/**
 * Driver onboarding and verification.
 *
 * In the demo, the "approve driver" button flipped client state and wrote it
 * straight to Firestore — any client could mark itself an approved driver.
 * Approval is now an admin-only callable that sets a custom claim the rules
 * trust, and onboarding only ever moves a driver to 'pending'.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAuth, requireAdmin, requireRole, invalid } from '../lib/guards';
import { applyRole } from '../users';
import { cycleCashFare, getCommissionSettings } from '../domain/commission';

const onboardingSchema = z.object({
  fullName:            z.string().min(2).max(120),
  cnic:                z.string().regex(/^\d{5}-\d{7}-\d$/, 'CNIC must be formatted NNNNN-NNNNNNN-N'),
  vehicleType:         z.enum(['bike', 'auto', 'mini', 'ac', 'comfort', 'xl']),
  vehicleLabel:        z.string().min(2).max(80),
  plate:               z.string().min(3).max(16),
  licenseDocPath:      z.string().min(1).max(512),
  licenseDocUrl:       z.string().url().max(2000).optional(),
  cnicDocPath:         z.string().min(1).max(512),
  cnicDocUrl:          z.string().url().max(2000).optional(),
  cnicBackDocPath:     z.string().max(512).optional(),
  cnicBackDocUrl:      z.string().url().max(2000).optional(),
  vehicleDocPath:      z.string().min(1).max(512),
  vehicleDocUrl:       z.string().url().max(2000).optional(),
  photoDocPath:        z.string().max(512).optional(),
  photoDocUrl:         z.string().url().max(2000).optional(),
  vehiclePhotoDocPath: z.string().max(512).optional(),
  vehiclePhotoDocUrl:  z.string().url().max(2000).optional(),
  extraVehiclePhotoDocPaths: z.array(z.string().min(1).max(512)).max(6).optional(),
  extraVehiclePhotoDocUrls:  z.array(z.string().url().max(2000)).max(6).optional(),
  email:               z.string().email().max(200).optional(),
  dob:                 z.string().max(40).optional(),
  licenseExpiry:       z.string().max(20).optional(),
  cnicExpiry:          z.string().max(20).optional(),
  vehicleDocExpiry:    z.string().max(20).optional(),
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
      // Clear any previous rejection data on resubmission
      reviewReason: null,
      rejectedSections: [],
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
  phone:        z.string().max(20).nullish(),
  vehicleType:  z.enum(['mini', 'ac', 'comfort', 'xl', 'bike', 'auto']),
  vehicleLabel: z.string().min(2).max(80),
  plate:        z.string().min(3).max(16),
  cnic:         z.string().max(20).nullish(),
  franchiseId:  z.string().max(128).nullish(),
});

/**
 * Authenticated user: if an approved driver Firestore doc exists for the caller
 * but their Firebase Auth token lacks the driver claim (e.g. the account existed
 * before adminCreateDriver ran), this re-applies the claim so they can log in.
 */
export const claimDriverRole = onCall(async (req) => {
  const ctx = requireAuth(req);

  const snap = await db.doc(`drivers/${ctx.uid}`).get();
  if (!snap.exists || snap.get('verificationStatus') !== 'approved') {
    invalid('No approved driver account found for this user.');
  }

  await auth.setCustomUserClaims(ctx.uid, { role: 'driver' });
  await auth.revokeRefreshTokens(ctx.uid); // force client to re-fetch claims

  logger.info('claimDriverRole: claims applied', { uid: ctx.uid });
  return { ok: true };
});

/**
 * Admin-only: create a driver account directly from the admin panel.
 * Creates a Firebase Auth user (or reuses an existing one), sets the driver
 * role, pre-approves the driver doc and returns a password-reset link.
 */
export const adminCreateDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminCreateDriverSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? 'Invalid driver details.');
  }
  const data = parsed.data!;

  // Create Firebase Auth account, or reuse an existing one for this email
  let uid: string;
  try {
    const userRecord = await auth.createUser({
      email: data.email,
      displayName: data.fullName,
      emailVerified: false,
      disabled: false,
    });
    uid = userRecord.uid;
  } catch (createErr: unknown) {
    // If the email already exists, reuse that account and update claims
    const msg = createErr instanceof Error ? createErr.message : '';
    if (msg.includes('already exists') || (createErr as { code?: string }).code === 'auth/email-already-exists') {
      try {
        const existing = await auth.getUserByEmail(data.email);
        uid = existing.uid;
      } catch {
        invalid('Email already in use and could not retrieve the existing account.');
      }
    } else {
      invalid(msg || 'Could not create user account.');
    }
  }

  // Set role claims and provision Firestore records
  try {
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
      ratingCount: 0,
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
      // Set even though nothing was submitted: `submittedAt` is "when this
      // driver entered the funnel", and the dashboard's new-drivers-per-day
      // counts on it. Without it an admin-created driver never appears.
      submittedAt: now,
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
  } catch (e: unknown) {
    // Clean up the Auth account if Firestore write fails
    await auth.deleteUser(uid!).catch(() => undefined);
    invalid(e instanceof Error ? e.message : 'Failed to provision driver records.');
  }

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
    createdAt: FieldValue.serverTimestamp(),
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

const SECTION_KEYS = ['basic', 'license', 'cnic', 'vehicle'] as const;
const rejectSchema = driverIdSchema.extend({
  reason:           z.string().max(500).optional(),
  suspend:          z.boolean().optional(),
  rejectedSections: z.array(z.enum(SECTION_KEYS)).optional(),
});

/** Admin-only: reject or suspend a driver, revoking the driver role. */
export const rejectDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = rejectSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid driverId.');
  const { driverId, reason, suspend, rejectedSections } = parsed.data;

  const ref = db.doc(`drivers/${driverId}`);
  if (!(await ref.get()).exists) invalid('Unknown driver.');

  // Drop the driver role back to passenger so they lose driver privileges.
  await applyRole(driverId, 'passenger');
  await auth.revokeRefreshTokens(driverId);
  await ref.set(
    {
      verificationStatus: suspend ? 'suspended' : 'rejected',
      online: false,
      reviewReason:     reason ?? null,
      rejectedSections: rejectedSections ?? [],
      reviewedBy:       admin.uid,
      updatedAt:        FieldValue.serverTimestamp(),
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
 * Driver-callable: settle the commission cycle from the driver's wallet and
 * unlock their profile. The amount owed is the admin-set rate applied to the
 * cycle's **cash** fares only — commission on online (wallet) rides was
 * already deducted from the held fare at completion, so mixed cash/online
 * cycles never pay twice. Settling debits the driver's wallet (funded by
 * JazzCash/Easypaisa top-ups, so the money reaches Velocity), ledgers the
 * amount as realized platform revenue and resets the cycle to zero.
 */
export const payCommission = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');

  const driverRef = db.doc(`drivers/${ctx.uid}`);
  const { rate, threshold } = await getCommissionSettings();

  const amountPaid = await db.runTransaction(async (tx) => {
    const walletRef = db.doc(`wallets/${ctx.uid}`);
    const [snap, walletSnap] = await Promise.all([tx.get(driverRef), tx.get(walletRef)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Driver record not found.');
    const cycleGrossFare: number = snap.get('cycleGrossFare') ?? 0;
    if (cycleGrossFare < threshold) {
      throw new HttpsError('failed-precondition', 'Commission threshold not reached yet.');
    }

    const cashFare = cycleCashFare(snap);
    const due = Math.round(cashFare * rate);
    if (due > 0) {
      const balance: number = walletSnap.get('balance') ?? 0;
      if (balance < due) {
        throw new HttpsError(
          'failed-precondition',
          `Commission due is ${due} PKR but your wallet has ${balance} PKR. Top up ${due - balance} PKR first.`,
        );
      }

      // Debit the driver's wallet and ledger both sides of the movement.
      tx.set(
        walletRef,
        { balance: FieldValue.increment(-due), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      tx.set(walletRef.collection('transactions').doc(), {
        type: 'commission_payment',
        amount: -due,
        cycleGrossFare,
        cycleCashFare: cashFare,
        threshold,
        rate,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('platformLedger').doc(), {
        type: 'ride_commission',
        source: 'cash_cycle',
        driverId: ctx.uid,
        amount: due,
        cycleGrossFare,
        cycleCashFare: cashFare,
        threshold,
        rate,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        db.doc('system/counters'),
        {
          cashCommissionCollected: FieldValue.increment(due),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    // The whole cycle is settled (commission charged on its full cash
    // portion), so it resets to zero rather than rolling any overflow.
    tx.set(
      driverRef,
      {
        cycleGrossFare: 0,
        cycleCashFare: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Log the payment in a sub-collection for audit.
    tx.set(driverRef.collection('commissionPayments').doc(), {
      amount: due,
      cycleGrossFare,
      cycleCashFare: cashFare,
      threshold,
      rate,
      paidAt: FieldValue.serverTimestamp(),
    });
    return due;
  });

  logger.info('Commission paid', { driverId: ctx.uid, amountPaid });
  return { ok: true, amountPaid };
});

// ── Admin CRUD for existing drivers ───────────────────────────────────────────

const updateDriverSchema = z.object({
  driverId:     z.string().min(1).max(128),
  fullName:     z.string().min(2).max(120).optional(),
  phone:        z.string().max(20).optional(),
  vehicleType:  z.enum(['mini', 'ac', 'comfort', 'xl', 'bike', 'auto']).optional(),
  vehicleLabel: z.string().min(2).max(80).optional(),
  plate:        z.string().min(3).max(16).optional(),
  cnic:         z.string().max(20).optional(),
  franchiseId:  z.string().max(128).nullable().optional(),
});

/** Admin-only: update an existing driver's profile fields. */
export const updateDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = updateDriverSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid data.');
  const { driverId, ...updates } = parsed.data!;

  const ref = db.doc(`drivers/${driverId}`);
  if (!(await ref.get()).exists) invalid('Driver not found.');

  const fields: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (updates.fullName)        fields.fullName     = updates.fullName;
  if (updates.phone !== undefined) fields.phone    = updates.phone ?? null;
  if (updates.vehicleType)     fields.vehicleType  = updates.vehicleType;
  if (updates.vehicleLabel)    fields.vehicleLabel = updates.vehicleLabel;
  if (updates.plate)           fields.plate        = updates.plate.toUpperCase();
  if (updates.cnic !== undefined)  fields.cnic     = updates.cnic ?? null;
  if ('franchiseId' in updates)    fields.franchiseId = updates.franchiseId ?? null;

  await ref.set(fields, { merge: true });

  if (updates.fullName) {
    await auth.updateUser(driverId, { displayName: updates.fullName }).catch(() => undefined);
    await db.doc(`users/${driverId}`).set({ displayName: updates.fullName }, { merge: true });
  }
  if (updates.phone !== undefined) {
    await db.doc(`users/${driverId}`).set({ phoneNumber: updates.phone ?? null }, { merge: true });
  }

  await db.collection('auditLogs').add({
    type: 'driver.updated',
    actor: admin.uid,
    targetUid: driverId,
    changes: Object.keys(fields).filter((k) => k !== 'updatedAt'),
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver updated', { actor: admin.uid, driverId });
  return { ok: true };
});

/** Admin-only: hard-disable a driver account (soft-delete, keeps audit trail). */
export const deleteDriver = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = driverIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid driverId.');
  const { driverId } = parsed.data;

  if (!(await db.doc(`drivers/${driverId}`).get()).exists) invalid('Driver not found.');

  // Revoke role and disable Auth account so they can't log in
  await applyRole(driverId, 'passenger');
  await auth.updateUser(driverId, { disabled: true }).catch(() => undefined);
  await auth.revokeRefreshTokens(driverId).catch(() => undefined);

  await db.doc(`drivers/${driverId}`).set({
    verificationStatus: 'deleted',
    online: false,
    deletedBy:  admin.uid,
    deletedAt:  FieldValue.serverTimestamp(),
    updatedAt:  FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('auditLogs').add({
    type: 'driver.deleted',
    actor: admin.uid,
    targetUid: driverId,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver deleted', { actor: admin.uid, driverId });
  return { ok: true };
});
