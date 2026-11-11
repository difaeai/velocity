/**
 * "Time to book your ride": when a saved route's reminder is due, and what
 * counts as a ride going your way (pure logic, no emulator).
 *
 * Two things have to hold or the reminder is worse than none: the window must
 * be at least as wide as the job's period, or a route falls between two runs
 * and nobody is ever reminded; and it must wrap midnight, or a night-shift
 * route is due at the wrong end of the clock.
 */
import { describe, it, expect } from 'vitest';
import { LEAD_MIN, pktDay, pktMinutes, reminderDue, ridesOnRoute } from '../reminders';

/** The cron's period. The due window must cover at least this, or runs can skip a route. */
const JOB_PERIOD_MIN = 15;

describe('reminderDue', () => {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h! * 60 + m!;
  };

  it('is due inside the lead time before the route, and not after it', () => {
    expect(reminderDue('09:00', at('08:45'))).toBe(true);
    expect(reminderDue('09:00', at('08:41'))).toBe(true);
    expect(reminderDue('09:00', at('09:00'))).toBe(true);
    // Past its time: the ride is now, the reminder is not.
    expect(reminderDue('09:00', at('09:01'))).toBe(false);
    expect(reminderDue('09:00', at('08:30'))).toBe(false);
  });

  it('covers the whole window between two runs of the job', () => {
    expect(LEAD_MIN).toBeGreaterThanOrEqual(JOB_PERIOD_MIN);
    // Whenever the job happens to land, every route's window catches a run.
    for (let offset = 0; offset < JOB_PERIOD_MIN; offset++) {
      const runs = [];
      for (let m = offset; m < 1440; m += JOB_PERIOD_MIN) runs.push(m);
      expect(runs.some((m) => reminderDue('09:00', m))).toBe(true);
    }
  });

  it('wraps past midnight for a night shift', () => {
    expect(reminderDue('00:05', at('23:50'))).toBe(true);
    expect(reminderDue('23:55', at('00:05'))).toBe(false);
  });

  it('has nothing to remind about without a time', () => {
    expect(reminderDue(null, 500)).toBe(false);
    expect(reminderDue(undefined, 500)).toBe(false);
    expect(reminderDue('any', 500)).toBe(false);
    expect(reminderDue('25:00', 500)).toBe(false);
  });
});

describe('the Pakistan clock', () => {
  it('reads minutes and the day in PKT, not UTC', () => {
    // 20:30 UTC is 01:30 the next day in Karachi.
    const t = new Date('2026-11-11T20:30:00Z');
    expect(pktMinutes(t)).toBe(90);
    expect(pktDay(t)).toBe('2026-11-12');
  });
});

describe('ridesOnRoute', () => {
  // F-8 Markaz → PWD, about 20 km: far enough apart that the same route the
  // other way round is a different trip (it is, under a 3 km match).
  const route = {
    pickup: { lat: 33.7, lng: 73.05, address: 'F-8 Markaz, Islamabad' },
    dropoff: { lat: 33.52, lng: 73.11, address: 'PWD, Islamabad' },
  };

  it('counts a ride whose two ends are both near the route', () => {
    expect(ridesOnRoute(route, [{ pickup: { lat: 33.702, lng: 73.052 }, dropoff: { lat: 33.521, lng: 73.112 } }])).toBe(1);
  });

  it('ignores one that only shares an end, or the same route backwards', () => {
    expect(ridesOnRoute(route, [{ pickup: { lat: 33.702, lng: 73.052 }, dropoff: { lat: 33.9, lng: 73.4 } }])).toBe(0);
    expect(ridesOnRoute(route, [{ pickup: route.dropoff, dropoff: route.pickup }])).toBe(0);
  });

  it('ignores a half-written ride', () => {
    expect(ridesOnRoute(route, [{ pickup: { lat: 33.7, lng: 73.05 } }, {}])).toBe(0);
  });
});
