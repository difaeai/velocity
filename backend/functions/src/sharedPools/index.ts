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
 *   a BOOKING    an entry in pool.bookings: a seat held for the next car, with
 *                the rider's OWN pickup and drop-off on the route and their own
 *                solo fare. PENDING — no driver has said yes and nobody is in a
 *                car — and it sets no activeTripId, so an 08:00 seat booked the
 *                night before never stops the rider taking another ride.
 *   the RIDE     an ordinary shared trip (trips/{id}), made from the bookings by
 *                `dispatchPool`. Drivers, OTP, cash, drop-offs — exactly as every
 *                other shared ride; each rider pays their own route at the car's
 *                tier (trips/poolPricing) and can leave it (trips/poolLeave).
 *   the DRIVER   whoever takes that trip: a driver who accepted the pool ahead of
 *                time (`acceptSharedPool`, or one who posted the route himself —
 *                `offerDriverRoute`) gets it the moment it exists; otherwise the
 *                first nearby driver to accept at the fixed fare.
 *
 * WHEN A CAR IS SENT. A pool with no time sends one the moment somebody books.
 * A pool with a time sends one DISPATCH_LEAD_MS before it — or the moment its
 * last seat is booked, because a full car has nobody left to wait for. No
 * minimum: one booked rider still gets a car.
 *
 * MATCHING. A rider's journey is on a pool when both ends are within 1 km of
 * its route, going the same way, over at least half of it (`routeFit`) — not
 * merely "two points near two points". Pools a short walk further away come back
 * separately as "also going your way", met at the car's own pickup.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { geohashForLocation, geohashQueryBounds } from 'geofire-common';

import { db, FieldValue, SCHEDULE_REGION, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAuth, requireRole } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { notifyUser, sendToUsers } from '../lib/fcm';
import { resolveSeatOccupant } from '../lib/seatGender';
import { computeGenderAccess } from '../lib/genderAccess';
import { queryNearbyDriverDocs } from '../lib/nearbyDrivers';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import type { DriverPublicInfo } from '../domain/types';
import { assertOutstandingClear, getCancellationSettings, type CancellationSettings } from '../domain/cancellation';
import { assertCommissionClear, getCommissionSettings } from '../domain/commission';
import { pktDayKey } from '../domain/dailyTarget';
import { assertVehicleConfirmed } from '../domain/vehicleCheck';
import { assertFaceCheckedIn } from '../domain/faceCheckIn';
import { sharedRideFare } from '../fare/sharedRideFare';
import { assertRiderCanBook, broadcastTripToNearbyDrivers, haversineKm, lockInBid } from '../trips';
import { generateShareCode, writeTripDocuments } from '../trips/poolTripFactory';
import { joinPoolTripAsRider, POOL_JOIN_WINDOW_MS } from '../trips/poolShare';
import { firstNameOf, hostRosterEntry, rosterForTrip } from '../trips/poolRoster';
import { poolJoinGenderGate } from '../trips/enRoute';
import {
  orderStops,
  priceCar,
  priceInOrder,
  priceJoin,
  routeFit,
  sharedCarRiders,
  type PricedRider,
  type RiderStops,
} from '../trips/poolPricing';
import { timestampMs } from '../poolRides/lifecycle';

/** A rider's pickup and drop-off must each be this close to the pool's route. */
export const MATCH_RADIUS_M = 1000;
/** "From your area": a search lists every car leaving within this of the rider's pickup. */
export const NEARBY_RADIUS_M = 2500;
/** A car that filled stays on the card this long; then the pool is empty again. */
export const FULL_HOLD_MS = 2 * 60 * 1000;
/** A pool with a time asks drivers this long before it, so the car is there on time. */
export const DISPATCH_LEAD_MS = 10 * 60 * 1000;
/** A car still without a driver this long after it went out: its riders are told. */
export const NO_DRIVER_ALERT_MS = 8 * 60 * 1000;
/**
 * The owner's start (2026-10-30): a car starts when its driver taps Start — or
 * by itself this long after it went out, once a driver has it.
 */
export const AUTO_START_MS = 10 * 60 * 1000;
/** "Leaving around 8:00" matches departures this close to it. */
export const TIME_WINDOW_MS = 60 * 60 * 1000;
/** A driver is shown shared rides with a pickup this close. */
const DRIVER_RADIUS_M = 15_000;
/** A driver's route catches pools whose ends are this close to it. */
const DRIVER_ROUTE_RADIUS_M = 1500;
/** A driver who posts "leaving now" is held to it this long. */
const NOW_OFFER_MS = 2 * 60 * 60 * 1000;
/** Seats one rider may hold at once — there and back on the same day. */
const MAX_BOOKINGS_PER_RIDER = 2;
/** A pool nobody has booked for this long stops turning up in search. */
const STALE_POOL_MS = 30 * 24 * 60 * 60 * 1000;
/** Pakistan Standard Time, UTC+5 all year (no daylight saving since 2009). */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Driver statuses in which a car has a driver and has not left yet. */
const WITH_DRIVER = new Set(['matched', 'arriving', 'arrived']);

type Place = { lat: number; lng: number; address: string };

/** A seat held for the next car. A plain Timestamp: Firestore refuses sentinels in arrays. */
interface Booking {
  uid: string;
  firstName: string;
  /** The seat's gender — see lib/seatGender. */
  gender: string;
  bookedAt: FirebaseFirestore.Timestamp;
  /** Their own stops on the route and their own solo fare. Older bookings: the pool's. */
  pickup?: Place;
  dropoff?: Place;
  soloFare?: number;
}

/** The driver who said yes to the pool's next car before it existed. */
interface PoolDriver {
  uid: string;
  name: string;
  vehicle: string;
  plate: string;
  acceptedAtMs: number;
  /** The departure they accepted; null for a pool that leaves on demand. */
  forDepartureMs: number | null;
}

/** Epoch-ms of the next HH:MM in Pakistan time that is still ahead of `nowMs`. */
export function nextDepartureMs(hhmm: string, nowMs: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const pkt = new Date(nowMs + PKT_OFFSET_MS);
  const today = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate(), h, m) - PKT_OFFSET_MS;
  return today > nowMs ? today : today + DAY_MS;
}

/** The departure the pool's bookings are for (or its next one); null when it leaves on demand. */
export function departureOf(pool: FirebaseFirestore.DocumentData, nowMs: number): number | null {
  const departTime = (pool.departTime as string | null) ?? null;
  if (!departTime) return null;
  const dispatchMs = timestampMs(pool.dispatchAt);
  return ((pool.bookings as Booking[] | undefined) ?? []).length > 0 && dispatchMs !== null
    ? dispatchMs + DISPATCH_LEAD_MS
    : nextDepartureMs(departTime, nowMs);
}

/** The driver who accepted the pool's next car ahead of time, while that still holds. */
export function aheadDriver(pool: FirebaseFirestore.DocumentData, nowMs: number): PoolDriver | null {
  const d = pool.driver as PoolDriver | null | undefined;
  if (!d?.uid) return null;
  const until = d.forDepartureMs === null ? d.acceptedAtMs + NOW_OFFER_MS : d.forDepartureMs + HOUR_MS;
  return until > nowMs ? d : null;
}

const bookingStops = (b: Booking, pool: FirebaseFirestore.DocumentData): RiderStops => ({
  pickup: b.pickup ?? (pool.pickup as Place),
  dropoff: b.dropoff ?? (pool.dropoff as Place),
  soloFare: b.soloFare ?? (pool.fare as number),
});

const bookedRiders = (bookings: Booking[], pool: FirebaseFirestore.DocumentData): PricedRider[] =>
  bookings.map((b) => ({ uid: b.uid, soloFare: b.soloFare ?? (pool.fare as number) }));

/**
 * True when the gender rules close the car's remaining seats — a mixed car of
 * three (lib/genderAccess, "the third rider makes seating uncomfortable"). Its
 * empty seat is not one anybody can be offered, so it is not shown as one.
 */
function closedForComfort(genders: string[]): boolean {
  const male = genders.filter((g) => g === 'male').length;
  const female = genders.filter((g) => g === 'female').length;
  return genders.length < MAX_POOL_RIDERS && computeGenderAccess(male, female, MAX_POOL_RIDERS, 'any') === 'none';
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
    // Started: the driver is collecting its riders, and the box is the next car's.
    joinable: !full && !trip.poolStartedAt && (gathering || WITH_DRIVER.has(status)),
    /** When the last seat went: the newest roster entry. */
    filledAtMs: full ? Math.max(0, ...rosterForTrip(trip).map((r) => timestampMs(r.joinedAt) ?? 0)) : null,
    fare: (trip.fare as number | null) ?? (trip.offeredFare as number),
    gross: typeof trip.poolDriverGross === 'number' ? (trip.poolDriverGross as number) : null,
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
   * gathering — seats are being booked for the next car; no car yet.
   * car       — a car is out, still taking riders; `driver` once one accepted.
   * full      — the car just filled (FULL_HOLD_MS); after that, gathering again.
   */
  state: 'gathering' | 'car' | 'full';
  riders: number;
  seatsTotal: number;
  seatsLeft: number;
  /** The car's own route fare. */
  fare: number;
  /** What THIS rider pays if they join now (or pays now, if already in). */
  farePerSeat: number;
  /** This rider's own route at 1, 2, 3, 4 riders. */
  fareLadder: number[];
  /** This rider's own route, alone: the most their share can ever be. */
  soloFare: number;
  driver: { name: string; vehicle: string; plate: string } | null;
  /** The driver accepted the next car before it went out. */
  driverAhead: boolean;
  /** Joining asks the driver rather than taking the seat. */
  needsDriverApproval: boolean;
  /** This rider holds a seat for the next car. */
  booked: boolean;
  /** This rider is in the pool's car — open it. */
  aboardTripId: string | null;
  /** This rider created the pool. */
  mine: boolean;
  /** Outside the 1 km match: the rider walks to the car's own pickup and from its drop-off. */
  nearby: boolean;
  /**
   * Real cars (owner, 2026-10-30): the accepted driver's own (`carIsDrivers`),
   * else up to five nearby online cars that could come. Empty: the stock car.
   */
  carPhotos: string[];
  carIsDrivers: boolean;
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
  /** The asking rider's own route, alone — null when they would ride the pool's own. */
  mySolo?: number | null;
  nearby?: boolean;
}): PoolCard {
  const { pool, uid, nowMs, trip } = args;
  const car = carOf(trip, nowMs);
  const inCar = !!car && !car.ended && car.members.includes(uid);
  const state: PoolCard['state'] = car?.joinable
    ? 'car'
    : car?.full && !car.ended && car.filledAtMs !== null && nowMs - car.filledAtMs < FULL_HOLD_MS
      ? 'full'
      : 'gathering';

  const bookings = (pool.bookings as Booking[] | undefined) ?? [];
  const booking = bookings.find((b) => b.uid === uid);
  const onCar = state !== 'gathering' && !!car && !!trip;
  const riders = onCar ? sharedCarRiders(trip!, car!.members) : bookedRiders(bookings, pool);
  const current = onCar
    ? {
        fares: (trip!.poolFares as Record<string, number> | undefined) ?? priceCar(riders).fares,
        gross: car!.gross ?? priceCar(riders).gross,
      }
    : priceInOrder(riders);
  const involved = !!booking || inCar;
  const ownSolo = involved
    ? riders.find((r) => r.uid === uid)?.soloFare ?? (pool.fare as number)
    : args.mySolo ?? (pool.fare as number);
  const farePerSeat = involved
    ? current.fares[uid] ?? poolPerSeatFare(ownSolo, riders.length)
    : state === 'full'
      ? poolPerSeatFare(car!.fare, car!.members.length)
      : priceJoin(riders, { uid: '__joiner__', soloFare: ownSolo }, current.gross).joinerFare;
  const ahead = onCar ? null : aheadDriver(pool, nowMs);
  const departTime = (pool.departTime as string | null) ?? null;
  const closed = closedForComfort(onCar ? rosterForTrip(trip!).map((r) => r.gender) : bookings.map((b) => b.gender));

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
    departsAtMs: departureOf(pool, nowMs),
    state,
    riders: riders.length,
    seatsTotal: MAX_POOL_RIDERS,
    seatsLeft: state === 'full' || closed ? 0 : Math.max(0, MAX_POOL_RIDERS - riders.length),
    fare: onCar ? car!.fare : (pool.fare as number),
    farePerSeat,
    fareLadder: Array.from({ length: MAX_POOL_RIDERS }, (_, i) => poolPerSeatFare(ownSolo, i + 1)),
    soloFare: ownSolo,
    driver: onCar ? car!.driver : ahead ? { name: ahead.name, vehicle: ahead.vehicle, plate: ahead.plate } : null,
    driverAhead: !!ahead,
    needsDriverApproval: state === 'car' && !!car && WITH_DRIVER.has(car.status) && !inCar,
    booked: !!booking,
    aboardTripId: inCar ? args.tripId : null,
    mine: pool.createdBy === uid,
    nearby: args.nearby === true,
    // Filled in by getSharedPools (attachCarPhotos), which reads the drivers.
    carPhotos: [],
    carIsDrivers: false,
  };
}

/** The people a car would be shared with right now, as gender-gate input. */
function aboardOf(card: PoolCard, pool: FirebaseFirestore.DocumentData, trip: FirebaseFirestore.DocumentData | null) {
  if (card.state !== 'gathering' && trip) return trip;
  // `sharedPoolId` puts the next car under the shared-ride gender rule too.
  return {
    sharedPoolId: card.id,
    poolRoster: ((pool.bookings as Booking[] | undefined) ?? []).map((b) => ({ uid: b.uid, gender: b.gender })),
  };
}

/** Whether a pool still counts: open, and booked within the last month. */
const live = (d: FirebaseFirestore.DocumentSnapshot, nowMs: number) =>
  d.get('status') === 'active' && nowMs - (timestampMs(d.get('lastActiveAt')) ?? 0) <= STALE_POOL_MS;

/** Does a pool's next departure suit "leaving around `at`"? On-demand pools suit "soon". */
function suitsTime(pool: FirebaseFirestore.DocumentData, at: number, nowMs: number): boolean {
  const dep = departureOf(pool, nowMs);
  return dep === null ? at - nowMs <= TIME_WINDOW_MS / 2 : Math.abs(dep - at) <= TIME_WINDOW_MS;
}

// ── getSharedPools ───────────────────────────────────────────────────────────

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const place = point.extend({ address: z.string().trim().min(1).max(200) });
const listSchema = z.object({
  city: z.string().trim().min(2).max(40).nullish(),
  from: point.nullish(),
  to: point.nullish(),
  /** Leaving around this time, epoch-ms. Absent: any time. */
  at: z.number().int().positive().nullish(),
  /** "My rides": pools this rider created, holds a seat in, or is riding with. */
  mine: z.boolean().nullish(),
});

/** The most cards one search returns. */
const MAX_CARDS = 40;

/**
 * The owner's list (2026-10-30), as `pools`, in order:
 *
 *   - Before a search (no `to`): every shared ride in the city — the rider's
 *     own first, then the nearest pickup to `from`.
 *   - With `from` and `to`: the related ones — on the rider's route (they are
 *     dropped at their own stop, so they come first), then the rest leaving
 *     from within NEARBY_RADIUS_M of their pickup, nearest drop-off to theirs
 *     first. Those are `nearby`: met at the car's pickup, left at its drop-off.
 *
 * With `mine`, the rider's own. Every price is THIS rider's: on their route,
 * their own route at the car's tier; otherwise the car's own route. Pools whose
 * car the gender rules keep this rider out of are left out, as in every
 * shared-ride feed: a Join that can only fail is no offer.
 */
export const getSharedPools = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = listSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid search.');
  const { city, from, to, at, mine } = parsed.data;
  const nowMs = Date.now();

  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  const myGender = resolveSeatOccupant(userSnap.get('gender'), null).seatGender;
  const myMixedOk = userSnap.get('mixedRideOk') === true;

  /** Each candidate pool and whether the rider would walk to it, in list order. */
  let picked: { doc: FirebaseFirestore.DocumentSnapshot; nearby: boolean }[];
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
    picked = [...byId.values()].map((doc) => ({ doc, nearby: false }));
  } else {
    if (!city) invalid('Choose a city.');
    // shortcut: scans one city's pools (≤300) per search; switch to the
    // pickupGeohash range query (as getDriverPools does) past a few hundred.
    const snap = await db.collection('sharedPools').where('city', '==', city).limit(300).get();
    const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
      haversineKm(a.lat, a.lng, b.lat, b.lng) * 1000;
    // Any rank past every on-route one: those come first.
    const LATER = 1e9;
    const ranked: { doc: FirebaseFirestore.DocumentSnapshot; nearby: boolean; rank: number }[] = [];
    for (const d of snap.docs) {
      if (!live(d, nowMs) || (at && !suitsTime(d.data(), at, nowMs))) continue;
      const inIt = ((d.get('bookingUids') as string[] | undefined) ?? []).includes(ctx.uid);
      // Deleted by its creator: gone from their screen, still open to everyone else.
      if (d.get('createdBy') === ctx.uid && d.get('creatorRemoved') === true && !inIt) continue;
      const route = { pickup: d.get('pickup') as Place, dropoff: d.get('dropoff') as Place };
      if (from && to) {
        if (routeFit(route, from, to, MATCH_RADIUS_M)) {
          ranked.push({ doc: d, nearby: false, rank: metres(from, route.pickup) });
        } else if (metres(from, route.pickup) <= NEARBY_RADIUS_M) {
          ranked.push({ doc: d, nearby: true, rank: LATER + metres(to, route.dropoff) });
        }
      } else {
        const yours = inIt || d.get('createdBy') === ctx.uid;
        ranked.push({ doc: d, nearby: true, rank: (yours ? 0 : LATER) + (from ? metres(from, route.pickup) : 0) });
      }
    }
    picked = ranked.sort((a, b) => a.rank - b.rank).slice(0, MAX_CARDS);
  }

  const tripIds = picked.map((p) => p.doc.get('tripId') as string | null).filter((t): t is string => !!t);
  const tripSnaps = tripIds.length ? await db.getAll(...tripIds.map((t) => db.doc(`trips/${t}`))) : [];
  const trips = new Map(tripSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));

  // This rider's own route, alone, per car type — what every one of their prices is built on.
  const quotes = new Map<string, Promise<number>>();
  const mySoloFor = (rideType: string): Promise<number> => {
    if (!quotes.has(rideType)) quotes.set(rideType, sharedRideFare(rideType, from!, to!).then((q) => q.fare));
    return quotes.get(rideType)!;
  };

  const pools: PoolCard[] = [];
  /** Card id → the uid of the driver who accepted it, for their car's photo. */
  const accepted = new Map<string, string>();
  for (const { doc, nearby: walk } of picked) {
    const pool = doc.data()!;
    const tripId = (pool.tripId as string | null) ?? null;
    const trip = tripId ? trips.get(tripId) ?? null : null;
    const mySolo = !mine && !walk && from && to ? await mySoloFor((pool.rideType as string) ?? 'mini') : null;
    const card = poolCard({
      id: doc.id, pool, trip, tripId, uid: ctx.uid, nowMs,
      from: from ?? undefined, to: to ?? undefined, mySolo, nearby: walk,
    });
    // A full car offers no seat, so there is no Join for the gender rules to
    // refuse — it is only on the card to say it left, and that it will be back.
    const offersSeat = card.state !== 'full' && !card.booked && card.aboardTripId === null && !card.mine;
    if (!mine && offersSeat && !poolJoinGenderGate(aboardOf(card, pool, trip), myGender, myMixedOk).allowed) continue;
    const driverUid = !card.driver ? null
      : card.driverAhead ? aheadDriver(pool, nowMs)?.uid ?? null
      : (trip?.driverId as string | undefined) ?? null;
    if (driverUid) accepted.set(card.id, driverUid);
    pools.push(card);
  }
  if (mine) {
    pools.sort((a, b) => Number(!!b.aboardTripId) - Number(!!a.aboardTripId) || Number(b.booked) - Number(a.booked));
  }
  await attachCarPhotos(pools, accepted, from ?? null).catch((e) =>
    logger.warn('sharedPools: car photos failed', { err: String(e) }));
  return { pools };
});

/** A driver's car as riders see it: their latest car check, else the photo it was registered with. */
const carPhotoOf = (d: FirebaseFirestore.DocumentSnapshot): string | null =>
  (d.get('vehicleCheck.photoUrl') as string | null | undefined)
  ?? (d.get('vehiclePhotoDocUrl') as string | null | undefined)
  ?? null;

/** How many nearby cars a box nobody has accepted shows, and how far it looks for them. */
const POSSIBLE_CARS = 5;
const POSSIBLE_CARS_RADIUS_M = 8000;
/** Online drivers' cars per ~5 km cell, briefly: a rider's screen asks every 20 seconds. */
const NEARBY_CARS_TTL_MS = 60_000;
const nearbyCarsCache = new Map<string, { atMs: number; cars: { photo: string; at: { lat: number; lng: number } }[] }>();
/** For tests, which change drivers between searches faster than the cache forgets. */
export const clearNearbyCarsCache = () => nearbyCarsCache.clear();

async function nearbyCars(near: { lat: number; lng: number }) {
  const cell = geohashForLocation([near.lat, near.lng], 5);
  const hit = nearbyCarsCache.get(cell);
  if (hit && Date.now() - hit.atMs < NEARBY_CARS_TTL_MS) return hit.cars;
  const cars = (await queryNearbyDriverDocs(near.lat, near.lng, POSSIBLE_CARS_RADIUS_M))
    .map((d) => ({ photo: carPhotoOf(d), at: d.get('lastLocation') as { lat: number; lng: number } | undefined }))
    .filter((c): c is { photo: string; at: { lat: number; lng: number } } =>
      !!c.photo && typeof c.at?.lat === 'number' && typeof c.at?.lng === 'number');
  nearbyCarsCache.set(cell, { atMs: Date.now(), cars });
  return cars;
}

/**
 * Real cars on the boxes (owner, 2026-10-30): a box a driver has accepted
 * shows that driver's own car; one nobody has accepted shows up to
 * POSSIBLE_CARS of the online cars nearest its pickup — the cars that could
 * come. With none, `carPhotos` stays empty and the app shows its stock car.
 */
async function attachCarPhotos(
  cards: PoolCard[],
  accepted: Map<string, string>,
  near: { lat: number; lng: number } | null,
): Promise<void> {
  const uids = [...new Set(accepted.values())];
  const [drivers, cars] = await Promise.all([
    uids.length ? db.getAll(...uids.map((u) => db.doc(`drivers/${u}`))) : Promise.resolve([]),
    near && cards.some((c) => !accepted.has(c.id)) ? nearbyCars(near) : Promise.resolve([]),
  ]);
  const photoOf = new Map(drivers.map((d) => [d.id, carPhotoOf(d)]));
  for (const card of cards) {
    const uid = accepted.get(card.id);
    if (uid) {
      const photo = photoOf.get(uid);
      card.carPhotos = photo ? [photo] : [];
      card.carIsDrivers = true;
    } else {
      card.carPhotos = cars
        .map((c) => ({ photo: c.photo, km: haversineKm(c.at.lat, c.at.lng, card.pickup.lat, card.pickup.lng) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, POSSIBLE_CARS)
        .map((c) => c.photo);
    }
  }
}

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
 * Turn one booking into a new car: a shared trip with this rider as its host,
 * on the pool's route, priced at their own solo fare. The booking leaves the
 * pool in the same transaction the trip is written in, so a seat is never in
 * both places and never in neither. Nobody is told yet — `dispatchPool` seats
 * the rest first, then hands the car to its driver.
 */
async function startCar(
  poolRef: FirebaseFirestore.DocumentReference,
  uid: string,
  settings: CancellationSettings,
): Promise<string> {
  const tripRef = db.collection('trips').doc();
  const shareCode = generateShareCode();
  await db.runTransaction(async (tx) => {
    const [snap, userSnap, walletSnap] = await Promise.all([
      tx.get(poolRef),
      tx.get(db.doc(`users/${uid}`)),
      tx.get(db.doc(`wallets/${uid}`)),
    ]);
    const d = snap.data() ?? {};
    const bookings = (d.bookings as Booking[] | undefined) ?? [];
    const booking = bookings.find((b) => b.uid === uid);
    if (!booking) throw new SeatGone();
    // Banned, already on a ride, or fees owing: refused here, at the moment a
    // car would be made — a booking for a later time does not hold a ride.
    await assertRiderCanBook(tx, userSnap, walletSnap, settings);
    const seat = resolveSeatOccupant(userSnap.get('gender'), null);
    const own = bookingStops(booking, d);
    const name = (userSnap.get('name') as string | undefined) ?? (userSnap.get('displayName') as string | undefined);

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
      passengerName: name,
      passengerRating: userSnap.get('rating') as number | undefined,
      passengerRatingCount: userSnap.get('ratingCount') as number | undefined,
      coRiderRating: userSnap.get('coRiderRating') as number | undefined,
      coRiderRatingCount: userSnap.get('coRiderRatingCount') as number | undefined,
      // One rider so far, paying their own route alone (trips/poolPricing).
      provenance: {
        sharedPoolId: poolRef.id,
        poolSoloFares: { [uid]: own.soloFare },
        poolFares: { [uid]: own.soloFare },
        poolDriverGross: own.soloFare,
      },
    });
    // The host is collected and dropped at their own stops too.
    tx.set(tripRef, {
      poolRoster: [hostRosterEntry({
        uid,
        name,
        gender: seat.seatGender,
        bookedForOther: seat.bookedForOther,
        coRiderRating: userSnap.get('coRiderRating'),
        coRiderRatingCount: userSnap.get('coRiderRatingCount'),
        pickup: own.pickup,
        dropoff: own.dropoff,
      })],
    }, { merge: true });
    tx.set(tripRef.collection('stops').doc(uid), {
      pickup: own.pickup,
      dropoff: own.dropoff,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.doc(`openRequests/${tripRef.id}`), { poolDriverGross: own.soloFare }, { merge: true });

    const rest = bookings.filter((b) => b.uid !== uid);
    tx.update(poolRef, {
      bookings: rest,
      bookingUids: rest.map((b) => b.uid),
      ...(rest.length === 0 ? { dispatchAt: FieldValue.delete() } : {}),
      tripId: tripRef.id,
      runs: FieldValue.increment(1),
      noDriverCheckAt: Timestamp.fromMillis(Date.now() + NO_DRIVER_ALERT_MS),
      autoStartAt: Timestamp.fromMillis(Date.now() + AUTO_START_MS),
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return tripRef.id;
}

/** Give a car to the driver who accepted it ahead of time — the same lock-in a bid uses. */
async function lockToDriver(tripId: string, driverUid: string): Promise<void> {
  const [tripSnap, userSnap, driverSnap] = await Promise.all([
    db.doc(`trips/${tripId}`).get(),
    db.doc(`users/${driverUid}`).get(),
    db.doc(`drivers/${driverUid}`).get(),
  ]);
  const driverInfo: DriverPublicInfo = {
    driverId: driverUid,
    displayName: (userSnap.get('displayName') as string | undefined) ?? 'Driver',
    photoURL: (userSnap.get('photoURL') as string | undefined) ?? null,
    vehicleLabel: (driverSnap.get('vehicleLabel') as string | undefined) ?? 'Vehicle',
    plate: (driverSnap.get('plate') as string | undefined) ?? '',
    rating: (driverSnap.get('rating') as number | undefined) ?? 5,
  };
  await lockInBid(tripId, driverUid, { by: 'driver', uid: driverUid }, {
    id: driverUid,
    tripId,
    driverId: driverUid,
    fare: tripSnap.get('offeredFare') as number,
    status: 'pending',
    driverInfo,
    driverLocation: (driverSnap.get('lastLocation') as { lat: number; lng: number } | undefined) ?? null,
    aheadOfTime: true,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export interface DispatchOutcome {
  tripId: string | null;
  seated: string[];
  /** Waiting on a driver's (or the host's) yes — see joinPoolTripAsRider. */
  asked: string[];
  dropped: { uid: string; reason: string }[];
  /** The car went straight to a driver who had accepted it ahead of time. */
  driverAssigned: boolean;
}

/**
 * Put everybody booked on this pool into a car. One booking at a time, each
 * let go only once it is settled, so a crash halfway leaves the rest booked
 * and the next tick of `dispatchSharedPools` finishes the job. A car made here
 * then goes to its driver — the one who accepted it ahead of time, or every
 * driver nearby.
 *
 * `quiet` is the rider who triggered it from the app: they get the answer on
 * their screen, not a push about it.
 */
export async function dispatchPool(poolId: string, quiet?: string): Promise<DispatchOutcome> {
  const poolRef = db.doc(`sharedPools/${poolId}`);
  const out: DispatchOutcome = { tripId: null, seated: [], asked: [], dropped: [], driverAssigned: false };
  const settings = await getCancellationSettings();
  let created: string | null = null;

  for (let i = 0; i <= MAX_POOL_RIDERS; i += 1) {
    const snap = await poolRef.get();
    const next = ((snap.get('bookings') as Booking[] | undefined) ?? [])[0];
    if (!next) break;
    const tripId = snap.get('tripId') as string | null;
    const tripSnap = tripId ? await db.doc(`trips/${tripId}`).get() : null;
    const car = carOf(tripSnap?.data(), Date.now());
    try {
      if (tripSnap && car && !car.ended && (car.joinable || car.members.includes(next.uid))) {
        const res = await joinPoolTripAsRider(next.uid, tripSnap.ref, 'self', bookingStops(next, snap.data()!));
        (res.pending ? out.asked : out.seated).push(next.uid);
        out.tripId = tripSnap.id;
        await releaseBooking(poolRef, next.uid);
      } else {
        out.tripId = await startCar(poolRef, next.uid, settings);
        created = out.tripId;
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

  const pool = (await poolRef.get()).data() ?? {};
  const label = (pool.label as string | null) ?? 'Your shared ride';
  if (created) {
    // Everybody booked is in before the car is handed over: a car with a driver
    // only takes new riders with that driver's yes.
    const ahead = aheadDriver(pool, Date.now());
    if (ahead) {
      try {
        await lockToDriver(created, ahead.uid);
        out.driverAssigned = true;
        await poolRef.update({ noDriverCheckAt: FieldValue.delete() });
      } catch (e) {
        logger.warn('sharedPools: ahead-of-time driver could not take the car', { poolId, driver: ahead.uid, err: String(e) });
        await notifyUser(
          ahead.uid,
          'Your shared ride went to other drivers',
          `${label}: ${e instanceof HttpsError ? e.message : 'you could not be given the car.'}`,
          'ride',
        ).catch(() => {});
      }
      await poolRef.update({ driver: FieldValue.delete(), driverUid: FieldValue.delete() });
    }
    if (!out.driverAssigned) {
      await broadcastTripToNearbyDrivers(created, pool.pickup as Place, true, pool.rideType as string, { fare: pool.fare as number })
        .catch((err) => logger.error('sharedPools: broadcast failed', { tripId: created, err }));
    }
  }

  const tell = out.tripId ? { tripId: out.tripId } : undefined;
  await Promise.all([
    // A driver who accepted ahead of time already told every rider (lockInBid).
    ...(out.driverAssigned ? [] : out.seated.filter((u) => u !== quiet).map((u) => notifyUser(
      u, '🚗 Finding your driver',
      `${label}: your car is out and drivers nearby are being asked now. You will hear the moment one accepts.`,
      'ride', tell,
    ))),
    ...out.dropped.filter((d) => d.uid !== quiet).map((d) => notifyUser(
      d.uid, 'Your shared-ride seat was let go', `${label}: ${d.reason}`, 'ride',
    )),
  ].map((p) => p.catch(() => {})));
  if (out.tripId) logger.info('sharedPools: car sent', { poolId, ...out });
  return out;
}

/**
 * Tell nearby online drivers a shared ride is forming — once per departure,
 * the moment its second seat is booked: demand they can plan around.
 */
async function alertDriversOfDemand(poolRef: FirebaseFirestore.DocumentReference): Promise<void> {
  const pool = (await poolRef.get()).data() ?? {};
  const pickup = pool.pickup as Place;
  const riders = bookedRiders((pool.bookings as Booking[] | undefined) ?? [], pool);
  const dep = departureOf(pool, Date.now());
  const docs = await queryNearbyDriverDocs(pickup.lat, pickup.lng, DRIVER_RADIUS_M / 3);
  const near = docs
    .filter((d) => {
      const loc = d.get('lastLocation') as { lat: number; lng: number } | undefined;
      return loc && haversineKm(pickup.lat, pickup.lng, loc.lat, loc.lng) <= DRIVER_RADIUS_M / 3000;
    })
    .map((d) => d.id);
  if (near.length === 0) return;
  const when = dep ? `at ${new Date(dep + PKT_OFFSET_MS).toISOString().slice(11, 16)}` : 'now';
  await sendToUsers(
    near,
    `🔀 ${riders.length} riders sharing ${when}`,
    `${pickup.address} to ${(pool.dropoff as Place).address}: PKR ${priceInOrder(riders).gross} so far. Open Shared rides to take it.`,
    { poolId: poolRef.id, screen: 'shared-pools' },
  ).catch(() => {});
}

export type SeatResult =
  | { status: 'seated' | 'asked'; tripId: string; perSeatFare: number }
  | { status: 'booked'; tripId: null; perSeatFare: number; departsAtMs: number | null };

/**
 * Take a seat on a pool: in its car when one is out and has room, else a
 * booking for the next car — which, for a pool with no time or a booking that
 * fills it, is sent at once. `stops` are the rider's own pickup and drop-off
 * (checked against the route); without them they ride the pool's own ends.
 */
async function seatOnPool(
  uid: string,
  poolId: string,
  stops?: { pickup: Place; dropoff: Place } | null,
): Promise<SeatResult> {
  const poolRef = db.doc(`sharedPools/${poolId}`);
  const snap = await poolRef.get();
  if (!snap.exists || snap.get('status') !== 'active') {
    throw new HttpsError('not-found', 'This shared ride is no longer running.');
  }
  const route = { pickup: snap.get('pickup') as Place, dropoff: snap.get('dropoff') as Place };
  if (stops && !routeFit(route, stops.pickup, stops.dropoff, MATCH_RADIUS_M)) {
    throw new HttpsError(
      'failed-precondition',
      'Your pickup or drop-off is more than 1 km off this shared ride’s route. Join one shown for your route, or start your own.',
    );
  }
  const own = stops ?? route;
  const rideType = snap.get('rideType') as string;
  const ownStops: RiderStops = { ...own, soloFare: (await sharedRideFare(rideType, own.pickup, own.dropoff)).fare };

  // A car already out with room: take a seat in it like any shared ride.
  const tripId = snap.get('tripId') as string | null;
  if (tripId) {
    const tripRef = db.doc(`trips/${tripId}`);
    const car = carOf((await tripRef.get()).data(), Date.now());
    if (car && !car.ended && (car.joinable || car.members.includes(uid))) {
      const res = await joinPoolTripAsRider(uid, tripRef, 'self', ownStops);
      await poolRef.update({ lastActiveAt: FieldValue.serverTimestamp() });
      return { status: res.pending ? 'asked' : 'seated', tripId, perSeatFare: res.perSeatFare };
    }
  }

  const held = await db.collection('sharedPools').where('bookingUids', 'array-contains', uid).get();
  if (held.docs.filter((d) => d.id !== poolId).length >= MAX_BOOKINGS_PER_RIDER) {
    throw new HttpsError('failed-precondition', 'You already hold seats on two shared rides. Cancel one first.');
  }

  // The first seat of a new car re-prices the car's own route, so a pool's
  // fare follows fuel and the city table from one car to the next.
  const fresh = ((snap.get('bookings') as Booking[] | undefined) ?? []).length === 0
    ? await sharedRideFare(rideType, route.pickup, route.dropoff)
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
    const departTime = (d.departTime as string | null) ?? null;
    const dueMs = bookings.length > 0
      ? timestampMs(d.dispatchAt) ?? nowMs
      : departTime ? nextDepartureMs(departTime, nowMs) - DISPATCH_LEAD_MS : nowMs;
    const pricedPool = { ...d, fare: bookings.length === 0 && fresh ? fresh.fare : d.fare };
    if (bookings.some((b) => b.uid === uid)) {
      return { count: bookings.length, dueMs, departTime, quote: priceInOrder(bookedRiders(bookings, pricedPool)).fares[uid] ?? 0, demand: false };
    }
    if (bookings.length >= MAX_POOL_RIDERS) {
      throw new HttpsError('failed-precondition', 'This shared ride is full. The next car opens two minutes after it leaves.');
    }
    if (userSnap.get('banned') === true) {
      throw new HttpsError('permission-denied', 'This account cannot book rides. Contact support.');
    }
    assertOutstandingClear(walletSnap, settings, 'passenger');
    const seat = resolveSeatOccupant(userSnap.get('gender'), null);
    const gate = poolJoinGenderGate(
      { sharedPoolId: poolId, poolRoster: bookings.map((b) => ({ uid: b.uid, gender: b.gender })) },
      seat.seatGender,
      userSnap.get('mixedRideOk') === true,
    );
    if (!gate.allowed) throw new HttpsError('permission-denied', gate.reason);

    const next: Booking[] = [...bookings, {
      uid,
      firstName: firstNameOf(userSnap.get('name') ?? userSnap.get('displayName')),
      gender: seat.seatGender,
      bookedAt: Timestamp.now(),
      pickup: ownStops.pickup,
      dropoff: ownStops.dropoff,
      soloFare: ownStops.soloFare,
    }];
    // Demand drivers can plan around: the second seat of a departure, once.
    const depKey = departTime ? dueMs + DISPATCH_LEAD_MS : 0;
    const demand = next.length === 2 && !aheadDriver(d, nowMs) && d.demandAlertedFor !== depKey;
    tx.update(poolRef, {
      bookings: next,
      bookingUids: next.map((b) => b.uid),
      fare: pricedPool.fare,
      dispatchAt: Timestamp.fromMillis(dueMs),
      // For drivers' "shared rides near you" — set here too for pools made before it existed.
      pickupGeohash: geohashForLocation([route.pickup.lat, route.pickup.lng]),
      ...(demand ? { demandAlertedFor: depKey } : {}),
      lastActiveAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      count: next.length,
      dueMs,
      departTime,
      quote: priceInOrder(bookedRiders(next, pricedPool)).fares[uid]!,
      demand,
    };
  });

  if (booked.demand) await alertDriversOfDemand(poolRef).catch((err) => logger.warn('sharedPools: demand alert failed', { poolId, err: String(err) }));

  if (booked.count >= MAX_POOL_RIDERS || booked.dueMs <= Date.now()) {
    const sent = await dispatchPool(poolId, uid);
    const dropped = sent.dropped.find((d) => d.uid === uid);
    if (dropped) throw new HttpsError('failed-precondition', dropped.reason);
    if (sent.tripId && (sent.seated.includes(uid) || sent.asked.includes(uid))) {
      const trip = (await db.doc(`trips/${sent.tripId}`).get()).data() ?? {};
      const fares = trip.poolFares as Record<string, number> | undefined;
      return {
        status: sent.asked.includes(uid) ? 'asked' : 'seated',
        tripId: sent.tripId,
        perSeatFare: fares?.[uid] ?? booked.quote,
      };
    }
  }
  return {
    status: 'booked',
    tripId: null,
    perSeatFare: booked.quote,
    departsAtMs: booked.departTime ? booked.dueMs + DISPATCH_LEAD_MS : null,
  };
}

// ── Rider callables ──────────────────────────────────────────────────────────

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

/** A new pool's document — riders' and drivers' alike. */
async function newPool(uid: string, d: z.infer<typeof createSchema>, driver?: PoolDriver | null) {
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
    pickupGeohash: geohashForLocation([d.pickup.lat, d.pickup.lng]),
    departTime: d.departTime ?? null,
    rideType: d.rideType,
    fare: quote.fare,
    createdBy: uid,
    creatorRemoved: false,
    bookings: [],
    bookingUids: [],
    tripId: null,
    runs: 0,
    status: 'active',
    ...(driver ? { driver, driverUid: driver.uid, offeredBy: uid } : {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastActiveAt: FieldValue.serverTimestamp(),
  });
  return ref;
}

/** Start a pool and take its first seat. */
export const createSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'createSharedPool', 10, 3600);
  const parsed = createSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid shared ride.');
  const ref = await newPool(ctx.uid, parsed.data);
  try {
    return { poolId: ref.id, ...(await seatOnPool(ctx.uid, ref.id)) };
  } catch (e) {
    // A pool its own creator could not get into is not one anybody asked for.
    await ref.delete().catch(() => {});
    throw e;
  }
});

/**
 * Take a seat on somebody's pool, at your own pickup and drop-off on its route
 * (`pickup`/`dropoff`) — or, without them, at the car's own ends.
 */
export const joinSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'joinSharedPool', 10, 60);
  const parsed = z.object({ poolId: docId, pickup: place.nullish(), dropoff: place.nullish() }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a shared ride.');
  const { poolId, pickup, dropoff } = parsed.data;
  return seatOnPool(ctx.uid, poolId, pickup && dropoff ? { pickup, dropoff } : null);
});

/**
 * Give back a booked seat. Free: no driver has committed to anything. A rider
 * already in the pool's car leaves from the ride screen (trips/poolLeave).
 */
export const leaveSharedPool = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ poolId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a shared ride.');
  const poolRef = db.doc(`sharedPools/${parsed.data.poolId}`);
  const before = (await poolRef.get()).data() ?? {};
  if (!(await releaseBooking(poolRef, ctx.uid))) {
    throw new HttpsError('failed-precondition', 'You hold no seat here. If you are in the car, leave from your ride.');
  }
  // The others' estimates move back up the tiers: tell whoever's went up.
  const after = (await poolRef.get()).data() ?? {};
  const was = priceInOrder(bookedRiders((before.bookings as Booking[] | undefined) ?? [], before)).fares;
  const now = priceInOrder(bookedRiders((after.bookings as Booking[] | undefined) ?? [], after)).fares;
  await Promise.allSettled(Object.entries(now)
    .filter(([uid, fare]) => fare > (was[uid] ?? Infinity))
    .map(([uid, fare]) => notifyUser(
      uid,
      'A rider cancelled their seat',
      `${(after.label as string | null) ?? 'Your shared ride'}: your estimated share is now PKR ${fare} — never more than riding alone. Cancelling stays free.`,
      'ride',
    )));
  return { ok: true };
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
      // Riders booked for 08:00 did not agree to 09:00, and neither did a driver.
      if (bookings.some((b) => b.uid !== ctx.uid)) {
        throw new HttpsError('failed-precondition', 'Others have booked seats for this time, so it cannot change now.');
      }
      if (aheadDriver(snap.data()!, Date.now())) {
        throw new HttpsError('failed-precondition', 'A driver has accepted this time, so it cannot change now.');
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

// ── Driver side ──────────────────────────────────────────────────────────────

/** What a driver sees of a pool: the job, the money and the stops, before saying yes. */
export interface DriverPoolView {
  id: string;
  label: string | null;
  rideType: string;
  pickup: Place;
  dropoff: Place;
  /** The pool's own route, km. */
  routeKm: number;
  /** From the driver to the pickup, km — null without a location. */
  toPickupKm: number | null;
  departTime: string | null;
  departsAtMs: number | null;
  riders: number;
  seatsLeft: number;
  /** What the car collects with the riders it has now. */
  earnNow: number;
  /** With every seat taken — the next riders priced at the route's own fare. */
  earnIfFull: number;
  /** Pickups and drop-offs in the order to make them: first names and places. */
  stops: { kind: 'pickup' | 'dropoff'; name: string; address: string }[];
  /** This driver accepted it ahead of time. */
  mine: boolean;
  /** A car already out with nobody driving it: accepting takes it now. */
  liveTripId: string | null;
}

/** A pool as a job for a driver, or null when it has no work in it for them. */
async function driverView(
  doc: FirebaseFirestore.DocumentSnapshot,
  trip: FirebaseFirestore.DocumentSnapshot | null,
  driverUid: string,
  at: { lat: number; lng: number } | null,
  nowMs: number,
): Promise<DriverPoolView | null> {
  const pool = doc.data()!;
  const ahead = aheadDriver(pool, nowMs);
  if (ahead && ahead.uid !== driverUid) return null; // somebody else's already
  const car = carOf(trip?.data(), nowMs);
  const liveTripId = car && !car.ended && car.status === 'requested' && trip ? trip.id : null;
  const bookings = (pool.bookings as Booking[] | undefined) ?? [];
  if (!liveTripId && bookings.length === 0 && !ahead) return null; // no riders yet

  let riders: PricedRider[];
  let located: { uid: string; name: string; pickup: Place; dropoff: Place }[];
  let earnNow: number;
  if (liveTripId && trip) {
    const t = trip.data()!;
    riders = sharedCarRiders(t, car!.members);
    earnNow = car!.gross ?? priceCar(riders).gross;
    const own = new Map((await trip.ref.collection('stops').get()).docs.map((s) => [s.id, s.data()] as const));
    located = rosterForTrip(t).map((r) => ({
      uid: r.uid,
      name: r.firstName,
      pickup: (own.get(r.uid)?.pickup as Place | undefined) ?? (t.pickup as Place),
      dropoff: (own.get(r.uid)?.dropoff as Place | undefined) ?? (t.dropoff as Place),
    }));
  } else {
    riders = bookedRiders(bookings, pool);
    earnNow = priceInOrder(riders).gross;
    located = bookings.map((b) => ({ uid: b.uid, name: b.firstName, ...bookingStops(b, pool) }));
  }
  // Seats the gender rules have closed are not earnings anybody can promise.
  const genders = liveTripId && trip ? rosterForTrip(trip.data()!).map((r) => r.gender) : bookings.map((b) => b.gender);
  const open = closedForComfort(genders) ? 0 : Math.max(0, MAX_POOL_RIDERS - riders.length);
  const filler = Array.from({ length: open }, (_, i) => ({
    uid: `seat-${i}`,
    soloFare: pool.fare as number,
  }));
  const byUid = new Map(located.map((l) => [l.uid, l] as const));
  const pickup = pool.pickup as Place;
  const dropoff = pool.dropoff as Place;
  return {
    id: doc.id,
    label: (pool.label as string | null) ?? null,
    rideType: (pool.rideType as string) ?? 'mini',
    pickup,
    dropoff,
    routeKm: Math.round(haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * 10) / 10,
    toPickupKm: at ? Math.round(haversineKm(at.lat, at.lng, pickup.lat, pickup.lng) * 10) / 10 : null,
    departTime: (pool.departTime as string | null) ?? null,
    departsAtMs: departureOf(pool, nowMs),
    riders: riders.length,
    seatsLeft: open,
    earnNow,
    earnIfFull: priceInOrder([...riders, ...filler]).gross,
    stops: orderStops(located, at).map((s) => {
      const r = byUid.get(s.uid)!;
      return { kind: s.kind, name: r.name, address: (s.kind === 'pickup' ? r.pickup : r.dropoff).address };
    }),
    mine: ahead?.uid === driverUid,
    liveTripId,
  };
}

/** Pools near a point — the driver's side of the pickupGeohash index. */
async function poolsNear(lat: number, lng: number, radiusM: number): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const snaps = await Promise.all(
    geohashQueryBounds([lat, lng], radiusM).map((b) =>
      db.collection('sharedPools').where('pickupGeohash', '>=', b[0]).where('pickupGeohash', '<=', b[1]).limit(100).get(),
    ),
  );
  const byId = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  for (const s of snaps) for (const d of s.docs) byId.set(d.id, d);
  return [...byId.values()];
}

/** Driver views for some pools, with their cars read in one go. */
async function viewsFor(
  docs: FirebaseFirestore.DocumentSnapshot[],
  driverUid: string,
  at: { lat: number; lng: number } | null,
  nowMs: number,
): Promise<DriverPoolView[]> {
  const tripIds = docs.map((d) => d.get('tripId') as string | null).filter((t): t is string => !!t);
  const tripSnaps = tripIds.length ? await db.getAll(...tripIds.map((t) => db.doc(`trips/${t}`))) : [];
  const trips = new Map(tripSnaps.filter((s) => s.exists).map((s) => [s.id, s] as const));
  const views = await Promise.all(docs.map((d) => {
    const tripId = d.get('tripId') as string | null;
    return driverView(d, tripId ? trips.get(tripId) ?? null : null, driverUid, at, nowMs);
  }));
  // Demand first: the fullest, best-paying cars, then the nearest.
  return views
    .filter((v): v is DriverPoolView => v !== null)
    .sort((a, b) => Number(b.mine) - Number(a.mine) || b.riders - a.riders || b.earnNow - a.earnNow
      || (a.toPickupKm ?? 0) - (b.toPickupKm ?? 0));
}

/** Shared rides near a driver that need one — booked seats, or a car out with nobody driving it. */
export const getDriverPools = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = point.safeParse(req.data);
  if (!parsed.success) invalid('Your location is needed to show shared rides near you.');
  const { lat, lng } = parsed.data;
  const nowMs = Date.now();
  const docs = (await poolsNear(lat, lng, DRIVER_RADIUS_M)).filter((d) => {
    if (!live(d, nowMs)) return false;
    const p = d.get('pickup') as Place;
    return haversineKm(lat, lng, p.lat, p.lng) * 1000 <= DRIVER_RADIUS_M;
  });
  return { pools: await viewsFor(docs, ctx.uid, { lat, lng }, nowMs) };
});

/** What every driver must be before taking riders — the checks placeBid applies. */
async function assertDriverCanTake(uid: string): Promise<FirebaseFirestore.DocumentSnapshot> {
  const [driverSnap, walletSnap, commission, cancellation] = await Promise.all([
    db.doc(`drivers/${uid}`).get(),
    db.doc(`wallets/${uid}`).get(),
    getCommissionSettings(),
    getCancellationSettings(),
  ]);
  if (driverSnap.get('verificationStatus') !== 'approved') {
    throw new HttpsError('permission-denied', 'Driver is not approved.');
  }
  assertCommissionClear(driverSnap, commission, pktDayKey());
  assertOutstandingClear(walletSnap, cancellation, 'driver');
  assertVehicleConfirmed(driverSnap);
  assertFaceCheckedIn(driverSnap);
  return driverSnap;
}

/** The driver as riders are shown them, for a pool's `driver` field. */
async function poolDriverFor(uid: string, driverSnap: FirebaseFirestore.DocumentSnapshot, forDepartureMs: number | null): Promise<PoolDriver> {
  const userSnap = await db.doc(`users/${uid}`).get();
  return {
    uid,
    name: firstNameOf(userSnap.get('displayName') ?? userSnap.get('name'), 'Driver'),
    vehicle: (driverSnap.get('vehicleLabel') as string | undefined) ?? 'Car',
    plate: (driverSnap.get('plate') as string | undefined) ?? '',
    acceptedAtMs: Date.now(),
    forDepartureMs,
  };
}

/** A driver may hold one shared ride per hour of the day. */
async function assertFreeAt(uid: string, departureMs: number | null, exceptPoolId?: string): Promise<void> {
  const mine = await db.collection('sharedPools').where('driverUid', '==', uid).limit(20).get();
  const nowMs = Date.now();
  for (const d of mine.docs) {
    if (d.id === exceptPoolId) continue;
    const held = aheadDriver(d.data(), nowMs);
    if (!held || held.uid !== uid) continue;
    const a = held.forDepartureMs ?? nowMs;
    const b = departureMs ?? nowMs;
    if (Math.abs(a - b) < HOUR_MS) {
      throw new HttpsError('failed-precondition', 'You already accepted a shared ride around that time. Withdraw from it first.');
    }
  }
}

/**
 * A driver takes a shared ride: a car already out without a driver, now — or
 * the pool's next car, ahead of time, so its riders see who is coming before
 * it leaves. Atomic: two drivers tapping at once, one wins.
 */
export const acceptSharedPool = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  await rateLimit(ctx.uid, 'acceptSharedPool', 10, 60);
  const parsed = z.object({ poolId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a shared ride.');
  const poolRef = db.doc(`sharedPools/${parsed.data.poolId}`);
  const driverSnap = await assertDriverCanTake(ctx.uid);
  const pre = await poolRef.get();
  if (!pre.exists || pre.get('status') !== 'active') throw new HttpsError('not-found', 'This shared ride is no longer running.');

  // A car already out with nobody driving it: it is leaving now, take it now.
  const tripId = pre.get('tripId') as string | null;
  const trip = tripId ? await db.doc(`trips/${tripId}`).get() : null;
  const car = carOf(trip?.data(), Date.now());
  if (tripId && car && !car.ended && car.status === 'requested') {
    await lockToDriver(tripId, ctx.uid);
    return { status: 'matched' as const, tripId };
  }

  const nowMs = Date.now();
  const departure = departureOf(pre.data()!, nowMs);
  await assertFreeAt(ctx.uid, departure, poolRef.id);
  const driver = await poolDriverFor(ctx.uid, driverSnap, departure);
  const riders = await db.runTransaction(async (tx) => {
    const snap = await tx.get(poolRef);
    const d = snap.data() ?? {};
    const bookings = (d.bookings as Booking[] | undefined) ?? [];
    if (bookings.length === 0) throw new HttpsError('failed-precondition', 'Nobody has booked this shared ride yet.');
    const held = aheadDriver(d, nowMs);
    if (held && held.uid !== ctx.uid) throw new HttpsError('failed-precondition', 'Another driver has already accepted this ride.');
    tx.update(poolRef, { driver, driverUid: ctx.uid, updatedAt: FieldValue.serverTimestamp() });
    return bookings.map((b) => b.uid);
  });
  const label = (pre.get('label') as string | null) ?? 'Your shared ride';
  await sendToUsers(
    riders,
    '🚗 Driver assigned',
    `${label}: ${driver.name} · ${driver.vehicle}${driver.plate ? ` · ${driver.plate}` : ''} will drive your car.`,
    { poolId: poolRef.id },
  ).catch(() => {});
  return { status: 'accepted' as const, departsAtMs: departure };
});

/** A driver gives back a ride they accepted ahead of time. The riders are told. */
export const withdrawSharedPool = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = z.object({ poolId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a shared ride.');
  const poolRef = db.doc(`sharedPools/${parsed.data.poolId}`);
  const riders = await db.runTransaction(async (tx) => {
    const snap = await tx.get(poolRef);
    if ((snap.get('driver') as PoolDriver | undefined)?.uid !== ctx.uid) {
      throw new HttpsError('failed-precondition', 'You have not accepted this shared ride.');
    }
    tx.update(poolRef, { driver: FieldValue.delete(), driverUid: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
    return ((snap.get('bookings') as Booking[] | undefined) ?? []).map((b) => b.uid);
  });
  await sendToUsers(
    riders,
    'Your driver can no longer make it',
    'Your seat still stands. Drivers nearby are asked when your car goes out.',
    { poolId: poolRef.id },
  ).catch(() => {});
  return { ok: true };
});

const routeSchema = z.object({
  pickup: place,
  dropoff: place,
  /** Daily "HH:MM", or null: leaving now. */
  departTime: z.string().regex(HHMM).nullish(),
});

/**
 * "I am driving G-10 to F-11 at 17:30" — shared rides whose riders sit on that
 * road, going that way, around that time. The driver still has to accept each.
 */
export const findPoolsForRoute = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = routeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Choose where you are driving from and to.');
  const { pickup, dropoff, departTime } = parsed.data;
  const nowMs = Date.now();
  const at = departTime ? nextDepartureMs(departTime, nowMs) : nowMs;
  const mid = { lat: (pickup.lat + dropoff.lat) / 2, lng: (pickup.lng + dropoff.lng) / 2 };
  const reach = haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) * 500 + DRIVER_ROUTE_RADIUS_M;
  const docs = (await poolsNear(mid.lat, mid.lng, reach)).filter((d) => {
    if (!live(d, nowMs) || !suitsTime(d.data() ?? {}, at, nowMs)) return false;
    return !!routeFit({ pickup, dropoff }, d.get('pickup') as Place, d.get('dropoff') as Place, DRIVER_ROUTE_RADIUS_M, 0);
  });
  return { pools: await viewsFor(docs, ctx.uid, pickup, nowMs) };
});

/**
 * The driver posts their own route as a shared ride, with themselves already
 * its driver: riders find it like any other ("Driver assigned") and its car
 * goes straight to this driver.
 */
export const offerDriverRoute = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  await rateLimit(ctx.uid, 'offerDriverRoute', 10, 3600);
  const parsed = createSchema.extend({ rideType: z.enum(['mini', 'ac']).nullish() }).safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid route.');
  const driverSnap = await assertDriverCanTake(ctx.uid);
  const d = parsed.data;
  const departure = d.departTime ? nextDepartureMs(d.departTime, Date.now()) : null;
  await assertFreeAt(ctx.uid, departure);
  const rideType = d.rideType ?? ((driverSnap.get('vehicleCategory') as string | undefined) === 'ac' ? 'ac' : 'mini');
  const ref = await newPool(ctx.uid, { ...d, rideType }, await poolDriverFor(ctx.uid, driverSnap, departure));
  return { poolId: ref.id };
});

// ── Starting a car ───────────────────────────────────────────────────────────

/**
 * Start a shared car: its driver is setting off to collect everyone (owner,
 * 2026-10-30). From here the car takes nobody new — the pool's box is the next
 * car's, four seats again — and each rider is asked to confirm they are coming;
 * the driver gets a rider's stops once they do (enRoute getPoolRiders). `by`
 * is the driver's uid, or null for the clock, which only starts a car a driver
 * has. True when this call started it.
 */
export async function startSharedCar(tripId: string, by: string | null): Promise<boolean> {
  const tripRef = db.doc(`trips/${tripId}`);
  const started = await db.runTransaction(async (tx) => {
    const t = (await tx.get(tripRef)).data();
    if (!t || typeof t.sharedPoolId !== 'string') throw new HttpsError('not-found', 'This shared ride no longer exists.');
    if (by !== null && t.driverId !== by) {
      throw new HttpsError('permission-denied', 'Only the driver of this car can start it.');
    }
    const poolRef = db.doc(`sharedPools/${t.sharedPoolId}`);
    const pool = await tx.get(poolRef);
    if (t.poolStartedAt) return null;
    if (!WITH_DRIVER.has(t.status as string)) {
      if (by === null) return null;
      throw new HttpsError('failed-precondition', 'This ride cannot be started now.');
    }
    const members = (t.poolMembers as string[] | undefined) ?? [t.passengerId as string];
    tx.update(tripRef, {
      poolStartedAt: FieldValue.serverTimestamp(),
      poolConfirm: Object.fromEntries(members.map((m) => [m, 'pending'])),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Only this car's clock: the pool may already be gathering the next one.
    if (pool.get('tripId') === tripId) tx.update(poolRef, { autoStartAt: FieldValue.delete() });
    return { members, driver: (t.driverInfo as { displayName?: string } | undefined)?.displayName ?? 'Your driver' };
  });
  if (!started) return false;
  await sendToUsers(
    started.members,
    'Your shared ride is starting',
    `${started.driver} is collecting everyone now. Confirm you are coming — or cancel.`,
    { tripId },
  ).catch((e) => logger.warn('sharedPools: start push failed', { tripId, err: String(e) }));
  return true;
}

/** The driver taps Start: they are setting off to collect their riders. */
export const startSharedRide = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ tripId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a ride.');
  await startSharedCar(parsed.data.tripId, ctx.uid);
  return { ok: true };
});

/** A rider answers the start prompt: yes, I am coming. Cancel goes through leaveSharedRide. */
export const confirmSharedSeat = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ tripId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Choose a ride.');
  const tripRef = db.doc(`trips/${parsed.data.tripId}`);
  await db.runTransaction(async (tx) => {
    const t = (await tx.get(tripRef)).data();
    if (!t?.poolStartedAt || !((t.poolMembers as string[] | undefined) ?? []).includes(ctx.uid)) {
      throw new HttpsError('failed-precondition', 'There is nothing to confirm on this ride.');
    }
    tx.update(tripRef, { [`poolConfirm.${ctx.uid}`]: 'confirmed', updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

/**
 * The clock's half of the start: every car past `autoStartAt` that a driver has
 * accepted starts now. One still without a driver keeps its clock, so it starts
 * on the first tick after somebody accepts it.
 */
export async function autoStartDue(now: FirebaseFirestore.Timestamp): Promise<void> {
  const due = await db.collection('sharedPools').where('autoStartAt', '<=', now).limit(50).get();
  for (const doc of due.docs) {
    try {
      const tripId = doc.get('tripId') as string | null;
      const status = tripId ? ((await db.doc(`trips/${tripId}`).get()).get('status') as string | undefined) : undefined;
      if (status === 'requested') continue;
      if (tripId && status && WITH_DRIVER.has(status) && (await startSharedCar(tripId, null))) continue;
      // Started already, gone, or on the road: this clock is done.
      await db.runTransaction(async (tx) => {
        const p = await tx.get(doc.ref);
        if (p.get('tripId') === tripId) tx.update(doc.ref, { autoStartAt: FieldValue.delete() });
      });
    } catch (e) {
      logger.warn('sharedPools: auto-start failed', { poolId: doc.id, err: String(e) });
    }
  }
}

/**
 * The clock: every booking whose car is due goes out, every car still without
 * a driver NO_DRIVER_ALERT_MS after it went out tells its riders, and every car
 * a driver has starts AUTO_START_MS after it went out. Also finishes any
 * dispatch a crash left halfway — every booking keeps `dispatchAt` until it is
 * settled.
 */
export const dispatchSharedPools = onSchedule(
  { schedule: 'every 2 minutes', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    const now = Timestamp.now();
    await autoStartDue(now);
    const [due, waiting] = await Promise.all([
      db.collection('sharedPools').where('dispatchAt', '<=', now).limit(50).get(),
      db.collection('sharedPools').where('noDriverCheckAt', '<=', now).limit(50).get(),
    ]);
    for (const doc of due.docs) {
      try {
        await dispatchPool(doc.id);
      } catch (e) {
        logger.warn('sharedPools: dispatch tick failed', { poolId: doc.id, err: String(e) });
      }
    }
    for (const doc of waiting.docs) {
      try {
        await doc.ref.update({ noDriverCheckAt: FieldValue.delete() });
        const tripId = doc.get('tripId') as string | null;
        const trip = tripId ? await db.doc(`trips/${tripId}`).get() : null;
        if (trip?.get('status') !== 'requested') continue;
        await sendToUsers(
          (trip.get('poolMembers') as string[] | undefined) ?? [],
          'Still finding a driver',
          `${(doc.get('label') as string | null) ?? 'Your shared ride'}: no driver has accepted yet. Keep waiting — or leave free of charge from your ride.`,
          { tripId: trip.id },
        );
      } catch (e) {
        logger.warn('sharedPools: no-driver alert failed', { poolId: doc.id, err: String(e) });
      }
    }
  },
);
