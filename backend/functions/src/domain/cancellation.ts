/**
 * Cancellation fee rules — the money side of cancelTrip.
 *
 * Cancelling a request nobody has taken yet is free: the passenger is just
 * withdrawing an offer. Once a driver has accepted the bid the two sides have a
 * deal, and whoever walks away from it pays a fee on the locked fare:
 *
 *   passenger cancels → 5% of the fare
 *   driver cancels    → 8% of the fare  (they cost the passenger a ride and a
 *                                        driver who was already en route)
 *
 * The fee is money owed to Velocity, not to the other party. It is taken from
 * the canceller's wallet balance if they have one; whatever the balance cannot
 * cover becomes `outstanding` on their wallet — a debt to the company that both
 * passengers and drivers carry. Small debts don't get in the way, but once the
 * outstanding total reaches `outstandingLimit` the account is blocked from
 * booking (passenger) or bidding (driver) until it is settled by transferring
 * the amount to Velocity and uploading a screenshot (see payments/cancellationFees).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { db } from '../lib/firebase';
import type { TripStatus } from './types';

export interface CancellationSettings {
  /** Fraction of the locked fare a passenger pays for cancelling after match. */
  passengerFeeRate: number;
  /** Fraction of the locked fare a driver pays for cancelling after accepting. */
  driverFeeRate: number;
  /** Outstanding debt (PKR) at which the account is blocked until it settles. */
  outstandingLimit: number;
}

export const DEFAULT_CANCELLATION: CancellationSettings = {
  passengerFeeRate: 0.05,
  driverFeeRate: 0.08,
  outstandingLimit: 300,
};

/**
 * Statuses in which a cancellation costs money. `requested` is free (no driver
 * has committed yet); `in_progress` and later cannot be cancelled at all, so
 * they never reach the fee logic.
 */
export const FEE_BEARING_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'matched',
  'arriving',
  'arrived',
]);

/** A rate is only honoured if it is a sane fraction — never more than half the fare. */
function safeRate(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.5
    ? value
    : fallback;
}

/** Admin-configurable settings from the dashboard (config/cancellationSettings). */
export async function getCancellationSettings(): Promise<CancellationSettings> {
  const snap = await db.doc('config/cancellationSettings').get();
  const limit = snap.get('outstandingLimit') as number | undefined;
  return {
    passengerFeeRate: safeRate(snap.get('passengerFeeRate'), DEFAULT_CANCELLATION.passengerFeeRate),
    driverFeeRate: safeRate(snap.get('driverFeeRate'), DEFAULT_CANCELLATION.driverFeeRate),
    outstandingLimit:
      typeof limit === 'number' && Number.isFinite(limit) && limit >= 0
        ? Math.round(limit)
        : DEFAULT_CANCELLATION.outstandingLimit,
  };
}

/**
 * The fee for cancelling a trip, in whole PKR.
 * Returns 0 when the status is free to cancel or there is no fare to charge on.
 */
export function cancellationFee(params: {
  status: TripStatus;
  cancelledByRole: 'passenger' | 'driver';
  fare: number;
  settings: CancellationSettings;
}): { amount: number; rate: number } {
  const { status, cancelledByRole, fare, settings } = params;
  if (!FEE_BEARING_STATUSES.has(status)) return { amount: 0, rate: 0 };
  if (!Number.isFinite(fare) || fare <= 0) return { amount: 0, rate: 0 };

  const rate = cancelledByRole === 'driver' ? settings.driverFeeRate : settings.passengerFeeRate;
  return { amount: Math.round(fare * rate), rate };
}

/**
 * Split a fee between the wallet balance that can absorb it now and the debt
 * that has to be carried. `available` is the balance the canceller will have
 * once the transaction's other movements (e.g. a released ride hold) land.
 */
export function splitFeeAgainstBalance(
  fee: number,
  available: number,
): { paidFromWallet: number; addedToOutstanding: number } {
  const payable = Math.max(0, Math.min(fee, Math.floor(available)));
  return { paidFromWallet: payable, addedToOutstanding: fee - payable };
}

/** What this user currently owes Velocity in unpaid cancellation fees (PKR). */
export function walletOutstanding(walletSnap: DocumentSnapshot | undefined): number {
  const value = walletSnap?.get('outstanding') as number | undefined;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** True once the debt is big enough to stop the account taking new rides. */
export function isOutstandingBlocked(outstanding: number, settings: CancellationSettings): boolean {
  return settings.outstandingLimit > 0 && outstanding >= settings.outstandingLimit;
}

/**
 * Guard for taking new work / booking a new ride. Throws when unpaid
 * cancellation fees have reached the block threshold.
 */
export function assertOutstandingClear(
  walletSnap: DocumentSnapshot | undefined,
  settings: CancellationSettings,
  role: 'passenger' | 'driver',
): void {
  const outstanding = walletOutstanding(walletSnap);
  if (!isOutstandingBlocked(outstanding, settings)) return;

  throw new HttpsError(
    'failed-precondition',
    role === 'driver'
      ? `Cancellation fees due: pay ${outstanding} PKR to Velocity to keep accepting rides.`
      : `Cancellation fees due: pay ${outstanding} PKR to Velocity to book another ride.`,
  );
}
