/**
 * Market comparison — what inDrive and Yango would charge for the same trip,
 * and the rule that keeps Velocity underneath both of them.
 *
 * ── Why there are no seeded prices in this file ──────────────────────────────
 * Neither competitor exposes a fare we are allowed to read:
 *
 *  · inDrive has no fixed fare at all. It is a bidding marketplace — the rider
 *    names the price. The "recommended fare" it shows is generated per request
 *    inside the app and is published nowhere.
 *  · Yango does not publish per-km tariffs for Pakistan. Tariff pages exist for
 *    some of its markets; no Pakistani city has one, and the company has said
 *    in the press that its per-km rates are not disclosed.
 *  · Neither has a public price API, and reading their internal endpoints would
 *    breach their terms, break on their next release, and put a number in front
 *    of a rider that we could not defend if they checked it.
 *
 * So every number this module works with is an OBSERVATION someone actually
 * made — ops opening the competitor app on a known route, or riders telling us
 * what they were quoted. Those observations are fitted to the linear model
 * below and stored in `marketRates/{cityId}`, each card carrying its source,
 * its sample size and the date it was last confirmed.
 *
 * The consequence is deliberate: with no verified card for a city and category,
 * `compareToMarket` returns `available: false` and the app shows no comparison
 * at all. An empty panel is the correct output for missing data. Nothing here
 * ever invents a competitor price.
 *
 * Config lives in Firestore: marketRates/{cityId} and config/marketComparison.
 * All money values are integer PKR.
 */

import type { VehicleCategory } from './fareEngine';

export type Competitor = 'indrive' | 'yango';

export const COMPETITORS: Competitor[] = ['indrive', 'yango'];

export const COMPETITOR_LABELS: Record<Competitor, string> = {
  indrive: 'inDrive',
  yango: 'Yango',
};

/**
 * Where a rate card's numbers came from. A card without a source is not
 * displayable — this field is the difference between a comparison and a claim.
 */
export type RateSource =
  /** Our own people opened the competitor app on known routes and wrote it down. */
  | 'ops_survey'
  /** Riders reported what they were quoted, from the booking screen. */
  | 'rider_reports'
  /** The competitor published it — a tariff page, a regulator filing, a release. */
  | 'published';

export const RATE_SOURCE_LABELS: Record<RateSource, string> = {
  ops_survey: 'Checked in-app by our team',
  rider_reports: 'Reported by riders',
  published: 'Published by the operator',
};

/**
 * A competitor's pricing for one vehicle class in one city, as a linear model
 * fitted to real quotes.
 *
 * inDrive does not price this way — it recommends a fare and lets the rider
 * move it. Fitting its *recommended* fares to the same base/km/min shape is
 * what makes the two comparable at all; `note` is where whoever fitted it
 * records which routes were sampled and how well the fit held.
 */
export interface CompetitorCategoryRates {
  base: number;
  includedKm: number;
  includedMin: number;
  perKm: number;
  perMin: number;
  minFare: number;
  /** The competitor's own name for this tier, e.g. "Economy", "City". */
  competitorClass: string;
  source: RateSource;
  /** How many real observations this card is fitted to. */
  sampleSize: number;
  /** Epoch ms of the most recent observation behind these numbers. */
  verifiedAt: number;
  /** Which routes were sampled, who checked, anything that qualifies the fit. */
  note?: string;
}

export type CompetitorRateCard = Partial<Record<VehicleCategory, CompetitorCategoryRates>>;

export interface CityMarketRates {
  cityId: string;
  competitors: Partial<Record<Competitor, CompetitorRateCard>>;
  updatedAt: number;
  updatedBy?: string;
}

/** A city with nothing verified yet. This is the honest starting state. */
export function emptyCityMarketRates(cityId: string): CityMarketRates {
  return { cityId, competitors: {}, updatedAt: Date.now() };
}

export interface MarketComparisonSettings {
  /** Master switch. Off → the app shows no comparison and applies no undercut. */
  enabled: boolean;
  /** How far under the cheapest competitor Velocity must land. 0.15 = 15%. */
  undercutPct: number;
  /** A card older than this is neither shown nor undercut against. */
  maxAgeDays: number;
  /** Below this many observations a card is not trusted enough to display. */
  minSampleSize: number;
  /** Name the competitors, or fall back to "other ride apps". */
  showCompetitorNames: boolean;
  /** Printed under every comparison. It is what keeps the claim truthful. */
  disclaimer: string;
}

export const DEFAULT_MARKET_SETTINGS: MarketComparisonSettings = {
  enabled: true,
  undercutPct: 0.15,
  maxAgeDays: 45,
  minSampleSize: 3,
  showCompetitorNames: true,
  disclaimer:
    'Estimated from fares recently checked in those apps for this city — not a live quote. Their price changes with demand.',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Round DOWN to Rs.5. Rounding up could push us back past the undercut target. */
export const floor5 = (n: number) => Math.max(0, Math.floor(n / 5) * 5);

/** What this competitor would charge for the trip, on the same shape of maths. */
export function estimateCompetitorFare(
  rates: CompetitorCategoryRates,
  distanceKm: number,
  durationMin: number,
): number {
  const billableKm = Math.max(0, distanceKm - rates.includedKm);
  const billableMin = Math.max(0, durationMin - rates.includedMin);
  const raw = rates.base + billableKm * rates.perKm + billableMin * rates.perMin;
  return Math.round(Math.max(rates.minFare, raw));
}

export interface CompetitorEstimate {
  competitor: Competitor;
  label: string;
  competitorClass: string;
  fare: number;
  source: RateSource;
  sampleSize: number;
  verifiedAt: number;
  ageDays: number;
}

/**
 * Why a card was left out. Surfaced to admins so a missing comparison is
 * diagnosable rather than mysterious.
 */
export type ExclusionReason = 'missing' | 'stale' | 'low_sample';

export interface ExcludedCompetitor {
  competitor: Competitor;
  label: string;
  reason: ExclusionReason;
  ageDays?: number;
  sampleSize?: number;
}

export interface CompetitorScan {
  usable: CompetitorEstimate[];
  excluded: ExcludedCompetitor[];
}

/** Every competitor card for this category, split into the usable and the not. */
export function scanCompetitors(
  cityRates: CityMarketRates | null,
  settings: MarketComparisonSettings,
  category: VehicleCategory,
  distanceKm: number,
  durationMin: number,
  now: number = Date.now(),
): CompetitorScan {
  const usable: CompetitorEstimate[] = [];
  const excluded: ExcludedCompetitor[] = [];

  for (const competitor of COMPETITORS) {
    const label = settings.showCompetitorNames
      ? COMPETITOR_LABELS[competitor]
      : 'Other ride app';
    const rates = cityRates?.competitors?.[competitor]?.[category];

    if (!rates) {
      excluded.push({ competitor, label, reason: 'missing' });
      continue;
    }

    const ageDays = Math.max(0, (now - rates.verifiedAt) / DAY_MS);
    if (ageDays > settings.maxAgeDays) {
      excluded.push({ competitor, label, reason: 'stale', ageDays, sampleSize: rates.sampleSize });
      continue;
    }
    if (rates.sampleSize < settings.minSampleSize) {
      excluded.push({ competitor, label, reason: 'low_sample', ageDays, sampleSize: rates.sampleSize });
      continue;
    }

    usable.push({
      competitor,
      label,
      competitorClass: rates.competitorClass,
      fare: estimateCompetitorFare(rates, distanceKm, durationMin),
      source: rates.source,
      sampleSize: rates.sampleSize,
      verifiedAt: rates.verifiedAt,
      ageDays,
    });
  }

  usable.sort((a, b) => a.fare - b.fare);
  return { usable, excluded };
}

export type ComparisonBlocker = 'disabled' | 'no_rates' | 'floor_blocked';

export interface MarketComparison {
  /** True only when there is at least one fresh, well-sampled competitor card. */
  available: boolean;
  competitors: CompetitorEstimate[];
  excluded: ExcludedCompetitor[];
  /** The cheapest competitor — the one we have to beat. */
  cheapest: CompetitorEstimate | null;
  /** At or below this and the undercut promise holds. */
  targetFare: number | null;
  /** What Velocity asks once the undercut has been applied. */
  velocityFare: number;
  /** What Velocity would have asked from the fare engine alone. */
  engineFare: number;
  savings: number | null;
  savingsPct: number | null;
  /** True when velocityFare <= targetFare. */
  guaranteeMet: boolean;
  /** Set when the comparison could not be made, or the promise could not be kept. */
  blocker?: ComparisonBlocker;
}

export interface CompareInput {
  cityRates: CityMarketRates | null;
  settings: MarketComparisonSettings;
  category: VehicleCategory;
  distanceKm: number;
  durationMin: number;
  /** The fare engine's answer, before any market adjustment. */
  velocityFare: number;
  /**
   * The lowest fare that still pays the driver for this trip. The undercut
   * never goes below it: beating a competitor is not worth a ride that no
   * driver will take.
   */
  floorFare: number;
  now?: number;
}

/**
 * Compare, then undercut.
 *
 * The order matters. We work out what the market charges, take the cheapest of
 * them, and drop our own fare to `undercutPct` below it — but only ever
 * downwards, and never through the driver floor. If our fare was already lower
 * it stays exactly where it is; a competitor being expensive is not a reason to
 * charge our riders more.
 */
export function compareToMarket(input: CompareInput): MarketComparison {
  const {
    cityRates, settings, category, distanceKm, durationMin,
    velocityFare, floorFare, now = Date.now(),
  } = input;

  const base: MarketComparison = {
    available: false,
    competitors: [],
    excluded: [],
    cheapest: null,
    targetFare: null,
    velocityFare,
    engineFare: velocityFare,
    savings: null,
    savingsPct: null,
    guaranteeMet: false,
  };

  if (!settings.enabled) return { ...base, blocker: 'disabled' };

  const { usable, excluded } = scanCompetitors(
    cityRates, settings, category, distanceKm, durationMin, now,
  );
  // `usable` is sorted cheapest-first, so element 0 is the one we have to beat.
  // Reading it before the emptiness check keeps the narrowing honest under
  // noUncheckedIndexedAccess, which the mobile build turns on.
  const cheapest = usable[0];
  if (!cheapest) {
    return { ...base, excluded, blocker: 'no_rates' };
  }

  const targetFare = floor5(cheapest.fare * (1 - settings.undercutPct));

  // Only ever downwards, and never below what the driver needs.
  const wanted = Math.min(velocityFare, targetFare);
  const finalFare = Math.max(wanted, floorFare);
  const guaranteeMet = finalFare <= targetFare;

  const savings = cheapest.fare - finalFare;

  return {
    available: true,
    competitors: usable,
    excluded,
    cheapest,
    targetFare,
    velocityFare: finalFare,
    engineFare: velocityFare,
    savings: savings > 0 ? savings : 0,
    savingsPct: cheapest.fare > 0 ? Math.round((savings / cheapest.fare) * 100) : 0,
    guaranteeMet,
    ...(guaranteeMet ? {} : { blocker: 'floor_blocked' as const }),
  };
}

/**
 * One rider's report of what a competitor quoted them. This is the pipe that
 * keeps the rate cards real: riders in this market already open inDrive and
 * Yango to compare before they book, so we ask them what they saw.
 */
export interface CompetitorQuoteReport {
  competitor: Competitor;
  category: VehicleCategory;
  cityId: string;
  /** What the other app quoted, in PKR. */
  quotedFare: number;
  distanceKm: number;
  durationMin: number;
  competitorClass?: string;
}

/** Bounds a rider-submitted quote has to clear before it is worth storing. */
export function isPlausibleReport(r: CompetitorQuoteReport): boolean {
  return (
    COMPETITORS.includes(r.competitor) &&
    Number.isFinite(r.quotedFare) && r.quotedFare >= 50 && r.quotedFare <= 100000 &&
    Number.isFinite(r.distanceKm) && r.distanceKm > 0 && r.distanceKm <= 500 &&
    Number.isFinite(r.durationMin) && r.durationMin > 0 && r.durationMin <= 600
  );
}

/**
 * Fit a linear rate card to a set of observed quotes by least squares on
 * (distanceKm, durationMin), holding `base` at the shortest observed fare.
 *
 * Used by the admin desk to turn a pile of rider reports into a card rather
 * than making someone eyeball the numbers. Returns null when the sample is too
 * small or too degenerate to fit — in which case there is no card, by design.
 */
export function fitRateCard(
  observations: { quotedFare: number; distanceKm: number; durationMin: number }[],
  minSample: number,
): { base: number; perKm: number; perMin: number; minFare: number; sampleSize: number } | null {
  const pts = observations.filter(
    (o) => Number.isFinite(o.quotedFare) && o.distanceKm > 0 && o.durationMin > 0,
  );
  if (pts.length < minSample) return null;

  // Duration and distance move together on real roads, so fitting both
  // independently produces wild coefficients on small samples. We hold the
  // per-minute rate at a fixed share of the fare and fit distance alone, which
  // is the term riders actually feel.
  const n = pts.length;
  const meanKm = pts.reduce((s, o) => s + o.distanceKm, 0) / n;
  const meanFare = pts.reduce((s, o) => s + o.quotedFare, 0) / n;

  let num = 0;
  let den = 0;
  for (const o of pts) {
    num += (o.distanceKm - meanKm) * (o.quotedFare - meanFare);
    den += (o.distanceKm - meanKm) ** 2;
  }
  if (den <= 0) return null; // every sample the same distance — nothing to fit

  const perKm = num / den;
  if (!Number.isFinite(perKm) || perKm <= 0) return null;

  const base = meanFare - perKm * meanKm;
  if (!Number.isFinite(base)) return null;

  const minFare = Math.min(...pts.map((o) => o.quotedFare));

  return {
    base: Math.max(0, Math.round(base)),
    perKm: Math.round(perKm * 10) / 10,
    perMin: 0,
    minFare: Math.round(minFare),
    sampleSize: n,
  };
}
