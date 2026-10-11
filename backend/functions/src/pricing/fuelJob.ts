/**
 * The daily fuel run: ask the sources, decide, store, and say so.
 * ----------------------------------------------------------------------------
 * SCHEDULE
 * --------
 * 06:15 Asia/Karachi, daily.
 *
 * Daily, even though Pakistan re-notifies prices roughly fortnightly, because
 * the schedule is not fixed: notifications land on the 15th and the last day of
 * a month, they are announced late in the evening, they are deferred, and they
 * have been issued off-cycle more than once. A daily check costs two HTTP
 * requests and finds every revision the morning it takes effect. A fortnightly
 * check would miss the off-cycle ones entirely.
 *
 * 06:15 rather than midnight because the mirrors need time to parse the
 * notification, and because the price taking effect at midnight is of no use to
 * anybody until the first rides of the morning. Pinned to Asia/Karachi —
 * `onSchedule` defaults to UTC, which would put this at 11:15 local.
 *
 * WHAT A RUN CAN DO
 * -----------------
 * Exactly one thing: write `fuelPrices/current`. It does not touch
 * `fareConfig/{cityId}` — the rate cards stay as a human authored them and the
 * fuel move is derived on read, in `fare/cityConfig.ts`. So turning the engine
 * off restores the original rates exactly, and a bad fuel price is undone by
 * fixing one document rather than by re-authoring every city's card.
 *
 * WHEN A RUN DECIDES NOTHING
 * --------------------------
 * Which will happen — a source goes down, two sources disagree, a parser
 * breaks. Then the previous confirmed price stands, untouched, and the run
 * records why on `fuelPrices/current.lastRun` so the admin desk can show it.
 * Fares do not move on a day the engine could not establish a price, and they
 * do not move back to the baseline either.
 * ----------------------------------------------------------------------------
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { FUEL_DOC, invalidatePricingCache, loadFuelPrices, loadPricingConfig } from './config';
import { reconcileFuelPrices, type FuelReconciliation } from './fuel';
import { fetchAllSources, type SourceResult } from './fuelSources';
import { FUEL_PRODUCTS, type ConfirmedFuelPrice, type FuelObservation, type FuelProduct } from './types';

const REGION = 'asia-south1';

/** What the run did, stored on the document and returned to the admin desk. */
export interface FuelRunReport {
  ranAt: number;
  /** Per source: how many usable rows it gave, or why it gave none. */
  sources: { sourceId: string; rows: number; error?: string }[];
  /** Per product: the believed price, or the reason there is no new one. */
  products: {
    product: FuelProduct;
    pricePkr: number | null;
    previousPkr: number | null;
    confirmations: number;
    rejection?: string;
    stepLimited?: boolean;
    /** Every reading, including the ones thrown out. The audit trail. */
    observed: { sourceId: string; pricePkr: number }[];
  }[];
  changed: boolean;
  /** True when no product could be confirmed — the state worth alerting on. */
  degraded: boolean;
}

function buildReport(
  results: SourceResult[],
  reconciliation: FuelReconciliation,
  now: number,
): FuelRunReport {
  const products = reconciliation.outcomes.map((outcome) => ({
    product: outcome.product,
    pricePkr: outcome.confirmed?.pricePkr ?? null,
    previousPkr: outcome.confirmed?.previousPkr ?? null,
    confirmations: outcome.confirmed?.confirmations ?? 0,
    ...(outcome.rejection ? { rejection: outcome.rejection } : {}),
    ...(outcome.confirmed?.stepLimited ? { stepLimited: true } : {}),
    observed: outcome.observed.map((o) => ({ sourceId: o.sourceId, pricePkr: o.pricePkr })),
  }));

  return {
    ranAt: now,
    sources: results.map((r) => ({
      sourceId: r.sourceId,
      rows: r.observations.length,
      ...(r.error ? { error: r.error } : {}),
    })),
    products,
    changed: reconciliation.changed,
    degraded: products.every((p) => p.pricePkr === null),
  };
}

/**
 * One fuel run. Returns the report rather than logging and forgetting, so the
 * callable in `functions.ts` can hand an admin the same thing the cron saw.
 */
export async function runFuelRefresh(now: number = Date.now()): Promise<FuelRunReport> {
  const config = await loadPricingConfig(true);
  const previous = await loadFuelPrices(true);

  const results = await fetchAllSources(now);
  const observations: FuelObservation[] = results.flatMap((r) => r.observations);
  const reconciliation = reconcileFuelPrices(observations, previous, config.fuel, now);
  const report = buildReport(results, reconciliation, now);

  // Only products that actually confirmed are written. A product that could not
  // be established this run keeps whatever it had — including its original
  // `confirmedAt`, so `fuelFactorFor` can still age it out if the feeds stay
  // broken for `maxAgeDays`. Fares drifting back to baseline after six weeks of
  // silence is the right failure; pretending a six-week-old price is today's
  // is not.
  const update: Record<string, ConfirmedFuelPrice | FuelRunReport> = { lastRun: report };
  for (const outcome of reconciliation.outcomes) {
    if (outcome.confirmed) update[outcome.product] = outcome.confirmed;
  }

  await db.doc(FUEL_DOC).set(update, { merge: true });

  // One document per effective date, so a disputed fare months later can be
  // priced against what we believed on the day rather than what we believe now.
  const dated = reconciliation.outcomes.filter((o) => o.confirmed);
  if (dated.length > 0) {
    const batch = db.batch();
    for (const outcome of dated) {
      const confirmed = outcome.confirmed!;
      batch.set(
        db.doc(`fuelPrices/${confirmed.effectiveDate}`),
        { [confirmed.product]: confirmed, effectiveDate: confirmed.effectiveDate },
        { merge: true },
      );
    }
    await batch.commit();
  }

  invalidatePricingCache();

  if (report.degraded) {
    // Not an error — the engine is behaving exactly as designed, holding the
    // last good price. It is a state somebody should know about, because if it
    // persists for maxAgeDays the fuel adjustment switches itself off.
    logger.warn('fuel run confirmed nothing — holding previous prices', { sources: report.sources });
  } else if (report.changed) {
    logger.info('fuel prices updated', {
      products: report.products.map((p) => `${p.product}=${p.pricePkr}`),
    });
  }

  return report;
}

export const refreshFuelPrices = onSchedule(
  { schedule: 'every day 06:15', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: 120 },
  async () => {
    await runFuelRefresh();
  },
);

/**
 * The prices an admin should be looking at, with their age.
 *
 * Age is what makes this readable: "petrol Rs.398.30, confirmed 2 days ago by
 * two sources" is actionable, and the bare number is not.
 */
export async function fuelStatus(now: number = Date.now()): Promise<{
  prices: { product: FuelProduct; pricePkr: number | null; effectiveDate: string | null; ageDays: number | null; confirmations: number; sources: string[] }[];
  baseline: Record<FuelProduct, number>;
  stale: boolean;
}> {
  const config = await loadPricingConfig();
  const prices = await loadFuelPrices();
  const DAY = 24 * 60 * 60 * 1000;

  const rows = FUEL_PRODUCTS.map((product) => {
    const price = prices[product];
    return {
      product,
      pricePkr: price?.pricePkr ?? null,
      effectiveDate: price?.effectiveDate ?? null,
      ageDays: price ? Math.floor((now - price.confirmedAt) / DAY) : null,
      confirmations: price?.confirmations ?? 0,
      sources: price?.sources ?? [],
    };
  });

  return {
    prices: rows,
    baseline: config.fuel.baseline,
    stale: rows.every((r) => r.ageDays === null || r.ageDays > config.fuel.maxAgeDays),
  };
}
