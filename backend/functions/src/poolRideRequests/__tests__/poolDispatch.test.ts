/**
 * The whole chain: riders build a pool, one driver is offered it, refusals walk
 * it down the queue, and nothing can take a ride that is somebody else's.
 *
 * Verified invariants:
 *  - a new pool is offered to exactly ONE driver, the most senior in the zone
 *  - the other eligible drivers cannot see it, and are refused if they call the
 *    accept callable anyway
 *  - a refusal hands the ride to the next driver, then the next
 *  - a refusal is permanent: that driver is never offered this pool again
 *  - an offer that simply lapses costs the same as a refusal
 *  - once the queue is exhausted the ride opens to every nearby driver
 *  - drivers who could not complete the ride are never offered it: wrong
 *    gender, no car photo, commission owing, solo mode, the pool's own members
 *  - accepting ends the ladder and the rest of the pool flow is untouched
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { geohashForLocation } from 'geofire-common';

import { clearFirestore, confirmedCar, db } from '../../travelMate/__tests__/helpers';
import { createPoolRideRequest, driverRespondToRequest, getNearbyPoolRequests } from '../index';
import { advancePoolLadder, sweepLapsedPoolOffers } from '../dispatch';
import { readDispatch } from '../dispatchLadder';
import { CONFIG_DOC, invalidatePricingCache, zoneKey } from '../../pricing/config';
import { fareCityIdsFor } from '../../fare/cityConfig';

function makeReq<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}
const driverReq = <T>(data: T, uid: string) => makeReq(data, uid, 'driver');

const LEADER = 'leader-uid';
const PICKUP = { lat: 33.6844, lng: 73.0479 };

const BASE_REQUEST = {
  pickupLat: PICKUP.lat,
  pickupLng: PICKUP.lng,
  pickupAreaName: 'F-7, Islamabad',
  destinationLat: 33.7215,
  destinationLng: 73.0433,
  destinationAreaName: 'G-9, Islamabad',
  proposedFarePerSeat: 200,
  totalSlots: 3,
  genderPref: 'any' as 'any' | 'male_only' | 'female_only',
};

/**
 * A driver the dispatcher will consider: online, approved, car photographed,
 * and — the field that is easy to forget — `geohash`, which is what
 * `queryNearbyDriverDocs` actually searches on. Stamped here the way the
 * sweeper stamps it in production.
 */
async function seedEligibleDriver(
  uid: string,
  over: Record<string, unknown> = {},
  at: { lat: number; lng: number } = PICKUP,
) {
  await db().doc(`drivers/${uid}`).set({
    gender: 'male',
    fullName: `Driver ${uid}`,
    vehicleLabel: 'Toyota Corolla',
    plate: 'ABC-123',
    online: true,
    verificationStatus: 'approved',
    lastLocation: { lat: at.lat, lng: at.lng },
    geohash: geohashForLocation([at.lat, at.lng]),
    ...confirmedCar(),
    ...over,
  });
}

/**
 * Seniority in the pickup's zone, as the pricing tick would have written it.
 *
 * The document id is built with the same `zoneKey` and city resolution the
 * dispatcher reads with, rather than spelled out here — a hardcoded id would
 * pass while silently testing an empty queue if either ever changed.
 */
async function seedZoneQueue(order: string[]) {
  const zone = geohashForLocation([PICKUP.lat, PICKUP.lng]).slice(0, 5);
  const key = zoneKey(fareCityIdsFor(PICKUP)[0]!, zone);
  await db().doc(`pricingZones/${key}`).set({
    queue: order.map((driverId, i) => ({
      driverId,
      queuedAt: 1_000 + i,
      lastSeenAt: Date.now(),
    })),
    updatedAt: Date.now(),
  });
}

const createPool = async (over: Partial<typeof BASE_REQUEST> = {}) =>
  (await createPoolRideRequest.run(makeReq({ ...BASE_REQUEST, ...over }, LEADER))).requestId as string;

const ladderOf = async (id: string) =>
  readDispatch((await db().doc(`poolRideRequests/${id}`).get()).data()).dispatch;

const feedFor = async (uid: string) =>
  (await getNearbyPoolRequests.run(
    driverReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, uid),
  )) as { requests: { requestId: string; exclusive: boolean; offerExpiresAt: number | null }[] };

/** Force the current offer to have run out, without waiting 25 real seconds. */
async function lapseOffer(id: string) {
  const { dispatch } = readDispatch((await db().doc(`poolRideRequests/${id}`).get()).data());
  await db().doc(`poolRideRequests/${id}`).update({
    dispatch: { ...dispatch, offerExpiresAt: Date.now() - 1 },
  });
}

beforeEach(async () => {
  await clearFirestore();
  // The settings are cached per instance for 60s, and `clearFirestore` does not
  // touch that cache — so without this, one test switching the ladder off would
  // leak into every test that ran within the next minute.
  invalidatePricingCache();
  await db().doc(`users/${LEADER}`).set({ gender: 'male', displayName: 'Leader' });
});

// ── One pool, one driver ────────────────────────────────────────────────────

describe('a new pool goes to one driver', () => {
  beforeEach(async () => {
    await seedEligibleDriver('d1');
    await seedEligibleDriver('d2');
    await seedEligibleDriver('d3');
    await seedZoneQueue(['d1', 'd2', 'd3']);
  });

  it('offers it to the most senior driver in the zone', async () => {
    const id = await createPool();
    const ladder = await ladderOf(id);

    expect(ladder.offeredDriverId).toBe('d1');
    expect(ladder.offers).toBe(1);
    expect(ladder.openToAll).toBe(false);
    expect(ladder.offerExpiresAt).toBeGreaterThan(Date.now());
  });

  it('shows it to that driver with a clock, and to nobody else at all', async () => {
    const id = await createPool();

    const held = await feedFor('d1');
    expect(held.requests.map((r) => r.requestId)).toEqual([id]);
    expect(held.requests[0]!.exclusive).toBe(true);
    expect(held.requests[0]!.offerExpiresAt).toBeGreaterThan(Date.now());

    // The behaviour this whole feature is for: before the ladder, d2 and d3
    // saw this pool too and the first tap won.
    expect((await feedFor('d2')).requests).toHaveLength(0);
    expect((await feedFor('d3')).requests).toHaveLength(0);
  });

  it('refuses an accept from a driver who was not offered it', async () => {
    const id = await createPool();
    await expect(driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'd2')))
      .rejects.toThrow(/being offered this ride/i);

    // …and the ride is still d1's.
    expect((await ladderOf(id)).offeredDriverId).toBe('d1');
    expect((await db().doc(`poolRideRequests/${id}`).get()).get('driverId')).toBeNull();
  });

  it('lets the holder accept, and ends the ladder when they do', async () => {
    const id = await createPool();
    const res = await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'd1'));
    expect(res.status).toBe('active');

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.get('driverId')).toBe('d1');
    expect(snap.get('status')).toBe('active');
    // The no-joiner window the rest of the pool flow depends on still starts.
    expect(snap.get('activatedAt')).toBeTruthy();
    // No stale offer left claiming a driver is still deciding.
    const ladder = readDispatch(snap.data()).dispatch;
    expect(ladder.offeredDriverId).toBeNull();
    expect(ladder.offerExpiresAt).toBeNull();
  });
});

// ── The ladder: reject, next, next ──────────────────────────────────────────

describe('a refusal hands the ride to the next driver', () => {
  beforeEach(async () => {
    await seedEligibleDriver('d1');
    await seedEligibleDriver('d2');
    await seedEligibleDriver('d3');
    await seedZoneQueue(['d1', 'd2', 'd3']);
  });

  it('walks down the queue one refusal at a time', async () => {
    const id = await createPool();
    expect((await ladderOf(id)).offeredDriverId).toBe('d1');

    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd1'));
    let ladder = await ladderOf(id);
    expect(ladder.offeredDriverId).toBe('d2');
    expect(ladder.declined).toEqual(['d1']);
    expect(ladder.offers).toBe(2);

    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd2'));
    ladder = await ladderOf(id);
    expect(ladder.offeredDriverId).toBe('d3');
    expect(ladder.declined).toEqual(['d1', 'd2']);
    expect(ladder.offers).toBe(3);
  });

  it('moves the ride out of the refuser’s feed and into the next driver’s', async () => {
    const id = await createPool();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd1'));

    expect((await feedFor('d1')).requests).toHaveLength(0);
    const next = await feedFor('d2');
    expect(next.requests.map((r) => r.requestId)).toEqual([id]);
    expect(next.requests[0]!.exclusive).toBe(true);
  });

  it('never offers a pool back to a driver who refused it', async () => {
    const id = await createPool();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd1'));
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd2'));
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd3'));

    // Everyone has passed, so it is open to all — and still not in their feeds.
    expect((await ladderOf(id)).openToAll).toBe(true);
    for (const uid of ['d1', 'd2', 'd3']) {
      expect((await feedFor(uid)).requests).toHaveLength(0);
    }
    // A driver who never refused it, though, can see it now.
    await seedEligibleDriver('d4');
    const latecomer = await feedFor('d4');
    expect(latecomer.requests.map((r) => r.requestId)).toEqual([id]);
    expect(latecomer.requests[0]!.exclusive).toBe(false);
  });

  it('refuses to let a driver who passed accept it later', async () => {
    const id = await createPool();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd1'));
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd2'));
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd3'));

    await expect(driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'd1')))
      .rejects.toThrow(/already passed/i);
  });

  it('charges an ignored offer the same as a refusal', async () => {
    const id = await createPool();
    await lapseOffer(id);

    // What the sweeper does a minute later, or a feed poll does sooner.
    await advancePoolLadder(id);

    const ladder = await ladderOf(id);
    expect(ladder.declined).toEqual(['d1']);
    expect(ladder.offeredDriverId).toBe('d2');
  });

  it('is advanced by any driver’s feed poll, not only by the sweeper', async () => {
    const id = await createPool();
    await lapseOffer(id);

    // d2 polls. The lapsed ladder is repaired by the read itself.
    await feedFor('d2');

    const ladder = await ladderOf(id);
    expect(ladder.offeredDriverId).toBe('d2');
    expect(ladder.declined).toEqual(['d1']);
  });

  it('is advanced by the sweeper when nobody is polling at all', async () => {
    const id = await createPool();
    await lapseOffer(id);

    const { advanced } = await sweepLapsedPoolOffers();
    expect(advanced).toBe(1);
    expect((await ladderOf(id)).offeredDriverId).toBe('d2');
  });

  it('leaves a live offer alone, however often the ladder is poked', async () => {
    const id = await createPool();
    const before = await ladderOf(id);

    await advancePoolLadder(id);
    await feedFor('d2');
    await sweepLapsedPoolOffers();

    const after = await ladderOf(id);
    expect(after.offeredDriverId).toBe('d1');
    expect(after.offerExpiresAt).toBe(before.offerExpiresAt);
    expect(after.offers).toBe(1);
  });

  it('opens the ride to everybody once the ladder runs out of drivers', async () => {
    const id = await createPool();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd1'));
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd2'));
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, 'd3'));

    const ladder = await ladderOf(id);
    expect(ladder.openToAll).toBe(true);
    expect(ladder.offeredDriverId).toBeNull();
  });

  it('does not churn a finished ladder on every sweep', async () => {
    const id = await createPool();
    for (const uid of ['d1', 'd2', 'd3']) {
      await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, uid));
    }
    const settled = (await db().doc(`poolRideRequests/${id}`).get()).get('updatedAt');

    // Firestore sorts null before numbers, so the sweeper's
    // `dispatch.offerExpiresAt <= now` MATCHES the null an exhausted ladder
    // leaves behind — every finished pool comes back on every sweep. Without an
    // early exit each one would re-run a nine-range driver query a minute,
    // for ever, and rewrite `updatedAt` while it was at it.
    const { advanced } = await sweepLapsedPoolOffers();
    expect(advanced).toBe(0);
    expect((await db().doc(`poolRideRequests/${id}`).get()).get('updatedAt')).toEqual(settled);
  });

  it('still lets the ride be taken after everybody passed', async () => {
    const id = await createPool();
    for (const uid of ['d1', 'd2', 'd3']) {
      await driverRespondToRequest.run(driverReq({ requestId: id, action: 'reject' }, uid));
    }
    await seedEligibleDriver('d4');

    const res = await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'd4'));
    expect(res.status).toBe('active');
    expect((await db().doc(`poolRideRequests/${id}`).get()).get('driverId')).toBe('d4');
  });
});

// ── Who is never offered a ride ─────────────────────────────────────────────

describe('drivers the ladder skips', () => {
  it('skips the wrong gender for a women-only pool', async () => {
    await db().doc(`users/${LEADER}`).set({ gender: 'female', displayName: 'Leader' });
    await seedEligibleDriver('male-driver', { gender: 'male' });
    await seedEligibleDriver('female-driver', { gender: 'female' });
    await seedZoneQueue(['male-driver', 'female-driver']);

    const id = await createPool({ genderPref: 'female_only' });
    expect((await ladderOf(id)).offeredDriverId).toBe('female-driver');
  });

  it('skips a driver who has not photographed the car they are driving', async () => {
    await seedEligibleDriver('no-photo', { vehicleCheck: null, activeVehicleId: null });
    await seedEligibleDriver('ok');
    await seedZoneQueue(['no-photo', 'ok']);

    const id = await createPool();
    // Senior, nearby, right gender — and would be refused at accept, so the
    // ladder must not spend a rung on them.
    expect((await ladderOf(id)).offeredDriverId).toBe('ok');
  });

  it('skips a driver who has chosen solo work', async () => {
    await seedEligibleDriver('solo', { rideMode: 'solo' });
    await seedEligibleDriver('sharing', { rideMode: 'sharing' });
    await seedZoneQueue(['solo', 'sharing']);

    const id = await createPool();
    expect((await ladderOf(id)).offeredDriverId).toBe('sharing');
  });

  it('treats a driver with no stored mode as available, for the installed base', async () => {
    // No build before this writes `rideMode`. Absent has to mean eligible or
    // the ladder would find nobody on the phones already out there.
    await seedEligibleDriver('legacy-build');
    const id = await createPool();
    expect((await ladderOf(id)).offeredDriverId).toBe('legacy-build');
  });

  it('skips an offline driver and one parked outside the radius', async () => {
    await seedEligibleDriver('offline', { online: false });
    await seedEligibleDriver('far-away', {}, { lat: 34.5, lng: 73.5 });
    await seedEligibleDriver('near');
    await seedZoneQueue(['offline', 'far-away', 'near']);

    const id = await createPool();
    expect((await ladderOf(id)).offeredDriverId).toBe('near');
  });

  it('never offers a pool to its own leader', async () => {
    // Drivers off shift may ride as passengers, so the leader can be a driver.
    await seedEligibleDriver(LEADER);
    await seedEligibleDriver('someone-else');
    await seedZoneQueue([LEADER, 'someone-else']);

    const id = await createPool();
    expect((await ladderOf(id)).offeredDriverId).toBe('someone-else');
  });

  it('opens the pool to all when there is nobody eligible to ask', async () => {
    await seedEligibleDriver('offline', { online: false });
    const id = await createPool();

    const ladder = await ladderOf(id);
    expect(ladder.offeredDriverId).toBeNull();
    expect(ladder.openToAll).toBe(true);

    // So a driver who comes online a minute later finds it, rather than the
    // pool sitting invisible until it ages out.
    await seedEligibleDriver('arrived-late');
    expect((await feedFor('arrived-late')).requests.map((r) => r.requestId)).toEqual([id]);
  });
});

// ── The switch ──────────────────────────────────────────────────────────────

describe('with the ladder switched off', () => {
  it('goes back to showing every open pool to every nearby driver', async () => {
    await db().doc(CONFIG_DOC).set({ dispatch: { enabled: false } }, { merge: true });
    await seedEligibleDriver('d1');
    await seedEligibleDriver('d2');

    const id = await createPool();
    for (const uid of ['d1', 'd2']) {
      const feed = await feedFor(uid);
      expect(feed.requests.map((r) => r.requestId)).toEqual([id]);
      expect(feed.requests[0]!.exclusive).toBe(false);
    }
    // And first tap still wins.
    expect((await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'd2'))).status)
      .toBe('active');
  });
});
