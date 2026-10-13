/**
 * The daily market run: re-derive every competitor rate card from what riders
 * actually saw, and say what it did.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------
 * The comparison panel ("inDrive 664 · Yango 715 · Velocity 560") was true on
 * the day somebody typed it into Admin → Market rates, and a little less true
 * every day after. The pipes to keep it honest were all built — riders report
 * what they were quoted (`reportCompetitorQuote`), and a fit turns those
 * reports into a card (`adminFitMarketRates`) — but the last link was a human
 * remembering to press a button. Nobody presses a button every morning. So the
 * cards aged, crossed `maxAgeDays`, and the panel went dark, which is the
 * honest failure mode but not a working feature.
 *
 * This run closes that loop. Cards now track the market on their own, from
 * observations made in the last few weeks, and the only thing a human does is
 * read the report of what changed.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It will not invent a price, and it will not go and read one off a competitor.
 * Neither inDrive nor Yango publishes Pakistani fares, neither has a public
 * price API, and their internal endpoints are barred by their terms and would
 * break on their next release — the research behind that is in ./marketRates.ts
 * and it has not changed. Every number here still comes from a fare a real
 * person was quoted and chose to tell us about.
 *
 * "Realtime" for a competitor who publishes nothing means: the freshest
 * observations we lawfully have, refitted every day, with the age of the
 * evidence printed next to the number. That is what this does.
 *
 * WHAT A RUN CAN DO
 * -----------------
 * Write `marketRates/{cityId}` — nothing else. It does not touch
 * `fareConfig/{cityId}`, so our own pricing stays exactly as a human authored
 * it and a bad fit can never move a driver's floor.
 *
 * WHEN A RUN DECIDES NOTHING
 * --------------------------
 * Which is most days for most cities, and is correct. Too few reports, a fit
 * that does not describe its own data, or a jump too large to believe from a
 * card that is still fresh — in every case the existing card STANDS, untouched,
 * and the reason is recorded on `marketRuns/current` for the admin desk. A card
 * is never silently replaced by a worse one, and `verifiedAt` is never bumped
 * without evidence that actually confirms it: see 'confirmed' below, which is
 * the one case where riders really did re-verify the numbers we had.
 * ----------------------------------------------------------------------------
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';
import type { VehicleCategory } from './fareEngine';
import {
  CityMarketRates, Competitor, CompetitorCategoryRates, MarketComparisonSettings,
  COMPETITORS, DEFAULT_MARKET_SETTINGS,
  estimateCompetitorFare, fitRateCard,
} from './marketRates';

const REGION = 'asia-south1';

const CATEGORIES: VehicleCategory[] = ['moto', 'rickshaw', 'mini', 'ac_car', 'luxury'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where the last run's report lives, for the admin desk to read. */
export const MARKET_RUN_DOC = 'marketRuns/current';

/**
 * The trip two cards are compared on when we ask "did the market move?".
 *
 * Any fixed trip would do — the question is whether the new model prices
 * differently from the old one, not what this particular trip costs. 10 km and
 * 25 minutes is a middling city ride here, which keeps the comparison inside
 * the range the reports were actually drawn from rather than extrapolating a
 * fitted line out to a distance nobody travelled.
 */
const REFERENCE_KM = 10;
const REFERENCE_MIN = 25;

/**
 * How far a refit may move the reference fare in one day and still be believed,
 * when the card it replaces is still fresh.
 *
 * Competitor pricing does move — surge, fuel, a promotion — but it does not
 * double overnight, and a fit that says it did is far more likely to be a
 * handful of airport runs than a repricing. A stale card gets no such
 * protection: there, any evidence beats none.
 */
const MAX_DAILY_MOVE_PCT = 0.25;

/**
 * Below this the new fit and the old card are saying the same thing, so the
 * reports CONFIRM the card rather than replacing it.
 */
const AGREEMENT_PCT = 0.06;

/**
 * How badly the fitted line may miss its own observations, as a mean absolute
 * percentage error, before the fit is thrown out.
 *
 * This is the guard that matters most. `fitRateCard` will happily fit a line
 * through any cloud of points; whether that line describes them is a separate
 * question, and a model that is 40% out on the fares it was built from has no
 * business pricing a comparison a rider will read.
 */
const MAX_FIT_MAPE = 0.3;

type Outcome =
  /** No reports at all for this competitor and class in the window. */
  | 'no_reports'
  /** Some, but fewer than `minSampleSize`. */
  | 'insufficient_data'
  /** Enough reports, but no line fits them (or they were all one distance). */
  | 'poor_fit'
  /** The fit agrees with the card we hold: numbers kept, verifiedAt refreshed. */
  | 'confirmed'
  /** The market moved: the card was replaced. */
  | 'updated'
  /** First card for this city/class. */
  | 'created'
  /** A jump too large to believe from a card that is still fresh. Card kept. */
  | 'rejected_jump';

export interface MarketRunRow {
  cityId: string;
  competitor: Competitor;
  category: VehicleCategory;
  outcome: Outcome;
  reportCount: number;
  /** Reference-trip fare before and after, so a move is readable at a glance. */
  previousFare: number | null;
  newFare: number | null;
  movePct: number | null;
  /** Mean absolute percentage error of the fit against its own observations. */
  fitError: number | null;
  ageDaysBefore: number | null;
}

export interface MarketRunReport {
  ranAt: number;
  citiesScanned: number;
  reportsConsidered: number;
  rows: MarketRunRow[];
  updated: number;
  confirmed: number;
  /** Cards that are now past `maxAgeDays` with no fresh reports to save them. */
  wentStale: { cityId: string; competitor: Competitor; category: VehicleCategory; ageDays: number }[];
  /** True when nothing anywhere could be confirmed — the state worth alerting on. */
  degraded: boolean;
}

interface Observation {
  quotedFare: number;
  distanceKm: number;
  durationMin: number;
  competitorClass?: string;
}

/** Everything a single (city, competitor, category) bucket observed. */
type Buckets = Map<string, Observation[]>;

const bucketKey = (cityId: string, competitor: string, category: string) =>
  `${cityId}\u0000${competitor}\u0000${category}`;

async function loadSettings(): Promise<MarketComparisonSettings> {
  const snap = await db.doc('config/marketComparison').get();
  const stored = snap.exists ? (snap.data() as Partial<MarketComparisonSettings>) : {};
  return {
    ...DEFAULT_MARKET_SETTINGS,
    ...stored,
    maxAgeDays: clamp(Number(stored.maxAgeDays ?? DEFAULT_MARKET_SETTINGS.maxAgeDays), 1, 365),
    minSampleSize: clamp(Number(stored.minSampleSize ?? DEFAULT_MARKET_SETTINGS.minSampleSize), 1, 100),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Every usable report inside the window, bucketed.
 *
 * One paged query over the whole collection rather than a query per
 * (city, competitor, category) — that would be up to ten round trips per city
 * for a collection this small, and the single-field index on `createdAt` is
 * automatic so it needs no index of its own.
 */
async function collectReports(sinceMs: number): Promise<{ buckets: Buckets; total: number }> {
  const buckets: Buckets = new Map();
  const cutoff = Timestamp.fromMillis(sinceMs);
  let total = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  // Paged, with a hard ceiling: a run that would read a hundred thousand
  // documents is a run that should be told to stop. At our volumes the window
  // holds a few thousand at most.
  for (let page = 0; page < 10; page += 1) {
    let q = db.collection('competitorQuoteReports')
      .where('createdAt', '>=', cutoff)
      .orderBy('createdAt', 'asc')
      .limit(1000);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const cityId = doc.get('cityId');
      const competitor = doc.get('competitor');
      const category = doc.get('category');
      if (typeof cityId !== 'string' || !cityId) continue;
      if (!COMPETITORS.includes(competitor as Competitor)) continue;
      if (!CATEGORIES.includes(category as VehicleCategory)) continue;

      const obs: Observation = {
        quotedFare: Number(doc.get('quotedFare')),
        distanceKm: Number(doc.get('distanceKm')),
        durationMin: Number(doc.get('durationMin')),
        competitorClass: typeof doc.get('competitorClass') === 'string'
          ? (doc.get('competitorClass') as string)
          : undefined,
      };
      if (!Number.isFinite(obs.quotedFare) || obs.quotedFare <= 0) continue;
      if (!(obs.distanceKm > 0) || !(obs.durationMin > 0)) continue;

      const key = bucketKey(cityId, competitor as string, category as string);
      const list = buckets.get(key);
      if (list) list.push(obs);
      else buckets.set(key, [obs]);
      total += 1;
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }

  return { buckets, total };
}

/**
 * How far the fitted card is, on average, from the fares it was fitted to.
 *
 * Exported for the tests: this is the number that decides whether a fit is
 * allowed to price anything, so it is worth being able to assert on directly.
 */
export function fitError(
  card: Pick<CompetitorCategoryRates, 'base' | 'includedKm' | 'includedMin' | 'perKm' | 'perMin' | 'minFare'>,
  observations: Observation[],
): number {
  if (observations.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (const o of observations) {
    const predicted = estimateCompetitorFare(card as CompetitorCategoryRates, o.distanceKm, o.durationMin);
    sum += Math.abs(predicted - o.quotedFare) / o.quotedFare;
  }
  return sum / observations.length;
}

/** The most-reported tier name in a bucket — what the riders called it. */
function commonClass(observations: Observation[], fallback: string): string {
  const tally = new Map<string, number>();
  for (const o of observations) {
    const name = o.competitorClass?.trim();
    if (!name) continue;
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [name, n] of tally) {
    if (n > bestN) { best = name; bestN = n; }
  }
  return best ?? fallback;
}

/**
 * Decide what to do with one bucket, given the card we already hold.
 *
 * Pure, and exported, because every rule that protects a rider from a bad
 * number lives in here and the tests drive it directly rather than through a
 * scheduled function and a database.
 */
export function decideCard(
  existing: CompetitorCategoryRates | undefined,
  observations: Observation[],
  settings: MarketComparisonSettings,
  now: number,
): { outcome: Outcome; card: CompetitorCategoryRates | null; row: Omit<MarketRunRow, 'cityId' | 'competitor' | 'category'> } {
  const ageDaysBefore = existing ? (now - existing.verifiedAt) / DAY_MS : null;
  const previousFare = existing
    ? estimateCompetitorFare(existing, REFERENCE_KM, REFERENCE_MIN)
    : null;

  const blank = (outcome: Outcome) => ({
    outcome,
    card: null,
    row: {
      outcome,
      reportCount: observations.length,
      previousFare,
      newFare: null,
      movePct: null,
      fitError: null,
      ageDaysBefore,
    },
  });

  if (observations.length === 0) return blank('no_reports');

  const fit = fitRateCard(observations, settings.minSampleSize);
  if (!fit) {
    return blank(observations.length < settings.minSampleSize ? 'insufficient_data' : 'poor_fit');
  }

  const candidate: CompetitorCategoryRates = {
    base: fit.base,
    includedKm: 0,
    includedMin: 0,
    perKm: fit.perKm,
    perMin: fit.perMin,
    minFare: fit.minFare,
    competitorClass: commonClass(observations, existing?.competitorClass ?? 'Reported by riders'),
    source: 'rider_reports',
    sampleSize: fit.sampleSize,
    verifiedAt: now,
    note: `Auto-fitted from ${fit.sampleSize} rider reports on ${new Date(now).toISOString().slice(0, 10)}`,
  };

  const error = fitError(candidate, observations);
  const newFare = estimateCompetitorFare(candidate, REFERENCE_KM, REFERENCE_MIN);

  if (!Number.isFinite(error) || error > MAX_FIT_MAPE) {
    return {
      outcome: 'poor_fit',
      card: null,
      row: {
        outcome: 'poor_fit',
        reportCount: observations.length,
        previousFare,
        newFare,
        movePct: null,
        fitError: round3(error),
        ageDaysBefore,
      },
    };
  }

  // Nothing to compare against: this city and class have never had a card.
  if (!existing || previousFare == null) {
    return {
      outcome: 'created',
      card: candidate,
      row: {
        outcome: 'created',
        reportCount: observations.length,
        previousFare: null,
        newFare,
        movePct: null,
        fitError: round3(error),
        ageDaysBefore,
      },
    };
  }

  const movePct = (newFare - previousFare) / previousFare;
  const row = {
    reportCount: observations.length,
    previousFare,
    newFare,
    movePct: round3(movePct),
    fitError: round3(error),
    ageDaysBefore,
  };

  /**
   * The riders are telling us the card we hold is still right.
   *
   * Keep its numbers — a card fitted to a long ops survey is a better model
   * than one fitted to this fortnight's handful of reports, even when the two
   * price the same trip identically — and move `verifiedAt` forward, because
   * that is exactly what a verification is. Nothing else in this file is
   * allowed to touch that field without new evidence.
   */
  if (Math.abs(movePct) <= AGREEMENT_PCT) {
    return {
      outcome: 'confirmed',
      card: {
        ...existing,
        verifiedAt: now,
        // The confirmation is evidence too, and the sample is what the staleness
        // and thin-card guards read.
        sampleSize: existing.sampleSize + fit.sampleSize,
        note: `${existing.note ?? 'Card'} — confirmed by ${fit.sampleSize} rider reports on ${new Date(now).toISOString().slice(0, 10)}`,
      },
      row: { ...row, outcome: 'confirmed' },
    };
  }

  // A big move, on a card that is still inside its freshness window. The market
  // may really have moved, but a fortnight of reports is not enough to say so
  // against a card that is not yet in doubt. Kept, and flagged for the desk.
  const stillFresh = ageDaysBefore != null && ageDaysBefore <= settings.maxAgeDays;
  if (stillFresh && Math.abs(movePct) > MAX_DAILY_MOVE_PCT) {
    return { outcome: 'rejected_jump', card: null, row: { ...row, outcome: 'rejected_jump' } };
  }

  return { outcome: 'updated', card: candidate, row: { ...row, outcome: 'updated' } };
}

const round3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

/**
 * The run itself.
 *
 * Shared by the schedule and by the admin "run it now" button, so the desk is
 * always testing the thing that actually runs rather than a copy of it.
 */
export async function runMarketRefresh(now = Date.now()): Promise<MarketRunReport> {
  const settings = await loadSettings();
  const windowMs = settings.maxAgeDays * DAY_MS;
  const { buckets, total } = await collectReports(now - windowMs);

  // Cities worth looking at: everywhere we hold a card, plus everywhere riders
  // have reported from (which is how a city gets its first card).
  const existingSnap = await db.collection('marketRates').get();
  const cityRates = new Map<string, CityMarketRates>();
  for (const doc of existingSnap.docs) {
    cityRates.set(doc.id, doc.data() as CityMarketRates);
  }
  const cities = new Set<string>(cityRates.keys());
  for (const key of buckets.keys()) cities.add(key.split('\u0000')[0]!);

  const rows: MarketRunRow[] = [];
  const wentStale: MarketRunReport['wentStale'] = [];
  let updated = 0;
  let confirmed = 0;

  for (const cityId of cities) {
    const held = cityRates.get(cityId);
    /** Only the competitors/categories that changed, so the merge stays small. */
    const writes: Record<string, Record<string, CompetitorCategoryRates>> = {};

    for (const competitor of COMPETITORS) {
      for (const category of CATEGORIES) {
        const existing = held?.competitors?.[competitor]?.[category];
        const observations = buckets.get(bucketKey(cityId, competitor, category)) ?? [];

        // Nothing held and nothing seen: not a gap worth reporting, just a
        // class this city has never sold. Keeps the report readable.
        if (!existing && observations.length === 0) continue;

        const { card, row } = decideCard(existing, observations, settings, now);
        rows.push({ cityId, competitor, category, ...row });

        if (card) {
          (writes[competitor] ??= {})[category] = card;
          if (row.outcome === 'confirmed') confirmed += 1;
          else updated += 1;
        } else if (existing) {
          const ageDays = (now - existing.verifiedAt) / DAY_MS;
          if (ageDays > settings.maxAgeDays) {
            wentStale.push({ cityId, competitor, category, ageDays: Math.round(ageDays) });
          }
        }
      }
    }

    if (Object.keys(writes).length > 0) {
      await db.doc(`marketRates/${cityId}`).set(
        {
          cityId,
          competitors: writes,
          updatedAt: now,
          updatedBy: 'refreshMarketRates',
        },
        { merge: true },
      );
    }
  }

  const report: MarketRunReport = {
    ranAt: now,
    citiesScanned: cities.size,
    reportsConsidered: total,
    rows,
    updated,
    confirmed,
    wentStale,
    // Reports came in and not one of them produced a usable card anywhere. That
    // is a parser-or-plausibility problem, not a quiet fortnight.
    degraded: total > 0 && updated === 0 && confirmed === 0,
  };

  await db.doc(MARKET_RUN_DOC).set({ ...report, writtenAt: FieldValue.serverTimestamp() });

  logger.info('Market rates refreshed', {
    cities: cities.size,
    reports: total,
    updated,
    confirmed,
    stale: wentStale.length,
  });

  return report;
}

/**
 * 05:40 Asia/Karachi, daily.
 *
 * Before the morning peak, so a day's rides are priced against the newest
 * evidence rather than yesterday's, and pinned to Karachi because `onSchedule`
 * defaults to UTC — which would put this at 10:40 local, in the middle of it.
 *
 * Daily rather than hourly: the input is rider reports, which arrive in ones
 * and twos, and a fit refitted every hour would mostly be refitting the same
 * numbers at a cost per run.
 */
export const refreshMarketRates = onSchedule(
  { schedule: 'every day 05:40', timeZone: 'Asia/Karachi', region: REGION },
  async () => {
    try {
      await runMarketRefresh();
    } catch (err) {
      // A failed run must leave the cards exactly as they were, which it does —
      // every write is per city and already committed or never attempted.
      logger.error('Market rate refresh failed', err);
      throw err;
    }
  },
);

/** Admin: run it now and hand back the report, for the market desk. */
export const adminRefreshMarketRates = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  return { ok: true, report: await runMarketRefresh() };
});

/** Admin: the last run's report, without triggering a new one. */
export const adminMarketRunReport = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const snap = await db.doc(MARKET_RUN_DOC).get();
  return { ok: true, report: snap.exists ? (snap.data() as MarketRunReport) : null };
});
