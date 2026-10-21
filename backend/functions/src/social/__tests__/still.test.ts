/**
 * The still pictures, laid out without ffmpeg: which words go on which slide,
 * and that they stay inside the part of the frame nobody's interface covers.
 */
import { describe, expect, it } from 'vitest';

import { planStill, stillCards, stillGraph } from '../still';
import type { PostScript } from '../types';

const script: PostScript = {
  hook: 'Your fare, your offer. No surge, ever.',
  hookVariants: [],
  frames: [
    { scene: 'a rider typing a fare', overlay: 'Offer your own fare' },
    { scene: 'bids arriving', overlay: 'Drivers bid on it' },
    { scene: 'cash in hand', overlay: 'Pay in cash' },
  ],
  voiceover: '',
  cta: 'Download Velocity Rides',
  rationale: '',
  viralHook: '',
};

describe('stillCards', () => {
  it('gives a post one 4:5 card, the designer’s words first, the ask below', () => {
    const [card, ...rest] = stillCards({ format: 'post', script, direction: [{ overlay: 'Name your fare' }] });
    expect(rest).toHaveLength(0);
    expect(card.aspect).toBe('4:5');
    expect(card.headline.lines.join(' ')).toBe('Name your fare');
    expect(card.body?.lines.join(' ')).toBe('Download Velocity Rides');
  });

  it('falls back to the hook when nobody wrote words for the frame', () => {
    const [card] = stillCards({ format: 'story', script, direction: null });
    expect(card.aspect).toBe('9:16');
    expect(card.headline.lines.join(' ')).toBe(script.hook);
  });

  it('numbers a carousel and closes it with the ask', () => {
    const cards = stillCards({ format: 'carousel', script, direction: null });
    expect(cards.map((c) => c.counter)).toEqual(['1/3', '2/3', '3/3']);
    expect(cards[0].headline.lines.join(' ')).toBe('Offer your own fare');
    expect(cards[2].body?.lines.join(' ')).toBe('Download Velocity Rides');
    expect(cards[1].body).toBeNull();
  });
});

describe('planStill', () => {
  it('keeps a long headline inside the band', () => {
    const card = planStill({
      headline: 'This is a deliberately long headline that has to wrap onto several lines to fit',
      body: 'And a line underneath it as well',
      aspect: '4:5',
    });
    const bottom = card.body!.y + card.body!.lines.length * Math.round(card.body!.size * 1.3);
    expect(card.headline.y).toBeGreaterThanOrEqual(170);
    expect(bottom).toBeLessThanOrEqual(1350);
  });
});

describe('stillGraph', () => {
  it('ends on the label the render maps', () => {
    const card = planStill({ headline: 'Hello', aspect: '9:16', counter: '1/2' });
    const graph = stillGraph(card, { textFiles: ['a.txt'], displayFont: 'D.ttf', bodyFont: 'B.ttf' });
    expect(graph.endsWith('[out]')).toBe(true);
    expect(graph).toContain("text='1/2'");
  });
});
