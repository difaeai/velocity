/**
 * What comes back from the model is not trusted: it is cut to the lengths
 * `studioCreateWorkspace`'s schema accepts, and a network it invented is
 * dropped rather than sent to a page that would then offer to connect it.
 */
import { describe, expect, it } from 'vitest';

import { cleanLookUp } from '../lookUp';

const full = {
  businessName: 'Bake House',
  what: 'fresh bread and cakes, delivered the same day',
  audience: 'families and offices',
  market: 'Lahore, Pakistan',
  language: 'Urdu and English',
  differences: 'baked at 5am every day',
  website: 'https://bakehouse.pk',
  platforms: ['instagram', 'facebook'],
  plan: 'I would post your morning bake every day.',
  thin: false,
};

describe('what Vexa read off a page, before it reaches the form', () => {
  it('keeps a good answer as it is', () => {
    expect(cleanLookUp(full, 'bakehouse.pk')).toEqual(full);
  });

  it('drops a network nobody can post to and caps the list at four', () => {
    const out = cleanLookUp(
      { ...full, platforms: ['instagram', 'pinterest', 'facebook', 'tiktok', 'youtube', 'x'] },
      'bakehouse.pk',
    );
    expect(out.platforms).toEqual(['instagram', 'facebook', 'tiktok', 'youtube']);
  });

  it('leaves a field it could not find empty rather than inventing one', () => {
    const out = cleanLookUp({ businessName: 'Bake House' }, 'instagram.com/bakehouse');
    expect(out.audience).toBe('');
    expect(out.what).toBe('');
    expect(out.platforms).toEqual([]);
    // Nothing was found, so the address they typed stands in — it does look like one.
    expect(out.website).toBe('instagram.com/bakehouse');
    // A brief with no language at all would make the team pick one at random.
    expect(out.language).toBe('English');
  });

  it('does not put a handle that is not a web address into the website box', () => {
    expect(cleanLookUp({}, '@bakehouse').website).toBe('');
  });

  it('cuts an answer that is longer than the sign-up will accept', () => {
    const out = cleanLookUp({ ...full, what: 'x'.repeat(900), businessName: 'y'.repeat(200) }, 'bakehouse.pk');
    expect(out.what).toHaveLength(600);
    expect(out.businessName).toHaveLength(80);
  });

  it('refuses a shape that is not even strings', () => {
    const out = cleanLookUp({ businessName: 42, platforms: 'instagram' } as never, 'bakehouse.pk');
    expect(out.businessName).toBe('');
    expect(out.platforms).toEqual([]);
  });
});
