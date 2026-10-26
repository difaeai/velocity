/**
 * The test audience an ad meets before Meta: a weak ad gets one rewrite, and
 * only a rewrite that scores better replaces the original. The model is
 * replaced by fixed panels, so this tests the decision, not the model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const replies = vi.hoisted(() => ({ queue: [] as unknown[] }));
vi.mock('../engine', async (orig) => ({
  ...(await orig<typeof import('../engine')>()),
  modelReady: () => true,
  generateJson: async () => ({ data: replies.queue.shift(), sources: [] }),
}));
vi.mock('../settings', async (orig) => ({
  ...(await orig<typeof import('../settings')>()),
  getSocialSettings: async () => ({ textModel: 'test-model' }),
}));

import { pretestAd } from '../ads';
import type { AdPlanSpec } from '../adsExpert';

const people = (wouldBuy: 'yes' | 'maybe' | 'no', n = 10) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, who: 'x', reaction: 'r', wouldBuy, objection: wouldBuy === 'no' ? 'too pricey' : '', wouldShare: false }));

const plan = (): AdPlanSpec => ({
  name: 'Drivers in Lahore',
  objective: 'traffic',
  audience: { cities: ['Lahore'], ageMin: 21, ageMax: 45, genders: 'all', interests: [] },
  dailyBudget: 500,
  days: 5,
  format: 'image',
  primaryText: 'old text',
  headline: 'old headline',
  cta: 'LEARN_MORE',
  lines: ['old hook'],
  why: '',
});

beforeEach(() => {
  replies.queue.length = 0;
});

describe('pretestAd', () => {
  it('keeps an ad the panel wants, without a second run', async () => {
    replies.queue.push({ panel: people('yes'), rewrite: { headline: 'unused' } });
    const p = plan();
    const t = await pretestAd(p);
    expect(t).toMatchObject({ verdict: 'go', rewritten: false, firstScore: null });
    expect(p.headline).toBe('old headline');
    expect(replies.queue).toHaveLength(0);
  });

  it('rewrites a weak ad when the rewrite scores better', async () => {
    replies.queue.push({ panel: people('no'), rewrite: { headline: 'new headline', lines: ['new hook'] } });
    replies.queue.push({ panel: people('yes'), rewrite: {} });
    const p = plan();
    const t = await pretestAd(p);
    expect(t).toMatchObject({ verdict: 'go', rewritten: true, firstScore: 0 });
    expect(p.headline).toBe('new headline');
    expect(p.lines).toEqual(['new hook']);
  });

  it('puts the original back when the rewrite does no better, and says the panel was not convinced', async () => {
    replies.queue.push({ panel: people('no'), rewrite: { headline: 'new headline' } });
    replies.queue.push({ panel: people('no'), rewrite: {} });
    const p = plan();
    const t = await pretestAd(p);
    expect(t).toMatchObject({ verdict: 'not_yet', rewritten: false, objections: ['too pricey'] });
    expect(p.headline).toBe('old headline');
  });
});
