/**
 * Daily routes + pool-match alerts.
 *
 * A rider saves the commutes they take regularly — each a pickup area, a
 * drop-off area, a time of day and a match radius. Whenever anyone opens a
 * PUBLIC pool that (a) starts within the radius of a saved pickup, (b) ends
 * within the radius of that route's drop-off, and (c) is opened near the saved
 * time, we push the rider a "join this pool" alert. They tap it, land on the
 * pool-join screen, and joining is always their own choice — we never auto-book
 * anyone into someone else's ride.
 *
 * Routes are owner-managed documents (the app writes them directly, guarded by
 * Firestore rules — see firestore.rules), one per commute:
 *   users/{uid}/dailyRoutes/{routeId} = {
 *     label?, pickup{lat,lng,address}, dropoff{lat,lng,address},
 *     radiusKm, time "HH:MM", notify, createdAt, updatedAt
 *   }
 *
 * The match runs server-side (admin SDK) via a collection-group scan, so it
 * sees every rider's routes without any per-collection rule exception.
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { notifyUser } from '../lib/fcm';

interface GeoPoint { lat: number; lng: number; address: string; }
interface DailyRouteDoc {
  pickup?: GeoPoint;
  dropoff?: GeoPoint;
  radiusKm?: number;
  time?: string;   // "HH:MM"
  notify?: boolean;
}

const DEFAULT_RADIUS_KM = 3;
// A pool counts as being "on" a route when it opens within this many minutes of
// the route's saved time, on either side.
const TIME_WINDOW_MIN = 60;

// Great-circle distance in km. Kept local so this module has no import edge to
// trips/index (which imports back for the alert hook, which would be a cycle).
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Minutes since midnight in Asia/Karachi (PKT = UTC+5, no DST). */
function karachiMinutes(date = new Date()): number {
  const pkt = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
}

/** Shortest gap between two minutes-of-day, wrapping around midnight. */
export function minuteGap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 1440 - raw);
}

/**
 * True when a route matches a pool on all three axes: pickup, drop-off and
 * time. Pure, so the matching rules are unit-testable without Firestore.
 */
export function routeMatchesPool(
  route: DailyRouteDoc,
  pool: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number }; nowMinutes: number },
): boolean {
  if (route.notify === false) return false;
  if (!route.pickup || !route.dropoff) return false;
  const radius = route.radiusKm ?? DEFAULT_RADIUS_KM;
  if (haversineKm(pool.pickup.lat, pool.pickup.lng, route.pickup.lat, route.pickup.lng) > radius) return false;
  if (haversineKm(pool.dropoff.lat, pool.dropoff.lng, route.dropoff.lat, route.dropoff.lng) > radius) return false;
  // A route without a time matches at any hour; with one, only near it.
  if (typeof route.time === 'string' && /^\d{1,2}:\d{2}$/.test(route.time)) {
    const [h, m] = route.time.split(':').map((x) => parseInt(x, 10));
    if (minuteGap(pool.nowMinutes, h * 60 + m) > TIME_WINDOW_MIN) return false;
  }
  return true;
}

/**
 * Called (best-effort) when a public pool is opened. Alerts every rider with a
 * saved route matching this pool on pickup, drop-off and time. Never throws — a
 * failure here must not affect the trip that triggered it.
 */
export async function notifyDailyRouteMatches(opts: {
  tripId: string;
  hostUid: string;
  shareCode: string | null;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  rideType: string;
}): Promise<void> {
  const { tripId, hostUid, shareCode, pickup, dropoff, rideType } = opts;
  const nowMinutes = karachiMinutes();

  const snap = await db.collectionGroup('dailyRoutes').get();
  if (snap.empty) return;

  const matched = new Set<string>();
  for (const doc of snap.docs) {
    const uid = doc.ref.parent.parent?.id; // users/{uid}/dailyRoutes/{routeId}
    if (!uid || uid === hostUid || matched.has(uid)) continue; // one alert per rider
    if (routeMatchesPool(doc.data() as DailyRouteDoc, { pickup, dropoff, nowMinutes })) {
      matched.add(uid);
    }
  }

  if (matched.size === 0) {
    logger.info('No daily-route matches for pool', { tripId });
    return;
  }

  const title = '🚕 A pool on your daily route';
  const body =
    `Someone just opened a ${rideType} pool going your way — tap to join and split the fare.`;
  const data: Record<string, string> = { tripId, screen: 'pool-join' };
  if (shareCode) data.code = shareCode;

  await Promise.all([...matched].map((uid) => notifyUser(uid, title, body, 'ride', data)));
  logger.info('Daily-route pool alerts sent', { tripId, riders: matched.size });
}
