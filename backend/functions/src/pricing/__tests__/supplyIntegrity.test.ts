/**
 * The whole value of this detector is in what it does NOT fire on. A false
 * positive freezes a fare that genuinely should have risen, so an honest
 * evening rush, a shift ending and a city going to sleep all have to pass
 * through untouched — while fifty drivers leaving at once does not.
 */
import { describe, it, expect } from 'vitest';

import { churnVerdict, describeShock, detectSupplyShock, freezeFor, trimPresenceEvents } from '../supplyIntegrity';
import { DEFAULT_PRICING_CONFIG, type ZoneSample } from '../types';

const NOW = 1_760_000_000_000;
const TICK = 60_000;
const settings = DEFAULT_PRICING_CONFIG.integrity;

/**
 * Builds a sample history ending now, one tick apart, from a list of
 * [onlineDrivers, openRequests] pairs given oldest-first.
 */
function history(pairs: [number, number][]): ZoneSample[] {
  const start = NOW - (pairs.length - 1) * TICK;
  return pairs.map(([onlineDrivers, openRequests], i) => ({
    at: start + i * TICK,
    onlineDrivers,
    availableDrivers: onlineDrivers,
    openRequests,
  }));
}

/** 100 drivers, steady demand, then half of them vanish in one tick. */
const WALKOUT = history([
  [100, 40], [100, 42], [98, 41], [101, 40], [99, 43], [50, 44],
]);

describe('detectSupplyShock', () => {
  it('catches half the drivers leaving at once while riders keep asking', () => {
    const shock = detectSupplyShock(WALKOUT, settings, NOW);
    expect(shock.suspicious).toBe(true);
    expect(shock.reason).toBe('sudden_drop');
    expect(shock.baselineSupply).toBeGreaterThanOrEqual(98);
    expect(shock.currentSupply).toBe(50);
    expect(shock.droppedPct).toBeGreaterThan(0.45);
    expect(shock.detectedAt).toBe(NOW);
  });

  it('leaves a shift ending alone', () => {
    // The same 50% fall, but spread across the whole window a few at a time.
    const gradual = history([
      [100, 40], [92, 39], [84, 38], [76, 37], [68, 36], [60, 35], [52, 34], [50, 33],
    ]);
    const shock = detectSupplyShock(gradual, settings, NOW);
    expect(shock.suspicious).toBe(false);
    expect(shock.reason).toBe('gradual');
  });

  it('leaves a city going to sleep alone', () => {
    // Drivers and riders both go home together — a lull, not a walk-out.
    const lull = history([
      [100, 40], [100, 38], [98, 35], [99, 20], [95, 10], [45, 4],
    ]);
    const shock = detectSupplyShock(lull, settings, NOW);
    expect(shock.suspicious).toBe(false);
    expect(shock.reason).toBe('demand_fell');
  });

  it('ignores percentages in a zone with a handful of drivers', () => {
    const tiny = history([[4, 3], [4, 3], [4, 3], [4, 3], [4, 4], [1, 4]]);
    const shock = detectSupplyShock(tiny, settings, NOW);
    expect(shock.suspicious).toBe(false);
    expect(shock.reason).toBe('too_few_drivers');
  });

  it('says so rather than guessing when a zone is new', () => {
    const shock = detectSupplyShock(history([[100, 40], [50, 40]]), settings, NOW);
    expect(shock.suspicious).toBe(false);
    expect(shock.reason).toBe('insufficient_history');
  });

  it('does not fire on ordinary churn', () => {
    const steady = history([[100, 40], [97, 41], [103, 39], [99, 42], [101, 40], [96, 41]]);
    expect(detectSupplyShock(steady, settings, NOW).suspicious).toBe(false);
  });

  it('does not fire on a genuine demand spike with supply intact', () => {
    // The evening rush: riders triple, drivers stay. This SHOULD surge.
    const rush = history([[100, 20], [100, 35], [101, 60], [99, 90], [100, 120], [100, 140]]);
    expect(detectSupplyShock(rush, settings, NOW).suspicious).toBe(false);
  });

  it('ignores samples that have aged out of the lookback window', () => {
    const stale = history([[100, 40], [100, 40], [100, 40], [100, 40], [100, 40], [50, 40]]).map((s, i, all) =>
      i < all.length - 1 ? { ...s, at: s.at - settings.lookbackSec * 1000 } : s,
    );
    expect(detectSupplyShock(stale, settings, NOW).reason).toBe('insufficient_history');
  });

  it('is a no-op when switched off', () => {
    expect(detectSupplyShock(WALKOUT, { ...settings, enabled: false }, NOW).suspicious).toBe(false);
  });
});

describe('freezeFor', () => {
  it('pins the factor where it was before the drop', () => {
    const shock = detectSupplyShock(WALKOUT, settings, NOW);
    const freeze = freezeFor(shock, 1.05, settings, NOW);
    expect(freeze?.multiplier).toBe(1.05);
    expect(freeze?.until).toBe(NOW + settings.freezeMinutes * 60_000);
  });

  it('is nothing at all when there was no shock', () => {
    expect(freezeFor({ suspicious: false, baselineSupply: 0, currentSupply: 0, droppedPct: 0, overSamples: 0, reason: 'none' }, 1.2, settings, NOW)).toBeNull();
  });
});

describe('churnVerdict', () => {
  const cycle = (offsetMin: number) => [
    { at: NOW - offsetMin * 60_000, online: false },
    { at: NOW - (offsetMin - 1) * 60_000, online: true },
  ];

  it('counts completed offline-and-back round trips', () => {
    const events = [...cycle(50), ...cycle(40), ...cycle(30)];
    expect(churnVerdict(events, settings, null, NOW).cycles).toBe(3);
  });

  it('leaves a driver who took one break unflagged', () => {
    expect(churnVerdict(cycle(30), settings, null, NOW).flagged).toBe(false);
  });

  it('flags a driver flapping all hour', () => {
    const events = [...cycle(55), ...cycle(45), ...cycle(35), ...cycle(25), ...cycle(15), ...cycle(5)];
    const verdict = churnVerdict(events, settings, null, NOW);
    expect(verdict.cycles).toBe(6);
    expect(verdict.flagged).toBe(true);
  });

  it('forgets anything older than the hour', () => {
    const old = [{ at: NOW - 3 * 60 * 60_000, online: false }, { at: NOW - 2.9 * 60 * 60_000, online: true }];
    expect(churnVerdict(old, settings, null, NOW).cycles).toBe(0);
  });

  it('notices a return that landed just after a shortage appeared', () => {
    const shockAt = NOW - 10 * 60_000;
    const events = [{ at: shockAt - 60_000, online: false }, { at: shockAt + 60_000, online: true }];
    expect(churnVerdict(events, settings, shockAt, NOW).opportunistic).toBe(true);
  });

  it('does not read anything into a return long after a shortage', () => {
    const shockAt = NOW - 120 * 60_000;
    const events = [{ at: NOW - 20 * 60_000, online: false }, { at: NOW - 10 * 60_000, online: true }];
    expect(churnVerdict(events, settings, shockAt, NOW).opportunistic).toBe(false);
  });
});

describe('trimPresenceEvents', () => {
  it('keeps the newest events and bounds the log', () => {
    const events = Array.from({ length: 100 }, (_, i) => ({ at: NOW - i * 1000, online: i % 2 === 0 }));
    const trimmed = trimPresenceEvents(events, 10);
    expect(trimmed).toHaveLength(10);
    expect(trimmed.at(-1)?.at).toBe(NOW);
  });
});

describe('describeShock', () => {
  it('explains a freeze in terms an operator can repeat to a driver', () => {
    const text = describeShock(detectSupplyShock(WALKOUT, settings, NOW));
    expect(text).toContain('frozen');
    expect(text).toContain('50');
  });
});
