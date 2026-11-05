import { describe, expect, it } from 'vitest';

import { GRACE_MS, planSleep, SLEEPY_JOBS } from '../jobSleep';

const NOW = 1_800_000_000_000;
const job = (fn: string, group: 'ride' | 'desk', paused = false) => ({ fn, region: 'us-central1', group, paused });

describe('planSleep', () => {
  it('puts a whole quiet group to sleep', () => {
    const jobs = [job('runPricingTick', 'ride'), job('agentSweep', 'desk')];
    expect(planSleep(jobs, {}, new Set(), NOW)).toEqual({ pause: ['runPricingTick', 'agentSweep'], resume: [] });
  });

  it('keeps a group awake for the grace after somebody was seen, then lets it sleep', () => {
    const jobs = [job('runPricingTick', 'ride')];
    expect(planSleep(jobs, { ride: NOW - GRACE_MS + 1 }, new Set(), NOW).pause).toEqual([]);
    expect(planSleep(jobs, { ride: NOW - GRACE_MS }, new Set(), NOW).pause).toEqual(['runPricingTick']);
  });

  // A driver online with the app in the background calls nothing, but is work.
  it('keeps the group awake while its probe finds work, even with nobody seen', () => {
    const jobs = [job('runPricingTick', 'ride'), job('sweepDriverGeohashes', 'ride', true)];
    expect(planSleep(jobs, {}, new Set(['ride']), NOW)).toEqual({ pause: [], resume: ['sweepDriverGeohashes'] });
  });

  it('wakes only the desk job that has work, not its whole group', () => {
    const jobs = [job('agentSweep', 'desk', true), job('salesSweep', 'desk', true)];
    expect(planSleep(jobs, {}, new Set(['salesSweep']), NOW)).toEqual({ pause: [], resume: ['salesSweep'] });
  });

  it('never touches a job already where it should be', () => {
    const jobs = [job('agentSweep', 'desk', true), job('runPricingTick', 'ride')];
    expect(planSleep(jobs, { ride: NOW }, new Set(), NOW)).toEqual({ pause: [], resume: [] });
  });
});

describe('SLEEPY_JOBS', () => {
  // These run on a clock or for the house desk on purpose; sleeping them would
  // miss a booked ride or stop Velocity's own posting.
  it('never lists a job whose work is a time on a clock or the house posting', () => {
    const names = SLEEPY_JOBS.map((j) => j.fn);
    for (const fn of ['runScheduledRides', 'runCommuteRideFormation', 'socialDailyContent', 'socialPublishSweep', 'sweepDashcamClips', 'coarsenTravelMateLocations']) {
      expect(names).not.toContain(fn);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});
