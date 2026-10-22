/**
 * bookFleetRide is a way of booking a ride, so it makes the checks createTrip
 * makes. It used to skip them: a host already on a live trip, or owing blocking
 * cancellation fees, could book a second car.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { bookFleetRide } from '../index';

const HOST = 'fleet-host';
const ASK = 'fleet-ask-1';

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${HOST}`).set({ name: 'Host', gender: 'male' });
  await db().doc(`fleetAsks/${ASK}`).set({
    hostUid: HOST,
    status: 'open',
    acceptedUids: [],
    pickup: { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' },
    dropoff: { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' },
  });
});

describe('bookFleetRide', () => {
  it('refuses a host who is already on a live trip', async () => {
    await db().doc('trips/live-1').set({ status: 'in_progress', passengerId: HOST });
    await db().doc(`users/${HOST}`).set({ activeTripId: 'live-1' }, { merge: true });
    await expect(bookFleetRide.run(makeReq({ askId: ASK }, HOST))).rejects.toThrow(/active trip/);
  });

  it('refuses a host whose unpaid cancellation fees block booking', async () => {
    await db().doc('config/cancellationSettings').set({ outstandingLimit: 100 });
    await db().doc(`wallets/${HOST}`).set({ balance: 0, outstanding: 150 });
    await expect(bookFleetRide.run(makeReq({ askId: ASK }, HOST))).rejects.toThrow(/Cancellation fees due/);
  });
});
