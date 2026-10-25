/**
 * The dash cam's rules: which clips a person may watch, and when they go.
 * Pure — no emulator, bucket or clock needed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { proofFilter } from '../dashcam';
import {
  CLIP_SPAN_MS,
  DASHCAM_KEEP_MS,
  WINDOW_GRACE_MS,
  clipInWindow,
  clipStartedAt,
  dashcamExpiresAt,
  viewerWindow,
  type DashcamParties,
} from '../../domain/dashcam';

const T = 1_760_000_000_000;
const MIN = 60_000;

describe('clipStartedAt', () => {
  it('reads the start time out of the object name', () => {
    expect(clipStartedAt(`dashcam/d1/t1/${T}.mp4`)).toBe(T);
    expect(clipStartedAt(`${T}.mp4`)).toBe(T);
  });

  it('refuses anything that is not a clip the phone named', () => {
    expect(clipStartedAt(`dashcam/d1/t1/${T}.mov`)).toBeNull();
    expect(clipStartedAt('dashcam/d1/t1/123.mp4')).toBeNull();
    expect(clipStartedAt(`dashcam/d1/t1/${T}.mp4.html`)).toBeNull();
    expect(clipStartedAt('dashcam/d1/t1/')).toBeNull();
  });
});

describe('dashcamExpiresAt', () => {
  it('is a day after the ride ended', () => {
    expect(dashcamExpiresAt(T, T + 5 * MIN)).toBe(T + DASHCAM_KEEP_MS);
  });

  it('counts from the last clip when the ride never formally ended', () => {
    expect(dashcamExpiresAt(null, T)).toBe(T + DASHCAM_KEEP_MS);
  });

  it('has nothing to say when there is no end and no clip', () => {
    expect(dashcamExpiresAt(null, null)).toBeNull();
  });
});

describe('viewerWindow', () => {
  const solo: DashcamParties = {
    driverId: 'driver',
    passengerId: 'rider',
    poolMembers: [],
    seats: [],
  };

  it('gives the driver the whole ride', () => {
    expect(viewerWindow(solo, 'driver')).toEqual({ from: null, to: null });
  });

  it('gives a solo rider the whole ride', () => {
    expect(viewerWindow(solo, 'rider')).toEqual({ from: null, to: null });
  });

  it('gives a stranger nothing', () => {
    expect(viewerWindow(solo, 'someone-else')).toBeNull();
  });

  it('never matches a trip with no driver to an absent uid', () => {
    expect(viewerWindow({ ...solo, driverId: null }, '')).toBeNull();
  });

  const shared: DashcamParties = {
    driverId: 'driver',
    passengerId: 'host',
    poolMembers: ['host', 'early', 'late'],
    seats: [
      { uid: 'host', joinedAtMs: 0, droppedAtMs: null },
      { uid: 'early', joinedAtMs: T, droppedAtMs: T + 20 * MIN },
      { uid: 'late', joinedAtMs: T + 30 * MIN, droppedAtMs: null },
    ],
  };

  it('limits a shared-ride rider to their own time aboard, with slack for clocks', () => {
    expect(viewerWindow(shared, 'early')).toEqual({
      from: T - WINDOW_GRACE_MS,
      to: T + 20 * MIN + WINDOW_GRACE_MS,
    });
    expect(viewerWindow(shared, 'late')).toEqual({ from: T + 30 * MIN - WINDOW_GRACE_MS, to: null });
  });

  it('reads a zero join time as unknown, not as 1970', () => {
    expect(viewerWindow(shared, 'host')).toEqual({ from: null, to: null });
  });

  const startedEach: DashcamParties = {
    driverId: 'driver',
    passengerId: 'host',
    poolMembers: ['host', 'waiting'],
    seats: [
      { uid: 'host', kind: 'host', joinedAtMs: T - 30 * MIN, boardedAtMs: T, droppedAtMs: T + 20 * MIN },
      { uid: 'waiting', kind: 'share', joinedAtMs: T - 25 * MIN, droppedAtMs: null },
    ],
  };

  it('runs from the rider own start, not from when they booked', () => {
    expect(viewerWindow(startedEach, 'host')).toEqual({
      from: T - WINDOW_GRACE_MS,
      to: T + 20 * MIN + WINDOW_GRACE_MS,
    });
  });

  it('shows nothing to a rider not picked up yet, nor to a no-show', () => {
    expect(viewerWindow(startedEach, 'waiting')).toBeNull();
    expect(viewerWindow({ ...shared, noShows: ['late'] }, 'late')).toBeNull();
  });
});

describe('the travel-proof watermark', () => {
  const bin = (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('ffmpeg-static') as string;
    } catch {
      return '';
    }
  })();

  it.skipIf(!bin || !existsSync(bin))('burns into a clip with the bundled ffmpeg and fonts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'proof-test-'));
    try {
      const texts = { tile: path.join(dir, 't.txt'), heading: path.join(dir, 'h.txt'), sub: path.join(dir, 's.txt') };
      writeFileSync(texts.tile, 'VELOCITY RIDES TRAVEL PROOF');
      writeFileSync(texts.heading, 'VELOCITY RIDES · TRAVEL PROOF');
      writeFileSync(texts.sub, '25 Oct 2026, 10:42 pm PKT');
      const out = path.join(dir, 'out.mp4');
      execFileSync(bin, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=480x854:r=12:d=1',
        '-filter_complex', proofFilter(texts), '-map', '[out]', '-c:v', 'libx264', '-preset', 'ultrafast', out]);
      expect(statSync(out).size).toBeGreaterThan(1000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('clipInWindow', () => {
  const window = { from: T, to: T + 20 * MIN };

  it('keeps a clip inside the window', () => {
    expect(clipInWindow(T + 5 * MIN, window)).toBe(true);
  });

  it('keeps a clip that was already running when the window opened', () => {
    expect(clipInWindow(T - CLIP_SPAN_MS + 1, window)).toBe(true);
  });

  it('drops a clip that ended before the window opened', () => {
    expect(clipInWindow(T - CLIP_SPAN_MS - 1, window)).toBe(false);
  });

  it('drops a clip that started after the window closed', () => {
    expect(clipInWindow(T + 20 * MIN + 1, window)).toBe(false);
  });

  it('keeps everything in an open window', () => {
    expect(clipInWindow(0, { from: null, to: null })).toBe(true);
  });
});
