/**
 * The rider's side of "riders on your way" (trips/enRouteRider.ts).
 *
 * The engine was already there and already tested from the driver's seat. What
 * these cover is the part that is new and the part that is easy to get wrong:
 *
 *  - a rider waiting ALONE, before any driver exists, is told who is on their
 *    road and what their own fare becomes — the whole point of the feature
 *  - the figure is a real one: lower than what they are paying now, and never
 *    an advertisement for a pickup the driver's own feed would refuse
 *  - the list is private to the people on the trip
 *  - asking the driver is impossible until there IS a driver, and once there
 *    is, the ask reaches their feed
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type * as admin from 'firebase-admin';

import { clearFirestore, confirmedCar, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../index';
import { getEnRouteMatches } from '../enRoute';
import { askDriverEnRoutePickup, getEnRouteSavings } from '../enRouteRider';

const HOST = 'err-host';
const CAND = 'err-candidate';
const OTHER = 'err-stranger';
const DRIVER = 'err-driver';

const ORIGIN = { lat: 33.6, lng: 73.0, address: 'Gulberg III, Islamabad' };
const DEST = { lat: 33.7, lng: 73.0, address: 'DHA Phase 5, Islamabad' };
/**
 * Someone who rides almost the whole road, 200 m off it at each end.
 *
 * Deliberately a LONG overlap. A shared-ride fare is already server-priced
 * below what the leg-split would charge, and the tier the rider was quoted is a
 * ceiling they can never be pushed above — so a brief hop along a long route
 * leaves the host's fare exactly where it was and the gain goes entirely to the
 * driver. The host only starts saving once enough of THEIR road is shared, and
 * that is the case this fixture is: see the note in enRouteRider.ts.
 */
const CAND_PICKUP = { lat: 33.605, lng: 73.002, address: 'Garden Town, Islamabad' };
const CAND_DROPOFF = { lat: 33.695, lng: 73.001, address: 'DHA Phase 6, Islamabad' };
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

async function poolTrip(
  uid: string,
  pickup: typeof ORIGIN,
  dropoff: typeof DEST,
  offeredFare: number,
) {
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

interface Savings {
  candidates: {
    tripId: string;
    firstName: string;
    pickupArea: string | null;
    dropoffArea: string | null;
    myFareIfTaken: number;
    theirFare: number;
  }[];
  myFareNow: number | null;
  myFareBest: number | null;
  canAsk: boolean;
  ridersAboard?: number;
}

let hostTripId = '';
let candidateId = '';

/** The road, cached on the trip the way a real one is, so no Maps call is made. */
const cachedRoad = {
  origin: ORIGIN,
  destination: DEST,
  polyline: encodePolyline([ORIGIN, DEST]),
  polylineSource: 'server' as const,
};

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${HOST}`).set({ name: 'Ayesha Khan', gender: 'female' });
  await db().doc(`users/${CAND}`).set({ name: 'Sana Malik', gender: 'female' });
  await db().doc(`users/${OTHER}`).set({ name: 'Imran Shah', gender: 'male' });
  await db().doc(`drivers/${DRIVER}`).set({
    verificationStatus: 'approved',
    online: true,
    fullName: 'Kamran Ali',
    vehicleLabel: 'Toyota Corolla',
    plate: 'LEA-2291',
    ...confirmedCar(),
  });

  // A shared ride that nobody has joined, still looking for a driver.
  hostTripId = await poolTrip(HOST, ORIGIN, DEST, AGREED_FARE);
  await db().doc(`trips/${hostTripId}`).set({ enRoute: cachedRoad }, { merge: true });

  // Somebody standing on that road who booked a shared ride of their own.
  candidateId = await poolTrip(CAND, CAND_PICKUP, CAND_DROPOFF, 400);
});

describe('getEnRouteSavings', () => {
  it('tells a rider waiting alone who is on their road and what it saves them', async () => {
    const res = (await getEnRouteSavings.run(
      makeReq({ tripId: hostTripId }, HOST),
    )) as unknown as Savings;

    expect(res.ridersAboard).toBe(1); // on their own, which is why this card exists
    expect(res.canAsk).toBe(false); // no driver yet, so nobody to ask
    expect(res.candidates).toHaveLength(1);

    const [c] = res.candidates;
    expect(c!.tripId).toBe(candidateId);
    // First names only, and areas rather than doorsteps.
    expect(c!.firstName).toBe('Sana');
    expect(c!.pickupArea).toBe('Garden Town');
    expect(c!.dropoffArea).toBe('DHA Phase 6');

    // The saving is real, and is never more than the rider is paying now.
    expect(res.myFareNow).toBeGreaterThan(0);
    expect(c!.myFareIfTaken).toBeLessThan(res.myFareNow!);
    expect(res.myFareBest).toBeLessThanOrEqual(c!.myFareIfTaken);
    // The other rider is never charged more than they themselves offered.
    expect(c!.theirFare).toBeLessThanOrEqual(400);
  });

  it('shows nobody on a road nobody is standing on', async () => {
    // Move the candidate 40 km off the corridor: same booking, wrong road.
    await db().doc(`openRequests/${candidateId}`).set(
      { pickup: { lat: 33.2, lng: 72.5, address: 'Attock' } },
      { merge: true },
    );
    const res = (await getEnRouteSavings.run(
      makeReq({ tripId: hostTripId }, HOST),
    )) as unknown as Savings;
    expect(res.candidates).toEqual([]);
  });

  it('is only for the people on the trip', async () => {
    await expect(
      getEnRouteSavings.run(makeReq({ tripId: hostTripId }, OTHER)),
    ).rejects.toThrow(/not your ride/i);
  });

  it('shows nothing on a wallet ride, because one can never gain a pickup', async () => {
    await db().doc(`trips/${hostTripId}`).set({ paymentMethod: 'wallet' }, { merge: true });
    const res = (await getEnRouteSavings.run(
      makeReq({ tripId: hostTripId }, HOST),
    )) as unknown as Savings;
    expect(res.candidates).toEqual([]);
  });
});

describe('askDriverEnRoutePickup', () => {
  it('cannot ask anybody before a driver exists', async () => {
    await expect(
      askDriverEnRoutePickup.run(
        makeReq({ tripId: hostTripId, candidateTripId: candidateId }, HOST),
      ),
    ).rejects.toThrow(/once a driver has taken your ride/i);
  });

  it('reaches the driver’s own feed once there is a driver', async () => {
    await db().doc(`trips/${hostTripId}`).set(
      { status: 'matched', driverId: DRIVER, fare: AGREED_FARE },
      { merge: true },
    );
    await db().doc(`openRequests/${hostTripId}`).delete();

    const savings = (await getEnRouteSavings.run(
      makeReq({ tripId: hostTripId }, HOST),
    )) as unknown as Savings;
    expect(savings.canAsk).toBe(true);

    const first = (await askDriverEnRoutePickup.run(
      makeReq({ tripId: hostTripId, candidateTripId: candidateId }, HOST),
    )) as unknown as { ok: boolean; alreadyAsked: boolean };
    expect(first).toEqual({ ok: true, alreadyAsked: false });

    // Stored on the trip as a plain Timestamp inside an array — a sentinel
    // there is rejected by Firestore, and that exact mistake is what made
    // every en-route pickup fail once before.
    const asks = (await db().doc(`trips/${hostTripId}`).get()).get('enRouteAsks') as {
      candidateTripId: string;
      byUid: string;
      at: admin.firestore.Timestamp;
    }[];
    expect(asks).toHaveLength(1);
    expect(asks[0]!.candidateTripId).toBe(candidateId);
    expect(asks[0]!.byUid).toBe(HOST);
    expect(typeof asks[0]!.at.toDate).toBe('function');

    // Asking twice is not an error and does not pile up.
    const again = (await askDriverEnRoutePickup.run(
      makeReq({ tripId: hostTripId, candidateTripId: candidateId }, HOST),
    )) as unknown as { alreadyAsked: boolean };
    expect(again.alreadyAsked).toBe(true);

    // And the driver sees whose idea it was, with every gate unchanged.
    const feed = (await getEnRouteMatches.run(driverReq({}))) as unknown as {
      matches: { tripId: string; askedByRider?: boolean }[];
    };
    const match = feed.matches.find((m) => m.tripId === candidateId);
    expect(match?.askedByRider).toBe(true);
  });
});
