/**
 * The editing stage — whoever holds the video-editor job runs it.
 *
 * Two jobs, in order. First the cut: a model call in the editor's own voice
 * that turns the writer's shots and the designer's frame into a second-by-second
 * edit — what moves, where the interrupt lands, what the audio is doing. Then
 * the render: Veo, through the Gemini API, one long-running operation, an MP4 at
 * the end.
 *
 * The cut is a separate call rather than a template because a video prompt is
 * where a piece is won or lost. "Driver counts cash" renders as a man holding
 * money; "hold on his hands for 1.5s, cut wide as the note count lands, lime
 * text stamps in on the beat" renders as something someone watches twice.
 *
 * `videoProvider: none` writes the cut and stops — you attach a file made
 * anywhere else, and it goes out through exactly the same publish path.
 *
 * ⚠️ Like the payments adapter, the Veo calls here were written from Google's
 * published API shape. Render one video from the console and watch the logs
 * before switching the daily run on — that first render is the real test of the
 * endpoint, the model name and the response shape.
 */
import { logger } from 'firebase-functions';

import { feedbackBlock, planBlock, systemFor } from './crew';
import { downloadAsset, postFolder, storeFile } from './assets';
import { GEMINI_BASE, geminiKey, generateJson } from './gemini';
import {
  FORMAT_SPECS,
  type ContentFormat,
  type ContentPlan,
  type Employee,
  type MediaAsset,
  type PostScript,
  type SearchPack,
  type SocialSettings,
} from './types';

/** How long to let a render run before giving up on it. */
const RENDER_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

export class VideoError extends Error {}

export function videoConfigured(provider: SocialSettings['videoProvider']): boolean {
  if (provider === 'none') return true;
  return typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.trim() !== '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── the cut ─────────────────────────────────────────────────────────────────

export interface Cut {
  /** The prompt handed to the renderer. */
  prompt: string;
  /** One line for the console, so an operator can see what was cut. */
  note: string;
}

/**
 * The editor writes the edit. Falls back to assembling the script directly if
 * the model call fails — a plainer video is a better outcome than no video.
 */
export async function planCut(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  plan: ContentPlan | null;
  /** The YouTube title, when the search desk has already written one. */
  search: SearchPack | null;
  feedback: string[];
}): Promise<Cut> {
  const spec = FORMAT_SPECS[params.format];

  try {
    const { data } = await generateJson<{ prompt?: unknown; note?: unknown }>({
      model: params.settings.textModel,
      system: `${systemFor(params.employee, params.settings)}

You are writing a single prompt for a text-to-video model that renders picture and sound in one pass. It has no memory and no second take, so the prompt carries everything: the shot order with rough timings, camera movement, lighting, wardrobe, the spoken voiceover verbatim, the on-screen text verbatim, and what the audio bed is doing.

Write it as directions, not as prose. Never ask for more than the seconds allow.

Reply with one JSON object and nothing else:
{ "prompt": "the full video prompt", "note": "one line describing the cut, for the console" }`,
      what: 'The cut',
      temperature: 0.9,
      maxOutputTokens: 2000,
      prompt: [
        `FORMAT: ${spec.label}, ${spec.aspect}, ${spec.seconds} seconds.`,
        planBlock(params.plan, params.employee),
        '',
        `HOOK (this is second zero): ${params.script.hook}`,
        'SHOTS:',
        ...params.script.frames.map(
          (f, i) => `${i + 1}. ${f.scene}${f.overlay ? ` — on screen: "${f.overlay}"` : ''}`,
        ),
        '',
        params.script.voiceover ? `VOICEOVER, spoken exactly:\n"${params.script.voiceover}"` : '',
        params.script.cta ? `ENDS ON: ${params.script.cta}` : '',
        params.search?.youtube?.title
          ? `This is going out on YouTube as: "${params.search.youtube.title}" — the opening has to deliver that promise.`
          : '',
        feedbackBlock(params.feedback),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const prompt = typeof data.prompt === 'string' ? data.prompt.trim().slice(0, 4000) : '';
    if (prompt) {
      return {
        prompt,
        note: (typeof data.note === 'string' ? data.note.trim().slice(0, 200) : '') || 'Cut written.',
      };
    }
  } catch (e) {
    logger.warn('social: the editor could not write a cut; falling back to the script', {
      message: (e as Error).message,
    });
  }

  return { prompt: assembleCut(params.script, spec.aspect), note: 'Cut assembled straight from the script.' };
}

/**
 * The fallback prompt, built without a model call. Kept because a render that
 * happens is worth more than one that waited for a second opinion.
 */
export function assembleCut(script: PostScript, aspect: string): string {
  return [
    `A ${aspect} short-form advert for Velocity, a ride-hailing app in Pakistan.`,
    'Look: modern Pakistani city streets — Lahore, Karachi, Islamabad — real cars, real drivers, natural daylight.',
    'Brand palette: near-black (#1a1c1c) and bright lime (#ccff00). Clean, confident, no stock-footage cheesiness.',
    '',
    'Shots:',
    ...script.frames.map((f, i) => `${i + 1}. ${f.scene}`),
    '',
    script.voiceover ? `Spoken voiceover: "${script.voiceover}"` : '',
    script.frames.some((f) => f.overlay)
      ? `On-screen text overlays: ${script.frames.map((f) => f.overlay).filter(Boolean).join(' / ')}`
      : '',
    script.cta ? `Ends on: ${script.cta}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── the render ──────────────────────────────────────────────────────────────

/** Pull the first thing in an arbitrarily-shaped response that looks like a video. */
function findVideoUri(node: unknown, depth = 0): string | null {
  if (depth > 8 || node === null || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === 'string' && /^https?:\/\//.test(value) && /video|\.mp4|files\//i.test(key + value)) {
      return value;
    }
    const nested = findVideoUri(value, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/**
 * Render with Veo and return the raw MP4. The operation is long-running: kick
 * it off, then poll until Google reports it done.
 *
 * `firstFrame` is the designer's cover image, when there is one. Image-to-video
 * is the one part of this call whose shape is most likely to drift, so a
 * failure with an image retries once without it — a video that opens on a
 * different frame beats no video at all.
 */
async function renderWithVeo(params: {
  prompt: string;
  model: string;
  aspect: string;
  firstFrame: { bytes: Buffer; mimeType: string } | null;
}): Promise<{ jobId: string; bytes: Buffer }> {
  const key = geminiKey();

  const start = async (withFrame: boolean) => {
    const instance: Record<string, unknown> = { prompt: params.prompt };
    if (withFrame && params.firstFrame) {
      instance.image = {
        bytesBase64Encoded: params.firstFrame.bytes.toString('base64'),
        mimeType: params.firstFrame.mimeType,
      };
    }
    return fetch(`${GEMINI_BASE}/models/${encodeURIComponent(params.model)}:predictLongRunning?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio: params.aspect, personGeneration: 'allow_adult' },
      }),
    });
  };

  let startRes = await start(params.firstFrame !== null);
  if (!startRes.ok && params.firstFrame) {
    logger.warn('social: Veo refused the conditioned render, retrying from the prompt alone', {
      detail: (await startRes.text()).slice(0, 300),
    });
    startRes = await start(false);
  }
  if (!startRes.ok) {
    throw new VideoError(`Veo refused the render: ${(await startRes.text()).slice(0, 400)}`);
  }

  const started = (await startRes.json()) as { name?: string };
  if (!started.name) throw new VideoError('Veo did not return an operation to poll.');

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let done: Record<string, unknown> | null = null;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`${GEMINI_BASE}/${started.name}?key=${key}`);
    if (!pollRes.ok) throw new VideoError(`Veo poll failed: ${(await pollRes.text()).slice(0, 300)}`);
    const op = (await pollRes.json()) as { done?: boolean; error?: { message?: string }; response?: unknown };
    if (op.error) throw new VideoError(`Veo render failed: ${op.error.message ?? 'unknown error'}`);
    if (op.done) {
      done = op as Record<string, unknown>;
      break;
    }
    if (Date.now() > deadline) throw new VideoError('Veo is still rendering after 8 minutes.');
  }

  const uri = findVideoUri(done.response ?? done);
  if (!uri) {
    logger.error('social: Veo finished but no video URI was found', { operation: started.name });
    throw new VideoError('Veo finished but returned no video file.');
  }

  // Files served by the Gemini API need the key on the download too.
  const fileRes = await fetch(uri.includes('key=') ? uri : `${uri}${uri.includes('?') ? '&' : '?'}key=${key}`);
  if (!fileRes.ok) throw new VideoError(`Could not download the rendered video (HTTP ${fileRes.status}).`);
  return { jobId: started.name, bytes: Buffer.from(await fileRes.arrayBuffer()) };
}

/** Put a finished MP4 in the bucket under the post it belongs to. */
export async function storeVideo(
  postId: string,
  bytes: Buffer,
): Promise<{ path: string; url: string; expiresAtMs: number }> {
  return storeFile({ path: `${postFolder(postId)}/video.mp4`, bytes, contentType: 'video/mp4' });
}

/** Render one video for one piece, or return null when no provider is configured. */
export async function renderVideo(params: {
  postId: string;
  cut: Cut;
  settings: SocialSettings;
  format: ContentFormat;
  /** The designer's cover frame, used as the opening frame where Veo accepts it. */
  cover: MediaAsset | null;
}): Promise<MediaAsset | null> {
  const { videoProvider: provider, videoModel: model } = params.settings;
  if (provider === 'none') return null;

  if (!videoConfigured(provider)) {
    throw new VideoError(
      'No GEMINI_API_KEY is configured, so videos cannot be rendered. Add it as a GitHub Actions ' +
        'secret, or set the video provider to "none" and attach files yourself.',
    );
  }

  let firstFrame: { bytes: Buffer; mimeType: string } | null = null;
  if (params.cover?.storagePath) {
    try {
      firstFrame = {
        bytes: await downloadAsset(params.cover),
        mimeType: params.cover.storagePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
      };
    } catch (e) {
      logger.warn('social: could not read the cover frame; rendering from the prompt alone', { e });
    }
  }

  const spec = FORMAT_SPECS[params.format];
  const { jobId, bytes } = await renderWithVeo({
    prompt: params.cut.prompt,
    model,
    aspect: spec.aspect,
    firstFrame,
  });
  const stored = await storeVideo(params.postId, bytes);

  return {
    kind: 'video',
    provider,
    model,
    jobId,
    storagePath: stored.path,
    url: stored.url,
    urlExpiresAtMs: stored.expiresAtMs,
    durationSec: spec.seconds,
    aspect: spec.aspect,
    slide: 1,
    alt: '',
  };
}
