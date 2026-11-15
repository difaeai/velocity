/**
 * The detour is measured on the ROAD, not the straight line — and falls back
 * cleanly when the road is unavailable (sharedPools/admit.ts).
 *
 * This is the correction the end-to-end test forced. Measured on OpenStreetMap,
 * a PWD→G-10 rider joining a PWD→F-10 car adds 4.32 km of real road, while the
 * straight line says 0.47 km: nine times out, in the direction that lets a bad
 * detour through. So the only thing worth pinning here is that the road numbers
 * are the ones the verdict is made on, and that a Maps failure degrades to the
 * straight line rather than to a wrong road figure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';

/** Legs the fake Routes service will answer, keyed by rounded coordinates. */
const legs = new Map<string, { distanceM: number; durationSec: number } | null>();
const key = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;

let routingOn = true;

vi.mock('../../lib/routes', () => ({
  serverRoutingConfigured: () => routingOn,
  fetchRouteServerSide: async (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ) => (legs.has(key(a, b)) ? legs.get(key(a, b)) : null),
}));

import { recordAdmission } from '../admit';
import { DEFAULT_POOLING } from '../../domain/poolingSettings';

// A straight west-east line: ~1 km per 0.0108° of longitude at this latitude.
const at = (km: number) => ({ lat: 33.7, lng: 73 + km / 92.6, address: `${km} km` });
const HOST = { uid: 'host', soloFare: 1000, pickup: at(0), dropoff: at(10) };
const JOINER = { uid: 'joiner', soloFare: 900, pickup: at(0), dropoff: at(9) };

/** Road legs for the two orders the car could drive, plus the host alone. */
function roadLegs({ withJoiner, hostAlone }: { withJoiner: number; hostAlone: number }) {
  legs.clear();
  // Both riders board at the same point, so that leg is degenerate and skipped.
  // The car then drives joiner's stop, then the host's.
  legs.set(key(at(0), at(9)), { distanceM: withJoiner * 1000 * 0.9, durationSec: withJoiner * 60 * 0.9 });
  legs.set(key(at(9), at(10)), { distanceM: withJoiner * 1000 * 0.1, durationSec: withJoiner * 60 * 0.1 });
  legs.set(key(at(0), at(10)), { distanceM: hostAlone * 1000, durationSec: hostAlone * 60 });
}

beforeEach(async () => {
  await clearFirestore();
  routingOn = true;
  legs.clear();
});

/** Admit, and wait for the ledger row so one test cannot write into the next. */
async function admit(settings = DEFAULT_POOLING) {
  const a = await recordAdmission(
    { poolId: 'pool-1', uid: JOINER.uid, aboard: [HOST], joiner: JOINER },
    settings,
  );
  await a.recorded;
  return a;
}

describe('the road is what the verdict is made on', () => {
  it('uses the road difference, not the straight line', async () => {
    // The straight line through these stops is ~10 km either way, so a
    // straight-line measurement would call this a ~0 km detour. The road says 4.
    roadLegs({ withJoiner: 14, hostAlone: 10 });
    const a = await admit();
    expect(a.detourSource).toBe('road');
    expect(a.detourKm).toBeCloseTo(4, 2);
    expect(a.detourMin).toBeCloseTo(4, 1);
  });

  it('refuses in live mode on a road detour the straight line would have passed', async () => {
    roadLegs({ withJoiner: 20, hostAlone: 10 }); // 10 km of extra road
    const a = await admit({ ...DEFAULT_POOLING, mode: 'live', maxDetourKm: 5, maxDetourMin: 180 });
    expect(a.detourSource).toBe('road');
    expect(a.ok).toBe(false);
    expect(a.refuse).toBe(true);
    expect(a.reason).toMatch(/10\.0 km is over the 5 km limit/);
    // A refusal always reaches the ledger before the caller throws.
    const rows = await db().collection('poolDecisions').get();
    expect(rows.size).toBe(1);
    expect(rows.docs[0]!.get('detourSource')).toBe('road');
  });

  it('never reports a negative detour when the road is shorter with the joiner', async () => {
    roadLegs({ withJoiner: 9, hostAlone: 10 });
    const a = await admit();
    expect(a.detourKm).toBe(0);
    expect(a.detourMin).toBe(0);
  });
});

describe('falling back when the road is not available', () => {
  it('falls back to the straight line with no Maps key, and says so', async () => {
    routingOn = false;
    const a = await admit();
    expect(a.detourSource).toBe('straight');
    // Same direction, same way: the straight-line detour is near nothing.
    expect(a.detourKm).toBeLessThan(0.2);
  });

  it('falls back whole rather than mixing one road leg with one straight leg', async () => {
    // Only the host-alone route is known; a leg of the shared route is missing,
    // which would otherwise make the car look longer with the joiner than it is.
    legs.clear();
    legs.set(key(at(0), at(10)), { distanceM: 10_000, durationSec: 600 });
    const a = await admit();
    expect(a.detourSource).toBe('straight');
    expect(a.detourKm).toBeLessThan(0.2);
  });

  it('counts a road-measured verdict in the analytics, and a fallback separately', async () => {
    roadLegs({ withJoiner: 12, hostAlone: 10 });
    await admit();
    routingOn = false;
    await admit();
    // Both wrote; one of the two was measured on the road.
    const totals = (await db().doc('analytics/pooling').get()).data()!;
    expect(totals.evaluated).toBe(2);
    expect(totals.roadMeasured).toBe(1);
  });
});
