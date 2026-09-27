/**
 * A franchise's share of a ride.
 * ----------------------------------------------------------------------------
 * Every franchise document carries its own `commissionRate` (set when the
 * franchise is created, editable from the dashboard), but both settlements
 * used to hard-code 5% and ignore it. The pool-ride settlement did not even
 * cap it at the commission, so with a commission below 5% the franchise was
 * credited more than Velocity actually earned on the ride.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';

/** What a franchise earns when its document does not say. */
export const DEFAULT_FRANCHISE_RATE = 0.05;

/** The franchise's rate as a fraction of the gross fare. 0 without a franchise. */
export async function franchiseRateFor(franchiseId: string | null | undefined): Promise<number> {
  if (!franchiseId) return 0;
  try {
    const snap = await db.doc(`franchises/${franchiseId}`).get();
    return franchiseRateFrom(snap.exists ? snap.get('commissionRate') : undefined);
  } catch {
    return DEFAULT_FRANCHISE_RATE;
  }
}

/** Validate a stored rate: 0–50%, anything else falls back to the default. */
export function franchiseRateFrom(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 0.5
    ? raw
    : DEFAULT_FRANCHISE_RATE;
}

/**
 * The franchise's cut of one ride. Paid out of Velocity's commission, so it can
 * never exceed that commission however the rates are set.
 */
export function franchiseCutFor(grossFare: number, rate: number, commission: number): number {
  if (!(grossFare > 0) || !(rate > 0)) return 0;
  return Math.min(Math.round(grossFare * rate), Math.max(0, commission));
}
