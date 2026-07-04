/**
 * Mock simulation — mixed-car gender batching on pool rides.
 *
 * Scenario: driver Ali posts a pool route F-8 Markaz → Blue Area (Islamabad)
 * with his home-screen radius preference (pickup 500 m / drop 500 m) applied
 * to the ride. Four passengers request seats:
 *
 *   1. Ahmed  (M) → seated directly (empty car)
 *   2. Sara   (F) → seated directly (1M, she opted into mixed) → car is 1M+1F
 *   3. Bilal  (M) → QUEUED — mixed car, lone male; driver must NOT see it
 *   4. Usman  (M) → QUEUED — second male → pair complete, driver notified
 *
 * Driver accepts the male pair → Bilal + Usman seated together (back row
 * stays same-gender), ride full. Also verifies: single-request invisibility,
 * duplicate-join guard, full-ride rejection, and queued-request cancellation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { joinPoolRide, driverAcceptPoolBatch, cancelPoolJoinRequest } from '../index';

function makeReq<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}
const driverReq = <T>(data: T, uid: string) => makeReq(data, uid, 'driver');

// ── Cast: F-8 Markaz → Blue Area, Islamabad ───────────────────────────────────

const DRIVER = 'driver-ali';
const AHMED  = 'passenger-ahmed';   // male
const SARA   = 'passenger-sara';    // female
const BILAL  = 'passenger-bilal';   // male
const USMAN  = 'passenger-usman';   // male
const NADIA  = 'passenger-nadia';   // female

const F8_MARKAZ  = { lat: 33.7086, lng: 73.0353, address: 'F-8 Markaz, Islamabad' };
const BLUE_AREA  = { lat: 33.7167, lng: 73.0646, address: 'Blue Area, Islamabad' };
const RIDE_ID    = 'ride-f8-bluearea';

// Pickup points all inside the driver's 500 m pickup zone around F-8 Markaz
// (0.001° latitude ≈ 111 m).
const PICKUPS: Record<string, { lat: number; lng: number; address: string }> = {
  [AHMED]: { lat: 33.7090, lng: 73.0350, address: 'F-8/3 Street 30 (≈50m from Markaz)' },
  [SARA]:  { lat: 33.7080, lng: 73.0360, address: 'F-8 Katchery Road (≈90m from Markaz)' },
  [BILAL]: { lat: 33.7100, lng: 73.0345, address: 'F-8/2 Park gate (≈170m from Markaz)' },
  [USMAN]: { lat: 33.7070, lng: 73.0340, address: 'F-8/4 corner (≈210m from Markaz)' },
  [NADIA]: { lat: 33.7088, lng: 73.0356, address: 'F-8 Markaz plaza (≈30m from Markaz)' },
};

async function seedUser(uid: string, gender: 'male' | 'female', name: string) {
  await db().doc(`users/${uid}`).set({
    gender,
    name,
    displayName: name,
    mixedRideOk: true,
    phone: '+92300000' + uid.length,
  });
}

/** The ride the driver posts — radius fields come from his home-screen preference. */
async function seedRide(overrides: Record<string, unknown> = {}) {
  await db().doc(`poolRides/${RIDE_ID}`).set({
    driverId:          DRIVER,
    driverName:        'Ali Khan',
    driverRating:      4.9,
    driverVehicle:     'Suzuki Cultus',
    driverPlate:       'ISB-778',
    driverGender:      'male',
    genderPref:        'any',
    rideCategory:      'mini',
    pickup:            F8_MARKAZ,
    dropoff:           BLUE_AREA,
    pickupRadius:      500,   // ← driver's pool pickup radius preference
    dropoffRadius:     500,   // ← driver's pool drop radius preference
    maxSeats:          4,
    takenSeats:        0,
    maleSeats:         0,
    femaleSeats:       0,
    genderComposition: 'all',
    perSeatFare:       250,
    baseFare:          750,
    status:            'open',
    departureTime:     admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)),
    createdAt:         admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
}

function join(uid: string) {
  return joinPoolRide.run(
    makeReq(
      {
        rideId:         RIDE_ID,
        pickupLat:      PICKUPS[uid].lat,
        pickupLng:      PICKUPS[uid].lng,
        pickupAddress:  PICKUPS[uid].address,
        dropoffAddress: BLUE_AREA.address,
      },
      uid,
    ),
  );
}

const ride = async () => (await db().doc(`poolRides/${RIDE_ID}`).get()).data()!;
const queuedRequests = async (gender: string) =>
  (
    await db()
      .collection(`poolRides/${RIDE_ID}/joinRequests`)
      .where('status', '==', 'queued')
      .where('userGender', '==', gender)
      .get()
  ).docs;
const notificationsOf = async (uid: string) =>
  (await db().collection(`notifications/${uid}/items`).get()).docs.map((d) => d.data());

beforeEach(async () => {
  await clearFirestore();
  await Promise.all([
    seedUser(AHMED, 'male', 'Ahmed Raza'),
    seedUser(SARA, 'female', 'Sara Iqbal'),
    seedUser(BILAL, 'male', 'Bilal Sheikh'),
    seedUser(USMAN, 'male', 'Usman Tariq'),
    seedUser(NADIA, 'female', 'Nadia Hussain'),
  ]);
  await seedRide();
});

describe('pool batching simulation — F-8 Markaz → Blue Area', () => {
  it('runs the full 4-passenger scenario with the mixed-car pairing rule', async () => {
    // ── 1. Ahmed (M) joins an empty car → seated immediately ────────────────
    const r1 = await join(AHMED);
    expect(r1.queued).toBe(false);
    let snap = await ride();
    expect(snap.takenSeats).toBe(1);
    expect(snap.maleSeats).toBe(1);
    expect(snap.ridersPublic).toHaveLength(1);
    expect(snap.ridersPublic[0]).toMatchObject({
      uid: AHMED,
      name: 'Ahmed',
      gender: 'male',
      pickupArea: PICKUPS[AHMED].address,
    });

    // ── 2. Sara (F) joins → seated; car becomes 1M + 1F ─────────────────────
    const r2 = await join(SARA);
    expect(r2.queued).toBe(false);
    snap = await ride();
    expect(snap.takenSeats).toBe(2);
    expect(snap.maleSeats).toBe(1);
    expect(snap.femaleSeats).toBe(1);
    // Co-rider transparency: Sara's card shows who's aboard and from where
    expect(snap.ridersPublic.map((r: { name: string }) => r.name)).toEqual(['Ahmed', 'Sara']);

    // ── 3. Bilal (M) requests → QUEUED, not seated ───────────────────────────
    const r3 = await join(BILAL);
    expect(r3.queued).toBe(true);
    expect(r3.waitingSameGender).toBe(1);
    snap = await ride();
    expect(snap.takenSeats).toBe(2);            // seat count unchanged
    expect((await queuedRequests('male')).length).toBe(1);

    // Rule: a single request is INVISIBLE to the driver — accepting must fail
    await expect(
      driverAcceptPoolBatch.run(driverReq({ rideId: RIDE_ID, gender: 'male' }, DRIVER)),
    ).rejects.toThrow(/two waiting male riders/i);

    // ── 4. Usman (M) requests → pair complete, driver notified ──────────────
    const r4 = await join(USMAN);
    expect(r4.queued).toBe(true);
    expect(r4.waitingSameGender).toBe(2);
    expect((await queuedRequests('male')).length).toBe(2);

    const driverNotifs = await notificationsOf(DRIVER);
    expect(driverNotifs.some((n) => String(n.title).includes('2 male riders'))).toBe(true);

    // ── 5. Driver accepts the male pair → both seated atomically ────────────
    const accept = await driverAcceptPoolBatch.run(
      driverReq({ rideId: RIDE_ID, gender: 'male' }, DRIVER),
    );
    expect(accept.accepted).toBe(2);

    snap = await ride();
    expect(snap.takenSeats).toBe(4);
    expect(snap.maleSeats).toBe(3);
    expect(snap.femaleSeats).toBe(1);
    expect(snap.status).toBe('full');
    expect(snap.ridersPublic).toHaveLength(4);

    const bilalPass = await db().doc(`poolRides/${RIDE_ID}/passengers/${BILAL}`).get();
    const usmanPass = await db().doc(`poolRides/${RIDE_ID}/passengers/${USMAN}`).get();
    expect(bilalPass.get('status')).toBe('confirmed');
    expect(usmanPass.get('status')).toBe('confirmed');
    expect((await queuedRequests('male')).length).toBe(0);

    const bilalNotifs = await notificationsOf(BILAL);
    expect(bilalNotifs.some((n) => String(n.title).includes('Pool Seat Confirmed'))).toBe(true);

    // ── 6. Ride is full — a fifth passenger is rejected ──────────────────────
    // (status flips to 'full', so the join is refused at the status gate)
    await expect(join(NADIA)).rejects.toThrow(/not accepting|full/i);
  });

  it('blocks double-joining the same ride', async () => {
    await join(AHMED);
    await expect(join(AHMED)).rejects.toThrow(/already have a seat/i);
  });

  it('keeps a lone female request queued and lets her cancel it', async () => {
    await join(AHMED); // M seated
    await join(SARA);  // F seated → mixed 1M+1F

    const r = await join(NADIA); // lone female → queued
    expect(r.queued).toBe(true);
    expect((await queuedRequests('female')).length).toBe(1);

    // Single female request → invisible; accepting a female pair must fail
    await expect(
      driverAcceptPoolBatch.run(driverReq({ rideId: RIDE_ID, gender: 'female' }, DRIVER)),
    ).rejects.toThrow(/two waiting female riders/i);

    // She withdraws
    await cancelPoolJoinRequest.run(makeReq({ rideId: RIDE_ID }, NADIA));
    expect((await queuedRequests('female')).length).toBe(0);
  });

  it('rejects a batch accept from a driver who does not own the ride', async () => {
    await join(AHMED);
    await join(SARA);
    await join(BILAL);
    await join(USMAN);
    await expect(
      driverAcceptPoolBatch.run(driverReq({ rideId: RIDE_ID, gender: 'male' }, 'driver-imposter')),
    ).rejects.toThrow(/not your pool ride/i);
  });
});
