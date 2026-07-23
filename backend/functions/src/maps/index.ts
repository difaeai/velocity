/**
 * Maps proxy — Places search and road directions, run with the server key.
 *
 * The app no longer holds a Google key that can spend money. It asks us, we
 * ask Google with `GOOGLE_MAPS_SERVER_KEY`, and the key stays on the server.
 * See lib/places.ts for why the client could not do this itself once the
 * Android key was locked to a package name and certificate.
 *
 * Every callable here is rate limited per user. That is the point of owning
 * the key: an extracted client key is unbounded spend, whereas an abusive
 * signed-in account hits a ceiling and stops.
 *
 * Nothing throws on a Google failure. `configured: false` (no server key) and
 * an empty result are normal answers the app renders as "search unavailable"
 * or "no results", because a Maps outage must not break booking — the user can
 * still type an address and continue.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import {
  fetchAutocomplete,
  fetchGeocode,
  fetchPlaceDetail,
  serverPlacesConfigured,
} from '../lib/places';
import { fetchRouteServerSide, serverRoutingConfigured } from '../lib/routes';

const autocompleteSchema = z.object({
  input: z.string().min(1).max(200),
  sessionToken: z.string().min(1).max(120),
});

/**
 * Address predictions as the user types.
 *
 * The limit is deliberately generous: this fires on a 300 ms debounce, so a
 * single destination search is a handful of calls and a busy session is a few
 * dozen. It exists to cap an abusive account, not to ration normal typing.
 */
export const placesAutocomplete = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!serverPlacesConfigured()) return { ok: true, configured: false, predictions: [] };
  await rateLimit(ctx.uid, 'placesAutocomplete', 300, 3600);

  const parsed = autocompleteSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a search input and session token.');

  const predictions = await fetchAutocomplete(parsed.data.input, parsed.data.sessionToken);
  return { ok: true, configured: true, predictions };
});

const detailSchema = z.object({
  placeId: z.string().min(1).max(400),
  sessionToken: z.string().min(1).max(120),
});

/** Coordinates for a prediction the user tapped. Closes the billing session. */
export const placeDetails = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!serverPlacesConfigured()) return { ok: true, configured: false, detail: null };
  await rateLimit(ctx.uid, 'placeDetails', 200, 3600);

  const parsed = detailSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a placeId and session token.');

  const detail = await fetchPlaceDetail(parsed.data.placeId, parsed.data.sessionToken);
  return { ok: true, configured: true, detail };
});

const geocodeSchema = z.object({ text: z.string().min(1).max(300) });

/** Coordinates for an address the user typed rather than picked. */
export const geocodeAddress = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!serverPlacesConfigured()) return { ok: true, configured: false, detail: null };
  await rateLimit(ctx.uid, 'geocodeAddress', 200, 3600);

  const parsed = geocodeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide an address to look up.');

  const detail = await fetchGeocode(parsed.data.text);
  return { ok: true, configured: true, detail };
});

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const directionsSchema = z.object({ origin: geoSchema, destination: geoSchema });

/**
 * The driving road between two points, for drawing the route line.
 *
 * Reuses `fetchRouteServerSide` — the same call en-route matching already
 * makes — so there is exactly one place that talks to the Routes API. The
 * corridor it also computes is dropped here; only the map needs the geometry.
 */
export const getDirections = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!serverRoutingConfigured()) return { ok: true, configured: false, route: null };
  await rateLimit(ctx.uid, 'getDirections', 200, 3600);

  const parsed = directionsSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid origin and destination.');

  const route = await fetchRouteServerSide(parsed.data.origin, parsed.data.destination);
  return {
    ok: true,
    configured: true,
    route: route
      ? { polyline: route.polyline, distanceM: route.distanceM, durationSec: route.durationSec }
      : null,
  };
});
