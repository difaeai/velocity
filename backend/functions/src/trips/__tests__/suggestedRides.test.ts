/**
 * The one "rides going your way" feed the booking screen reads (getSuggestedRides)
 * must not offer a seat the car's gender rules would refuse — every join call
 * enforces them, so such a row could only ever end in a failed Join.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../index';
import { joinPoolTrip } from '../poolShare';
import { getSuggestedRides } from '../suggestedRides';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

async function womensPool(): Promise<void> {
  const res = (await createTrip.run(
    makeReq(
      {
        rideType: 'mini' as const,
        offeredFare: 400,
        seats: 1,
        passengerGender: 'female' as const,
        pool: true,
        paymentMethod: 'cash' as const,
        pickup: PICKUP,
        dropoff: DROPOFF,
      },
      'sr-host',
    ),
  )) as { shareCode: string };
  await joinPoolTrip.run(makeReq({ code: res.shareCode }, 'sr-second'));
}

const feedFor = async (uid: string) =>
  ((await getSuggestedRides.run(
    makeReq({ lat: PICKUP.lat, lng: PICKUP.lng, radiusKm: 5 }, uid),
  )) as { rides: { kind: string }[] }).rides.filter((r) => r.kind === 'trip');

beforeEach(async () => {
  await clearFirestore();
  await db().doc('users/sr-host').set({ displayName: 'Ayesha', gender: 'female' });
  await db().doc('users/sr-second').set({ displayName: 'Sana', gender: 'female' });
  await db().doc('users/sr-man').set({ displayName: 'Hamza', gender: 'male', mixedRideOk: true });
  await db().doc('users/sr-woman').set({ displayName: 'Zara', gender: 'female' });
});

describe('getSuggestedRides and the gender rules', () => {
  it('never offers a car of two women to a man', async () => {
    await womensPool();
    expect(await feedFor('sr-man')).toHaveLength(0);
  });

  it('still offers it to a woman', async () => {
    await womensPool();
    expect(await feedFor('sr-woman')).toHaveLength(1);
  });
});
