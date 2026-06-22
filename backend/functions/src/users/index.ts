/**
 * User lifecycle and role management.
 */
import * as functionsV1 from 'firebase-functions/v1';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAdmin, invalid } from '../lib/guards';
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
