/**
 * Velocity's own map, end to end, on the emulator.
 *
 * The pieces each have unit tests (locations/__tests__/registry.test.ts,
 * lib/__tests__/places.test.ts, lib/__tests__/mapsCache.test.ts). What nothing
 * covered was the chain a rider actually goes through, and that chain is the only
 * thing that saves money:
 *
 *   completed trips → promoteTripLocations → a verified place
 *     → placesAutocomplete suggests it → placeDetails / geocodeAddress resolve it
 *
 * with Google's meter watched the whole way. Every Google request goes through a
 * stubbed `fetch`, so each case can assert exactly how many paid calls it made.
 *
 * It also pins the list-key fix: our suggestions used to carry `placeId: ''`, so two
 * of them in one list shared a React key, and builds before 1.11.0 (which send only
 * `placeId` on a tap) got an error and no pin.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { ScheduledEvent } from 'firebase-functions/v2/scheduler';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { Timestamp } from '../../lib/firebase';
import { __clearMapsMemoryCache } from '../../lib/mapsCache';
import { LOCATIONS_COLLECTION, VERIFY_AFTER_CONFIRMATIONS } from '../../locations/registry';
import { promoteTripLocations } from '../../locations/promote';
import { OWN_PLACE_ID_PREFIX, geocodeAddress, placeDetails, placesAutocomplete } from '../index';

const UID = 'own-map-rider';
const TOKEN = 'session-1';

/** Giga Mall's gate, where our drivers stop, and a place nobody has driven to yet. */
const GIGA = { lat: 33.5213, lng: 73.1569 };
const GOOGLE_GIGA = { lat: 33.5231, lng: 73.1601 };

// ── Google, stubbed and counted ──────────────────────────────────────────────
const realFetch = globalThis.fetch;
const google: { url: string }[] = [];

function googleFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = String(input);
  // The emulator itself is reached over fetch too (clearFirestore) — let it through.
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  google.push({ url });
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  if (url.includes('places:autocomplete')) {
    return json({
      suggestions: [
        { placePrediction: { placeId: 'g-giga', text: { text: 'Giga Mall, Islamabad' }, structuredFormat: { mainText: { text: 'Giga Mall' }, secondaryText: { text: 'Islamabad' } } } },
        { placePrediction: { placeId: 'g-gulberg', text: { text: 'Gulberg Greens, Islamabad' }, structuredFormat: { mainText: { text: 'Gulberg Greens' }, secondaryText: { text: 'Islamabad' } } } },
      ],
    });
  }
  if (url.includes('/geocode/json')) {
    return json({ status: 'OK', results: [{ formatted_address: 'Centaurus Mall, Islamabad', place_id: 'g-centaurus', geometry: { location: { lat: 33.7077, lng: 73.0498 } } }] });
  }
  if (url.includes('places.googleapis.com/v1/places/')) {
    return json({ location: { latitude: 33.7077, longitude: 73.0498 }, formattedAddress: 'Centaurus Mall, Islamabad' });
  }
  return json({});
}

const call = <T>(fn: { run: (r: CallableRequest<T>) => unknown }, data: T) => fn.run(makeReq(data, UID)) as Promise<any>;

/** A completed trip the promoter can learn from: rider GPS at pickup, driver GPS at drop-off. */
async function completedTrip(id: string, dropName: string, fix: { lat: number; lng: number }, minutesAgo: number) {
  const at = Timestamp.fromMillis(Date.now() - minutesAgo * 60_000);
  await db().doc(`trips/${id}`).set({
    status: 'completed',
    completedAt: at,
    pickup: { lat: 33.6938 + minutesAgo / 1e4, lng: 73.0652, address: 'F-6 Markaz, Islamabad' },
    // The geocoder's answer — the promoter must NOT use this coordinate.
    dropoff: { lat: GOOGLE_GIGA.lat, lng: GOOGLE_GIGA.lng, address: dropName },
    driverLocation: fix,
    driverLocationAt: Timestamp.fromMillis(at.toMillis() - 20_000),
  });
}

async function promote() {
  await promoteTripLocations.run({} as ScheduledEvent);
}

beforeEach(async () => {
  await clearFirestore();
  __clearMapsMemoryCache();
  google.length = 0;
  process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
  vi.stubGlobal('fetch', vi.fn(googleFetch));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('completed trips become our own map', () => {
  it('learns the drop-off from the driver GPS, never the geocoder, and verifies after three trips', async () => {
    for (let i = 0; i < VERIFY_AFTER_CONFIRMATIONS; i++) {
      await completedTrip(`t${i}`, 'Giga Mall', { lat: GIGA.lat + i * 1e-5, lng: GIGA.lng }, 30 - i);
    }
    await promote();

    const rows = await db().collection(LOCATIONS_COLLECTION).where('normalizedName', '==', 'giga mall').get();
    expect(rows.size).toBe(1);
    const giga = rows.docs[0]!.data();
    expect(giga.status).toBe('verified');
    expect(giga.confirmations).toBe(VERIFY_AFTER_CONFIRMATIONS);
    expect(giga.coordSource).toBe('trip_gps');
    // Our drivers' gate, not Google's centroid.
    expect(Math.abs(giga.lat - GIGA.lat)).toBeLessThan(1e-4);
    expect(Math.abs(giga.lat - GOOGLE_GIGA.lat)).toBeGreaterThan(1e-3);

    // One trip teaches two places: the pickup is learned too.
    const pickup = await db().collection(LOCATIONS_COLLECTION).where('normalizedName', '==', 'f 6 markaz islamabad').get();
    expect(pickup.size).toBe(1);

    // And a second sweep over the same trips changes nothing.
    await promote();
    const again = await db().collection(LOCATIONS_COLLECTION).doc(rows.docs[0]!.id).get();
    expect(again.get('confirmations')).toBe(VERIFY_AFTER_CONFIRMATIONS);
    expect(google).toHaveLength(0);
  });

  it('skips a drop-off whose driver fix is stale', async () => {
    await completedTrip('stale', 'Giga Mall', GIGA, 5);
    await db().doc('trips/stale').set({ driverLocationAt: Timestamp.fromMillis(Date.now() - 60 * 60_000) }, { merge: true });
    await promote();
    const rows = await db().collection(LOCATIONS_COLLECTION).where('normalizedName', '==', 'giga mall').get();
    expect(rows.size).toBe(0);
  });
});

describe('a rider searching for a place we know', () => {
  async function verifiedGiga() {
    for (let i = 0; i < VERIFY_AFTER_CONFIRMATIONS; i++) {
      await completedTrip(`g${i}`, 'Giga Mall', GIGA, 30 - i);
    }
    await promote();
    const doc = (await db().collection(LOCATIONS_COLLECTION).where('normalizedName', '==', 'giga mall').get()).docs[0]!;
    return doc.id;
  }

  it('puts our suggestion first, with a unique placeId, and drops Google’s duplicate', async () => {
    const velocityId = await verifiedGiga();
    const res = await call(placesAutocomplete, { input: 'giga', sessionToken: TOKEN });

    expect(res.fromOwnMap).toBe(1);
    const [first, ...rest] = res.predictions;
    expect(first).toMatchObject({ velocityId, placeId: `${OWN_PLACE_ID_PREFIX}${velocityId}`, mainText: 'Giga Mall' });
    // Google's own "Giga Mall" row is dropped; its other results stay.
    expect(rest.map((p: { mainText: string }) => p.mainText)).toEqual(['Gulberg Greens']);
    // Every row has a distinct, non-empty key.
    const keys = res.predictions.map((p: { placeId: string }) => p.placeId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(Boolean)).toBe(true);
    // Fewer than five of ours, so Google was still asked — once.
    expect(google.filter((g) => g.url.includes('autocomplete'))).toHaveLength(1);
  });

  it('skips Google entirely when our own map fills the list', async () => {
    for (const name of ['Giga Mall', 'Giga Food Court', 'Giga Parking', 'Giga Cinema', 'Giga Towers']) {
      for (let i = 0; i < VERIFY_AFTER_CONFIRMATIONS; i++) {
        await completedTrip(`${name}-${i}`, name, GIGA, 30 - i);
      }
    }
    await promote();
    const res = await call(placesAutocomplete, { input: 'giga', sessionToken: TOKEN });
    expect(res.predictions).toHaveLength(5);
    expect(res.fromOwnMap).toBe(5);
    expect(google).toHaveLength(0);
  });

  it('resolves a tap from a current build (velocityId) with no Google call', async () => {
    const velocityId = await verifiedGiga();
    const res = await call(placeDetails, { velocityId, sessionToken: TOKEN });
    expect(res.fromOwnMap).toBe(true);
    expect(res.detail.lat).toBeCloseTo(GIGA.lat, 4);
    expect(google).toHaveLength(0);
  });

  it('resolves a tap from an older build (prefixed placeId only) with no Google call', async () => {
    const velocityId = await verifiedGiga();
    const res = await call(placeDetails, { placeId: `${OWN_PLACE_ID_PREFIX}${velocityId}`, sessionToken: TOKEN });
    expect(res.fromOwnMap).toBe(true);
    expect(res.detail.lat).toBeCloseTo(GIGA.lat, 4);
    expect(google).toHaveLength(0);
  });

  it('never sends one of our ids to Google, even when it no longer resolves', async () => {
    const gone = await call(placeDetails, { placeId: `${OWN_PLACE_ID_PREFIX}VL-ISB-000000`, sessionToken: TOKEN });
    expect(gone.detail).toBeNull();
    const bare = await call(placeDetails, { placeId: OWN_PLACE_ID_PREFIX, sessionToken: TOKEN });
    expect(bare.detail).toBeNull();
    expect(google).toHaveLength(0);
  });

  it('answers a typed name from our own map before any cache or Google step', async () => {
    await verifiedGiga();
    const res = await call(geocodeAddress, { text: 'Giga Mall' });
    expect(res.detail.lat).toBeCloseTo(GIGA.lat, 4);
    expect(google).toHaveLength(0);
  });
});

describe('the rented cache for everything else', () => {
  it('pays Google once, then serves the same address from the cache', async () => {
    const first = await call(geocodeAddress, { text: 'Centaurus Mall, Islamabad' });
    expect(first.detail.lat).toBeCloseTo(33.7077, 4);
    expect(google.filter((g) => g.url.includes('/geocode/json'))).toHaveLength(1);

    // Coordinates on the 29-day clock, the place ID kept for good — two collections.
    const coords = await db().collection('mapsCache').where('kind', '==', 'place').get();
    expect(coords.size).toBe(1);
    expect(coords.docs[0]!.get('expireAt').toMillis()).toBeGreaterThan(Date.now() + 28 * 86_400_000);
    const ids = await db().collection('mapsPlaceIds').get();
    expect(ids.size).toBe(1);
    expect(ids.docs[0]!.get('placeId')).toBe('g-centaurus');
    expect(ids.docs[0]!.get('lat')).toBeUndefined();

    __clearMapsMemoryCache(); // a cold instance: the answer must come from Firestore
    const second = await call(geocodeAddress, { text: 'centaurus mall islamabad' });
    expect(second.detail.lat).toBeCloseTo(33.7077, 4);
    expect(google).toHaveLength(1);
  });

  it('after the coordinates expire, re-resolves through the kept place ID for $5, not a new search', async () => {
    await call(geocodeAddress, { text: 'Centaurus Mall, Islamabad' });
    const coords = await db().collection('mapsCache').where('kind', '==', 'place').get();
    await coords.docs[0]!.ref.update({ expireAt: Timestamp.fromMillis(Date.now() - 1000) });
    __clearMapsMemoryCache();
    google.length = 0;

    const res = await call(geocodeAddress, { text: 'Centaurus Mall, Islamabad' });
    expect(res.detail.lat).toBeCloseTo(33.7077, 4);
    // One Place Details call on the stored ID — no Geocoding, no Text Search.
    expect(google).toHaveLength(1);
    expect(google[0]!.url).toContain('places.googleapis.com/v1/places/g-centaurus');
  });

  it('caches a tapped Google prediction, so the next tap is free', async () => {
    await call(placeDetails, { placeId: 'g-centaurus', sessionToken: TOKEN });
    expect(google).toHaveLength(1);
    __clearMapsMemoryCache();
    const again = await call(placeDetails, { placeId: 'g-centaurus', sessionToken: 'session-2' });
    expect(again.detail.lat).toBeCloseTo(33.7077, 4);
    expect(google).toHaveLength(1);
  });
});
