/**
 * Commission cycle rules — shared by trips, pool rides and driver settlement.
 *
 * Every completed ride adds its gross fare to the driver's `cycleGrossFare`;
 * cash rides also add to `cycleCashFare`. When `cycleGrossFare` reaches the
 * admin-set threshold (config/commissionSettings) the driver is locked out of
 * taking new work until they settle.
 *
 * What they owe is `rate × cycleCashFare` — the commission on online (wallet)
 * rides is already deducted from the held fare at completion, so charging the
 * cash portion only keeps mixed cash/online cycles from paying twice. A cycle
 * earned entirely online therefore owes nothing and clears automatically.
 *
 * ── THE BONUS ────────────────────────────────────────────────────────────────
 *
 * On top of that there is the daily ride target (see ./dailyTarget.ts): a day
 * of enough real rides grants a fixed bonus, stored as `commissionCredit` on
 * the driver document. **To a driver it is called a bonus, never a credit and
 * never a commission** — see the naming note in ./dailyTarget.ts for why the
 * field keeps the older name. The bonus is spent here and nowhere else: it pays
 * the commission the driver would otherwise have to transfer to us, and when it
 * runs out they are locked and settle by bank transfer as before.
 *
 * So there are two numbers, and keeping them apart is what makes the money add
 * up afterwards:
 *
 *   `grossDue`      the commission actually earned on the cycle. This is
 *                   Velocity's revenue and it is what the ledger records.
 *   `due`           what the DRIVER still has to find, after their bonus. This
 *                   is what the lock and the settlement screens work from.
 *
 * `creditApplied` is the difference, and it is an incentive expense, not
 * revenue we failed to collect. Every settlement path ledgers both sides, so a
 * month where drivers paid half their commission out of target bonuses reads
 * as full revenue and a marketing cost rather than as a collection problem.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { db } from '../lib/firebase';
import {
  DEFAULT_DAILY_TARGET,
  type DailyTargetSettings,
} from './dailyTarget';

export interface CommissionSettings extends DailyTargetSettings {
  /** Fraction of cash fares owed per cycle, e.g. 0.10. Admin-set. */
  rate: number;
  /** Gross fare (cash + online) that locks the driver, in PKR. Admin-set. */
  threshold: number;
}

export const DEFAULT_COMMISSION: CommissionSettings = {
  rate: 0.10,
  threshold: 5000,
  ...DEFAULT_DAILY_TARGET,
};

/** A number from an admin text box, or the default when it is not usable. */
function setting(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * Admin-configurable settings from the dashboard Commission page.
 *
 * Every field is validated against a range rather than trusted, because all of
 * them arrive from a text input and three of them decide how much money leaves
 * the company every day. A value outside its range falls back to the default
 * instead of being clamped: a bonus typed as 200000 is a typo, and paying
 * PKR 50,000 (the clamp) would be just as wrong as paying what was typed.
 */
export async function getCommissionSettings(): Promise<CommissionSettings> {
  const snap = await db.doc('config/commissionSettings').get();
  const d = DEFAULT_COMMISSION;
  return {
    rate: setting(snap.get('rate'), d.rate, 0.001, 0.5),
    threshold: setting(snap.get('threshold'), d.threshold, 100, 1_000_000),
    dailyTargetEnabled: snap.get('dailyTargetEnabled') !== false,
    dailyTargetRides: Math.round(setting(snap.get('dailyTargetRides'), d.dailyTargetRides, 1, 100)),
    dailyTargetBonus: Math.round(setting(snap.get('dailyTargetBonus'), d.dailyTargetBonus, 0, 50_000)),
    dailyTargetWaivesCommission: snap.get('dailyTargetWaivesCommission') !== false,
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
 * Cash portion of the current cycle. Drivers from before `cycleCashFare`
 * existed fall back to the full cycle gross (their cycles were all-cash).
 */
export function cycleCashFare(driverSnap: DocumentSnapshot): number {
  const cash = driverSnap.get('cycleCashFare') as number | undefined;
  if (typeof cash === 'number') return cash;
  return (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0;
}

/** The driver's unspent bonus, in whole PKR. Never negative. */
export function commissionCredit(driverSnap: DocumentSnapshot | undefined): number {
  const credit = driverSnap?.get('commissionCredit') as number | undefined;
  return typeof credit === 'number' && Number.isFinite(credit) ? Math.max(0, Math.round(credit)) : 0;
}

/** The commission on a cycle, split by who is paying it. All PKR. */
export interface CommissionBreakdown {
  /** Commission earned on the cycle — Velocity's revenue. */
  grossDue: number;
  /** The part of it covered by the driver's bonus. */
  creditApplied: number;
  /** What the driver still has to transfer. `grossDue - creditApplied`. */
  due: number;
  /** Bonus left over once this cycle is settled. */
  creditRemaining: number;
}

/** Split the cycle's commission between the driver's bonus and their pocket. */
export function commissionBreakdown(
  driverSnap: DocumentSnapshot,
  settings: CommissionSettings,
): CommissionBreakdown {
  const grossDue = Math.round(cycleCashFare(driverSnap) * settings.rate);
  const credit = commissionCredit(driverSnap);
  const creditApplied = Math.min(credit, grossDue);
  return {
    grossDue,
    creditApplied,
    due: grossDue - creditApplied,
    creditRemaining: credit - creditApplied,
  };
}

/**
 * What the driver must pay out of pocket right now (PKR, whole rupees).
 *
 * Net of the bonus on purpose: this is the number the lock, the settlement
 * screen and the "commission due" push all mean. For the revenue figure use
 * `commissionBreakdown().grossDue`.
 */
export function commissionDue(driverSnap: DocumentSnapshot, settings: CommissionSettings): number {
  return commissionBreakdown(driverSnap, settings).due;
}

/** True when the cycle reached the threshold and something is still owed. */
export function isCommissionLocked(driverSnap: DocumentSnapshot, settings: CommissionSettings): boolean {
  const gross = (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0;
  return gross >= settings.threshold && commissionDue(driverSnap, settings) > 0;
}

/** Guard for taking new work — throws when the driver must settle first. */
export function assertCommissionClear(driverSnap: DocumentSnapshot, settings: CommissionSettings): void {
  if (isCommissionLocked(driverSnap, settings)) {
    const due = commissionDue(driverSnap, settings);
    throw new HttpsError(
      'failed-precondition',
      `Commission due: pay ${due} PKR to Velocity Rides to keep accepting rides.`,
    );
  }
}
