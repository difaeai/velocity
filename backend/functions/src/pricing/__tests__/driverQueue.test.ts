/**
 * The brief for the queue was given as a worked example: drivers 1-2-3-4-5 are
 * online, number 2 goes offline, and when number 2 comes back they are number
 * 5 — not number 2. `reassigns the returning driver to the tail` is that
 * example, and the rest of this file is the surrounding safety: a brief signal
 * drop must not cost a place, and a stalled pricing tick must not stop anybody
 * from working.
 */
import { describe, it, expect } from 'vitest';

import {
  QUEUE_STALE_MS,
  claimDecision,
  claimDelayMs,
  describeQueuePosition,
  orderClaimable,
  rankOf,
  rebuildQueue,
  sortQueue,
} from '../driverQueue';
import { DEFAULT_PRICING_CONFIG, type QueueEntry, type ZoneQueue } from '../types';

const NOW = 1_760_000_000_000;
const settings = DEFAULT_PRICING_CONFIG.queue;
const ids = (entries: QueueEntry[]) => sortQueue(entries).map((e) => e.driverId);

/** Five drivers who came online a minute apart, oldest first. */
function fiveOnline(now = NOW): QueueEntry[] {
  return ['d1', 'd2', 'd3', 'd4', 'd5'].map((driverId, i) => ({
    driverId,
    queuedAt: now - (5 - i) * 60_000,
    lastSeenAt: now,
  }));
}

describe('rebuildQueue', () => {
  it('keeps seniority for everyone who is still online', () => {
    const previous = fiveOnline();
    const result = rebuildQueue(previous, ['d1', 'd2', 'd3', 'd4', 'd5'], settings, NOW + 60_000);
    expect(ids(result.entries)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(result.joined).toEqual([]);
    expect(result.forfeited).toEqual([]);
  });

  it('puts a new driver at the tail', () => {
    const result = rebuildQueue(fiveOnline(), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], settings, NOW + 60_000);
    expect(ids(result.entries)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    expect(result.joined).toEqual(['d6']);
  });

  it('holds a place through a brief signal drop', () => {
    const afterGrace = NOW + settings.graceSec * 1000 - 1_000;
    const result = rebuildQueue(fiveOnline(), ['d1', 'd3', 'd4', 'd5'], settings, afterGrace);
    expect(result.inGrace).toEqual(['d2']);
    expect(ids(result.entries)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
  });

  it('reassigns the returning driver to the tail', () => {
    // d2 goes offline and stays off past the grace window.
    const gone = NOW + settings.graceSec * 1000 + 1_000;
    const afterLeaving = rebuildQueue(fiveOnline(), ['d1', 'd3', 'd4', 'd5'], settings, gone);
    expect(afterLeaving.forfeited).toEqual(['d2']);
    expect(ids(afterLeaving.entries)).toEqual(['d1', 'd3', 'd4', 'd5']);

    // ...and comes back. Second place is gone; they are behind d5 now.
    const back = rebuildQueue(afterLeaving.entries, ['d1', 'd2', 'd3', 'd4', 'd5'], settings, gone + 60_000);
    expect(ids(back.entries)).toEqual(['d1', 'd3', 'd4', 'd5', 'd2']);
    expect(rankOf(back.entries, 'd2')).toBe(4);
    expect(back.joined).toEqual(['d2']);
  });

  it('keeps the grace window closing while a driver is away', () => {
    // Two consecutive ticks with d2 absent, each inside the grace window on its
    // own. The window is measured from when they were last SEEN, so it still
    // expires — otherwise a driver missing every other poll would hold a slot
    // for ever.
    const previous = fiveOnline();
    const tick1 = rebuildQueue(previous, ['d1', 'd3', 'd4', 'd5'], settings, NOW + 60_000);
    expect(tick1.inGrace).toEqual(['d2']);
    const tick2 = rebuildQueue(tick1.entries, ['d1', 'd3', 'd4', 'd5'], settings, NOW + 150_000);
    expect(tick2.forfeited).toEqual(['d2']);
  });

  it('never seats one driver twice, even from a corrupt snapshot', () => {
    const duplicated = [...fiveOnline(), { driverId: 'd2', queuedAt: NOW, lastSeenAt: NOW }];
    const result = rebuildQueue(duplicated, ['d1', 'd2'], settings, NOW);
    expect(result.entries.filter((e) => e.driverId === 'd2')).toHaveLength(1);
  });

  it('orders drivers who joined in the same tick deterministically', () => {
    const a = rebuildQueue([], ['dz', 'da', 'dm'], settings, NOW);
    const b = rebuildQueue([], ['dm', 'dz', 'da'], settings, NOW);
    expect(ids(a.entries)).toEqual(ids(b.entries));
  });
});

describe('claimDelayMs', () => {
  it('releases the first tier at once and each later tier a step behind', () => {
    expect(claimDelayMs(0, settings)).toBe(0);
    expect(claimDelayMs(2, settings)).toBe(0);
    expect(claimDelayMs(3, settings)).toBe(8_000);
    expect(claimDelayMs(5, settings)).toBe(8_000);
    expect(claimDelayMs(6, settings)).toBe(16_000);
  });

  it('stops widening at the open-to-all cap', () => {
    expect(claimDelayMs(300, settings)).toBe(settings.openToAllAfterSec * 1000);
  });
});

describe('claimDecision', () => {
  const queue = (over: Partial<ZoneQueue> = {}): ZoneQueue => ({
    cityId: 'islamabad_rawalpindi',
    zone: 'tx4hb',
    entries: fiveOnline(),
    updatedAt: NOW,
    ...over,
  });

  it('lets the driver at the head take a brand new request', () => {
    const decision = claimDecision({ queue: queue(), driverId: 'd1', requestCreatedAt: NOW, settings, now: NOW });
    expect(decision.allowed).toBe(true);
    expect(decision.rank).toBe(0);
    expect(decision.reason).toBe('in_turn');
  });

  it('makes a driver further back wait their turn', () => {
    const decision = claimDecision({ queue: queue(), driverId: 'd4', requestCreatedAt: NOW, settings, now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('wait_your_turn');
    expect(decision.waitMs).toBe(8_000);
  });

  it('opens the same request to that driver once their tier arrives', () => {
    const decision = claimDecision({
      queue: queue(),
      driverId: 'd4',
      requestCreatedAt: NOW - 9_000,
      settings,
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it('opens an ageing request to everyone, whatever their rank', () => {
    const decision = claimDecision({
      queue: queue({ entries: Array.from({ length: 200 }, (_, i) => ({ driverId: `d${i}`, queuedAt: NOW - i, lastSeenAt: NOW })) }),
      driverId: 'd199',
      requestCreatedAt: NOW - 61_000,
      settings,
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('open_to_all');
  });

  it('puts a driver missing from the queue at its tail, not outside it', () => {
    const decision = claimDecision({ queue: queue(), driverId: 'unknown', requestCreatedAt: NOW, settings, now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('tail_of_queue');
    // Five queued drivers → the tail's tier, not the full open-to-all wait.
    expect(decision.waitMs).toBe(claimDelayMs(5, settings));
    expect(decision.waitMs).toBeLessThan(settings.openToAllAfterSec * 1000);
  });

  it('lets a driver parked across a cell boundary claim once the tail opens', () => {
    const decision = claimDecision({
      queue: queue(),
      driverId: 'next-zone-over',
      requestCreatedAt: NOW - claimDelayMs(5, settings),
      settings,
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('tail_of_queue');
  });

  it('never lets an unqueued driver cut ahead of a queued one', () => {
    const queued = claimDecision({ queue: queue(), driverId: 'd5', requestCreatedAt: NOW, settings, now: NOW });
    const unqueued = claimDecision({ queue: queue(), driverId: 'stranger', requestCreatedAt: NOW, settings, now: NOW });
    expect(unqueued.waitMs).toBeGreaterThanOrEqual(queued.waitMs);
  });

  // ── The fail-open cases. Each of these is a production incident if wrong. ──

  it('lets everybody work when the pricing tick has stalled', () => {
    const decision = claimDecision({
      queue: queue({ updatedAt: NOW - QUEUE_STALE_MS - 1 }),
      driverId: 'd5',
      requestCreatedAt: NOW,
      settings,
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('stale_queue');
  });

  it('lets everybody work in a zone with no queue yet', () => {
    const decision = claimDecision({ queue: null, driverId: 'd1', requestCreatedAt: NOW, settings, now: NOW });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('no_queue');
  });

  it('lets everybody work when the queue is switched off', () => {
    const decision = claimDecision({
      queue: queue(),
      driverId: 'd5',
      requestCreatedAt: NOW,
      settings: { ...settings, enabled: false },
      now: NOW,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('disabled');
  });

  it('tolerates a request whose clock is ahead of ours', () => {
    const decision = claimDecision({ queue: queue(), driverId: 'd1', requestCreatedAt: NOW + 30_000, settings, now: NOW });
    expect(decision.allowed).toBe(true);
  });
});

describe('orderClaimable', () => {
  const requests = [
    { id: 'new', createdAtMs: NOW - 1_000 },
    { id: 'old', createdAtMs: NOW - 40_000 },
    { id: 'middle', createdAtMs: NOW - 20_000 },
  ];

  it('shows the longest-waiting request first', () => {
    const { claimable } = orderClaimable(requests, { rank: 0, queueSize: 5 }, settings, NOW);
    expect(claimable.map((r) => r.id)).toEqual(['old', 'middle', 'new']);
  });

  it('holds back what a driver may not claim yet, soonest first', () => {
    const { claimable, waiting } = orderClaimable(requests, { rank: 4, queueSize: 5 }, settings, NOW);
    expect(claimable.map((r) => r.id)).toEqual(['old', 'middle']);
    expect(waiting.map((w) => w.request.id)).toEqual(['new']);
    expect(waiting[0]!.waitMs).toBe(7_000);
  });

  it('gives an unranked driver the tail delay, not an empty feed', () => {
    const { claimable } = orderClaimable(requests, { rank: null, queueSize: 5 }, settings, NOW);
    // Tail of a five-deep queue is one tier back — the two older requests have
    // already outlived it.
    expect(claimable.map((r) => r.id)).toEqual(['old', 'middle']);
  });

  it('shows everything when the queue is off', () => {
    const { claimable } = orderClaimable(requests, { rank: 9, queueSize: 20 }, { ...settings, enabled: false }, NOW);
    expect(claimable).toHaveLength(3);
  });
});

describe('describeQueuePosition', () => {
  it('counts from one, the way a person in a queue does', () => {
    expect(describeQueuePosition(0, 5)).toBe('You are next — 1st of 5 waiting');
    expect(describeQueuePosition(3, 5)).toBe('Position 4 of 5 waiting');
    expect(describeQueuePosition(null, 5)).toBe('Joining the queue…');
  });
});
