/**
 * Payments — wallet top-ups and driver payouts. All money movement is
 * server-authoritative and transactional; wallets are never client-writable.
 */
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, requireRole, requireAdmin, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { getProvider, isMockProvider } from './providers';

const MIN_TOPUP = 100;
const MAX_TOPUP = 100000;

const topupSchema = z.object({
  amount: z.number().int().min(MIN_TOPUP).max(MAX_TOPUP),
  phone: z.string().max(20).optional(),
});

/** Passenger/driver starts a wallet top-up; returns a gateway redirect. */
export const createTopupIntent = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'createTopupIntent', 10, 3600);
  const parsed = topupSchema.safeParse(req.data);
  if (!parsed.success) invalid(`Amount must be ${MIN_TOPUP}–${MAX_TOPUP} PKR.`);
  const { amount, phone } = parsed.data;

  const intentRef = db.collection('paymentIntents').doc();
  await intentRef.set({
    id: intentRef.id,
    uid: ctx.uid,
    amount,
    currency: 'PKR',
    status: 'pending',
    provider: getProvider().name,
    createdAt: FieldValue.serverTimestamp(),
  });

  const charge = await getProvider().createCharge({
    amount,
    reference: intentRef.id,
    uid: ctx.uid,
    phone,
    description: 'Wallet top-up',
  });
  await intentRef.set({ providerRef: charge.providerRef }, { merge: true });

  logger.info('Top-up intent created', { intentId: intentRef.id, uid: ctx.uid, amount });
  return {
    ok: true,
    intentId: intentRef.id,
    redirectUrl: charge.redirectUrl ?? null,
    mock: isMockProvider(),
  };
});

/** Idempotently credits a wallet from a paid intent. Returns false if unknown. */
async function creditFromIntent(reference: string, providerRef: string): Promise<boolean> {
  const intentRef = db.doc(`paymentIntents/${reference}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(intentRef);
    if (!snap.exists) return false;
    if (snap.get('status') === 'paid') return true; // already credited
    const uid = snap.get('uid') as string;
    const amount = snap.get('amount') as number;
    const walletRef = db.doc(`wallets/${uid}`);
    const txRef = walletRef.collection('transactions').doc();
    tx.set(intentRef, { status: 'paid', providerRef, paidAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(
      walletRef,
      { balance: FieldValue.increment(amount), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(txRef, { type: 'topup', amount, intentId: reference, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
}

/** Gateway webhook (HTTP). The provider verifies the signature server-side. */
export const paymentWebhook = onRequest(async (request, response) => {
  const result = getProvider().verifyWebhook(
    request.headers as Record<string, string | undefined>,
    request.body,
  );
  if (!result) {
    response.status(400).send('invalid');
    return;
  }
  if (result.success) {
    const ok = await creditFromIntent(result.reference, result.providerRef);
    response.status(ok ? 200 : 404).send(ok ? 'ok' : 'unknown reference');
    return;
  }
  await db
    .doc(`paymentIntents/${result.reference}`)
    .set({ status: 'failed' }, { merge: true })
    .catch(() => undefined);
  response.status(200).send('ok');
});

const confirmSchema = z.object({ intentId: z.string().min(1).max(128) });

/** Dev-only: simulate a successful gateway callback (mock provider only). */
export const mockConfirmTopup = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!isMockProvider()) {
    throw new HttpsError('failed-precondition', 'Only available with the mock provider.');
  }
  const parsed = confirmSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid intentId.');
  const snap = await db.doc(`paymentIntents/${parsed.data.intentId}`).get();
  if (!snap.exists || snap.get('uid') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Not your intent.');
  }
  await creditFromIntent(parsed.data.intentId, `mock_${parsed.data.intentId}`);
  return { ok: true };
});

const payoutSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(['jazzcash', 'easypaisa', 'bank']).optional(),
  account: z.string().max(40).optional(),
});

/** Driver requests a cash-out; reserves the funds and queues a payout. */
export const requestPayout = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = payoutSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid amount.');
  const { amount, method, account } = parsed.data;

  const payoutRef = db.collection('payouts').doc();
  await db.runTransaction(async (tx) => {
    const walletRef = db.doc(`wallets/${ctx.uid}`);
    const walletSnap = await tx.get(walletRef);
    const balance = (walletSnap.get('balance') as number) ?? 0;
    if (amount > balance) {
      throw new HttpsError('failed-precondition', 'Amount exceeds your balance.');
    }
    const txRef = walletRef.collection('transactions').doc();
    tx.set(payoutRef, {
      id: payoutRef.id,
      driverId: ctx.uid,
      amount,
      method: method ?? 'jazzcash',
      account: account ?? null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      walletRef,
      { balance: FieldValue.increment(-amount), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.set(txRef, {
      type: 'payout_request',
      amount: -amount,
      payoutId: payoutRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info('Payout requested', { payoutId: payoutRef.id, driver: ctx.uid, amount });
  return { ok: true, payoutId: payoutRef.id };
});

const markPaidSchema = z.object({ payoutId: z.string().min(1).max(128) });

/** Admin marks a payout as disbursed (after manual/automated transfer). */
export const markPayoutPaid = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = markPaidSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid payoutId.');
  const ref = db.doc(`payouts/${parsed.data.payoutId}`);
  const snap = await ref.get();
  if (!snap.exists) invalid('Payout not found.');
  if (snap.get('status') === 'paid') return { ok: true };
  await ref.set(
    { status: 'paid', paidBy: admin.uid, paidAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { ok: true };
});
