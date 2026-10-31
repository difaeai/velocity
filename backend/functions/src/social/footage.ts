/**
 * What goes under the words: footage and a music track.
 *
 * A reel that is only type on one colour reads as made by a machine. One clip
 * per beat, cut where the line changes, with a track under it, reads as made
 * by somebody who sat with an editor — which is the whole difference the
 * reels are judged on.
 *
 * - **Footage** is our own clips first — the library the admin fills from
 *   Automation, under `socialClips/` — then Pixabay stock for the beats left
 *   over, searched with the scene the writer already wrote for each frame.
 *   Pixabay needs `PIXABAY_API_KEY` (free). With neither, the reel stays
 *   typography.
 * - **Music** is the library under `socialMusic/`, filled from Automation with
 *   tracks cleared for Instagram (Meta Sound Collection, Pixabay Music), and
 *   the shared public-domain starter tracks under `studioMusic/` while that is
 *   empty. Instagram's own trending sounds cannot be attached through any API,
 *   and a copyrighted song baked into the file gets the reel muted — so the
 *   research desk lists this week's trending sounds in the queue instead, for
 *   whoever posts by hand.
 * - **Voice-over** is the writer's spoken line read by Gemini's free speech
 *   model, mixed over the music. No key, no voice.
 *
 * Everything here fails soft: a missing clip or track is a plainer reel, never
 * a failed one.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from 'firebase-functions';

import { overBudget } from '../ai/config';
import { db, storage } from '../lib/firebase';
import { geminiReady, geminiSpeech } from './gemini';
import { wsPath } from './workspace';

/** Where the admin's libraries live in the bucket. */
export const MUSIC_FOLDER = 'socialMusic/';
export const CLIPS_FOLDER = 'socialClips/';
/** Public-domain (CC0) starter tracks every desk falls back to while its own library is empty. */
export const SHARED_MUSIC_FOLDER = 'studioMusic/';

/** What to search when a scene finds nothing — on-brand, and stock has plenty of it. */
const FALLBACK_SCENE = 'city traffic night';

export interface StockFile {
  url: string;
  width: number;
  height: number;
}

interface PixabayHit {
  id: number;
  user_id: number;
  videos: Record<string, StockFile>;
}

/**
 * The smallest file that still fills a 720-wide frame. Instagram re-encodes
 * everything, so a 4K source is only a slower download.
 */
export function pickFile(files: StockFile[]): StockFile | null {
  const usable = files.filter((f) => f.url);
  const area = (f: StockFile) => f.width * f.height;
  const sharp = usable.filter((f) => Math.min(f.width, f.height) >= 720).sort((a, b) => area(a) - area(b));
  return sharp[0] ?? usable.sort((a, b) => area(b) - area(a))[0] ?? null;
}

/** A writer's scene ("a driver counting cash, close up") cut to what a stock search can match. */
export function searchTerms(scene: string, words = 6): string {
  return scene
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, words)
    .join(' ');
}

/** A stable spread over a library, so each piece starts somewhere else and a re-cut keeps its picks. */
export function trackIndex(postId: string, count: number): number {
  let h = 0;
  for (const c of postId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % count;
}

/** `count` items from a library, starting at this piece's place in it, no repeats. */
export function rotate<T>(items: T[], postId: string, count: number): T[] {
  if (!items.length) return [];
  const start = trackIndex(postId, items.length);
  return Array.from({ length: Math.min(count, items.length) }, (_, i) => items[(start + i) % items.length]);
}

/** Pixabay's videos come in every shape; a tall one crops into a reel without losing the subject. */
export function fitsOrientation(hit: PixabayHit, orientation: 'portrait' | 'landscape'): boolean {
  const file = pickFile(Object.values(hit.videos ?? {}));
  if (!file) return false;
  return orientation === 'portrait' ? file.height > file.width : file.width >= file.height;
}

/** Pixabay's terms: the same search must be answered from our own copy for 24 hours. */
const SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;

// shortcut: expired cache docs are never deleted — a few small ones a day; sweep them if that grows.
export async function searchPixabay(key: string, query: string): Promise<PixabayHit[]> {
  if (!query) return [];
  const doc = db.doc(`socialStockSearches/${createHash('sha1').update(query.toLowerCase()).digest('hex')}`);
  // A cache that cannot be read is a search, never a failure.
  const cached = (await doc.get().catch(() => null))?.data() as { atMs: number; hits: PixabayHit[] } | undefined;
  if (cached && Date.now() - cached.atMs < SEARCH_CACHE_MS) return cached.hits;

  const url = new URL('https://pixabay.com/api/videos/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query.slice(0, 100));
  url.searchParams.set('per_page', '20');
  url.searchParams.set('safesearch', 'true');
  // Real footage only: "animation" is mostly green-screen buttons and motion graphics.
  url.searchParams.set('video_type', 'film');
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pixabay said ${res.status}`);
  // Only what the render reads, so twenty hits stay a small document.
  const hits = (((await res.json()) as { hits?: PixabayHit[] }).hits ?? []).map((h) => ({
    id: h.id,
    user_id: h.user_id,
    videos: h.videos,
  }));
  await doc.set({ query, atMs: Date.now(), hits }).catch(() => {});
  return hits;
}

interface PixabayPhoto {
  id: number;
  user_id: number;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
}

/** Pixabay's photo search, under the same 24-hour rule and key as the footage. */
export async function searchPixabayPhotos(
  key: string,
  query: string,
  orientation: 'vertical' | 'horizontal',
): Promise<PixabayPhoto[]> {
  if (!query) return [];
  // Its own cache key: the same words as a footage search are a different answer.
  const id = createHash('sha1').update(`photo:${orientation}:${query.toLowerCase()}`).digest('hex');
  const doc = db.doc(`socialStockSearches/${id}`);
  const cached = (await doc.get().catch(() => null))?.data() as { atMs: number; photos: PixabayPhoto[] } | undefined;
  if (cached?.photos && Date.now() - cached.atMs < SEARCH_CACHE_MS) return cached.photos;

  const url = new URL('https://pixabay.com/api/');
  url.searchParams.set('key', key);
  url.searchParams.set('q', query.slice(0, 100));
  url.searchParams.set('image_type', 'photo');
  url.searchParams.set('orientation', orientation);
  url.searchParams.set('per_page', '20');
  url.searchParams.set('safesearch', 'true');
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pixabay said ${res.status}`);
  const photos = (((await res.json()) as { hits?: PixabayPhoto[] }).hits ?? [])
    .filter((h) => h.largeImageURL)
    .map((h) => ({ id: h.id, user_id: h.user_id, largeImageURL: h.largeImageURL, imageWidth: h.imageWidth, imageHeight: h.imageHeight }));
  await doc.set({ query, atMs: Date.now(), photos }).catch(() => {});
  return photos;
}

/**
 * One stock photograph for a frame, downloaded to `out`. The search is tried
 * shorter when the full one finds nothing; `skip` keeps a carousel from showing
 * the same photo twice. Null with no key or no match.
 */
export async function stockPhoto(params: {
  query: string;
  orientation: 'vertical' | 'horizontal';
  out: string;
  skip?: Set<number>;
}): Promise<string | null> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key || !params.query.trim()) return null;
  const words = params.query.trim().split(/\s+/);
  for (const query of [words.join(' '), words.slice(0, 2).join(' ')]) {
    const hit = (await searchPixabayPhotos(key, query, params.orientation)).find((p) => !params.skip?.has(p.id));
    if (!hit) continue;
    const res = await fetch(hit.largeImageURL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) continue;
    await writeFile(params.out, Buffer.from(await res.arrayBuffer()));
    params.skip?.add(hit.id);
    return params.out;
  }
  return null;
}

/**
 * Download one stock clip per scene into `dir`, never the same video twice.
 *
 * A scene that finds nothing is tried shorter, then as the fallback, so the
 * clips stay in step with the beats; one that still fails is skipped and the
 * renderer reuses another clip in its place.
 */
async function stockClips(scenes: string[], orientation: 'portrait' | 'landscape', dir: string): Promise<string[]> {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key || !scenes.length) return [];

  const used = new Set<number>();
  const usedBy = new Set<number>();
  // Two clips from one contributor are usually one shoot, which reads as a repeat;
  // then a clip the wrong shape for the frame. Stable, so Pixabay's order breaks ties.
  const rank = (h: PixabayHit) => (usedBy.has(h.user_id) ? 2 : 0) + (fitsOrientation(h, orientation) ? 0 : 1);
  const paths: string[] = [];
  for (const [i, scene] of scenes.entries()) {
    try {
      let hit: PixabayHit | undefined;
      for (const query of [searchTerms(scene), searchTerms(scene, 3), FALLBACK_SCENE]) {
        const fresh = (await searchPixabay(key, query)).filter((h) => !used.has(h.id) && pickFile(Object.values(h.videos ?? {})));
        hit = fresh.sort((a, b) => rank(a) - rank(b))[0];
        if (hit) break;
      }
      const file = hit && pickFile(Object.values(hit.videos));
      if (!hit || !file) continue;

      const res = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const out = path.join(dir, `stock-${i}.mp4`);
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      used.add(hit.id);
      usedBy.add(hit.user_id);
      paths.push(out);
    } catch (e) {
      logger.warn('social: a stock clip did not arrive', { scene, error: (e as Error).message });
    }
  }
  return paths;
}

/** Everything in one library folder, in a stable order. */
async function library(folder: string) {
  const [files] = await storage.bucket().getFiles({ prefix: folder });
  return files.filter((f) => !f.name.endsWith('/')).sort((a, b) => a.name.localeCompare(b.name));
}

/** Up to `count` of our own clips for this piece, downloaded into `dir`. */
async function ownClips(postId: string, count: number, dir: string): Promise<string[]> {
  const picked = rotate(await library(wsPath(CLIPS_FOLDER)), postId, count);
  const paths: string[] = [];
  for (const [i, clip] of picked.entries()) {
    const out = path.join(dir, `own-${i}${path.extname(clip.name)}`);
    await clip.download({ destination: out });
    paths.push(out);
  }
  return paths;
}

/** The library track for this piece, downloaded into `dir`; the shared starter tracks when ours is empty. */
async function libraryTrack(postId: string, dir: string): Promise<{ path: string; name: string } | null> {
  const own = await library(wsPath(MUSIC_FOLDER));
  const [track] = rotate(own.length ? own : await library(SHARED_MUSIC_FOLDER), postId, 1);
  if (!track) return null;
  const out = path.join(dir, `music${path.extname(track.name)}`);
  await track.download({ destination: out });
  return { path: out, name: path.basename(track.name) };
}

/** How a voice-over is read: like somebody talking to camera, not an announcement. */
export const VOICE_STYLE =
  'Warm, upbeat and conversational, like a creator talking to the camera. Natural pace. ' +
  'Where the words are Roman Urdu, say them the way a Pakistani speaker would.';

/** Seconds of audio in a 24 kHz mono 16-bit WAV, which is what the speech model returns. */
export const wavSeconds = (bytes: number) => Math.max(0, bytes - 44) / 48_000;

/** The writer's spoken line, read aloud into `dir`, or null with no key, no line, or no AI budget left this month. */
async function voiceOver(text: string, dir: string): Promise<{ path: string; seconds: number } | null> {
  if (!text.trim() || !geminiReady() || overBudget()) return null;
  const wav = await geminiSpeech(text.trim(), VOICE_STYLE);
  const out = path.join(dir, 'voice.wav');
  await writeFile(out, wav);
  return { path: out, seconds: wavSeconds(wav.length) };
}

/**
 * Fetch the footage and the track for one reel.
 *
 * `footage: false` skips the clips — slides attached by hand are the backdrop
 * then. The note is for the work log: what is under the words, and why not
 * more.
 */
export async function underlay(params: {
  postId: string;
  scenes: string[];
  orientation: 'portrait' | 'landscape';
  footage: boolean;
  /** The script's spoken line; empty means no voice-over. */
  voiceover?: string;
}): Promise<{
  clips: string[];
  music: string | null;
  voice: { path: string; seconds: number } | null;
  note: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-underlay-'));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  const soft = <T>(what: string, fallback: T) => (e: unknown) => {
    logger.warn(`social: could not fetch ${what}`, { error: (e as Error).message });
    return fallback;
  };

  // Ours take the first beats — the hook most of all — and stock fills the rest.
  const own = params.footage ? await ownClips(params.postId, params.scenes.length, dir).catch(soft('our clips', [])) : [];
  const stock = params.footage ? await stockClips(params.scenes.slice(own.length), params.orientation, dir) : [];
  const track = await libraryTrack(params.postId, dir).catch(soft('a music track', null));
  const voice = await voiceOver(params.voiceover ?? '', dir).catch(soft('the voice-over', null));

  const notes = [
    own.length ? `${own.length} of our clips` : null,
    stock.length ? `${stock.length} from Pixabay` : null,
    params.footage && !own.length && !stock.length
      ? `no footage (${process.env.PIXABAY_API_KEY?.trim() ? 'none found' : 'no clips in the library, no Pixabay key'})`
      : null,
    track ? `music: ${track.name}` : 'no music (no track in either library)',
    voice ? `voice-over ${voice.seconds.toFixed(1)}s` : params.voiceover?.trim() ? 'no voice-over' : null,
  ];
  return {
    clips: [...own, ...stock],
    music: track?.path ?? null,
    voice,
    note: notes.filter(Boolean).join(', '),
    cleanup,
  };
}
