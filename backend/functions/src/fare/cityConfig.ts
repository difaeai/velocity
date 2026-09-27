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
 * The fare table for a trip starting at `point`, or null when not even the
 * fallback table exists (callers then use their built-in defaults). Never throws.
 */
export async function loadFareConfigFor(
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
