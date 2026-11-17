/**
 * Partner Program — applications and admin review.
 * ----------------------------------------------------------------------------
 * Nobody self-serves into a fleet owner. They apply with an identity document
 * (CNIC, university card, licence, passport), a human looks at the documents,
 * and only an approval mints the `partners/{uid}` doc
 * that the dashboard and every earning path key off. `requirePartner()` is the
 * single gate — if there is no approved partner doc, there is no program.
 *
 * TIERS — BOTH PAID, SINCE 2026-10-17
 * -----------------------------------
 * Every application now needs an identity document, a verified mobile, a plan
 * length (3, 6 or 12 months) and proof that the fee was paid. Starter and Pro
 * differ only in the price and the rate they earn.
 *
 * It used to be that Starter (tier id `free`) cost nothing, and the fee was the
 * only thing standing between "a Pro partner" and "anyone who wanted the higher
 * rate". With a price on both, that gate is now in front of the whole program:
 * a partner account is a thing somebody paid for, which is also what makes the
 * fraud rules worth enforcing — there is now something to lose.
 *
 * The screenshot is checked by a human at approval. The backend cannot tell a
 * real receipt from a Photoshopped one, and pretending otherwise would just be
 * theatre.
 *
 * Phone verification, by contrast, IS enforced by the backend. The submitted
 * number must already be on the caller's Firebase Auth record, and a number only
 * lands there when Firebase itself verified an OTP for it. A client that skips
 * the OTP screen and posts the form anyway is rejected.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAdmin, requireAuth } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { getPartnerSettings, monthlyFeeForTier } from './config';
import { mintPortalId, portalUrl } from '../franchise/portal';
import { createFleetsForPartner, mintPartnerCode } from './fleets';
import type { PartnerApplicationStatus, PartnerTier } from './types';

/** 13 digits, hyphenated — the format printed on the card. Matches users/cnic. */
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

/**
 * Any government or institutional document that proves who the applicant is.
 * A CNIC is preferred but not everyone carries one — students apply with a
 * university card. The strict 13-digit format is only enforced when the
 * document actually is a CNIC; the field names stay `cnic*` because that is
 * what every existing application document and index already uses.
 */
const ID_TYPES = ['cnic', 'university_card', 'driving_license', 'passport', 'other'] as const;

/**
 * WHAT WE STOPPED ASKING FOR (owner, 2026-11-18)
 * ----------------------------------------------
 * "first two options k liye hamne kafi information li hui hai usay limited kr
 * k" — the two paid tiers used to demand a full name, a mobile number, a city,
 * an ID type, an ID number and photographs of both sides of a card, all before
 * anyone could pay. Every one of those is now OPTIONAL: the name and the number
 * come off the account the applicant is already signed in with, and the rest is
 * not asked for at all. What is left is the thing the tier actually is — a plan
 * length and proof the fee was paid.
 *
 * The fields stay in the schema rather than being deleted because an older
 * build of the app still posts them, and a submission that still carries a CNIC
 * is fine to store. The refinements below are what changed: none of them is
 * required any more.
 *
 * ONE GUARD LOST A LEG, DELIBERATELY. The duplicate-account check in
 * referrals.ts compares a recruit's CNIC and phone against the fleet owner's.
 * With no CNIC collected it has only the phone left — which is why `mobile` is
 * now filled from `users/{uid}.phoneNumber` server-side rather than left empty:
 * a verified phone number from the account is better evidence than a typed one
 * ever was, so the guard is narrower but not weaker on the leg that remains.
 */
const submitSchema = z
  .object({
    tier: z.enum(['free', 'pro']),
    /** Optional: taken from the signed-in account when absent. */
    fullName: z.string().trim().min(2).max(100).optional(),
    mobile: z.string().trim().min(10).max(20).optional(),
    /** Which document the photos show. Older clients never send it → CNIC. */
    idType: z.enum(ID_TYPES).default('cnic'),
    /** No longer asked for. Still accepted from an older build. */
    cnicNumber: z.string().trim().min(4).max(40).optional(),
    cnicFrontUrl: z.string().url().max(2048).optional(),
    /** The back side only exists to read on a CNIC; optional for other IDs. */
    cnicBackUrl: z.string().url().max(2048).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    /** How many months of the plan they are buying. Both tiers. */
    proMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(),
    /** Screenshot of the fee transfer. Both tiers. */
    paymentProofUrl: z.string().url().max(2048).optional(),
    /** Which rail they paid on, so the admin knows where to look. Both tiers. */
    paymentMethod: z.enum(['bank', 'easypaisa', 'jazzcash']).optional(),
    paymentReference: z.string().trim().max(120).optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Partner Program terms.' }),
    }),
  })
  // Both tiers are paid, so all three are required of both. An older build of
  // the app posts a Starter application with none of them; it is rejected with
  // a message that names what is missing rather than a validation code, because
  // the person reading it has an out-of-date app and no idea why.
  .refine((d) => !!d.proMonths, {
    message: 'Choose a plan length: 3 months, 6 months or 1 year.',
    path: ['proMonths'],
  })
  .refine((d) => !!d.paymentProofUrl, {
    message: 'Upload a screenshot of your plan payment.',
    path: ['paymentProofUrl'],
  })
  .refine((d) => !!d.paymentMethod, {
    message: 'Tell us which account you paid into.',
    path: ['paymentMethod'],
  })
  // An ID is no longer asked for, but one that IS sent must still be the right
  // shape — a half-typed CNIC stored as fact is worse than no CNIC at all.
  .refine((d) => !d.cnicNumber || d.idType !== 'cnic' || CNIC_RE.test(d.cnicNumber), {
    message: 'CNIC must look like 12345-1234567-1',
    path: ['cnicNumber'],
  });

const reviewSchema = z.object({
  uid: docId,
  decision: z.enum(['approve', 'reject', 'resubmit']),
  reason: z.string().trim().max(500).optional(),
  /** An admin may approve a Pro applicant down to free (e.g. the payment never
   * landed) rather than bouncing them out of the program entirely. */
  tier: z.enum(['free', 'pro']).optional(),
});

/** Documents must live in our own bucket — never a URL the client made up. */
function isOwnStorageUrl(url: string): boolean {
  return (
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/')
  );
}

/**
 * Pakistani mobile numbers to a single comparable form (+923001234567), so
 * "0300-1234567" typed in the form matches "+923001234567" on the auth record.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('92')) return `+${digits}`;
  if (digits.startsWith('0')) return `+92${digits.slice(1)}`;
  if (digits.length === 10) return `+92${digits}`;
  return `+${digits}`;
}

/**
 * The gate in front of every partner-only surface. Returns the partner doc, or
 * throws with a message the UI can show verbatim.
 */
export async function requirePartner(uid: string) {
  const snap = await db.doc(`partners/${uid}`).get();
  if (!snap.exists) {
    invalid('You are not a Velocity Rides partner yet. Apply for the Partner Program first.');
  }
  if (snap.get('status') === 'suspended') {
    invalid('Your partner account is suspended. Contact support.');
  }
  return snap;
}

/**
 * Public: the fee and the accounts to pay it into. The apply screen reads this
 * so the numbers can be changed by an admin without shipping a new app.
 */
export const getPartnerTiers = onCall(async () => {
  const s = await getPartnerSettings();
  return {
    ok: true,
    free: s.free,
    pro: s.pro,
    proMonthlyFee: s.proMonthlyFee,
    starterMonthlyFee: s.starterMonthlyFee,
    proFeeCurrency: s.proFeeCurrency,
    payment: s.payment,
  };
});

export const submitPartnerApplication = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input = submitSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.issues[0]?.message ?? 'Invalid application.');
  const data = input.data;

  const docs = [data.cnicFrontUrl, data.cnicBackUrl, data.paymentProofUrl].filter(
    (u): u is string => !!u,
  );
  for (const url of docs) {
    if (!isOwnStorageUrl(url)) invalid('Documents must be uploaded to Velocity Rides storage.');
  }

  // Already a partner? Nothing to apply for.
  const partnerSnap = await db.doc(`partners/${uid}`).get();
  if (partnerSnap.exists) invalid('You are already a Velocity Rides partner.');

  const appRef = db.doc(`partner_applications/${uid}`);
  const existing = await appRef.get();
  const prevStatus = existing.get('status') as PartnerApplicationStatus | undefined;
  if (prevStatus === 'pending') invalid('Your application is already awaiting review.');
  if (prevStatus === 'approved') invalid('Your application was already approved.');

  /**
   * The OTP proof. Firebase only writes a phone number onto the auth record
   * after it verified an SMS code for it, so this check IS the OTP check —
   * there is no way to satisfy it without having passed the OTP screen.
   *
   * The number is now TAKEN from that record rather than typed (owner,
   * 2026-11-18: stop asking for details we already have). A build that still
   * sends one must still send the right one — silently accepting a different
   * number from an old client would let somebody file under a number they never
   * verified, which is the one thing this check exists to stop.
   */
  const authUser = await auth.getUser(uid);
  if (!authUser.phoneNumber) {
    invalid('Verify your mobile number with an OTP before submitting your application.');
  }
  const claimed = normalizePhone(authUser.phoneNumber);
  if (data.mobile && normalizePhone(data.mobile) !== claimed) {
    invalid('Submit the same mobile number you verified with the OTP.');
  }

  // One ID document, one partner. Two accounts holding the same card is the
  // cheapest way to farm referrals, so it is blocked at the door rather than
  // unwound later by the fraud engine. The clash is scoped to the SAME document
  // type: a passport and a university card that happen to share a number are
  // different documents, not one document twice. Applications written before
  // idType existed are all CNICs.
  // Only when one was sent at all — an ID is no longer asked for.
  if (data.cnicNumber) {
    const idClash = await db
      .collection('partner_applications')
      .where('cnicNumber', '==', data.cnicNumber)
      .where('status', 'in', ['pending', 'approved'])
      .limit(10)
      .get();
    const clashing = idClash.docs.find(
      (d) => d.id !== uid && ((d.get('idType') as string | undefined) ?? 'cnic') === data.idType,
    );
    if (clashing) {
      invalid('This ID number is already used by another partner application.');
    }
  }

  const settings = await getPartnerSettings();
  const userSnap = await db.doc(`users/${uid}`).get();

  /**
   * The name, off the profile the app already built (owner, 2026-11-18).
   *
   * `onUserCreate` seeds displayName as the placeholder 'New User', which the
   * rider side already treats as "no name", so it is not accepted as one here
   * either. A client that still sends a name wins, so an older build is
   * unaffected.
   */
  const profileName =
    (typeof userSnap.get('name') === 'string' && (userSnap.get('name') as string).trim()) || '';
  const displayName = (userSnap.get('displayName') as string | undefined) ?? '';
  const fullName =
    data.fullName?.trim() ||
    profileName ||
    (displayName && displayName !== 'New User' ? displayName.trim() : '');
  if (!fullName) {
    invalid('Add your name to your Velocity Rides profile first, then apply.');
  }

  await appRef.set({
    uid,
    tier: data.tier as PartnerTier,
    fullName,
    mobile: claimed,
    idType: data.idType,
    cnicNumber: data.cnicNumber ?? null,
    cnicFrontUrl: data.cnicFrontUrl ?? null,
    cnicBackUrl: data.cnicBackUrl ?? null,
    city: data.city ?? null,
    photoURL: userSnap.get('photoURL') ?? null,
    // The bill is snapshotted as it stood when they paid — months × that
    // tier's monthly fee — so an admin reviewing next week compares the
    // screenshot against the price the applicant was actually shown, not
    // against a rate that changed since.
    paymentProofUrl: data.paymentProofUrl ?? null,
    paymentMethod: data.paymentMethod ?? null,
    paymentReference: data.paymentReference ?? null,
    proMonths: data.proMonths ?? null,
    quotedMonthlyFee: monthlyFeeForTier(settings, data.tier),
    quotedFee: monthlyFeeForTier(settings, data.tier) * (data.proMonths ?? 0),
    quotedFeeCurrency: settings.proFeeCurrency,
    acceptedTerms: true,
    status: 'pending' as PartnerApplicationStatus,
    // A resubmission is a fresh queue entry, so clear the old verdict.
    rejectionReason: null,
    reviewedAt: null,
    reviewedBy: null,
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Partner application submitted', { uid, tier: data.tier, city: data.city });
  return { ok: true, status: 'pending' as PartnerApplicationStatus };
});

export const adminReviewPartnerApplication = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid review.');
  const { uid, decision, reason } = parsed.data;

  if (decision !== 'approve' && !reason) {
    invalid('Give the applicant a reason so they know what to fix.');
  }

  const appRef = db.doc(`partner_applications/${uid}`);
  const snap = await appRef.get();
  if (!snap.exists) invalid('No application found for this user.');
  if (snap.get('status') === 'approved') invalid('This application is already approved.');

  const status: PartnerApplicationStatus =
    decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'resubmit';

  // Approving mints the code, so it happens BEFORE the transaction — minting
  // queries for collisions, and Firestore forbids reading after writing.
  const tier: PartnerTier =
    parsed.data.tier ?? ((snap.get('tier') as PartnerTier | undefined) ?? 'free');
  const code = decision === 'approve' ? await mintPartnerCode() : null;

  /**
   * Did an ambassador bring this partner in? (owner, 2026-11-18)
   *
   * This is the ambassador's SECOND target — "15 users signed up on Earn with
   * Velocity on the same code" — and it is counted here because here is the
   * moment it becomes true. A sale is not a sale when the application is filed;
   * it is a sale when an admin approves it.
   *
   * Read before the transaction, because Firestore forbids reading after
   * writing inside one. `boughtPartnerPlan` on the edge makes the increment
   * idempotent: an application approved, un-approved and approved again must
   * not count twice toward a salary.
   */
  const ambassadorEdgeRef = db.doc(`ambassador_referrals/${uid}`);
  const ambassadorEdge = decision === 'approve' ? await ambassadorEdgeRef.get() : null;
  const creditAmbassador =
    !!ambassadorEdge?.exists && ambassadorEdge.get('boughtPartnerPlan') !== true;
  const ambassadorId = creditAmbassador
    ? (ambassadorEdge!.get('ambassadorId') as string | undefined)
    : undefined;

  // Pro buys a private web portal for running a fleet. Minted here for the same
  // reason the code is — it queries for collisions, and a partner who has to ask
  // support for their link is a partner who never opens it.
  const portalId = decision === 'approve' && tier === 'pro' ? await mintPortalId() : null;

  // Both plans are bought by the month (3, 6 or 12). The clock starts at
  // approval, not at payment — the applicant shouldn't lose days to the review
  // queue. `proMonths`/`proExpiresAt` keep their names for the same reason the
  // `free` tier id does: they are already on every partner document, and a
  // rename buys nothing but a migration.
  const proMonths =
    decision === 'approve'
      ? ((snap.get('proMonths') as number | undefined) ?? null)
      : null;
  let proExpiresAt: Date | null = null;
  if (proMonths) {
    proExpiresAt = new Date();
    proExpiresAt.setMonth(proExpiresAt.getMonth() + proMonths);
  }

  await db.runTransaction(async (tx) => {
    const now = FieldValue.serverTimestamp();

    tx.update(appRef, {
      status,
      approvedTier: decision === 'approve' ? tier : null,
      rejectionReason: decision === 'approve' ? null : reason,
      reviewedAt: now,
      reviewedBy: admin.uid,
      updatedAt: now,
    });

    if (decision === 'approve' && code) {
      const fullName = (snap.get('fullName') as string) ?? 'Velocity Rides Partner';

      // Both fleets exist the moment the partner does. An approved partner who
      // still has to press "create fleet" before their code resolves is a
      // partner whose first recruits bounce off a dead code.
      const fleets = createFleetsForPartner(tx, { partnerId: uid, code, fullName });

      tx.set(db.doc(`partners/${uid}`), {
        uid,
        tier,
        proMonths,
        proExpiresAt,
        referralCode: code,
        portalId,
        portalIssuedAt: portalId ? now : null,
        fullName,
        // ?? null on every one of these, not just the new ones: now that the
        // two paid tiers no longer ask for a city or an ID (owner, 2026-11-18),
        // `snap.get` returns undefined for them — and Firestore refuses a
        // document containing undefined, which would have made APPROVING such
        // an applicant throw instead of approving them. Caught by
        // ambassadors/__tests__/flow.test.ts.
        mobile: snap.get('mobile') ?? null,
        city: snap.get('city') ?? null,
        cnicNumber: snap.get('cnicNumber') ?? null,
        photoURL: snap.get('photoURL') ?? null,
        status: 'active',
        level: 'bronze',
        driverFleetId: fleets.driverFleetId,
        passengerFleetId: fleets.passengerFleetId,
        totalDrivers: 0,
        totalPassengers: 0,
        completedRides: 0,
        flaggedRides: 0,
        lifetimeEarnings: 0,
        approvedAt: now,
        approvedBy: admin.uid,
        createdAt: now,
        updatedAt: now,
      });

      // A partner without a wallet would take a commission credit and drop it.
      tx.set(db.doc(`partner_wallets/${uid}`), {
        uid,
        balance: 0,
        pending: 0,
        withdrawn: 0,
        lifetimeEarnings: 0,
        currency: 'PKR',
        createdAt: now,
        updatedAt: now,
      });
    }

    // The ambassador who recruited this partner gets their sale — once.
    if (decision === 'approve' && ambassadorId) {
      tx.set(
        db.doc(`ambassadors/${ambassadorId}`),
        { partnersSold: FieldValue.increment(1), updatedAt: now },
        { merge: true },
      );
      tx.set(ambassadorEdgeRef, { boughtPartnerPlan: true, soldAt: now }, { merge: true });
    }

    tx.set(db.collection('auditLogs').doc(), {
      type: `partner.application.${status}`,
      actor: admin.uid,
      targetUid: uid,
      tier: decision === 'approve' ? tier : null,
      ambassadorId: ambassadorId ?? null,
      reason: reason ?? null,
      createdAt: now,
    });
  });

  const copy: Record<PartnerApplicationStatus, { title: string; body: string }> = {
    approved: {
      title: 'You are a Velocity Rides Partner 🎉',
      body:
        tier === 'pro'
          ? `Approved on Pro. Your code is ${code}. Your private fleet portal: ${portalUrl(portalId!)} — sign in with this same number.`
          : `Approved on the Free tier. Your referral code is ${code}. Share it to start building your fleets.`,
    },
    rejected: {
      title: 'Partner application rejected',
      body: reason ?? 'Your application could not be approved.',
    },
    resubmit: {
      title: 'Partner application — documents needed',
      body: reason ?? 'Please resubmit clearer documents.',
    },
    pending: { title: '', body: '' },
  };
  await notifyUser(uid, copy[status].title, copy[status].body, 'ride', { partnerStatus: status });

  logger.info('Partner application reviewed', { actor: admin.uid, uid, status, tier });
  return { ok: true, status, code };
});
