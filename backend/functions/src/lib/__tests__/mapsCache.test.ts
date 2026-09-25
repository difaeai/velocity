/**
 * The cache that decides whether we are inside Google's licence.
 *
 * Two behaviours here are legal obligations rather than optimisations, and both
 * are the kind of thing a well-meaning refactor breaks while all the feature
 * tests stay green:
 *
 *   1. Coordinates must not be served, or kept, past the licence window. The
 *      terms say we may cache lat/lng "for up to 30 consecutive calendar days,
 *      after which Customer must delete" them.
 *   2. Place IDs must survive that deletion, because they are expressly exempt
 *      and they are the entire reason a repeat lookup is cheap. Merging the two
 *      collections would satisfy (1) and silently destroy (2).
 *
 * So these tests assert the split itself, not just that caching works.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import {
  COORD_COLLECTION,
  PLACE_ID_COLLECTION,
  __clearMapsMemoryCache,
  normalizeQuery,
  readCachedPlaceId,
  readDetailCache,
  readPlaceCache,
  readRouteCache,
  routeCacheKey,
  sameRoundedPoint,
  writeDetailCache,
  writePlaceCache,
  writeRouteCache,
} from '../mapsCache';

const F7 = { lat: 33.7196, lng: 73.0724, address: 'F-7 Markaz, Islamabad' };

beforeEach(async () => {
  await clearFirestore();
  // The warm-instance layer would otherwise answer from the previous test and
  // hide whatever Firestore actually holds.
  __clearMapsMemoryCache();
});

describe('normalizeQuery', () => {
  it('collapses the many ways one address gets typed onto one key', () => {
    const expected = 'f 7 markaz islamabad';
    expect(normalizeQuery('F-7 Markaz, Islamabad')).toBe(expected);
    expect(normalizeQuery('f7 markaz islamabad')).not.toBe(expected); // genuinely different text
    expect(normalizeQuery('  F 7   Markaz ,  Islamabad  ')).toBe(expected);
    expect(normalizeQuery('F-7 MARKAZ, ISLAMABAD')).toBe(expected);
  });

  it('leaves non-Latin text alone beyond whitespace', () => {
    // Stripping marks here would merge places that are not the same place.
    expect(normalizeQuery('  ایف سیون   مرکز ')).toBe('ایف سیون مرکز');
  });
});

describe('place cache', () => {
  it('round-trips a resolved address', async () => {
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });
    __clearMapsMemoryCache();

    const hit = await readPlaceCache('F-7 Markaz, Islamabad');
    expect(hit).toMatchObject({ lat: F7.lat, lng: F7.lng, address: F7.address, placeId: 'ChIJf7' });
  });

  it('hits on a differently punctuated spelling of the same query', async () => {
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });
    __clearMapsMemoryCache();

    expect(await readPlaceCache('  f 7 markaz   islamabad ')).not.toBeNull();
  });

  it('writes the coordinates and the place ID to SEPARATE collections', async () => {
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });

    const coords = await db().collection(COORD_COLLECTION).get();
    const ids = await db().collection(PLACE_ID_COLLECTION).get();

    expect(coords.size).toBe(1);
    expect(ids.size).toBe(1);
    // The licence-exempt collection must carry no coordinates at all.
    const idDoc = ids.docs[0].data();
    expect(idDoc.placeId).toBe('ChIJf7');
    expect(idDoc.lat).toBeUndefined();
    expect(idDoc.lng).toBeUndefined();
  });

  it('stamps coordinates with an expiry inside the 30-day licence window', async () => {
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });

    const doc = (await db().collection(COORD_COLLECTION).get()).docs[0].data();
    const ttlMs = doc.expireAt.toMillis() - Date.now();
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });

  it('leaves the place ID document with no expiry — it is allowed to be permanent', async () => {
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });

    const doc = (await db().collection(PLACE_ID_COLLECTION).get()).docs[0].data();
    expect(doc.expireAt).toBeUndefined();
  });

  it('refuses to serve a coordinate whose expiry has passed, even if the sweep has not run', async () => {
    // The TTL policy and the sweep are both asynchronous. Neither may be trusted
    // to have happened: the read itself has to enforce the window.
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });
    __clearMapsMemoryCache();

    const ref = (await db().collection(COORD_COLLECTION).get()).docs[0].ref;
    await ref.update({ expireAt: new Date(Date.now() - 1000) });

    expect(await readPlaceCache('F-7 Markaz, Islamabad')).toBeNull();
  });

  it('still knows the place ID after the coordinates have expired', async () => {
    // The whole point. An expired entry is not a total miss: it still knows
    // WHICH place was meant, so re-resolving costs $5/1,000 and not $32/1,000.
    await writePlaceCache('F-7 Markaz, Islamabad', { ...F7, placeId: 'ChIJf7' });
    __clearMapsMemoryCache();

    const ref = (await db().collection(COORD_COLLECTION).get()).docs[0].ref;
    await ref.update({ expireAt: new Date(Date.now() - 1000) });

    expect(await readPlaceCache('F-7 Markaz, Islamabad')).toBeNull();
    expect(await readCachedPlaceId('F-7 Markaz, Islamabad')).toBe('ChIJf7');
  });

  it('survives an address that resolved without a place ID', async () => {
    await writePlaceCache('somewhere odd', { lat: 1, lng: 2, address: 'odd' });
    __clearMapsMemoryCache();

    expect(await readPlaceCache('somewhere odd')).toMatchObject({ lat: 1, lng: 2 });
    expect(await readCachedPlaceId('somewhere odd')).toBeNull();
    expect((await db().collection(PLACE_ID_COLLECTION).get()).size).toBe(0);
  });

  it('misses cleanly on an address it has never seen', async () => {
    expect(await readPlaceCache('nowhere at all')).toBeNull();
    expect(await readCachedPlaceId('nowhere at all')).toBeNull();
  });
});

describe('detail cache', () => {
  it('round-trips a place ID lookup and expires it like any other coordinate', async () => {
    await writeDetailCache('ChIJblue', { lat: 33.6844, lng: 73.0479, address: 'Blue Area' });
    __clearMapsMemoryCache();

    expect(await readDetailCache('ChIJblue')).toMatchObject({ lat: 33.6844, address: 'Blue Area' });

    const ref = (await db().collection(COORD_COLLECTION).get()).docs[0].ref;
    await ref.update({ expireAt: new Date(Date.now() - 1000) });
    __clearMapsMemoryCache();

    expect(await readDetailCache('ChIJblue')).toBeNull();
  });
});

describe('route cache', () => {
  const A = { lat: 33.6938, lng: 72.9989 };
  const B = { lat: 33.7196, lng: 73.0724 };
  const route = { polyline: '_p~iF~ps|U_ulLnnqC', distanceM: 8000, durationSec: 914 };

  it('round-trips a road', async () => {
    const key = routeCacheKey(A, B, false);
    await writeRouteCache(key, route, false);
    __clearMapsMemoryCache();

    expect(await readRouteCache(key)).toEqual(route);
  });

  it('shares an answer between two points a few metres apart', async () => {
    // ~11 m of GPS jitter must not cost another Routes call.
    const jittered = { lat: A.lat + 0.00002, lng: A.lng + 0.00002 };
    expect(routeCacheKey(jittered, B, false)).toBe(routeCacheKey(A, B, false));
  });

  it('does not confuse a traffic-aware road with a plain one', async () => {
    // Different products, different prices, different lifetimes.
    expect(routeCacheKey(A, B, true)).not.toBe(routeCacheKey(A, B, false));
  });

  it('keeps a traffic-aware road for minutes, not weeks', async () => {
    const key = routeCacheKey(A, B, true);
    await writeRouteCache(key, route, true);

    const doc = await db().collection(COORD_COLLECTION).doc(key).get();
    const ttlMs = (doc.get('expireAt') as { toMillis(): number }).toMillis() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('keeps plain geometry for the full licence window', async () => {
    const key = routeCacheKey(A, B, false);
    await writeRouteCache(key, route, false);

    const doc = await db().collection(COORD_COLLECTION).doc(key).get();
    const ttlMs = (doc.get('expireAt') as { toMillis(): number }).toMillis() - Date.now();
    expect(ttlMs).toBeGreaterThan(20 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });

  it('refuses an expired road', async () => {
    const key = routeCacheKey(A, B, false);
    await writeRouteCache(key, route, false);
    __clearMapsMemoryCache();

    await db().collection(COORD_COLLECTION).doc(key).update({ expireAt: new Date(Date.now() - 1000) });
    expect(await readRouteCache(key)).toBeNull();
  });
});

describe('sameRoundedPoint', () => {
  const A = { lat: 33.6938, lng: 72.9989 };

  it('is true for a point against itself', () => {
    expect(sameRoundedPoint(A, A)).toBe(true);
  });

  it('is true within the ~11 m the route key rounds to', () => {
    expect(sameRoundedPoint(A, { lat: A.lat + 0.00002, lng: A.lng + 0.00002 })).toBe(true);
  });

  it('is false once the points are genuinely apart', () => {
    // ~330 m — a real, if short, ride.
    expect(sameRoundedPoint(A, { lat: A.lat + 0.003, lng: A.lng })).toBe(false);
  });

  it('agrees with routeCacheKey, which is the point of it living here', () => {
    const B = { lat: A.lat + 0.00002, lng: A.lng };
    expect(sameRoundedPoint(A, B)).toBe(true);
    expect(routeCacheKey(A, B, false)).toBe(routeCacheKey(A, A, false));
  });
});
