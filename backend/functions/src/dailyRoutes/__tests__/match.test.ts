/**
 * Daily-route ↔ public-pool matching (pure logic, no emulator).
 *
 * A route matches a pool only when the pool's pickup AND drop-off both fall
 * inside the route's radius, the pool opens near the route's time, and the
 * route's alerts are on. `minuteGap` wraps around midnight so a 23:50 route and
 * a 00:10 pool are 20 minutes apart, not 1420.
 */
import { describe, it, expect } from 'vitest';
import { routeMatchesPool, minuteGap } from '../index';

// F-8 Markaz → Blue Area (Islamabad), a ~2 km commute.
const routePickup  = { lat: 33.700, lng: 73.050, address: 'F-8 Markaz' };
const routeDropoff = { lat: 33.720, lng: 73.070, address: 'Blue Area' };

const baseRoute = {
  pickup: routePickup,
  dropoff: routeDropoff,
  radiusKm: 3,
  time: '08:30', // 510 minutes
  notify: true,
};

// A pool that hugs both ends of the route.
const poolPickupClose  = { lat: 33.705, lng: 73.052 };
const poolDropoffClose = { lat: 33.722, lng: 73.072 };
const near = (nowMinutes: number) => ({ pickup: poolPickupClose, dropoff: poolDropoffClose, nowMinutes });

describe('routeMatchesPool', () => {
  it('matches when pickup, drop-off and time all line up', () => {
    expect(routeMatchesPool(baseRoute, near(540))).toBe(true); // 09:00, 30 min from 08:30
  });

  it('rejects a pool that starts outside the radius', () => {
    const pool = { pickup: { lat: 33.85, lng: 73.20 }, dropoff: poolDropoffClose, nowMinutes: 540 };
    expect(routeMatchesPool(baseRoute, pool)).toBe(false);
  });

  it('rejects a pool that ends outside the radius', () => {
    const pool = { pickup: poolPickupClose, dropoff: { lat: 33.60, lng: 72.90 }, nowMinutes: 540 };
    expect(routeMatchesPool(baseRoute, pool)).toBe(false);
  });

  it('rejects a pool opened well outside the time window', () => {
    expect(routeMatchesPool(baseRoute, near(660))).toBe(false); // 11:00, 150 min away
  });

  it('respects the alerts-off switch', () => {
    expect(routeMatchesPool({ ...baseRoute, notify: false }, near(540))).toBe(false);
  });

  it('matches at any time when the route has no time set', () => {
    const timeless = { ...baseRoute, time: undefined };
    expect(routeMatchesPool(timeless, near(660))).toBe(true);
  });

  it('uses the default radius when none is stored', () => {
    const noRadius = { ...baseRoute, radiusKm: undefined };
    expect(routeMatchesPool(noRadius, near(540))).toBe(true);
  });
});

describe('minuteGap', () => {
  it('is the direct distance within a day', () => {
    expect(minuteGap(510, 540)).toBe(30);
  });

  it('wraps around midnight', () => {
    expect(minuteGap(23 * 60 + 50, 10)).toBe(20); // 23:50 ↔ 00:10
  });
});
