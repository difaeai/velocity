/**
 * Funding a balance by bank transfer and a screenshot — the top-up path that
 * works before any gateway does.
 *
 * ── THE FLOW ─────────────────────────────────────────────────────────────────
 *
 *   app → user pays Velocity from Easypaisa / JazzCash / any bank app
 *       → uploads the receipt to settlements/{uid}/…
 *       → submitManualTopup(proofPath, amount)
 *       → our own OCR reads it (lib/localVision.ts, no model, no key)
 *       → domain/topupProof.ts decides
 *       → approved: the balance is credited in the same transaction that
 *         claims the receipt, and a locked driver is unlocked on the spot.
 *       → anything else: it waits for an admin, and no money moves.
 *
 * ── WHY THE CLAIM AND THE CREDIT ARE ONE TRANSACTION ─────────────────────────
 *
 * The whole anti-fraud design rests on a single sentence: **one bank
 * transaction may be credited exactly once, ever, across every account.** A
 * check that reads "has this reference been used?" and then, a moment later,
 * writes "it has now" is not that sentence — it is a race, and the attack is
 * to upload the same screenshot five times in the same second from five
 * requests. So the reference, the image digest and the balance are written in
 * one Firestore transaction whose reads are the duplicate checks. The second
 * request through finds the claim already there and credits nothing.
 *
 * The pre-check before the transaction is for the DRIVER's benefit, not for
 * correctness: it is what lets the verdict say "this was already credited"
 * instead of failing with a race error. Correctness is the transaction.
 *
 * ── WHY MANUAL MONEY IS STILL RING-FENCED ────────────────────────────────────
 *
 * It credits `toppedUpTotal` exactly like a gateway top-up does, and that is
 * not a detail. `domain/walletFunds.ts` only lets a payout draw on `earned`,
 * so money that arrived as a top-up can be spent on Velocity's own charges and
 * never withdrawn. Skip that increment here and this path becomes the shortest
 * route from a forged screenshot to cash in a stranger's Easypaisa — the
 * forgery would not even have to beat the OCR by much, because the money would
 * be withdrawable the moment it landed. It is also the reason this path can
 * exist at all before an EMI licence: a closed-loop prepayment for Velocity's
 * own service is not e-money (see docs/PAYMENTS.md).
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { createHash } from 'crypto';
import { z } from 'zod';

import { db, FieldValue, storage } from '../lib/firebase';
import { docId, invalid, requireAdmin, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import { readImageText } from '../lib/localVision';
import { walletFunds } from '../domain/walletFunds';
import {
  MAX_SINGLE,
  MIN_SINGLE,
  decideTopupProof,
  readReceipt,
  type TopupProofVerdict,
  type VelocityAccounts,
} from '../domain/topupProof';
import { trySettleCommissionFromWallet } from '../drivers/autoSettle';

/** Receipts bigger than this are not receipts. Matches the Storage rule. */
const MAX_PROOF_BYTES = 15 * 1024 * 1024;

/**
 * How much one account may have auto-credited in a rolling day.
 *
 * The per-receipt cap in domain/topupProof.ts bounds one forgery; this bounds a
 * campaign of them. Past it, top-ups still work — they just wait for an admin,
 * which is the correct amount of friction for somebody funding six figures by
 * screenshot.
 */
const DAILY_AUTO_CREDIT_CAP = 100_000;

const submitSchema = z.object({
  proofPath: z.string().min(1).max(512),
  amount: z.number().int().min(MIN_SINGLE).max(MAX_SINGLE),
  method: z.enum(['easypaisa', 'jazzcash', 'bank']).optional(),
});

/** Velocity's receiving accounts, as the admin maintains them. */
async function velocityAccounts(): Promise<VelocityAccounts> {
  const snap = await db.doc('config/settlementAccounts').get();
  return (snap.data() ?? {}) as VelocityAccounts;
}

/** Pull one Storage object into memory, refusing anything that is not an image. */
async function loadProof(path: string): Promise<Buffer | null> {
  try {
    const file = storage.bucket().file(path);
    const [meta] = await file.getMetadata();
    const contentType = (meta.contentType as string | undefined) ?? '';
    if (!contentType.startsWith('image/')) {
      logger.warn('Top-up proof is not an image', { path, contentType });
      return null;
    }
    if (Number(meta.size ?? 0) > MAX_PROOF_BYTES) {
      logger.warn('Top-up proof too large', { path, size: meta.size });
      return null;
    }
    const [buf] = await file.download();
    return buf;
  } catch (e) {
    logger.error('Failed to load top-up proof from Storage', { path, e });
    return null;
  }
}

/** What has been auto-credited to this account since `since`. */
async function autoCreditedSince(uid: string, since: Date): Promise<number> {
  const snap = await db
    .collection('manualTopups')
    .where('uid', '==', uid)
    .where('status', '==', 'approved')
    .where('createdAt', '>=', since)
    .limit(100)
    .get();
  return snap.docs.reduce((sum, d) => sum + (Number(d.get('creditedAmount')) || 0), 0);
}

/**
 * Credit a verified manual top-up, claiming the receipt in the same breath.
 *
 * Returns false when the claim was already taken — which is not an error, it
 * is the duplicate check doing its job under a race.
 */
async function creditManualTopup(params: {
  uid: string;
  topupId: string;
  amount: number;
  imageSha: string;
  refKey: string | null;
  approvedBy: 'engine' | string;
}): Promise<boolean> {
  const { uid, topupId, amount, imageSha, refKey, approvedBy } = params;

  return db.runTransaction(async (tx) => {
    const imageRef = db.doc(`manualTopupProofs/${imageSha}`);
    const referenceRef = refKey ? db.doc(`manualTopupRefs/${refKey}`) : null;
    const walletRef = db.doc(`wallets/${uid}`);
    const topupRef = db.doc(`manualTopups/${topupId}`);

    const [imageSnap, refSnap, walletSnap, topupSnap] = await Promise.all([
      tx.get(imageRef),
      referenceRef ? tx.get(referenceRef) : Promise.resolve(null),
      tx.get(walletRef),
      tx.get(topupRef),
    ]);

    // Already credited — by a racing request, or by a retry of this one.
    if (imageSnap.exists || refSnap?.exists) return false;
    if (topupSnap.get('status') === 'approved') return false;

    // Claim the receipt. These two documents are the ledger of what has been
    // spent; the balance is downstream of them.
    tx.set(imageRef, { uid, topupId, amount, createdAt: FieldValue.serverTimestamp() });
    if (referenceRef) {
      tx.set(referenceRef, { uid, topupId, amount, imageSha, createdAt: FieldValue.serverTimestamp() });
    }

    // Settle what was withdrawable BEFORE this credit, and write it down. Same
    // reasoning as payments/credit.ts: gateway and manual money are both
    // top-ups, so both have to pin `earned` or the ring-fence leaks.
    const earnedBeforeTopup = walletFunds(walletSnap).withdrawable;
    tx.set(
      walletRef,
      {
        balance: FieldValue.increment(amount),
        toppedUpTotal: FieldValue.increment(amount),
        earned: earnedBeforeTopup,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(walletRef.collection('transactions').doc(), {
      type: 'topup',
      amount,
      source: 'manual_proof',
      topupId,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      topupRef,
      {
        status: 'approved',
        creditedAmount: amount,
        approvedBy,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      db.doc('system/counters'),
      {
        manualTopupCredited: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  });
}

/**
 * A credited top-up should clear a lock without a second tap.
 *
 * This is the whole reason the manual path feels like a gateway: the driver
 * uploads one screenshot and is driving again, rather than uploading a
 * screenshot, waiting, and then hunting for a "pay commission" button.
 */
async function settleAfterCredit(uid: string): Promise<number> {
  const outcome = await trySettleCommissionFromWallet({ driverId: uid, trigger: 'topup' });
  return outcome?.status === 'settled' ? outcome.amountPaid : 0;
}

/**
 * Submit a payment screenshot to fund a balance.
 *
 * Runs the engine inline rather than on a queue: the driver is standing at the
 * screen and the whole value of this path is that the money appears while they
 * are still looking at it. OCR on a screenshot is about a second.
 */
export const submitManualTopup = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) {
    invalid(`Enter an amount between ${MIN_SINGLE} and ${MAX_SINGLE} PKR and attach the receipt.`);
  }
  const { proofPath, amount: claimed, method } = parsed.data!;

  // The proof must be something this user uploaded themselves. Without this a
  // caller could pass another user's receipt path and claim their payment.
  if (!proofPath.startsWith(`settlements/${ctx.uid}/`)) {
    throw new HttpsError('permission-denied', 'Invalid receipt path.');
  }
  await rateLimit(ctx.uid, 'submitManualTopup', 12, 3600);

  const topupRef = db.collection('manualTopups').doc();
  await topupRef.set({
    id: topupRef.id,
    uid: ctx.uid,
    claimedAmount: claimed,
    method: method ?? null,
    proofPath,
    status: 'verifying',
    createdAt: FieldValue.serverTimestamp(),
  });

  const fail = async (status: 'pending_review' | 'rejected', message: string, reasons: string[]) => {
    await topupRef.set(
      { status, reasons, message, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { ok: true, topupId: topupRef.id, status, credited: 0, message };
  };

  const bytes = await loadProof(proofPath);
  if (!bytes) {
    return fail('pending_review', 'We could not open that image. Our team will check it shortly.', [
      'proof_unreadable',
    ]);
  }
  const imageSha = createHash('sha256').update(bytes).digest('hex');

  const read = await readImageText(bytes);
  if (!read) {
    return fail('pending_review', 'We could not read that screenshot. Our team will check it shortly.', [
      'ocr_unavailable',
    ]);
  }

  const accounts = await velocityAccounts();
  const fields = readReceipt(read.text, accounts);

  // Pre-checks, for the message the user reads. The binding ones are the reads
  // inside creditManualTopup's transaction.
  const [imageSeen, refSeen] = await Promise.all([
    db.doc(`manualTopupProofs/${imageSha}`).get(),
    fields.refKey ? db.doc(`manualTopupRefs/${fields.refKey}`).get() : Promise.resolve(null),
  ]);

  let verdict: TopupProofVerdict = decideTopupProof({
    fields,
    claimed,
    ocrConfidence: read.ocrConfidence,
    duplicate: refSeen?.exists === true,
    imageReplay: imageSeen.exists,
  });

  // A day's worth of auto-credit is enough. Past it a human looks, however
  // clean the receipt was.
  if (verdict.status === 'approved') {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const already = await autoCreditedSince(ctx.uid, since);
    if (already + verdict.creditAmount > DAILY_AUTO_CREDIT_CAP) {
      verdict = {
        ...verdict,
        status: 'pending_review',
        creditAmount: 0,
        reasons: [...verdict.reasons, 'daily_auto_cap'],
        message: 'This takes you past the daily instant-credit limit, so our team will check it shortly.',
      };
    }
  }

  await topupRef.set(
    {
      imageSha,
      ocrConfidence: Math.round(read.ocrConfidence),
      detectedAmount: fields.amount,
      transactionRef: fields.transactionRef,
      refKey: fields.refKey,
      sourceApp: fields.sourceApp,
      recipientMatch: fields.recipientMatch,
      reasons: verdict.reasons,
      message: verdict.message,
      status: verdict.status === 'approved' ? 'verifying' : verdict.status,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  if (verdict.status !== 'approved') {
    logger.info('Manual top-up not auto-credited', {
      topupId: topupRef.id,
      uid: ctx.uid,
      status: verdict.status,
      reasons: verdict.reasons,
    });
    return { ok: true, topupId: topupRef.id, status: verdict.status, credited: 0, message: verdict.message };
  }

  const credited = await creditManualTopup({
    uid: ctx.uid,
    topupId: topupRef.id,
    amount: verdict.creditAmount,
    imageSha,
    refKey: fields.refKey,
    approvedBy: 'engine',
  });
  if (!credited) {
    return fail(
      'rejected',
      'This transaction has already been credited. If you made a second payment, upload that receipt instead.',
      [...verdict.reasons, 'claimed_by_race'],
    );
  }

  const settled = await settleAfterCredit(ctx.uid);
  logger.info('Manual top-up auto-credited', {
    topupId: topupRef.id,
    uid: ctx.uid,
    amount: verdict.creditAmount,
    settled,
  });

  return {
    ok: true,
    topupId: topupRef.id,
    status: 'approved' as const,
    credited: verdict.creditAmount,
    commissionSettled: settled,
    message: settled > 0
      ? `PKR ${verdict.creditAmount.toLocaleString()} added. PKR ${settled.toLocaleString()} of commission was cleared — you can drive again.`
      : verdict.message,
  };
});

const reviewSchema = z.object({
  topupId: docId,
  approve: z.boolean(),
  /** Admin override for what to credit; defaults to what the engine read. */
  amount: z.number().int().min(MIN_SINGLE).max(MAX_SINGLE).optional(),
  note: z.string().max(500).optional(),
});

/** Admin decides a top-up the engine would not credit on its own. */
export const adminReviewManualTopup = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = reviewSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid data.');
  const { topupId, approve, amount, note } = parsed.data!;

  const topupRef = db.doc(`manualTopups/${topupId}`);
  const snap = await topupRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Top-up not found.');
  if (snap.get('status') === 'approved') {
    throw new HttpsError('failed-precondition', 'That top-up has already been credited.');
  }

  const uid = snap.get('uid') as string;

  if (!approve) {
    await topupRef.set(
      {
        status: 'rejected',
        reviewedBy: admin.uid,
        reviewNote: note ?? null,
        message: note ?? 'This receipt could not be verified.',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await sendToUser(uid, 'Top-up not approved', note ?? 'We could not verify that receipt. Please contact support.')
      .catch(() => undefined);
    return { ok: true, status: 'rejected' as const, credited: 0 };
  }

  // Default to the amount the engine read off the receipt, NOT the one the
  // user typed: an admin approving in a hurry should land on the evidence.
  const credit = amount ?? (snap.get('detectedAmount') as number | null) ?? null;
  if (!credit || credit < MIN_SINGLE) {
    throw new HttpsError('failed-precondition', 'No readable amount — pass the amount to credit explicitly.');
  }

  const credited = await creditManualTopup({
    uid,
    topupId,
    amount: credit,
    imageSha: (snap.get('imageSha') as string | undefined) ?? `manual_${topupId}`,
    refKey: (snap.get('refKey') as string | null) ?? null,
    approvedBy: admin.uid,
  });
  if (!credited) {
    throw new HttpsError('failed-precondition', 'That receipt has already been credited.');
  }

  await topupRef.set({ reviewedBy: admin.uid, reviewNote: note ?? null }, { merge: true });
  const settled = await settleAfterCredit(uid);
  await sendToUser(
    uid,
    '✅ Top-up approved',
    settled > 0
      ? `PKR ${credit.toLocaleString()} added to your balance. PKR ${settled.toLocaleString()} of commission was cleared.`
      : `PKR ${credit.toLocaleString()} has been added to your balance.`,
  ).catch(() => undefined);

  logger.info('Manual top-up approved by admin', { topupId, uid, amount: credit, admin: admin.uid });
  return { ok: true, status: 'approved' as const, credited: credit, commissionSettled: settled };
});
