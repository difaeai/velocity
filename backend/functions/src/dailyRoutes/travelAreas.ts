/**
 * "Locations people are traveling to": every saved daily route, as areas.
 *
 * Riders save the trips they make often from the home map's "Location & time"
 * pill (users/{uid}/dailyRoutes). Those documents are owner-only and hold
 * house-level addresses, so nobody else can read them. This callable is the one
 * way out: it groups the routes that start near the caller by pickup AREA and
 * drop-off AREA and returns, per group, how many people, how many of them are
 * men and women, and their average departure time. No uid, name, coordinate or
 * address leaves the server.
 *
 * The same scan answers the add-a-route sheet's question, "how many people
 * already go this way?", on the radius the shared-ride alerts match with
 * (notifyDailyRouteMatches), so the number a rider sees is the number of people
 * a shared ride on that route would reach.
 *
 * Riders call it from the home map, drivers from the "Heading somewhere" screen.
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { haversineM } from '../lib/corridor';
import { db } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { hasRealCoords } from '../lib/poolRadius';
import { rateLimit } from '../lib/ratelimit';

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const schema = point.extend({
  radiusKm: z.number().min(1).max(50).default(25),
  /** A route being drafted: count the other people who already travel it. */
  route: z.object({ from: point, to: point }).optional(),
});

/** The radius a saved route matches a shared ride on — dailyRoutes DEFAULT_RADIUS_KM. */
const SAME_WAY_KM = 3;
const MAX_ROWS = 40;

type LatLng = { lat: number; lng: number };
type Gender = 'male' | 'female' | null;

export interface SavedRoute {
  uid: string;
  pickup: LatLng & { address: string };
  dropoff: LatLng & { address: string };
  /** "HH:MM", or null for "any time". */
  time: string | null;
}

export interface TravelArea {
  from: string;
  to: string;
  people: number;
  male: number;
  female: number;
  /** Average departure, rounded to 15 minutes; null when nobody set a time. */
  time: string | null;
}

export interface Tally {
  people: number;
  male: number;
  female: number;
}

// ── Area names ─────────────────────────────────────────────────────────────
// Mirror of apps/mobile/src/lib/areaLabel.ts. Here it is the privacy boundary,
// not a display nicety: nothing finer than this string reaches another user.
const STREET_LEVEL_RE =
  /^(house|home|flat|apt|apartment|suite|shop|office|floor|basement|plot|street|st[.\s]|road|rd[.\s]|lane|gali|mohalla|h[\s#.-]?no|no[.\s]|#|\d)/i;
const ROAD_RE = /(boulevard|blvd|avenue|highway|hwy|expressway|underpass|flyover|chowk|roundabout|\broad\b|\brd\b)\s*$/i;
const COUNTRY_RE = /^pakistan$/i;

/** "House 12, Street 5, F-7/4, Islamabad" → "F-7". */
export function areaLabel(raw: string): string {
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const candidate =
    parts.find((p) => !STREET_LEVEL_RE.test(p) && !ROAD_RE.test(p) && !COUNTRY_RE.test(p))
    ?? parts[parts.length - 1]
    ?? raw;
  return candidate.replace(/\s*\/\s*\d+\w*$/, '').trim();
}

/**
 * Mean departure time, on the clock face rather than the number line, so 23:30
 * and 00:30 average to midnight and not to noon. Rounded to 15 minutes.
 */
export function averageTime(times: string[]): string | null {
  let x = 0;
  let y = 0;
  for (const t of times) {
    const [h, m] = t.split(':').map(Number);
    const angle = (((h ?? 0) * 60 + (m ?? 0)) / 1440) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  // Exactly opposite times (08:00 and 20:00) have no mean; say "any time".
  if (times.length === 0 || Math.hypot(x, y) < 1e-6) return null;
  const minutes = (((Math.atan2(y, x) / (2 * Math.PI)) * 1440) + 1440) % 1440;
  const q = (Math.round(minutes / 15) * 15) % 1440;
  return `${String(Math.floor(q / 60)).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`;
}

/** One saved route document, or null when it has no real places to group on. */
export function parseRoute(uid: string | undefined, d: Record<string, unknown>): SavedRoute | null {
  const pickup = d.pickup as SavedRoute['pickup'] | undefined;
  const dropoff = d.dropoff as SavedRoute['dropoff'] | undefined;
  if (!uid || !pickup || !dropoff) return null;
  // (0, 0) is the old commute screen's "no place picked", not a place.
  if (!hasRealCoords(pickup.lat, pickup.lng) || !hasRealCoords(dropoff.lat, dropoff.lng)) return null;
  if (typeof pickup.address !== 'string' || typeof dropoff.address !== 'string') return null;
  const time = typeof d.time === 'string' && /^\d{1,2}:\d{2}$/.test(d.time) ? d.time : null;
  return { uid, pickup, dropoff, time };
}

const km = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;

/** Each person once, however many of their routes are in the set. */
export function tally(routes: SavedRoute[], genders: Map<string, Gender>): Tally {
  const uids = new Set(routes.map((r) => r.uid));
  let male = 0;
  let female = 0;
  for (const uid of uids) {
    const g = genders.get(uid);
    if (g === 'male') male += 1;
    else if (g === 'female') female += 1;
  }
  return { people: uids.size, male, female };
}

/** Routes grouped by pickup area → drop-off area, busiest first. */
export function groupAreas(routes: SavedRoute[], genders: Map<string, Gender>): TravelArea[] {
  const groups = new Map<string, { from: string; to: string; routes: SavedRoute[] }>();
  for (const r of routes) {
    const from = areaLabel(r.pickup.address);
    const to = areaLabel(r.dropoff.address);
    const key = `${from.toLowerCase()}|${to.toLowerCase()}`;
    const g = groups.get(key) ?? { from, to, routes: [] };
    g.routes.push(r);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      from: g.from,
      to: g.to,
      ...tally(g.routes, genders),
      time: averageTime(g.routes.flatMap((r) => (r.time ? [r.time] : []))),
    }))
    .sort((a, b) => b.people - a.people || a.from.localeCompare(b.from));
}

/** Other people whose saved route starts and ends near this one. */
export function sameWayRoutes(
  routes: SavedRoute[],
  route: { from: LatLng; to: LatLng },
  callerUid: string,
): SavedRoute[] {
  return routes.filter(
    (r) => r.uid !== callerUid && km(r.pickup, route.from) <= SAME_WAY_KM && km(r.dropoff, route.to) <= SAME_WAY_KM,
  );
}

async function readGenders(uids: Set<string>): Promise<Map<string, Gender>> {
  const genders = new Map<string, Gender>();
  if (uids.size === 0) return genders;
  const snaps = await db.getAll(...[...uids].map((uid) => db.doc(`users/${uid}`)));
  for (const s of snaps) {
    const g = s.get('gender');
    genders.set(s.id, g === 'male' || g === 'female' ? g : null);
  }
  return genders;
}

export const getTravelAreas = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const p = schema.safeParse(req.data);
  if (!p.success) invalid('Invalid location.');
  const { lat, lng, radiusKm, route } = p.data;
  await rateLimit(uid, 'travelAreas', 20, 60);

  // shortcut: reads every saved route per call, as notifyDailyRouteMatches does; fine to a few thousand routes, past that keep a scheduled per-area summary doc and read that instead.
  const snap = await db.collectionGroup('dailyRoutes').get();
  const routes = snap.docs.flatMap((d) => {
    const r = parseRoute(d.ref.parent.parent?.id, d.data());
    return r ? [r] : [];
  });

  const near = routes.filter((r) => km(r.pickup, { lat, lng }) <= radiusKm);
  const same = route ? sameWayRoutes(routes, route, uid) : [];
  const genders = await readGenders(new Set([...near, ...same].map((r) => r.uid)));

  return {
    areas: groupAreas(near, genders).slice(0, MAX_ROWS),
    people: tally(near, genders).people,
    sameWay: route ? tally(same, genders) : null,
  };
});
