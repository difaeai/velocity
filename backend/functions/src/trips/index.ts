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
import { randomInt } from 'crypto';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAuth, requireRole, invalid } from '../lib/guards';
import { applyPartnerCredit, preparePartnerCredit } from '../partners/commission';
import { rateLimit } from '../lib/ratelimit';
import { encodeGeohash } from '../lib/geohash';
import { sendToUser, sendToUsers } from '../lib/fcm';
import { HttpsError } from 'firebase-functions/v2/https';
import { DriverPublicInfo, TripStatus } from '../domain/types';
import {
  MAX_POOL_RIDERS,
  MAX_SEATS,
  computeSettlement,
  fareBounds,
  poolPerSeatFare,
} from '../domain/fares';
import { assertCommissionClear, cycleCashFare, getCommissionSettings } from '../domain/commission';
import {
  assertOutstandingClear,
  cancellationFee,
  getCancellationSettings,
  splitFeeAgainstBalance,
} from '../domain/cancellation';
import { calculateFare, CityFareConfig, VehicleCategory } from '../fare/fareEngine';
import { notifyDailyRouteMatches } from '../dailyRoutes';
import { alertOfflineDriversOnWhatsApp } from '../whatsapp/alerts';
import { hostRosterEntry } from './poolRoster';

export const ACTIVE_STATUSES: ReadonlySet<TripStatus> = new Set<TripStatus>([
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

// RideType → fare-engine category (must stay in sync with RIDE_TO_CAT in the
// mobile booking screen so client previews and server validation agree).
const RIDE_TO_ENGINE_CAT: Record<string, VehicleCategory> = {
  bike: 'moto',
  auto: 'rickshaw',
  mini: 'mini',
  ac: 'ac_car',
  comfort: 'luxury',
  xl: 'luxury',
};

/**
 * Acceptable offered-fare range for a trip. Follows the admin-configured fare
 * engine (fareConfig/{cityId} — the same doc the booking screen prices from);
 * the static per-type bounds remain only as a fallback when no config exists.
 */
export async function offeredFareBounds(
  rideType: string,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): Promise<{ min: number; max: number }> {
  try {
    const snap = await db.doc('fareConfig/islamabad_rawalpindi').get();
    if (snap.exists) {
      const cfg = snap.data() as CityFareConfig;
      const category = RIDE_TO_ENGINE_CAT[rideType] ?? 'mini';
      const distanceKm = Math.max(0.5, haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng));
      const est = calculateFare(cfg, {
        category,
        distanceKm,
        durationMin: Math.max(3, Math.round(distanceKm * 3.5)),
      });
      return { min: est.minAcceptableBid, max: est.suggestedMaxBid };
    }
  } catch (e) {
    logger.warn('offeredFareBounds: falling back to static bounds', e);
  }
  return fareBounds(rideType as Parameters<typeof fareBounds>[0]);
}

const createTripSchema = z.object({
  rideType: z.enum(['bike', 'auto', 'mini', 'ac', 'comfort', 'xl']),
  offeredFare: z.number().int().positive(),
  seats: z.number().int().min(1).max(MAX_SEATS),
  passengerGender: z.enum(['male', 'female', 'unspecified']),
  pool: z.boolean().optional(),
  // Pool rides only. public → nearby riders can discover and join; private →
  // joinable only through the share link. Nullish because the mobile SDK
  // encodes absent optionals as null on the wire.
  poolVisibility: z.enum(['public', 'private']).nullish(),
  paymentMethod: z.enum(['cash', 'wallet']).default('cash'),
  preferFemaleDriver: z.boolean().optional(),
  promoCode: z.string().max(32).optional(),
  pickup: geoSchema,
  dropoff: geoSchema,
});

/** Passenger creates a ride request. Rejects a second concurrent active trip. */
export const createTrip = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'createTrip', 5, 60);
  const parsed = createTripSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid(parsed.error.issues[0]?.message ?? 'Invalid trip request.');
  }
  const data = parsed.data;

  // Two independent config reads that used to run back to back, costing the
  // rider a whole extra round trip on the one call they are staring at a
  // spinner through. Neither depends on the other, so they go together.
  //
  // Pool trips offer the full solo fare too — the per-seat discount only
  // materialises as riders actually join — so the same bounds apply.
  const [{ min: fareMin, max: fareMax }, cancellationSettings] = await Promise.all([
    offeredFareBounds(data.rideType, data.pickup, data.dropoff),
    getCancellationSettings(),
  ]);
  if (data.offeredFare < fareMin || data.offeredFare > fareMax) {
    invalid(`Offered fare for ${data.rideType} must be between ${fareMin} and ${fareMax} PKR.`);
  }

  const isPool = data.pool ?? false;
  const poolVisibility = isPool ? (data.poolVisibility ?? 'public') : null;
  const shareCode = isPool ? generateShareCode() : null;
  // The fare after any promo discount, lifted out of the transaction so the
  // broadcast below can quote the number the driver will actually be offered.
  // Assigned inside the transaction, which may retry — last write wins, and a
  // retry recomputes it from the same inputs.
  let broadcastFare = data.offeredFare;

  const tripRef = db.collection('trips').doc();
  const userRef = db.doc(`users/${ctx.uid}`);

  await db.runTransaction(async (tx) => {
    const [userSnap, walletSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(db.doc(`wallets/${ctx.uid}`)),
    ]);
    const activeTripId = userSnap.get('activeTripId') as string | undefined;
    if (activeTripId) {
      const activeSnap = await tx.get(db.doc(`trips/${activeTripId}`));
      if (activeSnap.exists && ACTIVE_STATUSES.has(activeSnap.get('status'))) {
        throw new HttpsError('failed-precondition', 'You already have an active trip.');
      }
    }

    // Unpaid cancellation fees past the limit block new bookings until settled.
    assertOutstandingClear(walletSnap, cancellationSettings, 'passenger');

    // Wallet trips: the fare is held at bid-acceptance, but reject requests the
    // passenger can already not afford so drivers don't bid on dead trips.
    const walletBalance = (walletSnap.get('balance') as number | undefined) ?? 0;

    // Validate promo code if provided
    let promoDiscount = 0;
    if (data.promoCode) {
      const promoSnap = await tx.get(db.doc(`promoCodes/${data.promoCode.toUpperCase()}`));
      if (promoSnap.exists && promoSnap.get('active') === true) {
        const usageCount = (promoSnap.get('usageCount') as number) ?? 0;
        const usageLimit = (promoSnap.get('usageLimit') as number) ?? Infinity;
        if (usageCount < usageLimit) {
          promoDiscount = (promoSnap.get('discountFlat') as number) ?? 0;
          tx.set(db.doc(`promoCodes/${data.promoCode.toUpperCase()}`),
            { usageCount: FieldValue.increment(1) }, { merge: true });
        }
      }
    }

    const finalFare = Math.max(50, data.offeredFare - promoDiscount);
    broadcastFare = finalFare;

    if (data.paymentMethod === 'wallet' && walletBalance < finalFare) {
      throw new HttpsError(
        'failed-precondition',
        `Insufficient wallet balance (${walletBalance} PKR). Top up your wallet or pay with cash.`,
      );
    }

    tx.set(tripRef, {
      id: tripRef.id,
      status: 'requested' as TripStatus,
      passengerId: ctx.uid,
      passengerGender: data.passengerGender,
      driverId: null,
      rideType: data.rideType,
      offeredFare: finalFare,
      fare: null,
      seats: data.seats,
      pool: isPool,
      ...(isPool
        ? {
            poolVisibility,
            shareCode,
            poolMembers: [ctx.uid],
            // Who is in the car, by name. Seeded here so a pool has a roster
            // from the moment it exists — the drop-off list and the "sharing
            // this car" card both read it, and a pool whose first entry only
            // appeared when somebody joined left the host invisible on their
            // own ride. See trips/poolRoster.
            poolRoster: [
              hostRosterEntry({
                uid: ctx.uid,
                name: (userSnap.get('name') as string | undefined)
                  ?? (userSnap.get('displayName') as string | undefined),
                gender: data.passengerGender,
                pickup: data.pickup,
                dropoff: data.dropoff,
              }),
            ],
            poolPerSeatFare: finalFare, // just the host so far → full fare
            maxPoolRiders: MAX_POOL_RIDERS,
            // Running gender tally so nearby riders can see the make-up of a
            // pool before joining (names are never exposed — just the counts).
            poolGenders: {
              male:   data.passengerGender === 'male'   ? 1 : 0,
              female: data.passengerGender === 'female' ? 1 : 0,
            },
          }
        : {}),
      paymentMethod: data.paymentMethod,
      preferFemaleDriver: data.preferFemaleDriver ?? false,
      promoCode: data.promoCode ?? null,
      promoDiscount,
      pickup: data.pickup,
      dropoff: data.dropoff,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, { activeTripId: tripRef.id }, { merge: true });
    // Public-safe feed that approved online drivers can read to discover work.
    // Carries the passenger's display name and rating (never their uid, phone
    // or photo) so the driver's request list can show who is hailing them.
    const pickupGeohash = encodeGeohash(data.pickup.lat, data.pickup.lng, 6);
    tx.set(db.doc(`openRequests/${tripRef.id}`), {
      tripId: tripRef.id,
      rideType: data.rideType,
      offeredFare: finalFare,
      seats: data.seats,
      passengerGender: data.passengerGender,
      passengerName: (userSnap.get('name') as string | undefined) ?? 'Passenger',
      passengerRating: (userSnap.get('rating') as number | undefined) ?? 5,
      passengerRatingCount: (userSnap.get('ratingCount') as number | undefined) ?? 0,
      pool: isPool,
      ...(isPool
        ? {
            poolVisibility,
            shareCode,
            poolRiders: 1,
            // Mirrored so the driver feed can say "1 rider now, up to 4"
            // without hard-coding the cap on the client.
            maxPoolRiders: MAX_POOL_RIDERS,
            poolPerSeatFare: finalFare,
            poolGenders: {
              male:   data.passengerGender === 'male'   ? 1 : 0,
              female: data.passengerGender === 'female' ? 1 : 0,
            },
          }
        : {}),
      paymentMethod: data.paymentMethod,
      preferFemaleDriver: data.preferFemaleDriver ?? false,
      pickup: data.pickup,
      dropoff: data.dropoff,
      pickupGeohash,
      createdAt: FieldValue.serverTimestamp(),
    });
    // Share-code → trip lookup used by the pool invite link / join flow.
    if (isPool && shareCode) {
      tx.set(db.doc(`poolShareCodes/${shareCode}`), {
        tripId: tripRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  logger.info('Trip created', { tripId: tripRef.id, passenger: ctx.uid });

  // Broadcast to nearby online drivers — best-effort, does not block the response.
  broadcastTripToNearbyDrivers(
    tripRef.id,
    data.pickup,
    data.pool ?? false,
    data.rideType,
    { fare: broadcastFare },
  ).catch((err) => logger.error('Broadcast failed', { tripId: tripRef.id, err }));

  // Public pools go out to riders whose saved daily route matches this one on
  // both ends, so they can choose to hop in — best-effort, never blocks.
  if (isPool && poolVisibility === 'public') {
    notifyDailyRouteMatches({
      tripId:  tripRef.id,
      hostUid: ctx.uid,
      shareCode,
      pickup:  { lat: data.pickup.lat, lng: data.pickup.lng },
      dropoff: { lat: data.dropoff.lat, lng: data.dropoff.lng },
      rideType: data.rideType,
    }).catch((err) => logger.error('Daily-route alerts failed', { tripId: tripRef.id, err }));
  }

  return { ok: true, tripId: tripRef.id, shareCode };
});

// Unambiguous alphabet (no 0/O/1/I/L) — codes get read out loud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateShareCode(len = 8): string {
  let out = '';
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function broadcastTripToNearbyDrivers(
  tripId: string,
  pickup: { lat: number; lng: number; address?: string },
  isPool: boolean,
  rideType: string,
  opts: { fare?: number } = {},
): Promise<void> {
  const settingsSnap = await db.doc('config/rideSettings').get();
  const radiusKm = (settingsSnap.get('searchRadiusKm') as number) ?? 2;

  const driversSnap = await db.collection('drivers')
    .where('online', '==', true)
    .where('verificationStatus', '==', 'approved')
    .get();

  const nearbyUids: string[] = [];
  for (const d of driversSnap.docs) {
    const loc = d.get('lastLocation') as { lat: number; lng: number } | undefined;
    if (!loc?.lat || !loc?.lng) continue;
    if (haversineKm(pickup.lat, pickup.lng, loc.lat, loc.lng) <= radiusKm) {
      nearbyUids.push(d.id);
    }
  }

  // Drivers with the app CLOSED get no push — there is nothing to push to. They
  // are reached, if at all, on WhatsApp, and only when the online drivers above
  // are too few to serve this ride. Deliberately fired before the early return
  // below: no online drivers at all is the case where it matters most.
  alertOfflineDriversOnWhatsApp({
    tripId,
    pickup,
    rideType,
    fare: opts.fare ?? 0,
    onlineNearby: nearbyUids.length,
  }).catch((err) => logger.error('WhatsApp alerts failed', { tripId, err }));

  if (nearbyUids.length === 0) {
    logger.info('No nearby drivers for broadcast', { tripId });
    return;
  }

  const title = isPool ? '🔀 Pool ride request nearby' : '🚗 Ride request nearby';
  const body  = `A passenger needs a ${rideType} — tap to view`;

  await sendToUsers(nearbyUids, title, body, { tripId, screen: 'request-detail' });
  logger.info('Broadcast complete', { tripId, driverCount: nearbyUids.length, radiusKm });
}

const placeBidSchema = z.object({
  tripId: z.string().min(1).max(128),
  fare: z.number().int().positive(),
});

/** An approved, online driver bids on an open request. */
export const placeBid = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  await rateLimit(ctx.uid, 'placeBid', 30, 60);
  const parsed = placeBidSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and fare.');
  const { tripId, fare } = parsed.data;

  const [driverSnap, driverWalletSnap, commissionSettings, cancellationSettings] = await Promise.all([
    db.doc(`drivers/${ctx.uid}`).get(),
    db.doc(`wallets/${ctx.uid}`).get(),
    getCommissionSettings(),
    getCancellationSettings(),
  ]);
  if (driverSnap.get('verificationStatus') !== 'approved') {
    throw new HttpsError('permission-denied', 'Driver is not approved.');
  }
  if (driverSnap.get('online') !== true) {
    throw new HttpsError('failed-precondition', 'Go online before bidding.');
  }
  // Locked drivers must settle their commission cycle before taking new work.
  assertCommissionClear(driverSnap, commissionSettings);
  // As must drivers who racked up unpaid cancellation fees.
  assertOutstandingClear(driverWalletSnap, cancellationSettings, 'driver');

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) invalid('Trip not found.');
  if (tripSnap.get('passengerId') === ctx.uid) {
    throw new HttpsError('failed-precondition', 'You cannot bid on your own trip.');
  }
  if (tripSnap.get('status') !== 'requested') {
    throw new HttpsError('failed-precondition', 'This trip is no longer open for bids.');
  }
  const bidBounds = await offeredFareBounds(
    tripSnap.get('rideType'),
    tripSnap.get('pickup'),
    tripSnap.get('dropoff'),
  );
  if (fare < bidBounds.min || fare > bidBounds.max) {
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
    // Snapshot of the driver's position so the passenger's map can show the
    // offering drivers around them, Uber-style.
    driverLocation: (driverSnap.get('lastLocation') as { lat: number; lng: number } | undefined) ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Notify passenger of the new bid
  const passengerId = (await db.doc(`trips/${tripId}`).get()).get('passengerId') as string | undefined;
  if (passengerId) {
    await sendToUser(passengerId, '🚗 New driver offer', `A driver offered PKR ${fare} for your ride`, { tripId });
  }

  logger.info('Bid placed', { tripId, driver: ctx.uid, fare });
  return { ok: true, bidId: bidRef.id };
});

const raiseFareSchema = z.object({
  tripId: z.string().min(1).max(128),
  fare: z.number().int().positive(),
});

/**
 * Passenger raises the fare they are offering on a still-open request, to
 * attract drivers. Fare may only go up and must stay within the allowed band.
 * Updates both the private trip and the public openRequests feed.
 */
export const raiseTripFare = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'raiseTripFare', 20, 60);
  const parsed = raiseFareSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and fare.');
  const { tripId, fare } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);

  // Route never changes after creation, so bounds can be computed outside the
  // transaction (offeredFareBounds reads the fare config, which must not be a
  // transactional read).
  const preSnap = await tripRef.get();
  if (!preSnap.exists) invalid('Trip not found.');
  const raiseBounds = await offeredFareBounds(
    preSnap.get('rideType'),
    preSnap.get('pickup'),
    preSnap.get('dropoff'),
  );

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(tripRef);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('passengerId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    if (snap.get('status') !== 'requested') {
      throw new HttpsError('failed-precondition', 'This trip is no longer open.');
    }
    const current = snap.get('offeredFare') as number;
    if (fare <= current) {
      throw new HttpsError('failed-precondition', 'New fare must be higher than the current offer.');
    }
    if (fare < raiseBounds.min || fare > raiseBounds.max) {
      invalid('Fare is outside the allowed range.');
    }
    // Pool rides: the per-seat figure follows the (raised) solo fare.
    const members = (snap.get('poolMembers') as string[] | undefined) ?? [];
    const perSeat = snap.get('pool') === true
      ? poolPerSeatFare(fare, Math.max(1, members.length))
      : null;
    tx.set(
      tripRef,
      {
        offeredFare: fare,
        ...(perSeat !== null ? { poolPerSeatFare: perSeat } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      db.doc(`openRequests/${tripId}`),
      { offeredFare: fare, ...(perSeat !== null ? { poolPerSeatFare: perSeat } : {}) },
      { merge: true },
    );
  });

  logger.info('Trip fare raised', { tripId, by: ctx.uid, fare });
  return { ok: true, offeredFare: fare };
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
    const passengerId = tripSnap.get('passengerId') as string;
    const paymentMethod = (tripSnap.get('paymentMethod') as string | undefined) ?? 'cash';

    // Read phone numbers so both sides can contact each other in-ride
    const [passengerUserSnap, driverDocSnap] = await Promise.all([
      tx.get(db.doc(`users/${passengerId}`)),
      tx.get(db.doc(`drivers/${driverInfo.driverId}`)),
    ]);

    // Wallet trips: hold the full fare from the passenger's wallet now, so the
    // driver is guaranteed payment. Released back on cancel; settled to the
    // driver (minus commission) on completion.
    let walletHold = 0;
    if (paymentMethod === 'wallet') {
      const walletRef = db.doc(`wallets/${passengerId}`);
      const walletSnap = await tx.get(walletRef);
      const balance = (walletSnap.get('balance') as number) ?? 0;
      if (balance < fare) {
        throw new HttpsError(
          'failed-precondition',
          `Insufficient wallet balance (${balance} PKR) for this ${fare} PKR fare. Top up first.`,
        );
      }
      walletHold = fare;
      tx.set(
        walletRef,
        { balance: FieldValue.increment(-fare), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      tx.set(walletRef.collection('transactions').doc(), {
        type: 'ride_hold',
        amount: -fare,
        tripId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    const passengerPhone =
      (passengerUserSnap.get('phoneNumber') as string | null) ?? null;
    const driverPhone =
      (driverDocSnap.get('phone')        as string | null) ??
      (driverDocSnap.get('phoneNumber')  as string | null) ??
      null;

    // Pool rides: the per-seat figure now follows the driver-locked fare.
    const poolMembers = (tripSnap.get('poolMembers') as string[] | undefined) ?? [];
    const poolPerSeat = tripSnap.get('pool') === true
      ? poolPerSeatFare(fare, Math.max(1, poolMembers.length))
      : null;
    tx.set(
      tripRef,
      {
        status: 'matched' as TripStatus,
        driverId: driverInfo.driverId,
        driverInfo,
        fare,
        ...(poolPerSeat !== null ? { poolPerSeatFare: poolPerSeat } : {}),
        walletHold,
        passengerPhone,
        driverPhone,
        matchedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(bidRef, { status: 'accepted' }, { merge: true });
    tx.delete(db.doc(`openRequests/${tripId}`)); // no longer open
    return { fare, driverId: driverInfo.driverId };
  });

  // Notify driver they were chosen
  await sendToUser(result.driverId, '✅ Bid accepted!', `Your offer of PKR ${result.fare} was accepted. Head to the pickup point.`, { tripId });
  // Notify passenger match confirmed
  const passengerSnap = await db.doc(`trips/${tripId}`).get();
  const passengerId = passengerSnap.get('passengerId') as string | undefined;
  if (passengerId) {
    await sendToUser(passengerId, '🚗 Driver on the way!', `Your driver is heading to your pickup — PKR ${result.fare}`, { tripId });
  }

  logger.info('Bid accepted', { tripId, ...result });
  return { ok: true, ...result };
});

const declineBidSchema = z.object({
  tripId: z.string().min(1).max(128),
  bidId: z.string().min(1).max(128),
});

/**
 * Passenger turns down one driver's offer.
 *
 * Accepting was the only answer the passenger had, so a fare they did not want
 * simply sat in the list until the timer ran out. Declining retires that one
 * bid and leaves the request open — every other driver's offer stands, and the
 * trip stays in `requested`.
 *
 * A bid doc is keyed by the driver's uid, so a driver who bids again overwrites
 * this row and lands back in the list as `pending`. That is deliberate: a
 * decline rejects a PRICE, not a person, and the obvious next move for a driver
 * who wants the ride is to come back cheaper.
 */
export const declineBid = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = declineBidSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId and bidId.');
  const { tripId, bidId } = parsed.data;

  const tripRef = db.doc(`trips/${tripId}`);
  const bidRef = db.doc(`trips/${tripId}/bids/${bidId}`);

  const declined = await db.runTransaction(async (tx) => {
    const tripSnap = await tx.get(tripRef);
    if (!tripSnap.exists) invalid('Trip not found.');
    // Only the passenger who owns the trip may decline. On a pool that is the
    // host, which matches acceptBid — joiners never pick the driver.
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

    tx.set(
      bidRef,
      { status: 'declined', declinedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    return {
      driverId: bidSnap.get('driverId') as string,
      fare: bidSnap.get('fare') as number,
    };
  });

  // Tell the driver, so they can re-offer rather than wait on a dead bid.
  await sendToUser(
    declined.driverId,
    'Offer declined',
    `The passenger declined your PKR ${declined.fare} offer. You can send a new one.`,
    { tripId },
  );

  logger.info('Bid declined', { tripId, bidId });
  return { ok: true };
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
    const extra = to === 'arrived' ? { arrivedAt: FieldValue.serverTimestamp() } : {};
    tx.set(
      tripRef,
      { status: to, updatedAt: FieldValue.serverTimestamp(), ...extra },
      { merge: true },
    );
  });

  // Push to passenger based on new status
  const snap2 = await db.doc(`trips/${tripId}`).get();
  const passengerId2 = snap2.get('passengerId') as string | undefined;
  if (passengerId2) {
    const msgs: Record<string, [string, string]> = {
      arriving:    ['🚗 Driver is on the way', 'Your driver is heading to your pickup point.'],
      arrived:     ['📍 Driver has arrived!', 'Your driver is waiting at the pickup point.'],
      in_progress: ['🛣️ Trip started!', 'You are on your way to the destination.'],
    };
    const [title, body] = msgs[to] ?? [];
    if (title) await sendToUser(passengerId2, title, body, { tripId });
  }

  logger.info('Trip status advanced', { tripId, to, driver: ctx.uid });
  return { ok: true, status: to };
});

const cancelSchema = z.object({
  tripId: z.string().min(1).max(128),
  reason: z.string().max(300).optional(),
});

/**
 * Either participant cancels a trip that has not yet started.
 *
 * Free while the trip is still `requested` — nobody has committed to it. Once a
 * driver has accepted (matched / arriving / arrived) the canceller owes Velocity
 * a fee on the locked fare: 5% from a passenger, 8% from a driver. The fee comes
 * out of their wallet balance where there is one, and whatever is left becomes
 * `outstanding` on their wallet — a debt that blocks new rides once it reaches
 * the configured limit. See domain/cancellation.
 */
export const cancelTrip = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = cancelSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  const { tripId, reason } = parsed.data;

  // Admin-configured rates; read outside the transaction (config is not part of
  // the atomic set and a transactional read of it would only add contention).
  const settings = await getCancellationSettings();

  const tripRef = db.doc(`trips/${tripId}`);
  const cancellerWalletRef = db.doc(`wallets/${ctx.uid}`);

  const outcome = await db.runTransaction(async (tx) => {
    // ── Reads (all of them, before any write — Firestore requires this) ──
    const [snap, cancellerWalletSnap] = await Promise.all([
      tx.get(tripRef),
      tx.get(cancellerWalletRef),
    ]);

    if (!snap.exists) invalid('Trip not found.');
    const passengerId = snap.get('passengerId') as string;
    const driverId = snap.get('driverId') as string | null;
    if (ctx.uid !== passengerId && ctx.uid !== driverId) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    const status = snap.get('status') as TripStatus;
    if (status === 'in_progress' || status === 'completed' || status === 'cancelled') {
      throw new HttpsError('failed-precondition', `Cannot cancel a ${status} trip.`);
    }

    const cancelledByRole: 'passenger' | 'driver' = ctx.uid === driverId ? 'driver' : 'passenger';
    // The fare locked in at acceptBid is what both sides agreed to. Before a bid
    // is accepted there is no `fare` — but those statuses are free anyway.
    const lockedFare = (snap.get('fare') as number | null) ?? (snap.get('offeredFare') as number) ?? 0;
    const { amount: fee, rate } = cancellationFee({
      status,
      cancelledByRole,
      fare: lockedFare,
      settings,
    });

    // ── Writes ──
    // Release any wallet hold back to the passenger in the same transaction.
    const walletHold = (snap.get('walletHold') as number) ?? 0;
    if (walletHold > 0) {
      const passengerWalletRef = db.doc(`wallets/${passengerId}`);
      tx.set(
        passengerWalletRef,
        { balance: FieldValue.increment(walletHold), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      tx.set(passengerWalletRef.collection('transactions').doc(), {
        type: 'ride_hold_refund',
        amount: walletHold,
        tripId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Charge the fee to whoever walked away. A cancelling passenger gets their
    // hold back above, so that money is available to pay the fee out of.
    let paidFromWallet = 0;
    let addedToOutstanding = 0;
    if (fee > 0) {
      const balance = (cancellerWalletSnap.get('balance') as number | undefined) ?? 0;
      const available = balance + (cancelledByRole === 'passenger' ? walletHold : 0);
      ({ paidFromWallet, addedToOutstanding } = splitFeeAgainstBalance(fee, available));

      tx.set(
        cancellerWalletRef,
        {
          ...(paidFromWallet > 0 ? { balance: FieldValue.increment(-paidFromWallet) } : {}),
          ...(addedToOutstanding > 0 ? { outstanding: FieldValue.increment(addedToOutstanding) } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      tx.set(cancellerWalletRef.collection('transactions').doc(), {
        type: 'cancellation_fee',
        // Only the part actually taken from the balance moves money here; the
        // rest is a debt, tracked on `outstanding` and shown separately.
        amount: -paidFromWallet,
        fee,
        outstanding: addedToOutstanding,
        role: cancelledByRole,
        tripId,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Velocity's books: the whole fee is revenue owed to us, but only the part
      // paid from the wallet is money we already hold.
      tx.set(db.collection('platformLedger').doc(), {
        type: 'cancellation_fee',
        tripId,
        userId: ctx.uid,
        role: cancelledByRole,
        passengerId,
        driverId: driverId ?? null,
        amount: fee,
        rate,
        fare: lockedFare,
        collected: paidFromWallet,
        outstanding: addedToOutstanding,
        cancelledAt: status,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        db.doc('system/counters'),
        {
          cancellationFeesCharged: FieldValue.increment(fee),
          cancellationFeesCollected: FieldValue.increment(paidFromWallet),
          cancellationFeesOutstanding: FieldValue.increment(addedToOutstanding),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    tx.set(
      tripRef,
      {
        status: 'cancelled' as TripStatus,
        cancelledBy: ctx.uid,
        cancelledByRole,
        cancelledFrom: status,
        cancelReason: reason ?? null,
        cancellationFee: fee > 0
          ? { amount: fee, rate, role: cancelledByRole, paidFromWallet, outstanding: addedToOutstanding }
          : null,
        walletHold: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(db.doc(`users/${passengerId}`), { activeTripId: null }, { merge: true });
    for (const member of (snap.get('poolMembers') as string[] | undefined) ?? []) {
      if (member !== passengerId) {
        tx.set(db.doc(`users/${member}`), { activeTripId: null }, { merge: true });
      }
    }
    tx.delete(db.doc(`openRequests/${tripId}`));

    return {
      passengerId,
      driverId,
      cancelledByRole,
      fee,
      rate,
      fare: lockedFare,
      paidFromWallet,
      addedToOutstanding,
    };
  });

  const { passengerId, driverId, cancelledByRole, fee, paidFromWallet, addedToOutstanding } = outcome;

  // Tell the wronged party what happened, and the canceller what it cost them.
  if (cancelledByRole === 'driver') {
    await sendToUser(passengerId, '❌ Driver cancelled', 'Your driver cancelled the trip. Please request another.', { tripId });
  } else if (driverId) {
    await sendToUser(driverId, '❌ Trip cancelled', 'The passenger cancelled the trip.', { tripId });
  }
  if (fee > 0) {
    await sendToUser(
      ctx.uid,
      '⚠️ Cancellation fee',
      addedToOutstanding > 0
        ? `PKR ${fee} was charged for cancelling after the ride was confirmed. PKR ${addedToOutstanding} is now outstanding to Velocity — settle it from your wallet.`
        : `PKR ${fee} was charged to your wallet for cancelling after the ride was confirmed.`,
      { tripId },
    );
  }

  logger.info('Trip cancelled', {
    tripId,
    by: ctx.uid,
    role: cancelledByRole,
    fee,
    paidFromWallet,
    addedToOutstanding,
  });
  return { ok: true, fee, paidFromWallet, outstanding: addedToOutstanding };
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

  const tripRef    = db.doc(`trips/${tripId}`);
  const driverRef  = db.doc(`drivers/${ctx.uid}`);

  // Commission rate/threshold are admin-configurable from the dashboard
  // (Commission page) and apply app-wide.
  const commissionSettings = await getCommissionSettings();
  const commissionRate = commissionSettings.rate;

  // Partner Program: whoever recruited this driver or this passenger earns a
  // slice of Velocity's commission on the ride — but only if the ride is
  // genuine. Both the referral lookup and the fraud check run queries, and
  // Firestore forbids reading after writing inside a transaction, so the plan is
  // assembled here and only the writes happen under `tx` below.
  const preTrip = await tripRef.get();
  // Cash pools carry riders beyond the primary passenger, and each may have a
  // different partner behind them. Wallet pools settle solo (only the host's
  // fare is held), so co-riders are only credited on cash pools.
  const prePassengerId = preTrip.get('passengerId') as string;
  const coRiderIds =
    preTrip.get('pool') === true &&
    ((preTrip.get('paymentMethod') as string | undefined) ?? 'cash') === 'cash'
      ? ((preTrip.get('poolMembers') as string[] | undefined) ?? []).filter(
          (uid) => uid !== prePassengerId,
        )
      : [];
  const partnerPlan = await preparePartnerCredit({
    tripId,
    driverId: ctx.uid,
    passengerId: prePassengerId,
    coRiderIds,
    pickup: (preTrip.get('pickup') as { lat: number; lng: number } | undefined) ?? null,
    dropoff: (preTrip.get('dropoff') as { lat: number; lng: number } | undefined) ?? null,
    startedAt: (preTrip.get('startedAt') as Timestamp | undefined)?.toDate() ?? null,
  });

  const settlement = await db.runTransaction(async (tx) => {
    const [snap, driverSnap] = await Promise.all([
      tx.get(tripRef),
      tx.get(driverRef),
    ]);
    if (!snap.exists) invalid('Trip not found.');
    if (snap.get('driverId') !== ctx.uid) {
      throw new HttpsError('permission-denied', 'Not your trip.');
    }
    if (snap.get('status') !== 'in_progress') {
      throw new HttpsError('failed-precondition', 'Trip is not in progress.');
    }

    const lockedFare    = snap.get('fare') as number;
    const passengerId   = snap.get('passengerId') as string;
    const franchiseId   = driverSnap.get('franchiseId') as string | null | undefined;
    const paymentMethod = (snap.get('paymentMethod') as string | undefined) ?? 'cash';

    // Pool cash trips: every rider pays in cash, so the driver's gross is the sum
    // of what the riders actually owe. Wallet holds only ever cover the host's
    // fare, so wallet pools settle solo (and en-route pickups are cash-only).
    //
    // Two ways a pool can be priced, in precedence order:
    //   1. poolDriverGross — a trip that carried en-route riders. Each rider has
    //      their own fare from the leg-split (trips/enRoute), because they each
    //      rode a different piece of the road. This is already the sum of them.
    //   2. the flat 60/40/35% tier — an ordinary destination pool, where everyone
    //      travelled the same route and pays the same share.
    const poolMembers = (snap.get('poolMembers') as string[] | undefined) ?? [];
    const isPool      = snap.get('pool') === true;
    const poolFares   = (snap.get('poolFares') as Record<string, number> | undefined) ?? null;
    const poolDriverGross = snap.get('poolDriverGross') as number | undefined;
    let grossFare = lockedFare;
    let seats     = (snap.get('seats') as number) ?? 1;
    if (isPool && paymentMethod === 'cash') {
      if (typeof poolDriverGross === 'number' && poolDriverGross > 0) {
        seats     = Math.max(1, poolMembers.length);
        grossFare = poolDriverGross;
      } else if (poolMembers.length > 1) {
        seats     = poolMembers.length;
        grossFare = poolPerSeatFare(lockedFare, seats) * seats;
      }
    }
    const s = computeSettlement(grossFare, seats, commissionRate);

    // 5% of gross fare goes to the franchise, capped at the commission actually
    // taken so a low admin-set rate can never make Velocity's net negative.
    const franchiseCut = franchiseId ? Math.min(Math.round(grossFare * 0.05), s.commission) : 0;

    // Fleet owners are paid out of the SAME commission, never out of the fare —
    // the driver's payout above is already fixed and is not touched by any of
    // this. `applyPartnerCredit` pays the franchise first, then each fleet, and
    // hands back what is left, so Velocity's net can reach zero but never go
    // below it however the admin sets the rates.
    // Each rider's own fare, so a passenger-side partner is paid on the
    // commission their recruit's seat produced — not on the whole car.
    const perSeat =
      isPool && paymentMethod === 'cash' && poolMembers.length > 1
        ? poolPerSeatFare(lockedFare, poolMembers.length)
        : null;
    const fareFor = (uid: string): number => poolFares?.[uid] ?? perSeat ?? grossFare;

    const partnerCredit = applyPartnerCredit(tx, partnerPlan, {
      tripId,
      driverId: ctx.uid,
      passengerId,
      grossFare,
      platformCommission: s.commission,
      franchiseCut,
      paymentMethod,
      passengerFare: fareFor(passengerId),
      coRiderFares: Object.fromEntries(coRiderIds.map((uid) => [uid, fareFor(uid)])),
    });
    const velocityNet = partnerCredit.velocityNet;

    const walletRef   = db.doc(`wallets/${ctx.uid}`);
    const txRef       = walletRef.collection('transactions').doc();
    const countersRef = db.doc('system/counters');

    const walletHold = (snap.get('walletHold') as number) ?? 0;

    tx.set(
      tripRef,
      {
        status: 'completed' as TripStatus,
        // `passengerShare` is the even split and means nothing on an en-route
        // pool, where riders rode different distances — `poolFares` is the real
        // receipt, so carry it into the settlement rather than leaving each rider
        // to be told an average they never paid.
        settlement: {
          ...s,
          ...(poolFares ? { poolFares } : {}),
          franchiseCut,
          driverFleetCut: partnerCredit.driverFleetCut,
          passengerFleetCut: partnerCredit.passengerFleetCut,
          velocityNet,
          paymentMethod,
        },
        // A ride the fraud engine rejected still completes and still pays the
        // driver — the passenger really was carried. What it does not do is pay
        // a partner. The verdict is recorded on the trip so support can see why.
        partnerRideStatus: partnerCredit.rideStatus,
        walletHold: 0,
        walletSettled: paymentMethod === 'wallet',
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Wallet trips: the passenger's fare was held at bid-acceptance. Settle it
    // now — driver payout to their wallet, commission to the platform ledger.
    // Cash trips: driver already received cash from passenger — only track
    // the gross fare for commission cycle purposes; no wallet credit.
    if (paymentMethod === 'wallet') {
      if (walletHold !== grossFare) {
        // Should never happen (fare locks at accept); settle from the fare and
        // leave an audit trail rather than blocking the trip.
        logger.error('Wallet hold does not match fare at settlement', { tripId, walletHold, grossFare });
      }
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
        franchiseCut,
        paymentMethod,
        createdAt: FieldValue.serverTimestamp(),
      });
      // Commission collected instantly from the held fare — this money is
      // already in the platform's gateway settlement account (it entered via a
      // verified top-up), so ledger it as realized revenue.
      tx.set(db.collection('platformLedger').doc(), {
        type: 'ride_commission',
        source: 'wallet',
        tripId,
        driverId: ctx.uid,
        passengerId,
        amount: s.commission,
        franchiseCut,
        driverFleetCut: partnerCredit.driverFleetCut,
        passengerFleetCut: partnerCredit.passengerFleetCut,
        velocityNet,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        countersRef,
        { walletCommissionCollected: FieldValue.increment(s.commission) },
        { merge: true },
      );
    } else {
      // Cash: log the trip for audit but no balance movement
      tx.set(txRef, {
        type: 'trip_cash',
        tripId,
        amount: 0,
        grossFare: s.grossFare,
        commission: s.commission,
        franchiseCut,
        paymentMethod,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
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
    // Accumulate cycle earnings for commission lock tracking. Cash fares also
    // grow the settleable (owed) portion; wallet commission was collected just
    // above, so a cycle earned entirely online hits the threshold owing
    // nothing and clears itself without locking the driver.
    const prevGross = (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0;
    const prevCash  = cycleCashFare(driverSnap);
    let newGross = prevGross + grossFare;
    let newCash  = prevCash + (paymentMethod === 'wallet' ? 0 : grossFare);
    const cashDue = Math.round(newCash * commissionSettings.rate);
    if (newGross >= commissionSettings.threshold && cashDue === 0) {
      tx.set(driverRef.collection('commissionPayments').doc(), {
        amount: 0,
        threshold: commissionSettings.threshold,
        rate: commissionSettings.rate,
        cycleGrossFare: newGross,
        cycleCashFare: newCash,
        auto: true,
        paidAt: FieldValue.serverTimestamp(),
      });
      newGross = 0;
      newCash  = 0;
    }
    tx.set(
      driverRef,
      {
        tripsCount: FieldValue.increment(1),
        cycleGrossFare: newGross,
        cycleCashFare: newCash,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(db.doc(`users/${passengerId}`), { activeTripId: null }, { merge: true });
    // Pool riders who joined via a share link track the trip through
    // activeTripId too — release all of them.
    for (const member of poolMembers) {
      if (member !== passengerId) {
        tx.set(db.doc(`users/${member}`), { activeTripId: null }, { merge: true });
      }
    }

    // Credit franchise revenue.
    if (franchiseId && franchiseCut > 0) {
      tx.set(
        db.doc(`franchises/${franchiseId}`),
        {
          cycleRevenue: FieldValue.increment(franchiseCut),
          totalRevenue: FieldValue.increment(franchiseCut),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return {
      ...s,
      franchiseCut,
      velocityNet,
      commissionLocked: newGross >= commissionSettings.threshold && cashDue > 0,
      commissionDue: cashDue,
    };
  });

  // Notify both parties
  const completedSnap = await db.doc(`trips/${tripId}`).get();
  const completedPassengerId = completedSnap.get('passengerId') as string | undefined;
  const completedFare = completedSnap.get('fare') as number | undefined;
  if (completedPassengerId) {
    await sendToUser(completedPassengerId, '✅ Trip complete!', `You've arrived. Fare: PKR ${completedFare ?? settlement.grossFare}. Please rate your driver.`, { tripId });
  }
  const completedCoRiders = ((completedSnap.get('poolMembers') as string[] | undefined) ?? [])
    .filter((m) => m !== completedPassengerId);
  if (completedCoRiders.length > 0) {
    const completedPoolFares = completedSnap.get('poolFares') as Record<string, number> | undefined;
    if (completedPoolFares) {
      // Riders who boarded at different points owe different amounts — telling
      // them all the same average would be telling most of them a wrong number.
      await Promise.all(
        completedCoRiders.map((uid) =>
          sendToUser(
            uid,
            '✅ Pool trip complete!',
            `You've arrived. Your fare: PKR ${completedPoolFares[uid] ?? settlement.passengerShare}.`,
            { tripId },
          ),
        ),
      );
    } else {
      await sendToUsers(completedCoRiders, '✅ Pool trip complete!', `You've arrived. Your share: PKR ${settlement.passengerShare}.`, { tripId });
    }
  }
  await sendToUser(ctx.uid, '💰 Trip complete', `PKR ${settlement.driverPayout} earned. Great driving!`, { tripId });
  if (settlement.commissionLocked) {
    await sendToUser(
      ctx.uid,
      '🔒 Commission due',
      `Your earnings cycle is complete. Settle PKR ${settlement.commissionDue} with Velocity to keep receiving rides.`,
      { tripId },
    );
  }

  logger.info('Trip completed', { tripId, settlement });
  return { ok: true, settlement };
});
