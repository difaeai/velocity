/**
 * Settling unpaid cancellation fees — bank transfer + AI-verified screenshot.
 *
 * A cancellation fee is charged against the wallet balance first (see
 * domain/cancellation); only what the balance could not cover becomes
 * `outstanding` on the wallet. With top-ups switched off for launch, the way to
 * clear that debt is the same one locked drivers already use for commission:
 * transfer the amount to Velocity's account, upload a screenshot, and let the
 * AI verifier either clear it instantly or send it to the admin review queue.
 *
 * These settlements are written into `commissionSettlements` alongside the
 * commission ones, tagged `kind: 'cancellation_fee'`, so the admin review queue
 * and its UI stay a single list. Unlike commission, this path is open to
 * passengers as well as drivers — anyone can rack up a cancellation fee.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import { walletOutstanding } from '../domain/cancellation';
import {
  decideProofOutcome,
  proofAIConfigured,
  verifyPaymentProof,
  type SettlementStatus,
  type VelocityAccounts,
} from '../lib/paymentProofAI';

/**
 * Clear the settled debt from the user's wallet and ledger it as realized
 * revenue — the money has reached Velocity's bank by this point. Shared by the
 * AI-approve and admin-approve paths so both do exactly the same thing.
 *
 * Only `amountDue` is cleared, never the whole balance: a fee charged *after*
 * the user sent the transfer must survive it rather than be silently forgiven.
 * Idempotent on an already-approved settlement.
 */
export async function applyCancellationFeeSettlement(params: {
  userId: string;
  settlementId: string;
  amountDue: number;
  method: string | null;
  verifiedBy: 'ai' | string; // 'ai' or an admin uid
}): Promise<void> {
  const { userId, settlementId, amountDue, method, verifiedBy } = params;
  const walletRef = db.doc(`wallets/${userId}`);
  const settlementRef = db.doc(`commissionSettlements/${settlementId}`);

  await db.runTransaction(async (tx) => {
    const [walletSnap, settlementSnap] = await Promise.all([tx.get(walletRef), tx.get(settlementRef)]);
    if (!settlementSnap.exists) throw new HttpsError('not-found', 'Settlement not found.');
    if (settlementSnap.get('status') === 'approved') return; // already settled

    const outstanding = walletOutstanding(walletSnap);
    const cleared = Math.min(amountDue, outstanding);

    tx.set(
      walletRef,
      {
        outstanding: Math.max(0, outstanding - cleared),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(walletRef.collection('transactions').doc(), {
      type: 'cancellation_fee_paid',
      // No balance movement — the user paid Velocity directly, out of band.
      amount: 0,
      cleared,
      settlementId,
      method: method ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.collection('platformLedger').doc(), {
      type: 'cancellation_fee_settled',
      source: 'manual_bank',
      userId,
      settlementId,
      amount: cleared,
      method: method ?? null,
      verifiedBy,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      db.doc('system/counters'),
      {
        cancellationFeesCollected: FieldValue.increment(cleared),
        cancellationFeesOutstanding: FieldValue.increment(-cleared),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      settlementRef,
      {
        status: 'approved' as SettlementStatus,
        clearedAmount: cleared,
        verifiedBy,
        reviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  logger.info('Cancellation fees settled', { userId, settlementId, amountDue, verifiedBy });
}

const submitSchema = z.object({
  proofPath: z.string().min(1).max(512),
  method: z.enum(['easypaisa', 'jazzcash', 'bank']).optional(),
});

/**
 * A passenger or driver submits a payment screenshot to clear the cancellation
 * fees they owe Velocity. Auto-clears on a confident, correct, genuine receipt;
 * otherwise queues for admin review (or rejects an obvious fake).
 */
export const submitCancellationFeeSettlement = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the uploaded screenshot path.');
  const { proofPath, method } = parsed.data;

  // The proof must be an object this user uploaded themselves.
  if (!proofPath.startsWith(`settlements/${ctx.uid}/`)) {
    throw new HttpsError('permission-denied', 'Invalid screenshot path.');
  }
  await rateLimit(ctx.uid, 'submitCancellationFeeSettlement', 6, 3600);

  const walletRef = db.doc(`wallets/${ctx.uid}`);
  const walletSnap = await walletRef.get();
  const amountDue = walletOutstanding(walletSnap);
  if (amountDue <= 0) {
    throw new HttpsError('failed-precondition', 'You have no cancellation fees to pay right now.');
  }

  const accountsSnap = await db.doc('config/settlementAccounts').get();
  const accounts = (accountsSnap.exists ? accountsSnap.data() : {}) as VelocityAccounts;

  // Record the attempt up front so the user sees "verifying".
  const settlementRef = db.collection('commissionSettlements').doc();
  await settlementRef.set({
    id: settlementRef.id,
    kind: 'cancellation_fee',
    userId: ctx.uid,
    amountDue,
    proofPath,
    method: method ?? null,
    status: 'verifying' as SettlementStatus,
    aiChecked: proofAIConfigured(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const verdict = await verifyPaymentProof({
    proofPath,
    amountDue,
    accounts,
    debtDescription:
      'cancellation fees for rides they cancelled after the ride had already been confirmed',
  });
  const outcome = decideProofOutcome(verdict, amountDue);

  if (outcome.status === 'approved') {
    await applyCancellationFeeSettlement({
      userId: ctx.uid,
      settlementId: settlementRef.id,
      amountDue,
      method: method ?? null,
      verifiedBy: 'ai',
    });
    await settlementRef.set({ aiVerdict: verdict ?? null }, { merge: true });
    await sendToUser(
      ctx.uid,
      '✅ Cancellation fees cleared',
      `Your payment of PKR ${amountDue} was verified. Your account is back to normal.`,
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
    await sendToUser(
      ctx.uid,
      outcome.status === 'rejected' ? '❌ Payment not verified' : '⏳ Payment under review',
      outcome.status === 'rejected'
        ? outcome.reason ?? 'We could not verify your payment screenshot. Please upload a clear receipt.'
        : 'Your payment is being reviewed by our team. Your fees will clear once it is approved.',
    );
  }

  logger.info('Cancellation fee settlement submitted', {
    userId: ctx.uid,
    settlementId: settlementRef.id,
    status: outcome.status,
    amountDue,
  });
  return { ok: true, settlementId: settlementRef.id, status: outcome.status, amountDue, reason: outcome.reason };
});
