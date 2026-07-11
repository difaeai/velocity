/**
 * Scheduled rides — due-check unit tests + callable CRUD against the emulator.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { upsertScheduledRide, deleteScheduledRide, isScheduleDue, karachiNow } from '../index';

const RIDER = 'passenger-sana';

const BASE_INPUT = {
  pickup:  { lat: 33.7086, lng: 73.0353, address: 'F-8 Markaz, Islamabad' },
  dropoff: { lat: 33.7167, lng: 73.0646, address: 'Blue Area, Islamabad' },
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'female' as const,
  paymentMethod: 'cash' as const,
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  time: '08:30',
  active: true,
};

describe('isScheduleDue', () => {
  const base = {
    days: ['mon', 'wed'],
    time: '08:30',
    active: true,
    lastRunDate: null,
    nowDay: 'mon',
    nowMinutes: 8 * 60 + 32, // 08:32
    todayDate: '2026-07-13',
  };

  it('fires inside the window on an active day', () => {
    expect(isScheduleDue(base)).toBe(true);
  });

  it('does not fire before the scheduled time', () => {
    expect(isScheduleDue({ ...base, nowMinutes: 8 * 60 + 29 })).toBe(false);
  });

  it('does not fire after the window closes', () => {
    expect(isScheduleDue({ ...base, nowMinutes: 8 * 60 + 41 })).toBe(false);
  });

  it('does not fire on an off day', () => {
    expect(isScheduleDue({ ...base, nowDay: 'tue' })).toBe(false);
  });

  it('does not fire twice on the same day', () => {
    expect(isScheduleDue({ ...base, lastRunDate: '2026-07-13' })).toBe(false);
    expect(isScheduleDue({ ...base, lastRunDate: '2026-07-06' })).toBe(true);
  });

  it('does not fire when paused', () => {
    expect(isScheduleDue({ ...base, active: false })).toBe(false);
  });
});

describe('karachiNow', () => {
  it('converts UTC to PKT (+5, no DST)', () => {
    // 2026-07-13 03:30 UTC == 08:30 PKT, a Monday.
    const now = karachiNow(new Date('2026-07-13T03:30:00Z'));
    expect(now).toEqual({ day: 'mon', minutes: 8 * 60 + 30, date: '2026-07-13' });
  });

  it('rolls the date across midnight PKT', () => {
    // 2026-07-13 20:30 UTC == 2026-07-14 01:30 PKT (Tuesday).
    const now = karachiNow(new Date('2026-07-13T20:30:00Z'));
    expect(now).toEqual({ day: 'tue', minutes: 90, date: '2026-07-14' });
  });
});

describe('upsert/delete scheduled rides', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('creates, updates, and deletes a schedule', async () => {
    const created = (await upsertScheduledRide.run(makeReq(BASE_INPUT, RIDER))) as { scheduleId: string };
    expect(created.scheduleId).toBeTruthy();

    let snap = await db().doc(`scheduledRides/${created.scheduleId}`).get();
    expect(snap.get('uid')).toBe(RIDER);
    expect(snap.get('time')).toBe('08:30');
    expect(snap.get('lastRunDate')).toBeNull();

    await upsertScheduledRide.run(
      makeReq({ ...BASE_INPUT, scheduleId: created.scheduleId, time: '09:00', active: false }, RIDER),
    );
    snap = await db().doc(`scheduledRides/${created.scheduleId}`).get();
    expect(snap.get('time')).toBe('09:00');
    expect(snap.get('active')).toBe(false);

    await deleteScheduledRide.run(makeReq({ scheduleId: created.scheduleId }, RIDER));
    snap = await db().doc(`scheduledRides/${created.scheduleId}`).get();
    expect(snap.exists).toBe(false);
  });

  it('rejects edits to someone else\'s schedule', async () => {
    const created = (await upsertScheduledRide.run(makeReq(BASE_INPUT, RIDER))) as { scheduleId: string };
    await expect(
      upsertScheduledRide.run(makeReq({ ...BASE_INPUT, scheduleId: created.scheduleId }, 'other-user')),
    ).rejects.toThrow(/not your schedule/i);
    await expect(
      deleteScheduledRide.run(makeReq({ scheduleId: created.scheduleId }, 'other-user')),
    ).rejects.toThrow(/not your schedule/i);
  });

  it('caps schedules per user', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertScheduledRide.run(makeReq({ ...BASE_INPUT, time: `0${i + 1}:00` }, RIDER));
    }
    await expect(
      upsertScheduledRide.run(makeReq(BASE_INPUT, RIDER)),
    ).rejects.toThrow(/up to 5 scheduled rides/i);
  });
});
