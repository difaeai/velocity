/**
 * Shared cars with riders on their own stops — the maths that needs no database.
 * ----------------------------------------------------------------------------
 * A shared pool (sharedPools/) is a route, but its riders do not all stand at
 * its first metre and leave at its last: each has their own pickup and drop-off
 * on or near it. Three questions follow, all answered here so every caller —
 * search, booking, the car, leaving it — gets the same answer:
 *
 *   1. Is this journey ON the route? (`routeFit`)
 *   2. In what order does the car collect and drop everyone? (`orderStops`)
 *   3. What does each rider pay? (`priceJoin`, `priceCar`, `priceInOrder`)
 *
 * WHAT A RIDER PAYS — the owner's rule (2026-10-29): your own solo fare, at the
 * car's tier. Alone, PKR 1,000; with one other rider, 550; with two, 450. Each
 * rider's solo fare is their own route's, so two people in one car can pay
 * different amounts, and the driver collects the sum.
 *
 * Two promises sit on top, both pinned by tests:
 *   - NEVER MORE THAN RIDING ALONE. A share rises back up the tiers when someone
 *     leaves ("divided among the rest"), but never past the rider's own solo
 *     fare — the ceiling the join sheet shows before anyone taps. A rider whose
 *     share rose may then leave for free (trips/poolLeave): that is the consent.
 *   - THE DRIVER NEVER LOSES BY A JOIN. With different routes, the tier alone
 *     could let a short-hop rider pull a long rider down to 55% and leave the
 *     car earning less than before. So a joiner tops up whatever the car would
 *     lose — never beyond their own solo fare, and quoted before they join.
 *     `routeFit` only seats riders sharing half the route or more, whose solo
 *     fare always covers it.
 * ----------------------------------------------------------------------------
 */
import { buildCorridor, haversineM, projectToCorridor, type LatLng } from '../lib/corridor';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';

/** A rider has to share at least this much of the route, or it is not their car. */
export const MIN_SHARE_OF_ROUTE = 0.5;

export interface RouteFit {
  /** How far their pickup and drop-off sit off the pool's route. */
  pickupOffsetM: number;
  dropoffOffsetM: number;
  /** Where on the route they get in and out, metres from its start. */
  boardM: number;
  alightM: number;
}

/**
 * Is this journey on the pool's route? Both ends within `radiusM` of the line
 * from the pool's pickup to its drop-off, going the same way, over at least half
 * of it. Two points each within a kilometre of something is not a match — a
 * rider heading the other way stands just as close.
 */
export function routeFit(
  route: { pickup: LatLng; dropoff: LatLng },
  pickup: LatLng,
  dropoff: LatLng,
  radiusM: number,
  /** Least share of the route the journey must cover; 0 asks only "same direction". */
  minShare = MIN_SHARE_OF_ROUTE,
): RouteFit | null {
  const corridor = buildCorridor([route.pickup, route.dropoff]);
  const p = projectToCorridor(corridor, pickup);
  const d = projectToCorridor(corridor, dropoff);
  if (p.offsetM > radiusM || d.offsetM > radiusM) return null;
  if (d.alongM - p.alongM <= Math.max(0, corridor.lengthM * minShare)) return null;
  return { pickupOffsetM: p.offsetM, dropoffOffsetM: d.offsetM, boardM: p.alongM, alightM: d.alongM };
}

export interface Stop {
  uid: string;
  kind: 'pickup' | 'dropoff';
}

/**
 * The order the car collects and drops its riders: the shortest path in which
 * everybody is picked up before they are dropped. Four riders is at most 2,520
 * such orders, so every one is tried rather than guessed at.
 */
export function orderStops(
  riders: { uid: string; pickup: LatLng; dropoff: LatLng }[],
  start?: LatLng | null,
): Stop[] {
  if (riders.length === 0) return [];
  if (riders.length > MAX_POOL_RIDERS + 1) {
    // Never happens in a four-seat car; a cheap, sane order if it ever does.
    return [
      ...riders.map((r) => ({ uid: r.uid, kind: 'pickup' as const })),
      ...riders.map((r) => ({ uid: r.uid, kind: 'dropoff' as const })),
    ];
  }
  const at = (s: Stop): LatLng => {
    const r = riders.find((x) => x.uid === s.uid)!;
    return s.kind === 'pickup' ? r.pickup : r.dropoff;
  };
  let best: Stop[] = [];
  let bestM = Infinity;
  const walk = (path: Stop[], picked: Set<string>, dropped: Set<string>, lengthM: number, here: LatLng | null) => {
    if (lengthM >= bestM) return;
    if (dropped.size === riders.length) {
      best = path;
      bestM = lengthM;
      return;
    }
    for (const r of riders) {
      const next: Stop | null = !picked.has(r.uid)
        ? { uid: r.uid, kind: 'pickup' }
        : !dropped.has(r.uid) ? { uid: r.uid, kind: 'dropoff' } : null;
      if (!next) continue;
      const p = at(next);
      const step = here ? haversineM(here.lat, here.lng, p.lat, p.lng) : 0;
      walk(
        [...path, next],
        next.kind === 'pickup' ? new Set([...picked, r.uid]) : picked,
        next.kind === 'dropoff' ? new Set([...dropped, r.uid]) : dropped,
        lengthM + step,
        p,
      );
    }
  };
  walk([], new Set(), new Set(), 0, start ?? null);
  return best;
}

/** A rider's own stops on a shared pool's car, with their own route's solo fare. */
export interface RiderStops {
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  soloFare: number;
}

/** One rider's money in a shared car: their own route, riding alone. */
export interface PricedRider {
  uid: string;
  soloFare: number;
}

export interface CarPrice {
  /** uid → what they pay now. */
  fares: Record<string, number>;
  /** What the driver collects. */
  gross: number;
}

/**
 * A shared POOL's car, read off its trip: each rider's own solo fare. Riders
 * with no record — joined by invite link, or before this existed — ride the
 * car's own route at its own fare.
 */
export function sharedCarRiders(trip: Record<string, unknown>, members: string[]): PricedRider[] {
  const tripFare = (trip.fare as number | null) ?? (trip.offeredFare as number);
  const solo = (trip.poolSoloFares as Record<string, number> | undefined) ?? {};
  return members.map((uid) => ({ uid, soloFare: solo[uid] ?? tripFare }));
}

const tierOf = (soloFare: number, riders: number) =>
  poolPerSeatFare(soloFare, Math.min(MAX_POOL_RIDERS, Math.max(1, riders)));

const sum = (fares: Record<string, number>) => Object.values(fares).reduce((a, b) => a + b, 0);

/** The car as it now is: everyone at their own tier for its size. */
export function priceCar(riders: PricedRider[]): CarPrice {
  const fares: Record<string, number> = {};
  for (const r of riders) fares[r.uid] = tierOf(r.soloFare, riders.length);
  return { fares, gross: sum(fares) };
}

/**
 * Someone gets in. Everyone already aboard drops to the new tier; the joiner
 * pays their own tier — plus whatever keeps the car from earning less than the
 * `currentGross` it does now, up to their own solo fare. `joinerFare` is the
 * number to quote them before they tap.
 */
export function priceJoin(
  aboard: PricedRider[],
  joiner: PricedRider,
  currentGross?: number | null,
): CarPrice & { joinerFare: number } {
  const before = typeof currentGross === 'number' && currentGross > 0 ? currentGross : priceCar(aboard).gross;
  const fares: Record<string, number> = {};
  for (const r of aboard) fares[r.uid] = tierOf(r.soloFare, aboard.length + 1);
  const tier = tierOf(joiner.soloFare, aboard.length + 1);
  const shortfall = Math.max(0, before - sum(fares) - tier);
  const joinerFare = Math.min(joiner.soloFare, tier + shortfall);
  fares[joiner.uid] = joinerFare;
  return { fares, gross: sum(fares), joinerFare };
}

/**
 * Seat everybody in `riders`, in order, as `priceJoin` would one at a time —
 * which is exactly how bookings become a car, so a booking's estimate and the
 * car's real fare cannot drift apart.
 */
export function priceInOrder(riders: PricedRider[]): CarPrice {
  const aboard: PricedRider[] = [];
  let price: CarPrice = { fares: {}, gross: 0 };
  for (const r of riders) {
    const joined = priceJoin(aboard, r, price.gross);
    price = { fares: joined.fares, gross: joined.gross };
    aboard.push(r);
  }
  return price;
}
