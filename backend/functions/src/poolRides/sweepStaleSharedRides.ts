/**
 * Retire shared-ride offers that nobody can take any more.
 * ---------------------------------------------------------------------------
 * Both kinds of shared-ride offer could be abandoned without ever reaching an
 * ending, and nothing closed them:
 *
 *   · `poolRides` — a driver posts a route for a time. If they never press
 *     "Start boarding", the document stays `open`/`collecting`/`full` for ever.
 *   · `poolRideRequests` — riders club together and wait for a driver. The
 *     document carries a 30-minute `expiresAt` that every join call honours,
 *     but nothing ever wrote the expiry down, so the row stayed `open` for ever.
 *
 * Why that mattered, in rising order of seriousness:
 *   1. Discovery feeds kept offering the row. (Now also filtered on read, see
 *      lifecycle.ts — but a filter is make-up on a document that is still lying.)
 *   2. Riders who had joined kept a `confirmed` seat, and their screen kept
 *      saying "Seat Reserved", on a car that was not coming.
 *   3. `hasLiveWork` in drivers/vehicles.ts counts an open pool ride as live
 *      work. One abandoned ride therefore locked that driver out of switching
 *      cars permanently — a dead row quietly disabling a real feature.
 *
 * WHAT THIS IS CAREFUL ABOUT
 *  - It never touches a ride that has started boarding or is in progress. The
 *    driver set off; this job has no opinion about a real journey.
 *  - Timings live in lifecycle.ts and are deliberately late (90 minutes past
 *    departure). Hiding a row is cheap, cancelling someone's ride is not.
 *  - Every document is re-read and re-checked inside its own transaction, so a
 *    driver who starts boarding in the same second wins.
 *  - One bad document never stops the sweep; the next run retries it.
 *  - People are only told about an expiry that just happened. The first run
 *    meets the whole backlog, and nobody needs a push about last month.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { notifyUser } from '../lib/fcm';
import {
  POOL_EXPIRY_NOTIFY_WINDOW_MS,
  POOL_REQUEST_EXPIRE_GRACE_MS,
  POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS,
  POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS,
  timestampMs,
} from './lifecycle';

/** Driver-posted statuses that mean nobody has set off yet. */
const SWEEPABLE_RIDE_STATUSES = ['open', 'collecting', 'full'] as const;

/**
 * Request statuses that are still waiting on somebody who is not coming.
 *
 * `negotiating` is in here with `open`: a driver's counter offer that the
 * leader never answered is as dead as a request no driver ever saw, and by the
 * time the grace has passed the driver who made it has long since moved on.
 * `active` is NOT — a driver accepted that pool, and it is a real ride.
 */
const SWEEPABLE_REQUEST_STATUSES = ['open', 'negotiating'] as const;

/** Firestore caps a batch at 500 writes; each document here costs several. */
const SCAN_LIMIT = 200;

/**
 * Documents this run could not finish. A single bad document must never stop
 * the sweep, but a run that skipped everything it looked at is a broken sweep
 * pretending to be a quiet one — so the count is carried out to the log.
 */
let skipped = 0;

/** Who to tell, and what the expiry was about — collected inside the transaction. */
interface Expiry {
  id: string;
  reason: 'departure_passed' | 'never_departed' | 'no_driver';
  /** Epoch-ms of the thing that lapsed — decides whether anyone is told. */
  atMs: number;
  driverId: string | null;
  riderIds: string[];
  where: string;
}

/**
 * Mark the seats and the pairing queue on a dead ride, and say whose they were.
 *
 * Every read happens before every write, because a Firestore transaction
 * refuses a read that follows a write — and the refusal lands in this job's
 * per-document catch, where it looks like nothing happened at all: the ride
 * silently stays open, which is the exact bug this sweep exists to fix.
 */
async function closeRideMembers(
  tx: FirebaseFirestore.Transaction,
  rideRef: FirebaseFirestore.DocumentReference,
): Promise<string[]> {
  // A seat that was confirmed is a promise being withdrawn, so it is written
  // down. One already picked up or dropped off belongs to a journey that
  // happened and is left exactly as it is.
  const [seats, queued] = await Promise.all([
    tx.get(rideRef.collection('passengers').where('status', '==', 'confirmed')),
    // Riders still queued for a same-gender pair that never arrived.
    tx.get(rideRef.collection('joinRequests').where('status', '==', 'queued')),
  ]);

  const touched: string[] = [];

  for (const seat of seats.docs) {
    tx.set(
      seat.ref,
      { status: 'expired', expiredAt: FieldValue.serverTimestamp(), expiredReason: 'ride_expired' },
      { merge: true },
    );
    touched.push((seat.get('userId') as string | undefined) ?? seat.id);
  }

  for (const q of queued.docs) {
    tx.set(
      q.ref,
      { status: 'expired', decidedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    const uid = (q.get('userId') as string | undefined) ?? q.id;
    if (!touched.includes(uid)) touched.push(uid);
  }

  return touched;
}

/**
 * Driver-posted rides whose time has gone.
 *
 * Two scans, because Firestore cannot ask one question of two fields: the ones
 * with a departure time that has passed, and the ones that never had a
 * departure time and are simply old. The second scan skips anything carrying a
 * departure time, which is what keeps a ride created yesterday for tonight
 * safe — it belongs to the first scan, and the first scan says it is not due.
 */
async function sweepDriverRides(now: number): Promise<Expiry[]> {
  const departedCutoff = new Date(now - POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS);
  const ancientCutoff = new Date(now - POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS);

  const [departed, ancient] = await Promise.all([
    db.collection('poolRides')
      .where('status', 'in', SWEEPABLE_RIDE_STATUSES)
      .where('departureTime', '<', departedCutoff)
      .orderBy('departureTime')
      .limit(SCAN_LIMIT)
      .get(),
    db.collection('poolRides')
      .where('status', 'in', SWEEPABLE_RIDE_STATUSES)
      .where('createdAt', '<', ancientCutoff)
      .orderBy('createdAt')
      .limit(SCAN_LIMIT)
      .get(),
  ]);

  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of departed.docs) candidates.set(doc.id, doc);
  for (const doc of ancient.docs) {
    // A ride with a departure time is the first scan's business, whatever its age.
    if (timestampMs(doc.get('departureTime')) !== null) continue;
    candidates.set(doc.id, doc);
  }

  const expired: Expiry[] = [];

  for (const candidate of candidates.values()) {
    const rideRef = candidate.ref;
    try {
      const outcome = await db.runTransaction(async (tx): Promise<Expiry | null> => {
        const snap = await tx.get(rideRef);
        if (!snap.exists) return null;

        const status = snap.get('status') as string;
        if (!(SWEEPABLE_RIDE_STATUSES as readonly string[]).includes(status)) return null;

        // Re-decided inside the transaction: the scan is a hint, this is the rule.
        const departureMs = timestampMs(snap.get('departureTime'));
        const createdMs = timestampMs(snap.get('createdAt'));
        let reason: Expiry['reason'];
        let atMs: number;
        if (departureMs !== null) {
          if (departureMs + POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS >= now) return null;
          reason = 'departure_passed';
          atMs = departureMs;
        } else {
          if (createdMs === null || createdMs + POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS >= now) return null;
          reason = 'never_departed';
          atMs = createdMs;
        }

        const riderIds = await closeRideMembers(tx, rideRef);

        tx.set(
          rideRef,
          {
            status: 'expired',
            expiredAt: FieldValue.serverTimestamp(),
            expiredBy: 'system',
            expiredReason: reason,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return {
          id: rideRef.id,
          reason,
          atMs,
          driverId: (snap.get('driverId') as string | undefined) ?? null,
          riderIds,
          where: (snap.get('dropoff')?.address as string | undefined) ?? 'your route',
        };
      });

      if (outcome) expired.push(outcome);
    } catch (e) {
      skipped += 1;
      logger.warn('sweepStaleSharedRides: skipped a pool ride', { rideId: rideRef.id, error: e });
    }
  }

  return expired;
}

/** Riders' pool requests that ran out of time without a driver. */
async function sweepRiderRequests(now: number): Promise<Expiry[]> {
  const cutoff = new Date(now - POOL_REQUEST_EXPIRE_GRACE_MS);

  const stale = await db.collection('poolRideRequests')
    .where('status', 'in', SWEEPABLE_REQUEST_STATUSES)
    .where('expiresAt', '<', cutoff)
    .orderBy('expiresAt')
    .limit(SCAN_LIMIT)
    .get();

  const expired: Expiry[] = [];

  for (const candidate of stale.docs) {
    const reqRef = candidate.ref;
    try {
      const outcome = await db.runTransaction(async (tx): Promise<Expiry | null> => {
        const snap = await tx.get(reqRef);
        if (!snap.exists) return null;

        const status = snap.get('status') as string;
        if (!(SWEEPABLE_REQUEST_STATUSES as readonly string[]).includes(status)) return null;
        // A driver holding the pool means it is a ride, not an unanswered offer.
        if (snap.get('driverId')) return null;

        const expiresMs = timestampMs(snap.get('expiresAt'));
        if (expiresMs === null || expiresMs + POOL_REQUEST_EXPIRE_GRACE_MS >= now) return null;

        // Riders waiting on the driver's yes, on a pool with no driver.
        const pending = await tx.get(
          reqRef.collection('joinRequests').where('status', '==', 'pending'),
        );
        for (const p of pending.docs) {
          tx.set(
            p.ref,
            { status: 'expired', decidedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
        }

        tx.set(
          reqRef,
          {
            status: 'expired',
            expiredAt: FieldValue.serverTimestamp(),
            expiredBy: 'system',
            expiredReason: 'no_driver',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return {
          id: reqRef.id,
          reason: 'no_driver',
          atMs: expiresMs,
          driverId: null,
          riderIds: ((snap.get('passengers') as string[] | undefined) ?? []),
          where: (snap.get('destinationAreaName') as string | undefined) ?? 'your destination',
        };
      });

      if (outcome) expired.push(outcome);
    } catch (e) {
      skipped += 1;
      logger.warn('sweepStaleSharedRides: skipped a pool request', { requestId: reqRef.id, error: e });
    }
  }

  return expired;
}

/** Tell the people whose plans just changed — and only them. */
async function announce(expiries: Expiry[], now: number): Promise<number> {
  const fresh = expiries.filter((e) => now - e.atMs <= POOL_EXPIRY_NOTIFY_WINDOW_MS);
  let sent = 0;

  for (const e of fresh) {
    const riderTitle = e.reason === 'no_driver' ? 'No driver took your shared ride' : 'Shared ride cancelled';
    const riderBody = e.reason === 'no_driver'
      ? `Nobody drove your pool to ${e.where}. Nothing was charged — book again whenever you like.`
      : `The driver never set off for ${e.where}, so your seat was released. Nothing was charged.`;

    for (const uid of e.riderIds) {
      await notifyUser(uid, riderTitle, riderBody, 'ride', { poolId: e.id }).catch(() => {});
      sent += 1;
    }
    if (e.driverId) {
      await notifyUser(
        e.driverId,
        'Your posted ride expired',
        e.reason === 'never_departed'
          ? 'A pool ride you posted sat unstarted and has been closed. Post a new one when you are driving.'
          : `Your pool ride to ${e.where} passed its departure time without boarding, so it was closed.`,
        'ride',
        { poolId: e.id },
      ).catch(() => {});
      sent += 1;
    }
  }

  return sent;
}

export const sweepStaleSharedRides = onSchedule('every 10 minutes', async () => {
  const now = Date.now();
  skipped = 0;

  // The two collections are independent: a failure in one must not cost the other.
  const [rides, requests] = await Promise.all([
    sweepDriverRides(now).catch((e) => {
      logger.error('sweepStaleSharedRides: driver-ride scan failed', { error: e });
      return [] as Expiry[];
    }),
    sweepRiderRequests(now).catch((e) => {
      logger.error('sweepStaleSharedRides: request scan failed', { error: e });
      return [] as Expiry[];
    }),
  ]);

  const notified = await announce([...rides, ...requests], now);

  if (rides.length || requests.length || skipped) {
    const summary = {
      poolRidesExpired: rides.length,
      poolRequestsExpired: requests.length,
      seatsReleased: rides.reduce((n, r) => n + r.riderIds.length, 0),
      notified,
      skipped,
    };
    if (skipped > 0) logger.warn('Stale shared-ride sweep finished with skips', summary);
    else logger.info('Stale shared-ride offers swept', summary);
  }
});
