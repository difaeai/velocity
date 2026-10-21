/**
 * The arithmetic that decides what the ads desk spends and when it stops.
 *
 * Everything that can move money is in `adsExpert.ts` and is pure, so the
 * cases worth being sure of are all here: the limit is never exceeded, a
 * learning campaign is left alone, a campaign burning money is paused, a winner
 * is scaled by a step that does not reset learning, and Meta's minor units are
 * right — Rs 500 is 50000, not 500.
 */
import { describe, expect, it } from 'vitest';

import {
  clampBudget,
  diagnose,
  forecast,
  fromMinor,
  learningBudget,
  localPlan,
  marketBenchmarks,
  metricsFrom,
  normalisePlan,
  ownBenchmarks,
  SCALE_EVERY_MS,
  toMinor,
  type AdMetrics,
} from '../adsExpert';

const bench = marketBenchmarks('PKR')!;
const NOW = Date.UTC(2026, 9, 21);

const metrics = (over: Partial<AdMetrics> = {}): AdMetrics => ({
  spend: 5000,
  impressions: 40_000,
  reach: 20_000,
  frequency: 2,
  linkClicks: 500,
  ctr: 1.25,
  cpc: 10,
  cpm: 125,
  results: 500,
  costPerResult: 10,
  ...over,
});

const judge = (m: AdMetrics, over: Partial<Parameters<typeof diagnose>[0]> = {}) =>
  diagnose({
    objective: 'traffic',
    m,
    bench,
    currency: 'PKR',
    active: true,
    dailyBudget: 1000,
    ageHours: 120,
    lastScaledMs: null,
    nowMs: NOW,
    ...over,
  });

describe('minor units', () => {
  it('sends rupees in paisa and reads them back', () => {
    expect(toMinor(500, 'PKR')).toBe(50_000);
    expect(fromMinor(50_000, 'PKR')).toBe(500);
  });

  it('leaves zero-decimal currencies whole', () => {
    expect(toMinor(500, 'JPY')).toBe(500);
  });
});

describe('clampBudget', () => {
  const base = { cap: 3000, committed: 1000, minDaily: 300, currency: 'PKR' };

  it('keeps a request that fits', () => {
    expect(clampBudget({ ...base, requested: 1500 })).toEqual({ budget: 1500, note: null });
  });

  it('never goes past what is left of the limit', () => {
    const out = clampBudget({ ...base, requested: 5000 });
    expect(out.budget).toBe(2000);
    expect(out.note).toMatch(/held to/);
  });

  it('refuses when the room left is below Meta’s minimum', () => {
    expect(clampBudget({ ...base, committed: 2900, requested: 500 }).budget).toBeNull();
  });

  it('refuses everything until a limit is set', () => {
    const out = clampBudget({ ...base, cap: 0, committed: 0, requested: 500 });
    expect(out.budget).toBeNull();
    expect(out.note).toMatch(/No daily limit/);
  });

  it('raises a tiny request to the minimum rather than wasting it', () => {
    expect(clampBudget({ ...base, requested: 50 }).budget).toBe(300);
  });
});

describe('diagnose', () => {
  it('leaves a young campaign alone', () => {
    expect(judge(metrics(), { ageHours: 20 }).grade).toBe('learning');
    expect(judge(metrics({ impressions: 400 })).action.kind).toBe('none');
  });

  it('says nothing more than "not running" about a paused one', () => {
    expect(judge(metrics(), { active: false }).grade).toBe('idle');
  });

  it('pauses a campaign burning money, with enough data to be sure', () => {
    const v = judge(metrics({ results: 60, costPerResult: 40, cpc: 40 }));
    expect(v.grade).toBe('bad');
    expect(v.action.kind).toBe('pause');
  });

  it('pauses on spend with nothing to show for it', () => {
    expect(judge(metrics({ results: 0, linkClicks: 0, ctr: 0, cpc: 0, costPerResult: 0, spend: 600 })).action.kind).toBe(
      'pause',
    );
  });

  it('asks for a new creative when nobody clicks', () => {
    const v = judge(metrics({ ctr: 0.5, impressions: 4000 }));
    expect(v.action.kind).toBe('refresh');
    expect(v.reasons.join(' ')).toMatch(/0\.50% click/);
  });

  it('calls a worn-out audience what it is', () => {
    const v = judge(metrics({ frequency: 4.2 }));
    expect(v.headline).toMatch(/worn out/);
    expect(v.action.kind).toBe('refresh');
  });

  it('scales a winner by twenty percent', () => {
    const v = judge(metrics({ costPerResult: 6, cpc: 6 }));
    expect(v.grade).toBe('good');
    expect(v.action).toMatchObject({ kind: 'scale', to: 1200 });
  });

  it('does not scale the same winner again within three days', () => {
    const v = judge(metrics({ costPerResult: 6, cpc: 6 }), { lastScaledMs: NOW - SCALE_EVERY_MS + 3600_000 });
    expect(v.grade).toBe('good');
    expect(v.action.kind).toBe('none');
  });

  it('is plain about having no yardstick', () => {
    expect(judge(metrics(), { bench: null }).action.kind).toBe('none');
  });
});

describe('metricsFrom', () => {
  it('reads Meta’s strings and derives the rates itself', () => {
    const m = metricsFrom(
      { spend: '1000', impressions: '10000', reach: '5000', inline_link_clicks: '100' },
      'link_click',
    );
    expect(m).toMatchObject({ ctr: 1, cpc: 10, cpm: 100, results: 100, frequency: 2, costPerResult: 10 });
  });

  it('prices reach per thousand people', () => {
    const m = metricsFrom({ spend: '1000', impressions: '20000', reach: '10000' }, 'reach');
    expect(m.costPerResult).toBe(100);
  });

  it('counts an action result from the actions list', () => {
    const m = metricsFrom({ spend: '100', actions: [{ action_type: 'post_engagement', value: '50' }] }, 'post_engagement');
    expect(m.results).toBe(50);
    expect(m.costPerResult).toBe(2);
  });

  it('is zero, not NaN, on an empty row', () => {
    expect(Object.values(metricsFrom({}, 'link_click')).every((v) => v === 0)).toBe(true);
  });
});

describe('benchmarks', () => {
  it('converts the rupee yardstick for a dollar account', () => {
    expect(marketBenchmarks('USD')!.cpc.typical).toBeCloseTo(9 / 280);
    expect(marketBenchmarks('EUR')).toBeNull();
  });

  it('switches to our own median once two real campaigns exist', () => {
    const own = ownBenchmarks([metrics({ cpc: 6 }), metrics({ cpc: 8 })], bench)!;
    expect(own.source).toBe('own');
    expect(own.cpc.typical).toBe(7);
    expect(ownBenchmarks([metrics({ cpc: 6 })], bench)!.source).toBe('pakistan');
  });

  it('sizes the learning budget for about fifty results a week', () => {
    expect(learningBudget('traffic', bench)).toBe(Math.ceil((50 / 7) * 9 * 1.2));
  });

  it('forecasts a range, cheapest-case to dearest-case', () => {
    const f = forecast({ objective: 'traffic', dailyBudget: 1000, days: 7, bench });
    expect(f.spend).toBe(7000);
    expect(f.results).toEqual([350, 1750]);
  });
});

describe('plans', () => {
  const fallback = localPlan({ brief: 'Drivers in Lahore and Karachi, sign up this week.', bench, maxDays: 14 });

  it('reads the cities and the audience out of a brief with no model', () => {
    expect(fallback.audience.cities).toEqual(['Karachi', 'Lahore']);
    expect(fallback.audience.ageMin).toBe(21);
    expect(fallback.objective).toBe('traffic');
  });

  it('clamps whatever the model sends', () => {
    const plan = normalisePlan(
      {
        objective: 'sales',
        audience: { ageMin: 10, ageMax: 99, genders: 'robots', cities: ['Lahore'] },
        days: 90,
        cta: 'BUY_NOW',
        lines: [],
        dailyBudget: 'lots',
      },
      fallback,
      14,
    );
    expect(plan.objective).toBe(fallback.objective);
    expect(plan.audience).toMatchObject({ ageMin: 18, ageMax: 65, genders: 'all', cities: ['Lahore'] });
    expect(plan.days).toBe(14);
    expect(plan.cta).toBe(fallback.cta);
    expect(plan.lines).toEqual(fallback.lines);
    expect(plan.dailyBudget).toBe(fallback.dailyBudget);
  });
});
