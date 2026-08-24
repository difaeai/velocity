/**
 * The editor. Turns a script into an actual video file.
 *
 * Two providers exist on purpose:
 *
 *   `veo`  — Google's Veo, through the Gemini API. One key, one long-running
 *            operation, an MP4 at the end. Chosen as the default vendor
 *            because it renders dialogue and ambient sound in the same pass,
 *            which is what a 20-second advert needs.
 *   `none` — no rendering at all. The pipeline still writes the script and
 *            stops at "ready for a video", so you can attach a file made
 *            anywhere else. This is the default until you have picked a vendor
 *            and are willing to spend on renders.
 *
 * ⚠️ Like the payments adapter, the Veo calls here were written from Google's
 * published API shape. Render one video from the admin console ("Generate now")
 * and watch the logs before you switch the daily job on — that first render is
 * the real test of the endpoint, the model name and the response shape.
 *
 * Whatever renders it, the file ends up in our own bucket: Instagram, Facebook,
 * Threads and TikTok all *pull* the video from a URL rather than accepting an
 * upload, so it has to be somewhere they can reach.
 */
import { logger } from 'firebase-functions';

import { storage } from '../lib/firebase';
import type { SocialSettings, VideoAsset } from './types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** How long to let a render run before giving up on it. */
const RENDER_TIMEOUT_MS = 8 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

/** Signed URLs outlive the publish attempt by a wide margin, for retries. */
const URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class VideoError extends Error {}

export function videoConfigured(provider: SocialSettings['videoProvider']): boolean {
  if (provider === 'none') return true;
  return typeof process.env.GEMINI_API_KEY === 'string' && process.env.GEMINI_API_KEY.trim() !== '';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * Render with Veo and return the raw MP4. The operation is long-running:
 * kick it off, then poll until Google reports it done.
 */
async function renderWithVeo(params: {
  prompt: string;
  model: string;
  aspect: string;
}): Promise<{ jobId: string; bytes: Buffer }> {
  const key = process.env.GEMINI_API_KEY!;

  const startRes = await fetch(
    `${GEMINI_BASE}/models/${encodeURIComponent(params.model)}:predictLongRunning?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: params.prompt }],
        parameters: { aspectRatio: params.aspect, personGeneration: 'allow_adult' },
      }),
    },
  );
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

/**
 * Put the file where the networks can fetch it.
 *
 * Signed URLs are preferred — the link expires and nothing is left permanently
 * open. On a bucket with uniform access and no token-creator role the signing
 * call fails, in which case the object is made public instead: this is a
 * marketing video about to be posted publicly anyway, so the fallback costs
 * nothing but is worth knowing about.
 */
export async function storeVideo(postId: string, bytes: Buffer): Promise<{ path: string; url: string; expiresAtMs: number }> {
  const path = `social/${postId}.mp4`;
  const file = storage.bucket().file(path);
  await file.save(bytes, { contentType: 'video/mp4', resumable: false });

  const expiresAtMs = Date.now() + URL_TTL_MS;
  try {
    const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAtMs });
    return { path, url, expiresAtMs };
  } catch (e) {
    logger.warn('social: could not sign the video URL, falling back to a public object', { e });
    await file.makePublic();
    return {
      path,
      url: `https://storage.googleapis.com/${storage.bucket().name}/${path}`,
      expiresAtMs: 0,
    };
  }
}

/** Re-sign a video whose URL has aged out, so a retry days later still works. */
export async function refreshVideoUrl(asset: VideoAsset): Promise<VideoAsset> {
  if (!asset.storagePath) return asset;
  if (asset.urlExpiresAtMs === 0) return asset; // public object, never expires
  if (asset.urlExpiresAtMs && asset.urlExpiresAtMs > Date.now() + 60_000) return asset;

  const file = storage.bucket().file(asset.storagePath);
  const expiresAtMs = Date.now() + URL_TTL_MS;
  const [url] = await file.getSignedUrl({ action: 'read', expires: expiresAtMs });
  return { ...asset, url, urlExpiresAtMs: expiresAtMs };
}

/** Render one video for one post, or return null when no provider is configured. */
export async function renderVideo(params: {
  postId: string;
  prompt: string;
  settings: SocialSettings;
}): Promise<VideoAsset | null> {
  const { videoProvider: provider, videoModel: model, aspect } = params.settings;
  if (provider === 'none') return null;

  if (!videoConfigured(provider)) {
    throw new VideoError(
      'No GEMINI_API_KEY is configured, so videos cannot be rendered. Add it as a GitHub Actions ' +
        'secret, or set the video provider to "none" and attach files yourself.',
    );
  }

  const { jobId, bytes } = await renderWithVeo({ prompt: params.prompt, model, aspect });
  const stored = await storeVideo(params.postId, bytes);

  return {
    provider,
    model,
    jobId,
    storagePath: stored.path,
    url: stored.url,
    urlExpiresAtMs: stored.expiresAtMs,
    durationSec: null,
    aspect,
  };
}
