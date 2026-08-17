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
import { useEffect, useRef } from 'react';

import { api } from '../api/client';
import type { BusinessAdDashboard, NearbyBusinessAd } from '../api/client';
import { useAuth } from '../auth/AuthContext';
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
