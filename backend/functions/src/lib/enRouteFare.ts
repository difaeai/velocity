/**
 * En-route pool pricing — the leg-split.
 * ----------------------------------------------------------------------------
 * When a car carries riders who board and alight at different points, a flat
 * per-seat percentage is simply wrong: a rider who shares 2 km of a 20 km trip
 * has not shared the same thing as a rider who rode the whole way. So the route
 * is cut into LEGS at every boarding and alighting point, and each leg's distance
 * is split equally among whoever is actually in the car for it.
 *
 * That gives every rider a *billable distance* — the distance they are personally
 * responsible for:
 *
 *     billableKm(i) = Σ over legs i is aboard ( legKm / ridersAboard(leg) )   ← shared road
 *                   + detourKm(i)                                             ← theirs alone
 *
 * and their fare is that distance run through `calculateFare` — the very same
 * engine, config and city rates that priced their solo quote on the booking
 * screen. Base fare, included km/minutes, the category minimum and Rs.5 rounding
 * therefore all behave exactly as they do everywhere else in the app, instead of
 * this file inventing a second, subtly different idea of what a fare is.
 *
 * The detour term is the road the driver drives *off* the shared route to reach
 * that one rider's door and come back. Nobody else is carried a metre further by
 * it, so nobody else pays for it. A rider standing on the route pays nothing
 * extra; a rider 3 km off it near the destination pays for the 3 km. Without this
 * the driver would silently eat every detour, and the 4 km drop-off allowance
 * would just be a way to get long free drives.
 *
 * This is "divided among the passengers according to their pickup and drop-off",
 * exactly. It also has four properties, each enforced below and pinned by a test:
 *
 *   1. NOBODY OVERPAYS.        fare(i) ≤ that rider's own solo fare. Always.
 *   2. THE DRIVER NEVER LOSES.  Each extra rider adds a whole base fare while the
 *      route's distance charge is only redistributed, never given away — so the
 *      gross strictly rises. (A flat tier fails this badly: a 0.5 km hop joining a
 *      30 km trip would drop the long rider to 60% and cost the driver hundreds of
 *      rupees for exactly the same drive. See the "danger case" test.)
 *   3. SHARING ONLY EVER HELPS. A rider's fare is non-increasing in the number of
 *      people sharing their legs.
 *   4. THE ADVERTISED TIER IS HONOURED. Riders who booked a normal destination
 *      pool still pay no more than the 60/40/35% the booking screen promised them.
 *
 * The polyline the legs are measured on is supplied by the driver's client (the
 * backend has no Maps key), so property 1 is load-bearing rather than cosmetic:
 * `soloFare` is computed server-side from haversine, and no rider is ever billed
 * above it no matter what shape the client posts.
 */
import { CityFareConfig, VehicleCategory, calculateFare } from '../fare/fareEngine';

/**
 * Minutes per km used to turn a distance into a duration when there is no live
 * traffic estimate. The trip module already prices with this factor
 * (`offeredFareBounds`), and the two MUST agree — otherwise a rider's en-route
 * fare could land above the solo fare the booking screen quoted them.
 */
export const MIN_PER_KM = 3.5;

/** Float slack (metres) when deciding whether a rider is aboard for a leg. */
const EPS_M = 0.5;

export interface RiderSegment {
  uid: string;
  /** Arc position where they get in, metres from the route origin. */
  boardM: number;
  /** Arc position where they get out, metres from the route origin. */
  alightM: number;
  /** How far their pickup sits off the route — the driver detours this far for them. */
  pickupOffsetM: number;
  /** How far their drop-off sits off the route. */
  dropoffOffsetM: number;
  /** Server-computed fare for this rider's own pickup → drop-off, riding alone. */
  soloFare: number;
  /**
   * Ceiling from the advertised pool tier, for riders who booked a destination
   * pool. Null for en-route riders, who were never quoted a tier.
   */
  tierCap?: number | null;
}

export interface Leg {
  fromM: number;
  toM: number;
  km: number;
  aboard: string[];
}

export interface SplitResult {
  /** uid → fare in PKR. */
  fares: Record<string, number>;
  /** uid → the distance that fare was computed from, for the receipt. */
  billableKm: Record<string, number>;
  /** What the driver collects in total. */
  driverGross: number;
  /** Every leg, for the audit trail written onto the trip. */
  legs: Leg[];
  /** Route distance nobody was aboard for — the driver's own dead-head. */
  unpaidM: number;
}

/** Price a billable distance through the app's one and only fare engine. */
function fareForKm(cfg: CityFareConfig, category: VehicleCategory, km: number): number {
  const distanceKm = Math.max(0, km);
  return calculateFare(cfg, {
    category,
    distanceKm,
    durationMin: distanceKm * MIN_PER_KM,
  }).recommendedFare;
}

/**
 * Split the route across riders by the legs each of them is actually in the car
 * for. Pure; every input is already server-validated.
 */
export function splitEnRouteFares(
  riders: RiderSegment[],
  cfg: CityFareConfig,
  category: VehicleCategory,
): SplitResult {
  if (riders.length === 0) {
    return { fares: {}, billableKm: {}, driverGross: 0, legs: [], unpaidM: 0 };
  }

  // Cut the route at every boarding and alighting point. Between two adjacent
  // cuts the set of people in the car cannot change, so the leg is the largest
  // stretch over which an equal split is meaningful.
  const cuts = Array.from(new Set(riders.flatMap((r) => [r.boardM, r.alightM]))).sort(
    (a, b) => a - b,
  );

  const legs: Leg[] = [];
  let unpaidM = 0;

  for (let i = 0; i < cuts.length - 1; i += 1) {
    const fromM = cuts[i]!;
    const toM = cuts[i + 1]!;
    const spanM = toM - fromM;
    if (spanM <= EPS_M) continue;

    const aboard = riders
      .filter((r) => r.boardM <= fromM + EPS_M && r.alightM >= toM - EPS_M)
      .map((r) => r.uid);

    if (aboard.length === 0) {
      // A gap between one rider getting out and the next getting in. The driver
      // covers it, exactly as they cover the drive to the first pickup today.
      unpaidM += spanM;
      continue;
    }

    legs.push({ fromM, toM, km: spanM / 1000, aboard });
  }

  // Each rider's share of the road: every leg they were aboard for, divided by
  // how many of them were aboard for it.
  const billableKm: Record<string, number> = {};
  for (const r of riders) {
    // The detour to this rider's door and back is theirs alone from the start.
    billableKm[r.uid] = (r.pickupOffsetM + r.dropoffOffsetM) / 1000;
  }
  for (const leg of legs) {
    const each = leg.km / leg.aboard.length;
    for (const uid of leg.aboard) billableKm[uid] = (billableKm[uid] ?? 0) + each;
  }

  const fares: Record<string, number> = {};
  for (const r of riders) {
    // Priced by the same engine as every other fare in the app.
    const metered = fareForKm(cfg, category, billableKm[r.uid] ?? 0);

    // INVARIANT 1 — never above what they would have paid riding alone. This is
    // also what makes a doctored client polyline unable to overcharge anyone.
    let fare = Math.min(metered, r.soloFare);

    // INVARIANT 4 — a destination-pool rider never pays above the tier the
    // booking screen promised them, even when the leg maths lands higher.
    if (typeof r.tierCap === 'number' && r.tierCap > 0) {
      fare = Math.min(fare, r.tierCap);
    }

    fares[r.uid] = fare;
  }

  const driverGross = Object.values(fares).reduce((a, b) => a + b, 0);

  return { fares, billableKm, driverGross, legs, unpaidM };
}

/**
 * INVARIANT 2 — the driver must never earn less for driving the same route.
 *
 * The split cannot violate this on its own: each extra rider brings a fresh base
 * fare, while the route's distance charge is redistributed rather than given
 * away. But the *tier cap* is an outside promise, not a product of the leg maths,
 * so a pathological set of caps could in principle drag the gross below what the
 * driver already had. Rather than reason about when, every place that adds a
 * rider checks this and refuses the match if it fails. A driver is never worse
 * off for having said yes.
 */
export function driverIsNotWorseOff(grossBefore: number, grossAfter: number): boolean {
  return grossAfter >= grossBefore;
}
