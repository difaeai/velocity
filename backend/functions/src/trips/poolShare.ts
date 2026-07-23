/**
 * Pool ride share links — invite codes on booking-flow pool trips.
 * ----------------------------------------------------------------------------
 * Every pool trip created by createTrip gets a short share code (stored on the
 * trip and mirrored in poolShareCodes/{code}). The https share link opens the
 * pool-join screen in the app, which resolves the code here.
 *
 *  getPoolTripByCode      — resolve an invite code into a join-screen snapshot.
 *  joinPoolTrip           — join the pool; recomputes everyone's per-seat fare.
 *  setPoolVisibility      — host flips the ride between public and private.
 *  getNearbyPublicPoolTrips — public pools near the caller (private rides are
 *                             only reachable through their link).
 *
 * Visibility: 'public' pools appear in nearby discovery for every rider;
 * 'private' pools never do — possession of the link is the credential.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUsers } from '../lib/fcm';
import { TripStatus } from '../domain/types';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { ACTIVE_STATUSES, haversineKm } from './index';

/** Riders can hop on until the car actually departs. */
const JOINABLE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'requested',
  'matched',
  'arriving',
  'arrived',
]);

const codeSchema = z.object({ code: z.string().trim().min(4).max(16) });

async function tripRefByCode(rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const mapSnap = await db.doc(`poolShareCodes/${code}`).get();
  if (!mapSnap.exists) {
    throw new HttpsError('not-found', 'This pool invite is invalid or has expired.');
  }
  return { code, tripRef: db.doc(`trips/${mapSnap.get('tripId') as string}`) };
}

/** Resolve a pool invite code into everything the join screen needs. */
export const getPoolTripByCode = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = codeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid pool code.');
  const { code, tripRef } = await tripRefByCode(parsed.data.code);

  const snap = await tripRef.get();
  if (!snap.exists || snap.get('pool') !== true) {
    throw new HttpsError('not-found', 'This pool ride no longer exists.');
  }

  const status    = snap.get('status') as TripStatus;
  const members   = (snap.get('poolMembers') as string[] | undefined) ?? [snap.get('passengerId') as string];
  const maxRiders = (snap.get('maxPoolRiders') as number | undefined) ?? MAX_POOL_RIDERS;
  const soloFare  = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number);
  const alreadyJoined = members.includes(ctx.uid);

  const hostSnap = await db.doc(`users/${members[0]}`).get();
  const pickup   = snap.get('pickup')  as { address?: string } | undefined;
  const dropoff  = snap.get('dropoff') as { address?: string } | undefined;
  const genders  = (snap.get('poolGenders') as { male?: number; female?: number } | undefined) ?? {};

  return {
    code,
    status,
    pickupAddress:  pickup?.address ?? 'Pickup',
    dropoffAddress: dropoff?.address ?? 'Destination',
    rideType:   snap.get('rideType') as string,
    visibility: (snap.get('poolVisibility') as string | undefined) ?? 'public',
    hostName:   (hostSnap.get('displayName') as string | undefined) ?? 'A Velocity rider',
    riders:     members.length,
    males:      genders.male   ?? 0,
    females:    genders.female ?? 0,
    maxRiders,
    seatsLeft:  Math.max(0, maxRiders - members.length),
    perSeatFareNow:       poolPerSeatFare(soloFare, members.length),
    perSeatFareIfYouJoin: poolPerSeatFare(soloFare, members.length + 1),
    joinable: JOINABLE_STATUSES.has(status) && members.length < maxRiders && !alreadyJoined,
    alreadyJoined,
    // The trip itself is only revealed to people already on the ride.
    tripId: alreadyJoined ? tripRef.id : null,
  };
});

/** Join a pool trip via its invite code. Recomputes the per-seat fare. */
export const joinPoolTrip = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'joinPoolTrip', 10, 60);
  const parsed = codeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid pool code.');
  const { tripRef } = await tripRefByCode(parsed.data.code);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists || snap.get('pool') !== true) {
      throw new HttpsError('not-found', 'This pool ride no longer exists.');
    }
    const status  = snap.get('status') as TripStatus;
    const members = (snap.get('poolMembers') as string[] | undefined) ?? [snap.get('passengerId') as string];
    const maxRiders = (snap.get('maxPoolRiders') as number | undefined) ?? MAX_POOL_RIDERS;
    const soloFare  = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number);

    if (members.includes(ctx.uid)) {
      return {
        tripId: tripRef.id,
        riders: members.length,
        perSeatFare: poolPerSeatFare(soloFare, members.length),
        members,
        alreadyJoined: true,
      };
    }
    if (!JOINABLE_STATUSES.has(status)) {
      throw new HttpsError('failed-precondition', 'This pool ride has already departed or ended.');
    }
    if (members.length >= maxRiders) {
      throw new HttpsError('failed-precondition', 'This pool ride is already full.');
    }

    // A rider on another active trip can't be in two cars at once.
    const userSnap = await tx.get(db.doc(`users/${ctx.uid}`));
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    const joinerGender = userSnap.get('gender') as string | undefined;
    if (activeTripId && activeTripId !== tripRef.id) {
      const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
      if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status') as TripStatus)) {
        throw new HttpsError('failed-precondition', 'You already have an active trip.');
      }
    }

    const newMembers  = [...members, ctx.uid];
    const perSeatFare = poolPerSeatFare(soloFare, newMembers.length);

    // Bump the running gender tally so the nearby feed reflects who's aboard.
    // Merge keeps the existing map and only touches the joiner's bucket.
    const genderBump =
      joinerGender === 'male'   ? { male:   FieldValue.increment(1) } :
      joinerGender === 'female' ? { female: FieldValue.increment(1) } :
      null;

    tx.set(
      tripRef,
      {
        poolMembers: newMembers,
        seats: newMembers.length,
        poolPerSeatFare: perSeatFare,
        ...(genderBump ? { poolGenders: genderBump } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Keep the drivers' feed in sync while the request is still open.
    if (status === 'requested') {
      tx.set(
        db.doc(`openRequests/${tripRef.id}`),
        {
          seats: newMembers.length,
          poolRiders: newMembers.length,
          poolPerSeatFare: perSeatFare,
          ...(genderBump ? { poolGenders: genderBump } : {}),
        },
        { merge: true },
      );
    }
    tx.set(db.doc(`users/${ctx.uid}`), { activeTripId: tripRef.id }, { merge: true });

    return { tripId: tripRef.id, riders: newMembers.length, perSeatFare, members: newMembers, alreadyJoined: false };
  });

  if (!result.alreadyJoined) {
    const joinerSnap = await db.doc(`users/${ctx.uid}`).get();
    const joinerName = (joinerSnap.get('displayName') as string | undefined) ?? 'A rider';
    await sendToUsers(
      result.members.filter((m) => m !== ctx.uid),
      '🎉 New rider joined your pool',
      `${joinerName} joined — everyone now pays PKR ${result.perSeatFare}.`,
      { tripId: result.tripId },
    );
    logger.info('Pool joined', { tripId: result.tripId, joiner: ctx.uid, riders: result.riders });
  }

  return { ok: true, ...result };
});

// ---------------------------------------------------------------------------
const visibilitySchema = z.object({
  tripId: z.string().min(1).max(128),
  visibility: z.enum(['public', 'private']),
});

/** Host flips their pool ride between public (discoverable) and private (link-only). */
export const setPoolVisibility = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = visibilitySchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and visibility.');
  const { tripId, visibility } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists || snap.get('pool') !== true) {
      throw new HttpsError('not-found', 'Pool ride not found.');
    }
    if (snap.get('passengerId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Only the ride host can change visibility.');
    }
    const status = snap.get('status') as TripStatus;
    if (!JOINABLE_STATUSES.has(status)) {
      throw new HttpsError('failed-precondition', 'This ride can no longer be changed.');
    }
    tx.set(tripRef, { poolVisibility: visibility, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    // The openRequests mirror only exists while the request is open — never
    // re-create it here after a match deleted it.
    if (status === 'requested') {
      tx.set(db.doc(`openRequests/${tripId}`), { poolVisibility: visibility }, { merge: true });
    }
  });

  return { ok: true, visibility };
});

// ---------------------------------------------------------------------------
const nearbySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.5).max(15).default(5),
  // Optional destination gate: when the rider is searching for a pool heading
  // their way, only surface pools whose drop-off lands within destRadiusKm of
  // the point they typed. Omit all three and it's plain "pools near me".
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  destRadiusKm: z.number().min(0.5).max(15).default(5),
});

/**
 * Public pool trips near the caller that still have seats — shown on the
 * booking screen so a rider can join an existing pool instead of starting one.
 *
 * With destLat/destLng the feed narrows to pools going the rider's way: the
 * pickup must be within radiusKm of the rider and the drop-off within
 * destRadiusKm of where they want to go.
 */
export const getNearbyPublicPoolTrips = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = nearbySchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid location data.');
  const { lat, lng, radiusKm, destLat, destLng, destRadiusKm } = parsed.data;
  const filterByDest = typeof destLat === 'number' && typeof destLng === 'number';

  // Skip the caller's own open request without exposing passenger ids in the feed.
  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  const ownTripId = userSnap.get('activeTripId') as string | undefined;

  const openSnap = await db.collection('openRequests')
    .where('pool', '==', true)
    .limit(100)
    .get();

  const pools: object[] = [];
  for (const doc of openSnap.docs) {
    const d = doc.data();
    if (doc.id === ownTripId) continue;
    if ((d.poolVisibility ?? 'public') !== 'public') continue;
    if (!d.shareCode) continue; // legacy pool requests without invite codes
    const riders = (d.poolRiders as number | undefined) ?? 1;
    if (riders >= MAX_POOL_RIDERS) continue;
    const pLat = d.pickup?.lat as number | undefined;
    const pLng = d.pickup?.lng as number | undefined;
    if (typeof pLat !== 'number' || typeof pLng !== 'number') continue;
    const distanceKm = haversineKm(lat, lng, pLat, pLng);
    if (distanceKm > radiusKm) continue;

    // When searching by destination, drop pools that aren't heading there.
    if (filterByDest) {
      const dLat = d.dropoff?.lat as number | undefined;
      const dLng = d.dropoff?.lng as number | undefined;
      if (typeof dLat !== 'number' || typeof dLng !== 'number') continue;
      if (haversineKm(destLat, destLng, dLat, dLng) > destRadiusKm) continue;
    }

    const genders = (d.poolGenders as { male?: number; female?: number } | undefined) ?? {};

    pools.push({
      code: d.shareCode as string,
      pickupAddress:  d.pickup?.address ?? 'Nearby',
      dropoffAddress: d.dropoff?.address ?? 'Destination',
      rideType: d.rideType as string,
      riders,
      males:   genders.male   ?? 0,
      females: genders.female ?? 0,
      seatsLeft: MAX_POOL_RIDERS - riders,
      perSeatFareIfYouJoin: poolPerSeatFare(d.offeredFare as number, riders + 1),
      distanceKm: Math.round(distanceKm * 10) / 10,
    });
  }

  pools.sort((a, b) => (a as { distanceKm: number }).distanceKm - (b as { distanceKm: number }).distanceKm);
  return { pools: pools.slice(0, 20) };
});
