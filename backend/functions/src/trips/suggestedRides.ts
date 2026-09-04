/**
 * Suggested Rides — every shared car near you that still has a seat, in one list.
 * ----------------------------------------------------------------------------
 * Velocity grew three separate ways for several people to end up in one car,
 * and each of them had its own discovery screen:
 *
 *   1. `trips` with `pool: true`   — a rider booked a ride and opened it up.
 *   2. `poolRideRequests`          — riders club together first, then a driver
 *                                    takes the whole pool at a fixed per-seat fare.
 *   3. `poolRides`                 — a driver posts a route and sells the seats.
 *
 * To the person holding the phone those are not three products. They are "cars
 * going my way with room in them", and asking someone to know which of three
 * screens their seat is hiding on is asking them to understand our schema.
 *
 * This is the one feed. It reads all three, drops everything that is full or
 * expired, and returns rows in one shape with a `kind` saying which subsystem
 * the seat lives in, so the screen can render one list and still call the right
 * join function.
 *
 * WHAT NEVER APPEARS HERE
 *  - Full cars. A seat you cannot take is not a suggestion.
 *  - Private pools. The link is the credential; they are not discoverable.
 *  - Your own ride.
 *  - Pools that stopped gathering and have no driver — about to depart, or dead.
 *
 * WHAT EVERY ROW PROMISES
 *  - `farePerSeat` is what this rider would pay. It is set by whoever started
 *    the pool (or by the driver who posted the ride) and a joiner cannot move
 *    it — there is no negotiation on the way in.
 *  - `needsDriverApproval` says whether joining seats them or asks a driver.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

import { db } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { TripStatus } from '../domain/types';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { haversineKm } from './index';
import { rosterForTrip } from './poolRoster';
import { POOL_JOIN_WINDOW_MS } from './poolShare';

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** How far the rider will travel to a pickup. 25 km covers a whole metro. */
  radiusKm: z.number().min(0.5).max(25).default(5),
  /**
   * Optional destination gate. With it the feed is "rides going MY way"; without
   * it, "shared rides near me" — which is what the home screen asks for, before
   * the rider has said where they are going.
   */
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  destRadiusKm: z.number().min(0.5).max(25).default(5),
});

/** Which subsystem a seat lives in — decides which join call the screen makes. */
export type SuggestedRideKind = 'trip' | 'request' | 'ride';

export interface SuggestedRide {
  kind: SuggestedRideKind;
  /** Trip pools are joined by share code; the other two by document id. */
  id: string;
  pickupAreaName: string;
  destinationAreaName: string;
  /** Destination pin + drop zone, so a joiner can pick their own stop inside it. */
  destinationLat: number | null;
  destinationLng: number | null;
  dropRadiusM: number;
  /** What THIS rider would pay for a seat. Fixed — never negotiable by a joiner. */
  farePerSeat: number;
  seatsTotal: number;
  seatsLeft: number;
  riders: number;
  males: number;
  females: number;
  genderPref: string;
  distanceKm: number;
  hasDriver: boolean;
  driverName: string | null;
  driverVehicle: string | null;
  /** First names of the people already aboard. Never full names, never uids. */
  companions: { firstName: string; gender: string }[];
  /** Epoch-ms a driverless pool stops gathering riders. Null once it has a driver. */
  joinWindowEndsAt: number | null;
  /** True when Join sends a request to a driver instead of taking the seat. */
  needsDriverApproval: boolean;
  rideType: string | null;
}

const MATCHED_JOINABLE: TripStatus[] = ['matched', 'arriving', 'arrived'];

/** Epoch-ms when a driverless pool's gathering window closes. */
function windowEndOf(d: FirebaseFirestore.DocumentData): number | null {
  const ms = (d.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.getTime();
  return typeof ms === 'number' ? ms + POOL_JOIN_WINDOW_MS : null;
}

function expired(value: unknown, now: Date): boolean {
  const d = value as { toDate?: () => Date } | undefined;
  const at = d?.toDate?.();
  return at instanceof Date && at < now;
}

export const getSuggestedRides = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = schema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid location data.');
  const { lat, lng, radiusKm, destLat, destLng, destRadiusKm } = parsed.data;
  const filterByDest = typeof destLat === 'number' && typeof destLng === 'number';
  const now = new Date();

  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  const ownTripId = userSnap.get('activeTripId') as string | undefined;

  const rides: SuggestedRide[] = [];

  /** Does this ride end near enough to where the caller is going? */
  const headingMyWay = (dLat: unknown, dLng: unknown): boolean => {
    if (!filterByDest) return true;
    if (typeof dLat !== 'number' || typeof dLng !== 'number') return false;
    return haversineKm(destLat, destLng, dLat, dLng) <= destRadiusKm;
  };

  // ── 1. Pool trips (booking flow) ───────────────────────────────────────────
  const scanTrips = async (statuses: TripStatus[], hasDriver: boolean) => {
    const snap = await db.collection('trips')
      .where('pool', '==', true)
      .where('status', 'in', statuses)
      .limit(100)
      .get();

    for (const doc of snap.docs) {
      const d = doc.data();
      if (doc.id === ownTripId) continue;
      if ((d.poolVisibility ?? 'public') !== 'public') continue;
      const code = d.shareCode as string | undefined;
      if (!code) continue; // legacy pools have no invite code to join by

      const members = (d.poolMembers as string[] | undefined) ?? [d.passengerId as string];
      if (members.includes(ctx.uid)) continue;
      const maxRiders = (d.maxPoolRiders as number | undefined) ?? MAX_POOL_RIDERS;
      if (members.length >= maxRiders) continue;

      const soloFare = (d.fare as number | null) ?? (d.offeredFare as number);
      if (!(soloFare > 0)) continue;

      const windowEnd = hasDriver ? null : windowEndOf(d);
      if (!hasDriver && windowEnd !== null && windowEnd <= now.getTime()) continue;

      const pLat = d.pickup?.lat as number | undefined;
      const pLng = d.pickup?.lng as number | undefined;
      if (typeof pLat !== 'number' || typeof pLng !== 'number') continue;
      const distanceKm = haversineKm(lat, lng, pLat, pLng);
      if (distanceKm > radiusKm) continue;
      if (!headingMyWay(d.dropoff?.lat, d.dropoff?.lng)) continue;

      const genders = (d.poolGenders as { male?: number; female?: number } | undefined) ?? {};
      const driver = d.driverInfo as { displayName?: string; vehicleLabel?: string } | undefined;

      rides.push({
        kind: 'trip',
        id: code,
        pickupAreaName: (d.pickup?.address as string | undefined) ?? 'Nearby',
        destinationAreaName: (d.dropoff?.address as string | undefined) ?? 'Destination',
        destinationLat: (d.dropoff?.lat as number | undefined) ?? null,
        destinationLng: (d.dropoff?.lng as number | undefined) ?? null,
        dropRadiusM: 1000,
        farePerSeat: poolPerSeatFare(soloFare, members.length + 1),
        seatsTotal: maxRiders,
        seatsLeft: maxRiders - members.length,
        riders: members.length,
        males: genders.male ?? 0,
        females: genders.female ?? 0,
        genderPref: 'any',
        distanceKm: Math.round(distanceKm * 10) / 10,
        hasDriver,
        driverName: driver?.displayName ?? null,
        driverVehicle: driver?.vehicleLabel ?? null,
        companions: rosterForTrip(d)
          .filter((r) => r.uid !== ctx.uid)
          .map((r) => ({ firstName: r.firstName, gender: r.gender })),
        joinWindowEndsAt: windowEnd,
        needsDriverApproval: hasDriver,
        rideType: (d.rideType as string | undefined) ?? null,
      });
    }
  };

  // ── 2. Pool ride requests (riders club together, then a driver takes it) ───
  const scanRequests = async () => {
    const bounds = geohashQueryBounds([lat, lng], radiusKm * 1000);
    const snaps = await Promise.all(
      bounds.map((b) =>
        db.collection('poolRideRequests')
          .where('status', 'in', ['open', 'active'])
          .where('pickupGeohash', '>=', b[0])
          .where('pickupGeohash', '<=', b[1])
          .get(),
      ),
    );

    const seen = new Set<string>();
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const d = doc.data();

        if (((d.passengers ?? []) as string[]).includes(ctx.uid)) continue;
        const seatsLeft = (d.totalSlots as number) - (d.filledSlots as number);
        if (seatsLeft <= 0) continue;
        if (d.status === 'open' && expired(d.expiresAt, now)) continue;

        const distanceKm = distanceBetween([lat, lng], [d.pickupLat as number, d.pickupLng as number]);
        if (distanceKm > radiusKm) continue;
        if (!headingMyWay(d.destinationLat, d.destinationLng)) continue;

        const names = (d.passengerNames ?? {}) as Record<string, string>;
        rides.push({
          kind: 'request',
          id: doc.id,
          pickupAreaName: d.pickupAreaName as string,
          destinationAreaName: d.destinationAreaName as string,
          destinationLat: (d.destinationLat as number | undefined) ?? null,
          destinationLng: (d.destinationLng as number | undefined) ?? null,
          dropRadiusM: (d.dropRadiusM as number | undefined) ?? 1000,
          farePerSeat: (d.agreedFarePerSeat ?? d.proposedFarePerSeat) as number,
          seatsTotal: d.totalSlots as number,
          seatsLeft,
          riders: d.filledSlots as number,
          males: (d.maleSeats as number) ?? 0,
          females: (d.femaleSeats as number) ?? 0,
          genderPref: (d.genderPref as string) ?? 'any',
          distanceKm: Math.round(distanceKm * 10) / 10,
          hasDriver: d.driverId != null,
          driverName: (d.driverName as string | null) ?? null,
          driverVehicle: (d.driverVehicle as string | null) ?? null,
          companions: ((d.passengers ?? []) as string[])
            .filter((uid) => uid !== ctx.uid)
            .map((uid) => ({ firstName: names[uid] ?? 'Rider', gender: 'unspecified' })),
          joinWindowEndsAt: null,
          needsDriverApproval: d.driverId != null,
          rideType: null,
        });
      }
    }
  };

  // ── 3. Driver-posted pool rides ────────────────────────────────────────────
  const scanDriverRides = async () => {
    const snap = await db.collection('poolRides')
      .where('status', 'in', ['open', 'collecting'])
      .limit(100)
      .get();

    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.driverId === ctx.uid) continue;
      const seatsLeft = (d.maxSeats as number) - (d.takenSeats as number);
      if (seatsLeft <= 0) continue;

      const pLat = (d.pickup?.lat as number | undefined) ?? 0;
      const pLng = (d.pickup?.lng as number | undefined) ?? 0;
      if (pLat === 0 && pLng === 0) continue; // text-only offer, nothing to match on
      const distanceKm = distanceBetween([lat, lng], [pLat, pLng]);
      if (distanceKm > radiusKm) continue;
      if (!headingMyWay(d.dropoff?.lat, d.dropoff?.lng)) continue;

      rides.push({
        kind: 'ride',
        id: doc.id,
        pickupAreaName: (d.pickup?.address as string | undefined) ?? 'Nearby',
        destinationAreaName: (d.dropoff?.address as string | undefined) ?? 'Destination',
        destinationLat: (d.dropoff?.lat as number | undefined) ?? null,
        destinationLng: (d.dropoff?.lng as number | undefined) ?? null,
        dropRadiusM: (d.dropoffRadius as number | undefined) ?? 1000,
        farePerSeat: d.perSeatFare as number,
        seatsTotal: d.maxSeats as number,
        seatsLeft,
        riders: d.takenSeats as number,
        males: (d.maleSeats as number) ?? 0,
        females: (d.femaleSeats as number) ?? 0,
        genderPref: (d.genderPref as string) ?? 'any',
        distanceKm: Math.round(distanceKm * 10) / 10,
        hasDriver: true,
        driverName: (d.driverName as string | null) ?? null,
        driverVehicle: (d.vehicleLabel as string | null) ?? null,
        companions: [],
        joinWindowEndsAt: null,
        // The driver posted these seats to be taken, so taking one is not a
        // request — that is the whole offer.
        needsDriverApproval: false,
        rideType: (d.rideCategory as string | undefined) ?? null,
      });
    }
  };

  // Each source is best-effort: one missing composite index must not empty the
  // whole feed, it must only cost the rows that index would have served.
  const sources: [string, Promise<void>][] = [
    ['matched pools',   scanTrips(MATCHED_JOINABLE, true)],
    ['gathering pools', scanTrips(['requested'], false)],
    ['pool requests',   scanRequests()],
    ['driver pools',    scanDriverRides()],
  ];
  for (const [label, work] of sources) {
    try {
      await work;
    } catch (err) {
      logger.warn('getSuggestedRides: source failed', { source: label, err });
    }
  }

  rides.sort((a, b) => a.distanceKm - b.distanceKm);
  return { rides: rides.slice(0, 30) };
});
