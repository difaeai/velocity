/**
 * "Make one like this" — the team watches a video the person hands them.
 *
 * Gemini is the only engine here that can watch, so this calls it directly
 * rather than through the router, and refuses plainly without its key. One
 * grounded call does both jobs the person asked for: take the video apart, and
 * search how that kind of video is landing in our market right now.
 *
 * Three things worth knowing:
 *
 * 1. **The structure is copied, never the content.** The footage, faces, logo,
 *    music and words belong to whoever made it, and reposting them is how an
 *    account collects a strike. The prompt says so, and `dontCopy` is shown to
 *    the person next to the piece.
 * 2. **An uploaded file is shrunk before it is sent.** Gemini samples about a
 *    frame a second at low resolution whatever it is given, so a 640px copy
 *    loses nothing it would have used, and a file that small goes inline in the
 *    one request instead of sitting in Google's file store for two days.
 * 3. **Free tier: Google may use what is sent.** A reference is somebody's
 *    public video or our own footage — never rider or driver data.
 *
 * What comes back rides to the team on the same rail as the person's own brief
 * (see `referenceBrief`), so the writer, the designer and the editor all read it
 * without any stage having to know references exist.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { overBudget } from '../ai/config';
import { brandBlock, marketName } from './crew';
import { extractJson } from './engine';
import { GeminiError, geminiReady, geminiText } from './gemini';
import { ffmpegPath, runFfmpeg } from './reel';
import type { ReferenceRead, SocialSettings } from './types';
import { isHouse } from './workspace';

/** Three minutes is past any reel; the rest of a long video costs tokens and teaches nothing. */
const MAX_SECONDS = 180;

export class ReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceError';
  }
}

const TASK = (): string => `You have a video and Google Search. Watch the whole video first — what is shown, what is said, the words on screen — and then search.

The person wants a piece of ours made like this one. Find what makes it work so the team can do the same for our audience: the hook, the structure, the pacing, the look and the sound. Copy the structure, never the content: the original's footage, faces, logo, music and exact words belong to whoever made it.

Then search: is this kind of video or topic travelling in ${marketName()} right now, who is making it, and how it lands with ${
  isHouse() ? 'people who commute, share rides or travel between cities' : 'the people this business sells to'
}. Report what you found; if the search finds little, say so rather than filling the field.

Reply with one JSON object and nothing else:
{
  "summary": "one sentence: what the video is",
  "hook": "exactly what happens in the first 3 seconds, and why it stops the scroll",
  "beats": [{"at": "0-3s", "what": "what happens", "onScreen": "the text on screen, or empty"}],
  "seconds": the total length in seconds, as a number,
  "pacing": "how fast it cuts and how the rhythm changes",
  "look": "camera, framing, colours, how the text is styled",
  "sound": "voiceover, music mood, sound effects, or silence",
  "whyItWorks": ["3-5 specific reasons people watch to the end, send it or save it"],
  "market": "what the search found about this kind of video in our market right now",
  "ourVersion": "how we should make it for our audience — the angle, the hook, what we show — specific enough to film",
  "dontCopy": ["what belongs to the original and must not be reused"]
}`;

/** `youtu.be/ID`, `watch?v=ID`, `/shorts/ID` → the plain watch link, or null for anything else. */
export function youtubeLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1)
      : host === 'youtube.com'
        ? (url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1] ?? '')
        : '';
  return /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** The longer side 640px, 15 fps, about half a megabit: three minutes is ~11 MB. */
export async function shrinkVideo(bytes: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-ref-'));
  try {
    const input = path.join(dir, 'in');
    const out = path.join(dir, 'out.mp4');
    await writeFile(input, bytes);
    await runFfmpeg(ffmpegPath(), [
      '-i',
      input,
      '-t',
      String(MAX_SECONDS),
      '-vf',
      'scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=15',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-b:v',
      '450k',
      '-maxrate',
      '550k',
      '-bufsize',
      '1100k',
      '-pix_fmt',
      'yuv420p',
      // What is said is half of why a video works, so the sound stays.
      '-c:a',
      'aac',
      '-ac',
      '1',
      '-b:a',
      '48k',
      '-movflags',
      '+faststart',
      '-y',
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const text = (v: unknown, len: number): string => (typeof v === 'string' ? v.trim().slice(0, len) : '');
const texts = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v) ? v.map((x) => text(x, len)).filter(Boolean).slice(0, max) : [];

/** Watch one video — a public YouTube link or an uploaded file — and read our market around it. */
export async function watchReference(params: {
  settings: SocialSettings;
  date: string;
  youtube?: string;
  file?: { bytes: Buffer; name: string };
}): Promise<ReferenceRead> {
  if (!geminiReady()) {
    throw new ReferenceError('Watching a video needs Gemini, and GEMINI_KEY_RESEARCH is not set.');
  }
  // It calls Gemini directly rather than through the engine, so it checks the month itself.
  if (overBudget()) {
    throw new ReferenceError('This month’s AI work is used up, so the team cannot watch a video now. Buy credits on the Billing page, or it starts again on the 1st.');
  }
  if (!params.youtube && !params.file) throw new ReferenceError('There is no video to watch.');

  const video = params.youtube
    ? { uri: params.youtube }
    : { data: (await shrinkVideo(params.file!.bytes)).toString('base64'), mimeType: 'video/mp4' };

  const ask = (grounded: boolean) =>
    geminiText({
      model: params.settings.textModel,
      system: [brandBlock(), TASK()].join('\n\n'),
      prompt: grounded
        ? `Date: ${params.date}. Market: ${marketName()}. Watch the video, search, then answer.`
        : `Date: ${params.date}. Market: ${marketName()}. Search is not available this time: watch the video and answer, and set "market" to "Could not search the market alongside the video." rather than guessing.`,
      grounded,
      video,
    });

  // A video and a search tool in one request is the one combination here that
  // has not been seen working against the live API. If Google refuses it, the
  // video is still worth reading, so it is read once more without the search.
  let result;
  try {
    result = await ask(true);
  } catch (e) {
    if (!(e instanceof GeminiError) || !/^400:/.test(e.message)) throw e;
    result = await ask(false);
  }
  const data = extractJson<Record<string, unknown>>(result.text);
  if (!data) throw new ReferenceError('The team watched it, but their notes came back unreadable. Try again.');

  return {
    atMs: Date.now(),
    source: params.youtube ?? params.file!.name,
    summary: text(data.summary, 300),
    hook: text(data.hook, 400),
    beats: (Array.isArray(data.beats) ? data.beats : [])
      .slice(0, 12)
      .map((b: Record<string, unknown>) => ({ at: text(b?.at, 20), what: text(b?.what, 240), onScreen: text(b?.onScreen, 160) }))
      .filter((b) => b.what),
    seconds: typeof data.seconds === 'number' && data.seconds > 0 ? Math.round(data.seconds) : null,
    pacing: text(data.pacing, 300),
    look: text(data.look, 300),
    sound: text(data.sound, 300),
    whyItWorks: texts(data.whyItWorks, 6, 240),
    market: text(data.market, 800),
    ourVersion: text(data.ourVersion, 800),
    dontCopy: texts(data.dontCopy, 6, 160),
    sources: result.sources.slice(0, 12).map((s) => ({ title: s.title.slice(0, 200), url: s.url.slice(0, 500) })),
  };
}

/**
 * The read as an order. It goes to the team as one of the piece's revisions —
 * the rail the person's own brief already uses — so every stage that touches
 * the piece is handed it, and keeps being handed it on every later version.
 */
export function referenceBrief(read: ReferenceRead): string {
  return [
    'Make this piece like the reference video I gave you. Copy its structure, never its footage, faces, music or words.',
    `What it is: ${read.summary}`,
    `Its hook: ${read.hook}`,
    read.beats.length
      ? `Its beats: ${read.beats.map((b) => `${b.at} ${b.what}${b.onScreen ? ` [on screen: ${b.onScreen}]` : ''}`).join(' | ')}`
      : '',
    read.pacing ? `Pacing: ${read.pacing}` : '',
    read.look ? `Look: ${read.look}` : '',
    read.sound ? `Sound: ${read.sound}` : '',
    read.whyItWorks.length ? `Why it works: ${read.whyItWorks.join('; ')}` : '',
    read.market ? `In our market: ${read.market}` : '',
    read.ourVersion ? `Our version: ${read.ourVersion}` : '',
    read.dontCopy.length ? `Never reuse: ${read.dontCopy.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}
