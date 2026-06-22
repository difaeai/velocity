/**
 * Server-authoritative fare logic.
 *
 * The browser demo computed fares and the 10% commission on the client, which
 * meant any client could write arbitrary money values. All of that now lives
 * here and is the ONLY place settlements are produced. Clients may *propose* a
 * fare, but the backend validates it against these bounds before accepting.
 */

import { RideType, Settlement } from './types';

/** Platform commission taken from each gross fare. */
export const COMMISSION_RATE = 0.1;

/** Recommended base fare per ride type, in PKR. */
export const BASE_FARES: Record<RideType, number> = {
  bike: 150,
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
 */
export function computeSettlement(grossFare: number, seats: number): Settlement {
  const safeSeats = Math.min(Math.max(Math.trunc(seats) || 1, 1), MAX_SEATS);
  const commission = Math.round(grossFare * COMMISSION_RATE);
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
