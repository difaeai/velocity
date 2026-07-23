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
 * Autocomplete is billed per *session*, not per keystroke: the client mints a
 * session token, sends it with every keystroke and again with the final
 * Details call, and Google bills the whole thing once. Passing `sessionToken`
 * through faithfully is therefore a cost control, not a formality.
 *
 * FAILURE
 * Every helper returns null / [] rather than throwing. A Places outage should
 * degrade the app to "type the address by hand", never to a crash.
 */
import { logger } from 'firebase-functions';

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

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

/** Resolve a prediction the user picked into coordinates. */
export async function fetchPlaceDetail(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetail | null> {
  const data = await callPlaces(
    `${DETAILS_BASE_URL}/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
    { method: 'GET', fieldMask: 'location,formattedAddress' },
  );
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

/** Geocode a free-typed address via Text Search — the "I'll type it myself" path. */
export async function fetchGeocode(text: string): Promise<PlaceDetail | null> {
  const data = await callPlaces(SEARCH_TEXT_URL, {
    method: 'POST',
    fieldMask: 'places.location,places.formattedAddress',
    body: { textQuery: text, regionCode: 'PK', languageCode: 'en', pageSize: 1 },
  });
  const place = (data?.places as { location?: { latitude?: number; longitude?: number }; formattedAddress?: string }[] | undefined)?.[0];
  if (typeof place?.location?.latitude !== 'number' || typeof place?.location?.longitude !== 'number') {
    return null;
  }
  return {
    lat: place.location.latitude,
    lng: place.location.longitude,
    address: place.formattedAddress ?? text,
  };
}
