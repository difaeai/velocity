/**
 * Road-following route between two points.
 *
 * The map draws a straight geodesic line from pickup to drop-off unless we can
 * get the real streets, so this asks for the driving route and decodes its
 * polyline into the coordinates the map draws.
 *
 * The Routes API call now happens on the BACKEND (`getDirections`), with
 * GOOGLE_MAPS_SERVER_KEY. Calling it from the device stopped being possible
 * once the Android Maps key was restricted to the app's package name and
 * signing certificate: that restriction is proven by the native SDK attaching
 * those to the request, and a `fetch()` from JS attaches neither, so Google
 * rejected every call. Routing through the backend also means one place owns
 * the Routes API — en-route matching already used the same server helper.
 *
 * The legacy Directions endpoint is gone rather than kept as a fallback:
 * `velocity-fe379` is a post-2025 Cloud project, and Google does not let those
 * enable any legacy Maps API, so it answered REQUEST_DENIED every single time.
 *
 * When the route can't be fetched (offline, rate limited, no server key, no
 * road) this returns null and the caller falls back to the straight line — the
 * map is never left blank.
 */
import { useEffect, useState } from 'react';

import { api } from '../api/client';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * Decode an encoded polyline (Google's algorithm) into lat/lng points.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat * 1e-5, longitude: lng * 1e-5 });
  }

  return points;
}

/**
 * A route with the numbers the driver actually needs on screen. The routing
 * call already returns the leg's duration and distance alongside the polyline —
 * the ETA badges come free with the request we were making anyway.
 */
export interface RouteInfo {
  coords: LatLng[];
  /** Driving time in seconds, per Google's live traffic-aware estimate. */
  durationSec: number;
  /** Route length in metres (road distance, not straight-line). */
  distanceM: number;
  /**
   * The route still encoded, exactly as Google returned it.
   *
   * En-route matching happens on the backend, which has no Maps key of its own —
   * so the driver's app posts this string up and the server decodes it there to
   * work out who is on the way. It re-derives the corridor's endpoints from
   * Firestore and rejects any polyline that does not actually connect them, so
   * handing it over does not let a driver choose their own corridor.
   */
  encoded: string;
}

/** Fetch the driving route between two points with its ETA, or null on failure. */
export async function fetchRouteInfo(origin: MapPoint, dest: MapPoint): Promise<RouteInfo | null> {
  try {
    const res = await api.getDirections({
      origin: { lat: origin.lat, lng: origin.lng },
      destination: { lat: dest.lat, lng: dest.lng },
    });
    const encoded = res.route?.polyline;
    if (!encoded) return null;
    const coords = decodePolyline(encoded);
    if (coords.length < 2) return null;
    return {
      coords,
      durationSec: res.route!.durationSec,
      distanceM: res.route!.distanceM,
      encoded,
    };
  } catch {
    // Offline, rate limited, Maps outage — the caller draws the straight line.
    return null;
  }
}

/** Fetch the driving route polyline between two points, or null on failure. */
export async function fetchRoute(origin: MapPoint, dest: MapPoint): Promise<LatLng[] | null> {
  const info = await fetchRouteInfo(origin, dest);
  return info?.coords ?? null;
}

/**
 * React hook: returns the road-following route coordinates for a pickup →
 * drop-off pair, or null while loading / when Directions is unavailable.
 * Re-fetches only when the endpoints actually change.
 */
export function useRoute(pickup?: MapPoint | null, dropoff?: MapPoint | null): LatLng[] | null {
  return useRouteInfo(pickup, dropoff)?.coords ?? null;
}

/**
 * As `useRoute`, but also gives back the leg's ETA and road distance — what the
 * driver's request screen puts in the badges over the map.
 */
export function useRouteInfo(pickup?: MapPoint | null, dropoff?: MapPoint | null): RouteInfo | null {
  const [route, setRoute] = useState<RouteInfo | null>(null);

  const key =
    pickup && dropoff
      ? `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}`
      : null;

  useEffect(() => {
    if (!pickup || !dropoff) {
      setRoute(null);
      return;
    }
    let alive = true;
    setRoute(null);
    fetchRouteInfo(pickup, dropoff).then((info) => {
      if (alive) setRoute(info);
    });
    return () => {
      alive = false;
    };
    // Endpoints are captured by `key`; re-run only when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return route;
}
