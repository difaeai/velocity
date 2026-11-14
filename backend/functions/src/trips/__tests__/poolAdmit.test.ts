/**
 * Is a join worth making — the economic and detour limits (trips/poolPricing).
 *
 * `priceJoin` already promises nobody pays more than riding alone and the
 * driver never earns less. These are the cases it permits anyway, which are
 * the ones the owner's spec (2026-11-14) asks the engine to measure.
 */
import { describe, it, expect } from 'vitest';

import { detourOf, pathM, poolAdmit, priceCar, type PricedRider } from '../poolPricing';

/** ~1 km per 0.0108° of longitude at this latitude. */
const at = (km: number) => ({ lat: 33.7, lng: 73 + km / 92.6 });
/** A rider going straight down the route from `a` km to `b` km. */
const along = (uid: string, a: number, b: number) => ({ uid, pickup: at(a), dropoff: at(b) });

const LIMITS = {
  maxDetourKm: 5,
  maxDetourMin: 15,
  minRiderSavingPct: 0.1,
  minDriverGainPkr: 0,
};
/** No detour, so a case can speak about money alone. */
const NO_DETOUR = { km: 0, min: 0 };

describe('poolAdmit — the joiner must actually save something', () => {
  it('passes two riders on the same long route: both near the 45% tier discount', () => {
    const aboard: PricedRider[] = [{ uid: 'a', soloFare: 1000 }];
    const d = poolAdmit(aboard, { uid: 'b', soloFare: 1000 }, LIMITS, NO_DETOUR);
    expect(d.ok).toBe(true);
    expect(d.reason).toBeNull();
    // 55% each at two riders: both save 45%, and the car earns more than 1000.
    expect(d.joinerFare).toBe(550);
    expect(d.worstSavingPct).toBeCloseTo(0.45, 2);
    expect(d.driverGain).toBe(100);
  });

  it('refuses a short-hop joiner the top-up charges their whole solo fare', () => {
    // The car earns 1000 from one long rider. A 200-rupee hop pulls the long
    // rider to 550, so the top-up asks the joiner for the 450 shortfall —
    // capped at their own 200. They save nothing at all.
    const aboard: PricedRider[] = [{ uid: 'long', soloFare: 1000 }];
    const d = poolAdmit(aboard, { uid: 'hop', soloFare: 200 }, LIMITS, NO_DETOUR);
    expect(d.joinerFare).toBe(200);
    expect(d.joinerSavingPct).toBe(0);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/would save only 0%/);
  });

  it('measures the worst saving in the car, not just the joiner’s', () => {
    const d = poolAdmit([{ uid: 'hop', soloFare: 200 }], { uid: 'long', soloFare: 1000 }, LIMITS, NO_DETOUR);
    // The joiner does well; the rider already aboard is the one to protect.
    expect(d.joinerSavingPct).toBeGreaterThan(0.1);
    expect(d.worstSavingPct).toBeLessThanOrEqual(d.joinerSavingPct);
  });

  it('never charges anyone more than riding alone, whatever the mix of fares', () => {
    const aboard: PricedRider[] = [{ uid: 'a', soloFare: 1000 }];
    for (const solo of [100, 200, 500, 1000, 3000]) {
      const d = poolAdmit(aboard, { uid: 'b', soloFare: solo }, LIMITS, NO_DETOUR);
      expect(d.joinerFare).toBeLessThanOrEqual(solo);
    }
  });

  /**
   * The finding this gate exists for. `priceJoin`'s "the driver never loses"
   * top-up is capped at the joiner's own solo fare, so it can only hold while
   * that fare is big enough to cover what the tier takes off everyone else.
   * `routeFit` normally guarantees that (half the route or more), but nothing
   * in the pricing itself does — and when it does not hold, the car earns LESS
   * than before the join. The default limits refuse exactly that.
   */
  it('refuses a join that would leave the car earning less than before', () => {
    const aboard: PricedRider[] = [{ uid: 'a', soloFare: 1000 }];
    const before = priceCar(aboard).gross;
    const d = poolAdmit(aboard, { uid: 'tiny', soloFare: 100 }, LIMITS, NO_DETOUR);
    expect(d.gross).toBeLessThan(before);
    expect(d.driverGain).toBeLessThan(0);
    expect(d.ok).toBe(false);
  });
});

describe('poolAdmit — detour and driver-revenue limits', () => {
  const aboard: PricedRider[] = [{ uid: 'a', soloFare: 1000 }];
  const joiner: PricedRider = { uid: 'b', soloFare: 1000 };

  it('refuses a detour past the kilometre limit', () => {
    const d = poolAdmit(aboard, joiner, LIMITS, { km: 7, min: 10 });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/7\.0 km is over the 5 km limit/);
  });

  it('refuses a detour past the minute limit even when the distance is fine', () => {
    const d = poolAdmit(aboard, joiner, LIMITS, { km: 4, min: 40 });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/40 min is over the 15 min limit/);
  });

  it('refuses a join that leaves the driver no better off than before', () => {
    // A hop whose top-up only restores the old gross: gain 0, and the admin
    // asks for at least 50 rupees more.
    const d = poolAdmit(aboard, { uid: 'hop', soloFare: 150 }, { ...LIMITS, minRiderSavingPct: 0, minDriverGainPkr: 50 }, NO_DETOUR);
    expect(d.driverGain).toBeLessThan(50);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/would earn only PKR .* under the PKR 50 minimum/);
  });

  it('reports the detour before the money, so the admin reads the cause', () => {
    const d = poolAdmit(aboard, { uid: 'hop', soloFare: 200 }, LIMITS, { km: 9, min: 99 });
    expect(d.reason).toMatch(/km is over/);
  });

  it('turns every limit off and passes a join nothing else objects to', () => {
    const off = { maxDetourKm: 50, maxDetourMin: 180, minRiderSavingPct: 0, minDriverGainPkr: 0 };
    // A hop whose solo fare is too small to cover the tier still fails the
    // driver limit at 0, because the car would earn less than nothing extra.
    expect(poolAdmit(aboard, { uid: 'hop', soloFare: 200 }, off, NO_DETOUR).ok).toBe(false);
    // One whose fare does cover it passes with every limit at its loosest.
    expect(poolAdmit(aboard, { uid: 'b', soloFare: 900 }, off, { km: 6, min: 21 }).ok).toBe(true);
  });
});

describe('detourOf — the extra road one more rider adds, not their own distance', () => {
  it('is near zero for a rider going exactly the same way', () => {
    const { km, min } = detourOf([along('a', 0, 9)], along('b', 0, 9));
    expect(km).toBeLessThan(0.05);
    expect(min).toBeLessThan(0.2);
  });

  it('counts only the extra, for a rider who gets out short of the others', () => {
    // a: 0→9. b: 0→5, which the car passes anyway: no new road.
    const { km } = detourOf([along('a', 0, 9)], along('b', 0, 5));
    expect(km).toBeLessThan(0.05);
  });

  it('grows with a drop-off off the line', () => {
    const off = { uid: 'b', pickup: at(0), dropoff: { lat: 33.73, lng: 73.03 } };
    const { km, min } = detourOf([along('a', 0, 9)], off);
    expect(km).toBeGreaterThan(1);
    expect(min).toBeCloseTo(km * 3.5, 5);
  });

  it('never reports a negative detour', () => {
    for (const b of [along('b', 0, 1), along('b', 4, 5), along('b', 8, 9)]) {
      expect(detourOf([along('a', 0, 9)], b).km).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('pathM — the road the car drives', () => {
  it('is the route length when one rider rides it end to end', () => {
    expect(pathM([along('a', 0, 9)])).toBeGreaterThan(8_900);
    expect(pathM([along('a', 0, 9)])).toBeLessThan(9_100);
  });

  it('counts the drive to the first pickup when the car starts somewhere', () => {
    const fromStart = pathM([along('a', 2, 9)], at(0));
    expect(fromStart).toBeGreaterThan(pathM([along('a', 2, 9)]));
  });

  it('is zero for no riders', () => {
    expect(pathM([])).toBe(0);
  });
});
