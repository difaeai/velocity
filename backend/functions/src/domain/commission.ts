/**
 * Commission rules — shared by trips, pool rides and driver settlement.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 *
 * **A day is the unit.** Every completed ride adds its gross fare to the
 * driver's `cycleGrossFare`; cash rides also add to `cycleCashFare`. Then:
 *
 *   16 pool rides in one Pakistan day  →  that day costs NO commission at all.
 *   anything less                      →  the day owes `rate × its cash fares`,
 *                                         and that becomes payable the moment
 *                                         the day closes at midnight. Until it
 *                                         is cleared the driver cannot take new
 *                                         work.
 *
 * The rate is 5% of the cash the driver collected. Commission on online (wallet)
 * rides is already deducted from the held fare at completion, so charging the
 * cash portion only keeps mixed cash/online days from paying twice: a day earned
 * entirely online owes nothing and clears itself.
 *
 * ── NOTHING IS OWED MID-DAY ──────────────────────────────────────────────────
 *
 * There used to be a PKR 5,000 "settle threshold" that locked a driver the
 * moment their unsettled fares passed it. It is gone, and it had to go: a driver
 * needs the WHOLE day to reach sixteen pool rides, and at intercity fares the
 * old threshold fired at about the fourth one. It would have locked every driver
 * short of the exact thing it was meant to reward. So the open day never locks
 * anybody — the only lock is an unpaid day that has already ended.
 *
 * ── HOW "WHICH DAY" IS KNOWN ─────────────────────────────────────────────────
 *
 * Without a nightly sweep over every driver. Three fields on the driver document
 * carry it, and the answer is derived at read time from today's key:
 *
 *   `cycleGrossFare` / `cycleCashFare`   everything unsettled, as before.
 *   `cycleDay`                           the Pakistan day the open part is from.
 *   `cycleGrossToday` / `cycleCashToday` how much of the above is that day's.
 *
 * So the OPEN part is what belongs to `cycleDay` when `cycleDay` is today, and
 * the CLOSED part is the rest — which is exactly the money that is payable now.
 * At 23:59 the day's takings are open and nothing is due; at 00:00 the same
 * figures are closed and the driver is locked, with no write in between and no
 * scheduled job in the path. (A job does run, at 00:05, but only to TELL them —
 * see drivers/closeDay.ts. The money rule does not depend on it.)
 *
 * A driver carried over from before these fields existed has no `cycleDay`, so
 * their whole cycle reads as open — one day of grace, and from their next ride
 * they are on the new rule like everybody else.
 *
 * ── THE BONUS ────────────────────────────────────────────────────────────────
 *
 * `commissionCredit` on the driver document. It no longer comes from a daily
 * cash bonus (that ships at 0 — see ./dailyTarget.ts); what feeds it now is the
 * waiver on a target day's earlier rides and admin grants (a driver who paid at
 * the office, a bonus a bug lost). **To a driver it is called a bonus, never a
 * credit and never a commission** — see the naming note in ./dailyTarget.ts for
 * why the field keeps the older name. It is spent here and nowhere else: it pays
 * the commission the driver would otherwise have to transfer to us.
 *
 * So there are two numbers, and keeping them apart is what makes the money add
 * up afterwards:
 *
 *   `grossDue`      the commission actually earned on the closed days. This is
 *                   Velocity's revenue and it is what the ledger records.
 *   `due`           what the DRIVER still has to find, after their bonus. This
 *                   is what the lock and the settlement screens work from.
 *
 * `creditApplied` is the difference, and it is an incentive expense, not
 * revenue we failed to collect. Every settlement path ledgers both sides, so a
 * month where drivers paid half their commission out of waivers reads as full
 * revenue and a marketing cost rather than as a collection problem.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { db } from '../lib/firebase';
import {
  DEFAULT_DAILY_TARGET,
  type DailyTargetSettings,
  type DayKey,
} from './dailyTarget';

export interface CommissionSettings extends DailyTargetSettings {
  /** Fraction of cash fares a missed day owes, e.g. 0.05. Admin-set. */
  rate: number;
}

export const DEFAULT_COMMISSION: CommissionSettings = {
  rate: 0.05,
  ...DEFAULT_DAILY_TARGET,
};

/** A number from an admin text box, or the default when it is not usable. */
function setting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** A stored number, or 0. Negatives and junk read as 0, never as a credit. */
function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Admin-configurable settings from the dashboard Commission page.
 *
 * Every field is validated against a range rather than trusted, because all of
 * them arrive from a text input and they decide how much money leaves the
 * company every day. A value outside its range falls back to the default
 * instead of being clamped: a bonus typed as 200000 is a typo, and paying
 * PKR 50,000 (the clamp) would be just as wrong as paying what was typed.
 */
export async function getCommissionSettings(): Promise<CommissionSettings> {
  const snap = await db.doc('config/commissionSettings').get();
  const d = DEFAULT_COMMISSION;
  return {
    rate: setting(snap.get('rate'), d.rate, 0.001, 0.5),
    dailyTargetEnabled: snap.get('dailyTargetEnabled') !== false,
    dailyTargetRides: Math.round(setting(snap.get('dailyTargetRides'), d.dailyTargetRides, 1, 100)),
    dailyTargetBonus: Math.round(setting(snap.get('dailyTargetBonus'), d.dailyTargetBonus, 0, 50_000)),
    dailyTargetWaivesCommission: snap.get('dailyTargetWaivesCommission') !== false,
    dailyTargetPoolOnly: snap.get('dailyTargetPoolOnly') !== false,
    dailyTargetMinRideFare: Math.round(
      setting(snap.get('dailyTargetMinRideFare'), d.dailyTargetMinRideFare, 0, 100_000),
    ),
    dailyTargetMinRiders: Math.round(
      setting(snap.get('dailyTargetMinRiders'), d.dailyTargetMinRiders, 0, 100),
    ),
    dailyTargetMinDayFare: Math.round(
      setting(snap.get('dailyTargetMinDayFare'), d.dailyTargetMinDayFare, 0, 1_000_000),
    ),
  };
}

/**
 * Cash portion of the unsettled cycle. Drivers from before `cycleCashFare`
 * existed fall back to the full cycle gross (their cycles were all-cash).
 */
export function cycleCashFare(driverSnap: DocumentSnapshot): number {
  const cash = driverSnap.get('cycleCashFare') as number | undefined;
  if (typeof cash === 'number' && Number.isFinite(cash)) return Math.max(0, cash);
  return Math.max(0, num(driverSnap.get('cycleGrossFare')));
}

/** The driver's unspent bonus, in whole PKR. Never negative. */
export function commissionCredit(driverSnap: DocumentSnapshot | undefined): number {
  const credit = driverSnap?.get('commissionCredit') as number | undefined;
  return typeof credit === 'number' && Number.isFinite(credit) ? Math.max(0, Math.round(credit)) : 0;
}

/** The unsettled cycle, split into the day it is from. See the file header. */
export interface CycleState {
  /** Everything unsettled, cash and online together. */
  gross: number;
  /** The commissionable (cash) part of it. */
  cash: number;
  /** The Pakistan day the `*Today` figures belong to. Null on a legacy cycle. */
  day: DayKey | null;
  grossToday: number;
  cashToday: number;
}

/**
 * Read the cycle off a driver document.
 *
 * A cycle with no `cycleDay` is read as entirely open (`*Today` = the whole
 * cycle). That is the one-day grace for drivers who were mid-cycle when this
 * shipped: nothing of theirs is suddenly payable, and their next ride files them
 * under a real day.
 */
export function readCycle(driverSnap: DocumentSnapshot | undefined): CycleState {
  if (!driverSnap?.exists) {
    return { gross: 0, cash: 0, day: null, grossToday: 0, cashToday: 0 };
  }
  const gross = Math.max(0, num(driverSnap.get('cycleGrossFare')));
  const cash = Math.min(gross, cycleCashFare(driverSnap));
  const rawDay = driverSnap.get('cycleDay');
  const day = typeof rawDay === 'string' && rawDay.length === 10 ? rawDay : null;
  return {
    gross,
    cash,
    day,
    // Clamped to the totals: a half-applied write must not be able to report
    // more open money than the cycle actually holds, which would hide a debt.
    grossToday: day === null ? gross : Math.min(gross, Math.max(0, num(driverSnap.get('cycleGrossToday')))),
    cashToday: day === null ? cash : Math.min(cash, Math.max(0, num(driverSnap.get('cycleCashToday')))),
  };
}

/** The part of the cycle that belongs to the day still running. Not payable. */
export function openCycle(cycle: CycleState, today: DayKey): { gross: number; cash: number } {
  if (cycle.day !== null && cycle.day !== today) return { gross: 0, cash: 0 };
  return { gross: cycle.grossToday, cash: cycle.cashToday };
}

/** The part of the cycle from days that have already ended. Payable now. */
export function closedCycle(cycle: CycleState, today: DayKey): { gross: number; cash: number } {
  const open = openCycle(cycle, today);
  return {
    gross: Math.max(0, cycle.gross - open.gross),
    cash: Math.max(0, cycle.cash - open.cash),
  };
}

/** The commission that is payable right now, split by who is paying it. PKR. */
export interface CommissionBreakdown {
  /** Commission earned on the closed days — Velocity's revenue. */
  grossDue: number;
  /** The part of it covered by the driver's bonus. */
  creditApplied: number;
  /** What the driver still has to transfer. `grossDue - creditApplied`. */
  due: number;
  /** Bonus left over once this is settled. */
  creditRemaining: number;
  /** Cash fares the `grossDue` was charged on — for the ledger and the screens. */
  settleableCash: number;
  /** Gross fares of the same closed days. */
  settleableGross: number;
}

/**
 * Split the payable commission between the driver's bonus and their pocket.
 *
 * `today` is passed in rather than read from the clock so that a settlement
 * transaction and the guard that locked the driver can never disagree about
 * which day it is — a retry seconds after midnight would otherwise charge a
 * different amount from the one the driver was shown.
 */
export function commissionBreakdown(
  driverSnap: DocumentSnapshot,
  settings: CommissionSettings,
  today: DayKey,
): CommissionBreakdown {
  const closed = closedCycle(readCycle(driverSnap), today);
  const grossDue = Math.round(closed.cash * settings.rate);
  const credit = commissionCredit(driverSnap);
  const creditApplied = Math.min(credit, grossDue);
  return {
    grossDue,
    creditApplied,
    due: grossDue - creditApplied,
    creditRemaining: credit - creditApplied,
    settleableCash: closed.cash,
    settleableGross: closed.gross,
  };
}

/**
 * What the driver must pay out of pocket right now (PKR, whole rupees).
 *
 * Net of the bonus on purpose: this is the number the lock, the settlement
 * screen and the "commission due" push all mean. For the revenue figure use
 * `commissionBreakdown().grossDue`.
 */
export function commissionDue(
  driverSnap: DocumentSnapshot,
  settings: CommissionSettings,
  today: DayKey,
): number {
  return commissionBreakdown(driverSnap, settings, today).due;
}

/**
 * Everything the driver would owe if every day they have driven were settled
 * now — today's open day included.
 *
 * Only for leaving: account deletion has to collect the open day too, or
 * "delete account" becomes the cheapest way to skip a day's commission. The
 * lock and the settlement screens must NOT use this — they charge closed days
 * only, because an open day may still reach the target and cost nothing.
 */
export function commissionOwedInFull(
  driverSnap: DocumentSnapshot,
  settings: CommissionSettings,
): number {
  const grossDue = Math.round(cycleCashFare(driverSnap) * settings.rate);
  return Math.max(0, grossDue - commissionCredit(driverSnap));
}

/**
 * True when a day has closed owing commission the driver has not cleared.
 *
 * There is no threshold left in here: any unpaid closed day locks the driver,
 * which is the rule as asked for — clear it and you can take rides again.
 */
export function isCommissionLocked(
  driverSnap: DocumentSnapshot,
  settings: CommissionSettings,
  today: DayKey,
): boolean {
  return commissionDue(driverSnap, settings, today) > 0;
}

/** Guard for taking new work — throws when the driver must settle first. */
export function assertCommissionClear(
  driverSnap: DocumentSnapshot,
  settings: CommissionSettings,
  today: DayKey,
): void {
  const due = commissionDue(driverSnap, settings, today);
  if (due > 0) {
    throw new HttpsError(
      'failed-precondition',
      `Commission due: pay ${due} PKR to Velocity Rides to start taking rides again. ` +
        `Complete ${Math.max(1, Math.round(settings.dailyTargetRides))} ` +
        `${settings.dailyTargetPoolOnly ? 'pool rides' : 'rides'} in a day and that day costs you no commission.`,
    );
  }
}
