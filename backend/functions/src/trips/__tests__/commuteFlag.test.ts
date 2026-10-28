/**
 * A ride booked from home's "Corporate, Students & daily travel" screen carries
 * `commute: true` on the trip AND on the driver feed (openRequests), which is
 * what boxes it in yellow and hides it from drivers on "Regular". An ordinary
 * booking carries no such field.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../index';

const RIDER = 'commute-rider';

const TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'male' as const,
  pool: true,
  paymentMethod: 'cash' as const,
  pickup: { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' },
  dropoff: { lat: 33.6672, lng: 73.0726, address: 'D Watson, I-8 Markaz, Islamabad' },
};

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${RIDER}`).set({ name: 'Sana Ali', gender: 'female' });
});

describe('createTrip commute flag', () => {
  it('lands on the trip and the open request', async () => {
    const { tripId } = (await createTrip.run(makeReq({ ...TRIP, commute: true }, RIDER))) as { tripId: string };
    expect((await db().doc(`trips/${tripId}`).get()).get('commute')).toBe(true);
    expect((await db().doc(`openRequests/${tripId}`).get()).get('commute')).toBe(true);
  });

  it('is absent on an ordinary booking', async () => {
    const { tripId } = (await createTrip.run(makeReq(TRIP, RIDER))) as { tripId: string };
    expect((await db().doc(`trips/${tripId}`).get()).get('commute')).toBeUndefined();
    expect((await db().doc(`openRequests/${tripId}`).get()).get('commute')).toBeUndefined();
  });
});
