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
import { fetchRouteServerSide, serverRoutingConfigured } from '../lib/routes';
import type { LatLng } from '../lib/corridor';
import {
  detourOf,
  orderedPoints,
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
  /** Whether the detour above came off the road network or the straight line. */
  detourSource: 'road' | 'straight';
  /**
   * The ledger write. Already awaited for a refusal; still in flight for a
   * seated rider, who is not kept waiting on bookkeeping. Callers in the rider's
   * path ignore it; a caller that must know the row landed — a test, a backfill
   * — awaits it. It never rejects.
   */
  recorded: Promise<void>;
}

/**
 * The road a car drives through `points`, in metres and minutes, from Google
 * Routes — or null if the road is not available for any leg.
 *
 * WHY THIS IS NOT OPTIONAL POLISH. The straight-line detour is not a rough
 * version of the road detour; for the shapes this gate exists to judge it is a
 * different number entirely. Measured on OpenStreetMap, a PWD→G-10 rider joining
 * a PWD→F-10 car adds 4.32 km and 6.3 minutes of real road — while the straight
 * line says 0.47 km and 1.6 minutes, because as the crow flies G-10 sits almost
 * on top of the route. That is nine times out, and it is out in the direction
 * that lets a bad detour through: `maxDetourKm: 5` would behave like 45 km.
 *
 * COST. One cached Routes call per leg, in parallel, on the Essentials SKU
 * ($5/1,000 with 10,000 free a month) — and `lib/mapsCache` shares roads across
 * trips and screens, so a pool's own legs are bought once and then reused by
 * every later join on that route. No traffic: `trafficAware` doubles the price
 * for a duration this gate does not read, since the limits are distance and
 * free-flow minutes.
 *
 * ALL OR NOTHING. If one leg is unavailable the whole measurement returns null
 * rather than mixing road and straight-line legs, which would give a figure
 * that is neither and silently understate the detour again.
 */
async function roadPath(points: LatLng[]): Promise<{ m: number; min: number } | null> {
  if (points.length < 2) return { m: 0, min: 0 };
  const legs = await Promise.all(
    points.slice(1).map((to, i) => fetchRouteServerSide(points[i]!, to)),
  );
  let m = 0;
  let sec = 0;
  for (let i = 0; i < legs.length; i += 1) {
    const leg = legs[i];
    if (leg) {
      m += leg.distanceM;
      sec += leg.durationSec;
      continue;
    }
    // Two points Routes treats as the same place have no road worth buying and
    // come back null; that is a zero-length leg, not a failed measurement.
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4) continue;
    return null;
  }
  return { m, min: sec / 60 };
}

/**
 * What one more rider really costs the car: the road with them, less the road
 * without. Falls back to the straight line whenever the road is unavailable —
 * no key, quota, an outage — because a Maps failure must never stop a rider
 * sharing a car. The verdict records which one it used.
 */
async function measureDetour(
  aboard: RiderGeometry[],
  joiner: RiderGeometry,
  start: LatLng | null,
): Promise<{ km: number; min: number; source: 'road' | 'straight' }> {
  if (serverRoutingConfigured()) {
    const [withJoiner, without] = await Promise.all([
      roadPath(orderedPoints([...aboard, joiner], start)),
      roadPath(orderedPoints(aboard, start)),
    ]);
    if (withJoiner && without) {
      return {
        km: Math.max(0, withJoiner.m - without.m) / 1000,
        min: Math.max(0, withJoiner.min - without.min),
        source: 'road',
      };
    }
  }
  return { ...detourOf(aboard, joiner, start), source: 'straight' };
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
      detourSource: 'straight',
      recorded: Promise.resolve(),
    };
  }
  const geometry = (r: PricedRider & RiderGeometry): RiderGeometry => ({
    uid: r.uid,
    pickup: r.pickup,
    dropoff: r.dropoff,
  });
  const detour = await measureDetour(
    ctx.aboard.map(geometry),
    geometry(ctx.joiner),
    ctx.start ?? null,
  );
  const decision = poolAdmit(
    ctx.aboard.map(({ uid, soloFare }) => ({ uid, soloFare })),
    { uid: ctx.joiner.uid, soloFare: ctx.joiner.soloFare },
    settings,
    detour,
    ctx.currentGross,
  );
  const verdict = {
    ...decision,
    mode: settings.mode,
    refuse: !decision.ok && settings.mode === 'live',
    detourSource: detour.source,
  };
  const recorded = write(ctx, verdict, settings).catch((error) => {
    // `error:` not `message:` — the firebase logger overwrites `message`.
    logger.warn('pooling admission not recorded', { poolId: ctx.poolId, error });
  });
  const admission: Admission = { ...verdict, recorded };
  // A rider being SEATED does not wait on the ledger, and never fails because
  // of it. A rider being REFUSED does: the caller throws the moment this
  // returns, and a refusal that went unrecorded is the one row the desk most
  // needs — it is also the only evidence the rider was turned away at all.
  // Waiting costs that request nothing, since it is failing regardless.
  if (admission.refuse) await recorded;
  return admission;
}

async function write(
  ctx: AdmissionContext,
  a: Omit<Admission, 'recorded'>,
  settings: PoolingSettings,
): Promise<void> {
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
      // Whether this row's detour is the real road or the straight line. A
      // straight-line row understates the detour and must not be read as
      // evidence that a limit was comfortably met.
      detourSource: a.detourSource,
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
      roadMeasured: FieldValue.increment(a.detourSource === 'road' ? 1 : 0),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }),
  ]);
}
