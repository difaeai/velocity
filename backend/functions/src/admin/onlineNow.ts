/**
 * "Who is online right now, and where?" — the Overview page's ONLINE box.
 * ----------------------------------------------------------------------------
 * WHAT IT ANSWERS
 * ---------------
 * Two questions a dispatcher asks all day and nothing in the desk could answer:
 * which areas have cars in them, and which areas have people in them. Supply
 * and demand are the same problem seen from two ends, and when they are in the
 * same area and do not know about each other, both sides give up — the rider
 * books something else, the driver drives home.
 *
 * So this returns both sides, grouped by AREA, plus the two lists themselves,
 * and gives the desk one button that tells either side the other is there.
 *
 * WHERE "ONLINE" COMES FROM
 * -------------------------
 * Drivers: `drivers.online` is a flag the handset sets, and it lies — toggling
 * online and then closing the app leaves it true forever. So freshness is
 * decided by `lastSeenAt`, exactly as the passenger map decides it
 * (trips/nearbyActivity.ts), and the flag is only the first filter.
 *
 * Passengers: `userPresence/{uid}`, which the handset writes while the home
 * screen is open, throttled to one write every three minutes. "Online" here
 * therefore means "had the app open in the last twenty minutes" — long enough
 * to survive the throttle and a glance at another app, short enough that a row
 * means somebody is actually holding the phone.
 *
 * WHAT AN AREA IS
 * ---------------
 * Our own map first: `velocityLocations` is the registry of places riders have
 * actually named and been driven to, so its names are names people say. The
 * nearest verified one within `AREA_RADIUS_M` wins. Failing that, the nearest
 * city. Nothing here calls Google — an area name is not worth a geocoding bill
 * (see docs on maps cost), and the registry gets better on its own as trips
 * build it up.
 *
 * shortcut: until the registry has entries in a city, every row there collapses
 * to the city's own name. Fix by pinning areas in the Locations desk, not by
 * reverse-geocoding — that would be a bill per online person per page load.
 *
 * WHAT LEAVES THE SERVER
 * ----------------------
 * This is the admin desk, so names and phone numbers are fine here — it is the
 * same data the Drivers and Passengers pages already list. What does NOT leave
 * is a coordinate: the desk gets the AREA a person is in and nothing finer, so
 * an admin account cannot be used to follow somebody down a street.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { z } from 'zod';

import { notifyUser } from '../lib/fcm';
import { db, FieldValue, SCHEDULE_REGION, Timestamp } from '../lib/firebase';
import { invalid, requireAdmin } from '../lib/guards';
import { haversineM } from '../lib/corridor';
import { cityFor, LOCATIONS_COLLECTION } from '../locations/registry';

/** A driver whose last ping is older than this is not on the road. Mirrors nearbyActivity. */
const DRIVER_STALE_MS = 12 * 60 * 1000;
/** The presence beacon writes at most every 3 minutes; this covers a few missed ones. */
const PASSENGER_STALE_MS = 20 * 60 * 1000;

/** How far a named place may be and still be "the area you are in". */
const AREA_RADIUS_M = 4000;

/** Scan caps. The lists are capped tighter; the counts come from the whole scan. */
const DRIVER_SCAN = 500;
const PRESENCE_SCAN = 1000;
const PLACE_SCAN = 500;
/** Rows per list. A desk cannot act on more than this at a glance anyway. */
const LIST_ROWS = 60;

/** Nobody is told anything about an area again until this long has passed. */
export const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** Where the per-area "we already told them" stamps live. */
const ALERTS_DOC = 'adminConfig/areaAlerts';

export const UNKNOWN_AREA = 'Outside our cities';

export interface AreaPlace {
  name: string;
  lat: number;
  lng: number;
}

export interface OnlineRow {
  uid: string;
  name: string;
  area: string;
  /** Milliseconds since the epoch of their last ping. */
  lastSeenMs: number;
  phone: string | null;
  /** Drivers only: what they are driving, when the doc says. */
  vehicle?: string | null;
}

export interface AreaRow {
  area: string;
  drivers: number;
  passengers: number;
}

export interface OnlineNowPayload {
  areas: AreaRow[];
  drivers: OnlineRow[];
  passengers: OnlineRow[];
  totals: { drivers: number; passengers: number };
  /** True when both sides are present somewhere, i.e. the auto alert has something to say. */
  matched: number;
  autoAlerts: boolean;
  generatedAt: number;
}

// ── pure bits (unit-tested) ─────────────────────────────────────────────────

/**
 * The area a coordinate is in: our own nearest named place, else its city.
 *
 * Pure on purpose — the places list is loaded once per call and passed in, so
 * grouping a thousand people costs no reads and can be tested without Firestore.
 */
export function areaOf(point: { lat: number; lng: number }, places: AreaPlace[]): string {
  let best: { name: string; d: number } | null = null;
  for (const p of places) {
    const d = haversineM(point.lat, point.lng, p.lat, p.lng);
    if (d <= AREA_RADIUS_M && (best === null || d < best.d)) best = { name: p.name, d };
  }
  if (best) return best.name;
  return cityFor(point)?.name ?? UNKNOWN_AREA;
}

/**
 * One row per area that has anybody in it, busiest first.
 *
 * An area with both sides sorts above one with more people but only one side:
 * the whole point of the box is spotting a rider and a car that cannot see each
 * other, and that is never the area with forty riders and no cars.
 */
export function tallyAreas(drivers: OnlineRow[], passengers: OnlineRow[]): AreaRow[] {
  const by = new Map<string, AreaRow>();
  const bump = (area: string, side: 'drivers' | 'passengers') => {
    const row = by.get(area) ?? { area, drivers: 0, passengers: 0 };
    row[side] += 1;
    by.set(area, row);
  };
  for (const d of drivers) bump(d.area, 'drivers');
  for (const p of passengers) bump(p.area, 'passengers');

  const both = (r: AreaRow) => (r.drivers > 0 && r.passengers > 0 ? 1 : 0);
  return [...by.values()].sort(
    (a, b) => both(b) - both(a) || b.drivers + b.passengers - (a.drivers + a.passengers) || a.area.localeCompare(b.area),
  );
}

/** Areas where each side is waiting on the other — what the auto alert is for. */
export function matchedAreas(areas: AreaRow[]): AreaRow[] {
  return areas.filter((a) => a.drivers > 0 && a.passengers > 0);
}

/** `adminConfig/areaAlerts` keys a stamp per area; Firestore field paths cannot hold dots or slashes. */
export function areaKey(area: string): string {
  return area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function toMillis(value: unknown): number {
  return value instanceof Timestamp ? value.toMillis() : 0;
}

// ── reading the world ───────────────────────────────────────────────────────

/**
 * Verified places from our own map, for naming areas. Empty is fine: cities then.
 *
 * Held per instance for ten minutes. The desk polls every minute and a verified
 * place moves about once a month, so reading the registry on every poll would
 * put five hundred document reads behind a tab somebody left open — about
 * 700,000 reads a day from one browser. The staleness it buys is the only kind
 * that does not matter here: a place pinned nine minutes ago groups its people
 * under the city name until the cache turns over.
 */
let placesCache: { at: number; places: AreaPlace[] } | null = null;
const PLACES_TTL_MS = 10 * 60 * 1000;

async function loadPlaces(): Promise<AreaPlace[]> {
  if (placesCache && Date.now() - placesCache.at < PLACES_TTL_MS) return placesCache.places;
  const snap = await db
    .collection(LOCATIONS_COLLECTION)
    .where('status', '==', 'verified')
    .limit(PLACE_SCAN)
    .get();
  const places: AreaPlace[] = [];
  for (const d of snap.docs) {
    const name = d.get('name');
    const lat = d.get('lat');
    const lng = d.get('lng');
    if (typeof name === 'string' && name && typeof lat === 'number' && typeof lng === 'number') {
      places.push({ name, lat, lng });
    }
  }
  placesCache = { at: Date.now(), places };
  return places;
}

/** The tests seed places between runs, so they clear what a previous run cached. */
export function forgetPlaces(): void {
  placesCache = null;
}

/**
 * Everybody online now, both sides, with the area each is in.
 *
 * Shared by the callable and the scheduled alert so the desk and the alert can
 * never disagree about who is where.
 */
export async function readOnlineNow(nowMs: number): Promise<{
  drivers: OnlineRow[];
  passengers: OnlineRow[];
  areas: AreaRow[];
}> {
  const [places, driverSnap, presenceSnap] = await Promise.all([
    loadPlaces(),
    db.collection('drivers').where('online', '==', true).limit(DRIVER_SCAN).get(),
    db
      .collection('userPresence')
      .where('lastSeenAt', '>=', Timestamp.fromMillis(nowMs - PASSENGER_STALE_MS))
      .limit(PRESENCE_SCAN)
      .get(),
  ]);

  const drivers: OnlineRow[] = [];
  for (const d of driverSnap.docs) {
    const loc = d.get('lastLocation') as { lat?: number; lng?: number } | undefined;
    const seen = toMillis(d.get('lastSeenAt'));
    // The flag lies; the ping does not.
    if (nowMs - seen > DRIVER_STALE_MS) continue;
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
    drivers.push({
      uid: d.id,
      name: (d.get('fullName') as string) || (d.get('displayName') as string) || 'Driver',
      area: areaOf({ lat: loc.lat, lng: loc.lng }, places),
      lastSeenMs: seen,
      phone: (d.get('phone') as string) ?? null,
      vehicle: (d.get('vehicleLabel') as string) ?? (d.get('plate') as string) ?? null,
    });
  }

  const driverUids = new Set(drivers.map((d) => d.uid));
  const presence: { uid: string; area: string; lastSeenMs: number }[] = [];
  for (const p of presenceSnap.docs) {
    const lat = p.get('lat');
    const lng = p.get('lng');
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    // A driver using the passenger app is supply, not demand — one person, one side.
    if (driverUids.has(p.id)) continue;
    presence.push({ uid: p.id, area: areaOf({ lat, lng }, places), lastSeenMs: toMillis(p.get('lastSeenAt')) });
  }
  presence.sort((a, b) => b.lastSeenMs - a.lastSeenMs);

  // Names cost one read each, so only the rows the desk will actually see get one.
  const named = presence.slice(0, LIST_ROWS);
  const userDocs = named.length
    ? await db.getAll(...named.map((p) => db.doc(`users/${p.uid}`)))
    : [];
  const passengers: OnlineRow[] = presence.map((p, i) => {
    const doc = i < userDocs.length ? userDocs[i] : undefined;
    return {
      uid: p.uid,
      name: (doc?.get('displayName') as string) || 'Passenger',
      area: p.area,
      lastSeenMs: p.lastSeenMs,
      phone: (doc?.get('phone') as string) ?? null,
    };
  });

  return { drivers, passengers, areas: tallyAreas(drivers, passengers) };
}

// ── the callables ───────────────────────────────────────────────────────────

export const adminOnlineNow = onCall(async (req) => {
  requireAdmin(req);
  const nowMs = Date.now();
  const { drivers, passengers, areas } = await readOnlineNow(nowMs);
  const alerts = await db.doc(ALERTS_DOC).get();

  const payload: OnlineNowPayload = {
    areas,
    // Freshest first: the desk reads the top of the list and stops.
    drivers: [...drivers].sort((a, b) => b.lastSeenMs - a.lastSeenMs).slice(0, LIST_ROWS),
    passengers: passengers.slice(0, LIST_ROWS),
    totals: { drivers: drivers.length, passengers: passengers.length },
    matched: matchedAreas(areas).length,
    // Missing document means never touched, and the owner asked for this on.
    autoAlerts: alerts.get('enabled') !== false,
    generatedAt: nowMs,
  };
  return payload;
});

const notifySchema = z.object({
  /** The area exactly as a row names it, or `null` for everybody online. */
  area: z.string().min(1).max(120).nullable(),
  to: z.enum(['passengers', 'drivers', 'both']),
  title: z.string().min(2).max(80),
  body: z.string().min(2).max(300),
});

/**
 * Tell the people online in one area something, now.
 *
 * It resolves the audience at the moment of sending rather than trusting a list
 * the browser is holding: a page left open for an hour would otherwise push to
 * people who went offline forty minutes ago.
 */
export const adminNotifyArea = onCall({ timeoutSeconds: 300 }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = notifySchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid notification: ' + parsed.error.message);
  const { area, to, title, body } = parsed.data;

  const { drivers, passengers } = await readOnlineNow(Date.now());
  const inArea = (rows: OnlineRow[]) => (area === null ? rows : rows.filter((r) => r.area === area));
  const targets = [
    ...(to === 'drivers' || to === 'both' ? inArea(drivers) : []),
    ...(to === 'passengers' || to === 'both' ? inArea(passengers) : []),
  ];

  await Promise.all(targets.map((t) => notifyUser(t.uid, title, body, 'promo')));

  await db.collection('auditLogs').add({
    type: 'notification.area',
    actor: ctx.uid,
    area,
    to,
    title,
    body,
    sentCount: targets.length,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('adminNotifyArea', { area, to, sent: targets.length });
  return { ok: true, sent: targets.length };
});

// ── the automatic half ──────────────────────────────────────────────────────

/**
 * Every half hour in waking hours: where both sides are online and neither
 * knows it, tell them both.
 *
 * Deliberately narrow. It only fires where there is a driver AND a passenger,
 * it says only how many of the other side are there, and an area is left alone
 * for four hours afterwards — a push that arrives twice is an uninstall. The
 * owner can turn the whole thing off from the ONLINE box (`enabled: false`).
 *
 * Not in lib/jobSleep's list: it runs sixteen times a day, and its whole job is
 * to find the people the sleeper is watching for anyway.
 */
export async function runAreaAlerts(nowMs: number): Promise<number> {
  const ref = db.doc(ALERTS_DOC);
  const stamps = await ref.get();
  if (stamps.get('enabled') === false) return 0;

  const { drivers, passengers, areas } = await readOnlineNow(nowMs);
  // One nested map, not dotted keys: `set` stores "sent.x" as a field with a
  // dot in its name, where `update` would have read it as a path. Merge writes
  // only the areas told this run, so parallel areas never clobber each other.
  const was = (stamps.get('sent') ?? {}) as Record<string, number>;
  const sentStamps: Record<string, number> = {};
  let told = 0;

  for (const row of matchedAreas(areas)) {
    const key = areaKey(row.area);
    const last = was[key];
    if (typeof last === 'number' && nowMs - last < ALERT_COOLDOWN_MS) continue;

    const riders = passengers.filter((p) => p.area === row.area);
    const cars = drivers.filter((d) => d.area === row.area);

    await Promise.all([
      ...riders.map((p) =>
        notifyUser(
          p.uid,
          `${row.drivers} ${row.drivers === 1 ? 'driver is' : 'drivers are'} online in ${row.area}`,
          'A car near you is free right now. Book a ride and one of them will take it.',
          'promo',
        ),
      ),
      ...cars.map((d) =>
        notifyUser(
          d.uid,
          `${row.passengers} ${row.passengers === 1 ? 'person is' : 'people are'} using the app in ${row.area}`,
          'People near you are looking at rides right now. Stay online — a request is likely.',
          'promo',
        ),
      ),
    ]);

    sentStamps[key] = nowMs;
    told += riders.length + cars.length;
  }

  if (Object.keys(sentStamps).length > 0) await ref.set({ sent: sentStamps }, { merge: true });
  return told;
}

export const sweepAreaAlerts = onSchedule(
  // Waking hours only, Pakistan time: a push at 4am costs more than the ride it wins.
  { schedule: '*/30 7-21 * * *', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    const told = await runAreaAlerts(Date.now());
    if (told > 0) logger.info('sweepAreaAlerts: told people about each other', { told });
  },
);
