/**
 * Integration tests for picking up riders on the way (trips/enRoute.ts).
 *
 * The accept path had no test at all, which is how every "Pick them up" came
 * to fail in production: the riders array was written with serverTimestamp()
 * inside it, and Firestore refuses sentinels inside arrays. These drive the two
 * callables end to end on the emulator.
 *
 * Verified:
 *  - a rider on the corridor shows up in getEnRouteMatches, and accepting them
 *    succeeds (the crash)
 *  - the "+PKR" a driver is shown is measured against what they were actually
 *    going to be paid (the agreed fare), not a re-pricing of the same car
 *  - riders outside the car see who was picked up: roster + ♂/♀ tally
 *  - the picked-up rider's own request is absorbed into the carrier trip
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type * as admin from 'firebase-admin';

import { clearFirestore, confirmedCar, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../index';
import { acceptEnRouteRider, getEnRouteMatches } from '../enRoute';

const HOST = 'er-host';
const CAND = 'er-candidate';
const DRIVER = 'er-driver';

// An 11 km road due north, and a rider standing ~200 m off it about 4.5 km in,
// going almost all the way to the same end.
const ORIGIN = { lat: 33.6, lng: 73.0, address: 'Gulberg III' };
const DEST = { lat: 33.7, lng: 73.0, address: 'DHA Phase 5' };
const CAND_PICKUP = { lat: 33.64, lng: 73.002, address: 'Garden Town' };
const CAND_DROPOFF = { lat: 33.699, lng: 73.001, address: 'DHA Phase 6' };
const AGREED_FARE = 600;

/** Google's encoded-polyline format, precision 1e5 — what decodePolyline reads. */
function encodePolyline(points: { lat: number; lng: number }[]): string {
  const enc = (v: number): string => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let out = '';
    while (s >= 0x20) {
      out += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return out + String.fromCharCode(s + 63);
  };
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

function driverReq<T>(data: T, uid = DRIVER): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

async function poolTrip(uid: string, pickup: typeof ORIGIN, dropoff: typeof DEST, offeredFare: number) {
  const res = (await createTrip.run(
    makeReq(
      {
        rideType: 'mini' as const,
        offeredFare,
        seats: 1,
        passengerGender: 'female' as const,
        pool: true,
        paymentMethod: 'cash' as const,
        pickup,
        dropoff,
      },
      uid,
    ),
  )) as { tripId: string };
  return res.tripId;
}

let carrierId = '';
let candidateId = '';

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${HOST}`).set({ name: 'Ayesha Khan', gender: 'female' });
  await db().doc(`users/${CAND}`).set({ name: 'Sana Malik', gender: 'female' });
  await db().doc(`drivers/${DRIVER}`).set({
    verificationStatus: 'approved',
    online: true,
    fullName: 'Kamran Ali',
    vehicleLabel: 'Toyota Corolla',
    plate: 'LEA-2291',
    ...confirmedCar(),
  });

  // The host's pool, accepted by the driver at the host's offer, with the road
  // already cached on the trip (so no Maps call is needed).
  carrierId = await poolTrip(HOST, ORIGIN, DEST, AGREED_FARE);
  await db().doc(`openRequests/${carrierId}`).delete();
  await db().doc(`trips/${carrierId}`).set(
    {
      status: 'matched',
      fare: AGREED_FARE,
      driverId: DRIVER,
      enRoute: {
        origin: ORIGIN,
        destination: DEST,
        polyline: encodePolyline([ORIGIN, DEST]),
        polylineSource: 'server',
      },
    },
    { merge: true },
  );

  // Somebody on that road who booked a pool of their own.
  candidateId = await poolTrip(CAND, CAND_PICKUP, CAND_DROPOFF, 400);
});

describe('getEnRouteMatches', () => {
  it('shows the rider standing on the road, with the real gain for the driver', async () => {
    const res = (await getEnRouteMatches.run(
      driverReq({ driverLat: ORIGIN.lat, driverLng: ORIGIN.lng }),
    )) as { matches: { tripId: string; earnExtra: number; driverGrossAfter: number; driverGrossBefore: number }[] };
    expect(res.matches).toHaveLength(1);
    const m = res.matches[0]!;
    expect(m.tripId).toBe(candidateId);
    // "Before" is what the driver is actually owed right now: the agreed fare.
    expect(m.driverGrossBefore).toBe(AGREED_FARE);
    expect(m.earnExtra).toBe(m.driverGrossAfter - AGREED_FARE);
    expect(m.driverGrossAfter).toBeGreaterThanOrEqual(AGREED_FARE);
  });
});

describe('acceptEnRouteRider', () => {
  it('picks the rider up — this used to throw on every call', async () => {
    const res = (await acceptEnRouteRider.run(
      driverReq({ tripId: candidateId, driverLat: ORIGIN.lat, driverLng: ORIGIN.lng }),
    )) as { ok: boolean; carrierTripId: string; driverGross: number; earnExtra: number; fare: number };
    expect(res.ok).toBe(true);
    expect(res.carrierTripId).toBe(carrierId);
    expect(res.earnExtra).toBe(res.driverGross - AGREED_FARE);
    expect(res.driverGross).toBeGreaterThanOrEqual(AGREED_FARE);

    const carrier = (await db().doc(`trips/${carrierId}`).get()).data()!;
    expect(carrier.poolMembers).toEqual([HOST, CAND]);
    expect(carrier.poolRiders).toHaveLength(2);
    // Plain Timestamps in the array — the whole bug.
    for (const r of carrier.poolRiders as { joinedAt: { toMillis: () => number }; name: string }[]) {
      expect(typeof r.joinedAt.toMillis).toBe('function');
    }
    // First names only: every co-rider can read this document.
    expect((carrier.poolRiders as { uid: string; name: string }[]).find((r) => r.uid === CAND)!.name).toBe('Sana');
    expect(carrier.poolDriverGross).toBe(res.driverGross);

    // People OUTSIDE the car see who is in it before they decide to join.
    const roster = carrier.poolRoster as { uid: string; firstName: string; kind: string; gender: string }[];
    const picked = roster.find((r) => r.uid === CAND)!;
    expect(picked.kind).toBe('enroute');
    expect(picked.firstName).toBe('Sana');
    expect(picked.gender).toBe('female');
    expect(carrier.poolGenders).toEqual({ male: 0, female: 2 });

    // Her own request is absorbed into the car she is now in.
    const own = (await db().doc(`trips/${candidateId}`).get()).data()!;
    expect(own.status).toBe('merged');
    expect(own.mergedIntoTripId).toBe(carrierId);
    expect((await db().doc(`openRequests/${candidateId}`).get()).exists).toBe(false);
  });

  it('keeps the gender rules: a man is not put into a car of two women', async () => {
    await acceptEnRouteRider.run(driverReq({ tripId: candidateId, driverLat: ORIGIN.lat, driverLng: ORIGIN.lng }));

    await db().doc('users/er-man').set({ name: 'Bilal Ahmed', gender: 'male', mixedRideOk: true });
    const manTrip = (await createTrip.run(
      makeReq(
        {
          rideType: 'mini' as const,
          offeredFare: 400,
          seats: 1,
          passengerGender: 'male' as const,
          pool: true,
          paymentMethod: 'cash' as const,
          pickup: { lat: 33.65, lng: 73.001, address: 'Cantt' },
          dropoff: CAND_DROPOFF,
        },
        'er-man',
      ),
    )) as { tripId: string };

    const feed = (await getEnRouteMatches.run(
      driverReq({ driverLat: ORIGIN.lat, driverLng: ORIGIN.lng }),
    )) as { matches: { tripId: string }[] };
    expect(feed.matches.find((m) => m.tripId === manTrip.tripId)).toBeUndefined();
    await expect(
      acceptEnRouteRider.run(driverReq({ tripId: manTrip.tripId, driverLat: ORIGIN.lat, driverLng: ORIGIN.lng })),
    ).rejects.toThrow(/female passengers only/);
  });
});
