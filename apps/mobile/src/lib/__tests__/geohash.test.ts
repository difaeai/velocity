import { describe, expect, it } from 'vitest';

import { encodeGeohash } from '../geohash';

/**
 * These fixtures are the contract with the backend. The presence beacon writes
 * a cell from the handset and `getNearbyActivity` looks users up by it, so an
 * encoder that drifts from the server's (or from geofire-common's) makes people
 * silently invisible on the map rather than throwing anything.
 */
describe('encodeGeohash', () => {
  it('matches the canonical worked example', () => {
    // The textbook geohash of 57.64911, 10.40744.
    expect(encodeGeohash(57.64911, 10.40744, 11)) .toBe('u4pruydqqvj');
  });

  it('is prefix-stable across precisions', () => {
    const full = encodeGeohash(57.64911, 10.40744, 11);
    for (let p = 1; p <= 11; p += 1) {
      expect(encodeGeohash(57.64911, 10.40744, p)).toBe(full.slice(0, p));
    }
  });

  it('places the origin and the poles where they belong', () => {
    expect(encodeGeohash(0, 0, 5)).toBe('s0000');
    expect(encodeGeohash(90, 180, 3)).toBe('zzz');
    expect(encodeGeohash(-90, -180, 3)).toBe('000');
  });

  it('puts two points a few hundred metres apart in the same precision-5 cell', () => {
    // F-7 Islamabad and a point ~400 m north of it.
    expect(encodeGeohash(33.7100, 73.0550, 5)).toBe(encodeGeohash(33.7136, 73.0550, 5));
  });

  it('separates cities into different precision-5 cells', () => {
    expect(encodeGeohash(33.7100, 73.0550, 5)).not.toBe(encodeGeohash(24.8607, 67.0011, 5));
  });
});
