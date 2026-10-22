/**
 * Ending a trip nobody else can end.
 *
 * A trip left `in_progress` — the driver's phone died, the app was uninstalled
 * mid-ride — had no exit. cancelTrip refuses an in_progress trip, only the
 * driver can complete one, and createTrip refuses a rider whose activeTripId
 * still points at a live trip. So the rider could never book again.
 *
 * Two ways out, sharing one transaction:
 *  - `sweepStuckTrips` closes any trip still in_progress a day after it started.
 *    A day, not hours, because a city-to-city ride is legitimately long and
 *    cutting a real one short is worse than a rider waiting for the desk.
 *  - `adminForceEndTrip` lets the desk close any live trip at once, for the
 *    rider who rings support.
 *
 * The trip ends `cancelled` with no fee and no commission: nothing was settled,
 * and the desk can still charge or refund by hand. Any wallet hold goes back.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAdmin } from '../lib/guards';
import { ACTIVE_STATUSES } from './index';

/** How long after starting an in_progress trip counts as abandoned. */
export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;

function startedMs(trip: FirebaseFirestore.DocumentSnapshot): number | null {
  const at = (trip.get('startedAt') ?? trip.get('matchedAt') ?? trip.get('createdAt')) as
    | FirebaseFirestore.Timestamp
    | undefined;
  return at?.toMillis?.() ?? null;
}

/**
 * Close a live trip and release everybody it holds. `stillStuck` is re-checked
 * inside the transaction, so a driver completing the ride at the same moment
 * wins. Returns false when there was nothing to end.
 */
export async function forceEndTrip(
  tripId: string,
  by: { uid: string; role: 'admin' } | { uid: 'system'; role: 'system' },
  reason: string,
  stillStuck: (trip: FirebaseFirestore.DocumentSnapshot) => boolean = () => true,
): Promise<boolean> {
  const tripRef = db.doc(`trips/${tripId}`);
  return db.runTransaction(async (tx) => {
    const trip = await tx.get(tripRef);
    if (!trip.exists || !ACTIVE_STATUSES.has(trip.get('status')) || !stillStuck(trip)) return false;
    const passengerId = trip.get('passengerId') as string;
    const driverId = trip.get('driverId') as string | null | undefined;
    const driverSnap = driverId ? await tx.get(db.doc(`drivers/${driverId}`)) : null;

    const walletHold = (trip.get('walletHold') as number | undefined) ?? 0;
    if (walletHold > 0) {
      const walletRef = db.doc(`wallets/${passengerId}`);
      tx.set(
        walletRef,
        { balance: FieldValue.increment(walletHold), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      tx.set(walletRef.collection('transactions').doc(), {
        type: 'ride_hold_refund',
        amount: walletHold,
        tripId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(
      tripRef,
      {
        status: 'cancelled',
        cancelledBy: by.uid,
        cancelledByRole: by.role,
        cancelledFrom: trip.get('status'),
        cancelReason: reason,
        cancellationFee: null,
        walletHold: 0,
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    for (const uid of new Set([passengerId, ...((trip.get('poolMembers') as string[] | undefined) ?? [])])) {
      tx.set(db.doc(`users/${uid}`), { activeTripId: null }, { merge: true });
    }
    if (driverSnap?.get('activeTripId') === tripId) {
      tx.set(driverSnap.ref, { activeTripId: null }, { merge: true });
    }
    tx.delete(db.doc(`openRequests/${tripId}`));
    return true;
  });
}

export const sweepStuckTrips = onSchedule('every 60 minutes', async () => {
  const isStuck = (trip: FirebaseFirestore.DocumentSnapshot) => {
    const started = startedMs(trip);
    return trip.get('status') === 'in_progress' && started !== null && Date.now() - started > STUCK_AFTER_MS;
  };
  // shortcut: reads the first 500 in_progress trips by id; past ~500 concurrent
  // rides add a (status, startedAt) index and order by startedAt instead.
  const live = await db.collection('trips').where('status', '==', 'in_progress').limit(500).get();
  let ended = 0;
  for (const doc of live.docs.filter(isStuck)) {
    try {
      if (await forceEndTrip(doc.id, { uid: 'system', role: 'system' }, 'stuck_in_progress', isStuck)) ended += 1;
    } catch (e) {
      // One bad document must not stop the sweep — the next run retries it.
      logger.warn('sweepStuckTrips: skipped a trip', { tripId: doc.id, error: e });
    }
  }
  if (ended) logger.info('Stuck trips ended', { examined: live.size, ended });
});

/** Admin-only: close a live trip that its driver or rider can no longer end. */
export const adminForceEndTrip = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = z
    .object({ tripId: docId, reason: z.string().trim().min(3).max(300) })
    .safeParse(req.data);
  if (!parsed.success) invalid('Say which ride and why it is being ended.');
  const { tripId, reason } = parsed.data;

  if (!(await forceEndTrip(tripId, { uid: admin.uid, role: 'admin' }, reason))) {
    throw new HttpsError('failed-precondition', 'That ride is not live.');
  }
  await db.collection('auditLogs').add({
    type: 'trip.force_ended',
    actor: admin.uid,
    tripId,
    reason,
    createdAt: FieldValue.serverTimestamp(),
  });
  logger.info('Trip force-ended', { actor: admin.uid, tripId });
  return { ok: true };
});
