/**
 * AI phone calls: the agent dials a lead and talks to them itself.
 *
 * The path of one call:
 *   1. `placeCall` (the Call button, or the sweep) checks hours, caps and the
 *      package, writes `agentCalls/{id}` and asks Twilio to ring the lead.
 *   2. They pick up: Twilio asks `agentVoiceAnswer`, which answers with TwiML
 *      that streams the call's audio to the voice bridge (Cloud Run).
 *   3. The bridge asks `agentVoiceSession` for a one-use Gemini Live token,
 *      locked to this call's instructions, and joins the two streams.
 *   4. When the agent calls `finish_call` (or anyone hangs up) the bridge posts
 *      the transcript and the outcome to `agentVoiceResult`.
 *   5. Twilio posts the final duration to `agentVoiceStatus`, which prices the
 *      call onto `agentUsage` and the AI meter.
 *
 * Twilio's two webhooks are checked against Twilio's signature; the bridge's
 * two carry a random per-call key that never leaves the server side
 * (`agentCallKeys`, which no rule opens). The Gemini key never leaves this
 * file: the bridge only ever holds a token that works once, for this call.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { geminiKey, loadAi } from '../ai/config';
import { LIVE_USD_PER_MIN, recordAi } from '../ai/usage';
import { db, FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { getSales, seller, SALES_LEADS, type CallAgent, type LeadDoc, type LeadStatus } from '../sales';
import { deskCall, inWorkspace, sdb } from '../social/workspace';
import { HOUSE, currentWorkspace } from '../social/scope';
import { allowance, callCostUsd } from './billing';
import { CALL_MAX_SEC, CALL_MODEL, CALL_RESULTS, callInstruction, callSetup, type CallResult } from './prompt';
import {
  CALL_KEYS,
  CALLS,
  addUsage,
  agentPlanOf,
  bridgeUrl,
  functionsBase,
  numberFor,
  pathIn,
  rateCard,
  telephony,
  usageNow,
} from './store';
import { createCall, dialable, validTwilioRequest, xmlAttr } from './twilio';

const idRe = /^[A-Za-z0-9_-]{1,64}$/;

/** Pakistan's hour of the day, 0–23. */
export const pktHour = (ms = Date.now()): number => new Date(ms + 5 * 3600_000).getUTCHours();

/** True when `hour` falls in an agent's calling window (to is exclusive; 24 means midnight). Pure. */
export function inHours(agent: Pick<CallAgent, 'hoursFrom' | 'hoursTo'>, hour: number): boolean {
  return agent.hoursFrom <= agent.hoursTo ? hour >= agent.hoursFrom && hour < agent.hoursTo : hour >= agent.hoursFrom || hour < agent.hoursTo;
}

/** Start of today in Pakistan, as epoch ms. */
const pktDayStart = (ms = Date.now()): number => {
  const d = new Date(ms + 5 * 3600_000);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - 5 * 3600_000;
};

export class CallRefused extends Error {}

/** Ring one lead with one agent. Throws `CallRefused` with a reason a person can act on. */
export async function placeCall(leadId: string, agentId: string, by: string): Promise<{ callId: string }> {
  const wid = currentWorkspace();
  const bridge = bridgeUrl();
  if (!bridge) throw new CallRefused('AI calling is not switched on yet: the voice bridge has not been deployed.');
  const { settings: tel, auth } = await telephony();
  if (!auth) throw new CallRefused('No phone line is connected yet. A Velocity admin connects Twilio on AI agents & billing.');

  const s = await getSales();
  const agent = s.callAgents.find((a) => a.id === agentId) as CallAgent | undefined;
  if (!agent) throw new CallRefused('Set up that calling agent first.');
  if (!agent.active) throw new CallRefused(`${agent.name} is switched off.`);
  if (agent.mode !== 'ai') throw new CallRefused(`${agent.name} writes scripts for a person to read. Switch it to "AI dials" first.`);
  const from = numberFor(tel, wid, agentId);
  if (!from) throw new CallRefused(`${agent.name} has no phone number yet. A Velocity admin gives it one on AI agents & billing.`);
  if (!inHours(agent, pktHour())) {
    throw new CallRefused(`Outside ${agent.name}’s calling hours (${agent.hoursFrom}:00–${agent.hoursTo}:00 Pakistan time).`);
  }

  const leadRef = sdb.doc(`${SALES_LEADS}/${leadId}`);
  const lead = (await leadRef.get()).data() as LeadDoc | undefined;
  if (!lead) throw new CallRefused('No such lead.');
  if (lead.doNotContact) throw new CallRefused(`${lead.name} asked not to be contacted again.`);
  if (lead.status === 'won' || lead.status === 'lost') throw new CallRefused(`${lead.name} is already ${lead.status}.`);
  const to = dialable(lead.phone);
  if (!to) throw new CallRefused(`${lead.name} has no phone number that can be dialled.`);

  const [plan, used] = await Promise.all([agentPlanOf(wid), usageNow(wid)]);
  const no = allowance(plan, used, 'call', Date.now(), wid === HOUSE);
  if (no) throw new CallRefused(no);
  const agentToday = (
    await sdb.collection(CALLS).where('agentId', '==', agentId).where('createdAtMs', '>=', pktDayStart()).count().get()
  ).data().count;
  if (agentToday >= agent.dailyCap) throw new CallRefused(`${agent.name} has made today’s ${agent.dailyCap} calls.`);

  const ref = sdb.collection(CALLS).doc();
  const key = randomBytes(24).toString('base64url');
  const now = Date.now();
  await db.doc(`${CALL_KEYS}/${ref.id}`).set({ wid, key, sessionAtMs: null, resultAtMs: null, createdAtMs: now });
  await ref.set({
    wid,
    leadId,
    leadName: lead.name,
    agentId,
    agentName: agent.name,
    to,
    from: from.phone,
    state: 'dialing',
    twilioSid: null,
    by,
    createdAtMs: now,
    answeredAtMs: null,
    endedAtMs: null,
    seconds: 0,
    costUsd: 0,
    outcome: null,
    transcript: [],
    followUp: 'none',
    error: null,
  });

  const q = `wid=${encodeURIComponent(wid)}&callId=${ref.id}`;
  try {
    const call = await createCall(auth, {
      to,
      from: from.phone,
      answerUrl: `${functionsBase()}/agentVoiceAnswer?${q}`,
      statusUrl: `${functionsBase()}/agentVoiceStatus?${q}`,
      ringSeconds: 30,
      maxSeconds: CALL_MAX_SEC,
    });
    await ref.update({ twilioSid: call.sid });
  } catch (e) {
    await ref.update({ state: 'failed', error: (e as Error).message.slice(0, 300), endedAtMs: Date.now() });
    throw new CallRefused(`The phone line refused the call: ${(e as Error).message}`);
  }
  await Promise.all([
    addUsage(wid, { calls: 1 }),
    leadRef.update({ aiCalls: FieldValue.increment(1), lastCall: { atMs: now, outcome: 'calling' } }),
  ]);
  return { callId: ref.id };
}

/** The Call button on a lead. */
export const agentStartCall = deskCall('sales', { timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .object({ leadId: z.string().regex(/^[a-f0-9]{20}$/), agentId: z.string().regex(/^[a-z0-9-]{3,40}$/) })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  try {
    return { ok: true, ...(await placeCall(parsed.data.leadId, parsed.data.agentId, ctx.uid)) };
  } catch (e) {
    if (e instanceof CallRefused) throw new HttpsError('failed-precondition', e.message);
    throw e;
  }
});

/** wid + callId from a webhook's query string, or null. */
function callFrom(query: Record<string, unknown>): { wid: string; callId: string } | null {
  const wid = String(query.wid ?? '');
  const callId = String(query.callId ?? '');
  return idRe.test(wid) && idRe.test(callId) ? { wid, callId } : null;
}

/** True when this request is Twilio's, for exactly this URL. */
async function fromTwilio(fn: string, ids: { wid: string; callId: string }, req: { body: unknown; headers: Record<string, unknown> }): Promise<boolean> {
  const { auth } = await telephony();
  if (!auth) return false;
  const url = `${functionsBase()}/${fn}?wid=${encodeURIComponent(ids.wid)}&callId=${ids.callId}`;
  return validTwilioRequest(auth.authToken, url, (req.body ?? {}) as Record<string, unknown>, req.headers['x-twilio-signature']);
}

const twiml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

/** They picked up: stream the call to the bridge. */
export const agentVoiceAnswer = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const ids = callFrom(req.query as Record<string, unknown>);
  res.set('content-type', 'text/xml');
  if (!ids || !(await fromTwilio('agentVoiceAnswer', ids, req))) {
    res.status(403).send(twiml('<Hangup/>'));
    return;
  }
  const [callSnap, keySnap] = await Promise.all([db.doc(pathIn(ids.wid, `${CALLS}/${ids.callId}`)).get(), db.doc(`${CALL_KEYS}/${ids.callId}`).get()]);
  const key = keySnap.data()?.key as string | undefined;
  if (!callSnap.exists || !key || !bridgeUrl()) {
    res.send(twiml('<Hangup/>'));
    return;
  }
  await callSnap.ref.update({ state: 'live', answeredAtMs: Date.now() });
  res.send(
    twiml(
      `<Connect><Stream url="${xmlAttr(bridgeUrl())}">` +
        `<Parameter name="callId" value="${xmlAttr(ids.callId)}"/>` +
        `<Parameter name="wid" value="${xmlAttr(ids.wid)}"/>` +
        `<Parameter name="key" value="${xmlAttr(key)}"/>` +
        '</Stream></Connect>',
    ),
  );
});

/** The bridge's key for a call, checked in constant time. */
async function bridgeKeyOk(callId: string, key: unknown): Promise<DocumentSnapshot | null> {
  if (!idRe.test(callId) || typeof key !== 'string') return null;
  const snap = await db.doc(`${CALL_KEYS}/${callId}`).get();
  const want = Buffer.from(String(snap.data()?.key ?? ''));
  const got = Buffer.from(key);
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got) ? snap : null;
}

/** A one-use Live token, locked to this call's setup. */
async function mintToken(apiKey: string, setup: ReturnType<typeof callSetup>): Promise<string> {
  const now = Date.now();
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + (CALL_MAX_SEC + 120) * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      bidiGenerateContentSetup: setup,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`token HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const json = (await r.json()) as { name?: string };
  if (!json.name) throw new Error('token response had no name');
  return json.name;
}

/** The bridge, at the start of the stream: the Live token for this call, once. */
export const agentVoiceSession = onRequest({ cors: false, invoker: 'public', timeoutSeconds: 30 }, async (req, res) => {
  const body = (req.body ?? {}) as { callId?: string; key?: string };
  const keySnap = await bridgeKeyOk(String(body.callId ?? ''), body.key);
  if (!keySnap || req.method !== 'POST') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const wid = String(keySnap.get('wid'));
  // One session per call: a replayed request gets nothing.
  const first = await db.runTransaction(async (tx) => {
    const k = await tx.get(keySnap.ref);
    if (k.get('sessionAtMs')) return false;
    tx.update(keySnap.ref, { sessionAtMs: Date.now() });
    return true;
  });
  if (!first) {
    res.status(409).json({ error: 'already started' });
    return;
  }
  try {
    const out = await inWorkspace(wid, async () => {
      const call = (await sdb.doc(`${CALLS}/${body.callId}`).get()).data() as { agentId: string; leadId: string } | undefined;
      if (!call) throw new Error('no such call');
      const s = await getSales();
      const agent = s.callAgents.find((a) => a.id === call.agentId) as CallAgent | undefined;
      const lead = (await sdb.doc(`${SALES_LEADS}/${call.leadId}`).get()).data() as LeadDoc | undefined;
      if (!agent || !lead) throw new Error('the agent or the lead is gone');
      await loadAi();
      const apiKey = geminiKey('voice');
      if (!apiKey) throw new Error('no Gemini key for calls');
      const token = await mintToken(apiKey, callSetup(agent, callInstruction(agent, seller(s), lead)));
      return { token, model: CALL_MODEL, maxSeconds: CALL_MAX_SEC };
    });
    res.json(out);
  } catch (e) {
    logger.error('agents: could not start the voice session', { callId: body.callId, error: (e as Error).message });
    await db
      .doc(pathIn(wid, `${CALLS}/${body.callId}`))
      .update({ error: `Could not start the voice: ${(e as Error).message}`.slice(0, 300) })
      .catch(() => undefined);
    res.status(500).json({ error: 'could not start' });
  }
});

const resultSchema = z.object({
  callId: z.string().regex(idRe),
  key: z.string().min(10).max(100),
  transcript: z.array(z.object({ who: z.enum(['them', 'agent']), text: z.string().max(2000) })).max(400),
  result: z.enum(CALL_RESULTS).nullable(),
  summary: z.string().max(1500).default(''),
  whatsappOk: z.boolean().default(false),
  callbackWhen: z.string().max(300).default(''),
  deal: z.string().max(1500).default(''),
  /** Why the bridge ended without a result: Gemini closed, the line dropped. */
  error: z.string().max(300).optional(),
});

/** What a call's result does to its lead. Pure. */
export function leadAfterCall(result: CallResult | null, status: LeadStatus): { status: LeadStatus; doNotContact: boolean } {
  const done = status === 'won' || status === 'lost';
  switch (result) {
    case 'deal':
      return { status: 'won', doNotContact: false };
    case 'interested':
    case 'meeting':
    case 'callback':
      return { status: done ? status : 'replied', doNotContact: false };
    case 'not_interested':
    case 'wrong_number':
      return { status: done ? status : 'lost', doNotContact: false };
    case 'do_not_call':
      return { status: 'lost', doNotContact: true };
    default:
      return { status, doNotContact: false };
  }
}

/** The bridge, at the end of the stream: what was said and how it ended. Once per call. */
export const agentVoiceResult = onRequest({ cors: false, invoker: 'public', timeoutSeconds: 30 }, async (req, res) => {
  const parsed = resultSchema.safeParse(req.body ?? {});
  const keySnap = parsed.success ? await bridgeKeyOk(parsed.data.callId, parsed.data.key) : null;
  if (!parsed.success || !keySnap || req.method !== 'POST') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const r = parsed.data;
  const first = await db.runTransaction(async (tx) => {
    const k = await tx.get(keySnap.ref);
    if (k.get('resultAtMs')) return false;
    // The key has done its job; nothing can post for this call again.
    tx.update(keySnap.ref, { resultAtMs: Date.now(), key: FieldValue.delete() });
    return true;
  });
  if (!first) {
    res.status(409).json({ error: 'already recorded' });
    return;
  }
  const wid = String(keySnap.get('wid'));
  await inWorkspace(wid, async () => {
    const ref = sdb.doc(`${CALLS}/${r.callId}`);
    const call = (await ref.get()).data() as { leadId: string } | undefined;
    if (!call) return;
    const outcome = r.result
      ? { result: r.result, summary: r.summary, whatsappOk: r.whatsappOk, callbackWhen: r.callbackWhen, deal: r.deal }
      : null;
    await ref.update({
      transcript: r.transcript,
      outcome,
      ...(r.error ? { error: r.error } : {}),
      // WhatsApp goes only to someone who said yes on this call; the sweep sends it.
      followUp: r.result && r.whatsappOk && r.result !== 'do_not_call' ? 'pending' : 'none',
    });
    const leadRef = sdb.doc(`${SALES_LEADS}/${call.leadId}`);
    const lead = (await leadRef.get()).data() as LeadDoc | undefined;
    if (!lead) return;
    const next = leadAfterCall(r.result, lead.status);
    await leadRef.update({
      status: next.status,
      ...(next.doNotContact ? { doNotContact: true } : {}),
      lastCall: { atMs: Date.now(), outcome: r.result ?? 'no_result' },
      calls: FieldValue.arrayUnion({
        atMs: Date.now(),
        outcome: r.result ?? 'no_result',
        note: [r.summary, r.deal ? `Deal: ${r.deal}` : '', r.callbackWhen ? `Call back: ${r.callbackWhen}` : ''].filter(Boolean).join(' · ').slice(0, 300),
        by: 'ai',
      }),
    });
  });
  res.json({ ok: true });
});

const FINAL = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

/** Twilio's word for how a call ended, in ours. Pure. */
export function endState(twilioStatus: string, seconds: number): 'ended' | 'no-answer' | 'busy' | 'failed' {
  if (twilioStatus === 'completed') return seconds > 0 ? 'ended' : 'no-answer';
  if (twilioStatus === 'busy') return 'busy';
  if (twilioStatus === 'no-answer' || twilioStatus === 'canceled') return 'no-answer';
  return 'failed';
}

/** Twilio, as the call progresses: the final status prices the call. */
export const agentVoiceStatus = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const ids = callFrom(req.query as Record<string, unknown>);
  if (!ids || !(await fromTwilio('agentVoiceStatus', ids, req))) {
    res.status(403).send('forbidden');
    return;
  }
  const body = (req.body ?? {}) as Record<string, string>;
  const status = String(body.CallStatus ?? '');
  if (!FINAL.has(status)) {
    res.status(204).send();
    return;
  }
  const seconds = Math.max(0, Math.min(Number(body.CallDuration ?? 0) || 0, CALL_MAX_SEC + 60));
  const card = await rateCard();
  const costUsd = Math.round(callCostUsd(seconds, card) * 10_000) / 10_000;
  const ref = db.doc(pathIn(ids.wid, `${CALLS}/${ids.callId}`));
  const first = await db.runTransaction(async (tx) => {
    const c = await tx.get(ref);
    if (!c.exists || c.get('endedAtMs')) return null;
    tx.update(ref, { state: endState(status, seconds), seconds, costUsd, endedAtMs: Date.now() });
    return c.data() as { leadId: string };
  });
  if (first) {
    await addUsage(ids.wid, { answered: seconds > 0 ? 1 : 0, seconds, lineMin: Math.ceil(seconds / 60), costUsd });
    if (seconds > 0) {
      // `apart`: the agent package pays for calls, so they never use up the content month.
      void recordAi({ model: CALL_MODEL, usd: (seconds / 60) * LIVE_USD_PER_MIN, seconds, what: 'AI phone call', wid: ids.wid, apart: true });
    } else {
      // Nobody spoke: the bridge never ran, so the lead hears about it here.
      await db
        .doc(pathIn(ids.wid, `${SALES_LEADS}/${first.leadId}`))
        .update({ lastCall: { atMs: Date.now(), outcome: status === 'busy' ? 'busy' : 'no_answer' } })
        .catch(() => undefined);
    }
  }
  res.status(204).send();
});
