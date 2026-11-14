/**
 * "Find your Customers" — the radius price ladder (pure, no emulator).
 *
 * The owner's list (2026-11-14): Rs 300 buys one ad at one kilometre, and every
 * kilometre after it is Rs 60. These are the numbers a shopkeeper is quoted and
 * the numbers the server re-derives when the application lands, so they are
 * worth pinning down to the rupee.
 */
import { describe, it, expect } from 'vitest';

import { adPrice, DEFAULT_BUSINESS_AD_SETTINGS as S } from '../config';

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
});
