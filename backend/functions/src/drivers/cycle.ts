/**
 * Folding one completed ride into the driver's commission cycle.
 *
 * Both settlement paths come through here — `completeTrip` for ordinary,
 * booked-pool and en-route rides, `completePoolRide` for driver-offered pools —
 * so the day arithmetic has exactly one implementation. It used to be written
 * out twice, and the two copies had already drifted: only one of them cleared a
 * cycle the bonus had fully covered.
 *
 * TWO THINGS HAPPEN, in this order:
 *
 * 1. **The day rolls.** If the cycle still holds money from a day that has
 *    ended, that money is now payable (domain/commission.ts explains how the
 *    split is stored). If the driver's bonus covers all of it, the closed days
 *    are cleared right here and ledgered as revenue paid by the incentive — the
 *    same thing a settlement would do, minus asking the driver for money they
 *    do not owe. If it does not cover it, the debt is left alone: the driver is
 *    locked and will settle it by transfer.
 *
 * 2. **The ride is added**, to the totals and to today's portion of them.
 *
 * WHAT THIS DOES NOT WRITE. It never writes the driver document. It returns the
 * fields and lets the caller fold them into the single `tx.set` it already makes
 * on `drivers/{uid}`, so there is exactly one writer of the driver's money
 * fields per settlement.
 *
 * WHY THE RIDE'S OWN BONUS IS NOT SPENT HERE. A ride that completed today's
 * target credits the commission today's earlier rides accrued, and that credit
 * exists to cancel TODAY's cash — which is still sitting in the open portion.
 * Spending it on a closed day would make yesterday free as well, out of a waiver
 * earned for today. So the auto-clear only ever uses the bonus the driver
 * already had; today's own waiver clears today's cash at tomorrow's roll.
 */
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import {
  closedCycle,
  commissionCredit,
  openCycle,
  readCycle,
  type CommissionSettings,
} from '../domain/commission';
import type { DayKey } from '../domain/dailyTarget';
import { ledgerCreditSpend } from './commissionCredit';

export interface CycleUpdate {
  /** Merge into the single `tx.set(drivers/{uid}, …)` the caller already makes. */
  fields: Record<string, unknown>;
  /** Commission still owed from days that have ended. 0 = the driver is clear. */
  due: number;
  /** Commission earned on those days, before the bonus — the revenue figure. */
  grossDue: number;
  /** How much of `grossDue` the driver's bonus covered. */
  creditApplied: number;
  /** The driver must settle before taking new work. */
  locked: boolean;
  /** The closed days were fully covered and have been cleared here. */
  autoCleared: boolean;
}

export function applyRideToCycle(params: {
  tx: Transaction;
  driverId: string;
  /** The driver document as read in this transaction. */
  driverSnap: DocumentSnapshot;
  settings: CommissionSettings;
  /** The Pakistan day this ride belongs to, resolved before the transaction. */
  today: DayKey;
  /** This ride's whole fare, cash and online together. */
  grossFare: number;
  /** The part of it commission is due on — 0 once today's target is met. */
  commissionableCashFare: number;
  /** The ride this settlement belongs to, for the ledger rows. */
  rideId: string;
}): CycleUpdate {
  const { tx, driverId, driverSnap, settings, today, grossFare, commissionableCashFare, rideId } =
    params;

  const cycle = readCycle(driverSnap);
  const open = openCycle(cycle, today);
  const closed = closedCycle(cycle, today);

  // What the days that have ended owe, and who is paying it.
  const grossDue = Math.round(closed.cash * settings.rate);
  const credit = commissionCredit(driverSnap);
  const creditApplied = Math.min(credit, grossDue);
  const due = grossDue - creditApplied;

  // A closed day the driver does not have to find money for clears itself
  // rather than locking them: either it was earned online (commission already
  // taken) or their bonus covered it. This is the whole point of the bonus —
  // "it comes off the bonus, I don't pay separately".
  const autoCleared = (closed.gross > 0 || closed.cash > 0) && due === 0;
  if (autoCleared) {
    ledgerCreditSpend({
      tx,
      driverId,
      source: 'auto_clear',
      ref: rideId,
      grossDue,
      creditApplied,
      due: 0,
    });
    if (grossDue > 0) {
      // Revenue really was earned on those days; the bonus is what paid it.
      tx.set(db.collection('platformLedger').doc(), {
        type: 'ride_commission',
        source: 'daily_target_credit',
        driverId,
        tripId: rideId,
        amount: grossDue,
        paidFromCredit: creditApplied,
        cycleGrossFare: closed.gross,
        cycleCashFare: closed.cash,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`drivers/${driverId}`).collection('commissionPayments').doc(), {
        amount: grossDue,
        paidFromCredit: creditApplied,
        grossDue,
        rate: settings.rate,
        cycleGrossFare: closed.gross,
        cycleCashFare: closed.cash,
        auto: true,
        paidAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // Everything the cycle carries forward. A cleared cycle keeps only the open
  // day; an unpaid one keeps the debt as well, so the lock survives the ride.
  const baseGross = autoCleared ? open.gross : cycle.gross;
  const baseCash = autoCleared ? open.cash : cycle.cash;

  return {
    fields: {
      cycleGrossFare: baseGross + grossFare,
      cycleCashFare: baseCash + commissionableCashFare,
      cycleDay: today,
      cycleGrossToday: open.gross + grossFare,
      cycleCashToday: open.cash + commissionableCashFare,
    },
    due,
    grossDue,
    creditApplied,
    locked: due > 0,
    autoCleared,
  };
}
