/**
 * Scheduled (frequent) rides — "book it for me every weekday at 8:30".
 *
 * Passengers who take the same ride repeatedly save a schedule from the Book
 * Ride screen instead of re-entering the request every day. A cron sweeps the
 * schedules every 5 minutes (Asia/Karachi) and auto-creates the trip request
 * at the saved time on the saved days, exactly as if the passenger had tapped
 * "Find driver" themselves — same fare validation, same openRequests feed,
 * same nearby-driver broadcast. The passenger gets a push either way: booked,
 * or skipped (already on a trip / fare no longer valid).
 *
 * Collection: scheduledRides/{scheduleId}
 *   { uid, pickup{lat,lng,address}, dropoff{lat,lng,address}, rideType,
 *     offeredFare, seats, passengerGender, paymentMethod, days[], time "HH:MM",
 *     active, lastRunDate "YYYY-MM-DD"|null, lastTripId, createdAt, updatedAt }
 *
 * Writes go through the callables below only — clients get read-only access.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { encodeGeohash } from '../lib/geohash';
import { notifyUser } from '../lib/fcm';
import { offeredFareBounds, broadcastTripToNearbyDrivers } from '../trips';

const MAX_SCHEDULES_PER_USER = 5;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// The cron fires every 5 minutes; a schedule is "due" when its HH:MM falls in
// the window (now - DUE_WINDOW_MIN, now]. The window is wider than the cron
// interval so a delayed tick cannot silently skip a day.
const DUE_WINDOW_MIN = 10;

const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(1).max(200),
});

const UpsertSchema = z.object({
  scheduleId:      z.string().min(1).max(128).optional(),
  pickup:          geoSchema,
  dropoff:         geoSchema,
  rideType:        z.enum(['bike', 'auto', 'mini', 'ac', 'comfort', 'xl']),
  offeredFare:     z.number().int().min(50).max(100000),
  seats:           z.number().int().min(1).max(6),
  passengerGender: z.enum(['male', 'female', 'unspecified']),
  paymentMethod:   z.enum(['cash', 'wallet']).default('cash'),
  days:            z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1).max(7),
  time:            z.string().regex(HHMM, 'time must be HH:MM'),
  active:          z.boolean().default(true),
});

// ── upsertScheduledRide ───────────────────────────────────────────────────────

export const upsertScheduledRide = onCall(async (req) => {
  const ctx = requireAuth(req);
  const p = UpsertSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid schedule.');
  const d = p.data;

  let ref;
  if (d.scheduleId) {
    ref = db.doc(`scheduledRides/${d.scheduleId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Schedule not found.');
    if (snap.get('uid') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your schedule.');
    }
  } else {
    const mine = await db.collection('scheduledRides').where('uid', '==', ctx.uid).get();
    if (mine.size >= MAX_SCHEDULES_PER_USER) {
      throw new HttpsError(
        'failed-precondition',
        `You can keep up to ${MAX_SCHEDULES_PER_USER} scheduled rides. Delete one first.`,
      );
    }
    ref = db.collection('scheduledRides').doc();
  }

  await ref.set(
    {
      uid:             ctx.uid,
      pickup:          d.pickup,
      dropoff:         d.dropoff,
      rideType:        d.rideType,
      offeredFare:     d.offeredFare,
      seats:           d.seats,
      passengerGender: d.passengerGender,
      paymentMethod:   d.paymentMethod,
      days:            d.days,
      time:            d.time,
      active:          d.active,
      updatedAt:       FieldValue.serverTimestamp(),
      ...(d.scheduleId ? {} : { lastRunDate: null, lastTripId: null, createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  );

  return { ok: true, scheduleId: ref.id };
});

// ── deleteScheduledRide ───────────────────────────────────────────────────────

export const deleteScheduledRide = onCall(async (req) => {
  const ctx = requireAuth(req);
  const p = z.object({ scheduleId: z.string().min(1).max(128) }).safeParse(req.data);
  if (!p.success) invalid('Provide a valid scheduleId.');

  const ref = db.doc(`scheduledRides/${p.data.scheduleId}`);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true }; // already gone
  if (snap.get('uid') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Not your schedule.');
  }
  await ref.delete();
  return { ok: true };
});

// ── Due check (pure — unit tested) ────────────────────────────────────────────

export interface DueCheckInput {
  days: string[];
  time: string;           // HH:MM
  active: boolean;
  lastRunDate: string | null;
  /** "now" in the schedule's timezone */
  nowDay: string;         // mon..sun
  nowMinutes: number;     // minutes since midnight
  todayDate: string;      // YYYY-MM-DD
}

/** True when the schedule should fire on this cron tick. */
export function isScheduleDue(s: DueCheckInput): boolean {
  if (!s.active) return false;
  if (!s.days.includes(s.nowDay)) return false;
  if (s.lastRunDate === s.todayDate) return false; // already ran today
  const [h, m] = s.time.split(':').map((x) => parseInt(x, 10));
  const schedMinutes = h * 60 + m;
  return s.nowMinutes >= schedMinutes && s.nowMinutes - schedMinutes < DUE_WINDOW_MIN;
}

/** Now in Asia/Karachi as day name / minutes / date string. */
export function karachiNow(date = new Date()): { day: string; minutes: number; date: string } {
  // PKT is UTC+5 with no DST.
  const pkt = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return {
    day: DAY_NAMES[pkt.getUTCDay()],
    minutes: pkt.getUTCHours() * 60 + pkt.getUTCMinutes(),
    date: pkt.toISOString().slice(0, 10),
  };
}

// ── runScheduledRides (cron) ──────────────────────────────────────────────────

export const runScheduledRides = onSchedule(
  { schedule: 'every 5 minutes', timeZone: 'Asia/Karachi' },
  async () => {
    const now = karachiNow();
    const snap = await db.collection('scheduledRides').where('active', '==', true).get();
    if (snap.empty) return;

    let booked = 0;
    let skipped = 0;

    for (const doc of snap.docs) {
      const s = doc.data();
      if (
        !isScheduleDue({
          days: (s.days as string[]) ?? [],
          time: (s.time as string) ?? '00:00',
          active: s.active === true,
          lastRunDate: (s.lastRunDate as string | null) ?? null,
          nowDay: now.day,
          nowMinutes: now.minutes,
          todayDate: now.date,
        })
      ) continue;

      // Claim today's run up front so a crashed/overlapping tick can't
      // double-book the same schedule.
      await doc.ref.set({ lastRunDate: now.date }, { merge: true });

      try {
        const tripId = await bookScheduledTrip(doc.id, s);
        booked++;
        await doc.ref.set({ lastTripId: tripId, lastError: null }, { merge: true });
        await notifyUser(
          s.uid as string,
          '🗓️ Scheduled ride requested',
          `Your ${s.time} ride to ${(s.dropoff as { address?: string })?.address ?? 'your destination'} is now looking for a driver.`,
          'ride',
          { tripId, screen: 'trip' },
        ).catch(() => {});
      } catch (e) {
        skipped++;
        const reason = e instanceof HttpsError ? e.message : 'Could not create the ride.';
        await doc.ref.set({ lastError: reason }, { merge: true });
        await notifyUser(
          s.uid as string,
          '🗓️ Scheduled ride skipped',
          `We couldn't book your ${s.time} ride: ${reason}`,
          'ride',
        ).catch(() => {});
        logger.warn('Scheduled ride skipped', { scheduleId: doc.id, reason });
      }
    }

    if (booked || skipped) {
      logger.info('runScheduledRides tick', { booked, skipped });
    }
  },
);

/**
 * Creates the trip for a due schedule — the same writes createTrip performs
 * (trip doc + openRequests feed + activeTripId), then broadcasts to nearby
 * drivers. Throws HttpsError when booking is impossible (active trip exists,
 * wallet too low), which the cron reports back to the passenger as a skip.
 */
async function bookScheduledTrip(scheduleId: string, s: FirebaseFirestore.DocumentData): Promise<string> {
  const uid = s.uid as string;
  const pickup = s.pickup as { lat: number; lng: number; address: string };
  const dropoff = s.dropoff as { lat: number; lng: number; address: string };
  const rideType = s.rideType as string;

  // Clamp the saved fare into today's acceptable band so an old schedule keeps
  // working when the admin fare config moves.
  const bounds = await offeredFareBounds(rideType, pickup, dropoff);
  const fare = Math.min(bounds.max, Math.max(bounds.min, s.offeredFare as number));

  const tripRef = db.collection('trips').doc();
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    if (activeTripId) {
      const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
      const st = activeSnap.exists ? (activeSnap.get('status') as string) : '';
      if (['requested', 'matched', 'arriving', 'arrived', 'in_progress'].includes(st)) {
        throw new HttpsError('failed-precondition', 'You already have an active trip.');
      }
    }

    if (s.paymentMethod === 'wallet') {
      const walletSnap = await tx.get(db.doc(`wallets/${uid}`));
      const balance = (walletSnap.get('balance') as number) ?? 0;
      if (balance < fare) {
        throw new HttpsError('failed-precondition', `Insufficient wallet balance (${balance} PKR).`);
      }
    }

    tx.set(tripRef, {
      id: tripRef.id,
      status: 'requested',
      passengerId: uid,
      passengerGender: s.passengerGender ?? 'unspecified',
      driverId: null,
      rideType,
      offeredFare: fare,
      fare: null,
      seats: (s.seats as number) ?? 1,
      pool: false,
      paymentMethod: s.paymentMethod ?? 'cash',
      preferFemaleDriver: false,
      promoCode: null,
      promoDiscount: 0,
      pickup,
      dropoff,
      scheduled: true,
      scheduleId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, { activeTripId: tripRef.id }, { merge: true });
    tx.set(db.doc(`openRequests/${tripRef.id}`), {
      tripId: tripRef.id,
      rideType,
      offeredFare: fare,
      seats: (s.seats as number) ?? 1,
      passengerGender: s.passengerGender ?? 'unspecified',
      passengerName: (userSnap.get('name') as string | undefined) ?? 'Passenger',
      passengerRating: (userSnap.get('rating') as number | undefined) ?? 5,
      passengerRatingCount: (userSnap.get('ratingCount') as number | undefined) ?? 0,
      pool: false,
      paymentMethod: s.paymentMethod ?? 'cash',
      preferFemaleDriver: false,
      pickup,
      dropoff,
      pickupGeohash: encodeGeohash(pickup.lat, pickup.lng, 6),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  broadcastTripToNearbyDrivers(tripRef.id, pickup, false, rideType)
    .catch((err) => logger.error('Scheduled broadcast failed', { tripId: tripRef.id, err }));

  logger.info('Scheduled trip created', { scheduleId, tripId: tripRef.id, uid });
  return tripRef.id;
}
