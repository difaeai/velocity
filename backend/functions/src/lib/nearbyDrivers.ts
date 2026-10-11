/**
 * "Which approved, online drivers are near here?" — one implementation, two callers.
 * ----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * --------------------
 * Both the passenger home map (trips/nearbyActivity.ts) and the ride broadcast
 * (trips/index.ts) used to answer that question the same wrong way:
 *
 *     db.collection('drivers')
 *       .where('online', '==', true)
 *       .where('verificationStatus', '==', 'approved')
 *       .get()                              // <- no limit, no geography
 *
 * That reads EVERY online driver in the country and throws away all but the
 * ones within a couple of kilometres. It is correct, and it is fine at fifty
 * drivers. The cost is `onlineDrivers` document reads per call, and the home
 * map calls it once per open screen per poll — so the bill grows with
 * `users x drivers`, not with either one. Measured: 223 reads/call at 50 online
 * drivers, 2,800 at 2,000. Extrapolated to 10,000 concurrent users it is about
 * 667,000 document reads a second, which is six figures a month.
 *
 * So the query is bounded by geography instead, the same way
 * `poolRideRequests` already is: `drivers.geohash` is stamped from
 * `lastLocation` by the sweeper in drivers/geohashSweeper.ts, and the bounds
 * below turn a radius into a handful of string ranges.
 *
 * WHY THE GEOHASH IS SERVER-STAMPED AND NOT WRITTEN BY THE HANDSET
 * ---------------------------------------------------------------
 * Two reasons, both load-bearing:
 *
 *  1. The security rules let a driver write exactly seven fields on their own
 *     document (see `onlyChanges` in firestore.rules) and `geohash` is not one
 *     of them — deliberately. A client-written cell could disagree with the
 *     client-written `lastLocation` it is supposed to describe, which would let
 *     a patched build park itself in a cell it is nowhere near and harvest that
 *     area's ride requests.
 *  2. Every build already on a phone predates this field and would never write
 *     it. A geohash-bounded query against a field only new builds populate
 *     would make every existing driver vanish from every map and stop ride
 *     broadcasts dead. Deriving it server-side from `lastLocation` — which all
 *     builds do write — means this works on the installed base, today, with no
 *     app release in the path.
 *
 * WHY THE RADIUS IS PADDED
 * ------------------------
 * The stamped cell can be up to one sweep old, so a driver who has moved since
 * the last sweep is matched on where they were, not where they are. The pad
 * covers the distance a city driver covers in that window; the caller still
 * does its own exact haversine check on the fresh `lastLocation`, so padding
 * only ever widens the candidate set and never admits a far-away driver into a
 * result.
 */
import { geohashQueryBounds } from 'geofire-common';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { db } from './firebase';

/**
 * Written by drivers/geohashSweeper.ts via geofire's `geohashForLocation`,
 * whose default precision is 10 (~1 m cells). Stored at full precision on
 * purpose: `geohashQueryBounds` returns prefix ranges whose length depends on
 * the radius asked for, and a stored hash shorter than a bound's prefix would
 * sort outside it and drop out of the result. Long stored, short queried, is
 * the combination that always works — and it is what `pickupGeohash` on
 * `poolRideRequests` already does.
 */
export const DRIVER_GEOHASH_FIELD = 'geohash';

/**
 * Slack added to the query radius, in metres, to cover drivers whose stamped
 * cell is one sweep stale. 60 s of city driving at 60 km/h is 1 km; 1.5 km
 * leaves room for a late sweep without widening the scan much.
 */
export const DRIVER_GEOHASH_PAD_M = 1500;

/**
 * Hard backstop per bound range. `geohashQueryBounds` returns at most nine
 * ranges, so this caps one lookup at 9 x 200 documents however dense the city
 * gets. It exists so that a bug in the sweeper (every driver stamped into one
 * cell, say) degrades into a short result rather than back into the unbounded
 * scan this file replaced.
 */
const PER_BOUND_LIMIT = 200;

/**
 * Approved, online driver documents whose last known cell is near (lat, lng).
 *
 * Returns raw snapshots, deduplicated by id: bound ranges can overlap, and both
 * callers want to read their own fields off the document anyway. Callers MUST
 * still apply their own exact distance check — this is a candidate set, bounded
 * by geography, not a precise radius query.
 */
export async function queryNearbyDriverDocs(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<QueryDocumentSnapshot[]> {
  const bounds = geohashQueryBounds([lat, lng], radiusM + DRIVER_GEOHASH_PAD_M);

  const snaps = await Promise.all(
    bounds.map((b) =>
      db.collection('drivers')
        .where('online', '==', true)
        .where('verificationStatus', '==', 'approved')
        .where(DRIVER_GEOHASH_FIELD, '>=', b[0])
        .where(DRIVER_GEOHASH_FIELD, '<=', b[1])
        .limit(PER_BOUND_LIMIT)
        .get(),
    ),
  );

  const byId = new Map<string, QueryDocumentSnapshot>();
  for (const snap of snaps) {
    for (const doc of snap.docs) byId.set(doc.id, doc);
  }
  return [...byId.values()];
}
