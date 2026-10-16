/**
 * Clearing a closed day's commission out of the driver's balance, by itself.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * The money rule was already complete without it: a day that closes short owes
 * `rate × its cash fares`, the driver is locked, and `payCommission` takes the
 * amount out of their wallet when they tap it. What was missing is that the
 * driver had to BE there to tap. A driver with four thousand rupees sitting in
 * their balance still woke up locked, still read a push telling them to go and
 * pay, and still lost the first hour of their morning to a screen — while the
 * money to clear it was already ours to take.
 *
 * So this is the tap, made automatic. It runs in exactly two places:
 *
 *   1. when the day closes (drivers/closeDay.ts, 00:05 Karachi), so a driver
 *      who keeps a balance is never locked in the first place, and
 *   2. the moment a top-up lands (payments/credit.ts), so a driver who tops up
 *      *because* they are locked is unlocked by the top-up itself rather than
 *      by a second tap they have to discover.
 *
 * ── WHY IT IS NOT A PER-RIDE DEDUCTION ───────────────────────────────────────
 *
 * The obvious way to run a prepaid driver balance — the way inDrive runs theirs
 * — is to take the commission out of it at the end of every ride. That cannot
 * work here, and the reason is the daily target: sixteen pool rides make the
 * whole day free (domain/dailyTarget.ts). A deduction at ride four would have
 * to be given back at ride sixteen, so a per-ride debit would spend the day
 * taking money it may owe straight back, and every refund path is a new way to
 * get a driver's balance wrong.
 *
 * Nothing is deducted until the day has ended and the waiver has been decided.
 * That keeps one rule for what is owed — the one in domain/commission.ts — and
 * leaves this file with no opinion of its own about money.
 *
 * ── WHY IT NEVER PART-PAYS ───────────────────────────────────────────────────
 *
 * A balance that cannot cover the whole amount is left alone. Taking what is
 * there would empty the driver's balance and leave them locked anyway, which is
 * the worst of both: they are no better off, and the money they were saving
 * toward the debt is gone. Short means short, and the driver is told the
 * shortfall so they know exactly what to top up.
 */
import { logger } from 'firebase-functions';
import type { DocumentSnapshot } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import {
  closedCycle,
  cycleCashFare,
  getCommissionSettings,
  openCycle,
  readCycle,
  type CommissionSettings,
} from '../domain/commission';
import { applyCommissionCredit } from './commissionCredit';
import { pktDayKey, type DayKey } from '../domain/dailyTarget';

/** What one attempt at an automatic settlement did. */
export type AutoSettleOutcome =
  /** The closed days were cleared. `amountPaid` is what left the balance. */
  | { status: 'settled'; amountPaid: number; creditApplied: number; grossDue: number }
  /** No day has closed, so there was nothing to settle. */
  | { status: 'nothing_due' }
  /** There is no driver document — a broken state, not an empty cycle. */
  | { status: 'no_driver' }
  /** A day is owing and the balance cannot cover it. Nothing was taken. */
  | { status: 'short'; due: number; balance: number; shortfall: number };

/**
 * Settle every closed day out of the driver's balance, in one transaction.
 *
 * This is the single money path for a wallet-funded settlement: `payCommission`
 * calls it for the driver's own tap, and the two automatic callers above call
 * it unattended. The only difference between them is what they do with the
 * outcome — a tap turns `short` into an error the driver reads, the automatic
 * callers turn it into a push and leave the lock in place.
 *
 * `today` is passed in rather than read from the clock so a caller that already
 * quoted the driver a figure settles against the same day it quoted.
 */
export async function settleCommissionFromWallet(params: {
  driverId: string;
  today?: DayKey;
  settings?: CommissionSettings;
}): Promise<AutoSettleOutcome> {
  const { driverId } = params;
  const settings = params.settings ?? (await getCommissionSettings());
  const today = params.today ?? pktDayKey();
  const { rate } = settings;

  const driverRef = db.doc(`drivers/${driverId}`);
  const walletRef = db.doc(`wallets/${driverId}`);

  return db.runTransaction(async (tx): Promise<AutoSettleOutcome> => {
    const [snap, walletSnap]: [DocumentSnapshot, DocumentSnapshot] = await Promise.all([
      tx.get(driverRef),
      tx.get(walletRef),
    ]);
    if (!snap.exists) return { status: 'no_driver' };

    const cycleGrossFare: number = snap.get('cycleGrossFare') ?? 0;
    const cycle = readCycle(snap);
    const open = openCycle(cycle, today);
    const closed = closedCycle(cycle, today);

    // Nothing has closed yet, so nothing is payable. An all-online closed day
    // IS allowed through: it owes nothing, and letting it settle for zero is
    // how the driver's "fares this cycle" figure gets tidied up without
    // waiting for their next ride to roll the day.
    if (closed.gross <= 0 && closed.cash <= 0) return { status: 'nothing_due' };

    const cashFare = cycleCashFare(snap);

    // The driver's bonus pays first and is spent here; the balance only has to
    // cover what is left, which is often nothing.
    const breakdown = applyCommissionCredit({
      tx,
      driverId,
      driverSnap: snap,
      settings,
      today,
      source: 'wallet',
    });
    const due = breakdown.due;

    // Read the balance before spending any of it. A shortfall abandons the
    // whole transaction — including the credit spend above, which has not been
    // committed — so a driver who is short keeps their bonus intact.
    const balance: number = walletSnap.get('balance') ?? 0;
    if (due > 0 && balance < due) {
      return { status: 'short', due, balance, shortfall: due - balance };
    }

    if (breakdown.creditApplied > 0) {
      tx.set(db.collection('platformLedger').doc(), {
        type: 'ride_commission',
        source: 'daily_target_credit',
        driverId,
        amount: breakdown.creditApplied,
        paidFromCredit: breakdown.creditApplied,
        cycleGrossFare,
        cycleCashFare: cashFare,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    if (due > 0) {
      // Debit the driver's balance and ledger both sides of the movement.
      //
      // `earned` is deliberately untouched. The ring-fence is a `min` over the
      // balance (domain/walletFunds.ts), so a balance that falls below `earned`
      // narrows what is withdrawable on its own — there is no pot here to
      // remember to decrement, and writing one would be a second source of
      // truth for the same number.
      tx.set(
        walletRef,
        { balance: FieldValue.increment(-due), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      tx.set(walletRef.collection('transactions').doc(), {
        type: 'commission_payment',
        amount: -due,
        cycleGrossFare,
        cycleCashFare: cashFare,
        settledCashFare: breakdown.settleableCash,
        rate,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('platformLedger').doc(), {
        type: 'ride_commission',
        source: 'cash_cycle',
        driverId,
        amount: due,
        cycleGrossFare,
        cycleCashFare: cashFare,
        settledCashFare: breakdown.settleableCash,
        rate,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(
        db.doc('system/counters'),
        {
          cashCommissionCollected: FieldValue.increment(due),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    // The closed days are settled, so they come off the cycle. The day still
    // running stays: it is not payable yet, and it may yet cost nothing.
    tx.set(
      driverRef,
      {
        cycleGrossFare: open.gross,
        cycleCashFare: open.cash,
        cycleDay: today,
        cycleGrossToday: open.gross,
        cycleCashToday: open.cash,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // Log the payment in a sub-collection for audit.
    tx.set(driverRef.collection('commissionPayments').doc(), {
      amount: due,
      paidFromCredit: breakdown.creditApplied,
      grossDue: breakdown.grossDue,
      cycleGrossFare,
      cycleCashFare: cashFare,
      settledCashFare: breakdown.settleableCash,
      settledGrossFare: breakdown.settleableGross,
      rate,
      paidAt: FieldValue.serverTimestamp(),
    });

    return {
      status: 'settled',
      amountPaid: due,
      creditApplied: breakdown.creditApplied,
      grossDue: breakdown.grossDue,
    };
  });
}

/**
 * Try to settle, and never throw.
 *
 * The two automatic callers run inside a nightly job and a payment callback.
 * Neither may fail because one driver's settlement hit a contended document:
 * the nightly job still has a fleet to get through, and the payment callback
 * must still return success to the gateway — the money reached the wallet, and
 * a settlement that did not happen is simply a driver who stays locked until
 * they tap, which is where they were before this file existed.
 */
export async function trySettleCommissionFromWallet(params: {
  driverId: string;
  today?: DayKey;
  settings?: CommissionSettings;
  /** Where the attempt came from, for the log line. */
  trigger: 'day_close' | 'topup';
}): Promise<AutoSettleOutcome | null> {
  try {
    const outcome = await settleCommissionFromWallet(params);
    if (outcome.status === 'settled' && outcome.amountPaid > 0) {
      logger.info('Commission auto-settled from balance', {
        driverId: params.driverId,
        trigger: params.trigger,
        amountPaid: outcome.amountPaid,
      });
    }
    return outcome;
  } catch (e) {
    logger.warn('Auto-settle failed; driver keeps the manual path', {
      driverId: params.driverId,
      trigger: params.trigger,
      error: (e as Error).message,
    });
    return null;
  }
}
