/**
 * Partner commission on driver-posted POOL rides, end to end.
 *
 * completePoolRide used to settle the franchise and the driver's commission
 * cycle and stop — recruited drivers and riders generated zero partner revenue
 * on pool rides. This proves the gap is closed and stays closed:
 *
 *  - the driver's fleet owner earns their tier rate on the commission of the
 *    WHOLE pool gross (the driver drove all of it)
 *  - each rider's fleet owner earns on the commission of THAT rider's seat
 *    fare only — never on the whole car
 *  - a rider nobody recruited credits nobody
 *  - receipts are one row per member per role, so nothing overwrites
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import {
  joinPoolRide,
  startPoolBoarding,
  poolArrivePassenger,
  poolPassengerBoarded,
  completePoolRide,
} from '../../poolRides/index';

function makeReq<T>(data: T, uid: string, role = 'passenger'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}
const driverReq = <T>(data: T, uid: string) => makeReq(data, uid, 'driver');

const DRIVER = 'pool-driver';
const AHMED = 'pool-rider-ahmed';
const BILAL = 'pool-rider-bilal';
const DRIVER_PARTNER = 'pool-partner-driver-side';
const RIDER_PARTNER = 'pool-partner-rider-side';

const F8_MARKAZ = { lat: 33.7086, lng: 73.0353, address: 'F-8 Markaz, Islamabad' };
const BLUE_AREA = { lat: 33.7167, lng: 73.0646, address: 'Blue Area, Islamabad' };
const RIDE_ID = 'ride-partner-credit';
const PER_SEAT = 1000;

async function seedPartner(uid: string, fleetId: string, type: 'driver' | 'passenger', tier: 'free' | 'pro') {
  await db().doc(`partners/${uid}`).set({
    uid,
    tier,
    referralCode: uid === DRIVER_PARTNER ? '11111' : '22222',
    fullName: 'Fleet Owner',
    status: 'active',
    level: 'bronze',
    lifetimeEarnings: 0,
    completedRides: 0,
    flaggedRides: 0,
    [type === 'driver' ? 'driverFleetId' : 'passengerFleetId']: fleetId,
  });
  await db().doc(`partner_wallets/${uid}`).set({ uid, balance: 0, pending: 0, withdrawn: 0, lifetimeEarnings: 0 });
  await db().doc(`partner_fleets/${fleetId}`).set({
    id: fleetId,
    partnerId: uid,
    type,
    code: '11111',
    members: 1,
    completedRides: 0,
    lifetimeEarnings: 0,
  });
}

async function bindReferral(memberUid: string, partnerId: string, fleetId: string, type: 'driver' | 'passenger') {
  await db()
    .doc(type === 'driver' ? `driver_referrals/${memberUid}` : `passenger_referrals/${memberUid}`)
    .set({
      uid: memberUid,
      partnerId,
      fleetId,
      type,
      completedRides: 0,
      flaggedRides: 0,
      totalRideValue: 0,
      platformCommissionGenerated: 0,
      fleetCommissionGenerated: 0,
    });
}

async function pending(uid: string): Promise<number> {
  const w = await db().doc(`partner_wallets/${uid}`).get();
  return (w.get('pending') as number) ?? 0;
}

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${AHMED}`).set({ gender: 'male', displayName: 'Ahmed', mixedRideOk: false });
  await db().doc(`users/${BILAL}`).set({ gender: 'male', displayName: 'Bilal', mixedRideOk: false });
  await db().doc(`drivers/${DRIVER}`).set({ gender: 'male', fullName: 'Ali', online: true });
  await db().doc(`poolRides/${RIDE_ID}`).set({
    driverId: DRIVER,
    driverName: 'Ali',
    genderPref: 'male_only',
    pickup: F8_MARKAZ,
    dropoff: BLUE_AREA,
    pickupRadius: 500,
    dropoffRadius: 500,
    maxSeats: 3,
    takenSeats: 0,
    maleSeats: 0,
    femaleSeats: 0,
    genderComposition: 'male',
    perSeatFare: PER_SEAT,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // A Pro partner recruited the driver; a free partner recruited Ahmed. Bilal
  // was recruited by nobody.
  await seedPartner(DRIVER_PARTNER, 'pool-fleet-d', 'driver', 'pro');
  await bindReferral(DRIVER, DRIVER_PARTNER, 'pool-fleet-d', 'driver');
  await seedPartner(RIDER_PARTNER, 'pool-fleet-p', 'passenger', 'free');
  await bindReferral(AHMED, RIDER_PARTNER, 'pool-fleet-p', 'passenger');

  // Both riders join, the driver boards them, the pool goes in_progress.
  for (const rider of [AHMED, BILAL]) {
    await joinPoolRide.run(
      makeReq(
        {
          rideId: RIDE_ID,
          pickupLat: F8_MARKAZ.lat,
          pickupLng: F8_MARKAZ.lng,
          pickupAddress: F8_MARKAZ.address,
          dropoffAddress: BLUE_AREA.address,
        },
        rider,
      ),
    );
  }
  await startPoolBoarding.run(driverReq({ rideId: RIDE_ID, driverLat: F8_MARKAZ.lat, driverLng: F8_MARKAZ.lng }, DRIVER));
  for (const rider of [AHMED, BILAL]) {
    await poolArrivePassenger.run(driverReq({ rideId: RIDE_ID, passengerId: rider }, DRIVER));
    await poolPassengerBoarded.run(driverReq({ rideId: RIDE_ID, passengerId: rider }, DRIVER));
  }

  // The test completes the ride milliseconds after boarding, which the fraud
  // engine rightly reads as an impossible 2.9 km in zero time. Backdate the
  // boarding so the ride took a plausible half hour.
  await db().doc(`poolRides/${RIDE_ID}`).set(
    { allBoardedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 60 * 1000) },
    { merge: true },
  );
});

describe('a pool ride with recruited people aboard', () => {
  it('credits the driver partner on the whole commission and the rider partner on their seat only', async () => {
    await completePoolRide.run(driverReq({ rideId: RIDE_ID }, DRIVER));

    // Two seats × Rs 1,000 = Rs 2,000 gross; default 10% commission = Rs 200.
    const ride = await db().doc(`poolRides/${RIDE_ID}`).get();
    expect(ride.get('status')).toBe('completed');
    expect(ride.get('grossFare')).toBe(2 * PER_SEAT);
    expect(ride.get('partnerRideStatus')).toBe('completed');

    // Pro driver-side partner: 2% of the Rs 200 commission = Rs 4.
    expect(await pending(DRIVER_PARTNER)).toBe(4);

    // Free rider-side partner: Ahmed's seat carried Rs 100 of the commission;
    // 0.5% of that rounds to Rs 1 — NOT 0.5% of the whole Rs 200.
    expect(await pending(RIDER_PARTNER)).toBe(1);

    // One receipt per member per role.
    const driverRow = await db().doc(`partner_transactions/${RIDE_ID}_${DRIVER}_driver`).get();
    expect(driverRow.exists).toBe(true);
    expect(driverRow.get('fleetCommission')).toBe(4);
    expect(driverRow.get('platformCommission')).toBe(200);
    expect(driverRow.get('rideFare')).toBe(2 * PER_SEAT);
    expect(driverRow.get('paymentMethod')).toBe('cash');

    const ahmedRow = await db().doc(`partner_transactions/${RIDE_ID}_${AHMED}_passenger`).get();
    expect(ahmedRow.exists).toBe(true);
    expect(ahmedRow.get('fleetCommission')).toBe(1);
    expect(ahmedRow.get('rideFare')).toBe(PER_SEAT);

    // Bilal has no recruiter: no receipt, nobody paid for him.
    const bilalRow = await db().doc(`partner_transactions/${RIDE_ID}_${BILAL}_passenger`).get();
    expect(bilalRow.exists).toBe(false);
  });

  it('rolls the member counters at the member’s own seat value', async () => {
    await completePoolRide.run(driverReq({ rideId: RIDE_ID }, DRIVER));

    const ahmedEdge = await db().doc(`passenger_referrals/${AHMED}`).get();
    expect(ahmedEdge.get('completedRides')).toBe(1);
    expect(ahmedEdge.get('totalRideValue')).toBe(PER_SEAT);
    expect(ahmedEdge.get('platformCommissionGenerated')).toBe(100);
    expect(ahmedEdge.get('fleetCommissionGenerated')).toBe(1);

    const driverEdge = await db().doc(`driver_referrals/${DRIVER}`).get();
    expect(driverEdge.get('totalRideValue')).toBe(2 * PER_SEAT);
    expect(driverEdge.get('platformCommissionGenerated')).toBe(200);
  });

  it('flags the whole ride when the driver’s own fleet owner takes a seat', async () => {
    // The partner who recruited the driver climbs into a co-rider seat of their
    // own driver's pool. That is a staged ride however you slice it — the whole
    // ride pays zero, exactly as it would if they had been the primary rider.
    // A fresh ride, because the shared one is already in_progress. The decoy
    // rider's uid sorts before the owner's, so the owner lands in a CO-RIDER
    // slot (riders are read in document-id order) — the exact gap under test.
    const RIDE2 = 'ride-owner-seat';
    const DECOY = 'aaa-decoy-rider';
    await db().doc(`users/${DECOY}`).set({ gender: 'male', displayName: 'Decoy', mixedRideOk: false });
    await db().doc(`users/${DRIVER_PARTNER}`).set({ gender: 'male', displayName: 'Owner', mixedRideOk: false });
    await db().doc(`poolRides/${RIDE2}`).set({
      driverId: DRIVER,
      driverName: 'Ali',
      genderPref: 'male_only',
      pickup: F8_MARKAZ,
      dropoff: BLUE_AREA,
      pickupRadius: 500,
      dropoffRadius: 500,
      maxSeats: 3,
      takenSeats: 0,
      maleSeats: 0,
      femaleSeats: 0,
      genderComposition: 'male',
      perSeatFare: PER_SEAT,
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    for (const rider of [DECOY, DRIVER_PARTNER]) {
      await joinPoolRide.run(
        makeReq(
          {
            rideId: RIDE2,
            pickupLat: F8_MARKAZ.lat,
            pickupLng: F8_MARKAZ.lng,
            pickupAddress: F8_MARKAZ.address,
            dropoffAddress: BLUE_AREA.address,
          },
          rider,
        ),
      );
    }
    await startPoolBoarding.run(driverReq({ rideId: RIDE2, driverLat: F8_MARKAZ.lat, driverLng: F8_MARKAZ.lng }, DRIVER));
    for (const rider of [DECOY, DRIVER_PARTNER]) {
      await poolArrivePassenger.run(driverReq({ rideId: RIDE2, passengerId: rider }, DRIVER));
      await poolPassengerBoarded.run(driverReq({ rideId: RIDE2, passengerId: rider }, DRIVER));
    }
    await db().doc(`poolRides/${RIDE2}`).set(
      { allBoardedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 60 * 1000) },
      { merge: true },
    );

    await completePoolRide.run(driverReq({ rideId: RIDE2 }, DRIVER));

    const ride = await db().doc(`poolRides/${RIDE2}`).get();
    expect(ride.get('partnerRideStatus')).toBe('scam');
    expect(await pending(DRIVER_PARTNER)).toBe(0);

    const driverRow = await db().doc(`partner_transactions/${RIDE2}_${DRIVER}_driver`).get();
    expect(driverRow.exists).toBe(true);
    expect(driverRow.get('status')).toBe('reversed');
    expect(driverRow.get('rideStatus')).toBe('scam');
  });

  it('zeroes the seat of a rider who shares the driver’s recruiter — collusion', async () => {
    // Re-point Ahmed's edge at the DRIVER's partner: that partner now owns both
    // the driver and a rider, and can stage that seat at will.
    await db().doc(`passenger_referrals/${AHMED}`).set(
      { partnerId: DRIVER_PARTNER, fleetId: 'pool-fleet-d' },
      { merge: true },
    );

    await completePoolRide.run(driverReq({ rideId: RIDE_ID }, DRIVER));

    // Whichever slot Ahmed lands in (primary if he joined first, co-rider
    // otherwise), the same-partner rule must zero his seat and mark the row —
    // never silently drop it.
    const ahmedRow = await db().doc(`partner_transactions/${RIDE_ID}_${AHMED}_passenger`).get();
    expect(ahmedRow.exists).toBe(true);
    expect(ahmedRow.get('fleetCommission')).toBe(0);
    expect(ahmedRow.get('status')).toBe('reversed');
    expect(ahmedRow.get('rideStatus')).toBe('scam');
  });
});
