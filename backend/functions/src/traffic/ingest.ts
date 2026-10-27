/**
 * The traffic run: read the papers, keep almost nothing, store what is left.
 * ----------------------------------------------------------------------------
 * SCHEDULE
 * --------
 * Every 20 minutes. Road events are reported in minutes and matter for hours,
 * so this is the band where the alert is still useful when it lands. Fourteen
 * feeds at twenty-minute intervals is ~1,000 small HTTP requests a day, which
 * is nothing, and the work after the fetch is regex over a few hundred strings.
 *
 * A SCHEDULE, NOT A TRIGGER
 * -------------------------
 * As everywhere else in this backend. A Gen-2 Firestore document trigger runs
 * on Eventarc, the deploy service account cannot grant itself the service-agent
 * roles Eventarc needs, and the deploy then fails taking every unrelated
 * function with it. See the note on `sweepDriverVerificationJobs`.
 *
 * WHAT A RUN MAY DO
 * -----------------
 * Write `trafficAlerts/{id}` and delete expired ones. Nothing else in the
 * product reads from or writes to that collection, so a bad run is undone by
 * emptying one collection, and a run that fetches nothing simply leaves
 * yesterday's alerts to expire on their own clock.
 *
 * IDENTITY
 * --------
 * A document's id is a hash of the story's URL. So the same story re-read on
 * the next run updates its own document instead of multiplying, and the same
 * story carried by two of Dawn's feeds is one alert rather than two.
 * ----------------------------------------------------------------------------
 */
import { createHash } from 'node:crypto';

import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, SCHEDULE_REGION } from '../lib/firebase';
import { classify, type RefusalReason } from './classify';
import { fetchAllSources } from './sources';
import { TRAFFIC_COLLECTION, type TrafficAlert } from './types';

/** Firestore refuses a batch over 500 writes. We will never be near it. */
const MAX_WRITES_PER_RUN = 400;

/** Where the last run's numbers live, for the admin desk. */
export const TRAFFIC_RUN_DOC = 'adminConfig/trafficRun';

/** A story's URL is its identity. Stable across runs, unique across outlets. */
export function alertIdFor(link: string): string {
  return createHash('sha1').update(link.trim().toLowerCase()).digest('hex').slice(0, 24);
}

/**
 * What distinct event an alert is about, regardless of who reported it.
 *
 * Three papers covering one closure are three stories, three URLs and three
 * documents — but one fact, and a rider shown it three times learns nothing the
 * second and third time. Read paths collapse on this. It is stored rather than
 * computed on read so the grouping is auditable: if two alerts collapse that
 * should not have, the field says why.
 */
export function fingerprintFor(alert: Omit<TrafficAlert, 'id' | 'createdAt'>): string {
  const day = new Date(alert.publishedAt).toISOString().slice(0, 10);
  const where = alert.roads.length > 0 ? [...alert.roads].sort().join('|') : (alert.cityCode ?? '?');
  return `${day}:${alert.kind}:${where}`;
}

/**
 * Write the alerts a run decided to keep. Exported so the wiring can be tested
 * against a real Firestore without going anywhere near a newsroom.
 *
 * Returns how many were written.
 */
export async function storeAlerts(
  alerts: TrafficAlert[],
): Promise<number> {
  const writes = alerts.slice(0, MAX_WRITES_PER_RUN);
  if (writes.length > 0) {
    const refs = writes.map((a) => db.doc(`${TRAFFIC_COLLECTION}/${a.id}`));

    // WHICH OF THESE HAVE WE ALREADY GOT?
    //
    // `createdAt` is when WE first saw a story, which is the only honest
    // timestamp we have when a feed's own pubDate is wrong or missing — and
    // `{ merge: true }` does NOT preserve it. Merge keeps fields the new write
    // omits; `createdAt` is in every write, so a run every twenty minutes was
    // resetting "first seen" seventy-two times a day and the field meant
    // nothing. Reading first and omitting `createdAt` for documents that
    // already exist is one small getAll — the live collection is a handful of
    // documents by construction — and it makes the field true.
    const existing = new Set(
      (await db.getAll(...refs, { fieldMask: [] }))
        .filter((d) => d.exists)
        .map((d) => d.id),
    );

    const batch = db.batch();
    for (const alert of writes) {
      const seen = existing.has(alert.id);
      const { createdAt, ...rest } = alert;
      batch.set(
        db.doc(`${TRAFFIC_COLLECTION}/${alert.id}`),
        { ...rest, fingerprint: fingerprintFor(alert), ...(seen ? {} : { createdAt }) },
        { merge: true },
      );
    }
    await batch.commit();
  }

  return Math.min(alerts.length, MAX_WRITES_PER_RUN);
}

export interface TrafficRunReport {
  ranAt: number;
  sources: { sourceId: string; items: number; error?: string }[];
  itemsRead: number;
  kept: number;
  /** Why the rest were refused, counted. The health signal worth watching. */
  refusals: Partial<Record<RefusalReason, number>>;
  expired: number;
  /** True when no feed answered at all — the state worth alerting on. */
  degraded: boolean;
}

/**
 * One run. Returns the report rather than only logging it, so the admin
 * callable can hand a human exactly what the cron saw.
 */
export async function runTrafficRefresh(now: number = Date.now()): Promise<TrafficRunReport> {
  const results = await fetchAllSources();

  const refusals: Partial<Record<RefusalReason, number>> = {};
  const keep = new Map<string, TrafficAlert>();
  let itemsRead = 0;

  for (const result of results) {
    for (const item of result.items) {
      itemsRead++;
      const verdict = classify(item, now);
      if (!verdict.kept || !verdict.alert) {
        const reason = verdict.reason ?? 'no_event';
        refusals[reason] = (refusals[reason] ?? 0) + 1;
        continue;
      }
      const id = alertIdFor(item.link);
      // Two feeds carrying one URL: whichever we see first wins, and they are
      // byte-identical anyway.
      if (!keep.has(id)) keep.set(id, { ...verdict.alert, id, createdAt: now });
    }
  }

  const kept = await storeAlerts([...keep.values()]);

  const expired = await sweepExpired(now);

  const report: TrafficRunReport = {
    ranAt: now,
    sources: results.map((r) => ({
      sourceId: r.sourceId,
      items: r.items.length,
      ...(r.error ? { error: r.error } : {}),
    })),
    itemsRead,
    kept,
    refusals,
    expired,
    degraded: itemsRead === 0,
  };

  await db.doc(TRAFFIC_RUN_DOC).set(report, { merge: true });

  if (report.degraded) {
    logger.warn('traffic run read nothing — every feed failed', { sources: report.sources });
  } else {
    logger.info('traffic run complete', { itemsRead, kept, expired });
  }

  return report;
}

/**
 * Delete alerts whose own expiry has passed.
 *
 * The expiry is per kind and set at classification time — a jam lives three
 * hours, a closure a day. Deleting rather than flagging is deliberate: there is
 * no read path in the product that wants an expired road alert, and a
 * collection that only ever grows is one more thing to pay for and page through.
 */
export async function sweepExpired(now: number = Date.now()): Promise<number> {
  const stale = await db
    .collection(TRAFFIC_COLLECTION)
    .where('expiresAt', '<=', now)
    .limit(MAX_WRITES_PER_RUN)
    .get();

  if (stale.empty) return 0;
  const batch = db.batch();
  stale.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return stale.size;
}

export const refreshTrafficAlerts = onSchedule(
  {
    schedule: 'every 20 minutes',
    timeZone: 'Asia/Karachi',
    region: SCHEDULE_REGION,
    timeoutSeconds: 180,
  },
  async () => {
    await runTrafficRefresh();
  },
);
