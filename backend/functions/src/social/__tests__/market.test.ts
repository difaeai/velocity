/**
 * The launch market analysis is model output the whole desk then plans from,
 * so its shape is held in code — and the audience test's verdict is decided by
 * arithmetic, never by the model that played the panel.
 */
import { describe, expect, it } from 'vitest';

import {
  asResearch,
  mergeResearch,
  normaliseAnalysis,
  personas,
  topObjections,
  verdictFor,
  type MarketAnalysis,
  type Persona,
} from '../market';
import type { ContentResearch } from '../types';

const person = (wouldBuy: Persona['wouldBuy'], objection = ''): Persona => ({
  name: 'Sana',
  who: '29, Lahore, office worker',
  reaction: 'Looks good.',
  wouldBuy,
  objection,
  wouldShare: false,
});

describe('normaliseAnalysis', () => {
  const read = normaliseAnalysis({
    summary: '  Busy offices want breakfast delivered.  ',
    segments: [{ who: 'Office managers', wants: 'one invoice' }, { wants: 'no who, dropped' }, 'not an object'],
    competitors: [
      { name: 'Bake House', url: 'https://bakehouse.pk', knownFor: 'cakes' },
      { name: 'No Site', url: 'javascript:alert(1)', knownFor: '' },
      { url: 'https://x.pk' },
    ],
    opportunities: ['Corporate breakfast boxes', 42, ''],
    channels: 'Instagram',
  });

  it('keeps what has a name and trims it', () => {
    expect(read.summary).toBe('Busy offices want breakfast delivered.');
    expect(read.segments).toEqual([{ who: 'Office managers', wants: 'one invoice' }]);
    expect(read.competitors.map((c) => c.name)).toEqual(['Bake House', 'No Site']);
    expect(read.opportunities).toEqual(['Corporate breakfast boxes']);
  });

  it('keeps only real web addresses and treats a wrong shape as empty', () => {
    expect(read.competitors[1].url).toBe('');
    expect(read.channels).toEqual([]);
    expect(read.fromLinks).toEqual([]);
  });
});

describe('the audience test', () => {
  it('drops a panellist with no name or no reaction, and defaults a strange answer to no', () => {
    const panel = personas([
      { name: 'Ali', reaction: 'Maybe for Eid.', wouldBuy: 'perhaps' },
      { name: '', reaction: 'nameless' },
      { name: 'Hina', reaction: '' },
    ]);
    expect(panel).toHaveLength(1);
    expect(panel[0].wouldBuy).toBe('no');
  });

  it('decides the verdict in code: yes counts one, maybe half', () => {
    expect(verdictFor([person('yes'), person('yes'), person('maybe'), person('no')])).toEqual({ verdict: 'go', score: 0.63 });
    expect(verdictFor([person('maybe'), person('maybe'), person('no')]).verdict).toBe('adjust');
    expect(verdictFor([person('no'), person('no'), person('maybe'), person('no'), person('no')]).verdict).toBe('not_yet');
    expect(verdictFor([])).toEqual({ verdict: 'not_yet', score: 0 });
  });

  it('ranks the objections the panel raised most', () => {
    const panel = [person('no', 'Too expensive'), person('no', 'too expensive!'), person('maybe', 'No delivery'), person('yes')];
    expect(topObjections(panel)).toEqual(['Too expensive', 'No delivery']);
  });
});

describe('the analysis as a market read', () => {
  const analysis: MarketAnalysis = {
    atMs: 1,
    engine: 'gemini',
    grounded: true,
    summary: 'x',
    segments: [{ who: 'Office managers', wants: 'one invoice' }],
    competitors: [{ name: 'Bake House', url: '', knownFor: 'cakes' }],
    positioning: 'Fresh at 7am',
    opportunities: ['Breakfast boxes'],
    risks: ['Price'],
    channels: ['Instagram'],
    offers: ['First box free'],
    fromLinks: [],
    test: {
      verdict: 'adjust',
      score: 0.4,
      offer: 'First box free',
      panel: [],
      objections: ['Delivery time'],
      bestHook: 'Breakfast before the 9am meeting',
      changes: [],
    },
    sources: [],
  };

  it('feeds the planner the buyers, rivals, offers, best hook and doubts', () => {
    const r = asResearch(analysis);
    expect(r.trends).toEqual(['Office managers want one invoice']);
    expect(r.competitorMoves).toEqual(['Bake House — cakes']);
    expect(r.opportunities).toEqual(['Breakfast boxes', 'Offer: First box free']);
    expect(r.hookPatterns).toEqual(['Breakfast before the 9am meeting']);
    expect(r.avoid).toEqual(['Price', 'An objection to answer, never ignore: Delivery time']);
    expect(r.error).toBeNull();
  });

  it('puts this morning first and the launch read under it, without repeats', () => {
    const daily: ContentResearch = {
      atMs: 2,
      trends: ['Ramadan sehri boxes'],
      competitorMoves: [],
      opportunities: ['Breakfast boxes'],
      hookPatterns: [],
      avoid: [],
      sources: [],
      error: null,
    };
    const merged = mergeResearch(daily, asResearch(analysis))!;
    expect(merged.trends).toEqual(['Ramadan sehri boxes', 'Office managers want one invoice']);
    expect(merged.opportunities).toEqual(['Breakfast boxes', 'Offer: First box free']);
  });

  it('falls back to whichever read exists', () => {
    expect(mergeResearch(null, null)).toBeNull();
    expect(mergeResearch({ ...asResearch(analysis), error: 'no search' }, asResearch(analysis))!.error).toBeNull();
  });
});
