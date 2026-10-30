/**
 * Shared rides end to end, with several riders and drivers at once.
 * ----------------------------------------------------------------------------
 * Every step goes through the callables the apps call — search, book, accept,
 * dispatch, arrive, start each rider, drop each rider, complete, leave, cancel —
 * against the emulator, with a real city fare table so each rider's own route
 * is priced by distance. What it proves, scenario by scenario:
 *
 *   1. A driver accepts a pool ahead of time; three riders on their own stops
 *      each pay their own route at the car's tier; the car goes straight to that
 *      driver, who carries it to completion and is settled the sum.
 *   2. Leaving is free before a driver, costs 3% after; the host leaving hands
 *      the car on; a rider whose share rose may leave free; the last one out
 *      cancels it and frees the driver.
 *   3. A driver posts their own route; a rider on it finds it with the driver
 *      already assigned; its car goes straight to that driver.
 *   4. A driver who cancels hands the car back to the others, riders and fares
 *      untouched, and another driver takes it.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, confirmedCar, db, makeReq } from '../../travelMate/__tests__/helpers';
import { DEFAULT_ISLAMABAD_RAWALPINDI } from '../../fare/fareEngine';
import { cancelTrip, completeTrip, placeBid, updateTripStatus } from '../../trips';
import { boardPoolRider, dropOffRider } from '../../trips/dropOff';
import { getPoolRiders } from '../../trips/enRoute';
import { leaveSharedRide } from '../../trips/poolLeave';
import {
  acceptSharedPool,
  createSharedPool,
  dispatchPool,
  findPoolsForRoute,
  getDriverPools,
  getSharedPools,
  joinSharedPool,
  offerDriverRoute,
  type DriverPoolView,
  type PoolCard,
} from '../index';

// Route A — F-7 Markaz to F-11 Markaz, ~4.1 km north.
const A_PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const A_DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'F-11 Markaz, Islamabad' };
// Bilal: 430 m east of the start, out 150 m short of the end. Chand: gets in 30% along.
const BILAL = {
  pickup: { lat: 33.6850, lng: 73.0525, address: 'Jinnah Super, F-7' },
  dropoff: { lat: 33.7205, lng: 73.0440, address: 'F-11/1, Islamabad' },
};
const CHAND = {
  pickup: { lat: 33.6955, lng: 73.0465, address: 'F-8 Markaz, Islamabad' },
  dropoff: A_DROPOFF,
};
// Route B — a driver's own road, ~4.8 km north-west; Erum gets in a fifth of the way along.
const B_PICKUP = { lat: 33.66, lng: 73.0, address: 'G-10 Markaz, Islamabad' };
const B_DROPOFF = { lat: 33.7, lng: 72.98, address: 'F-11 Markaz west, Islamabad' };
const ERUM = {
  pickup: { lat: 33.6685, lng: 72.9968, address: 'G-10/4, Islamabad' },
  dropoff: { lat: 33.6985, lng: 72.981, address: 'F-11/2, Islamabad' },
};

const RIDERS = { amna: 'female', bilal: 'male', chand: 'female', danish: 'male', erum: 'female' } as const;
const D1 = 'drv-one';
const D2 = 'drv-two';

/** "HH:MM" in Pakistan time, `ms` from now. */
const pktClock = (ms: number) => new Date(Date.now() + ms + 5 * 3600_000).toISOString().slice(11, 16);

/** makeReq only carries a uid; driver-role callables need the claim too. */
function driverReq<T>(data: T, uid: string): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

const trip = async (id: string) => (await db().doc(`trips/${id}`).get()).data()!;

async function search(uid: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  return (await getSharedPools.run(makeReq({ city: 'islamabad', from, to }, uid))) as { pools: PoolCard[]; nearby: PoolCard[] };
}

beforeEach(async () => {
  await clearFirestore();
  // A real fare table: every rider's own route is priced by its distance.
  await db().doc('fareConfig/islamabad_rawalpindi').set(DEFAULT_ISLAMABAD_RAWALPINDI);
  for (const [uid, gender] of Object.entries(RIDERS)) {
    await db().doc(`users/${uid}`).set({ name: `${uid[0]!.toUpperCase()}${uid.slice(1)} Khan`, gender, mixedRideOk: true });
  }
  for (const [uid, name, plate] of [[D1, 'Imran', 'LEB-1001'], [D2, 'Sana', 'ISB-2002']] as const) {
    await db().doc(`users/${uid}`).set({ displayName: name, name, gender: 'male' });
    await db().doc(`drivers/${uid}`).set({
      verificationStatus: 'approved',
      online: true,
      lastLocation: { lat: A_PICKUP.lat, lng: A_PICKUP.lng },
      vehicleLabel: 'Suzuki Cultus',
      plate,
      rating: 4.9,
      ...confirmedCar(),
    });
  }
});

describe('1 · a driver accepts ahead of time; riders on their own stops pay their own route', () => {
  it('books three riders, hands the car to that driver, and settles the sum of their fares', async () => {
    // Amna starts a daily pool two hours out; her own stops are its ends.
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', label: 'F-7 to F-11', departTime: pktClock(2 * 3600_000),
      rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; status: string; perSeatFare: number };
    expect(made.status).toBe('booked');

    // Bilal finds it from his own stops, is quoted HIS price, and books it.
    const forBilal = (await search('bilal', BILAL.pickup, BILAL.dropoff)).pools;
    expect(forBilal.map((p) => p.id)).toEqual([made.poolId]);
    const bilalQuote = forBilal[0]!.farePerSeat;
    const bilal = (await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BILAL }, 'bilal'))) as { status: string; perSeatFare: number };
    expect(bilal).toMatchObject({ status: 'booked', perSeatFare: bilalQuote });

    // Chand gets in 30% along — a shorter route, so a lower share.
    const forChand = (await search('chand', CHAND.pickup, CHAND.dropoff)).pools;
    expect(forChand[0]!.id).toBe(made.poolId);
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...CHAND }, 'chand'));

    // Imran sees the job: three riders, what it pays now and full, and the stop order.
    const jobs = ((await getDriverPools.run(driverReq({ lat: A_PICKUP.lat, lng: A_PICKUP.lng }, D1))) as { pools: DriverPoolView[] }).pools;
    const job = jobs.find((j) => j.id === made.poolId)!;
    // One man and two women: a mixed car of three is closed for seating comfort
    // (lib/genderAccess), so its fourth seat is neither offered nor promised.
    expect(job).toMatchObject({ riders: 3, seatsLeft: 0, mine: false, liveTripId: null });
    expect(job.earnIfFull).toBe(job.earnNow);
    expect(job.stops).toHaveLength(6);
    expect(job.stops.slice(0, 3).every((s) => s.kind === 'pickup')).toBe(true);

    // He accepts ahead of time; Sana is too late.
    expect(await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1))).toMatchObject({ status: 'accepted' });
    await expect(acceptSharedPool.run(driverReq({ poolId: made.poolId }, D2))).rejects.toThrow(/already accepted/);
    // Every rider booked on it now sees who is coming, before the car exists.
    const seen = (await search('bilal', BILAL.pickup, BILAL.dropoff)).pools[0]!;
    expect(seen).toMatchObject({ booked: true, driverAhead: true, driver: { name: 'Imran', plate: 'LEB-1001' } });

    // The car goes out — straight to Imran, every booked rider aboard.
    const sent = await dispatchPool(made.poolId);
    expect(sent.driverAssigned).toBe(true);
    expect(sent.seated.sort()).toEqual(['amna', 'bilal', 'chand']);
    const car = await trip(sent.tripId!);
    expect(car).toMatchObject({ status: 'matched', driverId: D1, sharedPoolId: made.poolId });
    expect(car.poolMembers).toEqual(['amna', 'bilal', 'chand']);
    // Each pays their own route at the three-rider tier; the driver gets the sum.
    const fares = car.poolFares as Record<string, number>;
    expect(fares.chand).toBeLessThan(fares.amna!);
    expect(car.poolDriverGross).toBe(fares.amna! + fares.bilal! + fares.chand!);

    // Imran's list has everyone's own stops, in order; Bilal's own pickup included.
    const manifest = (await getPoolRiders.run(driverReq({ tripId: sent.tripId! }, D1))) as {
      riders: { uid: string; pickupLat: number | null }[]; stops: { uid: string; kind: string }[];
    };
    expect(manifest.riders.find((r) => r.uid === 'bilal')!.pickupLat).toBeCloseTo(BILAL.pickup.lat, 4);
    expect(manifest.stops).toHaveLength(6);

    // At the kerb: arrive, start each rider, drop each rider, complete.
    await updateTripStatus.run(driverReq({ tripId: sent.tripId!, to: 'arrived' }, D1));
    for (const r of ['amna', 'bilal', 'chand']) await boardPoolRider.run(driverReq({ tripId: sent.tripId!, riderUid: r }, D1));
    for (const r of ['chand', 'bilal', 'amna']) {
      const dropped = (await dropOffRider.run(driverReq({ tripId: sent.tripId!, riderUid: r }, D1))) as { fare: number };
      expect(dropped.fare).toBe(fares[r]);
    }
    await completeTrip.run(driverReq({ tripId: sent.tripId! }, D1));
    const done = await trip(sent.tripId!);
    expect(done.status).toBe('completed');
    expect(done.settlement.grossFare).toBe(car.poolDriverGross);
  });
});

describe('2 · leaving: free before a driver, 3% after, and nobody is stranded', () => {
  it('hands the car on, lets a rider whose share rose leave free, and frees the driver at the end', async () => {
    // A pool with no time: Amna's car goes out at once.
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; tripId: string };
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BILAL }, 'bilal'));
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...CHAND }, 'chand'));
    expect((await trip(made.tripId)).poolMembers).toHaveLength(3);

    // Chand leaves before any driver: free, and the car re-prices for two —
    // up for Amna and Bilal, who may now leave free until a driver accepts.
    expect(await leaveSharedRide.run(makeReq({ tripId: made.tripId }, 'chand'))).toMatchObject({ fee: 0, remaining: 2 });
    expect((await trip(made.tripId)).poolFreeLeave).toEqual({ amna: true, bilal: true });

    // Imran takes the car that is already out — and staying for him is their yes.
    expect(await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1))).toMatchObject({ status: 'matched' });
    const matched = await trip(made.tripId);
    expect(matched.poolFreeLeave).toBeUndefined();
    const amnaFare = (matched.poolFares as Record<string, number>).amna!;

    // Amna — the host — leaves after the driver accepted: 3% of her fare, owed.
    const left = (await leaveSharedRide.run(makeReq({ tripId: made.tripId }, 'amna'))) as { fee: number; outstanding: number; remaining: number };
    expect(left).toMatchObject({ fee: Math.round(amnaFare * 0.03), remaining: 1 });
    expect((await db().doc('wallets/amna').get()).get('outstanding')).toBe(left.fee);
    const handed = await trip(made.tripId);
    expect(handed).toMatchObject({ passengerId: 'bilal', status: 'matched', driverId: D1 });
    expect(handed.poolFreeLeave).toEqual({ bilal: true }); // his share went up to riding alone

    // Bilal never agreed to riding alone at that price: he may leave free — the last one out.
    expect(await leaveSharedRide.run(makeReq({ tripId: made.tripId }, 'bilal'))).toMatchObject({ fee: 0, remaining: 0 });
    expect((await trip(made.tripId)).status).toBe('cancelled');
    expect((await db().doc(`drivers/${D1}`).get()).get('activeTripId')).toBeNull();
  });

  it('a host cancelling from the old button leaves instead of cancelling everyone', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; tripId: string };
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BILAL }, 'bilal'));
    await cancelTrip.run(makeReq({ tripId: made.tripId }, 'amna'));
    const after = await trip(made.tripId);
    expect(after).toMatchObject({ status: 'requested', passengerId: 'bilal', poolMembers: ['bilal'] });
  });
});

describe('3 · a driver posts their own route', () => {
  it('is found by a rider on it, already with its driver, and its car goes to that driver', async () => {
    const departTime = pktClock(2 * 3600_000);
    const { poolId } = (await offerDriverRoute.run(driverReq({
      city: 'islamabad', label: 'G-10 to F-11', departTime, pickup: B_PICKUP, dropoff: B_DROPOFF,
    }, D2))) as { poolId: string };

    // Erum stands a fifth of the way along it.
    const [card] = (await search('erum', ERUM.pickup, ERUM.dropoff)).pools;
    expect(card).toMatchObject({ id: poolId, driverAhead: true, driver: { name: 'Sana' } });
    expect(card!.farePerSeat).toBeLessThan(card!.fare); // her own, shorter route alone
    await joinSharedPool.run(makeReq({ poolId, ...ERUM }, 'erum'));

    // Sana's route search shows the pool as hers.
    const mine = ((await findPoolsForRoute.run(driverReq({ pickup: B_PICKUP, dropoff: B_DROPOFF, departTime }, D2))) as { pools: DriverPoolView[] }).pools;
    expect(mine.find((p) => p.id === poolId)).toMatchObject({ mine: true, riders: 1 });

    const sent = await dispatchPool(poolId);
    expect(sent.driverAssigned).toBe(true);
    expect(await trip(sent.tripId!)).toMatchObject({ status: 'matched', driverId: D2, poolMembers: ['erum'] });
  });
});

describe('4 · a driver who cancels hands the car back', () => {
  it('re-opens it for the others with riders and fares untouched, and another driver takes it', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; tripId: string };
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BILAL }, 'bilal'));
    await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1));
    const before = await trip(made.tripId);

    const res = (await cancelTrip.run(driverReq({ tripId: made.tripId }, D1))) as { fee: number };
    expect(res.fee).toBeGreaterThan(0); // the driver still pays for walking away
    const reopened = await trip(made.tripId);
    expect(reopened).toMatchObject({ status: 'requested', driverId: null, poolMembers: ['amna', 'bilal'] });
    expect(reopened.poolFares).toEqual(before.poolFares);
    expect((await db().doc(`openRequests/${made.tripId}`).get()).exists).toBe(true);
    expect((await db().doc('users/bilal').get()).get('activeTripId')).toBe(made.tripId);

    // Sana takes it at its own fare.
    const bid = (await placeBid.run(driverReq({ tripId: made.tripId, fare: reopened.offeredFare }, D2))) as { matched: boolean };
    expect(bid.matched).toBe(true);
    expect(await trip(made.tripId)).toMatchObject({ status: 'matched', driverId: D2 });
  });
});
