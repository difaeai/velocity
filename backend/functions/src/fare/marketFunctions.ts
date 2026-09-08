/**
 * Market comparison endpoints — the server side of "we are cheaper than
 * inDrive and Yango".
 *
 * The comparison is computed here, not on the phone, for two reasons. The
 * undercut changes what the rider is charged, so it has to come from the same
 * place every other money decision comes from; and the competitor rate cards
 * are ops data that no client should be able to rewrite.
 *
 * See ./marketRates.ts for why none of these numbers are hard-coded.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAuth, requireAdmin, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import {
  CityFareConfig, VehicleCategory,
  calculateFare,
} from './fareEngine';
import {
  CityMarketRates, Competitor, CompetitorCategoryRates, MarketComparisonSettings,
  COMPETITORS, DEFAULT_MARKET_SETTINGS, RATE_SOURCE_LABELS,
  compareToMarket, fitRateCard, isPlausibleReport,
} from './marketRates';

const REGION = 'asia-south1';

const CATEGORIES: VehicleCategory[] = ['moto', 'rickshaw', 'mini', 'ac_car', 'luxury'];

// ── Config loading (short TTL — these are read on every fare preview) ─────────

const CACHE_TTL_MS = 5 * 60 * 1000;
const ratesCache = new Map<string, { rates: CityMarketRates | null; at: number }>();
let settingsCache: { settings: MarketComparisonSettings; at: number } | null = null;

async function loadSettings(): Promise<MarketComparisonSettings> {
  if (settingsCache && Date.now() - settingsCache.at < CACHE_TTL_MS) {
    return settingsCache.settings;
  }
  const snap = await db.doc('config/marketComparison').get();
  const stored = snap.exists ? (snap.data() as Partial<MarketComparisonSettings>) : {};
  const settings: MarketComparisonSettings = {
    ...DEFAULT_MARKET_SETTINGS,
    ...stored,
    // An undercut outside this band is a configuration mistake, not a strategy.
    undercutPct: clamp(Number(stored.undercutPct ?? DEFAULT_MARKET_SETTINGS.undercutPct), 0, 0.6),
    maxAgeDays: clamp(Number(stored.maxAgeDays ?? DEFAULT_MARKET_SETTINGS.maxAgeDays), 1, 365),
    minSampleSize: clamp(Number(stored.minSampleSize ?? DEFAULT_MARKET_SETTINGS.minSampleSize), 1, 100),
  };
  settingsCache = { settings, at: Date.now() };
  return settings;
}

async function loadCityRates(cityId: string): Promise<CityMarketRates | null> {
  const hit = ratesCache.get(cityId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rates;

  const snap = await db.doc(`marketRates/${cityId}`).get();
  const rates = snap.exists ? (snap.data() as CityMarketRates) : null;
  ratesCache.set(cityId, { rates, at: Date.now() });
  return rates;
}

function bustCaches(cityId?: string) {
  settingsCache = null;
  if (cityId) ratesCache.delete(cityId);
  else ratesCache.clear();
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

async function loadFareConfig(cityId: string): Promise<CityFareConfig> {
  const snap = await db.doc(`fareConfig/${cityId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', `No fare config for city: ${cityId}`);
  return snap.data() as CityFareConfig;
}

// ── Shared computation, reused by getFareEstimate ─────────────────────────────

export interface MarketAdjustedFare {
  comparison: ReturnType<typeof compareToMarket>;
  settings: MarketComparisonSettings;
}

/**
 * Hold an already-computed fare against the market.
 *
 * `floorFare` is the engine's own driver-protection floor. It is what stops a
 * competitor's cheap promotional pricing from dragging our fares below the
 * point where a driver would take the job.
 *
 * Exported because `getFareEstimate` runs the engine itself and only needs this
 * last step — loading the fare config twice for one quote would be waste.
 */
export async function comparisonFor(
  cityId: string,
  category: VehicleCategory,
  distanceKm: number,
  durationMin: number,
  velocityFare: number,
  floorFare: number,
): Promise<MarketAdjustedFare> {
  const [cityRates, settings] = await Promise.all([loadCityRates(cityId), loadSettings()]);
  const comparison = compareToMarket({
    cityRates, settings, category, distanceKm, durationMin, velocityFare, floorFare,
  });
  return { comparison, settings };
}

/** Run the fare engine for this city, then hold the result against the market. */
export async function marketAdjustedFare(
  cityId: string,
  category: VehicleCategory,
  distanceKm: number,
  durationMin: number,
  surgeMultiplier: number,
): Promise<MarketAdjustedFare> {
  const cfg = await loadFareConfig(cityId);
  const est = calculateFare(cfg, { category, distanceKm, durationMin, surgeMultiplier });
  return comparisonFor(
    cityId, category, distanceKm, durationMin, est.recommendedFare, est.minAcceptableBid,
  );
}

// ── Input parsing ─────────────────────────────────────────────────────────────

function parseComparisonInput(data: Record<string, unknown>) {
  const cityId = data?.cityId;
  const category = data?.category;
  const distanceKm = Number(data?.distanceKm);
  const durationMin = Number(data?.durationMin);

  if (typeof cityId !== 'string' || !cityId) invalid('cityId required');
  if (typeof category !== 'string' || !CATEGORIES.includes(category as VehicleCategory)) {
    invalid('category must be one of: ' + CATEGORIES.join(', '));
  }
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 500) {
    invalid('distanceKm must be 0-500');
  }
  if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 600) {
    invalid('durationMin must be 0-600');
  }
  return {
    cityId: cityId as string,
    category: category as VehicleCategory,
    distanceKm,
    durationMin,
  };
}

// ── Rider-facing ──────────────────────────────────────────────────────────────

/**
 * What the other apps would charge for this trip, and what we charge instead.
 *
 * Returns `available: false` whenever there is no fresh, well-sampled card for
 * the city and category. The booking screen renders nothing in that case, which
 * is the point: we would rather show no comparison than a guessed one.
 */
export const getMarketComparison = onCall({ region: REGION }, async (req) => {
  requireAuth(req);
  const { cityId, category, distanceKm, durationMin } =
    parseComparisonInput((req.data ?? {}) as Record<string, unknown>);

  const { comparison, settings } = await marketAdjustedFare(
    cityId, category, distanceKm, durationMin, 1,
  );

  return {
    ...comparison,
    disclaimer: settings.disclaimer,
    undercutPct: settings.undercutPct,
    // Riders never need the diagnostics; admins read them from the desk.
    excluded: undefined,
  };
});

/**
 * A rider tells us what inDrive or Yango quoted them.
 *
 * This is the only pipe that keeps the rate cards true over time, and it is
 * legitimate data: the rider saw the number in the other app and chose to pass
 * it on. Reports land unreviewed and never move a price by themselves — an
 * admin fits them into a card from the market desk.
 */
export const reportCompetitorQuote = onCall({ region: REGION }, async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'reportCompetitorQuote', 10, 3600);

  const data = (req.data ?? {}) as Record<string, unknown>;
  const { cityId, category, distanceKm, durationMin } = parseComparisonInput(data);
  const competitor = data.competitor as Competitor;
  const quotedFare = Math.round(Number(data.quotedFare));

  const report = {
    competitor,
    category,
    cityId,
    quotedFare,
    distanceKm,
    durationMin,
    competitorClass: typeof data.competitorClass === 'string'
      ? data.competitorClass.slice(0, 40)
      : undefined,
  };
  if (!isPlausibleReport(report)) invalid('That does not look like a real quote.');

  await db.collection('competitorQuoteReports').add({
    ...report,
    competitorClass: report.competitorClass ?? null,
    reportedBy: ctx.uid,
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    // Reports age out of usefulness; a TTL policy on this field clears them.
    expireAt: Timestamp.fromMillis(Date.now() + 180 * 24 * 60 * 60 * 1000),
  });

  logger.info('Competitor quote reported', { competitor, cityId, category, quotedFare });
  return { ok: true };
});

// ── Admin desk ────────────────────────────────────────────────────────────────

function parseRateCard(raw: Record<string, unknown>, uid: string): CompetitorCategoryRates {
  const num = (k: string, lo: number, hi: number) => {
    const v = Number(raw[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) invalid(`${k} must be ${lo}-${hi}`);
    return v;
  };
  const source = raw.source;
  if (typeof source !== 'string' || !(source in RATE_SOURCE_LABELS)) {
    invalid('source must be one of: ' + Object.keys(RATE_SOURCE_LABELS).join(', '));
  }
  const sampleSize = num('sampleSize', 1, 100000);
  const competitorClass = typeof raw.competitorClass === 'string' && raw.competitorClass.trim()
    ? raw.competitorClass.trim().slice(0, 40)
    : invalid('competitorClass required — record which tier of theirs you sampled');

  return {
    base: num('base', 0, 100000),
    includedKm: num('includedKm', 0, 50),
    includedMin: num('includedMin', 0, 120),
    perKm: num('perKm', 0, 10000),
    perMin: num('perMin', 0, 10000),
    minFare: num('minFare', 0, 100000),
    competitorClass,
    source: source as CompetitorCategoryRates['source'],
    sampleSize,
    // Never client-supplied: a card is verified when an admin saves it, and
    // backdating one would defeat the staleness guard.
    verifiedAt: Date.now(),
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : `Saved by ${uid}`,
  };
}

/** Admin: write one competitor's card for one category in one city. */
export const adminUpsertMarketRates = onCall({ region: REGION }, async (req) => {
  const ctx = requireAdmin(req);
  const data = (req.data ?? {}) as Record<string, unknown>;

  const cityId = data.cityId;
  const competitor = data.competitor;
  const category = data.category;
  if (typeof cityId !== 'string' || !cityId) invalid('cityId required');
  if (typeof competitor !== 'string' || !COMPETITORS.includes(competitor as Competitor)) {
    invalid('competitor must be one of: ' + COMPETITORS.join(', '));
  }
  if (typeof category !== 'string' || !CATEGORIES.includes(category as VehicleCategory)) {
    invalid('category must be one of: ' + CATEGORIES.join(', '));
  }

  const card = parseRateCard((data.rates ?? {}) as Record<string, unknown>, ctx.uid);

  await db.doc(`marketRates/${cityId}`).set(
    {
      cityId,
      competitors: { [competitor]: { [category]: card } },
      updatedAt: Date.now(),
      updatedBy: ctx.uid,
    },
    { merge: true },
  );
  bustCaches(cityId);

  logger.info('Market rate card saved', { cityId, competitor, category, by: ctx.uid });
  return { ok: true, card };
});

/** Admin: remove a card — the right move when a fit turns out to be wrong. */
export const adminDeleteMarketRates = onCall({ region: REGION }, async (req) => {
  const ctx = requireAdmin(req);
  const data = (req.data ?? {}) as Record<string, unknown>;
  const { cityId, competitor, category } = data as {
    cityId: string; competitor: Competitor; category: VehicleCategory;
  };
  if (typeof cityId !== 'string' || !cityId) invalid('cityId required');
  if (!COMPETITORS.includes(competitor)) invalid('unknown competitor');
  if (!CATEGORIES.includes(category)) invalid('unknown category');

  await db.doc(`marketRates/${cityId}`).set(
    {
      competitors: { [competitor]: { [category]: FieldValue.delete() } },
      updatedAt: Date.now(),
      updatedBy: ctx.uid,
    },
    { merge: true },
  );
  bustCaches(cityId);
  return { ok: true };
});

/**
 * Admin: turn the pending rider reports for one competitor + category into a
 * fitted rate card.
 *
 * The fit is least-squares on distance; it returns nothing when the sample is
 * too small or every report was for the same distance. That refusal is the
 * feature — a card fitted to two data points is a guess with a decimal point.
 */
export const adminFitMarketRates = onCall({ region: REGION }, async (req) => {
  const ctx = requireAdmin(req);
  const data = (req.data ?? {}) as Record<string, unknown>;
  const { cityId, competitor, category } = data as {
    cityId: string; competitor: Competitor; category: VehicleCategory;
  };
  if (typeof cityId !== 'string' || !cityId) invalid('cityId required');
  if (!COMPETITORS.includes(competitor)) invalid('unknown competitor');
  if (!CATEGORIES.includes(category)) invalid('unknown category');

  const settings = await loadSettings();
  const cutoff = Timestamp.fromMillis(Date.now() - settings.maxAgeDays * 24 * 60 * 60 * 1000);

  const snap = await db.collection('competitorQuoteReports')
    .where('cityId', '==', cityId)
    .where('competitor', '==', competitor)
    .where('category', '==', category)
    .where('createdAt', '>=', cutoff)
    .limit(500)
    .get();

  const observations = snap.docs.map((d) => ({
    quotedFare: Number(d.get('quotedFare')),
    distanceKm: Number(d.get('distanceKm')),
    durationMin: Number(d.get('durationMin')),
  }));

  const fit = fitRateCard(observations, settings.minSampleSize);
  if (!fit) {
    return {
      ok: false,
      reason: 'insufficient_data',
      reportCount: observations.length,
      needed: settings.minSampleSize,
    };
  }

  const card: CompetitorCategoryRates = {
    base: fit.base,
    includedKm: 0,
    includedMin: 0,
    perKm: fit.perKm,
    perMin: fit.perMin,
    minFare: fit.minFare,
    competitorClass: typeof data.competitorClass === 'string' && data.competitorClass.trim()
      ? data.competitorClass.trim().slice(0, 40)
      : 'Reported by riders',
    source: 'rider_reports',
    sampleSize: fit.sampleSize,
    verifiedAt: Date.now(),
    note: `Fitted from ${fit.sampleSize} rider reports on ${new Date().toISOString().slice(0, 10)}`,
  };

  await db.doc(`marketRates/${cityId}`).set(
    {
      cityId,
      competitors: { [competitor]: { [category]: card } },
      updatedAt: Date.now(),
      updatedBy: ctx.uid,
    },
    { merge: true },
  );
  bustCaches(cityId);

  return { ok: true, card, reportCount: observations.length };
});

/**
 * Admin: where we stand against the market, category by category, for a
 * reference trip.
 *
 * This is the screen that answers the only question that matters after a
 * competitor moves their prices — "are we still cheaper, and where are we not".
 * Anything with `guaranteeMet: false` is a category whose rates need editing in
 * the fare config, and the desk links straight there.
 */
export const adminMarketPosition = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const data = (req.data ?? {}) as Record<string, unknown>;
  const cityId = typeof data.cityId === 'string' ? data.cityId : '';
  if (!cityId) invalid('cityId required');

  // A 8 km / 25 min trip is a normal in-city ride on these roads, and it is
  // long enough that base-fare differences do not dominate the comparison.
  const distanceKm = clamp(Number(data.distanceKm ?? 8), 0.5, 500);
  const durationMin = clamp(Number(data.durationMin ?? 25), 1, 600);

  const rows = await Promise.all(CATEGORIES.map(async (category) => {
    const { comparison } = await marketAdjustedFare(cityId, category, distanceKm, durationMin, 1);
    return { category, ...comparison };
  }));

  const settings = await loadSettings();
  return { cityId, distanceKm, durationMin, undercutPct: settings.undercutPct, rows };
});
