/**
 * Where the AI agents keep things, and the small reads every part needs.
 *
 * Shared by all workspaces (admin-owned):
 *  - `system/agentTelephony` — the Twilio account and which number belongs to
 *    which workspace and agent. Its auth token is sealed one level down.
 *  - `adminConfig/agentBilling` — the rate card.
 *  - `agentUsage/{YYYY-MM}_{wid}` — a month of one workspace's calls and
 *    messages: what it cost us. The admin reads them all; a customer its own.
 *  - `agentCallKeys/{callId}` — the per-call bridge key and Live token. No
 *    rule opens it.
 *  - `agentWaLines/{phoneNumberId}` — which workspace a WhatsApp number
 *    belongs to, so the webhook knows whose message arrived.
 *
 * Per workspace (`sdb`, readable by its owner): `agentCalls/{id}` and
 * `agentThreads/{waId}`, and the WhatsApp line at `system/agentWhatsApp`.
 */
import { db, FieldValue } from '../lib/firebase';
import { dayOfMonth, monthKey } from '../ai/config';
import { open, type SealedSecret } from '../social/secrets';
import { HOUSE } from '../social/scope';
import type { Workspace } from '../studio/plans';
import { EMPTY_USAGE, rateCardFrom, type AgentPlan, type AgentUsage, type RateCard } from './billing';
import type { OwnedNumber, TwilioAuth } from './twilio';

export const TELEPHONY = 'system/agentTelephony';
export const TELEPHONY_SECRET = 'system/agentTelephony/secret/credentials';
export const RATE_CARD = 'adminConfig/agentBilling';
export const CALL_KEYS = 'agentCallKeys';
export const WA_INDEX = 'agentWaLines';
/** Per workspace, through `sdb`. */
export const CALLS = 'agentCalls';
export const THREADS = 'agentThreads';
export const WA_LINE = 'system/agentWhatsApp';
export const WA_SECRET = 'system/agentWhatsApp/secret/credentials';

/** A number on the Twilio account, and who it is given to. */
export interface NumberAssignment extends OwnedNumber {
  wid: string | null;
  agentId: string | null;
}

export interface TelephonySettings {
  accountSid: string;
  friendlyName: string;
  connectedAtMs: number;
  numbers: NumberAssignment[];
}

export async function telephony(): Promise<{ settings: TelephonySettings | null; auth: TwilioAuth | null }> {
  const [pub, sec] = await Promise.all([db.doc(TELEPHONY).get(), db.doc(TELEPHONY_SECRET).get()]);
  const settings = (pub.data() as TelephonySettings | undefined) ?? null;
  const sealed = sec.data()?.authToken as SealedSecret | undefined;
  if (!settings?.accountSid || !sealed) return { settings, auth: null };
  return { settings, auth: { accountSid: settings.accountSid, authToken: open(sealed) } };
}

/** The number an agent calls from, or null when none is given to it. */
export function numberFor(settings: TelephonySettings | null, wid: string, agentId: string): NumberAssignment | null {
  return settings?.numbers.find((n) => n.wid === wid && n.agentId === agentId) ?? null;
}

export async function rateCard(): Promise<RateCard> {
  return rateCardFrom((await db.doc(RATE_CARD).get()).data()?.card);
}

/** A customer's paid agent package; null in the house (no caps) or when none was bought. */
export async function agentPlanOf(wid: string): Promise<AgentPlan | null> {
  if (wid === HOUSE) return null;
  const ws = (await db.doc(`workspaces/${wid}`).get()).data() as (Workspace & { agentPlan?: AgentPlan }) | undefined;
  return ws?.agentPlan ?? null;
}

export const usageRef = (wid: string, month = monthKey()) => db.doc(`agentUsage/${month}_${wid}`);

/** This month's usage and today's calls for one workspace. */
export async function usageNow(wid: string): Promise<{ month: AgentUsage; callsToday: number }> {
  const d = (await usageRef(wid).get()).data() ?? {};
  const month = { ...EMPTY_USAGE };
  for (const k of Object.keys(EMPTY_USAGE) as (keyof AgentUsage)[]) month[k] = Number(d[k] ?? 0);
  return { month, callsToday: Number(d.byDay?.[dayOfMonth()]?.calls ?? 0) };
}

/** Add to a workspace's month. Increments only, so two webhooks never overwrite each other. */
export async function addUsage(wid: string, add: Partial<AgentUsage>): Promise<void> {
  const inc = FieldValue.increment;
  const fields: Record<string, unknown> = { month: monthKey(), wid, updatedAtMs: Date.now() };
  for (const [k, v] of Object.entries(add)) if (v) fields[k] = inc(v);
  const day: Record<string, unknown> = {};
  if (add.calls) day.calls = inc(add.calls);
  if (add.costUsd) day.costUsd = inc(add.costUsd);
  if (Object.keys(day).length) fields.byDay = { [dayOfMonth()]: day };
  await usageRef(wid).set(fields, { merge: true });
}

/** Public base URL of the deployed functions, which Twilio and the bridge call back on. */
export function functionsBase(): string {
  const explicit = (process.env.AGENTS_BASE_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  let projectId = process.env.GCLOUD_PROJECT;
  if (!projectId && process.env.FIREBASE_CONFIG) {
    try {
      projectId = (JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string }).projectId;
    } catch {
      /* noop */
    }
  }
  // Must match the region in setGlobalOptions (src/index.ts).
  return `https://${process.env.FUNCTION_REGION ?? 'asia-south1'}-${projectId ?? 'unknown'}.cloudfunctions.net`;
}

/**
 * The voice bridge's WebSocket URL (`wss://…/stream`), set by the deploy
 * workflow once the Cloud Run service exists. Empty means AI calls cannot run.
 */
export function bridgeUrl(): string {
  const raw = (process.env.VOICE_BRIDGE_URL ?? '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return `${raw.replace(/^http/, 'ws')}/stream`;
}

/** A workspace path for code that runs outside a workspace scope (webhooks). */
export const pathIn = (wid: string, path: string): string => (wid === HOUSE ? path : `workspaces/${wid}/${path}`);
