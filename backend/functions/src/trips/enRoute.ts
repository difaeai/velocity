/**
 * En-route pickups and driver routes.
 * ----------------------------------------------------------------------------
 * Two features, one engine.
 *
 * 1. RIDERS ON THE WAY. Ali pools F-10 → F-6. Nobody has joined him, or somebody
 *    has and there is still a seat. Along the way the car passes F-9, where
 *    somebody else is waiting for a pool ride that happens to be going the same
 *    direction. The driver can take them: the fare is recomputed for everybody by
 *    the leg-split (see lib/enRouteFare), each rider pays for the road they are
 *    actually on, and the driver's gross goes up.
 *
 * 2. THE DRIVER'S OWN ROUTE. A driver who is not on a trip at all — heading home,
 *    say — declares where they are going. Pool requests that lie along that route
 *    show up in their feed and can be picked up the same way. Earning on a drive
 *    they were making anyway.
 *
 * Both reduce to: *the driver has a corridor, who is on it?* The corridor comes
 * from the pool trip in case 1 and from `driverRoutes/{uid}` in case 2, and from
 * there every rule, every gate and every rupee is the same code.
 *
 * WHY RIDERS ARE ONLY EVER TAKEN FROM POOL REQUESTS
 * An en-route rider gets into a car with strangers. Someone who booked a pool
 * knew that when they booked — that is what pooling is. Someone who booked a solo
 * ride did not, and no discount makes that an acceptable surprise. So en-route
 * candidates are always `pool: true` requests, in both modes. A driver who wants
 * an exclusive fare still bids on it the ordinary way.
 *
 * WHAT THE PEOPLE ALREADY IN THE CAR SEE
 * Everything. The moment a rider is added, every seated passenger's trip document
 * gains them — name, gender, where they get in, where they get out — and they are
 * pushed a notification saying who just joined and what it did to their own fare.
 * They can call the driver from the same screen. Nobody finds a stranger in the
 * car without having been told.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, requireRole, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import { computeGenderAccess, canJoinPool } from '../lib/genderAccess';
import { assertCommissionClear, getCommissionSettings } from '../domain/commission';
import { assertOutstandingClear, getCancellationSettings } from '../domain/cancellation';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { TripStatus } from '../domain/types';
import {
  CityFareConfig,
  DEFAULT_ISLAMABAD_RAWALPINDI,
  VehicleCategory,
  calculateFare,
} from '../fare/fareEngine';
import {
  Corridor,
  LatLng,
  POLYLINE_REJECTION_MESSAGE,
  buildCorridor,
  decodePolyline,
  haversineM,
  projectToCorridor,
  validateRoutePolyline,
} from '../lib/corridor';
import { fetchRouteServerSide, serverRoutingConfigured } from '../lib/routes';
import {
  CORRIDOR_REJECTION_MESSAGE,
  CorridorFit,
  EnRouteSettings,
  checkCorridorFit,
  getEnRouteSettings,
} from '../lib/enRouteMatch';
import {
  MIN_PER_KM,
  RiderSegment,
  driverIsNotWorseOff,
  splitEnRouteFares,
} from '../lib/enRouteFare';

// ── Shared shapes ────────────────────────────────────────────────────────────

/** RideType → fare-engine category. Mirrors RIDE_TO_ENGINE_CAT in trips/index. */
const RIDE_TO_CAT: Record<string, VehicleCategory> = {
  bike: 'moto',
  auto: 'rickshaw',
  mini: 'mini',
  ac: 'ac_car',
  comfort: 'luxury',
  xl: 'luxury',
};

/** Statuses in which a trip is still carrying (or about to carry) people. */
const CARRYING: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'matched',
  'arriving',
  'arrived',
  'in_progress',
]);

/** A declared driver route goes stale rather than lingering forever. */
const ROUTE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(200).optional(),
});

/** A rider on a shared trip, as stored on the carrier trip document. */
export interface PoolRider {
  uid: string;
  name: string;
  gender: string;
  seats: number;
  rideType: string;
  pickup: { lat: number; lng: number; address?: string };
  dropoff: { lat: number; lng: number; address?: string };
  /** Where they sit on the driver's route. */
  boardM: number;
  alightM: number;
  pickupOffsetM: number;
  dropoffOffsetM: number;
  /** What they would have paid alone — the ceiling on what they can be charged. */
  soloFare: number;
  fare: number;
  billableKm: number;
  /** 'host' booked the trip · 'share' joined by invite link · 'enroute' picked up on the way. */
  kind: 'host' | 'share' | 'enroute';
  /** The request document they came from, for en-route riders. */
  originTripId: string | null;
  joinedAt?: FirebaseFirestore.Timestamp | FieldValue;
}

/** The driver's corridor: where they are going and the road they take to get there. */
interface ResolvedCorridor {
  source: 'trip' | 'driver_route';
  origin: LatLng & { address?: string };
  destination: LatLng & { address?: string };
  polyline: string;
  corridor: Corridor;
  settings: EnRouteSettings;
  /**
   * True when WE fetched this road from Google, false when it came off the
   * driver's phone. Recorded on the trip so a fare dispute can always be told
   * which one it was priced from.
   */
  trusted: boolean;
}

// ── Fare helpers ─────────────────────────────────────────────────────────────

async function loadFareConfig(): Promise<CityFareConfig> {
  try {
    const snap = await db.doc('fareConfig/islamabad_rawalpindi').get();
    if (snap.exists) return snap.data() as CityFareConfig;
  } catch (e) {
    logger.warn('enRoute: fare config unreadable, using defaults', e);
  }
  return DEFAULT_ISLAMABAD_RAWALPINDI;
}

/**
 * What a rider would pay riding alone, priced the way the whole app prices —
 * haversine distance, 3.5 min/km, the city fare engine. This is the ceiling on
 * what any en-route split may ever charge them, which is what makes the
 * client-supplied polyline safe to trust for geometry.
 */
function soloFareFor(
  cfg: CityFareConfig,
  rideType: string,
  pickup: LatLng,
  dropoff: LatLng,
): number {
  const distanceKm = Math.max(
    0.5,
    haversineM(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng) / 1000,
  );
  return calculateFare(cfg, {
    category: RIDE_TO_CAT[rideType] ?? 'mini',
    distanceKm,
    durationMin: Math.max(3, distanceKm * MIN_PER_KM),
  }).recommendedFare;
}

/** Seats already spoken for. */
const seatsUsed = (riders: PoolRider[]): number =>
  riders.reduce((n, r) => n + (r.seats || 1), 0);

/**
 * The pool tier a rider was promised on the booking screen, or null for someone
 * picked up en route who was never quoted one. Destination-pool riders keep this
 * as a ceiling forever — see INVARIANT 4 in enRouteFare.
 */
function tierCapFor(rider: PoolRider, riders: PoolRider[], hostSoloFare: number): number | null {
  if (rider.kind === 'enroute') return null;
  const destinationRiders = riders.filter((r) => r.kind !== 'enroute').length;
  return poolPerSeatFare(hostSoloFare, Math.max(1, destinationRiders));
}

/** Turn the stored riders into what the split needs, then price them. */
function priceRiders(
  riders: PoolRider[],
  cfg: CityFareConfig,
  category: VehicleCategory,
  hostSoloFare: number,
) {
  const segments: RiderSegment[] = riders.map((r) => ({
    uid: r.uid,
    boardM: r.boardM,
    alightM: r.alightM,
    pickupOffsetM: r.pickupOffsetM,
    dropoffOffsetM: r.dropoffOffsetM,
    soloFare: r.soloFare,
    tierCap: tierCapFor(r, riders, hostSoloFare),
  }));
  return splitEnRouteFares(segments, cfg, category);
}

// ── Reading the riders already on a trip ─────────────────────────────────────

/**
 * The riders currently on a trip, in the rich form the split needs.
 *
 * Trips created before this feature only carry `poolMembers: string[]`, and
 * share-link joiners never had a pickup point recorded at all. Those riders are
 * reconstructed as boarding at the trip's pickup and riding to its destination —
 * which is exactly the assumption their flat-tier fare was already built on, so
 * nothing they were quoted moves.
 */
function ridersOnTrip(
  trip: FirebaseFirestore.DocumentData,
  corridor: Corridor,
  cfg: CityFareConfig,
): PoolRider[] {
  const stored = trip.poolRiders as PoolRider[] | undefined;
  if (Array.isArray(stored) && stored.length > 0) return stored;

  const hostId = trip.passengerId as string;
  const members = (trip.poolMembers as string[] | undefined) ?? [hostId];
  const pickup = trip.pickup as { lat: number; lng: number; address?: string };
  const dropoff = trip.dropoff as { lat: number; lng: number; address?: string };
  const rideType = (trip.rideType as string) ?? 'mini';
  const soloFare = soloFareFor(cfg, rideType, pickup, dropoff);

  return members.map((uid) => ({
    uid,
    name: uid === hostId ? ((trip.passengerName as string) ?? 'Rider') : 'Rider',
    gender: uid === hostId ? ((trip.passengerGender as string) ?? 'unspecified') : 'unspecified',
    seats: 1,
    rideType,
    pickup,
    dropoff,
    boardM: 0,
    alightM: corridor.lengthM,
    pickupOffsetM: 0,
    dropoffOffsetM: 0,
    soloFare,
    fare: (trip.poolPerSeatFare as number) ?? soloFare,
    billableKm: corridor.lengthM / 1000,
    kind: uid === hostId ? 'host' : 'share',
    originTripId: null,
  }));
}

const maleCount = (riders: PoolRider[]) =>
  riders.filter((r) => r.gender === 'male').reduce((n, r) => n + (r.seats || 1), 0);
const femaleCount = (riders: PoolRider[]) =>
  riders.filter((r) => r.gender === 'female').reduce((n, r) => n + (r.seats || 1), 0);

// ── Resolving the driver's corridor ──────────────────────────────────────────

/**
 * The trip the driver is currently carrying, if any. That trip is the "carrier":
 * the document riders, fares and the settlement all live on.
 */
async function activeCarrierTrip(
  driverId: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const snap = await db
    .collection('trips')
    .where('driverId', '==', driverId)
    .where('status', 'in', [...CARRYING])
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0]!;
}

/**
 * Work out the driver's corridor: where they are going, and the road they take.
 *
 * The endpoints are NEVER taken from the client. They come from the carrier trip
 * or the declared route already in Firestore, so a driver cannot widen their own
 * corridor to sweep up rides that are not on their way.
 *
 * The road between those endpoints comes from one of three places, in order:
 *
 *   1. A ROUTE WE ALREADY FETCHED. Cached on the trip / driver-route document.
 *      A driver polling their feed every 20 seconds does not re-buy the same road.
 *   2. GOOGLE, FROM HERE. When GOOGLE_MAPS_SERVER_KEY is set we fetch it
 *      ourselves and cache it. The client's polyline is not even looked at.
 *   3. THE CLIENT'S POLYLINE. Only when there is no server key. Validated against
 *      the endpoints above before it is trusted an inch (validateRoutePolyline),
 *      and every fare it produces is still capped at the rider's own solo fare —
 *      so a doctored one cannot overcharge anyone. This is the fallback, not the
 *      plan, and it is also what keeps the feature alive through a Maps outage.
 */
async function resolveCorridor(
  driverId: string,
  clientPolyline: string | undefined,
  carrier: FirebaseFirestore.DocumentSnapshot | null,
): Promise<ResolvedCorridor> {
  const settings = await getEnRouteSettings();
  if (!settings.enabled) {
    throw new HttpsError('failed-precondition', 'En-route pickups are turned off right now.');
  }

  let source: 'trip' | 'driver_route';
  let origin: LatLng & { address?: string };
  let destination: LatLng & { address?: string };
  /** Where to write a freshly-fetched route so we only ever buy it once. */
  let cacheRef: FirebaseFirestore.DocumentReference;
  let cacheField: string;
  let cached: string | null = null;

  if (carrier) {
    // The corridor of a trip already under way is that trip's own route — unless
    // it was itself started from a declared route, in which case the driver is
    // still ultimately heading home and that longer corridor is the real one.
    const stored = carrier.get('enRoute') as
      | { origin?: LatLng; destination?: LatLng; source?: string; polyline?: string; polylineSource?: string }
      | undefined;
    if (stored?.origin && stored?.destination) {
      source = (stored.source as 'trip' | 'driver_route') ?? 'trip';
      origin = stored.origin;
      destination = stored.destination;
    } else {
      source = 'trip';
      origin = carrier.get('pickup') as LatLng & { address?: string };
      destination = carrier.get('dropoff') as LatLng & { address?: string };
    }
    // Only reuse a cached road that WE fetched. A polyline that came off a client
    // is never promoted to the cache, so it can never be silently re-trusted.
    if (stored?.polylineSource === 'server' && stored.polyline) cached = stored.polyline;
    cacheRef = carrier.ref;
    cacheField = 'enRoute';
  } else {
    const routeSnap = await db.doc(`driverRoutes/${driverId}`).get();
    if (!routeSnap.exists || routeSnap.get('status') !== 'active') {
      throw new HttpsError(
        'failed-precondition',
        'Set where you are heading first, then we can show you riders on your way.',
      );
    }
    const expiresAt = routeSnap.get('expiresAt') as FirebaseFirestore.Timestamp | undefined;
    if (expiresAt && expiresAt.toDate() < new Date()) {
      throw new HttpsError('failed-precondition', 'Your route has expired. Set it again.');
    }
    source = 'driver_route';
    origin = routeSnap.get('origin') as LatLng & { address?: string };
    destination = routeSnap.get('destination') as LatLng & { address?: string };
    if (routeSnap.get('polylineSource') === 'server') {
      cached = (routeSnap.get('polyline') as string | undefined) ?? null;
    }
    cacheRef = routeSnap.ref;
    cacheField = '';
  }

  // ── 1. The road we already bought ──
  if (cached) {
    const points = decodePolyline(cached);
    if (points.length >= 2) {
      return {
        source,
        origin,
        destination,
        polyline: cached,
        corridor: buildCorridor(points),
        settings,
        trusted: true,
      };
    }
  }

  // ── 2. Ask Google ourselves ──
  if (serverRoutingConfigured()) {
    const fetched = await fetchRouteServerSide(origin, destination);
    if (fetched) {
      const payload = {
        polyline: fetched.polyline,
        polylineSource: 'server' as const,
        routeLengthM: Math.round(fetched.corridor.lengthM),
        routeDurationSec: fetched.durationSec,
      };
      // Cache it. Best-effort: a failed write costs one extra Routes call later,
      // it must never cost the driver their feed.
      await cacheRef
        .set(
          cacheField ? { [cacheField]: payload, updatedAt: FieldValue.serverTimestamp() } : payload,
          { merge: true },
        )
        .catch((e) => logger.warn('enRoute: could not cache the route', e));

      return {
        source,
        origin,
        destination,
        polyline: fetched.polyline,
        corridor: fetched.corridor,
        settings,
        trusted: true,
      };
    }
    // Google said no (quota, outage, no road between the points). Fall through:
    // a Maps problem is not a reason nobody can earn today.
  }

  // ── 3. The client's polyline, trusted only as far as we can throw it ──
  if (!clientPolyline) {
    throw new HttpsError(
      'failed-precondition',
      'We could not work out your road route. Check your connection and try again.',
    );
  }
  const check = validateRoutePolyline(decodePolyline(clientPolyline), origin, destination);
  if (!check.ok) {
    throw new HttpsError('invalid-argument', POLYLINE_REJECTION_MESSAGE[check.reason]);
  }

  return {
    source,
    origin,
    destination,
    polyline: clientPolyline,
    corridor: check.corridor,
    settings,
    trusted: false,
  };
}

// ── setDriverRoute ───────────────────────────────────────────────────────────

const setRouteSchema = z.object({
  origin: geoSchema,
  destination: geoSchema,
  /**
   * Encoded road polyline from the driver's client. Only a fallback: when the
   * backend has GOOGLE_MAPS_SERVER_KEY it fetches the road itself and never
   * looks at this.
   */
  polyline: z.string().min(4).max(60_000).optional(),
});

/**
 * Feature 2 — the driver declares where they are going, so riders on the way can
 * be found. Replaces any route they already had.
 */
export const setDriverRoute = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  await rateLimit(ctx.uid, 'setDriverRoute', 20, 60);
  const parsed = setRouteSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid route.');
  const { origin, destination, polyline } = parsed.data;

  const [driverSnap, walletSnap, commission, cancellation, settings] = await Promise.all([
    db.doc(`drivers/${ctx.uid}`).get(),
    db.doc(`wallets/${ctx.uid}`).get(),
    getCommissionSettings(),
    getCancellationSettings(),
    getEnRouteSettings(),
  ]);

  if (!settings.enabled) {
    throw new HttpsError('failed-precondition', 'Driver routes are turned off right now.');
  }
  if (driverSnap.get('verificationStatus') !== 'approved') {
    throw new HttpsError('permission-denied', 'Only approved drivers can set a route.');
  }
  // The same two gates that stop a driver bidding also stop them touting a route.
  assertCommissionClear(driverSnap, commission);
  assertOutstandingClear(walletSnap, cancellation, 'driver');

  // The road, from Google, fetched here. This is the corridor the driver will be
  // matched on, so it is worth owning: we buy it once, now, and cache it on the
  // route document rather than re-deriving it on every poll.
  let corridor: Corridor;
  let routePolyline: string;
  let polylineSource: 'server' | 'client';

  const fetched = serverRoutingConfigured()
    ? await fetchRouteServerSide(origin, destination)
    : null;

  if (fetched) {
    corridor = fetched.corridor;
    routePolyline = fetched.polyline;
    polylineSource = 'server';
  } else {
    // No key, or Google is having a bad day. Fall back to the driver's own map —
    // checked against the endpoints they gave us before we believe a word of it.
    if (!polyline) {
      throw new HttpsError(
        'failed-precondition',
        'We could not work out the road to there. Check your connection and try again.',
      );
    }
    const check = validateRoutePolyline(decodePolyline(polyline), origin, destination);
    if (!check.ok) {
      throw new HttpsError('invalid-argument', POLYLINE_REJECTION_MESSAGE[check.reason]);
    }
    corridor = check.corridor;
    routePolyline = polyline;
    polylineSource = 'client';
  }

  await db.doc(`driverRoutes/${ctx.uid}`).set({
    driverId: ctx.uid,
    origin,
    destination,
    polyline: routePolyline,
    polylineSource,
    routeLengthM: Math.round(corridor.lengthM),
    ...(fetched ? { routeDurationSec: fetched.durationSec } : {}),
    vehicleType: (driverSnap.get('vehicleType') as string) ?? 'mini',
    status: 'active',
    expiresAt: new Date(Date.now() + ROUTE_TTL_MS),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Driver route set', {
    driverId: ctx.uid,
    routeKm: Math.round(corridor.lengthM / 1000),
    polylineSource,
  });
  return {
    ok: true,
    routeLengthM: Math.round(corridor.lengthM),
    corridorRadiusM: settings.corridorRadiusM,
    destRadiusM: settings.destRadiusM,
  };
});

/** The driver is done — stop showing them riders on a road they are no longer on. */
export const endDriverRoute = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  await db.doc(`driverRoutes/${ctx.uid}`).set(
    { status: 'ended', endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ok: true };
});

// ── getEnRouteMatches ────────────────────────────────────────────────────────

const matchesSchema = z.object({
  /**
   * The road route, encoded, from the driver's own map. Only used when the
   * backend has no Maps key of its own — with GOOGLE_MAPS_SERVER_KEY set the
   * server fetches the road itself and this is ignored entirely.
   */
  polyline: z.string().min(4).max(60_000).optional(),
  /** Where the driver is now, so riders they have already passed are dropped. */
  driverLat: z.number().min(-90).max(90).optional(),
  driverLng: z.number().min(-180).max(180).optional(),
});

/**
 * Pool requests that lie on the driver's corridor and that they are actually
 * allowed to take — seats, gender rules, fare gate and all.
 *
 * Every rejection reason a candidate can hit is evaluated here by the same
 * functions `acceptEnRouteRider` uses, so the feed can never show a ride that
 * would be refused on tap.
 */
export const getEnRouteMatches = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = matchesSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide your current route.');
  const { polyline, driverLat, driverLng } = parsed.data;

  const carrier = await activeCarrierTrip(ctx.uid);
  if (carrier && ((carrier.get('paymentMethod') as string) ?? 'cash') !== 'cash') {
    return { matches: [], seatsLeft: 0, walletTrip: true };
  }
  const [resolved, cfg] = await Promise.all([
    resolveCorridor(ctx.uid, polyline, carrier),
    loadFareConfig(),
  ]);
  const { corridor, destination, settings } = resolved;

  // How far along its own route the car already is — gate 4.
  const driverAlongM =
    typeof driverLat === 'number' && typeof driverLng === 'number'
      ? projectToCorridor(corridor, { lat: driverLat, lng: driverLng }).alongM
      : null;

  // What is already in the car (nothing, in driver-route mode).
  const existing: PoolRider[] = carrier ? ridersOnTrip(carrier.data()!, corridor, cfg) : [];
  const category =
    RIDE_TO_CAT[(carrier?.get('rideType') as string) ?? 'mini'] ?? 'mini';
  const hostSolo = existing.find((r) => r.kind === 'host')?.soloFare ?? 0;
  const grossBefore = carrier ? priceRiders(existing, cfg, category, hostSolo).driverGross : 0;
  const seatsLeft = MAX_POOL_RIDERS - seatsUsed(existing);

  if (seatsLeft <= 0) return { matches: [], seatsLeft: 0, corridorRadiusM: settings.corridorRadiusM };

  // Only pool requests, ever — see the file header.
  const openSnap = await db
    .collection('openRequests')
    .where('pool', '==', true)
    .limit(150)
    .get();

  const matches: object[] = [];

  for (const doc of openSnap.docs) {
    if (carrier && doc.id === carrier.id) continue; // our own trip
    const d = doc.data();

    const pickup = d.pickup as { lat?: number; lng?: number; address?: string } | undefined;
    const dropoff = d.dropoff as { lat?: number; lng?: number; address?: string } | undefined;
    if (typeof pickup?.lat !== 'number' || typeof dropoff?.lat !== 'number') continue;

    const seats = (d.seats as number) ?? 1;
    if (seats > seatsLeft) continue;

    // Cash only — see the note on `acceptEnRouteRider`.
    if (((d.paymentMethod as string) ?? 'cash') !== 'cash') continue;

    // Gates 1–4: is this rider on our way at all?
    const fit = checkCorridorFit(
      corridor,
      destination,
      { lat: pickup.lat!, lng: pickup.lng! },
      { lat: dropoff.lat!, lng: dropoff.lng! },
      settings,
      driverAlongM,
    );
    if (!fit.ok) continue;

    const candidate = await buildCandidate(doc.id, d, fit.fit, cfg);
    if (!candidate) continue;

    // Gender rules — the same ones that govern every other pool in the app.
    const gate = genderGate(existing, candidate);
    if (!gate.allowed) continue;

    // Price the car as it would be with them in it.
    const priced = priceRiders([...existing, candidate], cfg, category, hostSolo || candidate.soloFare);

    // Gate 5 — never charge them more than the fare they themselves offered. It
    // is what makes taking them without a further ask defensible: they wanted a
    // pool, they get one now, at or below their own price.
    const theirFare = priced.fares[candidate.uid]!;
    if (theirFare > (d.offeredFare as number)) continue;

    // INVARIANT 2 — and never for less than the driver was already making.
    if (!driverIsNotWorseOff(grossBefore, priced.driverGross)) continue;

    matches.push({
      tripId: doc.id,
      passengerName: (d.passengerName as string) ?? 'Passenger',
      passengerGender: candidate.gender,
      passengerRating: (d.passengerRating as number) ?? 5,
      rideType: candidate.rideType,
      seats,
      pickup,
      dropoff,
      /** What this rider will pay — already discounted for sharing. */
      fare: theirFare,
      soloFare: candidate.soloFare,
      offeredFare: d.offeredFare as number,
      /** What the driver's whole car will be worth with them aboard. */
      driverGrossAfter: priced.driverGross,
      driverGrossBefore: grossBefore,
      earnExtra: priced.driverGross - grossBefore,
      /** New fares for the people already in the car — never higher than now. */
      ridersAfter: existing.map((r) => ({
        uid: r.uid,
        name: r.name,
        fareNow: r.fare,
        fareAfter: priced.fares[r.uid]!,
      })),
      detourM: Math.round(fit.fit.detourM),
      pickupOffsetM: Math.round(fit.fit.pickupOffsetM),
      dropToDestM: Math.round(fit.fit.dropToDestM),
      alongM: Math.round(fit.fit.boardM),
    });
  }

  // The rider furthest along the route comes first: that is the next one the car
  // physically reaches.
  matches.sort((a, b) => (a as { alongM: number }).alongM - (b as { alongM: number }).alongM);

  return {
    matches,
    seatsLeft,
    corridorRadiusM: settings.corridorRadiusM,
    destRadiusM: settings.destRadiusM,
    mode: resolved.source,
  };
});

/** Build the rider record for an open request that has passed the corridor gates. */
async function buildCandidate(
  tripId: string,
  d: FirebaseFirestore.DocumentData,
  fit: CorridorFit,
  cfg: CityFareConfig,
): Promise<PoolRider | null> {
  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists || tripSnap.get('status') !== 'requested') return null;

  const uid = tripSnap.get('passengerId') as string;
  const userSnap = await db.doc(`users/${uid}`).get();
  if (userSnap.get('poolBookingBlocked') === true) return null;

  const pickup = d.pickup as { lat: number; lng: number; address?: string };
  const dropoff = d.dropoff as { lat: number; lng: number; address?: string };
  const rideType = (d.rideType as string) ?? 'mini';

  return {
    uid,
    name: (d.passengerName as string) ?? 'Rider',
    gender: (d.passengerGender as string) ?? 'unspecified',
    seats: (d.seats as number) ?? 1,
    rideType,
    pickup,
    dropoff,
    boardM: fit.boardM,
    alightM: fit.alightM,
    pickupOffsetM: fit.pickupOffsetM,
    dropoffOffsetM: fit.dropoffOffsetM,
    soloFare: soloFareFor(cfg, rideType, pickup, dropoff),
    fare: 0, // filled in by the split
    billableKm: 0,
    kind: 'enroute',
    originTripId: tripId,
    mixedRideOk: userSnap.get('mixedRideOk') === true,
  } as PoolRider & { mixedRideOk: boolean };
}

/**
 * The gender rules, unchanged from every other pool in the app: a woman is never
 * put in a car with unrelated men (and vice versa) unless she has opted into
 * mixed rides, and the compositions that make the back row uncomfortable are
 * closed outright. See lib/genderAccess.
 */
function genderGate(
  existing: PoolRider[],
  candidate: PoolRider & { mixedRideOk?: boolean },
): { allowed: true } | { allowed: false; reason: string } {
  if (existing.length === 0) return { allowed: true }; // an empty car has no composition

  const male = maleCount(existing);
  const female = femaleCount(existing);
  const composition = computeGenderAccess(male, female, MAX_POOL_RIDERS, 'any');

  return canJoinPool({
    currentComposition: composition,
    maleSeats: male,
    femaleSeats: female,
    joinerGender: candidate.gender,
    joinerMixedRideOk: candidate.mixedRideOk === true,
  });
}

// ── acceptEnRouteRider ───────────────────────────────────────────────────────

const acceptSchema = z.object({
  /** The open pool request the driver is taking. */
  tripId: z.string().min(1).max(128),
  /** Fallback road route. Ignored when the backend has its own Maps key. */
  polyline: z.string().min(4).max(60_000).optional(),
  driverLat: z.number().min(-90).max(90).optional(),
  driverLng: z.number().min(-180).max(180).optional(),
});

/**
 * The driver takes a rider from their corridor.
 *
 * Every gate `getEnRouteMatches` applied is applied again here, against freshly
 * read documents, inside the transaction that seats them — the feed the driver
 * tapped may be seconds stale, and a seat, a gender composition or a fare can all
 * have moved in that time.
 *
 * The rider's own request document is absorbed: it becomes `merged`, pointing at
 * the carrier trip, and their `activeTripId` follows. One car, one trip, one
 * settlement — which is what lets completion, cancellation, chat and the rules
 * carry on working exactly as they already do.
 */
export const acceptEnRouteRider = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  await rateLimit(ctx.uid, 'acceptEnRouteRider', 20, 60);
  const parsed = acceptSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the ride to pick up.');
  const { tripId, polyline, driverLat, driverLng } = parsed.data;

  const [driverSnap, walletSnap, commission, cancellation, cfg] = await Promise.all([
    db.doc(`drivers/${ctx.uid}`).get(),
    db.doc(`wallets/${ctx.uid}`).get(),
    getCommissionSettings(),
    getCancellationSettings(),
    loadFareConfig(),
  ]);
  if (driverSnap.get('verificationStatus') !== 'approved') {
    throw new HttpsError('permission-denied', 'Driver is not approved.');
  }
  if (driverSnap.get('online') !== true) {
    throw new HttpsError('failed-precondition', 'Go online before picking up riders.');
  }
  assertCommissionClear(driverSnap, commission);
  assertOutstandingClear(walletSnap, cancellation, 'driver');

  const carrierSnap = await activeCarrierTrip(ctx.uid);
  const resolved = await resolveCorridor(ctx.uid, polyline, carrierSnap);
  const { corridor, destination, settings } = resolved;

  const driverAlongM =
    typeof driverLat === 'number' && typeof driverLng === 'number'
      ? projectToCorridor(corridor, { lat: driverLat, lng: driverLng }).alongM
      : null;

  // In driver-route mode the rider we are taking *becomes* the carrier trip: the
  // document the car's riders and fares live on from here on.
  const carrierRef = carrierSnap ? carrierSnap.ref : db.doc(`trips/${tripId}`);
  const candidateRef = db.doc(`trips/${tripId}`);
  const isFirstRider = !carrierSnap;

  const driverInfo = {
    driverId: ctx.uid,
    displayName: (driverSnap.get('fullName') as string) ?? 'Driver',
    photoURL: (driverSnap.get('photoDocUrl') as string | null) ?? null,
    vehicleLabel: (driverSnap.get('vehicleLabel') as string) ?? 'Vehicle',
    plate: (driverSnap.get('plate') as string) ?? '',
    rating: (driverSnap.get('rating') as number) ?? 5,
  };
  const driverPhone =
    (driverSnap.get('phone') as string | null) ??
    (driverSnap.get('phoneNumber') as string | null) ??
    null;

  const result = await db.runTransaction(async (tx) => {
    // ── Reads first, all of them ──
    const candidateSnap = await tx.get(candidateRef);
    if (!candidateSnap.exists) throw new HttpsError('not-found', 'That ride no longer exists.');
    if (candidateSnap.get('status') !== 'requested') {
      throw new HttpsError('failed-precondition', 'Another driver already took that ride.');
    }
    if (candidateSnap.get('pool') !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Only riders who booked a pool can be picked up along your route.',
      );
    }
    const riderUid = candidateSnap.get('passengerId') as string;
    if (riderUid === ctx.uid) {
      throw new HttpsError('failed-precondition', 'That is your own ride request.');
    }

    const carrierData = isFirstRider ? candidateSnap.data()! : (await tx.get(carrierRef)).data()!;
    if (!isFirstRider && !CARRYING.has(carrierData.status as TripStatus)) {
      throw new HttpsError('failed-precondition', 'Your current trip is no longer active.');
    }

    // Cash only, on both sides. A wallet trip holds exactly the host's fare at
    // bid-acceptance and nothing else, so there is no held money to pay a driver
    // for an extra rider — and re-holding mid-trip against a balance that may
    // have moved is a way to strand a driver unpaid. Pool cash settlement already
    // works for many riders (completeTrip); this rides on it rather than
    // inventing a second, half-tested money path.
    if (((candidateSnap.get('paymentMethod') as string) ?? 'cash') !== 'cash') {
      throw new HttpsError(
        'failed-precondition',
        'Riders paying by wallet cannot be picked up along a route yet — cash only.',
      );
    }
    if (((carrierData.paymentMethod as string) ?? 'cash') !== 'cash') {
      throw new HttpsError(
        'failed-precondition',
        'Your current trip is paid by wallet, so extra riders cannot be added to it.',
      );
    }

    const userSnap = await tx.get(db.doc(`users/${riderUid}`));
    if (userSnap.get('poolBookingBlocked') === true) {
      throw new HttpsError(
        'permission-denied',
        'That rider is blocked from pool rides.',
      );
    }

    // ── Re-run every gate against what is true right now ──
    const existing: PoolRider[] = isFirstRider
      ? []
      : ridersOnTrip(carrierData, corridor, cfg);

    const seatsLeft = MAX_POOL_RIDERS - seatsUsed(existing);
    const seats = (candidateSnap.get('seats') as number) ?? 1;
    if (seats > seatsLeft) {
      throw new HttpsError('failed-precondition', 'Not enough seats left in your car.');
    }

    const pickup = candidateSnap.get('pickup') as { lat: number; lng: number; address?: string };
    const dropoff = candidateSnap.get('dropoff') as { lat: number; lng: number; address?: string };

    const fitRes = checkCorridorFit(corridor, destination, pickup, dropoff, settings, driverAlongM);
    if (!fitRes.ok) {
      throw new HttpsError('failed-precondition', CORRIDOR_REJECTION_MESSAGE[fitRes.reason]);
    }
    const fit = fitRes.fit;

    const rideType = (candidateSnap.get('rideType') as string) ?? 'mini';
    const candidate: PoolRider & { mixedRideOk: boolean } = {
      uid: riderUid,
      name: (userSnap.get('name') as string) ?? (userSnap.get('displayName') as string) ?? 'Rider',
      gender: (candidateSnap.get('passengerGender') as string) ?? 'unspecified',
      seats,
      rideType,
      pickup,
      dropoff,
      boardM: fit.boardM,
      alightM: fit.alightM,
      pickupOffsetM: fit.pickupOffsetM,
      dropoffOffsetM: fit.dropoffOffsetM,
      soloFare: soloFareFor(cfg, rideType, pickup, dropoff),
      fare: 0,
      billableKm: 0,
      kind: isFirstRider ? 'host' : 'enroute',
      originTripId: isFirstRider ? null : tripId,
      mixedRideOk: userSnap.get('mixedRideOk') === true,
    };

    const gate = genderGate(existing, candidate);
    if (!gate.allowed) throw new HttpsError('permission-denied', gate.reason);

    // ── Money ──
    const category = RIDE_TO_CAT[(carrierData.rideType as string) ?? 'mini'] ?? 'mini';
    const hostSolo =
      existing.find((r) => r.kind === 'host')?.soloFare ?? candidate.soloFare;
    const grossBefore = isFirstRider
      ? 0
      : priceRiders(existing, cfg, category, hostSolo).driverGross;

    const nextRiders = [...existing, candidate];
    const priced = priceRiders(nextRiders, cfg, category, hostSolo);

    const theirFare = priced.fares[candidate.uid]!;
    const offered = candidateSnap.get('offeredFare') as number;
    if (theirFare > offered) {
      throw new HttpsError(
        'failed-precondition',
        'The shared fare came out above what that rider offered.',
      );
    }
    if (!driverIsNotWorseOff(grossBefore, priced.driverGross)) {
      // Can only happen if a tier cap drags the gross down — refuse rather than
      // quietly pay the driver less for the same drive. INVARIANT 2.
      throw new HttpsError(
        'failed-precondition',
        'Taking that rider would lower your earnings for this trip.',
      );
    }

    // Fold the fares back onto the riders.
    const sealed: PoolRider[] = nextRiders.map((r) => ({
      ...r,
      fare: priced.fares[r.uid]!,
      billableKm: Math.round((priced.billableKm[r.uid] ?? 0) * 100) / 100,
      joinedAt: r.joinedAt ?? FieldValue.serverTimestamp(),
    }));
    // `mixedRideOk` was only needed for the gate — it is not the trip's business.
    for (const r of sealed) delete (r as { mixedRideOk?: boolean }).mixedRideOk;

    const members = sealed.map((r) => r.uid);
    const male = maleCount(sealed);
    const female = femaleCount(sealed);

    const enRoute = {
      active: true,
      source: resolved.source,
      origin: resolved.origin,
      destination: resolved.destination,
      polyline: resolved.polyline,
      // Which road these fares were computed against, and who supplied it. A
      // dispute months from now can be answered from the trip document alone.
      polylineSource: resolved.trusted ? 'server' : 'client',
      routeLengthM: Math.round(corridor.lengthM),
      corridorRadiusM: settings.corridorRadiusM,
      destRadiusM: settings.destRadiusM,
    };

    // ── Writes ──
    tx.set(
      carrierRef,
      {
        ...(isFirstRider
          ? {
              // The rider we just took becomes the trip the car runs on.
              status: 'matched' as TripStatus,
              driverId: ctx.uid,
              driverInfo,
              driverPhone,
              passengerPhone: (userSnap.get('phoneNumber') as string | null) ?? null,
              fare: theirFare,
              matchedAt: FieldValue.serverTimestamp(),
            }
          : {}),
        pool: true,
        poolRiders: sealed,
        poolMembers: members,
        poolFares: priced.fares,
        poolDriverGross: priced.driverGross,
        seats: seatsUsed(sealed),
        maleSeats: male,
        femaleSeats: female,
        genderComposition: computeGenderAccess(male, female, MAX_POOL_RIDERS, 'any'),
        enRoute,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // An audit line the passengers' screens read to say who joined and when.
    tx.set(carrierRef.collection('enRouteLog').doc(), {
      uid: candidate.uid,
      name: candidate.name,
      gender: candidate.gender,
      pickupAddress: pickup.address ?? null,
      dropoffAddress: dropoff.address ?? null,
      fare: theirFare,
      detourM: Math.round(fit.detourM),
      addedBy: ctx.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (!isFirstRider) {
      // Absorb the rider's own request into the carrier trip. It stops being a
      // trip in its own right, and its passenger now tracks the carrier.
      tx.set(
        candidateRef,
        {
          status: 'merged' as TripStatus,
          mergedIntoTripId: carrierRef.id,
          driverId: ctx.uid,
          driverInfo,
          fare: theirFare,
          mergedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    tx.set(db.doc(`users/${candidate.uid}`), { activeTripId: carrierRef.id }, { merge: true });

    // Off the open feed either way — it is taken.
    tx.delete(db.doc(`openRequests/${tripId}`));

    return {
      carrierTripId: carrierRef.id,
      riderUid: candidate.uid,
      riderName: candidate.name,
      riderGender: candidate.gender,
      pickupAddress: pickup.address ?? 'their pickup',
      fare: theirFare,
      driverGross: priced.driverGross,
      earnExtra: priced.driverGross - grossBefore,
      seated: existing.map((r) => ({ uid: r.uid, fareBefore: r.fare, fareAfter: priced.fares[r.uid]! })),
    };
  });

  // ── Tell everyone, immediately ──
  // The people already in the car find out who is getting in, and what it did to
  // their fare, before the car gets there. This is the whole safety story.
  await Promise.all([
    sendToUser(
      result.riderUid,
      '🚗 Driver found — shared ride',
      `You're on a pool going your way. Fare: PKR ${result.fare}.`,
      { tripId: result.carrierTripId },
    ),
    ...result.seated.map((s) =>
      sendToUser(
        s.uid,
        `👤 ${result.riderName} is joining your pool`,
        s.fareAfter < s.fareBefore
          ? `Picked up at ${result.pickupAddress}. Your fare drops to PKR ${s.fareAfter}.`
          : `Picked up at ${result.pickupAddress}. Your fare stays at PKR ${s.fareAfter}.`,
        { tripId: result.carrierTripId },
      ),
    ),
  ]).catch((e) => logger.warn('enRoute: notification failed', e));

  logger.info('En-route rider accepted', {
    driver: ctx.uid,
    carrierTripId: result.carrierTripId,
    rider: result.riderUid,
    fare: result.fare,
    driverGross: result.driverGross,
    earnExtra: result.earnExtra,
  });

  return { ok: true, ...result };
});

/** Riders on a trip — used by the passenger screen to show who else is in the car. */
export const getPoolRiders = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ tripId: z.string().min(1).max(128) }).safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');

  const snap = await db.doc(`trips/${parsed.data.tripId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Trip not found.');

  const members = (snap.get('poolMembers') as string[] | undefined) ?? [];
  if (!members.includes(ctx.uid) && snap.get('driverId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'You are not on this ride.');
  }

  const riders = (snap.get('poolRiders') as (PoolRider & { droppedAt?: unknown })[] | undefined) ?? [];
  // The driver has to collect the money, so they see every fare and the full
  // drop-off address. Co-riders see a first name, a gender and where the person
  // gets on and off — enough to know who is in the car, and nothing more.
  const isDriver = snap.get('driverId') === ctx.uid;
  return {
    riders: riders.map((r) => ({
      uid: r.uid,
      name: isDriver ? r.name : (r.name.split(' ')[0] ?? r.name),
      gender: r.gender,
      pickupAddress: r.pickup?.address ?? null,
      dropoffAddress: r.dropoff?.address ?? null,
      dropoffLat: isDriver ? (r.dropoff?.lat ?? null) : null,
      dropoffLng: isDriver ? (r.dropoff?.lng ?? null) : null,
      kind: r.kind,
      /**
       * Their own fare is theirs alone — except to the driver, who cannot ask
       * the right person for the right amount without knowing it.
       */
      fare: isDriver || r.uid === ctx.uid ? r.fare : null,
      /** Already let out. The driver's remaining-stops list is built from this. */
      droppedOff: !!r.droppedAt,
    })),
    yourFare: riders.find((r) => r.uid === ctx.uid)?.fare ?? null,
    driverGross: isDriver ? snap.get('poolDriverGross') : null,
  };
});
