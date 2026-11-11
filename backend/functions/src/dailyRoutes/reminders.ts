/**
 * "Time to book your ride" — the reminder before a saved route's own time.
 * ---------------------------------------------------------------------------
 * The owner (2026-11-11), on My Routes: a rider sets the time they go and the
 * time they come back home, and "user ko auto reminder b chala jaye k is time
 * ride book krni ya is time tumary area mai passengers ja rahy ride book hai
 * tum b book kr lo" — remind them when their time comes round, and tell them
 * when people are already going their way.
 *
 * Until now the only daily-route alert was reactive: `notifyDailyRouteMatches`
 * fires when somebody else opens a pool on your route. That never reaches the
 * rider who is the FIRST to want the trip, which at our volume is most of them
 * — nobody opens a pool, so nobody is told, so nobody books. This is the other
 * half: the clock itself is the trigger.
 *
 * WHAT IT DOES
 * Every quarter of an hour it looks for saved routes whose time is coming up
 * inside LEAD_MIN, and pushes each rider once. The push counts the shared rides
 * already running their way, because "3 rides are going your way" is a reason
 * to tap and "it is 8:40" is not.
 *
 * WHAT IT IS CAREFUL ABOUT
 *  - A schedule, never a document trigger: one onDocument* in this codebase
 *    blocks every deploy (see the Eventarc note in CLAUDE.md / index.ts).
 *  - Once per route per Pakistan day, written on the route as `remindedOn`, so
 *    a rider who opens the app at 8:45 is not reminded twice and a retry of the
 *    job sends nothing.
 *  - `notify === false` is the rider saying no. It is honoured here exactly as
 *    `routeMatchesPool` honours it.
 *  - A route with no time has no reminder: there is no moment to pick.
 *  - It is not in SLEEPY_JOBS. Like runScheduledRides, its work is a time on a
 *    clock rather than somebody being in the app — a sleeping reminder is a
 *    reminder that never arrives.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, SCHEDULE_REGION } from '../lib/firebase';
import { notifyUser } from '../lib/fcm';
import { areaLabel } from './travelAreas';

/** How long before their time a rider is reminded. Wider than the job's period, so no route is skipped. */
export const LEAD_MIN = 20;

/** A route's rides count as "going your way" within this many km of both its ends. */
const MATCH_KM = 3;

/** The id of the "home again" leg the ride-sharing screen writes (apps/mobile daily-travel). */
const BACK_LEG_ID = 'sharingBack';

interface GeoPoint { lat: number; lng: number; address?: string }
interface RouteDoc {
  pickup?: GeoPoint;
  dropoff?: GeoPoint;
  time?: string | null;
  notify?: boolean;
  remindedOn?: string;
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** Minutes since midnight in Asia/Karachi (PKT = UTC+5, no DST). */
export function pktMinutes(now: Date): number {
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
}

/** The Pakistan calendar day, "YYYY-MM-DD" — what `remindedOn` holds. */
export function pktDay(now: Date): string {
  return new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Whether a route saved for `time` is due now: inside the LEAD_MIN before it,
 * wrapping past midnight (a 23:55 route is due at 23:40 and at 00:05's run is
 * not). Anything that is not an "HH:MM" string has no time, so no reminder.
 */
export function reminderDue(time: string | null | undefined, nowMinutes: number): boolean {
  const m = typeof time === 'string' ? HHMM.exec(time) : null;
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return false;
  // How far ahead the route's time is from now, going forwards round the clock.
  const ahead = (at - nowMinutes + 1440) % 1440;
  return ahead <= LEAD_MIN;
}

const km = (a: GeoPoint, b: GeoPoint): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
};

/** The shared rides whose two ends are both near this route's — what "going your way" means. */
export function ridesOnRoute(
  route: { pickup: GeoPoint; dropoff: GeoPoint },
  pools: { pickup?: GeoPoint; dropoff?: GeoPoint }[],
): number {
  return pools.filter(
    (p) =>
      p.pickup &&
      p.dropoff &&
      km(p.pickup, route.pickup) <= MATCH_KM &&
      km(p.dropoff, route.dropoff) <= MATCH_KM,
  ).length;
}

/** "I-8" / "Gulberg" from a saved address, or null when it names no area. */
const place = (p: GeoPoint): string | null => (p.address ? areaLabel(p.address) || null : null);

export const runRouteReminders = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    const now = new Date();
    const nowMinutes = pktMinutes(now);
    const today = pktDay(now);

    const snap = await db.collectionGroup('dailyRoutes').get();
    if (snap.empty) return;

    const due = snap.docs.filter((doc) => {
      const r = doc.data() as RouteDoc;
      return (
        r.notify !== false &&
        !!r.pickup &&
        !!r.dropoff &&
        r.remindedOn !== today &&
        reminderDue(r.time, nowMinutes)
      );
    });
    if (due.length === 0) return;

    // One scan for every due route: what is already running, anywhere.
    // shortcut: 300 active shared rides per run, which is every pool we have;
    // when a city alone passes that, filter by the route's city instead.
    const poolsSnap = await db.collection('sharedPools').where('status', '==', 'active').limit(300).get();
    const pools = poolsSnap.docs.map((d) => d.data() as { pickup?: GeoPoint; dropoff?: GeoPoint });

    let sent = 0;
    for (const doc of due) {
      const r = doc.data() as RouteDoc;
      const uid = doc.ref.parent.parent?.id; // users/{uid}/dailyRoutes/{routeId}
      if (!uid || !r.pickup || !r.dropoff) continue;
      const homeward = doc.id === BACK_LEG_ID;
      const going = ridesOnRoute({ pickup: r.pickup, dropoff: r.dropoff }, pools);
      const from = place(r.pickup);
      const to = place(r.dropoff);
      const trip = from && to ? `${from} to ${to}` : 'your usual trip';
      const title = homeward ? '🏠 Time to book your ride home' : '🚗 Time to book your ride';
      const body =
        going > 0
          ? `${going} shared ${going === 1 ? 'ride is' : 'rides are'} going your way — ${trip}. ` +
            'Tap to take a seat before they fill.'
          : `${trip} is about ${LEAD_MIN} minutes away. Tap to book — anyone going your way can share it.`;
      try {
        await notifyUser(uid, title, body, 'ride', { screen: 'daily-travel' });
        // Stamped only after the push: a failure here must be retried, not swallowed.
        await doc.ref.set({ remindedOn: today }, { merge: true });
        sent++;
      } catch (e) {
        logger.warn('Route reminder failed', { uid, routeId: doc.id, error: e });
      }
    }
    logger.info('Route reminders sent', { due: due.length, sent, pools: pools.length });
  },
);
