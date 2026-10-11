/**
 * Loading the engine's settings, and the believed fuel price, from Firestore.
 * ----------------------------------------------------------------------------
 * Two documents:
 *
 *   adminConfig/pricingEngine   the settings, admin-editable, partial
 *   fuelPrices/current          what the daily job last confirmed
 *
 * Both are read on paths that price a ride, so both are cached per instance
 * with a short TTL — the same pattern and the same reasoning as
 * `fare/fareFunctions.ts:loadCityConfig`. A warm instance prices a fare with no
 * extra Firestore read at all; a cold one pays two.
 *
 * WHY THE STORED SETTINGS ARE MERGED, NOT READ
 * --------------------------------------------
 * `adminConfig/pricingEngine` holds whatever an admin has chosen to override
 * and nothing else. If it were read as the whole config, adding a setting in
 * code would make every existing deployment read `undefined` for it — and a
 * missing `maxMultiplier` is not a missing cap, it is an uncapped multiplier.
 * So defaults are the base, the stored document is layered over it, and a new
 * setting ships with its default already in force.
 *
 * Nothing here ever throws. A pricing engine that cannot read its own settings
 * must fall back to the defaults and let the ride be priced, not refuse to
 * quote a fare.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import {
  DEFAULT_PRICING_CONFIG,
  FUEL_PRODUCTS,
  type ConfirmedFuelPrice,
  type FuelProduct,
  type PricingEngineConfig,
} from './types';

export const CONFIG_DOC = 'adminConfig/pricingEngine';
export const FUEL_DOC = 'fuelPrices/current';

/** Collection holding one document per zone of live pricing state. */
export const ZONE_COLLECTION = 'pricingZones';

/** Collection the fare engine already reads its multiplier from. */
export const SURGE_COLLECTION = 'surge';

/** Per-driver presence log, for churn and for queue diagnostics. */
export const PRESENCE_COLLECTION = 'driverPresence';

/**
 * 60 seconds. Short enough that an admin moving the cap sees it take effect
 * while they are still looking at the screen, long enough that a busy instance
 * is not re-reading the same document for every quote.
 */
const CACHE_TTL_MS = 60_000;

let configCache: { value: PricingEngineConfig; at: number } | null = null;
let fuelCache: { value: Partial<Record<FuelProduct, ConfirmedFuelPrice>>; at: number } | null = null;

/** Replaces top-level sections wholesale, keeping any key the override omits. */
function mergeConfig(stored: Record<string, unknown> | undefined): PricingEngineConfig {
  const base = DEFAULT_PRICING_CONFIG;
  if (!stored) return base;

  const section = <K extends keyof PricingEngineConfig>(key: K): PricingEngineConfig[K] => {
    const override = stored[key as string];
    if (!override || typeof override !== 'object' || Array.isArray(override)) return base[key];
    return { ...(base[key] as object), ...(override as object) } as PricingEngineConfig[K];
  };

  return {
    fuel: section('fuel'),
    peak: section('peak'),
    integrity: section('integrity'),
    queue: section('queue'),
    dispatch: section('dispatch'),
    updatedAt: typeof stored.updatedAt === 'number' ? stored.updatedAt : base.updatedAt,
    ...(typeof stored.updatedBy === 'string' ? { updatedBy: stored.updatedBy } : {}),
  };
}

export async function loadPricingConfig(force = false): Promise<PricingEngineConfig> {
  if (!force && configCache && Date.now() - configCache.at < CACHE_TTL_MS) {
    return configCache.value;
  }
  try {
    const snap = await db.doc(CONFIG_DOC).get();
    const value = mergeConfig(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
    configCache = { value, at: Date.now() };
    return value;
  } catch (e) {
    logger.warn('pricing config unreadable — using defaults', e);
    return DEFAULT_PRICING_CONFIG;
  }
}

/**
 * The confirmed pump prices, or an empty object.
 *
 * Empty is a perfectly good answer: `fuelFactorFor` reads it as "no price" and
 * leaves the rate card alone, which is the correct behaviour on a day when
 * every source was down.
 */
export async function loadFuelPrices(
  force = false,
): Promise<Partial<Record<FuelProduct, ConfirmedFuelPrice>>> {
  if (!force && fuelCache && Date.now() - fuelCache.at < CACHE_TTL_MS) {
    return fuelCache.value;
  }
  try {
    const snap = await db.doc(FUEL_DOC).get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const value: Partial<Record<FuelProduct, ConfirmedFuelPrice>> = {};
    for (const product of FUEL_PRODUCTS) {
      const entry = data[product];
      if (entry && typeof entry === 'object' && typeof (entry as ConfirmedFuelPrice).pricePkr === 'number') {
        value[product] = entry as ConfirmedFuelPrice;
      }
    }
    fuelCache = { value, at: Date.now() };
    return value;
  } catch (e) {
    logger.warn('fuel prices unreadable — fares will not be fuel-adjusted', e);
    return {};
  }
}

/** Called after a write so the next read does not serve the old value. */
export function invalidatePricingCache(): void {
  configCache = null;
  fuelCache = null;
}

/** `surge/{cityId}_{zone}` — the id `fare/fareFunctions.ts` already builds. */
export const zoneKey = (cityId: string, zone: string): string => `${cityId}_${zone}`;
