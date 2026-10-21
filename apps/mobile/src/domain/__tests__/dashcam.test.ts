/**
 * The dash cam's rules on the phone: how long a clip runs, when the cabin is
 * checked, and when a ride's video can still be opened.
 */
import { describe, it, expect } from 'vitest';

import {
  CLIP_SECONDS,
  DASHCAM_KEEP_MS,
  FIRST_CLIP_SECONDS,
  MAX_CABIN_CHECKS,
  clipSeconds,
  dashcamWatchable,
  shouldCheckCabin,
} from '../dashcam';

describe('clipSeconds', () => {
  it('opens a ride with a short clip, so the cabin check answers in seconds', () => {
    expect(clipSeconds(0)).toBe(FIRST_CLIP_SECONDS);
    expect(clipSeconds(1)).toBe(CLIP_SECONDS);
    expect(clipSeconds(40)).toBe(CLIP_SECONDS);
  });
});

describe('shouldCheckCabin', () => {
  it('checks until somebody has been seen', () => {
    expect(shouldCheckCabin('unknown', 0)).toBe(true);
    expect(shouldCheckCabin('not_seen', 1)).toBe(true);
    expect(shouldCheckCabin('seen', 1)).toBe(false);
  });

  it('stops warning after the last allowed check', () => {
    expect(shouldCheckCabin('not_seen', MAX_CABIN_CHECKS - 1)).toBe(true);
    expect(shouldCheckCabin('not_seen', MAX_CABIN_CHECKS)).toBe(false);
  });
});

describe('dashcamWatchable', () => {
  const now = 1_760_000_000_000;
  const endedAgo = (ms: number) => ({ seconds: Math.floor((now - ms) / 1000) });

  it('is open for the whole ride', () => {
    expect(dashcamWatchable({ status: 'in_progress' }, now)).toBe(true);
  });

  it('stays open for a day after the ride ends, then closes', () => {
    expect(dashcamWatchable({ status: 'completed', completedAt: endedAgo(60_000) }, now)).toBe(true);
    expect(dashcamWatchable({ status: 'completed', completedAt: endedAgo(DASHCAM_KEEP_MS + 1000) }, now)).toBe(false);
  });

  it('is closed for rides that never ran, or with no recorded end', () => {
    expect(dashcamWatchable({ status: 'cancelled' }, now)).toBe(false);
    expect(dashcamWatchable({ status: 'arrived' }, now)).toBe(false);
    expect(dashcamWatchable({ status: 'completed', completedAt: null }, now)).toBe(false);
  });
});
