import type { Trip } from '../domain/types';

type Rates = { poolLeaveRate: number; poolLeaveArrivedRate: number };

/**
 * What leaving a shared pool's car costs this rider right now — the backend's
 * rule (trips/poolLeave): free before a driver accepts, or when somebody else's
 * leaving raised their share; otherwise a share of their OWN fare.
 */
export function poolLeaveRate(t: Trip, uid: string | undefined, rates: Rates): number {
  if (t.status === 'requested' || (uid && t.poolFreeLeave?.[uid])) return 0;
  return t.status === 'arrived' || t.status === 'in_progress' ? rates.poolLeaveArrivedRate : rates.poolLeaveRate;
}

export function poolLeaveFee(t: Trip, uid: string | undefined, rates: Rates): number {
  const fare = t.poolFares?.[uid ?? ''] ?? t.poolPerSeatFare ?? t.fare ?? t.offeredFare;
  return Math.round(fare * poolLeaveRate(t, uid, rates));
}
