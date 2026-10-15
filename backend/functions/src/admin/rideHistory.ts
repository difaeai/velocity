/**
 * The ride record — every trip the platform has ever run, and the full file on
 * any one of them.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------
 * The console could see rides in motion (`live-ops`), money after the fact
 * (`settlements`, `commission`) and complaints (`disputes`, `safety`), but it
 * could not answer the plainest question an operator ever gets asked: what
 * happened on this ride, and who was in the car. That question arrives from a
 * passenger who left a bag, from a driver disputing a fare, and — the case this
 * is really built for — from the police, who do not want an analytics chart,
 * they want names, numbers, a route and a set of timestamps.
 *
 * So there are two calls here and they are deliberately different in kind:
 *
 *   adminListRides     a scannable ledger: filter, page, skim.
 *   adminGetRideDetail one ride, assembled from every collection that holds a
 *                      piece of it, in the form you could read down a phone to
 *                      an investigating officer.
 *
 * INDEX DISCIPLINE
 * ----------------
 * This module adds no Firestore indexes, and that is a constraint on how it
 * queries rather than an accident. `trips` already carries (driverId,
 * createdAt), (passengerId, createdAt) and (status, createdAt); a filter UI
 * that let an admin tick driver AND status AND a date range would need a
 * composite for every combination they can tick. So exactly ONE equality
 * filter goes to Firestore — the narrowest one offered — and the rest are
 * applied in code over the page that comes back. The repo has been here before:
 * see the partner-withdrawal guard that queries by partnerId and filters status
 * in memory for precisely this reason. The cost is that a page can come back
 * short, which is why the result says how much was scanned to fill it.
 *
 * WHAT A CO-RIDER'S RATING IS DOING IN HERE
 * -----------------------------------------
 * Co-rider ratings are anonymous to their subject (see ratings/coRiders), and
 * this is the one place the anonymity is lifted — because the reason to lift it
 * is a complaint or a police file, and a desk that cannot see who said what
 * cannot investigate either. It stays behind requireAdmin and goes nowhere near
 * a rider's client.
 * ----------------------------------------------------------------------------
 */
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAdmin } from '../lib/guards';
import { rosterForTrip } from '../trips/poolRoster';

/** Hard ceiling on one page, whatever the caller asks for. */
const MAX_PAGE = 100;
/**
 * How many documents we are willing to read to fill one page when filters are
 * being applied in memory. Four pages' worth: generous enough that a realistic
 * filter still fills a screen, bounded enough that a pathological one (a status
 * nobody has used in a year) cannot walk the whole collection.
 */
const SCAN_MULTIPLIER = 4;
/**
 * How far back the rider view reaches. It merges two queries and so cannot be
 * cursor-paged (see `riderMode`); this is the ceiling on each half.
 */
const RIDER_MODE_CAP = 200;

const listSchema = z.object({
  /** The narrowing filters. Only the first of these reaches Firestore. */
  driverId: docId.nullish(),
  passengerId: docId.nullish(),
  status: z
    .enum([
      'requested',
      'matched',
      'arriving',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
      'merged',
    ])
    .nullish(),
  /** Shared rides only, solo only, or (absent) both. */
  pool: z.boolean().nullish(),
  /** Anyone who was in the car, host or joiner — applied in code off the roster. */
  riderId: docId.nullish(),
  fromMs: z.number().int().nonnegative().nullish(),
  toMs: z.number().int().nonnegative().nullish(),
  limit: z.number().int().min(1).max(MAX_PAGE).nullish(),
  /** Cursor: the `createdAt` of the last row of the previous page. */
  beforeMs: z.number().int().nonnegative().nullish(),
});

/** Timestamp-ish → millis, for the several shapes a trip's clock arrives in. */
function millisOf(value: unknown): number | null {
  const ts = value as { toMillis?: () => number; seconds?: number } | undefined;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts && typeof ts.seconds === 'number') return ts.seconds * 1000;
  return null;
}

const addressOf = (place: unknown): string | null => {
  const a = (place as { address?: unknown } | undefined)?.address;
  return typeof a === 'string' && a.trim() ? a.trim() : null;
};

/**
 * Every trip, filtered and paged.
 *
 * Ordered by `createdAt` descending throughout — including the in-memory
 * filtering, which preserves it — so paging with `beforeMs` is stable even
 * while new rides are being created above the cursor.
 */
export const adminListRides = onCall(async (req) => {
  requireAdmin(req);
  const parsed = listSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid filters.');
  const f = parsed.data;
  const limit = f.limit ?? 50;

  const filteredInCode: string[] = [];
  if (f.pool !== null && f.pool !== undefined) filteredInCode.push('pool');

  /**
   * "Every ride this person was in" is two questions, not one.
   *
   * `passengerId` is only ever whoever BOOKED the ride. Somebody who joined
   * another rider's shared car by invite code or from discovery appears in
   * `poolMembers` and nowhere else — so filtering a rider's history by
   * `passengerId` alone silently drops exactly the rides a complaint about a
   * shared car is usually about, while filtering it by the roster alone drops
   * every solo ride they ever took.
   *
   * So the rider view runs both and merges them. `array-contains` with an
   * `orderBy` would need a composite index, and so would pairing it with a date
   * range, so that half is fetched unordered and capped, then sorted and
   * date-filtered in code — the same shape the app's own usePoolMemberTrips
   * uses. The cost is that this one view cannot be cursor-paged, which is why
   * it answers `nextBeforeMs: null` and says as much in `pageable`.
   */
  const riderMode = !!f.riderId && !f.driverId && !f.passengerId;

  let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let scanLimit: number;
  let pageable = true;

  if (riderMode) {
    pageable = false;
    scanLimit = RIDER_MODE_CAP;
    const [booked, joined] = await Promise.all([
      db
        .collection('trips')
        .where('passengerId', '==', f.riderId)
        .orderBy('createdAt', 'desc')
        .limit(RIDER_MODE_CAP)
        .get(),
      db
        .collection('trips')
        .where('poolMembers', 'array-contains', f.riderId)
        .limit(RIDER_MODE_CAP)
        .get(),
    ]);
    const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const d of [...booked.docs, ...joined.docs]) byId.set(d.id, d);
    docs = [...byId.values()].sort(
      (a, b) => (millisOf(b.get('createdAt')) ?? 0) - (millisOf(a.get('createdAt')) ?? 0),
    );
    if (f.status) filteredInCode.push('status');
    if (f.fromMs || f.toMs) filteredInCode.push('date range');
  } else {
    // ── One equality filter goes to the index; the rest are applied below. ──
    let q: FirebaseFirestore.Query = db.collection('trips');
    if (f.driverId) {
      q = q.where('driverId', '==', f.driverId);
      if (f.passengerId) filteredInCode.push('passengerId');
      if (f.status) filteredInCode.push('status');
    } else if (f.passengerId) {
      q = q.where('passengerId', '==', f.passengerId);
      if (f.status) filteredInCode.push('status');
    } else if (f.status) {
      q = q.where('status', '==', f.status);
    }
    if (f.riderId) filteredInCode.push('riderId');

    // A date range on the same field we order by is free on every one of those
    // indexes, so it never has to be applied in code.
    if (f.fromMs) q = q.where('createdAt', '>=', Timestamp.fromMillis(f.fromMs));
    if (f.toMs) q = q.where('createdAt', '<=', Timestamp.fromMillis(f.toMs));
    q = q.orderBy('createdAt', 'desc');
    if (f.beforeMs) q = q.startAfter(Timestamp.fromMillis(f.beforeMs));

    scanLimit = filteredInCode.length > 0 ? Math.min(limit * SCAN_MULTIPLIER, 400) : limit;
    docs = (await q.limit(scanLimit).get()).docs;
  }

  const rides: Record<string, unknown>[] = [];
  let lastScannedMs: number | null = null;
  for (const doc of docs) {
    const d = doc.data();
    const createdMs = millisOf(d.createdAt);
    lastScannedMs = createdMs ?? lastScannedMs;

    if (riderMode) {
      if (f.status && d.status !== f.status) continue;
      if (f.fromMs && (createdMs ?? 0) < f.fromMs) continue;
      if (f.toMs && (createdMs ?? 0) > f.toMs) continue;
    }
    if (f.driverId && f.passengerId && d.passengerId !== f.passengerId) continue;
    if ((f.driverId || f.passengerId) && f.status && d.status !== f.status) continue;
    if (f.pool === true && d.pool !== true) continue;
    if (f.pool === false && d.pool === true) continue;

    const roster = rosterForTrip(d);
    // The roster is empty on a solo ride, so the booker is accepted directly
    // too — otherwise a rider's own solo trips never match their own filter.
    if (
      f.riderId &&
      d.passengerId !== f.riderId &&
      !roster.some((r) => r.uid === f.riderId)
    ) {
      continue;
    }

    const driverInfo = d.driverInfo as
      | { displayName?: string; plate?: string; vehicleLabel?: string }
      | undefined;
    const settlement = d.settlement as
      | { grossFare?: number; commission?: number; driverPayout?: number }
      | undefined;

    rides.push({
      id: doc.id,
      status: d.status ?? null,
      rideType: d.rideType ?? null,
      pool: d.pool === true,
      // Name and plate as they were AT THE TIME, off the trip document. A
      // driver can be suspended, renamed or moved to another car after a ride;
      // history has to keep saying who drove it that day.
      driverId: d.driverId ?? null,
      driverName: driverInfo?.displayName ?? null,
      plate: driverInfo?.plate ?? null,
      passengerId: d.passengerId ?? null,
      passengerName: d.passengerName ?? null,
      riders: roster.length,
      riderNames: roster.map((r) => r.firstName),
      pickupAddress: addressOf(d.pickup),
      dropoffAddress: addressOf(d.dropoff),
      fare: typeof d.fare === 'number' ? d.fare : (d.offeredFare ?? null),
      grossFare: settlement?.grossFare ?? null,
      commission: settlement?.commission ?? null,
      driverPayout: settlement?.driverPayout ?? null,
      paymentMethod: d.paymentMethod ?? null,
      createdAtMs: millisOf(d.createdAt),
      completedAtMs: millisOf(d.completedAt),
      cancelledByRole: d.cancelledByRole ?? null,
      // Flags the desk scans a list for.
      hasSafetyEvent: !!d.activeSafetyEventId,
      disputed: d.disputed === true,
    });
    if (rides.length >= limit) break;
  }

  return {
    rides,
    /**
     * Feed back as `beforeMs` for the next page. Null when the list is done —
     * and always null in the rider view, which merges two queries and so has no
     * single cursor to carry.
     */
    nextBeforeMs: !pageable || docs.length < scanLimit ? null : lastScannedMs,
    /** False when the result is a capped snapshot rather than a page. */
    pageable,
    /** Which filters could not be pushed into the index — see the header. */
    filteredInCode,
    scanned: docs.length,
  };
});

/**
 * One rider on a ride, as the desk needs them: by full name and phone number.
 *
 * Deliberately not what the trip document carries. A co-rider sees first names
 * only and that is a privacy rule, not a storage limitation — so the full
 * identity is looked up per rider here, behind requireAdmin, and never
 * denormalised anywhere a client could read it.
 */
async function riderFile(
  uid: string,
  trip: FirebaseFirestore.DocumentData,
): Promise<Record<string, unknown>> {
  const snap = await db.doc(`users/${uid}`).get();
  const u = snap.data() ?? {};
  const fares = (trip.poolFares as Record<string, number> | undefined) ?? {};
  const legs = (trip.poolRiders as { uid: string; fare?: number }[] | undefined) ?? [];
  return {
    uid,
    name: u.name ?? u.displayName ?? null,
    phone: u.phoneNumber ?? null,
    gender: u.gender ?? null,
    cnic: u.cnic ?? null,
    accountCreatedMs: millisOf(u.createdAt),
    banned: u.banned === true,
    // Both rating relationships, kept apart exactly as they are stored.
    driverGivenRating: typeof u.rating === 'number' ? u.rating : null,
    driverGivenRatingCount: u.ratingCount ?? 0,
    coRiderRating: typeof u.coRiderRating === 'number' ? u.coRiderRating : null,
    coRiderRatingCount: u.coRiderRatingCount ?? 0,
    /** What this particular rider owed on this particular ride. */
    fareOnThisRide:
      fares[uid] ?? legs.find((l) => l.uid === uid)?.fare ?? trip.poolPerSeatFare ?? null,
  };
}

/**
 * The full file on one ride.
 *
 * Assembled from the trip, both parties' accounts, the driver's record, and
 * every collection that files something against a tripId — ratings, safety
 * events, disputes. Each of those is a single-field equality query, so none of
 * them needs an index either.
 */
export const adminGetRideDetail = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z.object({ tripId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid ride id.');
  const { tripId } = parsed.data;

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) invalid('Ride not found.');
  const trip = tripSnap.data() ?? {};

  const driverId = (trip.driverId as string | null) ?? null;
  const roster = rosterForTrip(trip);

  const [driverProfile, driverUser, riders, ratings, safetyEvents, disputes] = await Promise.all([
    driverId ? db.doc(`drivers/${driverId}`).get() : Promise.resolve(null),
    driverId ? db.doc(`users/${driverId}`).get() : Promise.resolve(null),
    Promise.all(roster.map((r) => riderFile(r.uid, trip))),
    db.collection('ratings').where('tripId', '==', tripId).get(),
    db.collection('safetyEvents').where('tripId', '==', tripId).get(),
    db.collection('disputes').where('tripId', '==', tripId).get(),
  ]);

  const dp = driverProfile?.data() ?? {};
  const du = driverUser?.data() ?? {};
  const driverInfo = trip.driverInfo as
    | { displayName?: string; plate?: string; vehicleLabel?: string }
    | undefined;

  return {
    ride: {
      id: tripId,
      status: trip.status ?? null,
      rideType: trip.rideType ?? null,
      pool: trip.pool === true,
      poolVisibility: trip.poolVisibility ?? null,
      seats: trip.seats ?? null,
      // Coordinates as well as addresses: an address is what somebody typed,
      // a coordinate is where they were.
      pickup: trip.pickup ?? null,
      dropoff: trip.dropoff ?? null,
      /** The road the driver actually declared, when there was one. */
      route: (trip.enRoute as { polyline?: string } | undefined)?.polyline ?? null,
      lastDriverLocation: trip.driverLocation ?? null,
      lastDriverLocationMs: millisOf(trip.driverLocationAt),
      mergedIntoTripId: trip.mergedIntoTripId ?? null,
    },
    timeline: {
      requestedMs: millisOf(trip.createdAt),
      arrivedMs: millisOf(trip.arrivedAt),
      // Only rides taken after the ride-record work shipped carry this; older
      // ones answer null rather than guessing from `updatedAt`.
      startedMs: millisOf(trip.startedAt),
      completedMs: millisOf(trip.completedAt),
      cancelledMs: trip.status === 'cancelled' ? millisOf(trip.updatedAt) : null,
      lastWriteMs: millisOf(trip.updatedAt),
    },
    driver: driverId
      ? {
          uid: driverId,
          // As recorded on the ride…
          nameAtRide: driverInfo?.displayName ?? null,
          plateAtRide: driverInfo?.plate ?? null,
          vehicleAtRide: driverInfo?.vehicleLabel ?? null,
          phoneAtRide: trip.driverPhone ?? null,
          // …and as the account stands today. A driver suspended since the ride
          // (the document-expiry sweep can do that overnight) must not make the
          // history read as though they were never approved.
          nameNow: du.name ?? du.displayName ?? null,
          phoneNow: du.phoneNumber ?? null,
          cnic: dp.cnic ?? du.cnic ?? null,
          licenseNumber: dp.licenseNumber ?? null,
          plateNow: dp.plate ?? null,
          vehicleNow: dp.vehicleLabel ?? null,
          verificationStatusNow: dp.verificationStatus ?? null,
          ratingNow: typeof dp.rating === 'number' ? dp.rating : null,
          ratingCountNow: dp.ratingCount ?? 0,
        }
      : null,
    /** Everyone who was in the car, host first. Full identities. */
    riders,
    money: {
      offeredFare: trip.offeredFare ?? null,
      fare: trip.fare ?? null,
      paymentMethod: trip.paymentMethod ?? null,
      paymentMethods: trip.paymentMethods ?? null,
      settlement: trip.settlement ?? null,
      perSeatFare: trip.poolPerSeatFare ?? null,
      poolFares: trip.poolFares ?? null,
      cancellationFee: trip.cancellationFee ?? null,
      cancelledBy: trip.cancelledBy ?? null,
      cancelledByRole: trip.cancelledByRole ?? null,
      cancelReason: trip.cancelReason ?? null,
    },
    /**
     * Every rating filed against this ride, in both directions — including the
     * co-rider ratings that are anonymous everywhere else. Admin eyes only.
     */
    ratings: ratings.docs.map((d) => {
      const r = d.data();
      return {
        id: d.id,
        targetRole: r.targetRole ?? null,
        raterId: r.raterId ?? null,
        targetUid: r.targetUid ?? null,
        stars: r.stars ?? null,
        comment: r.comment ?? null,
        createdAtMs: millisOf(r.createdAt),
      };
    }),
    safetyEvents: safetyEvents.docs.map((d) => {
      const e = d.data();
      return {
        id: d.id,
        kind: e.kind ?? null,
        critical: e.critical === true,
        status: e.status ?? null,
        reportedBy: e.reportedBy ?? null,
        reportedByRole: e.reportedByRole ?? null,
        location: e.location ?? null,
        note: e.note ?? null,
        createdAtMs: millisOf(e.createdAt),
      };
    }),
    disputes: disputes.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        status: x.status ?? null,
        reason: x.reason ?? null,
        raisedBy: x.raisedBy ?? null,
        resolution: x.resolution ?? null,
        createdAtMs: millisOf(x.createdAt),
      };
    }),
  };
});

/**
 * Find the driver or rider whose rides the desk wants to look at.
 *
 * A uid is not something anybody has in their hand. What arrives with the
 * complaint is a phone number or a name, so both are searchable — by prefix,
 * which on a single field needs no composite index. Phone numbers are matched
 * as given and with a leading 0 swapped for +92, because Pakistani numbers get
 * written down both ways and an operator should not have to know which way the
 * account happens to store it.
 */
export const adminSearchRideParties = onCall(async (req) => {
  requireAdmin(req);
  const parsed = z.object({ term: z.string().min(2).max(60) }).safeParse(req.data);
  if (!parsed.success) invalid('Search for at least two characters.');
  const term = parsed.data.term.trim();

  const prefixes = new Set<string>([term]);
  const digits = term.replace(/[\s-]/g, '');
  if (/^0\d+$/.test(digits)) prefixes.add(`+92${digits.slice(1)}`);
  if (/^92\d+$/.test(digits)) prefixes.add(`+${digits}`);
  if (/^\+92\d+$/.test(digits)) prefixes.add(`0${digits.slice(3)}`);

  const byField = async (field: string, prefix: string) => {
    try {
      const snap = await db
        .collection('users')
        .where(field, '>=', prefix)
        .where(field, '<=', `${prefix}`)
        .limit(10)
        .get();
      return snap.docs;
    } catch {
      // A field nobody has ever written has no index to range over. One empty
      // branch must not take the whole search down with it.
      return [];
    }
  };

  const results = await Promise.all([
    ...[...prefixes].map((p) => byField('phoneNumber', p)),
    byField('name', term),
    byField('displayName', term),
  ]);

  const seen = new Map<string, Record<string, unknown>>();
  for (const docs of results) {
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      const u = d.data();
      seen.set(d.id, {
        uid: d.id,
        name: u.name ?? u.displayName ?? null,
        phone: u.phoneNumber ?? null,
        role: u.role ?? 'passenger',
        gender: u.gender ?? null,
        banned: u.banned === true,
      });
    }
  }

  return { people: [...seen.values()].slice(0, 20) };
});
