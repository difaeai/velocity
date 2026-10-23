/**
 * Velocity Studio against the emulators: signing up makes an isolated
 * workspace, a customer reaches only their own desk and only what their plan
 * covers, and a transaction ID buys one month once.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { adminDecideStudioPayment, studioCreateWorkspace, studioSubmitPayment, txnKey } from '../index';
import { PERIOD_MS } from '../plans';
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

async function signUp(plan = 'content'): Promise<string> {
  const res = (await studioCreateWorkspace.run(asUser({ ...SIGN_UP, plan }, OWNER))) as { workspaceId: string };
  return res.workspaceId;
}

beforeAll(() => {
  // The guard refuses a customer when no model can write for them.
  process.env.GEMINI_KEY_RESEARCH = 'test-key';
});

beforeEach(async () => {
  await clearFirestore();
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
    await expect(studioCreateWorkspace.run(asUser(SIGN_UP, OWNER))).rejects.toThrow(/already has/);
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
    const sent = (await studioSubmitPayment.run(asUser({ plan: 'all', txnId: 'EP-998877' }, OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'all', txnId: 'ep 998877' }, OWNER, { ws: wid })),
    ).rejects.toThrow(/already been sent/);

    const before = Date.now();
    await adminDecideStudioPayment.run(asUser({ paymentId: sent.paymentId, approve: true }, ADMIN, { role: 'admin' }));
    const ws = (await db().doc(`workspaces/${wid}`).get()).data()!;
    expect(ws.plan).toBe('all');
    expect(ws.paidUntilMs).toBeGreaterThanOrEqual(before + PERIOD_MS);
    expect(ws.accessUntilMs).toBe(ws.paidUntilMs);
    await expect(
      adminDecideStudioPayment.run(asUser({ paymentId: sent.paymentId, approve: true }, ADMIN, { role: 'admin' })),
    ).rejects.toThrow(/Already approved/);
  });

  it('rejecting frees the ID so an honest mistake can be sent again', async () => {
    const wid = await signUp();
    const sent = (await studioSubmitPayment.run(asUser({ plan: 'content', txnId: 'JC123456' }, OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    await adminDecideStudioPayment.run(asUser({ paymentId: sent.paymentId, approve: false }, ADMIN, { role: 'admin' }));
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'content', txnId: 'JC123456' }, OWNER, { ws: wid })),
    ).resolves.toMatchObject({ ok: true });
  });

  it('accepts a screenshot only from this workspace’s own payments folder', async () => {
    const wid = await signUp();
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'content', screenshotPath: 'workspaces/other/payments/x.png' }, OWNER, { ws: wid })),
    ).rejects.toThrow(/Billing page/);
    await expect(
      studioSubmitPayment.run(asUser({ plan: 'content', screenshotPath: `workspaces/${wid}/payments/x.png` }, OWNER, { ws: wid })),
    ).resolves.toMatchObject({ ok: true });
  });

  it('only an admin decides', async () => {
    const wid = await signUp();
    const sent = (await studioSubmitPayment.run(asUser({ plan: 'content', txnId: 'BANK778899' }, OWNER, { ws: wid }))) as {
      paymentId: string;
    };
    await expect(
      adminDecideStudioPayment.run(asUser({ paymentId: sent.paymentId, approve: true }, OWNER, { ws: wid })),
    ).rejects.toThrow();
  });
});
