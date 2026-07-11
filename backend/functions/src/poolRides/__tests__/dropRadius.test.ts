/**
 * Drop-zone enforcement on pool rides.
 *
 * Ride: F-8 Markaz → Blue Area (Islamabad), driver-set drop radius 500 m.
 *  - Joiner picking a drop-off inside the zone       → seated
 *  - Joiner picking the exact pool destination       → seated
 *  - Joiner omitting coords (same destination)       → seated
 *  - Joiner picking a drop-off ~5.5 km away          → REJECTED
 *  - Driver completing from inside the zone          → completed
 *  - Driver completing from ~5.5 km away             → REJECTED
 * Also unit-tests the pure radius helpers (no emulator dependency).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { joinPoolRide, completePoolRide, startPoolBoarding, poolArrivePassenger, poolPassengerBoarded } from '../index';
import { distanceM, effectiveDropRadiusM, withinRadiusM, hasRealCoords, DEFAULT_POOL_DROP_RADIUS_M } from '../../lib/poolRadius';

function makeReq<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}
const driverReq = <T>(data: T, uid: string) => makeReq(data, uid, 'driver');

const DRIVER = 'driver-ali';
const AHMED  = 'passenger-ahmed';
const BILAL  = 'passenger-bilal';

const F8_MARKAZ = { lat: 33.7086, lng: 73.0353, address: 'F-8 Markaz, Islamabad' };
const BLUE_AREA = { lat: 33.7167, lng: 73.0646, address: 'Blue Area, Islamabad' };
// ~300 m from Blue Area (inside a 500 m zone).
const NEAR_BLUE_AREA = { lat: 33.7180, lng: 73.0670 };
// Saddar Rawalpindi — far outside any sane drop zone of Blue Area.
const SADDAR = { lat: 33.5969, lng: 73.0528 };

const RIDE_ID = 'ride-drop-zone';

async function seedUser(uid: string, gender: 'male' | 'female', name: string) {
  await db().doc(`users/${uid}`).set({ gender, name, displayName: name, mixedRideOk: false });
}

async function seedRide(overrides: Record<string, unknown> = {}) {
  await db().doc(`poolRides/${RIDE_ID}`).set({
    driverId: DRIVER,
    driverName: 'Ali',
    genderPref: 'male_only',
    pickup:  F8_MARKAZ,
    dropoff: BLUE_AREA,
    pickupRadius: 500,
    dropoffRadius: 500,
    maxSeats: 3,
    takenSeats: 0,
    maleSeats: 0,
    femaleSeats: 0,
    genderComposition: 'male',
    perSeatFare: 250,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
}

describe('pure radius helpers', () => {
  it('measures F-8 → Blue Area at roughly 2.9 km', () => {
    const d = distanceM(F8_MARKAZ.lat, F8_MARKAZ.lng, BLUE_AREA.lat, BLUE_AREA.lng);
    expect(d).toBeGreaterThan(2500);
    expect(d).toBeLessThan(3500);
  });

  it('withinRadiusM honours the slack', () => {
    expect(withinRadiusM(BLUE_AREA.lat, BLUE_AREA.lng, NEAR_BLUE_AREA.lat, NEAR_BLUE_AREA.lng, 500)).toBe(true);
    expect(withinRadiusM(BLUE_AREA.lat, BLUE_AREA.lng, SADDAR.lat, SADDAR.lng, 500)).toBe(false);
    expect(withinRadiusM(BLUE_AREA.lat, BLUE_AREA.lng, SADDAR.lat, SADDAR.lng, 500, 20000)).toBe(true);
  });

  it('effectiveDropRadiusM prefers the ride value, falls back to the admin default', () => {
    expect(effectiveDropRadiusM(500, 1000)).toBe(500);
    expect(effectiveDropRadiusM(undefined, 1000)).toBe(1000);
    expect(effectiveDropRadiusM(null, 750)).toBe(750);
    expect(effectiveDropRadiusM(0, 1000)).toBe(1000);      // insane values ignored
    expect(effectiveDropRadiusM(99999, 1000)).toBe(1000);
    expect(DEFAULT_POOL_DROP_RADIUS_M).toBe(1000);
  });

  it('hasRealCoords rejects the (0,0) placeholder', () => {
    expect(hasRealCoords(0, 0)).toBe(false);
    expect(hasRealCoords(undefined, 73)).toBe(false);
    expect(hasRealCoords(33.7, 73.0)).toBe(true);
  });
});

describe('joinPoolRide drop-zone rule', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedUser(AHMED, 'male', 'Ahmed');
    await seedUser(BILAL, 'male', 'Bilal');
    await seedRide();
  });

  it('seats a joiner whose drop-off is inside the zone', async () => {
    const res = (await joinPoolRide.run(
      makeReq(
        {
          rideId: RIDE_ID,
          pickupLat: F8_MARKAZ.lat, pickupLng: F8_MARKAZ.lng,
          pickupAddress: 'F-8 Markaz', dropoffAddress: 'Near Blue Area',
          dropoffLat: NEAR_BLUE_AREA.lat, dropoffLng: NEAR_BLUE_AREA.lng,
        },
        AHMED,
      ),
    )) as { ok: boolean; queued: boolean };
    expect(res.ok).toBe(true);
    expect(res.queued).toBe(false);

    const pass = await db().doc(`poolRides/${RIDE_ID}/passengers/${AHMED}`).get();
    expect(pass.exists).toBe(true);
    expect(pass.get('dropoffLat')).toBeCloseTo(NEAR_BLUE_AREA.lat, 5);
  });

  it('seats a joiner who omits drop-off coords (same destination)', async () => {
    const res = (await joinPoolRide.run(
      makeReq(
        {
          rideId: RIDE_ID,
          pickupLat: F8_MARKAZ.lat, pickupLng: F8_MARKAZ.lng,
          pickupAddress: 'F-8 Markaz', dropoffAddress: BLUE_AREA.address,
        },
        AHMED,
      ),
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
  });

  it('rejects a joiner whose drop-off is outside the zone', async () => {
    await expect(
      joinPoolRide.run(
        makeReq(
          {
            rideId: RIDE_ID,
            pickupLat: F8_MARKAZ.lat, pickupLng: F8_MARKAZ.lng,
            pickupAddress: 'F-8 Markaz', dropoffAddress: 'Saddar, Rawalpindi',
            dropoffLat: SADDAR.lat, dropoffLng: SADDAR.lng,
          },
          AHMED,
        ),
      ),
    ).rejects.toThrow(/drop-off is .* km from the pool destination/i);

    const pass = await db().doc(`poolRides/${RIDE_ID}/passengers/${AHMED}`).get();
    expect(pass.exists).toBe(false);
  });

  it('skips the check on legacy rides with (0,0) destination coords', async () => {
    await seedRide({ dropoff: { lat: 0, lng: 0, address: 'Text-only offer' } });
    const res = (await joinPoolRide.run(
      makeReq(
        {
          rideId: RIDE_ID,
          pickupLat: F8_MARKAZ.lat, pickupLng: F8_MARKAZ.lng,
          pickupAddress: 'F-8 Markaz', dropoffAddress: 'Saddar',
          dropoffLat: SADDAR.lat, dropoffLng: SADDAR.lng,
        },
        AHMED,
      ),
    )) as { ok: boolean };
    expect(res.ok).toBe(true);
  });
});

describe('completePoolRide end-ride guard', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedUser(AHMED, 'male', 'Ahmed');
    await seedRide();
    await db().doc(`drivers/${DRIVER}`).set({ gender: 'male', fullName: 'Ali', online: true });

    // Seat + board Ahmed so the ride can reach in_progress.
    await joinPoolRide.run(
      makeReq(
        {
          rideId: RIDE_ID,
          pickupLat: F8_MARKAZ.lat, pickupLng: F8_MARKAZ.lng,
          pickupAddress: 'F-8 Markaz', dropoffAddress: BLUE_AREA.address,
        },
        AHMED,
      ),
    );
    await startPoolBoarding.run(driverReq({ rideId: RIDE_ID, driverLat: F8_MARKAZ.lat, driverLng: F8_MARKAZ.lng }, DRIVER));
    await poolArrivePassenger.run(driverReq({ rideId: RIDE_ID, passengerId: AHMED }, DRIVER));
    await poolPassengerBoarded.run(driverReq({ rideId: RIDE_ID, passengerId: AHMED }, DRIVER));
  });

  it('rejects completion when the driver has left the drop zone', async () => {
    await expect(
      completePoolRide.run(
        driverReq({ rideId: RIDE_ID, driverLat: SADDAR.lat, driverLng: SADDAR.lng }, DRIVER),
      ),
    ).rejects.toThrow(/end the ride within/i);

    const ride = await db().doc(`poolRides/${RIDE_ID}`).get();
    expect(ride.get('status')).toBe('in_progress');
  });

  it('completes when the driver is inside the drop zone', async () => {
    const res = (await completePoolRide.run(
      driverReq({ rideId: RIDE_ID, driverLat: NEAR_BLUE_AREA.lat, driverLng: NEAR_BLUE_AREA.lng }, DRIVER),
    )) as { ok: boolean };
    expect(res.ok).toBe(true);

    const ride = await db().doc(`poolRides/${RIDE_ID}`).get();
    expect(ride.get('status')).toBe('completed');
    const pass = await db().doc(`poolRides/${RIDE_ID}/passengers/${AHMED}`).get();
    expect(pass.get('status')).toBe('dropped_off');
  });

  it('completes without coords (legacy clients)', async () => {
    const res = (await completePoolRide.run(driverReq({ rideId: RIDE_ID }, DRIVER))) as { ok: boolean };
    expect(res.ok).toBe(true);
  });
});
