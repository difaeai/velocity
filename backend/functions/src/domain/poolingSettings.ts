/**
 * Ride-pooling parameters, admin-editable without a deploy.
 * ----------------------------------------------------------------------------
 * The shared-pool engine (sharedPools/) had these numbers as constants in its
 * source, so moving the candidate radius from 1 km to 5 km meant a functions
 * deploy. They live in `config/poolingSettings` now, read per call and clamped
 * here, so the dashboard's Ride Pooling page can move them while the app runs.
 *
 * TWO RADII, NOT ONE. The owner's spec (2026-11-14) separates them on purpose:
 *
 *   candidateRadiusM  how far away a car may be and still be WORTH SHOWING a
 *                     rider — discovery only, initially 5 km. Being inside it
 *                     qualifies nobody for anything.
 *   matchRadiusM      how far a rider's own pickup and drop-off may sit off a
 *                     car's route and still be ON it. This is what seats them,
 *                     and it stays at 1 km.
 *
 * MODE. `shadow` is the default and is how this shipped: every join is measured
 * against the economic and detour limits below, the verdict is recorded for the
 * dashboard, and the rider is seated either way. Nothing a rider or driver sees
 * changes until an admin sets `live`, which is the owner's instruction — the
 * algorithm proves itself on real bookings before it decides any.
 */
import { db } from '../lib/firebase';

/**
 * `shadow` measures and records but never refuses; `live` refuses a join that
 * fails the limits. Default `shadow` (owner, 2026-11-14).
 */
export type PoolingMode = 'shadow' | 'live';

export interface PoolingSettings {
  mode: PoolingMode;
  /** Discovery only: a car further than this from the rider is not offered. */
  candidateRadiusM: number;
  /** A rider's pickup and drop-off must each sit within this of the car's route. */
  matchRadiusM: number;
  /** Extra road one join may add to the car's whole journey. */
  maxDetourKm: number;
  /** Extra time one join may add, at the city speed fares already assume. */
  maxDetourMin: number;
  /** Every rider in the car must save at least this much of their own solo fare. */
  minRiderSavingPct: number;
  /** A join must leave the car earning at least this many rupees more. */
  minDriverGainPkr: number;
  /** A car with a departure time is asked for this long before it. */
  matchWindowMin: number;
  /** No new booking this close to a timed departure; 0 = no cutoff. */
  bookingCutoffMin: number;
  /** Seats a pool will book. Capped by the car itself (MAX_POOL_RIDERS). */
  maxRiders: number;
  /**
   * Let the engine fit its own distances to what actually happened —
   * `matchRadiusM`, `maxDetourKm` and `maxDetourMin`, nightly, from the ledger
   * (sharedPools/calibrate.ts). Money and mode are never auto-tuned.
   *
   * On by default: these three are the numbers nobody can pick correctly in
   * advance, and 1 km refused the owner's own example by 276 metres. Turn it
   * off to freeze them at whatever they are now.
   */
  autoTune: boolean;
}

/**
 * NOT a setting, by the owner's ruling (2026-11-15). The spec locked the pool
 * when its driver was assigned; this engine keeps filling empty seats until the
 * driver taps Start, and that stays — a seat filled cuts the fare for everyone
 * in the car and pays the driver more. It was briefly a `lockOnDriverAssigned`
 * flag; it was removed rather than left switchable, because a switch that can
 * turn off a decided rule is a way to turn it off by accident. The lock lives
 * in `carOf` (poolStartedAt) and in `placeBid` (assertNotCarryingPool).
 */

/**
 * What the engine did before any of this was configurable, plus the spec's
 * 5 km discovery radius — so writing the settings doc with these values is a
 * no-op, and `shadow` keeps the new limits from refusing anybody.
 */
export const DEFAULT_POOLING: PoolingSettings = {
  mode: 'shadow',
  candidateRadiusM: 5000,
  matchRadiusM: 1000,
  maxDetourKm: 5,
  maxDetourMin: 15,
  minRiderSavingPct: 0.1,
  minDriverGainPkr: 0,
  matchWindowMin: 10,
  bookingCutoffMin: 0,
  maxRiders: 4,
  autoTune: true,
};

/**
 * One number from the doc, or the default when it is missing or unusable.
 * Clamped rather than rejected: a bad value in the database must not be able to
 * stop every shared ride in the country, and the dashboard validates on the way
 * in (see app/(app)/dashboard/pooling).
 */
const setting = (raw: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * The live parameters. Never throws and never returns a partial object: a
 * missing doc, a failed read or a doc full of rubbish all give `DEFAULT_POOLING`,
 * which is the behaviour the engine shipped with.
 */
export async function getPoolingSettings(): Promise<PoolingSettings> {
  const d = DEFAULT_POOLING;
  let snap;
  try {
    snap = await db.doc('config/poolingSettings').get();
  } catch {
    return d;
  }
  if (!snap.exists) return d;
  return {
    // Anything but the exact string 'live' leaves the engine measuring only.
    mode: snap.get('mode') === 'live' ? 'live' : 'shadow',
    candidateRadiusM: Math.round(setting(snap.get('candidateRadiusM'), d.candidateRadiusM, 500, 25_000)),
    matchRadiusM: Math.round(setting(snap.get('matchRadiusM'), d.matchRadiusM, 200, 10_000)),
    maxDetourKm: setting(snap.get('maxDetourKm'), d.maxDetourKm, 0.5, 50),
    maxDetourMin: setting(snap.get('maxDetourMin'), d.maxDetourMin, 1, 180),
    minRiderSavingPct: setting(snap.get('minRiderSavingPct'), d.minRiderSavingPct, 0, 0.9),
    minDriverGainPkr: Math.round(setting(snap.get('minDriverGainPkr'), d.minDriverGainPkr, 0, 10_000)),
    matchWindowMin: Math.round(setting(snap.get('matchWindowMin'), d.matchWindowMin, 0, 240)),
    bookingCutoffMin: Math.round(setting(snap.get('bookingCutoffMin'), d.bookingCutoffMin, 0, 240)),
    maxRiders: Math.round(setting(snap.get('maxRiders'), d.maxRiders, 2, 4)),
    // Only an explicit false turns the fitting off.
    autoTune: snap.get('autoTune') !== false,
  };
}
