/**
 * Authentication / authorisation guards for callable functions.
 *
 * Every privileged operation funnels through these helpers so that auth and
 * role checks are consistent and impossible to forget. Roles come from custom
 * claims, which are only ever set by the backend (see users/setUserRole and
 * drivers/approveDriver).
 */
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { Role } from '../domain/types';

export interface AuthedContext {
  uid: string;
  role: Role;
  token: Record<string, unknown>;
}

/** Require a signed-in caller; returns normalised auth context. */
export function requireAuth(req: CallableRequest): AuthedContext {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const token = req.auth.token as Record<string, unknown>;
  const role = (token.role as Role) ?? 'passenger';
  return { uid: req.auth.uid, role, token };
}

/** Require the caller to hold a specific role. */
export function requireRole(req: CallableRequest, role: Role): AuthedContext {
  const ctx = requireAuth(req);
  if (ctx.role !== role) {
    throw new HttpsError(
      'permission-denied',
      `This action requires the '${role}' role.`,
    );
  }
  return ctx;
}

/** Require the caller to be an admin. */
export function requireAdmin(req: CallableRequest): AuthedContext {
  return requireRole(req, 'admin');
}

/** Convenience for raising a consistent validation error. */
export function invalid(message: string): never {
  throw new HttpsError('invalid-argument', message);
}

/**
 * A Firestore document id taken from a caller.
 *
 * Ids end up inside paths — `db.doc(`trips/${tripId}`)` — and the Admin SDK
 * reads a `/` in an id as a path separator, so `tripId: "abc/chat/msg1"` would
 * quietly address a document in a subcollection instead of the trip. Every
 * ownership check that follows would then be run against the wrong document.
 * No real id (auto-ids, uids, the composite `a_b` ids) ever contains a slash.
 */
export const docId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/]+$/, 'must be a document id');

/** The same check for ids that arrive outside zod (query strings, raw data). */
export function isDocId(value: unknown): value is string {
  return docId.safeParse(value).success;
}
