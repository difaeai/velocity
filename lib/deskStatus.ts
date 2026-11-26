'use client';

/**
 * What the sidebar needs to know about the desk.
 *
 * The overview used to be four boxes of numbers under the Brain. The owner
 * asked (2026-11-26) for the dashboard to be the Brain and nothing else, with
 * everything else in the sidebar — so the counts moved onto the nav rows, and
 * this is how they get there.
 *
 * It is a snapshot, not a fetch: the pages that already read posts, ads, chats
 * and readiness publish what they found, and the sidebar draws it. No page
 * makes a call it would not have made anyway, which matters on a console whose
 * reads are callables and cold starts.
 */
import { useSyncExternalStore } from 'react';

export interface DeskStatus {
  /** Pieces waiting for an Approve. */
  waiting: number;
  /** Comments nobody has answered. */
  comments: number;
  /** Campaigns actually spending. */
  liveAds: number;
  /** Conversations still open. */
  chats: number;
  /** Things stopping the team working at all. */
  blockers: number;
  /** Is the daily run on? */
  running: boolean;
  /** "today, 10:00" — when she next makes the day's pieces. */
  nextRun: string | null;
  /** The one line about what she is doing this minute. */
  doing: string | null;
}

let snapshot: DeskStatus | null = null;
const subs = new Set<() => void>();

/** Called by a page that has just read the desk. */
export function publishDeskStatus(next: DeskStatus) {
  const same =
    snapshot &&
    (Object.keys(next) as Array<keyof DeskStatus>).every((k) => snapshot![k] === next[k]);
  if (same) return;
  snapshot = next;
  subs.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/**
 * The last thing any page saw, or null before the first read of the session.
 *
 * `useSyncExternalStore`, not a hand-rolled subscribe: the page that publishes
 * is a child of the layout that reads, so its effect runs first and a
 * hand-rolled subscriber would miss the only publish it ever gets and sit
 * empty for the rest of the session. This reads the snapshot at the moment it
 * subscribes, which is the whole point of it.
 */
export function useDeskStatus(): DeskStatus | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}
