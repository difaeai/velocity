/**
 * Server-authoritative fare logic.
 *
 * The browser demo computed fares and the 10% commission on the client, which
 * meant any client could write arbitrary money values. All of that now lives
 * here and is the ONLY place settlements are produced. Clients may *propose* a
 * fare, but the backend validates it against these bounds before accepting.
 */

import { RideType, Settlement } from './types';

/**
 * Platform commission taken from each gross fare — the fallback only.
 *
 * The live figure is admin-set on `config/commissionSettings` and every
 * settlement passes it in; this constant is what applies when no config exists
 * at all. Kept in step with `DEFAULT_COMMISSION.rate` in ./commission.ts.
 */
export const COMMISSION_RATE = 0.05;

/** Recommended base fare per ride type, in PKR. */
export const BASE_FARES: Record<RideType, number> = {
  bike: 100,
  auto: 250,
  mini: 400,
  ac: 550,
  comfort: 750,
  xl: 1100,
};

/** A passenger offer must sit within these multiples of the base fare. */
export const MIN_BID_FACTOR = 0.7;
export const MAX_BID_FACTOR = 3.0;

/** Maximum passengers that can share a pooled ride. */
export const MAX_SEATS = 4;

/**
 * Pool rides — per-seat fare as a share of the solo fare, by total riders.
 * 2 riders → each pays 60% · 3 → 45% · 4 → 35%. Every rider saves versus
 * riding alone, and the driver's gross must grow with EVERY extra stop
 * (perSeat × riders): 100% → 120% → 135% → 140%. The third tier used to be 40%,
 * which made three riders worth exactly as much as two (120% both ways), so a
 * driver had every reason to refuse the third person. Mirrors POOL_TIERS on
 * the mobile booking screen.
 */
export const MAX_POOL_RIDERS = 4;
const POOL_SEAT_PCT: Record<number, number> = { 1: 1, 2: 0.6, 3: 0.45, 4: 0.35 };

export function poolPerSeatFare(soloFare: number, riders: number): number {
  const n = Math.min(Math.max(Math.trunc(riders) || 1, 1), MAX_POOL_RIDERS);
  return Math.ceil(soloFare * (POOL_SEAT_PCT[n] ?? 1));
}

export interface FareBounds {
  base: number;
  min: number;
  max: number;
}

export function fareBounds(rideType: RideType): FareBounds {
  const base = BASE_FARES[rideType];
  return {
    base,
    min: Math.round(base * MIN_BID_FACTOR),
    max: Math.round(base * MAX_BID_FACTOR),
  };
}

/** Whether a proposed fare is acceptable for the given ride type. */
export function isValidOfferedFare(rideType: RideType, fare: number): boolean {
  if (!Number.isFinite(fare) || !Number.isInteger(fare) || fare <= 0) {
    return false;
  }
  const { min, max } = fareBounds(rideType);
  return fare >= min && fare <= max;
}

/**
 * Compute the canonical money breakdown for a completed trip. This is the
 * single source of truth for revenue, commission and driver payout.
 * `rate` comes from config/commissionSettings (admin dashboard); the
 * COMMISSION_RATE constant is only the fallback when no config exists.
 */
export function computeSettlement(grossFare: number, seats: number, rate: number = COMMISSION_RATE): Settlement {
  const safeSeats = Math.min(Math.max(Math.trunc(seats) || 1, 1), MAX_SEATS);
  const safeRate = Number.isFinite(rate) && rate > 0 && rate <= 0.5 ? rate : COMMISSION_RATE;
  const commission = Math.round(grossFare * safeRate);
  const driverPayout = grossFare - commission;
  const passengerShare = Math.round(grossFare / safeSeats);
  return {
    grossFare,
    commission,
    driverPayout,
    passengerShare,
    seats: safeSeats,
  };
}
