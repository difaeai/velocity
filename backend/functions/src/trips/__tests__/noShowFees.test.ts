/**
 * Ending a shared ride with somebody who never got in, and carrying a rider's
 * unpaid cancellation fee on their next ride.
 *
 * Verified here:
 *  - a rider the driver never started or dropped is a no-show at End ride: not
 *    in the driver's gross, not in the seats, recorded on the trip
 *  - a trip started all at once (older driver builds) has no no-shows at all
 *  - a rider's fee is stamped when their ride starts and collected at End ride;
 *    the driver pays it — and their own old fee — from credits, then outstanding
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { poolPerSeatFare } from '../../domain/fares';
import { completeTrip, createTrip, updateTripStatus } from '../index';
import { boardPoolRider, dropOffRider } from '../dropOff';
import { joinPoolTrip } from '../poolShare';
import { noShowsOf } from '../poolRoster';

const HOST = 'noshow-host';
const RIDER = 'noshow-rider';
const DRIVER = 'noshow-driver';

const TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'male' as const,
  paymentMethod: 'cash' as const,
  pickup: { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' },
  dropoff: { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' },
};

function asDriver<T>(data: T): CallableRequest<T> {
  const req = makeReq(data, DRIVER);
  (req.auth!.token as unknown as Record<string, unknown>).role = 'driver';
  return req;
}

/** What acceptBid and "Arrived" leave behind. */
async function driverAtPickup(tripId: string) {
  await db().doc(`openRequests/${tripId}`).delete();
  await db().doc(`trips/${tripId}`).set(
    { status: 'arrived', fare: 400, driverId: DRIVER, driverInfo: { driverId: DRIVER, displayName: 'Bilal' } },
    { merge: true },
  );
}

async function seedRiders() {
  await clearFirestore();
  // createTrip and the join read gender from the profile, not the request.
  await db().doc(`users/${HOST}`).set({ name: 'Usman Tariq', gender: 'male' });
  await db().doc(`users/${RIDER}`).set({ name: 'Ali Raza', gender: 'male' });
}

async function twoRiderPool(): Promise<string> {
  const { tripId, shareCode } = (await createTrip.run(makeReq({ ...TRIP, pool: true }, HOST))) as {
    tripId: string;
    shareCode: string;
  };
  await joinPoolTrip.run(makeReq({ code: shareCode }, RIDER));
  await driverAtPickup(tripId);
  return tripId;
}

type Settlement = {
  grossFare: number;
  seats: number;
  noShows: string[];
  feesByRider: Record<string, number>;
  feesPaidFromCredit: number;
  commissionPaidFromCredit: number;
};
const settlementOf = (res: unknown) => (res as { settlement: Settlement }).settlement;

describe('noShowsOf', () => {
  it('names only the unstarted, undropped riders of a car started one by one', () => {
    expect(noShowsOf([
      { uid: 'a', kind: 'host', boardedAt: 1 },
      { uid: 'b', kind: 'share' },
      { uid: 'c', kind: 'share', droppedAt: 1 },
    ])).toEqual(['b']);
  });

  it('a car started all at once has nobody missing', () => {
    expect(noShowsOf([{ uid: 'a', kind: 'host' }, { uid: 'b', kind: 'share' }])).toEqual([]);
  });

  it('an en-route rider is aboard only by their own stamp', () => {
    expect(noShowsOf([
      { uid: 'a', kind: 'enroute', boardedAt: 1 },
      { uid: 'b', kind: 'host' },
      { uid: 'c', kind: 'enroute' },
    ])).toEqual(['c']);
  });
});

describe('End ride with a no-show', () => {
  beforeEach(seedRiders);

  it('settles only the rider who rode, at the fare they were told', async () => {
    const tripId = await twoRiderPool();
    await boardPoolRider.run(asDriver({ tripId, riderUid: HOST }));
    await dropOffRider.run(asDriver({ tripId, riderUid: HOST }));

    const s = settlementOf(await completeTrip.run(asDriver({ tripId })));
    expect(s.noShows).toEqual([RIDER]);
    expect(s.seats).toBe(1);
    expect(s.grossFare).toBe(poolPerSeatFare(400, 2));

    const trip = await db().doc(`trips/${tripId}`).get();
    expect(trip.get('poolNoShows')).toEqual([RIDER]);
  });

  it('a car started all at once still settles everyone', async () => {
    const tripId = await twoRiderPool();
    await db().doc(`trips/${tripId}`).set({ status: 'in_progress' }, { merge: true });

    const s = settlementOf(await completeTrip.run(asDriver({ tripId })));
    expect(s.noShows).toEqual([]);
    expect(s.seats).toBe(2);
    expect(s.grossFare).toBe(poolPerSeatFare(400, 2) * 2);
  });
});

describe('a cancellation fee rides on the next ride', () => {
  beforeEach(seedRiders);

  it('solo: stamped at Start, collected at End, paid from the driver credits', async () => {
    await db().doc(`wallets/${HOST}`).set({ outstanding: 62 });
    // The driver's own fee from before credits paid fees, plus credits to cover both.
    await db().doc(`wallets/${DRIVER}`).set({ outstanding: 50 });
    await db().doc(`drivers/${DRIVER}`).set({ commissionCredit: 500 });

    const { tripId } = (await createTrip.run(makeReq(TRIP, HOST))) as { tripId: string };
    await driverAtPickup(tripId);
    await updateTripStatus.run(asDriver({ tripId, to: 'in_progress' }));
    expect((await db().doc(`trips/${tripId}/fees/${HOST}`).get()).get('amount')).toBe(62);

    const s = settlementOf(await completeTrip.run(asDriver({ tripId })));
    expect(s.feesByRider).toEqual({ [HOST]: 62 });
    expect(s.feesPaidFromCredit).toBe(112);

    expect((await db().doc(`wallets/${HOST}`).get()).get('outstanding')).toBe(0);
    expect((await db().doc(`wallets/${DRIVER}`).get()).get('outstanding')).toBe(0);
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('commissionCredit')).toBe(500 - s.commissionPaidFromCredit - 112);
    expect((await db().doc(`trips/${tripId}/fees/${HOST}`).get()).get('collected')).toBe(62);
  });

  it('a driver without credits carries the rider fee as their own outstanding', async () => {
    await db().doc(`wallets/${HOST}`).set({ outstanding: 31 });

    const { tripId } = (await createTrip.run(makeReq(TRIP, HOST))) as { tripId: string };
    await driverAtPickup(tripId);
    await updateTripStatus.run(asDriver({ tripId, to: 'in_progress' }));
    const s = settlementOf(await completeTrip.run(asDriver({ tripId })));

    expect(s.feesPaidFromCredit).toBe(0);
    expect((await db().doc(`wallets/${HOST}`).get()).get('outstanding')).toBe(0);
    expect((await db().doc(`wallets/${DRIVER}`).get()).get('outstanding')).toBe(31);
  });

  it('a no-show carries their fee on to a ride they actually take', async () => {
    await db().doc(`wallets/${RIDER}`).set({ outstanding: 31 });
    const tripId = await twoRiderPool();
    await boardPoolRider.run(asDriver({ tripId, riderUid: HOST }));
    await dropOffRider.run(asDriver({ tripId, riderUid: HOST }));
    await completeTrip.run(asDriver({ tripId }));

    expect((await db().doc(`wallets/${RIDER}`).get()).get('outstanding')).toBe(31);
    expect((await db().doc(`trips/${tripId}/fees/${RIDER}`).get()).exists).toBe(false);
  });

  it('the rider hears the fee with the fare at their stop', async () => {
    await db().doc(`wallets/${RIDER}`).set({ outstanding: 31 });
    const tripId = await twoRiderPool();
    await boardPoolRider.run(asDriver({ tripId, riderUid: RIDER }));
    const res = (await dropOffRider.run(asDriver({ tripId, riderUid: RIDER }))) as { fee: number };
    expect(res.fee).toBe(31);
  });
});
