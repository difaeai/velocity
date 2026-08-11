/**
 * "Is anything happening around me?" — the passenger home map's supply/demand layer.
 * ----------------------------------------------------------------------------
 * WHY A CALLABLE AND NOT A CLIENT QUERY
 * -------------------------------------
 * The security rules let a passenger read `drivers/{uid}` only if they own it,
 * and open ride requests belong to other passengers. Neither is client-readable,
 * and neither should become client-readable just to draw pins — a wide-open
 * driver collection is a live tracking feed for anybody with an account. So the
 * server does the proximity work and hands back the minimum needed to paint dots.
 *
 * WHAT THE RED DOTS ARE
 * ---------------------
 * Every user who has the app and has opened it near here recently — not only
 * the ones with a ride request open. That is what makes the map answer the
 * question a rider actually has ("is anyone around, or is this a dead zone?").
 * The positions come from `userPresence`, which each handset writes for itself
 * while the home screen is open (see apps/mobile/src/hooks/presence.ts) and
 * which expires on its own if the app stops being opened.
 *
 * Riders with an open request are folded into the same dots, keyed by uid, so
 * one person is one dot however many collections they appear in. They are also
 * counted separately as `waitingCount`, which is the number worth showing a
 * driver-curious user.
 *
 * WHAT IS DELIBERATELY NOT RETURNED
 * ---------------------------------
 * No uids, no names, no plates, no fares, no addresses. Each pin is an opaque
 * per-caller id and a coordinate that has been JITTERED (see `blur`): a driver's
 * car chip lands within a couple of hundred metres of where they actually are,
 * which is all "there are cars nearby" needs, and is not enough to stake out a
 * person. The offset is derived from the uid or doc id, so a pin does not
 * jitter about between polls — it stays put and only moves when the real
 * position moves. Nothing in the response can be attributed back to a person,
 * which is the whole reason this is a callable and `userPresence` is not
 * client-readable.
 *
 * WHY THE COUNTS MATTER AS MUCH AS THE PINS
 * -----------------------------------------
 * Zero is a real, useful answer. An empty map is the app's cue to pitch "Earn
 * with Velocity" — the person looking at it is standing in a gap in our
 * coverage, and that gap is exactly what a new fleet partner would fill. So the
 * response distinguishes "we looked and found nothing" from "we never looked",
 * and the client only pitches on the former.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { haversineM } from '../lib/corridor';
import { db, Timestamp } from '../lib/firebase';
import { neighborGeohashes } from '../lib/geohash';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().min(1).max(15).default(6),
});

/** A driver whose last ping is older than this is not "moving around" any more. */
const DRIVER_STALE_MS = 12 * 60 * 1000;

/**
 * How recently someone must have opened the app to still count as "around here".
 *
 * Long enough that a real neighbourhood looks populated rather than empty at
 * 3pm on a Tuesday, short enough that a dot means something. It is also the
 * threshold the "it's quiet here → come earn with us" pitch hangs off, so
 * stretching it would quietly stop that pitch from ever firing.
 */
const PRESENCE_STALE_MS = 6 * 60 * 60 * 1000;

/** Enough pins to read as a busy city, few enough to keep the map legible. */
const MAX_DRIVER_PINS = 30;
const MAX_DEMAND_PINS = 40;

/** How far a returned coordinate may sit from the true one, in metres. */
const DRIVER_BLUR_M = 180;
const DEMAND_BLUR_M = 260;

/** Broad-scan caps. Open requests are short-lived, so these are generous. */
const TRIP_SCAN_LIMIT = 200;
const POOL_SCAN_LIMIT = 200;

/**
 * Presence is looked up by geohash cell, so the scan is bounded by geography
 * rather than by collection size — `userPresence` has a doc per user and will
 * outgrow every other collection here.
 *
 * Precision 5 is ~5 km per cell and `neighborGeohashes` returns the 3×3 block
 * around the caller, which is why the presence radius is capped at 5 km however
 * wide the caller asks: beyond that the cell block stops being a superset of
 * the circle and people would drop off the map with no visible reason.
 */
const PRESENCE_CELL_PRECISION = 5;
const PRESENCE_MAX_RADIUS_KM = 5;
const PRESENCE_SCAN_LIMIT = 400;

/**
 * Deterministic 32-bit hash of a doc id. Same id → same number, every call, on
 * every instance, which is what keeps a blurred pin from twitching between
 * polls. Not a security primitive: it only has to spread ids evenly.
 */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Offsets a coordinate by up to `maxM` metres in a direction fixed by `seed`.
 *
 * The angle and the distance both come out of the same hash, so the pin sits at
 * a stable bearing/offset from the real position: it tracks real movement but
 * never resolves to a doorstep.
 */
function blur(lat: number, lng: number, seed: string, maxM: number): { lat: number; lng: number } {
  const h = hashId(seed);
  const angle = ((h % 3600) / 3600) * 2 * Math.PI;
  // sqrt keeps the offsets uniform over the disc instead of clumping at the centre.
  const dist = Math.sqrt(((h >>> 12) % 1000) / 1000) * maxM;
  const dLat = (dist * Math.cos(angle)) / 111_320;
  const cos = Math.cos((lat * Math.PI) / 180);
  const dLng = (dist * Math.sin(angle)) / (111_320 * (Math.abs(cos) < 1e-6 ? 1e-6 : cos));
  return {
    lat: Math.round((lat + dLat) * 1e5) / 1e5,
    lng: Math.round((lng + dLng) * 1e5) / 1e5,
  };
}

/** Opaque, stable, per-pin key for React. Never the underlying uid or doc id. */
function pinId(prefix: string, id: string): string {
  return `${prefix}_${hashId(id).toString(36)}`;
}

/**
 * What a supply pin is drawn as. Bikes are a real, separate product here — a
 * street full of motorbikes and a street full of cars are different answers to
 * "can I get a ride?" — so the map and the chip split them. Everything that is
 * not a motorbike (mini/ac/comfort/xl, and rickshaws) is one "car" bucket:
 * finer than that is fare-selection detail the home map has no business showing.
 */
type Vehicle = 'bike' | 'car';

interface Pin {
  id: string;
  lat: number;
  lng: number;
  /** Straight-line distance from the caller, rounded to 100 m. */
  distanceKm: number;
  /** Supply pins only — absent on the demand dots. */
  vehicle?: Vehicle;
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  return 0;
}

export const getNearbyActivity = onCall(async (req) => {
  const ctx = requireAuth(req);
  // The home screen polls while it is open and refetches on significant
  // movement. 120/hour is one call every 30 seconds with headroom to spare.
  await rateLimit(ctx.uid, 'nearbyActivity', 120, 3600);

  const parsed = schema.safeParse(req.data);
  if (!parsed.success) invalid('A valid location is required.');
  const { lat, lng, radiusKm } = parsed.data;
  const radiusM = radiusKm * 1000;
  const nowMs = Date.now();

  // Online drivers, everyone whose app has been here recently, and the two
  // request systems that mark someone as actively waiting.
  //
  // Drivers and requests are broad reads narrowed by haversine: `drivers` has no
  // geohash at all (presence writes are a plain merge from the handset), and
  // mixing geofire bounds against the fixed-precision `pickupGeohash` on trips
  // risks dropping edge cells. Both collections only ever hold live drivers and
  // still-open requests, so they stay small.
  //
  // `userPresence` is the one that will not stay small — a doc per user, forever
  // — so it is the one queried by geohash cell rather than scanned.
  const cells = neighborGeohashes(lat, lng, PRESENCE_CELL_PRECISION);
  const presenceRadiusM = Math.min(radiusKm, PRESENCE_MAX_RADIUS_KM) * 1000;

  const [driverSnap, presenceSnap, tripSnap, poolSnap] = await Promise.all([
    db.collection('drivers')
      .where('online', '==', true)
      .where('verificationStatus', '==', 'approved')
      .get(),
    // `neighborGeohashes` returns at most 9 values, well inside Firestore's
    // 30-value cap on `in`.
    db.collection('userPresence')
      .where('geohash', 'in', cells)
      .limit(PRESENCE_SCAN_LIMIT)
      .get(),
    db.collection('trips')
      .where('status', '==', 'requested')
      .limit(TRIP_SCAN_LIMIT)
      .get(),
    // Written as 'open'; 'active'/'full' are the states the discovery feed uses.
    db.collection('poolRideRequests')
      .where('status', 'in', ['open', 'active', 'full'])
      .limit(POOL_SCAN_LIMIT)
      .get(),
  ]);

  const drivers: Pin[] = [];
  // Anyone drawn as a vehicle must not also be drawn as a dot — one person, one pin.
  const drawnAsVehicle = new Set<string>();
  for (const doc of driverSnap.docs) {
    // A driver browsing the passenger app must not see their own car as
    // "another driver nearby" — that reads as one phantom of extra supply.
    if (doc.id === ctx.uid) continue;
    const loc = doc.get('lastLocation') as { lat?: number; lng?: number } | undefined;
    if (typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') continue;
    // Toggling online and closing the app leaves `online: true` behind, so
    // freshness is decided by the last ping, not the flag.
    if (nowMs - toMillis(doc.get('lastSeenAt')) > DRIVER_STALE_MS) continue;
    const distM = haversineM(lat, lng, loc.lat, loc.lng);
    if (distM > radiusM) continue;
    drawnAsVehicle.add(doc.id);
    const b = blur(loc.lat, loc.lng, doc.id, DRIVER_BLUR_M);
    // A driver doc predating the vehicle picker has no type at all; a car is the
    // safe default, since claiming a bike that isn't there is the worse error.
    const vehicle: Vehicle = doc.get('vehicleType') === 'bike' ? 'bike' : 'car';
    drivers.push({
      id: pinId('d', doc.id),
      lat: b.lat,
      lng: b.lng,
      distanceKm: Math.round((distM / 1000) * 10) / 10,
      vehicle,
    });
  }

  // ── The red dots ──────────────────────────────────────────────────────────
  // Keyed by uid, not by document, so somebody who has the app open AND a ride
  // request open is one dot rather than two. An open request wins the position
  // (their pickup is where they will actually be standing) and flags them as
  // waiting; presence supplies everyone else.
  const people = new Map<string, { lat: number; lng: number; waiting: boolean }>();

  const consider = (uid: unknown, pLat: unknown, pLng: unknown, waiting: boolean) => {
    if (typeof uid !== 'string' || !uid) return;
    if (typeof pLat !== 'number' || typeof pLng !== 'number') return;
    // You are never one of the dots on your own map, and a car is never a dot.
    if (uid === ctx.uid || drawnAsVehicle.has(uid)) return;
    const existing = people.get(uid);
    // Presence must not overwrite the sharper position an open request gives us.
    if (existing?.waiting && !waiting) return;
    people.set(uid, { lat: pLat, lng: pLng, waiting: waiting || !!existing?.waiting });
  };

  for (const doc of presenceSnap.docs) {
    // A cell is bigger than the radius, so the distance check below is what
    // actually decides. Freshness is decided here: presence that has aged out
    // is not "somebody around here" any more.
    if (nowMs - toMillis(doc.get('lastSeenAt')) > PRESENCE_STALE_MS) continue;
    consider(doc.id, doc.get('lat'), doc.get('lng'), false);
  }
  for (const doc of tripSnap.docs) {
    const pickup = doc.get('pickup') as { lat?: number; lng?: number } | undefined;
    consider(doc.get('passengerId'), pickup?.lat, pickup?.lng, true);
  }
  for (const doc of poolSnap.docs) {
    consider(doc.get('leaderId'), doc.get('pickupLat'), doc.get('pickupLng'), true);
  }

  const passengers: Pin[] = [];
  let waitingCount = 0;
  for (const [uid, p] of people) {
    const distM = haversineM(lat, lng, p.lat, p.lng);
    // Someone merely present is held to the tighter cell-backed radius; someone
    // actively waiting for a car is relevant as far out as the caller asked.
    if (distM > (p.waiting ? radiusM : presenceRadiusM)) continue;
    if (p.waiting) waitingCount += 1;
    // Seeded by uid rather than by document: a person's dot then stays put as
    // their trip documents come and go.
    const b = blur(p.lat, p.lng, uid, DEMAND_BLUR_M);
    passengers.push({
      id: pinId('p', uid),
      lat: b.lat,
      lng: b.lng,
      distanceKm: Math.round((distM / 1000) * 10) / 10,
    });
  }

  // Closest first, so a trimmed list is the part of the picture that is actually
  // near the person looking at it.
  drivers.sort((a, b) => a.distanceKm - b.distanceKm);
  passengers.sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    ok: true,
    radiusKm,
    // Counts are the untrimmed truth; the pin arrays are what fits on a map.
    driverCount: drivers.length,
    /** The split behind `driverCount`, so the chip can name both products. */
    bikeCount: drivers.filter((d) => d.vehicle === 'bike').length,
    carCount: drivers.filter((d) => d.vehicle === 'car').length,
    /** Everyone with the app nearby — the red dots. */
    passengerCount: passengers.length,
    /** The subset of them with a ride request actually open right now. */
    waitingCount,
    drivers: drivers.slice(0, MAX_DRIVER_PINS),
    passengers: passengers.slice(0, MAX_DEMAND_PINS),
  };
});
