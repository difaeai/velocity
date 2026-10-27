/**
 * Many customers on one Velocity Studio, against the emulators.
 *
 * What the owner asked for, in their words: whatever a customer chose, they get
 * exactly that; the month's AI stays inside what their plan allows — never past
 * $5 — and one customer's use never touches another's. So: every plan against
 * every part of the desk, five customers' desks kept apart, each one's AI month
 * counted on its own, AI calls (paid by the agent package) never using up the
 * content month, and the schedulers visiting only the customers a job is for.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { CAP_RESERVE_USD, monthKey, overBudget, resetAiCache, usageId, warmAi } from '../../ai/config';
import { recordAi } from '../../ai/usage';
import { activeEngine, modelReady } from '../../social/engine';
import { HOUSE, deskWorkspace, forEachWorkspace, inWorkspace, sdb } from '../../social/workspace';
import { currentWorkspace } from '../../social/scope';
import { PLANS, type Need, type PlanId, type Workspace } from '../plans';

const saved = { gemini: process.env.GEMINI_KEY_RESEARCH, free: process.env.FREE_MODEL_KEY, claude: process.env.ANTHROPIC_API_KEY };

const asUser = <T>(data: T, uid: string, claims: Record<string, unknown> = {}): CallableRequest<T> => {
  const req = makeReq(data, uid);
  (req.auth as { token: Record<string, unknown> }).token = { uid, ...claims };
  return req;
};

const HOUR = 3600_000;

/** One customer: a workspace on `plan`, owned by `owner-<id>`. */
async function customer(id: string, plan: PlanId, over: Partial<Workspace> = {}): Promise<string> {
  const now = Date.now();
  const ws: Workspace = {
    name: `Shop ${id}`,
    ownerUid: `owner-${id}`,
    ownerEmail: `${id}@shop.test`,
    plan,
    trialEndsAtMs: now + 20 * HOUR,
    paidUntilMs: 0,
    accessUntilMs: now + 20 * HOUR,
    createdAtMs: now,
    brand: { name: `Shop ${id}`, what: 'things', audience: 'people', market: 'Lahore', language: 'English', differences: '', website: '' },
    ...over,
  };
  ws.accessUntilMs = Math.max(ws.trialEndsAtMs, ws.paidUntilMs);
  await db().doc(`workspaces/${id}`).set(ws);
  return id;
}

/** Put `usd` on a workspace's month, the way the meter does. */
const spend = (wid: string, usd: number, extra: Record<string, unknown> = {}) =>
  db().doc(`aiUsage/${usageId(wid)}`).set({ month: monthKey(), wid, usd, ...extra }, { merge: true });

const reach = (id: string, need: Need) => deskWorkspace(asUser({}, `owner-${id}`, { ws: id }), need);

beforeEach(async () => {
  await clearFirestore();
  resetAiCache();
  process.env.GEMINI_KEY_RESEARCH = 'test-key';
  delete process.env.FREE_MODEL_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

afterAll(() => {
  for (const [k, v] of [
    ['GEMINI_KEY_RESEARCH', saved.gemini],
    ['FREE_MODEL_KEY', saved.free],
    ['ANTHROPIC_API_KEY', saved.claude],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('every plan gets exactly its parts', () => {
  const NEEDS: Need[] = ['content', 'ads', 'sales', 'any'];

  it('across all four plans at once, each customer reaches only what they paid for', async () => {
    const plans: PlanId[] = ['sales', 'content', 'ads', 'all'];
    for (const plan of plans) await customer(`c-${plan}`, plan);

    for (const plan of plans) {
      for (const need of NEEDS) {
        const allowed = need === 'any' || PLANS[plan].can.includes(need as Exclude<Need, 'any'>);
        const call = reach(`c-${plan}`, need);
        if (allowed) await expect(call).resolves.toBe(`c-${plan}`);
        else await expect(call).rejects.toThrow(/does not include/);
      }
    }
  });

  it('a lapsed or paused customer reaches nothing, whatever their plan includes', async () => {
    await customer('lapsed', 'all', { trialEndsAtMs: Date.now() - 1 });
    await customer('paused', 'all', { suspended: true });
    for (const need of NEEDS) {
      await expect(reach('lapsed', need)).rejects.toThrow(/free day is over/);
      await expect(reach('paused', need)).rejects.toThrow(/paused this workspace/);
    }
  });

  it('nobody reaches another customer’s desk, or the house, by claiming it', async () => {
    await customer('a', 'all');
    await customer('b', 'all');
    await expect(deskWorkspace(asUser({}, 'owner-a', { ws: 'b' }), 'content')).rejects.toThrow(/not yours/);
    // A Velocity admin holding a customer's claim is that customer, not a skeleton key.
    await expect(deskWorkspace(asUser({}, 'some-admin', { role: 'admin', ws: 'b' }), 'content')).rejects.toThrow(/not yours/);
    await expect(deskWorkspace(asUser({}, 'owner-a', { ws: HOUSE }), 'content')).rejects.toThrow(/no Velocity Studio workspace/);
    await expect(deskWorkspace(asUser({}, 'owner-a', { ws: '../b' }), 'content')).rejects.toThrow(/no Velocity Studio workspace/);
  });
});

describe('five desks side by side', () => {
  it('keep their pieces apart, and the house desk untouched', async () => {
    const ids = ['s1', 's2', 's3', 's4', 's5'];
    for (const id of ids) await customer(id, 'content');
    // All at once, the way five customers' requests actually arrive.
    await Promise.all(
      ids.map((id) =>
        inWorkspace(id, async () => {
          expect(currentWorkspace()).toBe(id);
          await sdb.doc('socialPosts/today-reel').set({ by: id });
        }),
      ),
    );
    for (const id of ids) {
      expect((await db().doc(`workspaces/${id}/socialPosts/today-reel`).get()).get('by')).toBe(id);
    }
    expect((await db().doc('socialPosts/today-reel').get()).exists).toBe(false);
  });
});

describe('each customer’s AI month', () => {
  it('stops at the plan’s allowance — a little before, so no call can cross it', async () => {
    await customer('content', 'content');
    await customer('all', 'all');
    await spend('content', PLANS.content.aiUsd - CAP_RESERVE_USD);
    await spend('all', 1);
    await warmAi('content');
    await warmAi('all');

    expect(overBudget('content')).toBe(true);
    expect(overBudget('all')).toBe(false);
    expect(activeEngine('content')).toBe('local');
    expect(activeEngine('all')).toBe('gemini');
    // With nothing left to write with, the desk says so instead of spending.
    await expect(reach('content', 'content')).rejects.toThrow(/used up/);
    await expect(reach('all', 'content')).resolves.toBe('all');
  });

  it('never runs past $5 on any plan', () => {
    for (const plan of Object.keys(PLANS) as PlanId[]) expect(PLANS[plan].aiUsd).toBeLessThanOrEqual(5);
  });

  it('one customer’s spend never counts against another’s', async () => {
    await customer('heavy', 'all');
    await customer('light', 'all');
    await inWorkspace('heavy', async () => {
      for (let i = 0; i < 6; i++) await recordAi({ model: 'gemini-2.5-flash', usd: 1, what: 'test' });
    });
    resetAiCache();
    await warmAi('heavy');
    await warmAi('light');
    expect(overBudget('heavy')).toBe(true);
    expect(overBudget('light')).toBe(false);
    expect((await db().doc(`aiUsage/${usageId('light')}`).get()).exists).toBe(false);
  });

  it('AI phone calls, paid by the agent package, never use up the content month', async () => {
    await customer('caller', 'all');
    await recordAi({ model: 'live', usd: 4.95, seconds: 900, what: 'AI phone call', wid: 'caller', apart: true });
    resetAiCache();
    await warmAi('caller');
    expect(overBudget('caller')).toBe(false);
    const row = (await db().doc(`aiUsage/${usageId('caller')}`).get()).data()!;
    // Still on the meter as the true total, for the admin page.
    expect(row.usd).toBeCloseTo(4.95);
    expect(row.apartUsd).toBeCloseTo(4.95);
  });

  it('a credit day lets a customer who used up the month carry on today', async () => {
    await customer('credited', 'content', { creditDays: 2 });
    await spend('credited', PLANS.content.aiUsd);
    await expect(reach('credited', 'content')).resolves.toBe('credited');
    const ws = (await db().doc('workspaces/credited').get()).data() as Workspace;
    expect(ws.creditDays).toBe(1);
  });

  it('Claude, which the meter cannot price, is never a customer’s engine', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    await customer('pro', 'all');
    await warmAi('pro');
    expect(activeEngine(HOUSE)).toBe('claude');
    expect(activeEngine('pro')).toBe('gemini');
  });

  it('a free model keeps a spent customer writing at no cost', async () => {
    process.env.FREE_MODEL_KEY = 'gsk-test';
    await customer('thrifty', 'content');
    await spend('thrifty', 10);
    await warmAi('thrifty');
    expect(activeEngine('thrifty')).toBe('free');
    expect(modelReady('thrifty')).toBe(true);
  });
});

describe('the schedulers', () => {
  it('visit the house and only the customers whose live plan covers the job', async () => {
    await customer('sales-only', 'sales');
    await customer('content-only', 'content');
    await customer('everything', 'all');
    await customer('ads-only', 'ads');
    await customer('expired', 'all', { trialEndsAtMs: Date.now() - 1 });
    await customer('paused', 'all', { suspended: true });

    const visited = async (need: Need) => {
      const seen: string[] = [];
      await forEachWorkspace(need, async () => void seen.push(currentWorkspace()));
      return seen.sort();
    };
    expect(await visited('content')).toEqual(['content-only', 'everything', HOUSE].sort());
    expect(await visited('ads')).toEqual(['ads-only', 'everything', HOUSE].sort());
    expect(await visited('sales')).toEqual(['everything', 'sales-only', HOUSE].sort());
  });

  it('skip a customer with no AI left rather than spend past their month', async () => {
    await customer('spent', 'content');
    await customer('fresh', 'content');
    await spend('spent', 99);
    const seen: string[] = [];
    await forEachWorkspace('content', async () => void seen.push(currentWorkspace()));
    expect(seen).toContain('fresh');
    expect(seen).not.toContain('spent');
  });
});
