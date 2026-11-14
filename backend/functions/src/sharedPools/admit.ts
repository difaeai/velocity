/**
 * Every pooling verdict, measured and recorded — the shadow-mode ledger.
 * ----------------------------------------------------------------------------
 * The owner's instruction (2026-11-14): the algorithm validates itself on real
 * bookings before it decides any. So `recordAdmission` is called on every join
 * into a shared pool and always writes what the limits said, while `mode`
 * decides whether the engine acts on it:
 *
 *   shadow (default)  the rider is seated whatever the verdict. The dashboard
 *                     shows what `live` WOULD have refused, and on which
 *                     numbers, so the 5 km radius and the fare parameters can
 *                     be judged before they turn anybody away.
 *   live              a failing join is refused with its reason.
 *
 * TWO WRITES, NEITHER ON THE RIDER'S PATH. A row in `poolDecisions` for the
 * detail, and counters on `analytics/pooling` for the dashboard's totals so it
 * never has to read the rows to show an average. Both are fire-and-forget: a
 * failed write must not cost a rider their seat, which is why this returns the
 * verdict first and logs the failure rather than throwing.
 *
 * NO DOCUMENT TRIGGER. Aggregation is an increment on the write, not an
 * onDocumentCreated — one Eventarc trigger in this codebase blocks every
 * functions deploy (see reference_functions_deploy_iam_block).
 */
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import type { PoolingSettings } from '../domain/poolingSettings';
import {
  detourOf,
  poolAdmit,
  type AdmitDecision,
  type PricedRider,
  type RiderGeometry,
} from '../trips/poolPricing';

/** Where the verdicts live; `analytics/pooling` holds the running totals. */
export const DECISIONS = 'poolDecisions';
export const POOLING_ANALYTICS = 'analytics/pooling';

export interface AdmissionContext {
  poolId: string;
  /** The joining rider. */
  uid: string;
  /** Riders already holding a seat, with their own routes and solo fares. */
  aboard: (PricedRider & RiderGeometry)[];
  joiner: PricedRider & RiderGeometry;
  /** What the car collects now, when it is already out. */
  currentGross?: number | null;
  /** Where the car starts from, when it is already out. */
  start?: { lat: number; lng: number } | null;
}

export interface Admission extends AdmitDecision {
  /** True when the engine must refuse: the limits failed AND mode is live. */
  refuse: boolean;
  mode: PoolingSettings['mode'];
}

/**
 * Judge a join, record it, and say whether to refuse. The verdict is computed
 * before anything is written, so a recording failure can never change it.
 */
export async function recordAdmission(
  ctx: AdmissionContext,
  settings: PoolingSettings,
): Promise<Admission> {
  // The FIRST rider in an empty car is not a join: there is nobody to share
  // with, no saving to measure against a tier of one, and no detour — their
  // own journey is the car's route. Judging it compared their whole trip to an
  // empty car and called the difference an 18 km detour, which refused every
  // pool at creation. Nothing to decide, so nothing is recorded either: the
  // dashboard's counters are about combinations, not about first seats.
  if (ctx.aboard.length === 0) {
    return {
      ok: true,
      reason: null,
      joinerFare: ctx.joiner.soloFare,
      gross: ctx.joiner.soloFare,
      driverGain: ctx.joiner.soloFare,
      joinerSavingPct: 0,
      worstSavingPct: 0,
      detourKm: 0,
      detourMin: 0,
      mode: settings.mode,
      refuse: false,
    };
  }
  const geometry = (r: PricedRider & RiderGeometry): RiderGeometry => ({
    uid: r.uid,
    pickup: r.pickup,
    dropoff: r.dropoff,
  });
  const detour = detourOf(ctx.aboard.map(geometry), geometry(ctx.joiner), ctx.start ?? null);
  const decision = poolAdmit(
    ctx.aboard.map(({ uid, soloFare }) => ({ uid, soloFare })),
    { uid: ctx.joiner.uid, soloFare: ctx.joiner.soloFare },
    settings,
    detour,
    ctx.currentGross,
  );
  const admission: Admission = {
    ...decision,
    mode: settings.mode,
    refuse: !decision.ok && settings.mode === 'live',
  };

  // The rider's seat does not wait on the ledger, and never fails because of it.
  void write(ctx, admission, settings).catch((error) => {
    // `error:` not `message:` — the firebase logger overwrites `message`.
    logger.warn('pooling admission not recorded', { poolId: ctx.poolId, error });
  });
  return admission;
}

async function write(ctx: AdmissionContext, a: Admission, settings: PoolingSettings): Promise<void> {
  const riders = ctx.aboard.length + 1;
  await Promise.all([
    db.collection(DECISIONS).add({
      poolId: ctx.poolId,
      uid: ctx.uid,
      at: FieldValue.serverTimestamp(),
      mode: a.mode,
      ok: a.ok,
      refused: a.refuse,
      reason: a.reason,
      riders,
      joinerSoloFare: ctx.joiner.soloFare,
      joinerFare: a.joinerFare,
      gross: a.gross,
      driverGain: a.driverGain,
      joinerSavingPct: a.joinerSavingPct,
      worstSavingPct: a.worstSavingPct,
      detourKm: a.detourKm,
      detourMin: a.detourMin,
      // What the limits were at the time, so a row still means something after
      // an admin moves them.
      limits: {
        candidateRadiusM: settings.candidateRadiusM,
        matchRadiusM: settings.matchRadiusM,
        maxDetourKm: settings.maxDetourKm,
        maxDetourMin: settings.maxDetourMin,
        minRiderSavingPct: settings.minRiderSavingPct,
        minDriverGainPkr: settings.minDriverGainPkr,
      },
    }),
    // Sums and a count, never averages: the dashboard divides, so two writes
    // racing can never leave a mean that was never true of any ride.
    db.doc(POOLING_ANALYTICS).set({
      evaluated: FieldValue.increment(1),
      passed: FieldValue.increment(a.ok ? 1 : 0),
      refused: FieldValue.increment(a.refuse ? 1 : 0),
      wouldRefuse: FieldValue.increment(a.ok ? 0 : 1),
      ridersSum: FieldValue.increment(riders),
      savingPctSum: FieldValue.increment(a.joinerSavingPct),
      savingPkrSum: FieldValue.increment(Math.max(0, ctx.joiner.soloFare - a.joinerFare)),
      driverGainSum: FieldValue.increment(a.driverGain),
      detourKmSum: FieldValue.increment(a.detourKm),
      detourMinSum: FieldValue.increment(a.detourMin),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}
