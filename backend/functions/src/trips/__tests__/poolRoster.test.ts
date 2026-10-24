/**
 * The roster on a DESTINATION pool — the shared ride people actually book.
 *
 * These cover the half of pooling that had no code behind it at all: a pool
 * created on the booking screen and joined by invite recorded `poolMembers`
 * (a list of uids) and nothing else, so `getPoolRiders` answered with an empty
 * list. Everything downstream degraded quietly — the driver's drop-off panel
 * fell back to one "Complete trip" button that ended everyone's ride at the
 * first stop, and no passenger was ever told their car was being shared.
 *
 * Verified here:
 *  - getPoolRiders names everyone on a destination pool, for driver and riders
 *  - the driver sees full names, phone numbers, every fare and the drop-off
 *    coordinates; a co-rider sees a first name, a gender and nobody else's money
 *  - dropOffRider lets people out ONE AT A TIME on a destination pool, and only
 *    reports `remaining: 0` when the last passenger is out
 *  - a legacy pool with no roster still lists everybody rather than nobody
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { poolPerSeatFare } from '../../domain/fares';
import { createTrip } from '../index';
import { getPoolRiders } from '../enRoute';
import { boardPoolRider, dropOffRider } from '../dropOff';
import { joinPoolTrip } from '../poolShare';
import { isBoarded, rosterForTrip } from '../poolRoster';
import type { CallableRequest } from 'firebase-functions/v2/https';

const HOST = 'roster-host';
const RIDER = 'roster-rider';
const DRIVER = 'roster-driver';
const OUTSIDER = 'roster-outsider';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'male' as const,
  pool: true,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

/** `dropOffRider` is driver-only, and the role lives on the custom claim. */
function asDriver<T>(data: T): CallableRequest<T> {
  const req = makeReq(data, DRIVER);
  (req.auth!.token as unknown as Record<string, unknown>).role = 'driver';
  return req;
}

/** What acceptBid leaves behind — the point at which a pool becomes joinable. */
async function confirmWithDriver(tripId: string) {
  await db().doc(`openRequests/${tripId}`).delete();
  await db().doc(`trips/${tripId}`).set(
    {
      status: 'matched',
      fare: 400,
      driverId: DRIVER,
      driverInfo: { driverId: DRIVER, displayName: 'Bilal Khan', vehicleLabel: 'Corolla', plate: 'ABC-123', rating: 4.8 },
    },
    { merge: true },
  );
}

/** A two-rider destination pool with a driver assigned and the ride running. */
async function runningPool() {
  const res = await createTrip.run(makeReq(BASE_TRIP, HOST));
  const { tripId, shareCode } = res as { tripId: string; shareCode: string };
  // The rider gets in while the pool is still gathering — before a driver has
  // taken it. That is the order it happens in now: joining a pool a driver has
  // already agreed to carry is a request for that driver to answer, not a seat.
  await joinPoolTrip.run(makeReq({ code: shareCode }, RIDER));
  await confirmWithDriver(tripId);
  await db().doc(`trips/${tripId}`).set({ status: 'in_progress' }, { merge: true });
  return tripId;
}

beforeEach(async () => {
  await clearFirestore();
  // The gender here, not the one in the booking request, is what the pool is
  // built from — createTrip reads the profile. Without it this "man's pool"
  // would be a pool with nobody's gender known.
  await db().doc(`users/${HOST}`).set({
    name: 'Usman Tariq',
    gender: 'male',
    phoneNumber: '+923001111111',
  });
  // She opted into mixed rides: the host is a man, and joining a man's pool
  // now takes that consent like every other way into a shared car.
  await db().doc(`users/${RIDER}`).set({
    mixedRideOk: true,
    name: 'Ayesha Malik',
    gender: 'female',
    phoneNumber: '+923002222222',
  });
  await db().doc(`users/${OUTSIDER}`).set({ name: 'Nobody' });
});

describe('rosterForTrip', () => {
  it('lists every member of a legacy pool that predates the roster', () => {
    // Losing a passenger because their document is old is far worse than
    // showing the driver a row that says "Rider".
    const riders = rosterForTrip({
      poolMembers: ['a', 'b', 'c'],
      passengerName: 'Usman Tariq',
      passengerGender: 'male',
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    expect(riders.map((r) => r.uid)).toEqual(['a', 'b', 'c']);
    expect(riders[0]!.firstName).toBe('Usman');
    expect(riders[0]!.kind).toBe('host');
    expect(riders[1]!.firstName).toBe('Rider');
    expect(riders[1]!.kind).toBe('share');
  });

  it('never drops a member who has no roster row of their own', () => {
    const riders = rosterForTrip({
      poolMembers: ['a', 'b'],
      poolRoster: [
        {
          uid: 'a',
          firstName: 'Usman',
          gender: 'male',
          kind: 'host',
          pickupAddress: null,
          dropoffAddress: null,
        },
      ],
      pickup: PICKUP,
      dropoff: DROPOFF,
    });
    expect(riders).toHaveLength(2);
    expect(riders[1]!.uid).toBe('b');
  });

  it('is empty for a solo trip', () => {
    expect(rosterForTrip({ pickup: PICKUP, dropoff: DROPOFF })).toEqual([]);
  });
});

describe('getPoolRiders on a destination pool', () => {
  it('names everybody in the car — this used to come back empty', async () => {
    const tripId = await runningPool();
    const res = await getPoolRiders.run(makeReq({ tripId }, RIDER));
    expect(res.riders).toHaveLength(2);
    expect(res.riders.map((r: { name: string }) => r.name)).toEqual(['Usman', 'Ayesha']);
    expect(res.riders[1].gender).toBe('female');
  });

  it('gives the driver what they need to collect, and riders only their own', async () => {
    const tripId = await runningPool();
    const perSeat = poolPerSeatFare(400, 2); // 240

    const driverView = await getPoolRiders.run(makeReq({ tripId }, DRIVER));
    // Full names, a number to ring, every fare, and a stop to navigate to.
    expect(driverView.riders.map((r: { name: string }) => r.name))
      .toEqual(['Usman Tariq', 'Ayesha Malik']);
    expect(driverView.riders.map((r: { fare: number | null }) => r.fare)).toEqual([perSeat, perSeat]);
    expect(driverView.riders[0].phone).toBe('+923001111111');
    expect(driverView.riders[0].dropoffLat).toBe(DROPOFF.lat);

    // A co-rider sees who is in the car and nothing about their money or phone.
    const riderView = await getPoolRiders.run(makeReq({ tripId }, RIDER));
    expect(riderView.yourFare).toBe(perSeat);
    const host = riderView.riders.find((r: { uid: string }) => r.uid === HOST)!;
    expect(host.name).toBe('Usman');
    expect(host.fare).toBeNull();
    expect(host.phone).toBeNull();
    expect(host.dropoffLat).toBeNull();
  });

  it('refuses somebody who is not on the ride', async () => {
    const tripId = await runningPool();
    await expect(getPoolRiders.run(makeReq({ tripId }, OUTSIDER)))
      .rejects.toThrow(/not on this ride/);
  });
});

describe('dropOffRider on a destination pool', () => {
  it('lets passengers out one at a time instead of ending everybody ride', async () => {
    const tripId = await runningPool();
    const perSeat = poolPerSeatFare(400, 2);

    const first = await dropOffRider.run(asDriver({ tripId, riderUid: HOST })) as { name: string; fare: number; remaining: number };
    expect(first.name).toBe('Usman');
    expect(first.fare).toBe(perSeat);
    // The ride is still running — this is the whole point.
    expect(first.remaining).toBe(1);
    expect((await db().doc(`trips/${tripId}`).get()).get('status')).toBe('in_progress');

    // The dropped rider is marked on the roster, not removed from it.
    const roster = (await db().doc(`trips/${tripId}`).get()).get('poolRoster') as
      { uid: string; droppedAt?: unknown }[];
    expect(roster).toHaveLength(2);
    expect(roster.find((r) => r.uid === HOST)!.droppedAt).toBeTruthy();

    // And they no longer appear as a stop the driver still has to make.
    const left = await getPoolRiders.run(makeReq({ tripId }, DRIVER));
    expect(left.riders.filter((r: { droppedOff: boolean }) => !r.droppedOff)).toHaveLength(1);

    const last = await dropOffRider.run(asDriver({ tripId, riderUid: RIDER })) as { remaining: number };
    expect(last.remaining).toBe(0);
  });

  it('refuses to drop the same rider twice', async () => {
    const tripId = await runningPool();
    await dropOffRider.run(asDriver({ tripId, riderUid: HOST }));
    await expect(dropOffRider.run(asDriver({ tripId, riderUid: HOST })))
      .rejects.toThrow(/already been dropped off/);
  });

  it('refuses a rider who is not on the ride', async () => {
    const tripId = await runningPool();
    await expect(dropOffRider.run(asDriver({ tripId, riderUid: OUTSIDER })))
      .rejects.toThrow(/not on this ride/);
  });
});

describe('starting each rider on their own', () => {
  /** The same pool, with the car at the pickup and nobody in it yet. */
  async function poolAtPickup() {
    const tripId = await runningPool();
    await db().doc(`trips/${tripId}`).set({ status: 'arrived' }, { merge: true });
    return tripId;
  }
  const boarded = async (tripId: string) =>
    Object.fromEntries(
      ((await getPoolRiders.run(makeReq({ tripId }, DRIVER))).riders as { uid: string; boarded: boolean }[])
        .map((r) => [r.uid, r.boarded]),
    );

  it('starts the ride with the first rider in, and nobody else', async () => {
    const tripId = await poolAtPickup();
    expect(await boarded(tripId)).toEqual({ [HOST]: false, [RIDER]: false });

    const res = await boardPoolRider.run(asDriver({ tripId, riderUid: HOST })) as { status: string };
    expect(res.status).toBe('in_progress');
    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('status')).toBe('in_progress');
    expect(trip.get('startedAt')).toBeTruthy();
    // The second rider is still on the pavement until the driver says otherwise.
    expect(await boarded(tripId)).toEqual({ [HOST]: true, [RIDER]: false });

    await boardPoolRider.run(asDriver({ tripId, riderUid: RIDER }));
    expect(await boarded(tripId)).toEqual({ [HOST]: true, [RIDER]: true });
  });

  it('treats a second tap as done, not as an error', async () => {
    const tripId = await poolAtPickup();
    await boardPoolRider.run(asDriver({ tripId, riderUid: HOST }));
    await expect(boardPoolRider.run(asDriver({ tripId, riderUid: HOST }))).resolves.toMatchObject({ ok: true });
  });

  it('refuses before the car has reached the pickup', async () => {
    const tripId = await poolAtPickup();
    await db().doc(`trips/${tripId}`).set({ status: 'arriving' }, { merge: true });
    await expect(boardPoolRider.run(asDriver({ tripId, riderUid: HOST }))).rejects.toThrow(/Arrived at pickup/);
  });

  it('counts everyone at the pickup aboard on a ride started all at once', async () => {
    // runningPool goes straight to in_progress, as the trip-level Start and
    // every ride before per-rider starts did — nobody is stamped.
    const tripId = await runningPool();
    expect(await boarded(tripId)).toEqual({ [HOST]: true, [RIDER]: true });
  });
});

describe('isBoarded', () => {
  it('never counts an en-route rider aboard without their own start', () => {
    const riders = [{ kind: 'host' }, { kind: 'enroute' }];
    expect(isBoarded(riders[0]!, riders, 'in_progress')).toBe(true);
    expect(isBoarded(riders[1]!, riders, 'in_progress')).toBe(false);
    expect(isBoarded({ kind: 'enroute', boardedAt: 1 }, riders, 'in_progress')).toBe(true);
  });

  it('counts nobody aboard before the ride is running', () => {
    expect(isBoarded({ kind: 'host' }, [{ kind: 'host' }], 'arrived')).toBe(false);
  });
});

// Every member can read the trip doc, so it must stop carrying the host's
// number once somebody else is aboard. The driver rings them via getPoolRiders.
describe('the host phone on a shared trip', () => {
  it('leaves the trip doc when a co-rider joins', async () => {
    const res = await createTrip.run(makeReq(BASE_TRIP, HOST));
    const { tripId, shareCode } = res as { tripId: string; shareCode: string };
    await db().doc(`trips/${tripId}`).set({ passengerPhone: '+923001111111' }, { merge: true });

    await joinPoolTrip.run(makeReq({ code: shareCode }, RIDER));

    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('poolMembers')).toContain(RIDER);
    expect(trip.get('passengerPhone')).toBeUndefined();
  });
});
