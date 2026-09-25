/**
 * Cache for everything we buy from Google Maps — and the one file that knows
 * what Google's licence lets us keep.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Every address lookup and every route line is a metered Google call. The same
 * handful of Pakistani destinations get looked up over and over — "F-7 Markaz",
 * "Giga Mall", "Saddar" — and the same pickup→dropoff pair gets routed four
 * times per ride, because the passenger's booking screen, the trip screen, the
 * driver's en-route screen and the request detail screen each ask for it
 * separately. Without a cache we pay for all of it, every time.
 *
 * THE LICENCE IS THE DESIGN
 * We are not free to keep Google's answers. The Google Maps Platform Service
 * Specific Terms say, once per API (Places §5.4, Routes §11.4, Geocoding §3.4):
 *
 *   "Customer can temporarily cache latitude (lat) and longitude (lng) values
 *    ... for up to 30 consecutive calendar days, after which Customer must
 *    delete the cached latitude and longitude values."
 *
 * with exactly one carve-out, from the Places API policies:
 *
 *   "The place ID is exempt from the caching restrictions. You can therefore
 *    store place ID values indefinitely."
 *
 * So coordinates are a rental and place IDs are ours. That is why this file
 * writes to TWO collections instead of one, and why they must never be merged:
 *
 *   mapsCache/{key}     coordinates, addresses, polylines. Carries `expireAt`,
 *                       swept within 30 days. Deleting this is a licence
 *                       obligation, not housekeeping.
 *   mapsPlaceIds/{key}  query → place ID only. No coordinates, ever. Kept
 *                       indefinitely, because we are allowed to.
 *
 * WHY THE SPLIT IS THE WHOLE POINT
 * If both lived in one document, the 30-day delete would take the place ID with
 * it and month two would cost exactly what month one cost. Kept apart, an
 * expired entry still knows *which place* the user meant, so re-resolving it is
 * a Place Details Essentials call ($5/1,000) instead of a Text Search Pro call
 * ($32/1,000). The place ID is the part that compounds: coordinates go stale,
 * identity does not.
 *
 * WHAT THIS IS NOT
 * It is not a private copy of Google's map. We never pre-fetch, never crawl,
 * never store anything a real user did not ask for, and never serve a
 * coordinate older than the licence allows. Building a permanent local
 * basemap out of Google responses would breach the same terms this file is
 * written around ("No Scraping", §3.2.3(a)) — and a revoked key would take
 * address search down on both stores at once. The permanent dataset we are
 * allowed to build is made of our OWN trips, not Google's replies.
 */
import { createHash } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db, Timestamp } from './firebase';

/** Coordinates and polylines — rented from Google, deleted on schedule. */
export const COORD_COLLECTION = 'mapsCache';
/** Query → place ID. Licence-exempt, so this one has no expiry. */
export const PLACE_ID_COLLECTION = 'mapsPlaceIds';

/**
 * How long a cached coordinate may live.
 *
 * The licence says 30 days. This is 29, deliberately: the sweep runs daily, so
 * an entry written just after one pass is only looked at a day later. Leaving a
 * day of headroom means nothing can reach day 31 because a sweep ran late, and
 * the margin costs us one day of cache hits a month.
 */
const COORD_TTL_MS = 29 * 24 * 60 * 60 * 1000;

/**
 * Traffic-aware routes expire in minutes, not weeks.
 *
 * A route bought with live traffic is a statement about right now. Serving a
 * three-week-old one back as an ETA would be worse than not caching it, so
 * these get their own short life. Traffic-free geometry is stable and keeps
 * the full 29 days.
 */
const TRAFFIC_ROUTE_TTL_MS = 10 * 60 * 1000;

/** Warm-instance layer: free, and saves the Firestore read as well. */
const MEMORY_LIMIT = 500;
const memory = new Map<string, { value: unknown; expiresAtMs: number }>();

function memoryGet<T>(key: string): T | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAtMs <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value as T;
}

function memorySet(key: string, value: unknown, expiresAtMs: number): void {
  // Map iterates in insertion order, so the first key is the oldest write.
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, { value, expiresAtMs });
}

/**
 * Collapse the many ways one address gets typed onto a single cache key.
 *
 * "F-7 Markaz, Islamabad", "f7 markaz islamabad" and "F 7  Markaz , Islamabad"
 * are one query as far as Google is concerned, so they must be one key here or
 * we buy the same answer three times. Punctuation goes, case goes, runs of
 * whitespace collapse. Urdu and other non-Latin text is left alone beyond
 * whitespace — stripping marks there would merge genuinely different places.
 */
export function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}\-_/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Firestore-safe deterministic document id. */
function keyOf(kind: string, value: string): string {
  return `${kind}_${createHash('sha256').update(value).digest('hex').slice(0, 40)}`;
}

export interface CachedPlace {
  lat: number;
  lng: number;
  address: string;
  /** Present when Google told us which place this is. Kept past expiry. */
  placeId?: string;
}

export interface CachedRoute {
  polyline: string;
  distanceM: number;
  durationSec: number;
}

/**
 * Every read here answers null on any problem rather than throwing.
 *
 * A cache is an optimisation. If Firestore is slow, unreachable or the document
 * is malformed, the correct outcome is "cache miss, ask Google" — never a failed
 * booking. The same goes for the writes: a cache that could not be filled costs
 * one extra Google call later, and that is all it may ever cost.
 */

/** A cached coordinate for a typed address, or null. */
export async function readPlaceCache(query: string): Promise<CachedPlace | null> {
  const key = keyOf('geo', normalizeQuery(query));
  const warm = memoryGet<CachedPlace>(key);
  if (warm) return warm;

  try {
    const snap = await db.collection(COORD_COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const expireAt = snap.get('expireAt') as Timestamp | undefined;
    // Trust the field, not the sweep: a policy that has not run yet, or a TTL
    // policy nobody created in the console, must not let us serve a stale
    // coordinate past the licence window.
    if (!expireAt || expireAt.toMillis() <= Date.now()) return null;

    const lat = snap.get('lat') as number | undefined;
    const lng = snap.get('lng') as number | undefined;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    const value: CachedPlace = {
      lat,
      lng,
      address: (snap.get('address') as string | undefined) ?? '',
      placeId: snap.get('placeId') as string | undefined,
    };
    memorySet(key, value, expireAt.toMillis());
    return value;
  } catch (e) {
    logger.warn('mapsCache: place read failed, treating as a miss', e);
    return null;
  }
}

/**
 * The place ID we learned for this query on some earlier day, or null.
 *
 * This is the one thing that survives expiry, and the reason a repeat lookup in
 * month two is cheap. Callers turn it back into coordinates with a Place Details
 * Essentials call rather than searching for the text again.
 */
export async function readCachedPlaceId(query: string): Promise<string | null> {
  const key = keyOf('pid', normalizeQuery(query));
  const warm = memoryGet<string>(key);
  if (warm) return warm;

  try {
    const snap = await db.collection(PLACE_ID_COLLECTION).doc(key).get();
    const placeId = snap.get('placeId') as string | undefined;
    if (!placeId) return null;
    // No expiry on the document, so the memory entry just needs a sane refresh
    // horizon rather than a licence one.
    memorySet(key, placeId, Date.now() + COORD_TTL_MS);
    return placeId;
  } catch (e) {
    logger.warn('mapsCache: place id read failed, treating as a miss', e);
    return null;
  }
}

/** Remember a resolved address: coordinates on the clock, place ID forever. */
export async function writePlaceCache(query: string, place: CachedPlace): Promise<void> {
  const normalized = normalizeQuery(query);
  const coordKey = keyOf('geo', normalized);
  const expiresAtMs = Date.now() + COORD_TTL_MS;

  memorySet(coordKey, place, expiresAtMs);

  try {
    await db
      .collection(COORD_COLLECTION)
      .doc(coordKey)
      .set({
        kind: 'place',
        query: normalized,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        ...(place.placeId ? { placeId: place.placeId } : {}),
        cachedAt: Timestamp.now(),
        expireAt: Timestamp.fromMillis(expiresAtMs),
      });

    // Separate document, no expireAt: this is the licence-exempt half.
    if (place.placeId) {
      const pidKey = keyOf('pid', normalized);
      memorySet(pidKey, place.placeId, expiresAtMs);
      await db
        .collection(PLACE_ID_COLLECTION)
        .doc(pidKey)
        .set({ query: normalized, placeId: place.placeId, cachedAt: Timestamp.now() });
    }
  } catch (e) {
    logger.warn('mapsCache: place write failed; the lookup will repeat', e);
  }
}

/** A cached coordinate for a place ID the user tapped, or null. */
export async function readDetailCache(placeId: string): Promise<CachedPlace | null> {
  const key = keyOf('det', placeId);
  const warm = memoryGet<CachedPlace>(key);
  if (warm) return warm;

  try {
    const snap = await db.collection(COORD_COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const expireAt = snap.get('expireAt') as Timestamp | undefined;
    if (!expireAt || expireAt.toMillis() <= Date.now()) return null;

    const lat = snap.get('lat') as number | undefined;
    const lng = snap.get('lng') as number | undefined;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    const value: CachedPlace = {
      lat,
      lng,
      address: (snap.get('address') as string | undefined) ?? '',
      placeId,
    };
    memorySet(key, value, expireAt.toMillis());
    return value;
  } catch (e) {
    logger.warn('mapsCache: detail read failed, treating as a miss', e);
    return null;
  }
}

/** Remember the coordinates behind a place ID, for the licence window. */
export async function writeDetailCache(placeId: string, place: CachedPlace): Promise<void> {
  const key = keyOf('det', placeId);
  const expiresAtMs = Date.now() + COORD_TTL_MS;
  memorySet(key, { ...place, placeId }, expiresAtMs);

  try {
    await db
      .collection(COORD_COLLECTION)
      .doc(key)
      .set({
        kind: 'detail',
        placeId,
        lat: place.lat,
        lng: place.lng,
        address: place.address,
        cachedAt: Timestamp.now(),
        expireAt: Timestamp.fromMillis(expiresAtMs),
      });
  } catch (e) {
    logger.warn('mapsCache: detail write failed; the lookup will repeat', e);
  }
}

/**
 * Cache key for a road between two points.
 *
 * Coordinates are rounded to 4 decimal places — about 11 m — so that two
 * requests for the same corner of the same street share an answer instead of
 * missing on a metre of GPS jitter. Any tighter and the cache never hits; any
 * looser and we would start serving a road that begins on the wrong block.
 *
 * `trafficAware` is part of the key because the two answers are different
 * products with different prices and different lifetimes.
 */
export function routeCacheKey(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  trafficAware: boolean,
): string {
  const r = (n: number) => n.toFixed(4);
  return keyOf(
    'rt',
    `${r(origin.lat)},${r(origin.lng)}|${r(destination.lat)},${r(destination.lng)}|${trafficAware ? 't' : 'p'}`,
  );
}

/** A cached road, or null. */
export async function readRouteCache(key: string): Promise<CachedRoute | null> {
  const warm = memoryGet<CachedRoute>(key);
  if (warm) return warm;

  try {
    const snap = await db.collection(COORD_COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const expireAt = snap.get('expireAt') as Timestamp | undefined;
    if (!expireAt || expireAt.toMillis() <= Date.now()) return null;

    const polyline = snap.get('polyline') as string | undefined;
    if (!polyline) return null;

    const value: CachedRoute = {
      polyline,
      distanceM: (snap.get('distanceM') as number | undefined) ?? 0,
      durationSec: (snap.get('durationSec') as number | undefined) ?? 0,
    };
    memorySet(key, value, expireAt.toMillis());
    return value;
  } catch (e) {
    logger.warn('mapsCache: route read failed, treating as a miss', e);
    return null;
  }
}

/** Remember a road. Traffic-aware answers get minutes; plain geometry gets weeks. */
export async function writeRouteCache(
  key: string,
  route: CachedRoute,
  trafficAware: boolean,
): Promise<void> {
  const expiresAtMs = Date.now() + (trafficAware ? TRAFFIC_ROUTE_TTL_MS : COORD_TTL_MS);
  memorySet(key, route, expiresAtMs);

  try {
    await db
      .collection(COORD_COLLECTION)
      .doc(key)
      .set({
        kind: 'route',
        polyline: route.polyline,
        distanceM: route.distanceM,
        durationSec: route.durationSec,
        trafficAware,
        cachedAt: Timestamp.now(),
        expireAt: Timestamp.fromMillis(expiresAtMs),
      });
  } catch (e) {
    logger.warn('mapsCache: route write failed; the road will be re-bought', e);
  }
}

/** Test seam: drop the warm-instance layer between cases. */
export function __clearMapsMemoryCache(): void {
  memory.clear();
}
