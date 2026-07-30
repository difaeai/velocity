/**
 * "Find your Customers" — which geohash cells a proximity query has to look in.
 *
 * Kept separate from nearby.ts (and free of any Firebase import) because this is
 * the one piece of the feature that is pure geometry and the one piece that is
 * silently wrong if it is off: a cell we forget to query is an advertiser paying
 * for a radius that quietly does not reach part of itself.
 */

/** Geohash precision used for ad centres. Cell size ≈ 4.9 km × 4.9 km. */
export const GEO_PRECISION = 5;

/** Grid spacing for the candidate sweep, in km. MUST stay under the cell size. */
const SWEEP_STEP_KM = 2;

/** Firestore's hard cap on values in an `in` filter. */
const MAX_IN_VALUES = 30;

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Base32 geohash encoder. Duplicated from lib/geohash rather than imported so
 * this module stays dependency-free and testable on its own; the algorithm is
 * fixed by the geohash spec and cannot drift.
 */
export function encodeCell(lat: number, lng: number, precision = GEO_PRECISION): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bits = 0;
  let bitCount = 0;
  let isEven = true;

  while (hash.length < precision) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        bits = (bits << 1) | 1;
        minLng = mid;
      } else {
        bits = bits << 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        bits = (bits << 1) | 1;
        minLat = mid;
      } else {
        bits = bits << 1;
        maxLat = mid;
      }
    }
    isEven = !isEven;
    if (++bitCount === 5) {
      hash += BASE32[bits];
      bits = 0;
      bitCount = 0;
    }
  }
  return hash;
}

/**
 * Every geohash cell that could hold an ad centre within `radiusKm` of a point.
 *
 * Deliberately NOT the shared `neighborGeohashes()` helper. That one offsets by
 * less than one cell width, so from a point near a cell edge the far side of a
 * 5 km radius lands two cells away and never gets queried — a rider standing
 * inside a paid radius who hears nothing. This sweeps the region on a grid finer
 * than the cell size instead, so no cell overlapping the disc can fall between
 * two samples.
 *
 * At a 2 km step over a 5 km radius this returns roughly 4–9 distinct cells,
 * comfortably inside Firestore's 30-value `in` limit.
 */
export function candidateCells(lat: number, lng: number, radiusKm: number): string[] {
  const latPerKm = 1 / 110.574;
  // Longitude degrees shrink towards the poles. The clamp keeps the divisor sane
  // at extreme latitudes, where a 5 km sweep would otherwise span the globe.
  const lngPerKm = 1 / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const steps = Math.ceil(radiusKm / SWEEP_STEP_KM);

  const cells = new Set<string>([encodeCell(lat, lng)]);
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      const dLatKm = i * SWEEP_STEP_KM;
      const dLngKm = j * SWEEP_STEP_KM;
      // Drop the square's corners: they lie outside the disc plus one step of
      // slack, so no ad in range can sit in a cell only they would reach.
      if (Math.hypot(dLatKm, dLngKm) > radiusKm + SWEEP_STEP_KM) continue;
      const pLat = Math.max(-90, Math.min(90, lat + dLatKm * latPerKm));
      const pLng = ((lng + dLngKm * lngPerKm + 540) % 360) - 180;
      cells.add(encodeCell(pLat, pLng));
    }
  }
  return [...cells].slice(0, MAX_IN_VALUES);
}
