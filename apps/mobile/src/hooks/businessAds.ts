/**
 * "Find your Customers" — client state.
 *
 * `useBusinessAdDashboard` is what every advertise screen asks: does this user
 * have a plan, is it in the queue, is it running, has it lapsed. One callable
 * returns the whole picture including the ads and their numbers.
 *
 * `useNearbyBusinessAdCheck` is the other half of the feature — the receiving
 * side. It asks the server whether the rider's current position has earned an
 * offer notification. Two things throttle it, because neither the battery nor
 * the user's patience is free:
 *
 *   • distance — a fix that moved less than MIN_MOVE_M since the last check is
 *     the same place, and asking again would just be a wasted round trip;
 *   • time — but a person sitting still inside a radius must still hear from the
 *     advertiser once per server-side window (12 hours by default), so a check
 *     also fires when MIN_INTERVAL_MS has passed without moving at all.
 *
 * The server owns the actual notification decision. This hook only decides when
 * it is worth asking, and it never notifies anything itself.
 */
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import type {
  BusinessAdDashboard,
  BusinessAdQueryMessage,
  BusinessAdQueryThread,
  NearbyBusinessAd,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase';
import { useCachedResource } from '../lib/cachedResource';
import type { Coords } from './location';

/** Below this, the rider hasn't meaningfully moved. */
const MIN_MOVE_M = 250;
/** A stationary rider still gets re-checked this often. */
const MIN_INTERVAL_MS = 20 * 60 * 1000;

function metresBetween(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Fires the nearby-offer check as the rider moves. Returns nothing to render —
 * the payload arrives as a push, and the in-app list is a separate concern.
 *
 * Pass the coords from `useCurrentLocation`; a null coords is a no-op, so this
 * is safe to mount before permission has been granted.
 */
export function useNearbyBusinessAdCheck(coords: Coords | null): void {
  const { user } = useAuth();
  const lastAt = useRef(0);
  const lastPos = useRef<Coords | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!user || !coords) return;

    const now = Date.now();
    const moved = lastPos.current ? metresBetween(lastPos.current, coords) : Infinity;
    const stale = now - lastAt.current >= MIN_INTERVAL_MS;
    if (!stale && moved < MIN_MOVE_M) return;
    if (inFlight.current) return;

    inFlight.current = true;
    lastAt.current = now;
    lastPos.current = coords;

    api
      .checkNearbyBusinessAds({ lat: coords.lat, lng: coords.lng })
      .catch(() => {
        // Rate-limited, offline, or no ads nearby. Nothing to tell the rider:
        // this runs invisibly, and a failed advertising check is not their problem.
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [user, coords]);
}

/** One-shot fetch of offers currently in range, for a quiet in-app list. */
export async function fetchNearbyOffers(coords: Coords): Promise<NearbyBusinessAd[]> {
  try {
    const res = await api.checkNearbyBusinessAds({ lat: coords.lat, lng: coords.lng });
    return res.ads ?? [];
  } catch {
    return [];
  }
}

/**
 * The advertiser's own view: plan, offers, and the numbers behind them.
 *
 * Cached, because this screen is opened repeatedly by someone checking whether
 * their 5,500 rupees bought anything, and every one of those opens used to be a
 * cold wait on a callable in front of a grey screen. Last session's numbers are
 * on screen instantly and the fresh ones replace them a moment later.
 */
export function useBusinessAdDashboard() {
  return useCachedResource<BusinessAdDashboard>(
    'businessAdDashboard',
    () => api.getBusinessAdDashboard({}),
    'Could not load your advertising dashboard.',
  );
}

// ── Queries: questions people send about an offer ────────────────────────────

const msOf = (t: unknown): number | null =>
  t && typeof (t as Timestamp).toMillis === 'function' ? (t as Timestamp).toMillis() : null;

function toThread(id: string, d: Record<string, unknown>): BusinessAdQueryThread {
  return {
    queryId: id,
    adId: (d.adId as string) ?? '',
    ownerUid: (d.ownerUid as string) ?? '',
    askerUid: (d.askerUid as string) ?? '',
    askerName: (d.askerName as string) ?? 'Customer',
    adTitle: (d.adTitle as string) ?? '',
    businessName: (d.businessName as string) ?? '',
    adImageUrl: (d.adImageUrl as string | null) ?? null,
    lastMessage: (d.lastMessage as string) ?? '',
    lastFrom: d.lastFrom === 'business' ? 'business' : 'customer',
    // A message the server has not stamped yet is, by definition, just now.
    lastMessageAtMs: msOf(d.lastMessageAt) ?? Date.now(),
    status: d.status === 'answered' ? 'answered' : 'waiting',
    ownerUnread: (d.ownerUnread as number) ?? 0,
    askerUnread: (d.askerUnread as number) ?? 0,
    messageCount: (d.messageCount as number) ?? 0,
    blockedByBusiness: d.blockedByBusiness === true,
    blockedByCustomer: d.blockedByCustomer === true,
    blockedByAdmin: d.blockedByAdmin === true,
  };
}

/**
 * Every conversation people have opened with this business, newest first.
 *
 * Live rather than cached: a question is only useful to a shopkeeper while the
 * customer is still standing nearby deciding, so it has to appear the moment it
 * is sent. The rules only allow this query because it is constrained by ownerUid.
 */
export function useBusinessAdQueries(enabled = true) {
  return useQueryInbox('ownerUid', enabled);
}

/**
 * The customer's side: every offer they have asked a business about. Without
 * this the only ways back into a conversation were the reply notification or
 * the offer itself — and a deleted offer took the second one away.
 */
export function useMyBusinessAdQuestions() {
  return useQueryInbox('askerUid', true);
}

function useQueryInbox(side: 'ownerUid' | 'askerUid', enabled: boolean) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<BusinessAdQueryThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const active = !!user && enabled;

  useEffect(() => {
    if (!user || !enabled) return;
    const q = query(
      collection(db, 'businessAdQueries'),
      where(side, '==', user.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(50),
    );
    return onSnapshot(
      q,
      (snap) => {
        setThreads(snap.docs.map((d) => toThread(d.id, d.data())));
        setLoading(false);
        setError(false);
      },
      () => {
        setLoading(false);
        setError(true);
      },
    );
  }, [user, enabled, side]);

  const unread = threads.reduce(
    (n, t) => n + ((side === 'ownerUid' ? t.ownerUnread : t.askerUnread) > 0 ? 1 : 0),
    0,
  );
  // Nothing to listen to (signed out, or no plan) is not "still loading".
  return { threads, unread, loading: active && loading, error };
}

/**
 * One conversation, live, for either side of it. `thread` stays null until the
 * first message is sent — a customer opening "Ask about this offer" is looking
 * at a conversation that does not exist yet, and that is not an error.
 */
export function useBusinessAdThread(queryId: string | undefined) {
  const [thread, setThread] = useState<BusinessAdQueryThread | null>(null);
  const [messages, setMessages] = useState<BusinessAdQueryMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!queryId) return;
    const ref = doc(db, 'businessAdQueries', queryId);
    const unsubThread = onSnapshot(
      ref,
      (snap) => {
        setThread(snap.exists() ? toThread(snap.id, snap.data()) : null);
        setLoading(false);
      },
      // Rules refuse a read of a thread that does not exist yet, because there is
      // no ownerUid/askerUid to check. That is the empty conversation, not a fault.
      () => {
        setThread(null);
        setLoading(false);
      },
    );
    const unsubMsgs = onSnapshot(
      query(collection(ref, 'messages'), orderBy('createdAt', 'asc'), limit(200)),
      (snap) =>
        setMessages(
          snap.docs.map((d) => ({
            id: d.id,
            from: d.get('from') === 'business' ? 'business' : 'customer',
            text: (d.get('text') as string) ?? '',
            createdAtMs: msOf(d.get('createdAt')) ?? Date.now(),
          })),
        ),
      () => setMessages([]),
    );
    return () => {
      unsubThread();
      unsubMsgs();
    };
  }, [queryId]);

  return { thread, messages, loading };
}
