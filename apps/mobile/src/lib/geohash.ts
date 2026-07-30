/**
 * Standard Base32 geohash encoder.
 *
 * A deliberate mirror of `encodeGeohash` in
 * backend/functions/src/lib/geohash.ts — the presence beacon writes the cell
 * from the handset and the server queries by it, so the two implementations
 * MUST agree character for character or a user simply never appears on anyone's
 * map. Both are the plain textbook algorithm (longitude bit first, alternating),
 * which is also what geofire-common produces, so all three interoperate.
 *
 * If you change one, change the other, and check the fixtures in
 * __tests__/geohash.test.ts still pass.
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
      else            { bits = (bits << 1);     maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { bits = (bits << 1) | 1; minLat = mid; }
      else            { bits = (bits << 1);     maxLat = mid; }
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
