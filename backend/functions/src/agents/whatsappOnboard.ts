/**
 * Connecting a client's WhatsApp number without anyone pasting a token.
 *
 * `agentSaveWhatsApp` asks an operator for a phone number id, a permanent
 * access token and an app secret. That works for us, who have a Meta developer
 * account open anyway, and it is the reason no customer has ever connected a
 * number: the three values live on three different screens of a console they
 * have no reason to understand.
 *
 * Embedded Signup is Meta's answer to exactly that. The client presses one
 * button, Meta's own window walks them through choosing a business, a number
 * and a display name, and it hands back three things: a code, the WhatsApp
 * account id and the phone number id. This file spends the code where the app
 * secret lives and writes the same `WaLine` that a pasted token writes, so
 * everything downstream — the webhook, the threads, the auto-reply, the sales
 * agent — carries on unchanged.
 *
 * Two things are worth knowing before changing any of it:
 *
 * - **The code is worthless on the client.** It buys a token only with the app
 *   secret, which never leaves Cloud Functions. That is why the browser is
 *   allowed to hold it for the second between the window closing and this call.
 * - **Subscribing the app is not optional.** Until the app is subscribed to the
 *   client's WhatsApp account, Meta delivers no webhooks for it, so messages
 *   arrive nowhere and the desk looks broken rather than unconnected.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { db } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { currentWorkspace, deskCall, sdb } from '../social/workspace';
import { open, seal, tokenVaultReady, type SealedSecret } from '../social/secrets';
import { metaApp } from '../social/meta';
import { GRAPH_VERSION } from '../whatsapp/client';
import { WA_INDEX, WA_LINE, WA_SECRET, functionsBase } from './store';
import type { WaLine } from './whatsapp';

const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * The Facebook Login configuration that drives the signup window.
 *
 * It is not a secret — it travels in the dialog in plain sight — but it differs
 * per app, so it is read from the environment rather than written into the
 * code. Absent, the console says the desk is not set up instead of opening a
 * window that fails two screens later.
 */
function configId(): string | null {
  return process.env.META_WA_CONFIG_ID?.trim() || null;
}

/** One Graph call, with Meta's own error text kept intact. */
async function graph<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new HttpsError('unavailable', `Meta could not be reached: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  // Meta answers a failure with a 200 and an `error` object about as often as
  // it answers with a 4xx, so both are read.
  if (body?.error?.message) throw new HttpsError('failed-precondition', body.error.message);
  if (!res.ok) throw new HttpsError('failed-precondition', `Meta returned HTTP ${res.status}.`);
  return body;
}

/** What the console needs to decide whether it can draw the button. */
/** The connected line's WhatsApp account, and a token that can act on it. */
async function wabaFor(): Promise<{ wabaId: string; token: string }> {
  const line = (await sdb.doc(WA_LINE).get()).data() as WaLine | undefined;
  const sealed = (await sdb.doc(WA_SECRET).get()).data()?.token as SealedSecret | undefined;
  if (!line?.wabaId || !sealed) {
    throw new HttpsError(
      'failed-precondition',
      'Connect a WhatsApp number first — a template belongs to its WhatsApp Business account, not to Vexa.',
    );
  }
  return { wabaId: line.wabaId, token: open(sealed) };
}

/**
 * Submit a message template for Meta's review.
 *
 * A template is the only way to write to somebody more than 24 hours after
 * their last message, which is what `sendTemplate` in the closer needs and
 * what every outreach batch waits on. Meta reviews each one, and nothing here
 * can hurry it: it comes back PENDING and stays that way until it does not.
 */
export const agentSubmitWhatsAppTemplate = deskCall('sales', { timeoutSeconds: 60 }, async (req) => {
  requireAuth(req);
  const parsed = z
    .object({
      // Meta's own rule, not ours: lower case, digits and underscores only.
      name: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]{1,512}$/),
      language: z.string().trim().max(10).default('en'),
      category: z.enum(['MARKETING', 'UTILITY']).default('UTILITY'),
      body: z.string().trim().min(1).max(1024),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'A template needs a lower-case name with no spaces in it, and some text.');
  }
  const { wabaId, token } = await wabaFor();

  const made = await graph<{ id?: string; status?: string }>(`${GRAPH}/${encodeURIComponent(wabaId)}/message_templates`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      name: parsed.data.name,
      language: parsed.data.language || 'en',
      category: parsed.data.category,
      components: JSON.stringify([{ type: 'BODY', text: parsed.data.body }]),
    }).toString(),
  });

  // The desk can only open a conversation with a template it knows the name
  // of, so the first approved one becomes the line's template.
  const line = (await sdb.doc(WA_LINE).get()).data() as WaLine | undefined;
  if (!line?.templateName) {
    await sdb.doc(WA_LINE).set(
      { templateName: parsed.data.name, templateLang: parsed.data.language || 'en', templateHasName: false },
      { merge: true },
    );
  }

  return { ok: true, id: made.id ?? null, status: made.status ?? 'PENDING' };
});

/** Every template on the connected account, and where Meta's review got to. */
export const agentWhatsAppTemplates = deskCall('sales', async () => {
  const { wabaId, token } = await wabaFor();
  const res = await graph<{ data?: { name: string; status: string; category?: string; language?: string }[] }>(
    `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates?fields=name,status,category,language&limit=50`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return { templates: res.data ?? [] };
});

export const agentWhatsAppSignupState = deskCall('sales', async () => {
  const app = await metaApp();
  const cfg = configId();
  const line = (await sdb.doc(WA_LINE).get()).data() as WaLine | undefined;
  return {
    ready: Boolean(app && cfg && tokenVaultReady()),
    appId: app?.appId ?? null,
    configId: cfg,
    graphVersion: GRAPH_VERSION,
    vaultReady: tokenVaultReady(),
    connected: line ? { displayNumber: line.displayNumber, verifiedName: line.verifiedName } : null,
    // Missing pieces, named, so the console can say which one rather than "not configured".
    missing: [
      ...(app ? [] : ['META_APP_ID / META_APP_SECRET']),
      ...(cfg ? [] : ['META_WA_CONFIG_ID']),
      ...(tokenVaultReady() ? [] : ['SOCIAL_TOKEN_KEY']),
    ],
  };
});

const finishSchema = z.object({
  code: z.string().min(10).max(2000),
  wabaId: z.string().min(5).max(64),
  phoneNumberId: z.string().min(5).max(64),
});

/**
 * Spend the code, prove the number, subscribe the app, keep the token.
 *
 * Ordered so that nothing is written until Meta has agreed to all of it: a
 * half-connected line that holds a token but receives no webhooks is worse than
 * no line, because the desk reports itself as connected and then goes quiet.
 */
export const agentFinishWhatsAppSignup = deskCall('sales', { timeoutSeconds: 120 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = finishSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'That sign-up did not come back complete. Press Connect again.');
  const { code, wabaId, phoneNumberId } = parsed.data;

  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'Tokens cannot be stored safely right now.');
  const app = await metaApp();
  if (!app) throw new HttpsError('failed-precondition', 'No Meta app is configured, so the sign-up cannot be completed.');

  // Velocity's own line carries sign-in codes and driver alerts. A reported
  // sales chat on the same number would take the sign-in down with it.
  if (phoneNumberId === (process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim()) {
    throw new HttpsError('failed-precondition', 'That number sends Velocity’s sign-in codes. Connect a separate number.');
  }

  const wid = currentWorkspace();
  const idxRef = db.doc(`${WA_INDEX}/${phoneNumberId}`);
  const idx = (await idxRef.get()).data() as { wid?: string } | undefined;
  if (idx?.wid && idx.wid !== wid) {
    throw new HttpsError('already-exists', 'That WhatsApp number is connected to another workspace.');
  }

  // The code buys a business token here, where the app secret is. Embedded
  // Signup codes carry no redirect_uri, unlike the Facebook Login exchange.
  const { access_token: token } = await graph<{ access_token: string }>(
    `${GRAPH}/oauth/access_token` +
      `?client_id=${encodeURIComponent(app.appId)}` +
      `&client_secret=${encodeURIComponent(app.appSecret)}` +
      `&code=${encodeURIComponent(code)}`,
  );
  if (!token) throw new HttpsError('failed-precondition', 'Meta returned no access token for that sign-up.');

  // Proved before it is kept: the number must answer to this token.
  const info = await graph<{ display_phone_number?: string; verified_name?: string }>(
    `${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  // Without this, Meta delivers no webhooks for the client's account.
  await graph(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });

  // Registration carries a six-digit PIN that Meta asks for again if the number
  // is ever moved. It is generated once and sealed beside the token, because a
  // PIN nobody recorded is a support ticket a year from now.
  const prevSecret = (await sdb.doc(WA_SECRET).get()).data() as
    | { token?: SealedSecret; pin?: SealedSecret }
    | undefined;
  const pin = prevSecret?.pin ? open(prevSecret.pin) : String(randomBytes(3).readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
  try {
    await graph(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/register`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });
  } catch (e) {
    // Already registered is the common case on a reconnect, and not a failure.
    logger.info(`whatsapp onboarding: register said "${(e as Error).message}" — continuing`);
  }

  const prev = (await sdb.doc(WA_LINE).get()).data() as WaLine | undefined;
  if (prev?.phoneNumberId && prev.phoneNumberId !== phoneNumberId) {
    await db.doc(`${WA_INDEX}/${prev.phoneNumberId}`).delete();
  }

  const line: WaLine = {
    phoneNumberId,
    displayNumber: info.display_phone_number ?? '',
    verifiedName: info.verified_name ?? '',
    // Embedded Signup creates no template. The Sales page asks for one before
    // the first outbound message; replies inside the window need none.
    templateName: prev?.templateName ?? '',
    templateLang: prev?.templateLang ?? 'en',
    templateHasName: prev?.templateHasName ?? false,
    autoReply: prev?.autoReply ?? true,
    agentId: prev?.agentId ?? null,
    verifyToken: prev?.verifyToken || randomBytes(18).toString('base64url'),
    connectedAtMs: prev?.connectedAtMs || Date.now(),
  };

  await sdb.doc(WA_SECRET).set(
    { token: seal(token), appSecret: seal(app.appSecret), pin: seal(pin), updatedBy: ctx.uid },
    { merge: true },
  );
  await sdb.doc(WA_LINE).set(line);
  await idxRef.set({ wid, verifyToken: line.verifyToken, atMs: Date.now() });
  await db.collection('auditLogs').add({
    type: 'whatsapp.onboarded',
    actor: ctx.uid,
    wid,
    phoneNumberId,
    wabaId,
    createdAt: new Date(),
  });

  return {
    ok: true,
    line,
    needsTemplate: !line.templateName,
    webhookUrl: `${functionsBase()}/agentWhatsappWebhook`,
  };
});
