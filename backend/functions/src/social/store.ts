/**
 * The store's real sales, beside the ads that brought them.
 *
 * Meta counts a sale only when a pixel on the site tells it, and most shops
 * here have none, so ROAS was a guess: conversions times what the owner said
 * one is worth. A WooCommerce store knows better. Since WooCommerce 8.5 every
 * order records where it came from (its UTM tags), and every ad the desk makes
 * tags its link with `utm_campaign={{campaign.id}}` (`UTM_TAGS`). So the store
 * can say, per campaign, how many orders the ads really brought and what they
 * were worth — and the Ad Expert judges on that.
 *
 * Connecting is WooCommerce's own one-click flow: the owner names the store,
 * approves "Velocity Studio — read" on their own WordPress, and WooCommerce
 * posts a read-only key to `storeWooCallback`. The key is proved against the
 * store, then sealed like every other token. Only totals are kept: never a
 * customer's name, phone or address.
 */
import { randomBytes } from 'node:crypto';

import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { functionsBase } from '../agents/store';
import { db, SCHEDULE_REGION } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { assertPublicUrl } from '../sales/site';
import { PKR_PER_USD, type AdMetrics } from './adsExpert';
import { open, seal, tokenVaultReady, type SealedSecret } from './secrets';
import { currentWorkspace, deskCall, forEachWorkspace, inWorkspace, sdb } from './workspace';

/** Every desk-made ad's link carries these, so the store can tell which campaign sent each order. */
export const UTM_TAGS = 'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}';

const STORE_PATH = 'system/store';
const SECRET_PATH = 'system/store/secret/credentials';
/** One-use hand-offs between "Connect" and WooCommerce's callback. Shared, never scoped: the callback has no workspace yet. */
const statesRef = (state: string) => db.doc(`storeConnectStates/${state}`);
const STATE_TTL_MS = 30 * 60_000;
const DAY = 86_400_000;
/** Paid or on its way: what counts as a sale. Pending is unpaid; cancelled, refunded and failed never were. */
const SOLD = new Set(['processing', 'completed', 'on-hold']);
/** A month of orders at most per read: 10 pages of 100. */
const MAX_PAGES = 10;

/** One campaign's orders, as the store saw them. */
export interface CampaignSales {
  weekOrders: number;
  weekRevenue: number;
  monthOrders: number;
  monthRevenue: number;
}

/** `system/store` — what the console and the Ad Expert read. No customer data, only totals. */
export interface StoreDoc {
  platform: 'woocommerce';
  url: string;
  connectedAtMs: number;
  lastSyncAtMs: number | null;
  lastStatus: string | null;
  sales: StoreSales | null;
}

export interface StoreSales {
  atMs: number;
  currency: string;
  week: { orders: number; revenue: number };
  month: { orders: number; revenue: number };
  /** The orders the desk's ads brought, by Meta campaign id. */
  byCampaign: Record<string, CampaignSales>;
  /** Where the month's orders came from: "ig / paid_social", "organic", "direct"… most first. */
  sources: { source: string; orders: number }[];
}

/** An order as WooCommerce's REST API returns it, the fields used here only. */
export interface WooOrder {
  id?: number;
  status?: string;
  currency?: string;
  total?: string;
  date_created_gmt?: string;
  meta_data?: { key?: string; value?: unknown }[];
}

const meta = (o: WooOrder, key: string): string => {
  const v = o.meta_data?.find((m) => m.key === key)?.value;
  return typeof v === 'string' ? v.trim() : '';
};

/** Where one order came from, in a few words. */
function sourceOf(o: WooOrder): string {
  const type = meta(o, '_wc_order_attribution_source_type');
  const source = meta(o, '_wc_order_attribution_utm_source');
  const medium = meta(o, '_wc_order_attribution_utm_medium');
  if (type === 'utm' || source) return [source || 'unknown', medium].filter(Boolean).join(' / ');
  return type === 'typein' ? 'direct' : type || 'not recorded';
}

/**
 * The month's orders summed: all of them, the week's, and per campaign the ads
 * named in `utm_campaign`. Only sales count (`SOLD`), and only orders in the
 * store's own currency, which is the one reported. Pure.
 */
export function attribute(orders: WooOrder[], nowMs: number): StoreSales {
  const currency = orders.find((o) => o.currency)?.currency ?? '';
  const week = { orders: 0, revenue: 0 };
  const month = { orders: 0, revenue: 0 };
  const byCampaign: Record<string, CampaignSales> = {};
  const sources = new Map<string, number>();
  for (const o of orders) {
    if (!SOLD.has(o.status ?? '') || (o.currency && o.currency !== currency)) continue;
    const at = Date.parse(`${o.date_created_gmt ?? ''}Z`);
    if (!Number.isFinite(at) || at < nowMs - 30 * DAY || at > nowMs + DAY) continue;
    const total = Number.parseFloat(o.total ?? '');
    if (!Number.isFinite(total) || total < 0) continue;
    const inWeek = at >= nowMs - 7 * DAY;
    month.orders++;
    month.revenue += total;
    if (inWeek) {
      week.orders++;
      week.revenue += total;
    }
    sources.set(sourceOf(o), (sources.get(sourceOf(o)) ?? 0) + 1);
    const campaign = meta(o, '_wc_order_attribution_utm_campaign');
    if (!/^\d{5,40}$/.test(campaign)) continue;
    const c = (byCampaign[campaign] ??= { weekOrders: 0, weekRevenue: 0, monthOrders: 0, monthRevenue: 0 });
    c.monthOrders++;
    c.monthRevenue += total;
    if (inWeek) {
      c.weekOrders++;
      c.weekRevenue += total;
    }
  }
  return {
    atMs: nowMs,
    currency,
    week,
    month,
    byCampaign,
    sources: [...sources.entries()]
      .map(([source, n]) => ({ source, orders: n }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8),
  };
}

/** The store's money in the ad account's currency: the same, or rupees and dollars at the desk's fixed rate; null otherwise. */
export function inAccountCurrency(amount: number, from: string, to: string): number | null {
  if (from === to) return amount;
  if (from === 'PKR' && to === 'USD') return amount / PKR_PER_USD;
  if (from === 'USD' && to === 'PKR') return amount * PKR_PER_USD;
  return null;
}

/**
 * A campaign's week with the store's orders as its conversions — only when
 * Meta saw none of its own (a pixel's count is not added to, so a sale is never
 * counted twice). Pure.
 */
export function withStoreSales(m: AdMetrics, sold: CampaignSales | undefined, storeCurrency: string, accountCurrency: string): AdMetrics {
  if (!sold || sold.weekOrders <= 0 || (m.conversions ?? 0) > 0) return m;
  const worth = inAccountCurrency(sold.weekRevenue, storeCurrency, accountCurrency);
  return {
    ...m,
    conversions: sold.weekOrders,
    conversionKind: 'purchase',
    conversionValue: worth ?? 0,
    costPerConversion: m.spend / sold.weekOrders,
    roas: worth !== null && m.spend > 0 ? worth / m.spend : (m.roas ?? null),
  };
}

/** The store's address as the owner typed it, made the one WooCommerce wants: https, no trailing slash. */
export function storeUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (u.protocol !== 'https:') throw new Error('The store must be on https:// — its key would otherwise cross the internet in the clear.');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/** GET one JSON resource from the store, public addresses only, no redirects, time- and size-capped. */
async function storeGet<T>(url: string, key: { consumerKey: string; consumerSecret: string }): Promise<T> {
  await assertPublicUrl(url);
  const basic = Buffer.from(`${key.consumerKey}:${key.consumerSecret}`).toString('base64');
  let res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { authorization: `Basic ${basic}` } });
  // Some hosts drop the Authorization header; WooCommerce then takes the key in the query, over https only.
  if (res.status === 401) {
    const q = new URL(url);
    q.searchParams.set('consumer_key', key.consumerKey);
    q.searchParams.set('consumer_secret', key.consumerSecret);
    res = await fetch(q, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  }
  if (!res.ok) throw new Error(`The store answered ${res.status}.`);
  const text = await res.text();
  if (text.length > 8_000_000) throw new Error('The store sent more than expected.');
  return JSON.parse(text) as T;
}

/** The month's orders, page by page, from WooCommerce's REST API. */
async function readOrders(url: string, key: { consumerKey: string; consumerSecret: string }, nowMs: number): Promise<WooOrder[]> {
  const after = new Date(nowMs - 30 * DAY).toISOString();
  const all: WooOrder[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await storeGet<WooOrder[]>(`${url}/wp-json/wc/v3/orders?after=${encodeURIComponent(after)}&per_page=100&page=${page}`, key);
    if (!Array.isArray(batch)) throw new Error('The store did not answer with orders.');
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function storeKey(): Promise<{ consumerKey: string; consumerSecret: string } | null> {
  const sealed = (await sdb.doc(SECRET_PATH).get()).data() as { consumerKey?: SealedSecret; consumerSecret?: SealedSecret } | undefined;
  if (!sealed?.consumerKey || !sealed.consumerSecret) return null;
  return { consumerKey: open(sealed.consumerKey), consumerSecret: open(sealed.consumerSecret) };
}

/** Read the store's month and keep its totals. Returns the status line the console shows. */
export async function syncStore(nowMs = Date.now()): Promise<string> {
  const doc = (await sdb.doc(STORE_PATH).get()).data() as StoreDoc | undefined;
  const key = doc ? await storeKey() : null;
  if (!doc || !key) return 'No store is connected.';
  try {
    const sales = attribute(await readOrders(doc.url, key, nowMs), nowMs);
    const fromAds = Object.values(sales.byCampaign).reduce((n, c) => n + c.weekOrders, 0);
    const status = `${sales.week.orders} orders this week, ${fromAds} of them from your ads.`;
    await sdb.doc(STORE_PATH).set({ sales, lastSyncAtMs: nowMs, lastStatus: status }, { merge: true });
    return status;
  } catch (e) {
    const status = `Could not read the store: ${(e as Error).message}`.slice(0, 300);
    await sdb.doc(STORE_PATH).set({ lastSyncAtMs: nowMs, lastStatus: status }, { merge: true });
    return status;
  }
}

/** The store's sales for the Ad Expert, or null with no store connected or nothing read yet. */
export async function storeSales(): Promise<StoreSales | null> {
  return ((await sdb.doc(STORE_PATH).get()).data() as StoreDoc | undefined)?.sales ?? null;
}

// ── connecting ──────────────────────────────────────────────────────────────

/** "Connect": where to send the owner to approve a read-only key on their own store. */
export const storeStartConnect = deskCall('ads', async (req) => {
  const ctx = requireAuth(req);
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const parsed = z.object({ url: z.string().trim().min(4).max(300) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Type your store’s web address.');
  let url: string;
  try {
    url = storeUrl(parsed.data.url);
    await assertPublicUrl(url);
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message || 'That does not look like a public web address.');
  }
  const state = randomBytes(24).toString('hex');
  await statesRef(state).set({ wid: currentWorkspace(), uid: ctx.uid, url, createdAtMs: Date.now() });
  const web = (process.env.VELOCITY_WEB_ORIGIN ?? 'https://velocityrides.app').replace(/\/+$/, '');
  const q = new URLSearchParams({
    app_name: 'Vexa',
    scope: 'read',
    user_id: state,
    return_url: `${web}/dashboard/social/accounts?store=done#store`,
    callback_url: `${functionsBase()}/storeWooCallback`,
  });
  return { authorizeUrl: `${url}/wc-auth/v1/authorize?${q}` };
});

const wooKey = z.object({
  user_id: z.union([z.string(), z.number()]).transform(String),
  consumer_key: z.string().regex(/^ck_[a-f0-9]{40}$/),
  consumer_secret: z.string().regex(/^cs_[a-f0-9]{40}$/),
  key_permissions: z.string().optional(),
});

/**
 * WooCommerce posts the approved key here, server to server. It is accepted
 * only against a live hand-off made by "Connect" in the last half hour, used
 * once, proved against the store, and only then sealed into that workspace.
 * Returns the HTTP status to answer with.
 */
export async function acceptWooKey(method: string, body: unknown): Promise<number> {
  const parsed = wooKey.safeParse(body);
  if (method !== 'POST' || !parsed.success || !/^[a-f0-9]{48}$/.test(parsed.data.user_id)) return 400;
  const ref = statesRef(parsed.data.user_id);
  const state = await db.runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data() as { wid: string; url: string; createdAtMs: number } | undefined;
    if (s) tx.delete(ref);
    return s;
  });
  if (!state || Date.now() - state.createdAtMs > STATE_TTL_MS) return 400;
  const key = { consumerKey: parsed.data.consumer_key, consumerSecret: parsed.data.consumer_secret };
  try {
    // Proved before it is kept: one page of one order.
    await storeGet(`${state.url}/wp-json/wc/v3/orders?per_page=1`, key);
    await inWorkspace(state.wid, async () => {
      await sdb.doc(SECRET_PATH).set({ consumerKey: seal(key.consumerKey), consumerSecret: seal(key.consumerSecret) });
      await sdb.doc(STORE_PATH).set({
        platform: 'woocommerce',
        url: state.url,
        connectedAtMs: Date.now(),
        lastSyncAtMs: null,
        lastStatus: 'Connected. The first read of your orders is under way.',
        sales: null,
      } satisfies StoreDoc);
      await syncStore();
    });
    return 200;
  } catch (e) {
    logger.warn('store: a WooCommerce key could not be proved', { wid: state.wid, error: (e as Error).message });
    return 400;
  }
}

export const storeWooCallback = onRequest({ cors: false, invoker: 'public', timeoutSeconds: 60 }, async (req, res) => {
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      body = null;
    }
  }
  const status = await acceptWooKey(req.method, body);
  res.status(status).json({ ok: status === 200 });
});

export const storeSyncNow = deskCall('ads', { timeoutSeconds: 120 }, async () => ({ ok: true, status: await syncStore() }));

export const storeDisconnect = deskCall('ads', async () => {
  await sdb.doc(SECRET_PATH).delete();
  await sdb.doc(STORE_PATH).delete();
  return { ok: true };
});

/** Whether this workspace has a store connected. The sleeper asks too. */
export const storeConnected = async (): Promise<boolean> => (await sdb.doc(STORE_PATH).get()).exists;

/** Every hour, every workspace with a store: the month's orders read again, totals only. */
export const storeSalesSync = onSchedule(
  { schedule: 'every 60 minutes', region: SCHEDULE_REGION, timeoutSeconds: 300 },
  () =>
    forEachWorkspace('ads', async () => {
      if (!(await storeConnected())) return;
      const status = await syncStore();
      logger.info('store: read the orders', { status });
    }),
);
