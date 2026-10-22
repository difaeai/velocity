/**
 * What goes under the words: stock footage and a music track.
 *
 * A reel that is only type on one colour reads as made by a machine. One clip
 * per beat, cut where the line changes, with a track under it, reads as made
 * by somebody who sat with an editor — which is the whole difference the
 * reels are judged on.
 *
 * - **Footage** is Pexels: free for commercial use, no attribution required,
 *   searched with the scene the writer already wrote for each frame. It needs
 *   `PEXELS_API_KEY` (free); without one the reel stays typography.
 * - **Music** is the library the admin fills from Automation, under
 *   `socialMusic/` in the bucket. Instagram's own trending sounds cannot be
 *   attached through any API, and a copyrighted song baked into the file gets
 *   the reel muted, so the library holds royalty-free tracks somebody chose.
 *   Empty library, silent reel.
 *
 * Everything here fails soft: a missing clip or track is a plainer reel, never
 * a failed one.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { logger } from 'firebase-functions';

import { storage } from '../lib/firebase';

/** Where the admin's music library lives in the bucket. */
export const MUSIC_FOLDER = 'socialMusic/';

/** What to search when a scene finds nothing — on-brand, and Pexels has plenty of it. */
const FALLBACK_SCENE = 'city traffic night';

export interface PexelsFile {
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  video_files: PexelsFile[];
}

/**
 * The smallest file that still fills a 720-wide frame. Instagram re-encodes
 * everything, so a 4K source is only a slower download.
 */
export function pickFile(files: PexelsFile[]): PexelsFile | null {
  const mp4 = files.filter((f) => f.file_type === 'video/mp4' && f.link);
  const area = (f: PexelsFile) => f.width * f.height;
  const sharp = mp4.filter((f) => Math.min(f.width, f.height) >= 720).sort((a, b) => area(a) - area(b));
  return sharp[0] ?? mp4.sort((a, b) => area(b) - area(a))[0] ?? null;
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

/** The same track for the same piece, so a re-cut after a change request keeps its sound. */
export function trackIndex(postId: string, count: number): number {
  let h = 0;
  for (const c of postId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % count;
}

async function search(key: string, query: string, orientation: 'portrait' | 'landscape'): Promise<PexelsVideo[]> {
  if (!query) return [];
  const url = new URL('https://api.pexels.com/videos/search');
  url.searchParams.set('query', query);
  url.searchParams.set('orientation', orientation);
  url.searchParams.set('per_page', '10');
  const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Pexels said ${res.status}`);
  return ((await res.json()) as { videos?: PexelsVideo[] }).videos ?? [];
}

/**
 * Download one clip per scene into `dir`, never the same video twice.
 *
 * A scene that finds nothing is tried shorter, then as the fallback, so the
 * clips stay in step with the beats; one that still fails is skipped and the
 * renderer reuses another clip in its place.
 */
async function stockClips(scenes: string[], orientation: 'portrait' | 'landscape', dir: string): Promise<string[]> {
  const key = process.env.PEXELS_API_KEY?.trim();
  if (!key) return [];

  const used = new Set<number>();
  const paths: string[] = [];
  for (const [i, scene] of scenes.entries()) {
    try {
      let video: PexelsVideo | undefined;
      for (const query of [searchTerms(scene), searchTerms(scene, 3), FALLBACK_SCENE]) {
        video = (await search(key, query, orientation)).find((v) => !used.has(v.id) && pickFile(v.video_files));
        if (video) break;
      }
      const file = video && pickFile(video.video_files);
      if (!video || !file) continue;

      const res = await fetch(file.link, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const out = path.join(dir, `clip-${i}.mp4`);
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      used.add(video.id);
      paths.push(out);
    } catch (e) {
      logger.warn('social: a stock clip did not arrive', { scene, message: (e as Error).message });
    }
  }
  return paths;
}

/** The library track for this piece, downloaded into `dir`, or null when the library is empty. */
async function libraryTrack(postId: string, dir: string): Promise<{ path: string; name: string } | null> {
  const [files] = await storage.bucket().getFiles({ prefix: MUSIC_FOLDER });
  const tracks = files.filter((f) => !f.name.endsWith('/')).sort((a, b) => a.name.localeCompare(b.name));
  if (!tracks.length) return null;
  const track = tracks[trackIndex(postId, tracks.length)];
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

  const clips = params.footage ? await stockClips(params.scenes, params.orientation, dir) : [];
  const track = await libraryTrack(params.postId, dir).catch((e) => {
    logger.warn('social: could not fetch a music track', { message: (e as Error).message });
    return null;
  });

  const notes = [
    clips.length
      ? `${clips.length} clip${clips.length === 1 ? '' : 's'} from Pexels`
      : params.footage && !process.env.PEXELS_API_KEY?.trim()
        ? 'no footage (no Pexels key)'
        : null,
    track ? `music: ${track.name}` : 'no music (the library on Automation is empty)',
  ];
  return { clips, music: track?.path ?? null, note: notes.filter(Boolean).join(', '), cleanup };
}
