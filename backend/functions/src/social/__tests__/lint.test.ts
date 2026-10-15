/**
 * The checks have to be right about the obvious cases, because they run
 * unattended and a gate that cries wolf is a gate somebody switches off.
 *
 * These are the cases the Python originals were tuned against, re-asserted
 * here: a hook that opens on a greeting is weak, a hook with a number and a
 * stake is strong, six hashtags is a failure where the cap is five, and ninety
 * words do not fit in a twenty-second reel.
 */
import { describe, expect, it } from 'vitest';

import {
  beatSheet,
  detectHuman,
  humanise,
  lintCaption,
  reviewDraft,
  scoreHook,
  FOLD,
  HASHTAG_CAP,
} from '../lint';

describe('scoreHook', () => {
  it('rates a concrete hook with something at stake as strong', () => {
    const r = scoreHook('I lost 4,000 rupees to one surge price in Lahore.');
    expect(r.verdict).toBe('STRONG');
    expect(r.score).toBeGreaterThan(70);
    expect(r.dealbreakers).toEqual([]);
  });

  it('catches a greeting', () => {
    const r = scoreHook('Hey guys, today I wanted to talk about our app');
    expect(r.verdict).toBe('WEAK');
    expect(r.dealbreakers.join(' ')).toContain('greeted');
  });

  it('catches "stop scrolling" and the video preamble', () => {
    expect(scoreHook('Stop scrolling if you want cheap rides').dealbreakers.length).toBeGreaterThan(0);
    expect(scoreHook("In this video I'm going to show you the app").dealbreakers.length).toBeGreaterThan(0);
  });

  it('marks a hook with nothing checkable in it down on specificity', () => {
    const r = scoreHook('Our app is really great for everyone');
    const specificity = r.checks.find((c) => c.name === 'SPECIFICITY');
    expect(specificity?.score).toBeLessThan(40);
  });

  it('penalises a payload that arrives too late', () => {
    const late = scoreHook('There are a lot of people who end up paying 900 rupees');
    const early = scoreHook('900 rupees is what that ride should have cost you');
    expect(early.score).toBeGreaterThan(late.score);
  });

  it('counts a number said out loud as concrete', () => {
    const r = scoreHook('Three thousand rupees is what you never had to pay');
    const specificity = r.checks.find((c) => c.name === 'SPECIFICITY');
    expect(specificity?.score).toBeGreaterThan(40);
  });

  it('rejects a hashtag or an emoji in the hook', () => {
    expect(scoreHook('Cheap rides in #Lahore today').dealbreakers.length).toBeGreaterThan(0);
    expect(scoreHook('Cheap rides in Lahore today 🔥').dealbreakers.length).toBeGreaterThan(0);
  });
});

describe('lintCaption', () => {
  it('shows exactly what the feed shows', () => {
    const long = `${'a'.repeat(400)}`;
    const r = lintCaption(long);
    expect(r.visible).toHaveLength(FOLD);
    expect(r.truncated).toBe(true);
  });

  it('fails a caption over the hashtag cap', () => {
    const r = lintCaption('A real first line about fares in Lahore.\n\n#a #b #c #d #e #f');
    expect(r.hashtags).toHaveLength(HASHTAG_CAP + 1);
    expect(r.verdict).toBe('FIX');
    expect(r.checks.find((c) => c.name === 'HASHTAGS')?.status).toBe('FAIL');
  });

  it('fails a caption that opens on a hashtag', () => {
    const r = lintCaption('#velocityrides the fare you offer is the fare you pay');
    expect(r.checks.find((c) => c.name === 'FIRST LINE')?.status).toBe('FAIL');
  });

  it('warns when the first line is cut mid-thought', () => {
    const r = lintCaption(`${'word '.repeat(40)}end.`);
    expect(r.checks.find((c) => c.name === 'FIRST LINE')?.status).toBe('WARN');
  });

  it('warns about two asks', () => {
    const r = lintCaption('Fares from 250 in Lahore. Save this and follow us for more.');
    expect(r.checks.find((c) => c.name === 'ONE ASK')?.status).toBe('WARN');
  });

  it('passes a clean caption', () => {
    const r = lintCaption(
      'A Lahore to Gulberg ride cost 320 rupees today, because the rider named the fare.\n\nDownload the app.\n\n#lahoreride #gulberg #ridesharingpakistan #pakistandrivers #lahore',
    );
    expect(r.verdict).toBe('READY');
    expect(r.hashtags).toHaveLength(5);
  });

  it('reports missing search terms', () => {
    const r = lintCaption('A ride across town for 320 rupees.', ['sasti ride lahore']);
    expect(r.checks.find((c) => c.name === 'SEARCH TERMS')?.status).toBe('FAIL');
  });
});

describe('humanise', () => {
  it('strips invisible characters', () => {
    const r = humanise('Velocity​ Rides⁠ is live');
    expect(r.text).toBe('Velocity Rides is live');
    expect(r.changes.join(' ')).toContain('invisible');
  });

  it('replaces the typography a keyboard does not make', () => {
    const r = humanise('We built it — and it’s “live”…');
    expect(r.text).not.toMatch(/[—‘’“”…]/);
  });

  it('replaces stock vocabulary', () => {
    const r = humanise('We leverage a robust, seamless platform to elevate your journey.');
    expect(r.text.toLowerCase()).not.toContain('leverage');
    expect(r.text.toLowerCase()).not.toContain('seamless');
    expect(r.changes.join(' ')).toContain('stock wording');
  });

  it('reports the shapes it refuses to rewrite', () => {
    const r = humanise("It's not just a ride, it's a promise. Follow for more.");
    expect(r.flagged.length).toBeGreaterThan(0);
  });

  it('leaves a clean sentence alone', () => {
    const clean = 'A Lahore ride cost 320 rupees today. The rider set that price.';
    expect(humanise(clean).text).toBe(clean);
  });
});

describe('detectHuman', () => {
  it('flags a draft written to be as machine-like as possible', () => {
    const slop =
      "In today's fast-paced world, our innovative platform leverages cutting-edge technology to elevate your journey. " +
      "It's not just a ride, it's a transformative experience. Moreover, our comprehensive ecosystem fosters seamless mobility. " +
      'Furthermore, we empower drivers to unlock their potential. Ultimately, this is a game-changer for the entire landscape.';
    const r = detectHuman(slop);
    expect(r.verdict).not.toBe('PASS');
    expect(r.score).toBeLessThan(60);
  });

  it('scores cleaned-up text higher than the original', () => {
    const before =
      "In today's fast-paced world, our innovative platform leverages cutting-edge technology. " +
      'Moreover, it fosters a seamless ecosystem. Furthermore, we empower every driver. Ultimately, a game-changer.';
    const after = humanise(before).text;
    expect(detectHuman(after).score).toBeGreaterThan(detectHuman(before).score);
  });

  it('does not judge what it cannot judge', () => {
    const r = detectHuman('Short one.');
    expect(r.checks.filter((c) => c.score === null).length).toBeGreaterThan(0);
  });
});

describe('beatSheet', () => {
  it('catches a script that will not fit the cut', () => {
    const r = beatSheet('word '.repeat(90), 20);
    expect(r.overruns).toBe(true);
    expect(r.notes.join(' ')).toContain('Cut about');
  });

  it('catches a hook that takes too long to say', () => {
    const r = beatSheet(
      'This is a very long opening line that goes on well past the three seconds a hook actually gets before the thumb moves on. Then the rest.',
      30,
    );
    expect(r.notes.join(' ')).toContain('hook takes');
  });

  it('notices there is no loop back to the first line', () => {
    const r = beatSheet('Four thousand rupees saved. Here is the route. Download it.', 20);
    expect(r.notes.join(' ')).toContain('loop back');
  });

  it('times a script at roughly 165 words a minute', () => {
    const r = beatSheet('word '.repeat(55), null);
    expect(r.totalSeconds).toBeGreaterThan(18);
    expect(r.totalSeconds).toBeLessThan(22);
  });
});

describe('reviewDraft', () => {
  it('sends back a draft with a dealbreaker hook and six tags', () => {
    const r = reviewDraft({
      hook: 'Hey guys, welcome back to the channel',
      caption: 'Our app is great.',
      hashtags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(r.verdict).toBe('FIX');
    expect(r.notes.some((n) => n.startsWith('HOOK:'))).toBe(true);
    expect(r.notes.some((n) => n.startsWith('CAPTION:'))).toBe(true);
  });

  it('passes a draft that does the job', () => {
    const r = reviewDraft({
      hook: 'That Lahore ride should have cost you 320 rupees.',
      caption:
        'A Gulberg to Model Town ride cost 320 rupees today, because the rider named the fare and three drivers bid on it.\n\nDownload the app.',
      hashtags: ['lahoreride', 'gulberg', 'ridesharingpakistan', 'pakistandrivers', 'lahore'],
    });
    expect(r.verdict).not.toBe('FIX');
    expect(r.score).toBeGreaterThan(60);
  });

  it('writes notes a writer could act on without reading the code', () => {
    const r = reviewDraft({
      hook: 'Our service is good',
      caption: 'Good service.',
      hashtags: ['a'],
      voiceover: 'word '.repeat(90),
      seconds: 20,
    });
    expect(r.notes.length).toBeGreaterThan(0);
    for (const note of r.notes) expect(note).toMatch(/^(HOOK|CAPTION|VOICE|TIMING):/);
  });
});

describe('the zero-width joiner', () => {
  it('strips a stray one', () => {
    expect(humanise('Velocity‍Rides').text).toBe('VelocityRides');
  });

  it('leaves the one holding an emoji together', () => {
    const family = 'A family rides together \u{1F468}‍\u{1F469}‍\u{1F467} every day.';
    expect(humanise(family).text).toBe(family);
  });
});
