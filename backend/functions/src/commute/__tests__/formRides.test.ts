/**
 * The morning nudge that turns a matched commute into a real shared ride.
 * ----------------------------------------------------------------------------
 * The window arithmetic is the whole correctness story here, and it is the part
 * that is invisible in production: a nudge that fires at the wrong minute is
 * either useless (the rider has already left) or harmful (a second push about a
 * ride they just booked). So it is a pure function and it is tested as one.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect } from 'vitest';

import { isNudgeDue, nudgeBody, karachiNow } from '../formRides';

/** The common case: a weekday commuter leaving at 08:30. */
const WEEKDAY = {
  activeDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  morningTime: '08:30',
  active: true,
  lastNudgeDate: null,
  nowDay: 'mon',
  todayDate: '2026-10-12',
};

/** 08:30 is 510 minutes past midnight. */
const DEPART = 8 * 60 + 30;

describe('isNudgeDue', () => {
  it('fires ten minutes before departure', () => {
    // 08:20 — the rider has time to get downstairs and the first tapper's
    // gathering window will still be open when the others are ready.
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 10 })).toBe(true);
  });

  it('does not fire too early', () => {
    // An hour out the rider is not going anywhere yet, and a pool opened now
    // would stop gathering before anybody left the house.
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 60 })).toBe(false);
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 21 })).toBe(false);
  });

  it('does not fire once the departure has passed', () => {
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART })).toBe(false);
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART + 5 })).toBe(false);
  });

  it('covers every minute in between, so a ten-minute cron cannot skip a rider', () => {
    // The window must be at least as wide as the cron interval or a departure
    // falling between two ticks is never nudged at all. Every minute from
    // now+10 to now+19 inclusive has to be caught by some tick.
    const caught = [];
    for (let tick = DEPART - 20; tick <= DEPART; tick += 10) {
      if (isNudgeDue({ ...WEEKDAY, nowMinutes: tick })) caught.push(tick);
    }
    expect(caught).toHaveLength(1);
  });

  it('respects the days the rider actually travels', () => {
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 10, nowDay: 'sun' })).toBe(false);
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 10, nowDay: 'fri' })).toBe(true);
  });

  it('never nudges the same rider twice in a day', () => {
    // Claimed before anything is sent, so an overlapping tick or a crash
    // halfway through a run cannot double up.
    expect(isNudgeDue({
      ...WEEKDAY, nowMinutes: DEPART - 10, lastNudgeDate: '2026-10-12',
    })).toBe(false);
    // Yesterday's claim does not block today.
    expect(isNudgeDue({
      ...WEEKDAY, nowMinutes: DEPART - 10, lastNudgeDate: '2026-10-11',
    })).toBe(true);
  });

  it('ignores a schedule the rider switched off', () => {
    expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 10, active: false })).toBe(false);
  });

  it('ignores a malformed time rather than firing at midnight', () => {
    for (const morningTime of ['', 'half eight', '8', ':30']) {
      expect(isNudgeDue({ ...WEEKDAY, nowMinutes: DEPART - 10, morningTime })).toBe(false);
    }
  });
});

describe('nudgeBody', () => {
  it('says how many, and never who', () => {
    const body = nudgeBody(3, 3, 0);
    expect(body).toContain('3 women');
    // A stranger's daily movements are not ours to broadcast.
    expect(body).not.toMatch(/\b(uid|@)\b/);
  });

  it('names the company the way a rider would ask about it', () => {
    expect(nudgeBody(1, 1, 0)).toContain('1 woman');
    expect(nudgeBody(1, 0, 1)).toContain('1 man');
    expect(nudgeBody(2, 0, 2)).toContain('2 men');
    // Mixed: no gender claim at all, just a count.
    expect(nudgeBody(3, 1, 2)).toContain('3 riders');
  });

  it('agrees with itself grammatically', () => {
    expect(nudgeBody(1, 1, 0)).toContain('is leaving');
    expect(nudgeBody(2, 2, 0)).toContain('are leaving');
  });
});

describe('karachiNow', () => {
  it('reads a UTC instant as Pakistan local time', () => {
    // 2026-10-12T03:05:00Z is 08:05 in Karachi (UTC+5), a Monday.
    const at = new Date('2026-10-12T03:05:00Z');
    expect(karachiNow(at)).toEqual({
      day: 'mon',
      minutes: 8 * 60 + 5,
      date: '2026-10-12',
    });
  });

  it('rolls the date over at Karachi midnight, not UTC midnight', () => {
    // 2026-10-12T19:30:00Z is already 00:30 on the 13th in Karachi. A cron that
    // used UTC here would claim the wrong day and nudge a rider twice.
    const at = new Date('2026-10-12T19:30:00Z');
    const now = karachiNow(at);
    expect(now.date).toBe('2026-10-13');
    expect(now.day).toBe('tue');
    expect(now.minutes).toBe(30);
  });
});
