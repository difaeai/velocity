/**
 * Velocity Studio — the social desk, sold to other businesses.
 *
 * Three things happen here and nowhere else:
 *
 * 1. **Sign-up.** A signed-in person describes their business and picks a plan;
 *    they get a workspace, a one-day trial of that plan, the eight agents, and a
 *    brief written from their answers. Their account is tied to it by a `ws`
 *    custom claim, which is what every rule and every desk call checks.
 * 2. **Paying.** There is no card gateway yet (the user chose manual payment):
 *    the customer pays by bank transfer / EasyPaisa / JazzCash to the receiving
 *    accounts on file, then sends a screenshot or the transaction ID. A
 *    transaction ID can be claimed once, ever — the same bookkeeping defence the
 *    driver top-ups use, because the screenshot itself proves nothing.
 * 3. **Approving.** An admin checks the money arrived and approves: the plan is
 *    set to what was paid for and a month is added. Rejecting frees the
 *    transaction ID so an honest typo can be sent again.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { auth, db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth } from '../lib/guards';
import { seedTeam } from '../social/employees';
import { EMPTY_BRIEF } from '../social/types';
import { inWorkspace, sdb, workspaceRef } from '../social/workspace';
import { PLAN_IDS, PLANS, TRIAL_MS, extendPaid, type PlanId, type Workspace } from './plans';

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
  });

  // Merged, never replaced: a person may also hold a role claim from the ride app.
  const user = await auth.getUser(ctx.uid);
  await auth.setCustomUserClaims(ctx.uid, { ...(user.customClaims ?? {}), ws: ref.id });

  return { ok: true, workspaceId: ref.id, trialEndsAtMs: workspace.trialEndsAtMs };
});

/** Upper case letters and digits only: "TXN 12-ab" and "txn12AB" are the same transfer. */
export const txnKey = (txnId: string): string => txnId.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const studioSubmitPayment = onCall(async (req) => {
  const ctx = requireAuth(req);
  const wid = ctx.token.ws;
  if (typeof wid !== 'string') throw new HttpsError('failed-precondition', 'Sign up for Velocity Studio first.');
  const parsed = z
    .object({
      plan: z.enum(PLAN_IDS as [PlanId, ...PlanId[]]),
      txnId: text(60).optional().default(''),
      screenshotPath: text(300).optional().default(''),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Choose a plan.');
  const { plan, txnId, screenshotPath } = parsed.data;
  const key = txnKey(txnId);
  if (!screenshotPath && key.length < 6) {
    throw new HttpsError('invalid-argument', 'Upload the payment screenshot or type the transaction ID (at least 6 letters or digits).');
  }
  if (screenshotPath && !screenshotPath.startsWith(`workspaces/${wid}/payments/`)) {
    throw new HttpsError('permission-denied', 'Upload the screenshot from the Billing page.');
  }

  const ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  if (!ws || ws.ownerUid !== ctx.uid) throw new HttpsError('permission-denied', 'This workspace is not yours.');

  const paymentRef = db.collection('studioPayments').doc();
  await db.runTransaction(async (tx) => {
    if (key) {
      const claimRef = db.doc(`studioTxnRefs/${key}`);
      if ((await tx.get(claimRef)).exists) {
        throw new HttpsError('already-exists', 'That transaction ID has already been sent. If this is a mistake, contact us.');
      }
      tx.set(claimRef, { paymentId: paymentRef.id, wid, atMs: Date.now() });
    }
    tx.set(paymentRef, {
      wid,
      uid: ctx.uid,
      business: ws.name,
      email: ws.ownerEmail,
      plan,
      amountUsd: PLANS[plan].usd,
      txnId: txnId || null,
      txnKey: key || null,
      screenshotPath: screenshotPath || null,
      status: 'pending',
      createdAtMs: Date.now(),
      decidedAtMs: null,
      decidedBy: null,
      note: null,
    });
  });
  return { ok: true, paymentId: paymentRef.id };
});

export const adminDecideStudioPayment = onCall(async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({ paymentId: z.string().min(1).max(64).regex(/^[^/]+$/), approve: z.boolean(), note: text(300).optional() })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { paymentId, approve, note } = parsed.data;

  return db.runTransaction(async (tx) => {
    const payRef = db.doc(`studioPayments/${paymentId}`);
    const pay = (await tx.get(payRef)).data() as
      | { wid: string; plan: PlanId; status: string; txnKey: string | null }
      | undefined;
    if (!pay) throw new HttpsError('not-found', 'No such payment.');
    if (pay.status !== 'pending') throw new HttpsError('failed-precondition', `Already ${pay.status}.`);

    const now = Date.now();
    const decided = { status: approve ? 'approved' : 'rejected', decidedAtMs: now, decidedBy: ctx.uid, note: note ?? null };
    if (!approve) {
      tx.update(payRef, decided);
      if (pay.txnKey) tx.delete(db.doc(`studioTxnRefs/${pay.txnKey}`));
      return { ok: true, status: 'rejected' };
    }

    const wsRef = workspaceRef(pay.wid);
    const ws = (await tx.get(wsRef)).data() as Workspace | undefined;
    if (!ws) throw new HttpsError('not-found', 'That workspace no longer exists.');
    const paidUntilMs = extendPaid(ws.paidUntilMs, now);
    tx.update(payRef, decided);
    tx.update(wsRef, {
      plan: pay.plan,
      paidUntilMs,
      accessUntilMs: Math.max(ws.trialEndsAtMs, paidUntilMs),
    });
    return { ok: true, status: 'approved', paidUntilMs };
  });
});
