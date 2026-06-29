/**
 * Integration tests for commute schedule CFs.
 *
 * Verified invariants:
 *  - upsertCommuteSchedule: persists data, idempotent update
 *  - deleteCommuteSchedule: removes document
 *  - getCommuteDemand: aggregation is correct
 *  PRIVACY: getCommuteDemand never returns uid, homeLat, homeLng, destinationLat, destinationLng
 *  PRIVACY: incompatible gender schedules are filtered out from driver view
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { upsertCommuteSchedule, deleteCommuteSchedule, getCommuteDemand } from '../index';

function makeReq<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}
function driverReq<T>(data: T, uid: string): CallableRequest<T> {
  return makeReq(data, uid, 'driver');
}

const PASSENGER1 = 'p1-uid';
const PASSENGER2 = 'p2-uid';
const PASSENGER3 = 'p3-uid';
const DRIVER_MALE   = 'driver-male';
const DRIVER_FEMALE = 'driver-female';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const TODAY = DAY_NAMES[new Date().getDay()]!;

async function seedDriver(uid: string, gender: string) {
  await db().doc(`drivers/${uid}`).set({ gender, fullName: 'Driver', vehicleLabel: 'Car', plate: 'ABC-123' });
}

const BASE_SCHEDULE = {
  homeAreaName:        'F-7, Islamabad',
  homeLat:             33.7234,
  homeLng:             73.0479,
  destinationAreaName: 'Blue Area',
  destinationLat:      33.7294,
  destinationLng:      73.0967,
  morningTime:         '08:00',
  eveningTime:         null,
  activeDays:          [TODAY],
  genderPref:          'any' as const,
  active:              true,
};

beforeEach(async () => {
  await clearFirestore();
  await seedDriver(DRIVER_MALE, 'male');
  await seedDriver(DRIVER_FEMALE, 'female');
});

// ── upsertCommuteSchedule ─────────────────────────────────────────────────────

describe('upsertCommuteSchedule', () => {
  it('creates schedule with correct fields', async () => {
    await upsertCommuteSchedule.run(makeReq(BASE_SCHEDULE, PASSENGER1));

    const snap = await db().doc(`commuteSchedules/${PASSENGER1}`).get();
    expect(snap.exists).toBe(true);
    const d = snap.data()!;
    expect(d.uid).toBe(PASSENGER1);
    expect(d.homeAreaName).toBe('F-7, Islamabad');
    expect(d.destinationAreaName).toBe('Blue Area');
    expect(d.morningTime).toBe('08:00');
    expect(d.homeLat).toBe(33.7234);
    expect(d.homeGeohash).toBeTruthy();
    expect(d.destinationGeohash).toBeTruthy();
    expect(d.active).toBe(true);
  });

  it('updates existing schedule (idempotent)', async () => {
    await upsertCommuteSchedule.run(makeReq(BASE_SCHEDULE, PASSENGER1));
    await upsertCommuteSchedule.run(makeReq({ ...BASE_SCHEDULE, morningTime: '09:00' }, PASSENGER1));

    const snap = await db().doc(`commuteSchedules/${PASSENGER1}`).get();
    expect(snap.data()!.morningTime).toBe('09:00');
  });
});

// ── deleteCommuteSchedule ─────────────────────────────────────────────────────

describe('deleteCommuteSchedule', () => {
  it('removes the document', async () => {
    await upsertCommuteSchedule.run(makeReq(BASE_SCHEDULE, PASSENGER1));
    await deleteCommuteSchedule.run(makeReq({}, PASSENGER1));

    const snap = await db().doc(`commuteSchedules/${PASSENGER1}`).get();
    expect(snap.exists).toBe(false);
  });
});

// ── getCommuteDemand ──────────────────────────────────────────────────────────

describe('getCommuteDemand', () => {
  beforeEach(async () => {
    await upsertCommuteSchedule.run(makeReq(BASE_SCHEDULE, PASSENGER1));
    await upsertCommuteSchedule.run(makeReq(BASE_SCHEDULE, PASSENGER2));
    await upsertCommuteSchedule.run(
      makeReq({ ...BASE_SCHEDULE, morningTime: '17:07', destinationAreaName: 'G-9' }, PASSENGER3),
    );
  });

  it('returns demand slots with correct counts', async () => {
    const res = await getCommuteDemand.run(
      driverReq({ lat: 33.7234, lng: 73.0479, radiusKm: 5 }, DRIVER_MALE),
    );

    expect(res.demand.length).toBeGreaterThanOrEqual(2);

    const blueAreaSlot = res.demand.find((s: any) => s.destinationAreaName === 'Blue Area');
    expect(blueAreaSlot).toBeTruthy();
    expect(blueAreaSlot?.count).toBe(2);

    const g9Slot = res.demand.find((s: any) => s.destinationAreaName === 'G-9');
    expect(g9Slot).toBeTruthy();
    expect(g9Slot?.count).toBe(1);
  });

  it('PRIVACY: response never contains uid, homeLat, homeLng, destinationLat, destinationLng', async () => {
    const res = await getCommuteDemand.run(
      driverReq({ lat: 33.7234, lng: 73.0479, radiusKm: 5 }, DRIVER_MALE),
    );

    const json = JSON.stringify(res.demand);
    expect(json).not.toContain(PASSENGER1);
    expect(json).not.toContain(PASSENGER2);
    expect(json).not.toContain(PASSENGER3);
    expect(json).not.toContain('33.7234'); // homeLat
    expect(json).not.toContain('73.0479'); // homeLng
    expect(json).not.toContain('33.7294'); // destinationLat
    expect(json).not.toContain('73.0967'); // destinationLng
  });

  it('rounds times to nearest 15 minutes', async () => {
    const res = await getCommuteDemand.run(
      driverReq({ lat: 33.7234, lng: 73.0479, radiusKm: 5 }, DRIVER_MALE),
    );
    // 17:07 → 17:15
    const g9Slot = res.demand.find((s: any) => s.destinationAreaName === 'G-9');
    expect(g9Slot?.time).toBe('17:15');
  });

  it('PRIVACY: female_only schedules are hidden from male driver', async () => {
    await upsertCommuteSchedule.run(
      makeReq({ ...BASE_SCHEDULE, genderPref: 'female_only', destinationAreaName: 'F-11' }, 'female-p'),
    );

    const res = await getCommuteDemand.run(
      driverReq({ lat: 33.7234, lng: 73.0479, radiusKm: 5 }, DRIVER_MALE),
    );

    const f11Slot = res.demand.find((s: any) => s.destinationAreaName === 'F-11');
    expect(f11Slot).toBeUndefined();
  });

  it('female_only schedules are visible to female driver', async () => {
    await upsertCommuteSchedule.run(
      makeReq({ ...BASE_SCHEDULE, genderPref: 'female_only', destinationAreaName: 'F-11' }, 'female-p'),
    );

    const res = await getCommuteDemand.run(
      driverReq({ lat: 33.7234, lng: 73.0479, radiusKm: 5 }, DRIVER_FEMALE),
    );

    const f11Slot = res.demand.find((s: any) => s.destinationAreaName === 'F-11');
    expect(f11Slot).toBeTruthy();
    expect(f11Slot?.count).toBe(1);
  });

  it('inactive schedules are excluded', async () => {
    await upsertCommuteSchedule.run(
      makeReq({ ...BASE_SCHEDULE, active: false, destinationAreaName: 'H-8' }, 'inactive-p'),
    );

    const res = await getCommuteDemand.run(
      driverReq({ lat: 33.7234, lng: 73.0479, radiusKm: 5 }, DRIVER_MALE),
    );

    const h8Slot = res.demand.find((s: any) => s.destinationAreaName === 'H-8');
    expect(h8Slot).toBeUndefined();
  });
});
