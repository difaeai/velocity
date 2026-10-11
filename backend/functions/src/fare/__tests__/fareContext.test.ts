/**
 * `getFareContext` — the call that makes the rider's screen agree with the money.
 *
 * The booking screen priced riders from `fareConfig/{cityId}` read straight out
 * of Firestore. That document is deliberately never fuel-adjusted, so the
 * pricing engine moved what the server charged and validated while the screen
 * the rider actually used went on pricing off the un-adjusted table.
 *
 * Verified invariants:
 *  - the card handed to the app carries today's fuel price, and the stored
 *    document is still left exactly as the admin authored it
 *  - the city comes from the pickup coordinates, so a Karachi pickup is not
 *    priced from Islamabad's table
 *  - the zone's peak factor is returned, because the app has to price with the
 *    same multiplier the server will validate against
 *  - the peak ceiling reported is the LOWER of the engine's and the city's
 *  - a rider with no location is no worse off than before this existed
 *  - fuel off, or no confirmed price, returns the authored card untouched
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { getFareContext } from '../fareFunctions';
import { DEFAULT_ISLAMABAD_RAWALPINDI, DEFAULT_KARACHI } from '../fareEngine';
import { CONFIG_DOC, FUEL_DOC, invalidatePricingCache, zoneKey } from '../../pricing/config';
import { DEFAULT_PRICING_CONFIG } from '../../pricing/types';

function req<T>(data: T, uid = 'rider-uid'): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

const ISB = { lat: 33.6844, lng: 73.0479 };
const KHI = { lat: 24.8607, lng: 67.0011 };

const BASELINE = DEFAULT_PRICING_CONFIG.fuel.baseline.petrol;

/** A confirmed pump price, as the daily job writes it. */
async function seedFuel(pricePkr: number) {
  await db().doc(FUEL_DOC).set({
    petrol: {
      product: 'petrol',
      pricePkr,
      effectiveDate: '2026-10-11',
      confirmations: 2,
      sources: ['a', 'b'],
      confirmedAt: Date.now(),
      stepLimited: false,
      previousPkr: null,
    },
  });
  invalidatePricingCache();
}

beforeEach(async () => {
  await clearFirestore();
  invalidatePricingCache();
  await db().doc('fareConfig/islamabad_rawalpindi').set(DEFAULT_ISLAMABAD_RAWALPINDI);
  await db().doc('fareConfig/karachi').set(DEFAULT_KARACHI);
});

describe('getFareContext', () => {
  it('hands the app a card with today’s fuel price already in it', async () => {
    // Well above the baseline the rate cards were authored against, so the
    // per-km rate has to come back higher than the stored one.
    await seedFuel(BASELINE * 1.2);

    const res = await getFareContext.run(req({ ...ISB, category: 'mini' }));
    const stored = DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini!;

    expect(res.config.categories.mini!.perKm).toBeGreaterThan(stored.perKm);
    // And the driver's floor moves with it — a fuel rise the rider pays for
    // that did not reach the floor would be a rise the driver funded.
    expect(res.config.categories.mini!.bidFloorPerKm).toBeGreaterThan(stored.bidFloorPerKm);
    expect(res.fuel.pricePkr).toBeCloseTo(BASELINE * 1.2, 2);
    expect(res.fuel.note).toMatch(/per-km rates are .* up/i);
  });

  it('cuts rates when fuel is below the baseline the cards were written against', async () => {
    await seedFuel(BASELINE * 0.85);
    const res = await getFareContext.run(req({ ...ISB, category: 'mini' }));
    expect(res.config.categories.mini!.perKm)
      .toBeLessThan(DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini!.perKm);
    expect(res.fuel.note).toMatch(/down/i);
  });

  it('never rewrites the stored card — the adjustment is derived on read', async () => {
    await seedFuel(BASELINE * 1.2);
    await getFareContext.run(req({ ...ISB, category: 'mini' }));

    const stored = (await db().doc('fareConfig/islamabad_rawalpindi').get()).data()!;
    // Switching the engine off has to restore the authored rates exactly, which
    // it cannot do if a read ever wrote back to this document.
    expect(stored.categories.mini.perKm).toBe(DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini!.perKm);
  });

  it('prices a Karachi pickup from Karachi’s table, not Islamabad’s', async () => {
    const khi = await getFareContext.run(req({ ...KHI, category: 'mini' }));
    expect(khi.cityId).toBe('karachi');
    expect(khi.config.categories.mini!.perKm).toBe(DEFAULT_KARACHI.categories.mini!.perKm);

    const isb = await getFareContext.run(req({ ...ISB, category: 'mini' }));
    expect(isb.cityId).toBe('islamabad_rawalpindi');
  });

  it('falls back to the default city when the rider has no location', async () => {
    // The behaviour the screen had before this call existed. A rider with
    // location permission denied must still be able to see a price.
    const res = await getFareContext.run(req({ category: 'mini' }));
    expect(res.cityId).toBe('islamabad_rawalpindi');
    expect(res.config.categories.mini).toBeTruthy();
    expect(res.peak.multiplier).toBe(1);
  });

  it('returns the zone’s live peak factor for the app to price with', async () => {
    const key = zoneKey('islamabad_rawalpindi', 'ttgb0');
    await db().doc(`surge/${key}`).set({ multiplier: 1.18, expiresAt: Date.now() + 600_000 });

    const res = await getFareContext.run(req({ ...ISB, category: 'mini', geohash: 'ttgb0xyz' }));
    expect(res.peak.multiplier).toBe(1.18);
    expect(res.peak.label).toBeTruthy();
  });

  it('ignores an expired zone document rather than serving a stale multiplier', async () => {
    const key = zoneKey('islamabad_rawalpindi', 'ttgb0');
    await db().doc(`surge/${key}`).set({ multiplier: 1.25, expiresAt: Date.now() - 1 });

    const res = await getFareContext.run(req({ ...ISB, category: 'mini', geohash: 'ttgb0xyz' }));
    expect(res.peak.multiplier).toBe(1);
    expect(res.peak.label).toBeNull();
  });

  it('reports the lower of the engine ceiling and the city’s own', async () => {
    const res = await getFareContext.run(req({ ...ISB, category: 'mini' }));
    expect(res.peak.maxMultiplier).toBeLessThanOrEqual(DEFAULT_PRICING_CONFIG.peak.maxMultiplier);
    expect(res.peak.maxMultiplier)
      .toBeLessThanOrEqual(DEFAULT_ISLAMABAD_RAWALPINDI.surge.maxMultiplier);
  });

  it('leaves the authored card alone when there is no confirmed fuel price', async () => {
    const res = await getFareContext.run(req({ ...ISB, category: 'mini' }));
    expect(res.config.categories.mini!.perKm)
      .toBe(DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini!.perKm);
    // Silence, not a reassurance that fuel is normal.
    expect(res.fuel.note).toBeNull();
  });

  it('leaves it alone when an admin has switched the fuel engine off', async () => {
    await seedFuel(BASELINE * 1.2);
    await db().doc(CONFIG_DOC).set({ fuel: { enabled: false } }, { merge: true });
    invalidatePricingCache();

    const res = await getFareContext.run(req({ ...ISB, category: 'mini' }));
    expect(res.config.categories.mini!.perKm)
      .toBe(DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini!.perKm);
    expect(res.fuel.note).toBeNull();
  });

  it('moves a rickshaw more than a luxury car on the same price rise', async () => {
    // The fuel SHARE is per class: a rickshaw's rate is nearly all fuel, a
    // luxury car's is mostly the car. This is why the call takes a category.
    await seedFuel(BASELINE * 1.2);
    const [rickshaw, luxury] = await Promise.all([
      getFareContext.run(req({ ...ISB, category: 'rickshaw' })),
      getFareContext.run(req({ ...ISB, category: 'luxury' })),
    ]);
    const pct = (r: { config: { categories: Record<string, { perKm: number } | undefined> } }, cat: string) =>
      r.config.categories[cat]!.perKm /
      (DEFAULT_ISLAMABAD_RAWALPINDI.categories as Record<string, { perKm: number } | undefined>)[cat]!.perKm;

    expect(pct(rickshaw, 'rickshaw')).toBeGreaterThan(pct(luxury, 'luxury'));
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(
      getFareContext.run({ data: { ...ISB }, acceptsStreaming: false, rawRequest: {} } as never),
    ).rejects.toThrow(/sign in/i);
  });
});
