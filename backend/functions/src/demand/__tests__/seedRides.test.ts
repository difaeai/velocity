/**
 * Seeded rides — the examples a cold area is shown, and the four promises they
 * have to keep: never bookable, gender-correct, self-cancelling, and steady
 * under a polling screen.
 *
 * The pure half drives the generator with a clock. The emulator half runs the
 * real callables with several riders and several drivers at once, because every
 * interesting failure in this feature is a failure of "what does THIS person
 * see" — and one person on their own can never show that.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { geohashForLocation } from 'geofire-common';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../../domain/fares';
import {
  SEED_FARES,
  SEED_UNTIL,
  SEED_GONE,
  clearSeedSupplyCache,
  isSeedRideId,
  seedEndsNear,
  seedRides,
  seedsAllowed,
} from '../seedRides';
import {
  acceptSharedPool,
  createSharedPool,
  getSharedPools,
  getStarterRides,
  joinSharedPool,
  type DriverPoolView,
  type PoolCard,
} from '../../sharedPools';

const ISB = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const ISB_TO = { lat: 33.7215, lng: 73.0433, address: 'F-11 Markaz, Islamabad' };
/** Mid-Indian-Ocean: in no city we hold a single coordinate for. */
const NOWHERE = { lat: -20, lng: 80 };

const ends = { pickup: ISB, dropoff: ISB_TO };
const NOW = Date.UTC(2026, 10, 13, 6, 0);

/**
 * "HH:MM" in Pakistan time, two hours out — a pool that keeps its queue. One
 * that leaves now sends its car on the second booking, which empties the very
 * queue these tests are counting.
 */
const laterToday = () => new Date(Date.now() + 2 * 3600_000 + 5 * 3600_000).toISOString().slice(11, 16);

const ridesFor = (gender: string, mixedOk = false, nowMs = NOW) =>
  seedRides({ nowMs, gender, mixedOk, ...ends });

// ── The generator ───────────────────────────────────────────────────────────

describe('the owner’s three fares', () => {
  it('is exactly PKR 1,200 / 1,600 / 1,900, once each, for a man', () => {
    expect(ridesFor('male').map((r) => r.fare).sort((a, b) => a - b)).toEqual([1200, 1600, 1900]);
  });

  it('and exactly the same three for a woman', () => {
    expect(ridesFor('female').map((r) => r.fare).sort((a, b) => a - b)).toEqual([...SEED_FARES]);
  });

  it('prices a seat with the real ladder, never a made-up number', () => {
    for (const r of ridesFor('male')) {
      expect(r.farePerSeat).toBe(poolPerSeatFare(r.fare, r.riders + 1));
      expect(r.fareLadder).toEqual([1, 2, 3, 4].map((n) => poolPerSeatFare(r.fare, n)));
    }
  });

  it('always leaves a seat free — an example nobody could join is no advertisement', () => {
    for (let bucket = 0; bucket < 50; bucket += 1) {
      for (const r of ridesFor('male', false, NOW + bucket * 10 * 60_000)) {
        expect(r.riders).toBeGreaterThanOrEqual(1);
        expect(r.riders).toBeLessThan(MAX_POOL_RIDERS);
        expect(r.seatsLeft).toBeGreaterThanOrEqual(1);
        expect(r.riders + r.seatsLeft).toBe(MAX_POOL_RIDERS);
      }
    }
  });

  it('always leaves in the future, and inside the half hour', () => {
    for (const r of ridesFor('female')) {
      expect(r.departsAtMs).toBeGreaterThan(NOW);
      expect(r.departsAtMs - NOW).toBeLessThanOrEqual(30 * 60_000);
    }
  });
});

describe('men’s rides and women’s rides are separate lists', () => {
  it('shows a man only the men’s rides', () => {
    const seen = ridesFor('male');
    expect(seen).toHaveLength(3);
    expect(seen.every((r) => r.gender === 'male')).toBe(true);
  });

  it('shows a woman only the women’s rides', () => {
    const seen = ridesFor('female');
    expect(seen).toHaveLength(3);
    expect(seen.every((r) => r.gender === 'female')).toBe(true);
  });

  it('shows both to somebody who asked to travel with other genders', () => {
    const seen = ridesFor('female', true);
    expect(seen).toHaveLength(6);
    expect(new Set(seen.map((r) => r.gender))).toEqual(new Set(['male', 'female']));
  });

  it('shows none to somebody who has not set a gender — the real rule gives them an empty car', () => {
    expect(ridesFor('unspecified')).toHaveLength(0);
  });

  it('…unless they opted into mixed rides, which is the one thing that lets them share', () => {
    expect(ridesFor('unspecified', true)).toHaveLength(6);
  });

  it('never offers a woman a ride full of men she could not get into', () => {
    expect(ridesFor('female').some((r) => r.gender === 'male')).toBe(false);
  });
});

describe('a screen that polls does not shuffle under the reader', () => {
  it('is identical across a minute of polling', () => {
    const a = ridesFor('male', false, NOW);
    const b = ridesFor('male', false, NOW + 20_000);
    const c = ridesFor('male', false, NOW + 59_000);
    expect(a.map((r) => r.id + r.riders)).toEqual(b.map((r) => r.id + r.riders));
    expect(a.map((r) => r.id + r.riders)).toEqual(c.map((r) => r.id + r.riders));
  });

  it('but moves on over the day, so the same three are not frozen forever', () => {
    const shapes = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      shapes.add(ridesFor('male', false, NOW + i * 10 * 60_000).map((r) => r.riders).join(','));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe('an example is never mistaken for a real ride', () => {
  it('marks every one of them', () => {
    expect(ridesFor('male').every((r) => r.seeded === true)).toBe(true);
  });

  it('gives them ids nothing real can collide with', () => {
    for (const r of ridesFor('male', true)) expect(isSeedRideId(r.id)).toBe(true);
  });

  it('and does not mistake a Firestore id for one', () => {
    expect(isSeedRideId('aBcD1234efGh')).toBe(false);
    expect(isSeedRideId('')).toBe(false);
    expect(isSeedRideId(undefined)).toBe(false);
    expect(isSeedRideId(null)).toBe(false);
    expect(isSeedRideId({ id: 'seed:male:1200' })).toBe(false);
  });
});

describe('where an example says it is going', () => {
  it('names real places in the city the driver is actually in', () => {
    const near = seedEndsNear(ISB);
    expect(near).not.toBeNull();
    expect(near!.pickup.address.length).toBeGreaterThan(2);
    expect(near!.dropoff.address).not.toBe(near!.pickup.address);
  });

  it('invents nothing where we hold no coordinates — no card beats a fake address', () => {
    expect(seedEndsNear(NOWHERE)).toBeNull();
  });

  it('returns nothing at all when an end is unknown', () => {
    expect(seedRides({ nowMs: NOW, gender: 'male', mixedOk: false, pickup: ISB, dropoff: null })).toEqual([]);
    expect(seedRides({ nowMs: NOW, gender: 'male', mixedOk: false, pickup: null, dropoff: ISB_TO })).toEqual([]);
  });
});

// ── The five-and-stop rule, against real documents ──────────────────────────

/** An online, approved driver where the nearby query will find them. */
async function seedDriver(uid: string, at = ISB) {
  await db().doc(`drivers/${uid}`).set({
    online: true,
    verificationStatus: 'approved',
    geohash: geohashForLocation([at.lat, at.lng]),
    lastLocation: { lat: at.lat, lng: at.lng },
    lastSeenAt: new Date(),
    vehicleType: 'mini',
  });
}

describe('the examples stop once the area can stand on its own', () => {
  beforeEach(async () => {
    await clearFirestore();
    clearSeedSupplyCache();
  });

  it('shows them while the area is empty on both sides', async () => {
    expect((await seedsAllowed(ISB.lat, ISB.lng, 0)).show).toBe(true);
  });

  it('keeps showing them with plenty of drivers but no riders — that area needs demand, not supply', async () => {
    for (let i = 0; i < 8; i += 1) await seedDriver(`sd-${i}`);
    clearSeedSupplyCache();
    const d = await seedsAllowed(ISB.lat, ISB.lng, 1);
    expect(d.drivers).toBeGreaterThanOrEqual(SEED_UNTIL);
    expect(d.show).toBe(true);
  });

  it('keeps showing them with plenty of riders but no drivers', async () => {
    expect((await seedsAllowed(ISB.lat, ISB.lng, 20)).show).toBe(true);
  });

  it('stops the moment BOTH sides reach five', async () => {
    for (let i = 0; i < SEED_UNTIL; i += 1) await seedDriver(`sd-${i}`);
    clearSeedSupplyCache();
    expect((await seedsAllowed(ISB.lat, ISB.lng, SEED_UNTIL)).show).toBe(false);
  });

  it('comes back if the area goes quiet again', async () => {
    for (let i = 0; i < SEED_UNTIL; i += 1) await seedDriver(`sd-${i}`);
    clearSeedSupplyCache();
    expect((await seedsAllowed(ISB.lat, ISB.lng, SEED_UNTIL)).show).toBe(false);
    for (let i = 0; i < SEED_UNTIL; i += 1) await db().doc(`drivers/sd-${i}`).delete();
    clearSeedSupplyCache();
    expect((await seedsAllowed(ISB.lat, ISB.lng, SEED_UNTIL)).show).toBe(true);
  });

  it('does not count drivers in another city as this area’s supply', async () => {
    for (let i = 0; i < 8; i += 1) await seedDriver(`sd-${i}`, { lat: 24.86, lng: 67.07, address: 'Karachi' });
    clearSeedSupplyCache();
    expect((await seedsAllowed(ISB.lat, ISB.lng, 9)).drivers).toBe(0);
  });
});

// ── Through the real callables, with several people at once ─────────────────

const RIDERS = { man: 'seed-m', man2: 'seed-m2', woman: 'seed-f', open: 'seed-open' };

async function seedUsers() {
  await db().doc(`users/${RIDERS.man}`).set({ name: 'Ali', gender: 'male' });
  await db().doc(`users/${RIDERS.man2}`).set({ name: 'Bilal', gender: 'male' });
  await db().doc(`users/${RIDERS.woman}`).set({ name: 'Sara', gender: 'female' });
  await db().doc(`users/${RIDERS.open}`).set({ name: 'Omar', gender: 'male', mixedRideOk: true });
}

const search = async (uid: string): Promise<PoolCard[]> =>
  ((await getSharedPools.run(makeReq({
    city: 'islamabad',
    from: { lat: ISB.lat, lng: ISB.lng },
    to: { lat: ISB_TO.lat, lng: ISB_TO.lng },
    fromAddress: ISB.address,
    toAddress: ISB_TO.address,
  }, uid))) as { pools: PoolCard[] }).pools;

describe('what a rider actually sees on the Corporate & Students screen', () => {
  beforeEach(async () => {
    await clearFirestore();
    clearSeedSupplyCache();
    await seedUsers();
  });

  it('mixes the examples in while the area is cold', async () => {
    const seeded = (await search(RIDERS.man)).filter((p) => p.seeded);
    expect(seeded).toHaveLength(3);
    expect(seeded.map((p) => p.fare).sort((a, b) => a - b)).toEqual([1200, 1600, 1900]);
  });

  it('gives a man and a woman different example rides', async () => {
    const his = (await search(RIDERS.man)).filter((p) => p.seeded).map((p) => p.id);
    const hers = (await search(RIDERS.woman)).filter((p) => p.seeded).map((p) => p.id);
    expect(his).toHaveLength(3);
    expect(hers).toHaveLength(3);
    expect(his.some((id) => hers.includes(id))).toBe(false);
    expect((await search(RIDERS.woman)).filter((p) => p.seeded).every((p) => p.riderGender === 'female')).toBe(true);
  });

  it('gives somebody who opted into mixed rides both lists', async () => {
    expect((await search(RIDERS.open)).filter((p) => p.seeded)).toHaveLength(6);
  });

  it('names them after the route the rider actually searched', async () => {
    const seeded = (await search(RIDERS.man)).filter((p) => p.seeded);
    expect(seeded.every((p) => p.pickup.address === ISB.address)).toBe(true);
    expect(seeded.every((p) => p.dropoff.address === ISB_TO.address)).toBe(true);
  });

  it('puts the real rides first and the examples after them', async () => {
    await createSharedPool.run(makeReq({
      city: 'islamabad', label: 'Real', rideType: 'mini', pickup: ISB, dropoff: ISB_TO,
    }, RIDERS.man2));
    const pools = await search(RIDERS.man);
    const firstSeed = pools.findIndex((p) => p.seeded);
    const lastReal = pools.map((p) => !p.seeded).lastIndexOf(true);
    expect(firstSeed).toBeGreaterThan(-1);
    expect(lastReal).toBeLessThan(firstSeed);
  });

  it('never puts an example in "My rides" — that list is what the rider booked', async () => {
    const mine = ((await getSharedPools.run(makeReq({ mine: true }, RIDERS.man))) as { pools: PoolCard[] }).pools;
    expect(mine.some((p) => p.seeded)).toBe(false);
  });

  it('stops showing them once the area has five drivers and five riders', async () => {
    for (let i = 0; i < SEED_UNTIL; i += 1) await seedDriver(`sd-${i}`);
    /**
     * Five real riders holding seats at this pickup. Two pools with a future
     * departure, because a pool sends its car — and empties its queue — as soon
     * as a second rider books one that leaves now, and a car that has gone is
     * not demand waiting in the area.
     */
    let booked = 0;
    for (const host of ['h1', 'h2', 'h3']) {
      await db().doc(`users/${host}`).set({ name: host, gender: 'male' });
      const { poolId } = (await createSharedPool.run(makeReq({
        city: 'islamabad', label: `Real ${host}`, rideType: 'mini',
        pickup: ISB, dropoff: ISB_TO, departTime: laterToday(),
      }, host))) as { poolId: string };
      booked += 1;
      if (booked < SEED_UNTIL) {
        const mate = `${host}-mate`;
        await db().doc(`users/${mate}`).set({ name: mate, gender: 'male' });
        await joinSharedPool.run(makeReq({ poolId }, mate));
        booked += 1;
      }
    }
    expect(booked).toBeGreaterThanOrEqual(SEED_UNTIL);
    clearSeedSupplyCache();
    expect((await search(RIDERS.man)).some((p) => p.seeded)).toBe(false);
  });
});

describe('an example cannot be booked, by anybody, ever', () => {
  beforeEach(async () => {
    await clearFirestore();
    clearSeedSupplyCache();
    await seedUsers();
  });

  it('answers a rider’s Join with the owner’s sentence, not an error', async () => {
    const seed = (await search(RIDERS.man)).find((p) => p.seeded)!;
    await expect(joinSharedPool.run(makeReq({ poolId: seed.id }, RIDERS.man))).rejects.toThrow(SEED_GONE);
  });

  it('writes nothing when it refuses — no pool, no seat, no trip', async () => {
    const seed = (await search(RIDERS.man)).find((p) => p.seeded)!;
    await joinSharedPool.run(makeReq({ poolId: seed.id }, RIDERS.man)).catch(() => {});
    expect((await db().collection('sharedPools').get()).empty).toBe(true);
    expect((await db().collection('trips').get()).empty).toBe(true);
    expect((await db().doc(`users/${RIDERS.man}`).get()).get('activeTripId')).toBeUndefined();
  });

  it('refuses a driver who tries to accept one', async () => {
    await expect(
      acceptSharedPool.run({
        ...makeReq({ poolId: 'seed:male:1600' }, 'some-driver'),
        auth: { uid: 'some-driver', token: { uid: 'some-driver', role: 'driver' } },
      } as never),
    ).rejects.toThrow(SEED_GONE);
  });

  it('refuses a hand-made seed id nobody was ever shown', async () => {
    await expect(joinSharedPool.run(makeReq({ poolId: 'seed:anything' }, RIDERS.man))).rejects.toThrow(SEED_GONE);
  });

  it('survives several riders tapping the same example at once', async () => {
    const seed = (await search(RIDERS.man)).find((p) => p.seeded)!;
    const all = await Promise.allSettled(
      [RIDERS.man, RIDERS.man2, RIDERS.open].map((uid) => joinSharedPool.run(makeReq({ poolId: seed.id }, uid))),
    );
    expect(all.every((r) => r.status === 'rejected')).toBe(true);
    expect((await db().collection('trips').get()).empty).toBe(true);
  });
});

describe('what a driver part-way through registering is shown', () => {
  beforeEach(async () => {
    await clearFirestore();
    clearSeedSupplyCache();
    await seedUsers();
  });

  const starter = async (uid: string): Promise<DriverPoolView[]> =>
    ((await getStarterRides.run(makeReq({ lat: ISB.lat, lng: ISB.lng }, uid))) as { pools: DriverPoolView[] }).pools;

  it('shows them the three fares, without the driver role', async () => {
    const pools = await starter(RIDERS.man);
    expect(pools).toHaveLength(3);
    expect(pools.map((p) => p.earnNow).sort((a, b) => a - b)).toEqual([1200, 1600, 1900]);
    expect(pools.every((p) => p.seeded)).toBe(true);
  });

  it('shows them even where the area is busy — registration is not a live feed', async () => {
    for (let i = 0; i < 8; i += 1) await seedDriver(`sd-${i}`);
    clearSeedSupplyCache();
    expect(await starter(RIDERS.man)).toHaveLength(3);
  });

  it('never leaks a real rider’s pool to somebody nobody has checked', async () => {
    await createSharedPool.run(makeReq({
      city: 'islamabad', label: 'Real people', rideType: 'mini', pickup: ISB, dropoff: ISB_TO,
    }, RIDERS.man2));
    const pools = await starter(RIDERS.man);
    expect(pools.every((p) => p.seeded === true)).toBe(true);
    expect(pools.some((p) => p.label === 'Real people')).toBe(false);
  });

  it('gives a woman registering the women’s rides', async () => {
    expect((await starter(RIDERS.woman)).every((p) => isSeedRideId(p.id))).toBe(true);
    expect(await starter(RIDERS.woman)).toHaveLength(3);
  });

  it('shows nothing rather than a fake address outside the cities we hold', async () => {
    const pools = ((await getStarterRides.run(
      makeReq({ lat: NOWHERE.lat, lng: NOWHERE.lng }, RIDERS.man),
    )) as { pools: DriverPoolView[] }).pools;
    expect(pools).toEqual([]);
  });

  it('refuses a caller who is not signed in at all', async () => {
    await expect(
      getStarterRides.run({ data: { lat: ISB.lat, lng: ISB.lng }, auth: null } as never),
    ).rejects.toThrow();
  });
});
