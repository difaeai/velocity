/**
 * The server-side half of the queue: may this driver take this ride yet?
 * ----------------------------------------------------------------------------
 * The driver app asks `driverQueue.claimDecision` too, so the feed can show
 * "yours in 8s" rather than letting somebody tap a request that will bounce.
 * But a client-side check is a courtesy to honest builds. This is the one that
 * decides, and it lives in its own file so that wiring it into `acceptTrip` is
 * an import and two lines rather than a refactor of somebody else's function.
 *
 * FAILS OPEN, ALWAYS
 * ------------------
 * Every error path here returns "allowed". Not for tidiness — because of what
 * the two failures cost:
 *
 *   · Wrongly allowing a claim: one ride is served out of order. Nobody can
 *     tell, and the next one is in order again.
 *   · Wrongly refusing one: a driver cannot work, a rider is not collected, and
 *     neither of them can see why. If the pricing tick has died, that is EVERY
 *     driver and EVERY rider.
 *
 * So an unreadable config, a missing zone document, a stale queue and a thrown
 * exception all mean yes. The queue is an ordering policy on top of a working
 * marketplace, and it is never allowed to become a precondition for one.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { encodeGeohash } from '../lib/geohash';
import { fareCityIdsFor } from '../fare/cityConfig';
import { ZONE_COLLECTION, loadPricingConfig, zoneKey } from './config';
import { claimDecision, type ClaimDecision } from './driverQueue';
import type { QueueEntry, ZoneQueue } from './types';

const ALLOW = (reason: ClaimDecision['reason']): ClaimDecision => ({
  allowed: true,
  rank: null,
  queueSize: 0,
  waitMs: 0,
  reason,
});

/** The stored queue for the zone a pickup falls in, or null. */
export async function zoneQueueFor(
  pickup: { lat: number; lng: number },
  precision: number,
): Promise<{ queue: ZoneQueue | null; key: string }> {
  const cityId = fareCityIdsFor(pickup)[0]!;
  // Computed from the coordinates rather than read off `pickupGeohash`: that
  // field lives on `openRequests` and `poolRideRequests` but not on the trip
  // document, and the gate has to work from whichever one the caller holds.
  const zone = encodeGeohash(pickup.lat, pickup.lng, precision);
  const key = zoneKey(cityId, zone);

  const snap = await db.doc(`${ZONE_COLLECTION}/${key}`).get();
  if (!snap.exists) return { queue: null, key };

  const entries = snap.get('queue');
  const updatedAt = snap.get('updatedAt');
  if (!Array.isArray(entries) || typeof updatedAt !== 'number') return { queue: null, key };

  return {
    queue: { cityId, zone, entries: entries as QueueEntry[], updatedAt },
    key,
  };
}

export interface ClaimGateResult extends ClaimDecision {
  zoneKey: string | null;
}

/**
 * Whether `driverId` may accept a request that appeared at
 * `requestCreatedAtMs`, from the queue covering `pickup`.
 */
export async function claimGateFor(input: {
  driverId: string;
  pickup: { lat: number; lng: number } | null | undefined;
  requestCreatedAtMs: number | null | undefined;
  now?: number;
}): Promise<ClaimGateResult> {
  const { driverId, pickup, requestCreatedAtMs, now = Date.now() } = input;

  // Without a pickup or a creation time there is no queue to place them in and
  // no age to measure. Both are normal for older trip documents.
  if (
    !pickup ||
    !Number.isFinite(pickup.lat) ||
    !Number.isFinite(pickup.lng) ||
    !requestCreatedAtMs ||
    !Number.isFinite(requestCreatedAtMs)
  ) {
    return { ...ALLOW('no_queue'), zoneKey: null };
  }

  try {
    const config = await loadPricingConfig();
    if (!config.queue.enabled) return { ...ALLOW('disabled'), zoneKey: null };

    const { queue, key } = await zoneQueueFor(pickup, Math.max(1, Math.trunc(config.peak.zonePrecision)));
    const decision = claimDecision({
      queue,
      driverId,
      requestCreatedAt: requestCreatedAtMs,
      settings: config.queue,
      now,
    });
    return { ...decision, zoneKey: key };
  } catch (e) {
    logger.warn('claim gate unreadable — allowing the claim', { driverId, e });
    return { ...ALLOW('no_queue'), zoneKey: null };
  }
}

/**
 * What the driver is told when it is not their turn.
 *
 * Says how long, and why, because "Not available" on a request they can see on
 * their own screen reads as a bug and generates a support ticket. English, as
 * the rest of the app's strings are.
 */
export function waitMessage(decision: ClaimDecision): string {
  const seconds = Math.max(1, Math.ceil(decision.waitMs / 1000));
  if (decision.rank === null) {
    return `Drivers already waiting in this area get first refusal. This ride opens to you in ${seconds}s.`;
  }
  return `It is not your turn yet — you are number ${decision.rank + 1} of ${decision.queueSize} waiting here. This ride opens to you in ${seconds}s.`;
}
