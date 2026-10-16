/**
 * The reel renderer — a finished vertical video, made by the desk, for nothing.
 *
 * Every open tool that claims to make short videos automatically turns out to
 * need something paid behind it: a Pexels key for the stock footage, a
 * text-to-speech model, an image model per frame, or a rendering service. This
 * needs none of them. It is ffmpeg, two OFL fonts and the script the writer
 * already wrote, and the only thing it costs is the CPU seconds of the render.
 *
 * What it makes is a **kinetic typography reel**: the hook, then one line per
 * beat, moving on the brand's near-black and lime, cut to the timings
 * `lint.ts` already computes from the spoken script. That is not a compromise
 * format — text reels are one of the most watched shapes on the platform,
 * because the feed is watched muted and words are the only thing that survives
 * that. When slides have been attached to the piece they are used as the
 * backdrop with a slow push-in, and when they have not, the typography carries
 * it alone. Either way a video exists at the end of the run rather than a brief
 * somebody has to find time for.
 *
 * Three things worth knowing before changing anything:
 *
 * 1. **The planning is pure, the rendering is not.** `planReel` and
 *    `filterGraph` are functions of their arguments with no clock, no files and
 *    no ffmpeg, so the hard part — the timings, the wrapping, the safe zone —
 *    is unit-tested in CI, which has no ffmpeg in it. Only `renderReel` spawns
 *    anything.
 * 2. **Nothing is drawn outside the safe zone.** Instagram's own interface
 *    covers the top 220px, the bottom 450px and a column down the right. Text
 *    placed there is text nobody reads, and it is the commonest way an
 *    otherwise good reel is wasted.
 * 3. **It still stops at the queue.** A rendered reel is attached to the piece
 *    exactly as a hand-made file is, through the same storage path and the same
 *    media array, so it publishes through the same approval it always did. The
 *    desk makes the video; it does not decide to post it.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from 'firebase-functions';

import { beatSheet } from './lint';
import { FORMAT_SPECS, type ContentFormat, type PostScript } from './types';

// ── the canvas ──────────────────────────────────────────────────────────────

/** Near-black and lime, the same two colours as the app. */
const INK = '0x1a1c1c';
const LIME = '0xccff00';
const PAPER = '0xf4f6f3';

const FPS = 30;

/**
 * Instagram's interface sits on top of a reel, so these are the pixels we do
 * not own. Numbers from the Reels safe zone: the header, the caption and audio
 * row at the bottom, and the like/comment/share column down the right.
 */
const SAFE = { top: 240, bottom: 1470, side: 90, rightColumn: 120 } as const;

export interface ReelSize {
  width: number;
  height: number;
}

const SIZES: Record<'reel' | 'video', ReelSize> = {
  reel: { width: 1080, height: 1920 },
  video: { width: 1920, height: 1080 },
};

// ── planning ────────────────────────────────────────────────────────────────

export type BeatKind = 'hook' | 'body' | 'cta';

export interface PlannedBeat {
  kind: BeatKind;
  /** Already wrapped to the width available, longest-line-first is not implied. */
  lines: string[];
  start: number;
  end: number;
  size: number;
}

export interface ReelPlan {
  size: ReelSize;
  fps: number;
  seconds: number;
  beats: PlannedBeat[];
  /** The slide images to sit behind the words, in order. May be empty. */
  images: string[];
}

/**
 * How wide one character is, as a fraction of the font size.
 *
 * Outfit Black is a geometric sans and its uppercase advances cluster tightly
 * around this, so a straight multiply wraps correctly without shaping the text
 * — which would mean parsing the font at runtime to save a line break nobody
 * would notice. It is deliberately a little wide: a line that wraps one word
 * early looks considered, and a line that overflows the frame looks broken.
 */
const CHAR_WIDTH = 0.56;

/** Break a line into as few lines as fit, without splitting a word. */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Pick a size that fills the frame without overflowing it.
 *
 * Shrink until the longest word fits on one line and the whole block fits in
 * the band — big text is the entire point of the format, so this starts
 * generous and comes down rather than starting safe and going up.
 */
function fit(text: string, opts: { start: number; min: number; width: number; maxLines: number }): {
  size: number;
  lines: string[];
} {
  for (let size = opts.start; size >= opts.min; size -= 6) {
    const maxChars = Math.floor(opts.width / (size * CHAR_WIDTH));
    const longestWord = Math.max(...text.split(/\s+/).map((w) => w.length), 0);
    if (longestWord > maxChars) continue;
    const lines = wrap(text, maxChars);
    if (lines.length <= opts.maxLines) return { size, lines };
  }
  // Nothing fits even at the floor: wrap at the floor and let the block be
  // tall. A small, complete line beats a big, clipped one.
  const maxChars = Math.max(8, Math.floor(opts.width / (opts.min * CHAR_WIDTH)));
  return { size: opts.min, lines: wrap(text, maxChars) };
}

/**
 * Turn the writer's script into timed, wrapped, sized beats.
 *
 * The timings come from the same beat sheet the checks use, so what is
 * rendered and what the editor was told are the same seconds. The hook gets
 * its three seconds whatever else has to give.
 */
export function planReel(params: {
  script: PostScript;
  format: ContentFormat;
  images?: string[];
}): ReelPlan {
  const spec = FORMAT_SPECS[params.format];
  const size = SIZES[params.format === 'video' ? 'video' : 'reel'];
  const seconds = spec.seconds ?? 20;

  const textWidth = size.width - SAFE.side * 2 - (size.width === 1080 ? SAFE.rightColumn : 0);

  /** The lines the video actually shows, in order. */
  const sources: { kind: BeatKind; text: string }[] = [
    { kind: 'hook', text: params.script.hook },
    ...params.script.frames
      .map((f) => f.overlay || f.scene)
      .filter(Boolean)
      .map((text) => ({ kind: 'body' as const, text })),
  ];
  if (params.script.cta) sources.push({ kind: 'cta', text: params.script.cta });

  // How long each line takes to *say* is the honest measure of how long it
  // needs to be on screen, and the beat sheet already knows how to compute it.
  const spoken = sources.map((s) => Math.max(1.3, beatSheet(s.text, null).totalSeconds));

  // The hook is capped rather than shared proportionally. Splitting the clock
  // by length gives the longest line the most time, and the longest line is
  // almost always the hook — which would put seven seconds on the opening of a
  // twenty-second reel and contradict the one rule the whole playbook is built
  // on. It gets what it takes to say, between two and a half and four seconds,
  // and the rest of the video divides what is left.
  const hookSpan = Math.min(4, Math.max(2.5, spoken[0]));
  const rest = sources.slice(1);
  const restTotal = spoken.slice(1).reduce((a, b) => a + b, 0) || 1;
  const spare = Math.max(seconds - hookSpan, rest.length * 0.9);

  let at = 0;
  const beats: PlannedBeat[] = sources.map((source, i) => {
    const span = i === 0 ? hookSpan : (spoken[i] / restTotal) * spare;
    const { size: fontSize, lines } =
      source.kind === 'hook'
        ? fit(source.text, { start: 132, min: 66, width: textWidth, maxLines: 4 })
        : source.kind === 'cta'
          ? fit(source.text, { start: 96, min: 54, width: textWidth, maxLines: 3 })
          : fit(source.text, { start: 104, min: 54, width: textWidth, maxLines: 4 });

    const beat: PlannedBeat = {
      kind: source.kind,
      lines,
      start: round(at),
      end: round(at + span),
      size: fontSize,
    };
    at += span;
    return beat;
  });

  // Floating point across a dozen divisions leaves the last beat ending at
  // 19.999, which drops a frame of the closing line.
  if (beats.length) beats[beats.length - 1].end = seconds;

  return { size, fps: FPS, seconds, beats, images: params.images ?? [] };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

// ── the filter graph ────────────────────────────────────────────────────────

/**
 * ffmpeg's own escaping, for a value going inside a filter argument.
 *
 * Text never comes through here — it is written to a file and read with
 * `textfile=`, which is the only way to stay sane about apostrophes in a
 * caption. This is for the paths, which carry colons on Windows and are the
 * one thing that cannot be moved out of the graph.
 */
export function escapeArg(value: string): string {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Fade in, hold, fade out — as an ffmpeg expression over `t`. */
function alphaExpr(start: number, end: number): string {
  const IN = 0.28;
  const OUT = 0.22;
  return [
    `if(lt(t,${start}),0,`,
    `if(lt(t,${start + IN}),(t-${start})/${IN},`,
    `if(lt(t,${end - OUT}),1,`,
    `max(0,(${end}-t)/${OUT}))))`,
  ].join('');
}

/** The rise a line makes as it arrives, in pixels, as an expression over `t`. */
function riseExpr(baseY: number, start: number): string {
  const IN = 0.28;
  const LIFT = 34;
  return `${baseY}+${LIFT}*max(0,1-(t-${start})/${IN})`;
}

export interface GraphPaths {
  /** One file per line of text, already written out. */
  textFiles: string[][];
  displayFont: string;
  bodyFont: string;
}

/**
 * The whole video as one filter graph.
 *
 * Pure: give it a plan and the paths and it gives back the string, which is
 * why the timings and the layout can be tested without ffmpeg anywhere near
 * the machine.
 */
export function filterGraph(plan: ReelPlan, paths: GraphPaths): string {
  const { width, height } = plan.size;
  const steps: string[] = [];

  // The backdrop. Attached slides push in slowly behind a scrim so the words
  // stay readable; with none, the brand's near-black carries it.
  if (plan.images.length) {
    const per = plan.seconds / plan.images.length;
    plan.images.forEach((_, i) => {
      // zoompan counts in frames, and a slow push is the difference between a
      // still with words on it and a video.
      const frames = Math.max(1, Math.round(per * plan.fps));
      steps.push(
        `[${i}:v]scale=${width * 1.2}:${height * 1.2}:force_original_aspect_ratio=increase,` +
          `crop=${width * 1.2}:${height * 1.2},` +
          `zoompan=z='min(1.0+0.0012*on,1.14)':d=${frames}:s=${width}x${height}:fps=${plan.fps},` +
          `setsar=1[img${i}]`,
      );
    });
    const chain = plan.images.map((_, i) => `[img${i}]`).join('');
    steps.push(`${chain}concat=n=${plan.images.length}:v=1:a=0[slides]`);
    // The scrim is what makes white text on a daylight photograph legible. It
    // is heavier at the bottom, where the caption row already darkens things.
    steps.push(
      `[slides]format=rgba,` +
        `drawbox=x=0:y=0:w=${width}:h=${height}:color=${INK}@0.52:t=fill,` +
        `drawbox=x=0:y=${Math.round(height * 0.55)}:w=${width}:h=${Math.round(height * 0.45)}:color=${INK}@0.35:t=fill[bg]`,
    );
  } else {
    steps.push(
      `color=c=${INK}:s=${width}x${height}:r=${plan.fps}:d=${plan.seconds},format=rgba[base]`,
    );
    // A lime line that travels down the frame over the whole video: enough
    // movement that the eye does not read the background as a still.
    //
    // Moved with `overlay` rather than drawn with `drawbox`, because drawbox
    // reads `t` as its thickness option and leaves an animated expression
    // frozen at its value for frame one — which renders as a bar that never
    // moves, and looks like nothing is wrong until you check a later frame.
    // `overlay` evaluates x and y every frame, which is the behaviour wanted.
    steps.push(`color=c=${LIME}:s=${width}x4:r=${plan.fps}:d=${plan.seconds}[sweep]`);
    steps.push(
      `[base][sweep]overlay=x=0:y='-4+${height + 8}*t/${plan.seconds}':format=auto[bg]`,
    );
  }

  let last = 'bg';
  let n = 0;

  // A hairline across the top that fills as the reel plays. People watch it
  // without noticing it, and it buys the last two seconds.
  //
  // A full-width bar slid in from off-frame: overlay cannot animate a width,
  // but the visible part of a bar entering from the left *is* a width.
  steps.push(`color=c=${LIME}:s=${width}x7:r=${plan.fps}:d=${plan.seconds}[barsrc]`);
  steps.push(
    `[${last}][barsrc]overlay=x='-${width}+${width}*t/${plan.seconds}':y=0:format=auto[p${n}]`,
  );
  last = `p${n++}`;

  plan.beats.forEach((beat, bi) => {
    const lineHeight = Math.round(beat.size * 1.14);
    const blockHeight = lineHeight * beat.lines.length;
    // Sit the block in the band between the header and the caption row, a
    // little above centre — which is where a thumb is not covering the screen.
    const band = SAFE.bottom - SAFE.top;
    const top = SAFE.top + Math.max(0, Math.round((band - blockHeight) / 2) - 120);
    // One display face throughout, two colours. A lighter body face read as
    // weak next to the hook at this size, and the hierarchy a reel needs is
    // lime against white, not bold against semibold.
    const colour = beat.kind === 'body' ? PAPER : LIME;
    const font = paths.displayFont;

    // The accent rule above the hook and the call to action. It gives the eye
    // somewhere to arrive before the words resolve. Static, because an
    // animated one would need its own overlay pass per beat for a detail
    // nobody would notice.
    if (beat.kind !== 'body') {
      const ruleY = top - 46;
      steps.push(
        `[${last}]drawbox=x=${SAFE.side}:y=${ruleY}:w=180:h=8:color=${LIME}:t=fill:` +
          `enable='between(t,${round(beat.start + 0.3)},${beat.end})'[r${n}]`,
      );
      last = `r${n++}`;
    }

    beat.lines.forEach((_, li) => {
      const y = top + li * lineHeight;
      // Each line arrives a beat after the one above it, which is what makes
      // it read as typed rather than pasted.
      const start = round(beat.start + li * 0.09);
      steps.push(
        `[${last}]drawtext=fontfile='${escapeArg(font)}':` +
          `textfile='${escapeArg(paths.textFiles[bi][li])}':` +
          `fontcolor=${colour}:fontsize=${beat.size}:` +
          `x=${SAFE.side}:y='${riseExpr(y, start)}':` +
          `alpha='${alphaExpr(start, beat.end)}':` +
          `enable='between(t,${beat.start},${beat.end})'[t${n}]`,
      );
      last = `t${n++}`;
    });
  });

  // The wordmark, low and small, inside the safe zone the whole way through.
  steps.push(
    `[${last}]drawtext=fontfile='${escapeArg(paths.bodyFont)}':` +
      `text='VELOCITY RIDES':fontcolor=${PAPER}@0.55:fontsize=34:` +
      `x=${SAFE.side}:y=${SAFE.bottom - 56}[out]`,
  );

  return steps.join(';');
}

// ── rendering ───────────────────────────────────────────────────────────────

/** Where the two OFL fonts live, relative to the compiled output. */
function fontDir(): string {
  // `lib/social/reel.js` at runtime, `src/social/reel.ts` in tests — the
  // assets sit beside both, two levels up.
  return path.resolve(__dirname, '..', '..', 'assets', 'fonts');
}

/**
 * The ffmpeg binary.
 *
 * Required lazily and by name, because this is the only file in the backend
 * that needs it and eagerly importing an 80MB package into every cold start to
 * render one video a day is a bad trade.
 */
function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolved = require('ffmpeg-static') as string | { default?: string } | null;
  const bin = typeof resolved === 'string' ? resolved : resolved?.default;
  if (!bin) throw new Error('ffmpeg is not available in this runtime.');
  return bin;
}

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

/**
 * Render the plan to an MP4 and hand back the bytes.
 *
 * Everything happens in a temp directory that is removed afterwards, including
 * on the way out of a failure: Cloud Functions reuses an instance and a
 * half-written frame left behind is a confusing render next time.
 */
export async function renderReel(
  plan: ReelPlan,
  opts: { ffmpeg?: string; localImages?: string[] } = {},
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-reel-'));
  try {
    // Text goes to files rather than into the graph: a caption with an
    // apostrophe in it is otherwise a quoting problem with three layers.
    const textFiles: string[][] = [];
    for (const [bi, beat] of plan.beats.entries()) {
      const files: string[] = [];
      for (const [li, line] of beat.lines.entries()) {
        const file = path.join(dir, `b${bi}-l${li}.txt`);
        await writeFile(file, line, 'utf8');
        files.push(file);
      }
      textFiles.push(files);
    }

    const images = opts.localImages ?? [];
    const graph = filterGraph({ ...plan, images }, {
      textFiles,
      displayFont: path.join(fontDir(), 'Outfit-Black.ttf'),
      bodyFont: path.join(fontDir(), 'WorkSans-SemiBold.ttf'),
    });

    // The graph is long and full of commas, colons and quotes. A script file
    // is the supported way to hand ffmpeg one without a shell in the middle.
    const graphFile = path.join(dir, 'graph.txt');
    await writeFile(graphFile, graph, 'utf8');

    const out = path.join(dir, 'reel.mp4');

    // Every input first, then the output options. ffmpeg applies an option to
    // whichever file follows it, so a -map before the last -i is read as an
    // input option and the run dies on an argument it half understood.
    const args: string[] = [];
    for (const image of images) args.push('-loop', '1', '-i', image);
    // A silent track: several networks reject a video with no audio stream at
    // all, and a reel is watched muted anyway.
    args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    const silenceIndex = images.length;

    args.push(
      '-filter_complex_script',
      graphFile,
      '-map',
      '[out]',
      '-map',
      `${silenceIndex}:a`,
      '-shortest',
      '-t',
      String(plan.seconds),
      '-r',
      String(plan.fps),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      // Instagram re-encodes everything, so the file this produces is a source
      // rather than a master: yuv420p and +faststart are what make it play
      // everywhere while it is still ours.
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-y',
      out,
    );

    await run(opts.ffmpeg ?? ffmpegPath(), args);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Spawn ffmpeg and fail with its own last words rather than an exit code. */
function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      // ffmpeg is chatty and the useful line is always the last one, so only
      // the tail is kept rather than megabytes of progress.
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', (e) => reject(new RenderError(e.message)));
    child.on('close', (code) => {
      if (code === 0) return resolve();
      const lastLine = stderr.trim().split('\n').slice(-3).join(' ').trim();
      logger.error('social: the render failed', { code, stderr: stderr.slice(-2000) });
      reject(new RenderError(lastLine || `ffmpeg exited with ${code}`));
    });
  });
}
