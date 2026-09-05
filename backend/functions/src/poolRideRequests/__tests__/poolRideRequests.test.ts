/**
 * Integration tests for pool ride request CFs.
 *
 * Verified invariants:
 *  - createPoolRideRequest: persists correct structure, gender check, first name recorded
 *  - driverRespondToRequest: accept-only (fares fixed, counters refused), starts no-joiner window
 *  - leaderRespondToOffer: accept/reject state machine for legacy negotiating docs
 *  - joinPoolRideRequest: a driverless pool seats you outright; once a driver
 *    holds the pool the join is QUEUED for them to accept or reject. Gender
 *    enforced, fare locked, 2 km drop radius, driverless pools stay open when full
 *  - driverRespondToPoolRequestJoin: the driver's yes or no, and only theirs
 *  - respondToPoolGoAnyway: both must agree to go, either cancels, window enforced
 *  - cancelPoolRideRequest: leader-only
 *  - getNearbyPoolRequests: members (first name + fare) and totals per pool
 *  SECURITY: non-leader cannot call leaderRespondToOffer
 *  SECURITY: joining when negotiating is blocked
 *  SECURITY: joining gender-restricted ride as wrong gender is blocked
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import {
  createPoolRideRequest,
  driverRespondToRequest,
  leaderRespondToOffer,
  joinPoolRideRequest,
  driverRespondToPoolRequestJoin,
  getPoolRequestJoinRequests,
  cancelPoolRideRequest,
  respondToPoolGoAnyway,
  getNearbyPoolRequests,
  POOL_NO_JOINER_WINDOW_MS,
} from '../index';

// Build a minimal CallableRequest with optional role claim.
function makeReq<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}
function driverReq<T>(data: T, uid: string): CallableRequest<T> {
  return makeReq(data, uid, 'driver');
}

// ── Test identities ───────────────────────────────────────────────────────────

const LEADER   = 'leader-uid';
const DRIVER   = 'driver-uid';
const JOINER   = 'joiner-uid';
const FEMALE   = 'female-uid';
const INTRUDER = 'intruder-uid';

async function seedUser(uid: string, gender: string) {
  await db().doc(`users/${uid}`).set({ gender, displayName: uid });
}
async function seedDriver(uid: string, gender: string) {
  await db().doc(`drivers/${uid}`).set({
    gender,
    fullName: 'Test Driver',
    vehicleLabel: 'Toyota Corolla',
    plate: 'ABC-123',
    rating: 4.8,
  });
}

type GenderPref = 'any' | 'male_only' | 'female_only';

const BASE_REQUEST = {
  pickupLat:           33.6844,
  pickupLng:           73.0479,
  pickupAreaName:      'F-7, Islamabad',
  destinationLat:      33.7215,
  destinationLng:      73.0433,
  destinationAreaName: 'G-9, Islamabad',
  proposedFarePerSeat: 200,
  totalSlots:          3,
  genderPref:          'any' as GenderPref,
};

// Helper: create a request and return its ID
async function createRequest(uid = LEADER, overrides: Partial<typeof BASE_REQUEST> = {}) {
  const res = await createPoolRideRequest.run(makeReq({ ...BASE_REQUEST, ...overrides }, uid));
  return res.requestId as string;
}

beforeEach(async () => {
  await clearFirestore();
  await seedUser(LEADER, 'male');
  await seedUser(JOINER, 'male');
  await seedUser(FEMALE, 'female');
  await seedUser(INTRUDER, 'male');
  await seedDriver(DRIVER, 'male');
});

// ── createPoolRideRequest ─────────────────────────────────────────────────────

describe('createPoolRideRequest', () => {
  it('creates a request with correct structure', async () => {
    const id = await createRequest();
    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.exists).toBe(true);

    const d = snap.data()!;
    expect(d.leaderId).toBe(LEADER);
    expect(d.status).toBe('open');
    expect(d.proposedFarePerSeat).toBe(200);
    expect(d.totalSlots).toBe(3);
    expect(d.filledSlots).toBe(1);
    expect(d.passengers).toEqual([LEADER]);
    expect(d.agreedFarePerSeat).toBeNull();
    expect(d.driverId).toBeNull();
    expect(d.pickupAreaName).toBe('F-7, Islamabad');
    expect(d.destinationAreaName).toBe('G-9, Islamabad');
    expect(d.pickupGeohash).toBeTruthy();
  });

  it('rejects female creating a male_only request', async () => {
    await expect(
      createRequest(FEMALE, { genderPref: 'male_only' }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('allows female creating a female_only request', async () => {
    const id = await createRequest(FEMALE, { genderPref: 'female_only' });
    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.genderPref).toBe('female_only');
  });
});

// ── driverRespondToRequest ────────────────────────────────────────────────────

describe('driverRespondToRequest', () => {
  it('accept sets status=active and agreedFare=proposedFare', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('active');
    expect(snap.data()!.agreedFarePerSeat).toBe(200);
    expect(snap.data()!.driverId).toBe(DRIVER);
    expect(snap.data()!.driverName).toBe('Test Driver');
  });

  it('accept records first names, starts the no-joiner window', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.activatedAt).toBeTruthy();
    expect(d.goAnyway).toEqual({ leader: null, driver: null });
    expect(d.goAnywayConfirmed).toBe(false);
    // Leader's first name was recorded at creation (displayName seeded as uid).
    expect(d.passengerNames?.[LEADER]).toBe(LEADER);
  });

  it('counter is refused — pool fares are fixed', async () => {
    const id = await createRequest();
    await expect(
      driverRespondToRequest.run(
        driverReq({ requestId: id, action: 'counter', counterFarePerSeat: 300 }, DRIVER),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Request untouched — still open for any driver to accept.
    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('open');
    expect(snap.data()!.counterFarePerSeat).toBeNull();
  });

  it('accepting a driverless pool that already filled goes straight to full', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER)); // fills, stays open
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('full');
    expect(snap.data()!.agreedFarePerSeat).toBe(200);
  });

  it('rejects if request is already taken by another driver', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));

    await seedDriver('driver2', 'male');
    await expect(
      driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'driver2')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

});

// ── leaderRespondToOffer ──────────────────────────────────────────────────────

describe('leaderRespondToOffer', () => {
  // Counters can no longer be created, but requests negotiated before the
  // fixed-fare change may still sit in this state — the leader's accept/reject
  // must keep working for them. Seed the legacy state directly.
  async function setupNegotiating() {
    const id = await createRequest();
    await db().doc(`poolRideRequests/${id}`).update({
      status:             'negotiating',
      driverId:           DRIVER,
      driverName:         'Test Driver',
      driverVehicle:      'Toyota Corolla',
      driverPlate:        'ABC-123',
      driverGender:       'male',
      counterFarePerSeat: 300,
    });
    return id;
  }

  it('accept sets agreed fare to the counter and status=active', async () => {
    const id = await setupNegotiating();
    await leaderRespondToOffer.run(makeReq({ requestId: id, action: 'accept' }, LEADER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('active');
    expect(snap.data()!.agreedFarePerSeat).toBe(300);
    expect(snap.data()!.counterFarePerSeat).toBeNull();
  });

  it('reject clears driver and re-opens the request', async () => {
    const id = await setupNegotiating();
    await leaderRespondToOffer.run(makeReq({ requestId: id, action: 'reject' }, LEADER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('open');
    expect(snap.data()!.driverId).toBeNull();
    expect(snap.data()!.counterFarePerSeat).toBeNull();
  });

  it('SECURITY: non-leader cannot respond to counter offer', async () => {
    const id = await setupNegotiating();
    await expect(
      leaderRespondToOffer.run(makeReq({ requestId: id, action: 'accept' }, INTRUDER)),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // State unchanged
    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('negotiating');
  });

  it('fails when status is not negotiating', async () => {
    const id = await createRequest(); // still 'open'
    await expect(
      leaderRespondToOffer.run(makeReq({ requestId: id, action: 'accept' }, LEADER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ── joinPoolRideRequest ───────────────────────────────────────────────────────

describe('joinPoolRideRequest', () => {
  async function setupActive() {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    return id;
  }

  it('joiner is quoted the agreed fare per seat, and is queued for the driver', async () => {
    const id = await setupActive();
    const res = await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    expect(res.farePerSeat).toBe(200);
    // A driver already agreed to carry a specific car-load. Another person in
    // it is a change to THEIR job, so they are the one who says yes.
    expect(res.pending).toBe(true);

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.filledSlots).toBe(1);      // not seated yet
    expect(snap.data()!.passengers).not.toContain(JOINER);

    const q = (await db().doc(`poolRideRequests/${id}/joinRequests/${JOINER}`).get()).data()!;
    expect(q.status).toBe('pending');
    expect(q.farePerSeat).toBe(200);
  });

  it('filledSlots increments and passenger is added once the driver accepts', async () => {
    const id = await setupActive();
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    );

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.filledSlots).toBe(2);
    expect(snap.data()!.passengers).toContain(JOINER);
  });

  it('status becomes full when all slots are filled', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    );

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('full');
    expect(snap.data()!.filledSlots).toBe(2);
  });

  it('joins an open (driverless) request at the proposed fare — pool forms before a driver', async () => {
    const id = await createRequest();
    const res = await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    expect(res.farePerSeat).toBe(200);

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.status).toBe('open'); // still needs a driver
    expect(d.filledSlots).toBe(2);
    expect(d.passengers).toContain(JOINER);
    expect(d.passengerNames?.[JOINER]).toBe(JOINER);
  });

  it('a driverless pool that fills every seat stays open so drivers can still take it', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.status).toBe('open');
    expect(d.filledSlots).toBe(2);

    // ...but no further passengers fit.
    await seedUser('third-uid', 'male');
    await expect(
      joinPoolRideRequest.run(makeReq({ requestId: id }, 'third-uid')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('accepts a drop-off within 2 km of the pool destination', async () => {
    const id = await setupActive();
    // ~1.5 km north of the destination — outside the old 1 km default,
    // inside the 2 km joiner choice.
    const res = await joinPoolRideRequest.run(makeReq({
      requestId: id,
      dropoffLat: 33.735,
      dropoffLng: 73.0433,
      dropoffAreaName: 'G-8, Islamabad',
    }, JOINER));
    expect(res.farePerSeat).toBe(200);
  });

  it('rejects a drop-off beyond 2 km of the pool destination', async () => {
    const id = await setupActive();
    // ~2.5 km north — outside the joiner radius.
    await expect(
      joinPoolRideRequest.run(makeReq({
        requestId: id,
        dropoffLat: 33.744,
        dropoffLng: 73.0433,
        dropoffAreaName: 'Too far',
      }, JOINER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('SECURITY: joining a negotiating (legacy) request is blocked', async () => {
    const id = await createRequest();
    await db().doc(`poolRideRequests/${id}`).update({ status: 'negotiating', counterFarePerSeat: 300 });

    await expect(
      joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('SECURITY: joining a full ride is blocked', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    );
    // Ride is now full
    await seedUser('third-uid', 'male');
    await expect(
      joinPoolRideRequest.run(makeReq({ requestId: id }, 'third-uid')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('SECURITY: female cannot join a male_only ride', async () => {
    const id = await createRequest(LEADER, { genderPref: 'male_only' });
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));

    await expect(
      joinPoolRideRequest.run(makeReq({ requestId: id }, FEMALE)),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.filledSlots).toBe(1);
    expect(snap.data()!.passengers).not.toContain(FEMALE);
  });

  it('joiner cannot supply a custom fare (farePerSeat is always the agreed amount)', async () => {
    const id = await setupActive();
    // joinPoolRideRequest takes no fare input — the response always returns the
    // agreed fare. The leader set it; nobody joining gets to move it.
    const res = await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    expect(res.farePerSeat).toBe(200); // locked to agreed fare
  });
});

// ── driverRespondToPoolRequestJoin ────────────────────────────────────────────

describe('driverRespondToPoolRequestJoin', () => {
  async function poolWithRequest() {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    return id;
  }

  it('seats the rider on accept at the pool fare', async () => {
    const id = await poolWithRequest();
    const res = await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    );
    expect(res.accepted).toBe(true);

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.passengers).toContain(JOINER);
    expect(d.filledSlots).toBe(2);
  });

  it('leaves the car untouched on reject, and one refusal is final', async () => {
    const id = await poolWithRequest();
    const res = await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'reject' }, DRIVER),
    );
    expect(res.accepted).toBe(false);

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.passengers).not.toContain(JOINER);
    await expect(joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('answers each request exactly once', async () => {
    const id = await poolWithRequest();
    await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    );
    await expect(
      driverRespondToPoolRequestJoin.run(
        driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('shows the holding driver the queue they have to answer', async () => {
    const id = await poolWithRequest();
    const q = await getPoolRequestJoinRequests.run(driverReq({ requestId: id }, DRIVER));
    expect(q.requests).toHaveLength(1);
    expect(q.requests[0].riderId).toBe(JOINER);
    expect(q.requests[0].farePerSeat).toBe(200);
  });

  it('SECURITY: a driver who does not hold this pool cannot answer for it', async () => {
    const id = await poolWithRequest();
    await expect(
      driverRespondToPoolRequestJoin.run(
        driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, 'other-driver'),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ── cancelPoolRideRequest ─────────────────────────────────────────────────────

describe('cancelPoolRideRequest', () => {
  it('leader can cancel an open request', async () => {
    const id = await createRequest();
    await cancelPoolRideRequest.run(makeReq({ requestId: id }, LEADER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('cancelled');
  });

  it('SECURITY: non-leader cannot cancel', async () => {
    const id = await createRequest();
    await expect(
      cancelPoolRideRequest.run(makeReq({ requestId: id }, INTRUDER)),
    ).rejects.toMatchObject({ code: 'permission-denied' });

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('open');
  });

  it('cannot cancel a full ride', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    // Asking is not boarding — the driver's yes is what fills the last seat.
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    ); // fills → 'full'

    await expect(
      cancelPoolRideRequest.run(makeReq({ requestId: id }, LEADER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

// ── respondToPoolGoAnyway ─────────────────────────────────────────────────────
// 10 minutes with no co-rider: both sides asked; going needs both, either cancels.

describe('respondToPoolGoAnyway', () => {
  /** Driver-accepted request with the no-joiner window already elapsed. */
  async function setupElapsed() {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await db().doc(`poolRideRequests/${id}`).update({
      activatedAt: admin.firestore.Timestamp.fromMillis(Date.now() - POOL_NO_JOINER_WINDOW_MS - 60_000),
    });
    return id;
  }

  it('is blocked while the waiting window is still running', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await expect(
      respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'go' }, LEADER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('going needs BOTH: leader alone does not confirm, driver completes it', async () => {
    const id = await setupElapsed();

    const first = await respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'go' }, LEADER));
    expect(first.confirmed).toBe(false);
    let d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.goAnyway).toEqual({ leader: true, driver: null });
    expect(d.goAnywayConfirmed).toBe(false);
    expect(d.status).toBe('active');

    const second = await respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'go' }, DRIVER));
    expect(second.confirmed).toBe(true);
    d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.goAnywayConfirmed).toBe(true);
    expect(d.status).toBe('active');
  });

  it('either side can cancel — driver', async () => {
    const id = await setupElapsed();
    await respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'cancel' }, DRIVER));

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.status).toBe('cancelled');
    expect(d.cancelledBy).toBe('driver');
  });

  it('either side can cancel — leader', async () => {
    const id = await setupElapsed();
    await respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'cancel' }, LEADER));

    const d = (await db().doc(`poolRideRequests/${id}`).get()).data()!;
    expect(d.status).toBe('cancelled');
    expect(d.cancelledBy).toBe('leader');
  });

  it('still applies while a co-rider is only ASKING to join', async () => {
    // The leader is still riding alone until the driver says yes, so the
    // "nobody joined — go anyway?" question is still the right one to ask.
    // Treating a pending request as a passenger would strand the leader
    // waiting on a seat that may never be granted.
    const id = await setupElapsed();
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    await expect(
      respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'go' }, DRIVER)),
    ).resolves.toMatchObject({ ok: true });
  });

  it('no longer applies once a co-rider is actually aboard', async () => {
    const id = await setupElapsed();
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    await driverRespondToPoolRequestJoin.run(
      driverReq({ requestId: id, riderId: JOINER, action: 'accept' }, DRIVER),
    );
    await expect(
      respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'cancel' }, DRIVER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('SECURITY: only the leader or the assigned driver can respond', async () => {
    const id = await setupElapsed();
    await expect(
      respondToPoolGoAnyway.run(makeReq({ requestId: id, action: 'go' }, INTRUDER)),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ── getNearbyPoolRequests ─────────────────────────────────────────────────────

describe('getNearbyPoolRequests', () => {
  it('lists the whole pool: each rider by first name with their fare, plus totals', async () => {
    const id = await createRequest();
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));

    const res = await getNearbyPoolRequests.run(driverReq({
      lat: BASE_REQUEST.pickupLat,
      lng: BASE_REQUEST.pickupLng,
      radiusKm: 3,
    }, DRIVER));

    const req = (res.requests as any[]).find((r) => r.requestId === id);
    expect(req).toBeTruthy();
    expect(req.members).toEqual([
      { name: LEADER, farePerSeat: 200, dropoffAreaName: BASE_REQUEST.destinationAreaName },
      { name: JOINER, farePerSeat: 200, dropoffAreaName: BASE_REQUEST.destinationAreaName },
    ]);
    expect(req.totalFare).toBe(400);        // 2 riders aboard
    expect(req.totalFareIfFull).toBe(600);  // 3 seats
    expect(req.farePerSeat).toBe(200);
  });
});
