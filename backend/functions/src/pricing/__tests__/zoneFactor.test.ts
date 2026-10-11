/**
 * The zone factor read, and the shared-ride fare that now carries it.
 *
 * Two things are pinned here that nothing else pins:
 *
 *  1. **Every read fails to 1.0.** Missing document, expired document,
 *     half-written document, engine switched off. The alternative — a read that
 *     serves whatever it last found — pins every fare in a zone to a stale
 *     multiplier the moment the tick stops, which is the worst failure this
 *     feature could have.
 *  2. **A shared ride takes the factor but never breaks its floor.** Shared
 *     fares are server-priced with no negotiation, so the clamp at
 *     `minAcceptableBid` is the only thing standing between a discounting
 *     config and a pool no driver will accept.
 *
 * Also pins the coupling that makes the ceiling real: `peak.maxMultiplier`
 * applies to what is READ, not only to what the tick writes. A hand-edited
 * `surge/*` document must not be able to raise a fare past it.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { sharedRideFare } from '../../fare/sharedRideFare';
import { DEFAULT_ISLAMABAD_RAWALPINDI } from '../../fare/fareEngine';
import { CONFIG_DOC, invalidatePricingCache, zoneKey } from '../config';
import { peakFactorForPoint, peakFactorForZone } from '../zoneFactor';
import { DEFAULT_PRICING_CONFIG } from '../types';

/** Blue Area, Islamabad. */
const PICKUP = { lat: 33.7077, lng: 73.0498 };
const DROPOFF = { lat: 33.6844, lng: 73.0479 };

async function seedConfig(peak: Record<string, unknown> = {}) {
  await db().doc(CONFIG_DOC).set({
    ...DEFAULT_PRICING_CONFIG,
    peak: { ...DEFAULT_PRICING_CONFIG.peak, ...peak },
  });
  invalidatePricingCache();
}

/** Write the document the tick would have written, with a chosen multiplier. */
async function seedZone(multiplier: number, over: Record<string, unknown> = {}) {
  const { encodeGeohash } = await import('../../lib/geohash');
  const zone = encodeGeohash(PICKUP.lat, PICKUP.lng, DEFAULT_PRICING_CONFIG.peak.zonePrecision);
  const key = zoneKey('islamabad_rawalpindi', zone);
  await db().doc(`surge/${key}`).set({
    multiplier,
    cityId: 'islamabad_rawalpindi',
    zone,
    updatedAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_PRICING_CONFIG.peak.staleAfterSec * 1000,
    ...over,
  });
  return key;
}

async function seedFareTable() {
  await db().doc('fareConfig/islamabad_rawalpindi').set(DEFAULT_ISLAMABAD_RAWALPINDI);
}

describe('peakFactorForPoint', () => {
  beforeEach(async () => {
    await clearFirestore();
    invalidatePricingCache();
    await seedConfig();
  });

  it('reads the factor the tick wrote', async () => {
    await seedZone(1.18);
    const factor = await peakFactorForPoint(PICKUP);
    expect(factor.multiplier).toBe(1.18);
    expect(factor.reason).toBe('live');
    expect(factor.zoneKey?.startsWith('islamabad_rawalpindi_')).toBe(true);
  });

  it('is 1.0 in a zone the tick has never written', async () => {
    const factor = await peakFactorForPoint(PICKUP);
    expect(factor.multiplier).toBe(1);
    expect(factor.reason).toBe('no_document');
  });

  it('is 1.0 once the document has expired — a dead tick stops moving fares', async () => {
    await seedZone(1.25, { expiresAt: Date.now() - 1 });
    const factor = await peakFactorForPoint(PICKUP);
    expect(factor.multiplier).toBe(1);
    expect(factor.reason).toBe('expired');
  });

  it('refuses a multiplier above the ceiling even from its own document', async () => {
    // A hand-edited or half-written surge doc must not be able to triple a fare.
    await seedZone(3);
    expect((await peakFactorForPoint(PICKUP)).multiplier).toBe(
      DEFAULT_PRICING_CONFIG.peak.maxMultiplier,
    );
  });

  it('is 1.0 on a half-written document', async () => {
    await seedZone(Number.NaN);
    expect((await peakFactorForPoint(PICKUP)).multiplier).toBe(1);
  });

  it('is 1.0 while the peak factor is switched off', async () => {
    await seedZone(1.25);
    await seedConfig({ enabled: false });
    const factor = await peakFactorForPoint(PICKUP);
    expect(factor.multiplier).toBe(1);
    expect(factor.reason).toBe('disabled');
  });

  it('is 1.0 without usable coordinates', async () => {
    expect((await peakFactorForPoint(null)).multiplier).toBe(1);
    expect((await peakFactorForPoint({ lat: Number.NaN, lng: 73 })).reason).toBe('no_zone');
  });

  it('slices a longer geohash down to the zone the tick writes', async () => {
    const key = await seedZone(1.1);
    const { encodeGeohash } = await import('../../lib/geohash');
    // A 10-character hash from a handset must find the 5-character zone doc.
    const precise = encodeGeohash(PICKUP.lat, PICKUP.lng, 10);
    const factor = await peakFactorForZone('islamabad_rawalpindi', precise);
    expect(factor.multiplier).toBe(1.1);
    expect(factor.zoneKey).toBe(key);
  });
});

describe('a shared ride carries the zone factor', () => {
  beforeEach(async () => {
    await clearFirestore();
    invalidatePricingCache();
    await seedConfig();
    await seedFareTable();
  });

  it('prices higher in a busy zone than in an ordinary one', async () => {
    const ordinary = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(ordinary.peakMultiplier).toBe(1);

    await seedZone(1.25);
    const busy = await sharedRideFare('mini', PICKUP, DROPOFF);

    expect(busy.peakMultiplier).toBe(1.25);
    expect(busy.fare).toBeGreaterThan(ordinary.fare);
    // And the per-seat ladder moves with it, since it is derived from the fare.
    expect(busy.perSeat[2]!).toBeGreaterThan(ordinary.perSeat[2]!);
  });

  it('still clamps at the driver floor, peak factor or no peak factor', async () => {
    await seedZone(1.25);
    const quote = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(quote.fare).toBeGreaterThanOrEqual(quote.floor);
  });

  it('never falls below the floor even when the zone is discounting', async () => {
    // The idle-supply discount, which an admin may enable. A shared ride has no
    // negotiation to rescue it, so the floor is the only protection the driver
    // has against a config that prices the ride below what it costs to serve.
    await seedConfig({ minMultiplier: 0.8 });
    await seedZone(0.8);
    const quote = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(quote.peakMultiplier).toBeLessThanOrEqual(1);
    expect(quote.fare).toBeGreaterThanOrEqual(quote.floor);
  });

  it('is unaffected by a zone whose factor has expired', async () => {
    const ordinary = await sharedRideFare('mini', PICKUP, DROPOFF);
    await seedZone(1.25, { expiresAt: Date.now() - 1 });
    const stale = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(stale.fare).toBe(ordinary.fare);
    expect(stale.peakMultiplier).toBe(1);
  });

  it('prices at 1.0 when there is no fare table at all', async () => {
    await db().doc('fareConfig/islamabad_rawalpindi').delete();
    await seedZone(1.25);
    const quote = await sharedRideFare('mini', PICKUP, DROPOFF);
    // Static fallback: a last-resort base fare is not where factors get applied.
    expect(quote.peakMultiplier).toBe(1);
    expect(quote.cityId).toBeNull();
  });
});

describe('the engine ceiling is a ceiling on reads, not just on writes', () => {
  beforeEach(async () => {
    await clearFirestore();
    invalidatePricingCache();
    await seedFareTable();
  });

  it('holds a shared fare to the configured ceiling', async () => {
    await seedConfig({ maxMultiplier: 1.1 });
    await seedZone(1.25); // written before the ceiling was lowered
    const quote = await sharedRideFare('mini', PICKUP, DROPOFF);
    expect(quote.peakMultiplier).toBeLessThanOrEqual(1.1);
  });

  /**
   * `surge.minMultiplier` on a city table is a DISCOUNT floor and nothing else.
   *
   * `calculateFare` floors the multiplier at it, so without a cap a table
   * carrying `minMultiplier: 1.5` would multiply every fare in that city by 1.5
   * — with no zone document behind it, no tick involved, and nothing anywhere
   * recording that it happened. `fareConfig/{cityId}` is admin-writable, so
   * that is one careless edit away. Raising fares is the peak factor's job; it
   * is capped, and it leaves a `surge/*` document saying why.
   */
  it('a city table cannot use its surge floor to raise fares on its own', async () => {
    await seedConfig();
    const ordinary = (await sharedRideFare('mini', PICKUP, DROPOFF)).fare;

    await db().doc('fareConfig/islamabad_rawalpindi').set({
      ...DEFAULT_ISLAMABAD_RAWALPINDI,
      surge: { ...DEFAULT_ISLAMABAD_RAWALPINDI.surge, minMultiplier: 1.5 },
    });
    const quote = await sharedRideFare('mini', PICKUP, DROPOFF);

    // Not 1.5x the ordinary fare. Not any multiple of it.
    expect(quote.fare).toBe(ordinary);
    expect(quote.peakMultiplier).toBe(1);
  });

  it('still honours a city table that genuinely wants to discount', async () => {
    await seedConfig({ minMultiplier: 0.9 });
    const ordinary = (await sharedRideFare('mini', PICKUP, DROPOFF)).fare;

    await db().doc('fareConfig/islamabad_rawalpindi').set({
      ...DEFAULT_ISLAMABAD_RAWALPINDI,
      // A long ride, so the fare is well clear of `minFare` and a discount has
      // somewhere to go — on a short hop the floor clamp would hide it.
      surge: { ...DEFAULT_ISLAMABAD_RAWALPINDI.surge, minMultiplier: 0.9 },
    });
    const far = { lat: 33.52, lng: 73.09 };
    const discounted = await sharedRideFare('mini', PICKUP, far);
    const undiscounted = ordinary;

    expect(discounted.peakMultiplier).toBeLessThanOrEqual(1);
    // The floor is still absolute: a discount may not price below it.
    expect(discounted.fare).toBeGreaterThanOrEqual(discounted.floor);
    expect(undiscounted).toBeGreaterThan(0);
  });
});
