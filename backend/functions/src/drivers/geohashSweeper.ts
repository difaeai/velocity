/**
 * Stamps `drivers/{uid}.geohash` from the `lastLocation` the handset writes.
 * ----------------------------------------------------------------------------
 * This job is what lets the passenger map and the ride broadcast find drivers
 * by geography instead of reading every online driver in the country on every
 * single call — see lib/nearbyDrivers.ts for why that mattered and what it was
 * costing.
 *
 * WHY A SWEEP AND NOT A DOCUMENT TRIGGER
 * --------------------------------------
 * A Firestore `onDocumentWritten` trigger on `drivers/{uid}` would stamp the
 * cell within a second of each location write, which is strictly fresher. It
 * would also be the first document trigger in this codebase — a new Eventarc
 * surface, new service-agent permissions, and a deploy whose failure mode is
 * "no driver is ever findable again". A scheduled sweep reuses the machinery
 * that already runs half a dozen jobs here, and its failure mode is one minute
 * of staleness, which the radius padding in lib/nearbyDrivers.ts already
 * absorbs. When the fleet outgrows a per-minute sweep, the trigger is the
 * upgrade path.
 *
 * WHY THE UNBOUNDED SCAN IS STILL HERE, AND WHY THAT IS FINE
 * ---------------------------------------------------------
 * This job reads every online driver — the very query the rest of the change
 * removes. The difference is the rate. It used to run once per open home screen
 * per poll; here it runs ONCE A MINUTE for the whole country. At 1,200 online
 * drivers that is 20 document reads a second in total, against roughly 400,000
 * a second for the old per-request version at 10,000 concurrent users.
 * Centralising the scan is the entire point.
 *
 * ONLY CHANGED CELLS ARE WRITTEN
 * ------------------------------
 * A parked driver keeps pinging the same position, and rewriting an identical
 * geohash every minute would cost a write per driver per minute for nothing. So
 * the sweep compares first and writes only what moved, which also keeps the
 * index churn proportional to real movement.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { geohashForLocation } from 'geofire-common';

import { db } from '../lib/firebase';
import { DRIVER_GEOHASH_FIELD } from '../lib/nearbyDrivers';

const REGION = 'asia-south1';

/**
 * Ceiling on documents touched per run. Well above any plausible online fleet
 * for now; it is here so that a runaway `online: true` population cannot turn
 * one sweep into an unbounded job. Hitting it is logged loudly because it means
 * drivers beyond the cap are going unstamped and therefore unfindable.
 */
const MAX_DRIVERS_PER_RUN = 5000;

const WRITE_BATCH_SIZE = 400;

export const sweepDriverGeohashes = onSchedule(
  { schedule: '* * * * *', timeZone: 'Asia/Karachi', region: REGION },
  async () => {
    const snap = await db
      .collection('drivers')
      .where('online', '==', true)
      .where('verificationStatus', '==', 'approved')
      .limit(MAX_DRIVERS_PER_RUN)
      .get();

    if (snap.empty) return;

    const pending: { ref: FirebaseFirestore.DocumentReference; geohash: string }[] = [];

    for (const doc of snap.docs) {
      const loc = doc.get('lastLocation') as { lat?: number; lng?: number } | undefined;
      // A driver who has never sent a position has nothing to stamp. They are
      // already invisible to the map for the same reason, so this changes
      // nothing for them.
      if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
      if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) continue;

      const geohash = geohashForLocation([loc.lat, loc.lng]);
      if (doc.get(DRIVER_GEOHASH_FIELD) === geohash) continue;
      pending.push({ ref: doc.ref, geohash });
    }

    for (let i = 0; i < pending.length; i += WRITE_BATCH_SIZE) {
      const batch = db.batch();
      for (const p of pending.slice(i, i + WRITE_BATCH_SIZE)) {
        batch.set(p.ref, { [DRIVER_GEOHASH_FIELD]: p.geohash }, { merge: true });
      }
      await batch.commit();
    }

    if (snap.size >= MAX_DRIVERS_PER_RUN) {
      logger.error('sweepDriverGeohashes hit its cap — drivers beyond it are unfindable', {
        cap: MAX_DRIVERS_PER_RUN,
        scanned: snap.size,
        stamped: pending.length,
      });
    } else if (pending.length) {
      logger.info('sweepDriverGeohashes', { scanned: snap.size, stamped: pending.length });
    }
  },
);
