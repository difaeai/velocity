/**
 * How real users break Velocity — the attacks a function has to stop.
 *
 * Each case is something a person with an account and a few minutes could do,
 * written as the attack itself so the test fails the day the door reopens. The
 * attacks that only the security rules can stop (a client writing straight to
 * Firestore or Storage) live with the rules tests: tests/firestore.rules.test.mjs
 * and tests/storage.rules.test.mjs, numbered the same way.
 *
 *   1. Pay commission with a receipt made in an image editor
 *   2. Fake a gateway's "payment successful" return
 *   5. Get one driver matched to two riders at once
 *   6. Read where Travel Partner users live
 *   9. Flood someone's phone with fleet requests
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, confirmedCar, db, makeReq } from '../travelMate/__tests__/helpers';
import { decideTopupProof, readReceipt } from '../domain/topupProof';
import { reverseManualTopup } from '../payments/manualTopup';
import { paymentWebhook } from '../payments';
import { acceptBid, createTrip, placeBid } from '../trips';
import { coarsenTravelMateLocations } from '../travelMate/coarseLocation';
import { sendFleetRequest } from '../fleet';

const driverReq = <T>(data: T, uid: string): CallableRequest<T> =>
  ({
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  }) as unknown as CallableRequest<T>;

beforeEach(clearFirestore);

describe('Attack 1: pay commission with a receipt made in an image editor', () => {
  // A perfect-looking receipt: the right words, a fresh reference, our account.
  const FAKE = `Transaction Successful
Beneficiary: BERRETO PRIVATE LIMITED
Account: PK36SCBL0000001123456702
Amount Transferred PKR 5,000
Reference No: FT26101599999999`;
  const ACCOUNTS = { bankIban: 'PK36SCBL0000001123456702', accountTitle: 'BERRETO PRIVATE LIMITED' };

  it('cannot turn into spendable money — the engine clears only what is owed', () => {
    const v = decideTopupProof({
      fields: readReceipt(FAKE, ACCOUNTS),
      claimed: 5000,
      ocrConfidence: 95,
      duplicate: false,
      imageReplay: false,
      commissionDue: 300,
    });
    expect(v.status).toBe('pending_review');
    expect(v.creditAmount).toBe(0);
  });

  it('is taken back when the after-check finds no money: the driver owes it again', async () => {
    await db().doc('manualTopups/t1').set({ uid: 'drv', status: 'approved', audit: 'pending', creditedAmount: 300 });
    // The fake already paid the commission, so only 100 is left in the balance.
    await db().doc('wallets/drv').set({ balance: 100 });

    expect(await reverseManualTopup('t1', 'admin1', 'not on the statement')).toEqual({ takenFromBalance: 100, owed: 200 });
    const wallet = (await db().doc('wallets/drv').get()).data()!;
    expect(wallet).toMatchObject({ balance: 0, outstanding: 200 });
    expect((await db().doc('manualTopups/t1').get()).get('status')).toBe('reversed');
    await expect(reverseManualTopup('t1', 'admin1', null)).rejects.toThrow(/Only an engine-credited/);
  });
});

describe('Attack 2: fake a gateway "payment successful" return', () => {
  beforeEach(() => {
    process.env.PAYFAST_MERCHANT_ID = '12345';
    process.env.PAYFAST_SECURED_KEY = 'secret';
  });
  afterEach(() => {
    delete process.env.PAYFAST_MERCHANT_ID;
    delete process.env.PAYFAST_SECURED_KEY;
  });

  it('copying the return link out of the checkout page credits nothing', async () => {
    await db().doc('paymentIntents/i1').set({ uid: 'rider', amount: 100000, status: 'pending', provider: 'payfast', providerRef: 'V1' });
    await db().doc('paymentIntentSecrets/i1').set({ token: 'tok' });

    const res = { code: 0, body: '' as unknown, status(c: number) { this.code = c; return this; }, send(b: unknown) { this.body = b; return this; } };
    // Everything here is on the page the payer's own browser loaded.
    await paymentWebhook(
      { method: 'GET', query: { t: 'tok', basket_id: 'V1', err_code: '000' }, body: {}, headers: {} } as never,
      res as never,
    );

    expect(res.code).toBe(403);
    expect((await db().doc('wallets/rider').get()).get('balance') ?? 0).toBe(0);
    expect((await db().doc('paymentIntents/i1').get()).get('status')).toBe('unverified');
  });
});

describe('Attack 5: get one driver matched to two riders at once', () => {
  const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
  const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };
  const TRIP = { rideType: 'mini' as const, offeredFare: 400, seats: 1, passengerGender: 'unspecified' as const, paymentMethod: 'cash' as const, pickup: PICKUP, dropoff: DROPOFF };

  it('lets the first rider have the driver and turns the second away', async () => {
    await db().doc('drivers/drv').set({
      verificationStatus: 'approved', online: true, lastLocation: { lat: PICKUP.lat, lng: PICKUP.lng },
      vehicleLabel: 'Suzuki Alto', plate: 'ABC-123', rating: 5, ...confirmedCar(),
    });
    const { tripId: a } = (await createTrip.run(makeReq(TRIP, 'riderA'))) as { tripId: string };
    const { tripId: b } = (await createTrip.run(makeReq(TRIP, 'riderB'))) as { tripId: string };
    // The driver offers on both — which every driver does.
    const { bidId: bidA } = (await placeBid.run(driverReq({ tripId: a, fare: 400 }, 'drv'))) as { bidId: string };
    const { bidId: bidB } = (await placeBid.run(driverReq({ tripId: b, fare: 400 }, 'drv'))) as { bidId: string };

    await acceptBid.run(makeReq({ tripId: a, bidId: bidA }, 'riderA'));
    await expect(acceptBid.run(makeReq({ tripId: b, bidId: bidB }, 'riderB'))).rejects.toThrow(/just taken another ride/);
    expect((await db().doc(`trips/${b}`).get()).get('status')).toBe('requested');
  });
});

describe('Attack 6: read where Travel Partner users live', () => {
  it('finds nothing closer than ~1 km, however the profile was saved', async () => {
    await db().doc('travelMateProfiles/her').set({ displayName: 'A', gender: 'female', location: { lat: 31.520412, lng: 74.358734 } });
    await db().doc('travelMateProfiles/him').set({ displayName: 'B', gender: 'male', location: { lat: 31.52, lng: 74.36 } });

    await coarsenTravelMateLocations.run({} as never);

    expect((await db().doc('travelMateProfiles/her').get()).get('location')).toEqual({ lat: 31.52, lng: 74.36 });
    expect((await db().doc('travelMateProfiles/him').get()).get('location')).toEqual({ lat: 31.52, lng: 74.36 });
  });
});

describe('Attack 9: flood someone’s phone with fleet requests', () => {
  it('stops after ten an hour', async () => {
    await db().doc('usernames/ayesha').set({ uid: 'victim' });
    await db().doc('fleets/spammer').set({ uid: 'spammer', pickup: { lat: 31.5, lng: 74.3 }, members: [] });

    for (let i = 0; i < 10; i++) {
      await sendFleetRequest.run(makeReq({ username: 'ayesha', message: `#${i}` }, 'spammer'));
    }
    await expect(sendFleetRequest.run(makeReq({ username: 'ayesha' }, 'spammer'))).rejects.toThrow(/slow down/);
  });
});
