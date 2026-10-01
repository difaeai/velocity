/**
 * Spending the driver's commission credit, and the admin lever that adjusts it.
 *
 * Credit is granted by the daily ride target (drivers/dailyTarget.ts) and spent
 * here — in the one moment a commission cycle is settled. There are three ways
 * a cycle settles (bank transfer verified by AI or an admin, a wallet debit, and
 * the automatic clear when nothing is owed) and all three go through
 * `applyCommissionCredit`, so the credit can only ever be spent once and the
 * books always show the same two numbers for it.
 *
 * THE TWO LEDGER ROWS. A settlement writes revenue and, separately, the
 * incentive that paid for part of it:
 *
 *   platformLedger  `ride_commission`   grossDue     — revenue earned
 *   platformLedger  `driver_incentive`  creditApplied — what the bonus cost us
 *
 * Netting them into one row would have been less code and would have quietly
 * hidden the entire cost of the daily target programme inside a smaller revenue
 * number. The point of running an incentive is being able to see what it costs.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import type { DocumentSnapshot, Transaction } from 'firebase-admin/firestore';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAdmin } from '../lib/guards';
import { sendToUser } from '../lib/fcm';
import {
  commissionBreakdown,
  getCommissionSettings,
  type CommissionBreakdown,
  type CommissionSettings,
} from '../domain/commission';

/**
 * Spend as much credit as this cycle's commission can absorb.
 *
 * Writes the driver's credit fields, the driver-facing credit ledger row and
 * the platform incentive expense. Returns the full breakdown so the caller can
 * ledger the revenue side with the right gross figure and tell the driver what
 * they actually still owe.
 *
 * Idempotent per transaction, not per cycle: it must be called exactly once per
 * settlement, which is why each caller does it in the same transaction that
 * resets `cycleCashFare` to zero. A retry of that transaction re-reads a
 * driver snapshot with the credit already gone.
 */
export function applyCommissionCredit(params: {
  tx: Transaction;
  driverId: string;
  /** The driver document as read in this transaction. */
  driverSnap: DocumentSnapshot;
  settings: CommissionSettings;
  /** How the cycle was settled, for the ledger rows. */
  source: SettlementSource;
  /** The settlement document or trip this settlement belongs to, if any. */
  ref?: string | null;
}): CommissionBreakdown {
  const { tx, driverId, driverSnap, settings, source, ref } = params;
  const breakdown = commissionBreakdown(driverSnap, settings);
  ledgerCreditSpend({ tx, driverId, source, ref, ...breakdown });
  return breakdown;
}

export type SettlementSource = 'manual_bank' | 'wallet' | 'auto_clear';

/**
 * The write half of spending credit, taking the figures explicitly.
 *
 * `applyCommissionCredit` derives them from the driver snapshot, which is right
 * for a settlement that happens on its own. The trip-completion path cannot:
 * the ride being settled has just changed both the cycle's cash fare and the
 * credit balance, and neither change is in the snapshot it read. So it computes
 * the numbers itself and calls this.
 */
export function ledgerCreditSpend(params: {
  tx: Transaction;
  driverId: string;
  source: SettlementSource;
  ref?: string | null;
  /** Commission earned on the cycle. */
  grossDue: number;
  /** The part of it the credit paid. */
  creditApplied: number;
  /** The part of it the driver paid. */
  due: number;
}): void {
  const { tx, driverId, source, ref, grossDue, creditApplied, due } = params;
  if (creditApplied <= 0) return;

  const driverRef = db.doc(`drivers/${driverId}`);
  const breakdown = { grossDue, creditApplied, due };
  tx.set(
    driverRef,
    {
      commissionCredit: FieldValue.increment(-breakdown.creditApplied),
      commissionCreditUsed: FieldValue.increment(breakdown.creditApplied),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  tx.set(driverRef.collection('commissionCredits').doc(), {
    type: 'spent',
    source,
    ref: ref ?? null,
    // Negative, so the driver's credit history reads like a statement.
    amount: -breakdown.creditApplied,
    grossDue: breakdown.grossDue,
    paidByDriver: breakdown.due,
    createdAt: FieldValue.serverTimestamp(),
  });
  tx.set(db.collection('platformLedger').doc(), {
    type: 'driver_incentive',
    source: 'daily_target_credit',
    settlementSource: source,
    driverId,
    ref: ref ?? null,
    // An expense, recorded positive with an explicit type — see the file header.
    amount: breakdown.creditApplied,
    grossCommission: breakdown.grossDue,
    createdAt: FieldValue.serverTimestamp(),
  });
  tx.set(
    db.doc('system/counters'),
    {
      commissionCreditSpent: FieldValue.increment(breakdown.creditApplied),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

const adjustSchema = z.object({
  driverId: docId,
  /** PKR. Positive grants credit, negative claws it back. */
  amount: z.number().int().min(-500_000).max(500_000).refine((v) => v !== 0, 'Amount cannot be zero.'),
  reason: z.string().min(3).max(300),
  notify: z.boolean().optional(),
});

/**
 * Admin grants or removes commission credit by hand.
 *
 * This is the manual counterpart to the gateway top-up that does not exist yet:
 * a driver who pays their commission in cash at the office, or who is owed a
 * target bonus a bug lost, is made whole here. It is also the only way to take
 * credit back off a driver who farmed it, which is why the reason is required
 * and every adjustment is audit-logged with the admin's uid.
 *
 * Credit is floored at zero rather than allowed to go negative: a negative
 * balance would be a debt in a field the whole commission engine reads as
 * "money available", and `commissionBreakdown` would stop making sense.
 */
export const adminAdjustCommissionCredit = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = adjustSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Provide a driver, an amount and a reason.');
  const { driverId, amount, reason, notify } = parsed.data;

  const driverRef = db.doc(`drivers/${driverId}`);
  const applied = await db.runTransaction(async (tx) => {
    const snap = await tx.get(driverRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Driver record not found.');
    const current = Math.max(0, Math.round((snap.get('commissionCredit') as number | undefined) ?? 0));
    // A clawback larger than the balance takes what is there and stops.
    const delta = amount > 0 ? amount : -Math.min(current, -amount);
    if (delta === 0) return 0;

    tx.set(
      driverRef,
      {
        commissionCredit: Math.max(0, current + delta),
        ...(delta > 0
          ? { commissionCreditEarned: FieldValue.increment(delta) }
          : { commissionCreditUsed: FieldValue.increment(-delta) }),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(driverRef.collection('commissionCredits').doc(), {
      type: delta > 0 ? 'admin_grant' : 'admin_clawback',
      amount: delta,
      reason,
      by: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('auditLogs').doc(), {
      action: delta > 0 ? 'commissionCredit.granted' : 'commissionCredit.clawback',
      driverId,
      amount: delta,
      reason,
      by: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return delta;
  });

  if (applied !== 0 && notify !== false) {
    await sendToUser(
      driverId,
      applied > 0 ? '🎁 Commission credit added' : 'ℹ️ Commission credit adjusted',
      applied > 0
        ? `PKR ${applied.toLocaleString()} credit was added to your account. It pays your commission automatically.`
        : `PKR ${Math.abs(applied).toLocaleString()} credit was removed from your account. Reason: ${reason}`,
    );
  }

  logger.info('Commission credit adjusted', { driverId, applied, by: admin.uid });
  return { ok: true, applied };
});

const targetsSchema = z.object({ driverId: docId, days: z.number().int().min(1).max(60).optional() });

/**
 * Admin reads a driver's recent target days and credit statement.
 *
 * The security rules would let an admin read both subcollections directly, but
 * the dashboard needs them together with the live settings and the derived
 * "what do they owe" figure, and deriving that on the client is how the admin
 * panel and the app end up disagreeing about somebody's money.
 */
export const adminGetDriverCommission = onCall(async (req) => {
  requireAdmin(req);
  const parsed = targetsSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a driverId.');
  const { driverId, days } = parsed.data;

  const settings = await getCommissionSettings();
  const driverRef = db.doc(`drivers/${driverId}`);
  const [driverSnap, targetsSnap, creditsSnap] = await Promise.all([
    driverRef.get(),
    driverRef.collection('dailyTargets').orderBy('day', 'desc').limit(days ?? 14).get(),
    driverRef.collection('commissionCredits').orderBy('createdAt', 'desc').limit(25).get(),
  ]);
  if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver record not found.');

  const breakdown = commissionBreakdown(driverSnap, settings);
  return {
    settings,
    driver: {
      driverId,
      fullName: (driverSnap.get('fullName') as string | undefined) ?? null,
      phone: (driverSnap.get('phone') as string | undefined) ?? null,
      cycleGrossFare: (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0,
      cycleCashFare: (driverSnap.get('cycleCashFare') as number | undefined) ?? 0,
      commissionCredit: (driverSnap.get('commissionCredit') as number | undefined) ?? 0,
      commissionCreditEarned: (driverSnap.get('commissionCreditEarned') as number | undefined) ?? 0,
      commissionCreditUsed: (driverSnap.get('commissionCreditUsed') as number | undefined) ?? 0,
      ...breakdown,
    },
    days: targetsSnap.docs.map((d) => ({
      day: d.id,
      rides: (d.get('rides') as number | undefined) ?? 0,
      qualifyingRides: (d.get('qualifyingRides') as number | undefined) ?? 0,
      grossFare: (d.get('grossFare') as number | undefined) ?? 0,
      cashFare: (d.get('cashFare') as number | undefined) ?? 0,
      riders: ((d.get('riderIds') as string[] | undefined) ?? []).length,
      bonusGranted: (d.get('bonusGranted') as number | undefined) ?? 0,
      waiverGranted: (d.get('waiverGranted') as number | undefined) ?? 0,
      met: d.get('met') === true,
    })),
    credits: creditsSnap.docs.map((d) => ({
      id: d.id,
      type: (d.get('type') as string | undefined) ?? 'unknown',
      amount: (d.get('amount') as number | undefined) ?? 0,
      day: (d.get('day') as string | undefined) ?? null,
      reason: (d.get('reason') as string | undefined) ?? null,
      createdAt: (d.get('createdAt') as { seconds: number } | undefined) ?? null,
    })),
  };
});
