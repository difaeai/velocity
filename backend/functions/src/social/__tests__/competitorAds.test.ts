/**
 * A competitor's ad as the owner brings it from Meta's Ad Library: the card's
 * own lines say when it started and how far it was scaled, and what is left is
 * the ad's words.
 */
import { describe, expect, it } from 'vitest';

import { readLibraryCard } from '../competitorAds';

const NOW = Date.parse('2026-11-01T12:00:00Z');

describe('readLibraryCard', () => {
  it('reads a card copied from the Library', () => {
    const card = readLibraryCard(
      [
        'Active',
        'Library ID: 1234567890123',
        'Started running on 12 Oct 2026',
        'Platforms',
        '3 ads use this creative and text',
        'See ad details',
        'Lawn Collection',
        'Sponsored',
        'Eid lawn 2026 is here — 3-piece suits from Rs 3,999.',
        'Free delivery across Pakistan. Shop now',
      ].join('\n'),
      NOW,
    );
    expect(card).toEqual({
      text: 'Lawn Collection\nEid lawn 2026 is here — 3-piece suits from Rs 3,999.\nFree delivery across Pakistan. Shop now',
      startedOn: '2026-10-12',
      daysRunning: 21,
      versions: 3,
      libraryId: '1234567890123',
    });
  });

  it('reads the American date order and a single version', () => {
    const card = readLibraryCard('Started running on Oct 30, 2026\n1 ad uses this creative and text\nBuy one get one', NOW);
    expect(card.startedOn).toBe('2026-10-30');
    expect(card.daysRunning).toBe(3);
    expect(card.text).toBe('Buy one get one');
  });

  it('says nothing it cannot read: no start date means no days, never a guess', () => {
    const card = readLibraryCard('Summer sale, 50% off everything', NOW);
    expect(card).toMatchObject({ startedOn: null, daysRunning: null, versions: null, libraryId: null });
  });
});
