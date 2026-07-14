/**
 * Partner Program — applications and admin review.
 * ----------------------------------------------------------------------------
 * Nobody self-serves into a fleet owner. They apply with their CNIC, a human
 * looks at the documents, and only an approval mints the `partners/{uid}` doc
 * that the dashboard and every earning path key off. `requirePartner()` is the
 * single gate — if there is no approved partner doc, there is no program.
 *
 * Phone verification is not taken on trust from the client. The submitted
 * number must already be on the caller's Firebase Auth record, and a number
 * only lands there when Firebase itself verified an OTP for it. A client that
 * skips the OTP screen and posts the form anyway is rejected by the backend.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import type { PartnerApplicationStatus } from './types';

/** 13 digits, hyphenated — the format printed on the card. Matches users/cnic. */
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

const submitSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  mobile: z.string().trim().min(10).max(20),
  cnicNumber: z.string().trim().regex(CNIC_RE, 'CNIC must look like 12345-1234567-1'),
  cnicFrontUrl: z.string().url().max(2048),
  cnicBackUrl: z.string().url().max(2048),
  city: z.string().trim().min(2).max(80),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Partner Program terms.' }),
  }),
});

const reviewSchema = z.object({
  uid: z.string().min(1).max(128),
  decision: z.enum(['approve', 'reject', 'resubmit']),
  reason: z.string().trim().max(500).optional(),
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

export const submitPartnerApplication = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid application.');
  const data = parsed.data;

  for (const url of [data.cnicFrontUrl, data.cnicBackUrl]) {
    if (!isOwnStorageUrl(url)) invalid('CNIC photos must be uploaded to Velocity storage.');
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

  // One CNIC, one partner. Two accounts holding the same card is the cheapest
  // way to farm referrals, so it is blocked at the door rather than unwound
  // later by the fraud engine.
  const cnicClash = await db
    .collection('partner_applications')
    .where('cnicNumber', '==', data.cnicNumber)
    .where('status', 'in', ['pending', 'approved'])
    .limit(1)
    .get();
  if (!cnicClash.empty && cnicClash.docs[0].id !== uid) {
    invalid('This CNIC is already used by another partner application.');
  }

  const userSnap = await db.doc(`users/${uid}`).get();

  await appRef.set({
    uid,
    fullName: data.fullName,
    mobile: claimed,
    cnicNumber: data.cnicNumber,
    cnicFrontUrl: data.cnicFrontUrl,
    cnicBackUrl: data.cnicBackUrl,
    city: data.city,
    photoURL: userSnap.get('photoURL') ?? null,
    acceptedTerms: true,
    status: 'pending' as PartnerApplicationStatus,
    // A resubmission is a fresh queue entry, so clear the old verdict.
    rejectionReason: null,
    reviewedAt: null,
    reviewedBy: null,
    submittedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Partner application submitted', { uid, city: data.city });
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
  const now = FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.update(appRef, {
    status,
    rejectionReason: decision === 'approve' ? null : reason,
    reviewedAt: now,
    reviewedBy: admin.uid,
    updatedAt: now,
  });

  if (decision === 'approve') {
    // Approval mints the partner and their wallet together. A partner without a
    // wallet would take a commission credit and drop it on the floor.
    batch.set(db.doc(`partners/${uid}`), {
      uid,
      fullName: snap.get('fullName'),
      mobile: snap.get('mobile'),
      city: snap.get('city'),
      cnicNumber: snap.get('cnicNumber'),
      photoURL: snap.get('photoURL') ?? null,
      status: 'active',
      level: 'bronze',
      driverFleetId: null,
      passengerFleetId: null,
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
    batch.set(db.doc(`partner_wallets/${uid}`), {
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

  batch.set(db.collection('auditLogs').doc(), {
    type: `partner.application.${status}`,
    actor: admin.uid,
    targetUid: uid,
    reason: reason ?? null,
    createdAt: now,
  });

  await batch.commit();

  const copy: Record<PartnerApplicationStatus, { title: string; body: string }> = {
    approved: {
      title: 'You are a Velocity Partner 🎉',
      body: 'Your application is approved. Open Earn with Velocity to create your fleets and start earning.',
    },
    rejected: {
      title: 'Partner application rejected',
      body: reason ?? 'Your application could not be approved.',
    },
    resubmit: {
      title: 'Partner application — documents needed',
      body: reason ?? 'Please resubmit clearer CNIC photos.',
    },
    pending: { title: '', body: '' },
  };
  await notifyUser(uid, copy[status].title, copy[status].body, 'ride', { partnerStatus: status });

  logger.info('Partner application reviewed', { actor: admin.uid, uid, status });
  return { ok: true, status };
});
