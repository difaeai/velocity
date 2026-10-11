/**
 * Which city's fare table prices a trip.
 * ----------------------------------------------------------------------------
 * Fare tables live at fareConfig/{cityId}. Offer bounds and en-route pricing
 * used to read `islamabad_rawalpindi` for every ride in the country, so a
 * Karachi trip was priced on Islamabad's per-km rate even though Karachi has a
 * table of its own. The city now comes from where the trip starts.
 *
 * A city with no table yet (Lahore today) falls back to the Islamabad–Rawalpindi
 * one, which is what every ride used before — so adding `fareConfig/lahore`
 * from the admin side is all it takes to give Lahore its own rates.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { cityFor } from '../locations/registry';
import { loadFuelPrices, loadPricingConfig } from '../pricing/config';
import { withFuelAdjustedRates } from '../pricing/fuel';
import type { CityFareConfig } from './fareEngine';

/** The table every city falls back to until it has one of its own. */
export const DEFAULT_FARE_CITY = 'islamabad_rawalpindi';

/** Fare-config ids to try for a trip starting at `point`, most specific first. */
export function fareCityIdsFor(point: { lat: number; lng: number } | null | undefined): string[] {
  const ids: string[] = [];
  const usable = !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
  const name = usable ? cityFor(point!)?.name : null;
  if (name) {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, '');
    ids.push(slug === 'islamabad' || slug === 'rawalpindi' ? DEFAULT_FARE_CITY : slug);
  }
  ids.push(DEFAULT_FARE_CITY);
  return Array.from(new Set(ids));
}

/**
 * The fare table exactly as a human authored it, with no fuel adjustment.
 *
 * For the admin desk, which has to show what was typed into
 * `fareConfig/{cityId}` rather than what today's pump price makes of it.
 * Pricing paths want `loadFareConfigFor`.
 */
export async function loadStoredFareConfigFor(
  point: { lat: number; lng: number } | null | undefined,
): Promise<CityFareConfig | null> {
  for (const id of fareCityIdsFor(point)) {
    try {
      const snap = await db.doc(`fareConfig/${id}`).get();
      if (snap.exists) return snap.data() as CityFareConfig;
    } catch (e) {
      logger.warn('fare config unreadable', { id, e });
    }
  }
  return null;
}

/**
 * The fare table for a trip starting at `point`, with today's fuel price in it,
 * or null when not even the fallback table exists (callers then use their
 * built-in defaults). Never throws.
 *
 * ── Why the fuel adjustment happens HERE ────────────────────────────────────
 * Because this function is the one thing every priced path already has in
 * common: `fare/sharedRideFare.ts`, `trips/enRoute.ts` and `trips/index.ts`
 * all load their rates through it. Applying fuel at this single point means a
 * government price revision reaches solo fares, shared-ride fares, en-route leg
 * fares and offer bounds on the same morning, without any of those callers
 * knowing that fuel exists.
 *
 * The STORED document is never rewritten — see `pricing/fuel.ts`. The card on
 * disk stays the hand-authored one and the adjustment is derived on every read,
 * so switching the engine off restores the original rates exactly rather than
 * leaving whatever the last run happened to write. The cost is one extra
 * Firestore read per cold instance, which `pricing/config.ts` then caches.
 */
export async function loadFareConfigFor(
  point: { lat: number; lng: number } | null | undefined,
): Promise<CityFareConfig | null> {
  const stored = await loadStoredFareConfigFor(point);
  if (!stored) return null;

  try {
    const [pricing, prices] = await Promise.all([loadPricingConfig(), loadFuelPrices()]);
    return withFuelAdjustedRates(stored, prices, pricing.fuel).config;
  } catch (e) {
    // An unreadable fuel price must never stop a ride being priced. The
    // authored card is a perfectly good fare; it is just yesterday's.
    logger.warn('fuel adjustment skipped', e);
    return stored;
  }
}
