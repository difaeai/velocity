/**
 * Saved payment methods — the inDrive-style "connected accounts" wallet.
 *
 * The user authorises Velocity once at the gateway (Easypaisa, JazzCash, a bank
 * account or a card); the gateway hands back a reusable token; every later
 * top-up is one tap and one server-to-server charge with no redirect.
 *
 * Security shape, mirroring the existing paymentIntents/paymentIntentSecrets
 * split:
 *
 *   paymentMethods/{id}        display data the owner may read (kind, masked
 *                              tail, brand, default flag, status)
 *   paymentMethodSecrets/{id}  the gateway token — rules deny ALL client access
 *
 * The token is the thing that can move money, so it never travels to a client
 * and is never returned by a callable. A compromised app session can list and
 * remove instruments; it cannot exfiltrate anything chargeable.
 *
 * Gated by the `savedPaymentMethodsEnabled` feature flag, which is off for
 * launch. It is deliberately independent of `walletTopupEnabled` because
 * tokenisation is a separate merchant permission — see domain/featureFlags.ts.
 */
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { randomBytes } from 'crypto';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { getFeatureFlags } from '../domain/featureFlags';
import { creditFromIntent } from './credit';
import {
  isMockProvider,
  providerForSetupCallback,
  tokenizingProvider,
  type CheckoutForm,
  type SavedMethodKind,
} from './providers';

/** How many instruments one account may keep connected. */
const MAX_METHODS = 5;
const MIN_TOPUP = 100;
const MAX_TOPUP = 100000;

const KIND_LABEL: Record<SavedMethodKind, string> = {
  easypaisa: 'Easypaisa',
  jazzcash: 'JazzCash',
  card: 'Card',
  bank: 'Bank account',
};

/** Public shape of a saved method — everything here is safe to send to its owner. */
export interface SavedMethodView {
  id: string;
  kind: SavedMethodKind;
  label: string;
  maskedAccount: string | null;
  brand: string | null;
  isDefault: boolean;
  status: 'active' | 'revoked' | 'expired';
  createdAt: number | null;
}

function functionsBaseUrl(): string {
  const explicit = process.env.PAYMENTS_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  let projectId = process.env.GCLOUD_PROJECT;
  if (!projectId && process.env.FIREBASE_CONFIG) {
    try { projectId = (JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string }).projectId; } catch { /* noop */ }
  }
  const region = process.env.FUNCTION_REGION ?? 'asia-south1';
  return `https://${region}-${projectId ?? 'unknown'}.cloudfunctions.net`;
}

function makeProviderRef(): string {
  return `S${Date.now()}${Math.floor(1000 + Math.random() * 9000)}`;
}

/** "Easypaisa •••• 4321" — what the user sees in the methods list. */
function buildLabel(kind: SavedMethodKind, maskedAccount?: string, brand?: string): string {
  const head = kind === 'card' && brand ? brand : KIND_LABEL[kind];
  return maskedAccount ? `${head} •••• ${maskedAccount}` : head;
}

function toView(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): SavedMethodView {
  const createdAt = doc.get('createdAt') as FirebaseFirestore.Timestamp | undefined;
  return {
    id: doc.id,
    kind: doc.get('kind') as SavedMethodKind,
    label: (doc.get('label') as string) ?? '',
    maskedAccount: (doc.get('maskedAccount') as string | undefined) ?? null,
    brand: (doc.get('brand') as string | undefined) ?? null,
    isDefault: doc.get('isDefault') === true,
    status: (doc.get('status') as SavedMethodView['status']) ?? 'active',
    createdAt: createdAt ? createdAt.toMillis() : null,
  };
}

/**
 * Whether saved methods are usable right now, and by which gateway. A single
 * place so every callable below refuses for the same reasons.
 */
async function requireSavedMethodsEnabled() {
  const flags = await getFeatureFlags();
  if (!flags.savedPaymentMethodsEnabled) {
    throw new HttpsError('failed-precondition', 'Connected payment methods are coming soon.');
  }
  const provider = tokenizingProvider();
  if (!provider) {
    throw new HttpsError('failed-precondition', 'No payment gateway is configured for saved methods.');
  }
  return provider;
}

// ─── Listing ─────────────────────────────────────────────────────────────────

/**
 * The user's connected instruments. Always answers (never throws on the flag)
 * so the app can render the Payment methods screen in its Coming Soon state
 * rather than showing an error.
 */
export const getPaymentMethods = onCall(async (req) => {
  const ctx = requireAuth(req);
  const flags = await getFeatureFlags();
  const provider = tokenizingProvider();

  if (!flags.savedPaymentMethodsEnabled || !provider) {
    return { ok: true, comingSoon: true, methods: [] as SavedMethodView[], supportedKinds: [] as SavedMethodKind[] };
  }
  const snap = await db.collection('paymentMethods').where('uid', '==', ctx.uid).get();
  const methods = snap.docs
    .map(toView)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return {
    ok: true,
    comingSoon: false,
    methods,
    supportedKinds: provider.supportedMethodKinds(),
  };
});

// ─── Connecting a new instrument ─────────────────────────────────────────────

const setupSchema = z.object({
  kind: z.enum(['easypaisa', 'jazzcash', 'card', 'bank']),
  phone: z.string().max(20).optional(),
});

/**
 * Start the "connect your account" flow. Returns a URL the app opens; the user
 * authorises at the gateway and the token comes back to paymentMethodCallback.
 */
export const createPaymentMethodSetup = onCall(async (req) => {
  const ctx = requireAuth(req);
  const provider = await requireSavedMethodsEnabled();
  await rateLimit(ctx.uid, 'createPaymentMethodSetup', 10, 3600);

  const parsed = setupSchema.safeParse(req.data);
  if (!parsed.success) invalid('Choose a valid payment method type.');
  const { kind, phone } = parsed.data;

  if (!provider.supportedMethodKinds().includes(kind)) {
    throw new HttpsError('failed-precondition', `${KIND_LABEL[kind]} cannot be saved with the current gateway.`);
  }

  const existing = await db.collection('paymentMethods').where('uid', '==', ctx.uid).count().get();
  if (existing.data().count >= MAX_METHODS) {
    throw new HttpsError('failed-precondition', `You can connect at most ${MAX_METHODS} payment methods.`);
  }

  const setupRef = db.collection('paymentMethodSetups').doc();
  const providerRef = makeProviderRef();
  const callbackToken = randomBytes(16).toString('hex');

  await setupRef.set({
    id: setupRef.id,
    uid: ctx.uid,
    kind,
    provider: provider.name,
    providerRef,
    phone: phone ?? null,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`paymentMethodSetupSecrets/${setupRef.id}`).set({
    token: callbackToken,
    createdAt: FieldValue.serverTimestamp(),
  });

  const redirectUrl = provider.name === 'mock'
    ? `velocity://payments/mock-setup?ref=${setupRef.id}`
    : `${functionsBaseUrl()}/paymentMethodSetupPage?setup=${setupRef.id}`;

  logger.info('Payment method setup started', { setupId: setupRef.id, uid: ctx.uid, kind, provider: provider.name });
  return { ok: true, setupId: setupRef.id, redirectUrl, mock: provider.name === 'mock' };
});

/**
 * Stores a freshly authorised instrument. Shared by the real gateway callback
 * and the mock confirm, so both produce identical documents.
 */
async function saveMethod(params: {
  setupId: string;
  uid: string;
  kind: SavedMethodKind;
  provider: string;
  token: string;
  maskedAccount?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
}): Promise<string> {
  const methodRef = db.collection('paymentMethods').doc();
  // First instrument on the account becomes the default automatically.
  const existing = await db.collection('paymentMethods').where('uid', '==', params.uid).count().get();
  const isDefault = existing.data().count === 0;

  await methodRef.set({
    id: methodRef.id,
    uid: params.uid,
    kind: params.kind,
    provider: params.provider,
    label: buildLabel(params.kind, params.maskedAccount, params.brand),
    maskedAccount: params.maskedAccount ?? null,
    brand: params.brand ?? null,
    expiryMonth: params.expiryMonth ?? null,
    expiryYear: params.expiryYear ?? null,
    isDefault,
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    lastUsedAt: null,
  });
  // The chargeable secret lives where no client can read it.
  await db.doc(`paymentMethodSecrets/${methodRef.id}`).set({
    token: params.token,
    provider: params.provider,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`paymentMethodSetups/${params.setupId}`).set(
    { status: 'completed', methodId: methodRef.id, completedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return methodRef.id;
}

// ─── Hosted setup page + gateway callback ────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function autoSubmitPage(form: CheckoutForm, note: string): string {
  const inputs = Object.entries(form.fields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}"/>`)
    .join('\n      ');
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Velocity — Connect payment method</title>
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
  const title = success ? 'Payment method connected' : 'Could not connect';
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Velocity — ${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e7eef7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{text-align:center;padding:32px;max-width:360px}.icon{font-size:56px}h1{font-size:22px}p{color:#93a4b8}
a{display:inline-block;margin-top:20px;background:#38e07b;color:#04140b;text-decoration:none;font-weight:800;padding:14px 28px;border-radius:12px}</style>
</head><body><div class="card"><div class="icon">${icon}</div><h1>${title}</h1>
<p>${escapeHtml(message)}</p><a href="velocity://wallet">Return to Velocity</a></div></body></html>`;
}

/** Renders the gateway's auto-submitting authorisation form for a setup. */
export const paymentMethodSetupPage = onRequest(async (request, response) => {
  const setupId = String(request.query.setup ?? '');
  if (!setupId) { response.status(400).send('Missing setup.'); return; }

  const [setupSnap, secretSnap] = await Promise.all([
    db.doc(`paymentMethodSetups/${setupId}`).get(),
    db.doc(`paymentMethodSetupSecrets/${setupId}`).get(),
  ]);
  if (!setupSnap.exists || !secretSnap.exists) { response.status(404).send('Unknown setup.'); return; }
  if (setupSnap.get('status') === 'completed') {
    response.status(200).send(resultPage(true, 'This payment method is already connected.'));
    return;
  }

  const provider = tokenizingProvider();
  if (!provider || provider.name !== setupSnap.get('provider') || provider.name === 'mock') {
    response.status(400).send('This payment method is not available.');
    return;
  }

  const token = secretSnap.get('token') as string;
  const callbackUrl = `${functionsBaseUrl()}/paymentMethodCallback?t=${token}`;
  try {
    const form = provider.buildSetupForm(
      {
        setupId,
        providerRef: setupSnap.get('providerRef') as string,
        kind: setupSnap.get('kind') as SavedMethodKind,
        phone: (setupSnap.get('phone') as string | null) ?? undefined,
      },
      callbackUrl,
    );
    response.status(200).send(autoSubmitPage(form, 'Redirecting to your bank or wallet to authorise…'));
  } catch (e) {
    logger.error('paymentMethodSetupPage failed', { setupId, e });
    response.status(500).send('Could not start the authorisation. Please try again.');
  }
});

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

/** The gateway returns the authorised token here. Verified, then stored. */
export const paymentMethodCallback = onRequest(async (request, response) => {
  const params = callbackParams(request);
  const provider = providerForSetupCallback(params);
  if (!provider) { response.status(400).send('invalid'); return; }

  const outcome = await provider.verifySetupCallback(params);
  if (!outcome) {
    logger.warn('Rejected unverifiable setup callback', { provider: provider.name });
    response.status(400).send('invalid');
    return;
  }

  const setupQuery = await db.collection('paymentMethodSetups')
    .where('providerRef', '==', outcome.providerRef).limit(1).get();
  if (setupQuery.empty) { response.status(404).send(resultPage(false, 'Unknown authorisation reference.')); return; }
  const setupSnap = setupQuery.docs[0];
  const setupId = setupSnap.id;

  // Same rule as top-ups: an unsigned callback must carry our per-setup secret.
  const secretSnap = await db.doc(`paymentMethodSetupSecrets/${setupId}`).get();
  const tokenOk = secretSnap.exists && params.t === secretSnap.get('token');
  if (!outcome.verified && !tokenOk) {
    logger.warn('Rejected unverified setup callback without valid token', { setupId, provider: provider.name });
    response.status(403).send('invalid');
    return;
  }

  if (setupSnap.get('status') === 'completed') {
    response.status(200).send(resultPage(true, 'This payment method is already connected.'));
    return;
  }

  if (!outcome.success || !outcome.token) {
    await db.doc(`paymentMethodSetups/${setupId}`).set(
      { status: 'failed', failureMessage: outcome.message ?? null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    ).catch(() => undefined);
    response.status(200).send(resultPage(false, outcome.message ?? 'The authorisation was cancelled or declined.'));
    return;
  }

  await saveMethod({
    setupId,
    uid: setupSnap.get('uid') as string,
    kind: setupSnap.get('kind') as SavedMethodKind,
    provider: provider.name,
    token: outcome.token,
    maskedAccount: outcome.maskedAccount,
    brand: outcome.brand,
    expiryMonth: outcome.expiryMonth,
    expiryYear: outcome.expiryYear,
  });
  logger.info('Payment method connected', { setupId, provider: provider.name });
  response.status(200).send(resultPage(true, 'You can now top up your wallet with one tap.'));
});

const setupIdSchema = z.object({ setupId: z.string().min(1).max(128) });

/** Dev-only: simulate a successful gateway authorisation (mock provider only). */
export const mockConfirmPaymentMethod = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (!isMockProvider()) {
    throw new HttpsError('failed-precondition', 'Only available with the mock provider.');
  }
  const parsed = setupIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid setupId.');
  const snap = await db.doc(`paymentMethodSetups/${parsed.data.setupId}`).get();
  if (!snap.exists || snap.get('uid') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'Not your setup.');
  }
  if (snap.get('status') === 'completed') {
    return { ok: true, methodId: snap.get('methodId') as string };
  }
  const methodId = await saveMethod({
    setupId: parsed.data.setupId,
    uid: ctx.uid,
    kind: snap.get('kind') as SavedMethodKind,
    provider: 'mock',
    token: `mocktok_${parsed.data.setupId}`,
    maskedAccount: '4321',
  });
  return { ok: true, methodId };
});

// ─── Managing saved instruments ──────────────────────────────────────────────

const methodIdSchema = z.object({ methodId: z.string().min(1).max(128) });

/** Load a method and prove it belongs to the caller. */
async function ownedMethod(uid: string, methodId: string) {
  const snap = await db.doc(`paymentMethods/${methodId}`).get();
  if (!snap.exists || snap.get('uid') !== uid) {
    throw new HttpsError('not-found', 'Payment method not found.');
  }
  return snap;
}

/** Make one instrument the default; clears the flag on the others. */
export const setDefaultPaymentMethod = onCall(async (req) => {
  const ctx = requireAuth(req);
  await requireSavedMethodsEnabled();
  const parsed = methodIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid methodId.');
  await ownedMethod(ctx.uid, parsed.data.methodId);

  const all = await db.collection('paymentMethods').where('uid', '==', ctx.uid).get();
  const batch = db.batch();
  for (const doc of all.docs) {
    batch.set(doc.ref, { isDefault: doc.id === parsed.data.methodId }, { merge: true });
  }
  await batch.commit();
  return { ok: true };
});

/** Disconnect an instrument: revoke at the gateway, then delete token + doc. */
export const deletePaymentMethod = onCall(async (req) => {
  const ctx = requireAuth(req);
  const provider = await requireSavedMethodsEnabled();
  const parsed = methodIdSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide a valid methodId.');
  const { methodId } = parsed.data;
  const snap = await ownedMethod(ctx.uid, methodId);

  // Best effort — a gateway that will not revoke must not strand the user with
  // an instrument they cannot remove from their own account.
  const secretSnap = await db.doc(`paymentMethodSecrets/${methodId}`).get();
  const token = secretSnap.get('token') as string | undefined;
  if (token) {
    await provider.revokeToken(token).catch((e) => logger.warn('Token revoke failed', { methodId, e }));
  }

  await db.doc(`paymentMethodSecrets/${methodId}`).delete().catch(() => undefined);
  await db.doc(`paymentMethods/${methodId}`).delete();

  // Promote another instrument so the account is never left without a default.
  if (snap.get('isDefault') === true) {
    const rest = await db.collection('paymentMethods').where('uid', '==', ctx.uid).limit(1).get();
    if (!rest.empty) {
      await rest.docs[0].ref.set({ isDefault: true }, { merge: true });
    }
  }
  logger.info('Payment method removed', { methodId, uid: ctx.uid });
  return { ok: true };
});

// ─── One-tap top-up ──────────────────────────────────────────────────────────

const savedTopupSchema = z.object({
  methodId: z.string().min(1).max(128),
  amount: z.number().int().min(MIN_TOPUP).max(MAX_TOPUP),
});

/**
 * Charge a saved instrument and credit the wallet — the whole point of the
 * feature. No redirect, no hosted page: the gateway charges the token on our
 * word and we credit through the same idempotent path a webhook would.
 */
export const topupWithSavedMethod = onCall(async (req) => {
  const ctx = requireAuth(req);
  const provider = await requireSavedMethodsEnabled();
  const flags = await getFeatureFlags();
  if (!flags.walletTopupEnabled) {
    throw new HttpsError('failed-precondition', 'Wallet top-ups are coming soon.');
  }
  await rateLimit(ctx.uid, 'topupWithSavedMethod', 20, 3600);

  const parsed = savedTopupSchema.safeParse(req.data);
  if (!parsed.success) invalid(`Amount must be ${MIN_TOPUP}–${MAX_TOPUP} PKR.`);
  const { methodId, amount } = parsed.data;

  const methodSnap = await ownedMethod(ctx.uid, methodId);
  if (methodSnap.get('status') !== 'active') {
    throw new HttpsError('failed-precondition', 'That payment method is no longer usable. Please reconnect it.');
  }
  if (methodSnap.get('provider') !== provider.name) {
    throw new HttpsError('failed-precondition', 'That payment method was saved with a different gateway.');
  }
  const secretSnap = await db.doc(`paymentMethodSecrets/${methodId}`).get();
  const token = secretSnap.get('token') as string | undefined;
  if (!token) {
    throw new HttpsError('failed-precondition', 'That payment method is missing its authorisation. Please reconnect it.');
  }

  // Record the intent BEFORE charging, so a charge that succeeds while the
  // response is lost still has a document to reconcile against.
  const intentRef = db.collection('paymentIntents').doc();
  const providerRef = makeProviderRef();
  await intentRef.set({
    id: intentRef.id,
    uid: ctx.uid,
    amount,
    currency: 'PKR',
    status: 'pending',
    provider: provider.name,
    providerRef,
    methodId,
    source: 'saved_method',
    createdAt: FieldValue.serverTimestamp(),
  });

  const result = await provider.chargeToken(token, {
    intentId: intentRef.id,
    providerRef,
    amount,
    description: 'Velocity wallet top-up',
  });

  if (!result.success) {
    await intentRef.set(
      { status: 'failed', failureCode: result.responseCode ?? null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    // A dead token must stop being offered, or the user retries forever.
    if (result.tokenDead) {
      await db.doc(`paymentMethods/${methodId}`).set(
        { status: 'revoked', updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
    logger.warn('Saved-method charge declined', { methodId, intentId: intentRef.id, code: result.responseCode });
    throw new HttpsError('failed-precondition', result.message ?? 'The payment was declined. No money was taken.');
  }

  await creditFromIntent(intentRef.id, result.providerTxnRef ?? providerRef);
  await db.doc(`paymentMethods/${methodId}`).set(
    { lastUsedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  logger.info('Saved-method top-up credited', { methodId, intentId: intentRef.id, amount });
  return { ok: true, intentId: intentRef.id, amount };
});
