/**
 * Shared pools: a route that fills a car, sends it, and is empty again for the
 * next riders two minutes after it filled.
 *
 * The pure half pins the clock (Pakistan time, the two-minute hold) and the
 * owner's fare split. The emulator half books real seats through the callables
 * and checks they land in ONE ordinary shared trip — the car is never rebuilt
 * here, only chosen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { poolPerSeatFare } from '../../domain/fares';
import {
  FULL_HOLD_MS,
  createSharedPool,
  dispatchPool,
  editSharedPool,
  getSharedPools,
  joinSharedPool,
  leaveSharedPool,
  nextDepartureMs,
  poolCard,
  type PoolCard,
} from '../index';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'F-11 Markaz, Islamabad' };
/** ~300 m from each end — inside the 1 km match on both. */
const NEAR = { from: { lat: 33.6870, lng: 73.0479 }, to: { lat: 33.7240, lng: 73.0433 } };

/** "HH:MM" in Pakistan time, `ms` from now. */
const pktClock = (ms: number) => new Date(Date.now() + ms + 5 * 3600_000).toISOString().slice(11, 16);

const RIDERS = ['sp-a', 'sp-b', 'sp-c', 'sp-d', 'sp-e'];

beforeEach(async () => {
  await clearFirestore();
  // All women, so no gender rule ever explains a failed seat.
  for (const uid of RIDERS) {
    await db().doc(`users/${uid}`).set({ name: `Rider ${uid}`, gender: 'female' });
  }
});

const create = (uid: string, extra: Record<string, unknown> = {}) =>
  createSharedPool.run(makeReq({
    city: 'islamabad', label: 'F-7 to F-11', rideType: 'mini', pickup: PICKUP, dropoff: DROPOFF, ...extra,
  }, uid)) as Promise<{ poolId: string; status: string; tripId: string | null; perSeatFare: number }>;

const join = (uid: string, poolId: string) =>
  joinSharedPool.run(makeReq({ poolId }, uid)) as Promise<{ status: string; tripId: string | null; perSeatFare: number }>;

type Point = { lat: number; lng: number };
const search = async (uid: string, at: { from?: Point; to?: Point } = NEAR): Promise<PoolCard[]> =>
  ((await getSharedPools.run(makeReq({ city: 'islamabad', ...at }, uid))) as { pools: PoolCard[] }).pools;

describe('the owner’s fare split', () => {
  it('a PKR 1,000 car is 550 each for two and 450 each for three, and the driver gains every time', () => {
    expect([1, 2, 3, 4].map((n) => poolPerSeatFare(1000, n))).toEqual([1000, 550, 450, 350]);
    const gross = [1, 2, 3, 4].map((n) => poolPerSeatFare(1000, n) * n);
    expect(gross).toEqual([1000, 1100, 1350, 1400]);
  });
});

describe('nextDepartureMs (Pakistan time, UTC+5)', () => {
  it('is today while the time is still ahead', () => {
    const now = Date.UTC(2026, 9, 29, 2, 0); // 07:00 PKT
    expect(nextDepartureMs('08:00', now)).toBe(Date.UTC(2026, 9, 29, 3, 0));
  });
  it('is tomorrow once the time has gone', () => {
    const now = Date.UTC(2026, 9, 29, 3, 30); // 08:30 PKT
    expect(nextDepartureMs('08:00', now)).toBe(Date.UTC(2026, 9, 30, 3, 0));
  });
  it('crosses midnight in Pakistan, not in UTC', () => {
    const now = Date.UTC(2026, 9, 29, 18, 50); // 23:50 PKT on the 29th
    expect(nextDepartureMs('00:10', now)).toBe(Date.UTC(2026, 9, 29, 19, 10)); // 00:10 PKT on the 30th
  });
});

describe('poolCard — a full car stays full for two minutes, then the pool is empty again', () => {
  const filledAt = Date.UTC(2026, 9, 29, 3, 0);
  const trip = {
    status: 'matched',
    passengerId: 'a',
    poolMembers: ['a', 'b', 'c', 'd'],
    fare: 1000,
    poolRoster: ['a', 'b', 'c', 'd'].map((uid, i) => ({
      uid, gender: 'female', joinedAt: admin.firestore.Timestamp.fromMillis(filledAt - (3 - i) * 1000),
    })),
    driverInfo: { displayName: 'Bilal', vehicleLabel: 'Suzuki Cultus', plate: 'ISB-778' },
  };
  const pool = { city: 'islamabad', pickup: PICKUP, dropoff: DROPOFF, fare: 1000, bookings: [], departTime: null };
  const card = (nowMs: number) => poolCard({ id: 'p', pool, trip, tripId: 't', uid: 'z', nowMs });

  it('shows the full car, no seats, right after it filled', () => {
    const c = card(filledAt + 30_000);
    expect(c.state).toBe('full');
    expect(c.seatsLeft).toBe(0);
    expect(c.driver?.name).toBe('Bilal');
  });
  it('is an empty pool for the next riders once the two minutes are up', () => {
    const c = card(filledAt + FULL_HOLD_MS + 1);
    expect(c.state).toBe('gathering');
    expect(c.seatsLeft).toBe(4);
    expect(c.farePerSeat).toBe(1000);
    expect(c.driver).toBeNull();
  });
});

describe('a pool with no time sends a car the moment somebody books', () => {
  it('seats the creator in a shared trip, and the next rider in the same one at 55%', async () => {
    const made = await create('sp-a');
    expect(made.status).toBe('seated');
    expect(made.tripId).toBeTruthy();

    const trip = (await db().doc(`trips/${made.tripId}`).get()).data()!;
    expect(trip.pool).toBe(true);
    expect(trip.sharedPoolId).toBe(made.poolId);
    expect((await db().doc('users/sp-a').get()).get('activeTripId')).toBe(made.tripId);
    const fare = trip.offeredFare as number;

    const joined = await join('sp-b', made.poolId);
    expect(joined).toMatchObject({ status: 'seated', tripId: made.tripId });
    expect(joined.perSeatFare).toBe(poolPerSeatFare(fare, 2));

    const [card] = await search('sp-c');
    expect(card).toMatchObject({ id: made.poolId, state: 'car', riders: 2, seatsLeft: 2 });
    expect(card.farePerSeat).toBe(poolPerSeatFare(fare, 3));
  });
});

describe('a pool with a time holds seats until its car is due', () => {
  it('books without a trip, then dispatch puts everybody booked in one car', async () => {
    const made = await create('sp-a', { departTime: pktClock(2 * 3600_000) });
    expect(made.status).toBe('booked');
    expect(made.tripId).toBeNull();
    // A seat for later is not a ride now: the rider can still book anything else.
    expect((await db().doc('users/sp-a').get()).get('activeTripId')).toBeUndefined();

    expect((await join('sp-b', made.poolId)).status).toBe('booked');
    const [card] = await search('sp-c');
    expect(card).toMatchObject({ state: 'gathering', riders: 2, seatsLeft: 2, driver: null });
    expect(card.departsAtMs).toBeGreaterThan(Date.now());

    const sent = await dispatchPool(made.poolId);
    expect(sent.seated.sort()).toEqual(['sp-a', 'sp-b']);
    const trip = (await db().doc(`trips/${sent.tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual(['sp-a', 'sp-b']);
    const pool = (await db().doc(`sharedPools/${made.poolId}`).get()).data()!;
    expect(pool.bookings).toEqual([]);
    expect(pool.dispatchAt).toBeUndefined();
    expect(pool.tripId).toBe(sent.tripId);
  });

  it('two dispatches at once (the clock and a join) let nobody go', async () => {
    const made = await create('sp-a', { departTime: pktClock(2 * 3600_000) });
    await join('sp-b', made.poolId);
    const [one, two] = await Promise.all([dispatchPool(made.poolId), dispatchPool(made.poolId)]);
    expect([...one.dropped, ...two.dropped]).toEqual([]);
    const tripId = one.tripId ?? two.tripId;
    expect((await db().doc(`trips/${tripId}`).get()).get('poolMembers')).toHaveLength(2);
  });

  it('sends the car at once when the last seat is booked, and shows it full', async () => {
    const made = await create('sp-a', { departTime: pktClock(3 * 3600_000) });
    await join('sp-b', made.poolId);
    await join('sp-c', made.poolId);
    const fourth = await join('sp-d', made.poolId);
    expect(fourth.status).toBe('seated');

    const trip = (await db().doc(`trips/${fourth.tripId}`).get()).data()!;
    expect(trip.poolMembers).toHaveLength(4);
    const [card] = await search('sp-e');
    expect(card).toMatchObject({ state: 'full', seatsLeft: 0 });
  });

  it('gives a booked seat back for free', async () => {
    const made = await create('sp-a', { departTime: pktClock(2 * 3600_000) });
    await leaveSharedPool.run(makeReq({ poolId: made.poolId }, 'sp-a'));
    const pool = (await db().doc(`sharedPools/${made.poolId}`).get()).data()!;
    expect(pool.bookings).toEqual([]);
    expect(pool.dispatchAt).toBeUndefined();
  });
});

describe('search and ownership', () => {
  it('lists a car on your route first, then cars from your area, nearest drop-off first', async () => {
    const made = await create('sp-a', { departTime: pktClock(2 * 3600_000) });
    expect(await search('sp-b')).toMatchObject([{ id: made.poolId, nearby: false }]);
    // Same pickup, a drop-off ~3 km past the pool's: still from your area, met at its own ends.
    const farDrop = { from: NEAR.from, to: { lat: 33.7485, lng: 73.0433 } };
    expect(await search('sp-b', farDrop)).toMatchObject([{ id: made.poolId, nearby: true }]);
    // A pickup ~5 km away is not your area.
    expect(await search('sp-b', { from: { lat: 33.64, lng: 73.0479 }, to: NEAR.to })).toEqual([]);
    // Before a search: every shared ride in the city.
    expect((await search('sp-b', {})).map((c) => c.id)).toEqual([made.poolId]);

    // Two cars from F-7, neither on a route to (33.76, 73.0433): the one that ends nearer it first.
    const further = await create('sp-c', { departTime: pktClock(2 * 3600_000), dropoff: { lat: 33.7485, lng: 73.0433, address: 'F-11 north' } });
    const past = { from: NEAR.from, to: { lat: 33.76, lng: 73.0433 } };
    expect((await search('sp-b', past)).map((c) => c.id)).toEqual([further.poolId, made.poolId]);
  });

  it('only the creator may change it, and removing it only hides it from their own list', async () => {
    const made = await create('sp-a', { departTime: pktClock(2 * 3600_000) });
    await expect(editSharedPool.run(makeReq({ poolId: made.poolId, label: 'Mine now' }, 'sp-b')))
      .rejects.toThrow(/Only the person who started/);

    await leaveSharedPool.run(makeReq({ poolId: made.poolId }, 'sp-a'));
    await editSharedPool.run(makeReq({ poolId: made.poolId, remove: true }, 'sp-a'));
    const mine = (await getSharedPools.run(makeReq({ mine: true }, 'sp-a'))) as { pools: PoolCard[] };
    expect(mine.pools).toEqual([]);
    expect(await search('sp-a', {})).toEqual([]);
    expect((await search('sp-b')).map((c) => c.id)).toEqual([made.poolId]);
  });

  it('will not move a time other riders have booked for', async () => {
    const made = await create('sp-a', { departTime: pktClock(2 * 3600_000) });
    await join('sp-b', made.poolId);
    await expect(editSharedPool.run(makeReq({ poolId: made.poolId, departTime: '23:59' }, 'sp-a')))
      .rejects.toThrow(/cannot change now/);
  });
});
