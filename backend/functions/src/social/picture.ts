/**
 * The picture under the words.
 *
 * Every post, story, slide and reel cover used to be type on near-black,
 * because nothing on the desk could make a picture. This finds one for each
 * frame, best first:
 *
 * 1. **Drawn for this frame** by Gemini's image model, from the designer's art
 *    direction — the scene the piece is actually about, in the brand's look.
 *    About three US cents a picture, on the AI meter, and skipped for a
 *    workspace whose month's AI budget is spent.
 * 2. **A stock photograph** from Pixabay, searched with the frame's own words.
 *    Free, and plainer.
 * 3. **None** — `still.ts` paints a brand gradient rather than a flat card.
 *
 * The model is told never to draw words, so every word on a card is one the
 * writer chose and the checks read, set in our own type. And it is told to keep
 * people anonymous: a picture the model made must never be passed off as a
 * real driver or a real customer.
 *
 * Fails soft at every step: a refused picture is a stock photo, a missing one is
 * a gradient, and neither ever fails the piece.
 */
import { writeFile } from 'node:fs/promises';

import { logger } from 'firebase-functions';

import { budgetLeft, overBudget } from '../ai/config';
import { houseStyle } from './designer';
import { stockPhoto } from './footage';
import { geminiImage, geminiReady } from './gemini';
import type { StillAspect, StillLayout } from './still';

/** What every drawn picture is held to, whatever the art direction says. */
export function pictureRules(aspect: StillAspect | '16:9', layout: StillLayout = 'bottom'): string {
  const space =
    layout === 'top' ? 'Keep the top third calm and uncluttered' : 'Keep the bottom third calm and uncluttered';
  return [
    `A ${aspect === '16:9' ? 'horizontal 16:9' : aspect === '9:16' ? 'vertical 9:16' : 'vertical 4:5'} photograph.`,
    `${space} — a headline will be set there afterwards. The subject sits in the other two thirds.`,
    'People are anonymous: seen from behind, at a distance, in silhouette or partly in frame — never a posed portrait presented as a specific real person.',
    'Absolutely no text, letters, numbers, logos, signs with writing, or watermarks anywhere in the picture.',
    // Asked for by the owner on 20 Nov 2026, and it belongs here rather than in
    // a brief: this is the one line every drawn picture passes through, for
    // every workspace, whatever the art direction or the customer asked for.
    // A picture that shames somebody cannot be unsent once it is on a Page.
    'Nothing that could offend or hurt anyone, whoever asked for it: no violence, blood, injury, weapons or crash scenes; ' +
      'no nudity, suggestive poses or clothing used as a joke; no alcohol, drugs or smoking; ' +
      'no religious figures, scripture, worship or places of worship used as decoration; no political figures, parties, flags or slogans; ' +
      'nobody shown as poor, disabled, old, fat, low-caste, foreign or of any faith in order to be laughed at or pitied; ' +
      'and no child alone with an adult. If the art direction asks for any of that, draw the safe version of the scene instead.',
  ].join(' ');
}

/** The full prompt for one picture. Pure. */
export function picturePrompt(scene: string, aspect: StillAspect | '16:9', layout?: StillLayout): string {
  return [scene.trim(), houseStyle(), pictureRules(aspect, layout)].filter(Boolean).join('\n');
}

export type PictureSource = 'drawn' | 'stock';

/**
 * A capped month keeps this much for the writing: pictures are the dearest
 * thing per piece, so once the month is this low they come from stock instead
 * and the rest of the calendar still gets written.
 */
export const PICTURE_FLOOR_USD = 1;

/**
 * One picture for a frame, written to `out`. Null when neither the model nor
 * the stock library had one. `skip` carries the stock photos a set already
 * used, so a carousel never shows the same photograph twice. `drawn: false`
 * goes straight to stock.
 */
export async function pictureFor(params: {
  scene: string;
  query: string;
  aspect: StillAspect | '16:9';
  layout?: StillLayout;
  out: string;
  skip?: Set<number>;
  drawn?: boolean;
}): Promise<{ path: string; source: PictureSource } | null> {
  const mayDraw = params.drawn !== false && geminiReady() && !overBudget() && budgetLeft() > PICTURE_FLOOR_USD;
  if (params.scene.trim() && mayDraw) {
    try {
      const bytes = await geminiImage(picturePrompt(params.scene, params.aspect, params.layout), params.aspect);
      await writeFile(params.out, bytes);
      return { path: params.out, source: 'drawn' };
    } catch (e) {
      logger.warn('social: the picture could not be drawn; trying stock', { error: (e as Error).message });
    }
  }
  try {
    const path = await stockPhoto({
      query: params.query,
      orientation: params.aspect === '16:9' ? 'horizontal' : 'vertical',
      out: params.out,
      skip: params.skip,
    });
    return path ? { path, source: 'stock' } : null;
  } catch (e) {
    logger.warn('social: no stock photo either; the card gets the gradient', { error: (e as Error).message });
    return null;
  }
}
