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
 * Two things keep this cheap, and both are easy to undo by accident.
 *
 * FIRST, THE TIER. `TRAFFIC_AWARE` and `TRAFFIC_AWARE_OPTIMAL` are what Google
 * calls advanced features, and asking for either moves the whole request from
 * Compute Routes Essentials ($5 per 1,000, 10,000 free a month) to Compute
 * Routes **Pro** ($10 per 1,000, only 5,000 free). Double the price and half the
 * allowance. This used to pass `TRAFFIC_AWARE` unconditionally, which meant every
 * route line drawn on a map and every corridor match was billed at the Pro rate
 * for a traffic estimate nothing read. Traffic is now opt-in per call, and the
 * default is off. Before switching it on somewhere, check that a human actually
 * reads the duration: fares are computed from distance, and the corridor match
 * is pure geometry, so for both of those traffic is a number nobody looks at.
 *
 * SECOND, CACHING, at two levels. Callers cache the road they need on the trip
 * or driver-route document that needs it, so a driver refreshing their feed every
 * 20 seconds for an hour costs one Routes call and not 180. Underneath that,
 * lib/mapsCache.ts shares roads *across* documents and screens — the same
 * pickup→dropoff pair is drawn by the passenger's booking screen, the trip
 * screen, the driver's en-route screen and the request detail screen, and only
 * the first of them pays. Traffic-aware answers are cached for minutes rather
 * than weeks, because a stale ETA is worse than no cache at all.
 *
 * THE KEY ITSELF
 * Must be a *separate* key from the Android one in the mobile app. That one is
 * restricted to the app's package name and signing certificate (as it must be,
 * since it ships inside the APK), and a Cloud Function has neither — Google would
 * reject it. See .env.example for how to create and lock down the server key.
 */
import { logger } from 'firebase-functions';

import { Corridor, LatLng, buildCorridor, decodePolyline } from './corridor';
import { readRouteCache, routeCacheKey, sameRoundedPoint, writeRouteCache } from './mapsCache';

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
  /**
   * Driving time in seconds.
   *
   * Free-flow by default. It only accounts for live traffic when the caller
   * asked for `trafficAware`, which costs twice as much — so treat this as an
   * estimate unless you know the call opted in.
   */
  durationSec: number;
}

export interface RouteOptions {
  /**
   * Ask Google to account for live traffic.
   *
   * Moves the call to the Compute Routes Pro SKU: double the price, half the
   * free allowance, and a cached answer that is only good for minutes. Worth it
   * where a person reads the ETA and would be misled by a free-flow number;
   * never worth it for geometry, corridor matching, or a fare (those are
   * distance-based and do not read this field at all).
   */
  trafficAware?: boolean;
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
  opts: RouteOptions = {},
): Promise<FetchedRoute | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const trafficAware = opts.trafficAware === true;

  // Two points the cache would treat as the same place have no road between them
  // worth buying. This happens more than it sounds: a destination that geocodes
  // onto the rider's own position, a pool whose pickup and drop-off are one spot,
  // a screen that mounts with the same coordinate in both props while the real
  // destination is still resolving. Every one of those was a paid Routes call that
  // could only ever come back empty or as a 400. Callers already treat null as
  // "draw the straight line", which between two identical points is correct.
  if (sameRoundedPoint(origin, destination)) return null;

  // Shared across trips, drivers and screens — see the COST note above. Rebuild
  // the corridor from the cached polyline rather than storing it: it is derived
  // data, and keeping one copy means the two can never disagree.
  const cacheKey = routeCacheKey(origin, destination, trafficAware);
  const cached = await readRouteCache(cacheKey);
  if (cached) {
    const points = decodePolyline(cached.polyline);
    if (points.length >= 2) {
      return {
        polyline: cached.polyline,
        corridor: buildCorridor(points),
        distanceM: cached.distanceM,
        durationSec: cached.durationSec,
      };
    }
  }

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
        // The one field that decides Essentials vs Pro. See RouteOptions.
        routingPreference: trafficAware ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
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

    const distanceM = route!.distanceMeters ?? 0;
    // Comes back as a protobuf duration string like "914s".
    const durationSec = parseInt(String(route!.duration ?? '0'), 10) || 0;

    // Best-effort: a road we could not cache costs one extra call later, which is
    // never a reason to fail the request we already have an answer for.
    await writeRouteCache(cacheKey, { polyline, distanceM, durationSec }, trafficAware);

    return {
      polyline,
      corridor: buildCorridor(points),
      distanceM,
      durationSec,
    };
  } catch (e) {
    // Aborted, offline, DNS, malformed JSON — all the same to the caller.
    logger.warn('Routes API call failed; falling back to the client polyline', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
