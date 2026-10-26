/**
 * A customer gets what they paid for and nothing else, and only while a trial
 * or a paid month runs. Pure rules, no database.
 */
import { describe, expect, it } from 'vitest';

import { PERIOD_MS, PLAN_IDS, PLANS, YEAR_MS, canUse, extendPaid, paidAfter, priceUsd, refusal } from '../plans';

const NOW = 1_800_000_000_000;
const live = { trialEndsAtMs: NOW + 1000, paidUntilMs: 0 };

describe('canUse', () => {
  it('gives each plan exactly its parts', () => {
    expect(canUse({ ...live, plan: 'content' }, 'content', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'content' }, 'ads', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'content' }, 'sales', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'sales' }, 'sales', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'sales' }, 'content', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'sales' }, 'ads', NOW)).toBe(false);
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
  it('adds a year for a yearly payment', () => {
    expect(extendPaid(NOW + 10, NOW, YEAR_MS)).toBe(NOW + 10 + YEAR_MS);
  });
});

describe('paidAfter', () => {
  const DAY = 86_400_000;
  it('is extendPaid on the same plan, or when nothing paid is left', () => {
    expect(paidAfter({ plan: 'content', paidUntilMs: NOW + 5 * DAY }, 'content', NOW)).toBe(NOW + 5 * DAY + PERIOD_MS);
    expect(paidAfter({ plan: 'content', paidUntilMs: NOW - DAY }, 'all', NOW)).toBe(NOW + PERIOD_MS);
    expect(paidAfter({ plan: 'ads', paidUntilMs: 0 }, 'all', NOW, YEAR_MS)).toBe(NOW + YEAR_MS);
  });
  it('converts the days left on an upgrade at what they were worth', () => {
    // 32 days of Content ($24) are worth 24 days of the whole team ($32).
    expect(paidAfter({ plan: 'content', paidUntilMs: NOW + 32 * DAY }, 'all', NOW)).toBe(NOW + 24 * DAY + PERIOD_MS);
  });
  it('keeps their worth on a downgrade, so nothing paid is thrown away', () => {
    expect(paidAfter({ plan: 'all', paidUntilMs: NOW + 24 * DAY }, 'content', NOW)).toBe(NOW + 32 * DAY + PERIOD_MS);
  });
});

describe('priceUsd', () => {
  it('charges the monthly price for a month', () => {
    expect(priceUsd('content', 'month')).toBe(PLANS.content.usd);
  });
  it('prices a year at the figures the site shows', () => {
    expect([priceUsd('sales', 'year'), priceUsd('content', 'year'), priceUsd('all', 'year')]).toEqual([177, 250, 334]);
  });
  it('sells Sales agents, Content and the whole team, left to right — not the old ads-only plan', () => {
    expect(PLAN_IDS).toEqual(['sales', 'content', 'all']);
    expect([PLANS.sales.usd, PLANS.content.usd, PLANS.all.usd]).toEqual([17, 24, 32]);
    expect(PLANS.all.name).toMatch(/Meta Ad Expert.*Everything/);
  });
  it('never saves less than 13% on twelve months', () => {
    for (const id of PLAN_IDS) expect(priceUsd(id, 'year')).toBeLessThanOrEqual(PLANS[id].usd * 12 * 0.87);
  });
});
