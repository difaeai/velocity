/**
 * The sweep that gives shared-ride offers an ending.
 * ---------------------------------------------------------------------------
 * What it must get right is not "does it delete things" but WHEN it refuses to.
 * Expiring a ride is a decision about somebody's journey: a driver stuck in
 * traffic still means to drive, and their riders still have seats. So most of
 * these tests are about the rides it must leave alone.
 *
 * The one it must not leave alone is the abandoned ride, because an open
 * `poolRides` document is counted as live work by drivers/vehicles.ts — one
 * forgotten ride locked its driver out of ever switching cars again.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { sweepStaleSharedRides } from '../sweepStaleSharedRides';
import { createPoolRideRequest } from '../../poolRideRequests';
import {
  POOL_REQUEST_EXPIRE_GRACE_MS,
  POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS,
  POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS,
} from '../lifecycle';

const MIN = 60 * 1000;
const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const ts = (offsetMs: number) => admin.firestore.Timestamp.fromMillis(Date.now() + offsetMs);

/** Runs the scheduled function the way the scheduler does. */
const sweep = () => sweepStaleSharedRides.run({} as never);

const statusOf = async (path: string) => (await db().doc(path).get()).get('status');

/**
 * A driver-posted ride. `departure` is an offset from now; pass null for the
 * older documents that carry no departure time at all.
 */
async function seedRide(
  id: string,
  opts: { departure: number | null; created?: number; status?: string },
): Promise<void> {
  await db().doc(`poolRides/${id}`).set({
    driverId: 'sw-driver',
    driverName: 'Bilal',
    driverVehicle: 'Suzuki Cultus',
    driverGender: 'male',
    genderPref: 'any',
    rideCategory: 'mini',
    pickup: PICKUP,
    dropoff: DROPOFF,
    maxSeats: 4,
    takenSeats: 0,
    maleSeats: 0,
    femaleSeats: 0,
    genderComposition: 'all',
    perSeatFare: 250,
    baseFare: 750,
    status: opts.status ?? 'open',
    ...(opts.departure === null ? {} : { departureTime: ts(opts.departure) }),
    createdAt: ts(opts.created ?? (opts.departure === null ? -30 * MIN : opts.departure - 30 * MIN)),
  });
}

/** A confirmed seat on a ride, as joinPoolRide writes it. */
async function seedSeat(rideId: string, uid: string, status = 'confirmed'): Promise<void> {
  await db().doc(`poolRides/${rideId}/passengers/${uid}`).set({
    userId: uid,
    userName: `Rider ${uid}`,
    userGender: 'female',
    fare: 250,
    status,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

beforeEach(async () => {
  await clearFirestore();
  await db().doc('users/sw-leader').set({ displayName: 'Ayesha', gender: 'female' });
  await db().doc('users/sw-rider').set({ displayName: 'Sana', gender: 'female' });
});

describe('driver-posted rides', () => {
  it('retires a ride whose departure time came and went without boarding', async () => {
    await seedRide('sw-dead', { departure: -(POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS + 10 * MIN) });

    await sweep();

    const ride = await db().doc('poolRides/sw-dead').get();
    expect(ride.get('status')).toBe('expired');
    expect(ride.get('expiredBy')).toBe('system');
    expect(ride.get('expiredReason')).toBe('departure_passed');
  });

  it('releases the seats and the pairing queue on that ride', async () => {
    await seedRide('sw-dead', { departure: -(POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS + 10 * MIN) });
    await seedSeat('sw-dead', 'sw-rider');
    await db().doc('poolRides/sw-dead/joinRequests/sw-queued').set({
      userId: 'sw-queued', userGender: 'male', status: 'queued', fare: 250,
    });

    await sweep();

    expect(await statusOf('poolRides/sw-dead/passengers/sw-rider')).toBe('expired');
    expect(await statusOf('poolRides/sw-dead/joinRequests/sw-queued')).toBe('expired');
  });

  it('leaves a journey that actually happened alone', async () => {
    // Picked up before the driver abandoned the app: that seat is a fact, not a
    // promise, and rewriting it would falsify a completed pickup.
    await seedRide('sw-dead', { departure: -(POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS + 10 * MIN) });
    await seedSeat('sw-dead', 'sw-rider', 'picked_up');

    await sweep();

    expect(await statusOf('poolRides/sw-dead/passengers/sw-rider')).toBe('picked_up');
  });

  it('will not touch a ride that is merely late', async () => {
    // Twenty minutes past departure, no boarding: hidden from the feeds, but
    // the driver may well still be coming. Cancelling here is the expensive
    // mistake, so the sweep does not make it.
    await seedRide('sw-late', { departure: -20 * MIN });
    await seedSeat('sw-late', 'sw-rider');

    await sweep();

    expect(await statusOf('poolRides/sw-late')).toBe('open');
    expect(await statusOf('poolRides/sw-late/passengers/sw-rider')).toBe('confirmed');
  });

  it('will not touch a ride that has not left yet, however long ago it was posted', async () => {
    // Posted yesterday for tonight. The age scan sees it; the departure rule
    // must still save it.
    await seedRide('sw-tonight', {
      departure: 2 * 60 * MIN,
      created: -(POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS + 60 * MIN),
    });

    await sweep();

    expect(await statusOf('poolRides/sw-tonight')).toBe('open');
  });

  it('will not touch a ride the driver already started', async () => {
    await seedRide('sw-boarding', {
      departure: -(POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS + 60 * MIN),
      status: 'boarding',
    });

    await sweep();

    expect(await statusOf('poolRides/sw-boarding')).toBe('boarding');
  });

  it('retires an old ride that never carried a departure time at all', async () => {
    await seedRide('sw-timeless', {
      departure: null,
      created: -(POOL_RIDE_EXPIRE_WITHOUT_DEPARTURE_MS + 60 * MIN),
    });
    await seedRide('sw-fresh-timeless', { departure: null, created: -30 * MIN });

    await sweep();

    const dead = await db().doc('poolRides/sw-timeless').get();
    expect(dead.get('status')).toBe('expired');
    expect(dead.get('expiredReason')).toBe('never_departed');
    expect(await statusOf('poolRides/sw-fresh-timeless')).toBe('open');
  });

  it('sweeps a full car and a collecting one, not just an empty open one', async () => {
    const gone = -(POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS + 10 * MIN);
    await seedRide('sw-collecting', { departure: gone, status: 'collecting' });
    await seedRide('sw-full', { departure: gone, status: 'full' });

    await sweep();

    expect(await statusOf('poolRides/sw-collecting')).toBe('expired');
    expect(await statusOf('poolRides/sw-full')).toBe('expired');
  });

  it('is safe to run twice', async () => {
    await seedRide('sw-dead', { departure: -(POOL_RIDE_EXPIRE_AFTER_DEPARTURE_MS + 10 * MIN) });
    await seedSeat('sw-dead', 'sw-rider');

    await sweep();
    const first = (await db().doc('poolRides/sw-dead').get()).get('expiredAt');
    await sweep();
    const second = (await db().doc('poolRides/sw-dead').get()).get('expiredAt');

    // The second run finds nothing to do, so it does not rewrite the ending.
    expect(second.toMillis()).toBe(first.toMillis());
  });
});

describe("riders' pool requests", () => {
  /** A pool created by a rider, with its expiry moved to `expiresIn` from now. */
  async function seedRequest(expiresIn: number, overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await createPoolRideRequest.run(makeReq({
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupAreaName: PICKUP.address,
      destinationLat: DROPOFF.lat,
      destinationLng: DROPOFF.lng,
      destinationAreaName: DROPOFF.address,
      proposedFarePerSeat: 300,
      totalSlots: 3,
      genderPref: 'any' as const,
    }, 'sw-leader')) as { requestId: string };

    await db().doc(`poolRideRequests/${res.requestId}`)
      .set({ expiresAt: ts(expiresIn), ...overrides }, { merge: true });
    return res.requestId;
  }

  it('expires a pool no driver ever took', async () => {
    const id = await seedRequest(-(POOL_REQUEST_EXPIRE_GRACE_MS + 10 * MIN));

    await sweep();

    const req = await db().doc(`poolRideRequests/${id}`).get();
    expect(req.get('status')).toBe('expired');
    expect(req.get('expiredReason')).toBe('no_driver');
  });

  it('expires an unanswered counter offer with it', async () => {
    const id = await seedRequest(
      -(POOL_REQUEST_EXPIRE_GRACE_MS + 10 * MIN),
      { status: 'negotiating', counterFarePerSeat: 420 },
    );

    await sweep();

    expect(await statusOf(`poolRideRequests/${id}`)).toBe('expired');
  });

  it('leaves a pool inside its grace alone', async () => {
    const id = await seedRequest(-2 * MIN);

    await sweep();

    expect(await statusOf(`poolRideRequests/${id}`)).toBe('open');
  });

  it('never touches a pool a driver is actually driving', async () => {
    // Long past its expiry, but a driver accepted it — `expiresAt` was only
    // ever about finding one. This is a real ride.
    const id = await seedRequest(
      -(POOL_REQUEST_EXPIRE_GRACE_MS + 60 * MIN),
      { status: 'active', driverId: 'sw-driver', agreedFarePerSeat: 300 },
    );

    await sweep();

    expect(await statusOf(`poolRideRequests/${id}`)).toBe('active');
  });

  it('closes the join requests that were waiting on a driver', async () => {
    const id = await seedRequest(-(POOL_REQUEST_EXPIRE_GRACE_MS + 10 * MIN));
    await db().doc(`poolRideRequests/${id}/joinRequests/sw-rider`).set({
      riderId: 'sw-rider', status: 'pending', farePerSeat: 300,
    });

    await sweep();

    expect(await statusOf(`poolRideRequests/${id}/joinRequests/sw-rider`)).toBe('expired');
  });
});
