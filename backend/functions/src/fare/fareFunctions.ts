import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  CityFareConfig, TripInput, VehicleCategory,
  calculateFare, validateBid, calculatePoolingSplit,
  DEFAULT_ISLAMABAD_RAWALPINDI, DEFAULT_KARACHI,
} from './fareEngine';
import { comparisonFor } from './marketFunctions';
import { sharedRideFare } from './sharedRideFare';
import { fareCityIdsFor, loadFareConfigFor } from './cityConfig';
import { loadFuelPrices, loadPricingConfig } from '../pricing/config';
import { describeFuelAdjustment, fuelFactorFor, withFuelAdjustedRates } from '../pricing/fuel';
import { riderPeakLabel } from '../pricing/peak';
import { peakFactorForZone } from '../pricing/zoneFactor';

const REGION = 'asia-south1';
const db = () => getFirestore();

// ── Config cache (5 min TTL — reduces Firestore reads on hot instances) ──────

const CACHE_TTL_MS = 5 * 60 * 1000;
const configCache  = new Map<string, { cfg: CityFareConfig; at: number }>();

/**
 * The stored card, cached. Deliberately NOT fuel-adjusted: the cache would then
 * hold a fare that was right five minutes ago at a price that has since been
 * re-notified, and the whole point of deriving fuel on read is that it cannot
 * go stale. `loadCityConfig` layers fuel on top of this, outside the cache.
 */
async function loadStoredCityConfig(cityId: string): Promise<CityFareConfig> {
  const hit = configCache.get(cityId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cfg;

  const snap = await db().collection('fareConfig').doc(cityId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `No fare config for city: ${cityId}`);
  }
  const cfg = snap.data() as CityFareConfig;
  configCache.set(cityId, { cfg, at: Date.now() });
  return cfg;
}

/**
 * The rates this city is charging today, fuel included.
 *
 * The mirror of `fare/cityConfig.ts:loadFareConfigFor` for the callables, which
 * are handed a `cityId` rather than a coordinate. Both apply the same fuel
 * factor from the same confirmed price, so a quote from the booking screen and
 * a quote from `createTrip` cannot disagree about what a kilometre costs.
 */
async function loadCityConfig(cityId: string): Promise<CityFareConfig> {
  const stored = await loadStoredCityConfig(cityId);
  try {
    const [pricing, prices] = await Promise.all([loadPricingConfig(), loadFuelPrices()]);
    return withFuelAdjustedRates(stored, prices, pricing.fuel).config;
  } catch {
    return stored;
  }
}

// ── Input parsing ─────────────────────────────────────────────────────────────

function parseTrip(data: Record<string, unknown>): { cityId: string; trip: TripInput } {
  const { cityId, category, distanceKm, durationMin, waitMin, surgeMultiplier } = data ?? {};
  if (typeof cityId !== 'string' || !cityId) {
    throw new HttpsError('invalid-argument', 'cityId required');
  }
  if (typeof distanceKm !== 'number' || distanceKm <= 0 || distanceKm > 500) {
    throw new HttpsError('invalid-argument', 'distanceKm must be 0-500');
  }
  if (typeof durationMin !== 'number' || durationMin <= 0 || durationMin > 600) {
    throw new HttpsError('invalid-argument', 'durationMin must be 0-600');
  }
  return {
    cityId,
    trip: {
      category: (category as VehicleCategory) ?? 'mini',
      distanceKm: distanceKm as number,
      durationMin: durationMin as number,
      waitMin: typeof waitMin === 'number' ? waitMin : undefined,
      surgeMultiplier: typeof surgeMultiplier === 'number' ? surgeMultiplier : undefined,
    },
  };
}

// ── Surge lookup (server-side only — never trust client surge) ────────────────

/**
 * The zone's peak factor, as written by `pricing/engine.ts` once a minute.
 *
 * A thin wrapper over `pricing/zoneFactor.ts`, which owns the expiry check, the
 * ceiling clamp and the never-throw guarantee — this file, pricing/functions.ts
 * and fare/sharedRideFare.ts all read the same document and had begun growing
 * their own copies of those guards, which is how one of them ends up serving a
 * stale multiplier for ever while the others do not.
 *
 * What stays here is the one thing specific to these callables: the client
 * supplies a GEOHASH and never a multiplier. The number itself always comes
 * from the server's own document.
 */
async function getZoneSurge(cityId: string, geohash?: string): Promise<number> {
  return (await peakFactorForZone(cityId, geohash)).multiplier;
}

// ── Callable endpoints ────────────────────────────────────────────────────────

export const getFareEstimate = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { cityId, trip } = parseTrip(req.data as Record<string, unknown>);
  const cfg = await loadCityConfig(cityId);
  trip.surgeMultiplier = await getZoneSurge(cityId, req.data?.geohash as string);
  const est = calculateFare(cfg, trip);

  // Hold the engine's answer against what inDrive and Yango charge, and come in
  // under the cheaper of them. This is the authoritative copy of that rule —
  // the booking screen previews the same maths, but this is the number that
  // counts. With no verified competitor rates for the city the comparison is
  // unavailable and the engine's fare stands untouched.
  const { comparison } = await comparisonFor(
    cityId, trip.category, trip.distanceKm, trip.durationMin,
    est.recommendedFare, est.minAcceptableBid,
  );

  // Why this fare is what it is, in the same payload as the number. A rider
  // being charged a peak factor is owed the reason next to the price, and a
  // rider who is NOT gets `label: null` and sees no badge at all.
  const pricing = await loadPricingConfig();
  const fuelPrices = await loadFuelPrices();
  const fuel = fuelFactorFor(trip.category, fuelPrices, pricing.fuel);

  return {
    ...est,
    recommendedFare: comparison.available ? comparison.velocityFare : est.recommendedFare,
    peak: {
      multiplier: est.surgeApplied,
      label: riderPeakLabel(est.surgeApplied),
      maxMultiplier: Math.min(pricing.peak.maxMultiplier, cfg.surge.maxMultiplier),
    },
    fuel: {
      note: describeFuelAdjustment(fuel),
      pricePkr: fuel.pricePkr,
      product: fuel.product,
    },
    market: {
      available: comparison.available,
      competitors: comparison.competitors,
      cheapest: comparison.cheapest,
      targetFare: comparison.targetFare,
      savings: comparison.savings,
      savingsPct: comparison.savingsPct,
      guaranteeMet: comparison.guaranteeMet,
      engineFare: comparison.engineFare,
    },
  };
});

/**
 * The rate card the rider should be priced against, with today's fuel in it.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IS NOT `getFareEstimate`
 * ---------------------------------------------------
 * The booking screen priced riders from `fareConfig/{CITY_ID}` read straight
 * out of Firestore, and ran the maths in the app's own copy of the engine. That
 * document is deliberately never fuel-adjusted — `pricing/fuel.ts` derives the
 * adjustment on read and leaves the stored card as the human authored it — so
 * the screen the rider actually uses was pricing off the un-adjusted table.
 * The pricing engine moved what the server charges and validates, and left what
 * the rider was shown exactly where it had always been.
 *
 * It could not simply call `getFareEstimate` instead. That callable prices ONE
 * class for ONE trip, and the booking screen prices every class at once so the
 * rider can compare the tiles, re-pricing them all each time they change the
 * route. Five callables per tap on a screen that is currently instant is not a
 * trade worth making — the market-rates read a few lines above says the same
 * thing about its own data for the same reason.
 *
 * So the server hands over the adjusted CARD and the app keeps doing the
 * arithmetic. One call per route, every class correct, and three things fixed
 * at once:
 *
 *  · FUEL REACHES THE RIDER. A notified price revision moves the displayed
 *    fare the same morning it moves the charged one.
 *  · THE DISPLAY/VALIDATION SEAM CLOSES. `offeredFareBounds` and
 *    `minAcceptableBid` are computed from the adjusted card server-side. While
 *    the app priced from the un-adjusted one, a fuel price ABOVE the configured
 *    baseline meant the rider's auto-filled offer could fall under the server's
 *    floor and be clamped up — a rider charged more than the screen showed.
 *    Today's pump price sits below baseline, so rates are cut and the server
 *    comes in under the display, which is why nothing has surfaced yet. It
 *    would have flipped the day fuel rose past the baseline.
 *  · THE CITY IS RESOLVED FROM THE PICKUP. The screen hardcoded
 *    `islamabad_rawalpindi` while every server path resolves the city from
 *    coordinates, so a Karachi rider was shown Islamabad's rates and charged
 *    Karachi's.
 *
 * `peak` and `fuel` ride along because the screen needs them for the same
 * reason it needs the card, and a second round-trip for two labels would be
 * silly. The rider-facing explanation of both is in ui/PriceNotice.tsx.
 */
export const getFareContext = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');

  const lat = Number((req.data as Record<string, unknown>)?.lat);
  const lng = Number((req.data as Record<string, unknown>)?.lng);
  const hasPickup = Number.isFinite(lat) && Number.isFinite(lng);
  const pickup = hasPickup ? { lat, lng } : null;

  const cityId = fareCityIdsFor(pickup)[0]!;
  // The fuel-adjusted card, through the one function every priced path loads
  // its rates with — so the rider is shown the table the trip will be created
  // from, not a second opinion about it.
  const config = (await loadFareConfigFor(pickup)) ?? await loadCityConfig(cityId);

  const pricing = await loadPricingConfig();
  const fuelPrices = await loadFuelPrices();

  // A category has to be named to describe fuel, because the fuel SHARE differs
  // per class — a rickshaw's rate is nearly all fuel, a luxury car's is mostly
  // the car. 'mini' is the screen's default selection.
  const category = (((req.data as Record<string, unknown>)?.category as VehicleCategory) ?? 'mini');
  const fuel = fuelFactorFor(category, fuelPrices, pricing.fuel);

  const zone = hasPickup
    ? await peakFactorForZone(cityId, (req.data as Record<string, unknown>)?.geohash as string | undefined)
    : { multiplier: 1 };

  return {
    cityId,
    config,
    /**
     * The multiplier the app must pass into `calculateFare` as
     * `surgeMultiplier`. Without it the app would price at 1.0 and the server
     * would validate at the zone's real factor — the same seam again.
     */
    peak: {
      multiplier: zone.multiplier,
      label: riderPeakLabel(zone.multiplier),
      maxMultiplier: Math.min(pricing.peak.maxMultiplier, config.surge.maxMultiplier),
    },
    fuel: {
      note: describeFuelAdjustment(fuel),
      pricePkr: fuel.pricePkr,
      product: fuel.product,
    },
  };
});

export const submitBid = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { cityId, trip } = parseTrip(req.data as Record<string, unknown>);
  const bidAmount = Number(req.data?.bidAmount);
  const cfg = await loadCityConfig(cityId);
  trip.surgeMultiplier = await getZoneSurge(cityId, req.data?.geohash as string);

  const result = validateBid(cfg, trip, bidAmount);
  if (!result.valid) return { accepted: false, ...result };

  const rideRef = await db().collection('rideRequests').add({
    passengerId:  req.auth.uid,
    cityId,
    category:     trip.category,
    distanceKm:   trip.distanceKm,
    durationMin:  trip.durationMin,
    bidAmount,
    status:       'open',
    geohash:      req.data?.geohash ?? null,
    createdAt:    Date.now(),
  });

  return { accepted: true, rideRequestId: rideRef.id, ...result };
});

export const getPoolingQuote = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { cityId, trip } = parseTrip(req.data as Record<string, unknown>);
  const detours: number[] = Array.isArray(req.data?.riderDetourMinutes)
    ? (req.data.riderDetourMinutes as unknown[]).map(Number)
    : [];
  if (detours.length < 2 || detours.length > 4 || detours.some((d) => !Number.isFinite(d) || d < 0)) {
    throw new HttpsError('invalid-argument', 'riderDetourMinutes must be 2-4 non-negative numbers');
  }
  const cfg = await loadCityConfig(cityId);
  trip.surgeMultiplier = await getZoneSurge(cityId, req.data?.geohash as string);
  return calculatePoolingSplit(cfg, trip, detours);
});

/**
 * The one fare a shared ride between these two points costs.
 *
 * The booking screen shows this number and no stepper: a shared ride has a
 * price, not an opening offer. `createTrip` computes the same thing from the
 * same function when the ride is actually booked, so what the rider was shown
 * and what the driver is offered cannot drift apart — and a client that sends a
 * different number is simply ignored. See fare/sharedRideFare.
 */
export const getSharedRideFare = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const d = (req.data ?? {}) as Record<string, unknown>;
  const rideType = typeof d.rideType === 'string' ? d.rideType : 'mini';
  const pickup = d.pickup as { lat?: unknown; lng?: unknown } | undefined;
  const dropoff = d.dropoff as { lat?: unknown; lng?: unknown } | undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const pLat = num(pickup?.lat), pLng = num(pickup?.lng);
  const dLat = num(dropoff?.lat), dLng = num(dropoff?.lng);
  if (pLat === null || pLng === null || dLat === null || dLng === null) {
    throw new HttpsError('invalid-argument', 'pickup and dropoff coordinates are required.');
  }

  const quote = await sharedRideFare(
    rideType,
    { lat: pLat, lng: pLng },
    { lat: dLat, lng: dLng },
  );
  return {
    fare: quote.fare,
    perSeat: quote.perSeat,
    /** What the other apps would have charged, when we know. Never invented. */
    comparedTo: quote.undercutFrom,
    cityId: quote.cityId,
  };
});

/** Admin-only: write default configs for ISB/RWP and Karachi. */
export const seedFareConfig = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const token = await req.auth.token;
  if (token.role !== 'admin') throw new HttpsError('permission-denied', 'Admins only');

  const batch = db().batch();
  const isb = { ...DEFAULT_ISLAMABAD_RAWALPINDI, updatedAt: Date.now() };
  const khi = { ...DEFAULT_KARACHI, updatedAt: Date.now() };
  batch.set(db().collection('fareConfig').doc(isb.cityId), isb);
  batch.set(db().collection('fareConfig').doc(khi.cityId), khi);
  await batch.commit();
  // Bust cache
  configCache.delete(isb.cityId);
  configCache.delete(khi.cityId);
  return { seeded: [isb.cityId, khi.cityId] };
});
