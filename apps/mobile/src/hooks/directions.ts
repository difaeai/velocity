/**
 * Road-following route between two points.
 *
 * The map draws a straight geodesic line from pickup to drop-off unless we can
 * get the real streets, so this hook asks Google for the driving route and
 * decodes its polyline into the coordinates the map draws.
 *
 * We call the **Routes API** (routes.googleapis.com/directions/v2:computeRoutes),
 * not the legacy Directions API. `velocity-fe379` is a post-2025 Cloud project,
 * and Google no longer lets those projects enable any legacy Maps API — the old
 * endpoint answers every request with REQUEST_DENIED ("You're calling a legacy
 * API"), which is why the line used to stay straight. The legacy call is kept
 * only as a fallback for the (unlikely) case that a future project has
 * Directions enabled but not Routes.
 *
 * The Routes API must be enabled on the project AND allowed on the API key's
 * API restriction list, otherwise it answers API_KEY_SERVICE_BLOCKED. When the
 * route can't be fetched (offline, blocked key, no route) this returns null and
 * the caller falls back to the straight line — the map is never left blank.
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

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const LEGACY_DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

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

/** Routes API v2. `duration` comes back as a protobuf string like "914s". */
async function fetchViaRoutesApi(origin: MapPoint, dest: MapPoint): Promise<RouteInfo | null> {
  const res = await fetch(ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      // Field mask is mandatory — asking for everything is rejected on this API.
      'X-Goog-FieldMask':
        'routes.polyline.encodedPolyline,routes.duration,routes.distanceMeters',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      polylineQuality: 'HIGH_QUALITY',
      regionCode: 'PK',
      languageCode: 'en',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[Routes API]', data?.error?.status ?? res.status, data?.error?.message ?? '');
    return null;
  }

  const route = data?.routes?.[0];
  const encoded: string | undefined = route?.polyline?.encodedPolyline;
  if (!encoded) return null;
  const coords = decodePolyline(encoded);
  if (coords.length < 2) return null;

  return {
    coords,
    durationSec: parseInt(String(route.duration ?? '0'), 10) || 0,
    distanceM: route.distanceMeters ?? 0,
    encoded,
  };
}

/** Legacy Directions API — only reachable on projects that still have it enabled. */
async function fetchViaLegacyDirections(origin: MapPoint, dest: MapPoint): Promise<RouteInfo | null> {
  const url =
    `${LEGACY_DIRECTIONS_URL}?origin=${origin.lat},${origin.lng}` +
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
    encoded,
  };
}

/** Fetch the driving route between two points with its ETA, or null on failure. */
export async function fetchRouteInfo(origin: MapPoint, dest: MapPoint): Promise<RouteInfo | null> {
  try {
    const routed = await fetchViaRoutesApi(origin, dest);
    if (routed) return routed;
  } catch {
    /* fall through to the legacy endpoint */
  }
  try {
    return await fetchViaLegacyDirections(origin, dest);
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
