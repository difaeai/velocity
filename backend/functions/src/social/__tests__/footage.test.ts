/**
 * Picking footage and music. The network and the bucket are stubbed or absent:
 * a failure there only makes the reel plainer, never fails it. The search
 * cache runs against the emulator, because Pixabay's terms are about what
 * actually reaches them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { fitsOrientation, pickFile, rotate, searchPixabay, searchTerms, trackIndex, type StockFile } from '../footage';

const file = (width: number, height: number, url = `https://cdn.pixabay.com/${width}x${height}.mp4`): StockFile => ({
  url,
  width,
  height,
});

describe('pickFile', () => {
  it('takes the smallest file that still fills a 720-wide frame', () => {
    expect(pickFile([file(2160, 3840), file(540, 960), file(1080, 1920), file(720, 1280)])).toEqual(file(720, 1280));
  });

  it('takes the biggest there is when nothing is sharp enough', () => {
    expect(pickFile([file(360, 640), file(540, 960)])).toEqual(file(540, 960));
  });

  it('skips a size Pixabay has no file for', () => {
    // Pixabay sends every size key, with an empty url where it has none.
    expect(pickFile([file(3840, 2160, ''), file(1280, 720)])).toEqual(file(1280, 720));
    expect(pickFile([file(720, 1280, '')])).toBeNull();
    expect(pickFile([])).toBeNull();
  });
});

describe('fitsOrientation', () => {
  const hit = (w: number, h: number) => ({ id: 1, user_id: 1, videos: { medium: file(w, h), tiny: file(w / 4, h / 4) } });

  it('prefers tall clips for a reel and wide ones for a video', () => {
    expect(fitsOrientation(hit(720, 1280), 'portrait')).toBe(true);
    expect(fitsOrientation(hit(1280, 720), 'portrait')).toBe(false);
    expect(fitsOrientation(hit(1280, 720), 'landscape')).toBe(true);
  });
});

describe('searchTerms', () => {
  it('cuts a scene to the words a stock search can match', () => {
    expect(searchTerms('A driver, counting cash — close up, at night in Lahore traffic')).toBe(
      'A driver counting cash close up',
    );
    expect(searchTerms('A driver, counting cash', 3)).toBe('A driver counting');
  });
});

describe('trackIndex', () => {
  it('gives the same piece the same place, and stays in range', () => {
    expect(trackIndex('2026-10-22-reel', 5)).toBe(trackIndex('2026-10-22-reel', 5));
    for (const id of ['2026-10-22-reel', '2026-10-23-reel', '2026-10-24-video-2']) {
      const i = trackIndex(id, 3);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(3);
    }
  });
});

describe('searchPixabay', () => {
  const answer = { hits: [{ id: 7, user_id: 3, videos: { small: { url: 'https://cdn.pixabay.com/7.mp4', width: 720, height: 1280 } }, views: 9 }] };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));

  beforeEach(async () => {
    await clearFirestore();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks Pixabay once a day for the same search, as its terms require', async () => {
    const first = await searchPixabay('k', 'City traffic night');
    const again = await searchPixabay('k', 'city traffic night');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only what the render reads is kept.
    expect(first).toEqual([{ id: 7, user_id: 3, videos: answer.hits[0].videos }]);
    expect(again).toEqual(first);
  });

  it('asks again once the copy is a day old', async () => {
    await searchPixabay('k', 'rain');
    const [cached] = (await db().collection('socialStockSearches').get()).docs;
    await cached.ref.update({ atMs: Date.now() - 25 * 60 * 60 * 1000 });
    await searchPixabay('k', 'rain');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('rotate', () => {
  it('takes consecutive items from the piece’s place, wrapping, never repeating', () => {
    const items = ['a', 'b', 'c', 'd'];
    const picked = rotate(items, '2026-10-22-reel', 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    const start = trackIndex('2026-10-22-reel', 4);
    expect(picked[0]).toBe(items[start]);
  });

  it('never takes more than the library holds', () => {
    expect(rotate(['a', 'b'], 'x', 5)).toHaveLength(2);
    expect(rotate([], 'x', 5)).toEqual([]);
  });
});
