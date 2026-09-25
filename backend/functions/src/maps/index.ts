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
import { resolveOwnPlace, searchOwnPlaces } from '../locations/registry';

const autocompleteSchema = z.object({
  input: z.string().min(1).max(200),
  sessionToken: z.string().min(1).max(120),
});

/**
 * How many of our own suggestions count as a full answer.
 *
 * Five fills the dropdown. When our own map can do that, calling Google as well
 * would be paying for a second list nobody scrolls to — so at five we stop. Below
 * five we still ask Google and put ours on top, because our prefix search cannot
 * match mid-word ("mall" will not find "Giga Mall") and a rider must never lose
 * the ability to reach a place simply because we have not driven there yet.
 */
const OWN_MAP_SUFFICIENT = 5;

/**
 * Address predictions as the user types — ours first, Google only if needed.
 *
 * Every keystroke that reaches Google is a billed autocomplete request, and the
 * destinations Pakistanis actually pick are a small repeating set. So this asks our
 * own map first (locations/registry.ts): those suggestions are free, they stay free,
 * and for the places we have driven to they are more accurate than a geocoder —
 * their coordinate is where our drivers actually stop.
 *
 * Google is still called whenever our own map cannot fill the list, and its results
 * are appended rather than replacing ours. The rider's reach is never reduced; the
 * only thing that changes is who pays for the common case.
 *
 * The rate limit is deliberately generous: this fires on a debounce, so a single
 * destination search is a handful of calls. It exists to cap an abusive account, not
 * to ration normal typing.
 */
export const placesAutocomplete = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!serverPlacesConfigured()) return { ok: true, configured: false, predictions: [] };
  await rateLimit(ctx.uid, 'placesAutocomplete', 300, 3600);

  const parsed = autocompleteSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a search input and session token.');

  const own = await searchOwnPlaces(parsed.data.input, OWN_MAP_SUFFICIENT);
  const ours = own.map((p) => ({
    // No placeId: these resolve through `velocityId` instead, which is what keeps
    // the follow-up Place Details call off Google's meter as well.
    placeId: '',
    velocityId: p.velocityId,
    mainText: p.name,
    secondaryText: p.city ?? '',
    fullText: p.city && !p.name.includes(p.city) ? `${p.name}, ${p.city}` : p.name,
  }));

  if (ours.length >= OWN_MAP_SUFFICIENT) {
    return { ok: true, configured: true, predictions: ours, fromOwnMap: ours.length };
  }

  const google = await fetchAutocomplete(parsed.data.input, parsed.data.sessionToken);
  // Drop anything Google returns that we already offered, matched on the visible
  // name — two rows saying "Giga Mall" is a worse list, not a longer one.
  const shown = new Set(ours.map((p) => p.mainText.trim().toLowerCase()));
  const merged = [
    ...ours,
    ...google
      .filter((g) => !shown.has(g.mainText.trim().toLowerCase()))
      .map((g) => ({ ...g, velocityId: '' })),
  ];

  return { ok: true, configured: true, predictions: merged, fromOwnMap: ours.length };
});

const detailSchema = z
  .object({
    placeId: z.string().max(400).optional(),
    /** Set instead of `placeId` when the rider tapped one of our own suggestions. */
    velocityId: z.string().max(120).optional(),
    sessionToken: z.string().min(1).max(120),
  })
  .refine((d) => Boolean(d.placeId || d.velocityId), {
    message: 'Provide either a placeId or a velocityId.',
  });

/**
 * Coordinates for a prediction the rider tapped.
 *
 * Two kinds arrive here. One of ours resolves out of `velocityLocations` and costs
 * nothing — no Google call, no session to close, and the coordinate it returns is
 * the one our own drivers established. One of Google's goes to Place Details and
 * closes the autocomplete billing session, as before.
 *
 * A velocityId that no longer resolves (rejected by an operator between the
 * suggestion and the tap) falls through to null rather than to Google: we have no
 * placeId for it, and inventing a text search would be both a surprise charge and a
 * worse answer than the rider retyping.
 */
export const placeDetails = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'placeDetails', 200, 3600);

  const parsed = detailSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a placeId or velocityId, and a session token.');

  if (parsed.data.velocityId) {
    const own = await resolveOwnPlace(parsed.data.velocityId);
    return {
      ok: true,
      configured: true,
      detail: own ? { lat: own.lat, lng: own.lng, address: own.address } : null,
      fromOwnMap: Boolean(own),
    };
  }

  // Only Google's half needs a server key; ours answers without one.
  if (!serverPlacesConfigured()) return { ok: true, configured: false, detail: null };

  const detail = await fetchPlaceDetail(parsed.data.placeId!, parsed.data.sessionToken);
  return { ok: true, configured: true, detail, fromOwnMap: false };
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
