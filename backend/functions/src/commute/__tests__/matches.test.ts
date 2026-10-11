/**
 * Matching riders to each other by their commute, not by the clock.
 * ----------------------------------------------------------------------------
 * `getCommuteMatches` is the half of the commute feature that was missing.
 * Schedules were saved by riders and read only by `getCommuteDemand`, which
 * shows DRIVERS where demand is — so two women on an identical daily commute
 * could never learn the other existed.
 *
 * What these tests hold in place:
 *   - the four things that have to agree before two riders share a car (pickup,
 *     destination, time, at least one day),
 *   - that BOTH riders' gender preferences bind, not just the caller's,
 *   - and that nothing identifying ever leaves this function.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { geohashForLocation } from 'geofire-common';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { getCommuteMatches } from '../index';

/** Gulberg, Lahore — everybody's home in these fixtures unless stated. */
const HOME = { lat: 31.5204, lng: 74.3587 };
/** Blue Area-ish: far enough from HOME to be a real journey. */
const WORK = { lat: 31.5700, lng: 74.3100 };

const ME = 'commute-me';

interface ScheduleOpts {
  home?: { lat: number; lng: number };
  dest?: { lat: number; lng: number };
  destName?: string;
  morningTime?: string;
  activeDays?: string[];
  genderPref?: 'any' | 'male_only' | 'female_only';
  active?: boolean;
}

async function seedRider(
  uid: string,
  gender: 'male' | 'female' | 'unspecified',
  o: ScheduleOpts = {},
) {
  const home = o.home ?? HOME;
  const dest = o.dest ?? WORK;
  await db().doc(`users/${uid}`).set({ displayName: `User ${uid}`, gender });
  await db().doc(`commuteSchedules/${uid}`).set({
    uid,
    homeAreaName: 'Gulberg',
    homeGeohash: geohashForLocation([home.lat, home.lng]),
    homeLat: home.lat,
    homeLng: home.lng,
    destinationAreaName: o.destName ?? 'Blue Area',
    destinationGeohash: geohashForLocation([dest.lat, dest.lng]),
    destinationLat: dest.lat,
    destinationLng: dest.lng,
    morningTime: o.morningTime ?? '08:30',
    eveningTime: null,
    activeDays: o.activeDays ?? ['mon', 'tue', 'wed', 'thu', 'fri'],
    genderPref: o.genderPref ?? 'any',
    active: o.active ?? true,
  });
}

const ask = () => getCommuteMatches.run(makeReq({}, ME));

beforeEach(async () => {
  await clearFirestore();
});

describe('getCommuteMatches', () => {
  it('says so plainly when the rider has saved nothing', async () => {
    // Not an error — this is the state the home card renders as its invitation,
    // and that rider is the entire supply of future matches.
    await db().doc(`users/${ME}`).set({ displayName: 'Me', gender: 'female' });
    const res = await ask();
    expect(res.hasSchedule).toBe(false);
    expect(res.total).toBe(0);
  });

  it('ignores a schedule the rider switched off', async () => {
    await seedRider(ME, 'female', { active: false });
    await seedRider('other', 'female');
    const res = await ask();
    expect(res.hasSchedule).toBe(false);
  });

  it('finds riders on the same commute and counts them by gender', async () => {
    await seedRider(ME, 'female');
    await seedRider('w1', 'female');
    await seedRider('w2', 'female');
    await seedRider('m1', 'male');

    const res = await ask();
    expect(res.hasSchedule).toBe(true);
    expect(res.total).toBe(3);
    expect(res.females).toBe(2);
    expect(res.males).toBe(1);
    expect(res.destinationAreaName).toBe('Blue Area');
    expect(res.morningTime).toBe('08:30');
  });

  it('never counts the caller as their own company', async () => {
    await seedRider(ME, 'female');
    const res = await ask();
    expect(res.total).toBe(0);
  });

  it('drops riders who start somewhere else', async () => {
    await seedRider(ME, 'female');
    // ~15 km away: same destination, same time, but not the same pickup area.
    await seedRider('far', 'female', { home: { lat: 31.6500, lng: 74.3587 } });
    const res = await ask();
    expect(res.total).toBe(0);
  });

  it('drops riders going somewhere else', async () => {
    await seedRider(ME, 'female');
    // A shared car is one journey, not two that happen to start together.
    await seedRider('elsewhere', 'female', {
      dest: { lat: 31.4000, lng: 74.2000 },
      destName: 'Raiwind Road',
    });
    const res = await ask();
    expect(res.total).toBe(0);
  });

  it('allows a thirty-minute spread, and no more', async () => {
    await seedRider(ME, 'female', { morningTime: '08:30' });
    await seedRider('early', 'female', { morningTime: '08:05' }); // 25 min — in
    await seedRider('late', 'female', { morningTime: '09:15' });  // 45 min — out

    const res = await ask();
    expect(res.total).toBe(1);
  });

  it('needs at least one day both riders actually travel', async () => {
    await seedRider(ME, 'female', { activeDays: ['sat', 'sun'] });
    await seedRider('weekday', 'female', { activeDays: ['mon', 'tue'] });
    await seedRider('weekend', 'female', { activeDays: ['sun'] });

    const res = await ask();
    expect(res.total).toBe(1);
  });

  it('reports which of the caller’s days actually have company', async () => {
    // A rider who travels six days and has company on two should see that, not
    // one number that implies every morning is covered.
    await seedRider(ME, 'female', { activeDays: ['mon', 'tue', 'wed'] });
    await seedRider('monOnly', 'female', { activeDays: ['mon'] });
    await seedRider('monTue', 'female', { activeDays: ['mon', 'tue'] });

    const res = await ask();
    const byDay = Object.fromEntries(res.days.map((d) => [d.day, d.count]));
    expect(byDay.mon).toBe(2);
    expect(byDay.tue).toBe(1);
    expect(byDay.wed).toBeUndefined();
  });

  describe('both riders’ preferences bind, not just the caller’s', () => {
    it('honours the CALLER asking for women only', async () => {
      await seedRider(ME, 'female', { genderPref: 'female_only' });
      await seedRider('w', 'female');
      await seedRider('m', 'male');

      const res = await ask();
      expect(res.total).toBe(1);
      expect(res.females).toBe(1);
    });

    it('honours the OTHER rider’s preference too', async () => {
      // A woman who asked for women only must not be offered to a man just
      // because he is open to anyone — counting her would promise him a
      // companion who will not travel with him.
      await seedRider(ME, 'male', { genderPref: 'any' });
      await seedRider('sheWontShare', 'female', { genderPref: 'female_only' });
      await seedRider('heWill', 'male', { genderPref: 'any' });

      const res = await ask();
      expect(res.total).toBe(1);
      expect(res.males).toBe(1);
      expect(res.females).toBe(0);
    });

    it('leaves out a rider of unknown gender when either side asked for one', async () => {
      await seedRider(ME, 'female', { genderPref: 'female_only' });
      await seedRider('unknown', 'unspecified');
      const res = await ask();
      expect(res.total).toBe(0);
    });
  });

  it('ignores a route saved at (0, 0) — and so never pairs everybody with everybody', async () => {
    // Builds up to 2026-10-11 sent the coordinates as literal zeros: the screen
    // collected area NAMES and never a position. Every schedule ever saved sat
    // at the same point in the Gulf of Guinea, so a distance check between any
    // two of them was 0 and they would ALL have matched each other regardless
    // of which city they were in. Worse, such a schedule reaching the formation
    // cron would auto-book a real car from (0, 0).
    await seedRider(ME, 'female');
    await seedRider('legacyZero', 'female', {
      home: { lat: 0, lng: 0 },
      dest: { lat: 0, lng: 0 },
    });

    const res = await ask();
    expect(res.total).toBe(0);
  });

  it('tells a rider whose OWN route is (0, 0) that they have no usable schedule', async () => {
    // Their saved row exists but cannot be matched, so the screen must show the
    // "save your route" state and prompt them to pick real places — not a
    // confident "0 riders on your route".
    await seedRider(ME, 'female', { home: { lat: 0, lng: 0 }, dest: { lat: 0, lng: 0 } });
    await seedRider('real', 'female');

    const res = await ask();
    expect(res.hasSchedule).toBe(false);
  });

  it('PRIVACY: returns counts and area names, never a person', async () => {
    await seedRider(ME, 'female');
    await seedRider('w1', 'female');

    const res = await ask();
    const serialized = JSON.stringify(res);
    // Nothing that identifies a stranger or locates their home.
    expect(serialized).not.toContain('w1');
    expect(serialized).not.toContain('User w1');
    expect(serialized).not.toContain('homeLat');
    expect(serialized).not.toContain(String(HOME.lat));
    expect(serialized).not.toContain('Gulberg');
    // What it DOES carry: how many, and where they are going.
    expect(res.total).toBe(1);
    expect(res.slots[0]?.destinationAreaName).toBe('Blue Area');
  });

  it('groups matches into time slots rounded to the quarter hour', async () => {
    await seedRider(ME, 'female', { morningTime: '08:30' });
    await seedRider('a', 'female', { morningTime: '08:30' });
    await seedRider('b', 'female', { morningTime: '08:35' });

    const res = await ask();
    // 08:35 rounds up to 08:45, so these are two slots, not one.
    expect(res.slots).toHaveLength(2);
    expect(res.slots.map((s) => s.time)).toEqual(['08:30', '08:45']);
    expect(res.slots.reduce((n, s) => n + s.count, 0)).toBe(2);
  });
});
