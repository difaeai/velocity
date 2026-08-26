/**
 * The two endpoints WhatsApp alerts need: the driver's consent switch, and
 * Meta's webhook.
 *
 * Both exist to serve the same rule — that a person controls whether a business
 * messages them, and that when they say stop, it stops immediately and without
 * them having to ask twice. Everything else in this feature is a frequency cap;
 * these two are the consent itself.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { logger } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireRole } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import {
  blockDriverNumber,
  optInDriverByPhone,
  optOutDriverByPhone,
  tripCircuitBreaker,
} from './alerts';
import { classifySendError, toWhatsAppNumber, whatsAppConfig } from './client';
import { readInboundIntent } from './policy';

const prefSchema = z.object({
  enabled: z.boolean(),
  /**
   * Optional override for which number the alerts go to. Defaults to the
   * number on the driver's profile, which is the one they signed up with.
   */
  phone: z.string().max(24).nullish(),
});

/**
 * The driver's own switch. This callable is the ONLY thing in the codebase that
 * may set `optIn` to true.
 *
 * That restriction is the feature's foundation: an admin tool, a migration or a
 * well-meant "enable it for everyone in Rawalpindi" script would each be an
 * unsolicited WhatsApp campaign, which is both a policy violation and the
 * fastest way to lose the number. Consent comes from the person or not at all.
 */
export const setWhatsAppAlerts = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const parsed = prefSchema.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Send { enabled: true | false }.');

  await rateLimit(ctx.uid, 'setWhatsAppAlerts', 20, 3600);

  const ref = db.doc(`drivers/${ctx.uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Complete your driver profile first.');

  if (!parsed.data.enabled) {
    // Turning it off is unconditional and instant. It never fails validation,
    // never asks a follow-up question, and never needs a working phone number:
    // whatever state the record is in, "stop messaging me" must succeed.
    await ref.set(
      {
        whatsappAlerts: {
          optIn: false,
          optOutAt: FieldValue.serverTimestamp(),
          optOutSource: 'app',
        },
      },
      { merge: true },
    );
    return { ok: true, enabled: false };
  }

  // Three places a number can come from, in descending order of how
  // deliberately the driver chose it. The last fallback matters: a driver who
  // signed in with a phone number and never typed one into the onboarding form
  // has a perfectly good number on their user record, and telling them to "add
  // a mobile number" would be nonsense to somebody who signed up with one.
  let phone = toWhatsAppNumber(parsed.data.phone ?? (snap.get('phone') as string | undefined));
  if (!phone) {
    const userSnap = await db.doc(`users/${ctx.uid}`).get();
    phone = toWhatsAppNumber(userSnap.get('phoneNumber') as string | undefined);
  }
  if (!phone) {
    throw new HttpsError(
      'failed-precondition',
      'Add a valid Pakistani mobile number to your profile first (03XX XXXXXXX).',
    );
  }

  await ref.set(
    {
      whatsappAlerts: {
        optIn: true,
        number: phone,
        optInAt: FieldValue.serverTimestamp(),
        optInSource: 'app',
        // Switching alerts on is a fresh grant of consent, so it clears an
        // earlier block — including one Meta set because the number bounced.
        // If the number is still bad the next send will simply block it again.
        blocked: false,
        blockedReason: FieldValue.delete(),
      },
    },
    { merge: true },
  );
  return { ok: true, enabled: true, number: maskNumber(phone) };
});

/** `923001234567` → `+92 300 ****567`, for showing the driver what we have. */
export function maskNumber(n: string): string {
  return `+${n.slice(0, 2)} ${n.slice(2, 5)} ****${n.slice(-3)}`;
}

/**
 * Meta's webhook: delivery outcomes in, and driver replies in.
 *
 * This endpoint is the early-warning system. A message that fails, a driver who
 * types STOP, a number that turns out not to be on WhatsApp — each one arrives
 * here, and each one changes what the next fan-out is allowed to do. Without it
 * the sender would keep making the same mistake at the same rate, which is
 * precisely the behaviour that gets a business number restricted.
 *
 * It always answers 200. Meta retries non-2xx responses with backoff and
 * eventually disables a webhook that keeps failing, and a disabled webhook
 * means opt-outs stop arriving — the worst possible thing to break.
 */
export const whatsappWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (request, response) => {
    const cfg = whatsAppConfig();

    // ── Subscription handshake ──
    // Meta GETs this once when the webhook is registered and expects the
    // challenge echoed back verbatim, as text.
    if (request.method === 'GET') {
      const q = request.query as Record<string, string | undefined>;
      const token = cfg?.verifyToken;
      if (token && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === token) {
        response.status(200).send(q['hub.challenge'] ?? '');
        return;
      }
      response.status(403).send('forbidden');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).send('method not allowed');
      return;
    }

    // Anyone can POST to a public URL. The signature is what separates Meta
    // from someone who found the endpoint and would like to opt every driver
    // out — or, worse, opt somebody in.
    if (!verifySignature(request, cfg?.appSecret)) {
      logger.warn('WhatsApp webhook: bad signature');
      response.status(401).send('bad signature');
      return;
    }

    try {
      await handleWebhookBody(request.body);
    } catch (err) {
      // Swallowed deliberately: see the 200-always note above. A crash here
      // would make Meta retry the same payload, and a payload that crashes us
      // once will crash us every time.
      logger.error('WhatsApp webhook: handler failed', { err });
    }
    response.status(200).send('ok');
  },
);

/**
 * Confirms the payload really came from Meta.
 *
 * `X-Hub-Signature-256` is an HMAC of the RAW body — which is why this reads
 * `request.rawBody` rather than re-serialising `request.body`. JSON.stringify
 * of a parsed object is not byte-identical to what was sent, so verifying
 * against it fails for any payload with non-ASCII in it. Urdu opt-outs are
 * exactly that payload.
 */
export function verifySignature(
  request: { rawBody?: Buffer; headers: Record<string, unknown> },
  appSecret: string | undefined,
): boolean {
  // No secret configured means we cannot tell Meta from anyone else, so nothing
  // is trusted. Fail closed: the cost is a feature that does not work until it
  // is configured, versus an open endpoint that edits driver consent.
  if (!appSecret) return false;

  const header = request.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const raw = request.rawBody;
  if (!raw) return false;

  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  const got = header.slice('sha256='.length);
  if (got.length !== expected.length) return false;
  // Constant-time: a plain === leaks how much of the digest matched, which is
  // enough to forge one byte at a time.
  return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'));
}

interface WebhookValue {
  messages?: { from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }[];
  statuses?: {
    status?: string;
    recipient_id?: string;
    errors?: { code?: number; title?: string }[];
  }[];
}

/** Walks Meta's nested envelope and acts on each thing it carries. */
export async function handleWebhookBody(body: unknown): Promise<void> {
  const entries = (body as { entry?: { changes?: { value?: WebhookValue }[] }[] } | null)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      for (const msg of value.messages ?? []) await handleInbound(msg);
      for (const st of value.statuses ?? []) await handleStatus(st);
    }
  }
}

async function handleInbound(msg: NonNullable<WebhookValue['messages']>[number]): Promise<void> {
  const from = msg.from;
  if (!from) return;
  // A quick-reply button carries its label rather than a text body — the
  // template's own "Stop alerts" button arrives this way, and it is the path
  // most drivers will actually use, so it has to be read the same as typing it.
  const text = msg.text?.body ?? msg.button?.text ?? '';
  const intent = readInboundIntent(text);
  if (intent === 'stop') {
    const found = await optOutDriverByPhone(from, 'driver replied STOP');
    if (!found) logger.info('WhatsApp: STOP from an unknown number', { from: from.slice(-4) });
    return;
  }
  if (intent === 'start') {
    await optInDriverByPhone(from);
  }
  // Anything else is a driver talking to us. Nothing to do here — but the reply
  // has opened a 24-hour service window with them, which is exactly when a
  // human on the support desk can answer without a template.
}

async function handleStatus(st: NonNullable<WebhookValue['statuses']>[number]): Promise<void> {
  if (st.status !== 'failed') return;
  const code = st.errors?.[0]?.code ?? null;
  const action = classifySendError(code);
  const to = st.recipient_id;

  if (action === 'halt') {
    await tripCircuitBreaker(st.errors?.[0]?.title ?? `status error ${code}`, code);
    return;
  }
  if (action === 'drop-recipient' && to) {
    // Undeliverable is asynchronous: the send returned 200 and the failure
    // arrives here minutes later. Without this branch the same dead number gets
    // retried on every ride for ever, and undeliverables are a spam signal.
    const uid = await uidForNumber(to);
    if (uid) await blockDriverNumber(uid, `undeliverable (${code})`);
  }
}

async function uidForNumber(number: string): Promise<string | null> {
  const normalised = toWhatsAppNumber(number);
  if (!normalised) return null;
  const snap = await db
    .collection('drivers')
    .where('whatsappAlerts.number', '==', normalised)
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0]?.id ?? null);
}
