/**
 * The queue maths, mirrored on the handset so the feed can say "yours in 8s".
 * ----------------------------------------------------------------------------
 * AUTHORITATIVE COPY: backend/functions/src/pricing/driverQueue.ts
 *
 * Same arrangement as `src/lib/fareEngine.ts`, and for the same reason: the
 * driver's feed has to reorder itself every second as requests age, and asking
 * the server which rows are claimable on every tick would be a call a second
 * per online driver. So the ordering is computed here and the server decides
 * for real, in `placeBid`, where a patched build meets the same gate.
 *
 * What that means in practice: this file being wrong makes the feed show the
 * wrong order and a tap bounce with "it is not your turn yet". It cannot let
 * anybody actually take a ride out of turn. Keep it in step with the backend
 * anyway — a feed that disagrees with the gate is a support ticket.
 * ----------------------------------------------------------------------------
 */

/** A driver's place, as `getDriverQueueStatus` reports it. */
export interface QueuePosition {
  enabled: boolean;
  /** Zero-based. Null when this driver is not in the zone's queue. */
  rank: number | null;
  position: number | null;
  queueSize: number;
  label: string;
  /** How long after a request appears this driver may bid on it. */
  claimDelayMs: number;
  queuedSince: number | null;
  graceSec: number;
  openToAllAfterSec: number;
}

/**
 * How long this driver must wait before bidding on a request.
 *
 * Prefers the server's own `claimDelayMs` — it was computed from the live
 * settings, which this build may not know. Falls back to the tail's wait when
 * there is no status yet, because an unknown rank is never treated as the head
 * of the queue.
 */
export function waitFor(queue: QueuePosition | null | undefined): number {
  if (!queue || !queue.enabled) return 0;
  return Math.max(0, queue.claimDelayMs);
}

export interface Ageable {
  createdAt?: { seconds: number } | null;
}

/** Milliseconds since a request was created; 0 when its write is still local. */
export function ageMsOf(request: Ageable, now: number): number {
  const seconds = request.createdAt?.seconds;
  return seconds ? Math.max(0, now - seconds * 1000) : 0;
}

export interface Queued<T> {
  request: T;
  /** 0 when claimable now, otherwise how long until it opens to this driver. */
  opensInMs: number;
}

/**
 * The feed, in the order the driver should work it.
 *
 * Claimable rows first, longest-waiting first within them — that is the FIFO
 * half of the brief, and it is also the right triage, since the request that
 * has been waiting longest is the one closest to a rider giving up. Rows the
 * driver may not take yet follow, soonest-to-open first, rather than being
 * hidden: a feed that silently drops them looks broken, and showing "opens in
 * 6s" is what makes the queue legible instead of mysterious.
 */
export function orderFeed<T extends Ageable>(
  requests: T[],
  queue: QueuePosition | null | undefined,
  now: number,
): Queued<T>[] {
  const delay = waitFor(queue);

  const claimable: Queued<T>[] = [];
  const waiting: Queued<T>[] = [];

  for (const request of requests) {
    const age = ageMsOf(request, now);
    if (age >= delay) claimable.push({ request, opensInMs: 0 });
    else waiting.push({ request, opensInMs: delay - age });
  }

  claimable.sort((a, b) => ageMsOf(b.request, now) - ageMsOf(a.request, now));
  waiting.sort((a, b) => a.opensInMs - b.opensInMs);
  return [...claimable, ...waiting];
}

/**
 * What to put on a row the driver cannot take yet.
 *
 * Phrased as the queue working rather than as a refusal: the driver has not
 * been blocked, the drivers ahead of them are being given their turn, and this
 * row is coming.
 */
export function opensInLabel(opensInMs: number): string | null {
  if (opensInMs <= 0) return null;
  return `Opens to you in ${Math.max(1, Math.ceil(opensInMs / 1000))}s`;
}

/**
 * The one-line summary above the feed.
 *
 * Null when there is nothing worth saying — the queue is off, or this driver is
 * at the head of it and everything is already theirs to take.
 */
export function queueBanner(queue: QueuePosition | null | undefined): string | null {
  if (!queue || !queue.enabled || queue.queueSize === 0) return null;
  if (queue.rank === null) return 'Joining the queue for this area…';
  if (queue.rank === 0) return `You are next here — 1st of ${queue.queueSize} drivers waiting`;
  return `Position ${queue.rank + 1} of ${queue.queueSize} drivers waiting here`;
}

/**
 * The warning worth showing before a driver taps Go offline.
 *
 * This is the rule drivers will be angriest about if they meet it by surprise,
 * so it is stated before the fact and in terms of what they lose.
 */
export function offlineWarning(queue: QueuePosition | null | undefined): string | null {
  if (!queue || !queue.enabled || queue.rank === null) return null;
  return `You are number ${queue.rank + 1} in the queue here. Going offline for more than ${queue.graceSec} seconds gives up your place and you rejoin at the back.`;
}
