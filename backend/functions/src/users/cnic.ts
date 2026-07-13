/**
 * Velocity — passenger CNIC verification.
 * ----------------------------------------------------------------------------
 * Couriers move physical goods between strangers, so a passenger must prove who
 * they are before they can send or receive a parcel. Ordinary rides are
 * unaffected — this gate exists only for the courier flow (see couriers/).
 *
 * Flow: submit (front + back photo + CNIC number) → `pending` → an admin
 * approves or rejects in the dashboard → `verified` / `rejected`. Only
 * `verified` opens the courier flow. A rejected user may resubmit.
 *
 * The status lives on users/{uid}.cnicVerification so any surface can read it
 * in one document get, and is mirrored into `cnicVerifications/{uid}` so the
 * admin dashboard can list the review queue without scanning every user.
 *
 * Clients can never write these fields: the users/ rules whitelist excludes
 * `cnicVerification`, so status only ever changes through these callables.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';

/** 13 digits, hyphenated: 12345-1234567-1 — the format printed on the card. */
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export type CnicStatus = 'pending' | 'verified' | 'rejected';

const submitSchema = z.object({
  cnicNumber: z.string().trim().regex(CNIC_RE, 'CNIC must look like 12345-1234567-1'),
  fullName: z.string().trim().min(2).max(100),
  frontUrl: z.string().url().max(2048),
  backUrl: z.string().url().max(2048),
});

const reviewSchema = z.object({
  uid: z.string().min(1).max(128),
  approve: z.boolean(),
  reason: z.string().trim().max(300).optional(),
});

/** Reject document URLs that don't live in our own Storage bucket. */
function isOwnStorageUrl(url: string): boolean {
  return (
    url.startsWith('https://firebasestorage.googleapis.com/') ||
    url.startsWith('https://storage.googleapis.com/')
  );
}

/**
 * Shared gate. Any flow that requires a verified identity calls this and gets a
 * precise error the UI can act on, rather than a generic denial.
 */
export async function requireCnicVerified(uid: string): Promise<void> {
  const snap = await db.collection('users').doc(uid).get();
  const v = snap.data()?.cnicVerification as { status?: CnicStatus } | undefined;

  if (v?.status === 'verified') return;
  if (v?.status === 'pending') {
    invalid('Your CNIC is still being reviewed. You can book couriers once it is approved.');
  }
  if (v?.status === 'rejected') {
    invalid('Your CNIC verification was rejected. Please submit it again to book couriers.');
  }
  invalid('Verify your CNIC before sending or receiving a courier.');
}

export const submitCnicVerification = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const input = submitSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.issues[0]?.message ?? 'Invalid CNIC details.');
  const { cnicNumber, fullName, frontUrl, backUrl } = input.data!;

  for (const url of [frontUrl, backUrl]) {
    if (!isOwnStorageUrl(url)) invalid('CNIC photos must be uploaded to Velocity storage.');
  }

  const userRef = db.collection('users').doc(uid);
  const existing = (await userRef.get()).data()?.cnicVerification as
    | { status?: CnicStatus }
    | undefined;

  // Already-verified users have nothing to do; a pending one must wait rather
  // than resubmit and reset the admin's queue position.
  if (existing?.status === 'verified') invalid('Your CNIC is already verified.');
  if (existing?.status === 'pending') invalid('Your CNIC is already awaiting review.');

  const record = {
    status: 'pending' as CnicStatus,
    cnicNumber,
    fullName,
    frontUrl,
    backUrl,
    submittedAt: FieldValue.serverTimestamp(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
  };

  await Promise.all([
    userRef.set({ cnicVerification: record }, { merge: true }),
    // Review queue for the admin dashboard.
    db.collection('cnicVerifications').doc(uid).set({ uid, ...record }),
  ]);

  return { ok: true, status: 'pending' as CnicStatus };
});

export const adminReviewCnicVerification = onCall(async (req) => {
  requireAdmin(req);
  const input = reviewSchema.safeParse(req.data);
  if (!input.success) invalid(input.error.message);
  const { uid, approve, reason } = input.data!;

  const queueRef = db.collection('cnicVerifications').doc(uid);
  const snap = await queueRef.get();
  if (!snap.exists) invalid('No CNIC submission found for this user.');

  const status: CnicStatus = approve ? 'verified' : 'rejected';
  const patch = {
    status,
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: req.auth!.uid,
    rejectionReason: approve ? null : (reason ?? 'Your CNIC could not be verified.'),
  };

  await Promise.all([
    db.collection('users').doc(uid).set(
      { cnicVerification: { ...snap.data(), ...patch } },
      { merge: true },
    ),
    queueRef.update(patch),
  ]);

  await notifyUser(
    uid,
    approve ? 'CNIC verified ✅' : 'CNIC verification rejected',
    approve
      ? 'You can now send and receive couriers.'
      : (reason ?? 'Please submit clearer photos of your CNIC.'),
    'ride',
  );

  return { ok: true, status };
});
