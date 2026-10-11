/**
 * The one place a trip document is shaped.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------
 * A trip is not one document. Creating one writes four things that have to
 * agree with each other:
 *
 *   trips/{id}             the private record
 *   openRequests/{id}      the public feed drivers read
 *   poolShareCodes/{code}  the invite lookup, pools only
 *   users/{uid}.activeTripId
 *
 * And for a shared ride the agreement is not cosmetic. `poolGenders` is the
 * tally a woman reads before she gets into a car; `poolRoster` is who the
 * driver expects at the kerb; `poolPerSeatFare` is money. If the trip document
 * and the feed disagree about any of them, the app shows one thing and charges
 * or seats another.
 *
 * `createTrip` had this write inline. `scheduledRides` already has its own
 * second copy for solo rides. When the commute cron needed to create a shared
 * ride too, a third copy would have been three places where seat counts,
 * gender tallies and fares could drift apart — and drift in exactly the fields
 * nobody notices until a rider is in the wrong car or is charged the wrong
 * amount. So the write moved here and the callers pass a seed.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * No validation, no fare arithmetic, no gender derivation, no permission
 * checks. Every caller still owns its own rules — `createTrip` checks bounds
 * and wallets and promos, the cron checks that the rider opted in — because
 * those rules differ per caller and burying them here would make them
 * invisible. This function only writes, and it writes the same shape every
 * time.
 *
 * It must be called inside a transaction. All four writes land together or not
 * at all; a trip with no open request is invisible to drivers, and an open
 * request with no trip is a ghost in the feed.
 * ----------------------------------------------------------------------------
 */
import { randomInt } from 'crypto';

import { db, FieldValue } from '../lib/firebase';
import { encodeGeohash } from '../lib/geohash';
import { MAX_POOL_RIDERS } from '../domain/fares';
import { TripStatus, PaymentMethod } from '../domain/types';
import { hostRosterEntry } from './poolRoster';

/** Short, human-readable invite code for a shared ride. */
export function generateShareCode(): string {
  // No I/O/0/1 — these get read aloud and typed in by hand.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export interface GeoPointish {
  lat: number;
  lng: number;
  /** Optional because createTrip's own schema allows a pin with no label. */
  address?: string;
}

export interface TripSeed {
  uid: string;
  rideType: string;
  /** The fare the driver is offered, after everything the caller applies. */
  fare: number;
  seats: number;
  /** Gender of the person IN the seat — see lib/seatGender. */
  passengerGender: string;
  /** True when the booker is not the passenger. */
  bookedForOther: boolean;

  pool: boolean;
  /** Pools only. 'public' is discoverable; 'private' is link-only. */
  poolVisibility?: 'public' | 'private' | null;
  /** Pools only. Pass the code so the caller can return it to the client. */
  shareCode?: string | null;

  paymentMethod: 'cash' | 'wallet';
  paymentMethods: PaymentMethod[];
  preferFemaleDriver?: boolean;
  promoCode?: string | null;
  promoDiscount?: number;

  pickup: GeoPointish;
  dropoff: GeoPointish;

  /** Display fields for the public feed, read from the caller's user doc. */
  passengerName?: string;
  passengerRating?: number;
  passengerRatingCount?: number;

  /**
   * Anything the caller wants on the trip document that is particular to how
   * the trip came about — `autoBooked`/`commuteFormed` from the commute cron,
   * `scheduled`/`scheduleId` from a saved schedule. Kept as an escape hatch so
   * a new kind of trip does not need a new parameter here, and deliberately
   * NOT mirrored to openRequests: how a ride was created is not a driver's
   * business.
   */
  provenance?: Record<string, unknown>;
}

/**
 * Write a trip and everything that has to agree with it.
 *
 * Must run inside `db.runTransaction`. Returns nothing — the caller already
 * holds `tripRef` and knows the share code it passed in.
 */
export function writeTripDocuments(
  tx: FirebaseFirestore.Transaction,
  tripRef: FirebaseFirestore.DocumentReference,
  seed: TripSeed,
): void {
  const isPool = seed.pool;
  const shareCode = isPool ? (seed.shareCode ?? null) : null;
  const poolVisibility = isPool ? (seed.poolVisibility ?? 'public') : null;

  /** The tally a rider reads before getting into the car. One source, two docs. */
  const poolGenders = {
    male: seed.passengerGender === 'male' ? 1 : 0,
    female: seed.passengerGender === 'female' ? 1 : 0,
  };

  const poolFields = isPool
    ? {
        poolVisibility,
        shareCode,
        maxPoolRiders: MAX_POOL_RIDERS,
        poolPerSeatFare: seed.fare, // just the host so far → the full fare
        poolGenders,
      }
    : {};

  tx.set(tripRef, {
    id: tripRef.id,
    status: 'requested' as TripStatus,
    passengerId: seed.uid,
    passengerGender: seed.passengerGender,
    bookedForOther: seed.bookedForOther,
    driverId: null,
    rideType: seed.rideType,
    offeredFare: seed.fare,
    fare: null,
    seats: seed.seats,
    pool: isPool,
    ...(isPool
      ? {
          ...poolFields,
          poolMembers: [seed.uid],
          // Seeded here so a pool has a roster from the moment it exists. A
          // pool whose first entry only appeared when somebody joined left the
          // host invisible on their own ride — see trips/poolRoster.
          poolRoster: [
            hostRosterEntry({
              uid: seed.uid,
              name: seed.passengerName,
              gender: seed.passengerGender,
              bookedForOther: seed.bookedForOther,
              pickup: seed.pickup,
              dropoff: seed.dropoff,
            }),
          ],
        }
      : {}),
    paymentMethod: seed.paymentMethod,
    paymentMethods: seed.paymentMethods,
    preferFemaleDriver: seed.preferFemaleDriver ?? false,
    promoCode: seed.promoCode ?? null,
    promoDiscount: seed.promoDiscount ?? 0,
    pickup: seed.pickup,
    dropoff: seed.dropoff,
    ...(seed.provenance ?? {}),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  tx.set(db.doc(`users/${seed.uid}`), { activeTripId: tripRef.id }, { merge: true });

  // The public-safe feed approved online drivers read to discover work. Carries
  // the passenger's display name and rating — never their uid, phone or photo.
  tx.set(db.doc(`openRequests/${tripRef.id}`), {
    tripId: tripRef.id,
    rideType: seed.rideType,
    offeredFare: seed.fare,
    seats: seed.seats,
    passengerGender: seed.passengerGender,
    bookedForOther: seed.bookedForOther,
    passengerName: seed.passengerName ?? 'Passenger',
    passengerRating: seed.passengerRating ?? 5,
    passengerRatingCount: seed.passengerRatingCount ?? 0,
    pool: isPool,
    ...(isPool
      ? {
          ...poolFields,
          // Mirrored so the driver feed can say "1 rider now, up to 4" without
          // hard-coding the cap on the client.
          poolRiders: 1,
        }
      : {}),
    paymentMethod: seed.paymentMethod,
    paymentMethods: seed.paymentMethods,
    preferFemaleDriver: seed.preferFemaleDriver ?? false,
    pickup: seed.pickup,
    dropoff: seed.dropoff,
    pickupGeohash: encodeGeohash(seed.pickup.lat, seed.pickup.lng, 6),
    createdAt: FieldValue.serverTimestamp(),
  });

  // Share-code → trip lookup, used by the invite link and the join flow.
  if (isPool && shareCode) {
    tx.set(db.doc(`poolShareCodes/${shareCode}`), {
      tripId: tripRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}
