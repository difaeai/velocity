/**
 * The owner's WooCommerce store: orders summed per campaign from their UTM
 * tags (totals only), folded into a campaign's week only when Meta saw no sale,
 * and a key accepted only from a live, one-use hand-off — against the
 * emulators, with the store answered here.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';

const KEY = process.env.SOCIAL_TOKEN_KEY;
process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64');

import { metricsFrom } from '../adsExpert';
import { open } from '../secrets';
import { acceptWooKey, attribute, inAccountCurrency, storeUrl, withStoreSales, type WooOrder } from '../store';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const DAY = 86_400_000;
const gmt = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const order = (over: Partial<WooOrder> & { campaign?: string; source?: string; type?: string }): WooOrder => ({
  id: 1,
  status: 'processing',
  currency: 'PKR',
  total: '2500.00',
  date_created_gmt: gmt(NOW - DAY),
  meta_data: [
    { key: '_wc_order_attribution_source_type', value: over.type ?? (over.campaign ? 'utm' : 'organic') },
    ...(over.campaign ? [{ key: '_wc_order_attribution_utm_campaign', value: over.campaign }] : []),
    ...(over.source ? [{ key: '_wc_order_attribution_utm_source', value: over.source }, { key: '_wc_order_attribution_utm_medium', value: 'paid_social' }] : []),
  ],
  ...over,
});

describe('attribute', () => {
  const sales = attribute(
    [
      order({ campaign: '120211', source: 'ig' }),
      order({ campaign: '120211', source: 'fb', total: '1500', date_created_gmt: gmt(NOW - 10 * DAY) }),
      order({ campaign: '120299', source: 'ig', status: 'completed' }),
      order({ type: 'organic' }),
      order({ campaign: '120211', status: 'refunded' }),
      order({ campaign: '120211', status: 'pending' }),
      order({ campaign: '120211', date_created_gmt: gmt(NOW - 40 * DAY) }),
      order({ campaign: 'eid-sale', source: 'newsletter' }),
    ],
    NOW,
  );

  it('counts sales only, in the last month, and the week inside it', () => {
    expect(sales.currency).toBe('PKR');
    expect(sales.month).toEqual({ orders: 5, revenue: 11500 });
    expect(sales.week).toEqual({ orders: 4, revenue: 10000 });
  });

  it('credits each Meta campaign with the orders its links brought', () => {
    expect(sales.byCampaign['120211']).toEqual({ weekOrders: 1, weekRevenue: 2500, monthOrders: 2, monthRevenue: 4000 });
    expect(sales.byCampaign['120299']).toMatchObject({ weekOrders: 1 });
    // A hand-written utm_campaign is not a Meta campaign id: counted in the totals, credited to no campaign.
    expect(Object.keys(sales.byCampaign)).toEqual(['120211', '120299']);
  });

  it('says where the month came from', () => {
    expect(sales.sources[0]).toEqual({ source: 'ig / paid_social', orders: 2 });
    expect(sales.sources.map((s) => s.source)).toContain('organic');
  });
});

describe('withStoreSales', () => {
  const week = metricsFrom({ spend: '5000', impressions: '40000', inline_link_clicks: '400' }, 'link_click');
  const sold = { weekOrders: 4, weekRevenue: 14_000, monthOrders: 9, monthRevenue: 30_000 };

  it('makes the store’s orders the week’s conversions when Meta saw none', () => {
    const m = withStoreSales(week, sold, 'PKR', 'PKR');
    expect(m).toMatchObject({ conversions: 4, conversionKind: 'purchase', conversionValue: 14_000, costPerConversion: 1250 });
    expect(m.roas).toBeCloseTo(2.8, 6);
  });

  it('never adds to a pixel’s own count, so no sale is counted twice', () => {
    const pixel = { ...week, conversions: 3, roas: 1.1 };
    expect(withStoreSales(pixel, sold, 'PKR', 'PKR')).toBe(pixel);
  });

  it('converts rupees for a dollar account, and gives no ROAS for a currency it cannot price', () => {
    expect(inAccountCurrency(2800, 'PKR', 'USD')).toBe(10);
    expect(withStoreSales(week, sold, 'AED', 'PKR').roas).toBeNull();
  });
});

describe('storeUrl', () => {
  it('takes a bare domain, and refuses a store that is not on https', () => {
    expect(storeUrl('myshop.pk/')).toBe('https://myshop.pk');
    expect(storeUrl('https://myshop.pk/shop/')).toBe('https://myshop.pk/shop');
    expect(() => storeUrl('http://myshop.pk')).toThrow(/https/);
  });
});

describe('storeWooCallback', () => {
  const STATE = 'a'.repeat(48);
  // A public address written as an IP, so no name lookup leaves the test; the store itself is answered below.
  const SHOP = 'https://93.184.215.14';
  const seen: string[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    await clearFirestore();
    seen.length = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin !== SHOP) return realFetch(input, init);
      seen.push(url.pathname);
      // The callback reads the real clock, so the order is dated off it too (a fixed NOW expired on 2026-11-07).
      const sale = order({ campaign: '120211', source: 'ig', date_created_gmt: gmt(Date.now() - DAY) });
      const body = url.searchParams.get('per_page') === '1' ? [] : [sale];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    if (KEY === undefined) delete process.env.SOCIAL_TOKEN_KEY;
    else process.env.SOCIAL_TOKEN_KEY = KEY;
  });

  const post = (body: unknown) => acceptWooKey('POST', body);
  const key = { consumer_key: `ck_${'1'.repeat(40)}`, consumer_secret: `cs_${'2'.repeat(40)}`, key_permissions: 'read' };

  it('seals the key into the workspace that asked, once, and reads the orders', async () => {
    await db().doc('workspaces/w1').set({ name: 'Shop', ownerUid: 'o', brand: { name: 'Shop', market: 'Lahore' } });
    await db().doc(`storeConnectStates/${STATE}`).set({ wid: 'w1', uid: 'o', url: SHOP, createdAtMs: Date.now() });

    expect(await post({ ...key, user_id: STATE })).toBe(200);
    const sealed = (await db().doc('workspaces/w1/system/store/secret/credentials').get()).data()!;
    expect(open(sealed.consumerKey)).toBe(key.consumer_key);
    const store = (await db().doc('workspaces/w1/system/store').get()).data()!;
    expect(store).toMatchObject({ platform: 'woocommerce', url: SHOP });
    expect(store.sales.byCampaign['120211'].weekOrders).toBe(1);
    expect(JSON.stringify(store)).not.toMatch(/ck_|cs_/);
    expect(seen).toContain('/wp-json/wc/v3/orders');

    // The hand-off is spent: the same post again is refused.
    expect(await post({ ...key, user_id: STATE })).toBe(400);
  });

  it('refuses a key with no live hand-off, a stale one, or the wrong shape', async () => {
    expect(await post({ ...key, user_id: STATE })).toBe(400);
    await db().doc(`storeConnectStates/${STATE}`).set({ wid: 'w1', uid: 'o', url: SHOP, createdAtMs: Date.now() - 31 * 60_000 });
    expect(await post({ ...key, user_id: STATE })).toBe(400);
    await db().doc(`storeConnectStates/${STATE}`).set({ wid: 'w1', uid: 'o', url: SHOP, createdAtMs: Date.now() });
    expect(await post({ ...key, consumer_key: 'ck_short', user_id: STATE })).toBe(400);
    expect((await db().doc('workspaces/w1/system/store').get()).exists).toBe(false);
  });
});
