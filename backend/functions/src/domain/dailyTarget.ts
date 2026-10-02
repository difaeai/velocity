/**
 * The driver's daily ride target — "15 rides today, PKR 2,000 bonus".
 *
 * ── WHAT IT IS CALLED ──────────────────────────────────────────────────
 *
 * To a driver this is a **BONUS**, everywhere, in the app and on the web.
 * "Commission" is only ever the cut they pay Velocity. The two are opposite
 * directions of money and must never share a word in front of a driver — a
 * driver who reads "commission" on the thing they just earned assumes they are
 * being charged for it.
 *
 * The STORED name is still `commissionCredit` (the field, the
 * `commissionCredits` subcollection, `applyCommissionCredit`,
 * `adminAdjustCommissionCredit`). That is deliberate and follows the same call
 * the Travel Partner rename made about `travelMate*`: renaming a live field and
 * a deployed callable buys nothing a label cannot, and costs a migration on
 * money data. Change labels freely; leave the identifiers alone.
 *
 * WHAT THIS IS. Velocity charges drivers a commission on the cash fares they
 * collect (see ./commission.ts). On top of that there is an incentive: a driver
 * who completes the admin-set number of qualifying rides in one Pakistan day
 * earns a fixed bonus, and — while the admin leaves the waiver on — owes no
 * commission on that day's rides at all.
 *
 * The bonus is NOT cash. It can only ever be spent paying Velocity's own
 * charges, and it can never be withdrawn. That is the
 * same regulatory boundary the wallet ring-fence draws (domain/walletFunds.ts),
 * reached from the other side — money we hand out as an incentive is not money
 * we are holding for the driver, so letting it leave as cash would make it
 * e-money we are not licensed to issue. It is also simply what was asked for:
 * the bonus sits there and quietly pays the next days' commission until it
 * runs out.
 *
 * WHY A DAY IS A PAKISTAN DAY. `onSchedule` and `Date` both default to UTC, and
 * UTC midnight is 05:00 in Karachi — a driver's morning rides would land on the
 * previous day's target and the shift that earned the bonus would be split
 * across two. Every day key here is computed at UTC+05:00, which is Pakistan
 * Standard Time all year (Pakistan has observed no DST since 2009), so there is
 * no zone table to carry and no hour that belongs to two days.
 *
 * WHY "QUALIFYING" RIDES. A flat bonus for a ride count is the most gameable
 * thing in a ride-hailing app: a driver and one friend can book fifteen
 * minimum-fare rides around a car park and collect it every single day. So a
 * ride only counts toward the target if it clears a fare floor, and the day
 * only pays out if it also spans enough distinct passengers and enough total
 * fare to be a real shift. Every one of those guards is an admin field and
 * every one of them can be set to 0 to switch it off — but they default on,
 * because the first week of a launch is exactly when this gets farmed.
 *
 * The driver is told the rules and their progress against all of them, so a day
 * that will not pay out says so while there is still time to fix it rather than
 * at midnight.
 */

/** Pakistan Standard Time, UTC+05:00. No DST — see the file header. */
const PKT_OFFSET_MINUTES = 5 * 60;
const PKT_OFFSET_MS = PKT_OFFSET_MINUTES * 60_000;

/** A day in the driver's own timezone, as `YYYY-MM-DD`. */
export type DayKey = string;

/**
 * Which Pakistan day an instant falls in.
 *
 * Shifting the instant by the offset and then reading the UTC calendar fields
 * is the whole trick: it avoids `toLocaleString` (which depends on the ICU data
 * shipped with the runtime) and avoids a local-time read (which depends on the
 * container's TZ).
 */
export function pktDayKey(at: Date = new Date()): DayKey {
  return new Date(at.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Pakistan day began, as a UTC `Date`. For day-scoped queries. */
export function pktDayStart(day: DayKey): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - PKT_OFFSET_MS);
}

/** The admin-set shape of the incentive. Lives on config/commissionSettings. */
export interface DailyTargetSettings {
  /** Master switch. Off = no targets, no bonus, commission exactly as before. */
  dailyTargetEnabled: boolean;
  /** Qualifying rides in one Pakistan day that earn the bonus. */
  dailyTargetRides: number;
  /** Bonus granted when the target is met, in PKR. */
  dailyTargetBonus: number;
  /**
   * True = a day that met its target owes no commission on its own rides
   * either, so the driver keeps the whole bonus to spend on other days. False =
   * commission accrues as normal and the bonus simply offsets it.
   */
  dailyTargetWaivesCommission: boolean;
  /** A ride below this fare does not count toward the target. 0 = no floor. */
  dailyTargetMinRideFare: number;
  /** Distinct passengers the day needs before it pays out. 0 = no check. */
  dailyTargetMinRiders: number;
  /** Total gross fare the day needs before it pays out. 0 = no check. */
  dailyTargetMinDayFare: number;
}

export const DEFAULT_DAILY_TARGET: DailyTargetSettings = {
  dailyTargetEnabled: true,
  dailyTargetRides: 15,
  dailyTargetBonus: 2000,
  dailyTargetWaivesCommission: true,
  dailyTargetMinRideFare: 150,
  dailyTargetMinRiders: 5,
  dailyTargetMinDayFare: 2500,
};

/**
 * How many distinct passenger ids a day document keeps.
 *
 * The list exists for one yes/no question — "were there at least N different
 * people?" — so it only needs to hold enough to answer it. Capping it keeps a
 * 60-ride day from growing an unbounded array inside a document that is
 * rewritten on every single ride.
 */
export const MAX_TRACKED_RIDERS = 40;

/** One driver-day. `drivers/{uid}/dailyTargets/{YYYY-MM-DD}`, server-written. */
export interface DailyTargetDay {
  day: DayKey;
  /** Every completed ride, qualifying or not. */
  rides: number;
  /** Rides that cleared the fare floor — these are what the target counts. */
  qualifyingRides: number;
  /** Gross fare of every completed ride, PKR. */
  grossFare: number;
  /** Cash portion of the above — what commission would be charged on. */
  cashFare: number;
  /** Distinct passenger uids carried today, for the anti-farming check. */
  riderIds: string[];
  /** PKR of bonus already granted for this day. Non-zero = paid out once. */
  bonusGranted: number;
  /** PKR of waived commission credited for this day. */
  waiverGranted: number;
}

/** A day document that has not been written yet reads as an empty day. */
export function emptyDay(day: DayKey): DailyTargetDay {
  return {
    day,
    rides: 0,
    qualifyingRides: 0,
    grossFare: 0,
    cashFare: 0,
    riderIds: [],
    bonusGranted: 0,
    waiverGranted: 0,
  };
}

/** Does this ride count toward the target at all? */
export function rideQualifies(fare: number, settings: DailyTargetSettings): boolean {
  return fare >= settings.dailyTargetMinRideFare;
}

/** One unmet requirement, in the words the driver is shown. */
export interface TargetBlocker {
  key: 'rides' | 'riders' | 'dayFare';
  label: string;
  have: number;
  need: number;
}

export interface DailyTargetProgress {
  day: DayKey;
  enabled: boolean;
  /** Qualifying rides done today. */
  rides: number;
  /** Qualifying rides needed. */
  target: number;
  /** Rides still to go, floored at 0. */
  ridesToGo: number;
  /** PKR the day pays out when every requirement is met. */
  bonus: number;
  /** Every requirement is met right now. */
  met: boolean;
  /** The bonus for this day has already been granted. */
  granted: boolean;
  /** What is still missing, in driver-facing words. Empty when `met`. */
  blockers: TargetBlocker[];
  /** True while the day's own rides will not be charged commission. */
  commissionWaived: boolean;
}

/**
 * Where a day stands against the target.
 *
 * Pure, and shared by the backend (which decides whether to pay) and the driver
 * app (which draws the progress card), so the driver can never be shown a
 * different rule from the one that is actually applied.
 */
export function dailyTargetProgress(
  day: DailyTargetDay,
  settings: DailyTargetSettings,
): DailyTargetProgress {
  const target = Math.max(1, Math.round(settings.dailyTargetRides));
  const blockers: TargetBlocker[] = [];

  if (day.qualifyingRides < target) {
    blockers.push({
      key: 'rides',
      label:
        settings.dailyTargetMinRideFare > 0
          ? `${target} rides of PKR ${settings.dailyTargetMinRideFare}+`
          : `${target} rides`,
      have: day.qualifyingRides,
      need: target,
    });
  }
  if (settings.dailyTargetMinRiders > 0 && day.riderIds.length < settings.dailyTargetMinRiders) {
    blockers.push({
      key: 'riders',
      label: `${settings.dailyTargetMinRiders} different passengers`,
      have: day.riderIds.length,
      need: settings.dailyTargetMinRiders,
    });
  }
  if (settings.dailyTargetMinDayFare > 0 && day.grossFare < settings.dailyTargetMinDayFare) {
    blockers.push({
      key: 'dayFare',
      label: `PKR ${settings.dailyTargetMinDayFare.toLocaleString()} in fares`,
      have: Math.round(day.grossFare),
      need: settings.dailyTargetMinDayFare,
    });
  }

  const granted = day.bonusGranted > 0;
  const met = blockers.length === 0;
  return {
    day: day.day,
    enabled: settings.dailyTargetEnabled,
    rides: day.qualifyingRides,
    target,
    ridesToGo: Math.max(0, target - day.qualifyingRides),
    bonus: Math.round(settings.dailyTargetBonus),
    met,
    granted,
    blockers,
    // The waiver follows the payout: a day that earned its bonus is a day whose
    // rides are free of commission, and a day that did not is charged as usual.
    // `granted` is in there so a day that qualified and then had its figures
    // move (an admin editing the target mid-day) keeps the waiver it was given
    // rather than retroactively owing commission on rides already driven.
    commissionWaived:
      settings.dailyTargetEnabled && settings.dailyTargetWaivesCommission && (met || granted),
  };
}
