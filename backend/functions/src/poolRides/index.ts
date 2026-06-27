import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireRole, invalid } from '../lib/guards';

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
