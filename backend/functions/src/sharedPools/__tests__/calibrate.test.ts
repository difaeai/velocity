/**
 * The engine fitting its own distances (sharedPools/calibrate.ts).
 *
 * These numbers decide who gets seated on a real car, so what matters is not
 * only that a good distribution moves them — it is that a thin, noisy or
 * lopsided one does NOT.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_POOLING, modeForRoute, routeKeyOf } from '../../domain/poolingSettings';
import {
  MAX_LIVE_ROUTES,
  MIN_JOIN_SAMPLES,
  MIN_MODE_SAMPLES,
  MIN_OFFROUTE_SAMPLES,
  RADIUS_CEILING_M,
  RADIUS_STEP_M,
  decideModes,
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

// ── Deciding where to enforce ────────────────────────────────────────────────

/** `n` judged joins on `route`: `passed` met the limits, all road-measured. */
const joinsOn = (route: string, n: number, passed: number, source = 'road') =>
  Array.from({ length: n }, (_, i) => ({
    kind: 'join', routeKey: route, ok: i < passed, detourSource: source,
  }));

const withRoutes = (...routes: string[]) => ({ ...DEFAULT_POOLING, liveRoutes: routes });

describe('the engine decides for itself where to enforce', () => {
  it('promotes a route whose joins already meet the limits', () => {
    const d = decideModes(joinsOn('PWD>F-10', 40, 38), DEFAULT_POOLING);
    expect(d.promoted).toEqual(['PWD>F-10']);
    expect(d.liveRoutes).toEqual(['PWD>F-10']);
    expect(d.reasons.join(' ')).toMatch(/PWD>F-10 → live: 40 joins judged, 95% already met/);
  });

  it('leaves a route alone where enforcing would turn away a tenth of its riders', () => {
    const d = decideModes(joinsOn('PWD>G-10', 40, 30), DEFAULT_POOLING);
    expect(d.promoted).toEqual([]);
    expect(d.liveRoutes).toEqual([]);
  });

  it('will not promote on too few joins, however clean they look', () => {
    const d = decideModes(joinsOn('PWD>F-10', MIN_MODE_SAMPLES - 1, MIN_MODE_SAMPLES - 1), DEFAULT_POOLING);
    expect(d.promoted).toEqual([]);
  });

  it('will not promote a route whose detours were only straight-line measured', () => {
    const d = decideModes(joinsOn('PWD>F-10', 40, 40, 'straight'), DEFAULT_POOLING);
    expect(d.promoted).toEqual([]);
  });

  it('pulls a live route back to shadow when it starts refusing too many', () => {
    const d = decideModes(joinsOn('PWD>F-10', 40, 28), withRoutes('PWD>F-10'));
    expect(d.demoted).toEqual(['PWD>F-10']);
    expect(d.liveRoutes).toEqual([]);
    expect(d.reasons.join(' ')).toMatch(/→ shadow: only 70% of 40 joins met the limits/);
  });

  it('does not flap: a route between the two thresholds keeps whatever it has', () => {
    // 85% is under PROMOTE_PASS and over DEMOTE_PASS.
    const between = joinsOn('PWD>F-10', 40, 34);
    expect(decideModes(between, DEFAULT_POOLING).liveRoutes).toEqual([]);
    expect(decideModes(between, withRoutes('PWD>F-10')).liveRoutes).toEqual(['PWD>F-10']);
  });

  it('keeps a route that earned live but has since gone quiet', () => {
    const d = decideModes(joinsOn('PWD>F-10', 2, 0), withRoutes('PWD>F-10'));
    expect(d.demoted).toEqual([]);
    expect(d.liveRoutes).toEqual(['PWD>F-10']);
  });

  it('judges each route on its own record, not the city average', () => {
    const d = decideModes(
      [...joinsOn('PWD>F-10', 40, 39), ...joinsOn('PWD>I-9', 40, 20)],
      DEFAULT_POOLING,
    );
    expect(d.promoted).toEqual(['PWD>F-10']);
    expect(d.liveRoutes).toEqual(['PWD>F-10']);
  });

  it('ignores off-route rows and rows with no route at all', () => {
    const d = decideModes([
      ...offRoute(60, 1300),
      ...Array.from({ length: 40 }, () => ({ kind: 'join', ok: true, detourSource: 'road' })),
    ], DEFAULT_POOLING);
    expect(d.promoted).toEqual([]);
  });

  it('stops promoting once the cap is reached, rather than growing without bound', () => {
    const full = Array.from({ length: MAX_LIVE_ROUTES }, (_, i) => `r${i}`);
    const d = decideModes(joinsOn('PWD>F-10', 40, 40), withRoutes(...full));
    expect(d.promoted).toEqual([]);
    expect(d.liveRoutes).toHaveLength(MAX_LIVE_ROUTES);
  });

  it('says nothing when there is nothing to decide', () => {
    expect(decideModes([], DEFAULT_POOLING).reasons).toEqual([]);
  });
});

describe('modeForRoute — who enforces where', () => {
  it('is shadow by default, live only on a promoted route', () => {
    const s = withRoutes('PWD>F-10');
    expect(modeForRoute(s, 'PWD>F-10')).toBe('live');
    expect(modeForRoute(s, 'PWD>G-10')).toBe('shadow');
    expect(modeForRoute(s, null)).toBe('shadow');
  });

  it('a global live enforces everywhere, promoted or not', () => {
    const s = { ...DEFAULT_POOLING, mode: 'live' as const };
    expect(modeForRoute(s, 'anything')).toBe('live');
    expect(modeForRoute(s, null)).toBe('live');
  });
});

describe('routeKeyOf — two pools on one corridor share a record', () => {
  it('names a route by its areas, not its exact coordinates', () => {
    expect(routeKeyOf(
      { address: 'PWD Housing Society, Islamabad' },
      { address: 'F-10 Markaz, Islamabad' },
    )).toBe('PWD Housing Society>F-10 Markaz');
  });

  it('gives the same key for two pools whose addresses differ in street detail', () => {
    const a = routeKeyOf({ address: 'Street 12, PWD, Islamabad' }, { address: 'F-10 Markaz, Islamabad' });
    const b = routeKeyOf({ address: 'Street 40, PWD, Islamabad' }, { address: 'F-10 Markaz, Islamabad' });
    expect(a).toBe(b);
  });

  it('is directional: the way back is a different route', () => {
    const there = routeKeyOf({ address: 'PWD, Islamabad' }, { address: 'F-10 Markaz, Islamabad' });
    const back = routeKeyOf({ address: 'F-10 Markaz, Islamabad' }, { address: 'PWD, Islamabad' });
    expect(there).not.toBe(back);
  });
});
