/**
 * The pure parts of picking footage and music. The network and the bucket are
 * not here: a failure there only makes the reel plainer, never fails it.
 */
import { describe, expect, it } from 'vitest';

import { pickFile, searchTerms, trackIndex, type PexelsFile } from '../footage';

const file = (width: number, height: number, file_type = 'video/mp4'): PexelsFile => ({
  file_type,
  width,
  height,
  link: `https://videos.pexels.com/${width}x${height}.mp4`,
});

describe('pickFile', () => {
  it('takes the smallest file that still fills a 720-wide frame', () => {
    expect(pickFile([file(2160, 3840), file(540, 960), file(1080, 1920), file(720, 1280)])).toEqual(file(720, 1280));
  });

  it('takes the biggest there is when nothing is sharp enough', () => {
    expect(pickFile([file(360, 640), file(540, 960)])).toEqual(file(540, 960));
  });

  it('never takes a format ffmpeg was not promised', () => {
    expect(pickFile([file(720, 1280, 'video/webm')])).toBeNull();
    expect(pickFile([])).toBeNull();
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
  it('gives the same piece the same track, and stays in range', () => {
    expect(trackIndex('2026-10-22-reel', 5)).toBe(trackIndex('2026-10-22-reel', 5));
    for (const id of ['2026-10-22-reel', '2026-10-23-reel', '2026-10-24-video-2']) {
      const i = trackIndex(id, 3);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(3);
    }
  });
});
