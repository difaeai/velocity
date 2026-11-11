/**
 * Velocity Studio against the emulators: signing up needs a verified email and
 * makes an isolated workspace, a customer reaches only their own desk and only
 * what their plan covers, a transaction ID and a screenshot each buy one month
 * once, and an admin can manage every customer.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

// The mailbox and the receipt reader are outside the emulators: capture the
// mail, and record which payments were sent to the check.
const sent = vi.hoisted(() => ({ mail: [] as { to: string; text: string }[], checked: [] as string[] }));
vi.mock('../mailer', () => ({ sendStudioMail: async (m: { to: string; text: string }) => void sent.mail.push(m) }));
vi.mock('../paymentCheck', () => ({ checkStudioPayment: async (id: string) => void sent.checked.push(id) }));

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import {
  adminDecideStudioPayment,
  adminManageStudioCustomer,
  applyManage,
  studioCreateWorkspace,
  studioSubmitPayment,
  txnKey,
} from '../index';
import { studioSendEmailCode, studioTouch, studioVerifyEmailCode } from '../emailCode';
import { PERIOD_MS, PKR_PER_USD, TRIAL_MS, TRIAL_USD, YEAR_MS, type Workspace } from '../plans';
import { PRICE_GRACE_MS, PRICE_WINDOW_MS, studioPriceClock } from '../priceClock';
import { HOUSE, deskWorkspace, inWorkspace, liveWorkspaces, sdb, wsPath } from '../../social/workspace';

const OWNER = 'studio-owner';
const ADMIN = 'studio-admin';

const SIGN_UP = {
  businessName: 'Bake House',
  what: 'Fresh bread and cakes, delivered the same day',
  audience: 'families and offices in Lahore',
  market: 'Lahore, Pakistan',
  language: 'Urdu and English',
  plan: 'content',
  platforms: ['instagram', 'facebook'],
};

/** A request carrying custom claims, the way a refreshed ID token does. */
function asUser<T>(data: T, uid: string, claims: Record<string, unknown> = {}): CallableRequest<T> {
  const req = makeReq(data, uid);
  (req.auth as { token: Record<string, unknown> }).token = { uid, ...claims };
  return req;
}

/** Google sign-in, or an address proved with the code: what Firebase puts on the token. */
const VERIFIED = { email: 'owner@bakehouse.test', email_verified: true };

/**
 * Nothing starts unpaid any more, not even the day (owner, 2026-11-11), so a
 * sign-up here stands on an approved trial payment — what `decideStudioPayment`
 * leaves behind once the dollar has arrived.
 */
async function approvedTrial(uid = OWNER, plan = 'content'): Promise<string> {
  const payRef = db().collection('studioPayments').doc();
  const now = Date.now();
  await payRef.set({
    wid: null,
    uid,
    plan,
    billing: 'month',
    kind: 'trial',
    amountUsd: 1,
    status: 'approved',
    txnKey: null,
    createdAtMs: now,
    decidedAtMs: now,
    decidedBy: ADMIN,
    note: null,
  });
  await db()
    .doc(`studioUsers/${uid}`)
    .set({ prepaid: { plan, billing: 'month', paymentId: payRef.id, atMs: now, trial: true } }, { merge: true });
  return payRef.id;
}

async function signUp(plan = 'content'): Promise<string> {
  // Only when the test has not already paid for something itself — a paid plan must stay the one that wins.
  if (!(await db().doc(`studioUsers/${OWNER}`).get()).get('prepaid')) await approvedTrial(OWNER, plan);
  const res = (await studioCreateWorkspace.run(asUser({ ...SIGN_UP, plan }, OWNER, VERIFIED))) as {
    workspaceId: string;
  };
  return res.workspaceId;
}

/** A payment as the Billing page sends it: both the ID and the screenshot. */
const paid = (wid: string, plan: string, txnId: string, extra: Record<string, unknown> = {}) => ({
  plan,
  txnId,
  screenshotPath: `workspaces/${wid}/payments/${txnId}.jpg`,
  ...extra,
});

beforeAll(() => {
  // The guard refuses a customer when no model can write for them.
  process.env.GEMINI_KEY_RESEARCH = 'test-key';
});

beforeEach(async () => {
  await clearFirestore();
  sent.mail.length = 0;
  sent.checked.length = 0;
  await admin.auth().deleteUser(OWNER).catch(() => undefined);
  await admin.auth().createUser({ uid: OWNER, email: 'owner@bakehouse.test' });
});

describe('signing up', () => {
  it('makes a workspace on a one-day trial, with a team and a brief, and ties the account to it', async () => {
    const wid = await signUp();
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('content');
    expect(ws.ownerUid).toBe(OWNER);
    expect(ws.trialEndsAtMs - ws.createdAtMs).toBe(24 * 3600_000);
    expect(ws.brand.name).toBe('Bake House');
    expect(ws.platforms).toEqual(['instagram', 'facebook']);

    const settings = (await db().doc(`workspaces/${wid}/system/socialAutomation`).get()).data()!;
    expect(settings.brief.about).toContain('Bake House');
    expect(settings.competitors).toEqual([]);
    expect((await db().collection(`workspaces/${wid}/socialEmployees`).get()).size).toBe(8);

    expect((await admin.auth().getUser(OWNER)).customClaims?.ws).toBe(wid);
  });

  it('never touches the Velocity desk', async () => {
    await signUp();
    expect((await db().collection('socialEmployees').get()).size).toBe(0);
    expect((await db().doc('system/socialAutomation').get()).exists).toBe(false);
  });

  it('refuses a second workspace for the same person', async () => {
    await signUp();
    await expect(studioCreateWorkspace.run(asUser(SIGN_UP, OWNER, VERIFIED))).rejects.toThrow(/already has/);
  });

  it('refuses an email nobody has proved yet', async () => {
    await expect(
      studioCreateWorkspace.run(asUser(SIGN_UP, OWNER, { email: 'owner@bakehouse.test', email_verified: false })),
    ).rejects.toThrow(/Verify your email/);
  });

  it('puts the person on the admin list with how they signed in and their workspace', async () => {
    await studioTouch.run(asUser({}, OWNER, { ...VERIFIED, firebase: { sign_in_provider: 'google.com' } }));
    const first = (await db().doc(`studioUsers/${OWNER}`).get()).data()!;
    expect(first).toMatchObject({ method: 'google', emailVerified: true });
    expect(first.workspaceId).toBeUndefined();

    const wid = await signUp();
    const after = (await db().doc(`studioUsers/${OWNER}`).get()).data()!;
    expect(after.workspaceId).toBe(wid);
    expect(after.createdAtMs).toBe(first.createdAtMs);
  });
});

describe('the emailed code', () => {
  const UNVERIFIED = { email: 'owner@bakehouse.test', email_verified: false };
  const codeOf = () => sent.mail.at(-1)!.text.match(/\b(\d{6})\b/)![1];

  it('mails a code, and the right code marks the address verified', async () => {
    await studioSendEmailCode.run(asUser({}, OWNER, UNVERIFIED));
    expect(sent.mail.at(-1)!.to).toBe('owner@bakehouse.test');
    const row = (await db().doc(`studioEmailCodes/${OWNER}`).get()).data()!;
    expect(row.hash).not.toContain(codeOf());

    await studioVerifyEmailCode.run(asUser({ code: codeOf() }, OWNER, UNVERIFIED));
    expect((await admin.auth().getUser(OWNER)).emailVerified).toBe(true);
    expect((await db().doc(`studioEmailCodes/${OWNER}`).get()).exists).toBe(false);
    expect((await db().doc(`studioUsers/${OWNER}`).get()).get('emailVerified')).toBe(true);
  });

  it('counts wrong tries and locks after five', async () => {
    await studioSendEmailCode.run(asUser({}, OWNER, UNVERIFIED));
    const wrong = codeOf() === '000000' ? '111111' : '000000';
    await expect(studioVerifyEmailCode.run(asUser({ code: wrong }, OWNER, UNVERIFIED))).rejects.toThrow(/4 tries left/);
    for (let i = 0; i < 4; i++) {
      await studioVerifyEmailCode.run(asUser({ code: wrong }, OWNER, UNVERIFIED)).catch(() => undefined);
    }
    await expect(studioVerifyEmailCode.run(asUser({ code: codeOf() }, OWNER, UNVERIFIED))).rejects.toThrow(/Too many/);
    expect((await admin.auth().getUser(OWNER)).emailVerified).toBe(false);
  });

  it('refuses an expired code', async () => {
    await studioSendEmailCode.run(asUser({}, OWNER, UNVERIFIED));
    await db().doc(`studioEmailCodes/${OWNER}`).update({ expiresAtMs: Date.now() - 1 });
    await expect(studioVerifyEmailCode.run(asUser({ code: codeOf() }, OWNER, UNVERIFIED))).rejects.toThrow(/expired/);
  });

  it('will not send a second code straight away', async () => {
    await studioSendEmailCode.run(asUser({}, OWNER, UNVERIFIED));
    await expect(studioSendEmailCode.run(asUser({}, OWNER, UNVERIFIED))).rejects.toThrow(/on its way/);
  });

  it('sends nothing to an address that is already verified', async () => {
    await expect(studioSendEmailCode.run(asUser({}, OWNER, VERIFIED))).resolves.toMatchObject({ alreadyVerified: true });
    expect(sent.mail).toHaveLength(0);
  });
});

describe('whose desk a call reaches', () => {
  it('sends an admin to the house desk and keeps house paths unchanged', async () => {
    expect(await deskWorkspace(asUser({}, ADMIN, { role: 'admin' }), 'sales')).toBe(HOUSE);
    expect(wsPath('socialPosts')).toBe('socialPosts');
  });

  it('puts a customer under their own workspace', async () => {
    const wid = await signUp();
    expect(await deskWorkspace(asUser({}, OWNER, { ws: wid }), 'content')).toBe(wid);
    await inWorkspace(wid, async () => {
      expect(wsPath('socialPosts')).toBe(`workspaces/${wid}/socialPosts`);
      await sdb.doc('socialPosts/p1').set({ ok: true });
    });
    expect((await db().doc(`workspaces/${wid}/socialPosts/p1`).get()).exists).toBe(true);
    expect((await db().doc('socialPosts/p1').get()).exists).toBe(false);
  });

  it('refuses what the plan does not include', async () => {
    const wid = await signUp('content');
    await expect(deskWorkspace(asUser({}, OWNER, { ws: wid }), 'ads')).rejects.toThrow(/does not include the Meta & Google Ad Expert/);
  });

  it('refuses everything once the trial is over and nothing is paid', async () => {
    const wid = await signUp('all');
    await db().doc(`workspaces/${wid}`).update({ trialEndsAtMs: Date.now() - 1, accessUntilMs: Date.now() - 1 });
    await expect(deskWorkspace(asUser({}, OWNER, { ws: wid }), 'any')).rejects.toThrow(/free day is over/);
    expect(await liveWorkspaces('any')).not.toContain(wid);
  });

  it('refuses a claim for somebody else’s workspace', async () => {
    const wid = await signUp();
    await expect(deskWorkspace(asUser({}, 'intruder', { ws: wid }), 'content')).rejects.toThrow(/not yours/);
  });

  it('refuses a signed-in person with no workspace', async () => {
    await expect(deskWorkspace(asUser({}, 'rider-1'), 'content')).rejects.toThrow(/no Vexa workspace/);
  });
});

describe('paying', () => {
  it('normalises a transaction ID so spacing and case cannot make it new', () => {
    expect(txnKey(' txn 12-ab ')).toBe('TXN12AB');
  });

  /** The sign-up page's payment: no workspace yet, the receipt under the person's own uid. */
  const prepay = (plan: string, txnId: string) => ({ plan, txnId, screenshotPath: `studioSignup/${OWNER}/payments/${txnId}.jpg` });

  it('a plan paid before the business is described starts the workspace on it, paid, with no trial', async () => {
    const res = (await studioSubmitPayment.run(asUser(prepay('all', 'EP-111222'), OWNER, VERIFIED))) as { paymentId: string };
    expect((await db().doc(`studioPayments/${res.paymentId}`).get()).data()).toMatchObject({ wid: null, uid: OWNER, business: null, plan: 'all' });
    expect(sent.checked).toEqual([res.paymentId]);
    // One transfer at a time until it is decided.
    await expect(studioSubmitPayment.run(asUser(prepay('all', 'EP-333444'), OWNER, VERIFIED))).rejects.toThrow(/already have a payment/);

    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    expect((await db().doc(`studioUsers/${OWNER}`).get()).get('prepaid')).toMatchObject({ plan: 'all', billing: 'month', paymentId: res.paymentId });

    const before = Date.now();
    // The page's plan does not matter: they paid for the whole team.
    const wid = await signUp('content');
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('all');
    expect(ws.paidUntilMs).toBeGreaterThanOrEqual(before + PERIOD_MS);
    expect(ws.trialEndsAtMs).toBeLessThanOrEqual(ws.createdAtMs);
    expect(ws.accessUntilMs).toBe(ws.paidUntilMs);
    expect((await db().doc(`studioUsers/${OWNER}`).get()).get('prepaid')).toBeUndefined();
    expect((await db().doc(`studioPayments/${res.paymentId}`).get()).data()).toMatchObject({ wid, business: 'Bake House' });
  });

  it('a rejected pre-payment frees the way for another, and nothing starts until one is approved', async () => {
    const res = (await studioSubmitPayment.run(asUser(prepay('content', 'EP-777888'), OWNER, VERIFIED))) as { paymentId: string };
    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: false, note: 'Nothing arrived' }, ADMIN, { role: 'admin' }));
    expect((await db().doc(`studioUsers/${OWNER}`).get()).get('prepaid')).toBeUndefined();
    await expect(studioSubmitPayment.run(asUser(prepay('content', 'EP-777889'), OWNER, VERIFIED))).resolves.toMatchObject({ ok: true });

    // Nothing is free any more, not even the day (owner, 2026-11-11).
    await expect(studioCreateWorkspace.run(asUser(SIGN_UP, OWNER, VERIFIED))).rejects.toThrow(/before your team starts/);
    expect((await db().collection('workspaces').get()).empty).toBe(true);
  });

  it('a dollar buys one day of the plan, and no paid time with it', async () => {
    const res = (await studioSubmitPayment.run(
      asUser({ ...prepay('all', 'EP-TRIAL-1'), trial: true }, OWNER, VERIFIED),
    )) as { paymentId: string };
    expect((await db().doc(`studioPayments/${res.paymentId}`).get()).data()).toMatchObject({
      kind: 'trial',
      plan: 'all',
      amountUsd: TRIAL_USD,
      amountPkr: TRIAL_USD * PKR_PER_USD,
    });

    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    expect((await db().doc(`studioUsers/${OWNER}`).get()).get('prepaid')).toMatchObject({ plan: 'all', trial: true });

    const wid = await signUp('content');
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    // A day of the whole team, because that is the plan the dollar was paid against.
    expect(ws.plan).toBe('all');
    expect(ws.paidUntilMs).toBe(0);
    expect(ws.trialEndsAtMs - ws.createdAtMs).toBe(TRIAL_MS);
    expect(ws.accessUntilMs).toBe(ws.trialEndsAtMs);
  });

  it('refuses the trial day to a workspace that already exists', async () => {
    const wid = await signUp('content');
    await expect(
      studioSubmitPayment.run(
        asUser({ plan: 'all', trial: true, txnId: 'EP-TRIAL-2', screenshotPath: `workspaces/${wid}/payments/t.jpg` }, OWNER, { ...VERIFIED, ws: wid }),
      ),
    ).rejects.toThrow(/only for a new workspace/);
  });

  it('before a workspace exists only a plan can be paid for, and only from a proved address', async () => {
    await expect(
      studioSubmitPayment.run(asUser({ credits: 5, txnId: 'EP-555666', screenshotPath: `studioSignup/${OWNER}/payments/c.jpg` }, OWNER, VERIFIED)),
    ).rejects.toThrow(/Sign up for Vexa first/);
    await expect(
      studioSubmitPayment.run(asUser(prepay('all', 'EP-555667'), OWNER, { email: 'owner@bakehouse.test', email_verified: false })),
    ).rejects.toThrow(/Verify your email/);
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'all', txnId: 'EP-555668', screenshotPath: 'studioSignup/somebody-else/payments/c.jpg' }, OWNER, VERIFIED)),
    ).rejects.toThrow(/sign-up page/);
  });

  it('approving sets the paid plan and adds a month; the same ID cannot be sent twice', async () => {
    const wid = await signUp('content');
    const pay = (await studioSubmitPayment.run(asUser(paid(wid, 'all', 'EP-998877'), OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    expect(sent.checked).toEqual([pay.paymentId]);
    await expect(
      studioSubmitPayment.run(asUser(paid(wid, 'all', 'ep 998877'), OWNER, { ws: wid })),
    ).rejects.toThrow(/already been sent/);

    const before = Date.now();
    await adminDecideStudioPayment.run(asUser({ paymentId: pay.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('all');
    expect(ws.paidUntilMs).toBeGreaterThanOrEqual(before + PERIOD_MS);
    expect(ws.accessUntilMs).toBe(ws.paidUntilMs);
    await expect(
      adminDecideStudioPayment.run(asUser({ paymentId: pay.paymentId, approve: true }, ADMIN, { role: 'admin' })),
    ).rejects.toThrow(/Already approved/);
  });

  it('a yearly payment is priced 3% off and adds a year when approved', async () => {
    const wid = await signUp('content');
    const res = (await studioSubmitPayment.run(
      asUser(paid(wid, 'research', 'EP-445566', { billing: 'year' }), OWNER, { ws: wid }),
    )) as { paymentId: string };
    const pay = (await db().doc(`studioPayments/${res.paymentId}`).get()).data()!;
    expect(pay).toMatchObject({ billing: 'year', amountUsd: 232.8 });

    const before = Date.now();
    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('research');
    expect(ws.paidUntilMs).toBeGreaterThanOrEqual(before + YEAR_MS);
  });

  it('charges today’s price inside a customer’s 3 days and $2 more after them', async () => {
    const wid = await signUp('content');
    const charged = async (txnId: string) => {
      const res = (await studioSubmitPayment.run(asUser(paid(wid, 'content', txnId), OWNER, { ws: wid }))) as { paymentId: string };
      return (await db().doc(`studioPayments/${res.paymentId}`).get()).data()!;
    };
    expect((await charged('EP-100001')).amountUsd).toBe(26);

    await db().doc(`studioPriceClocks/u_${OWNER}`).set({ startedAtMs: Date.now() - PRICE_WINDOW_MS - PRICE_GRACE_MS - 1000 });
    expect(await charged('EP-100002')).toMatchObject({ amountUsd: 28, amountPkr: 7840 });
  });

  it('a credit pack never carries the rise', async () => {
    const wid = await signUp('content');
    await db().doc(`studioPriceClocks/u_${OWNER}`).set({ startedAtMs: 0 });
    const res = (await studioSubmitPayment.run(
      asUser({ credits: 5, txnId: 'EP-100003', screenshotPath: `workspaces/${wid}/payments/EP-100003.jpg` }, OWNER, { ws: wid }),
    )) as { paymentId: string };
    expect((await db().doc(`studioPayments/${res.paymentId}`).get()).data()).toMatchObject({ amountUsd: 5, amountPkr: 1400 });
  });

  it('counts a visitor by IP and keeps the clock across visits, without storing the address', async () => {
    const visit = (ip?: string) =>
      studioPriceClock.run({ data: {}, rawRequest: { ip } } as unknown as CallableRequest) as Promise<{ leftMs: number; raised: boolean }>;
    const first = await visit('203.0.113.9');
    expect(first.leftMs).toBeGreaterThan(PRICE_WINDOW_MS - 60_000);

    const clocks = await db().collection('studioPriceClocks').get();
    expect(clocks.size).toBe(1);
    expect(clocks.docs[0].id).toMatch(/^ip_[0-9a-f]{64}$/);

    await db().doc(clocks.docs[0].ref.path).set({ startedAtMs: 0 });
    expect((await visit('203.0.113.9')).raised).toBe(true);
    expect((await visit('203.0.113.10')).raised).toBe(false);
    await expect(visit()).rejects.toThrow(/No address/);
  });

  it('rejecting frees the ID and the screenshot so an honest mistake can be sent again', async () => {
    const wid = await signUp();
    const res = (await studioSubmitPayment.run(asUser(paid(wid, 'content', 'JC123456'), OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    // What the check writes once it has read the picture.
    await db().doc(`studioPayments/${res.paymentId}`).update({ imageSha: 'abc123' });
    await db().doc('studioReceiptHashes/abc123').set({ paymentId: res.paymentId });

    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: false }, ADMIN, { role: 'admin' }));
    expect((await db().doc('studioReceiptHashes/abc123').get()).exists).toBe(false);
    await expect(
      studioSubmitPayment.run(asUser(paid(wid, 'content', 'JC123456'), OWNER, { ws: wid })),
    ).resolves.toMatchObject({ ok: true });
  });

  it('needs both the screenshot and the transaction ID', async () => {
    const wid = await signUp();
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'content', txnId: 'EP-112233' }, OWNER, { ws: wid })),
    ).rejects.toThrow(/screenshot and type the transaction ID/);
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'content', screenshotPath: `workspaces/${wid}/payments/x.png` }, OWNER, { ws: wid })),
    ).rejects.toThrow(/screenshot and type the transaction ID/);
  });

  it('accepts a screenshot only from this workspace’s own payments folder', async () => {
    const wid = await signUp();
    await expect(
      studioSubmitPayment.run(
        asUser({ plan: 'content', txnId: 'EP-556677', screenshotPath: 'workspaces/other/payments/x.png' }, OWNER, { ws: wid }),
      ),
    ).rejects.toThrow(/Billing page/);
    await expect(
      studioSubmitPayment.run(asUser(paid(wid, 'content', 'EP-556677'), OWNER, { ws: wid })),
    ).resolves.toMatchObject({ ok: true });
  });

  it('a dearer plan buys its own month and converts the days left, never the whole paid time', async () => {
    const wid = await signUp('content');
    const left = 300 * 86_400_000; // most of a paid year of Content
    await db().doc(`workspaces/${wid}`).update({ paidUntilMs: Date.now() + left, accessUntilMs: Date.now() + left });
    const res = (await studioSubmitPayment.run(asUser(paid(wid, 'all', 'EP-121212'), OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    const before = Date.now();
    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('all');
    // 300 days of $26 are worth ~244 days of $32, plus the month just paid — not 330 days of the whole team.
    const days = (ws.paidUntilMs - before) / 86_400_000;
    expect(days).toBeGreaterThan(273);
    expect(days).toBeLessThan(275);
  });

  it('sells an AI agents package only on the plan that can use it', async () => {
    const wid = await signUp('content');
    const pkg = { agents: 1, numbers: 1, callsPerDay: 10, avgCallMin: 2, waMessagesPerMonth: 0 };
    const send = () =>
      studioSubmitPayment.run(
        asUser({ agents: pkg, txnId: 'EP-343434', screenshotPath: `workspaces/${wid}/payments/a.jpg` }, OWNER, { ws: wid }),
      );
    await expect(send()).rejects.toThrow(/Social Media Manager \+ Meta & Google Ad Expert plan/);
    // The Research Assistant has no one to call on its own behalf either.
    await db().doc(`workspaces/${wid}`).update({ plan: 'research' });
    await expect(send()).rejects.toThrow(/Social Media Manager \+ Meta & Google Ad Expert plan/);
    // A workspace still on the old Sales agents plan works from the Sales page too, so it can buy the package.
    await db().doc(`workspaces/${wid}`).update({ plan: 'sales' });
    await expect(send()).resolves.toMatchObject({ ok: true });
  });

  it('only an admin decides', async () => {
    const wid = await signUp();
    const res = (await studioSubmitPayment.run(asUser(paid(wid, 'content', 'BANK778899'), OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    await expect(
      adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: true }, OWNER, { ws: wid })),
    ).rejects.toThrow();
  });
});

describe('managing a customer', () => {
  const NOW = Date.UTC(2026, 9, 24, 12);
  const WS = { plan: 'content', trialEndsAtMs: NOW + 3600_000, paidUntilMs: 0, accessUntilMs: NOW + 3600_000 } as Workspace;
  const DAY = 86_400_000;

  it('extends a trial from its end, or from now once it is over', () => {
    expect(applyManage(WS, { action: 'extendTrial', days: 2 }, NOW)).toEqual({
      trialEndsAtMs: NOW + 3600_000 + 2 * DAY,
      accessUntilMs: NOW + 3600_000 + 2 * DAY,
    });
    const over = { ...WS, trialEndsAtMs: NOW - DAY };
    expect(applyManage(over, { action: 'extendTrial', days: 1 }, NOW).trialEndsAtMs).toBe(NOW + DAY);
  });

  it('gives days as paid time, on top of whatever is already paid', () => {
    const paidWs = { ...WS, paidUntilMs: NOW + 10 * DAY };
    expect(applyManage(paidWs, { action: 'giveDays', days: 5 }, NOW)).toEqual({
      paidUntilMs: NOW + 15 * DAY,
      accessUntilMs: NOW + 15 * DAY,
    });
  });

  it('a paused workspace reaches nothing until it is resumed, whatever it paid', async () => {
    const wid = await signUp('all');
    const admin1 = (data: Record<string, unknown>) => asUser({ wid, ...data }, ADMIN, { role: 'admin' });
    await adminManageStudioCustomer.run(admin1({ action: 'giveDays', days: 30 }));
    await adminManageStudioCustomer.run(admin1({ action: 'suspend' }));
    await expect(deskWorkspace(asUser({}, OWNER, { ws: wid }), 'content')).rejects.toThrow(/paused/);
    expect(await liveWorkspaces('any')).not.toContain(wid);

    await adminManageStudioCustomer.run(admin1({ action: 'resume' }));
    expect(await deskWorkspace(asUser({}, OWNER, { ws: wid }), 'content')).toBe(wid);
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.paidUntilMs - Date.now()).toBeGreaterThan(29 * DAY);
    expect(ws.trialEndsAtMs - ws.createdAtMs).toBe(TRIAL_MS);
  });

  it('changes the plan, keeps a note the customer cannot read, and logs who did it', async () => {
    const wid = await signUp('content');
    const admin1 = (data: Record<string, unknown>) => asUser({ wid, ...data }, ADMIN, { role: 'admin' });
    await adminManageStudioCustomer.run(admin1({ action: 'setPlan', plan: 'research' }));
    await adminManageStudioCustomer.run(admin1({ action: 'note', note: 'Called them, paying Friday.' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('research');
    // The workspace doc is the customer's to read (firestore.rules); the note lives on the admin-only row.
    expect(ws.adminNote).toBeUndefined();
    expect((await db().doc(`studioUsers/${OWNER}`).get()).get('adminNote')).toBe('Called them, paying Friday.');
    const log = await db().collection('auditLogs').where('wid', '==', wid).get();
    expect(log.docs.map((d) => d.get('type')).sort()).toEqual(['studio.note', 'studio.setPlan']);
  });

  it('only an admin manages', async () => {
    const wid = await signUp();
    await expect(
      adminManageStudioCustomer.run(asUser({ wid, action: 'giveDays', days: 30 }, OWNER, { ws: wid })),
    ).rejects.toThrow();
  });
});
