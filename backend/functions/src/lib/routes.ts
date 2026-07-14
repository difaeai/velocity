/**
 * Server-side road routing (Google Routes API).
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * En-route matching asks a geometric question — *is this rider on the driver's
 * road?* — and the answer decides who gets picked up and what everybody pays. Up
 * to now the road itself came from the driver's phone, because the backend had no
 * Maps key. That was made safe (the server re-derives the corridor's endpoints
 * from Firestore and caps every fare at the rider's own solo fare), but it was
 * still the driver's client describing the road the driver gets paid for.
 *
 * With `GOOGLE_MAPS_SERVER_KEY` set, the backend fetches the road itself and the
 * client's polyline is never consulted. That is the difference between "we can
 * prove a doctored route wouldn't help you" and "you don't get to draw the road".
 *
 * WITHOUT THE KEY
 * Everything still works. `serverRoutingConfigured()` is false, the callers fall
 * back to the validated client polyline, and the feature behaves exactly as it
 * did. Setting the key is an upgrade, not a switch that has to be thrown.
 *
 * COST
 * Routes are cached in Firestore against the trip / driver-route document that
 * needs them. A route is fetched ONCE per trip or per declared route — not once
 * per poll — so a driver refreshing their feed every 20 seconds for an hour costs
 * one Routes call, not 180.
 *
 * THE KEY ITSELF
 * Must be a *separate* key from the Android one in the mobile app. That one is
 * restricted to the app's package name and signing certificate (as it must be,
 * since it ships inside the APK), and a Cloud Function has neither — Google would
 * reject it. See .env.example for how to create and lock down the server key.
 */
import { logger } from 'firebase-functions';

import { Corridor, LatLng, buildCorridor, decodePolyline } from './corridor';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Give up rather than hold a callable open — the caller falls back gracefully. */
const TIMEOUT_MS = 6_000;

/** True when a server-side Maps key is configured. */
export function serverRoutingConfigured(): boolean {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

export interface FetchedRoute {
  /** The encoded polyline, exactly as Google returned it. */
  polyline: string;
  corridor: Corridor;
  /** Road distance in metres — the real thing, not the straight line. */
  distanceM: number;
  /** Traffic-aware driving time in seconds. */
  durationSec: number;
}

/**
 * The driving route between two points, from Google, server-side.
 *
 * Returns null on any failure — no key, quota, network, no route between the
 * points. Callers must treat null as "fall back", never as "block the driver":
 * a Maps outage is not a reason nobody can earn.
 */
export async function fetchRouteServerSide(
  origin: LatLng,
  destination: LatLng,
): Promise<FetchedRoute | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ROUTES_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // The field mask is mandatory on this API — asking for everything is a 400.
        'X-Goog-FieldMask':
          'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: {
          location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
        },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        polylineQuality: 'HIGH_QUALITY',
        regionCode: 'PK',
        languageCode: 'en',
      }),
    });

    const data = (await res.json()) as {
      routes?: {
        polyline?: { encodedPolyline?: string };
        distanceMeters?: number;
        duration?: string;
      }[];
      error?: { status?: string; message?: string };
    };

    if (!res.ok) {
      // The two you will actually hit: REQUEST_DENIED (Routes API not enabled on
      // the project) and PERMISSION_DENIED (key restricted so it won't answer a
      // server). Both are console problems, so say which one it was.
      logger.error('Routes API rejected the request', {
        httpStatus: res.status,
        status: data?.error?.status,
        message: data?.error?.message,
      });
      return null;
    }

    const route = data.routes?.[0];
    const polyline = route?.polyline?.encodedPolyline;
    if (!polyline) {
      logger.warn('Routes API returned no route', { origin, destination });
      return null;
    }

    const points = decodePolyline(polyline);
    if (points.length < 2) return null;

    return {
      polyline,
      corridor: buildCorridor(points),
      distanceM: route!.distanceMeters ?? 0,
      // Comes back as a protobuf duration string like "914s".
      durationSec: parseInt(String(route!.duration ?? '0'), 10) || 0,
    };
  } catch (e) {
    // Aborted, offline, DNS, malformed JSON — all the same to the caller.
    logger.warn('Routes API call failed; falling back to the client polyline', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
