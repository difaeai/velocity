/**
 * The AI meter: what every Gemini call cost, and who it was for.
 *
 * Nothing measured Gemini before this file, so "why did the bill go up" could
 * only be guessed from logs. Every call now adds its tokens and its price to
 * `aiUsage/{YYYY-MM}_{workspace}`: in total, by Cloud Run service (which job
 * made the call), by what was asked for (`what`, e.g. "The market read") and by
 * day. The admin page reads these rows; the budget check reads `usd`.
 *
 * Prices are Google's published paid-tier rates, per 1M tokens, as of October
 * 2026 (ai.google.dev/gemini-api/docs/pricing). The key is on prepaid credit,
 * so nothing is free — "free tier" in older comments meant the model, not the
 * bill. Thinking tokens are billed as output, so they are counted as output.
 * Grounded searches are counted but priced at 0: 2.5 Flash includes 1,500 a
 * day and the desk uses a handful.
 *
 * A write that fails is logged and dropped: a meter must never be the reason a
 * reply did not go out.
 */
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { currentWorkspace } from '../social/scope';
import { dayOfMonth, monthKey, noteSpend, usageId } from './config';

/** USD per 1M tokens. */
interface Price {
  in: number;
  out: number;
}

export const PRICES: Record<string, Price> = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
  // The 3.6/3.8 rates are the introductory ones, which Google says double after 2026.
  'gemini-3.8-flash': { in: 0.75, out: 3.75 },
  'gemini-3.6-flash': { in: 0.75, out: 3.75 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
  // Text in, audio out: a voice-over is almost all output.
  'gemini-3.8-flash-tts': { in: 0.5, out: 9 },
  'gemini-3.8-flash-lite-tts': { in: 0.5, out: 6 },
};

/** Gemini Live, per minute of a call: $0.005 heard + $0.018 spoken. */
export const LIVE_USD_PER_MIN = 0.023;

/**
 * The price of a model this table does not name: the dearest Flash for a
 * Flash, and an estimate well above it for anything else (a Pro), so an
 * unknown model reads as expensive rather than free.
 */
export function priceFor(model: string): Price {
  const id = model.replace(/^models\//, '');
  if (PRICES[id]) return PRICES[id];
  return /flash/.test(id) ? PRICES['gemini-3.8-flash'] : { in: 2.5, out: 15 };
}

export interface TokenUsage {
  inTok: number;
  outTok: number;
  grounded: number;
}

/** Read the Interactions API's `usage` block. Missing numbers are zero. Pure. */
export function readUsage(raw: unknown): TokenUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0);
  return {
    inTok: n('total_input_tokens') + n('total_tool_use_tokens'),
    outTok: n('total_output_tokens') + n('total_thought_tokens'),
    grounded: n('grounding_tool_count'),
  };
}

/** What a call cost, USD. Pure. */
export function costUsd(model: string, u: Pick<TokenUsage, 'inTok' | 'outTok'>): number {
  const p = priceFor(model);
  return (u.inTok * p.in + u.outTok * p.out) / 1_000_000;
}

/** Which part of the product a Cloud Run service belongs to. Pure. */
export function featureOf(service: string): string {
  const s = service.toLowerCase();
  if (s.includes('helpline')) return 'helpline';
  if (s.includes('support') || s.includes('ticket')) return 'support';
  if (s.startsWith('agent')) return 'agents';
  if (s.startsWith('sales')) return 'sales';
  if (/ads|createad|designad|adaction/.test(s)) return 'ads';
  if (s.includes('launch')) return 'launch';
  if (s.includes('studio')) return 'studio';
  if (s.includes('comment') || s.includes('engagement')) return 'comments';
  if (s.includes('social') || s.includes('post') || s.includes('plan')) return 'content';
  return 'other';
}

/** Firestore map keys, short and plain. Dots are fine: a merge set treats each key as one segment. */
const keyOf = (s: string): string => s.replace(/[/\\[\]*`~]/g, ' ').trim().slice(0, 60) || 'unnamed';

export interface UsageEntry {
  model: string;
  usd: number;
  inTok?: number;
  outTok?: number;
  grounded?: number;
  /** Seconds of a Live call, when that is how it was priced. */
  seconds?: number;
  /** What was asked for, e.g. "The market read". */
  what?: string;
  /** Overrides the workspace in scope (a webhook acting for a customer). */
  wid?: string;
  /** Overrides the Cloud Run service name (the voice bridge, which is not a function). */
  service?: string;
  /**
   * Paid for apart from the plan's AI allowance — an AI phone call, which the
   * customer's agent package pays for. Still on the meter (`usd`, the true
   * total), but also in `apartUsd`, so it never uses up their content month.
   */
  apart?: boolean;
}

/** One finished piece of content (post, reel, story…), so the page can show what a piece costs. Never throws. */
export async function recordPiece(wid: string = currentWorkspace()): Promise<void> {
  try {
    await db
      .doc(`aiUsage/${usageId(wid)}`)
      .set({ month: monthKey(), wid, pieces: FieldValue.increment(1), updatedAtMs: Date.now() }, { merge: true });
  } catch (err) {
    logger.warn('ai: could not count a piece', { wid, message: (err as Error).message });
  }
}

/** Add one call to the month. Never throws, never blocks the caller for long. */
export async function recordAi(e: UsageEntry): Promise<void> {
  const wid = e.wid ?? currentWorkspace();
  const service = keyOf(e.service ?? process.env.K_SERVICE ?? 'local');
  const usd = Math.max(0, e.usd);
  if (!e.apart) noteSpend(wid, usd);
  const inc = FieldValue.increment;
  const what = keyOf(e.what ?? 'other');
  try {
    await db.doc(`aiUsage/${usageId(wid)}`).set(
      {
        month: monthKey(),
        wid,
        usd: inc(usd),
        ...(e.apart ? { apartUsd: inc(usd) } : {}),
        calls: inc(1),
        inTok: inc(e.inTok ?? 0),
        outTok: inc(e.outTok ?? 0),
        grounded: inc(e.grounded ?? 0),
        seconds: inc(e.seconds ?? 0),
        byService: { [service]: { usd: inc(usd), calls: inc(1) } },
        byWhat: { [what]: { usd: inc(usd), calls: inc(1) } },
        byModel: { [keyOf(e.model)]: { usd: inc(usd), calls: inc(1) } },
        byDay: { [dayOfMonth()]: inc(usd) },
        updatedAtMs: Date.now(),
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn('ai: could not record usage', { wid, message: (err as Error).message });
  }
}
