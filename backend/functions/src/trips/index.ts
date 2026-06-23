/**
 * Trip lifecycle — fully server-authoritative.
 *
 * Clients never write trip documents directly (the rules forbid it). Every
 * transition runs through these callables, which validate the actor, the state
 * machine and the money. Fares and the platform commission are computed here
 * and nowhere else.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, requireRole, invalid } from '../lib/guards';
import { HttpsError } from 'firebase-functions/v2/https';
import { DriverPublicInfo, TripStatus } from '../domain/types';
import {
  MAX_SEATS,
  computeSettlement,
  fareBounds,
  isValidOfferedFare,
} from '../domain/fares';

const ACTIVE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
  'requested',
  'matched',
  'arriving',
  'arrived',
  'in_progress',
]);

// Transitions a driver may drive the trip through (from -> to).
const DRIVER_TRANSITIONS: ReadonlySet<string> = new Set([
  'matched->arriving',
  'arriving->arrived',
  'arrived->in_progress',
]);

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(200).optional(),
});

const createTripSchema = z.object({
  rideType: z.enum(['bike', 'auto', 'mini', 'ac', 'comfort', 'xl']),
  offeredFare: z.number().int().positive(),
  seats: z.number().int().min(1).max(MAX_SEATS),
  passengerGender: z.enum(['male', 'female', 'unspecified']),
  pool: z.boolean().optional(),
  pickup: geoSchema,
  dropoff: geoSchema,
});

/** Passenger creates a ride request. Rejects a second concurrent active trip. */
export const createTrip = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = createTripSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? 'Invalid trip request.');
  }
  const data = parsed.data;

  if (!isValidOfferedFare(data.rideType, data.offeredFare)) {
    const { min, max } = fareBounds(data.rideType);
    invalid(`Offered fare for ${data.rideType} must be between ${min} and ${max} PKR.`);
  }

  const tripRef = db.collection('trips').doc();
  const userRef = db.doc(`users/${ctx.uid}`);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    if (activeTripId) {
      const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
      if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status'))) {
        throw new HttpsError('failed-precondition', 'You already have an active trip.');
      }
    }

    tx.set(tripRef, {
      id: tripRef.id,
      status: 'requested' as TripStatus,
      passengerId: ctx.uid,
      passengerGender: data.passengerGender,
      driverId: null,
      rideType: data.rideType,
      offeredFare: data.offeredFare,
      fare: null,
      seats: data.seats,
      pool: data.pool ?? false,
      pickup: data.pickup,
      dropoff: data.dropoff,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, { activeTripId: tripRef.id }, { merge: true });
    // Public-safe feed that approved online drivers can read to discover work.
    tx.set(db.doc(`openRequests/${tripRef.id}`), {
      tripId: tripRef.id,
      rideType: data.rideType,
      offeredFare: data.offeredFare,
      seats: data.seats,
      passengerGender: data.passengerGender,
      pool: data.pool ?? false,
      pickup: data.pickup,
      dropoff: data.dropoff,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('Trip created', { tripId: tripRef.id, passenger: ctx.uid });
  return { ok: true, tripId: tripRef.id };
});

const placeBidSchema = z.object({
  tripId: z.string().min(1).max(128),
  fare: z.number().int().positive(),
});

/** An approved, online driver bids on an open request. */
export const placeBid = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = placeBidSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and fare.');
  const { tripId, fare } = parsed.data;

  const driverSnap = await db.doc(`drivers/${ctx.uid}`).get();
  if (driverSnap.get('verificationStatus') !== 'approved') {
    throw new HttpsError('permission-denied', 'Driver is not approved.');
  }
  if (driverSnap.get('online') !== true) {
    throw new HttpsError('failed-precondition', 'Go online before bidding.');
  }

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) invalid('Trip not found.');
  if (tripSnap.get('status') !== 'requested') {
    throw new HttpsError('failed-precondition', 'This trip is no longer open for bids.');
  }
  if (!isValidOfferedFare(tripSnap.get('rideType'), fare)) {
    invalid('Bid fare is outside the allowed range.');
  }

  const userSnap = await db.doc(`users/${ctx.uid}`).get();
  const driverInfo: DriverPublicInfo = {
    driverId: ctx.uid,
    displayName: userSnap.get('displayName') ?? 'Driver',
    photoURL: userSnap.get('photoURL') ?? null,
    vehicleLabel: driverSnap.get('vehicleLabel') ?? 'Vehicle',
    plate: driverSnap.get('plate') ?? '',
    rating: driverSnap.get('rating') ?? 5,
  };

  const bidRef = db.collection(`trips/${tripId}/bids`).doc(ctx.uid);
  await bidRef.set({
    id: bidRef.id,
    tripId,
    driverId: ctx.uid,
    fare,
    status: 'pending',
    driverInfo,
    createdAt: FieldValue.serverTimestamp(),
  });

  logger.info('Bid placed', { tripId, driver: ctx.uid, fare });
  return { ok: true, bidId: bidRef.id };
});

const acceptBidSchema = z.object({
  tripId: z.string().min(1).max(128),
  bidId: z.string().min(1).max(128),
});

/** Passenger accepts a driver's bid; locks the fare and assigns the driver. */
export const acceptBid = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = acceptBidSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and bidId.');
  const { tripId, bidId } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  const bidRef = db.doc(`trips/${tripId}/bids/${bidId}`);

  const result = await db.runTransaction(async (tx) => {
    const tripSnap = await tx.get(tripRef);
    if (!tripSnap.exists) invalid('Trip not found.');
    if (tripSnap.get('passengerId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    if (tripSnap.get('status') !== 'requested') {
      throw new HttpsError('failed-precondition', 'Trip is no longer open.');
    }
    const bidSnap = await tx.get(bidRef);
    if (!bidSnap.exists || bidSnap.get('status') !== 'pending') {
      invalid('Bid is no longer available.');
    }

    const driverInfo = bidSnap.get('driverInfo') as DriverPublicInfo;
    const fare = bidSnap.get('fare') as number;

    tx.set(
      tripRef,
      {
        status: 'matched' as TripStatus,
        driverId: driverInfo.driverId,
        driverInfo,
        fare,
        matchedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(bidRef, { status: 'accepted' }, { merge: true });
    tx.delete(db.doc(`openRequests/${tripId}`)); // no longer open
    return { fare, driverId: driverInfo.driverId };
  });

  logger.info('Bid accepted', { tripId, ...result });
  return { ok: true, ...result };
});

const statusSchema = z.object({
  tripId: z.string().min(1).max(128),
  to: z.enum(['arriving', 'arrived', 'in_progress']),
});

/** Assigned driver advances the trip through the pickup → en-route states. */
export const updateTripStatus = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = statusSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and target status.');
  const { tripId, to } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    const from = snap.get('status') as TripStatus;
    if (!DRIVER_TRANSITIONS.has(`${from}->${to}`)) {
      throw new HttpsError('failed-precondition', `Illegal transition ${from} → ${to}.`);
    }
    tx.set(
      tripRef,
      { status: to, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });

  logger.info('Trip status advanced', { tripId, to, driver: ctx.uid });
  return { ok: true, status: to };
});

const cancelSchema = z.object({
  tripId: z.string().min(1).max(128),
  reason: z.string().max(300).optional(),
});

/** Either participant cancels a trip that has not yet started. */
export const cancelTrip = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = cancelSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId, reason } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists) invalid('Trip not found.');
    const passengerId = snap.get('passengerId');
    const driverId = snap.get('driverId');
    if (ctx.uid !== passengerId && ctx.uid !== driverId) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    const status = snap.get('status') as TripStatus;
    if (status === 'in_progress' || status === 'completed' || status === 'cancelled') {
      throw new HttpsError('failed-precondition', `Cannot cancel a ${status} trip.`);
    }
    tx.set(
      tripRef,
      {
        status: 'cancelled' as TripStatus,
        cancelledBy: ctx.uid,
        cancelReason: reason ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(db.doc(`users/${passengerId}`), { activeTripId: null }, { merge: true });
    tx.delete(db.doc(`openRequests/${tripId}`));
  });

  logger.info('Trip cancelled', { tripId, by: ctx.uid });
  return { ok: true };
});

const completeSchema = z.object({ tripId: z.string().min(1).max(128) });

/**
 * Assigned driver completes the trip. Computes the settlement server-side and
 * atomically updates the driver wallet, the platform counters and the ledger.
 */
export const completeTrip = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = completeSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  const settlement = await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    if (snap.get('status') !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'Trip is not in progress.');
    }

    const grossFare = snap.get('fare') as number;
    const seats = (snap.get('seats') as number) ?? 1;
    const passengerId = snap.get('passengerId') as string;
    const s = computeSettlement(grossFare, seats);

    const walletRef = db.doc(`wallets/${ctx.uid}`);
    const txRef = walletRef.collection('transactions').doc();
    const countersRef = db.doc('system/counters');

    tx.set(
      tripRef,
      {
        status: 'completed' as TripStatus,
        settlement: s,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      walletRef,
      { balance: FieldValue.increment(s.driverPayout), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(txRef, {
      type: 'trip_payout',
      tripId,
      amount: s.driverPayout,
      grossFare: s.grossFare,
      commission: s.commission,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      countersRef,
      {
        totalRevenue: FieldValue.increment(s.grossFare),
        totalCommissions: FieldValue.increment(s.commission),
        totalDriverPayout: FieldValue.increment(s.driverPayout),
        totalTrips: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      db.doc(`drivers/${ctx.uid}`),
      { tripsCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(db.doc(`users/${passengerId}`), { activeTripId: null }, { merge: true });

    return s;
  });

  logger.info('Trip completed', { tripId, settlement });
  return { ok: true, settlement };
});
