/**
 * The AI meter and the budget: what a Gemini call costs, which part of the
 * product made it, and that a workspace which has spent its month stops
 * reaching Gemini while the others carry on.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { budgetFor, DEFAULT_BUDGETS, geminiKey, keySource, noteSpend, overBudget, resetAiCache, usageId, withinPace } from '../config';
import { countPlanned } from '../../social/strategy';
import { costUsd, featureOf, priceFor, readUsage } from '../usage';

const saved = { research: process.env.GEMINI_KEY_RESEARCH, live: process.env.GEMINI_LIVE_KEY };

afterEach(() => {
  resetAiCache();
  for (const [k, v] of [
    ['GEMINI_KEY_RESEARCH', saved.research],
    ['GEMINI_LIVE_KEY', saved.live],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('the meter', () => {
  it('reads the Interactions API usage block, thinking counted as output', () => {
    expect(
      readUsage({ total_input_tokens: 1000, total_tool_use_tokens: 200, total_output_tokens: 300, total_thought_tokens: 700, grounding_tool_count: 1 }),
    ).toEqual({ inTok: 1200, outTok: 1000, grounded: 1 });
    expect(readUsage(undefined)).toEqual({ inTok: 0, outTok: 0, grounded: 0 });
    expect(readUsage({ total_input_tokens: 'lots' })).toEqual({ inTok: 0, outTok: 0, grounded: 0 });
  });

  it('prices by the model, and an unknown one reads as dear rather than free', () => {
    expect(costUsd('gemini-2.5-flash', { inTok: 1_000_000, outTok: 1_000_000 })).toBeCloseTo(2.8, 6);
    expect(costUsd('models/gemini-3.8-flash-tts', { inTok: 0, outTok: 1_000_000 })).toBeCloseTo(9, 6);
    expect(priceFor('gemini-9-flash-new')).toEqual(priceFor('gemini-3.8-flash'));
    expect(priceFor('gemini-9-pro').out).toBeGreaterThan(priceFor('gemini-3.8-flash').out);
  });

  it('puts each Cloud Run service under the part of the product it belongs to', () => {
    expect(featureOf('socialdailycontent')).toBe('content');
    expect(featureOf('admingeneratesocialpost')).toBe('content');
    expect(featureOf('socialadssync')).toBe('ads');
    expect(featureOf('admindesignad')).toBe('ads');
    expect(featureOf('salessweep')).toBe('sales');
    expect(featureOf('agentwhatsappwebhook')).toBe('agents');
    expect(featureOf('loghelplinecall')).toBe('helpline');
    expect(featureOf('sendsupportmessage')).toBe('support');
    expect(featureOf('socialengagement')).toBe('comments');
    expect(featureOf('adminlaunchmarket')).toBe('launch');
    expect(featureOf('local')).toBe('other');
  });

  it('keeps one row per workspace per month', () => {
    expect(usageId('wsA', '2026-10')).toBe('2026-10_wsA');
  });
});

describe('budgets', () => {
  it('the house is uncapped by default, a customer gets the default or their own figure', () => {
    expect(budgetFor('velocity', DEFAULT_BUDGETS)).toBe(0);
    expect(budgetFor('wsA', DEFAULT_BUDGETS)).toBe(3);
    expect(budgetFor('wsA', { ...DEFAULT_BUDGETS, perWorkspace: { wsA: 10 } })).toBe(10);
  });

  it('a customer who has spent the month is over budget; the uncapped house never is', () => {
    expect(overBudget('wsA')).toBe(false);
    noteSpend('wsA', 2.5);
    expect(overBudget('wsA')).toBe(false);
    noteSpend('wsA', 0.6);
    expect(overBudget('wsA')).toBe(true);
    expect(overBudget('wsB')).toBe(false);
    noteSpend('velocity', 500);
    expect(overBudget('velocity')).toBe(false);
  });
});

describe('pacing a month’s budget', () => {
  // 10 Nov 2026, noon PKT: day 10 of 30.
  const NOV_10 = Date.UTC(2026, 10, 10, 7);
  it('lets a third of a $30 month go by day 10, and no more', () => {
    expect(withinPace(9.99, 30, NOV_10)).toBe(true);
    expect(withinPace(10, 30, NOV_10)).toBe(false);
  });
  it('carries unused days forward, and never paces with no budget', () => {
    expect(withinPace(0, 30, Date.UTC(2026, 10, 1, 7))).toBe(true);
    expect(withinPace(29, 30, Date.UTC(2026, 10, 30, 7))).toBe(true);
    expect(withinPace(1_000, 0, NOV_10)).toBe(true);
  });
});

describe('what a month plan asks for', () => {
  it('counts each day’s planned pieces, the rotation on unplanned days, and the daily story', () => {
    const days = { '2026-11-01': [{ format: 'reel' as const }, { format: 'post' as const }], '2026-11-02': [{ format: 'story' as const }] };
    const n = countPlanned(days, '2026-11', 1, true);
    // 1 reel + 1 story on the 1st; the story itself on the 2nd; rotation + story on the other 28 days.
    expect(n.byFormat).toEqual({ reel: 1, story: 30, rotation: 28 });
    expect(n.pieces).toBe(59);
  });
});

describe('keys', () => {
  it('falls back to the deploy secrets, voice to its own first', () => {
    process.env.GEMINI_KEY_RESEARCH = 'house-key';
    delete process.env.GEMINI_LIVE_KEY;
    expect(geminiKey('house')).toBe('house-key');
    expect(geminiKey('customers')).toBe('house-key');
    expect(geminiKey('voice')).toBe('house-key');
    expect(keySource('house')).toBe('deploy');
    expect(keySource('customers')).toBe('house');
    process.env.GEMINI_LIVE_KEY = 'live-key';
    expect(geminiKey('voice')).toBe('live-key');
    expect(keySource('voice')).toBe('deploy');
  });

  it('says so when there is no key at all', () => {
    delete process.env.GEMINI_KEY_RESEARCH;
    delete process.env.GEMINI_LIVE_KEY;
    expect(geminiKey('house')).toBe('');
    expect(keySource('customers')).toBe('missing');
  });
});
