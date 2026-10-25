/**
 * The Gemini keys and the monthly AI budgets, as an admin sets them on
 * Manage social → AI keys & usage.
 *
 * Three key slots, because three kinds of spend want three bills:
 *  - `house` — Velocity's own desk, support desk and sales agent.
 *  - `customers` — every Velocity Studio workspace. A key in its own Google
 *    project is a bill that is only customers, which is the number a price is
 *    set against. Empty means customers use the house key.
 *  - `voice` — the phone helpline and the AI calling agents (Gemini Live).
 *
 * A key typed in the console is sealed with `SOCIAL_TOKEN_KEY` under
 * `system/aiKeys/secret/credentials` — a path no client rule opens — and beats
 * the deploy secrets (`GEMINI_KEY_RESEARCH`, `GEMINI_LIVE_KEY`), which stay as
 * the fallback so a console with nothing typed in works exactly as before.
 *
 * Budgets are USD a month (Pakistan months), per workspace. Spent → Gemini sits
 * out for that workspace until the 1st and the engine falls through to the free
 * model or the local writer, so the desk slows down rather than the bill
 * running on. 0 means no cap.
 *
 * Everything the engine asks here is synchronous (`modelReady()` is), so the
 * async part is `warmAi()`, which `inWorkspace` runs on the way in. Cached a
 * minute per instance: a new key or budget reaches every instance within one.
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { open, type SealedSecret } from '../social/secrets';
import { HOUSE, currentWorkspace } from '../social/scope';

export type KeySlot = 'house' | 'customers' | 'voice';
export const KEY_SLOTS: readonly KeySlot[] = ['house', 'customers', 'voice'];

/** Admin-readable: budgets and each slot's status. Never a key. */
export const AI_CONFIG = 'adminConfig/aiKeys';
/** The sealed keys. No rule opens it to a client. */
export const AI_SECRET = 'system/aiKeys/secret/credentials';

export interface AiBudgets {
  /** Velocity's own desk, USD a month. 0 = no cap. */
  houseUsd: number;
  /** Every customer workspace without its own figure. */
  customerUsd: number;
  /** One customer's own figure, by workspace id. */
  perWorkspace: Record<string, number>;
}

/**
 * $3 a month covers a customer's 30 days of content several times over (a
 * piece is a few cents on Flash) and is a tenth of what the cheapest plan
 * brings in. The house is uncapped until an admin says otherwise.
 */
export const DEFAULT_BUDGETS: AiBudgets = { houseUsd: 0, customerUsd: 3, perWorkspace: {} };

/** The Pakistan month a moment falls in, `YYYY-MM`. */
export const monthKey = (ms = Date.now()): string => new Date(ms + 5 * 3600_000).toISOString().slice(0, 7);
/** The day of that month, `DD`. */
export const dayOfMonth = (ms = Date.now()): string => new Date(ms + 5 * 3600_000).toISOString().slice(8, 10);
/** One workspace's month of AI spend lives at `aiUsage/{id}`. */
export const usageId = (wid: string, month = monthKey()): string => `${month}_${wid}`;

const TTL_MS = 60_000;

let loaded: { keys: Partial<Record<KeySlot, string>>; budgets: AiBudgets; atMs: number } | null = null;
const spent = new Map<string, { usd: number; month: string; atMs: number }>();

const env = (name: string): string => (process.env[name] ?? '').trim();

/** Keys and budgets, at most a minute old. Never throws: a failed read keeps what was there. */
export async function loadAi(force = false): Promise<void> {
  if (!force && loaded && Date.now() - loaded.atMs < TTL_MS) return;
  try {
    const [pub, sec] = await Promise.all([db.doc(AI_CONFIG).get(), db.doc(AI_SECRET).get()]);
    const sealed = (sec.data() ?? {}) as Partial<Record<KeySlot, SealedSecret>>;
    const keys: Partial<Record<KeySlot, string>> = {};
    for (const slot of KEY_SLOTS) {
      const box = sealed[slot];
      if (!box) continue;
      try {
        keys[slot] = open(box);
      } catch (e) {
        logger.error('ai: a stored key could not be opened', { slot, message: (e as Error).message });
      }
    }
    const stored = (pub.data()?.budgets ?? {}) as Partial<AiBudgets>;
    loaded = {
      keys,
      budgets: { ...DEFAULT_BUDGETS, ...stored, perWorkspace: { ...(stored.perWorkspace ?? {}) } },
      atMs: Date.now(),
    };
  } catch (e) {
    logger.warn('ai: could not read the key settings; using what this instance had', { message: (e as Error).message });
    loaded = { keys: loaded?.keys ?? {}, budgets: loaded?.budgets ?? DEFAULT_BUDGETS, atMs: Date.now() };
  }
}

/** This month's spend for one workspace, at most a minute old. */
async function warmSpend(wid: string): Promise<void> {
  const month = monthKey();
  const have = spent.get(wid);
  if (have && have.month === month && Date.now() - have.atMs < TTL_MS) return;
  try {
    const usd = Number((await db.doc(`aiUsage/${usageId(wid, month)}`).get()).data()?.usd ?? 0);
    spent.set(wid, { usd: Number.isFinite(usd) ? usd : 0, month, atMs: Date.now() });
  } catch (e) {
    logger.warn('ai: could not read this month’s spend', { wid, message: (e as Error).message });
  }
}

/** Everything the sync checks below need, for `wid`. Never throws. */
export async function warmAi(wid: string = currentWorkspace()): Promise<void> {
  await Promise.all([loadAi(), warmSpend(wid)]);
}

/** Count a call against the cached spend at once, so a cap bites before the next read. */
export function noteSpend(wid: string, usd: number): void {
  const month = monthKey();
  const have = spent.get(wid);
  spent.set(wid, {
    usd: (have && have.month === month ? have.usd : 0) + usd,
    month,
    atMs: have && have.month === month ? have.atMs : 0,
  });
}

export function budgets(): AiBudgets {
  return loaded?.budgets ?? DEFAULT_BUDGETS;
}

/** The monthly cap for one workspace, USD; 0 = none. Pure over its inputs. */
export function budgetFor(wid: string, b: AiBudgets = budgets()): number {
  if (wid === HOUSE) return b.houseUsd;
  return b.perWorkspace[wid] ?? b.customerUsd;
}

/** True when this workspace has spent its month. */
export function overBudget(wid: string = currentWorkspace()): boolean {
  const cap = budgetFor(wid);
  const have = spent.get(wid);
  return cap > 0 && have?.month === monthKey() && have.usd >= cap;
}

/** The slot a text call made now draws on. */
export function textSlot(): KeySlot {
  return currentWorkspace() === HOUSE ? 'house' : 'customers';
}

/**
 * The key for `slot`, with the deploy secrets behind the console's. Empty when
 * there is none at all.
 */
export function geminiKey(slot: KeySlot = textSlot()): string {
  const k = loaded?.keys ?? {};
  const house = k.house || env('GEMINI_KEY_RESEARCH');
  if (slot === 'voice') return k.voice || env('GEMINI_LIVE_KEY') || house;
  if (slot === 'customers') return k.customers || house;
  return house;
}

/** Where a slot's key comes from, for the console. */
export function keySource(slot: KeySlot): 'console' | 'deploy' | 'house' | 'missing' {
  const k = loaded?.keys ?? {};
  if (k[slot]) return 'console';
  if (slot === 'house') return env('GEMINI_KEY_RESEARCH') ? 'deploy' : 'missing';
  if (slot === 'voice' && env('GEMINI_LIVE_KEY')) return 'deploy';
  return geminiKey('house') ? 'house' : 'missing';
}

/** The last four characters, which is all the console ever shows of a key. */
export const last4 = (key: string): string => (key ? key.slice(-4) : '');

const notedAt = new Map<KeySlot, number>();

/**
 * Put a refusal that needs a person ("prepayment credits are depleted", a
 * revoked key) on the slot, where the console shows it. Ten minutes apart at
 * most per instance; never throws.
 */
export function noteKeyError(slot: KeySlot, message: string): void {
  const now = Date.now();
  if (now - (notedAt.get(slot) ?? 0) < 600_000) return;
  notedAt.set(slot, now);
  db.doc(AI_CONFIG)
    .set({ slots: { [slot]: { lastError: message.slice(0, 300), lastErrorAtMs: now } } }, { merge: true })
    .catch(() => undefined);
}

/** Tests only. */
export function resetAiCache(): void {
  loaded = null;
  spent.clear();
  notedAt.clear();
}
