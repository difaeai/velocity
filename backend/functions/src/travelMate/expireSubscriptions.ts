/**
 * Travel Mate — daily subscription expiry job.
 *
 * Runs at midnight Asia/Karachi (00:00 PKT = 19:00 UTC previous day).
 * Finds every travelMateSubscriptions doc with status:'active' and endAt <= now,
 * marks it 'expired', and resets the matching travelMateQuota doc back to the
 * free tier so swipe.ts immediately enforces the monthly limit again.
 *
 * Processes in batches of 400 (well under Firestore's 500-op batch limit,
 * leaving headroom for the two writes per sub: the sub doc + the quota doc).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db, FieldValue, Timestamp } from '../lib/firebase';

const REGION = 'asia-south1';
const BATCH_SIZE = 400;

export const expireTravelMateSubscriptions = onSchedule(
  { schedule: '0 0 * * *', timeZone: 'Asia/Karachi', region: REGION },
  async () => {
    const now = Timestamp.now();
    let expired = 0;

    const snap = await db.collection('travelMateSubscriptions')
      .where('status', '==', 'active')
      .where('endAt', '<=', now)
      .limit(BATCH_SIZE)
      .get();

    if (snap.empty) {
      logger.info('expireTravelMateSubscriptions: nothing to expire');
      return;
    }

    const batch = db.batch();

    for (const doc of snap.docs) {
      const uid: string = doc.data().uid;

      // 1) Mark subscription expired.
      batch.update(doc.ref, {
        status: 'expired',
        expiredAt: FieldValue.serverTimestamp(),
      });

      // 2) Reset quota to free tier so swipe.ts uses freeMonthlySwipes again.
      const quotaRef = db.doc(`travelMateQuota/${uid}`);
      batch.set(quotaRef, {
        tier: 'free',
        subscriptionEndAt: null,
        subscriptionId: null,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      expired++;
    }

    await batch.commit();
    logger.info(`expireTravelMateSubscriptions: expired ${expired} subscriptions`);
  },
);
