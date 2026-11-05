/**
 * Scheduled jobs that sleep while nobody needs them.
 *
 * Measured in November 2026, with no riders on the road, nearly the whole
 * functions bill was schedules waking up to find nothing: every run starts a
 * Cloud Run instance whether there is work or not. A job listed here is paused
 * in Cloud Scheduler while it is idle, so a quiet night costs nothing, and is
 * resumed — and run at once, to catch up — the moment people turn up: a rider
 * on the home screen, a driver starting a shift, someone working in the desk.
 * `costs/sleeper.ts` decides who sleeps; `wake` below is how people wake them.
 *
 * Fails open throughout: when anything is unsure, jobs run.
 */
import { logger } from 'firebase-functions';
import { GoogleAuth } from 'google-auth-library';

import { db, FieldValue, SCHEDULE_REGION } from './firebase';

export type JobGroup = 'ride' | 'desk';

export interface SleepyJob {
  fn: string;
  region: string;
  group: JobGroup;
}

const ASIA = 'asia-south1';

/** Every job that may sleep. A job not listed here always runs. */
export const SLEEPY_JOBS: readonly SleepyJob[] = [
  // Riders and drivers. Never runScheduledRides or runCommuteRideFormation:
  // their work is a time on a clock, not a person in the app.
  { fn: 'runPricingTick', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'sweepDriverGeohashes', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'sweepDriverVerificationJobs', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'sweepPoolDispatch', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'dispatchSharedPools', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'sweepStaleOpenRequests', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'sweepStaleSharedRides', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'refreshTrafficAlerts', region: SCHEDULE_REGION, group: 'ride' },
  { fn: 'promoteTripLocations', region: ASIA, group: 'ride' },
  { fn: 'sweepStuckTrips', region: ASIA, group: 'ride' },
  // The desk. Never the house's own posting (socialDailyContent and friends):
  // it is switched on to run by itself, so it is always in use.
  { fn: 'agentSweep', region: ASIA, group: 'desk' },
  { fn: 'salesSweep', region: ASIA, group: 'desk' },
  { fn: 'studioCreditSweep', region: ASIA, group: 'desk' },
  { fn: 'socialLaunchSweep', region: SCHEDULE_REGION, group: 'desk' },
  { fn: 'storeSalesSync', region: SCHEDULE_REGION, group: 'desk' },
];

/** A group stays awake this long after somebody was last seen using it. */
export const GRACE_MS = 30 * 60_000;
/** One `seen` stamp per instance per this long; well inside GRACE_MS minus the sleeper's 10 minutes. */
const STAMP_EVERY_MS = 5 * 60_000;

/** `seen.{group}`: when a person was last here. `paused`: the jobs asleep now. */
export const JOB_SLEEP = db.doc('system/jobSleep');

/**
 * Which jobs to pause and which to resume. Pure.
 *
 * A job is awake while its group saw somebody within GRACE_MS, or a probe in
 * `busy` — its group's name, or its own — says there is work waiting.
 */
export function planSleep(
  jobs: readonly (SleepyJob & { paused: boolean })[],
  seen: Partial<Record<JobGroup, number>>,
  busy: ReadonlySet<string>,
  nowMs: number,
): { pause: string[]; resume: string[] } {
  const awake = (j: SleepyJob) => nowMs - (seen[j.group] ?? 0) < GRACE_MS || busy.has(j.group) || busy.has(j.fn);
  return {
    pause: jobs.filter((j) => !j.paused && !awake(j)).map((j) => j.fn),
    resume: jobs.filter((j) => j.paused && awake(j)).map((j) => j.fn),
  };
}

// ── Cloud Scheduler ──────────────────────────────────────────────────────────

const API = 'https://cloudscheduler.googleapis.com/v1';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const project = () => process.env.GCLOUD_PROJECT ?? '';
/** The name `firebase deploy` gives an onSchedule function's job. */
const jobName = (j: SleepyJob) => `projects/${project()}/locations/${j.region}/jobs/firebase-schedule-${j.fn}-${j.region}`;

async function call(path: string, method: 'GET' | 'POST'): Promise<unknown> {
  const token = await auth.getAccessToken();
  const res = await fetch(`${API}/${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Each listed job's state in Cloud Scheduler (ENABLED, PAUSED…); a job missing from the map was not found. */
export async function jobStates(): Promise<Map<string, string>> {
  const regions = [...new Set(SLEEPY_JOBS.map((j) => j.region))];
  const lists = (await Promise.all(
    regions.map((r) => call(`projects/${project()}/locations/${r}/jobs?pageSize=500`, 'GET')),
  )) as { jobs?: { name: string; state: string }[] }[];
  const byName = new Map(lists.flatMap((l) => l.jobs ?? []).map((j) => [j.name, j.state]));
  const states = new Map<string, string>();
  for (const j of SLEEPY_JOBS) {
    const state = byName.get(jobName(j));
    if (state) states.set(j.fn, state);
  }
  return states;
}

/** Pause, resume or run each job; returns the ones that worked. Never throws. */
export async function act(fns: readonly string[], verb: 'pause' | 'resume' | 'run'): Promise<string[]> {
  const out = await Promise.allSettled(
    fns.map((fn) => {
      const job = SLEEPY_JOBS.find((j) => j.fn === fn);
      return job ? call(`${jobName(job)}:${verb}`, 'POST') : Promise.reject(new Error('not a sleepy job'));
    }),
  );
  out.forEach((o, i) => {
    if (o.status === 'rejected') logger.warn('jobSleep: a scheduler call failed', { fn: fns[i], verb, error: String(o.reason) });
  });
  return fns.filter((_, i) => out[i].status === 'fulfilled');
}

/** Resume the jobs and run each at once, so nothing waits for its next slot. */
export async function resumeNow(fns: readonly string[]): Promise<string[]> {
  const resumed = await act(fns, 'resume');
  await act(resumed, 'run');
  return resumed;
}

// ── People ───────────────────────────────────────────────────────────────────

const stampedAt: Partial<Record<JobGroup, number>> = {};

/**
 * Somebody is here: keep `group`'s jobs awake, and wake them if they sleep.
 *
 * Costs nothing on most calls — one stamp per instance per five minutes, and
 * the Scheduler calls only when the group was actually asleep. Never throws:
 * a failed wake is retried by the sleeper, which also sees the work itself.
 */
export async function wake(group: JobGroup): Promise<void> {
  const now = Date.now();
  if (now - (stampedAt[group] ?? 0) < STAMP_EVERY_MS) return;
  stampedAt[group] = now;
  try {
    // Stamp, then read. The sleeper re-reads the stamp after it pauses, so
    // whichever of the two goes second sees the other and the jobs end awake.
    await JOB_SLEEP.set({ seen: { [group]: now } }, { merge: true });
    const paused = ((await JOB_SLEEP.get()).get('paused') as string[] | undefined) ?? [];
    const mine = paused.filter((fn) => SLEEPY_JOBS.some((j) => j.fn === fn && j.group === group));
    if (!mine.length) return;
    const resumed = await resumeNow(mine);
    if (resumed.length) await JOB_SLEEP.update({ paused: FieldValue.arrayRemove(...resumed) });
    logger.info('jobSleep: woken', { group, resumed });
  } catch (e) {
    stampedAt[group] = 0;
    logger.warn('jobSleep: wake failed', { group, error: (e as Error).message });
  }
}

/** Whether the sleeper has `fn` paused, for checks that would otherwise read its silence as a fault. */
export async function isAsleep(fn: string): Promise<boolean> {
  return (((await JOB_SLEEP.get()).get('paused') as string[] | undefined) ?? []).includes(fn);
}
