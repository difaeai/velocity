/**
 * Named pickup points: a place a rider can be told to stand, by name.
 * ----------------------------------------------------------------------------
 * THE PROBLEM WITH A RADIUS
 * -------------------------
 * A shared ride currently matches on a radius. "Within 1 km of this point" is
 * the right way to SEARCH, and a poor way to MEET:
 *
 *   - It is a continuous space, so no two riders are ever in the same place.
 *     Four people within a kilometre of each other are four separate detours,
 *     and the driver's route is a zigzag whose extra minutes nobody is paying
 *     for. That is also why every extra gender or seat rule bites so hard: the
 *     pool is already fragmented by geometry before any rule is applied.
 *   - It cannot be said out loud. The joiner's pickup used to reach the driver
 *     as the literal string "Current location" — see where the shared-rides
 *     screen calls `joinPoolRide`. A driver cannot find that, and a rider
 *     cannot be told to wait there.
 *
 * A handful of named points fixes both. Riders converge on the same few spots,
 * so the driver drives a line instead of a zigzag, and the pickup has a name
 * both of them already use.
 *
 * WHY THIS WORKS HERE AND FAILED IN THE US
 * ----------------------------------------
 * Uber's Express Pool asked riders to walk to a generated corner and was the
 * first thing it dropped. The difference is not distance, it is familiarity:
 * waiting at a named stop for a shared vehicle is already how a wagon or a
 * Qingqi works in Pakistan, and "Kalma Chowk" is an instruction a rider can
 * act on without a map. A dropped pin 300 m away is not.
 *
 * So the points are never invented. They come from `velocityLocations` — our
 * own first-party registry, built from places riders actually named and GPS we
 * are allowed to keep — which means every suggestion is somewhere people
 * already go by a name people already say. A generated midpoint would be
 * exactly the thing that failed.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not force anybody. A rider who wants to be collected where they are
 * standing still can be; this is an offer of a better-known spot, ranked by how
 * little walking it costs and how little it bends the driver's route. When the
 * registry has nothing nearby — which is most of the country until traffic
 * builds the registry up — it returns an empty list and the screens fall back
 * to the rider's own position, exactly as before.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

import { db } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { haversineM } from '../lib/corridor';
import { LOCATIONS_COLLECTION } from './registry';

/**
 * How far a rider will walk to a point they know by name.
 *
 * 600 m is about seven minutes. Beyond that the walk stops being a convenience
 * and starts being the reason they book a solo ride instead — and unlike the
 * drop-off, where 400 m is already pushing it, a rider setting out from home
 * has not yet spent anything and is choosing freely.
 */
const MAX_WALK_M = 600;

/** Never offer more than this many: a list of options is not a decision. */
const MAX_POINTS = 4;

const schema = z.object({
  /** Where the rider is now. */
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /**
   * Where the ride is going, when the caller knows. With it, points are also
   * ranked on whether they are ON THE WAY rather than behind the rider — a
   * named stop in the wrong direction is a longer trip for everybody.
   */
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  /** How far the rider is willing to walk. Capped at MAX_WALK_M. */
  walkM: z.number().int().min(50).max(MAX_WALK_M).optional(),
});

export interface PickupPoint {
  /** `velocity:<id>` — the same id shape the rest of the app uses for own places. */
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  /** How far the rider walks, in metres. */
  walkM: number;
  /**
   * Metres this point adds to the journey versus setting off from where the
   * rider stands. Negative means it is actually closer to the destination —
   * the rider walks toward their ride rather than away from it.
   */
  detourM: number | null;
}

/**
 * Rank: cheap to walk to, and on the way.
 *
 * The walk is what the rider pays and the detour is what the car pays, and
 * they trade off — a point 500 m away that saves the car a kilometre is a
 * better stop than one next door that sends it backwards. Weighting the walk
 * more heavily keeps the rider's cost dominant, because the rider is the one
 * who can simply decline.
 */
function score(p: PickupPoint): number {
  return p.walkM * 2 + (p.detourM ?? 0);
}

/**
 * Verified named points within walking distance, best first.
 *
 * Never throws for want of data: an empty list is a correct answer in a city
 * whose registry is still empty, and callers treat it as "use the rider's own
 * position". Only `verified` places are offered — a pending one is a name one
 * rider used once, and sending a driver to it would be sending them to a guess.
 */
export async function pickupPointsNear(args: {
  lat: number;
  lng: number;
  destLat?: number;
  destLng?: number;
  walkM?: number;
}): Promise<PickupPoint[]> {
  const radiusM = Math.min(args.walkM ?? MAX_WALK_M, MAX_WALK_M);

  try {
    const bounds = geohashQueryBounds([args.lat, args.lng], radiusM);
    const snaps = await Promise.all(
      bounds.map((b) =>
        db.collection(LOCATIONS_COLLECTION)
          .where('status', '==', 'verified')
          .where('geohash', '>=', b[0])
          .where('geohash', '<=', b[1])
          .get()
      )
    );

    const hasDest = typeof args.destLat === 'number' && typeof args.destLng === 'number';
    /** The rider's own distance to the destination — the baseline a detour is measured against. */
    const baseM = hasDest
      ? haversineM(args.lat, args.lng, args.destLat!, args.destLng!)
      : null;

    const seen = new Set<string>();
    const points: PickupPoint[] = [];

    for (const snap of snaps) {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const d = doc.data();
        const lat = d.lat as number;
        const lng = d.lng as number;
        if (typeof lat !== 'number' || typeof lng !== 'number') continue;

        // geohash bounds are a box; this is the circle.
        const walkM = Math.round(distanceBetween([args.lat, args.lng], [lat, lng]) * 1000);
        if (walkM > radiusM) continue;
        // A point the rider is already standing on is not worth offering as a
        // choice — it is just where they are.
        if (walkM < 25) continue;

        points.push({
          placeId: `velocity:${doc.id}`,
          name: (d.name as string) ?? 'Pickup point',
          lat,
          lng,
          walkM,
          detourM: baseM === null
            ? null
            : Math.round(haversineM(lat, lng, args.destLat!, args.destLng!) - baseM),
        });
      }
    }

    return points.sort((a, b) => score(a) - score(b)).slice(0, MAX_POINTS);
  } catch (e) {
    // A pickup suggestion is a convenience. Losing it must never cost a booking.
    logger.warn('pickupPointsNear failed', e);
    return [];
  }
}

/**
 * Named spots near the rider they could be collected from instead.
 *
 * The booking and join screens call this to replace "Current location" with
 * somewhere a driver can find and a rider can be told to wait.
 */
export const getPickupPoints = onCall(async (req) => {
  requireAuth(req);
  const parsed = schema.safeParse(req.data);
  if (!parsed.success) invalid('Provide your current coordinates.');

  const points = await pickupPointsNear(parsed.data);
  return { points, maxWalkM: MAX_WALK_M };
});
