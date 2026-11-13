/**
 * Seeded rides — the demand a cold area is shown until it has its own.
 * ----------------------------------------------------------------------------
 * The owner's rule (2026-11-13). A new city starts empty, and an empty screen
 * is what makes both sides leave: a driver who registers, looks at "no rides
 * near you" and never opens the app again, and a rider who sees nothing moving
 * and books a rickshaw instead. So an area with almost nobody in it is shown a
 * small, fixed set of example shared rides — PKR 1,200, 1,600 and 1,900, with
 * people already sharing them — and they disappear the moment the area has
 * real ones.
 *
 * FOUR THINGS THIS MODULE IS CAREFUL ABOUT
 * ----------------------------------------
 *  1. THEY ARE NEVER BOOKABLE. A seeded ride is a picture, not a seat. Its id
 *     carries the `seed:` prefix, nothing is written to Firestore for it, and
 *     every callable that would act on a pool refuses that id with `SEED_GONE`
 *     — the owner's sentence: the car has gone and the queue starts from the
 *     beginning. That refusal is the one honest moment in the feature, so it is
 *     worded as the owner asked and never dressed up as an error.
 *  2. THEY STOP ON THEIR OWN. `seedsAllowed` counts the real drivers and the
 *     real riders in the area and returns false once BOTH have reached
 *     `SEED_UNTIL`. Nobody has to remember to turn them off, and an area that
 *     goes quiet again gets them back.
 *  3. THEY OBEY THE GENDER RULE. Each seeded ride carries the gender of the
 *     people in it and is shown only to readers the real rule would let join —
 *     the same decision `sameGenderGate` makes for a real car, including its
 *     mutual mixed-ride opt-in. A woman is never shown a car of men she could
 *     not get into, seeded or not.
 *  4. THEY DO NOT MOVE UNDER THE READER. The set is derived from a ten-minute
 *     bucket, so a screen that polls every twenty seconds sees the same cards
 *     with the same departure times rather than a list that reshuffles while
 *     somebody is reading it.
 * ----------------------------------------------------------------------------
 */
import { geohashForLocation } from 'geofire-common';

import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { queryNearbyDriverDocs } from '../lib/nearbyDrivers';
import { GAZETTEER } from '../traffic/gazetteer';

/** The three fares the owner named. One seeded ride each, per gender. */
export const SEED_FARES = [1200, 1600, 1900] as const;

/**
 * Real drivers AND real riders an area needs before the seeded rides stop.
 * Below it on either side the area still needs the nudge, so they stay mixed in
 * with whatever real rides exist; at five of each it can stand on its own.
 */
export const SEED_UNTIL = 5;

/** What counts as "this area" when counting who is already in it. */
export const SEED_AREA_RADIUS_M = 5000;

/** How often the set rolls over, so departures stay plausible without flickering. */
const SEED_ROTATE_MS = 10 * 60 * 1000;

/** Every seeded id starts with this. Nothing real ever does. */
export const SEED_PREFIX = 'seed:';

export const isSeedRideId = (id: unknown): id is string =>
  typeof id === 'string' && id.startsWith(SEED_PREFIX);

/**
 * What a rider or driver is told when they act on a seeded ride. The owner's
 * words (2026-11-13): the ride has gone, and the queue fills from the start.
 */
export const SEED_GONE =
  'That shared ride has just left. The queue starts again from the beginning — '
  + 'book a seat and you will be first in the next car.';

export type SeedGender = 'male' | 'female';

interface Place { lat: number; lng: number; address: string }

/** One seeded ride, before it is dressed as a card or a driver's job. */
interface Seed {
  id: string;
  gender: SeedGender;
  /** The car's whole-route fare — one of SEED_FARES. */
  fare: number;
  /** People already in it: 1, 2 or 3, so there is always a seat left. */
  riders: number;
  /** Minutes from now until it leaves. */
  leavesInMin: number;
}

/**
 * The six seeded rides of a bucket: three fares, each as a men's car and a
 * women's car. Rider counts and departures are derived from the bucket so they
 * advance over the day instead of being frozen at "3 riders, leaving in 7
 * minutes" forever.
 */
function seedsOfBucket(bucket: number): Seed[] {
  const out: Seed[] = [];
  const genders: SeedGender[] = ['male', 'female'];
  for (const gender of genders) {
    SEED_FARES.forEach((fare, i) => {
      const n = bucket + i + (gender === 'female' ? 3 : 0);
      out.push({
        id: SEED_PREFIX + gender + ':' + fare,
        gender,
        fare,
        // 1..3 — never MAX_POOL_RIDERS, so every seeded card still offers a seat.
        riders: (n % Math.max(1, MAX_POOL_RIDERS - 1)) + 1,
        leavesInMin: 4 + ((n * 7) % 26),
      });
    });
  }
  return out;
}

/**
 * Which seeded rides this person may be shown.
 *
 * Deliberately the real rule rather than a copy of it: a seeded car of men is
 * offered to a man, to a woman only when she has opted into mixed rides, and to
 * somebody who has not set a gender only under that same opt-in — which is what
 * `sameGenderGate` decides for a real car. Nobody is ever shown a seeded ride
 * the real rules would refuse them, so the screen never teaches a rider to
 * expect a car they cannot have.
 */
function visibleTo(seeds: Seed[], gender: string, mixedOk: boolean): Seed[] {
  if (gender === 'male' || gender === 'female') {
    return mixedOk ? seeds : seeds.filter((s) => s.gender === gender);
  }
  // Gender not set: the real rule gives them an empty car only, so they are
  // shown seeded rides only once they have opted into mixed ones.
  return mixedOk ? seeds : [];
}

// ── Is this area still cold? ─────────────────────────────────────────────────

/**
 * Online drivers near a point, cached per ~5 km cell.
 *
 * The screens that ask this poll every twenty seconds, and the answer only has
 * to be right to within "about five". Without the cache this would add a
 * geohash query per poll per open screen, which is the kind of cost that does
 * not show up until the day it matters.
 */
const supplyCache = new Map<string, { atMs: number; drivers: number }>();
const SUPPLY_TTL_MS = 60_000;

/** For tests, which move drivers faster than the cache forgets. */
export const clearSeedSupplyCache = () => supplyCache.clear();

async function realDriversNear(lat: number, lng: number): Promise<number> {
  const cell = geohashForLocation([lat, lng], 5);
  const hit = supplyCache.get(cell);
  if (hit && Date.now() - hit.atMs < SUPPLY_TTL_MS) return hit.drivers;
  const drivers = (await queryNearbyDriverDocs(lat, lng, SEED_AREA_RADIUS_M)).length;
  supplyCache.set(cell, { atMs: Date.now(), drivers });
  return drivers;
}

export interface SeedDecision {
  show: boolean;
  drivers: number;
  riders: number;
}

/**
 * Whether an area still gets seeded rides.
 *
 * `realRiders` is counted by the caller from the pools it has already loaded —
 * free, where a second query would not be. BOTH sides have to reach
 * `SEED_UNTIL` before the seeds stop: an area with eight drivers and one rider
 * is exactly the one that still needs demand shown, which is the whole point.
 *
 * A failed driver count is treated as a cold area rather than a warm one. The
 * worst case of being wrong that way is a few example cards on a busy screen;
 * the worst case the other way is the empty screen this exists to prevent.
 */
export async function seedsAllowed(
  lat: number,
  lng: number,
  realRiders: number,
): Promise<SeedDecision> {
  const drivers = await realDriversNear(lat, lng).catch(() => 0);
  return { show: drivers < SEED_UNTIL || realRiders < SEED_UNTIL, drivers, riders: realRiders };
}

// ── Where a seeded ride goes ─────────────────────────────────────────────────

const toRad = (d: number) => (d * Math.PI) / 180;

/** Straight-line metres. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The nearest named place we already hold coordinates for.
 *
 * `traffic/gazetteer` is our own hand-checked table of the roads and
 * interchanges in the cities Velocity serves. Using it here costs nothing and
 * keeps the seeded rides honest about geography: a driver in Rawalpindi is
 * shown "Faizabad Interchange", never an invented address — and never a
 * reverse-geocode, which would put a Google bill on a screen that is only
 * showing examples.
 */
function nearestNamed(at: { lat: number; lng: number }): string | null {
  let best: { name: string; m: number } | null = null;
  for (const e of GAZETTEER) {
    const m = metres(at, e);
    if (!best || m < best.m) best = { name: e.name, m };
  }
  // Outside every city we hold: no invented name.
  return best && best.m <= 25_000 ? best.name : null;
}

/** A named place some distance from here, for the far end of an example. */
function namedAway(at: { lat: number; lng: number }, notName: string | null): Place | null {
  let best: { e: (typeof GAZETTEER)[number]; m: number } | null = null;
  for (const e of GAZETTEER) {
    if (e.name === notName) continue;
    const m = metres(at, e);
    // Far enough to be a journey, near enough to be the same city.
    if (m < 4000 || m > 20_000) continue;
    if (!best || m < best.m) best = { e, m };
  }
  return best ? { lat: best.e.lat, lng: best.e.lng, address: best.e.name } : null;
}

/**
 * The ends of a seeded ride for somebody who only told us where they are — a
 * driver's screen, or a rider who has not searched yet. Both ends come from the
 * gazetteer, so the example names real places in their own city, or none at all.
 */
export const nameOfPlaceNear = (at: { lat: number; lng: number }): string | null => nearestNamed(at);

export function seedEndsNear(at: { lat: number; lng: number }): { pickup: Place; dropoff: Place } | null {
  const fromName = nearestNamed(at);
  if (!fromName) return null;
  const to = namedAway(at, fromName);
  if (!to) return null;
  return { pickup: { lat: at.lat, lng: at.lng, address: fromName }, dropoff: to };
}

// ── The cards ────────────────────────────────────────────────────────────────

/** Only the parts of a ride a seed decides; the caller shapes the rest. */
export interface SeedRide {
  id: string;
  seeded: true;
  gender: SeedGender;
  fare: number;
  riders: number;
  seatsLeft: number;
  farePerSeat: number;
  fareLadder: number[];
  departsAtMs: number;
  pickup: Place;
  dropoff: Place;
}

export interface SeedRideArgs {
  nowMs: number;
  /** The reader's own gender and mixed-ride answer — the gender rule's input. */
  gender: string;
  mixedOk: boolean;
  /** Where the ride starts and ends. Both ends needed, or nothing is returned. */
  pickup: Place | null;
  dropoff: Place | null;
}

/**
 * The seeded rides for one reader.
 *
 * Returns nothing at all when either end is unknown. A card with a blank pickup
 * is worse than no card: it reads as a broken app rather than as a ride
 * somebody could take.
 */
export function seedRides(args: SeedRideArgs): SeedRide[] {
  const { pickup, dropoff } = args;
  if (!pickup || !dropoff) return [];
  const bucket = Math.floor(args.nowMs / SEED_ROTATE_MS);
  return visibleTo(seedsOfBucket(bucket), args.gender, args.mixedOk).map((s) => ({
    id: s.id,
    seeded: true as const,
    gender: s.gender,
    fare: s.fare,
    riders: s.riders,
    seatsLeft: Math.max(1, MAX_POOL_RIDERS - s.riders),
    // Priced exactly as a real seat would be: the car's route shared one more way.
    farePerSeat: poolPerSeatFare(s.fare, s.riders + 1),
    fareLadder: Array.from({ length: MAX_POOL_RIDERS }, (_, i) => poolPerSeatFare(s.fare, i + 1)),
    departsAtMs: args.nowMs + s.leavesInMin * 60_000,
    pickup,
    dropoff,
  }));
}
