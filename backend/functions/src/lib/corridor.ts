/**
 * Route-corridor geometry.
 * ----------------------------------------------------------------------------
 * En-route pickups need one question answered exactly: *is this point on the
 * driver's way, and where along the way?* Everything in this file is pure maths
 * over a decoded road polyline — no Firebase, no I/O — so it can be unit-tested
 * to the metre.
 *
 * WHY A POLYLINE AND NOT A STRAIGHT LINE
 * A straight line from F10 to F6 passes through blocks the car never drives.
 * Corridor membership has to be measured against the actual road route, so we
 * work on the encoded polyline the Routes API returns.
 *
 * WHO SUPPLIES IT
 * The backend has no Google Maps key (the server prices from haversine today —
 * see offeredFareBounds), so the *driver's app* fetches the route and posts the
 * encoded polyline up. That makes it untrusted input, which is why
 * `validateRoutePolyline` exists: the shape must actually start at the origin,
 * end at the destination, and not be absurdly longer than the straight line.
 * Money never rests on it alone — every en-route fare is additionally capped at
 * the rider's own server-computed solo fare (see enRouteFare.ts), so a doctored
 * polyline cannot inflate a single rupee.
 *
 * PROJECTION
 * Distances are computed in a local equirectangular projection (metres, x=east,
 * y=north) anchored at the polyline's first point. Over a city-sized bounding
 * box this is accurate to well under a metre — far below the ~1 km corridor and
 * GPS noise we actually care about — and it keeps point-to-segment projection a
 * simple, exact 2-D dot product instead of a spherical approximation.
 */

/** Mean Earth radius, metres. */
const R = 6_371_000;
const toRad = (d: number): number => (d * Math.PI) / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Decode a Google-encoded polyline into lat/lng points.
 * Mirrors decodePolyline() in the mobile app so both sides read the exact same
 * shape from the exact same string.
 */
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      if (Number.isNaN(b)) return points; // truncated input — return what we have
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      if (Number.isNaN(b)) return points;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }

  return points;
}

/**
 * A decoded route ready for corridor queries: the points, the running arc
 * length at each point (metres from the origin), and the local projection
 * anchor. Build it once per request and reuse it across every candidate.
 */
export interface Corridor {
  points: LatLng[];
  /** cum[i] = metres travelled along the route from points[0] to points[i]. */
  cum: number[];
  /** Total route length in metres. */
  lengthM: number;
  /** Projection anchor (the first point) and the cos(lat) scale for longitude. */
  anchorLat: number;
  anchorLng: number;
  cosAnchor: number;
}

export function buildCorridor(points: LatLng[]): Corridor {
  if (points.length < 2) {
    throw new Error('A corridor needs at least two points.');
  }
  const cum = new Array<number>(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cum[i] = cum[i - 1]! + haversineM(a.lat, a.lng, b.lat, b.lng);
  }
  const anchorLat = points[0]!.lat;
  return {
    points,
    cum,
    lengthM: cum[cum.length - 1]!,
    anchorLat,
    anchorLng: points[0]!.lng,
    cosAnchor: Math.cos(toRad(anchorLat)),
  };
}

/** Project lat/lng into local metres (x east, y north) around the corridor anchor. */
function toLocalXY(c: Corridor, p: LatLng): { x: number; y: number } {
  return {
    x: toRad(p.lng - c.anchorLng) * R * c.cosAnchor,
    y: toRad(p.lat - c.anchorLat) * R,
  };
}

/** Where a point sits relative to the route. */
export interface Projection {
  /** Perpendicular distance from the point to the nearest point ON the route, metres. */
  offsetM: number;
  /** Arc position of that nearest point, metres from the route origin. */
  alongM: number;
  /** Index of the polyline segment the nearest point falls on. */
  segment: number;
}

/**
 * Nearest point on the route to `p`, exactly.
 *
 * Walks every segment, projects `p` onto it (clamped to the segment's ends, so
 * the answer is always a point the car actually drives through), and keeps the
 * closest. O(n) per query on a polyline of a few hundred points — nothing worth
 * optimising against Firestore round-trips.
 */
export function projectToCorridor(c: Corridor, p: LatLng): Projection {
  const q = toLocalXY(c, p);

  let bestOffset = Infinity;
  let bestAlong = 0;
  let bestSegment = 0;

  for (let i = 0; i < c.points.length - 1; i += 1) {
    const a = toLocalXY(c, c.points[i]!);
    const b = toLocalXY(c, c.points[i + 1]!);

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const segLenSq = abx * abx + aby * aby;

    // Fraction of the way along [a,b] where the perpendicular from q lands,
    // clamped into [0,1] so we never project onto the segment's extension.
    let t = 0;
    if (segLenSq > 0) {
      t = ((q.x - a.x) * abx + (q.y - a.y) * aby) / segLenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }

    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const dx = q.x - cx;
    const dy = q.y - cy;
    const offset = Math.sqrt(dx * dx + dy * dy);

    if (offset < bestOffset) {
      bestOffset = offset;
      bestSegment = i;
      // Arc position: start of this segment plus how far along it we landed.
      // Use the segment's true (haversine) length so `alongM` stays consistent
      // with `cum`, which is what every fare leg is measured from.
      const segArc = c.cum[i + 1]! - c.cum[i]!;
      bestAlong = c.cum[i]! + t * segArc;
    }
  }

  return { offsetM: bestOffset, alongM: bestAlong, segment: bestSegment };
}

// ── Validation of the client-supplied polyline ──────────────────────────────

/** How far the polyline's ends may sit from the origin/destination they claim. */
export const ENDPOINT_TOLERANCE_M = 500;
/** A road route longer than this multiple of the straight line is not a route. */
export const MAX_ROUTE_DETOUR_FACTOR = 3;
/** Plus this slack, so short hops (where the factor is meaningless) still pass. */
export const ROUTE_LENGTH_SLACK_M = 2_000;
/** Upper bound on polyline size — guards against a client posting a huge blob. */
export const MAX_POLYLINE_POINTS = 4_000;

export type PolylineRejection =
  | 'too_few_points'
  | 'too_many_points'
  | 'origin_mismatch'
  | 'destination_mismatch'
  | 'implausible_length';

/**
 * Is this polyline actually the route it claims to be?
 *
 * It must start at the origin, end at the destination, and have a plausible
 * length for that pair. Anything else is either a bug or a driver trying to
 * bend the corridor to sweep up rides that are not on their way.
 */
export function validateRoutePolyline(
  points: LatLng[],
  origin: LatLng,
  destination: LatLng,
): { ok: true; corridor: Corridor } | { ok: false; reason: PolylineRejection } {
  if (points.length < 2) return { ok: false, reason: 'too_few_points' };
  if (points.length > MAX_POLYLINE_POINTS) return { ok: false, reason: 'too_many_points' };

  const first = points[0]!;
  const last = points[points.length - 1]!;

  if (haversineM(first.lat, first.lng, origin.lat, origin.lng) > ENDPOINT_TOLERANCE_M) {
    return { ok: false, reason: 'origin_mismatch' };
  }
  if (haversineM(last.lat, last.lng, destination.lat, destination.lng) > ENDPOINT_TOLERANCE_M) {
    return { ok: false, reason: 'destination_mismatch' };
  }

  const corridor = buildCorridor(points);
  const straightM = haversineM(origin.lat, origin.lng, destination.lat, destination.lng);
  const maxPlausible = straightM * MAX_ROUTE_DETOUR_FACTOR + ROUTE_LENGTH_SLACK_M;
  if (corridor.lengthM > maxPlausible) {
    return { ok: false, reason: 'implausible_length' };
  }

  return { ok: true, corridor };
}

export const POLYLINE_REJECTION_MESSAGE: Record<PolylineRejection, string> = {
  too_few_points:        'The route could not be read. Try again with a live map connection.',
  too_many_points:       'That route is too detailed to process.',
  origin_mismatch:       'The route does not start at your pickup point.',
  destination_mismatch:  'The route does not end at your destination.',
  implausible_length:    'That route is far longer than the trip it claims to cover.',
};
