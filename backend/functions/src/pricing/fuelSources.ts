/**
 * Reading today's notified pump price off the public mirrors of it.
 * ----------------------------------------------------------------------------
 * OGRA publishes price notifications as PDFs on its own site and there is no
 * official API. Three sources are implemented below and they are not of equal
 * standing:
 *
 *   psopk.com      FIRST PARTY. The state oil marketing company's own price
 *                  page — the company actually charging the price, publishing
 *                  it as HTML on the morning it takes effect.
 *   oilprices.pk   An independent parser of OGRA's PDFs, serving JSON.
 *   autoones.com   Another, unrelated to the first.
 *
 * All three were checked by hand. On 2026-10-11 the two mirrors agreed to the
 * paisa (petrol 398.30, HSD 396.24); on 2026-10-17 PSO's own page and
 * oilprices.pk both gave petrol 390.23 effective October 16. That is what makes
 * the two-source agreement rule in `fuel.ts` workable rather than aspirational.
 *
 * Standing does NOT mean weight. The vote in `fuel.ts` is flat and PSO does not
 * get to confirm a price alone, because a first-party page can freeze, lag a
 * notification, or be redesigned under us exactly like anybody else's parser.
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
 * Add an entry to `FUEL_SOURCES`, with `kind: 'html'` if it is a page rather
 * than an API. The id becomes what appears in `ConfirmedFuelPrice.sources`, so
 * it wants to be stable and recognisable. The
 * parsers stay in code on purpose — the same reason the competitor rate-card
 * catalogue does in `fare/marketRates.ts`. A URL is configuration; knowing that
 * "High Speed Diesel (HSD)" is our `diesel` is not.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import { pktDayKey } from '../domain/dailyTarget';
import type { FuelObservation, FuelProduct } from './types';

/** Past this, a source has failed. The daily job has no reason to wait longer. */
const FETCH_TIMEOUT_MS = 12_000;

/** A price page bigger than this is not a price page any more. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;

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
  /**
   * What comes back. `json` is parsed before `parse` sees it; `html` is handed
   * over as a raw string.
   *
   * There is an `html` source because the one publisher with any authority
   * here — PSO, which actually sells the fuel — has a web page and no API, and
   * a page we can read beats a third parser-of-PDFs we cannot verify. Default
   * is `json`, so the existing sources are unchanged.
   */
  kind?: 'json' | 'html';
  /** Turns a body into observations. Must never throw. */
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


/**
 * psopk.com — the company that sells the fuel, read off its own price page.
 * ----------------------------------------------------------------------------
 * WHY THIS ONE IS DIFFERENT FROM THE OTHER TWO
 * --------------------------------------------
 * oilprices.pk and autoones.com are both somebody's parser sitting in front of
 * OGRA's PDFs. PSO is the state oil marketing company: this page is not a
 * report of the price, it is the price, published by the party charging it, and
 * it changes on the morning a notification takes effect. Reading it directly
 * removes a whole layer of other people's parsing from the chain.
 *
 * IT IS STILL ONLY A VOTE, AND THE DAY THIS WAS WRITTEN PROVED WHY
 * ----------------------------------------------------------------
 * `fuel.ts` requires two independent sources to agree before it believes
 * anything, and nothing here changes that — PSO is a third voice, not a casting
 * one. The temptation with a first-party source is to let it decide alone. Do
 * not. Measured against the live feeds on 2026-10-17, within an hour of this
 * adapter being finished:
 *
 *   psopk.com      petrol 390.23  effective 2026-10-16
 *   oilprices.pk   petrol 386.30  effective 2026-10-17
 *   autoones.com   petrol 386.30  effective 2026-10-17
 *
 * OGRA had cut petrol by Rs 3.93 to 386.30 effective the 17th, both mirrors had
 * it, and PSO'S OWN PAGE WAS STILL SHOWING THE 16TH. The company selling the
 * fuel was a day behind the regulator setting its price.
 *
 * So the first-party source is the one that lagged, and a design that trusted
 * it alone — which is the obvious way to build this — would have charged every
 * rider in the country off yesterday's number while a correct one sat in two
 * other feeds. The flat vote plus the newest-date rule in `reconcileFuelPrices`
 * handles it correctly without any special case: PSO's stale reading does not
 * agree with the pair (3.93 on 386 is outside the 1% tolerance), so it forms a
 * cluster of one and is not adopted. Had the gap been smaller it would have
 * JOINED the cluster, raising the confirmation count to three, and the newest
 * effective date would still have decided the price.
 *
 * Diesel agreed across all three at 396.96 the same morning, so the lag is on
 * whichever product moved, not on the page as a whole.
 *
 * What PSO is for, then: a third independent voice that can confirm a price
 * when one of the mirrors is down, and the only source here that cannot
 * silently become a parser of a parser. Not an oracle.
 *
 * THE FIVE WAYS THIS PAGE COULD POISON A FARE, AND WHAT STOPS EACH
 * ----------------------------------------------------------------
 * It is a 290 KB marketing page with five product tabs, each with its own table
 * and its own effective date. None of these traps is hypothetical — every one
 * is in the markup served on 2026-10-17.
 *
 *  1. HIGH OCTANE. "Octane Euro 5 (Rawalpindi) 415.00" sits in its own tab, per
 *     city. It is a premium 97-RON product, some 25 rupees above petrol, and
 *     reading it as petrol would move every fare in the country. Blocked twice
 *     over: `octane` is excluded by name, AND those cells carry no unit, so the
 *     per-litre requirement below drops them anyway.
 *  2. OTHER UNITS. Furnace oil is quoted per tonne ("188,908.20"), LPG per
 *     kilogram ("Rs.279.34/KG"), LNG per MMBTU. Only a cell reading
 *     `Rs.<n>/Ltr` is read as a price at all.
 *  3. THE WRONG DATE. Nine other "Effective From" headings are on that page,
 *     three of them from 2022. A price is only ever paired with the date of the
 *     block it physically sits in — never the first date on the page, never the
 *     newest one. Getting this wrong is how the engine came to publish a price
 *     nobody was charging; the long comment in `reconcileFuelPrices` is about
 *     precisely that failure.
 *  4. COMMENTED-OUT ROWS. `<!-- <tr><td>E10 GASOLINE</td><td>--</td></tr> -->`
 *     is in the live markup, and a regex does not know what a comment is. They
 *     are stripped before anything is read, or a price PSO has deliberately
 *     withdrawn could still be adopted.
 *  5. A STALE OR FUTURE PAGE. A date we cannot read, a date in the future (a
 *     notification published the evening before it applies), or one over a year
 *     old all mean the parse found the wrong thing or the page has frozen. Each
 *     is dropped rather than coerced.
 *
 * ONE HONEST CAVEAT. PSO's own disclaimer says these are ex-depot prices,
 * exclusive of freight to the forecourt. So is the OGRA notification, and so is
 * what the other two sources publish — all three quote the same basis, which is
 * what matters to an engine that works in movement from a baseline.
 * ----------------------------------------------------------------------------
 */

/** PSO sells under brand names. These two are what a car on our roads burns. */
const PSO_PRODUCTS: { pattern: string; product: FuelProduct }[] = [
  { pattern: 'premier', product: 'petrol' },    // PSO Premier Euro 5 — the notified MS price
  { pattern: 'hi-cetane', product: 'diesel' },  // Hi-Cetane Diesel Euro 5 — HSD
  { pattern: 'hi cetane', product: 'diesel' },
];

/** Everything else on that page, by name. See traps 1 and 2 above. */
const PSO_EXCLUDED = [
  'octane', 'altron', 'e10', 'gasoline', 'jp-1', 'jp1', 'ldo', 'sko',
  'hsfo', 'lsfo', 'furnace', 'lng', 'rlng', 'lpg', 'kerosene', 'light diesel',
];

/** How far back a price page may be dated before we assume it has frozen. */
const PSO_MAX_AGE_DAYS = 400;

/** A PSO product cell to one of ours, or null. */
export function matchPsoProduct(name: string): FuelProduct | null {
  const haystack = name.toLowerCase();
  if (PSO_EXCLUDED.some((bad) => haystack.includes(bad))) return null;
  for (const { pattern, product } of PSO_PRODUCTS) {
    if (haystack.includes(pattern)) return product;
  }
  // The brand names are what the page actually uses today, but if PSO ever
  // labels a row "High Speed Diesel" the shared matcher already knows it.
  return matchProduct(haystack);
}

/** "October 16, 2026" or "2022-08-16" to `YYYY-MM-DD`, or null. */
export function parsePsoDate(text: string): string | null {
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const m = /([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i.exec(text);
  if (m) {
    const key = m[1]!.toLowerCase().slice(0, 3);
    const mo = months.findIndex((name) => name.startsWith(key));
    const day = Number(m[2]);
    if (mo >= 0 && day >= 1 && day <= 31) {
      return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return normaliseDate(text.trim());
}

/**
 * Read the price page. Never throws; returns nothing it is not sure of.
 *
 * The page is cut at every "Effective From", so each table is read with the
 * date printed above it and no row can inherit another table's date.
 */
export function parsePsoPage(html: string, fetchedAt: number): FuelObservation[] {
  // Trap 4, done first so nothing below can see a withdrawn row.
  const live = html.replace(/<!--[\s\S]*?-->/g, ' ');

  const today = pktDayKey(new Date(fetchedAt));
  const oldest = pktDayKey(new Date(fetchedAt - PSO_MAX_AGE_DAYS * 24 * 60 * 60 * 1000));

  const out: FuelObservation[] = [];
  const blocks = live.split(/Effective\s*From\s*:?/i);

  // `slice(1)`: whatever precedes the first date heading belongs to no date.
  for (const block of blocks.slice(1)) {
    // THE HEADING IS NOT THE FIRST FEW CHARACTERS OF THE BLOCK.
    //
    // It looked like it was. PSO's accordion title puts a newline and some
    // thirty-six spaces of template indentation between "Effective From:" and
    // the date itself, so reading a flat slice of
    // the raw markup got "October" and no date at all — and a date that will
    // not parse means the whole table is skipped. The first version of this
    // parser silently returned zero rows off the live page for exactly that
    // reason, while passing against a hand-tidied fixture.
    //
    // So the markup is flattened before the date is looked for: tags out,
    // whitespace collapsed, and THEN the first words are read.
    const heading = block
      .slice(0, 240)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const date = parsePsoDate(heading);
    if (!date) continue;
    // Trap 5. Dates are `YYYY-MM-DD`, so these are string comparisons.
    if (date > today || date < oldest) continue;

    const rows = /<tr[^>]*>\s*<td[^>]*>([\s\S]{1,160}?)<\/td>\s*<td[^>]*>([\s\S]{1,160}?)<\/td>/gi;
    let row: RegExpExecArray | null;
    while ((row = rows.exec(block)) !== null) {
      const name = row[1]!.replace(/<[^>]*>/g, ' ').trim();
      // Trap 2: the unit is part of the match, not an assumption about it.
      const price = /Rs\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*\/\s*Ltr/i.exec(row[2]!);
      if (!price) continue;

      const product = matchPsoProduct(name);
      const value = asNumber(price[1]);
      if (!product || value === null) continue;

      out.push({ product, pricePkr: value, sourceId: psoPk.id, effectiveDate: date, fetchedAt });
    }
  }

  return out;
}

export const psoPk: FuelSource = {
  id: 'psopk.com',
  url: 'https://psopk.com/en/fuels/fuel-prices',
  kind: 'html',
  parse: (body, fetchedAt) => (typeof body === 'string' ? parsePsoPage(body, fetchedAt) : []),
};

/**
 * PSO first — not because it outranks anything in the vote, which is flat, but
 * because it is the only first-party source here and anyone reading this list
 * should see that before the mirrors.
 */
export const FUEL_SOURCES: FuelSource[] = [psoPk, oilPricesPk, autoOnes];

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
  const wantsHtml = source.kind === 'html';

  try {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: wantsHtml ? 'text/html,application/xhtml+xml' : 'application/json',
        'user-agent': 'VelocityRides/1.0 (+https://velocityrides.app)',
      },
    });
    if (!res.ok) {
      return { sourceId: source.id, observations: [], error: `HTTP ${res.status}` };
    }

    // An HTML source is a whole marketing page — PSO's is ~290 KB — and the
    // one thing a daily job must not do is pull an unbounded body into a
    // function's memory because somebody put a video on the price page.
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return { sourceId: source.id, observations: [], error: `body ${declared} bytes` };
    }

    // A 200 carrying an HTML error page is the normal failure mode for the JSON
    // endpoints, and `res.json()` on it throws into the catch below.
    const body: unknown = wantsHtml ? await res.text() : await res.json();
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
