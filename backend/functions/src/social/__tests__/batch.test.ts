/**
 * The calendar is made in batches: thirty days in one go, then nothing but
 * posting until it runs low. The owner watched the AI being called every day
 * once the month was already made — a rolling window made one new day every
 * day — and asked for exactly this instead.
 */
import { describe, expect, it } from 'vitest';

import { BATCH_SHARE } from '../../ai/config';
import { batchStep, dayPieces, REFILL_DAYS } from '../pipeline';
import type { PlannedSlot } from '../strategy';

const slot = (format: PlannedSlot['format']): PlannedSlot => ({ format, topic: 't', hook: '', pillar: 'p' });

describe('batchStep', () => {
  it('starts a batch of the next thirty days when nothing is made yet', () => {
    expect(batchStep({ today: '2026-10-27', until: null, filling: null, makeAheadDays: 30 })).toEqual({ fill: '2026-11-26' });
  });

  it('makes nothing while the made calendar still has days to post — only posting', () => {
    for (const until of ['2026-11-26', '2026-11-10', '2026-10-30']) {
      expect(batchStep({ today: '2026-10-27', until, filling: null, makeAheadDays: 30 })).toEqual({ fill: null });
    }
  });

  it('starts the next batch once the calendar runs low, from today', () => {
    const lowOn = (days: number) => new Date(Date.parse('2026-11-26T12:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);
    // REFILL_DAYS before the end and closer.
    expect(batchStep({ today: lowOn(REFILL_DAYS - 1), until: '2026-11-26', filling: null, makeAheadDays: 30 }).fill).not.toBeNull();
    expect(batchStep({ today: lowOn(REFILL_DAYS), until: '2026-11-26', filling: null, makeAheadDays: 30 }).fill).toBeNull();
    // A calendar that ran out altogether.
    expect(batchStep({ today: '2026-12-01', until: '2026-11-26', filling: null, makeAheadDays: 30 })).toEqual({ fill: '2026-12-31' });
  });

  it('keeps filling a batch in progress to its end, whatever is made so far', () => {
    expect(batchStep({ today: '2026-10-28', until: '2026-11-26', filling: '2026-11-26', makeAheadDays: 30 })).toEqual({
      fill: '2026-11-26',
    });
  });
});

describe('dayPieces', () => {
  it('is the day’s planned pieces and its story', () => {
    expect(dayPieces([slot('reel')], 1, true).map((p) => p.format)).toEqual(['reel', 'story']);
  });

  it('never makes a second story on a day the plan already gave one', () => {
    expect(dayPieces([slot('story')], 1, true).map((p) => p.format)).toEqual(['story']);
  });

  it('holds the plan to the pieces a day, and leaves the story out when it is off', () => {
    expect(dayPieces([slot('reel'), slot('post'), slot('carousel')], 2, false).map((p) => p.format)).toEqual(['reel', 'post']);
  });
});

describe('a capped month', () => {
  it('keeps a share back for the month’s replies and changes', () => {
    expect(BATCH_SHARE).toBeGreaterThan(0.5);
    expect(BATCH_SHARE).toBeLessThan(1);
  });
});
