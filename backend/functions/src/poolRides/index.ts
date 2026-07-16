import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireRole, requireAuth, invalid } from '../lib/guards';
import { computeGenderAccess, canJoinPool } from '../lib/genderAccess';
import { notifyUser } from '../lib/fcm';
import { assertCommissionClear, cycleCashFare, getCommissionSettings } from '../domain/commission';
import { computeSettlement } from '../domain/fares';
import { applyPartnerCredit, preparePartnerCredit } from '../partners/commission';
import {
  DRIVER_END_RIDE_SLACK_M,
  distanceM,
  effectiveDropRadiusM,
  getAdminDropRadiusM,
  hasRealCoords,
} from '../lib/poolRadius';

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
 *
 * Drop-zone rule: the driver must end the ride BEFORE leaving the drop zone —
 * when the client reports a GPS position, completion is rejected if the driver
 * is outside the ride's drop radius of the pool destination (+ GPS slack), so
 * every passenger is dropped inside the zone.
 */
const CompletePoolSchema = z.object({
  rideId:    z.string().min(1).max(128),
  driverLat: z.number().min(-90).max(90).optional(),
  driverLng: z.number().min(-180).max(180).optional(),
});

export const completePoolRide = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = CompletePoolSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid rideId.');
  const { rideId, driverLat, driverLng } = parsed.data;

  const rideRef   = db.doc(`poolRides/${rideId}`);
  const driverRef = db.doc(`drivers/${ctx.uid}`);
  const adminDropRadiusM = await getAdminDropRadiusM();

  // Partner Program: pool rides pay fleet owners exactly like ordinary trips —
  // a share of the platform commission, never of the fare. The referral lookups
  // and fraud checks run queries, and Firestore forbids reads after writes in a
  // transaction, so the plan is assembled here and only written under `tx`.
  // These pre-reads are also the single source of truth for WHO is aboard: the
  // transaction reuses `pickedUp` below, so the riders who are credited and the
  // riders who price the gross can never diverge.
  const [preRide, prePassengers, commissionSettings] = await Promise.all([
    rideRef.get(),
    db.collection(`poolRides/${rideId}/passengers`).get(),
    getCommissionSettings(),
  ]);
  if (!preRide.exists) invalid('Pool ride not found.');
  // Cheap pre-check so a double-tapped "complete" fails before the partner
  // lookups run and write fraud logs for a settlement that will abort anyway.
  // The transactional re-check below stays authoritative.
  if (preRide.get('status') !== 'in_progress') {
    throw new HttpsError('failed-precondition', 'Ride is not in progress.');
  }
  const pickedUp = prePassengers.docs.filter((d) => d.get('status') === 'picked_up');
  const preRiders = pickedUp.map((d) => d.id);
  const prePickup  = preRide.get('pickup')  as { lat?: number; lng?: number } | undefined;
  const preDropoff = preRide.get('dropoff') as { lat?: number; lng?: number } | undefined;
  const partnerPlan = preRiders.length
    ? await preparePartnerCredit({
        tripId: rideId,
        driverId: ctx.uid,
        passengerId: preRiders[0],
        coRiderIds: preRiders.slice(1),
        pickup: hasRealCoords(prePickup?.lat, prePickup?.lng)
          ? { lat: prePickup!.lat!, lng: prePickup!.lng! }
          : null,
        dropoff: hasRealCoords(preDropoff?.lat, preDropoff?.lng)
          ? { lat: preDropoff!.lat!, lng: preDropoff!.lng! }
          : null,
        startedAt:
          (preRide.get('allBoardedAt') as FirebaseFirestore.Timestamp | undefined)?.toDate() ??
          null,
      })
    : null;

  await db.runTransaction(async (tx) => {
    // Transactional reads must all happen before the first write.
    const [rideSnap, driverSnap] = await Promise.all([tx.get(rideRef), tx.get(driverRef)]);
    if (!rideSnap.exists) invalid('Pool ride not found.');
    if (rideSnap.get('driverId') !== ctx.uid) throw new HttpsError('permission-denied', 'Not your pool ride.');
    if (rideSnap.get('status') !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'Ride is not in progress.');
    }

    // Driver must still be inside the drop zone when ending the ride.
    const dropoff = rideSnap.get('dropoff') as { lat?: number; lng?: number; address?: string } | undefined;
    if (
      typeof driverLat === 'number' && typeof driverLng === 'number' &&
      hasRealCoords(dropoff?.lat, dropoff?.lng)
    ) {
      const dropRadiusM = effectiveDropRadiusM(rideSnap.get('dropoffRadius') as number | undefined, adminDropRadiusM);
      const distM = distanceM(dropoff!.lat!, dropoff!.lng!, driverLat, driverLng);
      if (distM > dropRadiusM + DRIVER_END_RIDE_SLACK_M) {
        throw new HttpsError(
          'failed-precondition',
          `You are ${(distM / 1000).toFixed(1)} km from the pool destination. ` +
          `Drop all passengers and end the ride within ${dropRadiusM} m of ` +
          `"${dropoff?.address ?? 'the destination'}" before driving on.`,
        );
      }
    }

    const perSeatFare: number = rideSnap.get('perSeatFare') ?? 0;

    // Mark all picked-up passengers as dropped_off. `pickedUp` comes from the
    // pre-transaction read — the same snapshot the partner plan and the fares
    // were built from, so everything in this settlement agrees on who rode.
    // (The old in-tx re-read was equally non-transactional; it just opened a
    // window for the two rider sets to differ.)
    const grossFare = perSeatFare * pickedUp.length;

    for (const pd of pickedUp) {
      tx.set(pd.ref, { status: 'dropped_off', completedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    // Update driver commission cycle — pool fares are collected in cash, so
    // they grow both the threshold counter and the settleable portion.
    tx.set(
      driverRef,
      {
        cycleGrossFare: ((driverSnap.get('cycleGrossFare') as number | undefined) ?? 0) + grossFare,
        cycleCashFare:  cycleCashFare(driverSnap) + grossFare,
        tripsCount:     FieldValue.increment(1),
        updatedAt:      FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Handle franchise commission if driver belongs to a franchise
    const franchiseId: string | null = driverSnap.get('franchiseId') ?? null;
    const franchiseCut = franchiseId && grossFare > 0 ? Math.round(grossFare * 0.05) : 0;
    if (franchiseId && franchiseCut > 0) {
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

    // Partner Program: fleet owners are paid out of the platform commission on
    // this ride — never out of the fare, so the driver's cash take is untouched.
    // Every rider aboard is credited to their own recruiter at their own seat's
    // share of the commission.
    let partnerRideStatus: string | null = null;
    if (partnerPlan && grossFare > 0) {
      const commission = computeSettlement(
        grossFare,
        Math.max(1, pickedUp.length),
        commissionSettings.rate,
      ).commission;
      const credit = applyPartnerCredit(tx, partnerPlan, {
        tripId: rideId,
        driverId: ctx.uid,
        passengerId: preRiders[0],
        grossFare,
        platformCommission: commission,
        // The franchise is senior to the fleets, capped at the commission so
        // partner math can never push Velocity's net below zero.
        franchiseCut: Math.min(franchiseCut, commission),
        paymentMethod: 'cash',
        passengerFare: perSeatFare,
        coRiderFares: Object.fromEntries(preRiders.slice(1).map((uid) => [uid, perSeatFare])),
      });
      partnerRideStatus = credit.rideStatus;
    }

    tx.set(
      rideRef,
      {
        status:      'completed',
        grossFare,
        ...(partnerRideStatus ? { partnerRideStatus } : {}),
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
  // Joiner's chosen drop-off point. Optional for backward compatibility —
  // when omitted the joiner is treated as going to the pool destination.
  dropoffLat:     z.number().min(-90).max(90).optional(),
  dropoffLng:     z.number().min(-180).max(180).optional(),
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
 *
 * Drop-zone rule: the joiner's drop-off must lie within the ride's drop radius
 * of the pool destination (driver-set, else admin default, else 1 km).
 */
export const joinPoolRide = onCall(async (req) => {
  // Any signed-in user may ride as a passenger — including drivers off shift.
  const ctx = requireAuth(req);
  const p = JoinRideSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { rideId, pickupLat, pickupLng, pickupAddress, dropoffAddress, dropoffLat, dropoffLng } = p.data;

  const adminDropRadiusM = await getAdminDropRadiusM();

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

  // Set when the car already has a mixed (1M+1F) load: the join is queued per
  // gender instead of confirmed, and the driver is only told once two riders
  // of the same gender are waiting (so the back row stays same-gender).
  let queuedResult: { waitingSameGender: number; driverId: string } | null = null;

  await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) throw new HttpsError('not-found', 'Pool ride not found.');
    const ride = rideSnap.data()!;

    if (ride.driverId === ctx.uid) {
      throw new HttpsError('failed-precondition', 'You cannot join your own pool ride as a passenger.');
    }

    const existingPass = await tx.get(db.doc(`poolRides/${rideId}/passengers/${ctx.uid}`));
    if (existingPass.exists) {
      throw new HttpsError('already-exists', 'You already have a seat on this ride.');
    }

    if (!['open', 'collecting'].includes(ride.status as string)) {
      throw new HttpsError('failed-precondition', 'This ride is not accepting passengers right now.');
    }
    if ((ride.takenSeats as number) >= (ride.maxSeats as number)) {
      throw new HttpsError('failed-precondition', 'This ride is full.');
    }

    // ── Drop-zone rule ─────────────────────────────────────────────────────
    // The joiner's drop-off must be within the ride's drop radius of the pool
    // destination. Omitted coords mean "same as the pool destination", which
    // is always allowed.
    const rideDropLat = ride.dropoff?.lat as number | undefined;
    const rideDropLng = ride.dropoff?.lng as number | undefined;
    const dropRadiusM = effectiveDropRadiusM(ride.dropoffRadius as number | undefined, adminDropRadiusM);
    if (
      typeof dropoffLat === 'number' && typeof dropoffLng === 'number' &&
      hasRealCoords(rideDropLat, rideDropLng)
    ) {
      const distM = distanceM(rideDropLat!, rideDropLng!, dropoffLat, dropoffLng);
      if (distM > dropRadiusM) {
        throw new HttpsError(
          'failed-precondition',
          `Your drop-off is ${(distM / 1000).toFixed(1)} km from the pool destination. ` +
          `It must be within ${dropRadiusM} m of "${ride.dropoff?.address ?? 'the destination'}" — ` +
          'pick the same destination, a point inside the drop zone, or ask the driver to drop you within it.',
        );
      }
    }

    const maleSeats   = (ride.maleSeats   as number) ?? 0;
    const femaleSeats = (ride.femaleSeats as number) ?? 0;
    const driverPref  = (ride.genderPref  as 'male_only' | 'female_only' | 'any') ?? 'any';

    const currentComposition = computeGenderAccess(maleSeats, femaleSeats, ride.maxSeats as number, driverPref);

    const check = canJoinPool({ currentComposition, maleSeats, femaleSeats, joinerGender, joinerMixedRideOk: mixedRideOk });
    if (!check.allowed) throw new HttpsError('permission-denied', check.reason);

    // ── Mixed-car batching rule ────────────────────────────────────────────
    // With one male and one female already seated, a lone joiner of either
    // gender cannot be placed without risking a female sharing the back row
    // with an unrelated male. Queue the request; the driver accepts riders
    // in same-gender pairs via driverAcceptPoolBatch.
    if (maleSeats >= 1 && femaleSeats >= 1) {
      if (joinerGender !== 'male' && joinerGender !== 'female') {
        throw new HttpsError(
          'failed-precondition',
          'Set your gender in your profile to join a mixed pool — riders are paired by gender for seating.',
        );
      }

      const reqRef  = db.doc(`poolRides/${rideId}/joinRequests/${ctx.uid}`);
      const reqSnap = await tx.get(reqRef);
      if (reqSnap.exists && reqSnap.get('status') === 'queued') {
        throw new HttpsError('already-exists', 'You already have a pending request for this ride.');
      }

      const queuedSnap = await tx.get(
        db.collection(`poolRides/${rideId}/joinRequests`)
          .where('status', '==', 'queued')
          .where('userGender', '==', joinerGender),
      );

      tx.set(reqRef, {
        userId:         ctx.uid,
        userName:       joinerName,
        userPhone:      joinerPhone,
        userGender:     joinerGender,
        pickupAddress,
        pickupLat,
        pickupLng,
        dropoffAddress,
        dropoffLat:     dropoffLat ?? null,
        dropoffLng:     dropoffLng ?? null,
        fare:           ride.perSeatFare,
        status:         'queued',
        createdAt:      FieldValue.serverTimestamp(),
      });

      queuedResult = {
        waitingSameGender: queuedSnap.size + 1,
        driverId: ride.driverId as string,
      };
      return;
    }

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
      dropoffLat:     dropoffLat ?? null,
      dropoffLng:     dropoffLng ?? null,
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
      // Public co-rider info shown to passengers browsing this ride —
      // first name + pickup point only, never the phone number.
      ridersPublic: FieldValue.arrayUnion({
        uid:        ctx.uid,
        name:       joinerName.split(' ')[0],
        gender:     joinerGender,
        pickupArea: pickupAddress,
      }),
      ...(isFirst ? { boardingStartedAt: FieldValue.serverTimestamp() } : {}),
    });
  });

  if (queuedResult) {
    const { waitingSameGender, driverId } = queuedResult;
    const genderLabelTxt = joinerGender === 'female' ? 'female' : 'male';
    if (waitingSameGender >= 2) {
      // Pair complete — tell the driver there is a batch to accept.
      await notifyUser(
        driverId,
        `${waitingSameGender} ${genderLabelTxt} riders waiting 🚗`,
        'Two riders of the same gender want to join your pool. Open your route to accept them together.',
        'ride',
      ).catch(() => {});
    }
    logger.info('Pool join queued (mixed car)', { rideId, uid: ctx.uid, gender: joinerGender, waitingSameGender });
    return { ok: true, queued: true, waitingSameGender };
  }

  logger.info('Passenger joined pool ride', { rideId, uid: ctx.uid, gender: joinerGender });
  return { ok: true, queued: false };
});

// ── driverAcceptPoolBatch ─────────────────────────────────────────────────────

const AcceptBatchSchema = z.object({
  rideId: z.string().min(1).max(128),
  gender: z.enum(['male', 'female']),
});

/**
 * Driver accepts a same-gender pair of queued join requests on a mixed
 * (1M+1F) pool. Requests are only surfaced to the driver once at least two
 * riders of one gender are waiting; accepting seats both atomically so the
 * back row never mixes a female with an unrelated male.
 */
export const driverAcceptPoolBatch = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const p = AcceptBatchSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const { rideId, gender } = p.data;

  // Locked drivers must settle their commission cycle before taking new work.
  assertCommissionClear(await db.doc(`drivers/${ctx.uid}`).get(), await getCommissionSettings());

  const rideRef = db.doc(`poolRides/${rideId}`);
  const accepted: { uid: string }[] = [];

  await db.runTransaction(async (tx) => {
    const rideSnap = await tx.get(rideRef);
    if (!rideSnap.exists) throw new HttpsError('not-found', 'Pool ride not found.');
    const ride = rideSnap.data()!;
    if (ride.driverId !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your pool ride.');
    }
    if (!['open', 'collecting'].includes(ride.status as string)) {
      throw new HttpsError('failed-precondition', 'This ride is not accepting passengers right now.');
    }

    const maxSeats   = ride.maxSeats as number;
    const takenSeats = ride.takenSeats as number;
    if (maxSeats - takenSeats < 2) {
      throw new HttpsError('failed-precondition', 'Need two free seats to accept a rider pair.');
    }

    const queuedSnap = await tx.get(
      db.collection(`poolRides/${rideId}/joinRequests`)
        .where('status', '==', 'queued')
        .where('userGender', '==', gender),
    );
    const queued = queuedSnap.docs
      .sort((a, b) => {
        const ta = (a.get('createdAt')?.toMillis?.() as number) ?? 0;
        const tb = (b.get('createdAt')?.toMillis?.() as number) ?? 0;
        return ta - tb;
      })
      .slice(0, 2);
    if (queued.length < 2) {
      throw new HttpsError('failed-precondition', `Need at least two waiting ${gender} riders to accept a pair.`);
    }

    const maleSeats   = (ride.maleSeats   as number) ?? 0;
    const femaleSeats = (ride.femaleSeats as number) ?? 0;
    const driverPref  = (ride.genderPref  as 'male_only' | 'female_only' | 'any') ?? 'any';
    const newMale     = maleSeats   + (gender === 'male'   ? 2 : 0);
    const newFemale   = femaleSeats + (gender === 'female' ? 2 : 0);
    const newTotal    = takenSeats + 2;

    const riderEntries = queued.map((d) => ({
      uid:        d.id,
      name:       ((d.get('userName') as string) ?? 'Rider').split(' ')[0],
      gender,
      pickupArea: (d.get('pickupAddress') as string) ?? '',
    }));

    for (const d of queued) {
      tx.set(db.doc(`poolRides/${rideId}/passengers/${d.id}`), {
        userId:         d.id,
        userName:       d.get('userName') ?? 'Rider',
        userPhone:      d.get('userPhone') ?? null,
        userGender:     gender,
        pickupAddress:  d.get('pickupAddress') ?? '',
        pickupLat:      d.get('pickupLat') ?? 0,
        pickupLng:      d.get('pickupLng') ?? 0,
        dropoffAddress: d.get('dropoffAddress') ?? '',
        dropoffLat:     d.get('dropoffLat') ?? null,
        dropoffLng:     d.get('dropoffLng') ?? null,
        fare:           d.get('fare') ?? ride.perSeatFare,
        status:         'confirmed',
        joinedAt:       FieldValue.serverTimestamp(),
      });
      tx.update(d.ref, { status: 'accepted', acceptedAt: FieldValue.serverTimestamp() });
      accepted.push({ uid: d.id });
    }

    tx.update(rideRef, {
      takenSeats:        newTotal,
      maleSeats:         newMale,
      femaleSeats:       newFemale,
      genderComposition: computeGenderAccess(newMale, newFemale, maxSeats, driverPref),
      status:            newTotal >= maxSeats ? 'full' : 'collecting',
      ridersPublic:      FieldValue.arrayUnion(...riderEntries),
      updatedAt:         FieldValue.serverTimestamp(),
    });
  });

  await Promise.all(
    accepted.map(({ uid }) =>
      notifyUser(
        uid,
        'Pool Seat Confirmed! 🎉',
        `The driver accepted you together with another ${gender} rider — you'll share the back row. Check the ride for pickup details.`,
        'ride',
      ).catch(() => {}),
    ),
  );

  logger.info('Driver accepted pool batch', { rideId, gender, count: accepted.length, driver: ctx.uid });
  return { ok: true, accepted: accepted.length };
});

// ── cancelPoolJoinRequest ─────────────────────────────────────────────────────

const CancelJoinRequestSchema = z.object({
  rideId: z.string().min(1).max(128),
});

/** Passenger withdraws their queued (not yet accepted) pool join request. */
export const cancelPoolJoinRequest = onCall(async (req) => {
  const ctx = requireAuth(req);
  const p = CancelJoinRequestSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');

  const reqRef = db.doc(`poolRides/${p.data.rideId}/joinRequests/${ctx.uid}`);
  const snap   = await reqRef.get();
  if (!snap.exists || snap.get('status') !== 'queued') {
    invalid('No pending join request to cancel.');
  }
  await reqRef.delete();

  logger.info('Pool join request cancelled', { rideId: p.data.rideId, uid: ctx.uid });
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

    const ridersPublic = ((ride.ridersPublic as { uid: string }[] | undefined) ?? []).filter(
      (r) => r.uid !== passengerId,
    );

    tx.delete(passRef);
    tx.update(rideRef, {
      takenSeats:        newTaken,
      maleSeats:         Math.max(0, newMale),
      femaleSeats:       Math.max(0, newFemale),
      genderComposition: newComposition,
      ridersPublic,
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
