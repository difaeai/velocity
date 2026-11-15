/**
 * The engine fitting its own distances (sharedPools/calibrate.ts).
 *
 * These numbers decide who gets seated on a real car, so what matters is not
 * only that a good distribution moves them — it is that a thin, noisy or
 * lopsided one does NOT.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_POOLING } from '../../domain/poolingSettings';
import {
  MIN_JOIN_SAMPLES,
  MIN_OFFROUTE_SAMPLES,
  RADIUS_CEILING_M,
  RADIUS_STEP_M,
  percentile,
  recommend,
} from '../calibrate';

/** `n` riders turned away for standing `offsetM` off the route. */
const offRoute = (n: number, offsetM: number) =>
  Array.from({ length: n }, () => ({ kind: 'offRoute', offsetM }));

/** `n` worthwhile joins, each costing `km` of road and `min` of time. */
const goodJoins = (n: number, km: number, min: number) =>
  Array.from({ length: n }, () => ({ kind: 'join', ok: true, detourSource: 'road', detourKm: km, detourMin: min }));

describe('percentile', () => {
  it('takes the nearest rank, and survives an empty list', () => {
    expect(percentile([], 0.8)).toBe(0);
    expect(percentile([5], 0.8)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.8)).toBe(8);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });
});

describe('the radius follows where riders actually stand', () => {
  it('widens towards the riders it was turning away', () => {
    const p = recommend(offRoute(60, 1300), DEFAULT_POOLING);
    expect(p.matchRadiusM).toBe(1250); // 1000 + the 250 m step
    expect(p.samples.offRoute).toBe(60);
    expect(p.reasons.join(' ')).toMatch(/Match radius 1000 m → 1250 m/);
  });

  it('moves no more than one step, however far the riders were', () => {
    const p = recommend(offRoute(200, 2400), DEFAULT_POOLING);
    expect(p.matchRadiusM).toBe(DEFAULT_POOLING.matchRadiusM + RADIUS_STEP_M);
  });

  it('will not move on too few riders, and says nothing rather than confirming', () => {
    const p = recommend(offRoute(MIN_OFFROUTE_SAMPLES - 1, 1400), DEFAULT_POOLING);
    expect(p.matchRadiusM).toBe(DEFAULT_POOLING.matchRadiusM);
    expect(p.reasons).toEqual([]);
  });

  it('ignores riders past the ceiling, so a handful of far ones cannot drag it', () => {
    // 50 riders who stood 8 km off: a different journey, not evidence.
    const p = recommend(offRoute(50, 8000), DEFAULT_POOLING);
    expect(p.samples.offRoute).toBe(0);
    expect(p.matchRadiusM).toBe(DEFAULT_POOLING.matchRadiusM);
  });

  it('never fits past the ceiling, however much data says otherwise', () => {
    let settings = { ...DEFAULT_POOLING };
    // Twenty nightly runs against riders standing right at the ceiling.
    for (let i = 0; i < 20; i += 1) {
      const p = recommend(offRoute(100, RADIUS_CEILING_M), settings);
      settings = { ...settings, matchRadiusM: p.matchRadiusM };
    }
    expect(settings.matchRadiusM).toBe(RADIUS_CEILING_M);
  });

  it('tightens again when the riders being refused are close in', () => {
    const wide = { ...DEFAULT_POOLING, matchRadiusM: 2000 };
    const p = recommend(offRoute(60, 1100), wide);
    expect(p.matchRadiusM).toBe(2000 - RADIUS_STEP_M); // 1750, one step down
    expect(p.reasons.join(' ')).toMatch(/2000 m → 1750 m/);
  });
});

describe('the detour limits follow what a worthwhile join really costs', () => {
  it('tightens onto the road cost of joins that were worth making', () => {
    const p = recommend(goodJoins(60, 4, 6), DEFAULT_POOLING);
    // 5 km → 4, and 15 min → 11.3 (a quarter off, the step cap)
    expect(p.maxDetourKm).toBe(4);
    expect(p.maxDetourMin).toBeCloseTo(11.3, 1);
    expect(p.reasons.join(' ')).toMatch(/Max detour 5 km → 4 km/);
  });

  it('will not move on too few joins', () => {
    const p = recommend(goodJoins(MIN_JOIN_SAMPLES - 1, 2, 3), DEFAULT_POOLING);
    expect(p.maxDetourKm).toBe(DEFAULT_POOLING.maxDetourKm);
    expect(p.maxDetourMin).toBe(DEFAULT_POOLING.maxDetourMin);
  });

  it('ignores straight-line rows, which understate the detour', () => {
    const straight = Array.from({ length: 100 }, () => ({
      kind: 'join', ok: true, detourSource: 'straight', detourKm: 0.4, detourMin: 1.4,
    }));
    const p = recommend(straight, DEFAULT_POOLING);
    expect(p.samples.goodJoins).toBe(0);
    expect(p.maxDetourKm).toBe(DEFAULT_POOLING.maxDetourKm);
  });

  it('ignores joins the economics refused: a limit allows what was worth doing', () => {
    const bad = Array.from({ length: 100 }, () => ({
      kind: 'join', ok: false, detourSource: 'road', detourKm: 30, detourMin: 90,
    }));
    const p = recommend(bad, DEFAULT_POOLING);
    expect(p.samples.goodJoins).toBe(0);
    expect(p.maxDetourKm).toBe(DEFAULT_POOLING.maxDetourKm);
  });

  it('moves no more than a quarter of itself in one run', () => {
    const p = recommend(goodJoins(80, 40, 170), DEFAULT_POOLING);
    expect(p.maxDetourKm).toBeCloseTo(6.3, 1); // 5 × 1.25
    expect(p.maxDetourMin).toBeCloseTo(18.8, 1); // 15 × 1.25
  });

  it('converges rather than oscillating, run after run', () => {
    let settings = { ...DEFAULT_POOLING };
    for (let i = 0; i < 30; i += 1) {
      const p = recommend(goodJoins(80, 7, 12), settings);
      settings = { ...settings, maxDetourKm: p.maxDetourKm, maxDetourMin: p.maxDetourMin };
    }
    expect(settings.maxDetourKm).toBeCloseTo(7, 1);
    expect(settings.maxDetourMin).toBeCloseTo(12, 1);
  });
});

describe('together', () => {
  it('fits all three and explains each one', () => {
    const p = recommend([...offRoute(50, 1200), ...goodJoins(50, 3, 5)], DEFAULT_POOLING);
    expect(p.matchRadiusM).toBe(1200);
    expect(p.maxDetourKm).toBe(3.8); // 5 × 0.75, the step floor
    expect(p.reasons).toHaveLength(3);
    expect(p.samples).toEqual({ offRoute: 50, goodJoins: 50 });
  });

  it('says nothing at all when there is no data', () => {
    const p = recommend([], DEFAULT_POOLING);
    expect(p.reasons).toEqual([]);
    expect(p.matchRadiusM).toBe(DEFAULT_POOLING.matchRadiusM);
    expect(p.maxDetourKm).toBe(DEFAULT_POOLING.maxDetourKm);
    expect(p.maxDetourMin).toBe(DEFAULT_POOLING.maxDetourMin);
  });

  it('never proposes a value the backend would clamp away', () => {
    const p = recommend([...offRoute(200, 9000), ...goodJoins(200, 0.01, 0.01)], DEFAULT_POOLING);
    expect(p.matchRadiusM).toBeGreaterThanOrEqual(200);
    expect(p.matchRadiusM).toBeLessThanOrEqual(10_000);
    expect(p.maxDetourKm).toBeGreaterThanOrEqual(0.5);
    expect(p.maxDetourMin).toBeGreaterThanOrEqual(1);
  });
});
