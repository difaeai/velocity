/**
 * Pool ride drop-zone radius rules.
 *
 * Every passenger who joins a pool must be dropped within a fixed radius of
 * the pool's destination — the destination the first person (driver on
 * driver-posted rides, leader on passenger-initiated requests) set when the
 * ride was created. Joiners either pick the same destination, pick a point
 * inside the zone, or ask the driver to drop them inside it.
 *
 * The radius is, in priority order:
 *   1. the per-ride radius the driver set when posting the offer,
 *   2. the admin-configured default (config/poolSettings.dropRadiusM),
 *   3. the hard default below.
 *
 * ON THE SIZE OF THAT DEFAULT
 * ---------------------------
 * It was 1 km, and 1 km is too far to walk at the END of a journey here. A
 * rider will happily walk a few hundred metres to a pickup point they know by
 * name — that is how a wagon stop already works — but asking them to finish a
 * paid ride half a mile from where they were going, in Lahore in June, on roads
 * with no footpath, is the point at which they stop using shared rides. Uber's
 * Express Pool made exactly this trade and it was the first thing to fail.
 *
 * 400 m is roughly a five-minute walk and is about as far as that goodwill
 * stretches. Drivers can still set a wider zone per ride, and admins can move
 * the default, so nothing here is a ceiling — it is the answer when nobody has
 * said otherwise, and it should be the kind one.
 *
 * The driver must also END the ride while still inside the drop zone —
 * completePoolRide rejects completion attempts from outside it (with a small
 * GPS slack) so all passengers are dropped before the car leaves the zone.
 */
import { db } from './firebase';

/**
 * Hard default: joiners are dropped within a short walk of the pool
 * destination. See the note on the size of this above.
 */
export const DEFAULT_POOL_DROP_RADIUS_M = 400;

/** GPS slack added when checking the driver's end-of-ride position. */
export const DRIVER_END_RIDE_SLACK_M = 250;

/** Haversine distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** True when (lat2,lng2) is within radiusM (+slackM) of (lat1,lng1). */
export function withinRadiusM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
  radiusM: number,
  slackM = 0,
): boolean {
  return distanceM(lat1, lng1, lat2, lng2) <= radiusM + slackM;
}

/**
 * The radius that applies to a ride: the driver/leader-set value when present
 * and sane, otherwise the admin default.
 */
export function effectiveDropRadiusM(
  rideRadiusM: number | null | undefined,
  adminDefaultM: number,
): number {
  if (typeof rideRadiusM === 'number' && rideRadiusM >= 50 && rideRadiusM <= 5000) {
    return rideRadiusM;
  }
  return adminDefaultM;
}

/** Coordinates are considered real when they are not the (0,0) placeholder. */
export function hasRealCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && !(lat === 0 && lng === 0);
}

/** Admin-configured default drop radius (config/poolSettings.dropRadiusM). */
export async function getAdminDropRadiusM(): Promise<number> {
  try {
    const snap = await db.doc('config/poolSettings').get();
    const v = snap.get('dropRadiusM') as number | undefined;
    if (typeof v === 'number' && v >= 50 && v <= 5000) return v;
  } catch {
    // fall through to default
  }
  return DEFAULT_POOL_DROP_RADIUS_M;
}
