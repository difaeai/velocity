/**
 * Shared pools — one shared car that keeps leaving from the same place.
 * ----------------------------------------------------------------------------
 * The owner's model (2026-10-29). A pool is a ROUTE people come back to, not one
 * car: "Bahria University, E-8 at 08:00" fills, sends a car, and two minutes
 * after it filled it is empty again for the next riders going that way.
 *
 * Four things, kept apart on purpose — never one status:
 *
 *   the POOL     sharedPools/{id}. The route, its name, its daily time. Lasts.
 *   a BOOKING    an entry in pool.bookings: a seat held for the next car. It is
 *                PENDING — no driver has said yes and nobody is in a car. It
 *                sets no activeTripId, so an 08:00 seat booked the night before
 *                never stops the rider taking another ride in between.
 *   the RIDE     an ordinary shared trip (trips/{id}), made from the bookings by
 *                `dispatchPool`. Drivers, OTP, cash, ratings, drop-offs — all
 *                exactly as every other shared ride, nothing rebuilt here.
 *   the DRIVER   whoever takes that trip. A bid on a shared ride is at its fixed
 *                fare, so the first driver to accept is the driver.
 *
 * WHEN A CAR IS SENT. A pool with no time sends one the moment somebody books
 * ("leaves as soon as a driver takes it"). A pool with a time sends one
 * DISPATCH_LEAD_MS before it — or the moment its last seat is booked, because a
 * full car has nobody left to wait for. No minimum: one booked rider still
 * gets a car, at the one-rider price, which drops for everybody as others join.
 *
 * Every rule a seat must pass lives where it already lived: the fixed fare in
 * fare/sharedRideFare, the gender gates in trips/enRoute + lib/seatGender, the
 * "can this account book" checks in trips/assertRiderCanBook, joining a car in
 * trips/poolShare. This file only decides WHICH car and WHEN.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, SCHEDULE_REGION, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { notifyUser } from '../lib/fcm';
import { resolveSeatOccupant } from '../lib/seatGender';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { assertOutstandingClear, getCancellationSettings, type CancellationSettings } from '../domain/cancellation';
import { sharedRideFare } from '../fare/sharedRideFare';
import { assertRiderCanBook, broadcastTripToNearbyDrivers, haversineKm } from '../trips';
import { generateShareCode, writeTripDocuments } from '../trips/poolTripFactory';
import { joinPoolTripAsRider, POOL_JOIN_WINDOW_MS } from '../trips/poolShare';
import { firstNameOf, rosterForTrip } from '../trips/poolRoster';
import { poolJoinGenderGate } from '../trips/enRoute';
import { timestampMs } from '../poolRides/lifecycle';

/** A rider's pickup and drop-off must each be this close to the pool's. */
export const MATCH_RADIUS_M = 1000;
/** A car that filled stays on the card this long; then the pool is empty again. */
export const FULL_HOLD_MS = 2 * 60 * 1000;
/** A pool with a time asks drivers this long before it, so the car is there on time. */
export const DISPATCH_LEAD_MS = 10 * 60 * 1000;
/** Seats one rider may hold at once — there and back on the same day. */
const MAX_BOOKINGS_PER_RIDER = 2;
/** A pool nobody has booked for this long stops turning up in search. */
const STALE_POOL_MS = 30 * 24 * 60 * 60 * 1000;
/** Pakistan Standard Time, UTC+5 all year (no daylight saving since 2009). */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Driver statuses in which a car has a driver and has not left yet. */
const WITH_DRIVER = new Set(['matched', 'arriving', 'arrived']);

/** A seat held for the next car. A plain Timestamp: Firestore refuses sentinels in arrays. */
interface Booking {
  uid: string;
  firstName: string;
  /** The seat's gender — see lib/seatGender. */
  gender: string;
  bookedAt: FirebaseFirestore.Timestamp;
}

type Place = { lat: number; lng: number; address: string };

/** Epoch-ms of the next HH:MM in Pakistan time that is still ahead of `nowMs`. */
export function nextDepartureMs(hhmm: string, nowMs: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const pkt = new Date(nowMs + PKT_OFFSET_MS);
  const today = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate(), h, m) - PKT_OFFSET_MS;
  return today > nowMs ? today : today + DAY_MS;
}

/** What the pool's last car can still do, read off its trip. */
export function carOf(trip: FirebaseFirestore.DocumentData | null | undefined, nowMs: number) {
  if (!trip) return null;
  const status = trip.status as string;
  const members = (trip.poolMembers as string[] | undefined) ?? [trip.passengerId as string];
  const max = (trip.maxPoolRiders as number | undefined) ?? MAX_POOL_RIDERS;
  const created = timestampMs(trip.createdAt);
  // A trip whose createdAt has not landed yet is seconds old, never expired.
  const gathering = status === 'requested' && (created === null || created + POOL_JOIN_WINDOW_MS > nowMs);
  const full = members.length >= max;
  const ended = status === 'cancelled' || status === 'completed';
  const driver = trip.driverInfo as { displayName?: string; vehicleLabel?: string; plate?: string } | undefined;
  return {
    status,
    members,
    ended,
    full,
    joinable: !full && (gathering || WITH_DRIVER.has(status)),
    /** When the last seat went: the newest roster entry. */
    filledAtMs: full ? Math.max(0, ...rosterForTrip(trip).map((r) => timestampMs(r.joinedAt) ?? 0)) : null,
    fare: (trip.fare as number | null) ?? (trip.offeredFare as number),
    driver: driver && (WITH_DRIVER.has(status) || status === 'in_progress')
      ? { name: driver.displayName ?? 'Driver', vehicle: driver.vehicleLabel ?? 'Car', plate: driver.plate ?? '' }
      : null,
  };
}

export interface PoolCard {
  id: string;
  label: string | null;
  city: string;
  rideType: string;
  pickup: Place;
  dropoff: Place;
  /** How far the pool's ends are from the rider's own — null on "My rides". */
  pickupDistanceM: number | null;
  dropoffDistanceM: number | null;
  /** Daily "HH:MM", or null: leaves as soon as a driver takes it. */
  departTime: string | null;
  /** The departure the current bookings are for (or the next one), epoch-ms. */
  departsAtMs: number | null;
  /**
   * gathering — seats are being booked for the next car; no driver yet.
   * car       — a car is on, still taking riders; `driver` once one accepted.
   * full      — the car just filled (FULL_HOLD_MS); after that, gathering again.
   */
  state: 'gathering' | 'car' | 'full';
  riders: number;
  seatsTotal: number;
  seatsLeft: number;
  /** The whole-car fare. */
  fare: number;
  /** What THIS rider pays per seat if they join now (or pay now, if already in). */
  farePerSeat: number;
  /** Per seat at 1, 2, 3, 4 riders. */
  fareLadder: number[];
  driver: { name: string; vehicle: string; plate: string } | null;
  /** Joining asks the driver rather than taking the seat. */
  needsDriverApproval: boolean;
  /** This rider holds a seat for the next car. */
  booked: boolean;
  /** This rider is in the pool's car — open it. */
  aboardTripId: string | null;
  /** This rider created the pool. */
  mine: boolean;
}

/** One pool as a card, for one rider. Pure — the tests drive it with a clock. */
export function poolCard(args: {
  id: string;
  pool: FirebaseFirestore.DocumentData;
  trip: FirebaseFirestore.DocumentData | null;
  tripId: string | null;
  uid: string;
  nowMs: number;
  from?: { lat: number; lng: number };
  to?: { lat: number; lng: number };
}): PoolCard {
  const { pool, uid, nowMs } = args;
  const car = carOf(args.trip, nowMs);
  const inCar = !!car && !car.ended && car.members.includes(uid);
  const state: PoolCard['state'] = car?.joinable
    ? 'car'
    : car?.full && !car.ended && car.filledAtMs !== null && nowMs - car.filledAtMs < FULL_HOLD_MS
      ? 'full'
      : 'gathering';

  const bookings = (pool.bookings as Booking[] | undefined) ?? [];
  const booked = bookings.some((b) => b.uid === uid);
  const onCar = state !== 'gathering' && !!car;
  const fare = onCar ? car.fare : (pool.fare as number);
  const riders = onCar ? car.members.length : bookings.length;
  const paying = booked || (onCar && inCar) ? riders : riders + 1;
  const departTime = (pool.departTime as string | null) ?? null;
  const dispatchMs = timestampMs(pool.dispatchAt);

  const km = (a?: { lat: number; lng: number }, b?: { lat: number; lng: number }) =>
    a && b ? Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000) : null;

  return {
    id: args.id,
    label: (pool.label as string | null) ?? null,
    city: pool.city as string,
    rideType: (pool.rideType as string) ?? 'mini',
    pickup: pool.pickup as Place,
    dropoff: pool.dropoff as Place,
    pickupDistanceM: km(args.from, pool.pickup),
    dropoffDistanceM: km(args.to, pool.dropoff),
    departTime,
    departsAtMs: !departTime
      ? null
      : bookings.length > 0 && dispatchMs !== null
        ? dispatchMs + DISPATCH_LEAD_MS
        : nextDepartureMs(departTime, nowMs),
    state,
    riders,
    seatsTotal: MAX_POOL_RIDERS,
    seatsLeft: state === 'full' ? 0 : Math.max(0, MAX_POOL_RIDERS - riders),
    fare,
    farePerSeat: poolPerSeatFare(fare, Math.min(MAX_POOL_RIDERS, Math.max(1, paying))),
    fareLadder: Array.from({ length: MAX_POOL_RIDERS }, (_, i) => poolPerSeatFare(fare, i + 1)),
    driver: onCar ? car.driver : null,
    needsDriverApproval: state === 'car' && !!car && WITH_DRIVER.has(car.status) && !inCar,
    booked,
    aboardTripId: inCar ? args.tripId : null,
    mine: pool.createdBy === uid,
  };
}

/** The people a car would be shared with right now, as gender-gate input. */
function aboardOf(card: PoolCard, pool: FirebaseFirestore.DocumentData, trip: FirebaseFirestore.DocumentData | null) {
  if (card.state !== 'gathering' && trip) return trip;
  return { poolRoster: ((pool.bookings as Booking[] | undefined) ?? []).map((b) => ({ uid: b.uid, gender: b.gender })) };
}

// ── getSharedPools ───────────────────────────────────────────────────────────

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const listSchema = z.object({
  city: z.string().trim().min(2).max(40).nullish(),
  from: point.nullish(),
  to: point.nullish(),
  /** "My rides": pools this rider created, holds a seat in, or is riding with. */
  mine: z.boolean().nullish(),
});

/**
 * Pools going the rider's way — both ends within MATCH_RADIUS_M — or, with
 * `mine`, the rider's own. Pools whose car the gender rules keep this rider
 * out of are left out, as in every shared-ride feed: a Join that can only
 * fail is not an offer.
 */
export const getSharedPools = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = listSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid search.');
  const { city, from, to, mine } = parsed.data;
  const nowMs = Date.now();

  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  const myGender = resolveSeatOccupant(userSnap.get('gender'), null).seatGender;
  const myMixedOk = userSnap.get('mixedRideOk') === true;

  let docs: FirebaseFirestore.DocumentSnapshot[];
  if (mine) {
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    const activeTrip = activeTripId ? await db.doc(`trips/${activeTripId}`).get() : null;
    const ridingPoolId = activeTrip?.get('sharedPoolId') as string | undefined;
    const [created, booked, riding] = await Promise.all([
      db.collection('sharedPools').where('createdBy', '==', ctx.uid).limit(50).get(),
      db.collection('sharedPools').where('bookingUids', 'array-contains', ctx.uid).limit(10).get(),
      ridingPoolId ? db.doc(`sharedPools/${ridingPoolId}`).get() : null,
    ]);
    const byId = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const d of created.docs) if (d.get('creatorRemoved') !== true) byId.set(d.id, d);
    for (const d of booked.docs) byId.set(d.id, d);
    if (riding?.exists) byId.set(riding.id, riding);
    docs = [...byId.values()];
  } else {
    if (!city || !from || !to) invalid('Choose a city, a pickup and a drop-off.');
    // shortcut: scans one city's pools (≤300) per search; add a geohash range
    // query once a city holds more pools than that.
    const snap = await db.collection('sharedPools').where('city', '==', city).limit(300).get();
    docs = snap.docs.filter((d) => {
      if (d.get('status') !== 'active') return false;
      const active = timestampMs(d.get('lastActiveAt')) ?? 0;
      if (nowMs - active > STALE_POOL_MS) return false;
      const p = d.get('pickup') as Place;
      const q = d.get('dropoff') as Place;
      return haversineKm(from.lat, from.lng, p.lat, p.lng) * 1000 <= MATCH_RADIUS_M
        && haversineKm(to.lat, to.lng, q.lat, q.lng) * 1000 <= MATCH_RADIUS_M;
    });
  }

  const tripIds = docs.map((d) => d.get('tripId') as string | null).filter((t): t is string => !!t);
  const tripSnaps = tripIds.length ? await db.getAll(...tripIds.map((t) => db.doc(`trips/${t}`))) : [];
  const trips = new Map(tripSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));

  const pools: PoolCard[] = [];
  for (const d of docs) {
    const pool = d.data()!;
    const tripId = (pool.tripId as string | null) ?? null;
    const trip = tripId ? trips.get(tripId) ?? null : null;
    const card = poolCard({ id: d.id, pool, trip, tripId, uid: ctx.uid, nowMs, from: from ?? undefined, to: to ?? undefined });
    // A full car offers no seat, so there is no Join for the gender rules to
    // refuse — it is only on the card to say it left, and that it will be back.
    const offersSeat = card.state !== 'full' && !card.booked && card.aboardTripId === null && !card.mine;
    if (!mine && offersSeat && !poolJoinGenderGate(aboardOf(card, pool, trip), myGender, myMixedOk).allowed) continue;
    pools.push(card);
  }
  pools.sort((a, b) =>
    mine
      ? Number(!!b.aboardTripId) - Number(!!a.aboardTripId) || Number(b.booked) - Number(a.booked)
      : (a.pickupDistanceM ?? 0) - (b.pickupDistanceM ?? 0));
  return { pools };
});

// ── Seats and cars ───────────────────────────────────────────────────────────

/** Let one booking go. Clears the dispatch clock when nobody is left waiting. */
async function releaseBooking(poolRef: FirebaseFirestore.DocumentReference, uid: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(poolRef);
    const bookings = (snap.get('bookings') as Booking[] | undefined) ?? [];
    const rest = bookings.filter((b) => b.uid !== uid);
    if (rest.length === bookings.length) return false;
    tx.update(poolRef, {
      bookings: rest,
      bookingUids: rest.map((b) => b.uid),
      ...(rest.length === 0 ? { dispatchAt: FieldValue.delete() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

/** The booking was already settled by another dispatch (the cron and a join racing) — not a failure. */
class SeatGone extends Error {}

/**
 * Turn one booking into a new car: a shared trip with this rider as its host.
 * The booking leaves the pool in the same transaction the trip is written in,
 * so a seat is never in both places and never in neither.
 */
async function startCar(
  poolRef: FirebaseFirestore.DocumentReference,
  uid: string,
  settings: CancellationSettings,
): Promise<string> {
  const tripRef = db.collection('trips').doc();
  const shareCode = generateShareCode();
  const pool = await db.runTransaction(async (tx) => {
    const [snap, userSnap, walletSnap] = await Promise.all([
      tx.get(poolRef),
      tx.get(db.doc(`users/${uid}`)),
      tx.get(db.doc(`wallets/${uid}`)),
    ]);
    const d = snap.data() ?? {};
    const bookings = (d.bookings as Booking[] | undefined) ?? [];
    if (!bookings.some((b) => b.uid === uid)) throw new SeatGone();
    // Banned, already on a ride, or fees owing: refused here, at the moment a
    // car would be made — a booking for a later time does not hold a ride.
    await assertRiderCanBook(tx, userSnap, walletSnap, settings);
    const seat = resolveSeatOccupant(userSnap.get('gender'), null);

    writeTripDocuments(tx, tripRef, {
      uid,
      rideType: d.rideType as string,
      fare: d.fare as number,
      seats: 1,
      passengerGender: seat.seatGender,
      bookedForOther: seat.bookedForOther,
      pool: true,
      // Public: anyone else going this way can still find and join the car.
      poolVisibility: 'public',
      shareCode,
      paymentMethod: 'cash',
      paymentMethods: ['cash'],
      pickup: d.pickup as Place,
      dropoff: d.dropoff as Place,
      passengerName: (userSnap.get('name') as string | undefined) ?? (userSnap.get('displayName') as string | undefined),
      passengerRating: userSnap.get('rating') as number | undefined,
      passengerRatingCount: userSnap.get('ratingCount') as number | undefined,
      coRiderRating: userSnap.get('coRiderRating') as number | undefined,
      coRiderRatingCount: userSnap.get('coRiderRatingCount') as number | undefined,
      provenance: { sharedPoolId: poolRef.id },
    });
    const rest = bookings.filter((b) => b.uid !== uid);
    tx.update(poolRef, {
      bookings: rest,
      bookingUids: rest.map((b) => b.uid),
      ...(rest.length === 0 ? { dispatchAt: FieldValue.delete() } : {}),
      tripId: tripRef.id,
      runs: FieldValue.increment(1),
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return d;
  });

  await broadcastTripToNearbyDrivers(tripRef.id, pool.pickup as Place, true, pool.rideType as string, { fare: pool.fare as number })
    .catch((err) => logger.error('sharedPools: broadcast failed', { tripId: tripRef.id, err }));
  return tripRef.id;
}

export interface DispatchOutcome {
  tripId: string | null;
  seated: string[];
  /** Waiting on a driver's (or the host's) yes — see joinPoolTripAsRider. */
  asked: string[];
  dropped: { uid: string; reason: string }[];
}

/**
 * Put everybody booked on this pool into a car. One booking at a time, each
 * let go only once it is settled, so a crash halfway leaves the rest booked
 * and the next tick of `dispatchSharedPools` finishes the job.
 *
 * `quiet` is the rider who triggered it from the app: they get the answer on
 * their screen, not a push about it.
 */
export async function dispatchPool(poolId: string, quiet?: string): Promise<DispatchOutcome> {
  const poolRef = db.doc(`sharedPools/${poolId}`);
  const out: DispatchOutcome = { tripId: null, seated: [], asked: [], dropped: [] };
  const settings = await getCancellationSettings();

  for (let i = 0; i <= MAX_POOL_RIDERS; i += 1) {
    const snap = await poolRef.get();
    const next = ((snap.get('bookings') as Booking[] | undefined) ?? [])[0];
    if (!next) break;
    const tripId = snap.get('tripId') as string | null;
    const tripSnap = tripId ? await db.doc(`trips/${tripId}`).get() : null;
    const car = carOf(tripSnap?.data(), Date.now());
    try {
      if (tripSnap && car && (car.joinable || car.members.includes(next.uid))) {
        const res = await joinPoolTripAsRider(next.uid, tripSnap.ref, 'self');
        (res.pending ? out.asked : out.seated).push(next.uid);
        out.tripId = tripSnap.id;
        await releaseBooking(poolRef, next.uid);
      } else {
        out.tripId = await startCar(poolRef, next.uid, settings);
        out.seated.push(next.uid);
      }
    } catch (e) {
      if (e instanceof SeatGone) continue;
      const reason = e instanceof HttpsError ? e.message : 'Something went wrong on our side.';
      if (!(e instanceof HttpsError)) logger.warn('sharedPools: dispatch failed for rider', { poolId, uid: next.uid, err: String(e) });
      await releaseBooking(poolRef, next.uid);
      out.dropped.push({ uid: next.uid, reason });
    }
  }

  const label = await poolRef.get().then((s) => (s.get('label') as string | null) ?? 'Your shared ride');
  const tell = out.tripId ? { tripId: out.tripId } : undefined;
  await Promise.all([
    ...out.seated.filter((u) => u !== quiet).map((u) => notifyUser(
      u, '🚗 Finding your driver',
      `${label}: your car is on and drivers nearby are being asked now. You will hear the moment one accepts.`,
      'ride', tell,
    )),
    ...out.dropped.filter((d) => d.uid !== quiet).map((d) => notifyUser(
      d.uid, 'Your shared-ride seat was let go', `${label}: ${d.reason}`, 'ride',
    )),
  ].map((p) => p.catch(() => {})));
  if (out.tripId) logger.info('sharedPools: car sent', { poolId, ...out });
  return out;
}

export type SeatResult =
  | { status: 'seated' | 'asked'; tripId: string; perSeatFare: number }
  | { status: 'booked'; tripId: null; perSeatFare: number; departsAtMs: number | null };

/**
 * Take a seat on a pool: in its car when one is on and has room, else a
 * booking for the next car — which, for a pool with no time or a booking that
 * fills it, is sent at once.
 */
async function seatOnPool(uid: string, poolId: string): Promise<SeatResult> {
  const poolRef = db.doc(`sharedPools/${poolId}`);
  const snap = await poolRef.get();
  if (!snap.exists || snap.get('status') !== 'active') {
    throw new HttpsError('not-found', 'This shared ride is no longer running.');
  }

  // A car already on with room: take a seat in it like any shared ride.
  const tripId = snap.get('tripId') as string | null;
  if (tripId) {
    const tripRef = db.doc(`trips/${tripId}`);
    const car = carOf((await tripRef.get()).data(), Date.now());
    if (car && !car.ended && (car.joinable || car.members.includes(uid))) {
      const res = await joinPoolTripAsRider(uid, tripRef, 'self');
      await poolRef.update({ lastActiveAt: FieldValue.serverTimestamp() });
      return { status: res.pending ? 'asked' : 'seated', tripId, perSeatFare: res.perSeatFare };
    }
  }

  const held = await db.collection('sharedPools').where('bookingUids', 'array-contains', uid).get();
  if (held.docs.filter((d) => d.id !== poolId).length >= MAX_BOOKINGS_PER_RIDER) {
    throw new HttpsError('failed-precondition', 'You already hold seats on two shared rides. Cancel one first.');
  }

  // The first seat of a new car is priced fresh; later seats keep that price,
  // so nobody's fare moves while the car is filling.
  const fresh = ((snap.get('bookings') as Booking[] | undefined) ?? []).length === 0
    ? await sharedRideFare(snap.get('rideType') as string, snap.get('pickup') as Place, snap.get('dropoff') as Place)
    : null;
  const settings = await getCancellationSettings();
  const nowMs = Date.now();

  const booked = await db.runTransaction(async (tx) => {
    const [poolSnap, userSnap, walletSnap] = await Promise.all([
      tx.get(poolRef),
      tx.get(db.doc(`users/${uid}`)),
      tx.get(db.doc(`wallets/${uid}`)),
    ]);
    const d = poolSnap.data() ?? {};
    const bookings = (d.bookings as Booking[] | undefined) ?? [];
    const fare = bookings.length === 0 && fresh ? fresh.fare : (d.fare as number);
    const departTime = (d.departTime as string | null) ?? null;
    const dueMs = bookings.length > 0
      ? timestampMs(d.dispatchAt) ?? nowMs
      : departTime ? nextDepartureMs(departTime, nowMs) - DISPATCH_LEAD_MS : nowMs;
    if (bookings.some((b) => b.uid === uid)) return { count: bookings.length, dueMs, fare, departTime };
    if (bookings.length >= MAX_POOL_RIDERS) {
      throw new HttpsError('failed-precondition', 'This shared ride is full. The next car opens two minutes after it leaves.');
    }
    if (userSnap.get('banned') === true) {
      throw new HttpsError('permission-denied', 'This account cannot book rides. Contact support.');
    }
    assertOutstandingClear(walletSnap, settings, 'passenger');
    const seat = resolveSeatOccupant(userSnap.get('gender'), null);
    const gate = poolJoinGenderGate(
      { poolRoster: bookings.map((b) => ({ uid: b.uid, gender: b.gender })) },
      seat.seatGender,
      userSnap.get('mixedRideOk') === true,
    );
    if (!gate.allowed) throw new HttpsError('permission-denied', gate.reason);

    const next: Booking[] = [...bookings, {
      uid,
      firstName: firstNameOf(userSnap.get('name') ?? userSnap.get('displayName')),
      gender: seat.seatGender,
      bookedAt: Timestamp.now(),
    }];
    tx.update(poolRef, {
      bookings: next,
      bookingUids: next.map((b) => b.uid),
      fare,
      dispatchAt: Timestamp.fromMillis(dueMs),
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { count: next.length, dueMs, fare, departTime };
  });

  if (booked.count >= MAX_POOL_RIDERS || booked.dueMs <= Date.now()) {
    const sent = await dispatchPool(poolId, uid);
    const dropped = sent.dropped.find((d) => d.uid === uid);
    if (dropped) throw new HttpsError('failed-precondition', dropped.reason);
    if (sent.tripId && (sent.seated.includes(uid) || sent.asked.includes(uid))) {
      const trip = (await db.doc(`trips/${sent.tripId}`).get()).data() ?? {};
      const fares = trip.poolFares as Record<string, number> | undefined;
      const riders = ((trip.poolMembers as string[] | undefined) ?? []).length || 1;
      return {
        status: sent.asked.includes(uid) ? 'asked' : 'seated',
        tripId: sent.tripId,
        perSeatFare: fares?.[uid] ?? (trip.poolPerSeatFare as number | undefined) ?? poolPerSeatFare(booked.fare, riders),
      };
    }
  }
  return {
    status: 'booked',
    tripId: null,
    perSeatFare: poolPerSeatFare(booked.fare, booked.count),
    departsAtMs: booked.departTime ? booked.dueMs + DISPATCH_LEAD_MS : null,
  };
}

// ── Callables ────────────────────────────────────────────────────────────────

const place = point.extend({ address: z.string().trim().min(1).max(200) });
const createSchema = z.object({
  /** A PAKISTAN_CITIES id from the app, e.g. 'islamabad'. Scopes search. */
  city: z.string().trim().regex(/^[a-z_]{2,40}$/),
  /** "Bahria University, E-8" — a name people recognise. Matching never uses it. */
  label: z.string().trim().max(60).nullish(),
  /** Daily "HH:MM" Pakistan time, or null: leaves as soon as a driver takes it. */
  departTime: z.string().regex(HHMM).nullish(),
  rideType: z.enum(['mini', 'ac']).default('mini'),
  pickup: place,
  dropoff: place,
});

/** Start a pool and take its first seat. */
export const createSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'createSharedPool', 10, 3600);
  const parsed = createSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid shared ride.');
  const d = parsed.data;
  const km = haversineKm(d.pickup.lat, d.pickup.lng, d.dropoff.lat, d.dropoff.lng);
  if (km < 0.5) invalid('Pickup and drop-off are the same place.');
  if (km > 80) invalid('That is another city — book it from City to City.');

  const quote = await sharedRideFare(d.rideType, d.pickup, d.dropoff);
  const ref = db.collection('sharedPools').doc();
  await ref.set({
    city: d.city,
    label: d.label || null,
    pickup: d.pickup,
    dropoff: d.dropoff,
    departTime: d.departTime ?? null,
    rideType: d.rideType,
    fare: quote.fare,
    createdBy: ctx.uid,
    creatorRemoved: false,
    bookings: [],
    bookingUids: [],
    tripId: null,
    runs: 0,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastActiveAt: FieldValue.serverTimestamp(),
  });
  try {
    return { poolId: ref.id, ...(await seatOnPool(ctx.uid, ref.id)) };
  } catch (e) {
    // A pool its own creator could not get into is not one anybody asked for.
    await ref.delete().catch(() => {});
    throw e;
  }
});

/** Take a seat on somebody's pool. */
export const joinSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'joinSharedPool', 10, 60);
  const parsed = z.object({ poolId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a shared ride.');
  return seatOnPool(ctx.uid, parsed.data.poolId);
});

/**
 * Give back a booked seat. Free: no driver has committed to anything. A rider
 * already in the pool's car cancels from the ride screen, where the ordinary
 * cancellation rules apply.
 */
export const leaveSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ poolId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a shared ride.');
  const poolRef = db.doc(`sharedPools/${parsed.data.poolId}`);
  if (await releaseBooking(poolRef, ctx.uid)) return { ok: true };
  throw new HttpsError('failed-precondition', 'You hold no seat here. If you are in the car, cancel from your ride.');
});

const editSchema = z.object({
  poolId: docId,
  label: z.string().trim().max(60).nullish(),
  departTime: z.string().regex(HHMM).nullable().optional(),
  /** Off the creator's "My rides". The pool itself stays for everybody else. */
  remove: z.boolean().nullish(),
});

/** The creator renames, retimes or removes their pool from their own list. */
export const editSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = editSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid change.');
  const { poolId, label, departTime, remove } = parsed.data;
  const poolRef = db.doc(`sharedPools/${poolId}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(poolRef);
    if (!snap.exists) throw new HttpsError('not-found', 'This shared ride no longer exists.');
    if (snap.get('createdBy') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Only the person who started this shared ride can change it.');
    }
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (remove) update.creatorRemoved = true;
    if (label !== undefined) update.label = label || null;
    if (departTime !== undefined && departTime !== (snap.get('departTime') ?? null)) {
      const bookings = (snap.get('bookings') as Booking[] | undefined) ?? [];
      // Riders booked for 08:00 did not agree to 09:00.
      if (bookings.some((b) => b.uid !== ctx.uid)) {
        throw new HttpsError('failed-precondition', 'Others have booked seats for this time, so it cannot change now.');
      }
      update.departTime = departTime;
      if (bookings.length > 0) {
        update.dispatchAt = Timestamp.fromMillis(
          departTime ? nextDepartureMs(departTime, Date.now()) - DISPATCH_LEAD_MS : Date.now(),
        );
      }
    }
    tx.update(poolRef, update);
  });
  return { ok: true };
});

/**
 * The clock for pools with a time: every booking whose car is due goes to
 * drivers. Also finishes any dispatch a crash left halfway — every booking
 * keeps `dispatchAt` until it is settled.
 */
export const dispatchSharedPools = onSchedule(
  { schedule: 'every 2 minutes', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    const due = await db.collection('sharedPools')
      .where('dispatchAt', '<=', Timestamp.now())
      .limit(50)
      .get();
    for (const doc of due.docs) {
      try {
        await dispatchPool(doc.id);
      } catch (e) {
        logger.warn('sharedPools: dispatch tick failed', { poolId: doc.id, err: String(e) });
      }
    }
  },
);
