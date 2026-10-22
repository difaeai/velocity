/**
 * The viral list is what reaches the dashboard as clickable links, so only real
 * https addresses with a path survive, and only the fields it shows.
 */
import { describe, expect, it } from 'vitest';

import { viralList } from '../research';

describe('viralList', () => {
  it('keeps a real post and trims it to the three fields shown', () => {
    expect(
      viralList([{ title: ' A rider films the fare ', url: 'https://www.youtube.com/shorts/abc123', why: 'a real number', extra: 1 }]),
    ).toEqual([{ title: 'A rider films the fare', url: 'https://www.youtube.com/shorts/abc123', why: 'a real number' }]);
  });

  it('drops anything that is not an https address to a page', () => {
    const out = viralList([
      { title: 'no scheme', url: 'youtube.com/shorts/x' },
      { title: 'plain http', url: 'http://example.com/post' },
      { title: 'just a domain', url: 'https://example.com/' },
      { title: 'javascript', url: 'javascript:alert(1)' },
      { title: '', url: 'https://example.com/untitled' },
      'not an object',
      null,
    ]);
    expect(out).toEqual([]);
  });

  it('caps the list at six and returns nothing for a non-list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ title: `p${i}`, url: `https://example.com/p/${i}`, why: '' }));
    expect(viralList(many)).toHaveLength(6);
    expect(viralList('nope')).toEqual([]);
  });
});
