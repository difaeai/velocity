/**
 * Deletes expired Google Maps coordinates. This is a licence obligation.
 * ----------------------------------------------------------------------------
 * The Google Maps Platform terms allow us to cache latitude and longitude for
 * "up to 30 consecutive calendar days, after which Customer must delete the
 * cached latitude and longitude values." Must, not should.
 *
 * A Firestore TTL policy on `mapsCache.expireAt` does this job natively and
 * should be created anyway (docs/HARDENING.md). This sweep exists because that
 * policy is a console setting: it lives outside the repo, nobody reviews it, and
 * a project restored from scratch or a second environment starts without it.
 * Compliance that depends on somebody having clicked something once is not
 * compliance. So the obligation is discharged in code here, and the TTL policy
 * becomes what it should be — a cheaper way to do the same thing first.
 *
 * Note what this sweep does NOT touch: `mapsPlaceIds`. Place IDs are expressly
 * exempt from the caching restrictions and may be stored indefinitely, and they
 * are the reason a lookup in month two costs $5/1,000 instead of $32/1,000.
 * Deleting them would be throwing away the one thing the licence lets us keep.
 * See lib/mapsCache.ts for why the two collections are separate.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, Timestamp } from '../lib/firebase';
import { COORD_COLLECTION } from '../lib/mapsCache';

/** Firestore caps a batch at 500 writes; deletes are cheap, so stay near it. */
const BATCH_LIMIT = 400;

/**
 * How many batches one run may clear.
 *
 * At 400 a batch this is 4,000 documents per run, daily. Far past anything a
 * Pakistani city's address traffic can produce in a day, and it stops a corrupt
 * or runaway collection from turning one scheduled run into an unbounded bill.
 * Anything left over is picked up tomorrow, still inside the 30-day window
 * because the cache writes a 29-day expiry.
 */
const MAX_BATCHES = 10;

/**
 * 04:00 Pakistan time, not 04:00 UTC.
 *
 * `onSchedule` defaults to UTC, which would have put this at 09:00 in Karachi —
 * the morning rush, and the opposite of the quiet hour a sweep wants. Every other
 * clock-time schedule in this codebase pins `Asia/Karachi` for the same reason;
 * interval schedules ("every 15 minutes") do not need it.
 */
export const sweepMapsCache = onSchedule({ schedule: 'every day 04:00', timeZone: 'Asia/Karachi' }, async () => {
  const now = Timestamp.now();
  let deleted = 0;

  for (let pass = 0; pass < MAX_BATCHES; pass++) {
    // Only ever reads documents that are already past their expiry, so the cost
    // of the sweep tracks what actually expired, not how big the cache is.
    const expired = await db
      .collection(COORD_COLLECTION)
      .where('expireAt', '<=', now)
      .limit(BATCH_LIMIT)
      .get();

    if (expired.empty) break;

    const batch = db.batch();
    expired.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += expired.size;

    // A short page means we have caught up; do not spend another query proving it.
    if (expired.size < BATCH_LIMIT) break;
  }

  if (deleted > 0) {
    logger.info('sweepMapsCache: deleted expired Maps coordinates', { deleted });
  }
});
