/**
 * Minimal geohash encoder — Base32, configurable precision.
 * Precision 6 ≈ 1.2 km × 0.6 km cells, good for city-level proximity filtering.
 */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let bits = 0, bitCount = 0, isEven = true;

  while (hash.length < precision) {
    if (isEven) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { bits = (bits << 1) | 1; minLng = mid; }
      else             { bits = (bits << 1);     maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; minLat = mid; }
      else             { bits = (bits << 1);     maxLat = mid; }
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
 * Returns the 8 neighbouring geohash cells (including the center) at the given
 * precision. Used for driver-side Firestore queries: the driver's geohash must
 * be in this set for them to receive the request.
 */
export function neighborGeohashes(lat: number, lng: number, precision = 6): string[] {
  // Step sizes for this precision (approximate)
  const latStep = 180 / Math.pow(2, precision * 2.5);
  const lngStep = 360 / Math.pow(2, precision * 2.5);

  const hashes = new Set<string>();
  for (const dLat of [-latStep, 0, latStep]) {
    for (const dLng of [-lngStep, 0, lngStep]) {
      const clamped = Math.max(-90, Math.min(90, lat + dLat));
      const wrappedLng = ((lng + dLng + 180) % 360) - 180;
      hashes.add(encodeGeohash(clamped, wrappedLng, precision));
    }
  }
  return [...hashes];
}
