/**
 * The dash cam's rules: which clips a person may watch, and when they go.
 * Pure — no emulator, bucket or clock needed.
 */
import { describe, expect, it } from 'vitest';

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
