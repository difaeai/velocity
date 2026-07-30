/**
 * "Find your Customers" — buying a campaign, and the admin review that starts it.
 * ----------------------------------------------------------------------------
 * The shape of the deal: a business picks a radius, is quoted the band price for
 * it, buys 3, 6 or 12 months up front, and uploads a screenshot of the transfer.
 * A human looks at the screenshot and at the offer they intend to push, and only
 * an approval mints `businessAdvertisers/{uid}` — the document every publishing
 * and notification path keys off.
 *
 * The screenshot is checked by a person, not by code. The backend cannot tell a
 * real receipt from an edited one, and pretending otherwise would just be
 * theatre. What the backend CAN do is make sure the numbers the advertiser was
 * shown are the numbers on file: the radius, the band, the monthly fee and the
 * total are all re-derived here from the live settings and written as a snapshot,
 * so an admin comparing a receipt next week compares it against the price the
 * applicant actually saw — not against a rate that changed since.
 *
 * The creative arrives twice on purpose. It comes in with the application so the
 * reviewer can see what would be pushed to thousands of phones before saying
 * yes, and it is confirmed again after approval (prefilled) as the live ad. The
 * draft here is never itself an ad — publishing goes through ads.ts.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { encodeGeohash } from '../lib/geohash';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { rateLimit } from '../lib/ratelimit';
import { getBusinessAdSettings, maxRadiusKm, quoteFee, tierForRadius } from './config';
import type {
  BusinessAdApplicationStatus,
  BusinessAdPlanMonths,
  BusinessAdvertiserStatus,
} from './types';

/** Documents must live in our own bucket — never a URL the client made up. */
export function isOwnStorageUrl(url: string): boolean {
  return (
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/')
  );
}

/** The creative fields, shared with ads.ts so the draft and the live ad agree. */
export const creativeSchema = z.object({
  title: z.string().trim().min(3).max(80),
  businessName: z.string().trim().min(2).max(80),
  offerDetails: z.string().trim().min(5).max(600),
  imageUrl: z.string().url().max(2048),
});

const submitSchema = z.object({
  /** Radius in km, in 0.5 steps. The band — and so the price — follows from it. */
  radiusKm: z.number().min(0.5).max(50),
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]),
  /** The shop's own coordinates: the centre of every radius check. */
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().min(2).max(80),
  contactPhone: z.string().trim().min(7).max(20),
  creative: creativeSchema,
  paymentProofUrl: z.string().url().max(2048),
  paymentMethod: z.enum(['bank', 'easypaisa', 'jazzcash']),
  paymentReference: z.string().trim().max(120).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the advertising terms.' }),
  }),
});

const reviewSchema = z.object({
  uid: z.string().min(1).max(128),
  decision: z.enum(['approve', 'reject', 'resubmit']),
  reason: z.string().trim().max(500).optional(),
  /**
   * An admin may approve onto a different radius than was asked for — e.g. the
   * transfer that landed only covers the cheaper band. Approving down is kinder
   * than rejecting outright and making them start over.
   */
  radiusKm: z.number().min(0.5).max(50).optional(),
  months: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
});

/**
 * Public: the price list, the plan lengths and the accounts to pay into. The
 * subscribe screen reads this so prices can change without a new build.
 */
export const getBusinessAdPlans = onCall(async () => {
  const s = await getBusinessAdSettings();
  return {
    ok: true,
    tiers: s.tiers,
    currency: s.currency,
    planMonths: s.planMonths,
    maxRadiusKm: maxRadiusKm(s),
    notifyCooldownHours: s.notifyCooldownHours,
    payment: s.payment,
  };
});

/**
 * The gate in front of every advertiser-only surface. Returns the advertiser
 * doc, or throws with a message the UI can show verbatim.
 */
export async function requireAdvertiser(uid: string) {
  const snap = await db.doc(`businessAdvertisers/${uid}`).get();
  if (!snap.exists) {
    invalid('You do not have an advertising plan yet. Buy a plan to start advertising.');
  }
  if (snap.get('status') === 'suspended') {
    invalid('Your advertising account is suspended. Contact support.');
  }
  if (snap.get('status') === 'expired') {
    invalid('Your advertising plan has expired. Renew it to keep your offers running.');
  }
  const expiresAt = snap.get('expiresAt') as { toMillis?: () => number } | null | undefined;
  if (expiresAt?.toMillis && expiresAt.toMillis() <= Date.now()) {
    invalid('Your advertising plan has expired. Renew it to keep your offers running.');
  }
  return snap;
}

export const submitBusinessAdApplication = onCall(async (req) => {
  const { uid } = requireAuth(req);
  // A campaign application is cheap to submit and expensive to review. Five an
  // hour is far more than any real business needs and far less than a script.
  await rateLimit(uid, 'businessAdApply', 5, 3600);

  const input = submitSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.issues[0]?.message ?? 'Invalid application.');
  const data = input.data;

  for (const url of [data.paymentProofUrl, data.creative.imageUrl]) {
    if (!isOwnStorageUrl(url)) invalid('Images must be uploaded to Velocity storage.');
  }

  const settings = await getBusinessAdSettings();
  const cap = maxRadiusKm(settings);
  if (data.radiusKm > cap) invalid(`The widest radius we sell is ${cap} km.`);
  if (!settings.planMonths.includes(data.months as BusinessAdPlanMonths)) {
    invalid('Choose one of the plan lengths on offer.');
  }

  // An advertiser whose plan is still running renews from the advertise home,
  // not by filing a second application — two live applications for one shop
  // would give the reviewer no way to tell which one the payment belongs to.
  const advertiserSnap = await db.doc(`businessAdvertisers/${uid}`).get();
  if (advertiserSnap.exists && advertiserSnap.get('status') === 'active') {
    invalid('You already have an active advertising plan.');
  }

  const appRef = db.doc(`businessAdApplications/${uid}`);
  const existing = await appRef.get();
  if (existing.get('status') === 'pending') {
    invalid('Your advertising request is already awaiting approval.');
  }

  const tier = tierForRadius(settings, data.radiusKm);
  const totalFee = quoteFee(tier.monthlyFee, data.months);

  await appRef.set({
    uid,
    status: 'pending' as BusinessAdApplicationStatus,
    // The quote, snapshotted. Everything downstream reads these, never the live
    // settings, so a reprice mid-review cannot change what someone already paid.
    radiusKm: data.radiusKm,
    tierKey: tier.key,
    adSlots: tier.adSlots,
    months: data.months,
    monthlyFee: tier.monthlyFee,
    totalFee,
    currency: settings.currency,

    center: {
      lat: data.lat,
      lng: data.lng,
      geohash: encodeGeohash(data.lat, data.lng, 5),
      address: data.address ?? null,
    },
    city: data.city,
    contactPhone: data.contactPhone,

    // The offer as the reviewer will see it. Copied onto the live ad at publish.
    draft: data.creative,

    paymentProofUrl: data.paymentProofUrl,
    paymentMethod: data.paymentMethod,
    paymentReference: data.paymentReference ?? null,
    acceptedTerms: true,

    // A resubmission is a fresh queue entry, so clear the old verdict.
    rejectionReason: null,
    reviewedAt: null,
    reviewedBy: null,
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Business ad application submitted', {
    uid,
    radiusKm: data.radiusKm,
    months: data.months,
    totalFee,
  });

  return {
    ok: true,
    status: 'pending' as BusinessAdApplicationStatus,
    totalFee,
    monthlyFee: tier.monthlyFee,
    adSlots: tier.adSlots,
  };
});

export const adminReviewBusinessAdApplication = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid review.');
  const { uid, decision, reason } = parsed.data;

  if (decision !== 'approve' && !reason) {
    invalid('Give the advertiser a reason so they know what to fix.');
  }

  const appRef = db.doc(`businessAdApplications/${uid}`);
  const snap = await appRef.get();
  if (!snap.exists) invalid('No advertising request found for this user.');

  const status: BusinessAdApplicationStatus =
    decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'resubmit';

  const settings = await getBusinessAdSettings();
  const radiusKm = parsed.data.radiusKm ?? (snap.get('radiusKm') as number);
  const months = parsed.data.months ?? (snap.get('months') as number);
  const tier = tierForRadius(settings, radiusKm);

  // The clock starts at approval, not at payment: the advertiser should not lose
  // days to the review queue. A renewal extends from whichever is later — the
  // old expiry (so paid-for days are never burned) or now.
  const advertiserRef = db.doc(`businessAdvertisers/${uid}`);
  const advertiserSnap = await advertiserRef.get();
  const prevExpiryMs =
    (advertiserSnap.get('expiresAt') as { toMillis?: () => number } | null | undefined)?.toMillis?.() ??
    0;
  const startMs = Math.max(Date.now(), prevExpiryMs);
  const expiresAt = new Date(startMs);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  await db.runTransaction(async (tx) => {
    const now = FieldValue.serverTimestamp();

    tx.update(appRef, {
      status,
      approvedRadiusKm: decision === 'approve' ? radiusKm : null,
      approvedMonths: decision === 'approve' ? months : null,
      rejectionReason: decision === 'approve' ? null : reason,
      reviewedAt: now,
      reviewedBy: admin.uid,
      updatedAt: now,
    });

    if (decision === 'approve') {
      tx.set(
        advertiserRef,
        {
          uid,
          status: 'active' as BusinessAdvertiserStatus,
          businessName: snap.get('draft.businessName') ?? 'Velocity Business',
          city: snap.get('city') ?? null,
          contactPhone: snap.get('contactPhone') ?? null,
          center: snap.get('center'),
          radiusKm,
          tierKey: tier.key,
          adSlots: tier.adSlots,
          months,
          monthlyFee: snap.get('monthlyFee') ?? tier.monthlyFee,
          totalFee: snap.get('totalFee') ?? quoteFee(tier.monthlyFee, months),
          currency: snap.get('currency') ?? settings.currency,
          /** Prefills the ad composer so approval isn't followed by retyping. */
          draft: snap.get('draft') ?? null,
          expiresAt,
          // Lifetime counters, never reset by a renewal — an advertiser's history
          // is the only evidence they have that the last plan was worth buying.
          liveAds: advertiserSnap.get('liveAds') ?? 0,
          totalNotified: advertiserSnap.get('totalNotified') ?? 0,
          totalReach: advertiserSnap.get('totalReach') ?? 0,
          totalClicks: advertiserSnap.get('totalClicks') ?? 0,
          approvedAt: now,
          approvedBy: admin.uid,
          createdAt: advertiserSnap.exists ? advertiserSnap.get('createdAt') : now,
          updatedAt: now,
        },
        { merge: true },
      );
    }

    tx.set(db.collection('auditLogs').doc(), {
      type: `businessAd.application.${status}`,
      actor: admin.uid,
      targetUid: uid,
      radiusKm: decision === 'approve' ? radiusKm : null,
      months: decision === 'approve' ? months : null,
      reason: reason ?? null,
      createdAt: now,
    });
  });

  const copy: Record<BusinessAdApplicationStatus, { title: string; body: string }> = {
    approved: {
      title: 'Your advertising plan is live 🎉',
      body: `Approved for ${radiusKm} km and ${months} months. Open Business → Find your Customers to publish your offer.`,
    },
    rejected: {
      title: 'Advertising request rejected',
      body: reason ?? 'Your advertising request could not be approved.',
    },
    resubmit: {
      title: 'Advertising request — more detail needed',
      body: reason ?? 'Please check your payment screenshot and submit again.',
    },
    pending: { title: '', body: '' },
  };
  await notifyUser(uid, copy[status].title, copy[status].body, 'system', {
    screen: 'business-ads',
    businessAdStatus: status,
  });

  logger.info('Business ad application reviewed', { actor: admin.uid, uid, status });
  return { ok: true, status };
});
