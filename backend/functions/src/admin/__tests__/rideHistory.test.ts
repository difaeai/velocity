/**
 * The ride record — the admin desk's ledger, and the file on one ride.
 *
 * The behaviour worth pinning down here is not the listing itself but the two
 * places this code is deliberately awkward, because both were bugs waiting to
 * happen:
 *
 *  1. A RIDER's history is two queries, not one. `passengerId` is only whoever
 *     BOOKED a ride, so somebody who joined another rider's shared car by
 *     invite code appears in `poolMembers` and nowhere else. Filter by
 *     `passengerId` alone and you silently lose exactly the rides a complaint
 *     about a shared car is about; filter by the roster alone and you lose
 *     every solo ride they ever took. These tests fail if either half is
 *     dropped.
 *  2. Identity is reported TWICE on purpose — as it was on the ride, and as the
 *     account stands today. A driver can be renamed, change cars, or be
 *     suspended overnight by the document-expiry sweep, and history that
 *     quietly updated itself to match would be useless in a dispute.
 *
 * Also covered: only admins get in, and the co-rider ratings that are anonymous
 * everywhere else are legible here, which is the whole point of the desk.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../../trips/index';
import { joinPoolTrip } from '../../trips/poolShare';
import { submitCoRiderRating } from '../../ratings/coRiders';
import { adminListRides, adminGetRideDetail, adminSearchRideParties } from '../rideHistory';

const ADMIN = 'rides-admin';
const HOST = 'rides-host';
const JOINER = 'rides-joiner';
const DRIVER = 'rides-driver';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'male' as const,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

/** The role lives on the custom claim, which is what requireAdmin reads. */
function asAdmin<T>(data: T): CallableRequest<T> {
  return {
    data,
    auth: {
      uid: ADMIN,
      token: { uid: ADMIN, role: 'admin' } as unknown as admin.auth.DecodedIdToken,
    },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

async function confirmWithDriver(tripId: string) {
  await db().doc(`openRequests/${tripId}`).delete();
  await db().doc(`trips/${tripId}`).set(
    {
      status: 'matched',
      fare: 400,
      driverId: DRIVER,
      driverPhone: '+923009999999',
      driverInfo: {
        driverId: DRIVER,
        displayName: 'Bilal Khan',
        vehicleLabel: 'Corolla',
        plate: 'ABC-123',
        rating: 4.8,
      },
    },
    { merge: true },
  );
}

/** A shared ride the joiner got into, finished, with a driver and a settlement. */
async function completedSharedRide() {
  const res = await createTrip.run(makeReq({ ...BASE_TRIP, pool: true }, HOST));
  const { tripId, shareCode } = res as { tripId: string; shareCode: string };
  await joinPoolTrip.run(makeReq({ code: shareCode }, JOINER));
  await confirmWithDriver(tripId);
  await db()
    .doc(`trips/${tripId}`)
    .set(
      {
        status: 'completed',
        completedAt: new Date(),
        startedAt: new Date(Date.now() - 20 * 60_000),
        settlement: {
          grossFare: 400,
          commission: 20,
          driverPayout: 380,
          passengerShare: 400,
          seats: 2,
        },
      },
      { merge: true },
    );
  return tripId;
}

/** A solo ride the joiner booked for themselves. */
async function soloRideBy(uid: string) {
  const res = await createTrip.run(makeReq({ ...BASE_TRIP, pool: false }, uid));
  const { tripId } = res as { tripId: string };
  await confirmWithDriver(tripId);
  await db()
    .doc(`trips/${tripId}`)
    .set({ status: 'completed', completedAt: new Date() }, { merge: true });
  return tripId;
}

beforeEach(async () => {
  await clearFirestore();
  await db()
    .doc(`users/${HOST}`)
    .set({ name: 'Usman Tariq', gender: 'male', phoneNumber: '+923001111111' });
  await db().doc(`users/${JOINER}`).set({
    name: 'Ayesha Malik',
    gender: 'female',
    mixedRideOk: true,
    phoneNumber: '+923002222222',
    cnic: '61101-1234567-8',
  });
  await db()
    .doc(`users/${DRIVER}`)
    .set({ name: 'Bilal Khan', phoneNumber: '+923009999999', role: 'driver' });
  await db().doc(`drivers/${DRIVER}`).set({
    verificationStatus: 'approved',
    plate: 'ABC-123',
    vehicleLabel: 'Corolla',
    licenseNumber: 'ISB-9911',
    cnic: '61101-7654321-0',
    rating: 4.8,
    ratingCount: 31,
  });
});

describe('authorisation', () => {
  it('refuses a caller who is not an admin', async () => {
    await expect(adminListRides.run(makeReq({}, HOST))).rejects.toThrow(/admin/i);
    await expect(
      adminGetRideDetail.run(makeReq({ tripId: 'whatever' }, HOST)),
    ).rejects.toThrow(/admin/i);
    await expect(
      adminSearchRideParties.run(makeReq({ term: 'Ayesha' }, HOST)),
    ).rejects.toThrow(/admin/i);
  });
});

describe('adminListRides', () => {
  it('lists every ride a driver drove', async () => {
    await completedSharedRide();
    await soloRideBy(HOST);

    const res = await adminListRides.run(asAdmin({ driverId: DRIVER }));
    expect(res.rides).toHaveLength(2);
    // Name and plate come off the trip document — what was true on the day.
    expect(res.rides.every((r) => (r as { driverName: string }).driverName === 'Bilal Khan')).toBe(
      true,
    );
  });

  it('counts everyone aboard a shared ride, by first name', async () => {
    await completedSharedRide();
    const res = await adminListRides.run(asAdmin({ driverId: DRIVER }));
    const row = res.rides[0] as { riders: number; riderNames: string[]; pool: boolean };
    expect(row.pool).toBe(true);
    expect(row.riders).toBe(2);
    expect(row.riderNames.sort()).toEqual(['Ayesha', 'Usman']);
  });

  it('finds a ride somebody JOINED, not just ones they booked', async () => {
    // The regression this exists for: the joiner is in `poolMembers` and is not
    // the `passengerId`, so a single-query rider filter loses this ride.
    const tripId = await completedSharedRide();
    const res = await adminListRides.run(asAdmin({ riderId: JOINER }));
    expect(res.rides.map((r) => (r as { id: string }).id)).toContain(tripId);
  });

  it("finds a rider's own solo rides too, which have no roster at all", async () => {
    const solo = await soloRideBy(JOINER);
    const res = await adminListRides.run(asAdmin({ riderId: JOINER }));
    expect(res.rides.map((r) => (r as { id: string }).id)).toContain(solo);
  });

  it("returns a rider's booked and joined rides together, without duplicates", async () => {
    const shared = await completedSharedRide();
    const solo = await soloRideBy(JOINER);

    const res = await adminListRides.run(asAdmin({ riderId: JOINER }));
    const ids = res.rides.map((r) => (r as { id: string }).id);
    expect(ids.sort()).toEqual([shared, solo].sort());
    // Merged from two queries, so it cannot be cursor-paged and says so.
    expect(res.pageable).toBe(false);
    expect(res.nextBeforeMs).toBeNull();
  });

  it('does not attribute a ride to somebody who was not in it', async () => {
    await completedSharedRide();
    const res = await adminListRides.run(asAdmin({ riderId: DRIVER }));
    // The driver drove it; they were not a rider on it.
    expect(res.rides).toHaveLength(0);
  });

  it('filters by state, and says when it did so in memory', async () => {
    await completedSharedRide();
    const open = await createTrip.run(makeReq({ ...BASE_TRIP, pool: false }, HOST));
    const { tripId: openId } = open as { tripId: string };

    const completed = await adminListRides.run(asAdmin({ status: 'completed' }));
    expect(completed.rides.map((r) => (r as { id: string }).id)).not.toContain(openId);

    // driverId reaches the index; status cannot, on the same query.
    const both = await adminListRides.run(asAdmin({ driverId: DRIVER, status: 'completed' }));
    expect(both.filteredInCode).toContain('status');
    expect(both.rides.length).toBeGreaterThan(0);
  });

  it('separates shared rides from solo ones', async () => {
    await completedSharedRide();
    await soloRideBy(HOST);

    const shared = await adminListRides.run(asAdmin({ driverId: DRIVER, pool: true }));
    const solo = await adminListRides.run(asAdmin({ driverId: DRIVER, pool: false }));
    expect(shared.rides).toHaveLength(1);
    expect(solo.rides).toHaveLength(1);
  });
});

describe('adminGetRideDetail', () => {
  it('names everybody in the car in full, with their phone numbers', async () => {
    const tripId = await completedSharedRide();
    const d = await adminGetRideDetail.run(asAdmin({ tripId }));

    expect(d.riders).toHaveLength(2);
    const joiner = d.riders.find((r) => r.uid === JOINER)!;
    // Full name and number — the opposite of what a co-rider is shown, and the
    // reason this is behind requireAdmin.
    expect(joiner.name).toBe('Ayesha Malik');
    expect(joiner.phone).toBe('+923002222222');
    expect(joiner.cnic).toBe('61101-1234567-8');
  });

  it('reports the driver as they were on the ride AND as they are now', async () => {
    const tripId = await completedSharedRide();
    // Renamed, moved to another car and suspended after the fact — exactly what
    // the overnight document-expiry sweep can do.
    await db()
      .doc(`drivers/${DRIVER}`)
      .set({ verificationStatus: 'suspended', plate: 'XYZ-789' }, { merge: true });

    const d = await adminGetRideDetail.run(asAdmin({ tripId }));
    expect(d.driver!.plateAtRide).toBe('ABC-123');
    expect(d.driver!.plateNow).toBe('XYZ-789');
    expect(d.driver!.verificationStatusNow).toBe('suspended');
    expect(d.driver!.licenseNumber).toBe('ISB-9911');
  });

  it('carries the route, the clock and the money', async () => {
    const tripId = await completedSharedRide();
    const d = await adminGetRideDetail.run(asAdmin({ tripId }));

    expect(d.ride.pickup).toMatchObject({ lat: PICKUP.lat, lng: PICKUP.lng });
    expect(d.timeline.requestedMs).toBeTypeOf('number');
    expect(d.timeline.startedMs).toBeTypeOf('number');
    expect(d.timeline.completedMs).toBeTypeOf('number');
    expect(d.money.settlement).toMatchObject({ grossFare: 400, driverPayout: 380 });
  });

  it('shows who gave a co-rider rating — the only place that is legible', async () => {
    const tripId = await completedSharedRide();
    await submitCoRiderRating.run(
      makeReq({ tripId, targetUid: JOINER, stars: 2, comment: 'Took a call the whole way' }, HOST),
    );

    const d = await adminGetRideDetail.run(asAdmin({ tripId }));
    const rating = d.ratings.find((r) => r.targetRole === 'coRider')!;
    expect(rating.raterId).toBe(HOST);
    expect(rating.targetUid).toBe(JOINER);
    expect(rating.stars).toBe(2);
    expect(rating.comment).toBe('Took a call the whole way');
  });

  it('reports both rating relationships against a rider, kept apart', async () => {
    const tripId = await completedSharedRide();
    await db()
      .doc(`users/${JOINER}`)
      .set({ rating: 4.9, ratingCount: 12 }, { merge: true });
    await submitCoRiderRating.run(makeReq({ tripId, targetUid: JOINER, stars: 1 }, HOST));

    const d = await adminGetRideDetail.run(asAdmin({ tripId }));
    const joiner = d.riders.find((r) => r.uid === JOINER)!;
    expect(joiner.driverGivenRating).toBe(4.9);
    expect(joiner.coRiderRating).toBe(1);
  });

  it('refuses a ride that does not exist', async () => {
    await expect(adminGetRideDetail.run(asAdmin({ tripId: 'nope' }))).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('adminSearchRideParties', () => {
  it('finds somebody by name', async () => {
    const res = await adminSearchRideParties.run(asAdmin({ term: 'Ayesha' }));
    expect(res.people.map((p) => p.uid)).toContain(JOINER);
  });

  it('finds somebody by phone number as it is stored', async () => {
    const res = await adminSearchRideParties.run(asAdmin({ term: '+92300222' }));
    expect(res.people.map((p) => p.uid)).toContain(JOINER);
  });

  it('finds the same number written the local way', async () => {
    // Pakistani numbers get written down both ways, and an operator should not
    // have to know which way the account happens to store it.
    const res = await adminSearchRideParties.run(asAdmin({ term: '0300222' }));
    expect(res.people.map((p) => p.uid)).toContain(JOINER);
  });

  it('refuses a search too short to mean anything', async () => {
    await expect(adminSearchRideParties.run(asAdmin({ term: 'a' }))).rejects.toThrow();
  });
});
