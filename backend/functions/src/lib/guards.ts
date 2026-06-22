/**
 * Authentication / authorisation guards for callable functions.
 *
 * Every privileged operation funnels through these helpers so that auth and
 * role checks are consistent and impossible to forget. Roles come from custom
 * claims, which are only ever set by the backend (see users/setUserRole and
 * drivers/approveDriver).
 */
import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
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
