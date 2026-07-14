/**
 * The four gates that decide whether a rider is on the driver's way.
 *
 * Real Islamabad geography: the driver runs F-10 → F-6 along the Kashmir
 * Highway / Jinnah Avenue corridor, and riders are placed at sectors that
 * genuinely do and do not lie on it.
 */
import { describe, it, expect } from 'vitest';

import { buildCorridor } from '../corridor';
import {
  checkCorridorFit,
  DEFAULT_CORRIDOR_RADIUS_M,
  DEFAULT_DEST_RADIUS_M,
  MIN_RIDE_SPAN_M,
} from '../enRouteMatch';

const SETTINGS = {
  corridorRadiusM: DEFAULT_CORRIDOR_RADIUS_M, // 1 km
  destRadiusM: DEFAULT_DEST_RADIUS_M,         // 4 km
};

// F-10 Markaz → F-9 → F-8 → Blue Area → F-6 Markaz, west to east.
const F10 = { lat: 33.6938, lng: 72.9989 };
const F9  = { lat: 33.6960, lng: 73.0270 };
const F8  = { lat: 33.7050, lng: 73.0300 };
const BLUE_AREA = { lat: 33.7104, lng: 73.0551 };
const F6  = { lat: 33.7196, lng: 73.0724 };
/** ~6.3 km beyond F-6 — forward along the route, but well past where we stop. */
const BHARA_KAHU = { lat: 33.7500, lng: 73.1300 };

const ROUTE = buildCorridor([F10, F9, F8, BLUE_AREA, F6]);

describe('gate 1 — the pickup has to be on the way', () => {
  it('accepts a rider waiting in F-9, right on the driver\'s path', () => {
    const res = checkCorridorFit(ROUTE, F6, F9, F6, SETTINGS);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fit.pickupOffsetM).toBeLessThan(DEFAULT_CORRIDOR_RADIUS_M);
      expect(res.fit.boardM).toBeGreaterThan(0);
    }
  });

  it('rejects a rider in Bahria Town, nowhere near the corridor', () => {
    const bahria = { lat: 33.5215, lng: 73.0952 }; // ~22 km south of the route
    const res = checkCorridorFit(ROUTE, F6, bahria, F6, SETTINGS);
    expect(res).toEqual({ ok: false, reason: 'pickup_off_route' });
  });

  it('rejects a pickup just outside the 1 km corridor', () => {
    // ~1.7 km SOUTH of F-9. It has to be south: the route turns north at F-9 on
    // its way to F-8, so a point north of F-9 is nearer the road than it looks.
    const res = checkCorridorFit(ROUTE, F6, { lat: F9.lat - 0.0155, lng: F9.lng }, F6, SETTINGS);
    expect(res).toEqual({ ok: false, reason: 'pickup_off_route' });
  });
});

describe('gate 2 — the drop-off has to be near where the driver is already ending up', () => {
  it('accepts a drop-off a couple of km from F-6', () => {
    const nearF6 = { lat: 33.7300, lng: 73.0800 }; // ~1.5 km from F-6
    const res = checkCorridorFit(ROUTE, F6, F9, nearF6, SETTINGS);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fit.dropToDestM).toBeLessThan(DEFAULT_DEST_RADIUS_M);
  });

  it('rejects a drop-off in Bhara Kahu, 6 km past the driver\'s destination', () => {
    const res = checkCorridorFit(ROUTE, F6, F9, BHARA_KAHU, SETTINGS);
    expect(res).toEqual({ ok: false, reason: 'dropoff_too_far' });
  });

  it('respects an admin-widened drop allowance', () => {
    // Same rider, same route — only the admin's 4 km allowance has been raised.
    const res = checkCorridorFit(ROUTE, F6, F9, BHARA_KAHU, {
      corridorRadiusM: DEFAULT_CORRIDOR_RADIUS_M,
      destRadiusM: 15_000,
    });
    expect(res.ok).toBe(true);
  });
});

describe('gate 3 — forward only', () => {
  it('rejects a rider at F-8 who wants to go back to F-10', () => {
    // F-10 is the route's own origin, so it is within 4 km of nothing — but the
    // giveaway is that they alight before they board.
    const res = checkCorridorFit(ROUTE, F10, F8, F10, {
      corridorRadiusM: DEFAULT_CORRIDOR_RADIUS_M,
      destRadiusM: 20_000, // deliberately generous, so gate 2 cannot mask gate 3
    });
    expect(res).toEqual({ ok: false, reason: 'wrong_direction' });
  });

  it('rejects a ride too short to be worth a stop', () => {
    const almostF9 = { lat: F9.lat + 0.0005, lng: F9.lng + 0.0005 };
    const res = checkCorridorFit(ROUTE, F6, F9, almostF9, {
      corridorRadiusM: DEFAULT_CORRIDOR_RADIUS_M,
      destRadiusM: 20_000,
    });
    expect(res).toEqual({ ok: false, reason: 'wrong_direction' });
  });

  it('accepts a forward hop of more than the minimum span', () => {
    const res = checkCorridorFit(ROUTE, F6, F9, BLUE_AREA, {
      corridorRadiusM: DEFAULT_CORRIDOR_RADIUS_M,
      destRadiusM: 20_000,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fit.alightM - res.fit.boardM).toBeGreaterThan(MIN_RIDE_SPAN_M);
  });
});

describe('gate 4 — not behind the car', () => {
  it('hides an F-9 pickup once the driver has already reached Blue Area', () => {
    const blueAreaAlong = ROUTE.cum[3]!;
    const res = checkCorridorFit(ROUTE, F6, F9, F6, SETTINGS, blueAreaAlong);
    expect(res).toEqual({ ok: false, reason: 'behind_driver' });
  });

  it('still shows an F-9 pickup while the driver is only at F-10', () => {
    const res = checkCorridorFit(ROUTE, F6, F9, F6, SETTINGS, 0);
    expect(res.ok).toBe(true);
  });

  it('shows the whole route when the driver has not set off yet', () => {
    const res = checkCorridorFit(ROUTE, F6, F9, F6, SETTINGS, null);
    expect(res.ok).toBe(true);
  });
});

describe('the fit it hands back', () => {
  it('reports the detour as the round trip off the route at both ends', () => {
    // ~600 m north of the F-8 leg, dropping at F-6 itself (no detour there).
    const offRoute = { lat: F8.lat + 0.0054, lng: F8.lng };
    const res = checkCorridorFit(ROUTE, F6, offRoute, F6, SETTINGS);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fit.detourM).toBeCloseTo(2 * res.fit.pickupOffsetM + 2 * res.fit.dropoffOffsetM, 6);
      expect(res.fit.pickupOffsetM).toBeGreaterThan(400);
      expect(res.fit.dropoffOffsetM).toBeLessThan(50);
    }
  });

  it('orders board before alight along the route', () => {
    const res = checkCorridorFit(ROUTE, F6, F9, BLUE_AREA, SETTINGS);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.fit.boardM).toBeLessThan(res.fit.alightM);
  });
});
