/**
 * Velocity Studio — the social desk, sold to other businesses.
 *
 * Three things happen here and nowhere else:
 *
 * 1. **Sign-up.** A signed-in person with a verified email (Google, or the
 *    code in `emailCode.ts`) describes their business and picks a plan; they get
 *    a workspace, a one-day trial of that plan, the eight agents, and a brief
 *    written from their answers. Their account is tied to it by a `ws` custom
 *    claim, which is what every rule and every desk call checks.
 * 2. **Paying.** There is no card gateway yet (the user chose manual payment):
 *    the customer pays by bank transfer / EasyPaisa / JazzCash to the receiving
 *    accounts on file, then sends the screenshot AND the transaction ID. A
 *    transaction ID can be claimed once, ever — the same bookkeeping defence the
 *    driver top-ups use — and the receipt is read on the spot by our own OCR
 *    (`paymentCheck.ts`) so the admin sees what it says before opening it.
 * 3. **Approving.** An admin checks the money arrived and approves: the plan is
 *    set to what was paid for and a month (or a year) is added; days still paid
 *    on another plan carry over at their worth (`paidAfter`). Rejecting frees the
 *    transaction ID and the screenshot so an honest mistake can be sent again.
 * 4. **Managing.** Admins extend a trial, give days, change a plan, pause or
 *    resume a workspace and keep a note on it (`adminManageStudioCustomer`). The
 *    note sits on `studioUsers/{owner}`, which only admins read — the workspace
 *    doc is the customer's own to read.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { isDocId, requireAdmin, requireAuth } from '../lib/guards';
import { seedTeam } from '../social/employees';
import { freshLaunch, stateRef } from '../social/launch';
import { EMPTY_BRIEF } from '../social/types';
import { inWorkspace, sdb, workspaceRef } from '../social/workspace';
import { signInMethod, touchStudioUser } from './emailCode';
import { checkStudioPayment } from './paymentCheck';
import { quote, type AgentPackage, type AgentPlan } from '../agents/billing';
import { packageSchema, planFrom } from '../agents';
import { rateCard } from '../agents/store';
import {
  PERIOD_MS,
  PLAN_IDS,
  PLANS,
  TRIAL_MS,
  YEAR_MS,
  extendPaid,
  paidAfter,
  priceUsd,
  type Billing,
  type PlanId,
  type Workspace,
} from './plans';

/** Angles that fit any business; the customer edits them in Settings. */
export const STUDIO_ANGLES = [
  'what we do',
  'a customer story',
  'behind the scenes',
  'how it works',
  'this week’s offer',
  'a tip for our customers',
  'myth vs fact',
  'meet the team',
];

const text = (max: number) => z.string().trim().max(max);

const signUpSchema = z.object({
  businessName: text(80).min(2),
  website: text(200).optional().default(''),
  what: text(600).min(5),
  audience: text(400).min(3),
  market: text(120).min(2),
  language: text(80).min(2),
  differences: text(1200).optional().default(''),
  plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
});

/** The brief's first box, written from the sign-up answers so the team knows the business on day one. */
export function aboutFrom(s: z.infer<typeof signUpSchema>): string {
  return [
    `${s.businessName} — ${s.what}`,
    `Customers: ${s.audience}. Where: ${s.market}. Posts are written in ${s.language}.`,
    s.differences ? `Why people pick us: ${s.differences}` : '',
    s.website ? `Website: ${s.website}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const studioCreateWorkspace = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (ctx.token.ws) throw new HttpsError('already-exists', 'This account already has a Velocity Studio workspace.');
  if (ctx.role === 'admin') {
    throw new HttpsError('failed-precondition', 'Admins run the Velocity desk. Sign up with a different account.');
  }
  // The free day is for a real address: Google's, or one proved with the emailed code.
  if (ctx.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email first — type the code we sent you.');
  }
  const parsed = signUpSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Fill in your business name, what you sell, who buys it and where.');
  const s = parsed.data;

  // One workspace per person, also when the claim has not reached their token yet.
  const owned = await db.collection('workspaces').where('ownerUid', '==', ctx.uid).limit(1).get();
  if (!owned.empty) throw new HttpsError('already-exists', 'This account already has a Velocity Studio workspace.');

  const now = Date.now();
  const ref = db.collection('workspaces').doc();
  const workspace: Workspace = {
    name: s.businessName,
    ownerUid: ctx.uid,
    ownerEmail: (ctx.token.email as string | undefined) ?? null,
    plan: s.plan,
    trialEndsAtMs: now + TRIAL_MS,
    paidUntilMs: 0,
    accessUntilMs: now + TRIAL_MS,
    createdAtMs: now,
    brand: {
      name: s.businessName,
      what: s.what,
      audience: s.audience,
      market: s.market,
      language: s.language,
      differences: s.differences,
      website: s.website,
    },
  };
  await ref.set(workspace);

  await inWorkspace(ref.id, async () => {
    await sdb.doc('system/socialAutomation').set({
      angles: STUDIO_ANGLES,
      competitors: [],
      brief: { ...EMPTY_BRIEF, about: aboutFrom(s) },
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: ctx.uid,
    });
    await seedTeam(ctx.uid);
    // The launch sequence is queued from the first minute: the console starts
    // the market read the moment the owner lands, and the sweep if they do not.
    await stateRef().set(freshLaunch(now));
  });

  // Merged, never replaced: a person may also hold a role claim from the ride app.
  const user = await auth.getUser(ctx.uid);
  await auth.setCustomUserClaims(ctx.uid, { ...(user.customClaims ?? {}), ws: ref.id });
  await touchStudioUser(ctx.uid, ctx.token, { workspaceId: ref.id, method: signInMethod(ctx.token) });

  return { ok: true, workspaceId: ref.id, trialEndsAtMs: workspace.trialEndsAtMs };
});

/** Upper case letters and digits only: "TXN 12-ab" and "txn12AB" are the same transfer. */
export const txnKey = (txnId: string): string => txnId.toUpperCase().replace(/[^A-Z0-9]/g, '');

// 1GiB and two minutes: the receipt is read by Tesseract on this function's CPU.
export const studioSubmitPayment = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const ctx = requireAuth(req);
  const wid = ctx.token.ws;
  if (typeof wid !== 'string') throw new HttpsError('failed-precondition', 'Sign up for Velocity Studio first.');
  const parsed = z
    .object({
      plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]).optional(),
      billing: z.enum(['month', 'year']).optional().default('month'),
      /** A month of AI calling and WhatsApp instead of a plan, priced from the rate card. */
      agents: packageSchema.optional(),
      txnId: text(60).optional().default(''),
      screenshotPath: text(300).optional().default(''),
    })
    .refine((d) => Boolean(d.plan) !== Boolean(d.agents))
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Choose a plan.');
  const { billing, agents, txnId, screenshotPath } = parsed.data;
  const key = txnKey(txnId);
  // Both, always: the ID is what can be claimed once, the screenshot what the check reads.
  if (!screenshotPath || key.length < 6) {
    throw new HttpsError('invalid-argument', 'Upload the payment screenshot and type the transaction ID (at least 6 letters or digits).');
  }
  if (!screenshotPath.startsWith(`workspaces/${wid}/payments/`)) {
    throw new HttpsError('permission-denied', 'Upload the screenshot from the Billing page.');
  }

  const ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  if (!ws || ws.ownerUid !== ctx.uid) throw new HttpsError('permission-denied', 'This workspace is not yours.');
  // The agents work from the Sales page, so a package on any other plan would be money for nothing.
  if (agents && !PLANS[ws.plan].can.includes('sales')) {
    throw new HttpsError('failed-precondition', 'AI agents come with the Everything plan. Upgrade to it first, then add the package.');
  }
  // An agent package keeps the plan the workspace already has; its price comes from the rate card, never the client.
  const plan = parsed.data.plan ?? ws.plan;
  const agentQuote = agents ? quote(agents, await rateCard()) : null;

  const paymentRef = db.collection('studioPayments').doc();
  await db.runTransaction(async (tx) => {
    const claimRef = db.doc(`studioTxnRefs/${key}`);
    if ((await tx.get(claimRef)).exists) {
      throw new HttpsError('already-exists', 'That transaction ID has already been sent. If this is a mistake, contact us.');
    }
    tx.set(claimRef, { paymentId: paymentRef.id, wid, atMs: Date.now() });
    tx.set(paymentRef, {
      wid,
      uid: ctx.uid,
      business: ws.name,
      email: ws.ownerEmail,
      plan,
      billing: agents ? 'month' : billing,
      amountUsd: agentQuote ? agentQuote.priceUsd : priceUsd(plan, billing),
      ...(agents && agentQuote ? { kind: 'agents', agents, amountPkr: agentQuote.pricePkr } : {}),
      txnId,
      txnKey: key,
      screenshotPath,
      analysis: null,
      status: 'pending',
      createdAtMs: Date.now(),
      decidedAtMs: null,
      decidedBy: null,
      note: null,
    });
  });
  // Read the receipt now, while the admin queue is already showing the payment.
  await checkStudioPayment(paymentRef.id);
  return { ok: true, paymentId: paymentRef.id };
});

export const adminDecideStudioPayment = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ paymentId: z.string().min(1).max(64).regex(/^[^/]+$/), approve: z.boolean(), note: text(300).optional() })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { paymentId, approve, note } = parsed.data;
  const card = await rateCard();

  return db.runTransaction(async (tx) => {
    const payRef = db.doc(`studioPayments/${paymentId}`);
    const pay = (await tx.get(payRef)).data() as
      | {
          wid: string;
          plan: PlanId;
          billing?: Billing;
          status: string;
          txnKey: string | null;
          imageSha?: string | null;
          kind?: 'agents';
          agents?: AgentPackage;
          amountUsd?: number;
        }
      | undefined;
    if (!pay) throw new HttpsError('not-found', 'No such payment.');
    if (pay.status !== 'pending') throw new HttpsError('failed-precondition', `Already ${pay.status}.`);

    const now = Date.now();
    const decided = { status: approve ? 'approved' : 'rejected', decidedAtMs: now, decidedBy: ctx.uid, note: note ?? null };
    if (!approve) {
      tx.update(payRef, decided);
      if (pay.txnKey) tx.delete(db.doc(`studioTxnRefs/${pay.txnKey}`));
      if (pay.imageSha) tx.delete(db.doc(`studioReceiptHashes/${pay.imageSha}`));
      return { ok: true, status: 'rejected' };
    }

    const wsRef = workspaceRef(pay.wid);
    const ws = (await tx.get(wsRef)).data() as (Workspace & { agentPlan?: AgentPlan }) | undefined;
    if (!ws) throw new HttpsError('not-found', 'That workspace no longer exists.');
    // A month of AI agents: the package they paid for, from the end of what is already paid.
    if (pay.kind === 'agents' && pay.agents) {
      const until = extendPaid(ws.agentPlan?.paidUntilMs ?? 0, now, PERIOD_MS);
      tx.update(payRef, decided);
      tx.update(wsRef, { agentPlan: planFrom(pay.agents, card, until, ctx.uid, now, pay.amountUsd) });
      return { ok: true, status: 'approved', paidUntilMs: until };
    }
    // Payments sent before yearly billing existed have no `billing`: they were monthly.
    const paidUntilMs = paidAfter(ws, pay.plan, now, pay.billing === 'year' ? YEAR_MS : PERIOD_MS);
    tx.update(payRef, decided);
    tx.update(wsRef, {
      plan: pay.plan,
      paidUntilMs,
      accessUntilMs: Math.max(ws.trialEndsAtMs, paidUntilMs),
    });
    return { ok: true, status: 'approved', paidUntilMs };
  });
});

const DAY_MS = 86_400_000;

const manageSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('extendTrial'), days: z.number().int().min(1).max(30) }),
  z.object({ action: z.literal('giveDays'), days: z.number().int().min(1).max(366) }),
  z.object({ action: z.literal('setPlan'), plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]) }),
  z.object({ action: z.literal('suspend') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('note'), note: text(2000) }),
]);

export type ManageChange = z.infer<typeof manageSchema>;

/** What one management action does to a workspace. Pure, so it is tested without a database. */
export function applyManage(
  ws: Workspace,
  change: Exclude<ManageChange, { action: 'note' }>,
  nowMs: number,
): Partial<Workspace> {
  const access = (trialEndsAtMs: number, paidUntilMs: number) => ({ accessUntilMs: Math.max(trialEndsAtMs, paidUntilMs) });
  switch (change.action) {
    case 'extendTrial': {
      const trialEndsAtMs = Math.max(ws.trialEndsAtMs, nowMs) + change.days * DAY_MS;
      return { trialEndsAtMs, ...access(trialEndsAtMs, ws.paidUntilMs) };
    }
    case 'giveDays': {
      // Days given by Velocity count as paid time, exactly like an approved payment.
      const paidUntilMs = extendPaid(ws.paidUntilMs, nowMs, change.days * DAY_MS);
      return { paidUntilMs, ...access(ws.trialEndsAtMs, paidUntilMs) };
    }
    case 'setPlan':
      return { plan: change.plan };
    case 'suspend':
      return { suspended: true };
    case 'resume':
      return { suspended: false };
  }
}

/** Velocity AI Studio → Users: one admin action on one customer, written to the audit log. */
export const adminManageStudioCustomer = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const wid = (req.data as { wid?: unknown } | undefined)?.wid;
  const parsed = manageSchema.safeParse(req.data ?? {});
  if (!parsed.success || typeof wid !== 'string' || !isDocId(wid)) {
    throw new HttpsError('invalid-argument', 'Invalid request.');
  }
  const change = parsed.data;

  const updated = await db.runTransaction(async (tx) => {
    const ref = workspaceRef(wid);
    const ws = (await tx.get(ref)).data() as Workspace | undefined;
    if (!ws) throw new HttpsError('not-found', 'That workspace no longer exists.');
    // The customer reads their workspace doc; the admin's note goes where only admins read.
    if (change.action === 'note') {
      tx.set(db.doc(`studioUsers/${ws.ownerUid}`), { adminNote: change.note }, { merge: true });
      return ws;
    }
    const patch = applyManage(ws, change, Date.now());
    tx.update(ref, patch);
    return { ...ws, ...patch };
  });

  await db.collection('auditLogs').add({
    type: `studio.${change.action}`,
    actor: ctx.uid,
    wid,
    detail: change,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, workspace: updated };
});
