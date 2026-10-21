/**
 * The still pictures — the post image, the story frame, the carousel slides —
 * made by the desk with the same ffmpeg and the same two fonts that cut the
 * reel.
 *
 * Until this existed the designer stopped at a brief, so every post and story
 * reached the queue needing a person to make the picture, and nothing in those
 * formats could ever go out on its own. This draws the words the designer and
 * the writer already chose onto the brand canvas instead: a typographic card,
 * near-black and lime, the same look as the reels. A picture attached by hand
 * still wins — the pipeline only fills the slides nobody attached.
 *
 * Same split as `reel.ts`: `planStill` and `stillGraph` are pure, so the
 * wrapping and the layout are tested in CI without ffmpeg; only `renderStill`
 * spawns anything.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { escapeArg, ffmpegPath, fit, fontDir, INK, LIME, PAPER, runFfmpeg } from './reel';
import type { ContentFormat, PostScript } from './types';

export type StillAspect = '4:5' | '9:16';

const SIZES: Record<StillAspect, { width: number; height: number }> = {
  '4:5': { width: 1080, height: 1350 },
  '9:16': { width: 1080, height: 1920 },
};

/**
 * Where text may sit. A story's top 250px hold the progress bars and the
 * profile row, and the bottom 340 the reply box; a feed image is cropped to a
 * square in the profile grid, so its words stay inside the middle 1080.
 */
const BAND: Record<StillAspect, { top: number; bottom: number }> = {
  '4:5': { top: 170, bottom: 1180 },
  '9:16': { top: 300, bottom: 1520 },
};

const SIDE = 96;

export interface StillCard {
  aspect: StillAspect;
  width: number;
  height: number;
  headline: { lines: string[]; size: number; y: number; lime: boolean };
  body: { lines: string[]; size: number; y: number } | null;
  /** "2/5" on a carousel slide, so the swipe has a reason. */
  counter: string | null;
}

/** Lay one card out. Pure — no clock, no files. */
export function planStill(params: {
  headline: string;
  body?: string | null;
  aspect: StillAspect;
  lime?: boolean;
  counter?: string | null;
}): StillCard {
  const { width, height } = SIZES[params.aspect];
  const band = BAND[params.aspect];
  const textWidth = width - SIDE * 2;

  const head = fit(params.headline.trim(), { start: 120, min: 60, width: textWidth, maxLines: 5 });
  const bodyText = params.body?.trim() ?? '';
  const body = bodyText ? fit(bodyText, { start: 54, min: 38, width: textWidth, maxLines: 4 }) : null;

  const headHeight = Math.round(head.size * 1.14) * head.lines.length;
  const gap = body ? 48 : 0;
  const bodyHeight = body ? Math.round(body.size * 1.3) * body.lines.length : 0;
  const block = headHeight + gap + bodyHeight;

  // A little above centre, which is where the eye lands on a still.
  const top = band.top + Math.max(0, Math.round((band.bottom - band.top - block) / 2) - 40);

  return {
    aspect: params.aspect,
    width,
    height,
    headline: { lines: head.lines, size: head.size, y: top, lime: params.lime ?? true },
    body: body ? { lines: body.lines, size: body.size, y: top + headHeight + gap } : null,
    counter: params.counter ?? null,
  };
}

/**
 * The words for each picture a piece needs, in slide order.
 *
 * The designer's `overlay` is the line they chose to burn into the frame, so it
 * wins; the writer's frame text is next, and the hook carries the first slide
 * when neither said anything. The call to action closes a post, a story, and
 * the last slide of a carousel.
 */
export function stillCards(params: {
  format: ContentFormat;
  script: PostScript;
  direction: { overlay: string }[] | null;
}): StillCard[] {
  const { format, script } = params;
  const direction = params.direction ?? [];
  const aspect: StillAspect = format === 'story' ? '9:16' : '4:5';
  const cta = script.cta?.trim() || null;

  if (format !== 'carousel') {
    const headline = direction[0]?.overlay?.trim() || script.hook;
    return [planStill({ headline, body: cta && cta !== headline ? cta : null, aspect })];
  }

  const count = Math.min(10, Math.max(2, direction.length || script.frames.length || 5));
  return Array.from({ length: count }, (_, i) => {
    const headline =
      direction[i]?.overlay?.trim() ||
      script.frames[i]?.overlay?.trim() ||
      (i === 0 ? script.hook : script.frames[i]?.scene?.trim() || script.hook);
    const last = i === count - 1;
    return planStill({
      headline,
      body: last && cta && cta !== headline ? cta : null,
      aspect,
      lime: i === 0 || last,
      counter: `${i + 1}/${count}`,
    });
  });
}

export interface StillPaths {
  /** One file per line: headline lines first, then body lines. */
  textFiles: string[];
  displayFont: string;
  bodyFont: string;
}

/** The card as one ffmpeg filter graph. Pure, like `filterGraph` in reel.ts. */
export function stillGraph(card: StillCard, paths: StillPaths): string {
  const steps: string[] = [`color=c=${INK}:s=${card.width}x${card.height}:d=1,format=rgba[bg]`];
  let last = 'bg';
  let n = 0;
  const push = (filter: string) => {
    steps.push(`[${last}]${filter}[s${n}]`);
    last = `s${n++}`;
  };

  // The lime rule the eye arrives on, and a hairline along the top edge.
  push(`drawbox=x=0:y=0:w=${card.width}:h=10:color=${LIME}:t=fill`);
  push(`drawbox=x=${SIDE}:y=${card.headline.y - 54}:w=180:h=10:color=${LIME}:t=fill`);

  const head = card.headline;
  const headLine = Math.round(head.size * 1.14);
  head.lines.forEach((_, i) => {
    push(
      `drawtext=fontfile='${escapeArg(paths.displayFont)}':textfile='${escapeArg(paths.textFiles[i])}':` +
        `fontcolor=${head.lime ? LIME : PAPER}:fontsize=${head.size}:x=${SIDE}:y=${head.y + i * headLine}`,
    );
  });

  if (card.body) {
    const bodyLine = Math.round(card.body.size * 1.3);
    card.body.lines.forEach((_, i) => {
      push(
        `drawtext=fontfile='${escapeArg(paths.bodyFont)}':textfile='${escapeArg(paths.textFiles[head.lines.length + i])}':` +
          `fontcolor=${PAPER}:fontsize=${card.body!.size}:x=${SIDE}:y=${card.body!.y + i * bodyLine}`,
      );
    });
  }

  if (card.counter) {
    push(
      `drawtext=fontfile='${escapeArg(paths.bodyFont)}':text='${card.counter}':` +
        `fontcolor=${PAPER}@0.6:fontsize=34:x=w-tw-${SIDE}:y=${BAND[card.aspect].top - 90}`,
    );
  }

  push(
    `drawtext=fontfile='${escapeArg(paths.bodyFont)}':text='VELOCITY RIDES':fontcolor=${PAPER}@0.55:` +
      `fontsize=34:x=${SIDE}:y=${BAND[card.aspect].bottom + 30}`,
  );

  // The last label has to be the one -map asks for.
  steps[steps.length - 1] = steps[steps.length - 1].replace(/\[s\d+\]$/, '[out]');
  return steps.join(';');
}

/** Render one card to JPEG bytes — the only format Instagram publishes. */
export async function renderStill(card: StillCard, opts: { ffmpeg?: string } = {}): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-still-'));
  try {
    const lines = [...card.headline.lines, ...(card.body?.lines ?? [])];
    const textFiles: string[] = [];
    for (const [i, line] of lines.entries()) {
      const file = path.join(dir, `l${i}.txt`);
      await writeFile(file, line, 'utf8');
      textFiles.push(file);
    }

    const graphFile = path.join(dir, 'graph.txt');
    await writeFile(
      graphFile,
      stillGraph(card, {
        textFiles,
        displayFont: path.join(fontDir(), 'Outfit-Black.ttf'),
        bodyFont: path.join(fontDir(), 'WorkSans-SemiBold.ttf'),
      }),
      'utf8',
    );

    const out = path.join(dir, 'still.jpg');
    await runFfmpeg(opts.ffmpeg ?? ffmpegPath(), [
      '-filter_complex_script',
      graphFile,
      '-map',
      '[out]',
      '-frames:v',
      '1',
      '-pix_fmt',
      'yuvj420p',
      '-q:v',
      '2',
      '-y',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
