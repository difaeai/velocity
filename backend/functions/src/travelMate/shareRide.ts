/**
 * Velocity — Travel Mate — Phase 5 shareable ride links (callable, v2)
 * ----------------------------------------------------------------------------
 * shareTravelMateRide     — a passenger with a Travel Mate profile turns one of
 *                           their trips into a shareable ride. Optionally tied
 *                           to a commute group, in which case a ride card is
 *                           posted into the group chat so every member sees it.
 * getSharedTravelMateRide — resolve a share link: ride snapshot + whether the
 *                           caller is eligible to book (travel partner of the
 *                           sharer or fellow group member).
 * bookSharedTravelMateRide — join the shared ride as a co-rider. Regular users
 *                           (no Travel Mate profile) and non-partners are
 *                           rejected with a reason the app can act on.
 *
 * Identity wall: reads the sharer's own trip once to snapshot the route; all
 * writes stay inside travelMate* collections. The driver sees nothing new.
 *
 * Wire-up:
 *   export { shareTravelMateRide, getSharedTravelMateRide, bookSharedTravelMateRide }
 *     from './travelMate/shareRide';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

function pairId(a: string, b: string): string { return [a, b].sort().join('_'); }

async function areMatched(a: string, b: string): Promise<boolean> {
  const snap = await db.doc(`travelMateMatches/${pairId(a, b)}`).get();
  return snap.exists && (snap.data()!.status ?? 'active') === 'active';
}

async function isGroupMember(groupId: string, uid: string): Promise<boolean> {
  const snap = await db.doc(`travelMateGroups/${groupId}`).get();
  return snap.exists && ((snap.data()!.members ?? []) as string[]).includes(uid);
}

interface MemberInfo { displayName: string; photoURL: string | null }

async function requireProfile(uid: string): Promise<MemberInfo> {
  const snap = await db.doc(`travelMateProfiles/${uid}`).get();
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'Travel Mate profile required.', { reason: 'no_profile' });
  }
  const p = snap.data()!;
  return { displayName: p.displayName ?? 'Travel Mate', photoURL: p.photoURL ?? null };
}

// ---------------------------------------------------------------------------
// groupId is nullish, not optional: the mobile Firebase SDK encodes absent
// optional fields as null on the wire, which plain .optional() rejects.
const ShareInput = z.object({
  tripId: z.string().min(1).max(128),
  groupId: z.string().min(1).max(128).nullish(),
});

export const shareTravelMateRide = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = ShareInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid share request.');
  const { tripId, groupId } = parsed.data;

  const me = await requireProfile(uid);

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) throw new HttpsError('not-found', 'Trip not found.');
  const trip = tripSnap.data()!;
  if (trip.passengerId !== uid) throw new HttpsError('permission-denied', 'You can only share your own ride.');
  if (trip.status === 'cancelled' || trip.status === 'completed') {
    throw new HttpsError('failed-precondition', 'This ride is no longer active.');
  }

  if (groupId && !(await isGroupMember(groupId, uid))) {
    throw new HttpsError('permission-denied', 'You are not a member of this group.');
  }

  // Idempotent: reuse an existing open share for the same trip by the same user.
  const existing = await db.collection('travelMateSharedRides')
    .where('tripId', '==', tripId)
    .where('sharerUid', '==', uid)
    .where('status', '==', 'open')
    .limit(1)
    .get();
  if (!existing.empty) return { shareId: existing.docs[0].id, reused: true };

  const settings = (await db.doc('config/travelMateSettings').get()).data() || {};
  const maxCoRiders: number = settings.maxGroupSize ?? 4;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = db.collection('travelMateSharedRides').doc();
  await ref.set({
    tripId,
    groupId: groupId ?? null,
    sharerUid: uid,
    sharerInfo: me,
    pickup: {
      lat: trip.pickup?.lat ?? null,
      lng: trip.pickup?.lng ?? null,
      address: trip.pickup?.address ?? '',
    },
    dropoff: {
      lat: trip.dropoff?.lat ?? null,
      lng: trip.dropoff?.lng ?? null,
      address: trip.dropoff?.address ?? '',
    },
    rideType: trip.rideType ?? null,
    fare: trip.fare ?? trip.offeredFare ?? null,
    coRiders: [uid],
    coRiderInfo: { [uid]: me },
    maxCoRiders,
    status: 'open',
    createdAt: now,
  });

  // Announce in the group chat so every member can open + book with one tap.
  if (groupId) {
    const groupRef = db.doc(`travelMateGroups/${groupId}`);
    const batch = db.batch();
    batch.set(groupRef.collection('messages').doc(), {
      senderId: uid,
      senderName: me.displayName,
      senderPhoto: me.photoURL,
      type: 'ride_share',
      shareId: ref.id,
      text: `${me.displayName} shared a ride: ${trip.pickup?.address ?? 'pickup'} → ${trip.dropoff?.address ?? 'destination'}`,
      createdAt: now,
    });
    batch.update(groupRef, { lastMessage: '🚗 Shared a ride', lastMessageAt: now });
    await batch.commit();
  }

  return { shareId: ref.id, reused: false };
});

// ---------------------------------------------------------------------------
const ShareIdInput = z.object({ shareId: z.string().min(1).max(128) });

type Eligibility =
  | { eligible: true; alreadyJoined: boolean }
  | { eligible: false; reason: 'no_profile' | 'not_partner' };

async function checkEligibility(
  uid: string,
  ride: FirebaseFirestore.DocumentData,
): Promise<Eligibility> {
  const coRiders: string[] = ride.coRiders ?? [];
  if (uid === ride.sharerUid || coRiders.includes(uid)) {
    return { eligible: true, alreadyJoined: true };
  }
  const profSnap = await db.doc(`travelMateProfiles/${uid}`).get();
  if (!profSnap.exists) return { eligible: false, reason: 'no_profile' };
  if (await areMatched(uid, ride.sharerUid)) return { eligible: true, alreadyJoined: false };
  if (ride.groupId && (await isGroupMember(ride.groupId, uid))) {
    return { eligible: true, alreadyJoined: false };
  }
  return { eligible: false, reason: 'not_partner' };
}

export const getSharedTravelMateRide = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = ShareIdInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const snap = await db.doc(`travelMateSharedRides/${parsed.data.shareId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'This ride link is invalid or expired.');
  const ride = snap.data()!;

  const eligibility = await checkEligibility(uid, ride);

  return {
    ride: {
      sharerUid: ride.sharerUid,
      sharerInfo: ride.sharerInfo,
      pickupAddress: ride.pickup?.address ?? '',
      dropoffAddress: ride.dropoff?.address ?? '',
      rideType: ride.rideType,
      fare: ride.fare,
      status: ride.status,
      groupId: ride.groupId,
      coRiderCount: (ride.coRiders ?? []).length,
      maxCoRiders: ride.maxCoRiders ?? 4,
      coRiderNames: Object.values(
        (ride.coRiderInfo ?? {}) as Record<string, MemberInfo>,
      ).map((m) => m.displayName),
      // The underlying trip is only revealed to people already on the ride.
      tripId: eligibility.eligible && eligibility.alreadyJoined ? ride.tripId : null,
    },
    ...eligibility,
  };
});

// ---------------------------------------------------------------------------
export const bookSharedTravelMateRide = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const parsed = ShareIdInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const rideRef = db.doc(`travelMateSharedRides/${parsed.data.shareId}`);

  const preSnap = await rideRef.get();
  if (!preSnap.exists) throw new HttpsError('not-found', 'This ride link is invalid or expired.');
  const pre = preSnap.data()!;

  const eligibility = await checkEligibility(uid, pre);
  if (!eligibility.eligible) {
    if (eligibility.reason === 'no_profile') {
      throw new HttpsError(
        'failed-precondition',
        'This ride link is for Travel Mates only. Set up your Travel Mate profile and match with the sharer to book.',
        { reason: 'no_profile' },
      );
    }
    throw new HttpsError(
      'permission-denied',
      `Only ${pre.sharerInfo?.displayName ?? 'the sharer'}'s travel partners can book this ride. Find them in Travel Mate and match first.`,
      { reason: 'not_partner' },
    );
  }
  if (eligibility.alreadyJoined) return { booked: true, alreadyJoined: true, tripId: pre.tripId };

  const me = await requireProfile(uid);

  const tripId = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) throw new HttpsError('not-found', 'This ride link is invalid or expired.');
    const ride = snap.data()!;
    if (ride.status !== 'open') throw new HttpsError('failed-precondition', 'This ride is no longer open.');
    const coRiders: string[] = ride.coRiders ?? [];
    if (coRiders.includes(uid)) return ride.tripId as string;
    if (coRiders.length >= (ride.maxCoRiders ?? 4)) {
      throw new HttpsError('failed-precondition', 'This ride is full.');
    }
    tx.update(rideRef, {
      coRiders: admin.firestore.FieldValue.arrayUnion(uid),
      [`coRiderInfo.${uid}`]: me,
    });
    return ride.tripId as string;
  });

  return { booked: true, alreadyJoined: false, tripId };
});
