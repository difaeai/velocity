/**
 * "Find your Customers" — recount "Seen by" from the impression ledger.
 * ----------------------------------------------------------------------------
 * `viewers` (distinct people who opened an offer) started being counted on
 * 2026-09-15. Offers that were already running had opens recorded on their
 * impression docs (`clicks`, `lastClickedAt`) but no `firstViewedAt`, so their
 * "Seen by" started at zero while their open count did not.
 *
 * This walks the ledger once and makes the counters true:
 *   1. every impression with clicks > 0 and no `firstViewedAt` gets one — the
 *      best time we have for that first open (`lastClickedAt`, else the first
 *      notification);
 *   2. each ad's `viewers` and each advertiser's `totalViewers` are SET to the
 *      counted number, never incremented, so running it twice changes nothing;
 *   3. the last 7 days of daily `viewers` rollups are set the same way.
 *
 * The owner's own impression is skipped, matching recordBusinessAdClick.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { pkDay } from './config';

const PAGE = 400;
const ROLLUP_DAYS = 7;

export const adminBackfillBusinessAdViewers = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (req) => {
    const admin = requireAdmin(req);

    const perAd = new Map<string, number>();
    const perAdDay = new Map<string, number>();
    const adOwner = new Map<string, string>();
    const recentDays = new Set<string>();
    for (let i = 0; i < ROLLUP_DAYS; i++) recentDays.add(pkDay(new Date(Date.now() - i * 86_400_000)));

    let scanned = 0;
    let stamped = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    for (;;) {
      let q = db.collection('businessAdImpressions').where('clicks', '>', 0).orderBy('clicks').limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const page = await q.get();
      if (page.empty) break;

      const batch = db.batch();
      let writes = 0;
      for (const d of page.docs) {
        scanned++;
        const adId = d.get('adId') as string | undefined;
        const uid = d.get('uid') as string | undefined;
        const ownerUid = d.get('ownerUid') as string | undefined;
        if (!adId || !uid || uid === ownerUid) continue;
        if (ownerUid) adOwner.set(adId, ownerUid);

        let first = d.get('firstViewedAt') as Timestamp | undefined;
        if (!first) {
          first =
            (d.get('lastClickedAt') as Timestamp | undefined) ??
            (d.get('firstNotifiedAt') as Timestamp | undefined) ??
            Timestamp.now();
          batch.update(d.ref, { firstViewedAt: first, viewedAtBackfilled: true });
          writes++;
          stamped++;
        }

        perAd.set(adId, (perAd.get(adId) ?? 0) + 1);
        const day = pkDay(first.toDate());
        if (recentDays.has(day)) perAdDay.set(`${adId}|${day}`, (perAdDay.get(`${adId}|${day}`) ?? 0) + 1);
      }
      if (writes > 0) await batch.commit();
      cursor = page.docs[page.docs.length - 1] ?? null;
      if (page.size < PAGE) break;
    }

    // Absolute values. Ads with no opens at all are set to 0 too, so a counter
    // that drifted upward is corrected rather than left alone.
    const ads = await db.collection('businessAds').select('ownerUid').get();
    const perOwner = new Map<string, number>();
    let batch = db.batch();
    let pending = 0;
    const flush = async () => {
      if (pending > 0) await batch.commit();
      batch = db.batch();
      pending = 0;
    };

    for (const ad of ads.docs) {
      const viewers = perAd.get(ad.id) ?? 0;
      const owner = (ad.get('ownerUid') as string | undefined) ?? adOwner.get(ad.id);
      if (owner) perOwner.set(owner, (perOwner.get(owner) ?? 0) + viewers);
      batch.update(ad.ref, { viewers });
      pending++;
      for (const day of recentDays) {
        batch.set(
          db.doc(`businessAds/${ad.id}/daily/${day}`),
          { viewers: perAdDay.get(`${ad.id}|${day}`) ?? 0 },
          { merge: true },
        );
        pending++;
      }
      if (pending >= 400) await flush();
    }
    await flush();

    for (const [owner, total] of perOwner) {
      await db
        .doc(`businessAdvertisers/${owner}`)
        .update({ totalViewers: total })
        .catch(() => {});
    }

    await db.collection('auditLogs').add({
      type: 'businessAd.backfillViewers',
      actor: admin.uid,
      scanned,
      stamped,
      ads: ads.size,
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info('Business ad viewers backfilled', { scanned, stamped, ads: ads.size });
    return { ok: true, scanned, stamped, ads: ads.size, viewers: [...perAd.values()].reduce((a, b) => a + b, 0) };
  },
);
