/**
 * The driver's daily ride target — "16 pool rides today, no commission to pay".
 *
 * ── WHAT THE DRIVER EARNS ────────────────────────────────────────────────────
 *
 * A day of enough qualifying rides costs the driver **no commission at all**.
 * That waiver IS the reward. There is deliberately no separate cash bonus any
 * more: paying a bonus AND waiving the commission paid for the same day twice,
 * so the programme now has exactly one lever — hit the target and the day is
 * free; miss it and the day owes `rate × its cash fares` (see ./commission.ts,
 * which is where the missing day becomes payable at midnight).
 *
 * `dailyTargetBonus` survives as an admin field and ships at **0**. An admin who
 * wants to run a cash bonus on top of the waiver for a week can set it, and
 * everything below still works; nothing in the app shows a bonus while it is 0.
 *
 * ── WHAT IT IS CALLED ────────────────────────────────────────────────────────
 *
 * Anything the driver earns is a **BONUS**; "commission" is only ever the cut
 * they pay Velocity. The two are opposite directions of money and must never
 * share a word in front of a driver — a driver who reads "commission" on the
 * thing they just earned assumes they are being charged for it.
 *
 * The STORED name is still `commissionCredit` (the field, the
 * `commissionCredits` subcollection, `applyCommissionCredit`,
 * `adminAdjustCommissionCredit`). That is deliberate and follows the same call
 * the Travel Partner rename made about `travelMate*`: renaming a live field and
 * a deployed callable buys nothing a label cannot, and costs a migration on
 * money data. Change labels freely; leave the identifiers alone.
 *
 * ── WHICH RIDES COUNT ────────────────────────────────────────────────────────
 *
 * Only **pool / sharing rides**, while `dailyTargetPoolOnly` is on (it is, by
 * default). A solo ride still earns the driver their fare and still owes its
 * commission like any other ride — it simply does not move the counter. The
 * target exists to push drivers toward shared seats, which is the product; a
 * solo-only day is not the day we are paying for.
 *
 * "Pool" means what the rest of the codebase means by it: a `pool: true` trip
 * (booked pool, or a solo trip a driver turned into one with an en-route
 * pickup — `trips/enRoute.ts` sets the flag) and every driver-offered pool ride
 * from Sharing mode (`poolRides/`).
 *
 * ── WHY A DAY IS A PAKISTAN DAY ──────────────────────────────────────────────
 *
 * `onSchedule` and `Date` both default to UTC, and UTC midnight is 05:00 in
 * Karachi — a driver's morning rides would land on the previous day's target and
 * the shift that earned the waiver would be split across two. Every day key here
 * is computed at UTC+05:00, which is Pakistan Standard Time all year (Pakistan
 * has observed no DST since 2009), so there is no zone table to carry and no
 * hour that belongs to two days. Midnight Karachi is the deadline the driver was
 * promised, and it is the only boundary in here.
 *
 * ── WHY "QUALIFYING" RIDES ───────────────────────────────────────────────────
 *
 * A reward for a ride count is the most gameable thing in a ride-hailing app: a
 * driver and one friend can book sixteen minimum-fare rides around a car park
 * and go commission-free every single day. So a ride only counts toward the
 * target if it clears a fare floor, and the day only qualifies if it also spans
 * enough distinct passengers and enough total fare to be a real shift. Every one
 * of those guards is an admin field and every one of them can be set to 0 to
 * switch it off — but they default on, because the first week of a launch is
 * exactly when this gets farmed.
 *
 * The driver is told the rules and their progress against all of them, so a day
 * that will not qualify says so while there is still time to fix it rather than
 * at midnight, when the 5% lands and the lock comes down.
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

/** The Pakistan day before this one. */
export function pktPreviousDay(day: DayKey): DayKey {
  return pktDayKey(new Date(pktDayStart(day).getTime() - 1));
}

/** The admin-set shape of the incentive. Lives on config/commissionSettings. */
export interface DailyTargetSettings {
  /** Master switch. Off = no target, no waiver: every day owes its commission. */
  dailyTargetEnabled: boolean;
  /** Qualifying rides in one Pakistan day that make the day commission-free. */
  dailyTargetRides: number;
  /**
   * Cash bonus on top of the waiver, in PKR. **Ships at 0** — the waiver is the
   * reward. Left in place as an admin lever; see the file header.
   */
  dailyTargetBonus: number;
  /**
   * True = a day that met its target owes no commission on its own rides. This
   * is the whole programme, so it ships on; with `dailyTargetBonus` at 0,
   * turning it off leaves the target rewarding nothing at all.
   */
  dailyTargetWaivesCommission: boolean;
  /** Only pool / sharing rides count toward the target. See the file header. */
  dailyTargetPoolOnly: boolean;
  /** A ride below this fare does not count toward the target. 0 = no floor. */
  dailyTargetMinRideFare: number;
  /** Distinct passengers the day needs before it qualifies. 0 = no check. */
  dailyTargetMinRiders: number;
  /** Total gross fare the day needs before it qualifies. 0 = no check. */
  dailyTargetMinDayFare: number;
}

export const DEFAULT_DAILY_TARGET: DailyTargetSettings = {
  dailyTargetEnabled: true,
  dailyTargetRides: 16,
  // No separate bonus: the commission-free day is the reward. See the header.
  dailyTargetBonus: 0,
  dailyTargetWaivesCommission: true,
  dailyTargetPoolOnly: true,
  dailyTargetMinRideFare: 150,
  dailyTargetMinRiders: 5,
  // Must stay reachable by `dailyTargetRides × dailyTargetMinRideFare`
  // (16 × 150 = 2,400), or the day could not qualify on its own rules.
  dailyTargetMinDayFare: 2000,
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
  /** Every completed ride, pool or solo, qualifying or not. */
  rides: number;
  /** Pool / sharing rides, before the fare floor is applied. */
  poolRides: number;
  /** Rides that count toward the target — pool (if required) and over the floor. */
  qualifyingRides: number;
  /** Gross fare of every completed ride, PKR. */
  grossFare: number;
  /** Cash portion of the above — what commission would be charged on. */
  cashFare: number;
  /** Distinct passenger uids carried today, for the anti-farming check. */
  riderIds: string[];
  /**
   * The day crossed its target and was granted its waiver. The idempotency
   * guard: `bonusGranted > 0` used to be it, and cannot be any more now that
   * the bonus ships at 0.
   */
  granted: boolean;
  /** PKR of cash bonus granted for this day. 0 unless an admin set a bonus. */
  bonusGranted: number;
  /** PKR of waived commission credited for this day. */
  waiverGranted: number;
}

/** A day document that has not been written yet reads as an empty day. */
export function emptyDay(day: DayKey): DailyTargetDay {
  return {
    day,
    rides: 0,
    poolRides: 0,
    qualifyingRides: 0,
    grossFare: 0,
    cashFare: 0,
    riderIds: [],
    granted: false,
    bonusGranted: 0,
    waiverGranted: 0,
  };
}

/**
 * Does this ride count toward the target at all?
 *
 * Two independent gates: it has to be the kind of ride we are rewarding (a pool
 * ride, while `dailyTargetPoolOnly` is on) and it has to clear the fare floor.
 */
export function rideQualifies(
  fare: number,
  settings: DailyTargetSettings,
  isPoolRide: boolean,
): boolean {
  if (settings.dailyTargetPoolOnly && !isPoolRide) return false;
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
  /** Only pool rides are counting — for the wording, app-side and web-side. */
  poolOnly: boolean;
  /** PKR of cash bonus the day pays on top of the waiver. 0 by default. */
  bonus: number;
  /** Every requirement is met right now. */
  met: boolean;
  /** This day has already been granted its waiver (and bonus, if any). */
  granted: boolean;
  /** What is still missing, in driver-facing words. Empty when `met`. */
  blockers: TargetBlocker[];
  /** True while the day's own rides will not be charged commission. */
  commissionWaived: boolean;
}

/**
 * Where a day stands against the target.
 *
 * Pure, and shared by the backend (which decides whether the day is free) and
 * the driver app (which draws the progress card), so the driver can never be
 * shown a different rule from the one that is actually applied.
 */
export function dailyTargetProgress(
  day: DailyTargetDay,
  settings: DailyTargetSettings,
): DailyTargetProgress {
  const target = Math.max(1, Math.round(settings.dailyTargetRides));
  const poolOnly = settings.dailyTargetPoolOnly;
  const blockers: TargetBlocker[] = [];

  if (day.qualifyingRides < target) {
    const kind = poolOnly ? 'pool rides' : 'rides';
    blockers.push({
      key: 'rides',
      label:
        settings.dailyTargetMinRideFare > 0
          ? `${target} ${kind} of PKR ${settings.dailyTargetMinRideFare}+`
          : `${target} ${kind}`,
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

  // `bonusGranted > 0` is read as well so days written before the bonus went to
  // zero keep the waiver they were given.
  const granted = day.granted || day.bonusGranted > 0;
  const met = blockers.length === 0;
  return {
    day: day.day,
    enabled: settings.dailyTargetEnabled,
    rides: day.qualifyingRides,
    target,
    ridesToGo: Math.max(0, target - day.qualifyingRides),
    poolOnly,
    bonus: Math.round(settings.dailyTargetBonus),
    met,
    granted,
    blockers,
    // The waiver follows the target: a day that hit it is a day whose rides are
    // free of commission, and a day that did not is charged as usual.
    // `granted` is in there so a day that qualified and then had its figures
    // move (an admin editing the target mid-day) keeps the waiver it was given
    // rather than retroactively owing commission on rides already driven.
    commissionWaived:
      settings.dailyTargetEnabled && settings.dailyTargetWaivesCommission && (met || granted),
  };
}
