/**
 * Driver onboarding and verification.
 *
 * In the demo, the "approve driver" button flipped client state and wrote it
 * straight to Firestore — any client could mark itself an approved driver.
 * Approval is now an admin-only callable that sets a custom claim the rules
 * trust, and onboarding only ever moves a driver to 'pending'.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAuth, requireAdmin, invalid } from '../lib/guards';
import { applyRole } from '../users';

const onboardingSchema = z.object({
  fullName: z.string().min(2).max(120),
  cnic: z.string().regex(/^\d{5}-\d{7}-\d$/, 'CNIC must be formatted NNNNN-NNNNNNN-N'),
  vehicleType: z.enum(['bike', 'auto', 'mini', 'ac', 'comfort', 'xl']),
  vehicleLabel: z.string().min(2).max(80),
  plate: z.string().min(3).max(16),
  licenseDocPath: z.string().min(1).max(512),
  cnicDocPath: z.string().min(1).max(512),
  vehicleDocPath: z.string().min(1).max(512),
  cnicBackDocPath: z.string().max(512).optional(),
  photoDocPath: z.string().max(512).optional(),
  selfieDocPath: z.string().max(512).optional(),
  email: z.string().email().max(200).optional(),
  dob: z.string().max(40).optional(),
});

/**
 * A signed-in user submits driver documents. Creates/updates their driver doc
 * with status 'pending'. Does NOT grant the driver role — that requires admin
 * approval.
 */
export const submitDriverOnboarding = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = onboardingSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? 'Invalid onboarding details.');
  }
  const data = parsed.data;

  const ref = db.doc(`drivers/${ctx.uid}`);
  const snap = await ref.get();
  const current = snap.data();
  if (current?.verificationStatus === 'approved') {
    invalid('Driver is already approved.');
  }

  await ref.set(
    {
      driverId: ctx.uid,
      verificationStatus: 'pending',
      online: false,
      rating: current?.rating ?? 5.0,
      tripsCount: current?.tripsCount ?? 0,
      ...data,
      submittedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Driver onboarding submitted', { uid: ctx.uid });
  return { ok: true, verificationStatus: 'pending' };
});

const driverIdSchema = z.object({ driverId: z.string().min(1).max(128) });

/** Admin-only: approve a pending driver and grant the 'driver' role. */
export const approveDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = driverIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid driverId.');
  const { driverId } = parsed.data;

  const ref = db.doc(`drivers/${driverId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('Driver has not submitted onboarding.');

  await applyRole(driverId, 'driver');
  await ref.set(
    {
      verificationStatus: 'approved',
      approvedBy: admin.uid,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection('auditLogs').add({
    type: 'driver.approved',
    actor: admin.uid,
    targetUid: driverId,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver approved', { actor: admin.uid, driverId });
  return { ok: true, verificationStatus: 'approved' };
});

const rejectSchema = driverIdSchema.extend({
  reason: z.string().max(500).optional(),
  suspend: z.boolean().optional(),
});

/** Admin-only: reject or suspend a driver, revoking the driver role. */
export const rejectDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = rejectSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid driverId.');
  const { driverId, reason, suspend } = parsed.data;

  const ref = db.doc(`drivers/${driverId}`);
  if (!(await ref.get()).exists) invalid('Unknown driver.');

  // Drop the driver role back to passenger so they lose driver privileges.
  await applyRole(driverId, 'passenger');
  await auth.revokeRefreshTokens(driverId);
  await ref.set(
    {
      verificationStatus: suspend ? 'suspended' : 'rejected',
      online: false,
      reviewReason: reason ?? null,
      reviewedBy: admin.uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await db.collection('auditLogs').add({
    type: suspend ? 'driver.suspended' : 'driver.rejected',
    actor: admin.uid,
    targetUid: driverId,
    reason: reason ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver review action', { actor: admin.uid, driverId, suspend });
  return { ok: true };
});
