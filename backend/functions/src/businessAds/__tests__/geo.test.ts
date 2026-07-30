/**
 * The proximity sweep must never miss a cell.
 *
 * This is the test that matters for "Find your Customers": an advertiser buys a
 * radius, and if the candidate cell set omits one cell, riders in that slice of
 * their own paid radius silently never hear from them. So rather than asserting
 * a cell count, the test walks the whole disc and checks every sampled point's
 * cell is one we would have queried.
 */
import { describe, expect, it } from 'vitest';

import { candidateCells, encodeCell } from '../geo';

/** Cities across Pakistan, so the longitude scaling is exercised at real lats. */
const PLACES: [string, number, number][] = [
  ['Lahore', 31.5204, 74.3587],
  ['Karachi', 24.8607, 67.0011],
  ['Islamabad', 33.6844, 73.0479],
  ['Gilgit', 35.9208, 74.3144],
  ['Gwadar', 25.1264, 62.3225],
];

describe('candidateCells', () => {
  it.each(PLACES)('covers the whole 5 km disc around %s', (_name, lat, lng) => {
    const cells = new Set(candidateCells(lat, lng, 5));
    const missed: string[] = [];

    for (let bearing = 0; bearing < 360; bearing += 5) {
      for (let r = 0.25; r <= 5; r += 0.25) {
        const rad = (bearing * Math.PI) / 180;
        const pLat = lat + (r * Math.cos(rad)) / 110.574;
        const pLng = lng + (r * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
        const cell = encodeCell(pLat, pLng);
        if (!cells.has(cell)) missed.push(`${r.toFixed(2)}km@${bearing}° → ${cell}`);
      }
    }

    expect(missed.slice(0, 5)).toEqual([]);
  });

  it.each(PLACES)('covers the whole 3 km disc around %s', (_name, lat, lng) => {
    const cells = new Set(candidateCells(lat, lng, 3));
    for (let bearing = 0; bearing < 360; bearing += 5) {
      for (let r = 0.25; r <= 3; r += 0.25) {
        const rad = (bearing * Math.PI) / 180;
        const pLat = lat + (r * Math.cos(rad)) / 110.574;
        const pLng = lng + (r * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
        expect(cells.has(encodeCell(pLat, pLng))).toBe(true);
      }
    }
  });

  it('stays inside the Firestore `in` limit', () => {
    for (const [, lat, lng] of PLACES) {
      expect(candidateCells(lat, lng, 5).length).toBeLessThanOrEqual(30);
    }
  });

  it('always includes the caller’s own cell', () => {
    for (const [, lat, lng] of PLACES) {
      expect(candidateCells(lat, lng, 1)).toContain(encodeCell(lat, lng));
    }
  });

  it('matches the shared geohash encoder, so stored centres line up', async () => {
    const { encodeGeohash } = await import('../../lib/geohash');
    for (const [, lat, lng] of PLACES) {
      expect(encodeCell(lat, lng)).toBe(encodeGeohash(lat, lng, 5));
    }
  });
});
