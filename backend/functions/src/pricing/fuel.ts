/**
 * Fuel: believing a pump price, and moving per-kilometre rates with it.
 * ----------------------------------------------------------------------------
 * WHY THIS IS NOT "FETCH JSON, MULTIPLY FARE"
 * -------------------------------------------
 * Because the feeds disagree. Checked on 2026-10-11, four sites all describing
 * themselves as publishing the official OGRA rate gave Rs.336.03, Rs.393.64,
 * Rs.398.30 and Rs.336.15 for the same litre of petrol. Two were stale, one was
 * a different product's price under a petrol heading, and one was right.
 *
 * There is no official API. OGRA notifies prices as a PDF; everything
 * machine-readable in front of it is somebody's scraper, and scrapers go stale
 * silently — the endpoint keeps answering 200 with last fortnight's number, or
 * with a number from a parse that broke. A single-source engine would have
 * taken Rs.336 against a Rs.398 baseline and cut every per-km rate in the
 * country by 5% on a day when fuel had not moved at all.
 *
 * So nothing here believes one source. A price becomes real when
 * `minConfirmations` independent feeds land within `agreementTolerance` of each
 * other; short of that the previous confirmed price stands and an admin is told.
 * What is then ADOPTED is the newest-dated reading among those that agreed —
 * never a blend across effective dates. Agreement decides whether to believe a
 * price; it does not get to invent one. See `reconcileFuelPrices`, which has
 * the 2026-10-16 incident that taught us the difference written out in full.
 * Verified while writing this: oilprices.pk and autoones.com independently gave
 * petrol 398.30 and diesel 396.24 for 2026-10-10/11, so two-source agreement is
 * reachable in practice and not a counsel of perfection.
 *
 * THE THREE CLAMPS, AND WHY EACH EXISTS
 * -------------------------------------
 *  · `fuelShare` — fuel is a SHARE of a per-km rate, not all of it. Passing a
 *    10% fuel rise through whole would hand the driver a 10% raise on their
 *    time and the car's depreciation too, neither of which moved.
 *  · `maxStepPct` — one update may not move the believed price more than this.
 *    A feed that starts reporting LPG prices under the petrol key cannot halve
 *    the country's fares before anybody is awake to notice.
 *  · `maxAdjustmentPct` — a hard stop on the total distance from baseline,
 *    however far the pump has really gone. If fuel genuinely doubles, the rate
 *    cards need re-authoring by a human, not an engine extrapolating.
 *
 * Everything in this file is pure. The HTTP is in `fuelSources.ts` and the
 * Firestore writes are in `fuelJob.ts`, so all of the arithmetic that decides
 * what a kilometre costs is testable without a network or an emulator.
 * ----------------------------------------------------------------------------
 */
import type { CityFareConfig, CategoryRates, VehicleCategory } from '../fare/fareEngine';
import {
  FUEL_PRODUCTS,
  type ConfirmedFuelPrice,
  type FuelObservation,
  type FuelProduct,
  type FuelSettings,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Why a product's price did not update this run. */
export type FuelRejection =
  /** No source returned this product at all. */
  | 'no_observations'
  /** Sources returned it, but too few agreed with each other. */
  | 'no_agreement'
  /** Every reading was outside the plausible bounds for a litre. */
  | 'implausible';

export interface ProductOutcome {
  product: FuelProduct;
  /** The price the engine now believes, or null when nothing changed. */
  confirmed: ConfirmedFuelPrice | null;
  rejection?: FuelRejection;
  /** Every reading considered, so an admin can see the disagreement itself. */
  observed: { sourceId: string; pricePkr: number; effectiveDate: string }[];
  /** Readings thrown out as outliers, with the source that sent them. */
  outliers: { sourceId: string; pricePkr: number }[];
}

export interface FuelReconciliation {
  outcomes: ProductOutcome[];
  /** True when at least one product's believed price changed. */
  changed: boolean;
}

const median = (sorted: number[]): number => {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * One reading per source, the freshest. A feed polled twice, or a feed that
 * mirrors another feed's bug under its own name, must not be able to confirm
 * itself: `minConfirmations` counts sources, so the dedupe is what gives that
 * number its meaning.
 */
function latestPerSource(observations: FuelObservation[]): FuelObservation[] {
  const best = new Map<string, FuelObservation>();
  for (const o of observations) {
    const prior = best.get(o.sourceId);
    if (!prior || o.fetchedAt > prior.fetchedAt) best.set(o.sourceId, o);
  }
  return [...best.values()];
}

/**
 * The largest set of readings that agree with each other, and its median.
 *
 * "Agree" is relative: within `tolerance` of the candidate reading. Two feeds
 * at 398.30 and 398.31 agree; 398.30 and 336.03 do not, and the larger cluster
 * wins rather than the lower or the first. With exactly two readings that
 * disagree there is no majority and therefore no answer — which is the correct
 * output, not a tie to be broken.
 */
export function agreeingCluster(
  readings: FuelObservation[],
  tolerance: number,
): { cluster: FuelObservation[]; outliers: FuelObservation[] } {
  let best: FuelObservation[] = [];

  for (const candidate of readings) {
    const cluster = readings.filter(
      (r) => Math.abs(r.pricePkr - candidate.pricePkr) <= candidate.pricePkr * tolerance,
    );
    // Ties go to the cheaper cluster: if the market is genuinely ambiguous,
    // under-charging the rider is the error we would rather make.
    if (
      cluster.length > best.length ||
      (cluster.length === best.length &&
        cluster.length > 0 &&
        candidate.pricePkr < (best[0]?.pricePkr ?? Infinity))
    ) {
      best = cluster;
    }
  }

  const chosen = new Set(best.map((r) => r.sourceId));
  return { cluster: best, outliers: readings.filter((r) => !chosen.has(r.sourceId)) };
}

/**
 * Decide what each product costs, from whatever the sources said.
 *
 * `previous` is what was believed before — the fallback when this run cannot
 * establish anything, and the anchor `maxStepPct` is measured against.
 */
export function reconcileFuelPrices(
  observations: FuelObservation[],
  previous: Partial<Record<FuelProduct, ConfirmedFuelPrice>>,
  settings: FuelSettings,
  now: number = Date.now(),
): FuelReconciliation {
  const outcomes: ProductOutcome[] = [];
  let changed = false;

  for (const product of FUEL_PRODUCTS) {
    const prior = previous[product] ?? null;
    const plausible = latestPerSource(
      observations.filter(
        (o) =>
          o.product === product &&
          Number.isFinite(o.pricePkr) &&
          o.pricePkr >= settings.bounds.minPkr &&
          o.pricePkr <= settings.bounds.maxPkr,
      ),
    );
    const observed = plausible.map((o) => ({
      sourceId: o.sourceId,
      pricePkr: o.pricePkr,
      effectiveDate: o.effectiveDate,
    }));

    const anyForProduct = observations.some((o) => o.product === product);
    if (plausible.length === 0) {
      outcomes.push({
        product,
        confirmed: null,
        rejection: anyForProduct ? 'implausible' : 'no_observations',
        observed,
        outliers: [],
      });
      continue;
    }

    const { cluster, outliers } = agreeingCluster(plausible, settings.agreementTolerance);
    if (cluster.length < settings.minConfirmations) {
      outcomes.push({
        product,
        confirmed: null,
        rejection: 'no_agreement',
        observed,
        outliers: outliers.map((o) => ({ sourceId: o.sourceId, pricePkr: o.pricePkr })),
      });
      continue;
    }

    // THE PRICE COMES FROM THE NEWEST READINGS IN THE CLUSTER, NOT FROM ALL OF
    // THEM. This is not a refinement; it is the difference between a price
    // somebody notified and a price nobody did.
    //
    // Sources move at different times on a notification morning. On 2026-10-16
    // OGRA cut petrol from 393.86 to 390.23. oilprices.pk had the new number,
    // autoones.com still had the old one, and 3.63 apart on a ~390 price is
    // inside the 1% agreement tolerance — so they "agreed", and the median of
    // a two-member cluster is its midpoint: 392.05. That is what this engine
    // confirmed, wrote to fuelPrices/current, and showed riders on the booking
    // screen under a line inviting them to check it against the pump. No
    // forecourt in Pakistan was charging 392.05.
    //
    // Taking the newest-dated readings instead fixes it without weakening the
    // vote: `cluster.length` still decides whether the price is believed, so it
    // still takes two independent sources landing near each other to confirm
    // anything. All that changes is WHICH of the agreeing numbers is adopted —
    // the current one, rather than a blend of the current one and a stale one.
    //
    // The median survives for the case it was actually for: several sources
    // carrying the SAME effective date and differing in the last paisa.
    const newestDate = cluster
      .map((r) => r.effectiveDate)
      .sort()
      .at(-1)!;
    const freshest = cluster.filter((r) => r.effectiveDate === newestDate);
    const agreedPrice = median([...freshest.map((r) => r.pricePkr)].sort((a, b) => a - b));

    // One step at a time. Measured against what was believed, so a feed that
    // breaks can walk the price at most `maxStepPct` a day — enough runs for a
    // human to see the alert and stop it.
    let price = agreedPrice;
    let stepLimited = false;
    if (prior && prior.pricePkr > 0) {
      const maxUp = prior.pricePkr * (1 + settings.maxStepPct);
      const maxDown = prior.pricePkr * (1 - settings.maxStepPct);
      if (price > maxUp) {
        price = maxUp;
        stepLimited = true;
      } else if (price < maxDown) {
        price = maxDown;
        stepLimited = true;
      }
    }
    price = Math.round(price * 100) / 100;

    const confirmed: ConfirmedFuelPrice = {
      product,
      pricePkr: price,
      // The same date the price was taken from, necessarily. Stamping the
      // newest date onto a number blended from an older one is how the stored
      // document came to claim 392.05 "effective 2026-10-16".
      effectiveDate: newestDate,
      confirmations: cluster.length,
      sources: cluster.map((r) => r.sourceId).sort(),
      confirmedAt: now,
      stepLimited,
      previousPkr: prior?.pricePkr ?? null,
    };

    if (!prior || prior.pricePkr !== price || prior.effectiveDate !== newestDate) {
      changed = true;
    }

    outcomes.push({
      product,
      confirmed,
      observed,
      outliers: outliers.map((o) => ({ sourceId: o.sourceId, pricePkr: o.pricePkr })),
    });
  }

  return { outcomes, changed };
}

// ── Turning a litre price into a fare ───────────────────────────────────────

export interface FuelFactor {
  /** What to multiply a per-kilometre rate by. 1.0 when fuel changes nothing. */
  factor: number;
  product: FuelProduct;
  /** The price the factor was derived from, or null when none was usable. */
  pricePkr: number | null;
  baselinePkr: number;
  reason: 'disabled' | 'no_price' | 'stale_price' | 'applied' | 'clamped';
}

/**
 * The multiplier for one vehicle class, from the believed pump price.
 *
 * Linear in the fuel share and anchored to the baseline, so it is the same
 * answer whether it is computed once or a thousand times — there is no state
 * here to drift. A missing or stale price is 1.0: fares stand where the rate
 * card put them rather than guessing.
 */
export function fuelFactorFor(
  category: VehicleCategory,
  prices: Partial<Record<FuelProduct, ConfirmedFuelPrice>>,
  settings: FuelSettings,
  now: number = Date.now(),
): FuelFactor {
  const product = settings.productFor[category] ?? 'petrol';
  const baselinePkr = settings.baseline[product];

  if (!settings.enabled) {
    return { factor: 1, product, pricePkr: null, baselinePkr, reason: 'disabled' };
  }

  const price = prices[product];
  if (!price || !Number.isFinite(price.pricePkr) || price.pricePkr <= 0) {
    return { factor: 1, product, pricePkr: null, baselinePkr, reason: 'no_price' };
  }
  if (!Number.isFinite(baselinePkr) || baselinePkr <= 0) {
    return { factor: 1, product, pricePkr: price.pricePkr, baselinePkr, reason: 'no_price' };
  }
  if (now - price.confirmedAt > settings.maxAgeDays * DAY_MS) {
    return { factor: 1, product, pricePkr: price.pricePkr, baselinePkr, reason: 'stale_price' };
  }

  const share = settings.fuelShare[category] ?? 0;
  const raw = 1 + share * (price.pricePkr / baselinePkr - 1);

  const ceiling = 1 + settings.maxAdjustmentPct;
  const floor = Math.max(0, 1 - settings.maxAdjustmentPct);
  const factor = Math.min(Math.max(raw, floor), ceiling);

  return {
    factor: Math.round(factor * 10000) / 10000,
    product,
    pricePkr: price.pricePkr,
    baselinePkr,
    reason: factor === raw ? 'applied' : 'clamped',
  };
}

/**
 * Half of the fuel move reaches the base fare and the minimum fare.
 *
 * `perKm` is pure distance and takes the whole factor. `base` and `minFare` are
 * not: they cover the driver's fixed overhead plus the `includedKm` the base
 * buys, so only the latter part is fuel. Half is the honest approximation of
 * that split and it errs toward the rider on a rise.
 */
const BASE_FARE_FUEL_WEIGHT = 0.5;

const scale = (value: number, factor: number): number =>
  Math.max(0, Math.round(value * factor * 100) / 100);

/** One class's rates, moved for fuel. */
export function applyFuelToCategory(rates: CategoryRates, factor: number): CategoryRates {
  if (factor === 1) return rates;
  const damped = 1 + (factor - 1) * BASE_FARE_FUEL_WEIGHT;
  return {
    ...rates,
    perKm: scale(rates.perKm, factor),
    bidFloorPerKm: scale(rates.bidFloorPerKm, factor),
    base: Math.round(rates.base * damped),
    minFare: Math.round(rates.minFare * damped),
  };
}

export interface FuelAdjustedConfig {
  config: CityFareConfig;
  /** The factor applied to each class, for the admin desk and for support. */
  factors: Partial<Record<VehicleCategory, FuelFactor>>;
  /** True when at least one class actually moved. */
  applied: boolean;
}

/**
 * A city's fare table with today's fuel price in it.
 *
 * Returns a NEW config; the stored `fareConfig/{cityId}` document is never
 * rewritten by this. That is deliberate — the stored card stays the
 * hand-authored one, the fuel move is derived on read, and turning the engine
 * off restores the original rates exactly instead of leaving whatever the last
 * run happened to write.
 */
export function withFuelAdjustedRates(
  cfg: CityFareConfig,
  prices: Partial<Record<FuelProduct, ConfirmedFuelPrice>>,
  settings: FuelSettings,
  now: number = Date.now(),
): FuelAdjustedConfig {
  const factors: Partial<Record<VehicleCategory, FuelFactor>> = {};
  const categories = { ...cfg.categories };
  let applied = false;

  for (const category of Object.keys(cfg.categories) as VehicleCategory[]) {
    const rates = cfg.categories[category];
    if (!rates) continue;
    const factor = fuelFactorFor(category, prices, settings, now);
    factors[category] = factor;
    if (factor.factor !== 1) {
      categories[category] = applyFuelToCategory(rates, factor.factor);
      applied = true;
    }
  }

  return { config: applied ? { ...cfg, categories } : cfg, factors, applied };
}

/**
 * What to tell a rider or a driver about fuel, in one line.
 *
 * Only ever says something when fuel has actually moved the price, and names
 * the notified rate so the claim is checkable against the pump. Silence is the
 * default: a fare that has not moved needs no explanation.
 */
export function describeFuelAdjustment(factor: FuelFactor): string | null {
  if (factor.reason !== 'applied' && factor.reason !== 'clamped') return null;
  if (factor.pricePkr === null) return null;
  const movePct = Math.round((factor.factor - 1) * 1000) / 10;
  if (Math.abs(movePct) < 0.5) return null;
  const label = factor.product === 'diesel' ? 'Diesel' : 'Petrol';
  const direction = movePct > 0 ? 'up' : 'down';
  return `${label} is Rs.${factor.pricePkr.toFixed(2)}/litre — per-km rates are ${Math.abs(movePct)}% ${direction}.`;
}
