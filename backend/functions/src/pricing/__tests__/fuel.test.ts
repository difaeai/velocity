/**
 * What these pin down is the difference between "fuel moved" and "a scraper
 * broke". Every case below is taken from something the live feeds actually did
 * on 2026-10-11, when four sites claiming the official OGRA rate published
 * Rs.336.03, Rs.393.64, Rs.398.30 and Rs.336.15 for the same litre of petrol.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_ISLAMABAD_RAWALPINDI } from '../../fare/fareEngine';
import {
  agreeingCluster,
  applyFuelToCategory,
  describeFuelAdjustment,
  fuelFactorFor,
  reconcileFuelPrices,
  withFuelAdjustedRates,
} from '../fuel';
import { DEFAULT_PRICING_CONFIG, type ConfirmedFuelPrice, type FuelObservation } from '../types';

const NOW = 1_760_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const settings = DEFAULT_PRICING_CONFIG.fuel;

function obs(over: Partial<FuelObservation> = {}): FuelObservation {
  return {
    product: 'petrol',
    pricePkr: 398.3,
    sourceId: 'a',
    effectiveDate: '2026-10-10',
    fetchedAt: NOW,
    ...over,
  };
}

function confirmed(over: Partial<ConfirmedFuelPrice> = {}): ConfirmedFuelPrice {
  return {
    product: 'petrol',
    pricePkr: 398.3,
    effectiveDate: '2026-10-10',
    confirmations: 2,
    sources: ['a', 'b'],
    confirmedAt: NOW,
    stepLimited: false,
    previousPkr: null,
    ...over,
  };
}

const petrolOf = (result: ReturnType<typeof reconcileFuelPrices>) =>
  result.outcomes.find((o) => o.product === 'petrol')!;

describe('agreeingCluster', () => {
  it('picks the majority, not the first or the lowest', () => {
    const { cluster, outliers } = agreeingCluster(
      [
        obs({ sourceId: 'stale', pricePkr: 336.03 }),
        obs({ sourceId: 'good1', pricePkr: 398.3 }),
        obs({ sourceId: 'good2', pricePkr: 398.31 }),
      ],
      0.01,
    );
    expect(cluster.map((c) => c.sourceId).sort()).toEqual(['good1', 'good2']);
    expect(outliers.map((o) => o.sourceId)).toEqual(['stale']);
  });

  it('finds no majority when two sources simply disagree', () => {
    const { cluster } = agreeingCluster(
      [obs({ sourceId: 'a', pricePkr: 398.3 }), obs({ sourceId: 'b', pricePkr: 336.03 })],
      0.01,
    );
    // Each reading agrees only with itself, so the largest cluster is 1 — below
    // minConfirmations, which is what makes this a refusal rather than a coin toss.
    expect(cluster).toHaveLength(1);
  });
});

describe('reconcileFuelPrices', () => {
  it('confirms a price two independent sources agree on', () => {
    const result = reconcileFuelPrices(
      [obs({ sourceId: 'oilprices.pk' }), obs({ sourceId: 'autoones.com' })],
      {},
      settings,
      NOW,
    );
    const petrol = petrolOf(result);
    expect(petrol.confirmed?.pricePkr).toBe(398.3);
    expect(petrol.confirmed?.confirmations).toBe(2);
    expect(petrol.confirmed?.sources).toEqual(['autoones.com', 'oilprices.pk']);
    expect(result.changed).toBe(true);
  });

  it('refuses to move on one source alone', () => {
    const result = reconcileFuelPrices([obs({ sourceId: 'only' })], {}, settings, NOW);
    expect(petrolOf(result).confirmed).toBeNull();
    expect(petrolOf(result).rejection).toBe('no_agreement');
  });

  it('will not let one source confirm itself by answering twice', () => {
    const result = reconcileFuelPrices(
      [obs({ sourceId: 'same', fetchedAt: NOW - 1000 }), obs({ sourceId: 'same' })],
      {},
      settings,
      NOW,
    );
    expect(petrolOf(result).confirmed).toBeNull();
    expect(petrolOf(result).observed).toHaveLength(1);
  });

  it('keeps the previous price when the sources disagree', () => {
    const previous = { petrol: confirmed({ pricePkr: 398.3 }) };
    const result = reconcileFuelPrices(
      [obs({ sourceId: 'a', pricePkr: 336.03 }), obs({ sourceId: 'b', pricePkr: 393.64 })],
      previous,
      settings,
      NOW,
    );
    expect(petrolOf(result).confirmed).toBeNull();
    expect(result.changed).toBe(false);
  });

  it('throws out a reading outside the plausible bounds for a litre', () => {
    const result = reconcileFuelPrices(
      [obs({ sourceId: 'a', pricePkr: 3.98 }), obs({ sourceId: 'b', pricePkr: 3.98 })],
      {},
      settings,
      NOW,
    );
    expect(petrolOf(result).confirmed).toBeNull();
    expect(petrolOf(result).rejection).toBe('implausible');
  });

  it('limits how far one update may move the price', () => {
    const previous = { petrol: confirmed({ pricePkr: 400 }) };
    const result = reconcileFuelPrices(
      [obs({ sourceId: 'a', pricePkr: 200 }), obs({ sourceId: 'b', pricePkr: 200 })],
      previous,
      settings,
      NOW,
    );
    // Both sources agreed on a halving. Believed, but only 15% of it today.
    expect(petrolOf(result).confirmed?.pricePkr).toBe(340);
    expect(petrolOf(result).confirmed?.stepLimited).toBe(true);
  });

  it('reports a product no source carried', () => {
    const result = reconcileFuelPrices([obs({ sourceId: 'a' }), obs({ sourceId: 'b' })], {}, settings, NOW);
    const diesel = result.outcomes.find((o) => o.product === 'diesel')!;
    expect(diesel.rejection).toBe('no_observations');
  });

  /**
   * The 2026-10-16 incident, as it actually happened in production.
   *
   * OGRA cut petrol 393.86 -> 390.23. oilprices.pk had the new number that
   * morning; autoones.com was still serving the old one. 3.63 apart is inside
   * the 1% tolerance, so the pair "agreed" and the engine stored the midpoint,
   * 392.05 — a price no pump in the country was charging, shown to riders
   * under a line telling them to check it against the forecourt board.
   */
  it('adopts the freshly notified price, not a blend with a lagging source', () => {
    const result = reconcileFuelPrices(
      [
        obs({ sourceId: 'oilprices.pk', pricePkr: 390.23, effectiveDate: '2026-10-16' }),
        obs({ sourceId: 'autoones.com', pricePkr: 393.86, effectiveDate: '2026-10-15' }),
      ],
      { petrol: confirmed({ pricePkr: 393.86, effectiveDate: '2026-10-15' }) },
      settings,
      NOW,
    );
    const petrol = petrolOf(result).confirmed!;
    expect(petrol.pricePkr).toBe(390.23);
    expect(petrol.pricePkr).not.toBe(392.05);
    expect(petrol.effectiveDate).toBe('2026-10-16');
    // Still two sources: the lagging one agreed the price was ~390, which is
    // the whole job of a confirmation. It just does not get to set the number.
    expect(petrol.confirmations).toBe(2);
  });

  it('still refuses when the sources are genuinely far apart', () => {
    // 2026-10-17: autoones started reporting 386.30 against a true 390.23.
    const result = reconcileFuelPrices(
      [
        obs({ sourceId: 'oilprices.pk', pricePkr: 390.23, effectiveDate: '2026-10-16' }),
        obs({ sourceId: 'autoones.com', pricePkr: 386.3, effectiveDate: '2026-10-17' }),
      ],
      { petrol: confirmed({ pricePkr: 390.23, effectiveDate: '2026-10-16' }) },
      settings,
      NOW,
    );
    expect(petrolOf(result).confirmed).toBeNull();
    expect(petrolOf(result).rejection).toBe('no_agreement');
  });

  it('medians same-dated readings that differ in the last paisa', () => {
    const result = reconcileFuelPrices(
      [
        obs({ sourceId: 'a', pricePkr: 390.2, effectiveDate: '2026-10-16' }),
        obs({ sourceId: 'b', pricePkr: 390.3, effectiveDate: '2026-10-16' }),
      ],
      {},
      settings,
      NOW,
    );
    expect(petrolOf(result).confirmed?.pricePkr).toBe(390.25);
  });

  it('takes the later effective date when sources straddle a notification', () => {
    const result = reconcileFuelPrices(
      [
        obs({ sourceId: 'a', effectiveDate: '2026-10-10' }),
        obs({ sourceId: 'b', effectiveDate: '2026-10-11' }),
      ],
      {},
      settings,
      NOW,
    );
    expect(petrolOf(result).confirmed?.effectiveDate).toBe('2026-10-11');
  });
});

describe('fuelFactorFor', () => {
  it('is exactly 1 when the price sits on the baseline', () => {
    const factor = fuelFactorFor('mini', { petrol: confirmed({ pricePkr: settings.baseline.petrol }) }, settings, NOW);
    expect(factor.factor).toBe(1);
  });

  it('passes through only the fuel share of a rise', () => {
    // +10% fuel on a mini, whose rate is 35% fuel → +3.5%.
    const price = confirmed({ pricePkr: settings.baseline.petrol * 1.1 });
    expect(fuelFactorFor('mini', { petrol: price }, settings, NOW).factor).toBeCloseTo(1.035, 4);
    // A rickshaw is more fuel-exposed, a luxury car less.
    expect(fuelFactorFor('rickshaw', { petrol: price }, settings, NOW).factor).toBeCloseTo(1.038, 4);
  });

  it('follows the price down as well as up', () => {
    const price = confirmed({ pricePkr: settings.baseline.petrol * 0.9 });
    expect(fuelFactorFor('mini', { petrol: price }, settings, NOW).factor).toBeCloseTo(0.965, 4);
  });

  it('never compounds — the factor is a function of the baseline, not of yesterday', () => {
    const price = confirmed({ pricePkr: settings.baseline.petrol * 1.1 });
    const once = fuelFactorFor('mini', { petrol: price }, settings, NOW).factor;
    const again = fuelFactorFor('mini', { petrol: price }, settings, NOW + 30 * DAY - 1).factor;
    expect(again).toBe(once);
  });

  it('reads diesel for the classes that run on it', () => {
    const factor = fuelFactorFor(
      'luxury',
      { petrol: confirmed({ pricePkr: 999 }), diesel: confirmed({ product: 'diesel', pricePkr: settings.baseline.diesel }) },
      settings,
      NOW,
    );
    expect(factor.product).toBe('diesel');
    expect(factor.factor).toBe(1);
  });

  it('stands fares still when the price has gone stale', () => {
    const price = confirmed({ pricePkr: settings.baseline.petrol * 1.5, confirmedAt: NOW - 60 * DAY });
    const factor = fuelFactorFor('mini', { petrol: price }, settings, NOW);
    expect(factor.reason).toBe('stale_price');
    expect(factor.factor).toBe(1);
  });

  it('stands fares still when there is no price at all', () => {
    expect(fuelFactorFor('mini', {}, settings, NOW).reason).toBe('no_price');
    expect(fuelFactorFor('mini', {}, settings, NOW).factor).toBe(1);
  });

  it('clamps a move that would be too large to be a fuel move', () => {
    const price = confirmed({ pricePkr: settings.baseline.petrol * 10 });
    const factor = fuelFactorFor('mini', { petrol: price }, settings, NOW);
    expect(factor.factor).toBe(1 + settings.maxAdjustmentPct);
    expect(factor.reason).toBe('clamped');
  });

  it('does nothing while the engine is switched off', () => {
    const off = { ...settings, enabled: false };
    const price = confirmed({ pricePkr: settings.baseline.petrol * 1.5 });
    expect(fuelFactorFor('mini', { petrol: price }, off, NOW).factor).toBe(1);
  });
});

describe('applying fuel to a rate card', () => {
  it('moves per-km fully and the base fare at half weight', () => {
    const rates = DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini;
    const moved = applyFuelToCategory(rates, 1.1);
    expect(moved.perKm).toBeCloseTo(rates.perKm * 1.1, 2);
    expect(moved.bidFloorPerKm).toBeCloseTo(rates.bidFloorPerKm * 1.1, 2);
    expect(moved.base).toBe(Math.round(rates.base * 1.05));
    expect(moved.minFare).toBe(Math.round(rates.minFare * 1.05));
    // Time is not fuel.
    expect(moved.perMin).toBe(rates.perMin);
  });

  it('returns the card untouched at a factor of 1', () => {
    const rates = DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini;
    expect(applyFuelToCategory(rates, 1)).toBe(rates);
  });

  it('leaves the stored config object alone', () => {
    const before = DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini.perKm;
    withFuelAdjustedRates(
      DEFAULT_ISLAMABAD_RAWALPINDI,
      { petrol: confirmed({ pricePkr: settings.baseline.petrol * 1.2 }) },
      settings,
      NOW,
    );
    expect(DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini.perKm).toBe(before);
  });

  it('reports no adjustment when nothing moved', () => {
    const result = withFuelAdjustedRates(DEFAULT_ISLAMABAD_RAWALPINDI, {}, settings, NOW);
    expect(result.applied).toBe(false);
    expect(result.config).toBe(DEFAULT_ISLAMABAD_RAWALPINDI);
  });
});

describe('describeFuelAdjustment', () => {
  it('says nothing when fuel has not moved the fare', () => {
    expect(describeFuelAdjustment(fuelFactorFor('mini', {}, settings, NOW))).toBeNull();
  });

  it('names the pump price so the claim can be checked', () => {
    const price = confirmed({ pricePkr: 438.13 });
    const text = describeFuelAdjustment(fuelFactorFor('mini', { petrol: price }, settings, NOW));
    expect(text).toContain('438.13');
    expect(text).toContain('up');
  });
});
