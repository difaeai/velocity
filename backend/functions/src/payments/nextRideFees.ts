/**
 * A rider's unpaid cancellation fee rides along with their next ride.
 *
 * Riders pay cash and have no wallet a fee could come out of, so a fee they
 * could not pay sat on `outstanding` with nothing ever collecting it. Now it is
 * added to the next ride they take: stamped the moment that ride starts, so the
 * driver's screen asks for it together with the fare, and collected when the
 * ride is settled. The driver keeps that cash, so the fee becomes theirs to pay
 * Velocity — off their wallet credits first, the rest as their own outstanding,
 * the same way a fee of their own is paid (see trips/index cancelTrip).
 *
 *   trips/{tripId}/fees/{riderUid}   { amount, stampedAt, collected?, collectedAt? }
 *
 * A subcollection, not a field on the trip, because every co-rider can read the
 * trip document and somebody else's cancellation debt is not theirs to see.
 */
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import { splitFeeAgainstBalance, walletOutstanding } from '../domain/cancellation';
import { ledgerCreditSpend } from '../drivers/commissionCredit';
import { sendToUser } from '../lib/fcm';

export const feeRef = (tripId: string, uid: string) => db.doc(`trips/${tripId}/fees/${uid}`);

/**
 * Put the rider's unpaid fee on the ride that is starting. The caller has read
 * `wallets/{uid}` in this transaction (reads come before writes).
 */
export function stampFeeDue(tx: Transaction, tripId: string, uid: string, walletSnap: DocumentSnapshot): number {
  const amount = walletOutstanding(walletSnap);
  if (amount > 0) {
    tx.set(feeRef(tripId, uid), { amount, stampedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  return amount;
}

/**
 * Say so to both sides the moment a fee is put on a ride. A push reaches every
 * app build, including driver builds whose screen does not show the fee yet —
 * the driver is charged it, so they must hear to collect it.
 */
export async function tellFeeAdded(tripId: string, riderUid: string, driverId: string, fee: number): Promise<void> {
  if (fee <= 0) return;
  await Promise.allSettled([
    sendToUser(
      riderUid,
      `PKR ${fee} added to this ride`,
      `A cancellation fee from an earlier ride. Please pay it to your driver in cash with the fare.`,
      { tripId },
    ),
    sendToUser(
      driverId,
      `💵 Collect PKR ${fee} extra`,
      `Your passenger owes a PKR ${fee} cancellation fee from an earlier ride. Collect it with the fare — it is charged to your wallet credits.`,
      { tripId },
    ),
  ]);
}

/** A stamped fee that has not been collected yet, or 0. */
export function feeDue(feeSnap: DocumentSnapshot | undefined): number {
  if (!feeSnap?.exists || feeSnap.get('collectedAt')) return 0;
  const amount = feeSnap.get('amount') as number | undefined;
  return typeof amount === 'number' && amount > 0 ? Math.round(amount) : 0;
}

export interface FeeRead {
  uid: string;
  amount: number;
  wallet: DocumentSnapshot;
}

/** The reads `collectFees` needs, for the riders who actually rode. */
export async function readFeesDue(tx: Transaction, tripId: string, uids: string[]): Promise<FeeRead[]> {
  const fees = await Promise.all(uids.map((uid) => tx.get(feeRef(tripId, uid))));
  const due = uids.map((uid, i) => ({ uid, amount: feeDue(fees[i]) })).filter((f) => f.amount > 0);
  const wallets = await Promise.all(due.map((f) => tx.get(db.doc(`wallets/${f.uid}`))));
  return due.map((f, i) => ({ ...f, wallet: wallets[i]! }));
}

/**
 * Collect the stamped fees at the end of the ride, and pay what the driver now
 * owes — those fees plus anything they already owed — from their credits.
 *
 * `creditLeft` is the driver's credit after everything else this transaction
 * spends, which the caller knows and the snapshot does not.
 */
export function collectFees(params: {
  tx: Transaction;
  tripId: string;
  driverId: string;
  fees: FeeRead[];
  driverWallet: DocumentSnapshot;
  creditLeft: number;
}): { collected: number; byRider: Record<string, number>; paidFromCredit: number; driverOutstanding: number } {
  const { tx, tripId, driverId, fees, driverWallet, creditLeft } = params;

  let collected = 0;
  const byRider: Record<string, number> = {};
  for (const f of fees) {
    const owed = walletOutstanding(f.wallet);
    // Paid by transfer since the ride started: only what is still owed is taken.
    const take = Math.min(f.amount, owed);
    tx.set(feeRef(tripId, f.uid), { collected: take, collectedAt: FieldValue.serverTimestamp() }, { merge: true });
    if (take <= 0) continue;
    collected += take;
    byRider[f.uid] = take;
    tx.set(
      f.wallet.ref,
      { outstanding: owed - take, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(f.wallet.ref.collection('transactions').doc(), {
      type: 'cancellation_fee_paid',
      // Paid in cash to the driver, with the fare — no balance moves.
      amount: 0,
      cleared: take,
      method: 'next_ride_cash',
      tripId,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('platformLedger').doc(), {
      type: 'cancellation_fee_settled',
      source: 'next_ride_cash',
      userId: f.uid,
      driverId,
      tripId,
      amount: take,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  const owedBefore = walletOutstanding(driverWallet);
  if (collected + owedBefore === 0) return { collected: 0, byRider, paidFromCredit: 0, driverOutstanding: 0 };

  // The same split as a fee against a balance — here the balance is credits.
  const { paidFromWallet: paidFromCredit, addedToOutstanding: driverOutstanding } =
    splitFeeAgainstBalance(owedBefore + collected, Math.max(0, creditLeft));
  ledgerCreditSpend({
    tx,
    driverId,
    source: 'cancellation',
    ref: tripId,
    grossDue: paidFromCredit,
    creditApplied: paidFromCredit,
    due: 0,
    reason: 'Cancellation fees',
  });
  if (driverOutstanding !== owedBefore) {
    tx.set(driverWallet.ref, { outstanding: driverOutstanding, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  if (collected > 0) {
    tx.set(driverWallet.ref.collection('transactions').doc(), {
      type: 'cancellation_fee',
      amount: 0,
      fee: collected,
      collectedFromRiders: collected,
      paidFromCredit,
      outstanding: driverOutstanding,
      role: 'driver',
      tripId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  // Outstanding moved from riders to the driver; only the credit-paid part left it.
  if (paidFromCredit > 0) {
    tx.set(
      db.doc('system/counters'),
      {
        cancellationFeesCollected: FieldValue.increment(paidFromCredit),
        cancellationFeesOutstanding: FieldValue.increment(-paidFromCredit),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
  return { collected, byRider, paidFromCredit, driverOutstanding };
}
