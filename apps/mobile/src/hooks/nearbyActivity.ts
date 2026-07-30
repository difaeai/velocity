/**
 * The passenger home map's "is anything happening here?" feed.
 *
 * Polls `getNearbyActivity` while the home screen is mounted and hands back
 * blurred car pins, blurred waiting-rider pins, and the counts behind them.
 *
 * Three things this hook is careful about, because it runs on somebody's home
 * screen on a metered connection:
 *
 *  - One long-lived timer owns the polling, and a GPS update only *pokes* it.
 *    The timer decides on each beat whether a request is actually due, which is
 *    what lets a real move refresh the map within seconds while standing still
 *    still costs one call per interval. Restarting the loop from a
 *    coords-dependent effect instead would tear down the timer on every GPS
 *    tick — including the ones we mean to ignore — and polling would quietly
 *    stop.
 *  - It never surfaces an error. A failed poll leaves the last good picture on
 *    the map; the map is decoration, not a thing worth interrupting anyone over.
 *  - It reports `loaded` separately from the counts, so the caller can tell
 *    "nobody is around" (worth a nudge) apart from "we haven't looked yet"
 *    (worth nothing at all). Getting that backwards would flash a promo at
 *    every user on every cold start.
 */
import { useEffect, useRef, useState } from 'react';

import { api, type ActivityPin } from '../api/client';
import type { Coords } from './location';

export interface NearbyActivityState {
  drivers: ActivityPin[];
  passengers: ActivityPin[];
  /** Totals inside the radius — may exceed the pin arrays, which are capped. */
  driverCount: number;
  /** Everyone with the app nearby, whether or not they want a ride. */
  passengerCount: number;
  /** The subset of them with a ride request open right now. */
  waitingCount: number;
  /** True once a poll has come back successfully at least once. */
  loaded: boolean;
}

const EMPTY: NearbyActivityState = {
  drivers: [],
  passengers: [],
  driverCount: 0,
  passengerCount: 0,
  waitingCount: 0,
  loaded: false,
};

/** Longest we let the picture go stale while the screen is open. */
const POLL_MS = 30_000;

/** How often the loop wakes to ask "is a poll due?". Cheap; no network involved. */
const TICK_MS = 6_000;

/** Movement that justifies an early refetch, in degrees (~400 m). */
const MOVE_THRESHOLD = 0.0036;

export function useNearbyActivity(coords: Coords | null, radiusKm = 6): NearbyActivityState {
  const [state, setState] = useState<NearbyActivityState>(EMPTY);

  // Latest position, read by the loop. A ref rather than a dependency so GPS
  // noise never restarts the timer. Written from an effect, never during render.
  const latest = useRef<Coords | null>(null);

  // Where and when the last request went out from, and whether one is still in
  // flight — a slow response must not let calls stack up behind it.
  const sentFrom = useRef<Coords | null>(null);
  const sentAt = useRef(0);
  const inFlight = useRef(false);

  // Lets the coords effect below nudge the running loop without owning it.
  const poke = useRef<() => void>(() => {});

  // Declared BEFORE the coords effect so that on mount the loop is installed
  // first and the very first GPS fix can poll immediately, instead of waiting
  // out a full tick.
  useEffect(() => {
    let cancelled = false;

    const due = (now: Coords): boolean => {
      const from = sentFrom.current;
      if (!from) return true;
      if (Date.now() - sentAt.current >= POLL_MS) return true;
      return (
        Math.abs(now.lat - from.lat) > MOVE_THRESHOLD ||
        Math.abs(now.lng - from.lng) > MOVE_THRESHOLD
      );
    };

    const tick = () => {
      const now = latest.current;
      if (!now || inFlight.current || !due(now)) return;

      inFlight.current = true;
      sentFrom.current = { lat: now.lat, lng: now.lng };
      sentAt.current = Date.now();

      api
        .getNearbyActivity({ lat: now.lat, lng: now.lng, radiusKm })
        .then((res) => {
          if (cancelled) return;
          setState({
            drivers: res.drivers ?? [],
            passengers: res.passengers ?? [],
            driverCount: res.driverCount ?? 0,
            passengerCount: res.passengerCount ?? 0,
            waitingCount: res.waitingCount ?? 0,
            loaded: true,
          });
        })
        // Silent by design: keep whatever was last on the map.
        .catch(() => {})
        .finally(() => {
          inFlight.current = false;
        });
    };

    poke.current = tick;
    const timer = setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      poke.current = () => {};
    };
  }, [radiusKm]);

  useEffect(() => {
    latest.current = coords;
    // `tick` re-checks whether anything is actually due, so poking it on every
    // fix is safe: a few metres of drift costs a comparison, not a request.
    if (coords) poke.current();
  }, [coords?.lat, coords?.lng]);

  return state;
}
