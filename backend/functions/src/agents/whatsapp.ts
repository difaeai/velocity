/**
 * The AI agent on WhatsApp: it answers the business's WhatsApp, learns what
 * the person wants, and closes — takes the order or books the meeting — or
 * hands the chat to a person.
 *
 * Each workspace connects ITS OWN WhatsApp Business number (phone number ID,
 * a permanent token and the Meta app's secret), and points that app's webhook
 * at `agentWhatsappWebhook` with the verify token shown on the Sales page.
 * Velocity's own sign-in / driver-alert number is refused here on purpose: a
 * sales line that gets reported would take the login codes down with it.
 *
 * What it may send, and why it is this little:
 *  - A reply to someone who wrote in the last 24 hours (WhatsApp's service
 *    window) — the AI's answers and the owner's.
 *  - ONE approved template to a lead who said yes on a call ("send me the
 *    details on WhatsApp") — the sweep sends it.
 * Nothing else. No cold first message and no broadcast: that is what gets a
 * business number restricted, and "stop" is honoured at once.
 */
import { randomBytes } from 'node:crypto';

import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { getSales, seller, SALES_LEADS, type CallAgent, type LeadDoc } from '../sales';
import { generateJson, modelReady } from '../social/engine';
import { open, seal, tokenVaultReady, type SealedSecret } from '../social/secrets';
import { getSocialSettings } from '../social/settings';
import { HOUSE, currentWorkspace } from '../social/scope';
import { deskCall, inWorkspace, sdb } from '../social/workspace';
import { GRAPH_VERSION, postMessage } from '../whatsapp/client';
import { verifySignature } from '../whatsapp';
import { readInboundIntent } from '../whatsapp/policy';
import { allowance } from './billing';
import { WA_INTENTS, whatsappInstruction, whatsappPrompt, type AgentSetup, type WaIntent } from './prompt';
import { THREADS, WA_INDEX, WA_LINE, WA_SECRET, addUsage, agentPlanOf, functionsBase, pathIn, rateCard, usageNow } from './store';

/** The connected line, as the Sales page shows it. Never a token. */
export interface WaLine {
  phoneNumberId: string;
  displayNumber: string;
  verifiedName: string;
  templateName: string;
  templateLang: string;
  /** The template's body has one {{1}}, filled with the lead's name. */
  templateHasName: boolean;
  autoReply: boolean;
  /** Which calling agent's name, goal and knowledge answer on WhatsApp. */
  agentId: string | null;
  verifyToken: string;
  connectedAtMs: number;
}

export interface ThreadMessage {
  from: 'them' | 'us';
  text: string;
  atMs: number;
  by: 'them' | 'ai' | 'owner' | 'template';
}

/** Messages kept on a thread; older ones fall off. */
const KEEP = 100;
/** WhatsApp's customer-service window. */
const WINDOW_MS = 24 * 3600_000;

async function lineAndToken(): Promise<{ line: WaLine; token: string } | null> {
  const [l, s] = await Promise.all([sdb.doc(WA_LINE).get(), sdb.doc(WA_SECRET).get()]);
  const line = l.data() as WaLine | undefined;
  const sealed = s.data()?.token as SealedSecret | undefined;
  if (!line?.phoneNumberId || !sealed) return null;
  return { line, token: open(sealed) };
}

/** A WhatsApp id (digits, country code first) from an E.164 or local number. Pure. */
export const waIdOf = (phone: string): string => phone.replace(/\D/g, '').replace(/^0(?=3\d{9}$)/, '92');

/** Add messages to a thread, keeping the newest `KEEP`. */
async function append(waId: string, msgs: ThreadMessage[], patch: Record<string, unknown> = {}): Promise<ThreadMessage[]> {
  const ref = sdb.doc(`${THREADS}/${waId}`);
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as { messages?: ThreadMessage[] } | undefined;
    const messages = [...(cur?.messages ?? []), ...msgs].slice(-KEEP);
    tx.set(ref, { waId, messages, updatedAtMs: Date.now(), ...patch }, { merge: true });
    return messages;
  });
}

async function sendText(line: WaLine, token: string, to: string, body: string) {
  return postMessage(
    { token, phoneNumberId: line.phoneNumberId },
    { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } },
  );
}

/** The agent that answers WhatsApp: the one chosen, else the first switched on, else a plain assistant. */
function answeringAgent(agents: CallAgent[], id: string | null): AgentSetup {
  return (
    agents.find((a) => a.id === id) ??
    agents.find((a) => a.active) ?? { id: 'assistant', name: 'Assistant', voice: 'female', language: 'mixed', goal: '', opener: '', points: '' }
  );
}

/** What the reply's intent does to the lead. Pure. */
export function leadAfterChat(intent: WaIntent): { status?: LeadDoc['status']; doNotContact?: boolean } {
  if (intent === 'deal') return { status: 'won' };
  if (intent === 'meeting' || intent === 'interested') return { status: 'replied' };
  if (intent === 'not_interested') return { status: 'lost' };
  if (intent === 'stop') return { status: 'lost', doNotContact: true };
  return {};
}

/** One message from a person, inside its workspace. */
async function onMessage(line: WaLine, token: string, waId: string, name: string, text: string): Promise<void> {
  const wid = currentWorkspace();
  const ref = sdb.doc(`${THREADS}/${waId}`);
  const before = (await ref.get()).data() as
    | { leadId?: string | null; mode?: 'ai' | 'human'; optedOut?: boolean }
    | undefined;
  const now = Date.now();
  const messages = await append(waId, [{ from: 'them', text, atMs: now, by: 'them' }], {
    name: name || FieldValue.delete(),
    lastInAtMs: now,
    unread: FieldValue.increment(1),
    mode: before?.mode ?? 'ai',
  });
  await addUsage(wid, { waIn: 1 });

  const leadId = before?.leadId ?? null;
  const leadRef = leadId ? sdb.doc(`${SALES_LEADS}/${leadId}`) : null;

  // "Stop" in its first word: never another message, and no AI reply to it either.
  if (readInboundIntent(text) === 'stop') {
    await ref.update({ optedOut: true, needsOwner: false, intent: 'stop' });
    if (leadRef) await leadRef.update({ doNotContact: true, status: 'lost' }).catch(() => undefined);
    return;
  }
  if (!line.autoReply || before?.mode === 'human' || before?.optedOut) {
    await ref.update({ needsOwner: true });
    return;
  }
  const [plan, used] = await Promise.all([agentPlanOf(wid), usageNow(wid)]);
  const no = allowance(plan, used, 'whatsapp', now, wid === HOUSE);
  if (no || !modelReady()) {
    await ref.update({ needsOwner: true, note: no ?? 'No AI model is available right now.' });
    return;
  }

  const s = await getSales();
  const agent = answeringAgent(s.callAgents as CallAgent[], line.agentId);
  const lead = leadRef ? ((await leadRef.get()).data() as LeadDoc | undefined) : undefined;
  let reply = '';
  let intent: WaIntent = 'question';
  let deal = '';
  try {
    const { data } = await generateJson<{ reply?: unknown; intent?: unknown; deal?: unknown }>({
      model: (await getSocialSettings()).textModel,
      system: whatsappInstruction(agent, seller(s), lead ?? null),
      prompt: whatsappPrompt(messages.map((m) => ({ from: m.from, text: m.text }))),
      what: 'WhatsApp reply',
    });
    reply = typeof data.reply === 'string' ? data.reply.trim().slice(0, 1000) : '';
    intent = WA_INTENTS.includes(data.intent as WaIntent) ? (data.intent as WaIntent) : 'question';
    deal = typeof data.deal === 'string' ? data.deal.trim().slice(0, 1000) : '';
  } catch (e) {
    logger.warn('agents: no WhatsApp reply was written', { message: (e as Error).message });
  }
  if (!reply) {
    await ref.update({ needsOwner: true, note: 'The AI could not write a reply.' });
    return;
  }

  const sent = await sendText(line, token, waId, reply);
  if (!sent.ok) {
    await ref.update({ needsOwner: true, note: `WhatsApp refused the reply: ${sent.detail}`.slice(0, 300) });
    return;
  }
  const card = await rateCard();
  await append(waId, [{ from: 'us', text: reply, atMs: Date.now(), by: 'ai' }], {
    lastOutAtMs: Date.now(),
    intent,
    ...(deal ? { deal } : {}),
    // Closed, or out of its depth: either way the owner should look.
    needsOwner: intent === 'deal' || intent === 'meeting' || intent === 'human',
    ...(intent === 'human' ? { mode: 'human' } : {}),
    ...(intent === 'stop' ? { optedOut: true } : {}),
  });
  await addUsage(wid, { waOut: 1, aiReplies: 1, costUsd: card.cost.waMessage + card.cost.aiReply });
  const change = leadAfterChat(intent);
  if (leadRef && (change.status || change.doNotContact)) {
    const cur = lead?.status;
    // A won lead stays won; anything else moves.
    if (cur !== 'won') await leadRef.update({ ...change, ...(deal ? { deal } : {}) }).catch(() => undefined);
  }
}

/** Meta's webhook for every workspace's agent line. Always 200 once the signature is good. */
export const agentWhatsappWebhook = onRequest({ cors: false, invoker: 'public', timeoutSeconds: 120 }, async (req, res) => {
  if (req.method === 'GET') {
    const q = req.query as Record<string, string | undefined>;
    const token = q['hub.verify_token'] ?? '';
    const match =
      q['hub.mode'] === 'subscribe' && /^[A-Za-z0-9_-]{16,80}$/.test(token)
        ? await db.collection(WA_INDEX).where('verifyToken', '==', token).limit(1).get()
        : null;
    if (match && !match.empty) res.status(200).send(q['hub.challenge'] ?? '');
    else res.status(403).send('forbidden');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).send('method not allowed');
    return;
  }

  type Value = {
    metadata?: { phone_number_id?: string };
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
    messages?: { from?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
  };
  const values: Value[] = [];
  for (const entry of (req.body?.entry ?? []) as { changes?: { value?: Value }[] }[]) {
    for (const change of entry.changes ?? []) if (change.value) values.push(change.value);
  }
  const pnid = values.find((v) => v.metadata?.phone_number_id)?.metadata?.phone_number_id ?? '';
  if (!/^\d{5,30}$/.test(pnid)) {
    res.status(200).send('ok');
    return;
  }
  const idx = (await db.doc(`${WA_INDEX}/${pnid}`).get()).data() as { wid?: string } | undefined;
  if (!idx?.wid) {
    res.status(200).send('ok');
    return;
  }
  const wid = idx.wid;
  const secret = (await db.doc(pathIn(wid, WA_SECRET)).get()).data()?.appSecret as SealedSecret | undefined;
  if (!secret || !verifySignature(req, open(secret))) {
    logger.warn('agents: WhatsApp webhook with a bad signature', { pnid });
    res.status(401).send('bad signature');
    return;
  }

  try {
    await inWorkspace(wid, async () => {
      const lt = await lineAndToken();
      if (!lt) return;
      for (const v of values) {
        if (v.metadata?.phone_number_id !== pnid) continue;
        for (const m of v.messages ?? []) {
          const from = String(m.from ?? '');
          if (!/^\d{6,20}$/.test(from)) continue;
          const text =
            m.text?.body ??
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            `[${m.type ?? 'message'}]`;
          const name = v.contacts?.find((c) => c.wa_id === from)?.profile?.name ?? '';
          await onMessage(lt.line, lt.token, from, name.slice(0, 80), text.slice(0, 2000));
        }
      }
    });
  } catch (e) {
    // 200 regardless: Meta retries a failure, and a message that crashes once crashes every time.
    logger.error('agents: WhatsApp webhook failed', { wid, message: (e as Error).message });
  }
  res.status(200).send('ok');
});

/** Meta's health mark for a number: only GREEN (or not rated yet) may open a new chat. Pure. */
export function mayOpenChat(rating: string | undefined): boolean {
  return !rating || rating === 'GREEN' || rating === 'UNKNOWN' || rating === 'NA';
}

/**
 * After a call where they said yes to WhatsApp: the one approved template that
 * opens the conversation. Returns false when it could not go.
 */
export async function sendCallFollowUp(call: { to: string; leadId: string; leadName: string }): Promise<{ ok: boolean; error?: string }> {
  const lt = await lineAndToken();
  if (!lt) return { ok: false, error: 'No WhatsApp line is connected.' };
  const { line, token } = lt;
  if (!line.templateName) return { ok: false, error: 'No approved template is set on the WhatsApp line.' };
  // Meta marks a number YELLOW or RED once people report or block it; opening more chats then is how it gets restricted.
  const health = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${line.phoneNumberId}?fields=quality_rating`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => r.json() as Promise<{ quality_rating?: string }>)
    .catch(() => ({}) as { quality_rating?: string });
  if (!mayOpenChat(health.quality_rating)) {
    return {
      ok: false,
      error: `WhatsApp rates this number ${health.quality_rating}: no new chats are opened until it is green again, so it is not restricted.`,
    };
  }
  const waId = waIdOf(call.to);
  const first = call.leadName.split(/\s+/)[0] ?? call.leadName;
  const sent = await postMessage(
    { token, phoneNumberId: line.phoneNumberId },
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waId,
      type: 'template',
      template: {
        name: line.templateName,
        language: { code: line.templateLang || 'en' },
        components: line.templateHasName ? [{ type: 'body', parameters: [{ type: 'text', text: first.slice(0, 60) }] }] : [],
      },
    },
  );
  if (!sent.ok) return { ok: false, error: sent.detail };
  const card = await rateCard();
  await append(waId, [{ from: 'us', text: `[Template: ${line.templateName}]`, atMs: Date.now(), by: 'template' }], {
    leadId: call.leadId,
    name: call.leadName,
    lastOutAtMs: Date.now(),
    mode: 'ai',
  });
  await addUsage(currentWorkspace(), { waTemplates: 1, costUsd: card.cost.waTemplate });
  await sdb.doc(`${SALES_LEADS}/${call.leadId}`).update({ waId }).catch(() => undefined);
  return { ok: true };
}

// ── callables ───────────────────────────────────────────────────────────────

const lineSchema = z.object({
  phoneNumberId: z.string().regex(/^\d{5,30}$/),
  /** Only sent when it changes; never read back. */
  token: z.string().trim().min(20).max(1000).optional(),
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/i).optional(),
  templateName: z.string().trim().regex(/^[a-z0-9_]{0,512}$/),
  templateLang: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
  templateHasName: z.boolean(),
  autoReply: z.boolean(),
  agentId: z.string().regex(/^[a-z0-9-]{3,40}$/).nullable(),
});

/** Connect (or change) this workspace's WhatsApp line, after proving the token. */
export const agentSaveWhatsApp = deskCall('sales', { timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = lineSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Check the WhatsApp details — something is not valid.');
  const p = parsed.data;
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'Tokens cannot be stored safely right now.');
  if (p.phoneNumberId === (process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim()) {
    throw new HttpsError(
      'failed-precondition',
      'That number sends Velocity’s sign-in codes and driver alerts. Connect a separate WhatsApp number for sales, so a reported sales chat can never take the sign-in down.',
    );
  }
  const wid = currentWorkspace();
  const idxRef = db.doc(`${WA_INDEX}/${p.phoneNumberId}`);
  const idx = (await idxRef.get()).data() as { wid?: string } | undefined;
  if (idx?.wid && idx.wid !== wid) throw new HttpsError('already-exists', 'That WhatsApp number is connected to another workspace.');

  const secretRef = sdb.doc(WA_SECRET);
  const stored = (await secretRef.get()).data() as { token?: SealedSecret; appSecret?: SealedSecret } | undefined;
  const token = p.token ?? (stored?.token ? open(stored.token) : '');
  if (!token) throw new HttpsError('invalid-argument', 'Add the permanent access token.');
  if (!p.appSecret && !stored?.appSecret) throw new HttpsError('invalid-argument', 'Add the Meta app secret — it is how messages are proved to come from Meta.');

  // Proved before it is kept: the number must answer to this token.
  const check = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${p.phoneNumberId}?fields=display_phone_number,verified_name`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  ).catch((e: Error) => ({ ok: false, json: async () => ({ error: { message: e.message } }) }) as unknown as Response);
  const info = (await check.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string } };
  if (!check.ok) throw new HttpsError('failed-precondition', `Meta refused that number and token: ${info.error?.message ?? 'unknown error'}`);

  const prev = (await sdb.doc(WA_LINE).get()).data() as WaLine | undefined;
  if (prev?.phoneNumberId && prev.phoneNumberId !== p.phoneNumberId) await db.doc(`${WA_INDEX}/${prev.phoneNumberId}`).delete();
  const line: WaLine = {
    phoneNumberId: p.phoneNumberId,
    displayNumber: info.display_phone_number ?? '',
    verifiedName: info.verified_name ?? '',
    templateName: p.templateName,
    templateLang: p.templateLang,
    templateHasName: p.templateHasName,
    autoReply: p.autoReply,
    agentId: p.agentId,
    verifyToken: prev?.verifyToken || randomBytes(18).toString('base64url'),
    connectedAtMs: prev?.connectedAtMs || Date.now(),
  };
  await secretRef.set(
    { ...(p.token ? { token: seal(p.token) } : {}), ...(p.appSecret ? { appSecret: seal(p.appSecret) } : {}), updatedBy: ctx.uid },
    { merge: true },
  );
  await sdb.doc(WA_LINE).set(line);
  await idxRef.set({ wid, verifyToken: line.verifyToken, atMs: Date.now() });
  return { ok: true, line, webhookUrl: `${functionsBase()}/agentWhatsappWebhook` };
});

/** Disconnect this workspace's WhatsApp line. */
export const agentDisconnectWhatsApp = deskCall('sales', async () => {
  const line = (await sdb.doc(WA_LINE).get()).data() as WaLine | undefined;
  if (line?.phoneNumberId) await db.doc(`${WA_INDEX}/${line.phoneNumberId}`).delete();
  await Promise.all([sdb.doc(WA_LINE).delete(), sdb.doc(WA_SECRET).delete()]);
  return { ok: true };
});

/** The owner, in a chat: send a message, take over from the AI, hand back, mark read. */
export const agentThreadAction = deskCall('sales', { timeoutSeconds: 60 }, async (req) => {
  const parsed = z
    .object({
      waId: z.string().regex(/^\d{6,20}$/),
      action: z.enum(['send', 'takeover', 'handback', 'read']),
      text: z.string().trim().min(1).max(1000).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { waId, action, text } = parsed.data;
  const ref = sdb.doc(`${THREADS}/${waId}`);
  const thread = (await ref.get()).data() as { lastInAtMs?: number; optedOut?: boolean } | undefined;
  if (!thread) throw new HttpsError('not-found', 'No such chat.');

  if (action === 'takeover') await ref.update({ mode: 'human', needsOwner: false });
  if (action === 'handback') await ref.update({ mode: 'ai', needsOwner: false });
  if (action === 'read') await ref.update({ unread: 0, needsOwner: false });
  if (action === 'send') {
    if (!text) throw new HttpsError('invalid-argument', 'Write the message.');
    if (thread.optedOut) throw new HttpsError('failed-precondition', 'They asked not to be messaged again.');
    if (!thread.lastInAtMs || Date.now() - thread.lastInAtMs > WINDOW_MS) {
      throw new HttpsError('failed-precondition', 'More than 24 hours since they last wrote: WhatsApp only allows an approved template now.');
    }
    const lt = await lineAndToken();
    if (!lt) throw new HttpsError('failed-precondition', 'Connect the WhatsApp line first.');
    const sent = await sendText(lt.line, lt.token, waId, text);
    if (!sent.ok) throw new HttpsError('unavailable', `WhatsApp refused it: ${sent.detail}`);
    const card = await rateCard();
    await append(waId, [{ from: 'us', text, atMs: Date.now(), by: 'owner' }], { lastOutAtMs: Date.now(), unread: 0, needsOwner: false });
    await addUsage(currentWorkspace(), { waOut: 1, costUsd: card.cost.waMessage });
  }
  return { ok: true };
});
