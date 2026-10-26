/**
 * Manage social → AI keys & usage (admins only).
 *
 * Put a Gemini key in a slot (proved with a one-word call before it is kept),
 * take one out, set the monthly budgets, and read where the money went: this
 * month and last, per workspace, per job, per model and per day.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import { seal, tokenVaultReady } from '../social/secrets';
import { HOUSE } from '../social/scope';
import { countPlanned, type MonthPlan } from '../social/strategy';
import { DEFAULT_SETTINGS, type SocialSettings } from '../social/types';
import type { PlanId } from '../studio/plans';
import {
  AI_CONFIG,
  AI_SECRET,
  KEY_SLOTS,
  budgetFor,
  budgets,
  geminiKey,
  keySource,
  last4,
  loadAi,
  monthKey,
  type AiBudgets,
  type KeySlot,
} from './config';
import { featureOf } from './usage';

/**
 * One word from the cheapest model, which proves the key is real AND that its
 * project can pay — a key with spent prepaid credit lists models happily and
 * refuses the first real call, which is the failure this exists to catch.
 */
async function proveKey(key: string): Promise<string | null> {
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: 'gemini-2.5-flash-lite',
        input: 'Reply with the single word: ok',
        store: false,
        generation_config: { max_output_tokens: 8 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return null;
    const text = await res.text();
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    return `${res.status}: ${message}`;
  } catch (e) {
    return (e as Error).message;
  }
}

const slotSchema = z.enum(KEY_SLOTS as [KeySlot, ...KeySlot[]]);

/** Keys (never more than the last four characters), budgets, and the month's spend. */
export const adminAiOverview = onCall(async (req) => {
  requireAdmin(req);
  const month = z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .catch(monthKey())
    .parse((req.data as { month?: unknown } | null)?.month);
  await loadAi(true);

  const pub = (await db.doc(AI_CONFIG).get()).data() ?? {};
  const slotNotes = (pub.slots ?? {}) as Record<string, Record<string, unknown>>;
  const slots = KEY_SLOTS.map((slot) => ({
    slot,
    source: keySource(slot),
    last4: last4(geminiKey(slot)),
    setAtMs: (slotNotes[slot]?.setAtMs as number | undefined) ?? null,
    testedAtMs: (slotNotes[slot]?.testedAtMs as number | undefined) ?? null,
    lastError: (slotNotes[slot]?.lastError as string | undefined) ?? null,
    lastErrorAtMs: (slotNotes[slot]?.lastErrorAtMs as number | undefined) ?? null,
  }));

  const [y, m] = month.split('-').map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
  const [rows, prevRows] = await Promise.all(
    [month, prev].map((mm) => db.collection('aiUsage').where('month', '==', mm).get()),
  );

  const wids = [...new Set(rows.docs.map((d) => String(d.get('wid'))))].filter((w) => w !== HOUSE);
  const names = new Map<string, string>([[HOUSE, 'Velocity Rides (house)']]);
  const plans = new Map<string, PlanId>();
  if (wids.length) {
    const snaps = await db.getAll(...wids.map((w) => db.doc(`workspaces/${w}`)));
    for (const s of snaps) {
      names.set(s.id, (s.get('name') as string | undefined) ?? s.id);
      if (s.get('plan')) plans.set(s.id, s.get('plan') as PlanId);
    }
  }

  const b = budgets();
  const workspaces = rows.docs
    .map((d) => {
      const u = d.data();
      const byFeature: Record<string, { usd: number; calls: number }> = {};
      for (const [service, v] of Object.entries((u.byService ?? {}) as Record<string, { usd?: number; calls?: number }>)) {
        const f = (byFeature[featureOf(service)] ??= { usd: 0, calls: 0 });
        f.usd += v.usd ?? 0;
        f.calls += v.calls ?? 0;
      }
      return {
        wid: String(u.wid),
        name: names.get(String(u.wid)) ?? String(u.wid),
        usd: Number(u.usd ?? 0),
        calls: Number(u.calls ?? 0),
        inTok: Number(u.inTok ?? 0),
        outTok: Number(u.outTok ?? 0),
        grounded: Number(u.grounded ?? 0),
        seconds: Number(u.seconds ?? 0),
        pieces: Number(u.pieces ?? 0),
        budgetUsd: budgetFor(String(u.wid), b, plans.get(String(u.wid)), Number(u.extraUsd ?? 0) || 0),
        /** Credit days spent this month: the customer saw $1 each; `budgetUsd` holds what each really added. */
        creditDays: Number(u.creditDays ?? 0),
        byFeature,
        byService: u.byService ?? {},
        byWhat: u.byWhat ?? {},
        byModel: u.byModel ?? {},
        byDay: u.byDay ?? {},
      };
    })
    .sort((a, z2) => z2.usd - a.usd);

  // What each desk's month plan asks for — the page suggests a budget from it.
  const planned = await Promise.all(
    workspaces.map(async (w) => {
      const pre = w.wid === HOUSE ? '' : `workspaces/${w.wid}/`;
      const [plan, stored] = await Promise.all([
        db.doc(`${pre}socialPlans/${month}`).get(),
        db.doc(`${pre}system/socialAutomation`).get(),
      ]);
      const s = { ...DEFAULT_SETTINGS, ...((stored.data() ?? {}) as Partial<SocialSettings>) };
      return countPlanned(plan.get('days') as MonthPlan['days'] | undefined, month, s.postsPerDay, s.dailyStory);
    }),
  );

  return {
    month,
    slots,
    budgets: b,
    vaultReady: tokenVaultReady(),
    workspaces: workspaces.map((w, i) => ({ ...w, planned: planned[i] })),
    lastMonthUsd: prevRows.docs.reduce((s, d) => s + Number(d.get('usd') ?? 0), 0),
  };
});

/** Put a key in a slot, after proving it can pay for a call. */
export const adminAiSetKey = onCall({ timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ slot: slotSchema, key: z.string().trim().regex(/^[A-Za-z0-9_-]{20,200}$/) })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Paste the whole Gemini API key (it starts with AIza).');
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'Keys cannot be stored safely right now (SOCIAL_TOKEN_KEY is missing).');
  const { slot, key } = parsed.data;

  const refused = await proveKey(key);
  if (refused) throw new HttpsError('failed-precondition', `Google refused that key: ${refused}`);

  const now = Date.now();
  await db.doc(AI_SECRET).set({ [slot]: seal(key), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db
    .doc(AI_CONFIG)
    .set({ slots: { [slot]: { setAtMs: now, setBy: ctx.uid, testedAtMs: now, lastError: null, lastErrorAtMs: null } } }, { merge: true });
  await db.collection('auditLogs').add({
    type: 'ai.keySet',
    actor: ctx.uid,
    detail: { slot, last4: last4(key) },
    createdAt: FieldValue.serverTimestamp(),
  });
  await loadAi(true);
  return { ok: true, last4: last4(key) };
});

/** Take a slot's console key out; it falls back to the deploy secret (or the house key). */
export const adminAiRemoveKey = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z.object({ slot: slotSchema }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Which slot?');
  const { slot } = parsed.data;
  await db.doc(AI_SECRET).set({ [slot]: FieldValue.delete() }, { merge: true });
  await db.doc(AI_CONFIG).set({ slots: { [slot]: { setAtMs: null, setBy: null, lastError: null, lastErrorAtMs: null } } }, { merge: true });
  await db.collection('auditLogs').add({ type: 'ai.keyRemoved', actor: ctx.uid, detail: { slot }, createdAt: FieldValue.serverTimestamp() });
  await loadAi(true);
  return { ok: true };
});

/** Try the key a slot is using right now, whichever place it comes from. */
export const adminAiTestKey = onCall({ timeoutSeconds: 60 }, async (req) => {
  requireAdmin(req);
  const parsed = z.object({ slot: slotSchema }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Which slot?');
  await loadAi(true);
  const key = geminiKey(parsed.data.slot);
  if (!key) return { ok: false, error: 'There is no key for this slot.' };
  const refused = await proveKey(key);
  const now = Date.now();
  await db.doc(AI_CONFIG).set(
    {
      slots: {
        [parsed.data.slot]: refused ? { testedAtMs: now, lastError: refused, lastErrorAtMs: now } : { testedAtMs: now, lastError: null },
      },
    },
    { merge: true },
  );
  return { ok: !refused, error: refused };
});

const usd = z.number().min(0).max(10_000);

/** The monthly caps. 0 means no cap. */
export const adminAiSetBudgets = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({
      houseUsd: usd,
      customerUsd: usd,
      perWorkspace: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), usd).refine((r) => Object.keys(r).length <= 500),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Budgets are dollars a month, 0 or more.');
  const next: AiBudgets = parsed.data;
  // Replaced whole, so a customer taken off the list really is off it.
  await db.doc(AI_CONFIG).set({ budgets: next, budgetsBy: ctx.uid, budgetsAtMs: Date.now() }, { mergeFields: ['budgets', 'budgetsBy', 'budgetsAtMs'] });
  await loadAi(true);
  return { ok: true, budgets: next };
});
