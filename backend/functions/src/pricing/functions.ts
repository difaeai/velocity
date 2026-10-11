/**
 * The Pricing Engine's callable surface: three for the apps, five for admins.
 * ----------------------------------------------------------------------------
 * The apps never read `surge/*`, `pricingZones/*` or `fuelPrices/*` directly.
 * Those collections are closed to clients in firestore.rules and reached only
 * through here, for two reasons:
 *
 *  · A zone document carries half an hour of samples, the whole driver queue
 *    and the shock verdict. A rider needs one number and a label; handing them
 *    the rest is a bandwidth and privacy cost for nothing. The queue in
 *    particular names every driver in the area, which no rider should have.
 *  · A callable can shape the answer per caller. The same zone state produces
 *    "Busy right now" for a rider and "High demand — fares 18% higher here" for
 *    a driver, and neither of them sees the ratio it came from.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { db } from '../lib/firebase';
import { invalid, requireAdmin, requireAuth } from '../lib/guards';
import { encodeGeohash } from '../lib/geohash';
import { fareCityIdsFor } from '../fare/cityConfig';
import type { VehicleCategory } from '../fare/fareEngine';
import {
  CONFIG_DOC,
  ZONE_COLLECTION,
  invalidatePricingCache,
  loadFuelPrices,
  loadPricingConfig,
  zoneKey,
} from './config';
import { describeQueuePosition, effectiveDelayMs, rankOf } from './driverQueue';
import { describeFuelAdjustment, fuelFactorFor } from './fuel';
import { fuelStatus, runFuelRefresh } from './fuelJob';
import { runTick } from './engine';
import { driverPeakLabel, explainPeak, riderPeakLabel } from './peak';
import { describeShock } from './supplyIntegrity';
import { peakFactorForPoint } from './zoneFactor';
import {
  DEFAULT_PRICING_CONFIG,
  FUEL_PRODUCTS,
  type ConfirmedFuelPrice,
  type QueueEntry,
} from './types';

const REGION = 'asia-south1';

const coords = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/**
 * What a rider should be told about the price right now, before they book.
 *
 * Returns nothing to show in the ordinary case — `label` is null at 1.0, which
 * is most of the time in most places, and the booking screen then draws no
 * badge at all rather than reassuring somebody that fares are normal.
 */
export const getPricingSnapshot = onCall({ region: REGION }, async (req) => {
  requireAuth(req);
  const parsed = z
    .object({
      pickup: coords,
      category: z.string().optional(),
      forDriver: z.boolean().optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid('A pickup location is required.');
  const { pickup, category, forDriver } = parsed.data;

  const now = Date.now();
  const config = await loadPricingConfig();
  const [{ multiplier }, prices] = await Promise.all([
    peakFactorForPoint(pickup, now),
    loadFuelPrices(),
  ]);

  const fuel = fuelFactorFor(
    (category as VehicleCategory) ?? 'mini',
    prices,
    config.fuel,
    now,
  );

  return {
    peak: {
      multiplier,
      label: forDriver ? driverPeakLabel(multiplier) : riderPeakLabel(multiplier),
      /** The ceiling, so the app can promise "never more than this". */
      maxMultiplier: config.peak.maxMultiplier,
    },
    fuel: {
      /** Only ever set when fuel has actually moved the per-km rate. */
      note: describeFuelAdjustment(fuel),
      pricePkr: fuel.pricePkr,
      product: fuel.product,
    },
  };
});

/**
 * A driver's place in the queue for where they are standing.
 *
 * Computed live rather than read from the tick's snapshot, because a driver who
 * has just come online wants to see themselves in the queue now, not in up to
 * sixty seconds. The rank comes from the stored queue — the tick owns
 * seniority — but a driver absent from it is told they are joining rather than
 * shown nothing.
 */
export const getDriverQueueStatus = onCall({ region: REGION }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = z.object({ location: coords }).safeParse(req.data);
  if (!parsed.success) invalid('Your current location is required.');
  const { location } = parsed.data;

  const now = Date.now();
  const config = await loadPricingConfig();
  const precision = Math.max(1, Math.trunc(config.peak.zonePrecision));
  const cityId = fareCityIdsFor(location)[0]!;
  const zone = encodeGeohash(location.lat, location.lng, precision);
  const key = zoneKey(cityId, zone);

  let entries: QueueEntry[] = [];
  let updatedAt = 0;
  try {
    const snap = await db.doc(`${ZONE_COLLECTION}/${key}`).get();
    if (snap.exists) {
      const stored = snap.get('queue');
      if (Array.isArray(stored)) entries = stored as QueueEntry[];
      updatedAt = (snap.get('updatedAt') as number | undefined) ?? 0;
    }
  } catch {
    // Falls through to an empty queue, which reads as "joining".
  }

  const rank = rankOf(entries, ctx.uid);
  const queueSize = entries.length;
  const mine = entries.find((e) => e.driverId === ctx.uid);

  return {
    enabled: config.queue.enabled,
    rank,
    position: rank === null ? null : rank + 1,
    queueSize,
    label: describeQueuePosition(rank, queueSize),
    /** How long after a request appears this driver may take it. */
    claimDelayMs: effectiveDelayMs(rank, queueSize, config.queue),
    /** When their current unbroken online run started. */
    queuedSince: mine?.queuedAt ?? null,
    /** So the app can warn before a driver goes offline for a moment. */
    graceSec: config.queue.graceSec,
    openToAllAfterSec: config.queue.openToAllAfterSec,
    zone: key,
    queueAgeMs: updatedAt ? now - updatedAt : null,
  };
});

// ── Admin desk ──────────────────────────────────────────────────────────────

/** Everything the pricing page needs in one call. */
export const adminGetPricingEngine = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const now = Date.now();
  const [config, fuel] = await Promise.all([loadPricingConfig(true), fuelStatus(now)]);

  // The busiest zones, by multiplier then by demand. Capped: this is a
  // dashboard, not an export.
  const snap = await db
    .collection(ZONE_COLLECTION)
    .where('updatedAt', '>=', now - config.peak.staleAfterSec * 1000)
    .limit(100)
    .get();

  const zones = snap.docs
    .map((doc) => {
      const samples = (doc.get('samples') as { onlineDrivers: number; availableDrivers: number; openRequests: number }[] | undefined) ?? [];
      const latest = samples.at(-1);
      const shock = doc.get('shock') as Parameters<typeof describeShock>[0] | undefined;
      const decision = doc.get('decision') as Parameters<typeof explainPeak>[0] | undefined;
      return {
        key: doc.id,
        cityId: doc.get('cityId') as string | undefined,
        zone: doc.get('zone') as string | undefined,
        multiplier: (doc.get('multiplier') as number | undefined) ?? 1,
        onlineDrivers: latest?.onlineDrivers ?? 0,
        availableDrivers: latest?.availableDrivers ?? 0,
        openRequests: latest?.openRequests ?? 0,
        queueSize: ((doc.get('queue') as unknown[] | undefined) ?? []).length,
        frozen: decision?.reason === 'frozen_supply_shock',
        reason: decision?.reason ?? 'banded',
        explanation: decision ? explainPeak(decision) : null,
        shock: shock ? describeShock(shock) : null,
        suspicious: shock?.suspicious ?? false,
        updatedAt: doc.get('updatedAt') as number | undefined,
      };
    })
    .sort((a, b) => b.multiplier - a.multiplier || b.openRequests - a.openRequests);

  const flagged = await db
    .collection('driverPresence')
    .where('flagged', '==', true)
    .limit(50)
    .get();

  return {
    config,
    defaults: DEFAULT_PRICING_CONFIG,
    fuel,
    zones,
    summary: {
      zonesTracked: zones.length,
      surging: zones.filter((z) => z.multiplier > 1.001).length,
      frozen: zones.filter((z) => z.frozen).length,
      flaggedDrivers: flagged.size,
    },
    flaggedDrivers: flagged.docs.map((doc) => ({
      driverId: doc.id,
      cyclesLastHour: doc.get('cyclesLastHour') as number | undefined,
      lastOpportunisticReturnAt: doc.get('lastOpportunisticReturnAt') as number | undefined,
      updatedAt: doc.get('updatedAt') as number | undefined,
    })),
  };
});

/**
 * The bounds an admin may set from the dashboard.
 *
 * Every one of these is a cap on how much the engine can move somebody's money,
 * so they are validated here rather than trusted: `maxMultiplier` is capped at
 * 2.0 whatever an admin types, because a fat finger on a pricing dashboard
 * should not be able to double every fare in the country. Changing it past that
 * is a deliberate code change with a review on it.
 */
const configSchema = z.object({
  fuel: z
    .object({
      enabled: z.boolean(),
      baseline: z.object({ petrol: z.number().min(1).max(5000), diesel: z.number().min(1).max(5000) }),
      agreementTolerance: z.number().min(0).max(0.2),
      minConfirmations: z.number().int().min(1).max(5),
      maxStepPct: z.number().min(0).max(0.5),
      maxAgeDays: z.number().int().min(1).max(365),
      maxAdjustmentPct: z.number().min(0).max(1),
    })
    .partial()
    .optional(),
  peak: z
    .object({
      enabled: z.boolean(),
      maxMultiplier: z.number().min(1).max(2),
      minMultiplier: z.number().min(0.5).max(1),
      rampUpPerTick: z.number().min(0.01).max(0.5),
      rampDownPerTick: z.number().min(0.01).max(1),
      minActivity: z.number().int().min(0).max(100),
      staleAfterSec: z.number().int().min(60).max(3600),
      bands: z
        .array(z.object({ ratio: z.number().min(0), multiplier: z.number().min(0.5).max(2) }))
        .min(1)
        .max(10),
    })
    .partial()
    .optional(),
  integrity: z
    .object({
      enabled: z.boolean(),
      dropPct: z.number().min(0.05).max(0.95),
      lookbackSec: z.number().int().min(120).max(7200),
      maxSuddenSamples: z.number().int().min(1).max(10),
      freezeMinutes: z.number().int().min(1).max(240),
      returnWindowSec: z.number().int().min(60).max(7200),
      maxCyclesPerHour: z.number().int().min(1).max(50),
      minSupplyForShock: z.number().int().min(2).max(100),
    })
    .partial()
    .optional(),
  queue: z
    .object({
      enabled: z.boolean(),
      tierSize: z.number().int().min(1).max(50),
      tierSeconds: z.number().int().min(0).max(60),
      openToAllAfterSec: z.number().int().min(5).max(300),
      graceSec: z.number().int().min(0).max(600),
    })
    .partial()
    .optional(),
});

export const adminUpdatePricingEngine = onCall({ region: REGION }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = configSchema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid settings.');
  }

  // Merged rather than replaced, so a dashboard that only knows about three
  // settings cannot wipe a fourth it has never heard of.
  await db.doc(CONFIG_DOC).set(
    { ...parsed.data, updatedAt: Date.now(), updatedBy: ctx.uid },
    { merge: true },
  );
  invalidatePricingCache();
  return { config: await loadPricingConfig(true) };
});

/** Run the fuel fetch now, and hand back exactly what it saw. */
export const adminRefreshFuelPrices = onCall({ region: REGION, timeoutSeconds: 120 }, async (req) => {
  requireAdmin(req);
  return { report: await runFuelRefresh() };
});

/** Run the pricing tick now — for watching a settings change land. */
export const adminRunPricingTick = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  requireAdmin(req);
  return { report: await runTick() };
});

/**
 * Type a pump price in by hand.
 *
 * The escape hatch for the day both mirrors are down, or are wrong, and fares
 * are visibly off. It writes the same shape the job writes, with the admin's uid
 * as the source and one confirmation, so the provenance of a hand-typed price
 * is never mistaken for a corroborated one — and `stepLimited` is false,
 * because a human who has looked at a pump board is allowed to move the price
 * further than a scraper is.
 */
export const adminSetFuelPrice = onCall({ region: REGION }, async (req) => {
  const ctx = requireAdmin(req);
  const parsed = z
    .object({
      product: z.enum(['petrol', 'diesel']),
      pricePkr: z.number().min(1).max(5000),
      effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse(req.data);
  if (!parsed.success) invalid('Provide a product, a price and an effective date.');
  const { product, pricePkr, effectiveDate } = parsed.data;

  const previous = await loadFuelPrices(true);
  const entry: ConfirmedFuelPrice = {
    product,
    pricePkr,
    effectiveDate,
    confirmations: 1,
    sources: [`admin:${ctx.uid}`],
    confirmedAt: Date.now(),
    stepLimited: false,
    previousPkr: previous[product]?.pricePkr ?? null,
  };

  await db.doc('fuelPrices/current').set({ [product]: entry }, { merge: true });
  await db.doc(`fuelPrices/${effectiveDate}`).set({ [product]: entry, effectiveDate }, { merge: true });
  invalidatePricingCache();
  return { price: entry };
});

/**
 * Clear a zone's freeze by hand.
 *
 * For the case the detector was wrong: a tunnel closure, a power cut, a police
 * cordon — something that really did take half the drivers off the road at
 * once, and that no amount of history can tell apart from a walk-out. An
 * operator who knows what happened can release the hold and let the factor
 * price the shortage honestly.
 */
export const adminClearSupplyFreeze = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const parsed = z.object({ zoneKey: z.string().min(1).max(128).regex(/^[^/]+$/) }).safeParse(req.data);
  if (!parsed.success) invalid('A zone key is required.');

  const ref = db.doc(`${ZONE_COLLECTION}/${parsed.data.zoneKey}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'No such zone.');

  await ref.set({ freeze: null, lastShockAt: null, updatedAt: Date.now() }, { merge: true });
  return { cleared: parsed.data.zoneKey };
});

/** Write the default settings document. Safe to re-run. */
export const seedPricingEngine = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  await db.doc(CONFIG_DOC).set(
    { ...DEFAULT_PRICING_CONFIG, updatedAt: Date.now(), updatedBy: req.auth?.uid ?? null },
    { merge: true },
  );
  invalidatePricingCache();
  return { seeded: true, products: FUEL_PRODUCTS };
});
