/**
 * Manual commission settlement — bank transfer + AI-verified screenshot.
 *
 * With wallet top-ups switched off for launch, a locked driver settles their
 * commission cycle by transferring the amount due to Velocity's account and
 * uploading a screenshot of the payment. A Claude vision model checks the
 * screenshot; a clearly-genuine, correct-amount, correct-recipient result
 * unlocks the driver automatically. Anything the model is unsure about goes to
 * an admin review queue, and an obvious fake is rejected so the driver can
 * re-upload. If no AI key is configured, every settlement goes to admin review.
 *
 * The money side (reset the cycle, ledger the platform revenue, unlock) is
 * shared by the AI-approve and admin-approve paths via applyManualSettlement,
 * so both do exactly the same thing.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAdmin, requireRole } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import {
  cycleCashFare,
  getCommissionSettings,
  isCommissionLocked,
  commissionBreakdown,
  openCycle,
  readCycle,
} from '../domain/commission';
import { applyCommissionCredit } from './commissionCredit';
import { todayKey } from './dailyTarget';
import {
  decideProofOutcome,
  proofAIConfigured,
  verifyPaymentProof,
  type SettlementStatus,
  type VelocityAccounts,
} from '../lib/paymentProofAI';
import { applyCancellationFeeSettlement } from '../payments/cancellationFees';

export type { SettlementStatus };

/**
 * Atomically apply an approved settlement: settle the days that had closed
 * owing commission from the bank transfer the driver made, ledger it as
 * realized platform revenue, and unlock the driver. Idempotent on an
 * already-approved settlement.
 *
 * WHAT IT CLEARS. The closed days only — the day the driver is standing in
 * keeps its fares, because they are not payable yet and the driver may still
 * reach the target and owe nothing on them (domain/commission.ts). Settling no
 * longer means zeroing the cycle; it means removing the part of it that had
 * become due.
 */
async function applyManualSettlement(params: {
  driverId: string;
  settlementId: string;
  amountDue: number;
  method: string | null;
  verifiedBy: 'ai' | string; // 'ai' or an admin uid
}): Promise<void> {
  const { driverId, settlementId, amountDue, method, verifiedBy } = params;
  const driverRef = db.doc(`drivers/${driverId}`);
  const settlementRef = db.doc(`commissionSettlements/${settlementId}`);

  const settings = await getCommissionSettings();
  // One day key for the whole settlement. The AI path approves seconds after
  // the driver uploads, so this is the day they were quoted for; an admin
  // review that sits overnight settles against the day it is approved on.
  const today = todayKey();

  await db.runTransaction(async (tx) => {
    const [driverSnap, settlementSnap] = await Promise.all([tx.get(driverRef), tx.get(settlementRef)]);
    if (!settlementSnap.exists) throw new HttpsError('not-found', 'Settlement not found.');
    if (settlementSnap.get('status') === 'approved') return; // already settled

    const cycleGrossFare = (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0;
    const cashFare = cycleCashFare(driverSnap);
    const open = openCycle(readCycle(driverSnap), today);

    // Any bonus the driver has pays its part of what is due and is spent here,
    // so the debt is fully discharged by the transfer plus the bonus rather
    // than leaving a remainder nobody owes.
    const breakdown = applyCommissionCredit({
      tx,
      driverId,
      driverSnap,
      settings,
      today,
      source: 'manual_bank',
      ref: settlementId,
    });

    // Ledger the realized commission (money already reached Velocity's bank).
    tx.set(db.collection('platformLedger').doc(), {
      type: 'ride_commission',
      source: 'manual_bank',
      driverId,
      settlementId,
      amount: amountDue,
      paidFromCredit: breakdown.creditApplied,
      grossDue: breakdown.grossDue,
      method: method ?? null,
      verifiedBy,
      cycleGrossFare,
      cycleCashFare: cashFare,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      db.doc('system/counters'),
      {
        manualCommissionCollected: FieldValue.increment(amountDue),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Drop the settled days off the cycle, keep the open one → driver unlocked.
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
    tx.set(driverRef.collection('commissionPayments').doc(), {
      amount: amountDue,
      paidFromCredit: breakdown.creditApplied,
      grossDue: breakdown.grossDue,
      source: 'manual_bank',
      settlementId,
      rate: settings.rate,
      settledCashFare: breakdown.settleableCash,
      settledGrossFare: breakdown.settleableGross,
      cycleGrossFare,
      cycleCashFare: cashFare,
      verifiedBy,
      paidAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      settlementRef,
      {
        status: 'approved' as SettlementStatus,
        verifiedBy,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  logger.info('Manual commission settled', { driverId, settlementId, amountDue, verifiedBy });
}

const submitSchema = z.object({
  proofPath: z.string().min(1).max(512),
  method: z.enum(['easypaisa', 'jazzcash', 'bank']).optional(),
});

/**
 * Driver submits a payment screenshot to clear the commission a closed day left
 * them owing. Verifies it with AI and either auto-unlocks, rejects, or queues
 * for admin.
 *
 * The verifier reads ANTHROPIC_API_KEY from the function environment (set it in
 * backend/functions/.env.<project>, like the gateway credentials). When it's
 * absent, verification is skipped and the settlement goes to admin review — so
 * this deploys and runs fine before the key is configured.
 */
export const submitCommissionSettlement = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the uploaded screenshot path.');
  const { proofPath, method } = parsed.data;

  // The proof must be an object the driver themselves uploaded.
  if (!proofPath.startsWith(`drivers/${ctx.uid}/`)) {
    throw new HttpsError('permission-denied', 'Invalid screenshot path.');
  }
  await rateLimit(ctx.uid, 'submitCommissionSettlement', 6, 3600);

  const settings = await getCommissionSettings();
  const today = todayKey();
  const driverRef = db.doc(`drivers/${ctx.uid}`);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver record not found.');
  if (!isCommissionLocked(driverSnap, settings, today)) {
    throw new HttpsError('failed-precondition', 'No commission is due right now.');
  }
  const breakdown = commissionBreakdown(driverSnap, settings, today);
  const amountDue = breakdown.due;

  const accountsSnap = await db.doc('config/settlementAccounts').get();
  const accounts = (accountsSnap.exists ? accountsSnap.data() : {}) as VelocityAccounts;

  // Record the attempt up front so the driver sees "verifying".
  const settlementRef = db.collection('commissionSettlements').doc();
  await settlementRef.set({
    id: settlementRef.id,
    kind: 'commission',
    driverId: ctx.uid,
    userId: ctx.uid,
    amountDue,
    cycleGrossFare: (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0,
    cycleCashFare: cycleCashFare(driverSnap),
    // The closed days this payment is for, as they stood when it was quoted.
    settleableCashFare: breakdown.settleableCash,
    settleableGrossFare: breakdown.settleableGross,
    paidFromBonus: breakdown.creditApplied,
    forDay: today,
    proofPath,
    method: method ?? null,
    status: 'verifying' as SettlementStatus,
    aiChecked: proofAIConfigured(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const verdict = await verifyPaymentProof({ proofPath, amountDue, accounts });
  const outcome = decideProofOutcome(verdict, amountDue);

  if (outcome.status === 'approved') {
    await applyManualSettlement({
      driverId: ctx.uid,
      settlementId: settlementRef.id,
      amountDue,
      method: method ?? null,
      verifiedBy: 'ai',
    });
    await settlementRef.set({ aiVerdict: verdict ?? null }, { merge: true });
    await sendToUser(
      ctx.uid,
      '✅ Commission settled',
      `Your payment of PKR ${amountDue} was verified. Your account is unlocked — incoming rides are visible again.`,
    );
  } else {
    await settlementRef.set(
      {
        status: outcome.status,
        rejectionReason: outcome.reason,
        aiVerdict: verdict ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (outcome.status === 'rejected') {
      await sendToUser(
        ctx.uid,
        '❌ Payment not verified',
        outcome.reason ?? 'We could not verify your payment screenshot. Please upload a clear receipt.',
      );
    } else {
      await sendToUser(
        ctx.uid,
        '⏳ Payment under review',
        'Your payment is being reviewed by our team. Your account will unlock once it is approved.',
      );
    }
  }

  logger.info('Commission settlement submitted', { driverId: ctx.uid, settlementId: settlementRef.id, status: outcome.status });
  return { ok: true, settlementId: settlementRef.id, status: outcome.status, amountDue, reason: outcome.reason };
});

const reviewSchema = z.object({
  settlementId: docId,
  approve: z.boolean(),
  reason: z.string().max(300).optional(),
});

/**
 * Admin approves or rejects a settlement that was queued for manual review.
 * Handles both kinds that land in the queue: a driver's commission cycle and a
 * passenger's or driver's unpaid cancellation fees.
 */
export const adminReviewCommissionSettlement = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a settlementId and decision.');
  const { settlementId, approve, reason } = parsed.data;

  const settlementRef = db.doc(`commissionSettlements/${settlementId}`);
  const snap = await settlementRef.get();
  if (!snap.exists) invalid('Settlement not found.');
  const status = snap.get('status') as SettlementStatus;
  if (status === 'approved') return { ok: true, status };

  // Settlements written before cancellation fees existed carry no `kind`.
  const kind = (snap.get('kind') as string | undefined) ?? 'commission';
  const driverId = snap.get('driverId') as string;
  const amountDue = (snap.get('amountDue') as number | undefined) ?? 0;
  const method = (snap.get('method') as string | null | undefined) ?? null;

  if (kind === 'cancellation_fee') {
    const userId = snap.get('userId') as string;
    if (approve) {
      await applyCancellationFeeSettlement({
        userId,
        settlementId,
        amountDue,
        method,
        verifiedBy: admin.uid,
      });
      await sendToUser(
        userId,
        '✅ Cancellation fees cleared',
        `Your payment of PKR ${amountDue} was approved. Your account is back to normal.`,
      );
    } else {
      await settlementRef.set(
        {
          status: 'rejected' as SettlementStatus,
          rejectionReason: reason ?? 'Your payment could not be verified. Please upload a valid receipt.',
          reviewedBy: admin.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await sendToUser(
        userId,
        '❌ Payment rejected',
        reason ?? 'Your payment could not be verified. Please upload a valid receipt to clear your cancellation fees.',
      );
    }
    await db.collection('auditLogs').add({
      action: approve ? 'cancellationFee.settlement.approved' : 'cancellationFee.settlement.rejected',
      settlementId,
      userId,
      by: admin.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, status: approve ? 'approved' : 'rejected' };
  }

  if (approve) {
    await applyManualSettlement({ driverId, settlementId, amountDue, method, verifiedBy: admin.uid });
    await sendToUser(
      driverId,
      '✅ Commission approved',
      `Your payment of PKR ${amountDue} was approved. Your account is unlocked.`,
    );
  } else {
    await settlementRef.set(
      {
        status: 'rejected' as SettlementStatus,
        rejectionReason: reason ?? 'Your payment could not be verified. Please upload a valid receipt.',
        reviewedBy: admin.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await sendToUser(
      driverId,
      '❌ Payment rejected',
      reason ?? 'Your payment could not be verified. Please upload a valid receipt to settle your commission.',
    );
  }

  await db.collection('auditLogs').add({
    action: approve ? 'commission.settlement.approved' : 'commission.settlement.rejected',
    settlementId,
    driverId,
    by: admin.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, status: approve ? 'approved' : 'rejected' };
});
