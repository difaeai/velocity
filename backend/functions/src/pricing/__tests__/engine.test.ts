/**
 * The tick, against a real Firestore.
 *
 * The pure maths is covered in peak/supplyIntegrity/driverQueue tests. What
 * these verify is the wiring, which is where this feature can fail silently:
 *
 *  1. The tick writes `surge/{cityId}_{zone}` — the document
 *     `fare/fareFunctions.ts:getZoneSurge` has been reading, and defaulting to
 *     1.0 on, since the fare engine was written. If this stops working the
 *     whole peak factor goes quietly back to being a no-op and every test above
 *     still passes.
 *  2. The written document expires. A dead tick must fall back to 1.0 rather
 *     than pinning the last multiplier it managed to write for ever.
 *  3. Supply is counted from real driver documents by geohash cell, using the
 *     same (online, verificationStatus, geohash) shape as lib/nearbyDrivers.
 *  4. Drivers on a trip are not counted as available supply.
 *  5. The claim gate reads the queue the tick built — and fails open when it
 *     cannot.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { FieldValue } from '../../lib/firebase';
import { claimGateFor } from '../claimGate';
import { CONFIG_DOC, invalidatePricingCache } from '../config';
import { runTick } from '../engine';
import { DEFAULT_PRICING_CONFIG } from '../types';

/** Blue Area, Islamabad — inside the islamabad_rawalpindi fare city. */
const PICKUP = { lat: 33.7077, lng: 73.0498 };
/** encodeGeohash(PICKUP, 5) — the zone the tick will file this under. */
const ZONE_KEY_PREFIX = 'islamabad_rawalpindi_';

async function seedConfig(over: Record<string, unknown> = {}) {
  await db().doc(CONFIG_DOC).set({
    ...DEFAULT_PRICING_CONFIG,
    // A real zone in these tests is a handful of documents, so the quiet-zone
    // guard would otherwise throw every sample away.
    peak: { ...DEFAULT_PRICING_CONFIG.peak, minActivity: 2 },
    ...over,
  });
  invalidatePricingCache();
}

/** An approved, online driver parked at `at`, with the cell the sweeper stamps. */
async function seedDriver(id: string, at: { lat: number; lng: number }, online = true) {
  const { encodeGeohash } = await import('../../lib/geohash');
  await db().doc(`drivers/${id}`).set({
    online,
    verificationStatus: 'approved',
    lastLocation: at,
    geohash: encodeGeohash(at.lat, at.lng, 10),
  });
}

/** A rider waiting, as `openRequests` carries it. */
async function seedRequest(id: string, at: { lat: number; lng: number }) {
  const { encodeGeohash } = await import('../../lib/geohash');
  await db().doc(`openRequests/${id}`).set({
    tripId: id,
    rideType: 'mini',
    offeredFare: 400,
    seats: 1,
    pickup: at,
    pickupGeohash: encodeGeohash(at.lat, at.lng, 6),
    createdAt: FieldValue.serverTimestamp(),
  });
}

const surgeDocs = async () => {
  const snap = await db().collection('surge').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string });
};

describe('the defaults', () => {
  // adminGetPricingEngine returns them; an Infinity made every call answer INTERNAL.
  it('survive the trip to the admin page as JSON', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG))).toEqual(DEFAULT_PRICING_CONFIG);
  });
});

describe('the pricing tick', () => {
  beforeEach(async () => {
    await clearFirestore();
    invalidatePricingCache();
    await seedConfig();
  });

  it('writes the surge document the fare engine reads', async () => {
    // Four riders waiting, one free driver: a real shortage.
    await seedDriver('d1', PICKUP);
    for (const n of [1, 2, 3, 4]) await seedRequest(`r${n}`, PICKUP);

    const report = await runTick();
    expect(report.zonesPriced).toBeGreaterThan(0);

    const docs = await surgeDocs();
    expect(docs).toHaveLength(1);
    const surge = docs[0]!;
    expect(surge.id.startsWith(ZONE_KEY_PREFIX)).toBe(true);
    expect(surge.cityId).toBe('islamabad_rawalpindi');
    // Ramped, so one tick cannot reach the ceiling.
    expect(surge.multiplier).toBeCloseTo(1 + DEFAULT_PRICING_CONFIG.peak.rampUpPerTick, 4);
    expect(surge.ratio).toBe(4);
  });

  it('stamps an expiry so a dead tick stops moving fares', async () => {
    await seedDriver('d1', PICKUP);
    for (const n of [1, 2, 3, 4]) await seedRequest(`r${n}`, PICKUP);
    await runTick();

    const surge = (await surgeDocs())[0]!;
    const expiresAt = surge.expiresAt as number;
    const updatedAt = surge.updatedAt as number;
    expect(expiresAt - updatedAt).toBe(DEFAULT_PRICING_CONFIG.peak.staleAfterSec * 1000);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('leaves a well-supplied zone at 1.0', async () => {
    for (const n of [1, 2, 3, 4, 5, 6] as const) await seedDriver(`d${n}`, PICKUP);
    await seedRequest('r1', PICKUP);

    await runTick();
    expect((await surgeDocs())[0]!.multiplier).toBe(1);
  });

  it('does not count a driver who is already on a trip as supply', async () => {
    await seedDriver('busy', PICKUP);
    await seedDriver('free', PICKUP);
    await db().doc('trips/t1').set({ status: 'in_progress', driverId: 'busy' });
    for (const n of [1, 2, 3, 4] as const) await seedRequest(`r${n}`, PICKUP);

    await runTick();

    const zone = (await db().collection('pricingZones').get()).docs[0]!;
    const samples = zone.get('samples') as { onlineDrivers: number; availableDrivers: number }[];
    expect(samples.at(-1)!.onlineDrivers).toBe(2);
    expect(samples.at(-1)!.availableDrivers).toBe(1);
    // 4 riders over 1 free car, not over 2.
    expect(zone.get('decision').ratio).toBe(4);
  });

  it('ignores an offline driver and an unapproved one', async () => {
    await seedDriver('offline', PICKUP, false);
    await db().doc('drivers/pending').set({
      online: true,
      verificationStatus: 'pending',
      lastLocation: PICKUP,
      geohash: (await import('../../lib/geohash')).encodeGeohash(PICKUP.lat, PICKUP.lng, 10),
    });
    await seedDriver('ok', PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);

    await runTick();
    const zone = (await db().collection('pricingZones').get()).docs[0]!;
    const samples = zone.get('samples') as { onlineDrivers: number }[];
    expect(samples.at(-1)!.onlineDrivers).toBe(1);
  });

  it('builds the zone queue in the order drivers came online', async () => {
    await seedDriver('a', PICKUP);
    await seedDriver('b', PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);

    await runTick();

    const zone = (await db().collection('pricingZones').get()).docs[0]!;
    const queue = zone.get('queue') as { driverId: string; queuedAt: number }[];
    expect(queue.map((q) => q.driverId).sort()).toEqual(['a', 'b']);
    expect(queue.every((q) => typeof q.queuedAt === 'number')).toBe(true);
  });

  it('keeps a zone warm for a tick with no requests, so seniority survives', async () => {
    await seedDriver('a', PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);
    await runTick();
    const first = (await db().collection('pricingZones').get()).docs[0]!;
    const queuedAt = (first.get('queue') as { queuedAt: number }[])[0]!.queuedAt;

    // The rider gives up; the driver stays put.
    await db().doc('openRequests/r1').delete();
    await db().doc('openRequests/r2').delete();
    await runTick();

    const again = (await db().collection('pricingZones').get()).docs[0]!;
    const queue = again.get('queue') as { driverId: string; queuedAt: number }[];
    // Same driver, same seniority — not reset by a quiet minute.
    expect(queue).toHaveLength(1);
    expect(queue[0]!.queuedAt).toBe(queuedAt);
  });

  it('accumulates samples across ticks', async () => {
    await seedDriver('a', PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);

    await runTick();
    await runTick();

    const zone = (await db().collection('pricingZones').get()).docs[0]!;
    expect((zone.get('samples') as unknown[]).length).toBe(2);
  });

  it('does nothing at all when the peak factor is switched off', async () => {
    await seedConfig({ peak: { ...DEFAULT_PRICING_CONFIG.peak, enabled: false, minActivity: 2 } });
    await seedDriver('d1', PICKUP);
    for (const n of [1, 2, 3, 4] as const) await seedRequest(`r${n}`, PICKUP);

    await runTick();
    expect((await surgeDocs())[0]!.multiplier).toBe(1);
  });

  it('prices nothing when nobody is waiting anywhere', async () => {
    await seedDriver('d1', PICKUP);
    const report = await runTick();
    expect(report.zonesPriced).toBe(0);
    expect(await surgeDocs()).toEqual([]);
  });
});

describe('the claim gate, against a real queue', () => {
  beforeEach(async () => {
    await clearFirestore();
    invalidatePricingCache();
    await seedConfig();
  });

  it('lets the first driver in the queue bid at once and makes a later one wait', async () => {
    // Four drivers, so the second tier exists. tierSize is 3 by default.
    for (const id of ['a', 'b', 'c', 'd']) await seedDriver(id, PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);
    await runTick();

    const queue = (await db().collection('pricingZones').get()).docs[0]!.get('queue') as {
      driverId: string;
    }[];
    const head = queue[0]!.driverId;
    const tail = queue[3]!.driverId;

    const now = Date.now();
    const headDecision = await claimGateFor({ driverId: head, pickup: PICKUP, requestCreatedAtMs: now, now });
    expect(headDecision.allowed).toBe(true);
    expect(headDecision.rank).toBe(0);

    const tailDecision = await claimGateFor({ driverId: tail, pickup: PICKUP, requestCreatedAtMs: now, now });
    expect(tailDecision.allowed).toBe(false);
    expect(tailDecision.reason).toBe('wait_your_turn');
    expect(tailDecision.waitMs).toBe(DEFAULT_PRICING_CONFIG.queue.tierSeconds * 1000);
  });

  it('opens the request to the whole queue once it has aged', async () => {
    for (const id of ['a', 'b', 'c', 'd']) await seedDriver(id, PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);
    await runTick();

    const now = Date.now();
    const decision = await claimGateFor({
      driverId: 'd',
      pickup: PICKUP,
      requestCreatedAtMs: now - (DEFAULT_PRICING_CONFIG.queue.openToAllAfterSec + 1) * 1000,
      now,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('open_to_all');
  });

  it('fails open in a zone the tick has never priced', async () => {
    const decision = await claimGateFor({
      driverId: 'nobody',
      pickup: { lat: 24.8607, lng: 67.0011 }, // Karachi, no queue built
      requestCreatedAtMs: Date.now(),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('no_queue');
  });

  it('fails open for a trip with no pickup coordinates', async () => {
    const decision = await claimGateFor({
      driverId: 'a',
      pickup: undefined,
      requestCreatedAtMs: Date.now(),
    });
    expect(decision.allowed).toBe(true);
  });

  it('fails open when the queue is switched off', async () => {
    await seedConfig({ queue: { ...DEFAULT_PRICING_CONFIG.queue, enabled: false } });
    for (const id of ['a', 'b', 'c', 'd']) await seedDriver(id, PICKUP);
    await seedRequest('r1', PICKUP);
    await seedRequest('r2', PICKUP);
    await runTick();

    const decision = await claimGateFor({
      driverId: 'd',
      pickup: PICKUP,
      requestCreatedAtMs: Date.now(),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('disabled');
  });
});
