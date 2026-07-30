/**
 * "Find your Customers" — what the advertiser gets to see.
 * ----------------------------------------------------------------------------
 * The whole pitch of the feature is "you paid to reach people nearby", so the
 * numbers that prove it have to be visible: how many pushes went out, how many
 * distinct people that was, how many of them opened the offer, and the rate
 * between the last two. Everything here is read off counters that were written
 * at the moment the thing happened (nearby.ts), so this callable never scans the
 * impression collection — that collection grows with users × ads and would be
 * the first thing to make the dashboard slow.
 *
 * The 7-day series comes from the per-ad daily rollups for the same reason. It
 * returns a row for every one of the last 7 days, zero-filled, so the client can
 * render a chart without worrying about missing buckets.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';

import { db, Timestamp } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { getBusinessAdSettings, pkDay, tierForRadius } from './config';
import type { BusinessAdStatus } from './types';

interface DayRow {
  day: string;
  notified: number;
  reach: number;
  clicks: number;
}

/** The last `n` days in Pakistan time, oldest first. */
function recentDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(pkDay(new Date(Date.now() - i * 86_400_000)));
  }
  return out;
}

const ms = (t: unknown): number | null =>
  t instanceof Timestamp ? t.toMillis() : null;

export const getBusinessAdDashboard = onCall(async (req) => {
  const { uid } = requireAuth(req);

  const [advertiserSnap, appSnap, adsSnap, settings] = await Promise.all([
    db.doc(`businessAdvertisers/${uid}`).get(),
    db.doc(`businessAdApplications/${uid}`).get(),
    db.collection('businessAds').where('ownerUid', '==', uid).limit(50).get(),
    getBusinessAdSettings(),
  ]);

  // Never advertised, or applied and still waiting. Either way there is no
  // dashboard yet — the app shows the pitch or the pending card off `stage`.
  if (!advertiserSnap.exists) {
    return {
      ok: true,
      stage: appSnap.exists ? ((appSnap.get('status') as string) ?? 'none') : 'none',
      application: appSnap.exists
        ? {
            status: appSnap.get('status') as string,
            radiusKm: appSnap.get('radiusKm') as number,
            months: appSnap.get('months') as number,
            monthlyFee: appSnap.get('monthlyFee') as number,
            totalFee: appSnap.get('totalFee') as number,
            currency: appSnap.get('currency') as string,
            rejectionReason: (appSnap.get('rejectionReason') as string | null) ?? null,
            draft: (appSnap.get('draft') as Record<string, string> | null) ?? null,
            submittedAtMs: ms(appSnap.get('submittedAt')),
          }
        : null,
      advertiser: null,
      ads: [],
      series: [],
      totals: { notified: 0, reach: 0, clicks: 0, ctr: 0 },
    };
  }

  const expiresAtMs = ms(advertiserSnap.get('expiresAt'));
  const expired = expiresAtMs !== null && expiresAtMs <= Date.now();
  const status = advertiserSnap.get('status') as string;
  const radiusKm = (advertiserSnap.get('radiusKm') as number) ?? 0;

  const ads = adsSnap.docs
    .filter((d) => d.get('status') !== 'removed')
    .map((d) => ({
      adId: d.id,
      title: d.get('title') as string,
      businessName: d.get('businessName') as string,
      offerDetails: d.get('offerDetails') as string,
      imageUrl: d.get('imageUrl') as string,
      status: d.get('status') as BusinessAdStatus,
      radiusKm: (d.get('radiusKm') as number) ?? radiusKm,
      notified: (d.get('notified') as number) ?? 0,
      reach: (d.get('reach') as number) ?? 0,
      clicks: (d.get('clicks') as number) ?? 0,
      moderationReason: (d.get('moderationReason') as string | null) ?? null,
      createdAtMs: ms(d.get('createdAt')),
    }))
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));

  // One rollup read per ad per day, 7 days — small, and only for ads that exist.
  const days = recentDays(7);
  const zeroed: Record<string, DayRow> = {};
  for (const day of days) zeroed[day] = { day, notified: 0, reach: 0, clicks: 0 };

  if (ads.length > 0) {
    const refs = ads.flatMap((ad) => days.map((day) => db.doc(`businessAds/${ad.adId}/daily/${day}`)));
    const rollups = await db.getAll(...refs);
    rollups.forEach((snap, i) => {
      if (!snap.exists) return;
      const day = days[i % days.length];
      const row = zeroed[day];
      row.notified += (snap.get('notified') as number | undefined) ?? 0;
      row.reach += (snap.get('reach') as number | undefined) ?? 0;
      row.clicks += (snap.get('clicks') as number | undefined) ?? 0;
    });
  }

  const totals = ads.reduce(
    (acc, ad) => ({
      notified: acc.notified + ad.notified,
      reach: acc.reach + ad.reach,
      clicks: acc.clicks + ad.clicks,
    }),
    { notified: 0, reach: 0, clicks: 0 },
  );

  const tier = tierForRadius(settings, radiusKm);

  return {
    ok: true,
    stage: status === 'suspended' ? 'suspended' : expired ? 'expired' : 'active',
    application: null,
    advertiser: {
      businessName: (advertiserSnap.get('businessName') as string) ?? '',
      city: (advertiserSnap.get('city') as string | null) ?? null,
      contactPhone: (advertiserSnap.get('contactPhone') as string | null) ?? null,
      radiusKm,
      adSlots: (advertiserSnap.get('adSlots') as number) ?? tier.adSlots,
      liveAds: ads.filter((a) => a.status === 'active').length,
      months: (advertiserSnap.get('months') as number) ?? 0,
      monthlyFee: (advertiserSnap.get('monthlyFee') as number) ?? tier.monthlyFee,
      totalFee: (advertiserSnap.get('totalFee') as number) ?? 0,
      currency: (advertiserSnap.get('currency') as string) ?? settings.currency,
      expiresAtMs,
      daysLeft:
        expiresAtMs === null ? null : Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 86_400_000)),
      suspensionReason: (advertiserSnap.get('suspensionReason') as string | null) ?? null,
      /** Prefills the composer the first time, straight off the application. */
      draft: (advertiserSnap.get('draft') as Record<string, string> | null) ?? null,
      center: (advertiserSnap.get('center') as Record<string, unknown> | null) ?? null,
    },
    ads,
    series: days.map((day) => zeroed[day]),
    totals: {
      ...totals,
      // Opens per person actually reached. Reach, not pushes: an advertiser who
      // pushed one person twice and got one open has a 100% open rate, and
      // dividing by pushes would report 50% and understate a real result.
      ctr: totals.reach > 0 ? Math.round((totals.clicks / totals.reach) * 1000) / 10 : 0,
    },
  };
});
