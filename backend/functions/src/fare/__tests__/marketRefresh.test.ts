/**
 * The daily market run decides, every morning, whether a number a rider is
 * about to read gets replaced. These tests pin the guards that stop it
 * replacing a good number with a bad one — and the one case where it is allowed
 * to move `verifiedAt`, which is the field the whole staleness story rests on.
 *
 * `decideCard` is pure, so none of this needs a database or a scheduler.
 */
import { describe, it, expect } from 'vitest';

import {
  CompetitorCategoryRates, MarketComparisonSettings,
  DEFAULT_MARKET_SETTINGS, estimateCompetitorFare,
} from '../marketRates';
import { decideCard, fitError } from '../marketRefresh';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

const settings: MarketComparisonSettings = { ...DEFAULT_MARKET_SETTINGS, minSampleSize: 3 };

/** A card that prices a 10 km / 25 min reference trip at 200 + 40×10 = 600. */
function held(over: Partial<CompetitorCategoryRates> = {}): CompetitorCategoryRates {
  return {
    base: 200, includedKm: 0, includedMin: 0,
    perKm: 40, perMin: 0, minFare: 200,
    competitorClass: 'Economy',
    source: 'ops_survey',
    sampleSize: 12,
    verifiedAt: NOW - 2 * DAY,
    ...over,
  };
}

/**
 * Reports generated from a straight line, so the fit is exact and each test is
 * isolating the rule it names rather than fighting the regression.
 */
function observations(base: number, perKm: number, distances = [4, 7, 10, 14, 19]) {
  return distances.map((km) => ({
    quotedFare: Math.round(base + perKm * km),
    distanceKm: km,
    durationMin: Math.round(km * 2.5),
    competitorClass: 'Economy',
  }));
}

describe('decideCard', () => {
  it('does nothing when nobody reported anything', () => {
    const res = decideCard(held(), [], settings, NOW);
    expect(res.outcome).toBe('no_reports');
    expect(res.card).toBeNull();
  });

  it('refuses to fit fewer reports than minSampleSize', () => {
    const res = decideCard(held(), observations(200, 40, [5, 12]), settings, NOW);
    expect(res.outcome).toBe('insufficient_data');
    expect(res.card).toBeNull();
  });

  it('creates a card for a city that has never had one', () => {
    const res = decideCard(undefined, observations(180, 38), settings, NOW);
    expect(res.outcome).toBe('created');
    expect(res.card?.source).toBe('rider_reports');
    expect(res.card?.verifiedAt).toBe(NOW);
  });

  /**
   * The case this whole file exists for: reports that AGREE must not overwrite
   * a well-sampled card with a thinner one — but they are still evidence, so
   * the card is re-dated. That is what keeps a comparison alive without anyone
   * pressing a button, and it is the only path allowed to touch verifiedAt
   * without new numbers.
   */
  it('confirms (keeps the numbers, refreshes the date) when the fit agrees', () => {
    const existing = held();
    const res = decideCard(existing, observations(205, 40), settings, NOW);

    expect(res.outcome).toBe('confirmed');
    expect(res.card?.base).toBe(existing.base);
    expect(res.card?.perKm).toBe(existing.perKm);
    expect(res.card?.source).toBe('ops_survey');
    expect(res.card?.verifiedAt).toBe(NOW);
    // The confirmation counts towards the sample the thin-card guard reads.
    expect(res.card!.sampleSize).toBeGreaterThan(existing.sampleSize);
  });

  it('updates the card when the market has moved by a believable amount', () => {
    // 600 → ~690 on the reference trip: a 15% move, inside the daily limit.
    const res = decideCard(held(), observations(230, 46), settings, NOW);
    expect(res.outcome).toBe('updated');
    expect(res.card?.source).toBe('rider_reports');
    expect(estimateCompetitorFare(res.card!, 10, 25)).toBeGreaterThan(650);
  });

  /**
   * A fortnight of reports is not enough to say a competitor doubled its prices
   * overnight. The card we hold is still fresh, so it stands and the desk is
   * told why.
   */
  it('rejects an unbelievable jump while the held card is still fresh', () => {
    const res = decideCard(held(), observations(400, 90), settings, NOW);
    expect(res.outcome).toBe('rejected_jump');
    expect(res.card).toBeNull();
    expect(res.row.movePct).toBeGreaterThan(0.25);
  });

  /** …but against a card nobody has verified in months, any evidence beats none. */
  it('accepts the same jump when the held card is already stale', () => {
    const stale = held({ verifiedAt: NOW - 200 * DAY });
    const res = decideCard(stale, observations(400, 90), settings, NOW);
    expect(res.outcome).toBe('updated');
    expect(res.card).not.toBeNull();
  });

  /**
   * `fitRateCard` will put a line through any cloud of points. Whether that
   * line DESCRIBES them is the separate question, and the one that decides
   * whether a rider is shown the number: here the slope is positive and the
   * fit is returned, but it misses its own observations by a mile.
   */
  it('throws out a fit that does not describe its own observations', () => {
    const scattered = [
      { quotedFare: 200, distanceKm: 4, durationMin: 10 },
      { quotedFare: 1500, distanceKm: 7, durationMin: 18 },
      { quotedFare: 400, distanceKm: 10, durationMin: 25 },
      { quotedFare: 2200, distanceKm: 14, durationMin: 34 },
      { quotedFare: 700, distanceKm: 19, durationMin: 46 },
    ];
    const res = decideCard(held(), scattered, settings, NOW);
    expect(res.outcome).toBe('poor_fit');
    expect(res.card).toBeNull();
    expect(res.row.fitError!).toBeGreaterThan(0.3);
  });

  /** The other half of the same guard: fares that fall as the trip gets longer
   *  are not a rate card, and `fitRateCard` declines to produce one. */
  it('throws out observations with no usable slope', () => {
    const backwards = [
      { quotedFare: 300, distanceKm: 4, durationMin: 10 },
      { quotedFare: 2400, distanceKm: 5, durationMin: 12 },
      { quotedFare: 350, distanceKm: 9, durationMin: 22 },
      { quotedFare: 2600, distanceKm: 10, durationMin: 25 },
      { quotedFare: 400, distanceKm: 15, durationMin: 36 },
    ];
    const res = decideCard(held(), backwards, settings, NOW);
    expect(res.outcome).toBe('poor_fit');
    expect(res.card).toBeNull();
  });

  it('takes the tier name riders reported most often', () => {
    const obs = observations(180, 38).map((o, i) => ({
      ...o,
      competitorClass: i === 0 ? 'Comfort' : 'City',
    }));
    const res = decideCard(undefined, obs, settings, NOW);
    expect(res.card?.competitorClass).toBe('City');
  });
});

describe('fitError', () => {
  it('is zero for a card that reproduces its observations exactly', () => {
    const obs = observations(200, 40);
    expect(fitError(held(), obs)).toBeCloseTo(0, 5);
  });

  it('is infinite with nothing to measure against', () => {
    expect(fitError(held(), [])).toBe(Number.POSITIVE_INFINITY);
  });
});
