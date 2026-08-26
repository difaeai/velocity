import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, requireRole, invalid } from '../lib/guards';
import { computeGenderAccess, canJoinPool } from '../lib/genderAccess';
import { assertCommissionClear, getCommissionSettings } from '../domain/commission';
import { distanceM, effectiveDropRadiusM, getAdminDropRadiusM } from '../lib/poolRadius';
import { firstNameOf } from '../trips/poolRoster';

type GenderPref = 'male_only' | 'female_only' | 'any';

/**
 * How long a driver-accepted pool waits for co-riders before both sides are
 * asked whether they still want to go with just the leader aboard.
 */
export const POOL_NO_JOINER_WINDOW_MS = 10 * 60 * 1000;
// Client countdowns drift a little against server time — accept a response a
// few seconds early rather than bounce a tap made at the visible 0:00 mark.
const NO_JOINER_WINDOW_SLACK_MS = 20 * 1000;

/**
 * Joiners choose either the pool's exact destination ("same area") or their own
 * drop-off within 2 km of it. The leader/admin drop radius still applies when
 * it is wider, but a joiner is never held to less than the 2 km choice.
 */
export const POOL_JOIN_RADIUS_M = 2000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return distanceBetween([lat1, lng1], [lat2, lng2]);
}

async function getUserGender(uid: string): Promise<string> {
  const snap = await db.doc(`users/${uid}`).get();
  return snap.exists ? (snap.data()!.gender ?? 'unspecified') : 'unspecified';
}

async function getUserMixedRideOk(uid: string): Promise<boolean> {
  const snap = await db.doc(`users/${uid}`).get();
  return snap.exists ? ((snap.data()!.mixedRideOk as boolean) ?? false) : false;
}

function genderAllowed(userGender: string, pref: GenderPref): boolean {
  if (pref === 'any') return true;
  if (pref === 'male_only' && userGender === 'male') return true;
  if (pref === 'female_only' && userGender === 'female') return true;
  return false;
}

// ── createPoolRideRequest ─────────────────────────────────────────────────────

const CreateSchema = z.object({
  pickupLat:           z.number().min(-90).max(90),
  pickupLng:           z.number().min(-180).max(180),
  pickupAreaName:      z.string().trim().min(1).max(120),
  destinationLat:      z.number().min(-90).max(90),
  destinationLng:      z.number().min(-180).max(180),
  destinationAreaName: z.string().trim().min(1).max(120),
  proposedFarePerSeat: z.number().int().min(50).max(10000),
  totalSlots:          z.number().int().min(2).max(4),
  genderPref:          z.enum(['male_only', 'female_only', 'any']),
});

export const createPoolRideRequest = onCall(async (req) => {
  const ctx = requireAuth(req); // drivers off shift may act as passengers too
  const p = CreateSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const d = p.data;

  const leaderSnap = await db.doc(`users/${ctx.uid}`).get();
  const leaderData = leaderSnap.exists ? leaderSnap.data()! : {};
  const leaderGender: string = (leaderData.gender as string) ?? 'unspecified';
  // First name only — the whole pool (and browsing drivers) can see this.
  const leaderFirstName = firstNameOf(leaderData.displayName ?? leaderData.fullName);

  // Enforce gender: if requesting male_only/female_only the leader must match.
  if (!genderAllowed(leaderGender, d.genderPref)) {
    throw new HttpsError('failed-precondition', 'Your gender does not match the ride preference you selected.');
  }

  const geohash = geohashForLocation([d.pickupLat, d.pickupLng]);

  // Expire in 30 minutes if no driver responds.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  // Drop zone: joiners must be dropped within this radius of the leader's
  // destination (admin-configurable, default 1 km). Fixed at creation so the
  // rule everyone agreed to cannot shift under them mid-ride.
  const dropRadiusM = await getAdminDropRadiusM();

  // Seed passenger gender composition from the leader.
  const initMale   = leaderGender === 'male'   ? 1 : 0;
  const initFemale = leaderGender === 'female' ? 1 : 0;
  const initComposition = computeGenderAccess(initMale, initFemale, d.totalSlots, d.genderPref as 'male_only' | 'female_only' | 'any');

  const ref = db.collection('poolRideRequests').doc();
  await ref.set({
    leaderId:            ctx.uid,
    leaderGender,
    pickupAreaName:      d.pickupAreaName,
    pickupLat:           d.pickupLat,
    pickupLng:           d.pickupLng,
    pickupGeohash:       geohash,
    destinationAreaName: d.destinationAreaName,
    destinationLat:      d.destinationLat,
    destinationLng:      d.destinationLng,
    proposedFarePerSeat: d.proposedFarePerSeat,
    agreedFarePerSeat:   null,
    counterFarePerSeat:  null,
    totalSlots:          d.totalSlots,
    filledSlots:         1,
    passengers:          [ctx.uid],
    // First names only, keyed by uid — what drivers browsing pools and
    // co-riders are allowed to see of each other.
    passengerNames:      { [ctx.uid]: leaderFirstName },
    dropRadiusM,
    passengerDropoffs:   {},
    genderPref:          d.genderPref,
    maleSeats:           initMale,
    femaleSeats:         initFemale,
    genderComposition:   initComposition,
    driverId:            null,
    driverName:          null,
    driverVehicle:       null,
    driverPlate:         null,
    driverGender:        null,
    status:              'open',
    expiresAt,
    createdAt:           FieldValue.serverTimestamp(),
    updatedAt:           FieldValue.serverTimestamp(),
  });

  return { ok: true, requestId: ref.id };
});

// ── driverRespondToRequest ────────────────────────────────────────────────────

const DriverRespondSchema = z.object({
  requestId:           z.string().min(1).max(128),
  action:              z.enum(['accept', 'counter']),
  counterFarePerSeat:  z.number().int().min(50).max(10000).optional(),
});

export const driverRespondToRequest = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const p = DriverRespondSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { requestId, action } = p.data;

  // Pool fares are set by the pool, take-it-or-leave-it. 'counter' stays in the
  // schema so older app builds get this sentence instead of a validation error.
  if (action === 'counter') {
    throw new HttpsError(
      'failed-precondition',
      'Pool fares are fixed — counter offers are no longer available. Accept the fare or skip this pool.',
    );
  }

  // Fetch driver profile for name/vehicle info.
  const driverSnap = await db.doc(`drivers/${ctx.uid}`).get();
  if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver profile not found.');
  // Locked drivers must settle their commission cycle before taking new work.
  assertCommissionClear(driverSnap, await getCommissionSettings());
  const driverData = driverSnap.data()!;

  const reqRef = db.doc(`poolRideRequests/${requestId}`);

  let newStatus: string;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ride request not found.');
    const data = snap.data()!;

    if (data.leaderId === ctx.uid) {
      throw new HttpsError('failed-precondition', 'You cannot accept your own ride request.');
    }
    if (data.status !== 'open') {
      throw new HttpsError('failed-precondition', `Request is not open (current status: ${data.status}).`);
    }
    if (data.driverId !== null) {
      throw new HttpsError('failed-precondition', 'Another driver has already responded to this request.');
    }

    // Gender check: driver gender vs request gender pref.
    const driverGender: string = driverData.gender ?? 'unspecified';
    const genderPref = data.genderPref as GenderPref;
    if (!genderAllowed(driverGender, genderPref)) {
      throw new HttpsError('failed-precondition', 'Your gender does not match this ride request preference.');
    }

    // A pool can fill up with passengers before any driver takes it — accepting
    // one of those goes straight to 'full' so no further joiners slip in.
    newStatus = (data.filledSlots as number) >= (data.totalSlots as number) ? 'full' : 'active';

    tx.update(reqRef, {
      driverId:           ctx.uid,
      driverName:         driverData.fullName ?? 'Driver',
      driverVehicle:      driverData.vehicleLabel ?? 'Car',
      driverPlate:        driverData.plate ?? 'N/A',
      driverGender,
      status:             newStatus,
      agreedFarePerSeat:  data.proposedFarePerSeat,
      counterFarePerSeat: null,
      // Starts the no-joiner clock: if the pool is still just the leader after
      // POOL_NO_JOINER_WINDOW_MS, both sides get asked whether to go anyway.
      activatedAt:        FieldValue.serverTimestamp(),
      goAnyway:           { leader: null, driver: null },
      goAnywayConfirmed:  false,
      updatedAt:          FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, status: newStatus! };
});

// ── leaderRespondToOffer ──────────────────────────────────────────────────────

const LeaderRespondSchema = z.object({
  requestId: z.string().min(1).max(128),
  action:    z.enum(['accept', 'reject']),
});

export const leaderRespondToOffer = onCall(async (req) => {
  const ctx = requireAuth(req); // drivers off shift may act as passengers too
  const p = LeaderRespondSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { requestId, action } = p.data;

  const reqRef = db.doc(`poolRideRequests/${requestId}`);
  let newStatus: string;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ride request not found.');
    const data = snap.data()!;

    if (data.leaderId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Only the ride leader can respond to a counter offer.');
    }
    if (data.status !== 'negotiating') {
      throw new HttpsError('failed-precondition', 'No active counter offer to respond to.');
    }

    if (action === 'accept') {
      newStatus = 'active';
      tx.update(reqRef, {
        status:            'active',
        agreedFarePerSeat: data.counterFarePerSeat,
        counterFarePerSeat: null,
        updatedAt:         FieldValue.serverTimestamp(),
      });
    } else {
      // Leader rejects the counter: clear the driver and re-open.
      newStatus = 'open';
      tx.update(reqRef, {
        status:             'open',
        driverId:           null,
        driverName:         null,
        driverVehicle:      null,
        driverPlate:        null,
        driverGender:       null,
        counterFarePerSeat: null,
        updatedAt:          FieldValue.serverTimestamp(),
      });
    }
  });

  return { ok: true, status: newStatus! };
});

// ── joinPoolRideRequest ───────────────────────────────────────────────────────

const JoinSchema = z.object({
  requestId: z.string().min(1).max(128),
  // Joiner's own drop-off. Optional — omitted means "same destination as the
  // leader". When given it must be inside the request's drop zone.
  dropoffLat:      z.number().min(-90).max(90).optional(),
  dropoffLng:      z.number().min(-180).max(180).optional(),
  dropoffAreaName: z.string().trim().min(1).max(120).optional(),
});

export const joinPoolRideRequest = onCall(async (req) => {
  const ctx = requireAuth(req); // drivers off shift may act as passengers too
  const p = JoinSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid request.');
  const { requestId, dropoffLat, dropoffLng, dropoffAreaName } = p.data;
  const adminDropRadiusM = await getAdminDropRadiusM();

  const passengerGender = await getUserGender(ctx.uid);
  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  if (userSnap.exists && userSnap.data()!.poolBookingBlocked === true) {
    throw new HttpsError(
      'permission-denied',
      'Your account is blocked from pool rides due to a gender misrepresentation report.',
    );
  }
  const reqRef = db.doc(`poolRideRequests/${requestId}`);

  let farePerSeat: number;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ride request not found.');
    const data = snap.data()!;

    // Joinable while the pool is looking for a driver ('open') and after one
    // accepted ('active'). The fare is fixed either way — drivers cannot
    // negotiate a pool, so the proposed fare IS the fare.
    if (data.status !== 'active' && data.status !== 'open') {
      throw new HttpsError('failed-precondition', 'This ride can no longer be joined.');
    }
    if (data.status === 'open'
        && data.expiresAt && typeof (data.expiresAt as { toDate?: () => Date }).toDate === 'function'
        && (data.expiresAt as { toDate: () => Date }).toDate() < new Date()) {
      throw new HttpsError('failed-precondition', 'This ride request has expired.');
    }
    if ((data.passengers as string[]).includes(ctx.uid)) {
      // Already a member — return silently.
      farePerSeat = (data.agreedFarePerSeat ?? data.proposedFarePerSeat) as number;
      return;
    }
    if (data.filledSlots >= data.totalSlots) {
      throw new HttpsError('failed-precondition', 'This ride is full.');
    }

    // Gender enforcement — joining passenger must match the leader's preference.
    if (!genderAllowed(passengerGender, data.genderPref as GenderPref)) {
      throw new HttpsError('permission-denied', 'Your gender does not match this ride\'s preference.');
    }

    // Drop-zone rule — the joiner's drop-off must be within the request's
    // drop radius of the leader's destination (the pool destination decided
    // when the ride was created). Omitted coords mean "same destination".
    if (typeof dropoffLat === 'number' && typeof dropoffLng === 'number') {
      // Joiners always get at least the 2 km choice; a wider leader/admin
      // radius still counts when one was set.
      const dropRadiusM = Math.max(
        effectiveDropRadiusM(data.dropRadiusM as number | undefined, adminDropRadiusM),
        POOL_JOIN_RADIUS_M,
      );
      const distM = distanceM(
        data.destinationLat as number, data.destinationLng as number,
        dropoffLat, dropoffLng,
      );
      if (distM > dropRadiusM) {
        throw new HttpsError(
          'failed-precondition',
          `Your drop-off is ${(distM / 1000).toFixed(1)} km from the pool destination. ` +
          `It must be within ${(dropRadiusM / 1000).toFixed(1)} km of "${data.destinationAreaName}" — ` +
          'pick the same area, a point inside that radius, or ask the driver to drop you within it.',
        );
      }
    }

    // Composition rules — check whether the resulting mix is acceptable.
    const maleSeats   = (data.maleSeats   as number) ?? 0;
    const femaleSeats = (data.femaleSeats as number) ?? 0;
    const currentComposition = computeGenderAccess(
      maleSeats, femaleSeats, data.totalSlots as number, data.genderPref as GenderPref,
    );

    // Fetch mixedRideOk outside the transaction value already read.
    const joinerMixedRideOk = await getUserMixedRideOk(ctx.uid);
    const check = canJoinPool({
      currentComposition,
      maleSeats,
      femaleSeats,
      joinerGender: passengerGender,
      joinerMixedRideOk,
    });
    if (!check.allowed) throw new HttpsError('permission-denied', check.reason);

    const newMale   = maleSeats   + (passengerGender === 'male'   ? 1 : 0);
    const newFemale = femaleSeats + (passengerGender === 'female' ? 1 : 0);
    const newComposition = computeGenderAccess(
      newMale, newFemale, data.totalSlots as number, data.genderPref as GenderPref,
    );

    farePerSeat = (data.agreedFarePerSeat ?? data.proposedFarePerSeat) as number;
    const newFilledSlots = (data.filledSlots as number) + 1;

    // A driverless pool that fills up stays 'open' — it still needs a driver,
    // and drivers browse open requests (fullness comes from filledSlots).
    // Once a driver holds it, filling the last seat closes it as 'full'.
    const newStatus = newFilledSlots >= (data.totalSlots as number)
      ? (data.driverId ? 'full' : 'open')
      : data.status;

    tx.update(reqRef, {
      passengers:        FieldValue.arrayUnion(ctx.uid),
      filledSlots:       newFilledSlots,
      maleSeats:         newMale,
      femaleSeats:       newFemale,
      genderComposition: newComposition,
      status:            newStatus,
      [`passengerNames.${ctx.uid}`]: firstNameOf(
        userSnap.exists ? (userSnap.data()!.displayName ?? userSnap.data()!.fullName) : null,
      ),
      // Record where this joiner wants to be dropped (leader/driver can see
      // every stop stays inside the drop zone). Null coords = same destination.
      [`passengerDropoffs.${ctx.uid}`]: {
        lat:      dropoffLat ?? null,
        lng:      dropoffLng ?? null,
        areaName: dropoffAreaName ?? (data.destinationAreaName as string),
      },
      updatedAt:         FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, farePerSeat: farePerSeat! };
});

// ── cancelPoolRideRequest ─────────────────────────────────────────────────────

const CancelSchema = z.object({ requestId: z.string().min(1).max(128) });

export const cancelPoolRideRequest = onCall(async (req) => {
  const ctx = requireAuth(req); // drivers off shift may act as passengers too
  const p = CancelSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid request.');
  const { requestId } = p.data;

  const reqRef = db.doc(`poolRideRequests/${requestId}`);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Ride request not found.');
  if (snap.data()!.leaderId !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Only the leader can cancel this request.');
  }
  const cancellableStatuses = ['open', 'negotiating', 'active'];
  if (!cancellableStatuses.includes(snap.data()!.status)) {
    throw new HttpsError('failed-precondition', `Cannot cancel from status: ${snap.data()!.status}.`);
  }

  await reqRef.update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ── respondToPoolGoAnyway ─────────────────────────────────────────────────────
// Ten minutes after a driver takes a pool, if the leader is still riding alone,
// BOTH sides are asked whether they want to go anyway. Going needs both to say
// yes; either one can cancel instead.

const GoAnywaySchema = z.object({
  requestId: z.string().min(1).max(128),
  action:    z.enum(['go', 'cancel']),
});

export const respondToPoolGoAnyway = onCall(async (req) => {
  const ctx = requireAuth(req);
  const p = GoAnywaySchema.safeParse(req.data);
  if (!p.success) invalid('Invalid request.');
  const { requestId, action } = p.data;

  const reqRef = db.doc(`poolRideRequests/${requestId}`);

  let confirmed = false;
  let status = '';
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ride request not found.');
    const data = snap.data()!;

    const role: 'leader' | 'driver' | null =
      data.leaderId === ctx.uid ? 'leader'
      : data.driverId === ctx.uid ? 'driver'
      : null;
    if (!role) {
      throw new HttpsError('permission-denied', 'Only the ride leader or the assigned driver can respond.');
    }
    if (data.status !== 'active') {
      throw new HttpsError('failed-precondition', `This ride is not waiting on a decision (status: ${data.status}).`);
    }
    if ((data.filledSlots as number) > 1) {
      // Someone joined after the prompt appeared — the question no longer applies.
      throw new HttpsError('failed-precondition', 'A co-rider has joined — the ride goes ahead as a shared pool.');
    }

    // The question only opens once the no-joiner window has actually elapsed.
    const activatedAt = data.activatedAt as { toDate?: () => Date } | null;
    const activatedMs = activatedAt?.toDate?.()?.getTime();
    if (typeof activatedMs !== 'number'
        || Date.now() - activatedMs < POOL_NO_JOINER_WINDOW_MS - NO_JOINER_WINDOW_SLACK_MS) {
      throw new HttpsError('failed-precondition', 'The waiting window for co-riders is still running.');
    }

    if (action === 'cancel') {
      status = 'cancelled';
      tx.update(reqRef, {
        status:      'cancelled',
        cancelledBy: role,
        updatedAt:   FieldValue.serverTimestamp(),
      });
      return;
    }

    const goAnyway = { leader: null, driver: null, ...(data.goAnyway ?? {}) } as
      { leader: boolean | null; driver: boolean | null };
    goAnyway[role] = true;
    confirmed = goAnyway.leader === true && goAnyway.driver === true;
    status = 'active';
    tx.update(reqRef, {
      goAnyway,
      goAnywayConfirmed: confirmed,
      updatedAt:         FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, status, confirmed };
});

// ── getNearbyPoolRequests (driver) ────────────────────────────────────────────

const NearbyRequestsSchema = z.object({
  lat:      z.number().min(-90).max(90),
  lng:      z.number().min(-180).max(180),
  radiusKm: z.number().min(0.5).max(10).default(3),
});

export const getNearbyPoolRequests = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const p = NearbyRequestsSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid location data.');
  const { lat, lng, radiusKm } = p.data;

  const driverSnap = await db.doc(`drivers/${ctx.uid}`).get();
  const driverGender: string = driverSnap.exists ? (driverSnap.data()!.gender ?? 'unspecified') : 'unspecified';

  const radiusM = radiusKm * 1000;
  const bounds = geohashQueryBounds([lat, lng], radiusM);
  const now = new Date();

  const snapshots = await Promise.all(
    bounds.map((b) =>
      db.collection('poolRideRequests')
        .where('status', '==', 'open')
        .where('pickupGeohash', '>=', b[0])
        .where('pickupGeohash', '<=', b[1])
        .get()
    )
  );

  const results: object[] = [];
  const seen = new Set<string>();

  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);

      const d = doc.data();

      // Precise distance filter.
      const distKmVal = distKm(lat, lng, d.pickupLat as number, d.pickupLng as number);
      if (distKmVal > radiusKm) continue;

      // Filter out expired requests. Firestore returns Timestamps — comparing
      // a Timestamp object to a Date with < is always false, so convert first.
      if (d.expiresAt && typeof (d.expiresAt as { toDate?: () => Date }).toDate === 'function'
          && (d.expiresAt as { toDate: () => Date }).toDate() < now) continue;

      // Gender match: driver must match the request's pref.
      if (!genderAllowed(driverGender, d.genderPref as GenderPref)) continue;

      // Who is in the pool — first name and what each of them pays, in join
      // order, so the driver can weigh the whole pool before accepting.
      const farePerSeat = (d.agreedFarePerSeat ?? d.proposedFarePerSeat) as number;
      const names    = (d.passengerNames ?? {}) as Record<string, string>;
      const dropoffs = (d.passengerDropoffs ?? {}) as Record<string, { areaName?: string } | undefined>;
      const members  = ((d.passengers ?? []) as string[]).map((uid) => ({
        name:            names[uid] ?? 'Rider',
        farePerSeat,
        // The leader rides to the pool destination; joiners may have their own
        // drop-off inside the radius.
        dropoffAreaName: dropoffs[uid]?.areaName ?? (d.destinationAreaName as string),
      }));

      results.push({
        requestId:           doc.id,
        pickupAreaName:      d.pickupAreaName,
        destinationAreaName: d.destinationAreaName,
        proposedFarePerSeat: d.proposedFarePerSeat,
        farePerSeat,
        totalSlots:          d.totalSlots,
        filledSlots:         d.filledSlots,
        slotsAvailable:      (d.totalSlots as number) - (d.filledSlots as number),
        genderPref:          d.genderPref,
        members,
        totalFare:           farePerSeat * (d.filledSlots as number),
        totalFareIfFull:     farePerSeat * (d.totalSlots as number),
        distanceKm:          Math.round(distKmVal * 10) / 10,
      });
    }
  }

  // Sort nearest first.
  results.sort((a: any, b: any) => a.distanceKm - b.distanceKm);
  return { requests: results };
});

// ── getNearbyActiveRides (passenger — Task 2: anonymous discovery) ─────────────

const NearbyActiveSchema = z.object({
  lat:      z.number().min(-90).max(90),
  lng:      z.number().min(-180).max(180),
  radiusKm: z.number().min(0.5).max(5).default(2),
});

export const getNearbyActiveRides = onCall(async (req) => {
  // Both passengers and drivers may call this.
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

  const p = NearbyActiveSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid location data.');
  const { lat, lng, radiusKm } = p.data;

  const radiusM = radiusKm * 1000;
  const bounds = geohashQueryBounds([lat, lng], radiusM);

  // Query both active pool ride REQUESTS (passenger-initiated) and open
  // driver-posted pool RIDES, anonymise everything before returning.
  const [requestSnaps, rideSnaps] = await Promise.all([
    Promise.all(
      bounds.map((b) =>
        db.collection('poolRideRequests')
          // 'open' too: pools are joinable while still looking for a driver, so
          // riders can gather before one accepts.
          .where('status', 'in', ['open', 'active', 'full'])
          .where('pickupGeohash', '>=', b[0])
          .where('pickupGeohash', '<=', b[1])
          .get()
      )
    ),
    // Driver-initiated pool rides use pickup stored under pickup.lat/lng
    // with NO geohash — do a broad query then haversine filter.
    db.collection('poolRides')
      .where('status', 'in', ['open', 'collecting'])
      .limit(100)
      .get(),
  ]);

  const rides: object[] = [];
  const seen = new Set<string>();

  // Pool ride requests (passenger-initiated).
  for (const snap of requestSnaps) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      const d = doc.data();
      const distKmVal = distKm(lat, lng, d.pickupLat as number, d.pickupLng as number);
      if (distKmVal > radiusKm) continue;

      // Driverless requests expire — don't advertise a pool nobody can ride.
      if (d.status === 'open'
          && d.expiresAt && typeof (d.expiresAt as { toDate?: () => Date }).toDate === 'function'
          && (d.expiresAt as { toDate: () => Date }).toDate() < new Date()) continue;

      rides.push({
        type:                'request',
        id:                  doc.id,
        status:              d.status,
        hasDriver:           d.driverId != null,
        pickupAreaName:      d.pickupAreaName,
        destinationAreaName: d.destinationAreaName,
        // Destination pin + drop zone so joiners can pick a drop-off inside it.
        destinationLat:      d.destinationLat,
        destinationLng:      d.destinationLng,
        dropRadiusM:         (d.dropRadiusM as number) ?? 1000,
        farePerSeat:         d.agreedFarePerSeat ?? d.proposedFarePerSeat,
        totalSlots:          d.totalSlots,
        slotsAvailable:      (d.totalSlots as number) - (d.filledSlots as number),
        genderPref:          d.genderPref,
        maleSeats:           (d.maleSeats   as number) ?? 0,
        femaleSeats:         (d.femaleSeats as number) ?? 0,
        genderComposition:   d.genderComposition ?? 'all',
        distanceKm:          Math.round(distKmVal * 10) / 10,
      });
    }
  }

  // Driver-initiated pool rides.
  for (const doc of rideSnaps.docs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    const d = doc.data();
    const pLat = d.pickup?.lat as number ?? 0;
    const pLng = d.pickup?.lng as number ?? 0;
    if (pLat === 0 && pLng === 0) continue; // No coordinates stored (text-only offer).
    const distKmVal = distKm(lat, lng, pLat, pLng);
    if (distKmVal > radiusKm) continue;

    rides.push({
      type:                'ride',
      id:                  doc.id,
      pickupAreaName:      d.pickup?.address ?? 'Nearby',
      destinationAreaName: d.dropoff?.address ?? 'Destination',
      destinationLat:      d.dropoff?.lat ?? null,
      destinationLng:      d.dropoff?.lng ?? null,
      dropRadiusM:         (d.dropoffRadius as number) ?? 1000,
      farePerSeat:         d.perSeatFare,
      totalSlots:          d.maxSeats,
      slotsAvailable:      (d.maxSeats as number) - (d.takenSeats as number),
      genderPref:          d.genderPref,
      maleSeats:           (d.maleSeats   as number) ?? 0,
      femaleSeats:         (d.femaleSeats as number) ?? 0,
      genderComposition:   d.genderComposition ?? 'all',
      rideCategory:        d.rideCategory,
      distanceKm:          Math.round(distKmVal * 10) / 10,
    });
  }

  rides.sort((a: any, b: any) => a.distanceKm - b.distanceKm);
  return { rides };
});
