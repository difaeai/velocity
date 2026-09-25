/**
 * Server-side routing: configured or not, it must never take the app down.
 *
 * The whole point of the fallback is that a missing key, a revoked key, a quota
 * wall or a Maps outage all degrade to "use the client's polyline" rather than
 * "no driver can earn today". These tests pin that.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { fetchRouteServerSide, serverRoutingConfigured } from '../routes';

/**
 * Caching is lib/mapsCache.ts's job and is tested there. Stub it to a permanent
 * miss here, because every case in this file routes the same two points: without
 * the stub the one successful route below would be served back to every later
 * case that expects a failure, and they would pass for the wrong reason.
 */
vi.mock('../mapsCache', () => ({
  readRouteCache: async () => null,
  writeRouteCache: async () => undefined,
  routeCacheKey: () => 'test-route-key',
}));

const F10 = { lat: 33.6938, lng: 72.9989 };
const F6 = { lat: 33.7196, lng: 73.0724 };

const originalKey = process.env.GOOGLE_MAPS_SERVER_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_MAPS_SERVER_KEY;
  else process.env.GOOGLE_MAPS_SERVER_KEY = originalKey;
  vi.unstubAllGlobals();
});

describe('serverRoutingConfigured', () => {
  it('is false with no key', () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    expect(serverRoutingConfigured()).toBe(false);
  });

  it('is false for a key that is only whitespace', () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = '   ';
    expect(serverRoutingConfigured()).toBe(false);
  });

  it('is true once a key is set', () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    expect(serverRoutingConfigured()).toBe(true);
  });
});

describe('fetchRouteServerSide', () => {
  it('returns null rather than calling out when there is no key', async () => {
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(await fetchRouteServerSide(F10, F6)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('decodes a route into a corridor', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          routes: [
            {
              // Google's reference polyline — three points, known coordinates.
              polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
              distanceMeters: 8000,
              duration: '914s',
            },
          ],
        }),
      })),
    );

    const route = await fetchRouteServerSide(F10, F6);
    expect(route).not.toBeNull();
    expect(route!.corridor.points).toHaveLength(3);
    expect(route!.distanceM).toBe(8000);
    expect(route!.durationSec).toBe(914); // "914s" → 914
    expect(route!.corridor.lengthM).toBeGreaterThan(0);
  });

  it('falls back (null) when the key is rejected — a console problem, not an outage', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaBad';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          error: { status: 'PERMISSION_DENIED', message: 'API key not valid for this API' },
        }),
      })),
    );

    expect(await fetchRouteServerSide(F10, F6)).toBeNull();
  });

  it('falls back when Google finds no road between the points', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ routes: [] }) })));
    expect(await fetchRouteServerSide(F10, F6)).toBeNull();
  });

  it('falls back when the network throws', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    expect(await fetchRouteServerSide(F10, F6)).toBeNull();
  });

  it('sends the field mask Google requires, and the key in the header', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaSecret';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        routes: [{ polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' }, distanceMeters: 1, duration: '1s' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await fetchRouteServerSide(F10, F6);

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('AIzaSecret');
    // Omitting the mask is a 400 on this API — it is not optional.
    expect(headers['X-Goog-FieldMask']).toContain('routes.polyline.encodedPolyline');

    const body = JSON.parse(init.body as string);
    expect(body.travelMode).toBe('DRIVE');
    expect(body.regionCode).toBe('PK');
    expect(body.origin.location.latLng.latitude).toBe(F10.lat);
    expect(body.destination.location.latLng.longitude).toBe(F6.lng);
  });
});

/**
 * Which SKU we are billed at is decided by one field in the request body, and
 * getting it wrong doubles the price of every route while halving the monthly
 * free allowance. It is invisible until the bill arrives, so it is pinned here.
 */
describe('fetchRouteServerSide billing tier', () => {
  function stubOkRoute() {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        routes: [
          { polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' }, distanceMeters: 1, duration: '1s' },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  function bodyOf(fetchSpy: ReturnType<typeof stubOkRoute>) {
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    return JSON.parse(init.body as string);
  }

  it('defaults to the Essentials tier — no traffic unless asked', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    const fetchSpy = stubOkRoute();

    await fetchRouteServerSide(F10, F6);

    expect(bodyOf(fetchSpy).routingPreference).toBe('TRAFFIC_UNAWARE');
  });

  it('still defaults to Essentials when options are passed without trafficAware', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    const fetchSpy = stubOkRoute();

    await fetchRouteServerSide(F10, F6, {});

    expect(bodyOf(fetchSpy).routingPreference).toBe('TRAFFIC_UNAWARE');
  });

  it('opts into the Pro tier only on an explicit trafficAware', async () => {
    process.env.GOOGLE_MAPS_SERVER_KEY = 'AIzaTest';
    const fetchSpy = stubOkRoute();

    await fetchRouteServerSide(F10, F6, { trafficAware: true });

    expect(bodyOf(fetchSpy).routingPreference).toBe('TRAFFIC_AWARE');
  });
});
