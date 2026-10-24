import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import type { CnicVerification } from '../api/client';
import { useCachedList } from '../lib/cachedResource';
import type { Trip } from '../domain/types';

/**
 * Live list of the signed-in passenger's trips, newest first.
 *
 * The security rules allow a passenger to read trips where `passengerId == uid`,
 * so the query is filtered on that field. We sort client-side to avoid needing a
 * composite index (passengerId + createdAt).
 */
export function usePassengerTrips(uid?: string): { trips: Trip[]; loading: boolean } {
  // Ride history is the definition of data worth seeding: it is long, it is
  // append-only, and "Your rides" is a screen people open to look something up
  // rather than to watch it change. It now opens on the list.
  const { rows: trips, loading, publish, settle } = useCachedList<Trip>(uid ? 'passengerTrips' : null);

  useEffect(() => {
    if (!uid) {
      settle();
      return;
    }
    return onSnapshot(
      query(collection(db, 'trips'), where('passengerId', '==', uid)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip & { createdAt?: { seconds: number } });
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        publish(rows);
      },
      settle,
    );
  }, [uid, publish, settle]);

  return { trips, loading };
}

/**
 * Rides this user joined rather than booked — somebody else's pool.
 *
 * Kept apart from usePassengerTrips on purpose. These are not the rider's own
 * trips: they must not turn up in ride history, recent destinations or the daily
 * routes analysis, all of which read `passengerId == uid` and would be wrong if
 * this were folded in. The Messages inbox is the one place that wants them,
 * because a pool rider shares the car — and the conversation — with the driver.
 */
export function usePoolMemberTrips(uid?: string): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      query(collection(db, 'trips'), where('poolMembers', 'array-contains', uid)),
      (snap) => setTrips(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip)),
      () => setTrips([]),
    );
  }, [uid]);

  return trips;
}

export interface RecentDestination {
  address: string;
  /** Coordinates from the original trip — lets rebooking draw the route instantly. */
  lat?: number;
  lng?: number;
}

/**
 * Unique destinations from the passenger's own past trips, newest first.
 *
 * This is real data: it is empty for a brand-new user, so the UI shows an
 * empty state instead of inventing "suggested" places.
 */
export function useRecentDestinations(uid?: string): RecentDestination[] {
  const { trips } = usePassengerTrips(uid);
  return useMemo(() => {
    const seen = new Set<string>();
    const out: RecentDestination[] = [];
    for (const t of trips) {
      const address = t.dropoff?.address?.trim();
      if (address && !seen.has(address.toLowerCase())) {
        seen.add(address.toLowerCase());
        out.push({ address, lat: t.dropoff?.lat, lng: t.dropoff?.lng });
      }
    }
    return out;
  }, [trips]);
}

/**
 * Live CNIC verification status for the signed-in passenger.
 *
 * `undefined` while loading, `null` when they have never submitted. Couriers are
 * gated on `status === 'verified'`; every other flow ignores this. The field is
 * server-written (see backend users/cnic.ts) — the client only reads it.
 */
export function useCnicVerification(uid?: string): CnicVerification | null | undefined {
  const [record, setRecord] = useState<CnicVerification | null | undefined>(undefined);

  useEffect(() => {
    if (!uid) { setRecord(null); return; }
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => setRecord((snap.data()?.cnicVerification as CnicVerification) ?? null),
      () => setRecord(null),
    );
  }, [uid]);

  return record;
}

/**
 * The signed-in rider as the menu shows them, read from `users/{uid}`.
 *
 * Not from Firebase Auth: phone sign-in mints a custom token, so the Auth user
 * has no display name or photo and the drawer used to say "Your account" over a
 * blank mark. The name and picture a rider gave at onboarding live on the
 * profile document (`name`, `photoURL`), with `username` from claimUsername.
 * `null` until the first read lands.
 */
export interface MyProfile {
  name: string | null;
  photoURL: string | null;
  username: string | null;
  phone: string | null;
}

export function useMyProfile(uid?: string): MyProfile | null {
  const [me, setMe] = useState<MyProfile | null>(null);

  useEffect(() => {
    if (!uid) { setMe(null); return; }
    return onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const d = snap.data() ?? {};
        const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        // onUserCreate provisions displayName as 'New User' — a placeholder, not a name.
        const displayName = str(d.displayName);
        setMe({
          name: str(d.name) ?? (displayName === 'New User' ? null : displayName),
          photoURL: str(d.photoURL),
          username: str(d.username),
          phone: str(d.phoneNumber),
        });
      },
      () => setMe(null),
    );
  }, [uid]);

  return me;
}

/** A saved place on a daily route: where it is and what the rider called it. */
export interface RoutePlace {
  lat: number;
  lng: number;
  address: string;
}

/** One of the rider's regular trips, `users/{uid}/dailyRoutes/{id}`. */
export interface DailyRoute {
  id: string;
  label?: string;
  pickup: RoutePlace;
  dropoff: RoutePlace;
  /** "HH:MM", or null for any time — see src/lib/dailyRouteTime.ts. */
  time: string | null;
  radiusKm?: number;
  notify?: boolean;
}

/**
 * The rider's saved daily routes, earliest time first (any-time routes lead,
 * since null sorts first). `null` until the first read lands, so the map pill
 * never flashes "add your route" at someone who already has one.
 */
export function useDailyRoutes(uid?: string): DailyRoute[] | null {
  const [routes, setRoutes] = useState<DailyRoute[] | null>(null);

  useEffect(() => {
    if (!uid) { setRoutes(null); return; }
    return onSnapshot(
      query(collection(db, 'users', uid, 'dailyRoutes'), orderBy('time', 'asc')),
      (snap) => setRoutes(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as DailyRoute)
          // A route needs both ends to mean anything; a half-written doc is skipped, not drawn.
          .filter((r) => r.pickup?.address && r.dropoff?.address),
      ),
      () => setRoutes([]),
    );
  }, [uid]);

  return routes;
}
