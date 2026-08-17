/**
 * Stale-while-revalidate for the read-only callables behind our dashboards.
 *
 * The problem this exists to solve: every data screen in the app used to mount
 * with `data = null, loading = true`, fire a callable, and render skeletons
 * until it came back. On a Pakistani mobile connection, against a Cloud
 * Function that may be cold, that is anywhere from 400ms to several seconds of
 * an empty grey screen — and the user has already SEEN this screen before, so
 * we are making them wait for information we already had.
 *
 * Three layers, cheapest first:
 *
 *   memory  → a Map that lives as long as the JS context. Re-opening a screen
 *             in the same session paints on the FIRST render, synchronously,
 *             with zero frames of skeleton.
 *   disk    → AsyncStorage, so the first open after a cold start paints from
 *             the last known payload instead of from nothing. `hydrate()` pulls
 *             the whole namespace into memory once at launch, which is why the
 *             disk read never costs a screen anything at open time.
 *   network → always. Cached data is shown immediately AND revalidated in the
 *             background; whatever the server says wins.
 *
 * So `loading` is now true only when there is genuinely nothing to show, which
 * is the first open on a fresh install and nothing else.
 *
 * Two safety rules the cache must never break:
 *
 *   • Keys are scoped by uid. Two accounts on one handset can never see each
 *     other's numbers, and signing out purges the namespace outright.
 *   • Entries older than `maxAgeMs` are ignored. A week-old earnings figure
 *     shown as if it were current is worse than a skeleton, so past that age we
 *     go back to waiting for the server.
 *
 * Only for data that is safe to show one revalidation late — dashboards, lists,
 * summaries. Never for money being moved, trip state, or anything a decision is
 * made against in the moment.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { auth } from '../firebase';

const PREFIX = 'velocity_cache_v1:';

/** Beyond this, a cached payload is too old to pass off as current. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Entry {
  value: unknown;
  /** When the server last answered, not when we last wrote to disk. */
  at: number;
}

const memory = new Map<string, Entry>();

/** Keys written since the last flush. Disk writes are batched off the render path. */
const dirty = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scopedKey(uid: string, key: string): string {
  return `${PREFIX}${uid}:${key}`;
}

/**
 * The signed-in uid, straight from the SDK rather than from AuthContext.
 *
 * AuthContext's signOut clears this cache, so importing it here would close a
 * cycle (cache → context → phoneSignIn → cache). The subscription is the same
 * one AuthContext makes, and it is three lines.
 */
function useUid(): string | null {
  return useSyncExternalStore(
    (notify) => onAuthStateChanged(auth, () => notify()),
    () => auth.currentUser?.uid ?? null,
    () => null,
  );
}

/**
 * Pull every cached payload into memory once, at launch.
 *
 * This is the whole reason a screen can paint synchronously on its first render
 * after a cold start: by the time any route module runs, the answer is already
 * in the Map and no `await` sits between mount and pixels. It is one multiGet,
 * it is fire-and-forget, and a failure just means the app behaves the way it
 * did before this file existed.
 */
export async function hydrateResourceCache(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length === 0) return;
    for (const [k, raw] of await AsyncStorage.multiGet(keys)) {
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw, reviver) as Entry;
        if (entry && typeof entry.at === 'number') memory.set(k, entry);
      } catch {
        // A truncated write from a kill mid-flush. Drop it; the network refills it.
      }
    }
  } catch {
    // No cache is a valid state — every screen still fetches.
  }
}

/** Sign-out: nothing personal is left on the handset for the next account. */
export async function clearResourceCache(): Promise<void> {
  memory.clear();
  dirty.clear();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Memory is already clear, which is what protects the next session.
  }
}

/**
 * Firestore `Timestamp`s do not survive JSON.
 *
 * Left alone they come back as a bare `{seconds, nanoseconds}` object, and the
 * first screen to call `.toDate()` on one crashes — a caching layer that turns
 * a slow screen into a broken one is not a trade worth making. So they are
 * tagged on the way out and rebuilt on the way in.
 *
 * The tag is deliberately unlikely to collide with real document data.
 */
const TS_TAG = '__fsTimestamp__';

function replacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Timestamp).toMillis === 'function' &&
    typeof (value as Timestamp).seconds === 'number'
  ) {
    const ts = value as Timestamp;
    return { [TS_TAG]: true, seconds: ts.seconds, nanoseconds: ts.nanoseconds };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && (value as Record<string, unknown>)[TS_TAG]) {
    const { seconds, nanoseconds } = value as { seconds: number; nanoseconds: number };
    return new Timestamp(seconds, nanoseconds);
  }
  return value;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const pairs: [string, string][] = [];
    for (const key of dirty) {
      const entry = memory.get(key);
      if (!entry) continue;
      try {
        pairs.push([key, JSON.stringify(entry, replacer)]);
      } catch {
        // Circular or otherwise unserialisable. It stays in memory for this
        // session and simply does not survive to the next one.
      }
    }
    dirty.clear();
    if (pairs.length) void AsyncStorage.multiSet(pairs).catch(() => {});
  }, 400);
}

function readEntry<T>(key: string, maxAgeMs: number): T | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) return null;
  return entry.value as T;
}

function writeEntry(key: string, value: unknown): void {
  memory.set(key, { value, at: Date.now() });
  dirty.add(key);
  scheduleFlush();
}

/**
 * The same cache, reached imperatively.
 *
 * For screens that cannot hand their whole payload to `useCachedResource` —
 * cursor-paginated feeds being the case that matters, where only the FIRST page
 * is worth seeding and pages two onward must come from the server. Seed the
 * first page from `readCachedValue` so the list paints immediately, then
 * `writeCachedValue` each time page one is re-fetched.
 */
export function readCachedValue<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  const uid = auth.currentUser?.uid;
  return uid ? readEntry<T>(scopedKey(uid, key), maxAgeMs) : null;
}

export function writeCachedValue(key: string, value: unknown): void {
  const uid = auth.currentUser?.uid;
  if (uid) writeEntry(scopedKey(uid, key), value);
}

/**
 * The same idea for a live Firestore list.
 *
 * Firestore's own cache is `memoryLocalCache()` here, and it has to be: the JS
 * SDK's persistent cache is built on IndexedDB, which React Native does not
 * have. So the SDK starts every cold launch with nothing, and an `onSnapshot`
 * screen cannot render a single row until the network answers — which is what
 * makes the notification list, saved places and scheduled rides all open on a
 * spinner.
 *
 * This gives those screens a seed. The last snapshot is on screen immediately
 * and the listener overwrites it as soon as it connects, so the data is live in
 * exactly the way it was before — it just no longer starts from blank.
 *
 * Usage, in the snapshot handler:
 *
 *     const { rows, loading, publish } = useCachedList<Notif>('notifications');
 *     useEffect(() => onSnapshot(q, s => publish(s.docs.map(toNotif))), [q]);
 *
 * `loading` is true only when there is no seed AND no snapshot yet.
 */
export function useCachedList<T>(
  key: string | null,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): { rows: T[]; loading: boolean; publish: (rows: T[]) => void; settle: () => void } {
  const uid = useUid();
  const full = uid && key ? scopedKey(uid, key) : null;

  const [rows, setRows] = useState<T[] | null>(() => (full ? readEntry<T[]>(full, maxAgeMs) : null));
  const [live, setLive] = useState(false);

  // Re-seeding on a key change is done during render, not in an effect: React's
  // documented way to adjust state when an input changes. In an effect it would
  // paint one frame of the PREVIOUS account's rows before correcting itself.
  const [seededFor, setSeededFor] = useState(full);
  if (seededFor !== full) {
    setSeededFor(full);
    setRows(full ? readEntry<T[]>(full, maxAgeMs) : null);
    setLive(false);
  }

  const publish = useCallback(
    (next: T[]) => {
      setRows(next);
      setLive(true);
      if (full) writeEntry(full, next);
    },
    [full],
  );

  // The listener errored. Stop claiming to be loading — but do NOT write an
  // empty list to the cache, or one dropped connection would erase a good seed.
  const settle = useCallback(() => setLive(true), []);

  return { rows: rows ?? [], loading: !live && rows === null, publish, settle };
}

export interface CachedResource<T> {
  /** Last known payload — present on the first render whenever we have one. */
  data: T | null;
  /** True only when there is nothing at all to show yet. */
  loading: boolean;
  /** A revalidation is in flight behind data that is already on screen. */
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * `data` on the first render, if we have ever seen this payload before.
 *
 * @param key       stable name for the payload; scoped per-user internally.
 *                  Pass null to hold off entirely (e.g. an id not resolved yet).
 * @param fetcher   the callable. Re-created every render is fine — it is held in
 *                  a ref, so an inline arrow will not re-trigger the fetch.
 * @param errorText what to say when the fetch fails and we have nothing cached.
 */
export function useCachedResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  errorText = 'Could not load this. Pull down to try again.',
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): CachedResource<T> {
  const uid = useUid();
  const full = uid && key ? scopedKey(uid, key) : null;

  // Seeded from the cache in the initialiser, not in an effect: an effect would
  // cost a frame of skeleton, which is the exact thing this hook exists to kill.
  const [data, setData] = useState<T | null>(() => (full ? readEntry<T>(full, maxAgeMs) : null));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed on a key change during render, for the same reason as useCachedList:
  // an effect would show the previous account's payload for a frame first.
  const [seededFor, setSeededFor] = useState(full);
  if (seededFor !== full) {
    setSeededFor(full);
    setData(full ? readEntry<T>(full, maxAgeMs) : null);
    setError(null);
  }

  // Held in a ref so callers can pass an inline arrow without re-triggering the
  // fetch. Updated in an effect rather than during render — the initialiser
  // already holds the first one, so the first reload never sees a stale fetcher.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Guards a late response from a previous key (or an unmounted screen) writing
  // over the current one — switching accounts is the realistic way that happens.
  const activeKey = useRef(full);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!full) return;
    activeKey.current = full;
    setRefreshing(true);
    // Drop a previous failure so a retry shows the loading state again rather
    // than leaving the error card up with no sign anything is happening.
    setError(null);
    try {
      const fresh = await fetcherRef.current();
      writeEntry(full, fresh);
      if (!mounted.current || activeKey.current !== full) return;
      setData(fresh);
      setError(null);
    } catch (e) {
      if (!mounted.current || activeKey.current !== full) return;
      // A failed refresh behind data that is already on screen is not worth an
      // error state — the user is looking at something true, just not newest.
      // Only a failure with nothing to fall back on is worth saying out loud.
      if (readEntry<T>(full, maxAgeMs) === null) {
        setError(e instanceof Error ? e.message : errorText);
      }
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [full, errorText, maxAgeMs]);

  // Revalidate whenever the key changes. The seeding is already done above, so
  // this effect only talks to the network.
  useEffect(() => {
    if (!full) return;
    void reload();
  }, [full, reload]);

  return { data, loading: data === null && error === null, refreshing, error, reload };
}
