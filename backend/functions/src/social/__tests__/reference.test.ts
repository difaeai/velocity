/**
 * "Make it like this video": everything that runs on our side of the call.
 *
 * The call itself is Google's and needs the key, so it is not here. What is
 * here is what decides whether it can even be made: which links count as a
 * YouTube video, what the team is handed afterwards, and that the shrink runs
 * on the ffmpeg build we ship — the same trap that took drawtext out in prod.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { ffmpegPath } from '../reel';
import { referenceBrief, shrinkVideo, youtubeLink } from '../reference';
import type { ReferenceRead } from '../types';

describe('youtubeLink', () => {
  it('reads every shape a person pastes', () => {
    const want = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    for (const raw of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      '  https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share ',
    ]) {
      expect(youtubeLink(raw), raw).toBe(want);
    }
  });

  it('refuses anything that is not one YouTube video', () => {
    for (const raw of [
      'https://www.instagram.com/reel/DeycQF4jzV0/',
      'https://www.tiktok.com/@someone/video/7300000000000000000',
      'https://www.youtube.com/@velocityrides',
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'not a link',
    ]) {
      expect(youtubeLink(raw), raw).toBeNull();
    }
  });
});

const read: ReferenceRead = {
  atMs: 1,
  source: 'ref.mp4',
  summary: 'A commuter compares two fares on screen.',
  hook: 'A shocked face at a Rs 1,200 fare in the first second.',
  beats: [
    { at: '0-2s', what: 'the shocked face', onScreen: 'Rs 1,200?!' },
    { at: '2-8s', what: 'the cheaper split', onScreen: '' },
  ],
  seconds: 15,
  pacing: 'a cut every second',
  look: '',
  sound: 'trending audio',
  whyItWorks: ['the number lands before the scroll does'],
  market: 'Fare comparisons are travelling in Lahore this month.',
  ourVersion: 'Split a Lahore to Islamabad fare four ways.',
  dontCopy: ['their face', 'their audio'],
  sources: [],
};

describe('referenceBrief', () => {
  it('hands the team the structure, our angle and what never to reuse', () => {
    const brief = referenceBrief(read);
    expect(brief).toMatch(/^Make this piece like the reference video/);
    expect(brief).toContain('0-2s the shocked face [on screen: Rs 1,200?!]');
    expect(brief).toContain('Our version: Split a Lahore to Islamabad fare four ways.');
    expect(brief).toContain('In our market: Fare comparisons');
    expect(brief).toContain('Never reuse: their face; their audio');
  });

  it('leaves out what the read did not have', () => {
    expect(referenceBrief(read)).not.toContain('Look:');
  });
});

describe('shrinkVideo', () => {
  it('turns a 1080x1920 clip into a 360x640 one that keeps its sound', async () => {
    const bin = ffmpegPath();
    const dir = mkdtempSync(path.join(tmpdir(), 'ref-test-'));
    try {
      const src = path.join(dir, 'src.mp4');
      const made = spawnSync(bin, [
        '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', src,
      ]);
      expect(made.status).toBe(0);

      const out = await shrinkVideo(readFileSync(src));
      const shrunk = path.join(dir, 'out.mp4');
      writeFileSync(shrunk, out);
      const probe = spawnSync(bin, ['-i', shrunk, '-f', 'null', '-']).stderr.toString();
      expect(probe).toMatch(/Video: h264[^\n]* 360x640/);
      expect(probe).toMatch(/Audio: aac/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
