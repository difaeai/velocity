import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth, invalid } from '../lib/guards';
import { notifyUser } from '../lib/fcm';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const createBookingSchema = z.object({
  tripId:        z.string().min(1).max(128),
  seatsBooked:   z.number().int().min(1).max(6),
  paymentMethod: z.enum(['cash', 'wallet']),
});

const cancelBookingSchema = z.object({
  bookingId: z.string().min(1).max(128),
});

const sendMessageSchema = z.object({
  tripId: z.string().min(1).max(128),
  text:   z.string().min(1).max(1000),
});

const vehicleTypeEnum = z.enum(['standard_ac', 'business_ac', 'non_ac', 'coaster', 'suv', 'hiace']);
const tripStatusEnum  = z.enum(['scheduled', 'boarding', 'in_progress', 'completed', 'cancelled']);

const createTripSchema = z.object({
  fromCityId:            z.string().min(1).max(64),
  fromCityName:          z.string().min(1).max(64),
  toCityId:              z.string().min(1).max(64),
  toCityName:            z.string().min(1).max(64),
  departureTime:         z.number().int().positive(),
  estimatedArrivalTime:  z.number().int().positive().optional(),
  vehicleType:           vehicleTypeEnum,
  operatorName:          z.string().min(1).max(64).default('Velocity'),
  totalSeats:            z.number().int().min(1).max(60),
  farePerSeat:           z.number().int().positive(),
  pickupPoint:           z.string().max(200).optional(),
  dropoffPoint:          z.string().max(200).optional(),
  driverName:            z.string().max(64).optional(),
  driverPhone:           z.string().max(20).optional(),
  plateNumber:           z.string().max(20).optional(),
  notes:                 z.string().max(500).optional(),
});

const updateTripSchema = z.object({
  tripId: z.string().min(1).max(128),
  status: tripStatusEnum.optional(),
  driverName:   z.string().max(64).optional(),
  driverPhone:  z.string().max(20).optional(),
  plateNumber:  z.string().max(20).optional(),
  notes:        z.string().max(500).optional(),
  estimatedArrivalTime: z.number().int().positive().optional(),
  pickupPoint:  z.string().max(200).optional(),
  dropoffPoint: z.string().max(200).optional(),
});

const cancelTripSchema = z.object({
  tripId: z.string().min(1).max(128),
  reason: z.string().max(200).optional(),
});

// ── Passenger: book seats ────────────────────────────────────────────────────

export const createIntercityBooking = onCall(async (req) => {
  const { uid, token } = requireAuth(req);
  const displayName = (token as { name?: string }).name ?? 'Passenger';
  const phone = (token as { phone_number?: string }).phone_number ?? null;

  const parsed = createBookingSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid booking data: ' + parsed.error.message);
  const { tripId, seatsBooked, paymentMethod } = parsed.data!;

  const tripRef    = db.doc(`intercityTrips/${tripId}`);
  const bookingRef = db.collection('intercityBookings').doc();

  const bookingId = await db.runTransaction(async (txn) => {
    const tripDoc = await txn.get(tripRef);
    if (!tripDoc.exists) invalid('Trip not found.');

    const trip = tripDoc.data()!;
    if (!['scheduled', 'boarding'].includes(trip.status as string)) {
      invalid('This trip is no longer accepting bookings.');
    }
    if (trip.departureTime as number <= Date.now()) {
      invalid('This trip has already departed.');
    }

    const available = (trip.totalSeats as number) - (trip.bookedSeats as number);
    if (available < seatsBooked) {
      invalid(`Only ${available} seat${available === 1 ? '' : 's'} available.`);
    }

    const nextSeat = (trip.bookedSeats as number) + 1;
    const seatNumbers = Array.from({ length: seatsBooked }, (_, i) => nextSeat + i);
    const fareTotal   = (trip.farePerSeat as number) * seatsBooked;

    txn.set(bookingRef, {
      tripId,
      passengerId:      uid,
      passengerName:    displayName,
      passengerPhone:   phone,
      seatsBooked,
      fareTotal,
      farePerSeat:      trip.farePerSeat,
      fromCityId:       trip.fromCityId,
      fromCityName:     trip.fromCityName,
      toCityId:         trip.toCityId,
      toCityName:       trip.toCityName,
      departureTime:    trip.departureTime,
      estimatedArrivalTime: trip.estimatedArrivalTime ?? null,
      vehicleType:      trip.vehicleType,
      operatorName:     trip.operatorName,
      status:           'confirmed',
      paymentMethod,
      seatNumbers,
      pickupPoint:      trip.pickupPoint ?? null,
      dropoffPoint:     trip.dropoffPoint ?? null,
      createdAt:        Date.now(),
    });

    txn.update(tripRef, { bookedSeats: FieldValue.increment(seatsBooked) });

    return bookingRef.id;
  });

  await notifyUser(
    uid,
    'Booking Confirmed! 🎉',
    `${seatsBooked} seat${seatsBooked > 1 ? 's' : ''} booked. Check your booking for details.`,
    'ride',
    { bookingId, screen: 'intercityTrip' },
  ).catch(err => logger.warn('notify failed', err));

  return { ok: true, bookingId };
});

// ── Passenger: cancel booking ────────────────────────────────────────────────

export const cancelIntercityBooking = onCall(async (req) => {
  const { uid } = requireAuth(req);

  const parsed = cancelBookingSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid bookingId.');
  const { bookingId } = parsed.data!;

  const bookingRef = db.doc(`intercityBookings/${bookingId}`);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) invalid('Booking not found.');

  const booking = bookingDoc.data()!;
  if (booking.passengerId !== uid) invalid('Not your booking.');
  if (booking.status !== 'confirmed') invalid('Booking is already cancelled or completed.');

  const tripRef  = db.doc(`intercityTrips/${booking.tripId}`);
  const tripDoc  = await tripRef.get();
  const tripOk   = tripDoc.exists && ['scheduled', 'boarding'].includes(tripDoc.data()!.status as string);

  await db.runTransaction(async (txn) => {
    txn.update(bookingRef, { status: 'cancelled', cancelledAt: Date.now() });
    if (tripOk) {
      txn.update(tripRef, { bookedSeats: FieldValue.increment(-(booking.seatsBooked as number)) });
    }
  });

  await notifyUser(uid, 'Booking Cancelled', 'Your intercity booking has been cancelled.', 'ride', { bookingId }).catch(() => undefined);

  return { ok: true };
});

// ── Chat: send message ───────────────────────────────────────────────────────

export const sendIntercityMessage = onCall(async (req) => {
  const { uid, token } = requireAuth(req);
  const displayName = (token as { name?: string }).name ?? 'User';

  const parsed = sendMessageSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid message data.');
  const { tripId, text } = parsed.data!;

  // Verify sender is a passenger on this trip or admin
  const role = (token as { role?: string }).role;
  if (role !== 'admin') {
    const snap = await db
      .collection('intercityBookings')
      .where('tripId', '==', tripId)
      .where('passengerId', '==', uid)
      .where('status', '==', 'confirmed')
      .limit(1)
      .get();
    if (snap.empty) invalid('You do not have a confirmed booking for this trip.');
  }

  const msgRef = db.collection(`intercityChats/${tripId}/messages`).doc();
  await msgRef.set({
    senderId:   uid,
    senderName: displayName,
    senderRole: role ?? 'passenger',
    text:       text.trim(),
    createdAt:  Date.now(),
  });

  return { ok: true, messageId: msgRef.id };
});

// ── Admin: create trip ───────────────────────────────────────────────────────

export const adminCreateIntercityTrip = onCall(async (req) => {
  requireAdmin(req);

  const parsed = createTripSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid trip data: ' + parsed.error.message);
  const data = parsed.data!;

  const tripRef = db.collection('intercityTrips').doc();
  await tripRef.set({
    ...data,
    bookedSeats: 0,
    status:      'scheduled',
    createdAt:   Date.now(),
  });

  return { ok: true, tripId: tripRef.id };
});

// ── Admin: update trip (status, driver info, etc.) ──────────────────────────

export const adminUpdateIntercityTrip = onCall(async (req) => {
  requireAdmin(req);

  const parsed = updateTripSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid update data.');
  const { tripId, ...updates } = parsed.data!;

  const tripRef = db.doc(`intercityTrips/${tripId}`);
  const tripDoc = await tripRef.get();
  if (!tripDoc.exists) invalid('Trip not found.');

  const clean: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [k, v] of Object.entries(updates)) {
    if (v !== undefined) clean[k] = v;
  }

  await tripRef.update(clean);

  // If status changed to boarding/in_progress, notify all confirmed passengers
  if (updates.status && ['boarding', 'in_progress'].includes(updates.status)) {
    const bookingsSnap = await db
      .collection('intercityBookings')
      .where('tripId', '==', tripId)
      .where('status', '==', 'confirmed')
      .get();

    const trip = tripDoc.data()!;
    const msg = updates.status === 'boarding'
      ? `Your trip ${trip.fromCityName} → ${trip.toCityName} is now boarding. Head to the pickup point!`
      : `Your trip ${trip.fromCityName} → ${trip.toCityName} has departed. Safe travels!`;
    const title = updates.status === 'boarding' ? 'Trip Boarding Now! 🚌' : 'Trip En Route 🚀';

    await Promise.all(
      bookingsSnap.docs.map(d =>
        notifyUser(d.data().passengerId as string, title, msg, 'ride', { tripId }).catch(() => undefined),
      ),
    );
  }

  return { ok: true };
});

// ── Admin: cancel trip ───────────────────────────────────────────────────────

export const adminCancelIntercityTrip = onCall(async (req) => {
  requireAdmin(req);

  const parsed = cancelTripSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId, reason } = parsed.data!;

  const tripRef = db.doc(`intercityTrips/${tripId}`);
  const tripDoc = await tripRef.get();
  if (!tripDoc.exists) invalid('Trip not found.');

  const trip = tripDoc.data()!;
  if (['completed', 'cancelled'].includes(trip.status as string)) {
    invalid('Trip is already completed or cancelled.');
  }

  // Get all confirmed bookings for this trip
  const bookingsSnap = await db
    .collection('intercityBookings')
    .where('tripId', '==', tripId)
    .where('status', '==', 'confirmed')
    .get();

  const batch = db.batch();
  batch.update(tripRef, { status: 'cancelled', cancelReason: reason ?? null, cancelledAt: Date.now() });
  bookingsSnap.docs.forEach(d => batch.update(d.ref, { status: 'cancelled', cancelledAt: Date.now() }));
  await batch.commit();

  // Notify all affected passengers
  const notifMsg = reason
    ? `Your trip ${trip.fromCityName} → ${trip.toCityName} has been cancelled. Reason: ${reason}`
    : `Your trip ${trip.fromCityName} → ${trip.toCityName} has been cancelled by the operator.`;

  await Promise.all(
    bookingsSnap.docs.map(d =>
      notifyUser(
        d.data().passengerId as string,
        'Trip Cancelled',
        notifMsg,
        'ride',
        { tripId },
      ).catch(() => undefined),
    ),
  );

  logger.info('Trip cancelled', { tripId, affectedPassengers: bookingsSnap.size });
  return { ok: true, affectedPassengers: bookingsSnap.size };
});

// ── Admin: seed demo trips ───────────────────────────────────────────────────

export const seedIntercityTrips = onCall(async (req) => {
  requireAdmin(req);

  const now   = Date.now();
  const day   = 86_400_000;

  type SeedTrip = {
    fromCityId: string; fromCityName: string;
    toCityId: string;   toCityName: string;
    dayOffset: number; hour: number; min: number;
    vehicleType: string;
    totalSeats: number; farePerSeat: number;
    durationHours: number;
    pickupPoint?: string; dropoffPoint?: string;
  };

  const SEED_ROUTES: SeedTrip[] = [
    // Lahore ↔ Islamabad (multiple daily)
    { fromCityId:'lahore', fromCityName:'Lahore', toCityId:'islamabad', toCityName:'Islamabad', dayOffset:0, hour:6,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:1100, durationHours:5,  pickupPoint:'Velocity Terminal, Lahore (Gulberg)',    dropoffPoint:'Velocity Terminal, Islamabad (F-10)' },
    { fromCityId:'lahore', fromCityName:'Lahore', toCityId:'islamabad', toCityName:'Islamabad', dayOffset:0, hour:9,  min:0,  vehicleType:'business_ac',  totalSeats:14, farePerSeat:1800, durationHours:5,  pickupPoint:'Velocity Terminal, Lahore (Gulberg)',    dropoffPoint:'Velocity Terminal, Islamabad (F-10)' },
    { fromCityId:'lahore', fromCityName:'Lahore', toCityId:'islamabad', toCityName:'Islamabad', dayOffset:0, hour:14, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:1100, durationHours:5,  pickupPoint:'Velocity Terminal, Lahore (Gulberg)',    dropoffPoint:'Velocity Terminal, Islamabad (F-10)' },
    { fromCityId:'lahore', fromCityName:'Lahore', toCityId:'islamabad', toCityName:'Islamabad', dayOffset:1, hour:7,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:1100, durationHours:5,  pickupPoint:'Velocity Terminal, Lahore (Gulberg)',    dropoffPoint:'Velocity Terminal, Islamabad (F-10)' },
    { fromCityId:'lahore', fromCityName:'Lahore', toCityId:'islamabad', toCityName:'Islamabad', dayOffset:1, hour:22, min:0,  vehicleType:'non_ac',       totalSeats:40, farePerSeat:700,  durationHours:5.5,pickupPoint:'Lahore Bus Terminal',                    dropoffPoint:'Pirwadhai, Rawalpindi' },
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'lahore', toCityName:'Lahore', dayOffset:0, hour:7,  min:30, vehicleType:'standard_ac', totalSeats:28, farePerSeat:1100, durationHours:5,  pickupPoint:'Velocity Terminal, Islamabad (F-10)',    dropoffPoint:'Velocity Terminal, Lahore (Gulberg)' },
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'lahore', toCityName:'Lahore', dayOffset:0, hour:13, min:0,  vehicleType:'business_ac',  totalSeats:14, farePerSeat:1800, durationHours:5,  pickupPoint:'Velocity Terminal, Islamabad (F-10)',    dropoffPoint:'Velocity Terminal, Lahore (Gulberg)' },
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'lahore', toCityName:'Lahore', dayOffset:1, hour:8,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:1100, durationHours:5,  pickupPoint:'Velocity Terminal, Islamabad (F-10)',    dropoffPoint:'Velocity Terminal, Lahore (Gulberg)' },
    // Karachi ↔ Lahore
    { fromCityId:'karachi', fromCityName:'Karachi', toCityId:'lahore', toCityName:'Lahore', dayOffset:0, hour:18, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:3800, durationHours:18, pickupPoint:'Velocity Terminal, Karachi (Gulshan)',   dropoffPoint:'Velocity Terminal, Lahore (Gulberg)' },
    { fromCityId:'karachi', fromCityName:'Karachi', toCityId:'lahore', toCityName:'Lahore', dayOffset:1, hour:20, min:0,  vehicleType:'business_ac',  totalSeats:14, farePerSeat:5800, durationHours:18, pickupPoint:'Velocity Terminal, Karachi (Gulshan)',   dropoffPoint:'Velocity Terminal, Lahore (Gulberg)' },
    { fromCityId:'lahore',  fromCityName:'Lahore',  toCityId:'karachi', toCityName:'Karachi', dayOffset:0, hour:19, min:0, vehicleType:'standard_ac', totalSeats:28, farePerSeat:3800, durationHours:18, pickupPoint:'Velocity Terminal, Lahore (Gulberg)',    dropoffPoint:'Velocity Terminal, Karachi (Gulshan)' },
    // Islamabad ↔ Peshawar
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'peshawar', toCityName:'Peshawar', dayOffset:0, hour:8,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:680, durationHours:2.5, pickupPoint:'Velocity Terminal, Islamabad (F-10)', dropoffPoint:'Peshawar Bus Terminal (GT Road)' },
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'peshawar', toCityName:'Peshawar', dayOffset:0, hour:14, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:680, durationHours:2.5, pickupPoint:'Velocity Terminal, Islamabad (F-10)', dropoffPoint:'Peshawar Bus Terminal (GT Road)' },
    { fromCityId:'peshawar',  fromCityName:'Peshawar',  toCityId:'islamabad', toCityName:'Islamabad', dayOffset:0, hour:7, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:680, durationHours:2.5, pickupPoint:'Peshawar Bus Terminal (GT Road)',    dropoffPoint:'Velocity Terminal, Islamabad (F-10)' },
    // Islamabad ↔ Gilgit (Northern route)
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'gilgit', toCityName:'Gilgit', dayOffset:0, hour:5,  min:0,  vehicleType:'standard_ac', totalSeats:20, farePerSeat:2500, durationHours:14, pickupPoint:'NATCO Terminal, Islamabad',              dropoffPoint:'Gilgit Bus Stand' },
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'gilgit', toCityName:'Gilgit', dayOffset:1, hour:5,  min:0,  vehicleType:'coaster',      totalSeats:14, farePerSeat:3200, durationHours:14, pickupPoint:'NATCO Terminal, Islamabad',              dropoffPoint:'Gilgit Bus Stand' },
    { fromCityId:'gilgit',    fromCityName:'Gilgit',    toCityId:'islamabad', toCityName:'Islamabad', dayOffset:0, hour:5, min:0, vehicleType:'standard_ac', totalSeats:20, farePerSeat:2500, durationHours:14, pickupPoint:'Gilgit Bus Stand',                     dropoffPoint:'NATCO Terminal, Islamabad' },
    // Islamabad ↔ Abbottabad
    { fromCityId:'islamabad', fromCityName:'Islamabad', toCityId:'abbottabad', toCityName:'Abbottabad', dayOffset:0, hour:9, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:580, durationHours:2, pickupPoint:'Velocity Terminal, Islamabad (F-10)', dropoffPoint:'Abbottabad Bus Stand' },
    { fromCityId:'abbottabad',fromCityName:'Abbottabad',toCityId:'islamabad', toCityName:'Islamabad',   dayOffset:0, hour:8, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:580, durationHours:2, pickupPoint:'Abbottabad Bus Stand',                 dropoffPoint:'Velocity Terminal, Islamabad (F-10)' },
    // Islamabad ↔ Muzaffarabad (AJK)
    { fromCityId:'islamabad',  fromCityName:'Islamabad',  toCityId:'muzaffarabad', toCityName:'Muzaffarabad', dayOffset:0, hour:10, min:0, vehicleType:'coaster', totalSeats:14, farePerSeat:540, durationHours:2.5, pickupPoint:'Faizabad Morr, Islamabad', dropoffPoint:'Muzaffarabad Bus Terminal' },
    // Karachi ↔ Hyderabad
    { fromCityId:'karachi',    fromCityName:'Karachi',    toCityId:'hyderabad', toCityName:'Hyderabad',     dayOffset:0, hour:8,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:580, durationHours:2, pickupPoint:'Velocity Terminal, Karachi (Gulshan)', dropoffPoint:'Hyderabad Bus Terminal' },
    { fromCityId:'karachi',    fromCityName:'Karachi',    toCityId:'hyderabad', toCityName:'Hyderabad',     dayOffset:0, hour:14, min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:580, durationHours:2, pickupPoint:'Velocity Terminal, Karachi (Gulshan)', dropoffPoint:'Hyderabad Bus Terminal' },
    { fromCityId:'hyderabad',  fromCityName:'Hyderabad',  toCityId:'karachi', toCityName:'Karachi',         dayOffset:0, hour:9,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:580, durationHours:2, pickupPoint:'Hyderabad Bus Terminal',                dropoffPoint:'Velocity Terminal, Karachi (Gulshan)' },
    // Lahore ↔ Multan
    { fromCityId:'lahore',     fromCityName:'Lahore',     toCityId:'multan', toCityName:'Multan',           dayOffset:0, hour:7,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:950,  durationHours:5,  pickupPoint:'Velocity Terminal, Lahore (Gulberg)', dropoffPoint:'Multan Bus Terminal' },
    { fromCityId:'multan',     fromCityName:'Multan',     toCityId:'lahore', toCityName:'Lahore',           dayOffset:0, hour:8,  min:0,  vehicleType:'standard_ac', totalSeats:28, farePerSeat:950,  durationHours:5,  pickupPoint:'Multan Bus Terminal',                  dropoffPoint:'Velocity Terminal, Lahore (Gulberg)' },
    // Islamabad ↔ Naran
    { fromCityId:'islamabad',  fromCityName:'Islamabad',  toCityId:'naran', toCityName:'Naran',             dayOffset:0, hour:6,  min:0,  vehicleType:'coaster',      totalSeats:14, farePerSeat:1100, durationHours:5,  pickupPoint:'Faizabad Morr, Islamabad',             dropoffPoint:'Naran Bazaar' },
  ];

  const batch    = db.batch();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const base     = midnight.getTime();

  const created: string[] = [];
  for (const s of SEED_ROUTES) {
    const depTime = base + s.dayOffset * day + s.hour * 3_600_000 + s.min * 60_000;
    if (depTime <= now) continue; // skip past slots

    const ref = db.collection('intercityTrips').doc();
    batch.set(ref, {
      fromCityId:           s.fromCityId,
      fromCityName:         s.fromCityName,
      toCityId:             s.toCityId,
      toCityName:           s.toCityName,
      departureTime:        depTime,
      estimatedArrivalTime: depTime + s.durationHours * 3_600_000,
      vehicleType:          s.vehicleType,
      operatorName:         'Velocity',
      totalSeats:           s.totalSeats,
      bookedSeats:          0,
      farePerSeat:          s.farePerSeat,
      status:               'scheduled',
      pickupPoint:          s.pickupPoint ?? null,
      dropoffPoint:         s.dropoffPoint ?? null,
      driverId:             null,
      driverName:           null,
      driverPhone:          null,
      plateNumber:          null,
      notes:                null,
      createdAt:            Date.now(),
    });
    created.push(ref.id);
  }

  await batch.commit();
  logger.info('Seeded intercity trips', { count: created.length });
  return { ok: true, seeded: created.length };
});
