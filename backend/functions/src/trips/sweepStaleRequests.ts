/**
 * Retire ride requests that nobody is waiting on any more.
 *
 * `openRequests` is a denormalised, driver-readable copy of a trip. It is
 * written when the trip is created and deleted in the SAME transaction that
 * accepts a bid or cancels the ride, so the two can never disagree by accident.
 *
 * What they can disagree about is a trip that reaches neither ending. A
 * passenger who force-quits the app — or loses their phone, or simply walks
 * away — leaves a trip sitting in `requested` for ever, and its request sitting
 * in the feed for ever with it. Drivers were still being offered those: tap,
 * drive to the pickup, find nobody there.
 *
 * It is worse than a wasted trip, because `users/{uid}.activeTripId` still
 * points at that trip. The backend refuses a second active trip, so the
 * passenger cannot book again either — they are locked out by a ride that
 * stopped existing in every sense except the database's.
 *
 * So this sweep does two different jobs, and the difference matters:
 *
 *  - A request whose trip is already finished, cancelled or gone is pure
 *    wreckage. Delete it. Always safe: the trip has an ending already.
 *  - A request whose trip is STILL `requested` past the TTL is a live document
 *    describing a dead intention. Cancelling it is a real decision about
 *    somebody's ride, so it only happens well past the point a driver would
 *    ever have taken it, and it frees the passenger to book again.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';

/**
 * How long a request may stay open before it counts as abandoned.
 *
 * Deliberately generous — far past the couple of minutes a real booking takes
 * to find a driver — because the cost of being wrong in one direction (a
 * driver wastes a trip) is much smaller than in the other (a passenger who
 * genuinely is waiting has their ride cancelled out from under them).
 *
 * The driver feed's own REQUEST_TTL_MS (apps/mobile/src/hooks/driver.ts) is
 * deliberately SHORTER than this, not equal to it. Hiding a request costs the
 * passenger nothing — the trip stays open, and a driver coming online inside
 * the window still sees it — while this TTL cancels the ride outright. The
 * client's must never grow past this one, or drivers would be shown rides the
 * sweep has already killed.
 */
const REQUEST_TTL_MS = 30 * 60 * 1000;

/** Statuses that mean the trip still legitimately wants a driver. */
const OPEN_STATUS = 'requested';

/** Firestore caps a batch at 500 writes; stay well under with room per doc. */
const BATCH_LIMIT = 200;

export const sweepStaleOpenRequests = onSchedule('every 5 minutes', async () => {
  const cutoff = new Date(Date.now() - REQUEST_TTL_MS);

  // Only ever look at requests old enough to be candidates. A busy city's
  // fresh requests are never read, so the sweep costs the same whether the
  // app has ten open rides or ten thousand.
  const stale = await db
    .collection('openRequests')
    .where('createdAt', '<', cutoff)
    .limit(BATCH_LIMIT)
    .get();

  if (stale.empty) return;

  let orphaned = 0;
  let abandoned = 0;

  for (const reqDoc of stale.docs) {
    const tripId = (reqDoc.get('tripId') as string | undefined) ?? reqDoc.id;
    const tripRef = db.doc(`trips/${tripId}`);

    try {
      await db.runTransaction(async (tx) => {
        const tripSnap = await tx.get(tripRef);

        // Trip gone entirely, or already ended: the request is wreckage.
        if (!tripSnap.exists || tripSnap.get('status') !== OPEN_STATUS) {
          tx.delete(reqDoc.ref);
          orphaned += 1;
          return;
        }

        // Still open, and past the TTL — nobody is coming. End it properly so
        // the passenger is not locked out of booking by a ride that is over.
        const passengerId = tripSnap.get('passengerId') as string | undefined;
        tx.set(
          tripRef,
          {
            status: 'cancelled',
            cancelledBy: 'system',
            cancelReason: 'expired',
            cancelledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        if (passengerId) {
          tx.set(db.doc(`users/${passengerId}`), { activeTripId: null }, { merge: true });
        }
        // Pool riders are held by the same pointer, and are just as stuck.
        for (const member of (tripSnap.get('poolMembers') as string[] | undefined) ?? []) {
          if (member !== passengerId) {
            tx.set(db.doc(`users/${member}`), { activeTripId: null }, { merge: true });
          }
        }
        tx.delete(reqDoc.ref);
        abandoned += 1;
      });
    } catch (e) {
      // One bad document must not stop the sweep — the next run retries it.
      logger.warn('sweepStaleOpenRequests: skipped a request', { tripId, error: e });
    }
  }

  logger.info('Stale open requests swept', {
    examined: stale.size,
    orphaned,
    abandoned,
  });
});
