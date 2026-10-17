/**
 * The local writer, held to the same standard the critic holds a model to.
 *
 * These are not snapshot tests. A snapshot would lock in today's wording and
 * fail the moment somebody improves the material, which is the opposite of
 * useful. What is asserted here is the set of properties that have to survive
 * any rewrite of `material.ts`:
 *
 * - nothing it writes is ever scored WEAK or FIX by `lint.ts`;
 * - no figure appears unless the fact behind it is real, which is the one rule
 *   with legal consequences;
 * - a video script fits the seconds it was written for;
 * - the hashtag cap, the fold and the one-ask rule hold;
 * - saying something recently actually changes what it says next.
 *
 * The empty-facts case matters most. Velocity's counters are still near zero,
 * so the realistic production state is a writer with almost no numbers to use,
 * and a template engine that prints "Rs 0" in that state is a liability rather
 * than a fallback.
 */
import { describe, expect, it } from 'vitest';

import { ANGLE_MATERIAL, composeDraft, hookCandidates, factVars, seedFor } from '../local';
import { localDistribution, localDraft, localLessons, localReplies, localSeoPack, looksRomanUrdu } from '../local';
import { beatSheet, scoreHook } from '../lint';
import { FORMAT_SPECS, type ContentFormat } from '../types';

/** A page with real numbers on it. */
const FACTS: Record<string, number | string> = {
  date: '2026-10-17',
  totalTripsCompleted: 18420,
  totalDriverPayoutPKR: 7_310_000,
  approvedDrivers: 4120,
  tripsLast7Days: 2140,
  grossFaresLast7DaysPKR: 1_240_000,
  commissionRatePercent: 5,
  averageFarePKR: 580,
};

/** The state production is actually in: a brand, and no traffic yet. */
const NO_FACTS: Record<string, number | string> = {
  date: '2026-10-17',
  totalTripsCompleted: 0,
  totalDriverPayoutPKR: 0,
  approvedDrivers: 0,
  tripsLast7Days: 0,
  grossFaresLast7DaysPKR: 0,
  commissionRatePercent: 5,
  averageFarePKR: 0,
};

const ANGLES = Object.keys(ANGLE_MATERIAL);
const FORMATS: ContentFormat[] = ['reel', 'video', 'carousel', 'post', 'story'];
const DATE = '2026-10-17';

describe('the local writer, across every angle and format', () => {
  for (const angle of ANGLES) {
    it(`writes a publishable piece for ${angle}`, () => {
      for (const format of FORMATS) {
        const draft = localDraft({ angle, format, facts: FACTS, date: DATE, recentHooks: [], seo: null });
        const where = `${angle}/${format}`;

        // The critic's own bar, and the full one: not "not rejected" but
        // nothing left to say about it. There is no second pass here — a model
        // could be asked to try again, a template cannot — so the candidate
        // search has to come back clean on the first attempt, every time.
        //
        // The one note allowed through is "N seconds under target", and only
        // because the alternative is worse: the material for an angle runs to
        // about twenty seconds of speech, and a thirty-second slot would have
        // to be padded to fill it. The timer's own advice there is to shoot it
        // short, so a local draft that comes in under length is doing the right
        // thing rather than failing to do the job.
        const notes = draft.quality.notes.filter((n) => !/under target/.test(n));
        expect(notes, `${where}: ${draft.quality.notes.join(' | ')}`).toEqual([]);
        expect(draft.quality.verdict, where).not.toBe('FIX');
        expect(scoreHook(draft.script.hook).verdict, where).not.toBe('WEAK');

        // No unfilled placeholder ever reaches a caption.
        expect(draft.caption, where).not.toMatch(/\{[a-z]+\}/i);
        expect(draft.script.hook, where).not.toMatch(/\{[a-z]+\}/i);
        expect(draft.script.frames.map((f) => f.scene).join(' '), where).not.toMatch(/\{[a-z]+\}/i);

        expect(draft.hashtags.length, where).toBeLessThanOrEqual(5);
        expect(draft.hashtags.every((t) => !t.startsWith('#')), where).toBe(true);
        expect(draft.script.frames.length, where).toBeGreaterThan(0);

        // A still format has nothing to say out loud; a video says it in time.
        const spec = FORMAT_SPECS[format];
        if (spec.kind === 'video' && spec.seconds) {
          expect(draft.script.voiceover, where).not.toBe('');
          expect(beatSheet(draft.script.voiceover, spec.seconds).overruns, where).toBe(false);
        } else {
          expect(draft.script.voiceover, where).toBe('');
        }
      }
    });
  }
});

describe('the rule with legal consequences', () => {
  it('names no figure that the facts do not support', () => {
    for (const angle of ANGLES) {
      for (const format of FORMATS) {
        const draft = localDraft({ angle, format, facts: NO_FACTS, date: DATE, recentHooks: [], seo: null });
        const written = `${draft.script.hook}\n${draft.caption}\n${draft.script.voiceover}`;

        // With only a commission rate available, "5%" is the single figure
        // from the facts that may appear. The emergency numbers are the other
        // allowed exception: Police 15 and Rescue 1122 are public constants,
        // not claims about Velocity, and they are the two most load-bearing
        // digits the safety angle can carry. Anything else is a number the
        // engine invented, which is the failure this test exists to catch.
        const allowed = new Set(['5%', '15', '1122']);
        const numbers = (written.match(/\b\d[\d,.]*%?/g) ?? []).filter((n) => !allowed.has(n));
        expect(numbers, `${angle}/${format} invented ${numbers.join(', ')}`).toEqual([]);
      }
    }
  });

  it('never prints a zero as if it were a figure', () => {
    for (const angle of ANGLES) {
      const draft = localDraft({ angle, format: 'post', facts: NO_FACTS, date: DATE, recentHooks: [], seo: null });
      expect(`${draft.script.hook} ${draft.caption}`).not.toMatch(/\bRs\s*0\b|\b0\s*(?:rides|drivers|trips)\b/i);
    }
  });

  it('drops a candidate whose fact is missing, and keeps it when present', () => {
    const material = ANGLE_MATERIAL['driver-earnings'];
    const withFacts = hookCandidates({
      material,
      vars: factVars(FACTS, seedFor(DATE)),
      recentHooks: [],
    });
    const without = hookCandidates({
      material,
      vars: factVars(NO_FACTS, seedFor(DATE)),
      recentHooks: [],
    });

    expect(withFacts.length).toBeGreaterThan(without.length);
    expect(without.some((c) => c.text.includes('rides last week'))).toBe(false);
    expect(withFacts.some((c) => c.text.includes('2,140 rides last week'))).toBe(true);
  });
});

describe('not repeating itself', () => {
  it('says something different when the hook was used recently', () => {
    const first = composeDraft({
      angle: 'rider-savings',
      format: 'reel',
      facts: FACTS,
      date: DATE,
      recentHooks: [],
      keywords: [],
    });
    const second = composeDraft({
      angle: 'rider-savings',
      format: 'reel',
      facts: FACTS,
      date: DATE,
      recentHooks: [first.hook],
      keywords: [],
    });

    expect(second.hook).not.toBe(first.hook);
    expect(scoreHook(second.hook).verdict).not.toBe('WEAK');
  });

  it('writes rather than giving up when every opening has been used', () => {
    const material = ANGLE_MATERIAL.pooling;
    const all = hookCandidates({ material, vars: factVars(FACTS, seedFor(DATE)), recentHooks: [] }).map(
      (c) => c.text,
    );

    const draft = composeDraft({
      angle: 'pooling',
      format: 'post',
      facts: FACTS,
      date: DATE,
      recentHooks: all,
      keywords: [],
    });
    expect(all).toContain(draft.hook);
  });

  it('rotates the city with the date rather than always writing Lahore', () => {
    const cities = new Set(
      ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map(
        (date) => factVars(FACTS, seedFor(date)).values.city,
      ),
    );
    expect(cities.size).toBeGreaterThan(1);
  });

  it('writes the same piece twice for the same day, so a run is reproducible', () => {
    const args = { angle: 'safety' as const, format: 'reel' as const, facts: FACTS, date: DATE, recentHooks: [], keywords: [] };
    expect(composeDraft(args).caption).toBe(composeDraft(args).caption);
  });
});

describe('the SEO brief it writes for itself', () => {
  it('briefs only phrases the draft actually contains', () => {
    for (const angle of ANGLES) {
      const seo = localSeoPack({ angle, format: 'carousel', facts: FACTS, date: DATE });
      const draft = localDraft({ angle, format: 'carousel', facts: FACTS, date: DATE, recentHooks: [], seo });

      // The caption, and only the caption: that is what the SEARCH TERMS check
      // reads, so a phrase that lives only in the voiceover is still a miss.
      const haystack = draft.caption.toLowerCase();
      for (const keyword of seo.keywords) {
        expect(haystack, `${angle}: briefed "${keyword}" and did not write it`).toContain(keyword.toLowerCase());
      }
      expect(draft.quality.notes.join(' '), angle).not.toMatch(/SEARCH TERMS/);
      // One alt text per slide, in order, is the contract the designer reads.
      expect(seo.altTexts.length).toBe(FORMAT_SPECS.carousel.slides);
      expect(seo.hashtags.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('the manager', () => {
  const draft = localDraft({
    angle: 'rider-savings',
    format: 'post',
    facts: FACTS,
    date: DATE,
    recentHooks: [],
    seo: null,
  });

  it('fits every network inside its own limit', () => {
    const out = localDistribution({
      caption: draft.caption,
      hashtags: draft.hashtags,
      script: draft.script,
      candidates: ['instagram', 'facebook', 'threads', 'x', 'linkedin'],
      search: null,
    });

    expect(out.captions.x!.length).toBeLessThanOrEqual(280);
    expect(out.captions.threads!.length).toBeLessThanOrEqual(500);
    expect(out.targets).toContain('instagram');
    // The hook survives the trim on every network: it is the one line that
    // cannot be the part that got cut.
    for (const [platform, text] of Object.entries(out.captions)) {
      expect(text, platform).toContain(draft.script.hook.slice(0, 24));
    }
  });

  it('posts nothing when no network can take the format', () => {
    const out = localDistribution({
      caption: draft.caption,
      hashtags: draft.hashtags,
      script: draft.script,
      candidates: [],
      search: null,
    });
    expect(out.targets).toEqual([]);
  });
});

describe('the inbox', () => {
  it('escalates safety above everything else in the comment', () => {
    const [reply] = localReplies([{ id: 'c1', text: 'Great app but the driver was harassing me, I called the police' }]);
    expect(reply.intent).toBe('safety');
    expect(reply.reply).not.toBe('');
  });

  it('closes spam with an empty reply', () => {
    const [reply] = localReplies([{ id: 'c2', text: 'Make 50k daily with crypto, whatsapp me https://x.co/a' }]);
    expect(reply.intent).toBe('spam');
    expect(reply.reply).toBe('');
  });

  it('answers in Roman Urdu when the comment is in Roman Urdu', () => {
    const [reply] = localReplies([{ id: 'c3', text: 'Bhai yeh Lahore mein kaise kaam karta hai, kiraya kitna hai?' }]);
    expect(reply.intent).toBe('question');
    expect(reply.reply).toMatch(/jawab|tafseel|sawal/i);
  });

  it('promises a person rather than inventing an answer', () => {
    const [reply] = localReplies([{ id: 'c4', text: 'How much will I earn in Johar Town on a Tuesday?' }]);
    expect(reply.intent).toBe('question');
    expect(reply.reply).not.toMatch(/\d/);
  });

  it('leaves what it cannot classify for a person', () => {
    const [reply] = localReplies([{ id: 'c5', text: 'ok' }]);
    expect(reply.intent).toBe('other');
    expect(reply.reply).toBe('');
  });

  it('reads Roman Urdu without mistaking English for it', () => {
    expect(looksRomanUrdu('kiraya kitna hai bhai')).toBe(true);
    expect(looksRomanUrdu('How much is the fare to the airport')).toBe(false);
  });
});

describe('reading our own page', () => {
  const post = (mediaType: string, multiple: number, hookScore: number) => ({
    mediaType,
    multiple,
    sendRate: multiple * 4,
    saveRate: multiple * 2,
    hookScore,
    hook: `a ${mediaType} hook`,
  });

  it('names the format that travels, from the numbers', () => {
    const out = localLessons({
      best: [post('REEL', 3.1, 82), post('REEL', 2.4, 76), post('CAROUSEL', 1.4, 70)],
      worst: [post('IMAGE', 0.4, 38), post('IMAGE', 0.5, 41), post('CAROUSEL', 0.8, 55)],
      medianReach: 900,
      sampled: 13,
    });

    expect(out.lessons.join(' ')).toContain('reel');
    expect(out.useMore.join(' ')).toContain('reel');
    expect(out.useLess.join(' ')).toContain('image');
  });

  it('says plainly when there is not enough to be a pattern', () => {
    const out = localLessons({ best: [post('REEL', 2, 70)], worst: [], medianReach: 100, sampled: 1 });
    expect(out.lessons[0]).toMatch(/Only 1 post with numbers so far/);
    expect(out.lessons[0]).toMatch(/Nothing here is a pattern yet/);
    expect(out.useMore).toEqual([]);
  });

  it('refuses to credit the hook panel when it did not separate anything', () => {
    const out = localLessons({
      best: [post('REEL', 2.1, 60), post('REEL', 1.9, 61)],
      worst: [post('REEL', 0.5, 59), post('REEL', 0.6, 58)],
      medianReach: 500,
      sampled: 8,
    });
    expect(out.lessons.join(' ')).toMatch(/Something other than the opening/);
  });
});
