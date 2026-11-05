/**
 * Every ten minutes: put to sleep the scheduled jobs nobody needs, and wake the
 * ones that have work again. What may sleep, and why, is in lib/jobSleep.ts.
 *
 * A job is awake while people were seen using its side of the app in the last
 * half hour (`wake` stamps that), or while a probe below finds work it would
 * act on. Each probe is the job's own query, minus nothing and plus a little
 * look-ahead, so a sleeping job never has work waiting that it would have done.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { agentsHaveWork } from '../agents';
import { VERIFICATION_JOBS } from '../drivers/verification';
import { db, SCHEDULE_REGION, Timestamp } from '../lib/firebase';
import { act, GRACE_MS, JOB_SLEEP, jobStates, planSleep, resumeNow, SLEEPY_JOBS, type JobGroup } from '../lib/jobSleep';
import { POOL_REQUEST_EXPIRE_GRACE_MS, POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS, POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS } from '../poolRides/lifecycle';
import { SWEEPABLE_REQUEST_STATUSES, SWEEPABLE_RIDE_STATUSES } from '../poolRides/sweepStaleSharedRides';
import { loadPricingConfig, ZONE_COLLECTION } from '../pricing/config';
import { salesHasWork } from '../sales';
import { launchHasWork } from '../social/launch';
import { storeConnected } from '../social/store';
import { forEachWorkspace } from '../social/workspace';
import type { Needs } from '../studio/plans';

/** Work due within this counts as work now: longer than the ten minutes between runs. */
const SOON_MS = 15 * 60_000;
/** A driver heard from within this is really working. The QA agent draws the same line. */
const DRIVER_FRESH_MS = 30 * 60_000;

type Seen = Partial<Record<JobGroup, number>>;

const any = async (q: FirebaseFirestore.Query) => !(await q.limit(1).get()).empty;

/** Anything a ride job would act on now or within SOON_MS. */
async function rideHasWork(now: number): Promise<boolean> {
  const soon = now + SOON_MS;
  const { peak } = await loadPricingConfig();
  const found = await Promise.all([
    // `online` alone is not enough: two drivers have sat online since July.
    db.collection('drivers').where('online', '==', true).select('lastSeenAt').limit(5000).get()
      .then((s) => s.docs.some((d) => now - ((d.get('lastSeenAt') as Timestamp | undefined)?.toMillis() ?? 0) < DRIVER_FRESH_MS)),
    any(db.collection('openRequests')),
    any(db.collection('trips').where('status', '==', 'in_progress')),
    any(db.collection(VERIFICATION_JOBS).where('status', '==', 'queued')),
    any(db.collection('poolRideRequests').where('status', '==', 'open').where('dispatch.offerExpiresAt', '<=', soon).orderBy('dispatch.offerExpiresAt')),
    any(db.collection('poolRideRequests').where('status', 'in', SWEEPABLE_REQUEST_STATUSES)
      .where('expiresAt', '<', new Date(soon - POOL_REQUEST_EXPIRE_GRACE_MS)).orderBy('expiresAt')),
    any(db.collection('poolRides').where('status', 'in', SWEEPABLE_RIDE_STATUSES)
      .where('departureTime', '<', new Date(soon - POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS)).orderBy('departureTime')),
    any(db.collection('poolRides').where('status', 'in', SWEEPABLE_RIDE_STATUSES)
      .where('createdAt', '<', new Date(soon - POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS)).orderBy('createdAt')),
    ...(['dispatchAt', 'noDriverCheckAt', 'autoStartAt'] as const).map((f) =>
      any(db.collection('sharedPools').where(f, '<=', Timestamp.fromMillis(soon)))),
    // Every tick re-stamps the zones it priced, so a warm zone alone is not
    // work: only a surge, a freeze or a queue would go wrong without the next tick.
    db.collection(ZONE_COLLECTION).where('updatedAt', '>=', now - peak.staleAfterSec * 1000).select('multiplier', 'freeze', 'queue').get()
      .then((s) => s.docs.some((d) =>
        Number(d.get('multiplier') ?? 1) > 1.001 ||
        Number(d.get('freeze.until') ?? 0) > now ||
        ((d.get('queue') as unknown[] | undefined)?.length ?? 0) > 0)),
  ]);
  return found.some(Boolean);
}

/** Whether `has` finds work in any workspace the job itself would visit. Unsure counts as yes. */
async function anyWorkspace(need: Needs, has: () => Promise<boolean>): Promise<boolean> {
  let found = false;
  await forEachWorkspace(need, async () => {
    if (!found) found = await has().catch(() => true);
  });
  return found;
}

/** Group names and job names with work waiting. A probe that fails counts as work. Exported for a dry run against prod. */
export async function whoIsBusy(now: number): Promise<Set<string>> {
  const probes: Record<string, () => Promise<boolean>> = {
    ride: () => rideHasWork(now),
    agentSweep: () => anyWorkspace('sales', agentsHaveWork),
    salesSweep: () => anyWorkspace('sales', salesHasWork),
    studioCreditSweep: () => any(db.collection('workspaces').where('creditDays', '>', 0)),
    socialLaunchSweep: () => anyWorkspace('any', launchHasWork),
    storeSalesSync: () => anyWorkspace('ads', storeConnected),
  };
  const busy = new Set<string>();
  await Promise.all(
    Object.entries(probes).map(async ([key, probe]) => {
      const has = await probe().catch((e: Error) => {
        logger.warn('jobSleep: a probe failed, so its jobs stay awake', { key, error: e.message });
        return true;
      });
      if (has) busy.add(key);
    }),
  );
  return busy;
}

export const sleepIdleJobs = onSchedule(
  { schedule: 'every 10 minutes', region: SCHEDULE_REGION, timeoutSeconds: 120 },
  async () => {
    const now = Date.now();
    const [states, state, busy] = await Promise.all([jobStates(), JOB_SLEEP.get(), whoIsBusy(now)]);
    const missing = SLEEPY_JOBS.filter((j) => !states.has(j.fn)).map((j) => j.fn);
    if (missing.length) logger.warn('jobSleep: jobs not found in Cloud Scheduler', { missing });

    const jobs = SLEEPY_JOBS.filter((j) => states.has(j.fn)).map((j) => ({ ...j, paused: states.get(j.fn) === 'PAUSED' }));
    const wasPaused = jobs.filter((j) => j.paused).map((j) => j.fn);
    const { pause, resume } = planSleep(jobs, (state.get('seen') ?? {}) as Seen, busy, now);

    // Listed before pausing, so a wake that lands mid-way finds them and resumes them.
    if (pause.length) await JOB_SLEEP.set({ paused: [...wasPaused, ...pause] }, { merge: true });
    const slept = await act(pause, 'pause');
    const woke = await resumeNow(resume);
    let paused = wasPaused.filter((fn) => !woke.includes(fn)).concat(slept);

    // Somebody arrived while this ran: their group goes straight back up.
    const seenNow = ((await JOB_SLEEP.get()).get('seen') ?? {}) as Seen;
    const late = paused.filter((fn) => {
      const group = SLEEPY_JOBS.find((j) => j.fn === fn)?.group;
      return group !== undefined && Date.now() - (seenNow[group] ?? 0) < GRACE_MS;
    });
    const rewoke = late.length ? await resumeNow(late) : [];
    paused = paused.filter((fn) => !rewoke.includes(fn));

    await JOB_SLEEP.set({ paused, checkedAtMs: now }, { merge: true });
    if (slept.length || woke.length || rewoke.length) {
      logger.info('jobSleep: changed', { slept, woke: [...woke, ...rewoke], busy: [...busy], asleep: paused });
    }
  },
);
