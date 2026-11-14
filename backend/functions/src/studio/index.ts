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
 * 2. **Paying.** Two ways. By card, anywhere in the world, through Stripe
 *    Checkout (`cardPay.ts`) — proved by the gateway, so it approves itself.
 *    Or by bank transfer / EasyPaisa / JazzCash to the receiving accounts on
 *    file, sending the screenshot AND the transaction ID. A
 *    transaction ID can be claimed once, ever — the same bookkeeping defence the
 *    driver top-ups use — and the receipt is read on the spot by our own OCR
 *    (`paymentCheck.ts`) so the admin sees what it says before opening it.
 *    Sign-up asks for the payment before the business (owner, 2026-11-10): a
 *    plan can be paid for with no workspace yet (`wid: null`); approval parks it
 *    on `studioUsers/{uid}.prepaid`, and the workspace made next starts on that
 *    plan, paid, with no trial. The free day is the way past paying.
 * 3. **Approving.** An admin checks the money arrived and approves: the plan is
 *    set to what was paid for and a month (or a year) is added; days still paid
 *    on another plan carry over at their worth (`paidAfter`). Credits add days
 *    to the balance `credits.ts` spends from. Rejecting frees the
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
import { EMPTY_BRIEF, PLATFORMS } from '../social/types';
import { inWorkspace, sdb, workspaceRef } from '../social/workspace';
import { signInMethod, touchStudioUser } from './emailCode';
import { checkStudioPayment } from './paymentCheck';
import { customerPriceRaised } from './priceClock';
import { quote, type AgentPackage, type AgentPlan } from '../agents/billing';
import { packageSchema, planFrom } from '../agents';
import { rateCard } from '../agents/store';
import { pktDay } from './credits';
import {
  CREDIT_DAY_USD,
  CREDIT_PACKS,
  PERIOD_MS,
  PKR_PER_USD,
  PLAN_IDS,
  PLANS,
  TRIAL_USD,
  YEAR_MS,
  extendPaid,
  paidAfter,
  pricePkr,
  priceUsd,
  startTerms,
  type Billing,
  type PlanId,
  type Prepaid,
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

/**
 * Making the workspace takes nothing but the payment that is already on file.
 * Everything about the business arrives afterwards, through
 * `studioSaveBusiness`, because the customer connects their Facebook Page
 * first — and a Page can only be connected to a workspace that exists.
 */
const createSchema = z.object({
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional().default([]),
});

const businessSchema = z.object({
  businessName: text(80).min(2),
  website: text(200).optional().default(''),
  what: text(600).min(5),
  audience: text(400).min(3),
  market: text(120).min(2),
  language: text(80).min(2),
  differences: text(1200).optional().default(''),
  /** Anything else the owner wanted to say, in their own words; it joins the brief. */
  notes: text(1200).optional().default(''),
  /**
   * Who else is in this market, named by the owner: the morning research reads
   * around them. A row left blank is dropped below rather than refused — the
   * form shows three of them and most people fill in one.
   */
  competitors: z
    .array(
      z.object({
        name: text(80),
        url: text(300).optional().default(''),
        instagram: text(31).regex(/^@?[A-Za-z0-9._]{0,30}$/).optional(),
      }),
    )
    .max(8)
    .optional()
    .default([]),
  platforms: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length).optional().default([]),
});

/** The brief's first box, written from the sign-up answers so the team knows the business on day one. */
export function aboutFrom(s: z.infer<typeof businessSchema>): string {
  return [
    `${s.businessName} — ${s.what}`,
    `Customers: ${s.audience}. Where: ${s.market}. Posts are written in ${s.language}.`,
    s.differences ? `Why people pick us: ${s.differences}` : '',
    s.notes ? `In the owner's own words: ${s.notes}` : '',
    s.website ? `Website: ${s.website}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const studioCreateWorkspace = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (ctx.token.ws) throw new HttpsError('already-exists', 'This account already has a Vexa workspace.');
  if (ctx.role === 'admin') {
    throw new HttpsError('failed-precondition', 'Admins run the Velocity desk. Sign up with a different account.');
  }
  // The free day is for a real address: Google's, or one proved with the emailed code.
  if (ctx.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email first — type the code we sent you.');
  }
  const parsed = createSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const s = parsed.data;

  // One workspace per person, also when the claim has not reached their token yet.
  const owned = await db.collection('workspaces').where('ownerUid', '==', ctx.uid).limit(1).get();
  if (!owned.empty) throw new HttpsError('already-exists', 'This account already has a Vexa workspace.');

  const now = Date.now();
  // Paid before describing the business: that plan, paid, no trial — whatever plan the page sent.
  const userRef = db.doc(`studioUsers/${ctx.uid}`);
  const prepaid = ((await userRef.get()).get('prepaid') as Prepaid | undefined) ?? null;
  // Nothing starts unpaid any more (owner, 2026-11-11), not even the day: a
  // workspace exists only once a payment — a plan, or TRIAL_USD for the day —
  // has been proved by the gateway or approved by a person.
  if (!prepaid) {
    throw new HttpsError('failed-precondition', 'Pay for a plan, or for the one-day trial, before your team starts.');
  }
  const ref = db.collection('workspaces').doc();
  const email = (ctx.token.email as string | undefined) ?? null;
  const workspace: Workspace = {
    // Until they say what the business is called, their address is the only
    // honest name for it — the admin's list has to show something.
    name: (email ?? 'New workspace').slice(0, 80),
    ownerUid: ctx.uid,
    ownerEmail: email,
    // The plan is the one that was paid for — for a trial day too — never the one the page last had on screen.
    plan: prepaid.plan,
    ...startTerms(prepaid, now),
    createdAtMs: now,
    brand: { name: '', what: '', audience: '', market: '', language: '', differences: '', website: '' },
    platforms: s.platforms,
    // Paid for, not yet described: `studioSaveBusiness` is what finishes it.
    setupAtMs: null,
  };
  await ref.set(workspace);
  await userRef.update({ prepaid: FieldValue.delete() });
  // Now the payment has a workspace: the customer's Billing page and the admin's list show it.
  await db.doc(`studioPayments/${prepaid.paymentId}`).update({ wid: ref.id, business: workspace.name });

  await inWorkspace(ref.id, async () => {
    await sdb.doc('system/socialAutomation').set({
      angles: STUDIO_ANGLES,
      competitors: [],
      brief: { ...EMPTY_BRIEF },
      // Studio sells comment replies as fully automatic; safety comments still wait for a person.
      engagementEnabled: true,
      autoReply: true,
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

/**
 * The second half of sign-up: what the business actually is.
 *
 * The workspace was made the moment the money cleared, so that the customer
 * could connect their Facebook Page to something. Then Vexa read that page and
 * showed them what she found; this is them correcting it, adding anything she
 * could not know, and naming whoever else is in their market. It writes the
 * brand on the workspace and the brief the whole team reads, and stamps
 * `setupAtMs` — which is what lets the console stop sending them back here.
 *
 * Plain `onCall`, not `deskCall`: finishing a sign-up must not be refused
 * because the plan's AI allowance or a model is not ready. It is the customer's
 * own workspace and nothing here calls a model.
 */
export const studioSaveBusiness = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = businessSchema.safeParse(req.data ?? {});
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Fill in your business name, what you sell, who buys it and where.');
  }
  const s = parsed.data;

  // The claim usually arrives with the refreshed token; the query is for when it has not.
  let wid = typeof ctx.token.ws === 'string' && isDocId(ctx.token.ws) ? ctx.token.ws : null;
  if (!wid) {
    const owned = await db.collection('workspaces').where('ownerUid', '==', ctx.uid).limit(1).get();
    wid = owned.empty ? null : owned.docs[0].id;
  }
  if (!wid) throw new HttpsError('failed-precondition', 'Pay for a plan before your team starts.');

  const ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  if (!ws || ws.ownerUid !== ctx.uid) throw new HttpsError('permission-denied', 'This workspace is not yours.');
  // Once only. Afterwards the business is edited on the console's Settings page,
  // where the brief has been written on and must not be thrown away by a sign-up tab left open.
  if (ws.setupAtMs) {
    throw new HttpsError('failed-precondition', 'Your business is already set up — change it on the Settings page.');
  }

  const competitors = s.competitors
    .filter((c) => c.name.trim())
    .map((c) => ({ name: c.name, url: c.url, ...(c.instagram ? { instagram: c.instagram.replace(/^@/, '') } : {}) }));

  await workspaceRef(wid).update({
    name: s.businessName,
    brand: {
      name: s.businessName,
      what: s.what,
      audience: s.audience,
      market: s.market,
      language: s.language,
      differences: s.differences,
      website: s.website,
    },
    platforms: s.platforms,
    setupAtMs: Date.now(),
  });
  // The payment was filed under their email before there was a business name; the admin's list reads better with it.
  const theirs = await db.collection('studioPayments').where('wid', '==', wid).get();
  await Promise.all(theirs.docs.map((d) => d.ref.update({ business: s.businessName })));

  await inWorkspace(wid, async () => {
    await sdb.doc('system/socialAutomation').set(
      {
        // A nested merge, so the other four boxes of the brief are untouched.
        brief: { about: aboutFrom(s) },
        competitors,
        platforms: s.platforms,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ctx.uid,
      },
      { merge: true },
    );
  });

  return { ok: true, workspaceId: wid };
});

/** Upper case letters and digits only: "TXN 12-ab" and "txn12AB" are the same transfer. */
export const txnKey = (txnId: string): string => txnId.toUpperCase().replace(/[^A-Z0-9]/g, '');

// 1GiB and two minutes: the receipt is read by Tesseract on this function's CPU.
export const studioSubmitPayment = onCall({ timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  const ctx = requireAuth(req);
  // No workspace yet: the sign-up's pay-first path. A plan only, from a proved address.
  const wid = typeof ctx.token.ws === 'string' ? ctx.token.ws : null;
  if (!wid && ctx.token.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Verify your email first — type the code we sent you.');
  }
  const parsed = z
    .object({
      plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]).optional(),
      billing: z.enum(['month', 'year']).optional().default('month'),
      /** A month of AI calling and WhatsApp instead of a plan, priced from the rate card. */
      agents: packageSchema.optional(),
      /** Credit days instead of a plan: one of the packs, a dollar a day. */
      credits: z
        .number()
        .int()
        .refine((n) => (CREDIT_PACKS as readonly number[]).includes(n))
        .optional(),
      /** TRIAL_USD for one day of the plan named beside it, instead of a month of it. */
      trial: z.literal(true).optional(),
      txnId: text(60).optional().default(''),
      screenshotPath: text(300).optional().default(''),
    })
    .refine((d) => [d.plan, d.agents, d.credits].filter(Boolean).length === 1)
    // A trial is a day OF a plan, so it comes with one and never with a package or credits.
    .refine((d) => !d.trial || Boolean(d.plan))
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Choose a plan.');
  const { billing, agents, credits, trial, txnId, screenshotPath } = parsed.data;
  if (!wid && (agents || credits)) throw new HttpsError('failed-precondition', 'Sign up for Vexa first.');
  // The day is what a workspace starts on, so it can only be bought before there is one.
  if (trial && wid) throw new HttpsError('failed-precondition', 'The one-day trial is only for a new workspace.');
  const key = txnKey(txnId);
  // Both, always: the ID is what can be claimed once, the screenshot what the check reads.
  if (!screenshotPath || key.length < 6) {
    throw new HttpsError('invalid-argument', 'Upload the payment screenshot and type the transaction ID (at least 6 letters or digits).');
  }
  if (!screenshotPath.startsWith(wid ? `workspaces/${wid}/payments/` : `studioSignup/${ctx.uid}/payments/`)) {
    throw new HttpsError('permission-denied', `Upload the screenshot from the ${wid ? 'Billing' : 'sign-up'} page.`);
  }

  const ws = wid ? ((await workspaceRef(wid).get()).data() as Workspace | undefined) : undefined;
  if (wid && (!ws || ws.ownerUid !== ctx.uid)) throw new HttpsError('permission-denied', 'This workspace is not yours.');
  if (!wid) {
    // One transfer at a time before the workspace exists: a second would buy nothing until the first is decided and used.
    const earlier = await db.collection('studioPayments').where('uid', '==', ctx.uid).where('wid', '==', null).get();
    if (earlier.docs.some((d) => d.get('status') !== 'rejected')) {
      throw new HttpsError('already-exists', 'We already have a payment from you. Once it is approved, tell us about your business to start.');
    }
  }
  // The agents work from the Sales page, so a package on any other plan would be money for nothing.
  if (agents && ws && !PLANS[ws.plan].can.includes('sales')) {
    throw new HttpsError(
      'failed-precondition',
      'AI calling agents come with the Social Media Manager + Meta & Google Ad Expert plan. Upgrade first, then add the package.',
    );
  }
  // An agent package keeps the plan the workspace already has; its price comes from the rate card, never the client.
  const plan = parsed.data.plan ?? ws?.plan;
  if (!plan) throw new HttpsError('invalid-argument', 'Choose a plan.');
  const agentQuote = agents ? quote(agents, await rateCard()) : null;
  const raised = !agents && !credits && !trial && (await customerPriceRaised(ctx.uid, Date.now()));

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
      business: ws?.name ?? null,
      email: ws?.ownerEmail ?? (ctx.token.email as string | undefined) ?? null,
      plan,
      billing: agents || credits || trial ? 'month' : billing,
      amountUsd: agentQuote
        ? agentQuote.priceUsd
        : credits
          ? credits * CREDIT_DAY_USD
          : trial
            ? TRIAL_USD
            : priceUsd(plan, billing, raised),
      ...(agents && agentQuote ? { kind: 'agents', agents, amountPkr: agentQuote.pricePkr } : {}),
      ...(credits ? { kind: 'credits', credits, amountPkr: credits * CREDIT_DAY_USD * PKR_PER_USD } : {}),
      // A day of that plan, not a month of it: one dollar, and the price clock never touches it.
      ...(trial ? { kind: 'trial', amountPkr: TRIAL_USD * PKR_PER_USD } : {}),
      // The receipt check and the admin compare against this, so it has to carry the rise.
      ...(raised && !trial ? { amountPkr: pricePkr(plan, billing, true) } : {}),
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

/**
 * Approve or reject one payment: the plan starts (or, with no workspace yet, is
 * parked on the person), or the transaction ID and receipt are freed so an
 * honest mistake can be sent again.
 *
 * `by` is the admin who decided it, or `stripe` when the card gateway's own
 * signed webhook already proved the money arrived (`cardPay.ts`) — the only
 * caller that is not a person.
 */
export async function decideStudioPayment(paymentId: string, approve: boolean, by: string, note?: string) {
  const card = await rateCard();

  return db.runTransaction(async (tx) => {
    const payRef = db.doc(`studioPayments/${paymentId}`);
    const pay = (await tx.get(payRef)).data() as
      | {
          wid: string | null;
          uid: string;
          plan: PlanId;
          billing?: Billing;
          status: string;
          txnKey: string | null;
          imageSha?: string | null;
          kind?: 'agents' | 'credits' | 'trial';
          agents?: AgentPackage;
          credits?: number;
          amountUsd?: number;
        }
      | undefined;
    if (!pay) throw new HttpsError('not-found', 'No such payment.');
    if (pay.status !== 'pending') throw new HttpsError('failed-precondition', `Already ${pay.status}.`);

    const now = Date.now();
    const decided = { status: approve ? 'approved' : 'rejected', decidedAtMs: now, decidedBy: by, note: note ?? null };
    if (!approve) {
      tx.update(payRef, decided);
      if (pay.txnKey) tx.delete(db.doc(`studioTxnRefs/${pay.txnKey}`));
      if (pay.imageSha) tx.delete(db.doc(`studioReceiptHashes/${pay.imageSha}`));
      return { ok: true, status: 'rejected' };
    }
    // Paid before the business was described: parked on the person; the workspace made next starts on it.
    // A trial payment parks the same way and is what buys the 24 hours (`startTerms`).
    if (!pay.wid) {
      tx.update(payRef, decided);
      const prepaid: Prepaid = {
        plan: pay.plan,
        billing: pay.billing ?? 'month',
        paymentId,
        atMs: now,
        ...(pay.kind === 'trial' ? { trial: true } : {}),
      };
      tx.set(db.doc(`studioUsers/${pay.uid}`), { prepaid }, { merge: true });
      return { ok: true, status: 'approved' };
    }

    const wsRef = workspaceRef(pay.wid);
    const ws = (await tx.get(wsRef)).data() as (Workspace & { agentPlan?: AgentPlan }) | undefined;
    if (!ws) throw new HttpsError('not-found', 'That workspace no longer exists.');
    // A month of AI agents: the package they paid for, from the end of what is already paid.
    if (pay.kind === 'agents' && pay.agents) {
      const until = extendPaid(ws.agentPlan?.paidUntilMs ?? 0, now, PERIOD_MS);
      tx.update(payRef, decided);
      tx.update(wsRef, { agentPlan: planFrom(pay.agents, card, until, by, now, pay.amountUsd) });
      return { ok: true, status: 'approved', paidUntilMs: until };
    }
    // Credit days: added to the balance; `studio/credits.ts` spends them when the team would stop.
    if (pay.kind === 'credits' && pay.credits) {
      tx.update(payRef, decided);
      tx.update(wsRef, { creditDays: FieldValue.increment(pay.credits) });
      tx.set(wsRef.collection('creditLog').doc(), {
        atMs: now,
        day: pktDay(now),
        days: pay.credits,
        usd: pay.credits * CREDIT_DAY_USD,
        why: 'bought',
        paymentId,
      });
      return { ok: true, status: 'approved', creditDays: (ws.creditDays ?? 0) + pay.credits };
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
}

export const adminDecideStudioPayment = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ paymentId: z.string().min(1).max(64).regex(/^[^/]+$/), approve: z.boolean(), note: text(300).optional() })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { paymentId, approve, note } = parsed.data;
  return decideStudioPayment(paymentId, approve, ctx.uid, note);
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
