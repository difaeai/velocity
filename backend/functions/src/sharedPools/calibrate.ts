/**
 * The engine sets its own distances, once it has seen enough riders.
 * ----------------------------------------------------------------------------
 * The owner's ask (2026-11-15): "shadow mode wali baat — system auto khud ko
 * set kare, data jama hone ke baad, ke kitne km par kya karna chahiye."
 *
 * The three numbers nobody can pick correctly in advance are distances:
 *
 *   matchRadiusM   how far off a car's route a rider may stand and still be
 *                  seated on it
 *   maxDetourKm    how much extra road one more rider may add
 *   maxDetourMin   how much extra time
 *
 * They were round numbers somebody typed. 1 km refused the owner's own example
 * by 276 metres. So they are now fitted to what actually happened, from the two
 * kinds of row the engine writes:
 *
 *   kind 'join'      a rider it priced and judged — with the ROAD detour it
 *                    cost and whether the economics were good
 *   kind 'offRoute'  a rider whose journey was on the route but who stood
 *                    further off it than the radius allowed, and how far
 *
 * Money is NOT auto-tuned. What share of a fare a rider should save and what a
 * driver should earn are the owner's policy, not a number to be read off a
 * distribution. Only geometry is fitted here.
 *
 * ── WHAT KEEPS THIS SAFE ────────────────────────────────────────────────────
 *
 * Widening the radius admits journeys that divert further — so it is only safe
 * because the detour limits are measured on the real road network now
 * (sharedPools/admit.ts). A radius fitted against straight-line detours would
 * have been letting go of the wheel.
 *
 * On top of that: a minimum sample before anything moves, one small step per
 * run so a bad day cannot swing it, a hard ceiling on the radius beyond which a
 * journey is not "on the route" in any useful sense, and every change recorded
 * with the numbers that caused it. Turning `autoTune` off freezes all three.
 */
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db, FieldValue, SCHEDULE_REGION, Timestamp } from '../lib/firebase';
import { DEFAULT_POOLING, getPoolingSettings, type PoolingSettings } from '../domain/poolingSettings';
import { DECISIONS } from './admit';

/** Rows older than this tell us about a city that has since changed. */
export const WINDOW_DAYS = 30;
/** Off-route riders needed before the radius is allowed to move. */
export const MIN_OFFROUTE_SAMPLES = 40;
/** Road-measured good joins needed before a detour limit is allowed to move. */
export const MIN_JOIN_SAMPLES = 40;
/**
 * Most the radius may move in one run. A month of data arriving at once must
 * not be able to jump it from 1 km to 2.5 km overnight.
 */
export const RADIUS_STEP_M = 250;
/**
 * The radius will never be fitted past this, whatever the data says. Beyond it
 * a rider is not standing near the route, they are asking for a different one —
 * and `candidateRadiusM` already offers them the car at its own pickup.
 */
export const RADIUS_CEILING_M = 2500;
/** Share of off-route riders the fitted radius aims to take in. */
export const RADIUS_TARGET = 0.8;
/** Share of good joins the fitted detour limits aim to allow. */
export const DETOUR_TARGET = 0.9;
/** Most a detour limit may move in one run, as a fraction of itself. */
export const DETOUR_STEP = 0.25;

/** One ledger row, as calibration needs it. */
export interface LedgerRow {
  kind?: string;
  ok?: boolean;
  /** Off-route rows: how far off the route the rider stood. */
  offsetM?: number;
  /** Join rows: the road this join cost, when it was road-measured. */
  detourKm?: number;
  detourMin?: number;
  detourSource?: string;
}

export interface Proposal {
  matchRadiusM: number;
  maxDetourKm: number;
  maxDetourMin: number;
  /** Plain-English why, one line per number that moved. */
  reasons: string[];
  /** What it was fitted from. */
  samples: { offRoute: number; goodJoins: number };
}

/** The value at `p` of a sorted-ascending list, nearest-rank. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * What the distances should be, given the rows. Pure: the same rows always give
 * the same answer, which is what makes the applied change reviewable.
 *
 * A number that has too little evidence is returned unchanged, with no reason
 * line — silence here means "not enough data", never "already correct".
 */
export function recommend(rows: LedgerRow[], current: PoolingSettings): Proposal {
  const reasons: string[] = [];

  // ── The radius: follow where riders actually stand ────────────────────────
  // Only riders whose journey was on the route and who were refused for the
  // offset alone, and only those inside the ceiling — someone 8 km off is not
  // evidence about a 1 km radius.
  const offsets = rows
    .filter((r) => r.kind === 'offRoute' && typeof r.offsetM === 'number')
    .map((r) => r.offsetM!)
    .filter((m) => m <= RADIUS_CEILING_M)
    .sort((a, b) => a - b);

  let matchRadiusM = current.matchRadiusM;
  if (offsets.length >= MIN_OFFROUTE_SAMPLES) {
    const want = percentile(offsets, RADIUS_TARGET);
    // Up to the next 100 m, so the number on the page is one a person can read.
    const target = clamp(
      Math.ceil(want / 100) * 100,
      current.matchRadiusM - RADIUS_STEP_M,
      Math.min(RADIUS_CEILING_M, current.matchRadiusM + RADIUS_STEP_M),
    );
    if (target !== current.matchRadiusM) {
      matchRadiusM = target;
      const pct = Math.round(RADIUS_TARGET * 100);
      reasons.push(
        `Match radius ${current.matchRadiusM} m → ${target} m: of ${offsets.length} riders turned away `
        + `for standing off the route, ${pct}% were within ${Math.round(want)} m of it.`,
      );
    }
  }

  // ── The detour limits: what a good join actually costs ────────────────────
  // Road-measured joins only. A straight-line row understates the detour and
  // would fit the limits far too tight; and only joins whose economics passed,
  // because a limit should allow what was worth doing, not what merely happened.
  const good = rows.filter((r) => r.kind === 'join' && r.ok === true && r.detourSource === 'road');
  const km = good.map((r) => r.detourKm ?? 0).sort((a, b) => a - b);
  const min = good.map((r) => r.detourMin ?? 0).sort((a, b) => a - b);

  let maxDetourKm = current.maxDetourKm;
  let maxDetourMin = current.maxDetourMin;
  if (good.length >= MIN_JOIN_SAMPLES) {
    const pct = Math.round(DETOUR_TARGET * 100);
    const fit = (want: number, cur: number, lo: number, hi: number) => {
      const stepped = clamp(want, cur * (1 - DETOUR_STEP), cur * (1 + DETOUR_STEP));
      return Math.round(clamp(stepped, lo, hi) * 10) / 10;
    };
    const wantKm = percentile(km, DETOUR_TARGET);
    const wantMin = percentile(min, DETOUR_TARGET);
    const nextKm = fit(wantKm, current.maxDetourKm, 0.5, 50);
    const nextMin = fit(wantMin, current.maxDetourMin, 1, 180);
    if (nextKm !== current.maxDetourKm) {
      maxDetourKm = nextKm;
      reasons.push(
        `Max detour ${current.maxDetourKm} km → ${nextKm} km: across ${good.length} worthwhile joins, `
        + `${pct}% cost ${wantKm.toFixed(1)} km of road or less.`,
      );
    }
    if (nextMin !== current.maxDetourMin) {
      maxDetourMin = nextMin;
      reasons.push(
        `Max detour ${current.maxDetourMin} min → ${nextMin} min: ${pct}% of those joins cost `
        + `${Math.round(wantMin)} minutes or less.`,
      );
    }
  }

  return {
    matchRadiusM,
    maxDetourKm,
    maxDetourMin,
    reasons,
    samples: { offRoute: offsets.length, goodJoins: good.length },
  };
}

/**
 * Fit the distances to the last `WINDOW_DAYS` of rows and save them. Runs
 * nightly; does nothing at all when `autoTune` is off, when there is not enough
 * evidence, or when nothing moved.
 */
export async function calibrateOnce(nowMs = Date.now()): Promise<Proposal | null> {
  const settings = await getPoolingSettings();
  if (!settings.autoTune) return null;

  const since = Timestamp.fromMillis(nowMs - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db.collection(DECISIONS).where('at', '>=', since).limit(5000).get();
  const proposal = recommend(snap.docs.map((d) => d.data() as LedgerRow), settings);
  if (proposal.reasons.length === 0) return proposal;

  await db.doc('config/poolingSettings').set({
    matchRadiusM: proposal.matchRadiusM,
    maxDetourKm: proposal.maxDetourKm,
    maxDetourMin: proposal.maxDetourMin,
    autoTunedAt: FieldValue.serverTimestamp(),
    autoTunedReasons: proposal.reasons,
    autoTunedSamples: proposal.samples,
  }, { merge: true });
  logger.info('pooling distances re-fitted', { reasons: proposal.reasons, samples: proposal.samples });
  return proposal;
}

/**
 * Nightly, at 03:30 Pakistan time — after the evening commute is in the ledger
 * and before the morning one reads the settings.
 */
export const calibratePooling = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    try {
      await calibrateOnce();
    } catch (error) {
      // Never throws: a failed fit leaves yesterday's numbers in place, which
      // are the ones the engine has been running on all day anyway.
      logger.warn('pooling calibration failed', { error });
    }
  },
);

/** The defaults, for a page that wants to show what "unfitted" looks like. */
export const UNFITTED = {
  matchRadiusM: DEFAULT_POOLING.matchRadiusM,
  maxDetourKm: DEFAULT_POOLING.maxDetourKm,
  maxDetourMin: DEFAULT_POOLING.maxDetourMin,
};
