/**
 * "Find your Customers" — the radius price ladder (pure, no emulator).
 *
 * The owner's list (2026-11-14): a dollar buys one ad at one kilometre, and
 * every kilometre after it is twenty cents. These are the numbers a shopkeeper
 * is quoted and the numbers the server re-derives when the application lands,
 * so they are worth pinning down to the cent — in cents, because 1 + 0.2 * 3 in
 * floating point is 1.6000000000000003.
 */
import { describe, it, expect } from 'vitest';

import {
  adPriceCents,
  adPriceUsd,
  DEFAULT_BUSINESS_AD_SETTINGS as S,
  pricePkr,
} from '../config';

describe('adPriceUsd', () => {
  it('is a dollar for the kilometre the base price includes', () => {
    expect(adPriceUsd(S, 1)).toBe(1);
  });

  it('climbs twenty cents a kilometre', () => {
    expect(adPriceUsd(S, 2)).toBe(1.2);
    expect(adPriceUsd(S, 3)).toBe(1.4);
    // Five kilometres past the first make a second dollar.
    expect(adPriceUsd(S, 6)).toBe(2);
    expect(adPriceUsd(S, 11)).toBe(3);
  });

  it('prices the picker’s widest radius', () => {
    expect(adPriceUsd(S, 50)).toBe(10.8);
  });

  it('counts half kilometres', () => {
    expect(adPriceUsd(S, 2.5)).toBe(1.3);
  });

  it('never lands between cents', () => {
    for (let km = 0.5; km <= 60; km += 0.5) {
      expect(Number.isInteger(adPriceCents(S, km))).toBe(true);
    }
  });

  it('quotes the ceiling rather than more for a radius we do not sell', () => {
    expect(adPriceUsd(S, S.maxRadiusKm + 500)).toBe(adPriceUsd(S, S.maxRadiusKm));
  });

  it('charges the base price below the included radius', () => {
    expect(adPriceUsd(S, 0.5)).toBe(1);
  });

  it('follows a repriced list', () => {
    const cheap = { ...S, baseUsd: 2, perKmUsd: 0.5, includedKm: 2 };
    expect(adPriceUsd(cheap, 2)).toBe(2);
    expect(adPriceUsd(cheap, 4)).toBe(3);
  });
});

describe('pricePkr', () => {
  it('is the dollar price at the configured rate, to the rupee', () => {
    expect(pricePkr({ ...S, usdToPkr: 285 }, 1.8)).toBe(513);
  });
});
