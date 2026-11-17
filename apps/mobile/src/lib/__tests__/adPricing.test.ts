/**
 * The radius price ladder, on the phone.
 *
 * It is the deliberate twin of backend/functions/src/businessAds/config.ts —
 * the screen prices itself on its first frame instead of waiting for a cold
 * function, and the server re-derives the price when the application lands. The
 * two must agree to the rupee, so this pins the same rungs the backend's
 * pricing.test.ts pins. If this file and that one ever disagree, the shopkeeper
 * was quoted one number and charged another.
 */
import { describe, it, expect } from 'vitest';

import {
  adPrice,
  adPricing,
  clampPlanDays,
  MAX_PLAN_DAYS,
  AD_PRICE_DEFAULTS as P,
} from '../adPricing';

describe('adPrice', () => {
  it('is the owner’s ladder: Rs 300 for the first km, Rs 60 after it', () => {
    expect(adPrice(P, 1)).toBe(300);
    expect(adPrice(P, 2)).toBe(360);
    expect(adPrice(P, 6)).toBe(600);
    expect(adPrice(P, 50)).toBe(3240);
  });

  it('never quotes more than the widest radius sold', () => {
    expect(adPrice(P, P.maxRadiusKm + 100)).toBe(adPrice(P, P.maxRadiusKm));
  });

  it('never quotes paisa', () => {
    expect(Number.isInteger(adPrice(P, 2.5))).toBe(true);
  });

  it('leaves the standard run priced exactly as the ladder', () => {
    expect(adPrice(P, 1, P.planDays)).toBe(adPrice(P, 1));
    expect(adPrice(P, 50, P.planDays)).toBe(adPrice(P, 50));
  });

  it('charges by the day: half the days, half the money', () => {
    expect(adPrice(P, 1, 15)).toBe(150);
    expect(adPrice(P, 1, 60)).toBe(600);
    expect(adPrice(P, 2, 15)).toBe(180);
  });

  it('cannot be talked below a day or past a year', () => {
    expect(adPrice(P, 1, 0)).toBe(adPrice(P, 1, 1));
    expect(adPrice(P, 1, -5)).toBe(adPrice(P, 1, 1));
    expect(adPrice(P, 1, 10_000)).toBe(adPrice(P, 1, MAX_PLAN_DAYS));
  });
});

describe('clampPlanDays', () => {
  it('falls back when the number is missing or not a number', () => {
    expect(clampPlanDays(undefined, 30)).toBe(30);
    expect(clampPlanDays(Number.NaN, 30)).toBe(30);
  });

  it('rounds to whole days', () => {
    expect(clampPlanDays(7.4, 30)).toBe(7);
    expect(clampPlanDays(7.6, 30)).toBe(8);
  });
});

describe('adPricing', () => {
  it('uses this build’s ladder until the server’s arrives', () => {
    expect(adPricing(null).basePkr).toBe(P.basePkr);
  });

  it('takes the server’s numbers over its own', () => {
    const p = adPricing({
      ok: true,
      basePkr: 500,
      perKmPkr: 100,
      includedKm: 1,
      maxRadiusKm: 100,
      planDays: 15,
      adSlots: 2,
      notifyCooldownHours: 24,
      payment: {
        bankName: null,
        bankAccountTitle: null,
        bankAccount: null,
        easypaisaTitle: null,
        easypaisaAccount: null,
        jazzcashTitle: null,
        jazzcashAccount: null,
      },
    });
    expect(adPrice(p, 3)).toBe(700);
    expect(p.planDays).toBe(15);
  });
});
