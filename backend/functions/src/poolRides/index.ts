import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireRole, requireAuth, invalid } from '../lib/guards';
import { computeGenderAccess, canJoinPool } from '../lib/genderAccess';

// ── Haversine distance in km ─────────────────────────────────────────────────
function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// ── startPoolBoarding ────────────────────────────────────────────────────────

const startBoardingSchema = z.object({
  rideId:    z.string().min(1).max(128),
  driverLat: z.number().min(-90).max(90),
  driverLng: z.number().min(-180).max(180),
});

/**
 * Driver starts the passenger-pickup phase.
 * Reads all confirmed passengers, sorts them by distance from the driver's
 * current GPS position (nearest-first), stores the ordered array on the ride
 * doc, then flips status to 'boarding'.
 */
export const startPoolBoarding = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = startBoardingSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid data.');
  const { rideId, driverLat, driverLng } = parsed.data;

  const rideRef  = db.doc(`poolRides/${rideId}`);
  const rideSnap = await rideRef.get();
  if (!rideSnap.exists) invalid('Pool ride not found.');
  if (rideSnap.get('driverId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Not your pool ride.');
  }
  const status = rideSnap.get('status') as string;
  if (!['open', 'collecting', 'full'].includes(status)) {
    throw new HttpsError('failed-precondition', `Cannot start boarding from status "${status}".`);
  }

  const passSnap = await db.collection(`poolRides/${rideId}/passengers`).get();
  if (passSnap.empty) invalid('No passengers have joined yet.');

  // Sort passengers nearest-first from the driver's current location
  const sorted = passSnap.docs
    .map((d) => ({
      uid: d.id,
      lat: (d.get('pickupLat') as number) ?? 0,
      lng: (d.get('pickupLng') as number) ?? 0,
    }))
    .sort((a, b) =>
      distKm(driverLat, driverLng, a.lat, a.lng) - distKm(driverLat, driverLng, b.lat, b.lng),
    );

  const pickupOrder = sorted.map((p) => p.uid);

  await rideRef.set(
    {
      status:             'boarding',
      pickupOrder,
      currentPickupIndex: 0,
      updatedAt:          FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  logger.info('Pool boarding started', { rideId, driverId: ctx.uid, count: pickupOrder.length });
  return { ok: true, pickupOrder };
});

// ── poolArrivePassenger ──────────────────────────────────────────────────────

const passengerActionSchema = z.object({
  rideId:      z.string().min(1).max(128),
  passengerId: z.string().min(1).max(128),
});

/**
 * Driver marks themselves as arrived at a specific passenger's pickup stop.
 * The passenger's client will see the status change to 'driver_arrived'.
 */
export const poolArrivePassenger = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = passengerActionSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid data.');
  const { rideId, passengerId } = parsed.data;

  const rideSnap = await db.doc(`poolRides/${rideId}`).get();
  if (!rideSnap.exists) invalid('Pool ride not found.');
  if (rideSnap.get('driverId') !== ctx.uid) throw new HttpsError('permission-denied', 'Not your pool ride.');
  if (rideSnap.get('status') !== 'boarding') throw new HttpsError('failed-precondition', 'Ride is not in boarding state.');

  await db.doc(`poolRides/${rideId}/passengers/${passengerId}`).set(
    { status: 'driver_arrived', arrivedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  logger.info('Driver arrived at passenger stop', { rideId, passengerId, driver: ctx.uid });
  return { ok: true };
});

// ── poolPassengerBoarded ─────────────────────────────────────────────────────

/**
 * Driver confirms a passenger has boarded. Advances currentPickupIndex.
 * When the last passenger boards, transitions the ride to 'in_progress'.
 */
export const poolPassengerBoarded = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = passengerActionSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid data.');
  const { rideId, passengerId } = parsed.data;

  const rideRef = db.doc(`poolRides/${rideId}`);

  await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) invalid('Pool ride not found.');
    if (rideSnap.get('driverId') !== ctx.uid) throw new HttpsError('permission-denied', 'Not your pool ride.');
    if (rideSnap.get('status') !== 'boarding') throw new HttpsError('failed-precondition', 'Ride is not in boarding phase.');

    const passRef  = db.doc(`poolRides/${rideId}/passengers/${passengerId}`);
    const passSnap = await tx.get(passRef);
    if (!passSnap.exists) invalid('Passenger booking not found.');
    if (passSnap.get('status') !== 'driver_arrived') {
      throw new HttpsError('failed-precondition', 'Mark driver arrived first before confirming boarding.');
    }

    const currentIndex: number   = rideSnap.get('currentPickupIndex') ?? 0;
    const pickupOrder:  string[] = rideSnap.get('pickupOrder')         ?? [];
    const nextIndex = currentIndex + 1;
    const allBoarded = nextIndex >= pickupOrder.length;

    tx.set(passRef, { status: 'picked_up', boardedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      rideRef,
      {
        currentPickupIndex: nextIndex,
        status:    allBoarded ? 'in_progress' : 'boarding',
        updatedAt: FieldValue.serverTimestamp(),
        ...(allBoarded ? { allBoardedAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    );
  });

  logger.info('Pool passenger boarded', { rideId, passengerId, driver: ctx.uid });
  return { ok: true };
});

// ── completePoolRide ─────────────────────────────────────────────────────────

/**
 * Driver completes the pool ride after reaching the destination.
 * Marks all boarded passengers as dropped_off, increments driver's
 * cycleGrossFare for commission tracking.
 */
export const completePoolRide = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = z.object({ rideId: z.string().min(1).max(128) }).safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid rideId.');
  const { rideId } = parsed.data;

  const rideRef = db.doc(`poolRides/${rideId}`);

  await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) invalid('Pool ride not found.');
    if (rideSnap.get('driverId') !== ctx.uid) throw new HttpsError('permission-denied', 'Not your pool ride.');
    if (rideSnap.get('status') !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'Ride is not in progress.');
    }

    const perSeatFare: number = rideSnap.get('perSeatFare') ?? 0;

    // Mark all picked-up passengers as dropped_off
    const passSnap = await db.collection(`poolRides/${rideId}/passengers`).get();
    const pickedUp = passSnap.docs.filter((d) => d.get('status') === 'picked_up');
    const grossFare = perSeatFare * pickedUp.length;

    for (const pd of pickedUp) {
      tx.set(pd.ref, { status: 'dropped_off', completedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    // Update driver commission cycle
    const driverRef = db.doc(`drivers/${ctx.uid}`);
    tx.set(
      driverRef,
      {
        cycleGrossFare: FieldValue.increment(grossFare),
        tripsCount:     FieldValue.increment(1),
        updatedAt:      FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Handle franchise commission if driver belongs to a franchise
    const driverSnap = await tx.get(driverRef);
    const franchiseId: string | null = driverSnap.get('franchiseId') ?? null;
    if (franchiseId && grossFare > 0) {
      const franchiseCut = Math.round(grossFare * 0.05);
      tx.set(
        db.doc(`franchises/${franchiseId}`),
        {
          cycleRevenue:  FieldValue.increment(franchiseCut),
          totalRevenue:  FieldValue.increment(franchiseCut),
          updatedAt:     FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    tx.set(
      rideRef,
      {
        status:      'completed',
        grossFare,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt:   FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  logger.info('Pool ride completed', { rideId, driver: ctx.uid });
  return { ok: true };
});

// ── joinPoolRide ──────────────────────────────────────────────────────────────

const JoinRideSchema = z.object({
  rideId:         z.string().min(1).max(128),
  pickupLat:      z.number().min(-90).max(90),
  pickupLng:      z.number().min(-180).max(180),
  pickupAddress:  z.string().trim().min(1).max(300),
  dropoffAddress: z.string().trim().min(1).max(300),
});

/**
 * Atomically joins a driver-posted pool ride.
 *
 * Enforces Pakistani gender-composition rules:
 *   - Reads the ride's live maleSeats / femaleSeats counts inside a transaction.
 *   - Blocks the join when the resulting passenger mix would be uncomfortable
 *     (e.g. 2M+1F, 2F+1M, females in a 3-male pool, etc.).
 *   - Requires mixedRideOk opt-in from the user when joining a mixed-gender pool.
 *   - Atomically updates maleSeats, femaleSeats, genderComposition, and takenSeats.
 */
export const joinPoolRide = onCall(async (req) => {
  const ctx = requireRole(req, 'passenger');
  const p = JoinRideSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { rideId, pickupLat, pickupLng, pickupAddress, dropoffAddress } = p.data;

  // Fetch caller profile once outside the transaction (non-transactional reads are fine
  // for immutable-ish fields like gender and mixedRideOk preference).
  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
  const userData        = userSnap.data()!;
  if (userData.poolBookingBlocked === true) {
    throw new HttpsError(
      'permission-denied',
      'Your account is blocked from pool rides due to a gender misrepresentation report. Contact support if this is a mistake.',
    );
  }
  const joinerGender    = (userData.gender    as string)  ?? 'unspecified';
  const mixedRideOk     = (userData.mixedRideOk as boolean) ?? false;
  const joinerName      = (userData.name       as string)  ?? 'Passenger';
  const joinerPhone     = (userData.phone      as string | null) ?? null;

  const rideRef = db.doc(`poolRides/${rideId}`);

  await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) throw new HttpsError('not-found', 'Pool ride not found.');
    const ride = rideSnap.data()!;

    if (!['open', 'collecting'].includes(ride.status as string)) {
      throw new HttpsError('failed-precondition', 'This ride is not accepting passengers right now.');
    }
    if ((ride.takenSeats as number) >= (ride.maxSeats as number)) {
      throw new HttpsError('failed-precondition', 'This ride is full.');
    }

    const maleSeats   = (ride.maleSeats   as number) ?? 0;
    const femaleSeats = (ride.femaleSeats as number) ?? 0;
    const driverPref  = (ride.genderPref  as 'male_only' | 'female_only' | 'any') ?? 'any';

    const currentComposition = computeGenderAccess(maleSeats, femaleSeats, ride.maxSeats as number, driverPref);

    const check = canJoinPool({ currentComposition, maleSeats, femaleSeats, joinerGender, joinerMixedRideOk: mixedRideOk });
    if (!check.allowed) throw new HttpsError('permission-denied', check.reason);

    const newMale   = maleSeats   + (joinerGender === 'male'   ? 1 : 0);
    const newFemale = femaleSeats + (joinerGender === 'female' ? 1 : 0);
    const newTotal  = (ride.takenSeats as number) + 1;
    const isFull    = newTotal >= (ride.maxSeats as number);
    const newComposition = computeGenderAccess(newMale, newFemale, ride.maxSeats as number, driverPref);
    const isFirst   = (ride.takenSeats as number) === 0;

    const passRef = db.doc(`poolRides/${rideId}/passengers/${ctx.uid}`);
    tx.set(passRef, {
      userId:         ctx.uid,
      userName:       joinerName,
      userPhone:      joinerPhone,
      userGender:     joinerGender,
      pickupAddress,
      pickupLat,
      pickupLng,
      dropoffAddress,
      fare:           ride.perSeatFare,
      status:         'confirmed',
      joinedAt:       FieldValue.serverTimestamp(),
    });

    tx.update(rideRef, {
      takenSeats:        FieldValue.increment(1),
      maleSeats:         newMale,
      femaleSeats:       newFemale,
      genderComposition: newComposition,
      status:            isFull ? 'full' : 'collecting',
      updatedAt:         FieldValue.serverTimestamp(),
      ...(isFirst ? { boardingStartedAt: FieldValue.serverTimestamp() } : {}),
    });
  });

  logger.info('Passenger joined pool ride', { rideId, uid: ctx.uid, gender: joinerGender });
  return { ok: true };
});

// ── Shared helper: remove a passenger and recompute gender composition ─────────

async function removePassengerFromRide(
  rideId: string,
  passengerId: string,
  blockedReason: string,
): Promise<void> {
  const rideRef = db.doc(`poolRides/${rideId}`);
  const passRef = db.doc(`poolRides/${rideId}/passengers/${passengerId}`);

  await db.runTransaction(async (tx) => {
    const [rideSnap, passSnap] = await Promise.all([tx.get(rideRef), tx.get(passRef)]);
    if (!rideSnap.exists) throw new HttpsError('not-found', 'Pool ride not found.');
    if (!passSnap.exists) return;

    const ride = rideSnap.data()!;
    const passGender = (passSnap.get('userGender') as string) ?? 'unspecified';
    const maleSeats   = (ride.maleSeats   as number) ?? 0;
    const femaleSeats = (ride.femaleSeats as number) ?? 0;
    const newMale   = maleSeats   - (passGender === 'male'   ? 1 : 0);
    const newFemale = femaleSeats - (passGender === 'female' ? 1 : 0);
    const newTaken  = Math.max(0, (ride.takenSeats as number) - 1);
    const driverPref = (ride.genderPref as 'male_only' | 'female_only' | 'any') ?? 'any';
    const newComposition = computeGenderAccess(
      Math.max(0, newMale),
      Math.max(0, newFemale),
      ride.maxSeats as number,
      driverPref,
    );

    tx.delete(passRef);
    tx.update(rideRef, {
      takenSeats:        newTaken,
      maleSeats:         Math.max(0, newMale),
      femaleSeats:       Math.max(0, newFemale),
      genderComposition: newComposition,
      status:            newTaken === 0 ? 'open' : 'collecting',
      updatedAt:         FieldValue.serverTimestamp(),
    });

    tx.set(
      db.doc(`users/${passengerId}`),
      {
        poolBookingBlocked: true,
        poolBlockedReason:  blockedReason,
        poolBlockedAt:      FieldValue.serverTimestamp(),
        updatedAt:          FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

// ── driverBlockPoolPassenger ──────────────────────────────────────────────────

const BlockPassengerSchema = z.object({
  rideId:      z.string().min(1).max(128),
  passengerId: z.string().min(1).max(128),
  reason:      z.string().trim().min(3).max(500).optional(),
});

/**
 * Driver removes a passenger who misrepresented their gender and blocks them
 * from booking any future pool rides.
 */
export const driverBlockPoolPassenger = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const p = BlockPassengerSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { rideId, passengerId, reason } = p.data;

  const rideSnap = await db.doc(`poolRides/${rideId}`).get();
  if (!rideSnap.exists) throw new HttpsError('not-found', 'Pool ride not found.');
  if (rideSnap.get('driverId') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Not your pool ride.');
  }

  const blockedReason =
    reason?.trim() ||
    'Blocked by driver for gender misrepresentation on a pool ride.';

  await removePassengerFromRide(rideId, passengerId, blockedReason);

  await db.collection('poolGenderReports').add({
    rideId,
    reporterId:  ctx.uid,
    reporterRole: 'driver',
    reportedUid: passengerId,
    reason:      blockedReason,
    action:      'driver_block',
    createdAt:   FieldValue.serverTimestamp(),
  });

  logger.info('Driver blocked pool passenger', { rideId, passengerId, driver: ctx.uid });
  return { ok: true };
});

// ── reportPoolGenderMisrepresentation ─────────────────────────────────────────

const ReportGenderSchema = z.object({
  rideId:      z.string().min(1).max(128),
  reportedUid: z.string().min(1).max(128),
  note:        z.string().trim().min(3).max(500).optional(),
});

/**
 * A passenger (or driver) reports that another pool member misrepresented their
 * gender. The reported user is removed from the ride and blocked from pool booking.
 */
export const reportPoolGenderMisrepresentation = onCall(async (req) => {
  const ctx = requireAuth(req);
  const p = ReportGenderSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { rideId, reportedUid, note } = p.data;

  if (reportedUid === ctx.uid) {
    throw new HttpsError('invalid-argument', 'You cannot report yourself.');
  }

  const rideSnap = await db.doc(`poolRides/${rideId}`).get();
  if (!rideSnap.exists) throw new HttpsError('not-found', 'Pool ride not found.');

  const driverId = rideSnap.get('driverId') as string;
  const isDriver = driverId === ctx.uid;

  if (!isDriver) {
    const myPassSnap = await db.doc(`poolRides/${rideId}/passengers/${ctx.uid}`).get();
    if (!myPassSnap.exists) {
      throw new HttpsError('permission-denied', 'You must be on this ride to report a passenger.');
    }
  }

  const reportedPassSnap = await db.doc(`poolRides/${rideId}/passengers/${reportedUid}`).get();
  if (!reportedPassSnap.exists) {
    throw new HttpsError('not-found', 'That passenger is not on this ride.');
  }

  const blockedReason =
    note?.trim() ||
    'Reported by another pool passenger for gender misrepresentation.';

  await removePassengerFromRide(rideId, reportedUid, blockedReason);

  await db.collection('poolGenderReports').add({
    rideId,
    reporterId:   ctx.uid,
    reporterRole: isDriver ? 'driver' : 'passenger',
    reportedUid,
    reportedGender: reportedPassSnap.get('userGender') ?? 'unspecified',
    reason:       blockedReason,
    action:       'passenger_report',
    createdAt:    FieldValue.serverTimestamp(),
  });

  logger.info('Pool gender misrepresentation reported', { rideId, reportedUid, reporter: ctx.uid });
  return { ok: true };
});
