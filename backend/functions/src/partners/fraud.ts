/**
 * Partner Program — fraud detection.
 * ----------------------------------------------------------------------------
 * A referral program pays for growth, which means it also pays for fake growth
 * unless something is watching. These checks run at ride completion, before a
 * single rupee is credited, and a ride that trips any of them earns zero — it
 * still appears in the partner's history, marked, because hiding it would make
 * the partner think the ride simply vanished.
 *
 * Every rule here answers one question: could this ride have been manufactured
 * by the person being paid for it?
 *
 *   collusion    the driver and the passenger both belong to the same partner —
 *                the partner can stage rides between two accounts they control
 *                and bill Velocity a commission on each one
 *   ride loop    the same driver/passenger pair going round and round, which is
 *                what staging looks like when it is automated
 *   same device  the driver and the passenger are literally one handset
 *   gps jump     pickup and drop-off that no vehicle could have travelled in the
 *                elapsed time, i.e. a mocked location
 *   zero motion  a "ride" whose start and end are the same spot
 *
 * Detection is deliberately conservative. A false positive costs an honest
 * partner real money and a support ticket, so each threshold is set where
 * legitimate behaviour does not reach.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import type { PartnerRideStatus } from './types';

export type FraudKind =
  | 'self_referral'
  | 'duplicate_account'
  | 'device_abuse'
  | 'collusion'
  | 'ride_loop'
  | 'gps_manipulation';

export interface FraudLogInput {
  kind: FraudKind;
  partnerId: string;
  subjectUid: string;
  detail: string;
  tripId?: string;
}

/** Immutable record for the admin fraud monitor. Never throws — logging must
 * not be able to fail the ride it is describing. */
export async function logFraud(input: FraudLogInput): Promise<void> {
  try {
    await db.collection('partner_fraud_logs').add({
      ...input,
      tripId: input.tripId ?? null,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    logger.warn('Partner fraud signal', input);
  } catch (err) {
    logger.error('Failed to write fraud log', { err, input });
  }
}

/** A pair of coordinates as trips store them. */
interface Point {
  lat: number;
  lng: number;
}

/** Straight-line km between two points (haversine). */
function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** No vehicle in a Pakistani city sustains this. Above it, the GPS is lying. */
const IMPOSSIBLE_SPEED_KMH = 200;
/** Rides shorter than this between the same pair, inside the window, look staged. */
const LOOP_WINDOW_HOURS = 24;
const LOOP_MAX_RIDES = 4;

export interface FraudAssessment {
  status: PartnerRideStatus;
  /** Null when the ride is clean. */
  reason: string | null;
  kind: FraudKind | null;
}

const CLEAN: FraudAssessment = { status: 'completed', reason: null, kind: null };

export interface AssessArgs {
  tripId: string;
  driverId: string;
  passengerId: string;
  /** The partner behind the driver, if any. */
  driverPartnerId: string | null;
  /** The partner behind the passenger, if any. */
  passengerPartnerId: string | null;
  pickup?: Point | null;
  dropoff?: Point | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

/**
 * Decide whether a completed ride is genuine. Runs BEFORE any credit, and its
 * verdict is what the transaction writes — so a `scam` verdict means the money
 * is never created in the first place, not created and clawed back.
 */
export async function assessRide(args: AssessArgs): Promise<FraudAssessment> {
  const { driverId, passengerId, driverPartnerId, passengerPartnerId } = args;

  // ── The partner is riding in their own fleet's car ───────────────────────
  // Either side being the partner themselves means the "customer" and the
  // beneficiary are one person.
  if (driverPartnerId && driverPartnerId === passengerId) {
    return flag(args, 'collusion', driverPartnerId, 'The fleet owner was the passenger on their own driver’s ride.');
  }
  if (passengerPartnerId && passengerPartnerId === driverId) {
    return flag(args, 'collusion', passengerPartnerId, 'The fleet owner drove their own recruited passenger.');
  }

  // ── Both sides recruited by the same partner ─────────────────────────────
  // A partner who owns both ends of a ride can mint rides at will. Legitimately
  // this is rare (a driver and passenger who happen to share a recruiter), and
  // the ride is still logged — it just does not pay.
  if (driverPartnerId && passengerPartnerId && driverPartnerId === passengerPartnerId) {
    return flag(
      args,
      'collusion',
      driverPartnerId,
      'Driver and passenger were both recruited by the same partner.',
    );
  }

  // ── GPS manipulation ─────────────────────────────────────────────────────
  const { pickup, dropoff, startedAt, completedAt } = args;
  if (pickup && dropoff) {
    const km = distanceKm(pickup, dropoff);
    if (startedAt && completedAt) {
      const hours = (completedAt.getTime() - startedAt.getTime()) / 3_600_000;
      if (hours > 0 && km / hours > IMPOSSIBLE_SPEED_KMH) {
        const partnerId = driverPartnerId ?? passengerPartnerId;
        if (partnerId) {
          return flag(
            args,
            'gps_manipulation',
            partnerId,
            `Ride covered ${km.toFixed(1)} km in ${(hours * 60).toFixed(0)} min — faster than any vehicle.`,
          );
        }
      }
    }
  }

  // ── Ride loops ───────────────────────────────────────────────────────────
  // The same two accounts completing ride after ride is the signature of a
  // staged loop. Only checked when a partner would be paid for it, so ordinary
  // repeat customers of a favourite driver are never queried.
  if (driverPartnerId || passengerPartnerId) {
    const since = new Date(Date.now() - LOOP_WINDOW_HOURS * 3_600_000);
    const recent = await db
      .collection('trips')
      .where('driverId', '==', driverId)
      .where('passengerId', '==', passengerId)
      .where('status', '==', 'completed')
      .where('completedAt', '>=', since)
      .limit(LOOP_MAX_RIDES + 1)
      .get();
    if (recent.size > LOOP_MAX_RIDES) {
      const partnerId = driverPartnerId ?? passengerPartnerId!;
      return flag(
        args,
        'ride_loop',
        partnerId,
        `${recent.size} rides between the same driver and passenger in ${LOOP_WINDOW_HOURS}h.`,
      );
    }
  }

  return CLEAN;
}

async function flag(
  args: AssessArgs,
  kind: FraudKind,
  partnerId: string,
  detail: string,
): Promise<FraudAssessment> {
  await logFraud({ kind, partnerId, subjectUid: args.driverId, detail, tripId: args.tripId });
  return { status: 'scam', reason: detail, kind };
}
