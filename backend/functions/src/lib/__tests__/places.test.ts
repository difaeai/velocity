/**
 * Address resolution must always reach for the cheapest thing that works.
 *
 * `fetchGeocode` is the hottest paid path in the app — free-typed destinations,
 * voice bookings, rebooking a recent trip, daily-routes setup all land here — and
 * the four steps it tries are in cost order for a reason. A refactor that
 * accidentally reorders them, or drops the place ID on the floor, does not break
 * anything a user can see. It just quietly multiplies the bill, which is why the
 * order is pinned here rather than left to the comments.
 *
 * Prices behind the assertions, per 1,000 calls: Place Details Essentials $5,
 * Geocoding $5, Text Search Pro $32.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import type { CachedPlace } from '../mapsCache';

const mocks = vi.hoisted(() => ({
  readPlaceCache: vi.fn<(query: string) => Promise<unknown>>(),
  readCachedPlaceId: vi.fn<(query: string) => Promise<unknown>>(),
  readDetailCache: vi.fn<(placeId: string) => Promise<unknown>>(),
  writePlaceCache: vi.fn<(query: string, place: unknown) => Promise<void>>(),
  writeDetailCache: vi.fn<(placeId: string, place: unknown) => Promise<void>>(),
}));

vi.mock('../mapsCache', () => mocks);

import { fetchGeocode, fetchPlaceDetail } from '../places';

const originalKey = process.env.GOOGLE_MAPS_SERVER_KEY;

/** A Geocoding API success. Note `status` — this API reports failure in the body. */
function geocodeOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'OK',
      results: [
        {
          formatted_address: 'F-7 Markaz, Islamabad, Pakistan',
          place_id: 'ChIJgeocode',
          geometry: { location: { lat: 33.7196, lng: 73.0724 } },
        },
      ],
    }),
  };
}

/** A Geocoding API "no such address" — not an error, just nothing found. */
function geocodeZeroResults() {
  return { ok: true, status: 200, json: async () => ({ status: 'ZERO_RESULTS', results: [] }) };
}

/** A Places Text Search success. */
function textSearchOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      places: [
        {
          id: 'ChIJtextsearch',
          formattedAddress: 'Giga Mall, DHA II, Islamabad',
          location: { latitude: 33.5228, longitude: 73.1544 },
        },
      ],
    }),
  };
}

/** Text Search finding nothing either. */
function textSearchEmpty() {
  return { ok: true, status: 200, json: async () => ({ places: [] }) };
}

/** A Place Details success. */
function placeDetailsOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      location: { latitude: 33.6844, longitude: 73.0479 },
      formattedAddress: 'Blue Area, Islamabad',
    }),
  };
}

/** A place ID Google no longer recognises. */
function placeDetailsGone() {
  return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND' } }) };
}

type FetchStub = ReturnType<typeof makeFetchStub>;

function makeFetchStub() {
  return vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>();
}

/** Stub `fetch` to answer with these responses, in order, one call each. */
function stubFetch(...responses: unknown[]): FetchStub {
  const spy = makeFetchStub();
  responses.forEach((response) => spy.mockImplementationOnce(async () => response));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** Which Google product each captured request was aimed at. */
function targetsOf(spy: FetchStub): string[] {
  return spy.mock.calls.map(([url]) => {
    const u = String(url);
    if (u.includes('maps/api/geocode/json')) return 'geocoding';
    if (u.includes('places:searchText')) return 'textSearch';
    if (u.includes('places:autocomplete')) return 'autocomplete';
    if (u.includes('places.googleapis.com/v1/places/')) return 'placeDetails';
    return u;
  });
}

function urlOf(spy: FetchStub, call = 0): string {
  return String(spy.mock.calls[call]?.[0] ?? '');
}

function initOf(spy: FetchStub, call = 0): RequestInit {
  return (spy.mock.calls[call]?.[1] ?? {}) as RequestInit;
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
  mocks.readPlaceCache.mockResolvedValue(null);
  mocks.readCachedPlaceId.mockResolvedValue(null);
  mocks.readDetailCache.mockResolvedValue(null);
  mocks.writePlaceCache.mockResolvedValue(undefined);
  mocks.writeDetailCache.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_SERVER_KEY;
  else process.env.GOOGLE_MAPS_SERVER_KEY = originalKey;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('fetchGeocode — cheapest route to a coordinate', () => {
  it('step 1: a cache hit costs nothing and calls no one', async () => {
    const cached: CachedPlace = {
      lat: 33.7196,
      lng: 73.0724,
      address: 'F-7 Markaz',
      placeId: 'ChIJx',
    };
    mocks.readPlaceCache.mockResolvedValue(cached);
    const spy = stubFetch();

    const result = await fetchGeocode('F-7 Markaz');

    expect(result).toEqual({ lat: 33.7196, lng: 73.0724, address: 'F-7 Markaz' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('step 2: a known place ID is re-resolved with Place Details, never re-searched', async () => {
    // This is the licence payoff: the coordinates expired and were deleted, but
    // the place ID survived, so month two is a $5 call instead of a $32 one.
    mocks.readCachedPlaceId.mockResolvedValue('ChIJremembered');
    const spy = stubFetch(placeDetailsOk());

    const result = await fetchGeocode('Blue Area');

    expect(targetsOf(spy)).toEqual(['placeDetails']);
    expect(result).toEqual({ lat: 33.6844, lng: 73.0479, address: 'Blue Area, Islamabad' });
  });

  it('step 2: re-resolving a place ID sends no session token — there is no session to close', async () => {
    mocks.readCachedPlaceId.mockResolvedValue('ChIJremembered');
    const spy = stubFetch(placeDetailsOk());

    await fetchGeocode('Blue Area');

    expect(urlOf(spy)).not.toContain('sessionToken');
  });

  it('step 3: a plain miss goes to Geocoding, not Text Search', async () => {
    const spy = stubFetch(geocodeOk());

    const result = await fetchGeocode('F-7 Markaz, Islamabad');

    expect(targetsOf(spy)).toEqual(['geocoding']);
    expect(result).toEqual({
      lat: 33.7196,
      lng: 73.0724,
      address: 'F-7 Markaz, Islamabad, Pakistan',
    });
  });

  it('step 3: geocoding is restricted to Pakistan, not merely biased toward it', async () => {
    const spy = stubFetch(geocodeOk());

    await fetchGeocode('Saddar');

    expect(urlOf(spy)).toContain('components=country:pk');
  });

  it('step 4: Text Search is the last resort, reached only when geocoding finds nothing', async () => {
    // Business names ("Giga Mall") are the case geocoding genuinely cannot do,
    // which is why the expensive call still exists at all.
    const spy = stubFetch(geocodeZeroResults(), textSearchOk());

    const result = await fetchGeocode('Giga Mall');

    expect(targetsOf(spy)).toEqual(['geocoding', 'textSearch']);
    expect(result).toEqual({
      lat: 33.5228,
      lng: 73.1544,
      address: 'Giga Mall, DHA II, Islamabad',
    });
  });

  it('files the place ID away whichever call answered', async () => {
    stubFetch(geocodeOk());

    await fetchGeocode('F-7 Markaz');

    expect(mocks.writePlaceCache).toHaveBeenCalledWith(
      'F-7 Markaz',
      expect.objectContaining({ placeId: 'ChIJgeocode' }),
    );
  });

  it('asks Text Search for the free id field too, so the next lookup is cheap', async () => {
    const spy = stubFetch(geocodeZeroResults(), textSearchOk());

    await fetchGeocode('Giga Mall');

    const headers = initOf(spy, 1).headers as Record<string, string>;
    expect(headers['X-Goog-FieldMask']).toContain('places.id');
    expect(mocks.writePlaceCache).toHaveBeenCalledWith(
      'Giga Mall',
      expect.objectContaining({ placeId: 'ChIJtextsearch' }),
    );
  });

  it('falls through to the text lookup when a stored place ID no longer resolves', async () => {
    mocks.readCachedPlaceId.mockResolvedValue('ChIJretired');
    const spy = stubFetch(placeDetailsGone(), geocodeOk());

    const result = await fetchGeocode('F-7 Markaz');

    expect(targetsOf(spy)).toEqual(['placeDetails', 'geocoding']);
    expect(result).not.toBeNull();
  });

  it('returns null, never throws, when nothing can resolve the address', async () => {
    stubFetch(geocodeZeroResults(), textSearchEmpty());

    expect(await fetchGeocode('asdfghjkl qwerty')).toBeNull();
  });

  it('does not call out at all without a server key', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const spy = stubFetch();

    expect(await fetchGeocode('F-7 Markaz')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('fetchPlaceDetail', () => {
  it('serves a cached coordinate without a Google call', async () => {
    mocks.readDetailCache.mockResolvedValue({
      lat: 33.6844,
      lng: 73.0479,
      address: 'Blue Area, Islamabad',
    } satisfies CachedPlace);
    const spy = stubFetch();

    const result = await fetchPlaceDetail('ChIJcached', 'session-1');

    expect(result).toEqual({ lat: 33.6844, lng: 73.0479, address: 'Blue Area, Islamabad' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes the session token on a miss, so the autocomplete session closes', async () => {
    const spy = stubFetch(placeDetailsOk());

    await fetchPlaceDetail('ChIJfresh', 'session-42');

    expect(urlOf(spy)).toContain('sessionToken=session-42');
  });

  it('caches what it fetched', async () => {
    stubFetch(placeDetailsOk());

    await fetchPlaceDetail('ChIJfresh', 'session-42');

    expect(mocks.writeDetailCache).toHaveBeenCalledWith('ChIJfresh', {
      lat: 33.6844,
      lng: 73.0479,
      address: 'Blue Area, Islamabad',
    });
  });
});
