/**
 * Serving road alerts to a rider's screen and a driver's route.
 * ----------------------------------------------------------------------------
 * ONE CALLABLE, TWO QUESTIONS
 * ---------------------------
 * A rider asks "anything wrong in my city?" and a driver asks "anything wrong
 * on MY WAY?". They are the same query with a different filter, so they share a
 * callable: pass a point and get your city's alerts, pass a polyline too and
 * get the ones your route actually runs into, measured along the route.
 *
 * WHY THE WHOLE COLLECTION IS READ
 * --------------------------------
 * Because it is tiny. The classifier keeps on the order of one item in a
 * hundred, which on thirteen feeds is a handful of live alerts at any moment,
 * and
 * expired ones are deleted by the run rather than accumulating. One range query
 * on `expiresAt` returns all of them, needs no composite index — and therefore
 * cannot be broken by the index step of a deploy, which is continue-on-error —
 * and the filtering happens in memory where it is exact and free. If this
 * collection ever grows past a few hundred live documents the shape to reach
 * for is a city field in the query, not a cache.
 *
 * NO AUTH BEYOND SIGNED IN
 * ------------------------
 * A road being closed is not anybody's private information; it was in the
 * newspaper. The rate limit is there to stop a loop in a client burning reads,
 * not to protect the content.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { buildCorridor, decodePolyline, projectToCorridor, type LatLng } from '../lib/corridor';
import { db } from '../lib/firebase';
import { requireAdmin, requireAuth } from '../lib/guards';
import { cityFor } from '../locations/registry';
import { runTrafficRefresh, TRAFFIC_RUN_DOC } from './ingest';
import { SEVERITY_RANK, TRAFFIC_COLLECTION, type AlertWindow, type TrafficAlert } from './types';

/**
 * How far off the route an alert may sit and still be "on my way".
 *
 * Added to the alert's own radius, which already encodes how vague we are
 * about where that road is. 1.5 km on top covers a corridor the driver can see
 * from, and the diversions a closure pushes traffic onto.
 */
const ROUTE_SLACK_M = 1_500;

/** A polyline longer than this is not a route anybody is driving today. */
const MAX_POLYLINE_CHARS = 60_000;

/**
 * How far ahead of its own start an alert appears.
 *
 * Not zero, because a rider booking at half past one for a trip through a road
 * that closes at two has to be told at half past one. Ninety minutes is about
 * the longest journey anybody takes inside one of our cities, so an alert is on
 * screen by the time it could affect the ride being booked — and no earlier,
 * which is the whole point of having a window.
 */
const WINDOW_LEAD_MS = 90 * 60 * 1000;

/**
 * The window to judge an alert by.
 *
 * Documents written before windows existed have no `window` field, and the
 * collection is full of them for as long as the oldest live alert survives a
 * deploy. Their publication-to-expiry span IS their old behaviour, so reading
 * it as the window makes them behave exactly as they did yesterday rather than
 * vanishing or appearing at the wrong hour.
 */
const windowOf = (alert: TrafficAlert): AlertWindow =>
  alert.window ?? {
    startsAt: alert.publishedAt,
    endsAt: alert.expiresAt,
    basis: 'kind',
    phrase: null,
  };

/**
 * Is this alert about a problem that is happening, or about to?
 *
 * The one rule the whole window feature comes down to. Exported because it is
 * the thing most worth testing, and because the admin desk counts with it.
 */
export function showingNow(alert: TrafficAlert, now: number): boolean {
  const w = windowOf(alert);
  return now >= w.startsAt - WINDOW_LEAD_MS && now < w.endsAt;
}

const nearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** Optional: the driver's (or rider's) encoded route. */
  polyline: z.string().max(MAX_POLYLINE_CHARS).optional(),
});

/** What a client gets. Deliberately smaller than the stored document. */
export interface TrafficAlertView {
  id: string;
  kind: TrafficAlert['kind'];
  severity: TrafficAlert['severity'];
  headline: string;
  detail: string | null;
  roads: string[];
  cityName: string | null;
  source: { name: string; url: string };
  publishedAt: number;
  /**
   * The hours the story itself gave, when it gave any — so the strip can say
   * "2pm–6pm" and the rider can see why they are being shown this now.
   *
   * Absent on a kind default. A window we inferred from nothing but the kind is
   * not a fact about the road and has no business being displayed as one.
   */
  when?: { startsAt: number; endsAt: number };
  /** Set only when a route was supplied: metres from its start. */
  alongM?: number;
  /** Set only when a route was supplied: metres from the route at its closest. */
  offsetM?: number;
}

/**
 * Every alert that has not expired. The collection is small by construction.
 *
 * `expiresAt` is the end of the alert's window, so this query already drops
 * everything whose problem is over. What it cannot drop is an alert whose
 * window has not OPENED yet — a Friday story about a Sunday closure is stored,
 * unexpired, and must not be shown until Sunday. That half is `showingNow`,
 * applied in memory by the caller, which is also where it is free.
 */
async function liveAlerts(now: number): Promise<TrafficAlert[]> {
  const snap = await db
    .collection(TRAFFIC_COLLECTION)
    .where('expiresAt', '>', now)
    .limit(500)
    .get();
  return snap.docs.map((d) => d.data() as TrafficAlert & { fingerprint?: string });
}

/**
 * One alert per distinct event.
 *
 * Dawn, Geo and Tribune all reporting the same closure is one fact and three
 * documents. The rider gets the most severe telling of it, and the most recent
 * where severity ties, because a later story about the same closure is a later
 * state of it.
 */
export function dedupe(alerts: (TrafficAlert & { fingerprint?: string })[]): TrafficAlert[] {
  const best = new Map<string, TrafficAlert>();
  for (const alert of alerts) {
    const key = alert.fingerprint ?? alert.id;
    const prior = best.get(key);
    if (
      !prior ||
      SEVERITY_RANK[alert.severity] < SEVERITY_RANK[prior.severity] ||
      (alert.severity === prior.severity && alert.publishedAt > prior.publishedAt)
    ) {
      best.set(key, alert);
    }
  }
  return [...best.values()];
}

/** Most serious first, then most recent. The order a rider reads top-down. */
const byUrgency = (a: TrafficAlertView, b: TrafficAlertView): number =>
  SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.publishedAt - a.publishedAt;

const view = (alert: TrafficAlert, extra: Partial<TrafficAlertView> = {}): TrafficAlertView => ({
  id: alert.id,
  kind: alert.kind,
  severity: alert.severity,
  headline: alert.headline,
  detail: alert.detail,
  roads: alert.roads,
  cityName: alert.cityName,
  source: { name: alert.source.name, url: alert.source.url },
  publishedAt: alert.publishedAt,
  ...(alert.window?.basis === 'stated'
    ? { when: { startsAt: alert.window.startsAt, endsAt: alert.window.endsAt } }
    : {}),
  ...extra,
});

/**
 * The alerts a route runs into, each with where along the route it is.
 *
 * Pure, and exported so it can be tested against a real polyline without a
 * network. An alert with no coordinates (a city-wide event naming no road we
 * know) can never match a route — it has nothing to be near — which is correct:
 * "roads blocked across Lahore" belongs on the city strip, not pinned to a
 * kilometre of somebody's journey.
 */
export function alertsOnRoute(
  alerts: TrafficAlert[],
  points: LatLng[],
): TrafficAlertView[] {
  const corridor = buildCorridor(points);
  const out: TrafficAlertView[] = [];

  for (const alert of alerts) {
    let nearest: { alongM: number; offsetM: number } | null = null;

    for (const place of alert.places) {
      const p = projectToCorridor(corridor, { lat: place.lat, lng: place.lng });
      // The alert's own radius is how vague the gazetteer is about that road;
      // the slack is how near counts as on the way. Both have to be allowed
      // for, or a road we have placed with a 9 km radius never matches a route
      // that drives straight down it.
      if (p.offsetM > place.radiusM + ROUTE_SLACK_M) continue;
      if (!nearest || p.offsetM < nearest.offsetM) {
        nearest = { alongM: Math.round(p.alongM), offsetM: Math.round(p.offsetM) };
      }
    }

    if (nearest) out.push(view(alert, nearest));
  }

  // Along the route, in driving order — a driver reads their own journey
  // forwards, not by how bad each thing is.
  return out.sort((a, b) => (a.alongM ?? 0) - (b.alongM ?? 0));
}

/**
 * Road alerts for a point, and optionally for a route from it.
 *
 * `city` is what the booking screen shows: alerts filed to the city the rider
 * is standing in. `route` is what a driver sees: everything their actual
 * polyline runs into, city or motorway, in the order they will meet it.
 */
export const getTrafficAlerts = onCall(async (req) => {
  requireAuth(req);
  const input = nearbySchema.safeParse(req.data);
  if (!input.success) return { ok: true, city: [], route: [], cityName: null };

  const { lat, lng, polyline } = input.data;
  const now = Date.now();

  let alerts: TrafficAlert[];
  try {
    // Filtered BEFORE the dedupe, not after. Three papers report one closure
    // and `dedupe` keeps the most severe telling of it — if that telling's
    // window has not opened yet it would win the group and then be dropped,
    // silently taking a live alert's other two tellings down with it.
    alerts = dedupe((await liveAlerts(now)).filter((a) => showingNow(a, now)));
  } catch (e) {
    // A road alert is a nicety. If the collection cannot be read, the booking
    // screen must still price and book a ride — so this answers empty rather
    // than throwing into the rider's face.
    logger.warn('traffic alerts unreadable', { e });
    return { ok: true, city: [], route: [], cityName: null };
  }

  const city = cityFor({ lat, lng });
  const cityAlerts = city
    ? alerts
        .filter((a) => a.scope === 'city' && a.cityCode === city.code)
        .map((a) => view(a))
        .sort(byUrgency)
    : [];

  let route: TrafficAlertView[] = [];
  if (polyline) {
    try {
      const points = decodePolyline(polyline);
      if (points.length >= 2) route = alertsOnRoute(alerts, points);
    } catch (e) {
      // A polyline we cannot decode costs the route list, not the call.
      logger.warn('traffic route polyline undecodable', { e });
    }
  }

  return {
    ok: true,
    cityName: city?.name ?? null,
    city: cityAlerts.slice(0, 10),
    route: route.slice(0, 10),
  };
});

/** The last run's numbers, and a button to run it now. For the admin desk. */
export const adminGetTrafficRun = onCall(async (req) => {
  requireAdmin(req);
  const now = Date.now();
  const snap = await db.doc(TRAFFIC_RUN_DOC).get();
  const live = await db
    .collection(TRAFFIC_COLLECTION)
    .where('expiresAt', '>', now)
    .limit(500)
    .get();

  // TWO NUMBERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
  //
  // `liveAlerts` is what we are holding; `showingNow` is what a rider can
  // actually see this minute. The gap between them is the window feature
  // working — alerts kept for an event that has not started yet. If `showing`
  // sits at zero while `liveAlerts` climbs, something is reading hours wrongly
  // and nobody is being told anything.
  const showing = live.docs.filter((d) => showingNow(d.data() as TrafficAlert, now)).length;

  return {
    ok: true,
    lastRun: snap.exists ? snap.data() : null,
    liveAlerts: live.size,
    showingNow: showing,
  };
});

export const adminRefreshTrafficAlerts = onCall(async (req) => {
  requireAdmin(req);
  return { ok: true, report: await runTrafficRefresh() };
});
