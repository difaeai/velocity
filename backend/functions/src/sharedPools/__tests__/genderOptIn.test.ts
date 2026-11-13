/**
 * The owner's gender rule on ride sharing, and the option he asked for with it.
 * ----------------------------------------------------------------------------
 * "Men travel only with men and women only with women — and keep an option for
 * anybody who wants to travel with other genders" (owner, 2026-11-13).
 *
 * The first half was already enforced. The second half was not: `sameGenderGate`
 * ignored `mixedRideOk` entirely, so the switch existed in the app, saved to the
 * user document, and changed nothing on this screen. These tests pin both halves
 * and, above all, the thing that makes the option safe to grant: it takes
 * EVERYONE's agreement, not just the agreement of the person joining.
 *
 * Multi-user on purpose. A one-rider test cannot tell a mutual rule from a
 * one-sided one, which is exactly the bug being fixed.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { sameGenderGate } from '../../trips/enRoute';
import { createSharedPool, getSharedPools, joinSharedPool, type PoolCard } from '../index';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'F-11 Markaz, Islamabad' };

// ── The gate itself ─────────────────────────────────────────────────────────

describe('sameGenderGate', () => {
  const man = { gender: 'male', mixedOk: false };
  const woman = { gender: 'female', mixedOk: false };
  const openMan = { gender: 'male', mixedOk: true };
  const openWoman = { gender: 'female', mixedOk: true };

  it('lets anybody into an empty car', () => {
    expect(sameGenderGate([], 'male').allowed).toBe(true);
    expect(sameGenderGate([], 'female').allowed).toBe(true);
    expect(sameGenderGate([], 'unspecified').allowed).toBe(true);
  });

  it('keeps a men’s car for men and a women’s car for women', () => {
    expect(sameGenderGate([man], 'male').allowed).toBe(true);
    expect(sameGenderGate([woman], 'female').allowed).toBe(true);
    expect(sameGenderGate([man], 'female').allowed).toBe(false);
    expect(sameGenderGate([woman], 'male').allowed).toBe(false);
  });

  it('says which car it is, in words a rider can act on', () => {
    const r = sameGenderGate([woman, woman], 'male');
    expect(r.allowed).toBe(false);
    expect((r as { reason: string }).reason).toContain('women only');
    const r2 = sameGenderGate([man], 'female');
    expect((r2 as { reason: string }).reason).toContain('men only');
  });

  it('gives a rider with no gender set an empty car only', () => {
    expect(sameGenderGate([man], 'unspecified').allowed).toBe(false);
    expect(sameGenderGate([woman], 'unspecified').allowed).toBe(false);
  });

  // ── The option the owner asked for ────────────────────────────────────────

  it('lets a woman into a men’s car when SHE and EVERY man in it asked for mixed rides', () => {
    expect(sameGenderGate([openMan, openMan], 'female', true).allowed).toBe(true);
  });

  it('refuses when the joiner wants mixed but somebody already in the car did not', () => {
    // The reason the rule is mutual: the man who never opted in chose this car
    // under the same-gender promise, and a setting on her phone cannot answer
    // for him.
    expect(sameGenderGate([openMan, man], 'female', true).allowed).toBe(false);
  });

  it('refuses when the car opted in but the joiner did not', () => {
    expect(sameGenderGate([openWoman], 'male', false).allowed).toBe(false);
  });

  it('treats a seat booked before the option existed as "has not opted in"', () => {
    expect(sameGenderGate([{ gender: 'male' }], 'female', true).allowed).toBe(false);
  });

  it('lets an unknown-gender rider share only under the same mutual opt-in', () => {
    expect(sameGenderGate([openMan], 'unspecified', true).allowed).toBe(true);
    expect(sameGenderGate([openMan], 'unspecified', false).allowed).toBe(false);
  });

  it('is unchanged for same-gender cars whatever the switches say', () => {
    expect(sameGenderGate([openMan], 'male', false).allowed).toBe(true);
    expect(sameGenderGate([man], 'male', true).allowed).toBe(true);
  });
});

// ── End to end, through the callables, with real people ─────────────────────

const create = (uid: string, extra: Record<string, unknown> = {}) =>
  createSharedPool.run(makeReq({
    city: 'islamabad', label: 'F-7 to F-11', rideType: 'mini', pickup: PICKUP, dropoff: DROPOFF, ...extra,
  }, uid)) as Promise<{ poolId: string }>;

/**
 * "HH:MM" in Pakistan time, two hours out.
 *
 * A pool with no departure time sends a car the moment a second rider books,
 * so the seats move from `bookings` into the car's roster immediately. A future
 * time keeps the pool GATHERING, which is the only way to inspect a booking.
 */
const laterToday = () => new Date(Date.now() + 2 * 3600_000 + 5 * 3600_000).toISOString().slice(11, 16);

/** The genders in the car a pool sent, in the order they got in. */
async function ridersInCar(poolId: string): Promise<string[]> {
  const tripId = (await db().doc(`sharedPools/${poolId}`).get()).get('tripId') as string | null;
  if (!tripId) return [];
  const roster = (await db().doc(`trips/${tripId}`).get()).get('poolRoster') as { gender: string }[] | undefined;
  return (roster ?? []).map((r) => r.gender);
}

const search = async (uid: string): Promise<PoolCard[]> =>
  ((await getSharedPools.run(makeReq({
    city: 'islamabad',
    from: { lat: PICKUP.lat, lng: PICKUP.lng },
    to: { lat: DROPOFF.lat, lng: DROPOFF.lng },
  }, uid))) as { pools: PoolCard[] }).pools;

describe('two riders, one car — the rule as riders meet it', () => {
  beforeEach(async () => {
    await clearFirestore();
    await db().doc('users/g-man').set({ name: 'Ali', gender: 'male' });
    await db().doc('users/g-man2').set({ name: 'Bilal', gender: 'male' });
    await db().doc('users/g-woman').set({ name: 'Sara', gender: 'female' });
    await db().doc('users/g-open-man').set({ name: 'Omar', gender: 'male', mixedRideOk: true });
    await db().doc('users/g-open-woman').set({ name: 'Hina', gender: 'female', mixedRideOk: true });
    await db().doc('users/g-none').set({ name: 'Nobody' });
  });

  it('a second man joins the first man’s car', async () => {
    const { poolId } = await create('g-man');
    const res = await joinSharedPool.run(makeReq({ poolId }, 'g-man2'));
    expect((res as { status: string }).status).toBeTruthy();
  });

  it('a woman is refused a men’s car, and told why', async () => {
    const { poolId } = await create('g-man');
    await expect(joinSharedPool.run(makeReq({ poolId }, 'g-woman'))).rejects.toThrow(/men only/i);
  });

  it('and the men’s car is not even offered to her — a Join that can only fail is no offer', async () => {
    const { poolId } = await create('g-man');
    expect((await search('g-woman')).some((p) => p.id === poolId)).toBe(false);
    expect((await search('g-man2')).some((p) => p.id === poolId)).toBe(true);
  });

  it('an opted-in woman joins an opted-in man’s car — the option works end to end', async () => {
    // No departure time, so the car goes out the moment she books: this proves
    // the opt-in through the CAR door (joinPoolTripAsRider), not just the queue.
    const { poolId } = await create('g-open-man');
    const res = await joinSharedPool.run(makeReq({ poolId }, 'g-open-woman'));
    expect((res as { status: string }).status).toBeTruthy();
    expect([...await ridersInCar(poolId)].sort()).toEqual(['female', 'male']);
  });

  it('…and through the queue door too, on a pool that has not sent a car yet', async () => {
    const { poolId } = await create('g-open-man', { departTime: laterToday() });
    await joinSharedPool.run(makeReq({ poolId }, 'g-open-woman'));
    const bookings = (await db().doc(`sharedPools/${poolId}`).get()).get('bookings') as { gender: string }[];
    expect(bookings.map((b) => b.gender).sort()).toEqual(['female', 'male']);
  });

  it('…and it is offered to her, so she can find it in the first place', async () => {
    const { poolId } = await create('g-open-man');
    expect((await search('g-open-woman')).some((p) => p.id === poolId)).toBe(true);
  });

  it('one plain man in the car closes it again, even to an opted-in woman', async () => {
    const { poolId } = await create('g-open-man', { departTime: laterToday() });
    await joinSharedPool.run(makeReq({ poolId }, 'g-man2'));
    await expect(joinSharedPool.run(makeReq({ poolId }, 'g-open-woman'))).rejects.toThrow(/men only/i);
  });

  it('a rider with no gender set gets an empty car, not somebody else’s', async () => {
    const { poolId } = await create('g-man');
    await expect(joinSharedPool.run(makeReq({ poolId }, 'g-none'))).rejects.toThrow();
  });

  it('records each rider’s own answer on the seat, not the car’s', async () => {
    const { poolId } = await create('g-open-man', { departTime: laterToday() });
    await joinSharedPool.run(makeReq({ poolId }, 'g-open-woman'));
    const bookings = (await db().doc(`sharedPools/${poolId}`).get())
      .get('bookings') as { uid: string; mixedOk?: boolean }[];
    expect(bookings.every((b) => b.mixedOk === true)).toBe(true);
  });

  it('three riders racing for one car never seat more than its seats', async () => {
    const { poolId } = await create('g-man', { departTime: laterToday() });
    for (const uid of ['r1', 'r2', 'r3', 'r4']) {
      await db().doc(`users/${uid}`).set({ name: uid, gender: 'male' });
    }
    await Promise.allSettled(
      ['r1', 'r2', 'r3', 'r4'].map((uid) => joinSharedPool.run(makeReq({ poolId }, uid))),
    );
    const bookings = (await db().doc(`sharedPools/${poolId}`).get()).get('bookings') as unknown[];
    expect(bookings.length).toBeLessThanOrEqual(4);
    expect(new Set((bookings as { uid: string }[]).map((b) => b.uid)).size).toBe(bookings.length);
  });
});
