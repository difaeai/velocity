/**
 * "The content team makes the same useless thing every day."
 *
 * Three guards, all arithmetic: each piece is handed a shape the feed has not
 * had lately; a hook that is nearly one already posted is sent back on the one
 * rewrite the checks already use; and the other accounts the researcher reads
 * are ranked against their own normal, so "it did 4x" means something.
 */
import { describe, expect, it } from 'vitest';

import { accountsBlock, handleOf, rankAccount } from '../discovery';
import { holdReason } from '../engagement';
import { needsMedia, spokenFrom } from '../pipeline';
import { nextShape, STORY_SHAPES } from '../playbook';
import { closestHook, SAME_HOOK } from '../script';
import type { PostScript } from '../types';

describe('the shape of each piece', () => {
  it('is never one of the last six used', () => {
    const recent = Object.keys(STORY_SHAPES).slice(0, 6);
    for (let i = 0; i < 40; i++) expect(recent).not.toContain(nextShape(recent, `2026-10-${i}-reel`));
  });

  it('spreads across the shapes rather than settling on one', () => {
    const picked = new Set(Array.from({ length: 60 }, (_, i) => nextShape([], `2026-11-${i}-post`)));
    expect(picked.size).toBeGreaterThan(5);
  });

  it('still answers when every shape was used lately', () => {
    expect(Object.keys(STORY_SHAPES)).toContain(nextShape(Object.keys(STORY_SHAPES), 'x'));
  });
});

describe('a hook the feed already had', () => {
  const recent = ['Your fare, your offer. No surge, ever.', 'Cash is welcome here, always.'];

  it('is caught when it says the same thing again', () => {
    const hit = closestHook('Your offer, your fare — no surge ever', recent);
    expect(hit?.hook).toBe(recent[0]);
    expect(hit!.similarity).toBeGreaterThanOrEqual(SAME_HOOK);
  });

  it('lets a genuinely different opening through', () => {
    expect(closestHook('The 11pm bus never came. Here is what Sana did.', recent)!.similarity).toBeLessThan(SAME_HOOK);
  });

  it('has nothing to compare against on a new desk', () => {
    expect(closestHook('Anything at all', [])).toBeNull();
  });
});

describe('other accounts, read with their real numbers', () => {
  it('cuts a handle out of whatever people paste', () => {
    expect(handleOf('@Careem')).toBe('careem');
    expect(handleOf('https://www.instagram.com/indrive.pk/')).toBe('indrive.pk');
    expect(handleOf('not a handle!')).toBeNull();
    expect(handleOf('')).toBeNull();
  });

  it('ranks posts against that account’s own median, not raw likes', () => {
    const read = rankAccount('bakery', 5000, [
      { caption: 'ordinary', like_count: 100, comments_count: 0 },
      { caption: 'ordinary too', like_count: 90, comments_count: 10 },
      { caption: 'the one that travelled', like_count: 380, comments_count: 20, media_type: 'VIDEO' },
      { caption: 'quiet', like_count: 80, comments_count: 0 },
    ]);
    expect(read.medianEngagement).toBe(100);
    expect(read.top).toHaveLength(1);
    expect(read.top[0]).toMatchObject({ caption: 'the one that travelled', multiple: 4, mediaType: 'VIDEO' });
  });

  it('renders only accounts with something above their normal, and says not to copy or name them', () => {
    const quiet = rankAccount('quiet', 100, [{ like_count: 5 }, { like_count: 5 }]);
    const loud = rankAccount('loud', 9000, [{ like_count: 10 }, { like_count: 10 }, { like_count: 60, caption: 'x' }]);
    const block = accountsBlock([quiet, loud]);
    expect(block).toContain('@loud');
    expect(block).not.toContain('@quiet');
    expect(block).toMatch(/never copy the post, never name the account/);
    expect(accountsBlock([])).toBe('');
  });
});

describe('a stranger’s comment cannot steer an automatic reply', () => {
  it('holds a reply carrying a link, a number or a paragraph for a person', () => {
    expect(holdReason('Thanks! Get it free at cheap-rides.pk today')).toBe('it carries a link');
    expect(holdReason('See https://example.com')).toBe('it carries a link');
    expect(holdReason('Call us on 0300 1234567')).toBe('it carries a phone number');
    expect(holdReason('x'.repeat(301))).toBe('it is too long for a comment reply');
  });

  it('lets an ordinary short reply go out on its own', () => {
    expect(holdReason('Shukriya! Glad the ride went well.')).toBeNull();
    expect(holdReason('Sorry about that — DM us your ride time and we will sort it.')).toBeNull();
  });
});

const script = (over: Partial<PostScript> = {}): PostScript => ({
  hook: 'Your fare, your offer',
  hookVariants: [],
  frames: [
    { scene: 'a', overlay: 'Drivers bid on it' },
    { scene: 'b', overlay: 'Pay in cash!' },
  ],
  voiceover: '',
  cta: 'Download Velocity Rides',
  rationale: '',
  viralHook: '',
  ...over,
});

describe('a reel always speaks', () => {
  it('reads the lines on screen when the writer left the voice-over empty', () => {
    expect(spokenFrom(script())).toBe('Your fare, your offer. Drivers bid on it. Pay in cash! Download Velocity Rides.');
  });

  it('is cut again by the sweep when its voice failed, until the tries run out', () => {
    const media = [{ kind: 'video', url: 'https://x/v.mp4' }] as never;
    expect(needsMedia({ format: 'reel', script: script(), media, voiceMissing: true })).toBe(true);
    expect(needsMedia({ format: 'reel', script: script(), media, voiceMissing: false })).toBe(false);
    expect(needsMedia({ format: 'reel', script: script(), media, voiceMissing: true, renderTries: 3 })).toBe(false);
    // A still piece has no voice to miss.
    expect(needsMedia({ format: 'post', script: script(), media: [{ kind: 'image', url: 'https://x/i.jpg' }] as never, voiceMissing: true })).toBe(false);
  });
});
