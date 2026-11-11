/**
 * A customer gets what they paid for and nothing else, and only while a trial
 * or a paid month runs. Pure rules, no database.
 */
import { describe, expect, it } from 'vitest';

import { PERIOD_MS, PKR_PER_USD, PLAN_IDS, PLANS, TRIAL_MS, YEAR_MS, canUse, extendPaid, paidAfter, pricePkr, priceUsd, refusal, startTerms } from '../plans';
import { PRICE_GRACE_MS, PRICE_WINDOW_MS, priceState } from '../priceClock';

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
    expect(canUse({ ...live, plan: 'research' }, 'research', NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'research' }, 'content', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'research' }, 'ads', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'research' }, 'sales', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'content' }, 'research', NOW)).toBe(false);
    expect(canUse({ ...live, plan: 'all' }, 'research', NOW)).toBe(true);
  });

  it('opens a page two plans share to either of them, and to nobody else', () => {
    expect(canUse({ ...live, plan: 'research' }, ['content', 'research'], NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'content' }, ['content', 'research'], NOW)).toBe(true);
    expect(canUse({ ...live, plan: 'sales' }, ['content', 'research'], NOW)).toBe(false);
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
    expect(refusal({ ...live, plan: 'content' }, 'sales', NOW)).toMatch(/does not include the sales, calling and email agents/);
    expect(refusal({ ...live, plan: 'research' }, 'ads', NOW)).toMatch(
      /Research Assistant for Social Media plan does not include the Meta & Google Ad Expert/,
    );
    expect(refusal({ ...live, plan: 'sales' }, ['content', 'research'], NOW)).toMatch(/does not include the content team/);
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
    // 32 days of Content ($26) are worth 26 days of the whole team ($32).
    expect(paidAfter({ plan: 'content', paidUntilMs: NOW + 32 * DAY }, 'all', NOW)).toBe(NOW + 26 * DAY + PERIOD_MS);
  });
  it('keeps their worth on a downgrade, so nothing paid is thrown away', () => {
    expect(paidAfter({ plan: 'all', paidUntilMs: NOW + 26 * DAY }, 'content', NOW)).toBe(NOW + 32 * DAY + PERIOD_MS);
  });
});

describe('the $2 rise after a customer’s 3 days', () => {
  it('adds $2 a month, and a year is still twelve of those less 3%', () => {
    expect(PLAN_IDS.map((id) => priceUsd(id, 'month', true))).toEqual([22, 28, 34]);
    expect(PLAN_IDS.map((id) => priceUsd(id, 'year', true))).toEqual([256.08, 325.92, 395.76]);
    expect(pricePkr('content', 'month', true)).toBe(28 * PKR_PER_USD);
    expect(pricePkr('research', 'year', true)).toBe(71703);
  });

  it('holds the old price through the window and the grace after it, then raises it', () => {
    const start = 1_000_000;
    expect(priceState(start, start)).toEqual({ leftMs: PRICE_WINDOW_MS, raised: false });
    expect(priceState(start, start + PRICE_WINDOW_MS)).toEqual({ leftMs: 0, raised: false });
    expect(priceState(start, start + PRICE_WINDOW_MS + PRICE_GRACE_MS - 1).raised).toBe(false);
    expect(priceState(start, start + PRICE_WINDOW_MS + PRICE_GRACE_MS).raised).toBe(true);
  });
});

describe('priceUsd', () => {
  it('charges the monthly price for a month', () => {
    expect(priceUsd('content', 'month')).toBe(PLANS.content.usd);
  });
  it('prices a year at the figures the site shows', () => {
    expect([priceUsd('research', 'year'), priceUsd('content', 'year'), priceUsd('all', 'year')]).toEqual([232.8, 302.64, 372.48]);
  });
  it('sells the Research Assistant, Content and the whole team, left to right — not the old sales-only or ads-only plans', () => {
    expect(PLAN_IDS).toEqual(['research', 'content', 'all']);
    expect([PLANS.research.usd, PLANS.content.usd, PLANS.all.usd]).toEqual([20, 26, 32]);
    expect(PLANS.research.name).toBe('Research Assistant for Social Media');
    expect(PLANS.all.name).toBe('Social Media Manager + Meta & Google Ad Expert');
    // The whole team carries the sales, calling and email agents the old Sales plan sold on their own.
    expect(PLANS.all.can).toEqual(expect.arrayContaining(['research', 'content', 'ads', 'sales']));
  });
  it('takes exactly 3% off twelve months, never more, and nothing off a month', () => {
    for (const id of PLAN_IDS) {
      expect(priceUsd(id, 'year')).toBeCloseTo(PLANS[id].usd * 12 * 0.97, 10);
      expect(priceUsd(id, 'month')).toBe(PLANS[id].usd);
    }
  });
  it('asks for whole rupees, rounded up so a year never saves more than 3%', () => {
    expect(PLAN_IDS.map((id) => pricePkr(id, 'year'))).toEqual([65184, 84740, 104295]);
    for (const id of PLAN_IDS) {
      expect(Number.isInteger(pricePkr(id, 'year'))).toBe(true);
      expect(pricePkr(id, 'year')).toBeGreaterThanOrEqual(pricePkr(id, 'month') * 12 * 0.97);
      expect(pricePkr(id, 'month')).toBe(PLANS[id].usd * PKR_PER_USD);
    }
  });
});

describe('startTerms', () => {
  it('gives the day that was paid for, and no paid time with it', () => {
    const trial = startTerms({ plan: 'all', billing: 'month', paymentId: 'p0', atMs: NOW, trial: true }, NOW);
    expect(trial).toEqual({ trialEndsAtMs: NOW + TRIAL_MS, paidUntilMs: 0, accessUntilMs: NOW + TRIAL_MS });
    // A day of the whole team is still the whole team, for that day.
    expect(canUse({ ...trial, plan: 'all' }, 'ads', NOW)).toBe(true);
    expect(canUse({ ...trial, plan: 'all' }, 'ads', NOW + TRIAL_MS + 1)).toBe(false);
  });

  it('starts a prepaid workspace paid, with no trial, for a month or a year', () => {
    const month = startTerms({ plan: 'all', billing: 'month', paymentId: 'p1', atMs: NOW }, NOW);
    expect(month).toEqual({ trialEndsAtMs: NOW, paidUntilMs: NOW + PERIOD_MS, accessUntilMs: NOW + PERIOD_MS });
    expect(canUse({ ...month, plan: 'all' }, 'sales', NOW)).toBe(true);
    expect(startTerms({ plan: 'content', billing: 'year', paymentId: 'p2', atMs: NOW }, NOW).paidUntilMs).toBe(NOW + YEAR_MS);
  });
});
