/**
 * The peak factor is the one number in this engine a rider pays for directly,
 * so what matters here is the limits: it must not jump, must not exceed its
 * ceiling, must not read anything into a quiet zone, and must come down faster
 * than it went up.
 */
import { describe, it, expect } from 'vitest';

import { bandFor, computePeakFactor, driverPeakLabel, explainPeak, rampToward, riderPeakLabel } from '../peak';
import { DEFAULT_PRICING_CONFIG, type PeakSettings, type ZoneSample } from '../types';

const NOW = 1_760_000_000_000;
const settings = DEFAULT_PRICING_CONFIG.peak;

function sample(over: Partial<ZoneSample> = {}): ZoneSample {
  return { at: NOW, onlineDrivers: 10, availableDrivers: 10, openRequests: 10, ...over };
}

const factorFor = (over: Partial<ZoneSample>, previous = 1, s: PeakSettings = settings) =>
  computePeakFactor({ sample: sample(over), previousMultiplier: previous, settings: s, now: NOW });

describe('bandFor', () => {
  it('maps demand pressure onto the configured ladder', () => {
    expect(bandFor(0.2, settings)).toBe(1.0);
    expect(bandFor(0.8, settings)).toBe(1.05);
    expect(bandFor(1.4, settings)).toBe(1.1);
    expect(bandFor(2.0, settings)).toBe(1.18);
    expect(bandFor(50, settings)).toBe(1.25);
  });
});

describe('rampToward', () => {
  it('rises slowly and falls twice as fast', () => {
    expect(rampToward(1.0, 1.25, settings)).toBeCloseTo(1.05, 4);
    expect(rampToward(1.25, 1.0, settings)).toBeCloseTo(1.15, 4);
  });

  it('stops exactly on the target rather than overshooting', () => {
    expect(rampToward(1.02, 1.03, settings)).toBe(1.03);
  });
});

describe('computePeakFactor', () => {
  it('leaves fares alone when there are more cars than riders', () => {
    const decision = factorFor({ availableDrivers: 20, openRequests: 4 });
    expect(decision.multiplier).toBe(1);
    expect(decision.ratio).toBe(0.2);
  });

  it('takes several ticks to climb to its target', () => {
    let multiplier = 1;
    const seen: number[] = [];
    for (let tick = 0; tick < 8; tick++) {
      multiplier = computePeakFactor({
        sample: sample({ availableDrivers: 2, openRequests: 20 }),
        previousMultiplier: multiplier,
        settings,
        now: NOW,
      }).multiplier;
      seen.push(multiplier);
    }
    // Ramped, never jumped, and stopped at the ceiling.
    expect(seen.slice(0, 3)).toEqual([1.05, 1.1, 1.15]);
    expect(seen.at(-1)).toBe(1.25);
  });

  it('never exceeds the engine ceiling however extreme the shortage', () => {
    const decision = factorFor({ availableDrivers: 0, openRequests: 500 }, 1.25);
    expect(decision.multiplier).toBeLessThanOrEqual(settings.maxMultiplier);
  });

  it('ignores a zone too quiet to read', () => {
    // Ratio of 2.0 would earn 1.18 on the bands — but it is one driver and two
    // requests at four in the morning.
    const decision = factorFor({ availableDrivers: 1, openRequests: 2 });
    expect(decision.reason).toBe('low_activity');
    expect(decision.multiplier).toBe(1);
    expect(decision.ratio).toBeNull();
  });

  it('eases a quiet zone back down instead of snapping it', () => {
    const decision = factorFor({ availableDrivers: 1, openRequests: 1 }, 1.25);
    expect(decision.reason).toBe('low_activity');
    expect(decision.multiplier).toBeCloseTo(1.15, 4);
  });

  it('treats no drivers at all as the highest pressure, not a crash', () => {
    const decision = factorFor({ availableDrivers: 0, openRequests: 12 }, 1.2);
    expect(Number.isFinite(decision.multiplier)).toBe(true);
    expect(decision.targetMultiplier).toBe(1.25);
  });

  it('is a no-op when switched off', () => {
    const decision = factorFor({ availableDrivers: 1, openRequests: 50 }, 1.2, { ...settings, enabled: false });
    expect(decision.multiplier).toBe(1);
    expect(decision.reason).toBe('disabled');
  });

  it('holds at the pre-drop factor while a supply shock is frozen', () => {
    const decision = computePeakFactor({
      sample: sample({ availableDrivers: 2, openRequests: 20 }),
      previousMultiplier: 1.05,
      settings,
      freeze: { multiplier: 1.05, until: NOW + 60_000 },
      now: NOW,
    });
    expect(decision.reason).toBe('frozen_supply_shock');
    expect(decision.multiplier).toBe(1.05);
    expect(decision.frozenUntil).toBe(NOW + 60_000);
  });

  it('still gives the rider the lower price if demand falls during a freeze', () => {
    const decision = computePeakFactor({
      sample: sample({ availableDrivers: 30, openRequests: 2 }),
      previousMultiplier: 1.1,
      settings,
      freeze: { multiplier: 1.2, until: NOW + 60_000 },
      now: NOW,
    });
    // The freeze is a ceiling, never a floor.
    expect(decision.multiplier).toBeLessThan(1.1);
  });

  it('resumes normally once the freeze expires', () => {
    const decision = computePeakFactor({
      sample: sample({ availableDrivers: 2, openRequests: 20 }),
      previousMultiplier: 1.05,
      settings,
      freeze: { multiplier: 1.05, until: NOW - 1 },
      now: NOW,
    });
    expect(decision.reason).not.toBe('frozen_supply_shock');
    expect(decision.multiplier).toBeGreaterThan(1.05);
  });

  it('can discount idle supply when an admin allows it', () => {
    const discounting = { ...settings, minMultiplier: 0.95, bands: [{ ratio: 0.2, multiplier: 0.95 }, ...settings.bands] };
    const decision = computePeakFactor({
      sample: sample({ availableDrivers: 40, openRequests: 2 }),
      previousMultiplier: 1,
      settings: discounting,
      now: NOW,
    });
    expect(decision.multiplier).toBe(0.95);
  });

  it('cannot discount by default', () => {
    const decision = factorFor({ availableDrivers: 40, openRequests: 2 });
    expect(decision.multiplier).toBe(1);
  });
});

describe('labels', () => {
  it('say nothing at all when the fare has not moved', () => {
    expect(riderPeakLabel(1)).toBeNull();
    expect(driverPeakLabel(1)).toBeNull();
    expect(explainPeak({ multiplier: 1, targetMultiplier: 1, ratio: 1, reason: 'banded' })).toBeNull();
  });

  it('escalate with the factor', () => {
    expect(riderPeakLabel(1.05)).toBe('Busier than usual');
    expect(riderPeakLabel(1.1)).toBe('Busy right now');
    expect(riderPeakLabel(1.25)).toBe('Very busy right now');
  });

  it('tell the driver what it is worth to them', () => {
    expect(driverPeakLabel(1.18)).toContain('18%');
  });
});
