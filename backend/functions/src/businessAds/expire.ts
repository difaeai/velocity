/**
 * "Find your Customers" — daily plan expiry.
 *
 * Runs at midnight Asia/Karachi. An advertiser whose months ran out stops
 * reaching anyone: the account flips to `expired` and every live ad is paused.
 * Pausing rather than removing matters — the creative and its numbers survive, so
 * renewing is one tap and the analytics from the last campaign are still there
 * to justify it.
 *
 * nearby.ts independently skips ads whose `planExpiresAt` has passed, so a day
 * where this job fails to run cannot leak free notifications. This job is what
 * makes the advertiser's own screen tell the truth.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';

const REGION = 'asia-south1';
const BATCH_SIZE = 200;

export const expireBusinessAdPlans = onSchedule(
  { schedule: '5 0 * * *', timeZone: 'Asia/Karachi', region: REGION },
  async () => {
    const now = Timestamp.now();

    const snap = await db
      .collection('businessAdvertisers')
      .where('status', '==', 'active')
      .where('expiresAt', '<=', now)
      .limit(BATCH_SIZE)
      .get();

    if (snap.empty) {
      logger.info('expireBusinessAdPlans: nothing to expire');
      return;
    }

    let pausedAds = 0;

    for (const advertiser of snap.docs) {
      const uid = advertiser.id;
      const ads = await db
        .collection('businessAds')
        .where('ownerUid', '==', uid)
        .where('status', '==', 'active')
        .get();

      const batch = db.batch();
      batch.update(advertiser.ref, {
        status: 'expired',
        liveAds: 0,
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      for (const ad of ads.docs) {
        batch.update(ad.ref, {
          status: 'paused',
          pausedReason: 'plan_expired',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      pausedAds += ads.size;

      const { notifyUser } = await import('../lib/fcm');
      await notifyUser(
        uid,
        'Your advertising plan has ended',
        'Renew to start reaching customers near your business again. Your offers and results are saved.',
        'system',
        { screen: 'business-ads' },
      );
    }

    logger.info('expireBusinessAdPlans done', { advertisers: snap.size, pausedAds });
  },
);
