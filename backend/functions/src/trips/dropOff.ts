/**
 * Dropping riders off one at a time.
 *
 * A solo ride has one ending: the passenger gets out and the trip is over, which
 * is what `completeTrip` has always done. A shared ride does not. Four people
 * can be going four different ways, and the driver stops four times — collecting
 * cash from a different person at each stop, and continuing after three of them.
 * There was no way to say any of that: the only button available ended the whole
 * trip, so the first person to reach their street ended everybody's ride.
 *
 * This marks ONE rider as dropped and answers with how many are still aboard.
 * It deliberately does not finish the trip itself even when it is the last
 * rider — `completeTrip` settles commission, partner credit and wallet holds,
 * and a second copy of that logic that drifts from the first is a far worse
 * problem than one extra round trip. The client drops the last rider, sees
 * `remaining: 0`, and calls `completeTrip` exactly as it always has.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireRole, invalid } from '../lib/guards';
import { sendToUser } from '../lib/fcm';
import type { PoolRider } from './enRoute';

/** A rider who has been let out. Stored on their entry in `poolRiders`. */
type DroppedRider = PoolRider & { droppedAt?: Timestamp | FieldValue };

const dropSchema = z.object({
  tripId: z.string().min(1).max(128),
  riderUid: z.string().min(1).max(128),
});

export const dropOffRider = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = dropSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and riderUid.');
  const { tripId, riderUid } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    if (snap.get('status') !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'The trip is not running.');
    }

    const riders = (snap.get('poolRiders') as DroppedRider[] | undefined) ?? [];
    const index = riders.findIndex((r) => r.uid === riderUid);
    if (index < 0) invalid('That rider is not on this ride.');

    const rider = riders[index]!;
    if (rider.droppedAt) invalid('That rider has already been dropped off.');

    // Firestore cannot update one element of an array in place, so the whole
    // array is rewritten — inside a transaction, so two stops tapped in quick
    // succession cannot lose one another's write.
    const updated = riders.map((r, i) =>
      i === index ? { ...r, droppedAt: Timestamp.now() } : r,
    );
    tx.set(
      tripRef,
      { poolRiders: updated, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    const remaining = updated.filter((r) => !r.droppedAt).length;
    return {
      remaining,
      fare: rider.fare,
      name: rider.name,
      paymentMethod: (snap.get('paymentMethod') as string | undefined) ?? 'cash',
    };
  });

  // Tell the rider they have arrived and what they owe, so the amount does not
  // depend on the driver's word for it.
  await sendToUser(
    riderUid,
    '📍 You have arrived',
    result.paymentMethod === 'cash'
      ? `Please pay PKR ${result.fare} in cash to your driver.`
      : `PKR ${result.fare} will be settled from your wallet.`,
    { tripId, kind: 'dropped_off' },
  );

  logger.info('Pool rider dropped off', { tripId, riderUid, remaining: result.remaining });
  return {
    ok: true,
    remaining: result.remaining,
    fare: result.fare,
    name: result.name,
  };
});
