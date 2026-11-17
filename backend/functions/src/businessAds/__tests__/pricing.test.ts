/**
 * "Find your Customers" — the radius price ladder (pure, no emulator).
 *
 * The owner's list (2026-11-14): Rs 300 buys one ad at one kilometre, and every
 * kilometre after it is Rs 60. These are the numbers a shopkeeper is quoted and
 * the numbers the server re-derives when the application lands, so they are
 * worth pinning down to the rupee.
 */
import { describe, it, expect } from 'vitest';

import {
  adPrice,
  clampPlanDays,
  DEFAULT_BUSINESS_AD_SETTINGS as S,
  MAX_PLAN_DAYS,
  MIN_PLAN_DAYS,
} from '../config';

describe('adPrice', () => {
  it('is Rs 300 for the kilometre the base price includes', () => {
    expect(adPrice(S, 1)).toBe(300);
  });

  it('climbs Rs 60 a kilometre', () => {
    expect(adPrice(S, 2)).toBe(360);
    expect(adPrice(S, 3)).toBe(420);
    // Five kilometres past the first double the price.
    expect(adPrice(S, 6)).toBe(600);
    expect(adPrice(S, 11)).toBe(900);
  });

  it('prices the picker’s widest radius', () => {
    expect(adPrice(S, 50)).toBe(3240);
  });

  it('counts half kilometres', () => {
    expect(adPrice(S, 2.5)).toBe(390);
  });

  it('never quotes paisa', () => {
    for (let km = 0.5; km <= 60; km += 0.5) {
      expect(Number.isInteger(adPrice(S, km))).toBe(true);
    }
  });

  it('quotes the ceiling rather than more for a radius we do not sell', () => {
    expect(adPrice(S, S.maxRadiusKm + 500)).toBe(adPrice(S, S.maxRadiusKm));
  });

  it('charges the base price below the included radius', () => {
    expect(adPrice(S, 0.5)).toBe(300);
  });

  it('follows a repriced list', () => {
    const cheap = { ...S, basePkr: 500, perKmPkr: 100, includedKm: 2 };
    expect(adPrice(cheap, 2)).toBe(500);
    expect(adPrice(cheap, 4)).toBe(700);
  });

  /**
   * The buyer picks days (owner, 2026-11-17). The ladder above still prices the
   * standard run exactly, and anything else is pro-rata from it — so these must
   * agree to the rupee with the phone's own copy in
   * apps/mobile/src/lib/__tests__/adPricing.test.ts.
   */
  it('leaves the standard run priced exactly as the ladder', () => {
    expect(adPrice(S, 1, S.planDays)).toBe(adPrice(S, 1));
    expect(adPrice(S, 50, S.planDays)).toBe(adPrice(S, 50));
  });

  it('charges by the day', () => {
    expect(adPrice(S, 1, 15)).toBe(150);
    expect(adPrice(S, 1, 60)).toBe(600);
    expect(adPrice(S, 2, 15)).toBe(180);
  });

  it('cannot be talked below a day or past a year', () => {
    expect(adPrice(S, 1, 0)).toBe(adPrice(S, 1, MIN_PLAN_DAYS));
    expect(adPrice(S, 1, -5)).toBe(adPrice(S, 1, MIN_PLAN_DAYS));
    expect(adPrice(S, 1, 10_000)).toBe(adPrice(S, 1, MAX_PLAN_DAYS));
  });
});

describe('clampPlanDays', () => {
  it('falls back when nothing usable was sent', () => {
    expect(clampPlanDays(undefined, 30)).toBe(30);
    expect(clampPlanDays(Number.NaN, 30)).toBe(30);
  });

  it('rounds to whole days', () => {
    expect(clampPlanDays(7.4, 30)).toBe(7);
    expect(clampPlanDays(7.6, 30)).toBe(8);
  });
});
