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
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { db } from '../lib/firebase';

export interface CommissionSettings {
  /** Fraction of cash fares owed per cycle, e.g. 0.10. Admin-set. */
  rate: number;
  /** Gross fare (cash + online) that locks the driver, in PKR. Admin-set. */
  threshold: number;
}

export const DEFAULT_COMMISSION: CommissionSettings = { rate: 0.10, threshold: 5000 };

/** Admin-configurable settings from the dashboard Commission page. */
export async function getCommissionSettings(): Promise<CommissionSettings> {
  const snap = await db.doc('config/commissionSettings').get();
  const rate = snap.get('rate') as number | undefined;
  const threshold = snap.get('threshold') as number | undefined;
  return {
    rate: Number.isFinite(rate) && rate! > 0 && rate! <= 0.5 ? rate! : DEFAULT_COMMISSION.rate,
    threshold: Number.isFinite(threshold) && threshold! >= 100 ? threshold! : DEFAULT_COMMISSION.threshold,
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

/** Commission owed right now for the driver's cycle (PKR, whole rupees). */
export function commissionDue(driverSnap: DocumentSnapshot, settings: CommissionSettings): number {
  return Math.round(cycleCashFare(driverSnap) * settings.rate);
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
      `Commission due: pay ${due} PKR to Velocity to keep accepting rides.`,
    );
  }
}
