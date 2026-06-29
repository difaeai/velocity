/**
 * Integration tests for pool ride request CFs.
 *
 * Verified invariants:
 *  - createPoolRideRequest: persists correct structure, gender check
 *  - driverRespondToRequest: accept sets active + agreedFare; counter sets negotiating
 *  - leaderRespondToOffer: accept/reject state machine
 *  - joinPoolRideRequest: only on active, gender enforced, fare locked, fills slots
 *  - cancelPoolRideRequest: leader-only
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
  cancelPoolRideRequest,
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

  it('counter sets status=negotiating and counterFarePerSeat', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(
      driverReq({ requestId: id, action: 'counter', counterFarePerSeat: 300 }, DRIVER),
    );

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('negotiating');
    expect(snap.data()!.counterFarePerSeat).toBe(300);
    expect(snap.data()!.agreedFarePerSeat).toBeNull();
  });

  it('rejects if request is already taken by another driver', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));

    await seedDriver('driver2', 'male');
    await expect(
      driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, 'driver2')),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('counter without counterFarePerSeat is invalid', async () => {
    const id = await createRequest();
    await expect(
      driverRespondToRequest.run(driverReq({ requestId: id, action: 'counter' }, DRIVER)),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });
});

// ── leaderRespondToOffer ──────────────────────────────────────────────────────

describe('leaderRespondToOffer', () => {
  async function setupNegotiating() {
    const id = await createRequest();
    await driverRespondToRequest.run(
      driverReq({ requestId: id, action: 'counter', counterFarePerSeat: 300 }, DRIVER),
    );
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

  it('joiner receives the agreed fare per seat', async () => {
    const id = await setupActive();
    const res = await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    expect(res.farePerSeat).toBe(200);
  });

  it('filledSlots increments and passenger is added', async () => {
    const id = await setupActive();
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.filledSlots).toBe(2);
    expect(snap.data()!.passengers).toContain(JOINER);
  });

  it('status becomes full when all slots are filled', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));

    const snap = await db().doc(`poolRideRequests/${id}`).get();
    expect(snap.data()!.status).toBe('full');
    expect(snap.data()!.filledSlots).toBe(2);
  });

  it('SECURITY: joining a negotiating (not yet active) request is blocked', async () => {
    const id = await createRequest();
    await driverRespondToRequest.run(
      driverReq({ requestId: id, action: 'counter', counterFarePerSeat: 300 }, DRIVER),
    );

    await expect(
      joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('SECURITY: joining a full ride is blocked', async () => {
    const id = await createRequest(LEADER, { totalSlots: 2 });
    await driverRespondToRequest.run(driverReq({ requestId: id, action: 'accept' }, DRIVER));
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
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
    // joinPoolRideRequest takes no fare input — the response always returns the agreed fare
    const res = await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER));
    expect(res.farePerSeat).toBe(200); // locked to agreed fare
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
    await joinPoolRideRequest.run(makeReq({ requestId: id }, JOINER)); // fills → 'full'

    await expect(
      cancelPoolRideRequest.run(makeReq({ requestId: id }, LEADER)),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
