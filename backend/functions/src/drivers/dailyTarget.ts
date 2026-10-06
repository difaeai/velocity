/**
 * Recording one completed ride against the driver's daily target.
 *
 * This runs inside the settlement transaction of every path a ride can finish
 * on — `completeTrip` for ordinary, booked-pool and en-route rides,
 * `completePoolRide` for the driver-offered pools — so the target counts the
 * same ride once, whichever subsystem carried it, and can never be credited
 * twice by a double-tapped "end ride".
 *
 * ONLY POOL RIDES COUNT, while the admin leaves `dailyTargetPoolOnly` on. A solo
 * ride is still recorded on the day (and still owes its commission), it just
 * does not move the counter. `isPoolRide` is the caller's answer to that, taken
 * from the same `pool` flag the rest of the codebase uses.
 *
 * TWO RULES AT ONCE. Crossing the target does two separate things:
 *
 *   the waiver   the day's rides stop being commissionable. Rides from the
 *                moment of crossing onward simply never enter `cycleCashFare`.
 *                Rides from EARLIER the same day are already in it, so instead
 *                of reaching back into the cycle counters they are credited
 *                the commission they accrued. Same money, and it leaves the
 *                cycle arithmetic alone — which matters, because the day-roll
 *                in ./cycle.ts reads those fields and a retroactive subtraction
 *                is the kind of thing one of the two would eventually forget.
 *   the bonus    a flat PKR grant, once per day. Ships at 0 — the waiver is the
 *                reward now — and survives only as an admin lever.
 *
 * The retroactive part is capped at what is genuinely still owed
 * (`min(today's cash, the cycle's cash)`). A driver who settled at noon and
 * hits the target at six has already paid the morning's commission, and
 * crediting it again would be a gift, not a waiver.
 *
 * GRANTED ONCE. `granted` on the day document is the idempotency guard. It used
 * to be `bonusGranted > 0`, which stopped working the moment the bonus went to
 * zero: the waiver would have been re-granted on every ride after the sixteenth.
 *
 * WHAT THIS DOES NOT WRITE. It never touches the driver document. It returns
 * the credit delta and lets the caller fold it into the single `tx.set` the
 * caller already makes on `drivers/{uid}`, so there is exactly one writer of
 * the driver's money fields per settlement.
 */
import { logger } from 'firebase-functions';
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import { sendToUser } from '../lib/fcm';
import { cycleCashFare, type CommissionSettings } from '../domain/commission';
import {
  MAX_TRACKED_RIDERS,
  dailyTargetProgress,
  emptyDay,
  pktDayKey,
  rideQualifies,
  type DailyTargetDay,
  type DailyTargetProgress,
  type DayKey,
} from '../domain/dailyTarget';

/** `drivers/{uid}/dailyTargets/{YYYY-MM-DD}` — one document per driver-day. */
export function dailyTargetRef(driverId: string, day: DayKey): DocumentReference {
  return db.doc(`drivers/${driverId}/dailyTargets/${day}`);
}

/** Read a day document into the domain shape, tolerating a missing one. */
export function readDailyTargetDay(
  snap: DocumentSnapshot | undefined,
  day: DayKey,
): DailyTargetDay {
  if (!snap?.exists) return emptyDay(day);
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const ids = snap.get('riderIds');
  const bonusGranted = num(snap.get('bonusGranted'));
  return {
    day,
    rides: num(snap.get('rides')),
    poolRides: num(snap.get('poolRides')),
    qualifyingRides: num(snap.get('qualifyingRides')),
    grossFare: num(snap.get('grossFare')),
    cashFare: num(snap.get('cashFare')),
    riderIds: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
    // Days written before `granted` existed are recognised by their bonus.
    granted: snap.get('granted') === true || bonusGranted > 0,
    bonusGranted,
    waiverGranted: num(snap.get('waiverGranted')),
  };
}

export interface RecordRideInput {
  tx: Transaction;
  driverId: string;
  /** The driver document as read in this transaction — for the cycle figures. */
  driverSnap: DocumentSnapshot;
  /** The day document as read in this transaction. Must be today's. */
  daySnap: DocumentSnapshot | undefined;
  day: DayKey;
  settings: CommissionSettings;
  /** Everything the ride grossed, cash and online together. */
  grossFare: number;
  /** The part of it collected in cash — the only part commission is due on. */
  cashFare: number;
  /** Everyone carried. Pool rides pass every member, so a full car counts once
   *  as a ride but as several distinct passengers. */
  riderIds: string[];
  /** Was this a pool / sharing ride? The target only counts those. */
  isPoolRide: boolean;
  /** For the credit ledger, so a grant can be traced to the ride that earned it. */
  rideId: string;
}

export interface RecordRideResult {
  /** Where the day stands now, for the push and the response payload. */
  progress: DailyTargetProgress;
  /**
   * THIS ride is the one that completed the target. True exactly once a day,
   * which is what the "today is commission-free" push keys off.
   */
  granted: boolean;
  /** PKR of cash bonus granted by THIS ride. 0 unless an admin set a bonus. */
  bonusGranted: number;
  /** PKR credited for commission already accrued today, on the crossing ride. */
  waiverGranted: number;
  /** Total credit this ride added. The caller adds it to `commissionCredit`. */
  creditDelta: number;
  /**
   * The cash fare that should enter `cycleCashFare`. Zero once the day's
   * commission is waived — this is the forward half of the waiver.
   */
  commissionableCashFare: number;
  /**
   * This ride counted and left exactly one to go. Worth a push; set only on a
   * qualifying ride so a string of below-floor rides cannot send it twice.
   */
  nudge: boolean;
}

/**
 * Fold one completed ride into today's target and return what it changed.
 *
 * Safe to call when the feature is switched off: the day document is still
 * kept up to date (so an admin turning the target on mid-day does not see
 * every driver at zero rides), but nothing is granted and nothing is waived.
 */
export function recordRideOnDailyTarget(input: RecordRideInput): RecordRideResult {
  const {
    tx, driverId, driverSnap, daySnap, day, settings,
    grossFare, cashFare, riderIds, isPoolRide, rideId,
  } = input;

  const before = readDailyTargetDay(daySnap, day);
  const qualifies =
    settings.dailyTargetEnabled && rideQualifies(grossFare, settings, isPoolRide);

  const newRiderIds = [...before.riderIds];
  for (const uid of riderIds) {
    if (uid && !newRiderIds.includes(uid) && newRiderIds.length < MAX_TRACKED_RIDERS) {
      newRiderIds.push(uid);
    }
  }

  const after: DailyTargetDay = {
    day,
    rides: before.rides + 1,
    poolRides: before.poolRides + (isPoolRide ? 1 : 0),
    qualifyingRides: before.qualifyingRides + (qualifies ? 1 : 0),
    grossFare: before.grossFare + grossFare,
    cashFare: before.cashFare + cashFare,
    riderIds: newRiderIds,
    granted: before.granted,
    bonusGranted: before.bonusGranted,
    waiverGranted: before.waiverGranted,
  };

  const progress = dailyTargetProgress(after, settings);

  // Granted exactly once per day — on the ride that completes every
  // requirement. `before.granted` is the idempotency guard.
  let bonusGranted = 0;
  let waiverGranted = 0;
  const granting = settings.dailyTargetEnabled && progress.met && !before.granted;
  if (granting) {
    bonusGranted = Math.round(settings.dailyTargetBonus);

    if (settings.dailyTargetWaivesCommission) {
      // Earlier rides today are already inside the cycle. Credit what they
      // accrued — but never more than the cycle still holds, or a driver who
      // settled earlier today would be paid for commission they already cleared.
      const stillOwed = Math.min(before.cashFare, cycleCashFare(driverSnap));
      waiverGranted = Math.max(0, Math.round(stillOwed * settings.rate));
    }
  }

  const creditDelta = bonusGranted + waiverGranted;

  tx.set(
    dailyTargetRef(driverId, day),
    {
      day,
      rides: after.rides,
      poolRides: after.poolRides,
      qualifyingRides: after.qualifyingRides,
      grossFare: after.grossFare,
      cashFare: after.cashFare,
      riderIds: after.riderIds,
      granted: before.granted || granting,
      bonusGranted: before.bonusGranted + bonusGranted,
      waiverGranted: before.waiverGranted + waiverGranted,
      target: progress.target,
      poolOnly: progress.poolOnly,
      bonus: progress.bonus,
      met: progress.met,
      commissionWaived: progress.commissionWaived,
      ...(granting ? { metAt: FieldValue.serverTimestamp() } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (creditDelta > 0) {
    // The driver-facing credit ledger. Deliberately one row per grant with the
    // reason on it: "where did my 2,340 come from" has to be answerable from
    // the app without an admin reading Firestore.
    tx.set(db.collection(`drivers/${driverId}/commissionCredits`).doc(), {
      type: 'daily_target',
      day,
      rideId,
      amount: creditDelta,
      bonus: bonusGranted,
      waiver: waiverGranted,
      target: progress.target,
      rides: after.qualifyingRides,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  if (granting) {
    tx.set(
      db.doc('system/counters'),
      {
        ...(creditDelta > 0 ? { commissionCreditGranted: FieldValue.increment(creditDelta) } : {}),
        dailyTargetsMet: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  return {
    progress,
    granted: granting,
    bonusGranted,
    waiverGranted,
    creditDelta,
    // Forward half of the waiver: once today is waived, today's cash stops
    // entering the cycle at all.
    commissionableCashFare: progress.commissionWaived ? 0 : cashFare,
    nudge: settings.dailyTargetEnabled && qualifies && !progress.met && progress.ridesToGo === 1,
  };
}

/** Today, in the driver's own timezone. Computed once per invocation. */
export function todayKey(): DayKey {
  return pktDayKey();
}

/** What a completed ride carries back about the target, for the push below. */
export interface DailyTargetOutcome {
  dailyTarget: DailyTargetProgress;
  dailyTargetBonus: number;
  dailyTargetCredit: number;
  dailyTargetNudge: boolean;
  /** True on the ride that completed the target. */
  dailyTargetMet?: boolean;
}

/**
 * Tell the driver where the target stands, right after a ride settles.
 *
 * Two messages and no others. "One more ride" is the only one that changes
 * behaviour, and "today is free" is the only one that has to arrive — a reward
 * the driver has to go looking for is not an incentive. Everything in between
 * is on the progress card they can already see.
 *
 * Never throws: a push that fails must not roll back a settled ride.
 */
export async function notifyDailyTarget(
  driverId: string,
  outcome: DailyTargetOutcome,
  rideId?: string,
): Promise<void> {
  const data = rideId ? { tripId: rideId } : undefined;
  const rides = outcome.dailyTarget.poolOnly ? 'pool rides' : 'rides';
  try {
    if (outcome.dailyTargetMet || outcome.dailyTargetBonus > 0) {
      const waived = outcome.dailyTargetCredit - outcome.dailyTargetBonus;
      const bonusLine =
        outcome.dailyTargetBonus > 0
          ? ` Your PKR ${outcome.dailyTargetBonus.toLocaleString()} bonus is unlocked.`
          : '';
      const waivedLine =
        waived > 0
          ? ` PKR ${waived.toLocaleString()} of commission you had already run up today is cancelled.`
          : '';
      await sendToUser(
        driverId,
        '🎯 Daily target complete!',
        `${outcome.dailyTarget.target} ${rides} done — today's rides cost you no commission.` +
          bonusLine +
          waivedLine,
        data,
      );
      return;
    }
    if (outcome.dailyTargetNudge) {
      await sendToUser(
        driverId,
        '🔥 One more ride!',
        outcome.dailyTarget.bonus > 0
          ? `One more pool ride makes today commission-free and unlocks your PKR ${outcome.dailyTarget.bonus.toLocaleString()} bonus.`
          : `One more pool ride today and you pay no commission on the whole day.`,
        data,
      );
    }
  } catch (e) {
    logger.warn('daily target push failed', { driverId, error: (e as Error).message });
  }
}
