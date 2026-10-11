/**
 * The tick. Once a minute, for every zone that matters: how busy is it, is the
 * scarcity real, and who is next in line.
 * ----------------------------------------------------------------------------
 * WHY A SCHEDULED JOB AND NOT A TRIGGER
 * -------------------------------------
 * The obvious design is an `onDocumentWritten` trigger on `drivers/{uid}`,
 * which would give exact supply the instant it changes. It was priced and
 * rejected. The driver app writes `drivers/{uid}` every 30 seconds while online
 * (`apps/mobile/app/driver/home.tsx`), so at 1,200 online drivers that trigger
 * is ~3.4 million invocations a day, and all but a handful would be no-ops —
 * Firestore triggers cannot be filtered by field, so an early `return` still
 * pays for the invocation.
 *
 * One scheduled run a minute is 1,440 invocations a day, and the supply number
 * it computes is at most 60 seconds old. For a multiplier that is only allowed
 * to move 0.05 per tick, 60 seconds of staleness is not a defect.
 *
 * HOW THE READS ARE KEPT CHEAP
 * ----------------------------
 *  · Demand comes from one bounded read of `openRequests`, a collection that is
 *    already swept and small.
 *  · Busy drivers come from one bounded read of active trips, projected to
 *    `driverId` alone.
 *  · Supply is read per zone, and only for WARM zones — those with a request
 *    waiting, or with a sample inside `staleAfterSec`. A zone nobody is
 *    ordering a ride in costs nothing.
 *  · `MAX_ZONES_PER_TICK` is the backstop. A bug that marked every cell in the
 *    country warm degrades into a partial run, not into an unbounded bill.
 *
 * WHAT IT WRITES
 * --------------
 *   surge/{cityId}_{zone}        the multiplier `fare/fareFunctions.ts` reads
 *   pricingZones/{cityId}_{zone} samples, the queue, and why it decided that
 *   driverPresence/{driverId}    append-only-ish log of real transitions
 *
 * The surge document carries `expiresAt`. If this job stops running, the fare
 * engine sees the expiry and falls back to 1.0 rather than serving the last
 * multiplier it was told about for ever. A pricing engine that fails must fail
 * to 1.0.
 * ----------------------------------------------------------------------------
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { fareCityIdsFor } from '../fare/cityConfig';
import {
  PRESENCE_COLLECTION,
  SURGE_COLLECTION,
  ZONE_COLLECTION,
  loadPricingConfig,
  zoneKey,
} from './config';
import { rebuildQueue } from './driverQueue';
import { computePeakFactor } from './peak';
import { churnVerdict, detectSupplyShock, freezeFor, trimPresenceEvents, type PresenceEvent } from './supplyIntegrity';
import {
  MAX_ZONE_SAMPLES,
  type PricingEngineConfig,
  type QueueEntry,
  type ZoneSample,
} from './types';

const REGION = 'asia-south1';

/** Trip statuses that have a driver committed and therefore unavailable. */
const BUSY_STATUSES = ['matched', 'arriving', 'arrived', 'in_progress'] as const;

/** Hard caps. Each exists so a bad day degrades instead of escalating. */
const MAX_OPEN_REQUESTS = 1_000;
const MAX_BUSY_TRIPS = 1_000;
const MAX_ZONES_PER_TICK = 60;
const MAX_DRIVERS_PER_ZONE = 300;

/**
 * Geohash sorts as a string, so every cell inside a prefix lies between the
 * prefix and the prefix followed by a character above the alphabet's last.
 * Geohash base32 ends at 'z'; '{' is the next ASCII codepoint.
 */
const prefixEnd = (prefix: string): string => `${prefix}{`;

interface ZoneDemand {
  cityId: string;
  zone: string;
  openRequests: number;
}

/** Group the waiting requests by the zone of their pickup. */
async function readDemand(precision: number): Promise<Map<string, ZoneDemand>> {
  const snap = await db.collection('openRequests').limit(MAX_OPEN_REQUESTS).get();
  const zones = new Map<string, ZoneDemand>();

  for (const doc of snap.docs) {
    const pickup = doc.get('pickup') as { lat?: number; lng?: number } | undefined;
    const geohash = doc.get('pickupGeohash') as string | undefined;
    // `pickupGeohash` is written at precision 6, so a 5-character zone is a
    // prefix of it. A request without one cannot be placed in a zone, and is
    // counted nowhere rather than counted everywhere.
    if (!geohash || geohash.length < precision) continue;
    if (typeof pickup?.lat !== 'number' || typeof pickup?.lng !== 'number') continue;

    const zone = geohash.slice(0, precision);
    const cityId = fareCityIdsFor({ lat: pickup.lat, lng: pickup.lng })[0]!;
    const key = zoneKey(cityId, zone);
    const existing = zones.get(key);
    if (existing) existing.openRequests++;
    else zones.set(key, { cityId, zone, openRequests: 1 });
  }

  return zones;
}

/** Drivers who have a trip in hand and cannot take another. */
async function readBusyDrivers(): Promise<Set<string>> {
  const snap = await db
    .collection('trips')
    .where('status', 'in', BUSY_STATUSES)
    .select('driverId')
    .limit(MAX_BUSY_TRIPS)
    .get();

  const busy = new Set<string>();
  for (const doc of snap.docs) {
    const driverId = doc.get('driverId') as string | undefined;
    if (driverId) busy.add(driverId);
  }
  return busy;
}

/**
 * Approved, online drivers whose last known cell is inside this zone.
 *
 * Projected to ids: the tick needs who, not what. Uses the same
 * (online, verificationStatus, geohash) index `lib/nearbyDrivers.ts` relies on.
 */
async function readZoneDrivers(zone: string): Promise<string[]> {
  const snap = await db
    .collection('drivers')
    .where('online', '==', true)
    .where('verificationStatus', '==', 'approved')
    .where('geohash', '>=', zone)
    .where('geohash', '<', prefixEnd(zone))
    .select()
    .limit(MAX_DRIVERS_PER_ZONE)
    .get();
  return snap.docs.map((d) => d.id);
}

interface StoredZone {
  cityId: string;
  zone: string;
  samples: ZoneSample[];
  queue: QueueEntry[];
  multiplier: number;
  freeze: { multiplier: number; until: number } | null;
  lastShockAt: number | null;
}

/** Zones with a sample recent enough that they are still being tracked. */
async function readWarmZones(config: PricingEngineConfig, now: number): Promise<Map<string, StoredZone>> {
  const snap = await db
    .collection(ZONE_COLLECTION)
    .where('updatedAt', '>=', now - config.peak.staleAfterSec * 1000)
    .limit(MAX_ZONES_PER_TICK)
    .get();

  const zones = new Map<string, StoredZone>();
  for (const doc of snap.docs) {
    zones.set(doc.id, readStored(doc.id, doc.data() as Record<string, unknown>));
  }
  return zones;
}

function readStored(key: string, data: Record<string, unknown> | undefined): StoredZone {
  const [cityId = '', zone = ''] = [
    typeof data?.cityId === 'string' ? data.cityId : key.split('_')[0],
    typeof data?.zone === 'string' ? data.zone : key.split('_').slice(1).join('_'),
  ];
  const freeze = data?.freeze as { multiplier?: unknown; until?: unknown } | undefined;
  return {
    cityId,
    zone,
    samples: Array.isArray(data?.samples) ? (data.samples as ZoneSample[]) : [],
    queue: Array.isArray(data?.queue) ? (data.queue as QueueEntry[]) : [],
    multiplier: typeof data?.multiplier === 'number' ? data.multiplier : 1,
    freeze:
      freeze && typeof freeze.multiplier === 'number' && typeof freeze.until === 'number'
        ? { multiplier: freeze.multiplier, until: freeze.until }
        : null,
    lastShockAt: typeof data?.lastShockAt === 'number' ? data.lastShockAt : null,
  };
}

export interface TickReport {
  ranAt: number;
  zonesConsidered: number;
  zonesPriced: number;
  surging: number;
  frozen: number;
  joined: number;
  forfeited: number;
  truncated: boolean;
}

/**
 * One pass over every warm zone.
 *
 * Exported so the admin desk can run it on demand — useful when somebody has
 * just changed a cap and wants to see it land without waiting for the minute.
 */
export async function runTick(now: number = Date.now()): Promise<TickReport> {
  const config = await loadPricingConfig(true);
  const precision = Math.max(1, Math.trunc(config.peak.zonePrecision));

  const [demand, busy, stored] = await Promise.all([
    readDemand(precision),
    readBusyDrivers(),
    readWarmZones(config, now),
  ]);

  // A zone is worth pricing if somebody is waiting in it, or if it was being
  // tracked recently — the second half is what keeps a queue alive through a
  // quiet minute instead of resetting everybody's seniority.
  const keys = new Set([...demand.keys(), ...stored.keys()]);
  const truncated = keys.size > MAX_ZONES_PER_TICK;
  const considered = [...keys].slice(0, MAX_ZONES_PER_TICK);

  const report: TickReport = {
    ranAt: now,
    zonesConsidered: keys.size,
    zonesPriced: 0,
    surging: 0,
    frozen: 0,
    joined: 0,
    forfeited: 0,
    truncated,
  };

  const presenceWrites: { driverId: string; online: boolean; shockAt: number | null }[] = [];

  for (const key of considered) {
    const prior = stored.get(key) ?? readStored(key, undefined);
    const zoneDemand = demand.get(key);
    const cityId = zoneDemand?.cityId || prior.cityId;
    const zone = zoneDemand?.zone || prior.zone;
    if (!cityId || !zone) continue;

    let onlineIds: string[];
    try {
      onlineIds = await readZoneDrivers(zone);
    } catch (e) {
      // One unreadable zone must not take the whole tick down with it; the
      // others still get priced and this one is retried in a minute.
      logger.warn('zone supply unreadable', { key, e });
      continue;
    }

    const available = onlineIds.filter((id) => !busy.has(id));
    const sample: ZoneSample = {
      at: now,
      onlineDrivers: onlineIds.length,
      availableDrivers: available.length,
      openRequests: zoneDemand?.openRequests ?? 0,
    };
    const samples = [...prior.samples, sample].slice(-MAX_ZONE_SAMPLES);

    // ── Is the scarcity real? ───────────────────────────────────────────────
    const shock = detectSupplyShock(samples, config.integrity, now);
    // An existing freeze is honoured until it expires and is never raised: a
    // second shock during a freeze cannot ratchet the held factor upwards.
    const existingFreeze = prior.freeze && prior.freeze.until > now ? prior.freeze : null;
    const freeze = existingFreeze ?? freezeFor(shock, prior.multiplier, config.integrity, now);

    const decision = computePeakFactor({
      sample,
      previousMultiplier: prior.multiplier,
      settings: config.peak,
      freeze,
      now,
    });

    // ── Who is next? ────────────────────────────────────────────────────────
    const queue = rebuildQueue(prior.queue, onlineIds, config.queue, now);
    const lastShockAt = shock.suspicious ? now : prior.lastShockAt;

    for (const driverId of queue.joined) {
      presenceWrites.push({ driverId, online: true, shockAt: lastShockAt });
    }
    for (const driverId of queue.forfeited) {
      presenceWrites.push({ driverId, online: false, shockAt: lastShockAt });
    }

    const batch = db.batch();
    batch.set(
      db.doc(`${ZONE_COLLECTION}/${key}`),
      {
        cityId,
        zone,
        samples,
        queue: queue.entries,
        multiplier: decision.multiplier,
        decision,
        shock,
        ...(freeze ? { freeze } : { freeze: FieldValue.delete() }),
        ...(lastShockAt !== null ? { lastShockAt } : {}),
        updatedAt: now,
      },
      { merge: true },
    );
    // The document the fare engine reads. Deliberately minimal — a hot read
    // path should not be pulling half an hour of samples with it.
    batch.set(db.doc(`${SURGE_COLLECTION}/${key}`), {
      multiplier: decision.multiplier,
      reason: decision.reason,
      ratio: decision.ratio,
      cityId,
      zone,
      updatedAt: now,
      expiresAt: now + config.peak.staleAfterSec * 1000,
    });
    await batch.commit();

    report.zonesPriced++;
    if (decision.multiplier > 1.001) report.surging++;
    if (decision.reason === 'frozen_supply_shock') report.frozen++;
    report.joined += queue.joined.length;
    report.forfeited += queue.forfeited.length;
  }

  await recordPresence(presenceWrites, config, now);

  if (truncated) {
    logger.warn('pricing tick truncated', { considered: keys.size, cap: MAX_ZONES_PER_TICK });
  }
  return report;
}

/**
 * Log the real online/offline transitions, and score the flapping.
 *
 * Only transitions reach here — `rebuildQueue` already decided who joined and
 * who forfeited — so this is a handful of writes a tick, not one per driver.
 * A driver who simply stayed online costs nothing.
 */
async function recordPresence(
  writes: { driverId: string; online: boolean; shockAt: number | null }[],
  config: PricingEngineConfig,
  now: number,
): Promise<void> {
  if (writes.length === 0) return;

  // One driver can appear in several zones in the same tick (forfeited here,
  // joined there, as they drive across a boundary). Keep the latest.
  const byDriver = new Map<string, { online: boolean; shockAt: number | null }>();
  for (const write of writes) byDriver.set(write.driverId, write);

  await Promise.all(
    [...byDriver.entries()].map(async ([driverId, { online, shockAt }]) => {
      const ref = db.doc(`${PRESENCE_COLLECTION}/${driverId}`);
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const existing = (snap.get('events') as PresenceEvent[] | undefined) ?? [];
          const events = trimPresenceEvents([...existing, { at: now, online }]);
          const verdict = churnVerdict(events, config.integrity, shockAt, now);
          tx.set(
            ref,
            {
              events,
              cyclesLastHour: verdict.cycles,
              flagged: verdict.flagged,
              ...(verdict.opportunistic ? { lastOpportunisticReturnAt: now } : {}),
              online,
              updatedAt: now,
            },
            { merge: true },
          );
        });
      } catch (e) {
        // Presence history is diagnostics. Losing an entry must never fail a
        // tick that has already priced its zones.
        logger.warn('presence log write failed', { driverId, e });
      }
    }),
  );
}

/**
 * Every minute.
 *
 * An interval schedule rather than a clock time, so no timezone is needed —
 * and `maxInstances: 1` because two ticks running at once would both read the
 * same samples and both append to them.
 */
export const runPricingTick = onSchedule(
  { schedule: 'every 1 minutes', region: REGION, maxInstances: 1, timeoutSeconds: 300 },
  async () => {
    const report = await runTick();
    if (report.surging > 0 || report.frozen > 0 || report.forfeited > 0) {
      logger.info('pricing tick', report);
    }
  },
);
