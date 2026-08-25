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
import { sendToUser, sendToUsers } from '../lib/fcm';
import { TripStatus } from '../domain/types';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { ACTIVE_STATUSES, haversineKm } from './index';
import { firstNameOf, joinerRosterEntry, rosterForTrip } from './poolRoster';

/**
 * When a pool may be offered to a stranger.
 * ---------------------------------------------------------------------------
 * NOT while it is `requested`. A requested pool is a wish: the host has named a
 * price and is still haggling with drivers, and nothing about it is settled —
 * the fare can still move, no driver has agreed to carry anyone, and the host
 * may cancel it or have it expire out from under them. Letting a second rider
 * join at that point sold them a seat in a car that did not exist, and tied
 * their `activeTripId` to a trip that could evaporate.
 *
 * `matched` is the first status where BOTH sides have agreed: a driver bid, and
 * the host accepted it (see `acceptBid`). From there until the car departs the
 * ride is real, the fare is locked, and a seat in it is a seat worth selling.
 * ---------------------------------------------------------------------------
 */
const JOINABLE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'matched',
  'arriving',
  'arrived',
]);

/**
 * A pool still waiting on a driver. Nobody may join one, but the host can still
 * change its visibility — those are the minutes they are deciding whether to
 * make the ride public at all.
 */
const AWAITING_DRIVER: TripStatus = 'requested';

/** Statuses in which the host may still change their pool's settings. */
const HOST_EDITABLE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  AWAITING_DRIVER,
  ...JOINABLE_STATUSES,
]);

/** Said to anyone who reaches a pool that has not found its driver yet. */
const AWAITING_DRIVER_MESSAGE =
  'This shared ride is still agreeing a fare with a driver. You can join as soon '
  + 'as a driver is confirmed — try again in a minute.';

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
  const driver   = snap.get('driverInfo') as
    | { displayName?: string; vehicleLabel?: string; plate?: string; rating?: number }
    | undefined;

  // Deciding whether to get in this particular car is the whole job of this
  // screen, so it answers the two questions riders actually ask before they
  // tap Join: who else is aboard, and who is driving. Names are first names —
  // the roster is deliberately not a directory of the people in the car.
  const companions = rosterForTrip(snap.data() ?? {})
    .filter((r) => r.uid !== ctx.uid)
    .map((r) => ({ firstName: r.firstName, gender: r.gender, kind: r.kind }));

  const awaitingDriver = status === AWAITING_DRIVER;

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
    companions,
    maxRiders,
    seatsLeft:  Math.max(0, maxRiders - members.length),
    perSeatFareNow:       poolPerSeatFare(soloFare, members.length),
    perSeatFareIfYouJoin: poolPerSeatFare(soloFare, members.length + 1),
    joinable: JOINABLE_STATUSES.has(status) && members.length < maxRiders && !alreadyJoined,
    /**
     * The ride is real but has not settled with a driver yet, so it cannot be
     * joined *yet* — a different thing from a full or departed ride, and the
     * join screen says so rather than showing a dead end.
     */
    awaitingDriver,
    /** Who is driving, once there is one. Null while the fare is still open. */
    driverName:    driver?.displayName  ?? null,
    driverVehicle: driver?.vehicleLabel ?? null,
    driverPlate:   driver?.plate        ?? null,
    driverRating:  typeof driver?.rating === 'number' ? driver.rating : null,
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
        driverId: (snap.get('driverId') as string | null) ?? null,
        alreadyJoined: true,
      };
    }
    if (status === AWAITING_DRIVER) {
      // Not a failure of this ride — it just is not ready to be shared yet.
      throw new HttpsError('failed-precondition', AWAITING_DRIVER_MESSAGE);
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

    // Write them into the roster as well as the member list. The uid alone told
    // nobody anything: the driver could not name the person they were picking
    // up or say what to collect from them, and the riders already in the car
    // were never told a stranger had been added to it.
    const roster = rosterForTrip(snap.data() ?? {});
    const newRoster = [
      ...roster,
      joinerRosterEntry({
        uid: ctx.uid,
        name: (userSnap.get('name') as string | undefined)
          ?? (userSnap.get('displayName') as string | undefined),
        gender: joinerGender,
        pickup: snap.get('pickup'),
        dropoff: snap.get('dropoff'),
      }),
    ];

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
        poolRoster: newRoster,
        seats: newMembers.length,
        poolPerSeatFare: perSeatFare,
        ...(genderBump ? { poolGenders: genderBump } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // No openRequests mirror to keep in sync: a join is only possible from
    // `matched` onwards, and acceptBid deletes that document when it matches.
    tx.set(db.doc(`users/${ctx.uid}`), { activeTripId: tripRef.id }, { merge: true });

    return {
      tripId: tripRef.id,
      riders: newMembers.length,
      perSeatFare,
      members: newMembers,
      driverId: (snap.get('driverId') as string | null) ?? null,
      alreadyJoined: false,
    };
  });

  if (!result.alreadyJoined) {
    const joinerSnap = await db.doc(`users/${ctx.uid}`).get();
    // Same lookup order the roster uses, so the push and the passenger list
    // never disagree about what this person is called.
    const joinerName = (joinerSnap.get('name') as string | undefined)
      ?? (joinerSnap.get('displayName') as string | undefined)
      ?? 'A rider';
    await sendToUsers(
      result.members.filter((m) => m !== ctx.uid),
      `👤 ${firstNameOf(joinerName)} is sharing your ride`,
      `${result.riders} riders in the car now — everyone pays PKR ${result.perSeatFare} each.`,
      { tripId: result.tripId },
    );
    // The driver has to pick this person up and collect from them, so they are
    // told by name too — they used to find out by counting heads at the kerb.
    if (result.driverId) {
      await sendToUser(
        result.driverId,
        `👤 ${firstNameOf(joinerName)} joined your shared ride`,
        `${result.riders} passengers now — PKR ${result.perSeatFare} from each.`,
        { tripId: result.tripId },
      );
    }
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
    // Wider than JOINABLE on purpose: a pool waiting on a driver cannot be
    // joined, but the host is still allowed to decide whether it will be
    // public once it is.
    if (!HOST_EDITABLE_STATUSES.has(status)) {
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
  // The rider picks how far they're willing to walk/wait for a pool, so the
  // radius is theirs to set — 25 km is the ceiling (a whole metro area).
  radiusKm: z.number().min(0.5).max(25).default(5),
  // Optional destination gate: when the rider is searching for a pool heading
  // their way, only surface pools whose drop-off lands within destRadiusKm of
  // the point they typed. Omit all three and it's plain "pools near me".
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  destRadiusKm: z.number().min(0.5).max(25).default(5),
});

/** Exactly the statuses a stranger may be offered a seat in. See JOINABLE_STATUSES. */
const MATCHED_JOINABLE: TripStatus[] = ['matched', 'arriving', 'arrived'];

/** One row of the discovery feed. Carries areas and counts, never identities. */
interface PoolFeedRow {
  code: string;
  pickupAddress: string;
  dropoffAddress: string;
  rideType: string;
  riders: number;
  males: number;
  females: number;
  seatsLeft: number;
  perSeatFareIfYouJoin: number;
  distanceKm: number;
  /**
   * Always true now — a pool without a confirmed driver is not in this feed at
   * all. Kept so an older install still renders "driver on the way".
   */
  hasDriver: boolean;
  /** Who is driving, so the rider is choosing a car and not just a price. */
  driverName: string | null;
  driverVehicle: string | null;
  /** First names of the people already aboard. Never full names, never uids. */
  companions: { firstName: string; gender: string }[];
  /** Where the ride is in its journey, for "picking up now" vs "on the way". */
  status: TripStatus;
}

/**
 * Public pool trips near the caller that still have seats — shown at the top of
 * the booking screen so a rider sees the cheaper option before they price their
 * own ride.
 *
 * With destLat/destLng the feed narrows to pools going the rider's way: the
 * pickup must be within radiusKm of the rider and the drop-off within
 * destRadiusKm of where they want to go.
 *
 * ONLY CONFIRMED RIDES APPEAR HERE. The feed used to include `openRequests` —
 * pools whose host was still haggling with drivers — which meant a rider could
 * be shown a seat, tap Join, and be attached to a ride nobody had agreed to
 * drive: the fare could still move under them, and the whole thing could expire
 * or be cancelled while they waited. A pool enters this feed at `matched`, when
 * the driver has bid and the host has accepted, and leaves it when the car
 * departs. Everything in this list is a real car with a real driver and a
 * settled price.
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

  const pools: PoolFeedRow[] = [];
  const seenCodes = new Set<string>();

  /**
   * Gate one candidate pool and, if it passes, shape it into a feed row.
   * Never exposes rider identities — only areas, counts, seats and fare.
   */
  const consider = (
    docId: string,
    d: FirebaseFirestore.DocumentData,
    riders: number,
    soloFare: number,
    hasDriver: boolean,
  ) => {
    if (docId === ownTripId) return;
    if ((d.poolVisibility ?? 'public') !== 'public') return;
    const code = d.shareCode as string | undefined;
    if (!code || seenCodes.has(code)) return; // legacy pools have no invite code
    if (riders >= MAX_POOL_RIDERS) return;
    if (!(soloFare > 0)) return;

    const pLat = d.pickup?.lat as number | undefined;
    const pLng = d.pickup?.lng as number | undefined;
    if (typeof pLat !== 'number' || typeof pLng !== 'number') return;
    const distanceKm = haversineKm(lat, lng, pLat, pLng);
    if (distanceKm > radiusKm) return;

    // When searching by destination, drop pools that aren't heading there.
    if (filterByDest) {
      const dLat = d.dropoff?.lat as number | undefined;
      const dLng = d.dropoff?.lng as number | undefined;
      if (typeof dLat !== 'number' || typeof dLng !== 'number') return;
      if (haversineKm(destLat, destLng, dLat, dLng) > destRadiusKm) return;
    }

    const genders = (d.poolGenders as { male?: number; female?: number } | undefined) ?? {};
    const driver = d.driverInfo as { displayName?: string; vehicleLabel?: string } | undefined;

    seenCodes.add(code);
    pools.push({
      code,
      pickupAddress:  d.pickup?.address ?? 'Nearby',
      dropoffAddress: d.dropoff?.address ?? 'Destination',
      rideType: d.rideType as string,
      riders,
      males:   genders.male   ?? 0,
      females: genders.female ?? 0,
      seatsLeft: MAX_POOL_RIDERS - riders,
      perSeatFareIfYouJoin: poolPerSeatFare(soloFare, riders + 1),
      distanceKm: Math.round(distanceKm * 10) / 10,
      hasDriver,
      driverName:    driver?.displayName  ?? null,
      driverVehicle: driver?.vehicleLabel ?? null,
      // First names only. Enough to know a car has two women and a man in it
      // and decide whether to get in; not enough to identify anybody.
      companions: rosterForTrip(d)
        .filter((r) => r.uid !== ctx.uid)
        .map((r) => ({ firstName: r.firstName, gender: r.gender })),
      status: (d.status as TripStatus) ?? 'matched',
    });
  };

  // One source, deliberately: trips that a driver has already agreed to carry.
  // Best-effort — if the composite index is missing, discovery comes back empty
  // rather than falling back to unconfirmed requests.
  try {
    const matchedSnap = await db.collection('trips')
      .where('pool', '==', true)
      .where('status', 'in', MATCHED_JOINABLE)
      .limit(100)
      .get();
    for (const doc of matchedSnap.docs) {
      const d = doc.data();
      const members = (d.poolMembers as string[] | undefined) ?? [d.passengerId as string];
      const soloFare = (d.fare as number | null) ?? (d.offeredFare as number);
      consider(doc.id, d, members.length, soloFare, true);
    }
  } catch (err) {
    logger.warn('getNearbyPublicPoolTrips: matched-pool scan failed', err);
  }

  pools.sort((a, b) => a.distanceKm - b.distanceKm);
  return { pools: pools.slice(0, 20) };
});
