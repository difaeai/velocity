/**
 * Pool ride share links — invite codes on booking-flow pool trips.
 * ----------------------------------------------------------------------------
 * Every pool trip created by createTrip gets a short share code (stored on the
 * trip and mirrored in poolShareCodes/{code}). The https share link opens the
 * pool-join screen in the app, which resolves the code here.
 *
 *  getPoolTripByCode      — resolve an invite code into a join-screen snapshot.
 *  joinPoolTrip           — join the pool, or ask its driver for a seat.
 *  driverRespondToPoolJoin — the driver accepts or rejects that request.
 *  cancelPoolTripJoinRequest — the rider withdraws a request nobody answered.
 *  setPoolVisibility      — host flips the ride between public and private.
 *  getNearbyPublicPoolTrips — public pools near the caller (private rides are
 *                             only reachable through their link).
 *
 * Visibility: 'public' pools appear in nearby discovery for every rider;
 * 'private' pools never do — possession of the link is the credential.
 *
 * WHO DECIDES WHAT
 * ----------------
 * The person who STARTED the pool owns the fare: they name the offer, they take
 * or refuse a driver's bid, and they are the only one who can raise it (see
 * `raiseTripFare`). Everyone who joins afterwards takes the pool's per-seat fare
 * as it stands — there is no second negotiation, and no joiner can move a price
 * the host already agreed.
 *
 * The DRIVER owns the car. Before one is confirmed a pool is just riders
 * gathering, so joining is immediate; once a driver has agreed to carry this
 * ride, a new rider is a change to the driver's work and the driver accepts or
 * rejects them.
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
 * When a pool has a driver, so a new rider is the driver's decision.
 * ---------------------------------------------------------------------------
 * `matched` is the first status where both sides have agreed: a driver bid, and
 * the host accepted it (see `acceptBid`). From there until the car departs the
 * ride is real and the fare is locked — but the car now belongs to somebody who
 * agreed to a specific job, so a stranger asking for the fourth seat is a
 * request to that driver rather than something that happens to them.
 * ---------------------------------------------------------------------------
 */
const JOINABLE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'matched',
  'arriving',
  'arrived',
]);

/**
 * A pool that is still gathering riders and has not found a driver yet.
 *
 * This used to be a dead end — nobody could join a `requested` pool, so a rider
 * who started one sat alone until a driver took it, and the people who would
 * have shared it never knew it existed. That is backwards: the whole reason to
 * start a pool is to be found. A pool in this state carries no driver to ask,
 * so joining is immediate, and the extra riders are exactly what makes drivers
 * want the job.
 *
 * The old objection — "the fare could still move under a joiner" — is answered
 * by who is allowed to move it: only the host, and only upward on their own
 * offer to drivers. The per-seat tier a joiner is quoted is a fixed fraction of
 * that offer, and it is recomputed and shown live on their own trip screen.
 */
const AWAITING_DRIVER: TripStatus = 'requested';

/**
 * How long a driverless pool keeps gathering riders.
 *
 * Ten minutes, and the host is told so when they book: it is long enough for
 * somebody on the same road to see the ride and get in, and short enough that a
 * rider is not staring at a screen wondering whether Velocity has forgotten
 * them. After it lapses the pool stops appearing in discovery — the host is
 * still in the driver feed the whole time, so the ride itself keeps looking for
 * a car; it just stops advertising seats it is about to depart with.
 */
export const POOL_JOIN_WINDOW_MS = 10 * 60 * 1000;

/** Statuses in which the host may still change their pool's settings. */
const HOST_EDITABLE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  AWAITING_DRIVER,
  ...JOINABLE_STATUSES,
]);

/** Said to anyone who reaches a pool whose gathering window has run out. */
const WINDOW_CLOSED_MESSAGE =
  'This shared ride has stopped taking new riders while it waits for a driver. '
  + 'Book your own shared ride — riders going your way can join you instead.';

/** Epoch-ms when a pool's 10-minute gathering window ends, or null. */
function joinWindowEndsAt(d: FirebaseFirestore.DocumentData): number | null {
  const created = d.createdAt as { toDate?: () => Date } | undefined;
  const ms = created?.toDate?.()?.getTime();
  return typeof ms === 'number' ? ms + POOL_JOIN_WINDOW_MS : null;
}

/** Is a driverless pool still inside the window in which strangers may join? */
function withinJoinWindow(d: FirebaseFirestore.DocumentData, now = Date.now()): boolean {
  const ends = joinWindowEndsAt(d);
  // A pool whose createdAt has not landed yet (serverTimestamp resolves on the
  // write) is seconds old by definition — treat it as open, never as expired.
  return ends === null || ends > now;
}

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
  const gathering = awaitingDriver && withinJoinWindow(snap.data() ?? {});
  // A request this rider already sent and the driver has not answered. Without
  // it the join screen offers "Join" a second time to somebody who is already
  // in the queue, and a second tap reads as the first one having failed.
  const myRequest = await tripRef.collection('joinRequests').doc(ctx.uid).get();
  const requestStatus = myRequest.exists ? (myRequest.get('status') as string) : null;

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
    joinable:
      (JOINABLE_STATUSES.has(status) || gathering)
      && members.length < maxRiders
      && !alreadyJoined
      && requestStatus !== 'pending',
    /**
     * The ride is real but has not settled with a driver yet. It can still be
     * joined while it is `gathering` — that is the whole point of the window —
     * and the join screen says which of the two it is looking at.
     */
    awaitingDriver,
    /** Still inside the 10-minute window in which strangers may hop in. */
    gathering,
    /** Epoch-ms the gathering window closes, so the screen can count it down. */
    joinWindowEndsAt: awaitingDriver ? joinWindowEndsAt(snap.data() ?? {}) : null,
    /**
     * Where this rider's own request stands: 'pending' while the driver has not
     * answered, 'rejected' if they said no. Null when they never asked.
     */
    requestStatus,
    /**
     * True when tapping Join sends a request to the driver rather than seating
     * the rider outright — everything after a driver has agreed to this ride.
     */
    needsDriverApproval: JOINABLE_STATUSES.has(status),
    /** Who is driving, once there is one. Null while the fare is still open. */
    driverName:    driver?.displayName  ?? null,
    driverVehicle: driver?.vehicleLabel ?? null,
    driverPlate:   driver?.plate        ?? null,
    driverRating:  typeof driver?.rating === 'number' ? driver.rating : null,
    alreadyJoined,
    // The trip itself is only revealed to people already on the ride — and to
    // somebody with a request outstanding on it, who needs the id to withdraw.
    // Neither can read the trip document itself without being a member.
    tripId: alreadyJoined || requestStatus === 'pending' ? tripRef.id : null,
  };
});

/**
 * Seat a rider on a pool inside an open transaction.
 *
 * The one place a stranger is added to a shared car, so the member list, the
 * roster, the gender tally, the per-seat fare and the rider's own activeTripId
 * can never drift apart. Both ways in use it: joining a pool that is still
 * gathering (no driver to ask), and a driver accepting a request on a pool they
 * have already agreed to carry.
 */
async function seatRiderOnPool(
  tx: FirebaseFirestore.Transaction,
  tripRef: FirebaseFirestore.DocumentReference,
  snap: FirebaseFirestore.DocumentSnapshot,
  riderUid: string,
): Promise<{
  tripId: string;
  riders: number;
  perSeatFare: number;
  members: string[];
  driverId: string | null;
}> {
  const members = (snap.get('poolMembers') as string[] | undefined)
    ?? [snap.get('passengerId') as string];
  const maxRiders = (snap.get('maxPoolRiders') as number | undefined) ?? MAX_POOL_RIDERS;
  const soloFare  = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number);

  if (members.includes(riderUid)) {
    throw new HttpsError('already-exists', 'That rider is already on this ride.');
  }
  if (members.length >= maxRiders) {
    throw new HttpsError('failed-precondition', 'This pool ride is already full.');
  }

  // A rider on another active trip can't be in two cars at once.
  const userSnap = await tx.get(db.doc(`users/${riderUid}`));
  const activeTripId = userSnap.get('activeTripId') as string | undefined;
  const joinerGender = userSnap.get('gender') as string | undefined;
  if (activeTripId && activeTripId !== tripRef.id) {
    const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
    if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status') as TripStatus)) {
      throw new HttpsError('failed-precondition', 'That rider already has an active trip.');
    }
  }

  const newMembers  = [...members, riderUid];
  const perSeatFare = poolPerSeatFare(soloFare, newMembers.length);

  // Write them into the roster as well as the member list. The uid alone told
  // nobody anything: the driver could not name the person they were picking
  // up or say what to collect from them, and the riders already in the car
  // were never told a stranger had been added to it.
  const roster = rosterForTrip(snap.data() ?? {});
  const newRoster = [
    ...roster,
    joinerRosterEntry({
      uid: riderUid,
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
  // While a pool is still gathering, its openRequests mirror is what drivers
  // browse — so that mirror has to learn the job just grew. A driver deciding
  // on a ride needs to see three riders and three fares, not the one that was
  // there when it was posted. acceptBid deletes that document, so on a matched
  // pool this write has nothing to update and is skipped.
  if ((snap.get('status') as TripStatus) === AWAITING_DRIVER) {
    tx.set(
      db.doc(`openRequests/${tripRef.id}`),
      {
        poolRiders: newMembers.length,
        poolPerSeatFare: perSeatFare,
        seats: newMembers.length,
        ...(genderBump ? { poolGenders: genderBump } : {}),
      },
      { merge: true },
    );
  }
  tx.set(db.doc(`users/${riderUid}`), { activeTripId: tripRef.id }, { merge: true });

  return {
    tripId: tripRef.id,
    riders: newMembers.length,
    perSeatFare,
    members: newMembers,
    driverId: (snap.get('driverId') as string | null) ?? null,
  };
}

/** First name of a user, for pushes and request rows. Never the full name. */
async function riderFirstName(uid: string): Promise<string> {
  const snap = await db.doc(`users/${uid}`).get();
  return firstNameOf(
    (snap.get('name') as string | undefined)
      ?? (snap.get('displayName') as string | undefined)
      ?? 'A rider',
  );
}

/** Tell everybody already in the car — and the driver — about a new rider. */
async function announceJoin(
  result: {
    tripId: string;
    riders: number;
    perSeatFare: number;
    members: string[];
    driverId: string | null;
  },
  joinerUid: string,
): Promise<void> {
  const name = await riderFirstName(joinerUid);
  await sendToUsers(
    result.members.filter((m) => m !== joinerUid),
    `👤 ${name} is sharing your ride`,
    `${result.riders} riders in the car now — everyone pays PKR ${result.perSeatFare} each.`,
    { tripId: result.tripId },
  );
  // The driver has to pick this person up and collect from them, so they are
  // told by name too — they used to find out by counting heads at the kerb.
  if (result.driverId) {
    await sendToUser(
      result.driverId,
      `👤 ${name} joined your shared ride`,
      `${result.riders} passengers now — PKR ${result.perSeatFare} from each.`,
      { tripId: result.tripId },
    );
  }
}

/**
 * Take a seat on a pool ride, or ask its driver for one.
 *
 * Which of the two it is depends entirely on whether a driver has agreed to
 * carry this ride yet:
 *
 *  - Still gathering (no driver) — the rider is seated immediately. There is
 *    nobody to ask, and the extra rider is the thing that makes the job worth
 *    taking when a driver finally looks at it.
 *  - Driver confirmed — the rider is queued and the driver decides. A car
 *    somebody already agreed to drive does not silently acquire passengers.
 *
 * Either way the fare is the pool's own per-seat tier. A joiner never names a
 * price and never negotiates one: that power belongs to the rider who started
 * the pool, and to them alone.
 */
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
        pending: false,
      };
    }
    if (members.length >= maxRiders) {
      throw new HttpsError('failed-precondition', 'This pool ride is already full.');
    }

    // Still gathering: nobody to ask, so seat them now.
    if (status === AWAITING_DRIVER) {
      if (!withinJoinWindow(snap.data() ?? {})) {
        throw new HttpsError('failed-precondition', WINDOW_CLOSED_MESSAGE);
      }
      const seated = await seatRiderOnPool(tx, tripRef, snap, ctx.uid);
      return { ...seated, alreadyJoined: false, pending: false };
    }

    if (!JOINABLE_STATUSES.has(status)) {
      throw new HttpsError('failed-precondition', 'This pool ride has already departed or ended.');
    }

    // Driver confirmed: the driver decides.
    const reqRef  = tripRef.collection('joinRequests').doc(ctx.uid);
    const reqSnap = await tx.get(reqRef);
    if (reqSnap.exists && reqSnap.get('status') === 'pending') {
      throw new HttpsError('already-exists', 'Your request is already with the driver.');
    }
    // One refusal is an answer. Re-asking the same driver from the same screen
    // would only be a way to pester them into it.
    if (reqSnap.exists && reqSnap.get('status') === 'rejected') {
      throw new HttpsError(
        'failed-precondition',
        'The driver could not take you on this ride. Book your own shared ride instead.',
      );
    }

    // Refused here rather than at approval time: "you already have a ride" is
    // useful now, and useless after a driver has held a seat for you.
    const userSnap = await tx.get(db.doc(`users/${ctx.uid}`));
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    if (activeTripId && activeTripId !== tripRef.id) {
      const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
      if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status') as TripStatus)) {
        throw new HttpsError('failed-precondition', 'You already have an active trip.');
      }
    }

    const fareIfSeated = poolPerSeatFare(soloFare, members.length + 1);
    tx.set(reqRef, {
      tripId:      tripRef.id,
      riderId:     ctx.uid,
      riderName:   firstNameOf(
        (userSnap.get('name') as string | undefined)
          ?? (userSnap.get('displayName') as string | undefined),
      ),
      riderGender: (userSnap.get('gender') as string | undefined) ?? 'unspecified',
      // What the driver would collect from them. Fixed by the pool's tier —
      // the rider did not choose it and cannot move it.
      farePerSeat: fareIfSeated,
      status:      'pending',
      createdAt:   FieldValue.serverTimestamp(),
    });

    return {
      tripId: tripRef.id,
      riders: members.length,
      perSeatFare: fareIfSeated,
      members,
      driverId: (snap.get('driverId') as string | null) ?? null,
      alreadyJoined: false,
      pending: true,
    };
  });

  if (result.pending) {
    if (result.driverId) {
      const name = await riderFirstName(ctx.uid);
      await sendToUser(
        result.driverId,
        `🙋 ${name} wants to share your ride`,
        `PKR ${result.perSeatFare} more if you take them. Open the trip to accept or decline.`,
        { tripId: result.tripId },
      );
    }
    logger.info('Pool join requested', { tripId: result.tripId, rider: ctx.uid });
  } else if (!result.alreadyJoined) {
    await announceJoin(result, ctx.uid);
    logger.info('Pool joined', { tripId: result.tripId, joiner: ctx.uid, riders: result.riders });
  }

  return { ok: true, ...result };
});

// ---------------------------------------------------------------------------
const respondJoinSchema = z.object({
  tripId:  z.string().min(1).max(128),
  riderId: z.string().min(1).max(128),
  action:  z.enum(['accept', 'reject']),
});

/**
 * The driver answers a request for a seat on the pool they are carrying.
 *
 * Accepting seats the rider on exactly the terms they were quoted; rejecting
 * closes the request and tells them, so nobody is left watching a spinner for a
 * seat that was never coming.
 */
export const driverRespondToPoolJoin = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = respondJoinSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId, riderId and action.');
  const { tripId, riderId, action } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  const reqRef  = tripRef.collection('joinRequests').doc(riderId);

  const outcome = await db.runTransaction(async (tx) => {
    const snap    = await tx.get(tripRef);
    const reqSnap = await tx.get(reqRef);
    if (!snap.exists || snap.get('pool') !== true) {
      throw new HttpsError('not-found', 'Pool ride not found.');
    }
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Only this ride’s driver can answer join requests.');
    }
    if (!reqSnap.exists || reqSnap.get('status') !== 'pending') {
      throw new HttpsError('failed-precondition', 'That request has already been answered.');
    }
    const status = snap.get('status') as TripStatus;
    if (!JOINABLE_STATUSES.has(status)) {
      tx.set(reqRef, { status: 'expired', decidedAt: FieldValue.serverTimestamp() }, { merge: true });
      throw new HttpsError('failed-precondition', 'This ride has already departed or ended.');
    }

    if (action === 'reject') {
      tx.set(reqRef, { status: 'rejected', decidedAt: FieldValue.serverTimestamp() }, { merge: true });
      return {
        accepted: false as const,
        tripId,
        riders: 0,
        perSeatFare: 0,
        members: [] as string[],
        driverId: ctx.uid,
      };
    }

    const seated = await seatRiderOnPool(tx, tripRef, snap, riderId);
    tx.set(reqRef, {
      status: 'accepted',
      decidedAt: FieldValue.serverTimestamp(),
      farePerSeat: seated.perSeatFare,
    }, { merge: true });
    return { accepted: true as const, ...seated };
  });

  if (outcome.accepted) {
    await sendToUser(
      riderId,
      '✅ The driver took you on board',
      `You are in the car — PKR ${outcome.perSeatFare} for your seat.`,
      { tripId },
    );
    await announceJoin(outcome, riderId);
    logger.info('Pool join accepted', { tripId, rider: riderId, driver: ctx.uid });
  } else {
    await sendToUser(
      riderId,
      'That shared ride could not take you',
      'The driver has declined. Book your own shared ride and let others join you.',
      { tripId },
    );
    logger.info('Pool join rejected', { tripId, rider: riderId, driver: ctx.uid });
  }

  return { ok: true, accepted: outcome.accepted };
});

// ---------------------------------------------------------------------------
const cancelJoinSchema = z.object({ tripId: z.string().min(1).max(128) });

/** The rider withdraws a seat request the driver has not answered yet. */
export const cancelPoolTripJoinRequest = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = cancelJoinSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const reqRef = db.doc(`trips/${parsed.data.tripId}/joinRequests/${ctx.uid}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists || snap.get('status') !== 'pending') {
      throw new HttpsError('failed-precondition', 'There is no request waiting on this ride.');
    }
    tx.set(reqRef, { status: 'cancelled', decidedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  return { ok: true };
});

// ---------------------------------------------------------------------------
const joinRequestsSchema = z.object({ tripId: z.string().min(1).max(128) });

/** The seat requests still waiting on a pool, for its driver. */
export const getPoolJoinRequests = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = joinRequestsSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const tripRef = db.doc(`trips/${parsed.data.tripId}`);

  const snap = await tripRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Pool ride not found.');
  if (snap.get('driverId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Only this ride’s driver can see join requests.');
  }

  const rows = await tripRef.collection('joinRequests').where('status', '==', 'pending').get();
  return {
    requests: rows.docs.map((d) => ({
      riderId:     d.get('riderId') as string,
      riderName:   (d.get('riderName') as string | undefined) ?? 'A rider',
      riderGender: (d.get('riderGender') as string | undefined) ?? 'unspecified',
      farePerSeat: (d.get('farePerSeat') as number | undefined) ?? 0,
    })),
  };
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
    // Wider than JOINABLE on purpose: the host may make a ride private while it
    // is still gathering riders, and public again once a driver holds it.
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
   * Whether a driver has already agreed to carry this ride. False means the
   * pool is still gathering riders — joining is instant, and the ride is
   * looking for a car with everyone aboard counted in the fare.
   */
  hasDriver: boolean;
  /** Who is driving, so the rider is choosing a car and not just a price. */
  driverName: string | null;
  driverVehicle: string | null;
  /** First names of the people already aboard. Never full names, never uids. */
  companions: { firstName: string; gender: string }[];
  /** Where the ride is in its journey, for "picking up now" vs "on the way". */
  status: TripStatus;
  /**
   * Epoch-ms this pool stops gathering riders, on a pool without a driver.
   * Null once a driver holds the ride — from then on there is no window, only
   * the driver's decision.
   */
  joinWindowEndsAt: number | null;
  /** True when tapping Join asks the driver rather than seating the rider. */
  needsDriverApproval: boolean;
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
 * TWO KINDS OF POOL LIVE HERE, and the difference is stated on every row.
 *
 *  1. CONFIRMED — a driver bid, the host accepted, the car is coming. Joining
 *     one of these asks that driver for the seat.
 *  2. GATHERING — a pool booked in the last ten minutes that is still looking
 *     for a driver. Joining is instant, because there is no driver to ask.
 *
 * The second kind is what makes the first kind exist. A pool nobody can see
 * until a driver takes it is a pool nobody joins: the rider who booked it rides
 * alone, and the people on the same road never find out it was there. Ten
 * minutes of visibility is what turns one rider's booking into a shared car.
 *
 * What a joiner is never exposed to is a moving price. The per-seat tier quoted
 * on every row is a fixed fraction of the host's own offer, and only the host —
 * the rider who started the pool — can move that offer at all.
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
      joinWindowEndsAt: hasDriver ? null : joinWindowEndsAt(d),
      needsDriverApproval: hasDriver,
    });
  };

  /** Pull one status band of pool trips through `consider`. Best-effort. */
  const scan = async (statuses: TripStatus[], hasDriver: boolean, gatheringOnly: boolean) => {
    try {
      const snap = await db.collection('trips')
        .where('pool', '==', true)
        .where('status', 'in', statuses)
        .limit(100)
        .get();
      for (const doc of snap.docs) {
        const d = doc.data();
        // A gathering pool leaves the feed when its ten minutes are up: it is
        // about to be driven somewhere, and a seat nobody can take is noise.
        if (gatheringOnly && !withinJoinWindow(d)) continue;
        const members = (d.poolMembers as string[] | undefined) ?? [d.passengerId as string];
        const soloFare = (d.fare as number | null) ?? (d.offeredFare as number);
        consider(doc.id, d, members.length, soloFare, hasDriver);
      }
    } catch (err) {
      logger.warn('getNearbyPublicPoolTrips: pool scan failed', { statuses, err });
    }
  };

  // Confirmed cars first, then the pools still gathering. Order matters only
  // for the dedupe — the sort below is by distance, and the caller decides how
  // to weigh a confirmed driver against a cheaper seat.
  await scan(MATCHED_JOINABLE, true, false);
  await scan([AWAITING_DRIVER], false, true);

  pools.sort((a, b) => a.distanceKm - b.distanceKm);
  return { pools: pools.slice(0, 20) };
});
