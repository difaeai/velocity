/**
 * A trip left in_progress used to lock its rider out of booking for good:
 * cancelTrip refuses in_progress, and createTrip refuses while it is live.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { adminForceEndTrip, forceEndTrip, STUCK_AFTER_MS } from '../stuckTrips';

const RIDER = 'stuck-rider';
const CO_RIDER = 'stuck-co-rider';
const DRIVER = 'stuck-driver';
const TRIP = 'stuck-trip';

function asAdmin<T>(data: T) {
  const req = makeReq(data, 'desk-admin');
  (req.auth!.token as unknown as Record<string, unknown>).role = 'admin';
  return req;
}

async function seedTrip(startedAgoMs: number, status = 'in_progress') {
  await db().doc(`trips/${TRIP}`).set({
    status,
    passengerId: RIDER,
    driverId: DRIVER,
    poolMembers: [RIDER, CO_RIDER],
    walletHold: 300,
    startedAt: admin.firestore.Timestamp.fromMillis(Date.now() - startedAgoMs),
  });
  await db().doc(`users/${RIDER}`).set({ activeTripId: TRIP });
  await db().doc(`users/${CO_RIDER}`).set({ activeTripId: TRIP });
  await db().doc(`drivers/${DRIVER}`).set({ activeTripId: TRIP });
  await db().doc(`wallets/${RIDER}`).set({ balance: 0 });
}

const isStuck = (t: FirebaseFirestore.DocumentSnapshot) =>
  Date.now() - (t.get('startedAt') as FirebaseFirestore.Timestamp).toMillis() > STUCK_AFTER_MS;

beforeEach(clearFirestore);

describe('forceEndTrip', () => {
  it('closes a trip stuck in progress and frees everyone it held', async () => {
    await seedTrip(STUCK_AFTER_MS + 60_000);
    expect(await forceEndTrip(TRIP, { uid: 'system', role: 'system' }, 'stuck_in_progress', isStuck)).toBe(true);

    const trip = await db().doc(`trips/${TRIP}`).get();
    expect(trip.get('status')).toBe('cancelled');
    expect(trip.get('cancelledFrom')).toBe('in_progress');
    for (const uid of [RIDER, CO_RIDER]) {
      expect((await db().doc(`users/${uid}`).get()).get('activeTripId')).toBeNull();
    }
    expect((await db().doc(`drivers/${DRIVER}`).get()).get('activeTripId')).toBeNull();
    expect((await db().doc(`wallets/${RIDER}`).get()).get('balance')).toBe(300);
  });

  it('leaves a long ride that is still within the day alone', async () => {
    await seedTrip(STUCK_AFTER_MS - 60_000);
    expect(await forceEndTrip(TRIP, { uid: 'system', role: 'system' }, 'stuck_in_progress', isStuck)).toBe(false);
    expect((await db().doc(`trips/${TRIP}`).get()).get('status')).toBe('in_progress');
  });
});

describe('adminForceEndTrip', () => {
  it('lets the desk end a live trip at once, and refuses a finished one', async () => {
    await seedTrip(60_000);
    await adminForceEndTrip.run(asAdmin({ tripId: TRIP, reason: 'Driver phone died mid-ride' }));
    expect((await db().doc(`trips/${TRIP}`).get()).get('cancelledByRole')).toBe('admin');

    await expect(
      adminForceEndTrip.run(asAdmin({ tripId: TRIP, reason: 'again' })),
    ).rejects.toThrow(/not live/);
  });

  it('is admin-only', async () => {
    await seedTrip(60_000);
    await expect(
      adminForceEndTrip.run(makeReq({ tripId: TRIP, reason: 'let me out' }, RIDER)),
    ).rejects.toThrow();
  });
});
