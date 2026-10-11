/**
 * The one fare a shared ride has. Not a starting point, not an offer — the price.
 * ----------------------------------------------------------------------------
 * WHY SHARED RIDES STOPPED BEING NEGOTIABLE
 * -----------------------------------------
 * Velocity's booking screen was built around a rider naming their own fare:
 * a stepper, an offer, drivers bidding back, the rider accepting one. That is
 * the right model for a solo ride — one rider, one driver, one deal, and if
 * they cannot agree nobody else is affected.
 *
 * On a shared ride it is the wrong model, and it was quietly killing pools.
 *
 * A pool has a HOST — whoever opened it — and under the old flow that host also
 * owned the fare. So the host could set an offer no driver would take, or haggle
 * one down after riders had already joined. When the drivers refused, the pool
 * did not just lose its fare: it lost its driver, and three or four riders who
 * had committed to a seat went back to square one and had to find a car again.
 * One person's bargaining broke everybody else's ride. A rider who has been
 * through that once does not join a pool again.
 *
 * It was also unanswerable for a joiner. The per-seat tier is a fraction of the
 * host's offer, so "what will this cost me" had no stable answer until the host
 * finished negotiating — and could move afterwards, on a ride they had already
 * agreed to.
 *
 * So: a shared ride has exactly one fare, this module computes it, and nobody —
 * not the host, not a joiner, not the driver — can move it. The driver's choice
 * is the whole job at the stated price: yes or no. Negotiation stays on solo
 * rides, where it costs nobody else anything.
 *
 * HOW THE NUMBER IS ARRIVED AT
 * ----------------------------
 * It is not invented here. Three constraints, in this order:
 *
 *   1. The fare engine's recommendation for the city, category and distance
 *      (`calculateFare`) — the number that reflects what this trip costs to
 *      serve.
 *   2. The market undercut. `compareToMarket` takes the cheapest fresh inDrive
 *      or Yango card for the city and drops us `undercutPct` below it (15% by
 *      default, admin-set). A shared seat is then a further per-seat tier below
 *      THAT, which is where the real saving comes from.
 *   3. The driver floor (`minAcceptableBid`). The undercut never goes through
 *      it. Beating a competitor is worth nothing on a ride no driver will take,
 *      and a pool whose fare no driver accepts is the exact failure this module
 *      exists to prevent.
 *
 * When a city has no usable competitor card the undercut simply does not apply
 * and the engine's own recommendation stands — see `compareToMarket`, which
 * returns the fare unchanged rather than guessing at a competitor's price.
 *
 * WHAT THE RIDER SEES
 * -------------------
 * `fare` is the whole-car price, and `perSeat` says what each person pays once
 * 1, 2, 3 or 4 of them are aboard. Both come from here, so the number on the
 * booking screen, the number on the join screen and the number the driver is
 * offered are the same number by construction rather than by three clients
 * agreeing to compute it the same way.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import { MAX_POOL_RIDERS, poolPerSeatFare, fareBounds } from '../domain/fares';
import { calculateFare, type CityFareConfig, type VehicleCategory } from './fareEngine';
import { loadFareConfigFor } from './cityConfig';
import { comparisonFor } from './marketFunctions';

/** Ride types the app sells → the engine's vehicle categories. */
const RIDE_TO_ENGINE_CAT: Record<string, VehicleCategory> = {
  bike: 'moto',
  auto: 'rickshaw',
  mini: 'mini',
  ac: 'ac_car',
  comfort: 'luxury',
  xl: 'luxury',
};

export interface SharedFareQuote {
  /** The whole-car fare. Fixed: the host cannot raise it and no one can bid on it. */
  fare: number;
  /** What each rider pays at 1/2/3/4 aboard — index 0 is a single rider. */
  perSeat: number[];
  /** The lowest any driver will be asked to accept, for diagnostics. */
  floor: number;
  /** The engine's own answer, before the market undercut. */
  engineFare: number;
  /** Set when a competitor card moved the price; null when none was usable. */
  undercutFrom: number | null;
  /** Which city table priced it, for support questions. */
  cityId: string | null;
}

const haversineKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
};

/** Per-seat ladder for a whole-car fare — what each rider pays at every size. */
function seatLadder(fare: number): number[] {
  return Array.from({ length: MAX_POOL_RIDERS }, (_, i) => poolPerSeatFare(fare, i + 1));
}

/**
 * The fixed fare for a shared ride between these two points.
 *
 * Never throws: a shared ride that cannot be priced cannot be booked, and
 * leaving the rider staring at an error because a city table is missing is
 * worse than falling back to the static base fare for the ride type. Any
 * fallback is logged, because a city quietly running on static fares is a
 * configuration problem somebody needs to see.
 */
export async function sharedRideFare(
  rideType: string,
  pickup: { lat: number; lng: number },
  dropoff: { lat: number; lng: number },
): Promise<SharedFareQuote> {
  const category = RIDE_TO_ENGINE_CAT[rideType] ?? 'mini';
  const distanceKm = Math.max(0.5, haversineKm(pickup, dropoff));
  // The same duration estimate `offeredFareBounds` uses, so a pool and a solo
  // ride over the same road are priced off the same assumption about it.
  const durationMin = Math.max(3, Math.round(distanceKm * 3.5));

  try {
    const cfg: CityFareConfig | null = await loadFareConfigFor(pickup);
    if (cfg) {
      const est = calculateFare(cfg, { category, distanceKm, durationMin });
      const { comparison } = await comparisonFor(
        cfg.cityId,
        category,
        distanceKm,
        durationMin,
        est.recommendedFare,
        est.minAcceptableBid,
      );
      const fare = Math.max(comparison.velocityFare, est.minAcceptableBid);
      return {
        fare,
        perSeat: seatLadder(fare),
        floor: est.minAcceptableBid,
        engineFare: est.recommendedFare,
        undercutFrom: comparison.cheapest?.fare ?? null,
        cityId: cfg.cityId,
      };
    }
    logger.warn('sharedRideFare: no city fare table for pickup', { pickup });
  } catch (e) {
    logger.warn('sharedRideFare: falling back to static bounds', e);
  }

  // No city table at all. The static base for the ride type is a worse answer
  // than the engine's, but it is a real number and it keeps pools bookable.
  const bounds = fareBounds(rideType as Parameters<typeof fareBounds>[0]);
  return {
    fare: bounds.base,
    perSeat: seatLadder(bounds.base),
    floor: bounds.min,
    engineFare: bounds.base,
    undercutFrom: null,
    cityId: null,
  };
}
