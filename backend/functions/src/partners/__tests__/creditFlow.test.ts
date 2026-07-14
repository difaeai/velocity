/**
 * Partner commission, end to end through a real completeTrip.
 *
 * The unit tests in commission.test.ts prove the arithmetic. This proves the
 * arithmetic is actually WIRED: that finishing a real ride moves real money into
 * a real partner wallet, and that the fraud rules stop it when they should.
 *
 * Verified invariants:
 *  - a completed ride credits the driver's fleet owner 1% of the PLATFORM
 *    COMMISSION (not of the fare) and writes an immutable transaction row
 *  - the credit lands in `pending`, not the withdrawable balance
 *  - the driver's own payout is untouched — the cut comes out of Velocity's net
 *  - a ride with no referral behind it costs nothing and credits nobody
 *  - COLLUSION: a partner who recruited BOTH the driver and the passenger earns
 *    zero on that ride, and the ride is recorded as a scam
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip, placeBid, acceptBid, updateTripStatus, completeTrip } from '../../trips/index';

const PASSENGER = 'partner-passenger';
const DRIVER = 'partner-driver';
const PARTNER = 'partner-owner';
const OTHER_PARTNER = 'partner-owner-2';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const FARE = 1000;
const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: FARE,
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

async function seedApprovedDriver(uid = DRIVER) {
  await db().doc(`drivers/${uid}`).set({
    verificationStatus: 'approved',
    online: true,
    lastLocation: { lat: PICKUP.lat, lng: PICKUP.lng },
    vehicleLabel: 'Suzuki Alto',
    plate: 'ABC-123',
    rating: 5,
  });
}

async function seedPartner(uid: string, fleetId: string, type: 'driver' | 'passenger') {
  await db().doc(`partners/${uid}`).set({
    uid,
    fullName: 'Fleet Owner',
    status: 'active',
    level: 'bronze',
    lifetimeEarnings: 0,
    completedRides: 0,
    flaggedRides: 0,
  });
  await db().doc(`partner_wallets/${uid}`).set({ uid, balance: 0, pending: 0, withdrawn: 0, lifetimeEarnings: 0 });
  await db().doc(`partner_fleets/${fleetId}`).set({
    id: fleetId,
    partnerId: uid,
    type,
    code: type === 'driver' ? 'VLD-TEST01' : 'VLP-TEST01',
    members: 1,
    completedRides: 0,
    lifetimeEarnings: 0,
  });
}

/** Bind a recruit to a fleet directly — claimPartnerReferral is tested separately. */
async function bindReferral(
  memberUid: string,
  partnerId: string,
  fleetId: string,
  type: 'driver' | 'passenger',
) {
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

/** Run a full ride to completion and hand back the settlement. */
async function runRide(): Promise<{ tripId: string; settlement: Record<string, number> }> {
  const { tripId } = (await createTrip.run(makeReq(BASE_TRIP, PASSENGER))) as { tripId: string };
  const { bidId } = (await placeBid.run(driverReq({ tripId, fare: FARE }))) as { bidId: string };
  await acceptBid.run(makeReq({ tripId, bidId }, PASSENGER));
  // The driver walks the real state machine: matched → arriving → arrived → in_progress.
  await updateTripStatus.run(driverReq({ tripId, to: 'arriving' }));
  await updateTripStatus.run(driverReq({ tripId, to: 'arrived' }));
  await updateTripStatus.run(driverReq({ tripId, to: 'in_progress' }));
  await completeTrip.run(driverReq({ tripId }));

  const trip = await db().doc(`trips/${tripId}`).get();
  return { tripId, settlement: trip.get('settlement') as Record<string, number> };
}

async function partnerWallet(uid: string) {
  const snap = await db().doc(`partner_wallets/${uid}`).get();
  return {
    balance: (snap.get('balance') as number) ?? 0,
    pending: (snap.get('pending') as number) ?? 0,
    lifetimeEarnings: (snap.get('lifetimeEarnings') as number) ?? 0,
  };
}

beforeEach(async () => {
  await clearFirestore();
  await seedApprovedDriver();
});

describe('a driver recruited by a partner completes a ride', () => {
  beforeEach(async () => {
    await seedPartner(PARTNER, 'fleet-d', 'driver');
    await bindReferral(DRIVER, PARTNER, 'fleet-d', 'driver');
  });

  it('pays the fleet owner 1% of the platform commission, not of the fare', async () => {
    const { tripId, settlement } = await runRide();

    // Default commission is 10% of a 1000 PKR fare = 100 PKR to the platform.
    expect(settlement.commission).toBe(100);
    // 1% of that 100 is 1 PKR. 1% of the FARE would have been 10 — the bug this
    // whole feature is designed not to have.
    expect(settlement.driverFleetCut).toBe(1);
    expect(settlement.driverFleetCut).not.toBe(Math.round(FARE * 0.01));

    const txn = await db().doc(`partner_transactions/${tripId}_${PARTNER}`).get();
    expect(txn.exists).toBe(true);
    expect(txn.get('fleetCommission')).toBe(1);
    expect(txn.get('platformCommission')).toBe(100);
    expect(txn.get('rideFare')).toBe(FARE);
    expect(txn.get('rideStatus')).toBe('completed');
  });

  it('credits pending, never the withdrawable balance', async () => {
    await runRide();

    const w = await partnerWallet(PARTNER);
    expect(w.pending).toBe(1);
    // The hold window is the fraud window — money is not spendable on day one.
    expect(w.balance).toBe(0);
    expect(w.lifetimeEarnings).toBe(1);
  });

  it('takes the cut from Velocity, never from the driver', async () => {
    const { settlement } = await runRide();

    // The driver's payout is exactly what it would be with no partner involved.
    expect(settlement.driverPayout).toBe(FARE - settlement.commission);
    // Velocity absorbs the partner's cut out of its own commission.
    expect(settlement.velocityNet).toBe(settlement.commission - settlement.driverFleetCut);
  });

  it('rolls the counters the dashboard reads', async () => {
    await runRide();

    const edge = await db().doc(`driver_referrals/${DRIVER}`).get();
    expect(edge.get('completedRides')).toBe(1);
    expect(edge.get('totalRideValue')).toBe(FARE);
    expect(edge.get('fleetCommissionGenerated')).toBe(1);

    const partner = await db().doc(`partners/${PARTNER}`).get();
    expect(partner.get('completedRides')).toBe(1);
    expect(partner.get('lifetimeEarnings')).toBe(1);
  });
});

describe('a ride with nobody behind it', () => {
  it('credits no partner and writes no transaction', async () => {
    const { tripId, settlement } = await runRide();

    expect(settlement.driverFleetCut).toBe(0);
    expect(settlement.passengerFleetCut).toBe(0);
    // Velocity keeps the whole commission.
    expect(settlement.velocityNet).toBe(settlement.commission);

    const rows = await db()
      .collection('partner_transactions')
      .where('tripId', '==', tripId)
      .get();
    expect(rows.empty).toBe(true);
  });
});

describe('collusion — one partner owns both sides of the ride', () => {
  it('pays zero and records the ride as a scam', async () => {
    // The same partner recruited the driver AND the passenger, so they can stage
    // rides between two accounts they control and bill Velocity for each one.
    await seedPartner(PARTNER, 'fleet-d', 'driver');
    await bindReferral(DRIVER, PARTNER, 'fleet-d', 'driver');
    await db().doc('partner_fleets/fleet-p').set({
      id: 'fleet-p',
      partnerId: PARTNER,
      type: 'passenger',
      code: 'VLP-TEST02',
      members: 1,
      completedRides: 0,
      lifetimeEarnings: 0,
    });
    await bindReferral(PASSENGER, PARTNER, 'fleet-p', 'passenger');

    const { tripId, settlement } = await runRide();

    expect(settlement.driverFleetCut).toBe(0);
    expect(settlement.passengerFleetCut).toBe(0);
    expect(settlement.velocityNet).toBe(settlement.commission);

    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('partnerRideStatus')).toBe('scam');

    // The wallet never moved.
    const w = await partnerWallet(PARTNER);
    expect(w.pending).toBe(0);
    expect(w.lifetimeEarnings).toBe(0);

    // But the ride is still visible to the partner, marked — not silently gone.
    const txn = await db().doc(`partner_transactions/${tripId}_${PARTNER}`).get();
    expect(txn.exists).toBe(true);
    expect(txn.get('rideStatus')).toBe('scam');
    expect(txn.get('status')).toBe('reversed');
    expect(txn.get('fleetCommission')).toBe(0);
    expect(txn.get('fraudReason')).toBeTruthy();

    // And it is on the fraud desk.
    const logs = await db()
      .collection('partner_fraud_logs')
      .where('tripId', '==', tripId)
      .get();
    expect(logs.empty).toBe(false);
    expect(logs.docs[0].get('kind')).toBe('collusion');
  });
});

describe('a suspended partner', () => {
  it('stops earning but the ride still completes normally', async () => {
    await seedPartner(OTHER_PARTNER, 'fleet-s', 'driver');
    await db().doc(`partners/${OTHER_PARTNER}`).set({ status: 'suspended' }, { merge: true });
    await bindReferral(DRIVER, OTHER_PARTNER, 'fleet-s', 'driver');

    const { settlement } = await runRide();

    expect(settlement.driverFleetCut).toBe(0);
    expect(settlement.velocityNet).toBe(settlement.commission);
    // The driver is paid in full — a suspended recruiter is not the driver's fault.
    expect(settlement.driverPayout).toBe(FARE - settlement.commission);

    const w = await partnerWallet(OTHER_PARTNER);
    expect(w.pending).toBe(0);
  });
});
