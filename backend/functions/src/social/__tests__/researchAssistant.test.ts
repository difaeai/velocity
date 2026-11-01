/**
 * The Research Assistant's dummy campaign, against the emulators with the model
 * answered here: it plans the campaign, meets the simulated panel, prices the
 * money and keeps the run — and never touches Meta. Its next plan reads what
 * the last dummy found, which is how the Social Media Manager receives it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const model = vi.hoisted(() => ({ prompts: [] as { what: string; prompt: string }[] }));

vi.mock('../engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../engine')>();
  const PLAN = {
    name: 'Eid lawn — Lahore women',
    objective: 'traffic',
    audience: { cities: ['Lahore'], ageMin: 22, ageMax: 40, genders: 'women', interests: [] },
    dailyBudget: 100,
    days: 9,
    format: 'image',
    primaryText: 'Eid lawn, 20% off this week only.',
    headline: 'Eid lawn, 20% off',
    cta: 'LEARN_MORE',
    lines: ['Eid lawn, 20% off'],
    why: 'A short test in the busiest week.',
  };
  const person = (wouldBuy: 'yes' | 'maybe' | 'no', objection = '') => ({
    name: 'Ayesha',
    who: '29, Lahore, teacher',
    reaction: 'I would look at the prints first.',
    wouldBuy,
    objection,
    wouldShare: false,
  });
  // Seven yes, two maybe, one no: (7 + 1) / 10 = 0.8, a go — decided in code, not by the model.
  const PANEL = [...Array(7).fill(person('yes')), person('maybe', 'Delivery time'), person('maybe', 'Delivery time'), person('no', 'Too far')];
  return {
    ...real,
    modelReady: () => true,
    activeEngine: () => 'gemini',
    generateJson: async (req: { what: string; prompt: string }) => {
      model.prompts.push({ what: req.what, prompt: req.prompt });
      if (req.what === 'A competitor ad') {
        return { data: { hook: 'Rs 3,999 lawn', offer: 'Free delivery', angle: 'price', lesson: 'Lead with the price.' }, sources: [] };
      }
      return { data: req.what === 'The ad test audience' ? { panel: PANEL, rewrite: {} } : PLAN, sources: [] };
    },
  };
});

import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { dummyCampaign } from '../ads';
import { researchAddCompetitorAd } from '../competitorAds';

const admin = <T>(data: T): CallableRequest<T> => {
  const req = makeReq(data, 'research-admin');
  (req.auth as { token: Record<string, unknown> }).token = { uid: 'research-admin', role: 'admin' };
  return req;
};

beforeEach(async () => {
  await clearFirestore();
  model.prompts.length = 0;
});

describe('a dummy campaign', () => {
  it('is planned, tested on the panel and priced, with nothing made at Meta', async () => {
    const id = await dummyCampaign({ brief: 'Eid sale on lawn suits for women in Lahore', dailyBudget: 100, days: 5 });
    const run = (await db().doc(`researchTests/${id}`).get()).data()!;

    expect(run).toMatchObject({ by: 'owner', campaignId: null, currency: 'PKR' });
    expect(run.plan.name).toBe('Eid lawn — Lahore women');
    // Rs 100 is under Meta's floor: the figures describe a campaign that could actually run.
    expect(run.plan.dailyBudget).toBe(300);
    expect(run.plan.days).toBe(5);
    expect(run.pretest).toMatchObject({ verdict: 'go', score: 0.8, rewritten: false, objections: ['Delivery time', 'Too far'] });
    expect(run.pretest.panel).toHaveLength(10);
    expect(run.forecast.spend).toBe(1500);
    expect(run.forecast.results[0]).toBeGreaterThan(0);
    expect((await db().collection('socialAds').get()).empty).toBe(true);
  });

  it('hands what it found to the next plan the manager makes', async () => {
    await dummyCampaign({ brief: 'Eid sale on lawn suits for women in Lahore' });
    model.prompts.length = 0;
    await dummyCampaign({ brief: 'Wedding season formals in Faisalabad' });
    const plan = model.prompts.find((p) => p.what === 'The ad plan')!;
    expect(plan.prompt).toContain("WHAT THE RESEARCH ASSISTANT'S DUMMY CAMPAIGNS FOUND");
    expect(plan.prompt).toContain('"Eid lawn — Lahore women"');
    expect(plan.prompt).toContain('panel 80%, go');
  });
});

describe('a competitor ad', () => {
  it('is kept once per Library ad, ranked by how long it has run, and read by the next plan', async () => {
    const pasted = [
      'Library ID: 99887766',
      'Started running on 1 Sep 2026',
      '4 ads use this creative and text',
      'Eid lawn from Rs 3,999. Free delivery.',
    ].join(String.fromCharCode(10));
    const { id } = (await researchAddCompetitorAd.run(admin({ competitor: 'Big Lawn Co', text: pasted }))) as { id: string };
    await researchAddCompetitorAd.run(admin({ competitor: 'Big Lawn Co', text: pasted }));
    expect(id).toBe('lib-99887766');
    expect((await db().collection('competitorAds').get()).size).toBe(1);
    const ad = (await db().doc(`competitorAds/${id}`).get()).data()!;
    expect(ad).toMatchObject({ competitor: 'Big Lawn Co', startedOn: '2026-09-01', versions: 4, hook: 'Rs 3,999 lawn', angle: 'price', source: 'paste' });
    expect(ad.daysRunning).toBeGreaterThan(55);

    await dummyCampaign({ brief: 'Eid lawn for women in Lahore' });
    const plan = model.prompts.find((p) => p.what === 'The ad plan')!;
    expect(plan.prompt).toContain("THE COMPETITION'S STRONGEST ADS");
    expect(plan.prompt).toContain('Big Lawn Co: running');
    expect(plan.prompt).toContain('4 versions');
  });
});
