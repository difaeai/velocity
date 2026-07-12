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

/** Fetch the driving route polyline between two points, or null on failure. */
export async function fetchRoute(origin: MapPoint, dest: MapPoint): Promise<LatLng[] | null> {
  try {
    const url =
      `${DIRECTIONS_URL}?origin=${origin.lat},${origin.lng}` +
      `&destination=${dest.lat},${dest.lng}` +
      `&mode=driving&region=pk&key=${GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const encoded: string | undefined = data?.routes?.[0]?.overview_polyline?.points;
    if (data?.status !== 'OK' || !encoded) return null;
    const pts = decodePolyline(encoded);
    return pts.length > 1 ? pts : null;
  } catch {
    return null;
  }
}

/**
 * React hook: returns the road-following route coordinates for a pickup →
 * drop-off pair, or null while loading / when Directions is unavailable.
 * Re-fetches only when the endpoints actually change.
 */
export function useRoute(pickup?: MapPoint | null, dropoff?: MapPoint | null): LatLng[] | null {
  const [route, setRoute] = useState<LatLng[] | null>(null);

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
    fetchRoute(pickup, dropoff).then((pts) => {
      if (alive) setRoute(pts);
    });
    return () => {
      alive = false;
    };
    // Endpoints are captured by `key`; re-run only when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return route;
}
