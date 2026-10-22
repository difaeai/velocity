/**
 * A ban used to write `users.banned` and nothing read it. Now the Auth account
 * is disabled (so it cannot sign in or refresh a token) and booking refuses the
 * flag immediately, for the hour the current token still has.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { banPassenger } from '../index';
import { createTrip } from '../../trips';

const RIDER = 'banned-rider';

function asAdmin<T>(data: T) {
  const req = makeReq(data, 'desk-admin');
  (req.auth!.token as unknown as Record<string, unknown>).role = 'admin';
  return req;
}

const TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'unspecified' as const,
  paymentMethod: 'cash' as const,
  pickup: { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' },
  dropoff: { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' },
};

beforeEach(async () => {
  await clearFirestore();
  await admin.auth().deleteUser(RIDER).catch(() => undefined);
  await admin.auth().createUser({ uid: RIDER });
  await db().doc(`users/${RIDER}`).set({ name: 'Rider' });
});

describe('banPassenger', () => {
  it('disables the account and stops it booking; unbanning restores both', async () => {
    await banPassenger.run(asAdmin({ passengerId: RIDER, banned: true }));
    expect((await admin.auth().getUser(RIDER)).disabled).toBe(true);
    await expect(createTrip.run(makeReq(TRIP, RIDER))).rejects.toThrow(/cannot book rides/);

    await banPassenger.run(asAdmin({ passengerId: RIDER, banned: false }));
    expect((await admin.auth().getUser(RIDER)).disabled).toBe(false);
    await expect(createTrip.run(makeReq(TRIP, RIDER))).resolves.toBeTruthy();
  });

  it('still bans an account whose Auth user is already gone', async () => {
    await admin.auth().deleteUser(RIDER);
    await expect(banPassenger.run(asAdmin({ passengerId: RIDER, banned: true }))).resolves.toEqual({ ok: true });
  });
});
