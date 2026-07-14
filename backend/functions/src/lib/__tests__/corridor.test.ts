/**
 * Corridor geometry — the maths every en-route match rests on.
 *
 * These are pure unit tests: no emulator, no Firestore. If the projection is
 * wrong by 200 m the feature silently offers drivers rides that are not on their
 * way, so the numbers here are checked against hand-computed distances rather
 * than against the implementation's own output.
 */
import { describe, it, expect } from 'vitest';

import {
  buildCorridor,
  decodePolyline,
  haversineM,
  projectToCorridor,
  validateRoutePolyline,
  MAX_POLYLINE_POINTS,
} from '../corridor';

// A straight west→east line at Islamabad's latitude, one point every ~0.01°.
// 0.01° of longitude here is ~926 m, which gives us a route with known geometry.
const LAT = 33.6938;
const LINE = [
  { lat: LAT, lng: 72.99 },
  { lat: LAT, lng: 73.00 },
  { lat: LAT, lng: 73.01 },
  { lat: LAT, lng: 73.02 },
  { lat: LAT, lng: 73.03 },
];

describe('decodePolyline', () => {
  it('decodes Google\'s reference polyline exactly', () => {
    // The canonical example from Google's polyline algorithm documentation.
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0]!.lat).toBeCloseTo(38.5, 5);
    expect(pts[0]!.lng).toBeCloseTo(-120.2, 5);
    expect(pts[1]!.lat).toBeCloseTo(40.7, 5);
    expect(pts[1]!.lng).toBeCloseTo(-120.95, 5);
    expect(pts[2]!.lat).toBeCloseTo(43.252, 5);
    expect(pts[2]!.lng).toBeCloseTo(-126.453, 5);
  });

  it('returns what it has rather than throwing on truncated input', () => {
    expect(() => decodePolyline('_p~iF~ps|U_ulL')).not.toThrow();
  });

  it('returns nothing for an empty string', () => {
    expect(decodePolyline('')).toEqual([]);
  });
});

describe('buildCorridor', () => {
  it('accumulates arc length monotonically from zero', () => {
    const c = buildCorridor(LINE);
    expect(c.cum[0]).toBe(0);
    for (let i = 1; i < c.cum.length; i += 1) {
      expect(c.cum[i]!).toBeGreaterThan(c.cum[i - 1]!);
    }
    expect(c.lengthM).toBe(c.cum[c.cum.length - 1]);
  });

  it('measures total length as the sum of its segments', () => {
    const c = buildCorridor(LINE);
    let sum = 0;
    for (let i = 1; i < LINE.length; i += 1) {
      sum += haversineM(LINE[i - 1]!.lat, LINE[i - 1]!.lng, LINE[i]!.lat, LINE[i]!.lng);
    }
    expect(c.lengthM).toBeCloseTo(sum, 6);
  });

  it('refuses a degenerate one-point route', () => {
    expect(() => buildCorridor([{ lat: LAT, lng: 73 }])).toThrow();
  });
});

describe('projectToCorridor', () => {
  const c = buildCorridor(LINE);

  it('puts a point that sits on a vertex at that vertex, with no offset', () => {
    const p = projectToCorridor(c, LINE[2]!);
    expect(p.offsetM).toBeLessThan(0.5);
    expect(p.alongM).toBeCloseTo(c.cum[2]!, 1);
  });

  it('measures perpendicular offset for a point beside the route', () => {
    // 0.005° of latitude north of the line ≈ 556 m.
    const expected = haversineM(LAT, 73.015, LAT + 0.005, 73.015);
    const p = projectToCorridor(c, { lat: LAT + 0.005, lng: 73.015 });
    expect(p.offsetM).toBeCloseTo(expected, 0);
    // It should still land halfway between vertices 2 and 3 along the route.
    expect(p.alongM).toBeGreaterThan(c.cum[2]!);
    expect(p.alongM).toBeLessThan(c.cum[3]!);
  });

  it('clamps a point before the start to the origin', () => {
    const p = projectToCorridor(c, { lat: LAT, lng: 72.95 });
    expect(p.alongM).toBeCloseTo(0, 1);
    // The offset is the real distance back to the start, not zero.
    expect(p.offsetM).toBeCloseTo(haversineM(LAT, 72.95, LAT, 72.99), 0);
  });

  it('clamps a point past the end to the destination', () => {
    const p = projectToCorridor(c, { lat: LAT, lng: 73.08 });
    expect(p.alongM).toBeCloseTo(c.lengthM, 1);
  });

  it('never reports an arc position outside the route', () => {
    for (const lng of [72.9, 72.995, 73.017, 73.03, 73.2]) {
      for (const dLat of [-0.02, 0, 0.02]) {
        const p = projectToCorridor(c, { lat: LAT + dLat, lng });
        expect(p.alongM).toBeGreaterThanOrEqual(0);
        expect(p.alongM).toBeLessThanOrEqual(c.lengthM + 0.001);
      }
    }
  });

  it('projects onto the nearest leg of a route that doubles back', () => {
    // An L: east along the line, then sharply north. A point near the top of the
    // upstroke must project onto the upstroke, not onto the eastward leg below it.
    const L = buildCorridor([
      { lat: LAT, lng: 72.99 },
      { lat: LAT, lng: 73.02 },
      { lat: LAT + 0.03, lng: 73.02 },
    ]);
    const p = projectToCorridor(L, { lat: LAT + 0.025, lng: 73.021 });
    expect(p.offsetM).toBeLessThan(200);
    expect(p.alongM).toBeGreaterThan(L.cum[1]!);
  });
});

describe('validateRoutePolyline', () => {
  const origin = LINE[0]!;
  const destination = LINE[LINE.length - 1]!;

  it('accepts a route that starts and ends where it says it does', () => {
    const res = validateRoutePolyline(LINE, origin, destination);
    expect(res.ok).toBe(true);
  });

  it('rejects a route that does not start at the origin', () => {
    const res = validateRoutePolyline(LINE, { lat: LAT + 0.2, lng: 72.99 }, destination);
    expect(res).toEqual({ ok: false, reason: 'origin_mismatch' });
  });

  it('rejects a route that does not end at the destination', () => {
    const res = validateRoutePolyline(LINE, origin, { lat: LAT, lng: 73.2 });
    expect(res).toEqual({ ok: false, reason: 'destination_mismatch' });
  });

  it('rejects a wildly padded route between the same two points', () => {
    // Same endpoints, but the "route" detours ~40 km north and back — a driver
    // bending the corridor to sweep up rides nowhere near their way.
    const padded = [
      origin,
      { lat: LAT + 0.35, lng: 73.00 },
      { lat: LAT + 0.35, lng: 73.02 },
      destination,
    ];
    const res = validateRoutePolyline(padded, origin, destination);
    expect(res).toEqual({ ok: false, reason: 'implausible_length' });
  });

  it('still accepts a genuinely winding city route', () => {
    // A real road route is longer than the straight line — that must be fine.
    const winding = [
      origin,
      { lat: LAT + 0.01, lng: 73.00 },
      { lat: LAT - 0.01, lng: 73.01 },
      { lat: LAT + 0.01, lng: 73.02 },
      destination,
    ];
    const res = validateRoutePolyline(winding, origin, destination);
    expect(res.ok).toBe(true);
  });

  it('rejects a polyline with too few points', () => {
    const res = validateRoutePolyline([origin], origin, destination);
    expect(res).toEqual({ ok: false, reason: 'too_few_points' });
  });

  it('rejects an oversized polyline blob', () => {
    const huge = Array.from({ length: MAX_POLYLINE_POINTS + 1 }, (_, i) => ({
      lat: LAT,
      lng: 72.99 + i * 1e-6,
    }));
    const res = validateRoutePolyline(huge, origin, destination);
    expect(res).toEqual({ ok: false, reason: 'too_many_points' });
  });
});
