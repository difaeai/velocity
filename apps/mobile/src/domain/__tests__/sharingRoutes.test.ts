import { describe, expect, it } from 'vitest';

import { nearestSpotName, pickupFit, routeGap, sameRoute, SHARING_ROUTES } from '../sharingRoutes';
import { distanceMeters } from '../../lib/geo';

const km = (r: (typeof SHARING_ROUTES)[number]) =>
  distanceMeters(r.pickup.lat, r.pickup.lng, r.dropoff.lat, r.dropoff.lng) / 1000;

describe('SHARING_ROUTES', () => {
  it('covers the twin cities both ways, every route a real everyday distance', () => {
    expect(SHARING_ROUTES.length).toBeGreaterThan(500);
    expect(new Set(SHARING_ROUTES.map((r) => r.id)).size).toBe(SHARING_ROUTES.length);
    for (const r of SHARING_ROUTES) {
      expect(km(r)).toBeGreaterThanOrEqual(3);
      expect(km(r)).toBeLessThanOrEqual(35);
    }
    const ids = new Set(SHARING_ROUTES.map((r) => r.id));
    expect(ids.has('route:G-9>NUST')).toBe(true);
    expect(ids.has('route:NUST>G-9')).toBe(true);
    // Two homes are not an everyday route.
    expect(ids.has('route:G-9>G-13')).toBe(false);
  });
});

describe('routeGap', () => {
  it('ranks the routes nearest the rider’s own first', () => {
    // A house near Bahria Enclave to the Blue Area.
    const from = { lat: 33.689, lng: 73.21 };
    const to = { lat: 33.712, lng: 73.062 };
    const [first, second] = [...SHARING_ROUTES].sort((a, b) => routeGap(from, to, a) - routeGap(from, to, b));
    expect(first!.id).toBe('route:Bahria Enclave>Blue Area');
    expect(routeGap(from, to, second!)).toBeGreaterThanOrEqual(routeGap(from, to, first!));
  });
});

describe('pickupFit', () => {
  it('puts the short trips from the rider’s own area before the far ones', () => {
    // A house in PWD Housing Society.
    const from = { lat: 33.5705, lng: 73.1452 };
    const ranked = [...SHARING_ROUTES].sort((a, b) => pickupFit(from, a) - pickupFit(from, b));
    const top = ranked.slice(0, 10);
    expect(top.every((r) => distanceMeters(from.lat, from.lng, r.pickup.lat, r.pickup.lng) < 3000)).toBe(true);
    expect(top.some((r) => r.label === 'NUST')).toBe(false);
    expect(km(top[0]!)).toBeLessThan(10);
  });
});

describe('nearestSpotName', () => {
  it('names an address-only pickup after the area it is in', () => {
    expect(nearestSpotName({ lat: 33.5705, lng: 73.1452 })).toBe('PWD');
    expect(nearestSpotName({ lat: 31.52, lng: 74.358 })).toBeNull();
  });
});

describe('sameRoute', () => {
  it('matches the same way only', () => {
    const r = SHARING_ROUTES.find((x) => x.id === 'route:G-9>NUST')!;
    expect(sameRoute(r, { pickup: r.pickup, dropoff: r.dropoff })).toBe(true);
    expect(sameRoute(r, { pickup: r.dropoff, dropoff: r.pickup })).toBe(false);
  });
});
