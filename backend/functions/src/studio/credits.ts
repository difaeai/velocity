/**
 * Credits: the team's work, bought a day at a time on top of a plan.
 *
 * A customer buys credits in dollars — $5 is five days — through the same
 * manual payment as a plan. Each day the team works on credit, the customer
 * sees $1 spent; that day may spend up to `CREDIT_DAY_AI_USD` on Gemini, and
 * the rest of the dollar is the margin. The real figure never reaches them:
 * the AI meter (`aiUsage`) is admin-only, and `studioUsage` gives a percentage.
 *
 * A credit day is spent only when the team would otherwise stop:
 *  - `lapsed`: the trial or the paid month has run out (or will within the
 *    sweep's gap) — the day adds 24 hours of access on the current plan;
 *  - `allowance`: this month's AI allowance is used up — the day adds its AI
 *    dollars to the month.
 * At most one a Pakistan day, and it always brings both halves: a day bought
 * for the allowance also keeps access open for the next 24 hours.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { isDocId, requireAuth } from '../lib/guards';
import { allowanceUsd, baseBudget, budgets, monthKey, noteExtra, overBudget, usageId, warmAi } from '../ai/config';
import { CREDIT_DAY_AI_USD, CREDIT_DAY_USD, type Workspace } from './plans';

export type CreditWhy = 'lapsed' | 'allowance';

const DAY_MS = 86_400_000;
/** The sweep runs every 30 minutes: a plan ending inside the next 35 goes on credit now, so nothing stops. */
export const CREDIT_SOON_MS = 35 * 60_000;

/** The Pakistan day a moment falls in, `YYYY-MM-DD`. */
export const pktDay = (ms: number): string => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);

type CreditView = Pick<Workspace, 'trialEndsAtMs' | 'paidUntilMs' | 'suspended' | 'creditDays' | 'creditDayOn'>;

/** Why a credit day should be spent now, or null. Pure. */
export function creditDue(ws: CreditView, nowMs: number, overAllowance: boolean): CreditWhy | null {
  if (ws.suspended || !((ws.creditDays ?? 0) >= 1) || ws.creditDayOn === pktDay(nowMs)) return null;
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs + CREDIT_SOON_MS) return 'lapsed';
  return overAllowance ? 'allowance' : null;
}

/** What one credit day does to the workspace. Pure. */
export function applyCreditDay(ws: CreditView, why: CreditWhy, nowMs: number): Partial<Workspace> {
  const access = Math.max(ws.trialEndsAtMs, ws.paidUntilMs);
  // A lapse carries on from where access ends, so no minute is lost or bought twice.
  const paidUntilMs = Math.max(ws.paidUntilMs, (why === 'lapsed' ? Math.max(access, nowMs) : nowMs) + DAY_MS);
  return {
    creditDays: (ws.creditDays ?? 0) - 1,
    creditDayOn: pktDay(nowMs),
    paidUntilMs,
    accessUntilMs: Math.max(ws.trialEndsAtMs, paidUntilMs),
  };
}

/** Spend today's credit day for `wid` if one is due. Returns why, or null when none was. */
export async function spendCreditDay(wid: string, nowMs = Date.now()): Promise<CreditWhy | null> {
  await warmAi(wid);
  const over = overBudget(wid);
  const ref = db.doc(`workspaces/${wid}`);
  const why = await db.runTransaction(async (tx) => {
    const ws = (await tx.get(ref)).data() as Workspace | undefined;
    const due = ws ? creditDue(ws, nowMs, over) : null;
    if (!ws || !due) return null;
    tx.update(ref, applyCreditDay(ws, due, nowMs));
    tx.set(
      db.doc(`aiUsage/${usageId(wid, monthKey(nowMs))}`),
      { month: monthKey(nowMs), wid, extraUsd: FieldValue.increment(CREDIT_DAY_AI_USD), creditDays: FieldValue.increment(1), updatedAtMs: nowMs },
      { merge: true },
    );
    // The customer's own record: what they see spent, never what it cost.
    tx.set(ref.collection('creditLog').doc(), { atMs: nowMs, day: pktDay(nowMs), days: -1, usd: -CREDIT_DAY_USD, why: due });
    return due;
  });
  if (why) noteExtra(wid, CREDIT_DAY_AI_USD);
  return why;
}

/** Every 30 minutes: every workspace holding credits, on credit the moment it would stop. */
export const studioCreditSweep = onSchedule({ schedule: 'every 30 minutes', timeoutSeconds: 300 }, async () => {
  const snap = await db.collection('workspaces').where('creditDays', '>', 0).get();
  for (const d of snap.docs) {
    try {
      const why = await spendCreditDay(d.id);
      if (why) logger.info('studio: a credit day was spent', { wid: d.id, why });
    } catch (e) {
      logger.error('studio: a credit day failed', { wid: d.id, error: (e as Error).message });
    }
  }
});

/**
 * The customer's Usage page: how much of this month's AI work is used, as a
 * percentage of their plan's allowance plus the credit days spent this month.
 * Never a dollar of real cost.
 */
export const studioUsage = onCall(async (req) => {
  const ctx = requireAuth(req);
  const wid = ctx.token.ws;
  if (typeof wid !== 'string' || !isDocId(wid)) throw new HttpsError('failed-precondition', 'Sign up for Velocity Studio first.');
  const [row, ws] = await Promise.all([db.doc(`aiUsage/${usageId(wid)}`).get(), db.doc(`workspaces/${wid}`).get()]);
  if (ws.get('ownerUid') !== ctx.uid) throw new HttpsError('permission-denied', 'This workspace is not yours.');
  await warmAi(wid);
  const extra = Number(row.get('extraUsd') ?? 0) || 0;
  const base = baseBudget(wid, budgets(), ws.get('plan'));
  const cap = base > 0 ? base + extra : 0;
  const used = allowanceUsd(row.data());
  return {
    month: monthKey(),
    usedPct: cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0,
    creditDaysThisMonth: Number(row.get('creditDays') ?? 0) || 0,
  };
});
