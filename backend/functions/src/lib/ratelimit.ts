/**
 * Per-user fixed-window rate limiting for callable functions.
 *
 * Counters live in the server-only `rateLimits` collection (clients have no
 * access — default deny). Each doc carries an `expireAt` timestamp; enable a
 * Firestore TTL policy on that field so old counters self-delete (see
 * docs/HARDENING.md).
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { db, Timestamp } from './firebase';

export async function rateLimit(
  uid: string,
  action: string,
  max: number,
  windowSec: number,
): Promise<void> {
  const windowId = Math.floor(Date.now() / 1000 / windowSec);
  const ref = db.doc(`rateLimits/${uid}_${action}_${windowId}`);

  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.get('count') as number | undefined) ?? 0;
    const next = current + 1;
    if (next <= max) {
      tx.set(ref, {
        uid,
        action,
        count: next,
        expireAt: Timestamp.fromMillis((windowId + 2) * windowSec * 1000),
      });
    }
    return next;
  });

  if (count > max) {
    throw new HttpsError('resource-exhausted', 'Too many requests — please slow down.');
  }
}
