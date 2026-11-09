/**
 * Each visitor's own 3 days at today's price. A signed-in customer is counted
 * by profile, which is what a payment is charged from; anyone else by a hash of
 * their IP, which only decides what the public pricing page shows.
 */
import { createHash } from 'node:crypto';

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../lib/firebase';

export const PRICE_WINDOW_MS = 3 * 86_400_000;
/** Whoever saw the old price and went to send the money is still charged it. */
export const PRICE_GRACE_MS = 2 * 3600_000;

/** Pure: how long is left of this window, and whether the higher price applies yet. */
export function priceState(startedAtMs: number, nowMs: number): { leftMs: number; raised: boolean } {
  const leftMs = startedAtMs + PRICE_WINDOW_MS - nowMs;
  return { leftMs, raised: leftMs <= -PRICE_GRACE_MS };
}

// shortcut: these docs are never swept, one per IP or customer; add a Firestore TTL if the collection grows.
async function startedAt(key: string, nowMs: number): Promise<number> {
  const ref = db.collection('studioPriceClocks').doc(key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return snap.get('startedAtMs') as number;
    tx.create(ref, { startedAtMs: nowMs });
    return nowMs;
  });
}

/** Whether this customer pays the higher price now. Starts their clock the first time it is asked. */
export async function customerPriceRaised(uid: string, nowMs: number): Promise<boolean> {
  return priceState(await startedAt(`u_${uid}`, nowMs), nowMs).raised;
}

// shortcut: an IP is a rough identity (mobile networks share one, home ones change, the header can be forged), so it never sets what anyone is charged.
const ipKey = (ip: string): string => `ip_${createHash('sha256').update(ip).digest('hex')}`;

export const studioPriceClock = onCall(async (req) => {
  const now = Date.now();
  const ip = req.rawRequest?.ip;
  if (req.auth) return priceState(await startedAt(`u_${req.auth.uid}`, now), now);
  // No address to count from, and a clock that restarts would say nothing true: the page shows no timer.
  if (!ip) throw new HttpsError('failed-precondition', 'No address to count from.');
  return priceState(await startedAt(ipKey(ip), now), now);
});
