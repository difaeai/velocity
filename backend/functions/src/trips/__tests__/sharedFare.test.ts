/**
 * A shared ride has one fare, and nobody can move it.
 * ----------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT HAD TO
 * -------------------------------
 * Velocity's booking screen was built around a rider naming their own fare:
 * a stepper, an offer, drivers bidding back, the rider accepting one. For a
 * SOLO ride that is still exactly right — one rider, one driver, one deal, and
 * a negotiation that fails costs nobody but the two people having it.
 *
 * On a shared ride it was quietly killing pools. The host owned the fare, so
 * the host could set an offer no driver would take, or haggle one down after
 * riders had already joined. When the drivers refused, the pool did not merely
 * lose its fare — it lost its driver, and three or four riders who had already
 * committed to a seat were back to square one. One person's bargaining broke
 * everybody else's ride.
 *
 * So the fare is the server's: computed by `sharedRideFare` from the fare
 * engine, held against the market undercut, clamped to the driver floor, and
 * unreachable from any client. These tests hold every door shut:
 *
 *   createTrip      — the client's `offeredFare` is ignored outright
 *   raiseTripFare   — refused on a pool
 *   placeBid        — a driver's bid is an acceptance, not a counter-offer
 *   promo codes     — gone; one sent by an old build cannot move it
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, confirmedCar, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip, placeBid, raiseTripFare } from '../index';
import { sharedRideFare } from '../../fare/sharedRideFare';
import { poolPerSeatFare } from '../../domain/fares';

const HOST   = 'fare-host';
const DRIVER = 'fare-driver';

const PICKUP  = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const BASE = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'unspecified' as const,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

function driverReq<T>(data: T, uid = DRIVER): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

async function seedDriver(uid = DRIVER) {
  await db().doc(`drivers/${uid}`).set({
    verificationStatus: 'approved',
    online: true,
    lastLocation: { lat: PICKUP.lat, lng: PICKUP.lng },
    vehicleLabel: 'Suzuki Alto',
    plate: 'ABC-123',
    rating: 5,
    ...confirmedCar(),
  });
}

/** A pool booked by a build that shows the server's fixed fare — i.e. current. */
const makePool = (overrides: Record<string, unknown> = {}, uid = HOST) =>
  createTrip.run(
    makeReq({ ...BASE, pool: true, sharedFareFixed: true, ...overrides }, uid),
  ) as Promise<{ tripId: string }>;

/**
 * A pool booked by a build shipped before the fixed fare — it sends no
 * capability and showed the rider its own stepper value.
 */
const makeLegacyPool = (overrides: Record<string, unknown> = {}, uid = HOST) =>
  createTrip.run(makeReq({ ...BASE, pool: true, ...overrides }, uid)) as Promise<{ tripId: string }>;

const tripDoc = async (tripId: string) => (await db().doc(`trips/${tripId}`).get()).data()!;

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${HOST}`).set({ displayName: 'Ayesha', gender: 'female' });
  await db().doc(`users/${DRIVER}`).set({ displayName: 'Bilal' });
});

describe('sharedRideFare', () => {
  it('never prices a shared ride below what a driver will take', async () => {
    const q = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(q.fare).toBeGreaterThanOrEqual(q.floor);
    expect(q.fare).toBeGreaterThan(0);
  });

  it('publishes the per-seat ladder the saving actually comes from', async () => {
    const q = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(q.perSeat).toHaveLength(4);
    // One number, four seat counts — the same tier table the backend settles on.
    expect(q.perSeat[0]).toBe(poolPerSeatFare(q.fare, 1));
    expect(q.perSeat[3]).toBe(poolPerSeatFare(q.fare, 4));
    // And it always gets cheaper as the car fills; that is the whole offer.
    expect(q.perSeat[1]!).toBeLessThan(q.perSeat[0]!);
    expect(q.perSeat[3]!).toBeLessThan(q.perSeat[2]!);
  });

  it('is the same answer for the same journey, every time', async () => {
    // A fare that moved between the quote and the booking would be a fare the
    // rider could not rely on, which is the thing being fixed.
    const a = await sharedRideFare('mini', PICKUP, DROPOFF);
    const b = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(a.fare).toBe(b.fare);
  });
});

describe('createTrip prices a shared ride itself', () => {
  it('gives the same fare whatever the client asked for', async () => {
    const quoted = await sharedRideFare('mini', PICKUP, DROPOFF);
    const { tripId } = await makePool({ offeredFare: 99999 });
    const trip = await tripDoc(tripId);
    expect(trip.offeredFare).toBe(quoted.fare);
  });

  it('leaves a SOLO ride’s fare entirely to the rider', async () => {
    // The stepper and the bidding are untouched where they belong.
    const { tripId } = await createTrip.run(
      makeReq({ ...BASE, pool: false, offeredFare: 650 }, HOST),
    ) as { tripId: string };
    expect((await tripDoc(tripId)).offeredFare).toBe(650);
  });

  it('ignores a promo code an old build still sends — it cannot move the fare', async () => {
    const quoted = await sharedRideFare('mini', PICKUP, DROPOFF);
    const { tripId } = await makePool({ promoCode: 'WELCOME50' });
    expect((await tripDoc(tripId)).offeredFare).toBe(quoted.fare);
  });

  it('mirrors the server’s fare to the driver feed, not the client’s', async () => {
    const quoted = await sharedRideFare('mini', PICKUP, DROPOFF);
    const { tripId } = await makePool({ offeredFare: 150 });
    const feed = (await db().doc(`openRequests/${tripId}`).get()).data()!;
    expect(feed.offeredFare).toBe(quoted.fare);
    expect(feed.poolPerSeatFare).toBe(quoted.fare);
  });
});

describe('a build that predates the fixed fare is never charged above what it showed', () => {
  // The backend went live before the app did, so for a while the Play build put
  // a stepper on the sharing card, showed whatever it was set to, and the server
  // wrote a different number. When the server's was higher, the rider was
  // charged more than they had just agreed to — the app lying about a price.

  it('uses the rider’s own figure when the server’s is higher', async () => {
    const quoted = await sharedRideFare('mini', PICKUP, DROPOFF);
    const below = Math.max(300, quoted.fare - 100);
    const { tripId } = await makeLegacyPool({ offeredFare: below });
    // What they saw is what they get. Never the higher server figure.
    expect((await tripDoc(tripId)).offeredFare).toBe(below);
  });

  it('uses the server’s figure when that is cheaper, so the rider gains', async () => {
    const quoted = await sharedRideFare('mini', PICKUP, DROPOFF);
    const above = quoted.fare + 200;
    const { tripId } = await makeLegacyPool({ offeredFare: above });
    expect((await tripDoc(tripId)).offeredFare).toBe(quoted.fare);
  });

  it('still bounds-checks a fare such a build names', async () => {
    // 140 is under the mini floor of 280. An old build naming it is the bug the
    // original validation existed for, and it is still caught.
    await expect(makeLegacyPool({ offeredFare: 140 }))
      .rejects.toThrow(/must be between/);
  });

  it('ignores the number outright once the build declares the capability', async () => {
    const quoted = await sharedRideFare('mini', PICKUP, DROPOFF);
    // Below the floor AND absurd — neither matters any more.
    const { tripId } = await makePool({ offeredFare: 1 });
    expect((await tripDoc(tripId)).offeredFare).toBe(quoted.fare);
  });
});

describe('no door is left open', () => {
  it('refuses raiseTripFare on a shared ride', async () => {
    const { tripId } = await makePool();
    await expect(raiseTripFare.run(makeReq({ tripId, fare: 9000 }, HOST)))
      .rejects.toThrow(/fixed/i);
  });

  it('still lets a solo rider raise their own offer', async () => {
    const { tripId } = await createTrip.run(
      makeReq({ ...BASE, pool: false, offeredFare: 400 }, HOST),
    ) as { tripId: string };
    await raiseTripFare.run(makeReq({ tripId, fare: 500 }, HOST));
    expect((await tripDoc(tripId)).offeredFare).toBe(500);
  });

  it('turns a driver’s bid on a shared ride into an acceptance at the stated price', async () => {
    // The driver's choice is the whole job at the fare, yes or no — which is
    // what their own Sharing feed has always told them. A bid naming a
    // different number is not rejected (that would strand driver builds that
    // still send one); it simply has no effect on the price.
    await seedDriver();
    const { tripId } = await makePool();
    const fixed = (await tripDoc(tripId)).offeredFare as number;

    const { bidId } = await placeBid.run(
      driverReq({ tripId, fare: fixed + 400 }),
    ) as { bidId: string };

    const bid = (await db().doc(`trips/${tripId}/bids/${bidId}`).get()).data()!;
    expect(bid.fare).toBe(fixed);
    // …and an acceptance needs no second yes from the host: the ride is matched.
    expect(bid.status).toBe('accepted');
    expect(await tripDoc(tripId)).toMatchObject({ status: 'matched', driverId: DRIVER, fare: fixed });
  });

  it('still takes a driver’s real bid on a solo ride', async () => {
    await seedDriver();
    const { tripId } = await createTrip.run(
      makeReq({ ...BASE, pool: false, offeredFare: 400 }, HOST),
    ) as { tripId: string };

    const { bidId } = await placeBid.run(driverReq({ tripId, fare: 450 })) as { bidId: string };
    expect((await db().doc(`trips/${tripId}/bids/${bidId}`).get()).get('fare')).toBe(450);
  });
});

describe('a driver who takes the passenger’s own fare gets the ride', () => {
  const solo = () =>
    createTrip.run(makeReq({ ...BASE, pool: false, offeredFare: 400 }, HOST)) as Promise<{ tripId: string }>;

  it('matches the ride at once — the passenger is never asked to confirm', async () => {
    await seedDriver();
    const { tripId } = await solo();

    const res = await placeBid.run(driverReq({ tripId, fare: 400 }));
    expect(res).toMatchObject({ matched: true, taken: false });
    expect(await tripDoc(tripId)).toMatchObject({ status: 'matched', driverId: DRIVER, fare: 400 });
    expect((await db().doc(`openRequests/${tripId}`).get()).exists).toBe(false);
    expect((await db().doc(`drivers/${DRIVER}`).get()).get('activeTripId')).toBe(tripId);
    // Written by the lock-in itself, already accepted — there is no moment in
    // which the passenger sees it as an offer to accept.
    expect((await db().doc(`trips/${tripId}/bids/${DRIVER}`).get()).data()).toMatchObject({
      status: 'accepted', fare: 400, driverId: DRIVER, driverInfo: { driverId: DRIVER },
    });
  });

  it('leaves a counter-offer for the passenger to decide', async () => {
    await seedDriver();
    const { tripId } = await solo();

    expect(await placeBid.run(driverReq({ tripId, fare: 450 }))).toMatchObject({ matched: false });
    expect((await tripDoc(tripId)).status).toBe('requested');
    expect((await db().doc(`trips/${tripId}/bids/${DRIVER}`).get()).get('status')).toBe('pending');
  });

  it('tells the second driver the ride is gone instead of leaving them waiting', async () => {
    await seedDriver();
    await seedDriver('fare-driver-2');
    await db().doc('users/fare-driver-2').set({ displayName: 'Kamran' });
    const { tripId } = await solo();

    await placeBid.run(driverReq({ tripId, fare: 400 }));
    // The trip is no longer open, so the second bid is refused outright.
    await expect(placeBid.run(driverReq({ tripId, fare: 400 }, 'fare-driver-2'))).rejects.toThrow(/no longer open/);
    expect((await tripDoc(tripId)).driverId).toBe(DRIVER);
  });

  it('does not lock in a fare the passenger has since raised', async () => {
    await seedDriver();
    const { tripId } = await solo();
    await raiseTripFare.run(makeReq({ tripId, fare: 500 }, HOST));

    // The driver's screen still said 400 — now a lower counter-offer.
    expect(await placeBid.run(driverReq({ tripId, fare: 400 }))).toMatchObject({ matched: false });
    expect((await tripDoc(tripId)).status).toBe('requested');
  });
});
