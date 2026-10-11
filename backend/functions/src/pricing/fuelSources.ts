/**
 * Reading today's notified pump price off the public mirrors of it.
 * ----------------------------------------------------------------------------
 * OGRA publishes price notifications as PDFs on its own site and there is no
 * official API, so every machine-readable source is somebody's parser sitting
 * in front of those PDFs. Two independent ones are implemented below. Both were
 * checked by hand on 2026-10-11 and agreed to the paisa (petrol 398.30, HSD
 * 396.24), which is what makes the two-source agreement rule in `fuel.ts`
 * workable rather than aspirational.
 *
 * EVERY ASSUMPTION HERE IS HOSTILE TO THE SOURCE
 * ----------------------------------------------
 * These endpoints are free, unversioned and owned by people with no obligation
 * to us. They will change shape, go away, start returning HTML error pages with
 * a 200, or quietly serve last fortnight's number for ever. So:
 *
 *  · A source that throws, times out, or parses to nothing contributes no
 *    observations and is not an error — the run continues with whatever else
 *    answered. One source down is survivable by design; it just means no price
 *    is confirmed until it or another comes back.
 *  · Nothing here decides anything. Each adapter returns raw observations and
 *    `fuel.ts` decides what to believe. Adding a third source cannot change the
 *    arithmetic, only strengthen the vote.
 *  · The response is parsed field by field with every value re-validated. A
 *    string where a number belongs, or a product name we do not recognise, is
 *    dropped rather than coerced.
 *
 * ADDING A SOURCE
 * ---------------
 * Add an entry to `FUEL_SOURCES`. The id becomes what appears in
 * `ConfirmedFuelPrice.sources`, so it wants to be stable and recognisable. The
 * parsers stay in code on purpose — the same reason the competitor rate-card
 * catalogue does in `fare/marketRates.ts`. A URL is configuration; knowing that
 * "High Speed Diesel (HSD)" is our `diesel` is not.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import type { FuelObservation, FuelProduct } from './types';

/** Past this, a source has failed. The daily job has no reason to wait longer. */
const FETCH_TIMEOUT_MS = 12_000;

/**
 * Product names seen in the wild, mapped to ours. Matching is lowercase
 * substring, longest pattern first, so "high speed diesel" wins over "diesel"
 * and light diesel oil is never mistaken for HSD.
 */
const PRODUCT_PATTERNS: { pattern: string; product: FuelProduct }[] = [
  { pattern: 'high speed diesel', product: 'diesel' },
  { pattern: 'motor spirit', product: 'petrol' },
  { pattern: 'hsd', product: 'diesel' },
  { pattern: 'petrol', product: 'petrol' },
  { pattern: 'diesel', product: 'diesel' },
];

/**
 * Deliberately NOT matched: Superior Kerosene Oil, Light Diesel Oil and LPG.
 * They appear in the same payloads, no Velocity vehicle runs on them, and a
 * loose `diesel` match on "Light Diesel Oil" would quietly feed the cheaper
 * product into car fares.
 */
const EXCLUDED = ['kerosene', 'sko', 'lpg', 'light diesel', 'ldo', 'cng'];

export function matchProduct(name: string): FuelProduct | null {
  const haystack = name.toLowerCase();
  if (EXCLUDED.some((bad) => haystack.includes(bad))) return null;
  for (const { pattern, product } of PRODUCT_PATTERNS) {
    if (haystack.includes(pattern)) return product;
  }
  return null;
}

/** YYYY-MM-DD, or null. A date we cannot read is not a date we will store. */
export function normaliseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

const asNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

export interface FuelSource {
  id: string;
  url: string;
  /** Turns a parsed JSON body into observations. Must never throw. */
  parse: (body: unknown, fetchedAt: number) => FuelObservation[];
}

/** oilprices.pk — `{ effectiveDate, products: [{ product, pricePkr, unit }] }` */
export const oilPricesPk: FuelSource = {
  id: 'oilprices.pk',
  url: 'https://oilprices.pk/api/latest',
  parse: (body, fetchedAt) => {
    const root = body as { effectiveDate?: unknown; products?: unknown };
    const date = normaliseDate(root?.effectiveDate);
    const rows = Array.isArray(root?.products) ? root.products : [];
    const out: FuelObservation[] = [];

    for (const row of rows) {
      const entry = row as { product?: unknown; pricePkr?: unknown; unit?: unknown };
      // LPG is quoted per kilogram in the same array. A per-kg price in a
      // per-litre field is the exact kind of silent unit error that would move
      // every fare in the country, so the unit is checked, not assumed.
      if (typeof entry.unit === 'string' && !entry.unit.toLowerCase().startsWith('litre')) continue;
      const product = typeof entry.product === 'string' ? matchProduct(entry.product) : null;
      const price = asNumber(entry.pricePkr);
      if (!product || price === null || !date) continue;
      out.push({ product, pricePkr: price, sourceId: oilPricesPk.id, effectiveDate: date, fetchedAt });
    }
    return out;
  },
};

/** autoones.com — `{ prices: [{ fuel, slug, price_pkr, effective_date }] }` */
export const autoOnes: FuelSource = {
  id: 'autoones.com',
  url: 'https://api2.autoones.com/api/fuel-prices',
  parse: (body, fetchedAt) => {
    const root = body as { prices?: unknown };
    const rows = Array.isArray(root?.prices) ? root.prices : [];
    const out: FuelObservation[] = [];

    for (const row of rows) {
      const entry = row as {
        fuel?: unknown;
        slug?: unknown;
        price_pkr?: unknown;
        effective_date?: unknown;
      };
      const name = typeof entry.slug === 'string' ? entry.slug : entry.fuel;
      const product = typeof name === 'string' ? matchProduct(name) : null;
      const price = asNumber(entry.price_pkr);
      const date = normaliseDate(entry.effective_date);
      if (!product || price === null || !date) continue;
      out.push({ product, pricePkr: price, sourceId: autoOnes.id, effectiveDate: date, fetchedAt });
    }
    return out;
  },
};

export const FUEL_SOURCES: FuelSource[] = [oilPricesPk, autoOnes];

export interface SourceResult {
  sourceId: string;
  observations: FuelObservation[];
  /** Why this source contributed nothing, when it did not. */
  error?: string;
}

/**
 * Ask one source. Never throws, never retries.
 *
 * No retry because the caller runs daily against a fortnightly-ish price: a
 * source that is down right now will be asked again tomorrow, long before the
 * number it holds goes stale. Retrying inside the run would only turn one slow
 * source into a slow job.
 */
export async function fetchSource(
  source: FuelSource,
  now: number = Date.now(),
): Promise<SourceResult> {
  try {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json', 'user-agent': 'VelocityRides/1.0 (+https://velocityrides.app)' },
    });
    if (!res.ok) {
      return { sourceId: source.id, observations: [], error: `HTTP ${res.status}` };
    }
    // A 200 carrying an HTML error page is the normal failure mode for these
    // endpoints, and `res.json()` on it throws into the catch below.
    const body: unknown = await res.json();
    const observations = source.parse(body, now);
    return {
      sourceId: source.id,
      observations,
      ...(observations.length === 0 ? { error: 'no usable rows' } : {}),
    };
  } catch (e) {
    return { sourceId: source.id, observations: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ask every source at once. Slow sources cost the job their timeout, not more. */
export async function fetchAllSources(now: number = Date.now()): Promise<SourceResult[]> {
  const results = await Promise.all(FUEL_SOURCES.map((source) => fetchSource(source, now)));
  for (const result of results) {
    if (result.error) {
      logger.warn('fuel source contributed nothing', { source: result.sourceId, error: result.error });
    }
  }
  return results;
}
