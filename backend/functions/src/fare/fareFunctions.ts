import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  CityFareConfig, TripInput, VehicleCategory,
  calculateFare, validateBid, calculatePoolingSplit,
  DEFAULT_ISLAMABAD_RAWALPINDI, DEFAULT_KARACHI,
} from './fareEngine';

const REGION = 'asia-south1';
const db = () => getFirestore();

// ── Config cache (5 min TTL — reduces Firestore reads on hot instances) ──────

const CACHE_TTL_MS = 5 * 60 * 1000;
const configCache  = new Map<string, { cfg: CityFareConfig; at: number }>();

async function loadCityConfig(cityId: string): Promise<CityFareConfig> {
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

async function getZoneSurge(cityId: string, geohash?: string): Promise<number> {
  try {
    if (!geohash) return 1.0;
    const zone = geohash.substring(0, 5); // ~5 km cell
    const snap = await db().doc(`surge/${cityId}_${zone}`).get();
    const m    = snap.exists ? Number(snap.data()?.multiplier) : 1.0;
    return Number.isFinite(m) && m >= 1 ? m : 1.0;
  } catch {
    return 1.0;
  }
}

// ── Callable endpoints ────────────────────────────────────────────────────────

export const getFareEstimate = onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  const { cityId, trip } = parseTrip(req.data as Record<string, unknown>);
  const cfg = await loadCityConfig(cityId);
  trip.surgeMultiplier = await getZoneSurge(cityId, req.data?.geohash as string);
  return calculateFare(cfg, trip);
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
