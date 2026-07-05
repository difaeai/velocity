/**
 * Integration tests for Phase 5 shareable ride links.
 *
 * Critical paths:
 *  - share own trip → doc created; idempotent reuse of an open share
 *  - sharing someone else's trip / without a profile is rejected
 *  - group share posts a ride_share card into the group chat
 *  - eligibility gate: sharer/co-rider, matched partner, group member — and
 *    regular users (no profile) or unmatched users are rejected on booking
 *  - capacity + closed-ride enforcement
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  clearFirestore, seedProfile, seedMatch, makeReq, db,
} from './helpers';
import {
  shareTravelMateRide, getSharedTravelMateRide, bookSharedTravelMateRide,
} from '../shareRide';
import { createTravelMateGroup } from '../groups';
import * as admin from 'firebase-admin';

const SHARER  = 'sharer-uid';
const PARTNER = 'partner-uid';   // matched with SHARER
const STRANGER = 'stranger-uid'; // has a profile, but no match
const REGULAR = 'regular-uid';   // no Travel Mate profile at all

async function seedTrip(tripId: string, passengerId: string, overrides: Record<string, unknown> = {}) {
  await db().doc(`trips/${tripId}`).set({
    passengerId,
    status: 'requested',
    rideType: 'car',
    offeredFare: 500,
    pickup: { lat: 33.7, lng: 73.0, address: 'F-7 Markaz' },
    dropoff: { lat: 33.65, lng: 73.1, address: 'Blue Area' },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    ...overrides,
  });
}

beforeEach(async () => {
  await clearFirestore();
  await seedProfile(SHARER);
  await seedProfile(PARTNER);
  await seedProfile(STRANGER);
  await seedMatch(SHARER, PARTNER);
  await seedTrip('trip-1', SHARER);
});

describe('shareTravelMateRide', () => {
  it('creates a shared ride from own trip and reuses it on repeat', async () => {
    const first = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    expect(first.shareId).toBeTruthy();
    expect(first.reused).toBe(false);

    const doc = (await db().doc(`travelMateSharedRides/${first.shareId}`).get()).data()!;
    expect(doc.sharerUid).toBe(SHARER);
    expect(doc.coRiders).toEqual([SHARER]);
    expect(doc.pickup.address).toBe('F-7 Markaz');
    expect(doc.status).toBe('open');

    const second = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    expect(second.shareId).toBe(first.shareId);
    expect(second.reused).toBe(true);
  });

  it('rejects sharing someone else\'s trip', async () => {
    await expect(shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, PARTNER)))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects users without a Travel Mate profile', async () => {
    await seedTrip('trip-r', REGULAR);
    await expect(shareTravelMateRide.run(makeReq({ tripId: 'trip-r' }, REGULAR)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects completed/cancelled trips', async () => {
    await seedTrip('trip-done', SHARER, { status: 'completed' });
    await expect(shareTravelMateRide.run(makeReq({ tripId: 'trip-done' }, SHARER)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('group share posts a ride_share card into the group chat', async () => {
    const { groupId } = await createTravelMateGroup.run(makeReq({}, SHARER));
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1', groupId }, SHARER));

    const msgs = await db().collection(`travelMateGroups/${groupId}/messages`).get();
    expect(msgs.size).toBe(1);
    const msg = msgs.docs[0].data();
    expect(msg.type).toBe('ride_share');
    expect(msg.shareId).toBe(shareId);
    expect(msg.senderId).toBe(SHARER);
  });
});

describe('getSharedTravelMateRide eligibility', () => {
  it('matched partner is eligible; stranger and regular user are not', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));

    const partner = await getSharedTravelMateRide.run(makeReq({ shareId }, PARTNER));
    expect(partner.eligible).toBe(true);

    const stranger = await getSharedTravelMateRide.run(makeReq({ shareId }, STRANGER));
    expect(stranger.eligible).toBe(false);
    expect((stranger as { reason: string }).reason).toBe('not_partner');

    const regular = await getSharedTravelMateRide.run(makeReq({ shareId }, REGULAR));
    expect(regular.eligible).toBe(false);
    expect((regular as { reason: string }).reason).toBe('no_profile');
  });

  it('only riders already on the ride see the underlying tripId', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));

    const asSharer = await getSharedTravelMateRide.run(makeReq({ shareId }, SHARER));
    expect(asSharer.ride.tripId).toBe('trip-1');

    const asPartner = await getSharedTravelMateRide.run(makeReq({ shareId }, PARTNER));
    expect(asPartner.ride.tripId).toBeNull();
  });

  it('unmatched (closed) match does not grant eligibility', async () => {
    await seedMatch(SHARER, STRANGER, 'unmatched');
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    const res = await getSharedTravelMateRide.run(makeReq({ shareId }, STRANGER));
    expect(res.eligible).toBe(false);
  });
});

describe('bookSharedTravelMateRide', () => {
  it('matched partner books onto the ride; repeat call is idempotent', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));

    const res = await bookSharedTravelMateRide.run(makeReq({ shareId }, PARTNER));
    expect(res.booked).toBe(true);
    expect(res.alreadyJoined).toBe(false);
    expect(res.tripId).toBe('trip-1');

    const doc = (await db().doc(`travelMateSharedRides/${shareId}`).get()).data()!;
    expect(doc.coRiders).toEqual([SHARER, PARTNER]);
    expect(doc.coRiderInfo[PARTNER].displayName).toBe(`User ${PARTNER}`);

    const again = await bookSharedTravelMateRide.run(makeReq({ shareId }, PARTNER));
    expect(again.alreadyJoined).toBe(true);
  });

  it('regular user (no profile) is rejected with no_profile', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    try {
      await bookSharedTravelMateRide.run(makeReq({ shareId }, REGULAR));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpsError).code).toBe('failed-precondition');
      expect(((e as HttpsError).details as { reason: string }).reason).toBe('no_profile');
    }
  });

  it('travel mate who is not a partner of the sharer is rejected', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    try {
      await bookSharedTravelMateRide.run(makeReq({ shareId }, STRANGER));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as HttpsError).code).toBe('permission-denied');
      expect(((e as HttpsError).details as { reason: string }).reason).toBe('not_partner');
    }
  });

  it('fellow group member can book even without a direct match', async () => {
    const { groupId } = await createTravelMateGroup.run(makeReq({}, SHARER));
    // STRANGER is in the group but not matched with SHARER.
    await db().doc(`travelMateGroups/${groupId}`).update({
      members: admin.firestore.FieldValue.arrayUnion(STRANGER),
    });
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1', groupId }, SHARER));

    const res = await bookSharedTravelMateRide.run(makeReq({ shareId }, STRANGER));
    expect(res.booked).toBe(true);
  });

  it('enforces capacity', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    await db().doc(`travelMateSharedRides/${shareId}`).update({ maxCoRiders: 1 });
    await expect(bookSharedTravelMateRide.run(makeReq({ shareId }, PARTNER)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('rejects closed rides', async () => {
    const { shareId } = await shareTravelMateRide.run(makeReq({ tripId: 'trip-1' }, SHARER));
    await db().doc(`travelMateSharedRides/${shareId}`).update({ status: 'closed' });
    await expect(bookSharedTravelMateRide.run(makeReq({ shareId }, PARTNER)))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
