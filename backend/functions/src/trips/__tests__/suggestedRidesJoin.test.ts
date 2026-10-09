/**
 * Can a rider actually take the seat the Shared rides screen just offered them?
 * ---------------------------------------------------------------------------
 * `getSuggestedRides` merges three different pooling subsystems into one list,
 * and each row carries an `id` the screen is expected to hand straight to a
 * different join call:
 *
 *   kind 'trip'    -> getPoolTripByCode / joinPoolTrip   (the id is a share code)
 *   kind 'request'  -> joinPoolRideRequest                (the id is a doc id)
 *   kind 'ride'     -> joinPoolRide                       (the id is a doc id)
 *
 * A feed row whose id does not open its own join call is the worst kind of bug
 * here: the list looks full of seats and every tap fails. These tests take the
 * row the feed returns and join with nothing but that row, for all three kinds,
 * and then check the seat really moved.
 *
 * They also pin the time fields the screen prints. Only a driver-posted ride is
 * scheduled, so only it may carry `departureAtMs` — everything else must come
 * back null, because a clock time the data cannot back would have a rider
 * standing on a road at a time nobody promised.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../index';
import { getPoolTripByCode, joinPoolTrip } from '../poolShare';
import { getSuggestedRides, type SuggestedRide } from '../suggestedRides';
import { createPoolRideRequest, joinPoolRideRequest } from '../../poolRideRequests';
import { joinPoolRide } from '../../poolRides';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

/** Everyone is a woman here, so the gender rules never confuse a join failure. */
const RIDERS = ['sj-leader', 'sj-joiner'];

const feed = async (uid: string): Promise<SuggestedRide[]> =>
  ((await getSuggestedRides.run(
    makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, uid),
  )) as { rides: SuggestedRide[] }).rides;

const rowOfKind = async (uid: string, kind: SuggestedRide['kind']): Promise<SuggestedRide> => {
  const row = (await feed(uid)).find((r) => r.kind === kind);
  expect(row, `the feed offered no ${kind} row`).toBeDefined();
  return row!;
};

/** A driver-posted pool ride, shaped exactly as the driver's offer screen writes it. */
async function seedDriverRide(departureInMs: number, id = 'sj-ride'): Promise<string> {
  await db().doc(`poolRides/${id}`).set({
    driverId: 'sj-driver',
    driverName: 'Bilal',
    driverVehicle: 'Suzuki Cultus',
    driverPlate: 'ISB-778',
    driverGender: 'male',
    genderPref: 'any',
    rideCategory: 'mini',
    pickup: PICKUP,
    dropoff: DROPOFF,
    pickupRadius: 500,
    dropoffRadius: 2000,
    maxSeats: 4,
    takenSeats: 0,
    maleSeats: 0,
    femaleSeats: 0,
    genderComposition: 'all',
    perSeatFare: 250,
    baseFare: 750,
    status: 'open',
    departureTime: admin.firestore.Timestamp.fromMillis(Date.now() + departureInMs),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return id;
}

beforeEach(async () => {
  await clearFirestore();
  for (const uid of RIDERS) {
    await db().doc(`users/${uid}`).set({ displayName: `Rider ${uid}`, name: `Rider ${uid}`, gender: 'female' });
  }
});

describe('a row from the Shared rides feed can be joined with nothing but that row', () => {
  it("seats a rider on a driver-posted ride using the row's id", async () => {
    await seedDriverRide(45 * 60 * 1000);

    const row = await rowOfKind('sj-joiner', 'ride');
    const res = await joinPoolRide.run(makeReq({
      rideId: row.id,
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupAddress: 'Current location',
      dropoffAddress: row.destinationAreaName,
    }, 'sj-joiner')) as { ok: boolean; queued: boolean };

    expect(res).toMatchObject({ ok: true, queued: false });
    const ride = await db().doc('poolRides/sj-ride').get();
    expect(ride.get('takenSeats')).toBe(1);
    expect((await db().doc('poolRides/sj-ride/passengers/sj-joiner').get()).exists).toBe(true);

    // And the seat it sold is gone from the next read of the feed.
    expect((await rowOfKind('sj-joiner', 'ride')).seatsLeft).toBe(3);
  });

  it("seats a rider on a riders' request using the row's id", async () => {
    await createPoolRideRequest.run(makeReq({
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupAreaName: PICKUP.address,
      destinationLat: DROPOFF.lat,
      destinationLng: DROPOFF.lng,
      destinationAreaName: DROPOFF.address,
      proposedFarePerSeat: 300,
      totalSlots: 3,
      genderPref: 'any' as const,
    }, 'sj-leader'));

    const row = await rowOfKind('sj-joiner', 'request');
    expect(row.needsDriverApproval).toBe(false); // no driver yet: the seat is free to take

    const res = await joinPoolRideRequest.run(
      makeReq({ requestId: row.id }, 'sj-joiner'),
    ) as { ok: boolean; pending: boolean; farePerSeat: number };

    expect(res).toMatchObject({ ok: true, pending: false });
    // The fare the row advertised is the fare the join charged — a joiner never
    // moves it, and a row that lies about it is a row riders stop trusting.
    expect(res.farePerSeat).toBe(row.farePerSeat);

    const req = await db().doc(`poolRideRequests/${row.id}`).get();
    expect(req.get('filledSlots')).toBe(2);
    expect(req.get('passengers')).toContain('sj-joiner');
  });

  it("opens and joins a booked shared ride using the row's id as its code", async () => {
    await createTrip.run(makeReq({
      rideType: 'mini' as const,
      offeredFare: 400,
      seats: 1,
      passengerGender: 'female' as const,
      pool: true,
      paymentMethod: 'cash' as const,
      pickup: PICKUP,
      dropoff: DROPOFF,
    }, 'sj-leader'));

    const row = await rowOfKind('sj-joiner', 'trip');

    // The screen resolves the code before it shows the join screen; if this
    // call fails the rider gets an error instead of a seat.
    const info = await getPoolTripByCode.run(
      makeReq({ code: row.id }, 'sj-joiner'),
    ) as { perSeatFareIfYouJoin: number };
    // The price on the row is the price on the join screen. A rider who taps a
    // 200-rupee seat and lands on a 260-rupee screen stops using the list.
    expect(info.perSeatFareIfYouJoin).toBe(row.farePerSeat);

    await joinPoolTrip.run(makeReq({ code: row.id }, 'sj-joiner'));

    const trips = await db().collection('trips').where('shareCode', '==', row.id).get();
    expect(trips.docs[0]!.get('poolMembers')).toContain('sj-joiner');
  });
});

describe('the time a row claims', () => {
  it('gives a clock time only to the ride that was actually scheduled', async () => {
    const departsAt = Date.now() + 45 * 60 * 1000;
    await seedDriverRide(45 * 60 * 1000);

    const row = await rowOfKind('sj-joiner', 'ride');
    expect(row.departureAtMs).toBeGreaterThan(Date.now());
    // Within a second of what was written — the field is the driver's time, not
    // a time the feed computed.
    expect(Math.abs(row.departureAtMs! - departsAt)).toBeLessThan(1500);
    expect(row.postedAtMs).toBeGreaterThan(0);
    expect(row.expiresAtMs).toBeNull();
  });

  it('gives a gathering booked ride a window and a posting time, never a departure', async () => {
    await createTrip.run(makeReq({
      rideType: 'mini' as const,
      offeredFare: 400,
      seats: 1,
      passengerGender: 'female' as const,
      pool: true,
      paymentMethod: 'cash' as const,
      pickup: PICKUP,
      dropoff: DROPOFF,
    }, 'sj-leader'));

    const row = await rowOfKind('sj-joiner', 'trip');
    expect(row.departureAtMs).toBeNull();
    expect(row.joinWindowEndsAt).toBeGreaterThan(Date.now());
    expect(row.postedAtMs).toBeGreaterThan(0);
  });

  it("tells a driverless request how long it has left to find a driver", async () => {
    await createPoolRideRequest.run(makeReq({
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupAreaName: PICKUP.address,
      destinationLat: DROPOFF.lat,
      destinationLng: DROPOFF.lng,
      destinationAreaName: DROPOFF.address,
      proposedFarePerSeat: 300,
      totalSlots: 3,
      genderPref: 'any' as const,
    }, 'sj-leader'));

    const row = await rowOfKind('sj-joiner', 'request');
    expect(row.departureAtMs).toBeNull();
    // Created with a 30-minute life; the row must carry it so the screen can
    // say "waiting for a driver until 6:05 PM" instead of implying a departure.
    expect(row.expiresAtMs).toBeGreaterThan(Date.now());
    expect(row.expiresAtMs! - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('drops a driver-posted ride whose departure time has gone', async () => {
    // Nothing sweeps poolRides, so a ride posted for last night stays 'open'
    // for ever. It must not be suggested, and it certainly must not be
    // suggested with last night's time printed on it.
    await seedDriverRide(-60 * 60 * 1000, 'sj-stale');
    expect((await feed('sj-joiner')).filter((r) => r.kind === 'ride')).toHaveLength(0);

    // A ride that left two minutes ago is still worth offering: the car is on
    // the road and the grace window is what stops a 15-minute-old row vanishing
    // while a rider is reading it.
    await seedDriverRide(-2 * 60 * 1000, 'sj-justleft');
    expect((await feed('sj-joiner')).filter((r) => r.kind === 'ride')).toHaveLength(1);
  });
});
