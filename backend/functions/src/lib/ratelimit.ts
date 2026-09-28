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

/**
 * The counter document for one key, action and window, and the fields a write
 * to it carries.
 *
 * Exported for a caller that folds the check into a transaction of its own
 * (the WhatsApp sign-in code does, to keep round trips off every login). It has
 * to count in the same document, with the same TTL, as `rateLimit` does.
 */
export function rateLimitSlot(uid: string, action: string, windowSec: number) {
  const windowId = Math.floor(Date.now() / 1000 / windowSec);
  return {
    ref: db.doc(`rateLimits/${uid}_${action}_${windowId}`),
    fields: (count: number) => ({
      uid,
      action,
      count,
      expireAt: Timestamp.fromMillis((windowId + 2) * windowSec * 1000),
    }),
  };
}

export async function rateLimit(
  uid: string,
  action: string,
  max: number,
  windowSec: number,
): Promise<void> {
  const slot = rateLimitSlot(uid, action, windowSec);

  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(slot.ref);
    const current = (snap.get('count') as number | undefined) ?? 0;
    const next = current + 1;
    if (next <= max) tx.set(slot.ref, slot.fields(next));
    return next;
  });

  if (count > max) {
    throw new HttpsError('resource-exhausted', 'Too many requests — please slow down.');
  }
}
