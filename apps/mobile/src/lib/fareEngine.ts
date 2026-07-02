/**
 * Velocity Fare Engine — pure calculation logic (no Firebase dependency).
 * Used server-side in Cloud Functions AND copied to mobile for instant
 * client-side fare previews without a network call.
 *
 * Config lives in Firestore: fareConfig/{cityId}
 * All money values are integer PKR. Round at the end, never mid-calc.
 */

export type VehicleCategory = 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury';

export interface CategoryRates {
  /** Base fare in PKR, includes `includedKm` and `includedMin` */
  base: number;
  includedKm: number;
  includedMin: number;
  perKm: number;
  perMin: number;
  /** Absolute minimum fare regardless of distance */
  minFare: number;
  /** Lowest acceptable effective per-km rate for a bid (driver protection) */
  bidFloorPerKm: number;
  /** Free wait minutes before paid waiting kicks in */
  freeWaitMin: number;
  /** Paid waiting charge per minute after free window */
  waitPerMin: number;
}

export interface CityFareConfig {
  cityId: string;
  currency: 'PKR';
  categories: Record<VehicleCategory, CategoryRates>;
  surge: {
    enabled: boolean;
    /** Hard cap so surge never gets abusive, e.g. 1.8 */
    maxMultiplier: number;
  };
  pooling: {
    enabled: boolean;
    /** Fraction of solo fare each pooled rider pays, keyed by seat count */
    perRiderFactor: Record<number, number>;
    /** Max extra detour minutes before a rider gets a detour discount */
    maxDetourMin: number;
    /** Discount per extra detour-minute (fraction of that rider's fare) */
    detourDiscountPerMin: number;
  };
  commission: {
    /** Platform take as a fraction, e.g. 0.07 = 7% */
    rate: number;
    flatFee: number;
  };
  updatedAt: number;
}

export interface TripInput {
  category: VehicleCategory;
  distanceKm: number;
  durationMin: number;
  waitMin?: number;
  surgeMultiplier?: number;
}

export interface FareEstimate {
  category: VehicleCategory;
  recommendedFare: number;
  minAcceptableBid: number;
  suggestedMaxBid: number;
  surgeApplied: number;
  breakdown: {
    base: number;
    distanceCharge: number;
    timeCharge: number;
    waitCharge: number;
    subtotal: number;
  };
}

export interface PoolingQuote {
  riders: number;
  soloFare: number;
  perRiderFare: number[];
  totalCollected: number;
  driverGross: number;
  driverNet: number;
  driverUpliftVsSolo: number;
}

// ── Default config — Islamabad / Rawalpindi ──────────────────────────────────
// Anchored to mid-2026 market: Yango ISB Comfort Rs.190 min / 17/km / 8/min.
// 10% below Yango AC tier is the target positioning for Velocity.

export const DEFAULT_ISLAMABAD_RAWALPINDI: CityFareConfig = {
  cityId: 'islamabad_rawalpindi',
  currency: 'PKR',
  categories: {
    moto:     { base: 60,  includedKm: 1.5, includedMin: 4, perKm: 14, perMin: 3,  minFare: 100, bidFloorPerKm: 12, freeWaitMin: 5, waitPerMin: 3  },
    rickshaw: { base: 80,  includedKm: 1.5, includedMin: 4, perKm: 16, perMin: 4,  minFare: 130, bidFloorPerKm: 14, freeWaitMin: 5, waitPerMin: 4  },
    mini:     { base: 120, includedKm: 1.5, includedMin: 5, perKm: 26, perMin: 6,  minFare: 200, bidFloorPerKm: 22, freeWaitMin: 5, waitPerMin: 6  },
    ac_car:   { base: 160, includedKm: 1.5, includedMin: 5, perKm: 34, perMin: 8,  minFare: 280, bidFloorPerKm: 30, freeWaitMin: 5, waitPerMin: 8  },
    luxury:   { base: 300, includedKm: 1.5, includedMin: 5, perKm: 60, perMin: 12, minFare: 600, bidFloorPerKm: 55, freeWaitMin: 8, waitPerMin: 12 },
  },
  surge: { enabled: true, maxMultiplier: 1.8 },
  pooling: {
    enabled: true,
    perRiderFactor: { 2: 0.65, 3: 0.50, 4: 0.42 },
    maxDetourMin: 8,
    detourDiscountPerMin: 0.02,
  },
  commission: { rate: 0.07, flatFee: 0 },
  updatedAt: Date.now(),
};

export const DEFAULT_KARACHI: CityFareConfig = {
  ...DEFAULT_ISLAMABAD_RAWALPINDI,
  cityId: 'karachi',
  categories: {
    moto:     { ...DEFAULT_ISLAMABAD_RAWALPINDI.categories.moto,     perKm: 13, bidFloorPerKm: 11 },
    rickshaw: { base: 80, includedKm: 1.7, includedMin: 5, perKm: 16, perMin: 6,  minFare: 100, bidFloorPerKm: 14, freeWaitMin: 5, waitPerMin: 6  },
    mini:     { ...DEFAULT_ISLAMABAD_RAWALPINDI.categories.mini,     perKm: 24, bidFloorPerKm: 20 },
    ac_car:   { ...DEFAULT_ISLAMABAD_RAWALPINDI.categories.ac_car,   perKm: 31, bidFloorPerKm: 27 },
    luxury:   { ...DEFAULT_ISLAMABAD_RAWALPINDI.categories.luxury,   perKm: 55, bidFloorPerKm: 50 },
  },
  updatedAt: Date.now(),
};

// ── Engine ───────────────────────────────────────────────────────────────────

/** Round to nearest Rs.5 — keeps fares clean and avoids PKR coin issues */
export const round5 = (n: number) => Math.round(n / 5) * 5;

export function calculateFare(cfg: CityFareConfig, trip: TripInput): FareEstimate {
  const r = cfg.categories[trip.category];
  if (!r) throw new Error(`Unknown category: ${trip.category}`);

  const billableKm  = Math.max(0, trip.distanceKm  - r.includedKm);
  const billableMin = Math.max(0, trip.durationMin  - r.includedMin);
  const billableWait= Math.max(0, (trip.waitMin ?? 0) - r.freeWaitMin);

  const distanceCharge = billableKm  * r.perKm;
  const timeCharge     = billableMin * r.perMin;
  const waitCharge     = billableWait* r.waitPerMin;
  const subtotal = Math.max(r.minFare, r.base + distanceCharge + timeCharge + waitCharge);

  const surge = cfg.surge.enabled
    ? Math.min(Math.max(trip.surgeMultiplier ?? 1, 1), cfg.surge.maxMultiplier)
    : 1;

  const recommendedFare  = round5(subtotal * surge);
  const minAcceptableBid = round5(Math.max(r.minFare, trip.distanceKm * r.bidFloorPerKm));
  const suggestedMaxBid  = round5(subtotal * cfg.surge.maxMultiplier);

  return {
    category: trip.category,
    recommendedFare,
    minAcceptableBid,
    suggestedMaxBid,
    surgeApplied: surge,
    breakdown: {
      base: r.base,
      distanceCharge: Math.round(distanceCharge),
      timeCharge:     Math.round(timeCharge),
      waitCharge:     Math.round(waitCharge),
      subtotal:       Math.round(subtotal),
    },
  };
}

export function validateBid(
  cfg: CityFareConfig,
  trip: TripInput,
  bidAmount: number,
): { valid: boolean; reason?: string; minAcceptableBid: number } {
  const est = calculateFare(cfg, trip);
  if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
    return { valid: false, reason: 'INVALID_AMOUNT', minAcceptableBid: est.minAcceptableBid };
  }
  if (bidAmount < est.minAcceptableBid) {
    return { valid: false, reason: 'BELOW_FLOOR', minAcceptableBid: est.minAcceptableBid };
  }
  if (bidAmount > est.suggestedMaxBid * 2) {
    return { valid: false, reason: 'ABOVE_SANITY_CAP', minAcceptableBid: est.minAcceptableBid };
  }
  return { valid: true, minAcceptableBid: est.minAcceptableBid };
}

export function calculatePoolingSplit(
  cfg: CityFareConfig,
  trip: TripInput,
  riderDetourMinutes: number[],
): PoolingQuote {
  if (!cfg.pooling.enabled) throw new Error('Pooling disabled for this city');
  const riders = riderDetourMinutes.length;
  const factor = cfg.pooling.perRiderFactor[riders];
  if (!factor) throw new Error(`No pooling factor for ${riders} riders`);

  const solo = calculateFare(cfg, trip).recommendedFare;

  const perRiderFare = riderDetourMinutes.map((detour) => {
    const extra    = Math.max(0, detour - cfg.pooling.maxDetourMin);
    const discount = Math.min(0.15, extra * cfg.pooling.detourDiscountPerMin);
    return round5(solo * factor * (1 - discount));
  });

  const totalCollected = perRiderFare.reduce((a, b) => a + b, 0);
  const commission     = totalCollected * cfg.commission.rate + cfg.commission.flatFee;
  const driverNet      = Math.round(totalCollected - commission);

  return {
    riders,
    soloFare: solo,
    perRiderFare,
    totalCollected,
    driverGross: totalCollected,
    driverNet,
    driverUpliftVsSolo: +(totalCollected / solo).toFixed(2),
  };
}

export function driverNetEarnings(cfg: CityFareConfig, acceptedFare: number): number {
  return Math.round(acceptedFare * (1 - cfg.commission.rate) - cfg.commission.flatFee);
}
