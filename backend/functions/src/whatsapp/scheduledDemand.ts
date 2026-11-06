/**
 * Time-based demand on WhatsApp (owner, 2026-11-05): "3 passengers will travel
 * from Blue Area at 5:00 PM today. Total fare: PKR 450."
 *
 * Every quarter hour, the WhatsApp QR leads (leads.ts) whose ride starts an
 * hour from now are grouped — same time, starting within 1.5 km of each other,
 * a car's worth at most — and each group goes to opted-in drivers near where it
 * starts, through the same fanout as ride alerts: consent, per-driver caps,
 * quiet hours, app closed, circuit breaker. A lead travels twice a day: home to
 * office at the start of their timings, office to home at the end.
 *
 * Only an area name leaves (areaLabel): "Blue Area", never a house or street.
 */
import { distanceBetween } from 'geofire-common';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { areaLabel } from '../dailyRoutes/travelAreas';
import { MAX_POOL_RIDERS } from '../domain/fares';
import { sharedRideFare } from '../fare/sharedRideFare';
import { db, SCHEDULE_REGION } from '../lib/firebase';
import { priceInOrder } from '../trips/poolPricing';
import { alertOfflineDriversOnWhatsApp, pktClock, PKT_OFFSET_MS } from './alerts';
import { leadTimes, type LeadPin } from './leads';

const QUARTER_MS = 15 * 60_000;
/** How far ahead a driver is told. */
const AHEAD_MS = 60 * 60_000;
/** Riders starting this close together are one car's worth of demand. */
const GROUP_KM = 1.5;

export interface DemandLeg {
  id: string;
  from: LeadPin;
  to: LeadPin;
  /** Today's departure, on a quarter hour. */
  atMs: number;
}

/** A lead's two trips today (PKT): home to office at the start, office to home at the end. None on Sunday. */
export function leadLegs(
  id: string,
  l: { pickup?: LeadPin | null; dropoff?: LeadPin | null; timings?: string | null },
  nowMs: number,
): DemandLeg[] {
  const t = leadTimes(l.timings);
  const pkt = new Date(nowMs + PKT_OFFSET_MS);
  if (!t || !l.pickup || !l.dropoff || pkt.getUTCDay() === 0) return [];
  const midnight = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) - PKT_OFFSET_MS;
  const at = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return midnight + Math.round(((h * 60 + m) * 60_000) / QUARTER_MS) * QUARTER_MS;
  };
  return [
    { id, from: l.pickup, to: l.dropoff, atMs: at(t.start) },
    ...(t.end ? [{ id, from: l.dropoff, to: l.pickup, atMs: at(t.end) }] : []),
  ];
}

/**
 * The legs leaving an hour from now, in cars. The target is the nearest quarter
 * hour to now + 1h, so a tick that fires a few seconds early or late still
 * picks the same one, and each departure is told exactly once.
 */
export function dueGroups(legs: DemandLeg[], nowMs: number): DemandLeg[][] {
  const target = Math.round((nowMs + AHEAD_MS) / QUARTER_MS) * QUARTER_MS;
  const groups: DemandLeg[][] = [];
  for (const leg of legs.filter((l) => l.atMs === target)) {
    const car = groups.find((g) => g.length < MAX_POOL_RIDERS
      && distanceBetween([g[0]!.from.lat, g[0]!.from.lng], [leg.from.lat, leg.from.lng]) <= GROUP_KM);
    if (car) car.push(leg);
    else groups.push([leg]);
  }
  return groups;
}

/** One tick: every car's worth of demand leaving in an hour, to the drivers near it. */
export async function runScheduledDemand(nowMs: number): Promise<number> {
  // shortcut: reads every finished lead each tick; index leads by departure time past a few thousand.
  const snap = await db.collection('whatsappLeads').where('step', '==', 'done').limit(2000).get();
  const groups = dueGroups(snap.docs.flatMap((d) => leadLegs(d.id, d.data(), nowMs)), nowMs);
  for (const car of groups) {
    const first = car[0]!;
    try {
      // Each rider's own route at the shared-ride price, then the car at the 100/55/45/35 tiers.
      const solo = await Promise.all(car.map((l) => sharedRideFare('mini', l.from, l.to).then((q) => q.fare)));
      const fare = priceInOrder(solo.map((soloFare, i) => ({ uid: String(i), soloFare }))).gross;
      await alertOfflineDriversOnWhatsApp({
        tripId: 'scheduled-demand',
        pickup: { lat: first.from.lat, lng: first.from.lng },
        rideType: 'mini',
        fare,
        onlineNearby: 0,
        demand: {
          people: car.length,
          from: areaLabel(first.from.name ?? first.from.address ?? '') || 'near you',
          time: pktClock(first.atMs),
          link: 'demand',
        },
      });
    } catch (err) {
      logger.warn('WhatsApp: scheduled demand alert failed', { error: String(err) });
    }
  }
  return groups.length;
}

export const sendScheduledDemandAlerts = onSchedule(
  // Unix cron, not "every 15 minutes": it lands on :00/:15/:30/:45, the quarter hours departures sit on.
  // Only 7:00–21:45, Monday to Saturday: quiet hours send nothing and leads have no Sunday trips,
  // so a run then would be billed for nothing (the job is not in lib/jobSleep's list).
  { schedule: '*/15 7-21 * * 1-6', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    const cars = await runScheduledDemand(Date.now());
    if (cars > 0) logger.info('WhatsApp: scheduled demand sent', { cars });
  },
);
