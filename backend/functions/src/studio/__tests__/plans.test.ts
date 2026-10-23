/**
 * A customer gets what they paid for and nothing else, and only while a trial
 * or a paid month runs. Pure rules, no database.
 */
import { describe, expect, it } from 'vitest';

import { PERIOD_MS, canUse, extendPaid, refusal } from '../plans';

const NOW = 1_800_000_000_000;
const live = { trialEndsAtMs: NOW + 1000, paidUntilMs: 0 };

describe('canUse', () => {
  it('gives each plan exactly its parts', () => {
    expect(canUse({ ...live, plan: 'content' }, 'content', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'content' }, 'ads', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'content' }, 'sales', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'ads' }, 'ads', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'ads' }, 'content', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'all' }, 'sales', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'all' }, 'content', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'all' }, 'ads', NOW)).toBe(true);
  });

  it('lets any live plan reach the shared parts', () => {
    expect(canUse({ ...live, plan: 'ads' }, 'any', NOW)).toBe(true);
  });

  it('stops everything once the trial and the paid month are both over', () => {
    const over = { plan: 'all' as const, trialEndsAtMs: NOW - 1, paidUntilMs: NOW - 1 };
    expect(canUse(over, 'any', NOW)).toBe(false);
    expect(canUse(over, 'content', NOW)).toBe(false);
  });

  it('keeps a paid month going after the trial ends', () => {
    expect(canUse({ plan: 'content', trialEndsAtMs: NOW - 1, paidUntilMs: NOW + 1 }, 'content', NOW)).toBe(true);
  });
});

describe('refusal', () => {
  it('says the free day is over before anything is paid', () => {
    expect(refusal({ plan: 'content', trialEndsAtMs: NOW - 1, paidUntilMs: 0 }, 'content', NOW)).toMatch(/free day is over/);
  });
  it('says the plan ran out once something was paid', () => {
    expect(refusal({ plan: 'content', trialEndsAtMs: NOW - 9, paidUntilMs: NOW - 1 }, 'content', NOW)).toMatch(/run out/);
  });
  it('names what the plan lacks', () => {
    expect(refusal({ ...live, plan: 'content' }, 'sales', NOW)).toMatch(/does not include the sales agent/);
  });
  it('is null when allowed', () => {
    expect(refusal({ ...live, plan: 'all' }, 'sales', NOW)).toBeNull();
  });
});

describe('extendPaid', () => {
  it('adds a month from now when nothing is running', () => {
    expect(extendPaid(0, NOW)).toBe(NOW + PERIOD_MS);
    expect(extendPaid(NOW - 5, NOW)).toBe(NOW + PERIOD_MS);
  });
  it('adds a month to the end of the paid time, so paying early loses nothing', () => {
    expect(extendPaid(NOW + 10, NOW)).toBe(NOW + 10 + PERIOD_MS);
  });
});
