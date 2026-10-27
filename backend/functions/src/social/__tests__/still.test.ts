/**
 * The still pictures, laid out without ffmpeg: which words go on which slide,
 * that they stay inside the part of the frame nobody's interface covers, and
 * that a card is a picture with words on it — never the flat dark card the
 * desk used to post.
 */
import { describe, expect, it } from 'vitest';

import { LIME } from '../reel';
import { ACCENTS, accentFor, layoutFor, planStill, stillCards, stillGraph } from '../still';
import type { PostScript } from '../types';

const script: PostScript = {
  hook: 'Your fare, your offer. No surge, ever.',
  hookVariants: [],
  frames: [
    { scene: 'a rider typing a fare', overlay: 'Offer your own fare', stock: 'woman phone street' },
    { scene: 'bids arriving', overlay: 'Drivers bid on it' },
    { scene: 'cash in hand', overlay: 'Pay in cash' },
  ],
  voiceover: '',
  cta: 'Download Velocity Rides',
  rationale: '',
  viralHook: '',
};

const paths = { textFiles: ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt', 'h.txt'], displayFont: 'D.ttf', bodyFont: 'B.ttf' };

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

  it("draws each picture from the designer's art direction, else the writer's scene", () => {
    const [post] = stillCards({ format: 'post', script, direction: [{ overlay: 'x', picture: 'a rickshaw at dusk in Karachi' }] });
    expect(post.scene).toBe('a rickshaw at dusk in Karachi');
    const cards = stillCards({ format: 'carousel', script, direction: null });
    expect(cards.map((c) => c.scene)).toEqual(['a rider typing a fare', 'bids arriving', 'cash in hand']);
    // The writer's stock words when given; the first frame's stand in for a frame that has none.
    expect(cards[0].query).toBe('woman phone street');
    expect(cards[2].query).toBe('woman phone street');
  });

  it('keeps one layout for every slide of a set', () => {
    const cards = stillCards({ format: 'carousel', script, direction: null, postId: '2026-10-27-carousel' });
    expect(new Set(cards.map((c) => c.layout)).size).toBe(1);
  });
});

describe('the look', () => {
  it('varies the layout between pieces, and never sets a story’s words over its reply box', () => {
    const posts = new Set(Array.from({ length: 30 }, (_, i) => layoutFor(`2026-10-${i}-post`, '4:5')));
    expect(posts.size).toBeGreaterThan(1);
    for (let i = 0; i < 30; i++) expect(layoutFor(`2026-10-${i}-story`, '9:16')).not.toBe('bottom');
  });

  it('is lime in the house and one stable accent per customer', () => {
    expect(accentFor(null)).toBe(LIME);
    expect(accentFor('ws-1')).toBe(accentFor('ws-1'));
    expect(ACCENTS).toContain(accentFor('ws-2') as (typeof ACCENTS)[number]);
  });
});

describe('planStill', () => {
  it('keeps a long headline inside the band', () => {
    for (const layout of ['bottom', 'top', 'highlight'] as const) {
      const card = planStill({
        headline: 'This is a deliberately long headline that has to wrap onto several lines to fit',
        body: 'And a line underneath it as well',
        aspect: '4:5',
        layout,
      });
      const bottom = card.body!.y + card.body!.lines.length * card.body!.lineHeight;
      expect(card.headline.y).toBeGreaterThanOrEqual(170);
      expect(bottom).toBeLessThanOrEqual(1350);
    }
  });

  it('sets the words at the top or ending at the foot, clear of the subject in the middle', () => {
    const top = planStill({ headline: 'Short', aspect: '9:16', layout: 'top' });
    const foot = planStill({ headline: 'Short', aspect: '9:16', layout: 'bottom' });
    expect(top.headline.y).toBeLessThan(600);
    expect(foot.headline.y).toBeGreaterThan(1200);
  });
});

describe('stillGraph', () => {
  it('ends on the label the render maps', () => {
    const card = planStill({ headline: 'Hello', aspect: '9:16', counter: '1/2' });
    const graph = stillGraph(card, paths);
    expect(graph.endsWith('[out]')).toBe(true);
    expect(graph).toContain("text='1/2'");
  });

  it('sets the words over the picture, with a fade under them', () => {
    const card = planStill({ headline: 'Hello there', body: 'Book now', aspect: '4:5', layout: 'bottom' });
    const graph = stillGraph(card, { ...paths, photo: '/tmp/p.jpg', accent: '0xffb020' });
    expect(graph).toMatch(/^\[0:v\]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350/);
    expect(graph).toContain('geq=r=0:g=0:b=0:a=');
    expect(graph).toContain('[photo][fade]overlay');
    // The ask is a pill in the desk's accent.
    expect(graph).toContain('boxcolor=0xffb020');
  });

  it('paints a gradient, not a flat card, when there is no picture at all', () => {
    const card = planStill({ headline: 'Hello', aspect: '4:5' });
    const graph = stillGraph(card, paths);
    expect(graph).not.toContain('[0:v]');
    expect(graph).toMatch(/geq=r='[\d+()\-*/ YH]+':g=/);
  });

  it('highlights each headline line in the accent on a highlight card', () => {
    const card = planStill({ headline: 'Lahore to Islamabad for less than the bus', aspect: '4:5', layout: 'highlight' });
    const graph = stillGraph(card, { ...paths, photo: '/tmp/p.jpg' });
    const boxed = graph.split(';').filter((s) => s.includes('textfile=') && s.includes(`boxcolor=${LIME}`));
    expect(boxed).toHaveLength(card.headline.lines.length);
  });
});
