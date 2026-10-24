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
import { PERIOD_MS, TRIAL_MS, YEAR_MS, type Workspace } from '../plans';
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
};

/** A request carrying custom claims, the way a refreshed ID token does. */
function asUser<T>(data: T, uid: string, claims: Record<string, unknown> = {}): CallableRequest<T> {
  const req = makeReq(data, uid);
  (req.auth as { token: Record<string, unknown> }).token = { uid, ...claims };
  return req;
}

/** Google sign-in, or an address proved with the code: what Firebase puts on the token. */
const VERIFIED = { email: 'owner@bakehouse.test', email_verified: true };

async function signUp(plan = 'content'): Promise<string> {
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
    await expect(deskWorkspace(asUser({}, OWNER, { ws: wid }), 'ads')).rejects.toThrow(/does not include the Meta Ad Expert/);
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
    await expect(deskWorkspace(asUser({}, 'rider-1'), 'content')).rejects.toThrow(/no Velocity Studio workspace/);
  });
});

describe('paying', () => {
  it('normalises a transaction ID so spacing and case cannot make it new', () => {
    expect(txnKey(' txn 12-ab ')).toBe('TXN12AB');
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

  it('a yearly payment is priced 13% off and adds a year when approved', async () => {
    const wid = await signUp('content');
    const res = (await studioSubmitPayment.run(
      asUser(paid(wid, 'ads', 'EP-445566', { billing: 'year' }), OWNER, { ws: wid }),
    )) as { paymentId: string };
    const pay = (await db().doc(`studioPayments/${res.paymentId}`).get()).data()!;
    expect(pay).toMatchObject({ billing: 'year', amountUsd: 250 });

    const before = Date.now();
    await adminDecideStudioPayment.run(asUser({ paymentId: res.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('ads');
    expect(ws.paidUntilMs).toBeGreaterThanOrEqual(before + YEAR_MS);
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

  it('changes the plan, keeps a note, and logs who did it', async () => {
    const wid = await signUp('content');
    const admin1 = (data: Record<string, unknown>) => asUser({ wid, ...data }, ADMIN, { role: 'admin' });
    await adminManageStudioCustomer.run(admin1({ action: 'setPlan', plan: 'ads' }));
    await adminManageStudioCustomer.run(admin1({ action: 'note', note: 'Called them, paying Friday.' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws).toMatchObject({ plan: 'ads', adminNote: 'Called them, paying Friday.' });
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
