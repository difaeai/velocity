/**
 * Delete expired ride-tracking links.
 *
 * `getTripWatch` already refuses an expired token, so nothing here is a
 * security control — this is hygiene. A link document holds a trip id and the
 * uid of whoever shared it, and keeping millions of dead ones around means
 * keeping a growing index of who shared which ride with their family for ever.
 * The shortest-lived copy of personal data is the one that was deleted.
 *
 * Runs well after expiry rather than exactly on it: the query is on
 * `expiresAt`, and sweeping a day late costs nothing while sweeping early could
 * kill a link somebody is still watching.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, Timestamp } from '../lib/firebase';

/** Deleted this long after a link stopped resolving. */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;

/** Kept well under the 500-write limit for a single batch. */
const BATCH = 300;

export const sweepTripWatchLinks = onSchedule(
  { schedule: 'every 24 hours', timeZone: 'Asia/Karachi' },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - PURGE_AFTER_MS);
    const stale = await db
      .collection('tripWatchLinks')
      .where('expiresAt', '<', cutoff)
      .limit(BATCH)
      .get();
    if (stale.empty) return;

    const batch = db.batch();
    for (const doc of stale.docs) batch.delete(doc.ref);
    await batch.commit();

    logger.info('Purged expired trip watch links', { deleted: stale.size });
  },
);
