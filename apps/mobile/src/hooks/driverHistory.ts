/**
 * A driver's own ride record.
 * ----------------------------------------------------------------------------
 * The driver app could show a driver what they had EARNED — Earnings reads the
 * wallet ledger — but not what they had DRIVEN. Those are not the same list and
 * cannot be made into each other: a cancelled ride has no transaction, a cash
 * ride and a wallet ride land in different rows, and a wallet transaction knows
 * an amount and a date and nothing about where anybody went. So a driver asking
 * the ordinary questions — which ride was that, where did I take them on
 * Tuesday, how many did I do last week — had nowhere to look.
 *
 * This reads the trips themselves, which the driver is already allowed to read
 * (firestore.rules lets a signed-in driver read any trip whose `driverId` is
 * their own uid), on the (driverId, createdAt) index that already exists.
 *
 * Deliberately in its own file rather than in hooks/driver.ts: that module is
 * about the driver's live state — profile, shift, commission, daily target —
 * and every screen that mounts pays for what it imports.
 */
import { useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../firebase';
import { useCachedList } from '../lib/cachedResource';
import type { Trip } from '../domain/types';

/** A day of driving, as the history screen lists it. */
export interface RideHistoryDay {
  /** `YYYY-MM-DD` in local time — the key the screen groups and labels by. */
  date: string;
  trips: Trip[];
  completed: number;
  cancelled: number;
  /** Fares actually collected that day. Cancelled rides contribute nothing. */
  earned: number;
}

/**
 * Every ride this driver has been assigned, newest first.
 *
 * Seeded from cache for the same reason ride history is on the passenger side:
 * it is long, append-only, and opened to look something up rather than to watch
 * it change, so it should paint instantly and correct itself behind the scenes.
 */
export function useDriverTrips(uid?: string): { trips: Trip[]; loading: boolean } {
  const { rows: trips, loading, publish, settle } = useCachedList<Trip>(uid ? 'driverTrips' : null);

  useEffect(() => {
    if (!uid) {
      settle();
      return;
    }
    // Sorted in code, not with orderBy: the sort is free on a list this size and
    // it keeps the query to a single equality filter, which cannot outgrow its
    // index as the screen grows date pickers and status filters.
    return onSnapshot(
      query(collection(db, 'trips'), where('driverId', '==', uid)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip);
        rows.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        publish(rows);
      },
      settle,
    );
  }, [uid, publish, settle]);

  return { trips, loading };
}

/** Local-time `YYYY-MM-DD` for a trip's clock. */
export function dayKeyOf(trip: Trip): string {
  const seconds = trip.createdAt?.seconds;
  const d = seconds ? new Date(seconds * 1000) : new Date(0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The rides, cut into days.
 *
 * Local time, not UTC: a driver's "yesterday" is their own midnight, and in
 * Pakistan (UTC+5) grouping by UTC would file every ride before 5am under the
 * previous day — exactly the late-night rides a driver is most likely to be
 * checking on.
 */
export function groupByDay(trips: Trip[]): RideHistoryDay[] {
  const byDay = new Map<string, RideHistoryDay>();
  for (const t of trips) {
    const date = dayKeyOf(t);
    const day =
      byDay.get(date) ?? { date, trips: [], completed: 0, cancelled: 0, earned: 0 };
    day.trips.push(t);
    if (t.status === 'completed') {
      day.completed += 1;
      // What the driver kept, where the ride got far enough to have a
      // settlement; the agreed fare otherwise.
      day.earned += t.settlement?.driverPayout ?? t.fare ?? 0;
    } else if (t.status === 'cancelled') {
      day.cancelled += 1;
    }
    byDay.set(date, day);
  }
  // Insertion order follows the already-sorted trips, so the days come out
  // newest-first without a second sort.
  return [...byDay.values()];
}

/** The same grouping, memoised for a screen that re-renders on every filter tap. */
export function useRideHistoryDays(trips: Trip[]): RideHistoryDay[] {
  return useMemo(() => groupByDay(trips), [trips]);
}
