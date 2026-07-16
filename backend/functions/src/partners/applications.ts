/**
 * Partner Program — applications and admin review.
 * ----------------------------------------------------------------------------
 * Nobody self-serves into a fleet owner. They apply with an identity document
 * (CNIC, university card, licence, passport), a human looks at the documents,
 * and only an approval mints the `partners/{uid}` doc
 * that the dashboard and every earning path key off. `requirePartner()` is the
 * single gate — if there is no approved partner doc, there is no program.
 *
 * TIERS
 * -----
 * A free application needs an identity document and a verified mobile, nothing
 * else. A Pro
 * application additionally needs proof that the registration fee was paid — a
 * screenshot of the transfer — because Pro earns roughly four times what free
 * earns and the fee is the only thing standing between "a partner" and "anyone
 * who wants the higher rate". The screenshot is checked by a human at approval:
 * the backend cannot tell a real receipt from a Photoshopped one, and pretending
 * otherwise would just be theatre.
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
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { getPartnerSettings } from './config';
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

const submitSchema = z
  .object({
    tier: z.enum(['free', 'pro']),
    fullName: z.string().trim().min(2).max(100),
    mobile: z.string().trim().min(10).max(20),
    /** Which document the photos show. Older clients never send it → CNIC. */
    idType: z.enum(ID_TYPES).default('cnic'),
    cnicNumber: z.string().trim().min(4).max(40),
    cnicFrontUrl: z.string().url().max(2048),
    /** The back side only exists to read on a CNIC; optional for other IDs. */
    cnicBackUrl: z.string().url().max(2048).optional(),
    city: z.string().trim().min(2).max(80),
    /** Pro only: screenshot of the registration-fee transfer. */
    paymentProofUrl: z.string().url().max(2048).optional(),
    /** Pro only: which rail they paid on, so the admin knows where to look. */
    paymentMethod: z.enum(['bank', 'easypaisa', 'jazzcash']).optional(),
    paymentReference: z.string().trim().max(120).optional(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Partner Program terms.' }),
    }),
  })
  .refine((d) => d.tier !== 'pro' || !!d.paymentProofUrl, {
    message: 'Upload a screenshot of your Pro registration payment.',
    path: ['paymentProofUrl'],
  })
  .refine((d) => d.tier !== 'pro' || !!d.paymentMethod, {
    message: 'Tell us which account you paid into.',
    path: ['paymentMethod'],
  })
  .refine((d) => d.idType !== 'cnic' || CNIC_RE.test(d.cnicNumber), {
    message: 'CNIC must look like 12345-1234567-1',
    path: ['cnicNumber'],
  })
  .refine((d) => d.idType !== 'cnic' || !!d.cnicBackUrl, {
    message: 'Upload both sides of your CNIC.',
    path: ['cnicBackUrl'],
  });

const reviewSchema = z.object({
  uid: z.string().min(1).max(128),
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
    invalid('You are not a Velocity partner yet. Apply for the Partner Program first.');
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
    proFee: s.proFee,
    proFeeCurrency: s.proFeeCurrency,
    payment: s.payment,
  };
});

export const submitPartnerApplication = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input = submitSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.issues[0]?.message ?? 'Invalid application.');
  const data = input.data;

  const docs = [data.cnicFrontUrl];
  if (data.cnicBackUrl) docs.push(data.cnicBackUrl);
  if (data.paymentProofUrl) docs.push(data.paymentProofUrl);
  for (const url of docs) {
    if (!isOwnStorageUrl(url)) invalid('Documents must be uploaded to Velocity storage.');
  }

  // Already a partner? Nothing to apply for.
  const partnerSnap = await db.doc(`partners/${uid}`).get();
  if (partnerSnap.exists) invalid('You are already a Velocity partner.');

  const appRef = db.doc(`partner_applications/${uid}`);
  const existing = await appRef.get();
  const prevStatus = existing.get('status') as PartnerApplicationStatus | undefined;
  if (prevStatus === 'pending') invalid('Your application is already awaiting review.');
  if (prevStatus === 'approved') invalid('Your application was already approved.');

  // The OTP proof. Firebase only writes a phone number onto the auth record
  // after it verified an SMS code for it, so this check IS the OTP check —
  // there is no way to satisfy it without having passed the OTP screen.
  const authUser = await auth.getUser(uid);
  const claimed = normalizePhone(data.mobile);
  if (!authUser.phoneNumber) {
    invalid('Verify your mobile number with an OTP before submitting your application.');
  }
  if (normalizePhone(authUser.phoneNumber) !== claimed) {
    invalid('Submit the same mobile number you verified with the OTP.');
  }

  // One ID document, one partner. Two accounts holding the same card is the
  // cheapest way to farm referrals, so it is blocked at the door rather than
  // unwound later by the fraud engine.
  const cnicClash = await db
    .collection('partner_applications')
    .where('cnicNumber', '==', data.cnicNumber)
    .where('status', 'in', ['pending', 'approved'])
    .limit(1)
    .get();
  if (!cnicClash.empty && cnicClash.docs[0].id !== uid) {
    invalid('This CNIC is already used by another partner application.');
  }

  const settings = await getPartnerSettings();
  const userSnap = await db.doc(`users/${uid}`).get();

  await appRef.set({
    uid,
    tier: data.tier as PartnerTier,
    fullName: data.fullName,
    mobile: claimed,
    idType: data.idType,
    cnicNumber: data.cnicNumber,
    cnicFrontUrl: data.cnicFrontUrl,
    cnicBackUrl: data.cnicBackUrl ?? null,
    city: data.city,
    photoURL: userSnap.get('photoURL') ?? null,
    // Pro only. The fee is snapshotted as it stood when they paid, so an admin
    // reviewing next week compares the screenshot against the price the
    // applicant was actually shown, not against a rate that changed since.
    paymentProofUrl: data.paymentProofUrl ?? null,
    paymentMethod: data.paymentMethod ?? null,
    paymentReference: data.paymentReference ?? null,
    quotedFee: data.tier === 'pro' ? settings.proFee : 0,
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
      const fullName = (snap.get('fullName') as string) ?? 'Velocity Partner';

      // Both fleets exist the moment the partner does. An approved partner who
      // still has to press "create fleet" before their code resolves is a
      // partner whose first recruits bounce off a dead code.
      const fleets = createFleetsForPartner(tx, { partnerId: uid, code, fullName });

      tx.set(db.doc(`partners/${uid}`), {
        uid,
        tier,
        referralCode: code,
        fullName,
        mobile: snap.get('mobile'),
        city: snap.get('city'),
        cnicNumber: snap.get('cnicNumber'),
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

    tx.set(db.collection('auditLogs').doc(), {
      type: `partner.application.${status}`,
      actor: admin.uid,
      targetUid: uid,
      tier: decision === 'approve' ? tier : null,
      reason: reason ?? null,
      createdAt: now,
    });
  });

  const copy: Record<PartnerApplicationStatus, { title: string; body: string }> = {
    approved: {
      title: 'You are a Velocity Partner 🎉',
      body: `Approved on the ${tier === 'pro' ? 'Pro' : 'Free'} tier. Your referral code is ${code}. Share it to start building your fleets.`,
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
