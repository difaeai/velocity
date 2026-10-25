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
import { docId, invalid, requireRole } from '../lib/guards';
import { sendToUser } from '../lib/fcm';
import { isWarmPing, warmUp } from '../lib/warmup';
import type { PoolRider } from './enRoute';
import { poolPerSeatFare } from '../domain/fares';
import { rosterForTrip, type PoolRosterEntry } from './poolRoster';
import { feeDue, feeRef, stampFeeDue } from '../payments/nextRideFees';

/** A rider who has been let out. Stored on their entry in `poolRiders`. */
type DroppedRider = PoolRider & { droppedAt?: Timestamp | FieldValue; boardedAt?: Timestamp };

const dropSchema = z.object({
  tripId: docId,
  riderUid: docId,
});

/**
 * Which array holds the riders depends on how the pool was formed: an en-route
 * pickup writes the priced `poolRiders`, a destination pool writes `poolRoster`
 * (see trips/poolRoster). Both are lists of people to let in and out one at a
 * time, and the field that is present is the one we update.
 */
export function ridersOf(snap: FirebaseFirestore.DocumentSnapshot): {
  field: 'poolRiders' | 'poolRoster';
  riders: (DroppedRider | PoolRosterEntry)[];
} {
  const enRouteRiders = (snap.get('poolRiders') as DroppedRider[] | undefined) ?? [];
  return enRouteRiders.length === 0
    ? { field: 'poolRoster', riders: rosterForTrip(snap.data() ?? {}) }
    : { field: 'poolRiders', riders: enRouteRiders };
}

/**
 * Starting one rider's ride on a shared car.
 *
 * A shared car does not start once: riders get in at the pickup one by one,
 * and an en-route rider gets in halfway along. So each one is started on their
 * own, and told so. The first rider in moves an arrived trip to in_progress —
 * the wheels are turning from then on. Money is untouched: what each rider owes
 * is still decided where it always was, at drop-off and completion.
 */
export const boardPoolRider = onCall({ invoker: 'public' }, async (req) => {
  const ctx = requireRole(req, 'driver');
  if (isWarmPing(req.data)) return warmUp();
  const parsed = dropSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and riderUid.');
  const { tripId, riderUid } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  const result = await db.runTransaction(async (tx) => {
    // Their wallet too: an unpaid fee is added to the ride they are starting.
    const [snap, walletSnap] = await Promise.all([tx.get(tripRef), tx.get(db.doc(`wallets/${riderUid}`))]);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    const status = snap.get('status') as string;
    if (status !== 'arrived' && status !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'Tap "Arrived at pickup" first.');
    }

    const { field, riders } = ridersOf(snap);
    const index = riders.findIndex((r) => r.uid === riderUid);
    if (index < 0) invalid('That rider is not on this ride.');
    const rider = riders[index]!;
    if (rider.droppedAt) invalid('That rider has already been dropped off.');
    // A double tap, or two phones: already started is done, not an error.
    if (rider.boardedAt) return { started: false, status };

    const updated = riders.map((r, i) => (i === index ? { ...r, boardedAt: Timestamp.now() } : r));
    const starting = status === 'arrived';
    tx.set(
      tripRef,
      {
        [field]: updated,
        ...(starting ? { status: 'in_progress', startedAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (((snap.get('paymentMethod') as string | undefined) ?? 'cash') === 'cash') {
      stampFeeDue(tx, tripId, riderUid, walletSnap);
    }
    return { started: true, status: 'in_progress' };
  });

  if (result.started) {
    await sendToUser(riderUid, '🛣️ Your ride has started', 'You are on your way to the destination.', {
      tripId,
    }).catch(() => {});
  }
  logger.info('Pool rider boarded', { tripId, riderUid, status: result.status });
  return { ok: true, status: result.status };
});

export const dropOffRider = onCall({ invoker: 'public' }, async (req) => {
  const ctx = requireRole(req, 'driver');
  if (isWarmPing(req.data)) return warmUp();
  const parsed = dropSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and riderUid.');
  const { tripId, riderUid } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);

  const result = await db.runTransaction(async (tx) => {
    const [snap, feeSnap] = await Promise.all([tx.get(tripRef), tx.get(feeRef(tripId, riderUid))]);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    if (snap.get('status') !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'The trip is not running.');
    }

    // A destination pool used to have no rider list at all, which is why its
    // driver had only "Complete trip" and the first passenger out ended
    // everyone's ride. See ridersOf.
    const { field, riders } = ridersOf(snap);
    const usingRoster = field === 'poolRoster';

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
      { [field]: updated, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    const remaining = updated.filter((r) => !r.droppedAt).length;
    // A destination pool prices everyone the same, so what this rider owes is
    // the tier fare — the driver's panel shows it and the rider is told it in
    // the push below, so the amount never rests on the driver's word alone.
    const soloFare = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number) ?? 0;
    const fare = usingRoster
      ? ((snap.get('poolFares') as Record<string, number> | undefined)?.[riderUid]
        ?? poolPerSeatFare(soloFare, Math.max(1, riders.length)))
      : (rider as DroppedRider).fare;
    const name = usingRoster
      ? (rider as PoolRosterEntry).firstName
      : (rider as DroppedRider).name;

    return {
      remaining,
      fare,
      name,
      // Collected with the rest of the money in completeTrip; only told here.
      fee: feeDue(feeSnap),
      paymentMethod: (snap.get('paymentMethod') as string | undefined) ?? 'cash',
    };
  });

  // Tell the rider they have arrived and what they owe, so the amount does not
  // depend on the driver's word for it.
  await sendToUser(
    riderUid,
    '📍 You have arrived',
    result.paymentMethod === 'cash'
      ? result.fee > 0
        ? `Please pay PKR ${result.fare + result.fee} in cash to your driver: the PKR ${result.fare} fare and the PKR ${result.fee} cancellation fee from an earlier ride.`
        : `Please pay PKR ${result.fare} in cash to your driver.`
      : `PKR ${result.fare} will be settled from your wallet.`,
    { tripId, kind: 'dropped_off' },
  );

  logger.info('Pool rider dropped off', { tripId, riderUid, remaining: result.remaining });
  return {
    ok: true,
    remaining: result.remaining,
    fare: result.fare,
    fee: result.fee,
    name: result.name,
  };
});
