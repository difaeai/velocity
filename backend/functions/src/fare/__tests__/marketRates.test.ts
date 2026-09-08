/**
 * The undercut rule is the only thing standing between "we are cheaper" and a
 * claim we cannot back. These tests pin the parts that would quietly break it:
 * missing data must produce no comparison, stale data must produce no
 * comparison, and the driver floor must win over the promise.
 */
import { describe, it, expect } from 'vitest';

import {
  CityMarketRates, MarketComparisonSettings,
  DEFAULT_MARKET_SETTINGS,
  compareToMarket, estimateCompetitorFare, fitRateCard, scanCompetitors,
} from '../marketRates';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

const settings: MarketComparisonSettings = { ...DEFAULT_MARKET_SETTINGS, undercutPct: 0.15 };

function card(over: Partial<Record<string, unknown>> = {}) {
  return {
    base: 200, includedKm: 0, includedMin: 0,
    perKm: 40, perMin: 0, minFare: 200,
    competitorClass: 'Economy',
    source: 'ops_survey' as const,
    sampleSize: 10,
    verifiedAt: NOW - 2 * DAY,
    ...over,
  };
}

function rates(over: Partial<CityMarketRates['competitors']> = {}): CityMarketRates {
  return {
    cityId: 'islamabad_rawalpindi',
    competitors: {
      indrive: { mini: card() },
      yango: { mini: card({ base: 250, perKm: 45, competitorClass: 'Comfort' }) },
      ...over,
    },
    updatedAt: NOW,
  };
}

const trip = { category: 'mini' as const, distanceKm: 10, durationMin: 30 };

describe('estimateCompetitorFare', () => {
  it('charges base plus distance beyond the included kilometres', () => {
    // 200 + (10 - 0) * 40 = 600
    expect(estimateCompetitorFare(card(), 10, 30)).toBe(600);
  });

  it('never returns less than the competitor minimum fare', () => {
    expect(estimateCompetitorFare(card({ minFare: 500 }), 0.5, 2)).toBe(500);
  });
});

describe('compareToMarket', () => {
  it('drops our fare to 15% under the cheapest competitor', () => {
    const out = compareToMarket({
      cityRates: rates(), settings, ...trip,
      velocityFare: 700, floorFare: 200, now: NOW,
    });

    // inDrive 600, Yango 700 → cheapest 600 → target floor5(510) = 510
    expect(out.available).toBe(true);
    expect(out.cheapest?.competitor).toBe('indrive');
    expect(out.cheapest?.fare).toBe(600);
    expect(out.targetFare).toBe(510);
    expect(out.velocityFare).toBe(510);
    expect(out.guaranteeMet).toBe(true);
    expect(out.savings).toBe(90);
    expect(out.savingsPct).toBe(15);
  });

  it('leaves an already-cheaper fare alone rather than raising it', () => {
    const out = compareToMarket({
      cityRates: rates(), settings, ...trip,
      velocityFare: 400, floorFare: 200, now: NOW,
    });
    expect(out.velocityFare).toBe(400);
    expect(out.guaranteeMet).toBe(true);
  });

  it('stops at the driver floor and admits the promise is not met', () => {
    const out = compareToMarket({
      cityRates: rates(), settings, ...trip,
      velocityFare: 700, floorFare: 560, now: NOW,
    });
    expect(out.velocityFare).toBe(560);
    expect(out.guaranteeMet).toBe(false);
    expect(out.blocker).toBe('floor_blocked');
  });

  it('is unavailable when no competitor card exists for the category', () => {
    const out = compareToMarket({
      cityRates: rates(), settings, category: 'luxury', distanceKm: 10, durationMin: 30,
      velocityFare: 900, floorFare: 200, now: NOW,
    });
    expect(out.available).toBe(false);
    expect(out.blocker).toBe('no_rates');
    expect(out.velocityFare).toBe(900);
    expect(out.excluded.map((e) => e.reason)).toEqual(['missing', 'missing']);
  });

  it('is unavailable when there are no rates at all', () => {
    const out = compareToMarket({
      cityRates: null, settings, ...trip, velocityFare: 700, floorFare: 200, now: NOW,
    });
    expect(out.available).toBe(false);
    expect(out.velocityFare).toBe(700);
  });

  it('ignores cards older than the freshness window', () => {
    const stale = rates({
      indrive: { mini: card({ verifiedAt: NOW - 100 * DAY }) },
      yango: { mini: card({ verifiedAt: NOW - 100 * DAY }) },
    });
    const out = compareToMarket({
      cityRates: stale, settings, ...trip, velocityFare: 700, floorFare: 200, now: NOW,
    });
    expect(out.available).toBe(false);
    expect(out.excluded.every((e) => e.reason === 'stale')).toBe(true);
  });

  it('ignores cards fitted to too few observations', () => {
    const thin = rates({
      indrive: { mini: card({ sampleSize: 1 }) },
      yango: { mini: card({ sampleSize: 2 }) },
    });
    const out = compareToMarket({
      cityRates: thin, settings, ...trip, velocityFare: 700, floorFare: 200, now: NOW,
    });
    expect(out.available).toBe(false);
    expect(out.excluded.every((e) => e.reason === 'low_sample')).toBe(true);
  });

  it('applies no undercut at all when the feature is switched off', () => {
    const out = compareToMarket({
      cityRates: rates(), settings: { ...settings, enabled: false }, ...trip,
      velocityFare: 700, floorFare: 200, now: NOW,
    });
    expect(out.available).toBe(false);
    expect(out.blocker).toBe('disabled');
    expect(out.velocityFare).toBe(700);
  });

  it('hides competitor names when the setting says to', () => {
    const scan = scanCompetitors(
      rates(), { ...settings, showCompetitorNames: false }, 'mini', 10, 30, NOW,
    );
    expect(scan.usable.every((c) => c.label === 'Other ride app')).toBe(true);
  });
});

describe('fitRateCard', () => {
  it('recovers the line a set of quotes was drawn from', () => {
    const obs = [2, 5, 9, 14].map((km) => ({
      quotedFare: 150 + 35 * km, distanceKm: km, durationMin: km * 3,
    }));
    const fit = fitRateCard(obs, 3);
    expect(fit).not.toBeNull();
    expect(fit!.perKm).toBeCloseTo(35, 1);
    expect(fit!.base).toBe(150);
    expect(fit!.sampleSize).toBe(4);
  });

  it('refuses a sample smaller than the minimum', () => {
    expect(fitRateCard([{ quotedFare: 500, distanceKm: 8, durationMin: 20 }], 3)).toBeNull();
  });

  it('refuses when every observation is the same distance', () => {
    const obs = [500, 520, 480].map((quotedFare) => ({
      quotedFare, distanceKm: 8, durationMin: 20,
    }));
    expect(fitRateCard(obs, 3)).toBeNull();
  });
});
