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
 *   5. A shared ride is one gender: women with women, men with men.
 *   6. The driver starts the car (or it starts itself once due): the box opens
 *      for the next car, and the driver gets each rider's stops as they confirm.
 *   7. Real cars: the nearest online cars before a driver accepts, then theirs.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { geohashForLocation } from 'geofire-common';
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
  autoStartDue,
  clearNearbyCarsCache,
  confirmSharedSeat,
  createSharedPool,
  dispatchPool,
  findPoolsForRoute,
  getDriverPools,
  getSharedPools,
  joinSharedPool,
  offerDriverRoute,
  startSharedRide,
  type DriverPoolView,
  type PoolCard,
} from '../index';

// Route A — F-7 Markaz to F-11 Markaz, ~4.1 km north.
const A_PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const A_DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'F-11 Markaz, Islamabad' };
// Bushra: 430 m east of the start, out 150 m short of the end. Chand: gets in 30% along.
const BUSHRA = {
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

const RIDERS = { amna: 'female', bushra: 'female', chand: 'female', danish: 'male', erum: 'female' } as const;
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
  return (await getSharedPools.run(makeReq({ city: 'islamabad', from, to }, uid))) as { pools: PoolCard[] };
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

    // Bushra finds it from his own stops, is quoted HIS price, and books it.
    const forBushra = (await search('bushra', BUSHRA.pickup, BUSHRA.dropoff)).pools;
    expect(forBushra.map((p) => p.id)).toEqual([made.poolId]);
    const bushraQuote = forBushra[0]!.farePerSeat;
    const bushra = (await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BUSHRA }, 'bushra'))) as { status: string; perSeatFare: number };
    expect(bushra).toMatchObject({ status: 'booked', perSeatFare: bushraQuote });

    // Chand gets in 30% along — a shorter route, so a lower share.
    const forChand = (await search('chand', CHAND.pickup, CHAND.dropoff)).pools;
    expect(forChand[0]!.id).toBe(made.poolId);
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...CHAND }, 'chand'));

    // Imran sees the job: three riders, what it pays now and full, and the stop order.
    const jobs = ((await getDriverPools.run(driverReq({ lat: A_PICKUP.lat, lng: A_PICKUP.lng }, D1))) as { pools: DriverPoolView[] }).pools;
    const job = jobs.find((j) => j.id === made.poolId)!;
    // Three women (a shared ride is one gender): the fourth seat is still on offer.
    expect(job).toMatchObject({ riders: 3, seatsLeft: 1, mine: false, liveTripId: null });
    expect(job.earnIfFull).toBeGreaterThan(job.earnNow);
    expect(job.stops).toHaveLength(6);
    expect(job.stops.slice(0, 3).every((s) => s.kind === 'pickup')).toBe(true);

    // He accepts ahead of time; Sana is too late.
    expect(await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1))).toMatchObject({ status: 'accepted' });
    await expect(acceptSharedPool.run(driverReq({ poolId: made.poolId }, D2))).rejects.toThrow(/already accepted/);
    // Every rider booked on it now sees who is coming, before the car exists.
    const seen = (await search('bushra', BUSHRA.pickup, BUSHRA.dropoff)).pools[0]!;
    expect(seen).toMatchObject({ booked: true, driverAhead: true, driver: { name: 'Imran', plate: 'LEB-1001' } });

    // The car goes out — straight to Imran, every booked rider aboard.
    const sent = await dispatchPool(made.poolId);
    expect(sent.driverAssigned).toBe(true);
    expect(sent.seated.sort()).toEqual(['amna', 'bushra', 'chand']);
    const car = await trip(sent.tripId!);
    expect(car).toMatchObject({ status: 'matched', driverId: D1, sharedPoolId: made.poolId });
    expect(car.poolMembers).toEqual(['amna', 'bushra', 'chand']);
    // Each pays their own route at the three-rider tier; the driver gets the sum.
    const fares = car.poolFares as Record<string, number>;
    expect(fares.chand).toBeLessThan(fares.amna!);
    expect(car.poolDriverGross).toBe(fares.amna! + fares.bushra! + fares.chand!);

    // Imran's list has everyone's own stops, in order; Bushra's own pickup included.
    const manifest = (await getPoolRiders.run(driverReq({ tripId: sent.tripId! }, D1))) as {
      riders: { uid: string; pickupLat: number | null }[]; stops: { uid: string; kind: string }[];
    };
    expect(manifest.riders.find((r) => r.uid === 'bushra')!.pickupLat).toBeCloseTo(BUSHRA.pickup.lat, 4);
    expect(manifest.stops).toHaveLength(6);

    // At the kerb: arrive, start each rider, drop each rider, complete.
    await updateTripStatus.run(driverReq({ tripId: sent.tripId!, to: 'arrived' }, D1));
    for (const r of ['amna', 'bushra', 'chand']) await boardPoolRider.run(driverReq({ tripId: sent.tripId!, riderUid: r }, D1));
    for (const r of ['chand', 'bushra', 'amna']) {
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
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BUSHRA }, 'bushra'));
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...CHAND }, 'chand'));
    expect((await trip(made.tripId)).poolMembers).toHaveLength(3);

    // Chand leaves before any driver: free, and the car re-prices for two —
    // up for Amna and Bushra, who may now leave free until a driver accepts.
    expect(await leaveSharedRide.run(makeReq({ tripId: made.tripId }, 'chand'))).toMatchObject({ fee: 0, remaining: 2 });
    expect((await trip(made.tripId)).poolFreeLeave).toEqual({ amna: true, bushra: true });

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
    expect(handed).toMatchObject({ passengerId: 'bushra', status: 'matched', driverId: D1 });
    expect(handed.poolFreeLeave).toEqual({ bushra: true }); // her share went up to riding alone

    // Bushra never agreed to riding alone at that price: he may leave free — the last one out.
    expect(await leaveSharedRide.run(makeReq({ tripId: made.tripId }, 'bushra'))).toMatchObject({ fee: 0, remaining: 0 });
    expect((await trip(made.tripId)).status).toBe('cancelled');
    expect((await db().doc(`drivers/${D1}`).get()).get('activeTripId')).toBeNull();
  });

  it('a host cancelling from the old button leaves instead of cancelling everyone', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; tripId: string };
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BUSHRA }, 'bushra'));
    await cancelTrip.run(makeReq({ tripId: made.tripId }, 'amna'));
    const after = await trip(made.tripId);
    expect(after).toMatchObject({ status: 'requested', passengerId: 'bushra', poolMembers: ['bushra'] });
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
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BUSHRA }, 'bushra'));
    await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1));
    const before = await trip(made.tripId);

    const res = (await cancelTrip.run(driverReq({ tripId: made.tripId }, D1))) as { fee: number };
    expect(res.fee).toBeGreaterThan(0); // the driver still pays for walking away
    const reopened = await trip(made.tripId);
    expect(reopened).toMatchObject({ status: 'requested', driverId: null, poolMembers: ['amna', 'bushra'] });
    expect(reopened.poolFares).toEqual(before.poolFares);
    expect((await db().doc(`openRequests/${made.tripId}`).get()).exists).toBe(true);
    expect((await db().doc('users/bushra').get()).get('activeTripId')).toBe(made.tripId);

    // Sana takes it at its own fare.
    const bid = (await placeBid.run(driverReq({ tripId: made.tripId, fare: reopened.offeredFare }, D2))) as { matched: boolean };
    expect(bid.matched).toBe(true);
    expect(await trip(made.tripId)).toMatchObject({ status: 'matched', driverId: D2 });
  });
});

describe('5 · a shared ride is one gender', () => {
  it('a man neither sees nor joins a women’s car, and a woman cannot join a man’s', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', departTime: pktClock(2 * 3600_000), pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string };
    expect((await search('danish', A_PICKUP, A_DROPOFF)).pools).toEqual([]);
    await expect(joinSharedPool.run(makeReq({ poolId: made.poolId }, 'danish'))).rejects.toThrow(/women only/);
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BUSHRA }, 'bushra'));

    const his = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', departTime: pktClock(3 * 3600_000), pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'danish'))) as { poolId: string };
    await expect(joinSharedPool.run(makeReq({ poolId: his.poolId }, 'chand'))).rejects.toThrow(/men only/);
  });
});

describe('6 · the driver starts the car; riders confirm', () => {
  it('starts on Start, opens the box to the next car, and gives the driver the stops of those who confirm', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; tripId: string };
    await joinSharedPool.run(makeReq({ poolId: made.poolId, ...BUSHRA }, 'bushra'));
    await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1));

    await expect(startSharedRide.run(driverReq({ tripId: made.tripId }, D2))).rejects.toThrow(/Only the driver/);
    await startSharedRide.run(driverReq({ tripId: made.tripId }, D1));
    const started = await trip(made.tripId);
    expect(started.poolStartedAt).toBeTruthy();
    expect(started.poolConfirm).toEqual({ amna: 'pending', bushra: 'pending' });
    expect((await db().doc(`sharedPools/${made.poolId}`).get()).get('autoStartAt')).toBeUndefined();

    // Its box is the next car's now: four seats again.
    const [box] = (await search('chand', CHAND.pickup, CHAND.dropoff)).pools;
    expect(box).toMatchObject({ id: made.poolId, state: 'gathering', seatsLeft: 4 });

    // The driver gets a rider's stops once she confirms, each rider with her fare.
    const manifest = async () => (await getPoolRiders.run(driverReq({ tripId: made.tripId }, D1))) as {
      riders: { uid: string; confirm: string | null; fare: number | null }[];
      stops: { uid: string; kind: string }[];
    };
    expect((await manifest()).stops).toEqual([]);
    // Amna also holds a seat on a later ride, to be sure of one; saying yes to this car gives it back.
    const later = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', departTime: pktClock(3 * 3600_000), pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'erum'))) as { poolId: string };
    await joinSharedPool.run(makeReq({ poolId: later.poolId }, 'amna'));
    expect(await confirmSharedSeat.run(makeReq({ tripId: made.tripId }, 'amna'))).toMatchObject({ released: 1 });
    expect((await db().doc(`sharedPools/${later.poolId}`).get()).get('bookingUids')).toEqual(['erum']);
    const m = await manifest();
    expect(m.stops.map((s) => `${s.kind}:${s.uid}`)).toEqual(['pickup:amna', 'dropoff:amna']);
    expect(m.riders.find((r) => r.uid === 'bushra')!.confirm).toBe('pending');
    expect(m.riders.every((r) => typeof r.fare === 'number' && r.fare > 0)).toBe(true);

    // Bushra cancels instead: she leaves like any rider — 3%, a driver has the car.
    const left = (await leaveSharedRide.run(makeReq({ tripId: made.tripId }, 'bushra'))) as { fee: number };
    expect(left.fee).toBeGreaterThan(0);
    expect((await trip(made.tripId)).poolConfirm).toEqual({ amna: 'confirmed' });
  });

  it('starts by itself once due, as soon as a driver has it', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string; tripId: string };
    const pool = db().doc(`sharedPools/${made.poolId}`);
    expect((await pool.get()).get('autoStartAt')).toBeTruthy();

    // Due, but no driver yet: it waits for one.
    await pool.update({ autoStartAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
    await autoStartDue(admin.firestore.Timestamp.now());
    expect((await trip(made.tripId)).poolStartedAt).toBeUndefined();

    await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D1));
    await autoStartDue(admin.firestore.Timestamp.now());
    expect((await trip(made.tripId)).poolConfirm).toEqual({ amna: 'pending' });
    expect((await pool.get()).get('autoStartAt')).toBeUndefined();
  });
});

describe('7 · real cars on the boxes', () => {
  it('shows the online cars nearest the pickup before a driver accepts, and that driver’s own after', async () => {
    clearNearbyCarsCache();
    await db().doc(`drivers/${D1}`).set({
      geohash: geohashForLocation([A_PICKUP.lat, A_PICKUP.lng]),
      vehicleCheck: { photoUrl: 'https://cars.example/imran.jpg' },
    }, { merge: true });
    const farther = { lat: A_PICKUP.lat + 0.01, lng: A_PICKUP.lng };
    await db().doc(`drivers/${D2}`).set({
      geohash: geohashForLocation([farther.lat, farther.lng]),
      lastLocation: farther,
      vehiclePhotoDocUrl: 'https://cars.example/sana.jpg',
    }, { merge: true });
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', rideType: 'mini', departTime: pktClock(2 * 3600_000), pickup: A_PICKUP, dropoff: A_DROPOFF,
    }, 'amna'))) as { poolId: string };

    const [before] = (await search('bushra', BUSHRA.pickup, BUSHRA.dropoff)).pools;
    expect(before).toMatchObject({
      carPhotos: ['https://cars.example/imran.jpg', 'https://cars.example/sana.jpg'],
      carIsDrivers: false,
    });

    await acceptSharedPool.run(driverReq({ poolId: made.poolId }, D2));
    const [after] = (await search('bushra', BUSHRA.pickup, BUSHRA.dropoff)).pools;
    expect(after).toMatchObject({ carPhotos: ['https://cars.example/sana.jpg'], carIsDrivers: true });
  });
});
