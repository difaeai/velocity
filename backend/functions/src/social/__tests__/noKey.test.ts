/**
 * The desk with no model key at all — the whole point of the local engine.
 *
 * Every other test in this folder checks a part. This one checks the claim:
 * that a run gets all the way through without a key, through the same public
 * functions `pipeline.ts` calls, in the same order, and comes out with a piece
 * somebody could post.
 *
 * Three of these stages used to throw rather than degrade — the standup, the
 * writer and the designer — so a single missing environment variable killed a
 * run at the first stage. That is the regression worth a test: not that the
 * local engine is good, but that nothing on this path is still fatal without a
 * key.
 *
 * Every key is cleared, not just Anthropic's: there are three ways to have a
 * model now, and a machine with any of them in its environment would otherwise
 * run this whole file against a real endpoint and fail for reasons that have
 * nothing to do with the local writer.
 *
 * No Firestore and no network: every function here is reached on its local
 * branch, which is itself part of what is being asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planContent } from '../crew';
import { modelReady } from '../engine';
import { directFrames } from '../designer';
import { planDistribution } from '../manager';
import { runResearch } from '../research';
import { adPass, searchPass, seoPass } from '../seo';
import { draftPost, rewriteCaption } from '../script';
import { shouldAutoPublish } from '../pipeline';
import { planCut } from '../video';
import {
  CAPTION_LIMITS,
  DEFAULT_SETTINGS,
  type ContentFormat,
  type Employee,
  type Platform,
  type Role,
  type SocialSettings,
} from '../types';

const FACTS: Record<string, number | string> = {
  date: '2026-10-17',
  commissionRatePercent: 5,
  averageFarePKR: 580,
  approvedDrivers: 4120,
  tripsLast7Days: 2140,
  totalTripsCompleted: 18420,
};

const settings: SocialSettings = { ...DEFAULT_SETTINGS, textModel: 'claude-opus-5' };

function hire(id: string, role: Role, name: string): Employee {
  return {
    id,
    name,
    role,
    title: role,
    status: 'active',
    instructions: '',
    colour: '#ccff00',
    hiredAtMs: 0,
    hiredBy: null,
    lastWorkedAtMs: null,
    piecesWorked: 0,
  };
}

const team: Employee[] = [
  hire('w1', 'content-writer', 'Qalam'),
  hire('d1', 'designer', 'Rang'),
  hire('v1', 'video-editor', 'Raftar'),
  hire('m1', 'social-manager', 'Awaaz'),
  hire('s1', 'seo-expert', 'Talha'),
  hire('r1', 'research-assistant', 'Hina'),
];

const byRole = (role: Role): Employee => team.find((e) => e.role === role)!;

const KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_KEY_RESEARCH', 'FREE_MODEL_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const name of KEYS) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterAll(() => {
  for (const name of KEYS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('a full run with no key', () => {
  it('has no key, so every stage below takes its local branch', () => {
    expect(modelReady()).toBe(false);
  });

  for (const format of ['reel', 'carousel', 'post'] as ContentFormat[]) {
    it(`gets a ${format} from standup to distribution`, async () => {
      // ── the standup. Used to throw; now decides from the material.
      const plan = await planContent({
        settings,
        team,
        format,
        angle: 'driver-earnings',
        facts: FACTS,
        research: null,
        recentConcepts: [],
        feedback: [],
      });
      expect(plan.concept.length).toBeGreaterThan(20);
      expect(plan.hookDirection).toMatch(/Formula/);
      // Only people actually in the room get notes.
      for (const id of Object.keys(plan.notes)) expect(team.map((e) => e.id)).toContain(id);

      // ── the market read. The one stage with no local equivalent: it has to
      // say so rather than invent a trend.
      // Reached before the cached-read, so this needs no Firestore: a stage
      // about to decline has nothing to look up.
      const research = await runResearch({
        employee: byRole('research-assistant'),
        settings,
        date: '2026-10-17',
      });
      expect(research.error).toMatch(/cannot read the live web/);
      expect(research.trends).toEqual([]);

      // ── the SEO brief, before anything is written.
      const seo = await seoPass({
        employee: byRole('seo-expert'),
        settings,
        format,
        angle: 'driver-earnings',
        plan,
        research,
        facts: FACTS,
        feedback: [],
      });
      expect(seo).not.toBeNull();
      expect(seo!.hashtags.length).toBeLessThanOrEqual(5);

      // ── the writing. Used to throw; this is the stage that matters most.
      const drafted = await draftPost({
        employee: byRole('content-writer'),
        settings,
        format,
        angle: 'driver-earnings',
        plan,
        facts: FACTS,
        research,
        seo,
        recentHooks: [],
        feedback: [],
      });
      expect(drafted.script.hook).not.toBe('');
      expect(drafted.quality.verdict).not.toBe('FIX');
      expect(drafted.note).toMatch(/openings/);

      // ── the search pack.
      const search = await searchPass({
        employee: byRole('seo-expert'),
        settings,
        format,
        script: drafted.script,
        caption: drafted.caption,
        seo,
        plan,
        angle: 'driver-earnings',
        facts: FACTS,
        feedback: [],
      });
      expect(search).not.toBeNull();

      // ── the art direction. Used to throw.
      const frames = await directFrames({
        employee: byRole('designer'),
        settings,
        format,
        script: drafted.script,
        plan,
        count: format === 'carousel' ? 5 : 1,
        seo,
        feedback: [],
      });
      expect(frames.length).toBe(format === 'carousel' ? 5 : 1);
      for (const frame of frames) {
        expect(frame.prompt.length).toBeGreaterThan(40);
        // The house style has to be on every frame: each one is drawn alone.
        expect(frame.prompt).toMatch(/lime/i);
        expect(frame.alt).not.toBe('');
      }

      // ── the cut and the campaign brief, on video only.
      if (format === 'reel') {
        const cut = await planCut({
          employee: byRole('video-editor'),
          settings,
          format,
          script: drafted.script,
          plan,
          search,
          feedback: [],
        });
        expect(cut.prompt.length).toBeGreaterThan(40);
        expect(cut.note).toMatch(/local engine/);

        const ads = await adPass({
          employee: byRole('seo-expert'),
          settings,
          format,
          script: drafted.script,
          facts: FACTS,
          plan,
          search,
          angle: 'driver-earnings',
          feedback: [],
        });
        expect(ads).not.toBeNull();
        expect(ads!.hookVariants.length).toBeGreaterThan(1);
        expect(ads!.targeting.locations.length).toBeGreaterThan(0);
      }

      // ── distribution, which is where a run ends before the queue.
      const candidates: Platform[] = ['instagram', 'facebook', 'threads', 'x'];
      const out = await planDistribution({
        employee: byRole('social-manager'),
        settings,
        format,
        script: drafted.script,
        plan,
        caption: drafted.caption,
        hashtags: drafted.hashtags,
        search,
        candidates,
        feedback: [],
      });
      expect(out.targets.length).toBeGreaterThan(0);
      for (const target of out.targets) expect(candidates).toContain(target);
      // Not the old "same caption everywhere" fallback: there is a caption per
      // network, and each one fits that network. Which networks appear depends
      // on the format — X takes a still and not a reel — so this asserts over
      // what was produced rather than naming one.
      expect(Object.keys(out.captions).length).toBeGreaterThan(0);
      for (const [platform, text] of Object.entries(out.captions)) {
        expect(text!.length, platform).toBeLessThanOrEqual(CAPTION_LIMITS[platform as Platform]);
        expect(text, platform).not.toBe('');
      }
    });
  }

  // The one code path that puts words in front of an audience with no human in
  // the loop, so the rule gets its own test rather than living inside a
  // 400-line run.
  describe('auto-publish', () => {
    it('never publishes a locally written piece, even when switched on', () => {
      expect(shouldAutoPublish(true, false)).toBe(false);
    });

    it('still publishes without approval when the model wrote it', () => {
      // The deliberate absence of a quality gate is not undone by this: with a
      // key, auto-publish means exactly what it meant before.
      expect(shouldAutoPublish(true, true)).toBe(true);
    });

    it('publishes nothing at all when it is off', () => {
      expect(shouldAutoPublish(false, true)).toBe(false);
      expect(shouldAutoPublish(false, false)).toBe(false);
    });
  });

  it('keeps the caption and only reorders it when asked to rewrite', async () => {
    const drafted = await draftPost({
      employee: byRole('content-writer'),
      settings,
      format: 'post',
      angle: 'safety',
      plan: null,
      facts: FACTS,
      research: null,
      seo: null,
      recentHooks: [],
      feedback: [],
    });

    const again = await rewriteCaption({
      employee: byRole('content-writer'),
      settings,
      script: drafted.script,
      currentCaption: drafted.caption,
      hashtags: drafted.hashtags,
      feedback: ['Make it warmer.'],
    });

    // It cannot read the request, so it must not lose the content either: the
    // hook still opens it and the tags are still capped.
    expect(again.caption).toContain(drafted.script.hook);
    expect(again.hashtags.length).toBeLessThanOrEqual(5);
    expect(again.quality.verdict).not.toBe('FIX');
  });
});
