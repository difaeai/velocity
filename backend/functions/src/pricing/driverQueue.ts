/**
 * First come, first served — and going offline costs you your place.
 * ----------------------------------------------------------------------------
 * WHAT IT REPLACES
 * ----------------
 * `useOpenRequests` in apps/mobile/src/hooks/driver.ts listens to every open
 * request in the city, filters to nearby cells, sorts by distance and shows the
 * lot. Every online driver sees the same list at the same instant and the first
 * tap wins. That has two consequences the brief asks us to end:
 *
 *  · It rewards staring. A driver who has been waiting four hours and a driver
 *    who opened the app thirty seconds ago have exactly the same chance, so the
 *    way to earn is to keep the screen lit and the thumb ready.
 *  · It rewards the fastest phone and the best signal, which is not a thing
 *    Velocity should be paying for.
 *
 * HOW THE QUEUE WORKS
 * -------------------
 * Every zone has an ordered list. A driver's position is set by when their
 * current unbroken online run began — `queuedAt` — and positions are released
 * in tiers: the first `tierSize` drivers may claim a new request immediately,
 * the next tier `tierSeconds` later, and so on.
 *
 * Nothing is ever reserved for a driver who is not there. After
 * `openToAllAfterSec` every online driver may claim, whatever their rank. A
 * rider waiting is a worse outcome than a driver being served out of turn, and
 * that cap is what guarantees the queue can never strand a request.
 *
 * GOING OFFLINE FORFEITS THE PLACE
 * --------------------------------
 * Which is the point. Positions 1-2-3-4-5, number 2 goes offline, number 2
 * comes back: they are now number 5. Their `queuedAt` is the moment they
 * returned, because what the queue measures is the length of the run you are
 * currently on, not the total time you have ever been signed up.
 *
 * That is also the second half of the defence in `supplyIntegrity.ts`. Going
 * offline to force the price up already gains nothing, because the factor
 * freezes. Now it costs something as well: your place in every zone queue.
 *
 * `graceSec` is the one concession. A driver who drops out of the online set
 * for less than that keeps their slot, because one missed poll is the Kahuta
 * tunnel or a dead patch on the motorway, not a decision to stop working.
 *
 * Pure. The Firestore reads and writes are in `engine.ts`.
 * ----------------------------------------------------------------------------
 */
import type { QueueEntry, QueueSettings, ZoneQueue } from './types';

/**
 * How old a queue snapshot may be and still gate an accept.
 *
 * This is a safety valve, not a tuning knob. If the pricing tick stops — a bad
 * deploy, a quota, a region outage — the queue documents stop being refreshed,
 * and a gate that trusted them would start refusing every driver in the country
 * while riders sat waiting. Past this age the gate fails OPEN and the system
 * degrades to exactly the behaviour it had before this file existed.
 *
 * Five minutes is five missed ticks at the one-minute schedule.
 */
export const QUEUE_STALE_MS = 5 * 60 * 1000;

export interface QueueRebuild {
  entries: QueueEntry[];
  /** Drivers who were not in the queue and now are, at the tail. */
  joined: string[];
  /** Drivers dropped for being away longer than the grace window. */
  forfeited: string[];
  /** Drivers kept only because they are inside the grace window. */
  inGrace: string[];
}

/**
 * The queue this zone should have, given who is online right now.
 *
 * `previous` is the last snapshot, `onlineNow` is the driver ids the tick just
 * observed. Seniority is preserved for anyone still present: a driver's
 * `queuedAt` is only ever rewritten when they rejoin after forfeiting, which is
 * the entire mechanic.
 */
export function rebuildQueue(
  previous: QueueEntry[],
  onlineNow: string[],
  settings: QueueSettings,
  now: number = Date.now(),
): QueueRebuild {
  const online = new Set(onlineNow);
  const entries: QueueEntry[] = [];
  const forfeited: string[] = [];
  const inGrace: string[] = [];
  const known = new Set<string>();

  for (const entry of previous) {
    // A duplicate id in a stored snapshot would otherwise occupy two places.
    if (known.has(entry.driverId)) continue;
    known.add(entry.driverId);

    if (online.has(entry.driverId)) {
      entries.push({ ...entry, lastSeenAt: now });
      continue;
    }
    // Absent. Keep the place only while inside the grace window, and do NOT
    // touch lastSeenAt — the window has to keep closing while they are away,
    // or a driver who misses every other poll would hold a slot for ever.
    if (now - entry.lastSeenAt <= settings.graceSec * 1000) {
      entries.push(entry);
      inGrace.push(entry.driverId);
      continue;
    }
    forfeited.push(entry.driverId);
  }

  const joined: string[] = [];
  for (const driverId of onlineNow) {
    if (known.has(driverId)) continue;
    known.add(driverId);
    joined.push(driverId);
    entries.push({ driverId, queuedAt: now, lastSeenAt: now });
  }

  return { entries: sortQueue(entries), joined, forfeited, inGrace };
}

/**
 * Oldest run first, then by id.
 *
 * The id tie-break is not cosmetic: several drivers joining in the same tick
 * share a `queuedAt` to the millisecond, and without a stable second key their
 * order would depend on Firestore's iteration order and shuffle every tick,
 * which is the opposite of a queue.
 */
export function sortQueue(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort(
    (a, b) => a.queuedAt - b.queuedAt || a.driverId.localeCompare(b.driverId),
  );
}

/** Zero-based place in the queue, or null when this driver is not in it. */
export function rankOf(entries: QueueEntry[], driverId: string): number | null {
  const index = sortQueue(entries).findIndex((e) => e.driverId === driverId);
  return index === -1 ? null : index;
}

/** How long after a request appears this rank may claim it. */
export function claimDelayMs(rank: number, settings: QueueSettings): number {
  if (!settings.enabled) return 0;
  const tierSize = Math.max(1, Math.trunc(settings.tierSize));
  const tier = Math.floor(Math.max(0, rank) / tierSize);
  const delay = tier * Math.max(0, settings.tierSeconds) * 1000;
  return Math.min(delay, Math.max(0, settings.openToAllAfterSec) * 1000);
}

/**
 * The delay that applies to a driver, whether or not they are in the queue.
 *
 * A driver with no rank takes the tail's delay — see `claimDecision` for why a
 * cell boundary must not cost somebody the full wait.
 */
export function effectiveDelayMs(
  rank: number | null,
  queueSize: number,
  settings: QueueSettings,
): number {
  return claimDelayMs(rank ?? queueSize, settings);
}

export type ClaimReason =
  /** The queue is switched off — behave as before it existed. */
  | 'disabled'
  /** No queue for this zone yet. Fails open. */
  | 'no_queue'
  /** The tick has not refreshed this queue recently. Fails open. */
  | 'stale_queue'
  /** Past `openToAllAfterSec` — anybody may take it. */
  | 'open_to_all'
  /** This driver's tier has opened. */
  | 'in_turn'
  /** Their tier has not opened yet. */
  | 'wait_your_turn'
  /** Not in this zone's queue — treated as its tail, never ahead of it. */
  | 'tail_of_queue';

export interface ClaimDecision {
  allowed: boolean;
  rank: number | null;
  queueSize: number;
  /** Milliseconds until this driver may claim; 0 when they already may. */
  waitMs: number;
  reason: ClaimReason;
}

/**
 * May this driver take this request yet?
 *
 * The authoritative copy of this question is asked server-side in `acceptTrip`.
 * The driver app asks it too, so the feed can show "yours in 8s" instead of
 * letting a driver tap something that will be refused — but a client-side
 * answer is only ever a courtesy, and a patched build that ignores it meets the
 * same gate at accept.
 *
 * Fails open on every kind of not-knowing. The cost of wrongly allowing a claim
 * is one ride served out of order; the cost of wrongly refusing is a driver who
 * cannot work and a rider nobody collects.
 */
export function claimDecision(input: {
  queue: ZoneQueue | null;
  driverId: string;
  requestCreatedAt: number;
  settings: QueueSettings;
  now?: number;
}): ClaimDecision {
  const { queue, driverId, requestCreatedAt, settings, now = Date.now() } = input;

  if (!settings.enabled) {
    return { allowed: true, rank: null, queueSize: 0, waitMs: 0, reason: 'disabled' };
  }
  if (!queue || queue.entries.length === 0) {
    return { allowed: true, rank: null, queueSize: 0, waitMs: 0, reason: 'no_queue' };
  }
  if (now - queue.updatedAt > QUEUE_STALE_MS) {
    return {
      allowed: true,
      rank: null,
      queueSize: queue.entries.length,
      waitMs: 0,
      reason: 'stale_queue',
    };
  }

  const ageMs = Math.max(0, now - requestCreatedAt);
  const openToAllMs = Math.max(0, settings.openToAllAfterSec) * 1000;
  const queueSize = queue.entries.length;

  if (ageMs >= openToAllMs) {
    return { allowed: true, rank: rankOf(queue.entries, driverId), queueSize, waitMs: 0, reason: 'open_to_all' };
  }

  const rank = rankOf(queue.entries, driverId);
  if (rank === null) {
    // Not in this zone's queue. Two ordinary ways that happens, and neither is
    // misconduct: they came online after this snapshot was taken, or they are
    // parked just across a cell boundary and queued in the zone next door.
    //
    // So they are given the TAIL's delay rather than being refused. Geohash
    // edges are arbitrary — a driver 200 m from the pickup can easily be in a
    // different cell from it — and making a boundary cost a driver the full
    // open-to-all wait would be a worse injustice than the queue-jumping it
    // prevents. The tail is still strictly behind every driver who is properly
    // queued here, which is the property that matters.
    const tailDelay = effectiveDelayMs(null, queueSize, settings);
    return {
      allowed: ageMs >= tailDelay,
      rank: null,
      queueSize,
      waitMs: Math.max(0, tailDelay - ageMs),
      reason: 'tail_of_queue',
    };
  }

  const delay = claimDelayMs(rank, settings);
  if (ageMs >= delay) {
    return { allowed: true, rank, queueSize, waitMs: 0, reason: 'in_turn' };
  }
  return { allowed: false, rank, queueSize, waitMs: delay - ageMs, reason: 'wait_your_turn' };
}

/**
 * What the driver app says about a place in the queue.
 *
 * Positions are shown one-based, because no driver thinks of themselves as
 * number zero in a queue.
 */
export function describeQueuePosition(rank: number | null, queueSize: number): string {
  if (rank === null) return 'Joining the queue…';
  if (rank === 0) return `You are next — 1st of ${queueSize} waiting`;
  return `Position ${rank + 1} of ${queueSize} waiting`;
}

/**
 * Requests this driver may claim right now, oldest first.
 *
 * Oldest-first rather than nearest-first is the FIFO half of the brief, and it
 * is also the right triage: the request that has been waiting longest is the
 * one closest to a rider giving up. Distance is still carried on each row for
 * the card to show, it just no longer decides the order.
 */
export function orderClaimable<T extends { createdAtMs: number }>(
  requests: T[],
  position: { rank: number | null; queueSize: number },
  settings: QueueSettings,
  now: number = Date.now(),
): { claimable: T[]; waiting: { request: T; waitMs: number }[] } {
  const claimable: T[] = [];
  const waiting: { request: T; waitMs: number }[] = [];
  const delay = effectiveDelayMs(position.rank, position.queueSize, settings);

  for (const request of requests) {
    const ageMs = Math.max(0, now - request.createdAtMs);
    if (!settings.enabled || ageMs >= delay) claimable.push(request);
    else waiting.push({ request, waitMs: delay - ageMs });
  }

  claimable.sort((a, b) => a.createdAtMs - b.createdAtMs);
  waiting.sort((a, b) => a.waitMs - b.waitMs);
  return { claimable, waiting };
}
