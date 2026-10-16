/**
 * The arithmetic that decides what the team is told it should do more of.
 *
 * This is the part worth testing hardest, because a wrong baseline here does
 * not fail loudly — it quietly teaches the desk the wrong lesson every morning
 * for a month, and the posts get worse while everything looks like it is
 * working.
 */
import { describe, expect, it } from 'vitest';

import { median, rank } from '../insights';
import type { PostPerformance } from '../platforms';

const post = (over: Partial<PostPerformance> = {}): PostPerformance => ({
  platform: 'instagram',
  mediaId: 'm1',
  permalink: null,
  mediaType: 'REELS',
  caption: 'A Lahore ride cost 320 rupees today.\nmore text below',
  postedAtMs: 1,
  reach: 1000,
  saves: 10,
  sends: 5,
  comments: 2,
  likes: 40,
  plays: 0,
  ...over,
});

describe('median', () => {
  it('takes the middle of an odd list', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the middle two of an even list', () => {
    expect(median([1, 3, 5, 7])).toBe(4);
  });

  it('is nought for nothing', () => {
    expect(median([])).toBe(0);
  });

  it('is not dragged by one enormous outlier, which is the whole point', () => {
    expect(median([100, 110, 120, 130, 1_000_000])).toBe(120);
  });
});

describe('rank', () => {
  it('measures each post against this account’s own normal', () => {
    const { ranked, medianReach } = rank([
      post({ mediaId: 'a', reach: 1000 }),
      post({ mediaId: 'b', reach: 1000 }),
      post({ mediaId: 'c', reach: 4000 }),
    ]);
    expect(medianReach).toBe(1000);
    expect(ranked[0].mediaId).toBe('c');
    expect(ranked[0].multiple).toBe(4);
  });

  it('puts the biggest multiple first, not the biggest number', () => {
    // The sort has to be on the multiple. On one account both are the same
    // order, which is exactly why a regression here would go unnoticed, so
    // the baseline is checked rather than assumed.
    const { ranked } = rank([
      post({ mediaId: 'small', reach: 50 }),
      post({ mediaId: 'mid', reach: 100 }),
      post({ mediaId: 'big', reach: 900 }),
    ]);
    expect(ranked.map((r) => r.mediaId)).toEqual(['big', 'mid', 'small']);
    expect(ranked[0].multiple).toBe(9);
  });

  it('ignores posts the insights window has aged out', () => {
    // A zero is "we cannot see this any more", not "nobody saw it". Counting
    // them halves the median and makes every recent post look like a triumph.
    const { ranked, medianReach } = rank([
      post({ mediaId: 'a', reach: 1000 }),
      post({ mediaId: 'b', reach: 1000 }),
      post({ mediaId: 'old', reach: 0 }),
      post({ mediaId: 'older', reach: 0 }),
    ]);
    expect(medianReach).toBe(1000);
    expect(ranked).toHaveLength(2);
  });

  it('reads the hook as the feed showed it — the first line only', () => {
    const { ranked } = rank([post({ caption: 'The opening line.\nthen the rest\nand more' })]);
    expect(ranked[0].hook).toBe('The opening line.');
  });

  it('scores that hook, so a pattern can be seen across posts', () => {
    const { ranked } = rank([
      post({ mediaId: 'good', reach: 3000, caption: 'That ride should have cost you 320 rupees.' }),
      post({ mediaId: 'bad', reach: 1000, caption: 'Hey guys, welcome back' }),
    ]);
    const good = ranked.find((r) => r.mediaId === 'good')!;
    const bad = ranked.find((r) => r.mediaId === 'bad')!;
    expect(good.hookScore).toBeGreaterThan(bad.hookScore);
  });

  it('reports sends and saves per thousand reached, not as raw counts', () => {
    const { ranked } = rank([post({ reach: 2000, sends: 40, saves: 100 })]);
    expect(ranked[0].sendRate).toBe(20);
    expect(ranked[0].saveRate).toBe(50);
  });

  it('survives an account with no reach anywhere', () => {
    const { ranked, medianReach } = rank([post({ reach: 0 }), post({ reach: 0 })]);
    expect(ranked).toHaveLength(0);
    expect(medianReach).toBe(1);
  });

  it('does not divide by zero on an empty page', () => {
    expect(() => rank([])).not.toThrow();
    expect(rank([]).ranked).toEqual([]);
  });
});
