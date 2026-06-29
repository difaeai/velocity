/**
 * User lifecycle and role management.
 */
import * as functionsV1 from 'firebase-functions/v1';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { Role } from '../domain/types';

/**
 * Runs when a new Firebase Auth account is created. Provisions the canonical
 * profile + wallet and assigns the default 'passenger' role as a custom claim.
 * (gen1 trigger — works on any Firebase project without an Identity Platform
 * upgrade.)
 */
export const onUserCreate = functionsV1.auth.user().onCreate(async (user) => {
  const { uid, email, phoneNumber, displayName, photoURL } = user;

  await auth.setCustomUserClaims(uid, { role: 'passenger' });

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(db.doc(`users/${uid}`), {
    uid,
    role: 'passenger',
    email: email ?? null,
    phoneNumber: phoneNumber ?? null,
    displayName: displayName ?? 'New User',
    photoURL: photoURL ?? null,
    gender: 'unspecified',
    createdAt: now,
    updatedAt: now,
  });

  batch.set(db.doc(`wallets/${uid}`), {
    uid,
    balance: 0,
    currency: 'PKR',
    createdAt: now,
    updatedAt: now,
  });

  await batch.commit();
  logger.info('Provisioned new user', { uid });
});

/** Removes the user's app data when their auth account is deleted. */
export const onUserDelete = functionsV1.auth.user().onDelete(async (user) => {
  await db.doc(`users/${user.uid}`).delete().catch(() => undefined);
  logger.info('Cleaned up deleted user', { uid: user.uid });
});

const setUserRoleSchema = z.object({
  targetUid: z.string().min(1).max(128),
  role: z.enum(['passenger', 'driver', 'admin']),
});

/**
 * Admin-only: assign a role to a user. This is the ONLY supported path to
 * granting elevated privileges, and it is itself guarded by requireAdmin.
 */
export const setUserRole = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = setUserRoleSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid('Provide a valid targetUid and role.');
  }
  const { targetUid, role } = parsed.data;

  await applyRole(targetUid, role);

  await db.collection('auditLogs').add({
    type: 'role.set',
    actor: admin.uid,
    targetUid,
    role,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Role updated', { actor: admin.uid, targetUid, role });
  return { ok: true, targetUid, role };
});

const registerFcmTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

/** Mobile: register or refresh an FCM token for the signed-in user. */
export const registerFcmToken = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = registerFcmTokenSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid FCM token.');
  const { token, platform } = parsed.data;

  await db.doc(`users/${ctx.uid}/fcmTokens/${token.slice(-20)}`).set({
    token,
    platform: platform ?? 'android',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

const banPassengerSchema = z.object({
  passengerId: z.string().min(1).max(128),
  banned: z.boolean(),
});

/** Admin-only: ban or unban a passenger. */
export const banPassenger = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = banPassengerSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid passengerId and banned flag.');
  const { passengerId, banned } = parsed.data;

  await db.doc(`users/${passengerId}`).set(
    { banned, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection('auditLogs').add({
    type: banned ? 'passenger.banned' : 'passenger.unbanned',
    actor: admin.uid,
    targetUid: passengerId,
    createdAt: FieldValue.serverTimestamp(),
  });
  logger.info('banPassenger', { actor: admin.uid, passengerId, banned });
  return { ok: true };
});

const resolveDisputeSchema = z.object({
  disputeId: z.string().min(1).max(128),
  resolution: z.string().max(500),
  refundAmount: z.number().min(0).optional(),
});

/** Admin-only: resolve a dispute, optionally credit passenger wallet. */
export const resolveDispute = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = resolveDisputeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid dispute resolution input.');
  const { disputeId, resolution, refundAmount } = parsed.data;

  await db.runTransaction(async tx => {
    const disputeRef = db.doc(`disputes/${disputeId}`);
    const snap = await tx.get(disputeRef);
    if (!snap.exists) invalid('Dispute not found.');
    const passengerId = snap.get('passengerId') as string | undefined;

    tx.set(disputeRef, {
      status: 'resolved',
      resolution,
      resolvedBy: admin.uid,
      resolvedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (refundAmount && refundAmount > 0 && passengerId) {
      const walletRef = db.doc(`wallets/${passengerId}`);
      tx.set(walletRef, { balance: FieldValue.increment(refundAmount), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      const txRef = db.collection(`wallets/${passengerId}/transactions`).doc();
      tx.set(txRef, {
        type: 'dispute_refund',
        amount: refundAmount,
        disputeId,
        resolvedBy: admin.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  logger.info('resolveDispute', { actor: admin.uid, disputeId, resolution, refundAmount });
  return { ok: true };
});

// ── Admin passenger CRUD ───────────────────────────────────────────────────

const adminCreatePassengerSchema = z.object({
  displayName: z.string().min(1).max(120),
  email:       z.string().email().optional(),
  phone:       z.string().min(6).max(20).optional(),
  gender:      z.enum(['male', 'female', 'other', 'unspecified']).optional(),
  password:    z.string().min(6).max(64).optional(),
}).refine(d => d.email || d.phone, { message: 'Provide email or phone.' });

/** Admin-only: manually create a passenger account. */
export const adminCreatePassenger = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminCreatePassengerSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.errors[0]?.message ?? 'Invalid input.');
  const { displayName, email, phone, gender, password } = parsed.data;

  // Create Firebase Auth account — onUserCreate trigger provisions Firestore doc
  const userRecord = await auth.createUser({
    displayName,
    email:       email   ?? undefined,
    phoneNumber: phone   ?? undefined,
    password:    password ?? undefined,
  });

  // Patch gender if supplied (trigger sets 'unspecified' by default)
  if (gender && gender !== 'unspecified') {
    await db.doc(`users/${userRecord.uid}`).set(
      { gender, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }

  await db.collection('auditLogs').add({
    type: 'passenger.created',
    actor: admin.uid,
    targetUid: userRecord.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('adminCreatePassenger', { actor: admin.uid, uid: userRecord.uid });
  return { ok: true, uid: userRecord.uid };
});

const adminUpdatePassengerSchema = z.object({
  passengerId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(120).optional(),
  email:       z.string().email().optional(),
  gender:      z.enum(['male', 'female', 'other', 'unspecified']).optional(),
  role:        z.enum(['passenger', 'driver', 'admin']).optional(),
});

/** Admin-only: update a passenger's profile fields. */
export const adminUpdatePassenger = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminUpdatePassengerSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid update input.');
  const { passengerId, displayName, email, gender, role } = parsed.data;

  // Update Firebase Auth record
  const authPatch: { displayName?: string; email?: string } = {};
  if (displayName) authPatch.displayName = displayName;
  if (email)       authPatch.email       = email;
  if (Object.keys(authPatch).length) {
    await auth.updateUser(passengerId, authPatch);
  }

  // Update Firestore profile
  const firestorePatch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (displayName) firestorePatch.displayName = displayName;
  if (email)       firestorePatch.email       = email;
  if (gender)      firestorePatch.gender      = gender;
  await db.doc(`users/${passengerId}`).set(firestorePatch, { merge: true });

  // Role change (updates custom claim)
  if (role) await applyRole(passengerId, role);

  await db.collection('auditLogs').add({
    type: 'passenger.updated',
    actor: admin.uid,
    targetUid: passengerId,
    changes: { displayName, email, gender, role },
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('adminUpdatePassenger', { actor: admin.uid, passengerId });
  return { ok: true };
});

const adminDeletePassengerSchema = z.object({
  passengerId: z.string().min(1).max(128),
});

/** Admin-only: permanently delete a passenger's Auth account + Firestore data. */
export const adminDeletePassenger = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adminDeletePassengerSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide passengerId.');
  const { passengerId } = parsed.data;

  // onUserDelete trigger handles Firestore cleanup
  await auth.deleteUser(passengerId);

  await db.collection('auditLogs').add({
    type: 'passenger.deleted',
    actor: admin.uid,
    targetUid: passengerId,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('adminDeletePassenger', { actor: admin.uid, passengerId });
  return { ok: true };
});

/** Sets a user's custom claim + mirrors the role onto their profile doc. */
export async function applyRole(targetUid: string, role: Role): Promise<void> {
  const existing = await auth.getUser(targetUid);
  const claims = { ...(existing.customClaims ?? {}), role };
  await auth.setCustomUserClaims(targetUid, claims);
  await db.doc(`users/${targetUid}`).set(
    { role, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
