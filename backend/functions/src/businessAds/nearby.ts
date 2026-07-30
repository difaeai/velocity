/**
 * "Find your Customers" — putting the offer in front of someone standing nearby.
 * ----------------------------------------------------------------------------
 * WHY THIS IS A CALLABLE AND NOT A GEOFENCE
 * -----------------------------------------
 * There is no background geofence. Registering real geofences means asking every
 * rider for background location, declaring it to Play, and justifying the battery
 * cost — a large ask for an advertising feature. Instead the app calls this while
 * it is open, throttled to significant movement, and the server decides whether
 * that position has earned a notification. An advertiser reaches people who use
 * the app near their shop, which is the honest version of what was sold.
 *
 * THE BUDGET
 * ----------
 * Two independent limits, both enforced here because the client cannot be
 * trusted with either:
 *   1. Per ad, per person: one push per cooldown window (default 24 h). Walking
 *      past the same shop four times in a day is one notification, not four.
 *   2. Per person, all advertisers: a hard daily ceiling. Someone in a dense
 *      market must not open the app to eleven offers.
 * Blowing the budget is not an error — it returns the ads silently un-notified,
 * so the app can still show them as a quiet in-app list if it wants to.
 *
 * COUNTING
 * --------
 * `notified` counts pushes sent. `reach` counts distinct people, incremented
 * only the first time an ad ever reaches a given uid. The gap between the two is
 * exactly the repeat-exposure number an advertiser wants to see, and it comes
 * free from the impression doc we already have to write for the cooldown.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { haversineM } from '../lib/corridor';
import { notifyUser } from '../lib/fcm';
import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { getBusinessAdSettings, maxRadiusKm, pkDay } from './config';
import { candidateCells } from './geo';

const nearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const clickSchema = z.object({ adId: z.string().min(1).max(128) });

function impressionId(adId: string, uid: string): string {
  return `${adId}_${uid}`;
}

/**
 * Claims up to `want` pushes out of today's per-person allowance, and returns
 * how many were actually granted. Done in a transaction so two location fixes
 * arriving together cannot each spend the same last slot.
 */
async function claimNotifyBudget(uid: string, want: number, dailyMax: number): Promise<number> {
  if (want <= 0) return 0;
  const day = pkDay();
  const ref = db.doc(`businessAdNotifyBudget/${uid}_${day}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = (snap.get('count') as number | undefined) ?? 0;
    const grant = Math.max(0, Math.min(want, dailyMax - used));
    if (grant > 0) {
      tx.set(
        ref,
        {
          uid,
          day,
          count: used + grant,
          // Self-deletes via the Firestore TTL policy on `expireAt`.
          expireAt: Timestamp.fromMillis(Date.now() + 3 * 24 * 3600 * 1000),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return grant;
  });
}

export const checkNearbyBusinessAds = onCall(async (req) => {
  const { uid } = requireAuth(req);
  // The app throttles itself to significant movement; this is the backstop for a
  // client that doesn't. 40/hour is roughly one call every 90 seconds.
  await rateLimit(uid, 'businessAdNearby', 40, 3600);

  const parsed = nearbySchema.safeParse(req.data);
  if (!parsed.success) invalid('A valid location is required.');
  const { lat, lng } = parsed.data;

  const settings = await getBusinessAdSettings();
  // Swept against the WIDEST band we sell, not against any one ad's radius —
  // which ads are in range is only known after the distance check below.
  const cells = candidateCells(lat, lng, maxRadiusKm(settings));

  const snap = await db
    .collection('businessAds')
    .where('status', '==', 'active')
    .where('center.geohash', 'in', cells)
    .limit(60)
    .get();

  const nowMs = Date.now();
  const cooldownMs = settings.notifyCooldownHours * 3600 * 1000;

  // Inside the radius the advertiser paid for, and on a plan that has not lapsed.
  const inRange = snap.docs
    .map((doc) => {
      const center = doc.get('center') as { lat: number; lng: number } | undefined;
      if (!center) return null;
      const distanceM = haversineM(lat, lng, center.lat, center.lng);
      const radiusKm = (doc.get('radiusKm') as number | undefined) ?? 0;
      const expiry = (doc.get('planExpiresAt') as Timestamp | null | undefined)?.toMillis?.();
      if (expiry !== undefined && expiry <= nowMs) return null;
      if (distanceM > radiusKm * 1000) return null;
      return { doc, distanceM };
    })
    .filter((x): x is { doc: (typeof snap.docs)[number]; distanceM: number } => x !== null)
    // Closest first: if the daily budget only covers one push, it should be the
    // shop the person is actually standing next to.
    .sort((a, b) => a.distanceM - b.distanceM);

  if (inRange.length === 0) return { ok: true, ads: [], notified: 0 };

  // Who is still inside their cooldown, and who has never seen this ad at all.
  const impressionRefs = inRange.map(({ doc }) =>
    db.doc(`businessAdImpressions/${impressionId(doc.id, uid)}`),
  );
  const impressions = await db.getAll(...impressionRefs);

  const candidates = inRange.map(({ doc, distanceM }, i) => {
    const imp = impressions[i];
    const last = (imp.get('lastNotifiedAt') as Timestamp | null | undefined)?.toMillis?.() ?? 0;
    return {
      doc,
      distanceM,
      isFirstEver: !imp.exists,
      dueForPush: nowMs - last >= cooldownMs,
    };
  });

  const due = candidates.filter((c) => c.dueForPush);
  const grants = await claimNotifyBudget(uid, due.length, settings.maxNotifPerUserPerDay);
  const toPush = due.slice(0, grants);

  for (const { doc, isFirstEver } of toPush) {
    const title = doc.get('title') as string;
    const businessName = doc.get('businessName') as string;
    const offerDetails = doc.get('offerDetails') as string;
    const imageUrl = doc.get('imageUrl') as string | undefined;

    // The impression doc is the cooldown ledger AND the unique-reach counter, so
    // it is written before the push: a push we sent but failed to record would
    // let us send the same one again a minute later.
    await db.doc(`businessAdImpressions/${impressionId(doc.id, uid)}`).set(
      {
        adId: doc.id,
        uid,
        ownerUid: doc.get('ownerUid'),
        notifyCount: FieldValue.increment(1),
        lastNotifiedAt: FieldValue.serverTimestamp(),
        ...(isFirstEver ? { firstNotifiedAt: FieldValue.serverTimestamp(), clicks: 0 } : {}),
      },
      { merge: true },
    );

    await db.doc(`businessAds/${doc.id}`).update({
      notified: FieldValue.increment(1),
      ...(isFirstEver ? { reach: FieldValue.increment(1) } : {}),
      lastNotifiedAt: FieldValue.serverTimestamp(),
    });

    // Daily rollup — what the advertiser's 7-day chart reads. Cheap to write,
    // and it means the analytics screen never scans the impression collection.
    await db
      .doc(`businessAds/${doc.id}/daily/${pkDay()}`)
      .set(
        { notified: FieldValue.increment(1), ...(isFirstEver ? { reach: FieldValue.increment(1) } : {}) },
        { merge: true },
      );

    await db
      .doc(`businessAdvertisers/${doc.get('ownerUid')}`)
      .update({
        totalNotified: FieldValue.increment(1),
        ...(isFirstEver ? { totalReach: FieldValue.increment(1) } : {}),
      })
      .catch(() => {});

    // The picture rides along in the push itself, so pulling the shade down
    // shows the offer as a big-picture card — business name, offer line and the
    // photo — with the app closed. An offer whose picture only appears after you
    // open the app is an offer nobody opens.
    await notifyUser(
      uid,
      `${businessName}: ${title}`,
      offerDetails.length > 200 ? `${offerDetails.slice(0, 197)}…` : offerDetails,
      'promo',
      { screen: 'business-offer', adId: doc.id },
      imageUrl ? { imageUrl } : {},
    );
  }

  if (toPush.length > 0) {
    logger.info('Business ads notified', { uid, count: toPush.length });
  }

  // Everything in range comes back, pushed or not, so the app can show a quiet
  // "offers near you" list without spending another notification.
  return {
    ok: true,
    notified: toPush.length,
    ads: candidates.map(({ doc, distanceM }) => ({
      adId: doc.id,
      title: doc.get('title') as string,
      businessName: doc.get('businessName') as string,
      offerDetails: doc.get('offerDetails') as string,
      imageUrl: doc.get('imageUrl') as string,
      distanceM: Math.round(distanceM),
    })),
  };
});

/**
 * The tap. Called by the offer screen the notification opens, which is the only
 * click there is to measure — an advertiser buying a push wants to know how many
 * people opened it, and this is that number.
 *
 * Idempotent per person per ad in the sense that matters: repeat opens are
 * counted (an advertiser cares about total opens), but the impression doc records
 * them against one uid, so the admin can still see opens-per-person if a number
 * ever looks too good to be true.
 */
export const recordBusinessAdClick = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'businessAdClick', 60, 3600);

  const parsed = clickSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid offer.');
  const { adId } = parsed.data;

  const adRef = db.doc(`businessAds/${adId}`);
  const ad = await adRef.get();
  if (!ad.exists) invalid('That offer no longer exists.');

  const now = FieldValue.serverTimestamp();

  await db.doc(`businessAdImpressions/${impressionId(adId, uid)}`).set(
    {
      adId,
      uid,
      ownerUid: ad.get('ownerUid'),
      clicks: FieldValue.increment(1),
      lastClickedAt: now,
    },
    { merge: true },
  );
  await adRef.update({ clicks: FieldValue.increment(1), lastClickedAt: now });
  await db
    .doc(`businessAds/${adId}/daily/${pkDay()}`)
    .set({ clicks: FieldValue.increment(1) }, { merge: true });
  await db
    .doc(`businessAdvertisers/${ad.get('ownerUid')}`)
    .update({ totalClicks: FieldValue.increment(1) })
    .catch(() => {});

  return { ok: true };
});
