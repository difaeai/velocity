/**
 * Credits: a day of the team's work at a time, spent only when the team would
 * otherwise stop, never twice in one Pakistan day. Pure rules, no database.
 */
import { describe, expect, it } from 'vitest';

import { CREDIT_SOON_MS, applyCreditDay, creditDue, pktDay } from '../credits';

const DAY = 86_400_000;
// 27 Oct 2026, 15:00 PKT.
const NOW = Date.UTC(2026, 9, 27, 10);
const paid = { trialEndsAtMs: NOW - 9 * DAY, paidUntilMs: NOW + 10 * DAY, creditDays: 5 };

describe('creditDue', () => {
  it('waits while the plan runs and the month’s AI is not used up', () => {
    expect(creditDue(paid, NOW, false)).toBeNull();
  });

  it('spends one when the plan has run out, or is about to before the next sweep', () => {
    expect(creditDue({ ...paid, paidUntilMs: NOW - 1 }, NOW, false)).toBe('lapsed');
    expect(creditDue({ ...paid, paidUntilMs: NOW + CREDIT_SOON_MS - 1 }, NOW, false)).toBe('lapsed');
    expect(creditDue({ ...paid, paidUntilMs: NOW + CREDIT_SOON_MS + 60_000 }, NOW, false)).toBeNull();
  });

  it('spends one when the month’s AI allowance is used up', () => {
    expect(creditDue(paid, NOW, true)).toBe('allowance');
  });

  it('never with no credits left, once already today, or while paused', () => {
    expect(creditDue({ ...paid, creditDays: 0 }, NOW, true)).toBeNull();
    expect(creditDue({ ...paid, creditDayOn: pktDay(NOW) }, NOW, true)).toBeNull();
    expect(creditDue({ ...paid, creditDayOn: pktDay(NOW - DAY) }, NOW, true)).toBe('allowance');
    expect(creditDue({ ...paid, suspended: true }, NOW, true)).toBeNull();
  });

  it('counts the day in Pakistan, not UTC', () => {
    // 23:30 UTC on the 27th is 04:30 PKT on the 28th.
    expect(pktDay(Date.UTC(2026, 9, 27, 23, 30))).toBe('2026-10-28');
  });
});

describe('applyCreditDay', () => {
  it('a lapsed plan gets 24 hours from where access ended, and one credit fewer', () => {
    const ended = NOW - 3600_000;
    const after = applyCreditDay({ ...paid, paidUntilMs: ended }, 'lapsed', NOW);
    expect(after).toMatchObject({ creditDays: 4, creditDayOn: pktDay(NOW) });
    // Ended an hour ago: the day starts now, not back-dated.
    expect(after.paidUntilMs).toBe(NOW + DAY);
    expect(after.accessUntilMs).toBe(NOW + DAY);

    const soon = NOW + 20 * 60_000;
    expect(applyCreditDay({ ...paid, paidUntilMs: soon }, 'lapsed', NOW).paidUntilMs).toBe(soon + DAY);
  });

  it('carries a trial straight on', () => {
    const trialEnd = NOW + 10 * 60_000;
    const after = applyCreditDay({ trialEndsAtMs: trialEnd, paidUntilMs: 0, creditDays: 1 }, 'lapsed', NOW);
    expect(after.paidUntilMs).toBe(trialEnd + DAY);
    expect(after.creditDays).toBe(0);
  });

  it('a day bought for the allowance never adds paid time to a plan that still runs', () => {
    expect(applyCreditDay(paid, 'allowance', NOW).paidUntilMs).toBe(paid.paidUntilMs);
    // …but keeps the team open for that day if the plan would end inside it.
    const lastHours = { ...paid, paidUntilMs: NOW + 2 * 3600_000 };
    expect(applyCreditDay(lastHours, 'allowance', NOW).paidUntilMs).toBe(NOW + DAY);
  });
});
