import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';

const submitRatingSchema = z.object({
  tripId:     z.string().min(1).max(128),
  stars:      z.number().int().min(1).max(5),
  comment:    z.string().max(300).optional(),
  targetRole: z.enum(['driver', 'passenger']),
});

/**
 * Either participant submits a rating after a completed trip.
 * - passenger rates the driver  (targetRole: 'driver')
 * - driver rates the passenger  (targetRole: 'passenger')
 *
 * Prevents double-submission via per-trip flags; updates the driver's rolling
 * average rating in a transaction so reads and writes are consistent.
 */
export const submitRating = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = submitRatingSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid rating data.');
  const { tripId, stars, comment, targetRole } = parsed.data;

  const tripRef  = db.doc(`trips/${tripId}`);
  const tripSnap = await tripRef.get();
  if (!tripSnap.exists) invalid('Trip not found.');
  if (tripSnap.get('status') !== 'completed') invalid('Trip is not yet completed.');

  const passengerId = tripSnap.get('passengerId') as string;
  const driverId    = tripSnap.get('driverId')    as string;

  const isPassengerRatingDriver = targetRole === 'driver'    && ctx.uid === passengerId;
  const isDriverRatingPassenger = targetRole === 'passenger' && ctx.uid === driverId;
  if (!isPassengerRatingDriver && !isDriverRatingPassenger) {
    throw new HttpsError('permission-denied', 'You are not a participant of this trip.');
  }

  const alreadyField = targetRole === 'driver' ? 'passengerRated' : 'driverRated';
  if (tripSnap.get(alreadyField)) invalid('You have already rated this trip.');

  const targetUid = targetRole === 'driver' ? driverId : passengerId;

  await db.runTransaction(async (tx) => {
    const ratingRef = db.collection('ratings').doc(`${tripId}_${targetRole}`);
    tx.set(ratingRef, {
      tripId,
      stars,
      comment:    comment ?? null,
      raterId:    ctx.uid,
      targetUid,
      targetRole,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Mark trip so neither side can double-rate
    tx.set(tripRef, { [alreadyField]: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    // Update driver's rolling average (passenger ratings aren't aggregated yet)
    if (targetRole === 'driver') {
      const driverRef  = db.doc(`drivers/${targetUid}`);
      const driverSnap = await tx.get(driverRef);
      if (driverSnap.exists) {
        const prevRating: number = driverSnap.get('rating')      ?? 5.0;
        const prevCount:  number = driverSnap.get('ratingCount') ?? 0;
        const newCount  = prevCount + 1;
        const newRating = (prevRating * prevCount + stars) / newCount;
        tx.set(
          driverRef,
          {
            rating:      Math.round(newRating * 10) / 10,
            ratingCount: newCount,
            updatedAt:   FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }
  });

  logger.info('Rating submitted', { tripId, by: ctx.uid, targetRole, stars });
  return { ok: true };
});
