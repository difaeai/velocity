/**
 * The ads sync against the emulators with Meta answered here: it reads the
 * week cut by placement, people and region, says why the CPM is what it is,
 * and in `direct` mode stops the platform buying results at five times the
 * price — on the ad set, keeping the rest of its targeting — once a week.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';

const KEY = process.env.SOCIAL_TOKEN_KEY;
process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');

import { adminSyncAds } from '../ads';
import { seal } from '../secrets';

const ACT = 'act_1';
const row = (spend: number, impressions: number, clicks: number, extra: Record<string, string> = {}) => ({
  campaign_id: '123',
  spend: String(spend),
  impressions: String(impressions),
  reach: String(Math.round(impressions / 2)),
  inline_link_clicks: String(clicks),
  ...extra,
});

const posts: { path: string; form: Record<string, string> }[] = [];

function meta(url: URL, init?: RequestInit): unknown {
  const path = url.pathname.replace(/^\/v\d+\.\d+\//, '');
  if (init?.method === 'POST') {
    posts.push({ path, form: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return { success: true };
  }
  const q = url.searchParams;
  if (path === `${ACT}/campaigns`) {
    return {
      data: [
        {
          id: '123',
          name: 'Lawn — Lahore',
          objective: 'OUTCOME_TRAFFIC',
          status: 'ACTIVE',
          effective_status: 'ACTIVE',
          daily_budget: '150000',
          created_time: '2026-10-01T00:00:00+0000',
        },
      ],
    };
  }
  if (path === `${ACT}/ads`) return { data: [{ id: '789', campaign_id: '123', effective_status: 'ACTIVE' }] };
  if (path === '456') return { targeting: { geo_locations: { countries: ['PK'] }, age_min: 22 } };
  if (path !== `${ACT}/insights`) throw new Error(`unexpected ${path}`);
  const breakdowns = q.get('breakdowns');
  if (breakdowns === 'publisher_platform,platform_position') {
    return {
      data: [
        row(6200, 20_000, 300, { publisher_platform: 'instagram', platform_position: 'reels' }),
        row(2800, 30_000, 260, { publisher_platform: 'facebook', platform_position: 'feed' }),
        row(1000, 25_000, 10, { publisher_platform: 'audience_network', platform_position: 'an_classic' }),
      ],
    };
  }
  if (breakdowns === 'age,gender') {
    return { data: [row(7000, 50_000, 400, { age: '25-34', gender: 'female' }), row(3000, 25_000, 170, { age: '35-44', gender: 'female' })] };
  }
  if (breakdowns === 'region') return { data: [row(10_000, 75_000, 570, { region: 'Punjab' })] };
  if (q.get('level') === 'ad') return { data: [{ campaign_id: '123', impressions: '75000', quality_ranking: 'BELOW_AVERAGE_20' }] };
  if (q.get('level') === 'account') return { data: [row(10_000, 75_000, 570, { date_start: '2026-10-31' })] };
  return { data: [row(10_000, 75_000, 570)] };
}

const realFetch = globalThis.fetch;
beforeEach(async () => {
  await clearFirestore();
  posts.length = 0;
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'graph.facebook.com') return realFetch(input, init);
    return new Response(JSON.stringify(meta(url, init)), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await db().doc('system/socialAds').set({
    adAccountId: ACT,
    accountName: 'Test',
    currency: 'PKR',
    pageId: '42',
    mode: 'direct',
    dailyCap: 5000,
    maxDays: 14,
    link: 'https://shop.test',
  });
  await db().doc('system/socialAds/secret/credentials').set({ token: seal('meta-token') });
  await db().doc('socialAds/123').set({ id: '123', managed: true, adsetId: '456', adId: '789', objectiveKind: 'traffic' });
});

afterAll(() => {
  vi.unstubAllGlobals();
  if (KEY === undefined) delete process.env.SOCIAL_TOKEN_KEY;
  else process.env.SOCIAL_TOKEN_KEY = KEY;
});

const admin = (): CallableRequest<unknown> => {
  const req = makeReq({}, 'ads-admin');
  (req.auth as { token: Record<string, unknown> }).token = { uid: 'ads-admin', role: 'admin' };
  return req;
};

describe('the sync reads why it costs what it does', () => {
  it('explains the CPM and stops the wasteful platform on the ad set, once a week', async () => {
    await adminSyncAds.run(admin());
    const c = (await db().doc('socialAds/123').get()).data()!;

    expect(c.cost.level).toBe('normal');
    expect(c.cost.quality).toBe('BELOW_AVERAGE_20');
    expect(c.cost.reasons[0]).toMatch(/bottom 20% for quality/);
    expect(c.cost.placements[0]).toMatchObject({ label: 'Instagram Reels' });
    expect(c.cost.waste).toMatchObject({ platform: 'audience_network', label: 'Audience Network' });

    const cut = posts.find((p) => p.path === '456');
    expect(JSON.parse(cut!.form.targeting)).toEqual({
      geo_locations: { countries: ['PK'] },
      age_min: 22,
      publisher_platforms: ['facebook', 'instagram', 'messenger'],
    });
    expect(c.trimmedAtMs).toBeGreaterThan(0);
    expect(c.autoActions.map((a: { kind: string }) => a.kind)).toContain('trim');

    // The next reading, inside the week, leaves the targeting alone.
    posts.length = 0;
    await adminSyncAds.run(admin());
    expect(posts.some((p) => p.path === '456')).toBe(false);
  });

  it('only advises in ask mode', async () => {
    await db().doc('system/socialAds').set({ mode: 'ask' }, { merge: true });
    await adminSyncAds.run(admin());
    expect(posts.some((p) => p.path === '456')).toBe(false);
    expect((await db().doc('socialAds/123').get()).get('cost.waste.platform')).toBe('audience_network');
  });
});
