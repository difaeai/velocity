/**
 * Cancellation fees — who pays what, and where the money lands.
 *
 * Verified invariants:
 *  - cancelling a `requested` trip is free for the passenger (no driver committed)
 *  - after a driver accepts: passenger pays 5%, driver pays 8%, of the LOCKED fare
 *  - the fee is taken from the wallet balance first; only the shortfall becomes
 *    `outstanding` — and balance is never driven negative
 *  - a cancelling passenger's released wallet hold is available to pay their fee
 *  - the fee is ledgered to platformLedger and the system counters
 *  - `in_progress` trips still cannot be cancelled by anyone
 *  SECURITY: a stranger cannot cancel someone else's trip
 *  ENFORCEMENT: outstanding at/over the limit blocks createTrip and placeBid;
 *               under the limit it does not
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip, placeBid, acceptBid, cancelTrip } from '../index';

const PASSENGER = 'cancel-passenger';
const DRIVER = 'cancel-driver';
const STRANGER = 'cancel-stranger';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

// mini: static band is 280–1200 PKR, so 400 is a valid offer and a valid bid.
const FARE = 400;
const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: FARE,
  seats: 1,
  passengerGender: 'unspecified' as const,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

/** makeReq only carries a uid; driver-role callables need the claim too. */
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

async function wallet(uid: string): Promise<{ balance: number; outstanding: number }> {
  const snap = await db().doc(`wallets/${uid}`).get();
  return {
    balance: (snap.get('balance') as number | undefined) ?? 0,
    outstanding: (snap.get('outstanding') as number | undefined) ?? 0,
  };
}

/** Create a trip, have the driver bid, and have the passenger accept it. */
async function matchedTrip(overrides: Record<string, unknown> = {}): Promise<string> {
  const { tripId } = await createTrip.run(
    makeReq({ ...BASE_TRIP, ...overrides }, PASSENGER),
  ) as { tripId: string };
  const { bidId } = await placeBid.run(driverReq({ tripId, fare: FARE })) as { bidId: string };
  await acceptBid.run(makeReq({ tripId, bidId }, PASSENGER));
  return tripId;
}

beforeEach(async () => {
  await clearFirestore();
  await seedApprovedDriver();
});

describe('cancelTrip — before a driver accepts', () => {
  it('is free for the passenger and charges nothing', async () => {
    const { tripId } = await createTrip.run(makeReq(BASE_TRIP, PASSENGER)) as { tripId: string };

    const res = await cancelTrip.run(makeReq({ tripId }, PASSENGER)) as { fee: number };
    expect(res.fee).toBe(0);

    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('status')).toBe('cancelled');
    expect(trip.get('cancellationFee')).toBeNull();
    expect(await wallet(PASSENGER)).toEqual({ balance: 0, outstanding: 0 });

    // The request is off the drivers' feed and the passenger is free to rebook.
    expect((await db().doc(`openRequests/${tripId}`).get()).exists).toBe(false);
    expect((await db().doc(`users/${PASSENGER}`).get()).get('activeTripId')).toBeNull();
  });
});

describe('cancelTrip — after a driver accepts', () => {
  it('charges the passenger 5% of the locked fare, all of it outstanding on an empty wallet', async () => {
    const tripId = await matchedTrip();

    const res = await cancelTrip.run(makeReq({ tripId }, PASSENGER)) as {
      fee: number; paidFromWallet: number; outstanding: number;
    };
    expect(res).toEqual({ ok: true, fee: 20, paidFromWallet: 0, outstanding: 20 }); // 5% of 400

    // Empty wallet → the whole fee is a debt, and the balance never goes negative.
    expect(await wallet(PASSENGER)).toEqual({ balance: 0, outstanding: 20 });

    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('status')).toBe('cancelled');
    expect(trip.get('cancelledByRole')).toBe('passenger');
    expect(trip.get('cancelledFrom')).toBe('matched');
    expect(trip.get('cancellationFee')).toMatchObject({
      amount: 20, rate: 0.05, role: 'passenger', paidFromWallet: 0, outstanding: 20,
    });
  });

  it('charges the driver 8% of the locked fare — more than the passenger pays', async () => {
    const tripId = await matchedTrip();

    const res = await cancelTrip.run(driverReq({ tripId })) as {
      fee: number; paidFromWallet: number; outstanding: number;
    };
    expect(res).toEqual({ ok: true, fee: 32, paidFromWallet: 0, outstanding: 32 }); // 8% of 400

    expect(await wallet(DRIVER)).toEqual({ balance: 0, outstanding: 32 });
    // The passenger walked away clean — they didn't cancel.
    expect(await wallet(PASSENGER)).toEqual({ balance: 0, outstanding: 0 });

    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('cancelledByRole')).toBe('driver');
    expect(trip.get('cancellationFee')).toMatchObject({ amount: 32, rate: 0.08, role: 'driver' });
  });

  it('takes the fee out of a wallet balance that can cover it, owing nothing', async () => {
    await db().doc(`wallets/${DRIVER}`).set({ balance: 500 });
    const tripId = await matchedTrip();

    const res = await cancelTrip.run(driverReq({ tripId })) as { paidFromWallet: number; outstanding: number };
    expect(res.paidFromWallet).toBe(32);
    expect(res.outstanding).toBe(0);
    expect(await wallet(DRIVER)).toEqual({ balance: 468, outstanding: 0 });
  });

  it('splits a fee a partial balance cannot cover: balance drains to 0, rest is owed', async () => {
    await db().doc(`wallets/${DRIVER}`).set({ balance: 12 });
    const tripId = await matchedTrip();

    const res = await cancelTrip.run(driverReq({ tripId })) as { paidFromWallet: number; outstanding: number };
    expect(res.paidFromWallet).toBe(12);
    expect(res.outstanding).toBe(20); // 32 owed − 12 paid
    expect(await wallet(DRIVER)).toEqual({ balance: 0, outstanding: 20 });
  });

  it("pays a cancelling passenger's fee out of the ride hold it just released", async () => {
    // Wallet ride: acceptBid holds the full fare, so the balance drops to 100.
    await db().doc(`wallets/${PASSENGER}`).set({ balance: 500 });
    const tripId = await matchedTrip({ paymentMethod: 'wallet' });
    expect((await wallet(PASSENGER)).balance).toBe(100);

    const res = await cancelTrip.run(makeReq({ tripId }, PASSENGER)) as {
      paidFromWallet: number; outstanding: number;
    };
    // Hold released (100 + 400 = 500), fee of 20 taken from it → nothing owed.
    expect(res).toMatchObject({ paidFromWallet: 20, outstanding: 0 });
    expect(await wallet(PASSENGER)).toEqual({ balance: 480, outstanding: 0 });
    expect((await db().doc(`trips/${tripId}`).get()).get('walletHold')).toBe(0);
  });

  it('accumulates across repeat cancellations rather than overwriting', async () => {
    await cancelTrip.run(makeReq({ tripId: await matchedTrip() }, PASSENGER));
    await cancelTrip.run(makeReq({ tripId: await matchedTrip() }, PASSENGER));

    expect((await wallet(PASSENGER)).outstanding).toBe(40); // 20 + 20
  });

  it("books the fee to Velocity's ledger and counters", async () => {
    const tripId = await matchedTrip();
    await cancelTrip.run(driverReq({ tripId }));

    const ledger = await db().collection('platformLedger')
      .where('type', '==', 'cancellation_fee').get();
    expect(ledger.size).toBe(1);
    expect(ledger.docs[0]!.data()).toMatchObject({
      tripId, userId: DRIVER, role: 'driver', amount: 32, collected: 0, outstanding: 32,
    });

    const counters = await db().doc('system/counters').get();
    expect(counters.get('cancellationFeesCharged')).toBe(32);
    expect(counters.get('cancellationFeesCollected')).toBe(0);
    expect(counters.get('cancellationFeesOutstanding')).toBe(32);
  });

  it('honours admin-configured rates', async () => {
    await db().doc('config/cancellationSettings').set({
      passengerFeeRate: 0.25,
      driverFeeRate: 0.5,
      outstandingLimit: 1000,
    });

    const res = await cancelTrip.run(makeReq({ tripId: await matchedTrip() }, PASSENGER)) as { fee: number };
    expect(res.fee).toBe(100); // 25% of 400
  });
});

describe('cancelTrip — guards', () => {
  it('refuses to cancel a trip in progress', async () => {
    const tripId = await matchedTrip();
    await db().doc(`trips/${tripId}`).set({ status: 'in_progress' }, { merge: true });

    await expect(cancelTrip.run(makeReq({ tripId }, PASSENGER))).rejects.toThrow(/in_progress/);
    expect(await wallet(PASSENGER)).toEqual({ balance: 0, outstanding: 0 });
  });

  it('refuses a stranger, charging nobody', async () => {
    const tripId = await matchedTrip();

    await expect(cancelTrip.run(makeReq({ tripId }, STRANGER))).rejects.toThrow(/Not your trip/);
    expect((await db().doc(`trips/${tripId}`).get()).get('status')).toBe('matched');
    expect(await wallet(STRANGER)).toEqual({ balance: 0, outstanding: 0 });
  });
});

describe('outstanding fees block new rides at the limit', () => {
  beforeEach(async () => {
    await db().doc('config/cancellationSettings').set({
      passengerFeeRate: 0.05,
      driverFeeRate: 0.08,
      outstandingLimit: 100,
    });
  });

  it('lets a passenger keep booking while the debt is under the limit', async () => {
    await db().doc(`wallets/${PASSENGER}`).set({ outstanding: 99 });

    const res = await createTrip.run(makeReq(BASE_TRIP, PASSENGER)) as { tripId: string };
    expect(res.tripId).toBeTruthy();
  });

  it('blocks a passenger from booking once the debt reaches the limit', async () => {
    await db().doc(`wallets/${PASSENGER}`).set({ outstanding: 100 });

    await expect(createTrip.run(makeReq(BASE_TRIP, PASSENGER)))
      .rejects.toThrow(/Cancellation fees due/);
  });

  it('blocks a driver from bidding once the debt reaches the limit', async () => {
    const { tripId } = await createTrip.run(makeReq(BASE_TRIP, PASSENGER)) as { tripId: string };
    await db().doc(`wallets/${DRIVER}`).set({ outstanding: 150 });

    await expect(placeBid.run(driverReq({ tripId, fare: FARE })))
      .rejects.toThrow(/Cancellation fees due/);
  });

  it('lets the driver bid again once the debt is settled', async () => {
    const { tripId } = await createTrip.run(makeReq(BASE_TRIP, PASSENGER)) as { tripId: string };
    await db().doc(`wallets/${DRIVER}`).set({ outstanding: 150 });
    await expect(placeBid.run(driverReq({ tripId, fare: FARE }))).rejects.toThrow();

    await db().doc(`wallets/${DRIVER}`).set({ outstanding: 0 }, { merge: true });
    const res = await placeBid.run(driverReq({ tripId, fare: FARE })) as { bidId: string };
    expect(res.bidId).toBe(DRIVER);
  });
});
