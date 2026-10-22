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
 * NOBODY owns the fare. It is computed server-side when the pool is created
 * (see fare/sharedRideFare) and it cannot be moved by the host, by a joiner or
 * by the driver: `raiseTripFare` refuses pool trips outright and a driver's bid
 * on a pool is an acceptance at the stated price rather than an offer.
 *
 * This used to be the host's to name, and that was the single biggest reason
 * pools fell apart — a host haggling could lose the car for everyone who had
 * already taken a seat in it. Negotiation now lives only on solo rides, where a
 * failed one costs nobody but the two people having it.
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
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser, sendToUsers } from '../lib/fcm';
import { TripStatus } from '../domain/types';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { ACTIVE_STATUSES, haversineKm } from './index';
import { firstNameOf, joinerRosterEntry, rosterForTrip } from './poolRoster';
import { coRiderStanding } from '../ratings/coRiders';
import { computeGenderAccess } from '../lib/genderAccess';
import {
  BOOKED_FOR_OTHER_NOTE,
  normalizeGender,
  requiresVettingToJoin,
  resolveSeatOccupant,
  type BookedFor,
  type SeatOccupant,
} from '../lib/seatGender';
import {
  agreedGrossOf,
  loadFareConfig,
  poolJoinGenderGate,
  priceShareJoinerOnto,
} from './enRoute';
import type { CityFareConfig } from '../fare/fareEngine';

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

const codeSchema = z.object({
  code: z.string().trim().min(4).max(16),
  /**
   * Who is taking the seat — the joiner themselves, or somebody they are
   * booking for. Names a relationship, never a gender; lib/seatGender turns it
   * into one against the caller's own profile. Absent means 'self'.
   */
  bookedFor: z.enum(['self', 'other']).nullish(),
});

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
  const rosterHere = rosterForTrip(snap.data() ?? {}).filter((r) => r.uid !== ctx.uid);
  // Unlike the feeds, this screen reads each companion's standing LIVE. It is
  // one car and at most three people, and it is the screen where the number
  // actually decides something — a rider staring at "Join" deserves the rating
  // as it is now, not as it was when that person boarded.
  const companionSnaps = rosterHere.length
    ? await db.getAll(...rosterHere.map((r) => db.doc(`users/${r.uid}`)))
    : [];
  const companions = rosterHere.map((r, i) => ({
    firstName: r.firstName,
    gender: r.gender,
    kind: r.kind,
    ...coRiderStanding(companionSnaps[i]?.data()),
  }));

  const awaitingDriver = status === AWAITING_DRIVER;
  const gathering = awaitingDriver && withinJoinWindow(snap.data() ?? {});
  // A request this rider already sent and the driver has not answered. Without
  // it the join screen offers "Join" a second time to somebody who is already
  // in the queue, and a second tap reads as the first one having failed.
  const myRequest = await tripRef.collection('joinRequests').doc(ctx.uid).get();
  const requestStatus = myRequest.exists ? (myRequest.get('status') as string) : null;
  // The same gender rules the join itself enforces, answered before the tap.
  const meSnap = await db.doc(`users/${ctx.uid}`).get();
  const gate = alreadyJoined
    ? { allowed: true as const }
    : poolJoinGenderGate(
        snap.data() ?? {},
        (meSnap.get('gender') as string | undefined) ?? 'unspecified',
        meSnap.get('mixedRideOk') === true,
      );

  return {
    code,
    status,
    pickupAddress:  pickup?.address ?? 'Pickup',
    dropoffAddress: dropoff?.address ?? 'Destination',
    rideType:   snap.get('rideType') as string,
    visibility: (snap.get('poolVisibility') as string | undefined) ?? 'public',
    hostName:   (hostSnap.get('displayName') as string | undefined) ?? 'A Velocity Rides rider',
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
      && requestStatus !== 'pending'
      && gate.allowed,
    /** Why this rider cannot join, when the car's gender rules say no. */
    blockedReason: gate.allowed ? null : gate.reason,
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
  cfg: CityFareConfig,
  /**
   * Who is actually taking the seat. Omitted means "the account holder,
   * themselves" — the behaviour from before seats carried their own gender.
   * The driver-approval path passes the occupant recorded on the request, so
   * the person seated is the person the driver said yes to.
   */
  seat?: SeatOccupant,
): Promise<SeatResult> {
  const members = (snap.get('poolMembers') as string[] | undefined)
    ?? [snap.get('passengerId') as string];
  const maxRiders = (snap.get('maxPoolRiders') as number | undefined) ?? MAX_POOL_RIDERS;
  const soloFare  = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number);
  const trip = snap.data() ?? {};

  if (members.includes(riderUid)) {
    throw new HttpsError('already-exists', 'That rider is already on this ride.');
  }
  if (members.length >= maxRiders) {
    throw new HttpsError('failed-precondition', 'This pool ride is already full.');
  }

  // A rider on another active trip can't be in two cars at once.
  const userSnap = await tx.get(db.doc(`users/${riderUid}`));
  const activeTripId = userSnap.get('activeTripId') as string | undefined;
  const occupant = seat ?? resolveSeatOccupant(userSnap.get('gender'), null);
  const joinerGender = occupant.seatGender;
  if (activeTripId && activeTripId !== tripRef.id) {
    const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
    if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status') as TripStatus)) {
      throw new HttpsError('failed-precondition', 'That rider already has an active trip.');
    }
  }

  // The same gender rules as every other way into a shared car. This door used
  // to skip them entirely — only the tally was bumped — so a man could be seated
  // straight into a car of two women before any driver was even involved.
  const gate = poolJoinGenderGate(trip, joinerGender, userSnap.get('mixedRideOk') === true);
  if (!gate.allowed) throw new HttpsError('permission-denied', gate.reason);

  const newMembers  = [...members, riderUid];
  const tierFare    = poolPerSeatFare(soloFare, newMembers.length);
  const joinerName  = (userSnap.get('name') as string | undefined)
    ?? (userSnap.get('displayName') as string | undefined);

  // Write them into the roster as well as the member list. The uid alone told
  // nobody anything: the driver could not name the person they were picking
  // up or say what to collect from them, and the riders already in the car
  // were never told a stranger had been added to it.
  const roster = rosterForTrip(trip);
  const newRoster = [
    ...roster,
    joinerRosterEntry({
      uid: riderUid,
      name: joinerName,
      gender: joinerGender,
      bookedForOther: occupant.bookedForOther,
      // Free of charge: `userSnap` is already read above for the gender gate.
      coRiderRating: userSnap.get('coRiderRating') as number | undefined,
      coRiderRatingCount: userSnap.get('coRiderRatingCount') as number | undefined,
      pickup: snap.get('pickup'),
      dropoff: snap.get('dropoff'),
    }),
  ];

  // A car that already carries riders picked up on the way settles from the
  // leg-split total (poolDriverGross), so a joiner has to be priced into it —
  // written into poolMembers alone they were never billed, and the next pickup
  // could not see their seat or their gender.
  const priced = priceShareJoinerOnto(
    trip,
    { uid: riderUid, name: firstNameOf(joinerName), gender: joinerGender },
    cfg,
  );
  const perSeatFare = priced ? priced.joinerFare : tierFare;

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
      // Every member can read the trip doc, so the host's number leaves it the
      // moment somebody else is aboard; the driver gets it from getPoolRiders.
      passengerPhone: FieldValue.delete(),
      seats: newMembers.length,
      poolPerSeatFare: tierFare,
      ...(genderBump ? { poolGenders: genderBump } : {}),
      ...(priced
        ? {
            poolRiders: priced.riders,
            poolFares: priced.fares,
            poolDriverGross: priced.gross,
            maleSeats: priced.male,
            femaleSeats: priced.female,
            genderComposition: computeGenderAccess(priced.male, priced.female, MAX_POOL_RIDERS, 'any'),
          }
        : {}),
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
        poolPerSeatFare: tierFare,
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
    fares: priced ? priced.fares : null,
  };
}

/** What seating a rider produced — the joiner's own fare, and everyone's when it differs. */
interface SeatResult {
  tripId: string;
  riders: number;
  /** The joiner's own fare: the flat tier, or their leg-split share. */
  perSeatFare: number;
  members: string[];
  driverId: string | null;
  /** Everyone's fare, when the car is priced by the leg-split rather than one flat tier. */
  fares: Record<string, number> | null;
}

/** Everything a join produced, for the callables that start one. */
export interface JoinOutcome extends SeatResult {
  alreadyJoined: boolean;
  /** True when the join went out as a request rather than becoming a seat. */
  pending: boolean;
  /** Pending requests: what the driver really gains by accepting. */
  driverEarnExtra: number | null;
  /** Pending requests: the driver's total if they accept. */
  driverTotal: number | null;
  /**
   * Who answers a pending request — the driver when the ride has one, otherwise
   * the host whose ride it is. Null when nothing is pending.
   */
  vetBy?: 'driver' | 'host' | null;
  /** True when the seat was booked by somebody other than its passenger. */
  bookedForOther?: boolean;
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
async function announceJoin(result: SeatResult, joinerUid: string): Promise<void> {
  const name = await riderFirstName(joinerUid);
  const others = result.members.filter((m) => m !== joinerUid);
  if (result.fares) {
    // Riders picked up on the way pay for their own stretch of road, so there
    // is no "everyone pays X" — each rider is told their own fare.
    await Promise.all(others.map((m) => sendToUser(
      m,
      `👤 ${name} is sharing your ride`,
      `${result.riders} riders in the car now — your fare is PKR ${result.fares![m] ?? result.perSeatFare}.`,
      { tripId: result.tripId },
    )));
  } else {
    await sendToUsers(
      others,
      `👤 ${name} is sharing your ride`,
      `${result.riders} riders in the car now — everyone pays PKR ${result.perSeatFare} each.`,
      { tripId: result.tripId },
    );
  }
  // The driver has to pick this person up and collect from them, so they are
  // told by name too — they used to find out by counting heads at the kerb.
  if (result.driverId) {
    await sendToUser(
      result.driverId,
      `👤 ${name} joined your shared ride`,
      result.fares
        ? `${result.riders} passengers now — PKR ${result.perSeatFare} from ${name}.`
        : `${result.riders} passengers now — PKR ${result.perSeatFare} from each.`,
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

  const result = await joinPoolTripAsRider(ctx.uid, tripRef, parsed.data.bookedFor ?? null);
  return {
    ok: true,
    tripId: result.tripId,
    riders: result.riders,
    perSeatFare: result.perSeatFare,
    members: result.members,
    driverId: result.driverId,
    alreadyJoined: result.alreadyJoined,
    pending: result.pending,
  };
});

/**
 * Put a rider into a pool trip: seat them while it is still gathering, or send
 * its driver a request once it has one. Invite codes, "Pools near you" and
 * Travel Partner ride links all come through here, so every door into a shared
 * car has the same seats, the same gender rules and the same fares.
 */
export async function joinPoolTripAsRider(
  uid: string,
  tripRef: FirebaseFirestore.DocumentReference,
  bookedFor: BookedFor | null = null,
): Promise<JoinOutcome> {
  const pre = await tripRef.get();
  const cfg = await loadFareConfig((pre.get('pickup') as { lat: number; lng: number } | undefined) ?? null);

  const result = await db.runTransaction(async (tx): Promise<JoinOutcome> => {
    const snap = await tx.get(tripRef);
    if (!snap.exists || snap.get('pool') !== true) {
      throw new HttpsError('not-found', 'This pool ride no longer exists.');
    }
    const status  = snap.get('status') as TripStatus;
    const members = (snap.get('poolMembers') as string[] | undefined) ?? [snap.get('passengerId') as string];
    const maxRiders = (snap.get('maxPoolRiders') as number | undefined) ?? MAX_POOL_RIDERS;
    const soloFare  = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number);
    const trip = snap.data() ?? {};

    if (members.includes(uid)) {
      const fares = (trip.poolFares as Record<string, number> | undefined) ?? null;
      return {
        tripId: tripRef.id,
        riders: members.length,
        perSeatFare: fares?.[uid] ?? poolPerSeatFare(soloFare, members.length),
        members,
        driverId: (snap.get('driverId') as string | null) ?? null,
        fares,
        alreadyJoined: true,
        pending: false,
        driverEarnExtra: null,
        driverTotal: null,
      };
    }
    if (members.length >= maxRiders) {
      throw new HttpsError('failed-precondition', 'This pool ride is already full.');
    }

    /**
     * Who is taking the seat, resolved before either branch because it decides
     * WHICH branch applies. A seat booked for somebody of the other gender may
     * not take an instant place in a single-gender car even while the pool is
     * still gathering — there would be nobody in the loop at all, and "nobody
     * to ask" is the wrong answer when the seat's occupant is somebody we are
     * taking the booker's word for. See lib/seatGender.
     */
    const seatSnap = await tx.get(db.doc(`users/${uid}`));
    const seat = resolveSeatOccupant(seatSnap.get('gender'), bookedFor);
    const aboardGenders = rosterForTrip(trip).map((r) => normalizeGender(r.gender));
    const needsVetting = requiresVettingToJoin(seat, aboardGenders);

    // Still gathering and nothing to vet: nobody to ask, so seat them now.
    if (status === AWAITING_DRIVER && !needsVetting) {
      if (!withinJoinWindow(trip)) {
        throw new HttpsError('failed-precondition', WINDOW_CLOSED_MESSAGE);
      }
      const seated = await seatRiderOnPool(tx, tripRef, snap, uid, cfg, seat);
      return { ...seated, alreadyJoined: false, pending: false, driverEarnExtra: null, driverTotal: null };
    }

    if (status === AWAITING_DRIVER) {
      // Gathering, but this seat has to be vetted. The pool has no driver, so
      // the person who answers is the one whose ride it is: the host.
      if (!withinJoinWindow(trip)) {
        throw new HttpsError('failed-precondition', WINDOW_CLOSED_MESSAGE);
      }
    } else if (!JOINABLE_STATUSES.has(status)) {
      throw new HttpsError('failed-precondition', 'This pool ride has already departed or ended.');
    }

    // Somebody has to say yes: the driver if there is one, otherwise the host.
    const reqRef  = tripRef.collection('joinRequests').doc(uid);
    const reqSnap = await tx.get(reqRef);
    if (reqSnap.exists && reqSnap.get('status') === 'pending') {
      throw new HttpsError('already-exists', 'Your request for this seat is already waiting for an answer.');
    }
    // One refusal is an answer. Re-asking from the same screen would only be a
    // way to pester somebody into it.
    if (reqSnap.exists && reqSnap.get('status') === 'rejected') {
      throw new HttpsError(
        'failed-precondition',
        'This shared ride could not take you. Book your own and let others join you.',
      );
    }

    // Refused here rather than at approval time: "you already have a ride" is
    // useful now, and useless after a seat has been held for you.
    const userSnap = seatSnap;
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    if (activeTripId && activeTripId !== tripRef.id) {
      const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
      if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status') as TripStatus)) {
        throw new HttpsError('failed-precondition', 'You already have an active trip.');
      }
    }

    // The same goes for the car's gender rules: they are checked now, before
    // anybody waits on a driver for a seat the rules would refuse anyway.
    const joinerGender = seat.seatGender;
    const gate = poolJoinGenderGate(trip, joinerGender, userSnap.get('mixedRideOk') === true);
    if (!gate.allowed) throw new HttpsError('permission-denied', gate.reason);

    const riderName = firstNameOf(
      (userSnap.get('name') as string | undefined)
        ?? (userSnap.get('displayName') as string | undefined),
    );
    // What the joiner would pay, and what the driver would REALLY gain: their
    // total after minus their total now. The push used to quote the joiner's
    // per-seat fare as "more", which is not what the driver's total moves by.
    const priced = priceShareJoinerOnto(trip, { uid, name: riderName, gender: joinerGender }, cfg);
    const fareIfSeated = priced ? priced.joinerFare : poolPerSeatFare(soloFare, members.length + 1);
    const driverTotal = priced
      ? priced.gross
      : poolPerSeatFare(soloFare, members.length + 1) * (members.length + 1);
    const driverEarnExtra = driverTotal - agreedGrossOf(trip);

    const driverId = (snap.get('driverId') as string | null) ?? null;
    tx.set(reqRef, {
      tripId:      tripRef.id,
      riderId:     uid,
      riderName,
      riderGender: joinerGender,
      /**
       * Shown to the driver and to every co-rider before anybody answers. A
       * seat somebody booked on another person's behalf is the one case where
       * the gender on the request is a claim rather than a verified fact, and
       * the people getting into the car are entitled to know that.
       */
      bookedForOther: seat.bookedForOther,
      /** Why this is a request at all, so the UI can say the true reason. */
      vetReason: needsVetting ? 'booked_for_other' : 'driver_confirmed',
      /** Who answers: the driver when there is one, otherwise the host. */
      vetBy: driverId ? 'driver' : 'host',
      // What the driver would collect from them. Fixed by the pool's tier —
      // the rider did not choose it and cannot move it.
      farePerSeat: fareIfSeated,
      driverEarnExtra,
      driverTotalAfter: driverTotal,
      status:      'pending',
      /**
       * Any co-rider may object, and an objection is binding (see
       * `coRiderObjectToPoolJoin`). Seeded empty so the field always exists for
       * the rules and the driver's UI to read.
       */
      objections:  [] as string[],
      createdAt:   FieldValue.serverTimestamp(),
    });

    return {
      tripId: tripRef.id,
      riders: members.length,
      perSeatFare: fareIfSeated,
      members,
      driverId: (snap.get('driverId') as string | null) ?? null,
      fares: null,
      alreadyJoined: false,
      pending: true,
      driverEarnExtra,
      driverTotal,
      vetBy: driverId ? 'driver' : 'host',
      bookedForOther: seat.bookedForOther,
    };
  });

  if (result.pending) {
    const name = await riderFirstName(uid);
    const forOther = result.bookedForOther === true;

    if (result.vetBy === 'driver' && result.driverId) {
      const extra = result.driverEarnExtra ?? 0;
      const total = result.driverTotal ?? 0;
      const money = extra > 0
        ? `PKR ${extra} more for you if you take them (they pay PKR ${result.perSeatFare}).`
        : `Your total would go from PKR ${total - extra} to PKR ${total} if you take them (they pay PKR ${result.perSeatFare}).`;
      await sendToUser(
        result.driverId,
        `🙋 ${name} wants to share your ride`,
        forOther
          ? `${money} ${BOOKED_FOR_OTHER_NOTE} Open the trip to accept or decline.`
          : `${money} Open the trip to accept or decline.`,
        { tripId: result.tripId },
      );
    } else if (result.vetBy === 'host') {
      /**
       * No driver yet, so the person who answers is the host. This path exists
       * only for a seat that has to be vetted — an ordinary joiner is seated
       * instantly and nobody is asked anything.
       */
      await sendToUser(
        result.members[0] ?? '',
        `🙋 ${name} wants a seat in your shared ride`,
        `${BOOKED_FOR_OTHER_NOTE} They would pay PKR ${result.perSeatFare}. `
        + 'Open your ride to accept or decline.',
        { tripId: result.tripId },
      );
    }

    /**
     * Everybody already in the car is told too, because any one of them may
     * refuse and their refusal is final (see `coRiderObjectToPoolJoin`). They
     * are the people who will be sitting next to this passenger, and asking the
     * driver to guess on their behalf is how a woman ends up sharing a back
     * seat she never agreed to.
     */
    const coRiders = result.members.filter((m) => m !== uid && m !== result.members[0]);
    if (forOther && coRiders.length > 0) {
      await sendToUsers(
        coRiders,
        `🙋 Someone wants to join your shared ride`,
        `${BOOKED_FOR_OTHER_NOTE} Open the ride to say whether that is alright with you.`,
        { tripId: result.tripId },
      );
    }
    logger.info('Pool join requested', {
      tripId: result.tripId, rider: uid, vetBy: result.vetBy, forOther,
    });
  } else if (!result.alreadyJoined) {
    await announceJoin(result, uid);
    logger.info('Pool joined', { tripId: result.tripId, joiner: uid, riders: result.riders });
  }

  return result;
}

// ---------------------------------------------------------------------------
const respondJoinSchema = z.object({
  tripId:  docId,
  riderId: docId,
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
  const pre = await tripRef.get();
  const cfg = await loadFareConfig((pre.get('pickup') as { lat: number; lng: number } | undefined) ?? null);

  const outcome = await db.runTransaction(async (tx) => {
    const snap    = await tx.get(tripRef);
    const reqSnap = await tx.get(reqRef);
    if (!snap.exists || snap.get('pool') !== true) {
      throw new HttpsError('not-found', 'Pool ride not found.');
    }
    /**
     * Who may answer. The driver owns the car, so it is theirs to decide — but
     * a ride that has no driver yet still gets vetting requests (a seat booked
     * for somebody else never takes an instant place in a single-gender car),
     * and those are the host's to answer. Exactly one of the two is in charge
     * at any moment, and it is whichever one the request was addressed to.
     */
    const rideDriverId = (snap.get('driverId') as string | null) ?? null;
    const hostId = (snap.get('passengerId') as string | undefined) ?? null;
    const answerer = rideDriverId ?? hostId;
    if (answerer !== ctx.uid) {
      throw new HttpsError(
        'permission-denied',
        rideDriverId
          ? 'Only this ride’s driver can answer join requests.'
          : 'Only the rider whose shared ride this is can answer join requests.',
      );
    }
    if (!reqSnap.exists || reqSnap.get('status') !== 'pending') {
      throw new HttpsError('failed-precondition', 'That request has already been answered.');
    }
    /**
     * A co-rider's refusal is binding, so accepting over the top of one is not
     * a decision the driver gets to make. Checked here as well as in the
     * objection call, because the two can race and the seat is what matters.
     */
    const objections = (reqSnap.get('objections') as string[] | undefined) ?? [];
    if (action === 'accept' && objections.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        'Someone already in the car has refused this passenger, so the seat cannot be given.',
      );
    }
    const status = snap.get('status') as TripStatus;
    if (!JOINABLE_STATUSES.has(status) && status !== AWAITING_DRIVER) {
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
        fares: null,
      };
    }

    /**
     * Seat the person the answerer actually said yes to. The occupant was
     * settled when the request was made; re-deriving it from the account's
     * profile here would seat the BOOKER's gender and quietly undo the whole
     * point of asking who was travelling.
     */
    const seated = await seatRiderOnPool(tx, tripRef, snap, riderId, cfg, {
      seatGender: normalizeGender(reqSnap.get('riderGender')),
      bookedForOther: reqSnap.get('bookedForOther') === true,
    });
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

// ── coRiderObjectToPoolJoin ──────────────────────────────────────────────────

const objectSchema = z.object({
  tripId:  docId,
  riderId: docId,
});

/**
 * Somebody already in the car refuses a passenger who has asked to join it.
 *
 * WHY THIS IS BINDING, AND NOT ADVICE
 * -----------------------------------
 * The driver decides who rides in their car, and that stays true. But the
 * driver is not the person who will be sitting in the back seat next to a
 * stranger, and the one case this whole mechanism exists for — a seat booked by
 * one person for another, where the gender on the request is a claim rather
 * than a verified fact — is precisely the case where the driver has the least
 * information and the co-riders have the most at stake.
 *
 * So a refusal from anyone aboard ends the request. Not a vote, not a signal
 * for the driver to weigh: an answer. A woman who says she will not share the
 * back seat with this passenger does not need three other people to agree with
 * her, and asking her to make that case to a driver over the phone is asking
 * her to do something she will simply not do — she will cancel the ride
 * instead, and we will have learned nothing about why.
 *
 * The passenger is told the seat is unavailable and never told who refused or
 * why. An objection that identified its author would be an invitation to argue
 * with them at the kerb.
 */
export const coRiderObjectToPoolJoin = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'coRiderObjectToPoolJoin', 20, 60);
  const parsed = objectSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the ride and the rider you are answering about.');
  const { tripId, riderId } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  const reqRef  = tripRef.collection('joinRequests').doc(riderId);

  const outcome = await db.runTransaction(async (tx) => {
    const [snap, reqSnap] = await Promise.all([tx.get(tripRef), tx.get(reqRef)]);
    if (!snap.exists || snap.get('pool') !== true) {
      throw new HttpsError('not-found', 'Shared ride not found.');
    }
    const members = (snap.get('poolMembers') as string[] | undefined)
      ?? [snap.get('passengerId') as string];
    if (!members.includes(ctx.uid)) {
      throw new HttpsError(
        'permission-denied',
        'Only the riders already in this car can answer for it.',
      );
    }
    if (ctx.uid === riderId) {
      throw new HttpsError('failed-precondition', 'That is your own seat.');
    }
    if (!reqSnap.exists || reqSnap.get('status') !== 'pending') {
      throw new HttpsError('failed-precondition', 'That request has already been answered.');
    }

    // One refusal is enough, so the request closes here rather than waiting for
    // the driver to action it. Recording the objector as well as the rejection
    // keeps the decision auditable without ever showing it to the passenger.
    tx.set(reqRef, {
      status:       'rejected',
      rejectedBy:   'co_rider',
      objections:   FieldValue.arrayUnion(ctx.uid),
      decidedAt:    FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      driverId: (snap.get('driverId') as string | null) ?? null,
      hostId:   (snap.get('passengerId') as string | undefined) ?? null,
    };
  });

  await sendToUser(
    riderId,
    'That shared ride could not take you',
    'The seat is not available. Book your own shared ride and let others join you.',
    { tripId },
  );
  // Whoever would otherwise have been deciding is told the answer is already in,
  // so they are not left looking at a request that no longer needs them.
  const toTell = outcome.driverId ?? outcome.hostId;
  if (toTell && toTell !== ctx.uid) {
    await sendToUser(
      toTell,
      'A seat request was declined',
      'Someone already in the car refused that passenger, so the request is closed.',
      { tripId },
    );
  }
  logger.info('Pool join refused by co-rider', { tripId, rider: riderId, by: ctx.uid });
  return { ok: true, rejected: true };
});

// ---------------------------------------------------------------------------
const cancelJoinSchema = z.object({ tripId: docId });

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
const joinRequestsSchema = z.object({ tripId: docId });

/** The seat requests still waiting on a pool, for its driver. */
export const getPoolJoinRequests = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = joinRequestsSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const tripRef = db.doc(`trips/${parsed.data.tripId}`);

  const snap = await tripRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Pool ride not found.');

  /**
   * Who may see the queue: the driver, and everybody already in the car.
   *
   * It used to be the driver alone, which was right while they were the only
   * person who could answer. They are not any more — a ride with no driver yet
   * sends vetting requests to the host, and any co-rider may refuse one. People
   * cannot answer a request they are not allowed to look at.
   */
  const driverId = (snap.get('driverId') as string | null) ?? null;
  const members = (snap.get('poolMembers') as string[] | undefined)
    ?? [snap.get('passengerId') as string];
  if (driverId !== ctx.uid && !members.includes(ctx.uid)) {
    throw new HttpsError(
      'permission-denied',
      'Only this ride’s driver and the riders in it can see join requests.',
    );
  }

  const rows = await tripRef.collection('joinRequests').where('status', '==', 'pending').get();
  return {
    requests: rows.docs.map((d) => ({
      riderId:     d.get('riderId') as string,
      riderName:   (d.get('riderName') as string | undefined) ?? 'A rider',
      riderGender: (d.get('riderGender') as string | undefined) ?? 'unspecified',
      farePerSeat: (d.get('farePerSeat') as number | undefined) ?? 0,
      /**
       * The one fact that makes this decision different from an ordinary one,
       * and the reason co-riders are shown the queue at all: the gender above
       * is what the booker says, not what a profile proves.
       */
      bookedForOther: d.get('bookedForOther') === true,
      vetBy:          (d.get('vetBy') as string | undefined) ?? 'driver',
    })),
  };
});

// ---------------------------------------------------------------------------
const visibilitySchema = z.object({
  tripId: docId,
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
  /**
   * First names of the people already aboard, with what previous co-riders made
   * of them. Never full names, never uids.
   *
   * `coRiderRating` is null when too few people have rated somebody to show a
   * number — the threshold lives in ratings/coRiders, and the count comes
   * through regardless so a screen can say how solid the figure is.
   */
  companions: {
    firstName: string;
    gender: string;
    coRiderRating: number | null;
    coRiderRatingCount: number;
  }[];
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
  // Pools the caller could not get into are not offered to them — the same
  // rule the poolRideRequests feed has always applied (2 men → never shown to
  // women), now that joining a booking pool is gated on it too.
  const myGender  = (userSnap.get('gender') as string | undefined) ?? 'unspecified';
  const myMixedOk = userSnap.get('mixedRideOk') === true;

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
    if (!poolJoinGenderGate(d, myGender, myMixedOk).allowed) return;
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
      // and decide whether to get in; not enough to identify anybody. The
      // standing comes from the roster snapshot rather than a live read — this
      // is a feed of up to a hundred cars, and see PoolRosterEntry.coRiderRating
      // for why that trade is the right way round here.
      companions: rosterForTrip(d)
        .filter((r) => r.uid !== ctx.uid)
        .map((r) => ({
          firstName: r.firstName,
          gender: r.gender,
          ...coRiderStanding({
            coRiderRating: r.coRiderRating,
            coRiderRatingCount: r.coRiderRatingCount,
          }),
        })),
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
