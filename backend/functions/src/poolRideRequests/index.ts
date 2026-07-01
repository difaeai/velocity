import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';

import { db, FieldValue } from '../lib/firebase';
import { requireRole, invalid } from '../lib/guards';
import { computeGenderAccess, canJoinPool } from '../lib/genderAccess';

type GenderPref = 'male_only' | 'female_only' | 'any';

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
  const ctx = requireRole(req, 'passenger');
  const p = CreateSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const d = p.data;

  const leaderGender = await getUserGender(ctx.uid);

  // Enforce gender: if requesting male_only/female_only the leader must match.
  if (!genderAllowed(leaderGender, d.genderPref)) {
    throw new HttpsError('failed-precondition', 'Your gender does not match the ride preference you selected.');
  }

  const geohash = geohashForLocation([d.pickupLat, d.pickupLng]);

  // Expire in 30 minutes if no driver responds.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

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
  const { requestId, action, counterFarePerSeat } = p.data;

  if (action === 'counter' && !counterFarePerSeat) {
    invalid('counterFarePerSeat is required when action is counter.');
  }

  // Fetch driver profile for name/vehicle info.
  const driverSnap = await db.doc(`drivers/${ctx.uid}`).get();
  if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver profile not found.');
  const driverData = driverSnap.data()!;

  const reqRef = db.doc(`poolRideRequests/${requestId}`);

  let newStatus: string;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ride request not found.');
    const data = snap.data()!;

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

    newStatus = action === 'accept' ? 'active' : 'negotiating';

    tx.update(reqRef, {
      driverId:           ctx.uid,
      driverName:         driverData.fullName ?? 'Driver',
      driverVehicle:      driverData.vehicleLabel ?? 'Car',
      driverPlate:        driverData.plate ?? 'N/A',
      driverGender,
      status:             newStatus,
      agreedFarePerSeat:  action === 'accept' ? data.proposedFarePerSeat : null,
      counterFarePerSeat: action === 'counter' ? counterFarePerSeat! : null,
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
  const ctx = requireRole(req, 'passenger');
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
});

export const joinPoolRideRequest = onCall(async (req) => {
  const ctx = requireRole(req, 'passenger');
  const p = JoinSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid request.');
  const { requestId } = p.data;

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

    // Only join active (fare agreed) requests.
    if (data.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This ride is not yet active. Wait for the leader to finalize the fare.');
    }
    if ((data.passengers as string[]).includes(ctx.uid)) {
      // Already a member — return silently.
      farePerSeat = data.agreedFarePerSeat as number;
      return;
    }
    if (data.filledSlots >= data.totalSlots) {
      throw new HttpsError('failed-precondition', 'This ride is full.');
    }

    // Gender enforcement — joining passenger must match the leader's preference.
    if (!genderAllowed(passengerGender, data.genderPref as GenderPref)) {
      throw new HttpsError('permission-denied', 'Your gender does not match this ride\'s preference.');
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

    farePerSeat = data.agreedFarePerSeat as number;
    const newFilledSlots = (data.filledSlots as number) + 1;

    tx.update(reqRef, {
      passengers:        FieldValue.arrayUnion(ctx.uid),
      filledSlots:       newFilledSlots,
      maleSeats:         newMale,
      femaleSeats:       newFemale,
      genderComposition: newComposition,
      status:            newFilledSlots >= data.totalSlots ? 'full' : 'active',
      updatedAt:         FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, farePerSeat: farePerSeat! };
});

// ── cancelPoolRideRequest ─────────────────────────────────────────────────────

const CancelSchema = z.object({ requestId: z.string().min(1).max(128) });

export const cancelPoolRideRequest = onCall(async (req) => {
  const ctx = requireRole(req, 'passenger');
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

      // Filter out expired requests.
      if (d.expiresAt && (d.expiresAt as Date) < now) continue;

      // Gender match: driver must match the request's pref.
      if (!genderAllowed(driverGender, d.genderPref as GenderPref)) continue;

      results.push({
        requestId:           doc.id,
        pickupAreaName:      d.pickupAreaName,
        destinationAreaName: d.destinationAreaName,
        proposedFarePerSeat: d.proposedFarePerSeat,
        totalSlots:          d.totalSlots,
        filledSlots:         d.filledSlots,
        slotsAvailable:      (d.totalSlots as number) - (d.filledSlots as number),
        genderPref:          d.genderPref,
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
          .where('status', 'in', ['active', 'full'])
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

      rides.push({
        type:                'request',
        id:                  doc.id,
        pickupAreaName:      d.pickupAreaName,
        destinationAreaName: d.destinationAreaName,
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
