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
import { requireRole, requireAdmin, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import {
  cycleCashFare,
  getCommissionSettings,
  isCommissionLocked,
  commissionDue,
} from '../domain/commission';
import {
  proofAIConfigured,
  verifyPaymentProof,
  type ProofVerdict,
  type VelocityAccounts,
} from '../lib/paymentProofAI';

export type SettlementStatus = 'verifying' | 'approved' | 'rejected' | 'pending_review';

/**
 * Atomically apply an approved settlement: settle the whole cycle from the
 * bank transfer the driver made, ledger it as realized platform revenue, and
 * unlock the driver. Idempotent on an already-approved settlement.
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

  await db.runTransaction(async (tx) => {
    const [driverSnap, settlementSnap] = await Promise.all([tx.get(driverRef), tx.get(settlementRef)]);
    if (!settlementSnap.exists) throw new HttpsError('not-found', 'Settlement not found.');
    if (settlementSnap.get('status') === 'approved') return; // already settled

    const cycleGrossFare = (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0;
    const cashFare = cycleCashFare(driverSnap);

    // Ledger the realized commission (money already reached Velocity's bank).
    tx.set(db.collection('platformLedger').doc(), {
      type: 'ride_commission',
      source: 'manual_bank',
      driverId,
      settlementId,
      amount: amountDue,
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

    // Reset the cycle → driver is unlocked.
    tx.set(
      driverRef,
      { cycleGrossFare: 0, cycleCashFare: 0, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(driverRef.collection('commissionPayments').doc(), {
      amount: amountDue,
      source: 'manual_bank',
      settlementId,
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

/** Decide the outcome from the AI verdict under the "safe" auto-unlock policy. */
function decideOutcome(
  verdict: ProofVerdict | null,
  amountDue: number,
): { status: Exclude<SettlementStatus, 'verifying'>; reason: string | null } {
  if (!verdict) {
    // No AI (unconfigured) or the check failed — never guess, send to a human.
    return { status: 'pending_review', reason: null };
  }
  if (!verdict.genuine) {
    return {
      status: 'rejected',
      reason: verdict.reasoning || 'The screenshot could not be verified as a genuine payment. Please upload a clear, unedited receipt.',
    };
  }
  const amountOk = verdict.amountDetected !== null && verdict.amountDetected >= amountDue;
  if (verdict.confidence === 'high' && amountOk && verdict.recipientMatch) {
    return { status: 'approved', reason: null };
  }
  // Genuine but not confidently correct (amount unclear, recipient unclear, or
  // lower confidence) → let an admin make the final call.
  return { status: 'pending_review', reason: verdict.reasoning || null };
}

const submitSchema = z.object({
  proofPath: z.string().min(1).max(512),
  method: z.enum(['easypaisa', 'jazzcash', 'bank']).optional(),
});

/**
 * Driver submits a payment screenshot to settle their locked commission cycle.
 * Verifies it with AI and either auto-unlocks, rejects, or queues for admin.
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
  const driverRef = db.doc(`drivers/${ctx.uid}`);
  const driverSnap = await driverRef.get();
  if (!driverSnap.exists) throw new HttpsError('not-found', 'Driver record not found.');
  if (!isCommissionLocked(driverSnap, settings)) {
    throw new HttpsError('failed-precondition', 'No commission is due right now.');
  }
  const amountDue = commissionDue(driverSnap, settings);

  const accountsSnap = await db.doc('config/settlementAccounts').get();
  const accounts = (accountsSnap.exists ? accountsSnap.data() : {}) as VelocityAccounts;

  // Record the attempt up front so the driver sees "verifying".
  const settlementRef = db.collection('commissionSettlements').doc();
  await settlementRef.set({
    id: settlementRef.id,
    driverId: ctx.uid,
    amountDue,
    cycleGrossFare: (driverSnap.get('cycleGrossFare') as number | undefined) ?? 0,
    cycleCashFare: cycleCashFare(driverSnap),
    proofPath,
    method: method ?? null,
    status: 'verifying' as SettlementStatus,
    aiChecked: proofAIConfigured(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const verdict = await verifyPaymentProof({ proofPath, amountDue, accounts });
  const outcome = decideOutcome(verdict, amountDue);

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
  settlementId: z.string().min(1).max(128),
  approve: z.boolean(),
  reason: z.string().max(300).optional(),
});

/** Admin approves or rejects a settlement that was queued for manual review. */
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

  const driverId = snap.get('driverId') as string;
  const amountDue = (snap.get('amountDue') as number | undefined) ?? 0;
  const method = (snap.get('method') as string | null | undefined) ?? null;

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
