/**
 * Server-side Places (Google Places API New, v1).
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * The app used to call Places directly from the device with the Android Maps
 * key. That cannot work once the key is locked down: Android key restrictions
 * are enforced by the *native* SDK attaching the package name and signing
 * certificate to the request, and a `fetch()` from React Native's JS layer
 * attaches neither. Google sees no Android identity and answers
 *
 *   PERMISSION_DENIED — "Requests from this Android client application
 *                        <empty> are blocked."
 *
 * where `<empty>` is literally the package name it never received. The only
 * ways out are to unrestrict the key — which ships inside the APK, so anyone
 * can extract it and spend your money — or to move the calls here. We move
 * them here.
 *
 * THE KEY
 * Same `GOOGLE_MAPS_SERVER_KEY` as lib/routes.ts: no application restriction
 * (a Cloud Function has no fixed IP), API-restricted to Routes + Places, and
 * it never leaves the server. See .env.example.
 *
 * COST
 * Read this before "optimising" anything here, because the obvious belief about
 * autocomplete billing is out of date. Under the SKU model Google moved to in
 * March 2025 a session is only free when it ends in a Place Details call asking
 * for *Pro or Enterprise* fields. We ask for `location,formattedAddress`, which
 * is Place Details **Essentials** — and for those sessions Google bills the
 * first 12 autocomplete requests, with requests 13 and higher free. A normal
 * destination search is three to six requests, so in practice we pay for every
 * one of them and the session token saves nothing.
 *
 * That is not a reason to drop the token: an abandoned session is billed the
 * same way, so keeping it costs nothing and it does start saving above twelve
 * requests. It is a reason not to mistake it for a cost control. What actually
 * cuts this bill is upstream — fewer requests per search (the 3-character floor
 * and 500 ms debounce in the client's hooks/places.ts) and never buying the same
 * answer twice (lib/mapsCache.ts).
 *
 * The other two calls here are cached, and `fetchGeocode` prefers the Geocoding
 * API over Text Search: same answer, $5 per 1,000 instead of $32. See that
 * function for why Text Search is still here at all.
 *
 * FAILURE
 * Every helper returns null / [] rather than throwing. A Places outage should
 * degrade the app to "type the address by hand", never to a crash.
 */
import { logger } from 'firebase-functions';

import {
  readCachedPlaceId,
  readDetailCache,
  readPlaceCache,
  writeDetailCache,
  writePlaceCache,
} from './mapsCache';
import { lookupOwnPlace } from '../locations/registry';

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';
/**
 * The Geocoding API — address text in, coordinates out, $5 per 1,000.
 *
 * Not a legacy endpoint despite the older-looking URL: Geocoding is a current
 * Essentials-tier API with its own 10,000-a-month free allowance. That matters
 * here because this project is post-2025 and Google refuses to enable genuinely
 * legacy Maps APIs on those (see the client's hooks/directions.ts for the scar).
 */
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Give up rather than hold a callable open. */
const TIMEOUT_MS = 6_000;

export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

export interface PlaceDetail {
  lat: number;
  lng: number;
  address: string;
}

/** True when a server-side Maps key is configured. */
export function serverPlacesConfigured(): boolean {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/** Shared fetch: applies the timeout, logs a rejection, returns parsed JSON or null. */
async function callPlaces(
  url: string,
  init: { method: 'GET' | 'POST'; fieldMask?: string; body?: unknown },
): Promise<Record<string, unknown> | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'X-Goog-Api-Key': key };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.fieldMask) headers['X-Goog-FieldMask'] = init.fieldMask;

    const res = await fetch(url, {
      method: init.method,
      signal: controller.signal,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = (await res.json()) as Record<string, unknown> & {
      error?: { status?: string; message?: string };
    };

    if (!res.ok) {
      // The ones you will actually hit are console problems, so name them:
      // REQUEST_DENIED   → Places API (New) not enabled on the project
      // PERMISSION_DENIED→ key restricted so it will not answer a server
      logger.error('Places API rejected the request', {
        url,
        httpStatus: res.status,
        status: data?.error?.status,
        message: data?.error?.message,
      });
      return null;
    }
    return data;
  } catch (e) {
    logger.warn('Places API call failed', { url, e });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Autocomplete predictions for a partial address, biased to Pakistan. */
export async function fetchAutocomplete(
  input: string,
  sessionToken: string,
): Promise<PlacePrediction[]> {
  const data = await callPlaces(AUTOCOMPLETE_URL, {
    method: 'POST',
    body: {
      input,
      sessionToken,
      includedRegionCodes: ['pk'],
      languageCode: 'en',
    },
  });
  if (!data) return [];

  const suggestions = (data.suggestions ?? []) as {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }[];

  return suggestions
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId!,
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
      fullText: p.text?.text ?? '',
    }));
}

/**
 * Ask Google what is at a place ID. One Place Details Essentials call.
 *
 * `sessionToken` is optional because there are two callers with different
 * histories: a prediction the user just tapped (there is a live autocomplete
 * session to close, so pass it) and a place ID we already had on file from weeks
 * ago (no session exists, so there is nothing to close).
 */
async function placeDetailFromGoogle(
  placeId: string,
  sessionToken?: string,
): Promise<PlaceDetail | null> {
  const url = sessionToken
    ? `${DETAILS_BASE_URL}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`
    : `${DETAILS_BASE_URL}/${encodeURIComponent(placeId)}`;
  const data = await callPlaces(url, { method: 'GET', fieldMask: 'location,formattedAddress' });
  const location = data?.location as { latitude?: number; longitude?: number } | undefined;
  if (typeof location?.latitude !== 'number' || typeof location?.longitude !== 'number') {
    return null;
  }
  return {
    lat: location.latitude,
    lng: location.longitude,
    address: (data?.formattedAddress as string | undefined) ?? '',
  };
}

/**
 * Resolve a prediction the user picked into coordinates.
 *
 * A cache hit skips the Google call, which also means the autocomplete session
 * never gets closed. That is deliberate and it is free: Google bills an
 * abandoned session's requests exactly as it bills the first twelve of a closed
 * Essentials session — the same Autocomplete Requests SKU, the same price. So
 * for the three-to-six-request searches people actually make, serving from cache
 * costs the same on autocomplete and saves the whole Place Details call.
 *
 * Above twelve requests a closed session would have started earning free ones,
 * so a very long search that ends on a cached place is fractionally worse. That
 * is a rare shape, and the Place Details call we skip is worth more than the
 * handful of autocomplete requests it would have discounted.
 */
export async function fetchPlaceDetail(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetail | null> {
  const cached = await readDetailCache(placeId);
  if (cached) return { lat: cached.lat, lng: cached.lng, address: cached.address };

  const detail = await placeDetailFromGoogle(placeId, sessionToken);
  if (detail) await writeDetailCache(placeId, detail);
  return detail;
}

/** Geocode via the Geocoding API. Essentials tier: $5 per 1,000, 10,000 free. */
async function geocodeFromGoogle(
  text: string,
): Promise<(PlaceDetail & { placeId?: string }) | null> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url =
      `${GEOCODE_URL}?address=${encodeURIComponent(text)}` +
      // `components` restricts rather than biases: an Islamabad sector name must
      // not resolve to a same-named street in another country.
      `&components=country:pk&language=en&key=${encodeURIComponent(key)}`;

    const res = await fetch(url, { signal: controller.signal });
    const data = (await res.json()) as {
      status?: string;
      error_message?: string;
      results?: {
        formatted_address?: string;
        place_id?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }[];
    };

    // This API reports failure in `status`, not the HTTP code — a REQUEST_DENIED
    // arrives as a 200. ZERO_RESULTS is not an error, just no such address.
    if (data.status !== 'OK') {
      if (data.status !== 'ZERO_RESULTS') {
        logger.error('Geocoding API rejected the request', {
          status: data.status,
          message: data.error_message,
        });
      }
      return null;
    }

    const first = data.results?.[0];
    const loc = first?.geometry?.location;
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') return null;

    return {
      lat: loc.lat,
      lng: loc.lng,
      address: first?.formatted_address ?? text,
      placeId: first?.place_id,
    };
  } catch (e) {
    logger.warn('Geocoding API call failed', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Geocode via Places Text Search. Pro tier: $32 per 1,000. The last resort. */
async function textSearchFromGoogle(
  text: string,
): Promise<(PlaceDetail & { placeId?: string }) | null> {
  const data = await callPlaces(SEARCH_TEXT_URL, {
    method: 'POST',
    // `places.id` rides along free — it is an Essentials field and the SKU is
    // already decided by the other two. Worth having: it is what makes the next
    // lookup of this address cheap.
    fieldMask: 'places.id,places.location,places.formattedAddress',
    body: { textQuery: text, regionCode: 'PK', languageCode: 'en', pageSize: 1 },
  });
  const place = (
    data?.places as
      | {
          id?: string;
          location?: { latitude?: number; longitude?: number };
          formattedAddress?: string;
        }[]
      | undefined
  )?.[0];
  if (typeof place?.location?.latitude !== 'number' || typeof place?.location?.longitude !== 'number') {
    return null;
  }
  return {
    lat: place.location.latitude,
    lng: place.location.longitude,
    address: place.formattedAddress ?? text,
    placeId: place.id,
  };
}

/**
 * Coordinates for an address somebody typed or spoke — the cheapest way we can
 * get them, in five steps.
 *
 * This is the hottest paid path in the app. It backs the free-typed destination,
 * the voice booking prefill (src/voice/gazetteer.ts resolves spoken phrases to a
 * canonical string and hands it straight here), rebooking a recent trip whose
 * coordinates were never saved, and daily-routes setup. It used to be a single
 * Text Search call asking for `location` and `formattedAddress` — and because
 * neither field is in the Text Search Essentials set, every one of those was
 * billed at Text Search **Pro, $32 per 1,000**. For coordinates. Which the
 * Geocoding API sells for $5.
 *
 * So, in order of what it costs us:
 *
 *   0. OUR OWN MAP. Free, and free permanently. A place the platform has driven
 *      to enough times to be sure of is in `velocityLocations` with a coordinate
 *      taken from our own drivers' phones — not rented from anyone, so it never
 *      expires and this step never stops working. It is checked first because it
 *      is both the cheapest answer and, for the places Pakistanis actually name,
 *      the most accurate one: a geocoder returns the centroid of a mall, our
 *      drivers return the gate they stop at. See locations/registry.ts.
 *   1. CACHE. Free. Same address, same coordinates, still inside the licence
 *      window.
 *   2. A PLACE ID WE ALREADY HAVE. One Place Details Essentials call, $5/1,000.
 *      This is the step that makes month two cheaper than month one: the
 *      coordinates expired and were deleted as the licence requires, but the
 *      place ID did not, so we can ask Google "what is at this exact place"
 *      instead of "find me this text" all over again.
 *   3. THE GEOCODING API. $5/1,000 with 10,000 free a month. The normal miss.
 *   4. TEXT SEARCH. $32/1,000. Only when geocoding found nothing — and it does
 *      genuinely find things geocoding will not, because it matches business
 *      names ("Giga Mall", "Jinnah Super") where geocoding wants an address.
 *      Kept for that reason, not as a fallback for outages, and reached rarely
 *      enough to stay cheap.
 *
 * Whatever answers, the place ID is filed away permanently and the coordinates
 * on a 29-day clock. See lib/mapsCache.ts for why those are two collections.
 */
export async function fetchGeocode(text: string): Promise<PlaceDetail | null> {
  // Step 0. Ours, so there is nothing to pay and nothing to expire. Deliberately
  // not written back into mapsCache: that collection is for rented coordinates and
  // gets swept, and round-tripping our own point through it would put a 29-day
  // clock on something that does not have one.
  const own = await lookupOwnPlace(text);
  if (own) return { lat: own.lat, lng: own.lng, address: own.address };

  const cached = await readPlaceCache(text);
  if (cached) return { lat: cached.lat, lng: cached.lng, address: cached.address };

  const knownPlaceId = await readCachedPlaceId(text);
  if (knownPlaceId) {
    const refreshed = await placeDetailFromGoogle(knownPlaceId);
    if (refreshed) {
      await writePlaceCache(text, { ...refreshed, placeId: knownPlaceId });
      return refreshed;
    }
    // The place ID no longer resolves — Google retired it, or it was never
    // good. Fall through and look the text up again rather than failing.
  }

  const geocoded = (await geocodeFromGoogle(text)) ?? (await textSearchFromGoogle(text));
  if (!geocoded) return null;

  await writePlaceCache(text, geocoded);
  return { lat: geocoded.lat, lng: geocoded.lng, address: geocoded.address };
}
