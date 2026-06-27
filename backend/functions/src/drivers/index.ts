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
import { requireAuth, requireAdmin, requireRole, invalid } from '../lib/guards';
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
  vehiclePhotoDocPath: z.string().max(512).optional(),
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

const adminCreateDriverSchema = z.object({
  fullName:     z.string().min(2).max(120),
  email:        z.string().email().max(200),
  phone:        z.string().max(20).optional(),
  vehicleType:  z.enum(['mini', 'ac', 'comfort', 'xl', 'bike', 'auto']),
  vehicleLabel: z.string().min(2).max(80),
  plate:        z.string().min(3).max(16),
  cnic:         z.string().max(20).optional(),
  franchiseId:  z.string().max(128).optional(),
});

/**
 * Admin-only: create a driver account directly from the admin panel.
 * Creates a Firebase Auth user, sets the driver role, pre-approves the driver
 * doc and returns a password-reset link for the admin to share with the driver.
 */
export const adminCreateDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminCreateDriverSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? 'Invalid driver details.');
  }
  const data = parsed.data;

  let uid: string;
  try {
    const user = await auth.createUser({
      email: data.email,
      displayName: data.fullName,
      emailVerified: false,
      disabled: false,
    });
    uid = user.uid;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not create user account.';
    invalid(msg);
  }

  await auth.setCustomUserClaims(uid!, { role: 'driver' });

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(db.doc(`users/${uid!}`), {
    uid: uid!,
    role: 'driver',
    email: data.email,
    phoneNumber: data.phone ?? null,
    displayName: data.fullName,
    photoURL: null,
    gender: 'unspecified',
    createdAt: now,
    updatedAt: now,
  });

  batch.set(db.doc(`wallets/${uid!}`), {
    uid: uid!,
    balance: 0,
    currency: 'PKR',
    createdAt: now,
    updatedAt: now,
  });

  batch.set(db.doc(`drivers/${uid!}`), {
    driverId: uid!,
    verificationStatus: 'approved',
    adminCreated: true,
    online: false,
    rating: 5.0,
    tripsCount: 0,
    cycleGrossFare: 0,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone ?? null,
    vehicleType: data.vehicleType,
    vehicleLabel: data.vehicleLabel,
    plate: data.plate,
    cnic: data.cnic ?? null,
    franchiseId: data.franchiseId ?? null,
    approvedBy: admin.uid,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (data.franchiseId) {
    batch.set(
      db.doc(`franchises/${data.franchiseId}`),
      { totalDrivers: FieldValue.increment(1), updatedAt: now },
      { merge: true },
    );
  }

  await batch.commit();

  let passwordResetLink: string | null = null;
  try {
    passwordResetLink = await auth.generatePasswordResetLink(data.email);
  } catch {
    // non-fatal — admin can send reset manually
  }

  await db.collection('auditLogs').add({
    type: 'driver.admin_created',
    actor: admin.uid,
    targetUid: uid!,
    createdAt: now,
  });

  logger.info('Admin created driver', { actor: admin.uid, driverId: uid! });
  return { ok: true, uid: uid!, passwordResetLink };
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

/**
 * Driver-callable: record commission payment and unlock their profile.
 * In production this would verify a payment receipt; here it resets the cycle
 * counter so the driver can accept rides again.
 */
export const payCommission = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');

  const driverRef = db.doc(`drivers/${ctx.uid}`);
  const settingsSnap = await db.doc('config/commissionSettings').get();
  const threshold: number = settingsSnap.get('threshold') ?? 5000;
  const rate: number = settingsSnap.get('rate') ?? 0.10;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) throw new Error('Driver record not found.');
    const cycleGrossFare: number = snap.get('cycleGrossFare') ?? 0;
    if (cycleGrossFare < threshold) throw new Error('Commission threshold not reached yet.');

    const amountPaid = Math.round(threshold * rate);
    tx.set(
      driverRef,
      {
        cycleGrossFare: FieldValue.increment(-threshold),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Log the payment in a sub-collection for audit.
    const paymentRef = driverRef.collection('commissionPayments').doc();
    tx.set(paymentRef, {
      amount: amountPaid,
      threshold,
      rate,
      paidAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('Commission paid', { driverId: ctx.uid });
  return { ok: true };
});
