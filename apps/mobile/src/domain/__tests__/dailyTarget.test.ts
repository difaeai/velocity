/**
 * The app's copy of the daily-target rule, pinned against the backend's.
 *
 * Two implementations of this rule exist on purpose — the app recomputes it so
 * the progress card moves the instant a ride lands instead of waiting on a
 * round trip — and the whole arrangement only works if they agree. The backend
 * is authoritative; this suite exists to catch the app drifting away from it.
 *
 * Every expectation below is also asserted in
 * backend/functions/src/drivers/__tests__/dailyTarget.test.ts. If you change one
 * file, this is the other one.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_DAILY_TARGET,
  dailyTargetProgress,
  emptyDay,
  pktDayKey,
  type DailyTargetDay,
  type DailyTargetSettings,
} from '../dailyTarget';

const DAY = '2026-10-01';

function settings(over: Partial<DailyTargetSettings> = {}): DailyTargetSettings {
  return { ...DEFAULT_DAILY_TARGET, ...over };
}

function day(over: Partial<DailyTargetDay> = {}): DailyTargetDay {
  return { ...emptyDay(DAY), ...over };
}

function riders(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `rider-${i}`);
}

describe('the shipped defaults match the backend', () => {
  it('is 16 pool rides for a commission-free day, with no cash bonus', () => {
    expect(DEFAULT_DAILY_TARGET.dailyTargetRides).toBe(16);
    expect(DEFAULT_DAILY_TARGET.dailyTargetBonus).toBe(0);
    expect(DEFAULT_DAILY_TARGET.dailyTargetPoolOnly).toBe(true);
    expect(DEFAULT_DAILY_TARGET.dailyTargetWaivesCommission).toBe(true);
  });

  it('keeps the day floor reachable by the ride count and the fare floor', () => {
    // 16 × 150 = 2,400. A day minimum above that could never be satisfied, and
    // the card would show a condition nobody can clear.
    const d = DEFAULT_DAILY_TARGET;
    expect(d.dailyTargetMinDayFare).toBeLessThanOrEqual(
      d.dailyTargetRides * d.dailyTargetMinRideFare,
    );
  });
});

describe('pktDayKey', () => {
  it('reads the Pakistan calendar day, not the UTC one', () => {
    expect(pktDayKey(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    expect(pktDayKey(new Date('2026-10-01T18:59:00Z'))).toBe('2026-10-01');
    // Midnight Karachi: the day rolls, and a short day becomes payable.
    expect(pktDayKey(new Date('2026-10-01T19:00:00Z'))).toBe('2026-10-02');
  });
});

describe('dailyTargetProgress', () => {
  it('counts down in rides and says which kind', () => {
    const p = dailyTargetProgress(day({ qualifyingRides: 9 }), settings());
    expect(p.target).toBe(16);
    expect(p.ridesToGo).toBe(7);
    expect(p.poolOnly).toBe(true);
    expect(p.blockers.find((b) => b.key === 'rides')!.label).toBe('16 pool rides of PKR 150+');
  });

  it('drops the word "pool" when the admin turns pool-only off', () => {
    const p = dailyTargetProgress(day(), settings({ dailyTargetPoolOnly: false }));
    expect(p.blockers.find((b) => b.key === 'rides')!.label).toBe('16 rides of PKR 150+');
  });

  it('names every unmet condition, not just the ride count', () => {
    const p = dailyTargetProgress(
      day({ qualifyingRides: 16, riderIds: ['friend'], grossFare: 1600 }),
      settings(),
    );
    expect(p.met).toBe(false);
    expect(p.blockers.map((b) => b.key).sort()).toEqual(['dayFare', 'riders']);
    expect(p.blockers.find((b) => b.key === 'riders')).toMatchObject({ have: 1, need: 5 });
  });

  it('frees the day only when every condition clears', () => {
    const p = dailyTargetProgress(
      day({ qualifyingRides: 16, riderIds: riders(5), grossFare: 4800 }),
      settings(),
    );
    expect(p.met).toBe(true);
    expect(p.blockers).toEqual([]);
    expect(p.bonus).toBe(0);
    expect(p.commissionWaived).toBe(true);
  });

  it('keeps the waiver on a day already granted, even if the target is raised', () => {
    const granted = day({ qualifyingRides: 16, granted: true, riderIds: ['a'], grossFare: 100 });
    const p = dailyTargetProgress(granted, settings({ dailyTargetRides: 30 }));
    expect(p.met).toBe(false);
    expect(p.granted).toBe(true);
    expect(p.commissionWaived).toBe(true);
  });

  it('recognises a day written before `granted` existed by its bonus', () => {
    expect(dailyTargetProgress(day({ bonusGranted: 2000 }), settings()).granted).toBe(true);
  });

  it('never waives when the admin has the waiver switched off', () => {
    const met = day({ qualifyingRides: 16, riderIds: riders(5), grossFare: 4800 });
    const p = dailyTargetProgress(met, settings({ dailyTargetWaivesCommission: false }));
    expect(p.met).toBe(true);
    expect(p.commissionWaived).toBe(false);
  });

  it('shows nothing at all while the programme is off', () => {
    const p = dailyTargetProgress(day(), settings({ dailyTargetEnabled: false }));
    expect(p.enabled).toBe(false);
    expect(p.commissionWaived).toBe(false);
  });

  it('drops every check the admin zeroes out', () => {
    const open = settings({
      dailyTargetMinRiders: 0,
      dailyTargetMinDayFare: 0,
      dailyTargetMinRideFare: 0,
    });
    expect(dailyTargetProgress(day({ qualifyingRides: 16 }), open).met).toBe(true);
  });
});
