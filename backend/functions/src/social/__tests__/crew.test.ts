/**
 * The parts of the content crew that are pure functions, and the two places a
 * silent mistake in them would reach a live audience.
 *
 * What is worth testing here is not the model calls — those are network — but
 * the rules around them: which network is allowed to receive which format, what
 * a caption becomes when a network has a hard character limit, and whether a
 * grounded reply can still be read when the model wraps its JSON in prose. All
 * three fail quietly in production if they regress: a story silently posted as
 * a feed image, a tweet truncated mid-word, or a whole run "failing" because
 * the answer arrived inside a code fence.
 */
import { describe, it, expect } from 'vitest';

import { extractJson } from '../gemini';
import { captionFor } from '../manager';
import {
  FORMAT_SPECS,
  FORMATS,
  PLATFORM_FORMATS,
  PLATFORMS,
  platformsForFormat,
  postMedia,
  supports,
  type MediaAsset,
} from '../types';

describe('the format matrix', () => {
  it('never offers a network a format its adapter cannot post', () => {
    // The pipeline trusts this matrix to filter targets, so an entry here that
    // the adapter does not implement is a publish failure at 10am.
    for (const platform of PLATFORMS) {
      for (const format of PLATFORM_FORMATS[platform]) {
        expect(FORMATS).toContain(format);
      }
    }
  });

  it('keeps video formats off the networks that only take stills', () => {
    expect(supports('x', 'reel')).toBe(false);
    expect(supports('linkedin', 'video')).toBe(false);
    expect(supports('youtube', 'story')).toBe(false);
    expect(supports('instagram', 'video')).toBe(false);
  });

  it('gives every format somewhere to go', () => {
    for (const format of FORMATS) {
      expect(platformsForFormat(format).length).toBeGreaterThan(0);
    }
  });

  it('asks the designer for more than one slide only on a carousel', () => {
    for (const format of FORMATS) {
      const spec = FORMAT_SPECS[format];
      if (format === 'carousel') expect(spec.slides).toBeGreaterThan(1);
      else expect(spec.slides).toBe(1);
    }
  });

  it('puts the editor on the video formats and nowhere else', () => {
    for (const format of FORMATS) {
      const spec = FORMAT_SPECS[format];
      expect(spec.crew.includes('raftar')).toBe(spec.kind === 'video');
    }
  });
});

describe('captions per network', () => {
  const master = 'The rider names the fare. Drivers bid. No surge, ever.';

  it('uses the network-specific rewrite when there is one', () => {
    expect(captionFor('x', master, { x: 'You name the fare.' })).toBe('You name the fare.');
  });

  it('falls back to the master caption when there is not', () => {
    expect(captionFor('facebook', master, { x: 'You name the fare.' })).toBe(master);
    expect(captionFor('facebook', master, undefined)).toBe(master);
  });

  it('ignores an empty rewrite rather than posting nothing', () => {
    expect(captionFor('threads', master, { threads: '   ' })).toBe(master);
  });

  it('cuts a long caption to what the network will accept', () => {
    const long = 'x'.repeat(1000);
    expect(captionFor('x', long, undefined)).toHaveLength(280);
    expect(captionFor('threads', long, undefined)).toHaveLength(500);
    expect(captionFor('facebook', long, undefined)).toHaveLength(1000);
  });
});

describe('reading a model reply', () => {
  it('reads a bare JSON object', () => {
    expect(extractJson<{ hook: string }>('{"hook":"one"}')).toEqual({ hook: 'one' });
  });

  it('reads JSON out of a fenced block', () => {
    const reply = 'Here you go:\n```json\n{"hook":"two"}\n```\nHope that helps.';
    expect(extractJson<{ hook: string }>(reply)).toEqual({ hook: 'two' });
  });

  it('reads JSON out of prose, which is how grounded answers come back', () => {
    // Search grounding and JSON mode are mutually exclusive in the API, so the
    // research call always has to survive a chatty answer.
    const reply = 'After searching, my findings: {"trends":["a","b"]} — sources above.';
    expect(extractJson<{ trends: string[] }>(reply)).toEqual({ trends: ['a', 'b'] });
  });

  it('returns null rather than throwing when there is no object at all', () => {
    expect(extractJson('I could not do that.')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
});

describe('posts written before formats existed', () => {
  const asset: MediaAsset = {
    kind: 'video',
    provider: 'veo',
    model: null,
    jobId: null,
    storagePath: 'social/2026-01-01.mp4',
    url: 'https://example.test/v.mp4',
    urlExpiresAtMs: 0,
    durationSec: 20,
    aspect: '9:16',
    slide: 1,
    alt: '',
  };

  it('still finds the video on an old single-video post', () => {
    expect(postMedia({ video: asset })).toEqual([asset]);
  });

  it('prefers the new media array when both are present', () => {
    const slide = { ...asset, kind: 'image' as const, slide: 1 };
    expect(postMedia({ media: [slide], video: asset })).toEqual([slide]);
  });

  it('returns nothing for a post the crew has not finished', () => {
    expect(postMedia({})).toEqual([]);
  });
});
