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
 *   tracks cleared for Instagram (Meta Sound Collection, Pixabay Music).
 *   Instagram's own trending sounds cannot be attached through any API, and a
 *   copyrighted song baked into the file gets the reel muted — so the research
 *   desk lists this week's trending sounds in the queue instead, for whoever
 *   posts by hand. Empty library, silent reel.
 *
 * Everything here fails soft: a missing clip or track is a plainer reel, never
 * a failed one.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from 'firebase-functions';

import { db, storage } from '../lib/firebase';

/** Where the admin's libraries live in the bucket. */
export const MUSIC_FOLDER = 'socialMusic/';
export const CLIPS_FOLDER = 'socialClips/';

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
      logger.warn('social: a stock clip did not arrive', { scene, message: (e as Error).message });
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
  const picked = rotate(await library(CLIPS_FOLDER), postId, count);
  const paths: string[] = [];
  for (const [i, clip] of picked.entries()) {
    const out = path.join(dir, `own-${i}${path.extname(clip.name)}`);
    await clip.download({ destination: out });
    paths.push(out);
  }
  return paths;
}

/** The library track for this piece, downloaded into `dir`, or null when the library is empty. */
async function libraryTrack(postId: string, dir: string): Promise<{ path: string; name: string } | null> {
  const [track] = rotate(await library(MUSIC_FOLDER), postId, 1);
  if (!track) return null;
  const out = path.join(dir, `music${path.extname(track.name)}`);
  await track.download({ destination: out });
  return { path: out, name: path.basename(track.name) };
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
}): Promise<{ clips: string[]; music: string | null; note: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-underlay-'));
  const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  const soft = <T>(what: string, fallback: T) => (e: unknown) => {
    logger.warn(`social: could not fetch ${what}`, { message: (e as Error).message });
    return fallback;
  };

  // Ours take the first beats — the hook most of all — and stock fills the rest.
  const own = params.footage ? await ownClips(params.postId, params.scenes.length, dir).catch(soft('our clips', [])) : [];
  const stock = params.footage ? await stockClips(params.scenes.slice(own.length), params.orientation, dir) : [];
  const track = await libraryTrack(params.postId, dir).catch(soft('a music track', null));

  const notes = [
    own.length ? `${own.length} of our clips` : null,
    stock.length ? `${stock.length} from Pixabay` : null,
    params.footage && !own.length && !stock.length
      ? `no footage (${process.env.PIXABAY_API_KEY?.trim() ? 'none found' : 'no clips in the library, no Pixabay key'})`
      : null,
    track ? `music: ${track.name}` : 'no music (the library on Automation is empty)',
  ];
  return { clips: [...own, ...stock], music: track?.path ?? null, note: notes.filter(Boolean).join(', '), cleanup };
}
