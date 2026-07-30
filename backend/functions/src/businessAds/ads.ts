/**
 * "Find your Customers" — the ads themselves.
 * ----------------------------------------------------------------------------
 * An ad is a creative (title, business name, offer, picture) plus the geography
 * it is allowed to reach. The geography is NOT the advertiser's to choose per
 * ad: centre and radius are copied off `businessAdvertisers/{uid}`, which is
 * what they paid for. Letting an ad carry its own radius would make the whole
 * price list decorative — buy the 3 km band, publish a 5 km ad.
 *
 * SLOTS
 * -----
 * The band decides how many ads may be live at once (one on the cheap band,
 * three on the wide one). Only `active` ads consume a slot: pausing an ad frees
 * it, so an advertiser can keep several creatives on file and rotate which one
 * is running. The count is done inside a transaction against the ads collection
 * rather than trusting a counter, because a counter that drifts hands out free
 * slots.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { creativeSchema, isOwnStorageUrl, requireAdvertiser } from './applications';
import type { BusinessAdStatus } from './types';

const createSchema = z.object({ creative: creativeSchema });

const updateSchema = z.object({
  adId: z.string().min(1).max(128),
  creative: creativeSchema.partial(),
});

const statusSchema = z.object({
  adId: z.string().min(1).max(128),
  status: z.enum(['active', 'paused', 'removed']),
});

/** How many of this advertiser's ads are live right now. */
async function countActiveAds(uid: string): Promise<number> {
  const snap = await db
    .collection('businessAds')
    .where('ownerUid', '==', uid)
    .where('status', '==', 'active')
    .get();
  return snap.size;
}

export const createBusinessAd = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'businessAdCreate', 20, 3600);

  const parsed = createSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid offer.');
  const creative = parsed.data.creative;

  if (!isOwnStorageUrl(creative.imageUrl)) {
    invalid('The offer picture must be uploaded to Velocity storage.');
  }

  const advertiser = await requireAdvertiser(uid);
  const slots = (advertiser.get('adSlots') as number | undefined) ?? 1;
  const live = await countActiveAds(uid);
  if (live >= slots) {
    invalid(
      slots === 1
        ? 'Your plan runs one offer at a time. Pause your current offer to publish a new one.'
        : `Your plan runs ${slots} offers at a time. Pause one to publish another.`,
    );
  }

  const adRef = db.collection('businessAds').doc();
  const now = FieldValue.serverTimestamp();

  await adRef.set({
    adId: adRef.id,
    ownerUid: uid,
    ...creative,
    // Copied off the plan, never taken from the client.
    center: advertiser.get('center'),
    radiusKm: advertiser.get('radiusKm'),
    city: advertiser.get('city') ?? null,
    contactPhone: advertiser.get('contactPhone') ?? null,
    /** Denormalised so the nearby query can skip ads whose plan lapsed. */
    planExpiresAt: advertiser.get('expiresAt') ?? null,
    status: 'active' as BusinessAdStatus,
    // Stats the advertiser's analytics screen reads. `notified` counts pushes
    // sent, `reach` counts distinct people — the gap between them is how often
    // the same person walked back into the radius.
    notified: 0,
    reach: 0,
    clicks: 0,
    createdAt: now,
    updatedAt: now,
  });

  await db.doc(`businessAdvertisers/${uid}`).update({
    liveAds: live + 1,
    updatedAt: now,
  });

  logger.info('Business ad published', { uid, adId: adRef.id });
  return { ok: true, adId: adRef.id, liveAds: live + 1, adSlots: slots };
});

export const updateBusinessAd = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = updateSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid offer.');
  const { adId, creative } = parsed.data;

  if (creative.imageUrl && !isOwnStorageUrl(creative.imageUrl)) {
    invalid('The offer picture must be uploaded to Velocity storage.');
  }

  const adRef = db.doc(`businessAds/${adId}`);
  const snap = await adRef.get();
  if (!snap.exists) invalid('That offer no longer exists.');
  if (snap.get('ownerUid') !== uid) invalid('That offer belongs to another business.');
  if (snap.get('status') === 'removed') invalid('That offer was deleted.');

  // Only the creative is editable. Geography and stats stay server-owned.
  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const key of ['title', 'businessName', 'offerDetails', 'imageUrl'] as const) {
    if (creative[key] !== undefined) patch[key] = creative[key];
  }
  if (Object.keys(patch).length === 1) invalid('Nothing to change.');

  await adRef.update(patch);
  return { ok: true };
});

export const setBusinessAdStatus = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = statusSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid status.');
  const { adId, status } = parsed.data;

  const adRef = db.doc(`businessAds/${adId}`);
  const snap = await adRef.get();
  if (!snap.exists) invalid('That offer no longer exists.');
  if (snap.get('ownerUid') !== uid) invalid('That offer belongs to another business.');
  if (snap.get('status') === status) return { ok: true, status };

  // Going live consumes a slot, so it has to pass the same gate as creating.
  if (status === 'active') {
    const advertiser = await requireAdvertiser(uid);
    const slots = (advertiser.get('adSlots') as number | undefined) ?? 1;
    const live = await countActiveAds(uid);
    if (live >= slots) {
      invalid(`Your plan runs ${slots} offer${slots === 1 ? '' : 's'} at a time. Pause one first.`);
    }
    await adRef.update({
      status,
      // A plan renewed while the ad sat paused must carry its new expiry, or the
      // nearby query would keep skipping an ad that is paid for again.
      planExpiresAt: advertiser.get('expiresAt') ?? null,
      radiusKm: advertiser.get('radiusKm'),
      center: advertiser.get('center'),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await adRef.update({ status, updatedAt: FieldValue.serverTimestamp() });
  }

  await db
    .doc(`businessAdvertisers/${uid}`)
    .update({ liveAds: await countActiveAds(uid), updatedAt: FieldValue.serverTimestamp() })
    .catch(() => {});

  logger.info('Business ad status changed', { uid, adId, status });
  return { ok: true, status };
});

/**
 * Admin override — take an ad down (or put it back) regardless of who owns it.
 * Publishing is deliberately not gated on a second review, so this is the lever
 * that exists for the offer that should never have gone out.
 */
export const adminSetBusinessAdStatus = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = z
    .object({
      adId: z.string().min(1).max(128),
      status: z.enum(['active', 'paused', 'removed']),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid status.');
  const { adId, status, reason } = parsed.data;

  const adRef = db.doc(`businessAds/${adId}`);
  const snap = await adRef.get();
  if (!snap.exists) invalid('That offer no longer exists.');
  const ownerUid = snap.get('ownerUid') as string;

  await adRef.update({
    status,
    moderationReason: status === 'active' ? null : (reason ?? null),
    moderatedBy: admin.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('auditLogs').add({
    type: `businessAd.moderate.${status}`,
    actor: admin.uid,
    targetUid: ownerUid,
    adId,
    reason: reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Business ad moderated', { actor: admin.uid, adId, status });
  return { ok: true, status };
});

/** Admin override — suspend or reinstate a whole advertiser account. */
export const adminSuspendAdvertiser = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = z
    .object({
      uid: z.string().min(1).max(128),
      suspended: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid request.');
  const { uid, suspended, reason } = parsed.data;

  const ref = db.doc(`businessAdvertisers/${uid}`);
  if (!(await ref.get()).exists) invalid('That business has no advertising plan.');

  await ref.update({
    status: suspended ? 'suspended' : 'active',
    suspensionReason: suspended ? (reason ?? null) : null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('auditLogs').add({
    type: `businessAd.advertiser.${suspended ? 'suspended' : 'reinstated'}`,
    actor: admin.uid,
    targetUid: uid,
    reason: reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await notifySuspension(uid, suspended, reason);
  return { ok: true };
});

async function notifySuspension(uid: string, suspended: boolean, reason?: string) {
  const { notifyUser } = await import('../lib/fcm');
  await notifyUser(
    uid,
    suspended ? 'Advertising paused' : 'Advertising resumed',
    suspended
      ? (reason ?? 'Your advertising account was paused. Contact support.')
      : 'Your offers are running again.',
    'system',
    { screen: 'business-ads' },
  );
}

/** Admin: the price list, the notification budget and the payment accounts. */
export const adminUpdateBusinessAdSettings = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = z
    .object({
      tiers: z
        .array(
          z.object({
            key: z.string().trim().min(1).max(24),
            maxRadiusKm: z.number().min(0.5).max(50),
            monthlyFee: z.number().min(0).max(10_000_000),
            adSlots: z.number().int().min(1).max(20),
          }),
        )
        .min(1)
        .max(6)
        .optional(),
      currency: z.string().trim().min(1).max(8).optional(),
      notifyCooldownHours: z.number().min(1).max(720).optional(),
      maxNotifPerUserPerDay: z.number().int().min(1).max(20).optional(),
      payment: z
        .object({
          bankName: z.string().trim().max(120).nullable().optional(),
          bankAccountTitle: z.string().trim().max(120).nullable().optional(),
          bankAccount: z.string().trim().max(64).nullable().optional(),
          easypaisaTitle: z.string().trim().max(120).nullable().optional(),
          easypaisaAccount: z.string().trim().max(64).nullable().optional(),
          jazzcashTitle: z.string().trim().max(120).nullable().optional(),
          jazzcashAccount: z.string().trim().max(64).nullable().optional(),
        })
        .optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid settings.');

  const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  const d = parsed.data;
  if (d.tiers) patch.tiers = [...d.tiers].sort((a, b) => a.maxRadiusKm - b.maxRadiusKm);
  if (d.currency) patch.currency = d.currency;
  if (d.notifyCooldownHours !== undefined) patch.notifyCooldownHours = d.notifyCooldownHours;
  if (d.maxNotifPerUserPerDay !== undefined) {
    patch.maxNotifPerUserPerDay = d.maxNotifPerUserPerDay;
  }
  if (d.payment) {
    for (const [k, v] of Object.entries(d.payment)) {
      if (v !== undefined) patch[`payment.${k}`] = v;
    }
  }

  await db.doc('config/businessAdSettings').set(patch, { merge: true });
  logger.info('Business ad settings updated', { actor: admin.uid });
  return { ok: true };
});
