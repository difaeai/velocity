/**
 * Road-following route between two points.
 *
 * The map used to draw a straight geodesic line from pickup to drop-off, which
 * doesn't reflect the real streets the driver takes. This hook asks the Google
 * Directions API for the driving route and decodes its overview polyline into
 * the list of coordinates the map draws. If Directions is unavailable (offline,
 * API disabled, no route found) it returns null and the caller falls back to
 * the straight line — the map is never left blank.
 */
import { useEffect, useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from '../config';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

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
 * A route with the numbers the driver actually needs on screen. Directions
 * already returns the leg's duration and distance alongside the polyline — the
 * ETA badges come free with the request we were making anyway.
 */
export interface RouteInfo {
  coords: LatLng[];
  /** Driving time in seconds, per Google's live traffic-free estimate. */
  durationSec: number;
  /** Route length in metres (road distance, not straight-line). */
  distanceM: number;
}

/** Fetch the driving route between two points with its ETA, or null on failure. */
export async function fetchRouteInfo(origin: MapPoint, dest: MapPoint): Promise<RouteInfo | null> {
  try {
    const url =
      `${DIRECTIONS_URL}?origin=${origin.lat},${origin.lng}` +
      `&destination=${dest.lat},${dest.lng}` +
      `&mode=driving&region=pk&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const route = data?.routes?.[0];
    const encoded: string | undefined = route?.overview_polyline?.points;
    if (data?.status !== 'OK' || !encoded) return null;
    const coords = decodePolyline(encoded);
    if (coords.length < 2) return null;

    // Sum the legs — there are no waypoints here, so this is normally just one.
    const legs: { duration?: { value?: number }; distance?: { value?: number } }[] = route.legs ?? [];
    return {
      coords,
      durationSec: legs.reduce((s, l) => s + (l.duration?.value ?? 0), 0),
      distanceM: legs.reduce((s, l) => s + (l.distance?.value ?? 0), 0),
    };
  } catch {
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
