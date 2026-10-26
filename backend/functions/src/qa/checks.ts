/**
 * The testing agent's eyes: invariants that must hold if the features work.
 * ----------------------------------------------------------------------------
 * WHAT A CHECK IS
 * Not a unit test. A unit test proves the code does what the code says on a
 * machine with no users on it. These run against PRODUCTION data and ask a
 * different question: given what is in the database right now, is this feature
 * keeping its promise to the people using it?
 *
 * Every check here corresponds to a real failure this product has had, and each
 * one looks for the EVIDENCE that failure leaves behind:
 *
 *   a trip nobody can see            · a booking that never reached a driver
 *   an open request with a dead trip · drivers sent to pickups that ended
 *   activeTripId pointing nowhere    · a rider locked out of booking for ever
 *   a pool member who is not a rider · a seat carried for free, unbilled
 *   an online driver with no cell    · working a shift while invisible
 *   a daily job that did not run     · a feature that died without an error
 *   a message nobody answered        · the one rule Rapid Response has
 *   alerts held but shown to nobody  · a courtesy feature silently switched off
 *
 * THE CHECKS THAT MATTER MOST ARE THE ONES THE PHONE CANNOT MAKE
 * A call built never to fail — `getTrafficAlerts` answers {ok:true} with empty
 * lists when the alerts are unreadable, so a road alert can never stop somebody
 * booking a ride — is invisible to the app-side watcher by construction. The
 * app sees a fast, successful, empty response whether the feature is healthy or
 * completely dead. Those features are proved HERE or not at all. When you add
 * one, give it an agent check and keep its id out of CALLABLE_FEATURE in the
 * mobile watcher, so nobody reads "no reports" as "no problem".
 *
 * RULES EVERY CHECK FOLLOWS
 *  1. BOUNDED. Every query has a limit. The agent runs forever; a check whose
 *     cost grows with the size of the business would eventually cost more than
 *     the bugs it finds.
 *  2. GRACE PERIODS. Nothing is flagged until it is old enough that the normal
 *     mechanism has had its chance — the five-minute sweep gets three runs
 *     before its leftovers count as a problem. A check that races the system it
 *     watches reports noise, and noise is how a log stops being read.
 *  3. SILENT WHEN HEALTHY. A pass returns null and writes nothing at all.
 *  4. NEVER FATAL. The runner isolates each check; one broken query cannot stop
 *     the agent, and the failure is reported as the agent's own.
 *
 * ADDING ONE
 * Pick the feature id from features.ts, write the narrowest query that proves
 * the promise broken, return a finding with real document paths as evidence, and
 * give it a cadence. If it cannot be expressed as "this document should not
 * exist in this state", it probably belongs in a unit test instead.
 */
import { auth, db } from '../lib/firebase';
import { showingNow } from '../traffic/functions';
import { TRAFFIC_COLLECTION, type TrafficAlert } from '../traffic/types';
import type { QaFailureKind, QaSeverity } from './features';
import type { QaEvidence } from './log';

export interface QaCheckFinding {
  kind: QaFailureKind;
  /** One sentence, written for somebody who has not seen the query. */
  whatHappened: string;
  evidence: QaEvidence;
  severity?: QaSeverity;
}

export interface QaCheck {
  id: string;
  /** The feature whose promise this check proves or disproves. */
  featureId: string;
  title: string;
  /**
   * How often it is worth running, in minutes. The agent wakes every 15; a
   * check with a longer cadence is skipped until its time comes round, which is
   * what keeps a daily database-wide question from being asked 96 times a day.
   */
  everyMin: number;
  run(now: Date): Promise<QaCheckFinding | null>;
}

/** Statuses that mean a trip is still live and somebody is waiting on it. */
const CARRYING = ['matched', 'arriving', 'arrived', 'in_progress'] as const;
/** Statuses that mean a trip is over, whatever else is still pointing at it. */
const FINISHED = new Set(['completed', 'cancelled', 'merged']);

const MIN = 60_000;
const paths = (collection: string, ids: string[]) => ids.map((id) => `${collection}/${id}`);

export const QA_CHECKS: readonly QaCheck[] = [
  // ── A booking that no driver can see ───────────────────────────────────────
  {
    id: 'requests.feed.mirror',
    featureId: 'booking.request',
    title: 'Every open ride request reaches the driver feed',
    everyMin: 15,
    async run(now) {
      // `openRequests` is the driver-readable mirror of a trip, written in the
      // same transaction that creates it. Three minutes is far longer than that
      // transaction takes, so a trip still missing its mirror is not a race.
      const snap = await db
        .collection('trips')
        .where('status', '==', 'requested')
        .where('createdAt', '<', new Date(now.getTime() - 3 * MIN))
        .orderBy('createdAt', 'desc')
        .limit(60)
        .get();
      if (snap.empty) return null;

      const missing: string[] = [];
      const mirrors = await db.getAll(
        ...snap.docs.map((d) => db.doc(`openRequests/${d.id}`)),
        { fieldMask: ['tripId'] },
      );
      mirrors.forEach((m, i) => {
        if (!m.exists) missing.push(snap.docs[i]!.id);
      });
      if (missing.length === 0) return null;

      return {
        kind: 'no_effect',
        whatHappened: `${missing.length} ride request${missing.length === 1 ? '' : 's'} ${
          missing.length === 1 ? 'has' : 'have'
        } been waiting more than three minutes with no entry in the driver feed at all, so no driver can see ${
          missing.length === 1 ? 'it' : 'them'
        }. The rider is watching a screen that says we are looking for a driver.`,
        evidence: {
          detail: { examined: String(snap.size), invisible: String(missing.length) },
          samples: paths('trips', missing),
        },
      };
    },
  },

  // ── Dead rides still in the feed ───────────────────────────────────────────
  {
    id: 'requests.feed.orphans',
    featureId: 'driver.feed',
    title: 'The driver feed holds nothing that has already ended',
    everyMin: 30,
    async run(now) {
      // sweepStaleOpenRequests runs every five minutes, so anything older than
      // fifteen has survived three sweeps and is a real leak rather than a lag.
      const snap = await db
        .collection('openRequests')
        .where('createdAt', '<', new Date(now.getTime() - 15 * MIN))
        .limit(60)
        .get();
      if (snap.empty) return null;

      const trips = await db.getAll(
        ...snap.docs.map((d) => db.doc(`trips/${(d.get('tripId') as string) ?? d.id}`)),
        { fieldMask: ['status'] },
      );
      const orphans: string[] = [];
      trips.forEach((t, i) => {
        const status = t.exists ? (t.get('status') as string) : null;
        if (status === null || status !== 'requested') orphans.push(snap.docs[i]!.id);
      });
      if (orphans.length === 0) return null;

      return {
        kind: 'wrong_result',
        whatHappened: `${orphans.length} request${orphans.length === 1 ? '' : 's'} in the driver feed point${
          orphans.length === 1 ? 's' : ''
        } at a trip that is finished, cancelled or gone. A driver who taps one drives to a pickup where nobody is waiting.`,
        evidence: {
          detail: { examined: String(snap.size), dead: String(orphans.length) },
          samples: paths('openRequests', orphans),
        },
      };
    },
  },

  // ── Locked out of booking by a ride that is over ───────────────────────────
  {
    id: 'users.activeTrip.dangling',
    featureId: 'booking.request',
    title: 'Nobody is held by a pointer to a finished ride',
    everyMin: 60,
    async run() {
      // The backend refuses a second active trip, so a stale pointer does not
      // degrade booking — it removes it entirely, silently, for that person.
      const snap = await db
        .collection('users')
        .where('activeTripId', '!=', null)
        .limit(150)
        .get();
      if (snap.empty) return null;

      const trips = await db.getAll(
        ...snap.docs.map((d) => db.doc(`trips/${d.get('activeTripId') as string}`)),
        { fieldMask: ['status'] },
      );
      const stuck: string[] = [];
      trips.forEach((t, i) => {
        const status = t.exists ? (t.get('status') as string) : null;
        if (status === null || FINISHED.has(status)) stuck.push(snap.docs[i]!.id);
      });
      if (stuck.length === 0) return null;

      return {
        kind: 'wrong_result',
        whatHappened: `${stuck.length} ${
          stuck.length === 1 ? 'person' : 'people'
        } cannot book a ride: their activeTripId points at a trip that is over or no longer exists, and the backend refuses a second active trip. To them the app simply says they already have a ride.`,
        evidence: {
          detail: { examined: String(snap.size), lockedOut: String(stuck.length) },
          samples: paths('users', stuck),
        },
        severity: 'blocker',
      };
    },
  },

  // ── Trips that never ended ────────────────────────────────────────────────
  {
    id: 'trips.stuck',
    featureId: 'driver.trip.progress',
    title: 'No trip is left mid-ride for hours',
    everyMin: 60,
    async run(now) {
      // Six hours is longer than any honest ride in these cities, including the
      // intercity ones, so this is about trips that stopped progressing rather
      // than trips that are simply long.
      const cutoff = new Date(now.getTime() - 6 * 60 * MIN);
      const stuck: string[] = [];
      for (const status of CARRYING) {
        const snap = await db
          .collection('trips')
          .where('status', '==', status)
          .where('createdAt', '<', cutoff)
          .orderBy('createdAt', 'desc')
          .limit(25)
          .get();
        stuck.push(...snap.docs.map((d) => d.id));
      }
      if (stuck.length === 0) return null;

      return {
        kind: 'no_effect',
        whatHappened: `${stuck.length} trip${stuck.length === 1 ? ' is' : 's are'} still mid-ride after six hours. Each one holds activeTripId on both sides, so that rider cannot book and that driver cannot take another ride.`,
        evidence: {
          detail: { stuck: String(stuck.length) },
          samples: paths('trips', stuck),
        },
      };
    },
  },

  // ── A seat in the car that nobody is billing ──────────────────────────────
  {
    id: 'pool.riders.unbilled',
    featureId: 'shared.join',
    title: 'Everybody aboard a shared ride is priced into it',
    everyMin: 30,
    async run() {
      // A trip carrying en-route riders settles from the leg-split total, so a
      // joiner written into poolMembers but missing from poolRiders rides free
      // and is invisible to the next seat and gender check.
      const snap = await db
        .collection('trips')
        .where('pool', '==', true)
        .where('status', 'in', CARRYING as unknown as string[])
        .limit(80)
        .get();
      if (snap.empty) return null;

      const bad: string[] = [];
      for (const doc of snap.docs) {
        const riders = doc.get('poolRiders') as { uid?: string }[] | undefined;
        if (!Array.isArray(riders) || riders.length === 0) continue; // not leg-split priced
        const members = (doc.get('poolMembers') as string[] | undefined) ?? [];
        const priced = new Set(riders.map((r) => r.uid));
        if (members.some((uid) => !priced.has(uid))) bad.push(doc.id);
      }
      if (bad.length === 0) return null;

      return {
        kind: 'wrong_result',
        whatHappened: `${bad.length} shared ride${
          bad.length === 1 ? ' carries' : 's carry'
        } somebody who is in poolMembers but not in poolRiders. That seat is not in the car total, is not counted by the next pickup's seat check, and is not seen by its gender check.`,
        evidence: {
          detail: { examined: String(snap.size), unbilled: String(bad.length) },
          samples: paths('trips', bad),
        },
      };
    },
  },

  // ── Working a shift while invisible ───────────────────────────────────────
  {
    id: 'drivers.cell.missing',
    featureId: 'driver.online',
    title: 'Every online driver is findable by the nearby lookup',
    everyMin: 15,
    async run(now) {
      const snap = await db.collection('drivers').where('online', '==', true).limit(150).get();
      if (snap.empty) return null;

      const invisible: string[] = [];
      for (const doc of snap.docs) {
        const loc = doc.get('lastLocation') as { lat?: number; lng?: number } | undefined;
        if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
        if (doc.get('geohash')) continue;
        // The sweep stamps cells once a minute and stampDriverCell closes the
        // gap at shift start, so three minutes without one is neither.
        const seen = doc.get('lastSeenAt') as { toDate?: () => Date } | undefined;
        const seenAt = seen?.toDate?.();
        if (!seenAt || now.getTime() - seenAt.getTime() > 30 * MIN) continue; // not really working
        if (now.getTime() - seenAt.getTime() < 3 * MIN) continue; // give the sweep its minute
        invisible.push(doc.id);
      }
      if (invisible.length === 0) return null;

      return {
        kind: 'empty',
        whatHappened: `${invisible.length} driver${
          invisible.length === 1 ? ' is' : 's are'
        } online, moving, and have no geohash cell stamped, so the bounded nearby-driver lookup cannot return them. They are waiting for requests that cannot reach them.`,
        evidence: {
          detail: { online: String(snap.size), invisible: String(invisible.length) },
          samples: paths('drivers', invisible),
        },
      };
    },
  },

  // ── A driver the app opens as a passenger ────────────────────────────────
  {
    id: 'drivers.role.claim',
    featureId: 'driver.online',
    title: 'Every approved driver signs in as a driver',
    everyMin: 360,
    async run() {
      // The role is a custom claim, and a claims write elsewhere can replace it — the old onUserCreate did, in prod.
      const snap = await db.collection('drivers').where('verificationStatus', '==', 'approved').limit(300).get();
      const ids = snap.docs.map((d) => d.id);
      const wrong: string[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { users } = await auth.getUsers(ids.slice(i, i + 100).map((uid) => ({ uid })));
        for (const u of users) if (!['driver', 'admin'].includes(u.customClaims?.role as string)) wrong.push(u.uid);
      }
      if (!wrong.length) return null;

      return {
        kind: 'wrong_result',
        whatHappened: `${wrong.length} approved driver${
          wrong.length === 1 ? ' does' : 's do'
        } not carry the driver role, so the app opens the passenger side for them and the rules refuse every driver action.`,
        evidence: {
          detail: { approved: String(snap.size), withoutRole: String(wrong.length) },
          samples: paths('drivers', wrong.slice(0, 10)),
        },
      };
    },
  },

  // ── A daily job that quietly stopped ─────────────────────────────────────
  {
    id: 'pricing.fuel.daily',
    featureId: 'booking.fare.quote',
    title: 'The fuel price was established this morning',
    everyMin: 180,
    async run(now): Promise<QaCheckFinding | null> {
      const snap = await db.doc('fuelPrices/current').get();
      const lastRun = snap.get('lastRun') as
        | { ranAt?: number; degraded?: boolean; sources?: { sourceId: string; rows: number; error?: string }[] }
        | undefined;

      if (!snap.exists || typeof lastRun?.ranAt !== 'number') {
        return {
          kind: 'no_effect',
          whatHappened:
            'fuelPrices/current has no record of the daily fuel job ever running, so fares are being priced from whatever the engine last believed — with nothing saying when that was.',
          evidence: { detail: { doc: 'fuelPrices/current' } },
        };
      }

      const ageH = Math.round((now.getTime() - lastRun.ranAt) / 3_600_000);
      // The job runs at 06:00 PKT. Past 26 hours it has missed a day outright.
      if (ageH > 26) {
        return {
          kind: 'no_effect',
          whatHappened: `The daily fuel job last ran ${ageH} hours ago, so it has missed at least one morning. Fares do not move on a day the engine cannot establish a price — including moving back down.`,
          evidence: { detail: { lastRanHoursAgo: String(ageH) } },
        };
      }

      if (lastRun.degraded === true) {
        const failed = (lastRun.sources ?? [])
          .filter((s) => s.error || s.rows === 0)
          .map((s) => `${s.sourceId}: ${s.error ?? 'no rows'}`);
        return {
          kind: 'empty',
          whatHappened:
            'The fuel job ran and could not confirm a single product, so the pricing engine has no fresh price to work from. Remember PSO lags OGRA by a day and must never be the only source that votes.',
          evidence: {
            detail: { lastRanHoursAgo: String(ageH) },
            samples: failed.slice(0, 6),
          },
        };
      }
      return null;
    },
  },

  // ── A feature that is built never to fail ────────────────────────────────
  // getTrafficAlerts answers {ok:true} with empty lists when the alerts cannot
  // be read, on purpose: a road alert must never stop somebody booking a ride.
  // That makes it invisible to the app-side watcher — a successful empty call
  // looks the same whether the feature is healthy or dead — so the only honest
  // signal is here, against the server's own state.
  {
    id: 'traffic.refresh.silent',
    featureId: 'platform.traffic',
    title: 'The road-alert refresh is still running',
    everyMin: 180,
    async run(now): Promise<QaCheckFinding | null> {
      const snap = await db.doc('adminConfig/trafficRun').get();
      const ranAt = snap.get('ranAt') as number | undefined;

      if (!snap.exists || typeof ranAt !== 'number') {
        return {
          kind: 'no_effect',
          whatHappened:
            'There is no record of the road-alert refresh ever running, so whatever riders are being shown is whatever happened to be stored — with nothing saying when.',
          evidence: { detail: { doc: 'adminConfig/trafficRun' } },
        };
      }

      // It runs every 20 minutes. Two hours is six missed runs, not a blip.
      const ageMin = Math.round((now.getTime() - ranAt) / MIN);
      if (ageMin > 120) {
        return {
          kind: 'no_effect',
          whatHappened: `The road-alert refresh last ran ${ageMin} minutes ago, so it has missed at least six runs. Alerts are ageing out and nothing is replacing them.`,
          evidence: { detail: { lastRanMinutesAgo: String(ageMin) } },
        };
      }

      if (snap.get('degraded') === true) {
        const sources = (snap.get('sources') as { sourceId: string; items: number; error?: string }[] | undefined) ?? [];
        return {
          kind: 'empty',
          whatHappened:
            'The last road-alert run read nothing at all — every feed failed. One or two failing is ordinary and is why there are fourteen of them; all of them failing is not.',
          evidence: {
            detail: { lastRanMinutesAgo: String(ageMin) },
            samples: sources
              .filter((s) => s.error || s.items === 0)
              .map((s) => `${s.sourceId}: ${s.error ?? 'nothing read'}`),
          },
        };
      }
      return null;
    },
  },
  {
    id: 'traffic.window.gate',
    featureId: 'platform.traffic',
    title: 'Road alerts we are holding are reaching somebody',
    everyMin: 60,
    async run(now) {
      const ms = now.getTime();
      const live = await db
        .collection(TRAFFIC_COLLECTION)
        .where('expiresAt', '>', ms)
        .limit(500)
        .get();
      // Holding alerts for an event that has not started yet is the window
      // feature working, so a handful showing nothing is normal and a quiet
      // night would trip a tighter rule. Five unexpired alerts with not one of
      // them visible is the shape of the gate misreading hours.
      if (live.size < 5) return null;
      const showing = live.docs.filter((d) => showingNow(d.data() as TrafficAlert, ms)).length;
      if (showing > 0) return null;

      return {
        kind: 'no_effect',
        whatHappened: `We are holding ${live.size} unexpired road alerts and not one of them is being shown to anybody. Either every single one is for a time that has not come yet, or the window gate is reading the hours wrongly and the whole feature is silently off.`,
        evidence: {
          detail: { liveAlerts: String(live.size), showingNow: '0' },
          samples: live.docs.slice(0, 6).map((d) => `${TRAFFIC_COLLECTION}/${d.id}`),
        },
      };
    },
  },

  // ── The one rule Rapid Response has ──────────────────────────────────────
  {
    id: 'support.unanswered',
    featureId: 'safety.support',
    title: 'Nobody is left waiting for a human',
    everyMin: 30,
    async run(now) {
      // waiting_human means the AI has stepped aside and a person owes them an
      // answer. Forty-five minutes is already a long time to be ignored.
      const snap = await db
        .collection('supportTickets')
        .where('status', '==', 'waiting_human')
        .where('lastAt', '<', new Date(now.getTime() - 45 * MIN))
        .orderBy('lastAt', 'asc')
        .limit(40)
        .get();
      if (snap.empty) return null;

      const oldest = snap.docs[0]!.get('lastAt') as { toDate?: () => Date } | undefined;
      const waitedMin = oldest?.toDate
        ? Math.round((now.getTime() - oldest.toDate().getTime()) / MIN)
        : null;

      return {
        kind: 'no_effect',
        whatHappened: `${snap.size} support ticket${
          snap.size === 1 ? ' has' : 's have'
        } been waiting for a human for more than 45 minutes${
          waitedMin ? `; the oldest has waited ${waitedMin} minutes` : ''
        }. A message is never left unanswered — that is the whole promise of Rapid Response.`,
        evidence: {
          detail: { waiting: String(snap.size), ...(waitedMin ? { oldestWaitMin: String(waitedMin) } : {}) },
          samples: paths('supportTickets', snap.docs.map((d) => d.id)),
        },
        severity: 'blocker',
      };
    },
  },

  // ── Somebody asked for help and nothing happened ─────────────────────────
  {
    id: 'safety.events.open',
    featureId: 'safety.sos',
    title: 'Every safety alert is picked up',
    everyMin: 15,
    async run(now) {
      const snap = await db
        .collection('safetyEvents')
        .where('status', '==', 'open')
        .where('createdAt', '<', new Date(now.getTime() - 20 * MIN))
        .orderBy('createdAt', 'desc')
        .limit(40)
        .get();
      if (snap.empty) return null;

      return {
        kind: 'no_effect',
        whatHappened: `${snap.size} safety alert${
          snap.size === 1 ? ' has' : 's have'
        } been open for more than twenty minutes with nobody resolving ${
          snap.size === 1 ? 'it' : 'them'
        }. Somebody pressed SOS or reported something on a ride and the desk has not closed the loop.`,
        evidence: {
          detail: { open: String(snap.size) },
          samples: paths('safetyEvents', snap.docs.map((d) => d.id)),
        },
        severity: 'blocker',
      };
    },
  },
];

/**
 * Which checks are due at this instant.
 *
 * The cadence is measured against the minute of the day rather than against the
 * last time each check ran, so it needs no state of its own and cannot drift:
 * a 180-minute check runs at 00:00, 03:00, 06:00 and so on, whatever the agent
 * did yesterday. Everything is due at midnight, which also guarantees each new
 * day's log starts with a complete sweep behind it.
 */
export function checksDueAt(now: Date, wakeEveryMin: number): QaCheck[] {
  const minuteOfDay = Math.floor((now.getTime() + 5 * 3_600_000) / MIN) % 1440;
  return QA_CHECKS.filter((c) => {
    const every = Math.max(wakeEveryMin, Math.round(c.everyMin / wakeEveryMin) * wakeEveryMin);
    return minuteOfDay % every < wakeEveryMin;
  });
}
