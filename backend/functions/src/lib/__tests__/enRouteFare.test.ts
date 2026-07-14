/**
 * The leg-split, and the four invariants it exists to guarantee.
 *
 * Every en-route pickup moves real money between a passenger and a driver, so
 * each property is pinned here rather than left to reasoning:
 *
 *   1. no rider ever pays more than riding alone
 *   2. the driver's gross never falls for driving the same route
 *   3. another rider joining never raises your fare
 *   4. a destination-pool rider still gets the 60/40/35% they were promised
 *
 * The "danger case" test is the one that decided the design: it is the exact
 * scenario where a flat per-seat tier quietly takes hundreds of rupees off the
 * driver, and the leg-split does not.
 */
import { describe, it, expect } from 'vitest';

import { splitEnRouteFares, driverIsNotWorseOff, RiderSegment, MIN_PER_KM } from '../enRouteFare';
import { calculateFare, DEFAULT_ISLAMABAD_RAWALPINDI } from '../../fare/fareEngine';
import { poolPerSeatFare } from '../../domain/fares';

const CFG = DEFAULT_ISLAMABAD_RAWALPINDI;
const MINI = CFG.categories.mini;

/** Shorthand: split a car full of riders at the mini rate. */
const split = (riders: RiderSegment[]) => splitEnRouteFares(riders, CFG, 'mini');

/** The same solo fare the server quotes for a distance (haversine + 3.5 min/km). */
function solo(distanceKm: number): number {
  return calculateFare(DEFAULT_ISLAMABAD_RAWALPINDI, {
    category: 'mini',
    distanceKm,
    durationMin: distanceKm * MIN_PER_KM,
  }).recommendedFare;
}

/** A rider standing exactly on the route (no detour), boarding and alighting at metres. */
function rider(uid: string, boardM: number, alightM: number, tierCap: number | null = null): RiderSegment {
  return {
    uid,
    boardM,
    alightM,
    pickupOffsetM: 0,
    dropoffOffsetM: 0,
    soloFare: solo((alightM - boardM) / 1000),
    tierCap,
  };
}

describe('splitEnRouteFares — the worked example', () => {
  // Ali rides F-10 → F-6, 8 km. B is picked up 3 km in and rides to the same end.
  const ali = rider('ali', 0, 8000);
  const b = rider('b', 3000, 8000);

  it('bills each rider the distance they are personally responsible for', () => {
    const { fares, billableKm } = split([ali, b]);

    // Leg 0–3 km: Ali alone      → 3 km, all his.
    // Leg 3–8 km: Ali and B      → 5 km, 2.5 km each.
    expect(billableKm.ali).toBeCloseTo(5.5, 6);
    expect(billableKm.b).toBeCloseTo(2.5, 6);

    // Those distances, priced by the same engine as any other fare.
    expect(fares.ali).toBe(solo(5.5));
    expect(fares.b).toBe(solo(2.5));
  });

  it('pays the driver more than the solo trip they were already making', () => {
    const { driverGross } = split([ali, b]);
    const aliAlone = split([ali]).driverGross;
    expect(aliAlone).toBe(ali.soloFare); // one rider, whole route → the solo fare
    expect(driverGross).toBeGreaterThan(aliAlone);
  });

  it('leaves both riders better off than riding alone', () => {
    const { fares } = split([ali, b]);
    expect(fares.ali!).toBeLessThan(ali.soloFare);
    expect(fares.b!).toBeLessThan(b.soloFare);
  });
});

describe('INVARIANT 1 — nobody ever pays more than their own solo fare', () => {
  it('holds across a spread of overlapping segments', () => {
    const riders = [
      rider('a', 0, 20000),
      rider('b', 1000, 5000),
      rider('c', 4000, 19000),
      rider('d', 15000, 20000),
    ];
    const { fares } = split(riders);
    for (const r of riders) {
      expect(fares[r.uid]!).toBeLessThanOrEqual(r.soloFare);
    }
  });

  it('caps a rider even when a doctored polyline inflates their leg', () => {
    // A client claiming a 60 km route for what is really a 5 km ride. The share
    // maths would bill a fortune; the solo-fare cap is what stops it.
    const honest = solo(5);
    const inflated: RiderSegment = {
      uid: 'victim',
      boardM: 0,
      alightM: 60000,
      pickupOffsetM: 0,
      dropoffOffsetM: 0,
      soloFare: honest, // server-computed from the real pickup → drop-off
      tierCap: null,
    };
    const { fares } = split([inflated]);
    expect(fares.victim).toBeLessThanOrEqual(honest);
  });
});

describe('INVARIANT 2 — the driver is never worse off', () => {
  it('survives the danger case: a 500 m hop joining a 30 km trip', () => {
    // This is precisely where a flat 60% per-seat tier robs the driver.
    const longRider = rider('long', 0, 30000);
    const shortHop = rider('hop', 10000, 10500);

    const before = split([longRider]).driverGross;
    const after = split([longRider, shortHop]).driverGross;

    expect(driverIsNotWorseOff(before, after)).toBe(true);
    expect(after).toBeGreaterThan(before);

    // For contrast — what a flat tier would have done to the same driver.
    const tierGross =
      poolPerSeatFare(longRider.soloFare, 2) + poolPerSeatFare(shortHop.soloFare, 2);
    expect(tierGross).toBeLessThan(before);
  });

  it('holds however many riders pile in', () => {
    const base = [rider('host', 0, 15000)];
    let gross = split(base).driverGross;

    const extras = [rider('x', 2000, 9000), rider('y', 5000, 15000), rider('z', 8000, 14000)];
    const riders = [...base];
    for (const extra of extras) {
      riders.push(extra);
      const next = split(riders).driverGross;
      expect(driverIsNotWorseOff(gross, next)).toBe(true);
      gross = next;
    }
  });
});

describe('INVARIANT 3 — a rider joining never raises anyone else\'s fare', () => {
  it('only ever lowers the fares of the people already aboard', () => {
    const host = rider('host', 0, 12000);
    const first = rider('first', 2000, 12000);
    const second = rider('second', 4000, 11000);

    const alone = split([host]).fares;
    const pair = split([host, first]).fares;
    const trio = split([host, first, second]).fares;

    expect(pair.host!).toBeLessThanOrEqual(alone.host!);
    expect(trio.host!).toBeLessThanOrEqual(pair.host!);
    expect(trio.first!).toBeLessThanOrEqual(pair.first!);
  });
});

describe('INVARIANT 4 — the advertised pool tier is still honoured', () => {
  it('never charges a destination-pool rider above their 60% tier', () => {
    const soloFare = solo(8);
    const tier = poolPerSeatFare(soloFare, 2);

    // Host and a share-code joiner riding the same route end to end.
    const host = rider('host', 0, 8000, tier);
    const joiner = rider('joiner', 0, 8000, tier);

    const { fares } = split([host, joiner]);
    expect(fares.host).toBeLessThanOrEqual(tier);
    expect(fares.joiner).toBeLessThanOrEqual(tier);
  });

  it('gives a tiered rider the leg-split price when that is the cheaper of the two', () => {
    // A generous (high) cap should not stop the leg maths from undercutting it.
    const host = rider('host', 0, 8000, 99999);
    const other = rider('other', 0, 8000, 99999);
    const { fares } = split([host, other]);
    const uncapped = split([rider('host', 0, 8000), rider('other', 0, 8000)]);
    expect(fares.host).toBe(uncapped.fares.host);
  });
});

describe('detour cost', () => {
  it('bills the detour to the rider who caused it, and to nobody else', () => {
    const onRoute = rider('on', 0, 10000);
    const offRoute: RiderSegment = {
      ...rider('off', 3000, 10000),
      // 3 km off the route at the drop-off end — inside the 4 km allowance.
      dropoffOffsetM: 3000,
    };

    const withDetour = split([onRoute, offRoute]).fares;
    const without = split([onRoute, rider('off', 3000, 10000)]).fares;

    // The rider who is 3 km off the route pays more than they would standing on it…
    expect(withDetour.off!).toBeGreaterThan(without.off!);
    // …and the rider who is on the route pays exactly the same either way.
    expect(withDetour.on).toBe(without.on);
  });

  it('still refuses to bill a detouring rider above their solo fare', () => {
    const r: RiderSegment = {
      uid: 'far',
      boardM: 0,
      alightM: 2000,
      pickupOffsetM: 1000,
      dropoffOffsetM: 4000,
      soloFare: solo(2),
      tierCap: null,
    };
    const { fares } = split([r]);
    expect(fares.far!).toBeLessThanOrEqual(r.soloFare);
  });
});

describe('edges', () => {
  it('charges at least the category minimum for a very short hop', () => {
    const { fares } = split([rider('a', 0, 12000), rider('hop', 5000, 5400)]);
    // minFare for mini is 200, but the hop's own solo fare caps it — the floor
    // can never push a rider above what they would have paid alone.
    const hopSolo = solo(0.4);
    expect(fares.hop!).toBe(Math.min(MINI.minFare, hopSolo));
  });

  it('leaves the stretch nobody is aboard for unpaid — the driver\'s own dead-head', () => {
    // Rider gets out at 4 km; the route runs to 10 km with nobody in the car.
    const { unpaidM, legs } = split([rider('a', 0, 4000)]);
    expect(unpaidM).toBe(0); // legs only ever span between rider cut points
    expect(legs.every((l) => l.aboard.length > 0)).toBe(true);
  });

  it('counts the gap between one rider getting out and the next getting in', () => {
    const { unpaidM } = split([rider('a', 0, 3000), rider('b', 7000, 10000)]);
    expect(unpaidM).toBeCloseTo(4000, 6);
  });

  it('returns nothing at all for an empty car', () => {
    expect(split([])).toEqual({
      fares: {},
      billableKm: {},
      driverGross: 0,
      legs: [],
      unpaidM: 0,
    });
  });
});
