/**
 * The radius price ladder, on the phone.
 *
 * It is the deliberate twin of backend/functions/src/businessAds/config.ts —
 * the screen prices itself on its first frame instead of waiting for a cold
 * function, and the server re-derives the price when the application lands. The
 * two must agree to the cent, so this pins the same rungs the backend's
 * pricing.test.ts pins. If this file and that one ever disagree, the shopkeeper
 * was quoted one number and charged another.
 */
import { describe, it, expect } from 'vitest';

import { adPriceLabel, adPricePkr, adPricing, AD_PRICE_DEFAULTS as P } from '../adPricing';

describe('adPriceLabel', () => {
  it('is the owner’s ladder: $1 for the first km, 20¢ after it', () => {
    expect(adPriceLabel(P, 1)).toBe('$1');
    expect(adPriceLabel(P, 2)).toBe('$1.20');
    expect(adPriceLabel(P, 6)).toBe('$2');
    expect(adPriceLabel(P, 50)).toBe('$10.80');
  });

  it('never quotes more than the widest radius sold', () => {
    expect(adPriceLabel(P, P.maxRadiusKm + 100)).toBe(adPriceLabel(P, P.maxRadiusKm));
  });
});

describe('adPricePkr', () => {
  it('is the rupees to transfer at the configured rate', () => {
    expect(adPricePkr({ ...P, usdToPkr: 285 }, 5 )).toBe(Math.round(1.8 * 285));
  });
});

describe('adPricing', () => {
  it('uses this build’s ladder until the server’s arrives', () => {
    expect(adPricing(null).baseUsd).toBe(P.baseUsd);
  });

  it('takes the server’s numbers over its own', () => {
    const p = adPricing({
      ok: true,
      baseUsd: 2,
      perKmUsd: 0.5,
      includedKm: 1,
      maxRadiusKm: 100,
      planDays: 15,
      usdToPkr: 300,
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
    expect(adPriceLabel(p, 3)).toBe('$3');
    expect(p.planDays).toBe(15);
  });
});
