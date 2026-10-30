/**
 * Leaving a shared pool's car — any rider, the host included.
 * ----------------------------------------------------------------------------
 * Before this, a rider who had joined somebody's car could not leave it at all
 * (cancelTrip answered "Not your trip"), and the host cancelling cancelled every
 * other rider's ride along with theirs. The owner's rules (2026-10-29):
 *
 *   - Before a driver accepts: free. The seat goes back and the car keeps going.
 *   - After a driver accepts, before you are picked up: a fee on YOUR fare —
 *     `poolLeaveRate` (3%) while the driver is on the way, `poolLeaveArrivedRate`
 *     (5%) once they are at the pickup. The app says so before the tap.
 *   - Already picked up: not from the app. The driver lets you out
 *     (dropOffRider) and you pay your fare.
 *   - Everybody else keeps their ride. Their shares move back up the tiers —
 *     "divided among the rest" — never past riding alone (trips/poolPricing).
 *     Each is told the new number, and anyone whose share rose may then leave
 *     for free (`poolFreeLeave`) — until a driver accepts the car (lockInBid
 *     clears it): staying for the driver is their consent to it.
 *   - The host leaving hands the car to the next rider; the last rider leaving
 *     cancels it, and frees the driver.
 *
 * Only cars made by a shared pool (`sharedPoolId`) and not carrying riders
 * picked up on the way (`poolRiders`, priced by the leg-split) — those keep the
 * older rules.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import { poolPerSeatFare } from '../domain/fares';
import { getCancellationSettings, splitFeeAgainstBalance } from '../domain/cancellation';
import type { TripStatus } from '../domain/types';
import { firstNameOf, isBoarded, rosterForTrip } from './poolRoster';
import { priceCar, sharedCarRiders } from './poolPricing';

/** True for a car this module looks after — see the header. */
export function isSharedPoolCar(trip: FirebaseFirestore.DocumentData | undefined): boolean {
  return !!trip
    && trip.pool === true
    && typeof trip.sharedPoolId === 'string'
    && !(Array.isArray(trip.poolRiders) && trip.poolRiders.length > 0);
}

export interface LeaveOutcome {
  ok: true;
  fee: number;
  paidFromWallet: number;
  outstanding: number;
  /** Riders still in the car. 0 means the car was cancelled. */
  remaining: number;
}

/** Take one rider out of a shared pool's car, charging what the rules say. */
export async function leaveSharedCar(uid: string, tripId: string): Promise<LeaveOutcome> {
  const settings = await getCancellationSettings();
  const tripRef = db.doc(`trips/${tripId}`);
  const walletRef = db.doc(`wallets/${uid}`);

  const out = await db.runTransaction(async (tx) => {
    const [snap, walletSnap] = await Promise.all([tx.get(tripRef), tx.get(walletRef)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Trip not found.');
    const trip = snap.data()!;
    if (!isSharedPoolCar(trip)) {
      throw new HttpsError('failed-precondition', 'Only a shared ride from Ride sharing can be left this way.');
    }
    const members = (trip.poolMembers as string[] | undefined) ?? [trip.passengerId as string];
    if (!members.includes(uid)) throw new HttpsError('permission-denied', 'You are not on this ride.');
    const status = trip.status as TripStatus;
    if (status === 'completed' || status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'This ride has already ended.');
    }
    const roster = rosterForTrip(trip);
    const me = roster.find((r) => r.uid === uid);
    if (status === 'in_progress' && me && isBoarded(me, roster, status)) {
      throw new HttpsError(
        'failed-precondition',
        'You are already in the car. Ask your driver to let you out at a safe place — you pay your fare.',
      );
    }

    const tripFare = (trip.fare as number | null) ?? (trip.offeredFare as number);
    const myFare = (trip.poolFares as Record<string, number> | undefined)?.[uid]
      ?? poolPerSeatFare(tripFare, members.length);
    // Free before a driver accepts, and free for anyone whose share went up
    // because somebody else left — they never agreed to that number.
    const freeLeave = (trip.poolFreeLeave as Record<string, boolean> | undefined)?.[uid] === true;
    const rate = status === 'requested' || freeLeave
      ? 0
      : status === 'arrived' || status === 'in_progress'
        ? settings.poolLeaveArrivedRate
        : settings.poolLeaveRate;
    const fee = Math.round(myFare * rate);

    const remaining = members.filter((m) => m !== uid);
    const driverId = (trip.driverId as string | null) ?? null;
    const isHost = trip.passengerId === uid;
    const newHost = isHost ? remaining[0] ?? null : (trip.passengerId as string);
    // Every read before the first write — Firestore refuses a read after one.
    const driverSnap = driverId && remaining.length === 0 ? await tx.get(db.doc(`drivers/${driverId}`)) : null;
    const newHostSnap = isHost && newHost && status === 'requested' ? await tx.get(db.doc(`users/${newHost}`)) : null;

    // ── The fee, exactly as cancelTrip charges a passenger: balance first, debt for the rest ──
    let paidFromWallet = 0;
    let outstanding = 0;
    if (fee > 0) {
      const balance = (walletSnap.get('balance') as number | undefined) ?? 0;
      ({ paidFromWallet, addedToOutstanding: outstanding } = splitFeeAgainstBalance(fee, balance));
      tx.set(walletRef, {
        ...(paidFromWallet > 0 ? { balance: FieldValue.increment(-paidFromWallet) } : {}),
        ...(outstanding > 0 ? { outstanding: FieldValue.increment(outstanding) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(walletRef.collection('transactions').doc(), {
        type: 'cancellation_fee',
        amount: -paidFromWallet,
        fee,
        paidFromCredit: 0,
        outstanding,
        role: 'passenger',
        reason: 'left_shared_ride',
        tripId,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('platformLedger').doc(), {
        type: 'cancellation_fee',
        tripId,
        userId: uid,
        role: 'passenger',
        passengerId: trip.passengerId,
        driverId,
        amount: fee,
        rate,
        fare: myFare,
        collected: paidFromWallet,
        paidFromCredit: 0,
        outstanding,
        cancelledAt: status,
        leftSharedRide: true,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.doc('system/counters'), {
        cancellationFeesCharged: FieldValue.increment(fee),
        cancellationFeesCollected: FieldValue.increment(paidFromWallet),
        cancellationFeesOutstanding: FieldValue.increment(outstanding),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    tx.set(db.doc(`users/${uid}`), { activeTripId: null }, { merge: true });
    tx.delete(tripRef.collection('stops').doc(uid));

    if (remaining.length === 0) {
      // The last rider out: there is no car left to keep.
      tx.set(tripRef, {
        status: 'cancelled' as TripStatus,
        cancelledBy: uid,
        cancelledByRole: 'passenger',
        cancelledFrom: status,
        cancelReason: 'Every rider left the shared ride',
        cancellationFee: fee > 0
          ? { amount: fee, rate, role: 'passenger', paidFromWallet, paidFromCredit: 0, outstanding }
          : null,
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (driverSnap?.get('activeTripId') === tripId) {
        tx.set(driverSnap.ref, { activeTripId: null }, { merge: true });
      }
      tx.delete(db.doc(`openRequests/${tripId}`));
      return { fee, paidFromWallet, outstanding, remaining, fares: {} as Record<string, number>, before: {}, gross: 0, driverId, name: me?.firstName ?? 'A rider' };
    }

    const before = (trip.poolFares as Record<string, number> | undefined) ?? {};
    const price = priceCar(sharedCarRiders(trip, remaining));
    const solo = { ...((trip.poolSoloFares as Record<string, number> | undefined) ?? {}) };
    delete solo[uid];
    // Whoever now pays more may walk away free of charge.
    const freeLeaves = { ...((trip.poolFreeLeave as Record<string, boolean> | undefined) ?? {}) };
    delete freeLeaves[uid];
    for (const m of remaining) {
      if ((price.fares[m] ?? 0) > (before[m] ?? Infinity)) freeLeaves[m] = true;
    }
    const nextRoster = roster
      .filter((r) => r.uid !== uid)
      .map((r) => (r.uid === newHost ? { ...r, kind: 'host' as const } : r));
    const hostEntry = nextRoster.find((r) => r.uid === newHost);
    const genderKey = me?.gender === 'male' || me?.gender === 'female' ? `poolGenders.${me.gender}` : null;

    tx.update(tripRef, {
      poolMembers: remaining,
      poolRoster: nextRoster,
      seats: remaining.length,
      poolPerSeatFare: poolPerSeatFare(tripFare, remaining.length),
      poolFares: price.fares,
      poolDriverGross: price.gross,
      poolSoloFares: solo,
      poolFreeLeave: freeLeaves,
      ...(genderKey ? { [genderKey]: FieldValue.increment(-1) } : {}),
      // The car is the next rider's now: pushes, chat and the rating go to them.
      ...(isHost && hostEntry
        ? {
            passengerId: newHost,
            passengerGender: hostEntry.gender,
            bookedForOther: hostEntry.bookedForOther === true,
          }
        : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // Still in the driver feed: it has to show the car as it now is.
    if (status === 'requested') {
      tx.set(db.doc(`openRequests/${tripId}`), {
        poolRiders: remaining.length,
        seats: remaining.length,
        poolPerSeatFare: poolPerSeatFare(tripFare, remaining.length),
        poolDriverGross: price.gross,
        ...(me?.gender === 'male' || me?.gender === 'female'
          ? { poolGenders: { [me.gender]: FieldValue.increment(-1) } }
          : {}),
        ...(newHostSnap
          ? {
              passengerName: (newHostSnap.get('name') as string | undefined)
                ?? (newHostSnap.get('displayName') as string | undefined) ?? 'Passenger',
              passengerRating: (newHostSnap.get('rating') as number | undefined) ?? 5,
              passengerRatingCount: (newHostSnap.get('ratingCount') as number | undefined) ?? 0,
              passengerGender: hostEntry?.gender ?? 'unspecified',
            }
          : {}),
      }, { merge: true });
    }
    return { fee, paidFromWallet, outstanding, remaining, fares: price.fares, before, gross: price.gross, driverId, name: me?.firstName ?? 'A rider' };
  });

  // Everybody affected is told what changed — never a silent new number.
  const name = firstNameOf(out.name);
  await Promise.allSettled([
    out.fee > 0
      ? sendToUser(
        uid,
        '⚠️ Fee for leaving a shared ride',
        out.outstanding > 0
          ? `PKR ${out.fee} for leaving after a driver accepted. PKR ${out.outstanding} is now owed to Velocity Rides and is added to your next ride.`
          : `PKR ${out.fee} was taken from your wallet for leaving after a driver accepted.`,
        { tripId },
      )
      : null,
    out.driverId
      ? sendToUser(
        out.driverId,
        out.remaining.length === 0 ? '❌ Shared ride cancelled' : `👤 ${name} left your shared ride`,
        out.remaining.length === 0
          ? 'Every rider left, so the ride is cancelled. You are free for your next one.'
          : `${out.remaining.length} rider${out.remaining.length === 1 ? '' : 's'} now — you collect PKR ${out.gross} in all.`,
        { tripId },
      )
      : null,
    ...out.remaining.map((m) => {
      const now = out.fares[m];
      const was = out.before[m];
      return sendToUser(
        m,
        `👤 ${name} left your shared ride`,
        typeof now === 'number' && typeof was === 'number' && now > was
          ? `Your share is now PKR ${now} (was ${was}) — never more than riding alone. Rather not? You can leave free of charge.`
          : typeof now === 'number' && now !== was
            ? `Your fare is now PKR ${now}.`
            : 'Your ride and your fare are unchanged.',
        { tripId },
      );
    }),
  ]);
  logger.info('Left a shared car', { tripId, uid, fee: out.fee, remaining: out.remaining.length });
  return { ok: true, fee: out.fee, paidFromWallet: out.paidFromWallet, outstanding: out.outstanding, remaining: out.remaining.length };
}

/** A rider leaves the shared pool car they are in — see the header for what it costs. */
export const leaveSharedRide = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'leaveSharedRide', 5, 60);
  const parsed = z.object({ tripId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid tripId.');
  return leaveSharedCar(ctx.uid, parsed.data.tripId);
});
