/**
 * The still pictures — the post image, the story frame, the carousel slides,
 * the reel cover — made by the desk with the same ffmpeg and the same two fonts
 * that cut the reel.
 *
 * Every card is a photograph with the words set on it: the picture the
 * designer art-directed (drawn by Gemini's image model, or a stock photograph
 * when that cannot be had — `picture.ts` decides), a scrim so the words read,
 * the headline in heavy white type, and the ask in a coloured pill. Only when
 * no picture could be had at all does a card fall back to a brand gradient —
 * never the flat near-black card the desk used to post, which read on the grid
 * as "a black screen with green on it". A picture attached by hand still wins:
 * the pipeline only fills the slides nobody attached.
 *
 * Three layouts, chosen per piece so a week of posts does not look like one
 * post five times: the words at the foot over a dark fade, at the top over a
 * fade from above, or as highlighted blocks. A carousel keeps one layout for
 * every slide, because a set that changes style on each swipe reads as five
 * unrelated posts.
 *
 * Same split as `reel.ts`: `planStill` and `stillGraph` are pure, so the
 * wrapping and the layout are tested in CI without ffmpeg; only `renderStill`
 * spawns anything.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { escapeArg, ffmpegPath, fit, fontDir, INK, LIME, PAPER, runFfmpeg, stockQuery } from './reel';
import type { ContentFormat, PostScript } from './types';

export type StillAspect = '4:5' | '9:16';
export type StillLayout = 'bottom' | 'top' | 'highlight';

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
/** The padding a highlight box or the ask's pill extends past its words. */
const PAD = 18;

/**
 * Accents a customer's desk is drawn in: bright enough that near-black words
 * read on each. Velocity's own desk is always lime.
 */
export const ACCENTS = [LIME, '0xffb020', '0x34d3ff', '0xff6b8b', '0x9d8cff', '0x2ee6a6'] as const;

/** A stable small number from a string — the same piece always gets the same look. */
export function hashOf(text: string): number {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** The accent for a workspace: lime in the house, one stable colour per customer. */
export function accentFor(workspaceId: string | null): string {
  return workspaceId ? ACCENTS[hashOf(workspaceId) % ACCENTS.length] : LIME;
}

/** The layout for a piece. A story never sets its words at the foot, where the reply box sits. */
export function layoutFor(postId: string, aspect: StillAspect): StillLayout {
  const choices: StillLayout[] = aspect === '9:16' ? ['top', 'highlight'] : ['bottom', 'highlight', 'top'];
  return choices[hashOf(postId) % choices.length];
}

export interface StillCard {
  aspect: StillAspect;
  width: number;
  height: number;
  layout: StillLayout;
  headline: { lines: string[]; size: number; y: number; lineHeight: number };
  /** The ask, set in a pill under the headline. */
  body: { lines: string[]; size: number; y: number; lineHeight: number } | null;
  /** "2/5" on a carousel slide, so the swipe has a reason. */
  counter: string | null;
  /** What the picture behind the words shows — the art direction, for the image model. */
  scene: string;
  /** A short stock-photo search for the same picture, when the image model cannot draw it. */
  query: string;
}

/** Lay one card out. Pure — no clock, no files. */
export function planStill(params: {
  headline: string;
  body?: string | null;
  aspect: StillAspect;
  layout?: StillLayout;
  counter?: string | null;
  scene?: string;
  query?: string;
}): StillCard {
  const { width, height } = SIZES[params.aspect];
  const band = BAND[params.aspect];
  const layout = params.layout ?? 'bottom';
  const textWidth = width - SIDE * 2 - (layout === 'highlight' ? PAD * 2 : 0);

  const head = fit(params.headline.trim(), { start: layout === 'highlight' ? 96 : 112, min: 58, width: textWidth, maxLines: 5 });
  const bodyText = params.body?.trim() ?? '';
  const body = bodyText ? fit(bodyText, { start: 46, min: 34, width: textWidth - PAD * 2, maxLines: 3 }) : null;

  // A highlight box carries its padding above and below every line.
  const headLine = Math.round(head.size * 1.12) + (layout === 'highlight' ? PAD * 2 : 0);
  const bodyLine = body ? Math.round(body.size * 1.25) + PAD : 0;
  const headHeight = headLine * head.lines.length;
  const gap = body ? 44 : 0;
  const bodyHeight = body ? bodyLine * body.lines.length + PAD : 0;
  const block = headHeight + gap + bodyHeight;

  // At the top of the band, or ending at its foot: either way clear of the
  // middle of the frame, which is where the picture's subject is.
  const top = layout === 'top' ? band.top + 30 : Math.max(band.top, band.bottom - block);
  const scene = params.scene?.trim() || params.headline.trim();

  return {
    aspect: params.aspect,
    width,
    height,
    layout,
    headline: { lines: head.lines, size: head.size, y: top, lineHeight: headLine },
    body: body ? { lines: body.lines, size: body.size, y: top + headHeight + gap, lineHeight: bodyLine } : null,
    counter: params.counter ?? null,
    scene,
    query: params.query?.trim() || stockQuery(scene),
  };
}

/**
 * The words for each picture a piece needs, in slide order.
 *
 * The designer's `overlay` is the line they chose to burn into the frame, so it
 * wins; the writer's frame text is next, and the hook carries the first slide
 * when neither said anything. The call to action closes a post, a story, and
 * the last slide of a carousel. The picture under each comes from the
 * designer's art direction for that frame, else the writer's scene.
 */
export function stillCards(params: {
  format: ContentFormat;
  script: PostScript;
  direction: { overlay: string; picture?: string }[] | null;
  /** Seeds the layout; the same piece always draws the same way. */
  postId?: string;
}): StillCard[] {
  const { format, script } = params;
  const direction = params.direction ?? [];
  const aspect: StillAspect = format === 'story' ? '9:16' : '4:5';
  const layout = layoutFor(params.postId ?? script.hook, aspect);
  const cta = script.cta?.trim() || null;
  const sceneAt = (i: number) => direction[i]?.picture?.trim() || script.frames[i]?.scene?.trim() || script.frames[0]?.scene?.trim() || '';
  const queryAt = (i: number) => script.frames[i]?.stock?.trim() || script.frames[0]?.stock?.trim() || '';

  if (format !== 'carousel') {
    const headline = direction[0]?.overlay?.trim() || script.hook;
    return [
      planStill({
        headline,
        body: cta && cta !== headline ? cta : null,
        aspect,
        layout,
        scene: sceneAt(0),
        query: queryAt(0),
      }),
    ];
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
      layout,
      counter: `${i + 1}/${count}`,
      scene: sceneAt(i),
      query: queryAt(i),
    });
  });
}

export interface StillPaths {
  /** One file per line: headline lines first, then body lines. */
  textFiles: string[];
  displayFont: string;
  bodyFont: string;
  /** The brand line at the foot, as a file; absent means Velocity's own. */
  wordmarkFile?: string;
  /** The picture under the words. Absent means the brand gradient. */
  photo?: string;
  /** The accent, as ffmpeg's 0xRRGGBB. Lime when absent. */
  accent?: string;
}

/** Dark gradients a card falls back to, one per piece: never the same flat black. */
const GRADIENTS: [number[], number[]][] = [
  [[26, 28, 28], [14, 58, 38]],
  [[16, 24, 40], [26, 28, 28]],
  [[26, 28, 28], [58, 22, 52]],
  [[10, 44, 52], [26, 28, 28]],
];

/** The card as one ffmpeg filter graph. Pure, like `filterGraph` in reel.ts. */
export function stillGraph(card: StillCard, paths: StillPaths): string {
  const { width: W, height: H } = card;
  const accent = paths.accent ?? LIME;
  const steps: string[] = [];

  if (paths.photo) {
    // Fill the frame, a touch of contrast so a flat stock photo does not read grey.
    steps.push(
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,` +
        `eq=contrast=1.06:saturation=1.1,format=rgba[photo]`,
    );
    // The fade the words sit on, darkest where they are.
    const alpha =
      card.layout === 'top'
        ? `clip((H*0.62-Y)/(H*0.62)\\,0\\,1)*225`
        : `clip((Y-H*0.32)/(H*0.68)\\,0\\,1)*230`;
    steps.push(`color=c=black:s=${W}x${H}:d=1,format=rgba,geq=r=0:g=0:b=0:a='${alpha}'[fade]`);
    steps.push(`[photo][fade]overlay=0:0:format=auto[bg]`);
  } else {
    const [from, to] = GRADIENTS[hashOf(card.headline.lines.join(' ')) % GRADIENTS.length];
    const ch = (i: number) => `${from[i]}+(${to[i] - from[i]})*Y/H`;
    steps.push(`color=c=black:s=${W}x${H}:d=1,format=rgb24,geq=r='${ch(0)}':g='${ch(1)}':b='${ch(2)}',format=rgba[bg]`);
  }

  let last = 'bg';
  let n = 0;
  const push = (filter: string) => {
    steps.push(`[${last}]${filter}[s${n}]`);
    last = `s${n++}`;
  };
  const shadow = 'shadowcolor=0x000000@0.55:shadowx=0:shadowy=4';

  // A hairline of the accent along the top edge: the one brand mark on every card.
  push(`drawbox=x=0:y=0:w=${W}:h=10:color=${accent}:t=fill`);

  const head = card.headline;
  if (card.layout !== 'highlight') {
    push(`drawbox=x=${SIDE}:y=${head.y - 40}:w=150:h=10:color=${accent}:t=fill`);
  }
  head.lines.forEach((_, i) => {
    const y = head.y + i * head.lineHeight + (card.layout === 'highlight' ? PAD : 0);
    const look =
      card.layout === 'highlight'
        ? `fontcolor=${INK}:box=1:boxcolor=${accent}:boxborderw=${PAD}`
        : `fontcolor=${PAPER}:${shadow}`;
    push(
      `drawtext=fontfile='${escapeArg(paths.displayFont)}':textfile='${escapeArg(paths.textFiles[i])}':` +
        `${look}:fontsize=${head.size}:x=${SIDE + (card.layout === 'highlight' ? PAD : 0)}:y=${y}`,
    );
  });

  if (card.body) {
    const body = card.body;
    // The ask is a pill: the accent with dark words, or white on a highlight card.
    const pill = card.layout === 'highlight' ? PAPER : accent;
    body.lines.forEach((_, i) => {
      push(
        `drawtext=fontfile='${escapeArg(paths.bodyFont)}':textfile='${escapeArg(paths.textFiles[head.lines.length + i])}':` +
          `fontcolor=${INK}:box=1:boxcolor=${pill}:boxborderw=${PAD}:fontsize=${body.size}:` +
          `x=${SIDE + PAD}:y=${body.y + PAD + i * body.lineHeight}`,
      );
    });
  }

  if (card.counter) {
    push(
      `drawtext=fontfile='${escapeArg(paths.bodyFont)}':text='${card.counter}':` +
        `fontcolor=${PAPER}@0.85:${shadow}:fontsize=34:x=w-tw-${SIDE}:y=${BAND[card.aspect].top - 90}`,
    );
  }

  push(
    `drawtext=fontfile='${escapeArg(paths.bodyFont)}':` +
      (paths.wordmarkFile ? `textfile='${escapeArg(paths.wordmarkFile)}'` : `text='VELOCITY RIDES'`) +
      `:fontcolor=${PAPER}@0.8:${shadow}:` +
      `fontsize=32:x=${SIDE}:y=${BAND[card.aspect].bottom + 56}`,
  );

  // The last label has to be the one -map asks for.
  steps[steps.length - 1] = steps[steps.length - 1].replace(/\[s\d+\]$/, '[out]');
  return steps.join(';');
}

/** Render one card to JPEG bytes — the only format Instagram publishes. */
export async function renderStill(
  card: StillCard,
  opts: { ffmpeg?: string; wordmark?: string; photo?: string | null; accent?: string } = {},
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-still-'));
  try {
    const lines = [...card.headline.lines, ...(card.body?.lines ?? [])];
    const textFiles: string[] = [];
    for (const [i, line] of lines.entries()) {
      const file = path.join(dir, `l${i}.txt`);
      await writeFile(file, line, 'utf8');
      textFiles.push(file);
    }
    const wordmarkFile = opts.wordmark ? path.join(dir, 'wordmark.txt') : undefined;
    if (wordmarkFile) await writeFile(wordmarkFile, opts.wordmark as string, 'utf8');

    const graphFile = path.join(dir, 'graph.txt');
    await writeFile(
      graphFile,
      stillGraph(card, {
        textFiles,
        displayFont: path.join(fontDir(), 'Outfit-Black.ttf'),
        bodyFont: path.join(fontDir(), 'WorkSans-SemiBold.ttf'),
        wordmarkFile,
        photo: opts.photo ?? undefined,
        accent: opts.accent,
      }),
      'utf8',
    );

    const out = path.join(dir, 'still.jpg');
    await runFfmpeg(opts.ffmpeg ?? ffmpegPath(), [
      ...(opts.photo ? ['-i', opts.photo] : []),
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
