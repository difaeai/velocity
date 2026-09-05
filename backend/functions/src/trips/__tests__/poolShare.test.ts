/**
 * Integration tests for pool ride share links.
 *
 * Verified invariants:
 *  - createTrip(pool): full solo fare validated (never the discounted per-seat
 *    fare), share code generated + mapped, poolMembers seeded, feed mirrored
 *  - getPoolTripByCode: join snapshot with correct per-seat tier maths
 *  - joinPoolTrip: adds rider, recomputes everyone's per-seat fare, records the
 *    roster, idempotent for existing members, rejects when full
 *  - TWO WAYS IN: a pool still looking for a driver gathers riders for ten
 *    minutes (joining is instant); once a driver holds it, a joiner is queued
 *    and that driver accepts or rejects them
 *  - the roster names everyone in the car, for the driver and the riders both
 *  - visibility: private pools never appear in nearby discovery; the host's
 *    own pool is excluded; setPoolVisibility is host-only
 *  SECURITY: a rider with an active trip cannot join a second pool
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { poolPerSeatFare } from '../../domain/fares';
import { createTrip } from '../index';
import {
  getPoolTripByCode,
  joinPoolTrip,
  driverRespondToPoolJoin,
  cancelPoolTripJoinRequest,
  getPoolJoinRequests,
  setPoolVisibility,
  getNearbyPublicPoolTrips,
} from '../poolShare';

const HOST    = 'pool-host';
const JOINER  = 'pool-joiner';
const JOINER2 = 'pool-joiner-2';
const JOINER3 = 'pool-joiner-3';
const LATE    = 'pool-late';

const PICKUP  = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400, // full solo fare — inside the static mini band (280–1200)
  seats: 1,
  passengerGender: 'unspecified' as const,
  pool: true,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

async function createPool(uid = HOST, overrides: Record<string, unknown> = {}) {
  const res = await createTrip.run(makeReq({ ...BASE_TRIP, ...overrides }, uid));
  return res as { tripId: string; shareCode: string | null };
}

/**
 * What `acceptBid` leaves behind: a driver assigned, a locked fare, and the
 * open-request mirror gone. A pool is only shareable from this point on, so
 * almost every test here has to get the ride to it first.
 */
async function confirmWithDriver(tripId: string, fare = 400) {
  await db().doc(`openRequests/${tripId}`).delete();
  await db().doc(`trips/${tripId}`).set(
    {
      status: 'matched',
      fare,
      driverId: 'pool-driver',
      driverInfo: { driverId: 'pool-driver', displayName: 'Bilal Khan', vehicleLabel: 'Toyota Corolla', plate: 'ABC-123', rating: 4.8 },
    },
    { merge: true },
  );
}

/** A pool a driver has agreed to carry — joining one of these has to be asked. */
async function createConfirmedPool(uid = HOST, overrides: Record<string, unknown> = {}) {
  const res = await createPool(uid, overrides);
  await confirmWithDriver(res.tripId);
  return res;
}

beforeEach(async () => {
  await clearFirestore();
  for (const uid of [HOST, JOINER, JOINER2, JOINER3, LATE]) {
    await db().doc(`users/${uid}`).set({ displayName: `User ${uid}` });
  }
});

describe('poolPerSeatFare', () => {
  it('follows the 100/60/40/35 tier table', () => {
    expect(poolPerSeatFare(400, 1)).toBe(400);
    expect(poolPerSeatFare(400, 2)).toBe(240);
    expect(poolPerSeatFare(400, 3)).toBe(160);
    expect(poolPerSeatFare(400, 4)).toBe(140);
  });
  it('clamps rider counts outside 1–4', () => {
    expect(poolPerSeatFare(400, 0)).toBe(400);
    expect(poolPerSeatFare(400, 9)).toBe(140);
  });
});

describe('createTrip (pool)', () => {
  it('accepts the full solo fare and issues a share code', async () => {
    const { tripId, shareCode } = await createPool();
    expect(shareCode).toBeTruthy();

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.pool).toBe(true);
    expect(trip.offeredFare).toBe(400);
    expect(trip.shareCode).toBe(shareCode);
    expect(trip.poolVisibility).toBe('public');
    expect(trip.poolMembers).toEqual([HOST]);
    expect(trip.poolPerSeatFare).toBe(400);
    // The host is on the roster from the moment the pool exists — otherwise
    // they are invisible on their own ride until somebody else joins it.
    expect(trip.poolRoster).toHaveLength(1);
    expect(trip.poolRoster[0].uid).toBe(HOST);
    expect(trip.poolRoster[0].kind).toBe('host');

    const mapping = await db().doc(`poolShareCodes/${shareCode}`).get();
    expect(mapping.exists).toBe(true);
    expect(mapping.get('tripId')).toBe(tripId);

    const feed = (await db().doc(`openRequests/${tripId}`).get()).data()!;
    expect(feed.shareCode).toBe(shareCode);
    expect(feed.poolVisibility).toBe('public');
    expect(feed.poolRiders).toBe(1);
  });

  it('rejects a discounted per-seat fare below the floor (the old client bug)', async () => {
    // 35% of 400 = 140 < mini floor 280 — the backend must refuse it.
    await expect(createPool(HOST, { offeredFare: 140 })).rejects.toThrow(/must be between/);
  });

  it('does not issue share codes for solo trips', async () => {
    const res = await createTrip.run(makeReq({ ...BASE_TRIP, pool: false }, HOST));
    expect(res.shareCode).toBeNull();
    const trip = (await db().doc(`trips/${res.tripId}`).get()).data()!;
    expect(trip.shareCode).toBeUndefined();
  });
});

describe('getPoolTripByCode', () => {
  it('returns a joinable snapshot with tier maths for an outsider', async () => {
    const { shareCode } = await createConfirmedPool();
    const info = await getPoolTripByCode.run(makeReq({ code: shareCode! }, JOINER));
    expect(info.joinable).toBe(true);
    expect(info.alreadyJoined).toBe(false);
    expect(info.tripId).toBeNull(); // trip id hidden until joined
    expect(info.riders).toBe(1);
    expect(info.seatsLeft).toBe(3);
    expect(info.perSeatFareNow).toBe(400);
    expect(info.perSeatFareIfYouJoin).toBe(240);
    expect(info.pickupAddress).toBe(PICKUP.address);
    // Choosing this car, not just this price: who is driving and who is in it.
    expect(info.driverName).toBe('Bilal Khan');
    expect(info.driverVehicle).toBe('Toyota Corolla');
    expect(info.companions.map((c: { firstName: string }) => c.firstName)).toEqual(['User']);
  });

  it('offers a seat in a pool that is still gathering riders, and names it as such', async () => {
    const { shareCode } = await createPool(); // still 'requested'
    const info = await getPoolTripByCode.run(makeReq({ code: shareCode! }, JOINER));
    // No driver yet — which is exactly why joining is instant rather than a
    // request: there is nobody to ask, and the extra rider is what makes the
    // job worth taking when a driver does look at it.
    expect(info.awaitingDriver).toBe(true);
    expect(info.gathering).toBe(true);
    expect(info.joinable).toBe(true);
    expect(info.needsDriverApproval).toBe(false);
    expect(info.driverName).toBeNull();
  });

  it('closes the gathering window ten minutes after the pool was booked', async () => {
    const { tripId, shareCode } = await createPool();
    await db().doc(`trips/${tripId}`).update({
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });
    const info = await getPoolTripByCode.run(makeReq({ code: shareCode! }, JOINER));
    expect(info.gathering).toBe(false);
    expect(info.joinable).toBe(false);
  });

  it('rejects unknown codes', async () => {
    await expect(getPoolTripByCode.run(makeReq({ code: 'NOSUCHCODE' }, JOINER)))
      .rejects.toThrow(/invalid or has expired/);
  });
});

describe('joinPoolTrip', () => {
  it('adds the rider and drops everyone to the tier fare', async () => {
    const { tripId, shareCode } = await createPool();
    const res = await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    expect(res.alreadyJoined).toBe(false);
    expect(res.riders).toBe(2);
    expect(res.perSeatFare).toBe(240);
    expect(res.tripId).toBe(tripId);

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([HOST, JOINER]);
    expect(trip.seats).toBe(2);
    expect(trip.poolPerSeatFare).toBe(240);

    // Joiner now tracks the pool as their active trip.
    const joiner = (await db().doc(`users/${JOINER}`).get()).data()!;
    expect(joiner.activeTripId).toBe(tripId);
  });

  it('seats a rider outright on a pool that has no driver to ask', async () => {
    // A pool nobody can see until a driver takes it is a pool nobody joins —
    // the rider who booked it rides alone and everyone on the same road never
    // finds out it existed. Ten minutes of visibility is what fills these cars.
    const { tripId, shareCode } = await createPool();
    const res = await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    expect(res.pending).toBe(false);
    expect(res.riders).toBe(2);

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([HOST, JOINER]);
    // The driver feed has to learn the job grew: a driver deciding on this ride
    // must see two riders and two fares, not the one that was posted.
    const mirror = (await db().doc(`openRequests/${tripId}`).get()).data()!;
    expect(mirror.poolRiders).toBe(2);
  });

  it('refuses a pool whose ten-minute gathering window has closed', async () => {
    const { tripId, shareCode } = await createPool();
    await db().doc(`trips/${tripId}`).update({
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });
    await expect(joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER)))
      .rejects.toThrow(/stopped taking new riders/);
  });

  it('QUEUES the rider for the driver once one has agreed to carry the pool', async () => {
    // A car somebody already agreed to drive does not silently acquire
    // passengers: the driver took a specific job, and a fourth person in it is
    // a change to THEIR work. So the tap asks rather than seats.
    const { tripId, shareCode } = await createConfirmedPool();
    const res = await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    expect(res.pending).toBe(true);

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([HOST]); // not seated yet

    const reqDoc = (await db().doc(`trips/${tripId}/joinRequests/${JOINER}`).get()).data()!;
    expect(reqDoc.status).toBe('pending');
    // Quoted at the pool's own tier — the joiner never named this number.
    expect(reqDoc.farePerSeat).toBe(240);

    // Asking twice is not a second request.
    await expect(joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER)))
      .rejects.toThrow(/already with the driver/);
  });

  it('writes the joiner onto the roster so everybody knows who is in the car', async () => {
    await db().doc(`users/${JOINER}`).set({ name: 'Ayesha Malik', gender: 'female' });
    const { tripId, shareCode } = await createPool();
    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolRoster).toHaveLength(2);
    const joined = (trip.poolRoster as { uid: string; firstName: string; gender: string; kind: string }[])[1];
    expect(joined.uid).toBe(JOINER);
    expect(joined.kind).toBe('share');
    expect(joined.gender).toBe('female');
    // First name only: the trip document is readable by every co-rider.
    expect(joined.firstName).toBe('Ayesha');
  });

  it('is idempotent for existing members', async () => {
    const { shareCode } = await createPool();
    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    const again = await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    expect(again.alreadyJoined).toBe(true);
    expect(again.riders).toBe(2);
  });

  it('rejects when the pool is full', async () => {
    const { shareCode } = await createPool();
    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER2));
    const full = await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER3));
    expect(full.riders).toBe(4);
    expect(full.perSeatFare).toBe(140);
    await expect(joinPoolTrip.run(makeReq({ code: shareCode! }, LATE)))
      .rejects.toThrow(/already full/);
  });

  it('SECURITY: a rider with their own active trip cannot join', async () => {
    const { shareCode } = await createConfirmedPool();
    await createPool(JOINER); // joiner hosts their own active pool
    // Refused at the ASK, not at approval: being told this is useful now, and
    // useless after a driver has held a seat for you.
    await expect(joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER)))
      .rejects.toThrow(/already have an active trip/);
  });
});

describe('driverRespondToPoolJoin', () => {
  const DRIVER = 'pool-driver';

  /** A confirmed pool with one rider waiting on the driver's answer. */
  async function poolWithRequest() {
    const { tripId, shareCode } = await createConfirmedPool();
    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    return { tripId, shareCode };
  }

  it('seats the rider on accept, at exactly the fare they were quoted', async () => {
    const { tripId } = await poolWithRequest();
    const res = await driverRespondToPoolJoin.run(
      makeReq({ tripId, riderId: JOINER, action: 'accept' }, DRIVER),
    );
    expect(res.accepted).toBe(true);

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([HOST, JOINER]);
    expect(trip.poolPerSeatFare).toBe(240);
    expect((await db().doc(`users/${JOINER}`).get()).get('activeTripId')).toBe(tripId);
  });

  it('closes the request on reject and leaves the car as it was', async () => {
    const { tripId } = await poolWithRequest();
    const res = await driverRespondToPoolJoin.run(
      makeReq({ tripId, riderId: JOINER, action: 'reject' }, DRIVER),
    );
    expect(res.accepted).toBe(false);

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([HOST]);
    // One refusal is an answer — the same rider cannot re-ask their way in.
    const { shareCode } = trip as { shareCode: string };
    await expect(joinPoolTrip.run(makeReq({ code: shareCode }, JOINER)))
      .rejects.toThrow(/could not take you/);
  });

  it('answers each request once', async () => {
    const { tripId } = await poolWithRequest();
    await driverRespondToPoolJoin.run(makeReq({ tripId, riderId: JOINER, action: 'accept' }, DRIVER));
    await expect(
      driverRespondToPoolJoin.run(makeReq({ tripId, riderId: JOINER, action: 'accept' }, DRIVER)),
    ).rejects.toThrow(/already been answered/);
  });

  it('SECURITY: only the assigned driver decides who rides in their car', async () => {
    const { tripId } = await poolWithRequest();
    // Not the host either — the leader owns the fare, the driver owns the car.
    await expect(
      driverRespondToPoolJoin.run(makeReq({ tripId, riderId: JOINER, action: 'accept' }, HOST)),
    ).rejects.toThrow(/driver can answer/);
    await expect(getPoolJoinRequests.run(makeReq({ tripId }, HOST)))
      .rejects.toThrow(/driver can see/);
  });

  it('shows the driver the queue, and lets the rider withdraw from it', async () => {
    const { tripId } = await poolWithRequest();
    const queue = await getPoolJoinRequests.run(makeReq({ tripId }, DRIVER));
    expect(queue.requests).toHaveLength(1);
    expect(queue.requests[0].riderId).toBe(JOINER);
    expect(queue.requests[0].farePerSeat).toBe(240);

    await cancelPoolTripJoinRequest.run(makeReq({ tripId }, JOINER));
    const after = await getPoolJoinRequests.run(makeReq({ tripId }, DRIVER));
    expect(after.requests).toHaveLength(0);
  });
});

describe('visibility', () => {
  it('private pools are invisible in nearby discovery; public ones appear', async () => {
    await createConfirmedPool(HOST, { poolVisibility: 'private' });
    const { tripId: publicTripId } = await createConfirmedPool(JOINER); // defaults public

    const res = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER2),
    );
    const pools = res.pools as { code: string; dropoffAddress: string }[];
    expect(pools).toHaveLength(1);

    const publicTrip = (await db().doc(`trips/${publicTripId}`).get()).data()!;
    expect(pools[0].code).toBe(publicTrip.shareCode);
  });

  it("excludes the caller's own pool from discovery", async () => {
    await createConfirmedPool(HOST);
    const res = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, HOST),
    );
    expect(res.pools).toHaveLength(0);
  });

  it('surfaces a pool still gathering riders, and says it has no driver yet', async () => {
    const { tripId } = await createPool(HOST); // status 'requested'
    const gathering = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER),
    );
    expect(gathering.pools).toHaveLength(1);
    expect(gathering.pools[0].hasDriver).toBe(false);
    // Instant to join, and the row can count the window down.
    expect(gathering.pools[0].needsDriverApproval).toBe(false);
    expect(typeof gathering.pools[0].joinWindowEndsAt).toBe('number');

    await confirmWithDriver(tripId);
    const confirmed = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER),
    );
    expect(confirmed.pools).toHaveLength(1);
    expect(confirmed.pools[0].hasDriver).toBe(true);
    expect(confirmed.pools[0].needsDriverApproval).toBe(true);
  });

  it('drops a driverless pool out of discovery once its window has closed', async () => {
    const { tripId } = await createPool(HOST);
    await db().doc(`trips/${tripId}`).update({
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });
    const res = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER),
    );
    expect(res.pools).toHaveLength(0);
  });

  it('carries the driver and the people already aboard, so the rider picks a car', async () => {
    await db().doc(`users/${HOST}`).set({ name: 'Usman Tariq' });
    // The host's gender on the roster is the one they BOOKED with, not whatever
    // their profile says — that is the figure the pool's tally is built from.
    const { tripId } = await createPool(HOST, { passengerGender: 'male' });
    await confirmWithDriver(tripId);

    const res = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER),
    );
    const pool = (res.pools as {
      hasDriver: boolean;
      driverName: string | null;
      driverVehicle: string | null;
      companions: { firstName: string; gender: string }[];
      riders: number;
      perSeatFareIfYouJoin: number;
      status: string;
    }[])[0];
    expect(pool.hasDriver).toBe(true);
    expect(pool.driverName).toBe('Bilal Khan');
    expect(pool.driverVehicle).toBe('Toyota Corolla');
    expect(pool.status).toBe('matched');
    expect(pool.companions).toEqual([{ firstName: 'Usman', gender: 'male' }]);
    expect(pool.riders).toBe(1);
    expect(pool.perSeatFareIfYouJoin).toBe(240); // 2 riders → 60% of 400
  });

  it('a private pool stays hidden even after a driver accepts it', async () => {
    await createConfirmedPool(HOST, { poolVisibility: 'private' });

    const res = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER),
    );
    expect(res.pools).toHaveLength(0);
  });

  it('setPoolVisibility is host-only and mirrors to the feed', async () => {
    const { tripId } = await createPool();
    await expect(setPoolVisibility.run(makeReq({ tripId, visibility: 'private' }, JOINER)))
      .rejects.toThrow(/Only the ride host/);

    await setPoolVisibility.run(makeReq({ tripId, visibility: 'private' }, HOST));
    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    const feed = (await db().doc(`openRequests/${tripId}`).get()).data()!;
    expect(trip.poolVisibility).toBe('private');
    expect(feed.poolVisibility).toBe('private');
  });
});

describe('gender tally', () => {
  it('seeds the host gender and increments as riders join', async () => {
    // Host is female; a male and a female join → 2F, 1M.
    await db().doc(`users/${HOST}`).set({ displayName: 'Host', gender: 'female' });
    await db().doc(`users/${JOINER}`).set({ displayName: 'J1', gender: 'male' });
    await db().doc(`users/${JOINER2}`).set({ displayName: 'J2', gender: 'female' });

    // Gathering, not confirmed: these two get in on their own tap. The tally
    // has to be right at exactly this moment, because it is what a third rider
    // looking at the feed decides on — before any driver is involved.
    const { tripId, shareCode } = await createPool(HOST, { passengerGender: 'female' });
    let trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolGenders).toEqual({ male: 0, female: 1 });

    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER));
    await joinPoolTrip.run(makeReq({ code: shareCode! }, JOINER2));

    trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolGenders).toEqual({ male: 1, female: 2 });

    // The nearby feed surfaces the same counts, no names.
    const res = await getNearbyPublicPoolTrips.run(
      makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, JOINER3),
    );
    const pool = (res.pools as { males: number; females: number; riders: number }[])[0];
    expect(pool.males).toBe(1);
    expect(pool.females).toBe(2);
    expect(pool.riders).toBe(3);
  });
});

describe('destination filter', () => {
  it('only surfaces pools whose drop-off is near the searched destination', async () => {
    const { tripId } = await createConfirmedPool(JOINER); // drops at G-9 Markaz (DROPOFF)

    // Searching toward the pool's actual destination finds it…
    const near = await getNearbyPublicPoolTrips.run(
      makeReq(
        { lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5, destLat: DROPOFF.lat, destLng: DROPOFF.lng, destRadiusKm: 2 },
        JOINER2,
      ),
    );
    expect(near.pools).toHaveLength(1);

    // …searching toward a far-away destination (Lahore) excludes it.
    const far = await getNearbyPublicPoolTrips.run(
      makeReq(
        { lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5, destLat: 31.5204, destLng: 74.3587, destRadiusKm: 2 },
        JOINER2,
      ),
    );
    expect(far.pools).toHaveLength(0);

    expect(tripId).toBeTruthy();
  });
});
