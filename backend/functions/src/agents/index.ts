/**
 * The AI agents' schedule, the admin box (AI agents & billing) and what a
 * customer's Sales page reads.
 *
 * Calls live in `calls.ts`, WhatsApp in `whatsapp.ts`, the money in
 * `billing.ts`. This file is the glue: the five-minute sweep, the Twilio
 * account and its numbers, the rate card, each customer's package, and the
 * month's numbers — what each customer cost us and what they pay.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { monthKey } from '../ai/config';
import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { getSales, SALES_LEADS, SALES_SETTINGS, type CallAgent, type LeadDoc } from '../sales';
import { seal, tokenVaultReady } from '../social/secrets';
import { HOUSE, currentWorkspace } from '../social/scope';
import { deskCall, forEachWorkspace, sdb } from '../social/workspace';
import { extendPaid, PERIOD_MS, type Workspace } from '../studio/plans';
import { DEFAULT_RATE_CARD, EMPTY_USAGE, quote, type AgentPackage, type AgentPlan, type AgentUsage, type RateCard } from './billing';
import { CallRefused, inHours, pktHour, placeCall } from './calls';
import { CALLS, RATE_CARD, TELEPHONY, TELEPHONY_SECRET, WA_LINE, agentPlanOf, bridgeUrl, functionsBase, pathIn, rateCard, telephony, usageNow, type NumberAssignment, type TelephonySettings } from './store';
import { buyNumber, fetchAccount, listNumbers, releaseNumber, searchNumbers, TwilioError } from './twilio';
import { sendCallFollowUp, type WaLine } from './whatsapp';

export { agentStartCall, agentVoiceAnswer, agentVoiceSession, agentVoiceResult, agentVoiceStatus } from './calls';
export { agentWhatsappWebhook, agentSaveWhatsApp, agentDisconnectWhatsApp, agentThreadAction } from './whatsapp';

const REGION = 'asia-south1';

/** Calls one agent may start in one sweep pass: a steady trickle, never a burst. */
const CALLS_PER_PASS = 2;
/** A no-answer is tried again once, after this long. */
const RETRY_AFTER_MS = 3 * 3600_000;
/** A call with no word from Twilio for this long is written off. */
const STALE_MS = 20 * 60_000;

/** Whether a lead is next in line for an AI call. Pure. */
export function dueForCall(lead: Pick<LeadDoc, 'status' | 'phone' | 'doNotContact' | 'lastCall' | 'aiCalls'>, nowMs: number): boolean {
  if (!lead.phone || lead.doNotContact) return false;
  if (!['new', 'drafted', 'sent'].includes(lead.status)) return false;
  const calls = lead.aiCalls ?? 0;
  if (calls === 0) return !lead.lastCall;
  const missed = lead.lastCall?.outcome === 'no_answer' || lead.lastCall?.outcome === 'busy';
  return calls < 2 && missed && nowMs - (lead.lastCall?.atMs ?? nowMs) > RETRY_AFTER_MS;
}

/** One workspace's pass: WhatsApp after calls, then the next calls, then clean-up. */
async function sweepOne(): Promise<void> {
  const now = Date.now();

  // 1. Details on WhatsApp for whoever said yes on a call.
  const pending = await sdb.collection(CALLS).where('followUp', '==', 'pending').limit(10).get();
  for (const doc of pending.docs) {
    const c = doc.data() as { to: string; leadId: string; leadName: string };
    const out = await sendCallFollowUp(c).catch((e: Error) => ({ ok: false, error: e.message }));
    await doc.ref.update({ followUp: out.ok ? 'sent' : 'failed', ...(out.ok ? {} : { followUpError: out.error?.slice(0, 300) ?? null }) });
  }

  // 2. Calls nobody heard back about (a lost webhook) stop counting as live.
  const stale = await sdb.collection(CALLS).where('state', 'in', ['dialing', 'live']).limit(20).get();
  for (const doc of stale.docs) {
    if (now - Number(doc.get('createdAtMs') ?? now) > STALE_MS) {
      await doc.ref.update({ state: 'failed', error: 'No word from the phone line.', endedAtMs: now });
    }
  }

  // 3. Agents set to ring new leads on their own.
  const s = await getSales();
  const dialers = (s.callAgents as CallAgent[]).filter((a) => a.active && a.mode === 'ai' && a.autoCall && inHours(a, pktHour(now)));
  if (!dialers.length || !bridgeUrl()) return;
  const leads = (await sdb.collection(SALES_LEADS).where('status', 'in', ['new', 'drafted', 'sent']).limit(200).get()).docs
    .map((d) => ({ id: d.id, lead: d.data() as LeadDoc }))
    .filter((x) => dueForCall(x.lead, now));
  for (const agent of dialers) {
    for (const { id } of leads.splice(0, CALLS_PER_PASS)) {
      try {
        await placeCall(id, agent.id, 'auto');
      } catch (e) {
        // A cap or the hours: this agent is done for this pass.
        if (e instanceof CallRefused) {
          logger.info('agents: auto-call held', { wid: currentWorkspace(), agent: agent.id, why: e.message });
          break;
        }
        logger.warn('agents: auto-call failed', { message: (e as Error).message });
      }
    }
  }
}

export const agentSweep = onSchedule({ schedule: 'every 5 minutes', region: REGION, timeoutSeconds: 300, memory: '512MiB' }, () =>
  forEachWorkspace('sales', sweepOne),
);

// ── what a customer's Sales page reads ───────────────────────────────────────

/** Package, usage, prices (never our costs), numbers and the line, for the caller's workspace. */
export const agentState = deskCall('sales', async () => {
  const wid = currentWorkspace();
  const [card, plan, used, tel, line] = await Promise.all([
    rateCard(),
    agentPlanOf(wid),
    usageNow(wid),
    telephony().catch(() => ({ settings: null, auth: null })),
    sdb.doc(WA_LINE).get(),
  ]);
  return {
    house: wid === HOUSE,
    plan,
    /** Read on the server: the console does not read the clock while drawing. */
    planLive: Boolean(plan && plan.paidUntilMs > Date.now()),
    usage: used.month,
    callsToday: used.callsToday,
    price: card.price,
    usdToPkr: card.usdToPkr,
    numbers: (tel.settings?.numbers ?? []).filter((n) => n.wid === wid).map((n) => ({ phone: n.phone, kind: n.kind, agentId: n.agentId })),
    phoneLine: Boolean(tel.auth),
    bridge: Boolean(bridgeUrl()),
    whatsapp: (line.data() as WaLine | undefined) ?? null,
    webhookUrl: `${functionsBase()}/agentWhatsappWebhook`,
  };
});

// ── the admin box ────────────────────────────────────────────────────────────

/** Everything AI agents & billing shows: the line, its numbers, the rate card, every customer's month. */
export const adminAgentsOverview = onCall(async (req) => {
  requireAdmin(req);
  const month = monthKey();
  const [tel, card, usage, wsSnap] = await Promise.all([
    telephony().catch(() => ({ settings: null, auth: null })),
    rateCard(),
    db.collection('agentUsage').where('month', '==', month).get(),
    db.collection('workspaces').get(),
  ]);
  const used = new Map(usage.docs.map((d) => [String(d.get('wid')), d.data() as Partial<AgentUsage>]));
  const workspaces = [{ id: HOUSE, name: 'Velocity Rides (house)', plan: null as AgentPlan | null, studioPlan: 'house' }].concat(
    wsSnap.docs.map((d) => {
      const w = d.data() as Workspace & { agentPlan?: AgentPlan };
      return { id: d.id, name: w.name, plan: w.agentPlan ?? null, studioPlan: w.plan };
    }),
  );
  const agents = await Promise.all(
    workspaces.map(async (w) => {
      const sales = (await db.doc(pathIn(w.id, SALES_SETTINGS)).get()).data() as { callAgents?: CallAgent[] } | undefined;
      return (sales?.callAgents ?? []).map((a) => ({ id: a.id, name: a.name, mode: a.mode ?? 'script', active: a.active }));
    }),
  );
  const numbers = tel.settings?.numbers ?? [];
  return {
    month,
    twilio: tel.settings ? { accountSid: tel.settings.accountSid, friendlyName: tel.settings.friendlyName, connectedAtMs: tel.settings.connectedAtMs, ok: Boolean(tel.auth) } : null,
    vaultReady: tokenVaultReady(),
    bridge: bridgeUrl(),
    numbers,
    card,
    defaults: DEFAULT_RATE_CARD,
    clients: workspaces
      .map((w, i) => {
        const u = { ...EMPTY_USAGE, ...(used.get(w.id) ?? {}) };
        const owned = numbers.filter((n) => n.wid === w.id && n.kind === 'twilio').length;
        // Our month: what calls and messages cost, plus the numbers they hold.
        const costUsd = Math.round((Number(u.costUsd ?? 0) + owned * card.cost.numberPerMonth) * 100) / 100;
        const billUsd = w.plan && w.plan.paidUntilMs > Date.now() ? w.plan.priceUsd : 0;
        return {
          ...w,
          planLive: Boolean(w.plan && w.plan.paidUntilMs > Date.now()),
          agents: agents[i],
          usage: u,
          numbers: numbers.filter((n) => n.wid === w.id).length,
          costUsd,
          billUsd,
          marginUsd: Math.round((billUsd - costUsd) * 100) / 100,
        };
      })
      .filter((c) => c.id === HOUSE || c.plan || c.agents.length || c.usage.calls || c.numbers),
  };
});

/** Connect the Twilio account, after proving the SID and token. */
export const adminAgentsConnectTwilio = onCall({ timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ accountSid: z.string().trim().regex(/^AC[a-f0-9]{32}$/), authToken: z.string().trim().regex(/^[a-f0-9]{32}$/) })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'The Account SID starts with AC; the Auth Token is 32 letters and digits.');
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'Tokens cannot be stored safely right now (SOCIAL_TOKEN_KEY is missing).');
  let account;
  try {
    account = await fetchAccount(parsed.data);
  } catch (e) {
    throw new HttpsError('failed-precondition', `Twilio refused those details: ${(e as Error).message}`);
  }
  const prev = (await db.doc(TELEPHONY).get()).data() as TelephonySettings | undefined;
  const owned = await listNumbers(parsed.data).catch(() => []);
  const keep = new Map((prev?.numbers ?? []).map((n) => [n.sid, n]));
  const numbers: NumberAssignment[] = owned.map((n) => ({ ...n, wid: keep.get(n.sid)?.wid ?? null, agentId: keep.get(n.sid)?.agentId ?? null }));
  await db.doc(TELEPHONY_SECRET).set({ authToken: seal(parsed.data.authToken), updatedAt: FieldValue.serverTimestamp() });
  await db.doc(TELEPHONY).set({ accountSid: parsed.data.accountSid, friendlyName: account.friendlyName, connectedAtMs: Date.now(), numbers });
  await db.collection('auditLogs').add({ type: 'agents.twilioConnected', actor: ctx.uid, detail: { accountSid: parsed.data.accountSid }, createdAt: FieldValue.serverTimestamp() });
  return { ok: true, friendlyName: account.friendlyName, status: account.status, type: account.type, numbers };
});

const numbersSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh') }),
  z.object({ action: z.literal('search'), country: z.string().regex(/^[A-Z]{2}$/) }),
  z.object({ action: z.literal('buy'), phone: z.string().regex(/^\+[1-9]\d{6,14}$/) }),
  z.object({ action: z.literal('release'), sid: z.string().regex(/^PN[a-f0-9]{32}$/) }),
  z.object({
    action: z.literal('assign'),
    sid: z.string().regex(/^(PN|CA)[a-f0-9]{32}$/),
    wid: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable(),
    agentId: z.string().regex(/^[a-z0-9-]{3,40}$/).nullable(),
  }),
]);

/** The account's numbers: refresh the list, search, buy, release, and give one to a workspace's agent. */
export const adminAgentsNumbers = onCall({ timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = numbersSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const p = parsed.data;
  const { settings, auth } = await telephony();
  if (!settings || !auth) throw new HttpsError('failed-precondition', 'Connect Twilio first.');
  try {
    if (p.action === 'search') return { ok: true, available: await searchNumbers(auth, p.country) };
    let numbers = settings.numbers;
    if (p.action === 'buy') {
      const n = await buyNumber(auth, p.phone);
      numbers = [...numbers, { ...n, wid: null, agentId: null }];
    } else if (p.action === 'release') {
      await releaseNumber(auth, p.sid);
      numbers = numbers.filter((n) => n.sid !== p.sid);
    } else if (p.action === 'refresh') {
      const keep = new Map(numbers.map((n) => [n.sid, n]));
      numbers = (await listNumbers(auth)).map((n) => ({ ...n, wid: keep.get(n.sid)?.wid ?? null, agentId: keep.get(n.sid)?.agentId ?? null }));
    } else if (p.action === 'assign') {
      if (!numbers.some((n) => n.sid === p.sid)) throw new HttpsError('not-found', 'That number is not on the account.');
      // One agent, one number: whoever held this agent's number before lets it go.
      numbers = numbers.map((n) =>
        n.sid === p.sid
          ? { ...n, wid: p.wid, agentId: p.wid ? p.agentId : null }
          : p.wid && p.agentId && n.wid === p.wid && n.agentId === p.agentId
            ? { ...n, agentId: null }
            : n,
      );
    }
    await db.doc(TELEPHONY).update({ numbers });
    if (p.action !== 'refresh') {
      await db.collection('auditLogs').add({ type: `agents.number.${p.action}`, actor: ctx.uid, detail: p, createdAt: FieldValue.serverTimestamp() });
    }
    return { ok: true, numbers };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', e instanceof TwilioError ? `Twilio: ${e.message}` : (e as Error).message);
  }
});

const money = z.number().min(0).max(1000);

/** The rate card: what it costs us, what we charge. */
export const adminAgentsSetRateCard = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({
      cost: z.object({ callPerMin: money, aiVoicePerMin: money, numberPerMonth: money, waTemplate: money, waMessage: money, aiReply: money }),
      price: z.object({ perAgentMonth: money, perNumberMonth: money, perMin: money, perWaMessage: money }),
      usdToPkr: z.number().min(1).max(10_000),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Every rate is dollars, 0 or more.');
  const card: RateCard = parsed.data;
  await db.doc(RATE_CARD).set({ card, updatedBy: ctx.uid, updatedAtMs: Date.now() });
  return { ok: true, card };
});

export const packageSchema = z.object({
  agents: z.number().int().min(1).max(5),
  numbers: z.number().int().min(1).max(10),
  callsPerDay: z.number().int().min(1).max(500),
  avgCallMin: z.number().min(0.5).max(8),
  waMessagesPerMonth: z.number().int().min(0).max(50_000),
});

/** The plan a package becomes once paid for. Pure. */
export function planFrom(pkg: AgentPackage, card: RateCard, paidUntilMs: number, by: string, nowMs: number, priceUsd?: number): AgentPlan {
  const q = quote(pkg, card);
  return { ...pkg, minutesPerMonth: q.minutes, priceUsd: priceUsd ?? q.priceUsd, paidUntilMs, setAtMs: nowMs, setBy: by };
}

/** Give a customer an agent package (a cash deal, a trial), or take it away. */
export const adminAgentsSetPlan = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({
      wid: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      package: packageSchema.nullable(),
      /** Months paid from today (or from the end of what is paid). 0 keeps the current end. */
      months: z.number().int().min(0).max(12),
      priceUsd: money.optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success || parsed.data.wid === HOUSE) throw new HttpsError('invalid-argument', 'Invalid package.');
  const { wid, months } = parsed.data;
  const ref = db.doc(`workspaces/${wid}`);
  const ws = (await ref.get()).data() as (Workspace & { agentPlan?: AgentPlan }) | undefined;
  if (!ws) throw new HttpsError('not-found', 'No such workspace.');
  if (!parsed.data.package) {
    await ref.update({ agentPlan: FieldValue.delete() });
  } else {
    const now = Date.now();
    const until = months ? extendPaid(ws.agentPlan?.paidUntilMs ?? 0, now, months * PERIOD_MS) : (ws.agentPlan?.paidUntilMs ?? now);
    await ref.update({ agentPlan: planFrom(parsed.data.package, await rateCard(), until, ctx.uid, now, parsed.data.priceUsd) });
  }
  await db.collection('auditLogs').add({ type: 'agents.plan', actor: ctx.uid, wid, detail: parsed.data, createdAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
