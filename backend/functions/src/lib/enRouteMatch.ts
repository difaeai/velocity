/**
 * En-route matching rules — is this rider actually on the driver's way?
 * ----------------------------------------------------------------------------
 * Four gates, all of them geometric and all of them pure, so the exact same
 * function decides what the driver is shown and what the driver is allowed to
 * accept. (The listing endpoint and the accept endpoint calling different rules
 * is how ride-hailing backends end up honouring matches they never offered.)
 *
 *   1. ON THE WAY        pickup within `corridorRadiusM` of the road route (1 km).
 *   2. ENDS WHERE WE END drop-off within `destRadiusM` of the route's destination
 *                        (4 km) — so the driver is never dragged away from where
 *                        they were already going.
 *   3. FORWARD ONLY      they get out further along the route than they got in.
 *                        Without this, a rider heading back toward F10 would look
 *                        like a match and send the car backwards.
 *   4. NOT BEHIND US     their pickup is not somewhere the car has already driven
 *                        past. Cheap to check, and it is the difference between a
 *                        useful feed and one full of impossible rides.
 *
 * Radii are admin-configurable (config/enRouteSettings); the defaults are the
 * 1 km corridor and 4 km drop allowance the product asks for.
 */
import { db } from './firebase';
import { Corridor, LatLng, haversineM, projectToCorridor } from './corridor';

/** Pickup must be within this far of the road route to count as "on the way". */
export const DEFAULT_CORRIDOR_RADIUS_M = 1_000;
/** Drop-off must be within this far of where the driver is already headed. */
export const DEFAULT_DEST_RADIUS_M = 4_000;
/** Below this the "ride" is a walk, and the split maths gets degenerate. */
export const MIN_RIDE_SPAN_M = 300;
/** GPS slack before we call a pickup "already behind the car". */
export const BEHIND_SLACK_M = 400;

export interface EnRouteSettings {
  corridorRadiusM: number;
  destRadiusM: number;
  /** Master switch — lets support turn the whole feature off without a deploy. */
  enabled: boolean;
}

export const DEFAULT_EN_ROUTE_SETTINGS: EnRouteSettings = {
  corridorRadiusM: DEFAULT_CORRIDOR_RADIUS_M,
  destRadiusM: DEFAULT_DEST_RADIUS_M,
  enabled: true,
};

const inRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Admin-configured corridor rules (config/enRouteSettings). */
export async function getEnRouteSettings(): Promise<EnRouteSettings> {
  try {
    const snap = await db.doc('config/enRouteSettings').get();
    if (snap.exists) {
      const corridor = snap.get('corridorRadiusM');
      const dest = snap.get('destRadiusM');
      return {
        corridorRadiusM: inRange(corridor, 200, 5_000) ? corridor : DEFAULT_CORRIDOR_RADIUS_M,
        destRadiusM: inRange(dest, 500, 15_000) ? dest : DEFAULT_DEST_RADIUS_M,
        enabled: snap.get('enabled') !== false,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_EN_ROUTE_SETTINGS;
}

export type CorridorRejection =
  | 'pickup_off_route'
  | 'dropoff_too_far'
  | 'wrong_direction'
  | 'behind_driver';

/** Where a candidate rider sits on the driver's route, once they've passed the gates. */
export interface CorridorFit {
  boardM: number;
  alightM: number;
  pickupOffsetM: number;
  dropoffOffsetM: number;
  /** Distance from the drop-off to the route's destination — gate 2's measurement. */
  dropToDestM: number;
  /** Extra metres the driver drives to serve this rider: off the route and back. */
  detourM: number;
}

/**
 * Run the four gates. Returns where the rider sits on the route, or why not.
 *
 * `driverAlongM` is the driver's own arc position — pass it once the car is
 * moving so riders it has already driven past stop showing up. Omit it (or pass
 * null) before the trip starts, when the whole route is still ahead.
 */
export function checkCorridorFit(
  corridor: Corridor,
  destination: LatLng,
  pickup: LatLng,
  dropoff: LatLng,
  settings: Pick<EnRouteSettings, 'corridorRadiusM' | 'destRadiusM'>,
  driverAlongM?: number | null,
): { ok: true; fit: CorridorFit } | { ok: false; reason: CorridorRejection } {
  // Gate 1 — the pickup has to be on the road the driver is already on.
  const pickupProj = projectToCorridor(corridor, pickup);
  if (pickupProj.offsetM > settings.corridorRadiusM) {
    return { ok: false, reason: 'pickup_off_route' };
  }

  // Gate 2 — the drop-off has to be near where the driver is already ending up.
  const dropToDestM = haversineM(dropoff.lat, dropoff.lng, destination.lat, destination.lng);
  if (dropToDestM > settings.destRadiusM) {
    return { ok: false, reason: 'dropoff_too_far' };
  }

  const dropProj = projectToCorridor(corridor, dropoff);

  // Gate 3 — they must be travelling the same way the car is. A rider whose
  // drop-off projects to a point at or before their pickup wants to go back the
  // way we came, however close to the route they are standing.
  if (dropProj.alongM - pickupProj.alongM < MIN_RIDE_SPAN_M) {
    return { ok: false, reason: 'wrong_direction' };
  }

  // Gate 4 — don't offer the driver a pickup they have already sailed past.
  if (typeof driverAlongM === 'number' && pickupProj.alongM < driverAlongM - BEHIND_SLACK_M) {
    return { ok: false, reason: 'behind_driver' };
  }

  // Off the route to their door and back again, at both ends.
  const detourM = 2 * pickupProj.offsetM + 2 * dropProj.offsetM;

  return {
    ok: true,
    fit: {
      boardM: pickupProj.alongM,
      alightM: dropProj.alongM,
      pickupOffsetM: pickupProj.offsetM,
      dropoffOffsetM: dropProj.offsetM,
      dropToDestM,
      detourM,
    },
  };
}

export const CORRIDOR_REJECTION_MESSAGE: Record<CorridorRejection, string> = {
  pickup_off_route: 'That pickup is not on your route.',
  dropoff_too_far:  'That drop-off is too far from where you are heading.',
  wrong_direction:  'That rider is travelling the other way.',
  behind_driver:    'You have already driven past that pickup.',
};
