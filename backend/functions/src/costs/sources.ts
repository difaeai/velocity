/**
 * The three vendors that will tell us what we spent, and how to ask each one.
 *
 * Raw REST throughout, on the same reasoning as `social/gemini.ts`: the surface
 * used here is one endpoint per vendor, and a client library that ships
 * breaking changes on somebody else's schedule is a bad trade for a job that
 * has to still work unattended next quarter. The one exception is Google's
 * auth, which is a signed-JWT exchange nobody should hand-roll — that comes
 * from `google-auth-library`, already in the tree under firebase-admin.
 *
 * Every fetcher returns amounts in the vendor's own currency together with what
 * that currency is. Nothing here converts to rupees: the console owns the
 * dollar rate, because the rate that matters is the one the card was charged
 * at, and only a person knows that.
 */
import { logger } from 'firebase-functions';
import { GoogleAuth } from 'google-auth-library';

import {
  type AnthropicAdminConfig,
  type CloudBillingConfig,
  type CostWindow,
  type MetaCostConfig,
} from './config';

/** One vendor line, keyed by the catalogue id the console knows it as. */
export interface FetchedAmount {
  amount: number;
  currency: string;
}

export type FetchedAmounts = Record<string, FetchedAmount>;

const REQUEST_TIMEOUT_MS = 60_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Google Cloud ────────────────────────────────────────────────────────────

/**
 * Cloud service name → the catalogue line it belongs to. First match wins, so
 * the order is load-bearing.
 *
 * Two of these are genuinely ambiguous and worth knowing about:
 *
 *  · **2nd-gen Cloud Functions bill as Cloud Run.** They usually surface as
 *    "Cloud Run Functions", which is matched first, but a plain "Cloud Run"
 *    line could be either the backend or App Hosting. It is attributed to App
 *    Hosting because that is what App Hosting is made of.
 *  · **App Hosting is not one SKU.** It bills through Cloud Run, Cloud Build
 *    and Artifact Registry, so all three land on that line.
 *
 * Anything unrecognised goes to `google-cloud-other` rather than being dropped.
 * A cost tool that silently loses line items is worse than no cost tool: the
 * total here always adds up to the actual bill, even when the attribution is
 * imperfect.
 */
const GCP_SERVICE_MAP: [RegExp, string][] = [
  [/firestore/i, 'firebase-firestore'],
  [/cloud storage/i, 'firebase-storage'],
  [/identity platform|firebase authentication/i, 'firebase-auth-phone'],
  [/maps|places|geocoding|directions|distance matrix|routes api/i, 'google-maps'],
  [/generative language|gemini|vertex ai/i, 'google-gemini'],
  [/app hosting/i, 'firebase-app-hosting'],
  [/cloud functions|cloud run functions/i, 'firebase-functions'],
  [/cloud run|cloud build|artifact registry/i, 'firebase-app-hosting'],
];

export interface CloudCostResult {
  amounts: FetchedAmounts;
  /** Services that fell through to the catch-all, for the console to show. */
  unmapped: string[];
}

/**
 * A month of Cloud spend, grouped by service, net of credits.
 *
 * Credits are added rather than ignored because they are negative and they are
 * the free tier: gross cost would tell you what Firestore would have cost if
 * Google charged from the first read, which is not a number anybody pays.
 */
export async function fetchCloudCosts(
  cfg: CloudBillingConfig,
  window: CostWindow,
): Promise<CloudCostResult> {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/bigquery.readonly'],
  });
  const token = await auth.getAccessToken();
  if (!token) throw new Error('No Google credentials available for BigQuery.');

  // The table identifier cannot be a query parameter; config.ts is what makes
  // interpolating it safe, and it is the only reason that regex is so strict.
  const sql = `
    SELECT
      service.description AS service,
      SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net,
      ANY_VALUE(currency) AS currency
    FROM \`${cfg.table}\`
    WHERE usage_start_time >= @start AND usage_start_time < @end
    GROUP BY service
    HAVING net != 0
  `;

  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${cfg.projectId}/queries`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        parameterMode: 'NAMED',
        timeoutMs: 55_000,
        queryParameters: [
          {
            name: 'start',
            parameterType: { type: 'TIMESTAMP' },
            parameterValue: { value: window.start.toISOString() },
          },
          {
            name: 'end',
            parameterType: { type: 'TIMESTAMP' },
            parameterValue: { value: window.end.toISOString() },
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  const body = (await res.json()) as {
    error?: { message?: string };
    jobComplete?: boolean;
    rows?: { f: { v: string | null }[] }[];
  };

  if (!res.ok) {
    throw new Error(body.error?.message ?? `BigQuery returned HTTP ${res.status}.`);
  }
  if (body.jobComplete === false) {
    throw new Error('BigQuery did not finish the query in time.');
  }

  const amounts: FetchedAmounts = {};
  const unmapped: string[] = [];

  for (const row of body.rows ?? []) {
    const service = row.f[0]?.v ?? '';
    const net = Number(row.f[1]?.v ?? 0);
    const currency = row.f[2]?.v || 'USD';
    if (!service || !isFinite(net)) continue;

    const hit = GCP_SERVICE_MAP.find(([pattern]) => pattern.test(service));
    const id = hit ? hit[1] : 'google-cloud-other';
    if (!hit) unmapped.push(service);

    const existing = amounts[id];
    amounts[id] = { amount: (existing?.amount ?? 0) + net, currency };
  }

  return { amounts, unmapped };
}

// ── Anthropic ───────────────────────────────────────────────────────────────

/**
 * A month of Claude spend from the organization cost report.
 *
 * **The API returns cents.** The docs are explicit that `amount` is "in lowest
 * currency units" — `"123.45"` in USD means $1.23. Reading it as dollars is a
 * hundred-fold error that would look entirely plausible on the dashboard, which
 * is why the division is here and loudly commented rather than inline.
 */
export async function fetchAnthropicCost(
  cfg: AnthropicAdminConfig,
  window: CostWindow,
): Promise<FetchedAmounts> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  if (cfg.scheme === 'x-api-key') headers['x-api-key'] = cfg.credential;
  else headers.Authorization = `Bearer ${cfg.credential}`;

  let cents = 0;
  let currency = 'USD';
  let page: string | null = null;

  // A calendar month is at most 31 daily buckets, which is exactly the API's
  // page ceiling — so this loops at most twice, and only at a month boundary.
  for (let guard = 0; guard < 6; guard += 1) {
    const params = new URLSearchParams({
      starting_at: window.start.toISOString(),
      ending_at: window.end.toISOString(),
      bucket_width: '1d',
      limit: '31',
    });
    if (page) params.set('page', page);

    const res = await fetch(
      `https://api.anthropic.com/v1/organizations/cost_report?${params}`,
      { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    const body = (await res.json()) as {
      error?: { message?: string };
      data?: { results?: { amount?: string; currency?: string }[] }[];
      has_more?: boolean;
      next_page?: string | null;
    };

    if (!res.ok) {
      throw new Error(body.error?.message ?? `Anthropic returned HTTP ${res.status}.`);
    }

    for (const bucket of body.data ?? []) {
      for (const result of bucket.results ?? []) {
        const value = Number(result.amount ?? 0);
        if (isFinite(value)) cents += value;
        if (result.currency) currency = result.currency;
      }
    }

    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }

  return { 'anthropic-claude': { amount: cents / 100, currency } };
}

// ── Meta ────────────────────────────────────────────────────────────────────

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * WhatsApp conversation cost, and ad spend when there is an ad account.
 *
 * The two calls are independent and one failing must not take the other down —
 * a WABA that bills through a Solution Partner's credit line returns no COST at
 * all (Meta says to ask the partner), and that is a permanent condition, not an
 * outage. So each is caught separately and simply contributes nothing.
 */
export async function fetchMetaCosts(
  cfg: MetaCostConfig,
  window: CostWindow,
): Promise<FetchedAmounts> {
  const amounts: FetchedAmounts = {};
  const startUnix = Math.floor(window.start.getTime() / 1000);
  const endUnix = Math.floor(window.end.getTime() / 1000);

  if (cfg.wabaId) {
    try {
      const field =
        `conversation_analytics.start(${startUnix}).end(${endUnix})` +
        `.granularity(MONTHLY).metric_types(['COST'])`;
      const res = await fetch(
        `${GRAPH}/${cfg.wabaId}?fields=${encodeURIComponent(field)}&access_token=${encodeURIComponent(cfg.token)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      const body = (await res.json()) as {
        error?: { message?: string };
        conversation_analytics?: {
          data?: { data_points?: { cost?: number; currency?: string }[] }[];
        };
      };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);

      let cost = 0;
      let currency = 'USD';
      for (const group of body.conversation_analytics?.data ?? []) {
        for (const point of group.data_points ?? []) {
          if (typeof point.cost === 'number' && isFinite(point.cost)) cost += point.cost;
          if (point.currency) currency = point.currency;
        }
      }
      amounts['meta-whatsapp'] = { amount: cost, currency };
    } catch (e) {
      logger.warn('costs: WhatsApp conversation cost unavailable', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (cfg.adAccountId) {
    try {
      const timeRange = JSON.stringify({
        since: isoDate(window.start),
        // Graph time ranges are inclusive at both ends; the window's end is
        // exclusive, so step back a day rather than billing an extra one.
        until: isoDate(new Date(window.end.getTime() - 86_400_000)),
      });
      const res = await fetch(
        `${GRAPH}/${cfg.adAccountId}/insights?fields=spend,account_currency` +
          `&time_range=${encodeURIComponent(timeRange)}` +
          `&access_token=${encodeURIComponent(cfg.token)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      const body = (await res.json()) as {
        error?: { message?: string };
        data?: { spend?: string; account_currency?: string }[];
      };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);

      const row = body.data?.[0];
      const spend = Number(row?.spend ?? 0);
      if (isFinite(spend)) {
        amounts['social-ad-spend'] = {
          amount: spend,
          currency: row?.account_currency || 'PKR',
        };
      }
    } catch (e) {
      logger.warn('costs: Meta ad spend unavailable', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return amounts;
}
