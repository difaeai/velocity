/**
 * Payments — wallet top-ups (JazzCash / Easypaisa) and driver payouts.
 *
 * All money movement is server-authoritative and transactional; wallets are
 * never client-writable. A top-up flow:
 *
 *   app → createTopupIntent(amount, provider)
 *       → redirectUrl = paymentCheckout?intent=… (hosted by us)
 *       → auto-submits the signed gateway form; user pays on the gateway page
 *       → gateway sends the outcome to paymentWebhook?t=<per-intent secret>
 *       → signature/token verified → wallet credited idempotently.
 *
 * Gateway settlement (where the money physically lands) is the merchant
 * account you registered with JazzCash / Easypaisa — configure those
 * credentials as Functions secrets; see docs/PAYMENTS.md.
 */
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { randomBytes } from 'crypto';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, requireRole, requireAdmin, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { getFeatureFlags } from '../domain/featureFlags';
import { creditFromIntent } from './credit';
import {
  configuredProviders,
  easypaisaProvider,
  getProviderByName,
  isMockProvider,
  payfastProvider,
  providerForCallback,
  resolveProvider,
  type CheckoutForm,
} from './providers';

const MIN_TOPUP = 100;
const MAX_TOPUP = 100000;

/** Human names for the gateways, used on the hosted redirect page. */
const PROVIDER_LABEL: Record<string, string> = {
  jazzcash: 'JazzCash',
  easypaisa: 'Easypaisa',
  payfast: 'PayFast secure',
};

/** Public base URL of the deployed functions (for gateway redirect/callback URLs). */
function functionsBaseUrl(): string {
  const explicit = process.env.PAYMENTS_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  let projectId = process.env.GCLOUD_PROJECT;
  if (!projectId && process.env.FIREBASE_CONFIG) {
    try { projectId = (JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string }).projectId; } catch { /* noop */ }
  }
  // Must match the region in setGlobalOptions (src/index.ts).
  const region = process.env.FUNCTION_REGION ?? 'asia-south1';
  return `https://${region}-${projectId ?? 'unknown'}.cloudfunctions.net`;
}

/** Gateway-safe alphanumeric transaction reference (JazzCash caps at 20 chars). */
function makeProviderRef(): string {
  return `V${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
}

const topupSchema = z.object({
  amount: z.number().int().min(MIN_TOPUP).max(MAX_TOPUP),
  provider: z.enum(['jazzcash', 'easypaisa', 'payfast']).optional(),
  phone: z.string().max(20).optional(),
});

/** Which top-up methods the app should offer right now. */
export const getPaymentOptions = onCall(async (req) => {
  requireAuth(req);
  const flags = await getFeatureFlags();
  if (!flags.walletTopupEnabled) {
    // Wallet top-ups are "Coming Soon" — advertise nothing so the app shows
    // the disabled state. The gateway code stays wired for the flip.
    return { ok: true, providers: [], mock: false, comingSoon: true };
  }
  const providers = configuredProviders().map((p) => p.name);
  return { ok: true, providers, mock: providers.length === 0 && isMockProvider(), comingSoon: false };
});

/** Passenger/driver starts a wallet top-up; returns a gateway redirect. */
export const createTopupIntent = onCall(async (req) => {
  const ctx = requireAuth(req);
  const flags = await getFeatureFlags();
  if (!flags.walletTopupEnabled) {
    throw new HttpsError('failed-precondition', 'Wallet top-ups are coming soon.');
  }
  await rateLimit(ctx.uid, 'createTopupIntent', 10, 3600);
  const parsed = topupSchema.safeParse(req.data);
  if (!parsed.success) invalid(`Amount must be ${MIN_TOPUP}–${MAX_TOPUP} PKR.`);
  const { amount, provider: requested, phone } = parsed.data;

  let provider;
  try {
    provider = resolveProvider(requested);
  } catch (e) {
    throw new HttpsError('failed-precondition', e instanceof Error ? e.message : 'Provider unavailable.');
  }

  const intentRef = db.collection('paymentIntents').doc();
  const providerRef = makeProviderRef();
  // Secret token embedded in the gateway callback URL. Stored where no client
  // can read it (rules deny all access), so even the payer cannot forge a
  // success callback.
  const callbackToken = randomBytes(16).toString('hex');

  await intentRef.set({
    id: intentRef.id,
    uid: ctx.uid,
    amount,
    currency: 'PKR',
    status: 'pending',
    provider: provider.name,
    providerRef,
    phone: phone ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`paymentIntentSecrets/${intentRef.id}`).set({
    token: callbackToken,
    createdAt: FieldValue.serverTimestamp(),
  });

  const redirectUrl = provider.name === 'mock'
    ? `velocity://payments/mock?ref=${intentRef.id}`
    : `${functionsBaseUrl()}/paymentCheckout?intent=${intentRef.id}`;

  logger.info('Top-up intent created', { intentId: intentRef.id, uid: ctx.uid, amount, provider: provider.name });
  return {
    ok: true,
    intentId: intentRef.id,
    provider: provider.name,
    redirectUrl,
    mock: provider.name === 'mock',
  };
});

// ─── Hosted checkout page ────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function autoSubmitPage(form: CheckoutForm, note: string): string {
  const inputs = Object.entries(form.fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}"/>`)
    .join('\n      ');
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Velocity — Secure payment</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e7eef7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{text-align:center;padding:32px}.spin{width:36px;height:36px;border:4px solid #24313f;border-top-color:#38e07b;border-radius:50%;margin:0 auto 16px;animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}</style>
</head><body><div class="card"><div class="spin"></div><p>${escapeHtml(note)}</p>
<form id="f" method="${form.method}" action="${escapeHtml(form.actionUrl)}">
      ${inputs}
</form><script>document.getElementById('f').submit();</script>
</div></body></html>`;
}

function resultPage(success: boolean, message: string): string {
  const icon = success ? '✅' : '❌';
  const title = success ? 'Payment successful' : 'Payment failed';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Velocity — ${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e7eef7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{text-align:center;padding:32px;max-width:360px}.icon{font-size:56px}h1{font-size:22px}p{color:#93a4b8}
a{display:inline-block;margin-top:20px;background:#38e07b;color:#04140b;text-decoration:none;font-weight:800;padding:14px 28px;border-radius:12px}</style>
</head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1>
<p>${escapeHtml(message)}</p><a href="velocity://wallet">Return to Velocity</a></div></body></html>`;
}

/**
 * Hosted checkout (HTTP GET). Renders the signed, auto-submitting gateway form
 * for the intent, and handles Easypaisa's intermediate auth-token leg.
 */
export const paymentCheckout = onRequest(async (request, response) => {
  const intentId = String(request.query.intent ?? '');
  if (!intentId) { response.status(400).send('Missing intent.'); return; }

  const [intentSnap, secretSnap] = await Promise.all([
    db.doc(`paymentIntents/${intentId}`).get(),
    db.doc(`paymentIntentSecrets/${intentId}`).get(),
  ]);
  if (!intentSnap.exists || !secretSnap.exists) {
    response.status(404).send('Unknown payment.');
    return;
  }
  if (intentSnap.get('status') === 'paid') {
    response.status(200).send(resultPage(true, 'This top-up is already complete. Your wallet has been credited.'));
    return;
  }
  const token = secretSnap.get('token') as string;
  const providerName = intentSnap.get('provider') as string;
  const provider = getProviderByName(providerName);
  if (!provider || provider.name === 'mock' || !provider.isConfigured()) {
    response.status(400).send('This payment method is not available.');
    return;
  }

  const ctx = {
    intentId,
    providerRef: intentSnap.get('providerRef') as string,
    amount: intentSnap.get('amount') as number,
    phone: (intentSnap.get('phone') as string | null) ?? undefined,
    description: 'Velocity wallet top-up',
  };
  const base = functionsBaseUrl();
  const webhookUrl = `${base}/paymentWebhook?t=${token}`;

  try {
    // Easypaisa's middle leg: Easypay redirected back with an auth token that
    // must be exchanged via Confirm.jsf before the final outcome callback.
    if (providerName === 'easypaisa' && request.query.step === 'confirm') {
      if (request.query.t !== token) { response.status(403).send('Invalid token.'); return; }
      const authToken = String(request.query.auth_token ?? '');
      if (!authToken) {
        response.status(200).send(resultPage(false, 'The payment was cancelled or expired. No money was taken.'));
        return;
      }
      const form = easypaisaProvider.buildConfirmForm(authToken, webhookUrl);
      response.status(200).send(autoSubmitPage(form, 'Confirming your Easypaisa payment…'));
      return;
    }

    const callbackUrl = providerName === 'easypaisa'
      ? `${base}/paymentCheckout?intent=${intentId}&step=confirm&t=${token}`
      : webhookUrl;

    // PayFast needs a network round-trip for an access token before its form can
    // be built; the other gateways sign their form offline.
    let form: CheckoutForm;
    if (providerName === 'payfast') {
      const accessToken = await payfastProvider.prepare(ctx);
      if (!accessToken) {
        response.status(502).send(resultPage(false, 'The payment gateway did not respond. No money was taken — please try again.'));
        return;
      }
      form = payfastProvider.buildCheckoutForm(ctx, callbackUrl, accessToken);
    } else {
      form = provider.buildCheckoutForm(ctx, callbackUrl);
    }
    response.status(200).send(autoSubmitPage(form, `Redirecting to ${PROVIDER_LABEL[providerName] ?? 'secure'} payment…`));
  } catch (e) {
    logger.error('paymentCheckout failed', { intentId, e });
    response.status(500).send('Could not start the payment. Please try again.');
  }
});

// ─── Webhook / return URL ────────────────────────────────────────────────────

/** Flatten query + body into a plain string map (gateways use form posts/redirects). */
function callbackParams(request: { query: unknown; body: unknown }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of [request.query, request.body]) {
    if (source && typeof source === 'object') {
      for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
      }
    }
  }
  return out;
}

/**
 * Gateway callback (HTTP). JazzCash outcomes are verified by HMAC secure-hash;
 * Easypaisa outcomes by the per-intent secret token plus (when configured) a
 * server-to-server inquiry. Responds with a user-facing result page because
 * the gateways send the payer's browser here.
 */
export const paymentWebhook = onRequest(async (request, response) => {
  const params = callbackParams(request);

  // Dev-only JSON path for the mock provider (kept for tests/emulator).
  if (isMockProvider() && typeof request.body === 'object' && request.body && 'reference' in (request.body as object)) {
    const b = request.body as Record<string, unknown>;
    if (typeof b.reference === 'string' && b.success === true) {
      const ok = await creditFromIntent(b.reference, `mock_${b.reference}`);
      response.status(ok ? 200 : 404).send(ok ? 'ok' : 'unknown reference');
      return;
    }
    response.status(400).send('invalid');
    return;
  }

  const provider = providerForCallback(params);
  if (!provider) { response.status(400).send('invalid'); return; }

  const outcome = await provider.verifyCallback(params);
  if (!outcome) {
    logger.warn('Rejected unverifiable payment callback', { provider: provider.name });
    response.status(400).send('invalid');
    return;
  }

  // Map the gateway reference back to our intent.
  const intentQuery = await db.collection('paymentIntents')
    .where('providerRef', '==', outcome.providerRef).limit(1).get();
  if (intentQuery.empty) { response.status(404).send(resultPage(false, 'Unknown payment reference.')); return; }
  const intentSnap = intentQuery.docs[0];
  const intentId = intentSnap.id;

  // Per-intent secret token check — mandatory when the gateway gave us no
  // cryptographic proof (Easypaisa without inquiry), defense-in-depth otherwise.
  const secretSnap = await db.doc(`paymentIntentSecrets/${intentId}`).get();
  const tokenOk = secretSnap.exists && params.t === secretSnap.get('token');
  if (!outcome.verified && !tokenOk) {
    logger.warn('Rejected unverified callback without valid token', { intentId, provider: provider.name });
    response.status(403).send('invalid');
    return;
  }

  if (outcome.success) {
    // The credit always comes from the amount stored on our own intent, never
    // from the callback — so a forged amount cannot mint balance. This check is
    // therefore an alarm, not a gate: it is warned rather than rejected because
    // a gateway is entitled to settle us less than face value once fees are
    // deducted, and refusing that would strand a payment the user really made.
    const expected = intentSnap.get('amount') as number;
    if (outcome.settledAmount !== undefined && Math.abs(outcome.settledAmount - expected) > 0.5) {
      logger.error('Settled amount does not match the intent', {
        intentId, expected, settled: outcome.settledAmount, provider: provider.name,
      });
    }
    const ok = await creditFromIntent(intentId, outcome.providerRef);
    if (outcome.methodName) {
      await db.doc(`paymentIntents/${intentId}`)
        .set({ methodName: outcome.methodName }, { merge: true })
        .catch(() => undefined);
    }
    if (!outcome.verified) {
      logger.warn('Credited top-up on token-only verification (configure Easypaisa inquiry for production)', { intentId });
    }
    response.status(ok ? 200 : 404).send(
      resultPage(ok, ok
        ? `PKR ${intentSnap.get('amount')} has been added to your Velocity wallet.`
        : 'Unknown payment reference.'),
    );
    return;
  }

  await db.doc(`paymentIntents/${intentId}`).set(
    { status: 'failed', failureCode: outcome.responseCode ?? null, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  ).catch(() => undefined);
  response.status(200).send(resultPage(false, outcome.message ?? 'The payment was declined or cancelled. No money was taken.'));
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

// ─── Driver payouts ──────────────────────────────────────────────────────────

const payoutSchema = z.object({
  amount: z.number().int().positive(),
  method: z.enum(['jazzcash', 'easypaisa', 'bank']).optional(),
  account: z.string().min(5).max(40).optional(),
  accountTitle: z.string().max(80).optional(),
});

/** Driver requests a cash-out; reserves the funds and queues a payout. */
export const requestPayout = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = payoutSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid amount and account (5–40 characters).');
  const { amount, method, account, accountTitle } = parsed.data;

  const driverRef = db.doc(`drivers/${ctx.uid}`);
  const payoutRef = db.collection('payouts').doc();
  await db.runTransaction(async (tx) => {
    const walletRef = db.doc(`wallets/${ctx.uid}`);
    const [walletSnap, driverSnap] = await Promise.all([tx.get(walletRef), tx.get(driverRef)]);
    const balance = (walletSnap.get('balance') as number) ?? 0;
    if (amount > balance) {
      throw new HttpsError('failed-precondition', 'Amount exceeds your balance.');
    }
    // Fall back to the saved payout account so one-tap payouts keep working.
    const finalMethod = method ?? (driverSnap.get('payoutMethod') as string | undefined) ?? 'jazzcash';
    const finalAccount = account ?? (driverSnap.get('payoutAccount') as string | undefined) ?? null;
    const finalTitle = accountTitle ?? (driverSnap.get('payoutAccountTitle') as string | undefined) ?? null;
    if (!finalAccount) {
      throw new HttpsError('failed-precondition', 'Add your JazzCash/Easypaisa number or bank IBAN first.');
    }

    const txRef = walletRef.collection('transactions').doc();
    tx.set(payoutRef, {
      id: payoutRef.id,
      driverId: ctx.uid,
      amount,
      method: finalMethod,
      account: finalAccount,
      accountTitle: finalTitle,
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
      method: finalMethod,
      createdAt: FieldValue.serverTimestamp(),
    });
    // Remember the account for next time.
    tx.set(driverRef, {
      payoutMethod: finalMethod,
      payoutAccount: finalAccount,
      payoutAccountTitle: finalTitle,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info('Payout requested', { payoutId: payoutRef.id, driver: ctx.uid, amount });
  return { ok: true, payoutId: payoutRef.id };
});

const markPaidSchema = z.object({
  payoutId: z.string().min(1).max(128),
  txnRef: z.string().max(120).optional(),
});

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
    {
      status: 'paid',
      paidBy: admin.uid,
      txnRef: parsed.data.txnRef ?? null,
      paidAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
});

// ─── Platform settlement accounts ────────────────────────────────────────────

const settlementSchema = z.object({
  easypaisaNumber: z.string().max(20).optional(),
  jazzcashNumber: z.string().max(20).optional(),
  bankName: z.string().max(80).optional(),
  bankIban: z.string().max(40).optional(),
  accountTitle: z.string().max(80).optional(),
});

/**
 * Admin sets the platform's receiving accounts (your Easypaisa / JazzCash /
 * bank). Shown to users for manual transfers (e.g. Travel Partner receipts) and
 * to admins as the source accounts for driver payouts. Gateway settlement is
 * separate — that is configured with the gateway itself via secrets.
 */
export const adminSetSettlementAccounts = onCall(async (req) => {
  const admin = requireAdmin(req);
  const parsed = settlementSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid account details.');
  await db.doc('config/settlementAccounts').set(
    { ...parsed.data, updatedBy: admin.uid, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection('auditLogs').add({
    action: 'payments.settlementAccounts.updated',
    by: admin.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
