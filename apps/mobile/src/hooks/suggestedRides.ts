/**
 * "Is anyone already driving my way right now?" — for the home screen.
 *
 * Backs the Suggested Rides entry point: it needs a live count so the row can
 * say "4 shared rides near you" rather than sending people into an empty list
 * to find out. The list itself lives on /passenger/suggested-rides and fetches
 * its own, fuller payload; this only carries what a one-line summary needs.
 *
 * Deliberately quiet about failure. A home screen must never show an error
 * because a discovery poll timed out — the row simply reports nothing and the
 * next beat tries again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { useForegroundInterval } from './useForegroundInterval';
import type { Coords } from './location';

/** How often the count is refreshed while home is open. */
const POLL_MS = 60_000;

/** Metres the rider must move before a GPS tick is worth a fresh lookup. */
const MOVE_THRESHOLD_M = 400;

/** The radius the home row summarises. The full screen lets the rider change it. */
export const HOME_SUGGESTED_RADIUS_KM = 5;

export interface SuggestedRidesSummary {
  /** Shared cars near the rider with a seat free. */
  count: number;
  /** How many of those already have a driver confirmed. */
  withDriver: number;
  /** The nearest one's destination, so the row can name a real place. */
  nearestDestination: string | null;
  /** The cheapest seat on offer, for "from PKR 180". */
  cheapestFare: number | null;
  /** False until the first poll lands, so the row can stay hidden until then. */
  loaded: boolean;
}

const EMPTY: SuggestedRidesSummary = {
  count: 0,
  withDriver: 0,
  nearestDestination: null,
  cheapestFare: null,
  loaded: false,
};

function metresBetween(a: Coords, b: Coords): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function useSuggestedRides(coords: Coords | null): SuggestedRidesSummary {
  const [state, setState] = useState<SuggestedRidesSummary>(EMPTY);
  const lastFetchedAt = useRef(0);
  const lastPosition = useRef<Coords | null>(null);
  const coordsRef = useRef<Coords | null>(coords);
  coordsRef.current = coords;

  /**
   * Only the most recent poll may publish.
   *
   * Every call takes a ticket and drops its result if a newer call has since
   * taken one. That replaces the old per-effect `alive` flag and is slightly
   * stricter than it was: a slow response is now discarded whenever it has been
   * superseded, not only when the rider's position changed underneath it.
   */
  const seq = useRef(0);

  const poll = useCallback(async (force: boolean) => {
    const here = coordsRef.current;
    if (!here) return;
    const moved = lastPosition.current
      ? metresBetween(lastPosition.current, here) >= MOVE_THRESHOLD_M
      : true;
    const due = Date.now() - lastFetchedAt.current >= POLL_MS;
    if (!force && !moved && !due) return;

    // Taken here rather than on entry: a tick that decides it is not due must not
    // invalidate a request that is already in flight and about to publish.
    const ticket = ++seq.current;
    lastFetchedAt.current = Date.now();
    lastPosition.current = here;
    try {
      const { rides } = await api.getSuggestedRides({
        lat: here.lat,
        lng: here.lng,
        radiusKm: HOME_SUGGESTED_RADIUS_KM,
      });
      if (ticket !== seq.current) return;
      // Rows arrive nearest-first, so the first one is the nearest.
      setState({
        count: rides.length,
        withDriver: rides.filter((r) => r.hasDriver).length,
        nearestDestination: rides[0]?.destinationAreaName ?? null,
        cheapestFare: rides.length
          ? rides.reduce((min, r) => Math.min(min, r.farePerSeat), rides[0]!.farePerSeat)
          : null,
        loaded: true,
      });
    } catch {
      // Keep the last good summary; only mark that we have looked, so the row
      // stops showing a spinner it will never resolve.
      if (ticket === seq.current) setState((s) => ({ ...s, loaded: true }));
    }
  }, []);

  // A fresh position is worth an immediate look, regardless of the timer.
  useEffect(() => {
    void poll(true);
  }, [coords?.lat, coords?.lng, poll]);

  // Kept fresh only while the user is actually looking. A backgrounded app
  // polling this summary row helps nobody — see hooks/useForegroundInterval.
  useForegroundInterval(coords ? () => void poll(false) : null, 15_000);

  return state;
}
