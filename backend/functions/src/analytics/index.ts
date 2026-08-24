/**
 * Admin dashboard analytics.
 *
 * The console used to show four running totals out of `system/counters` and
 * nothing else — no trend, no mix, no way to tell a good week from a bad one.
 * This module answers the question the dashboard actually needs: what happened
 * on each of the last N days, across every service Velocity runs.
 *
 * Cost control is the whole design. A finished day never changes, so the first
 * time anyone asks for it the day is computed once and written to
 * `analyticsDaily/{YYYY-MM-DD}`; every later request reads that one small
 * document. Only *today* is recomputed live. A 30-day dashboard refresh
 * therefore costs a handful of reads, not a scan of every trip ever taken.
 *
 * Days are Pakistan days. PKT is UTC+05:00 with no daylight saving, so the
 * local date is simply the UTC date five hours ahead — see `dayKey`.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, Timestamp } from '../lib/firebase';
import { requireAdmin } from '../lib/guards';

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const MAX_DAYS = 90;

/** One day of platform activity. Every number is a plain integer (PKR / count). */
export interface DailyStats {
  /** `YYYY-MM-DD` in Pakistan time. */
  date: string;
  /** City rides requested that day, whatever became of them. */
  tripsRequested: number;
  tripsCompleted: number;
  tripsCancelled: number;
  /** Of the completed rides, how many were pooled. */
  tripsPooled: number;
  /** Gross fares, platform commission and driver payout on completed rides. */
  revenue: number;
  commission: number;
  driverPayout: number;
  /** Completed rides split by how the passenger paid. */
  cashTrips: number;
  walletTrips: number;
  /** Requests per vehicle class — bike, auto, mini, ac, comfort, xl. */
  byRideType: Record<string, number>;
  /** The non-city services, counted by order/booking created that day. */
  intercity: number;
  couriers: number;
  freight: number;
  specialRides: number;
  scheduled: number;
  /** Accounts created that day (everyone starts as a passenger). */
  newPassengers: number;
  /** Drivers who entered the onboarding funnel that day. */
  newDrivers: number;
}

/** Point-in-time figures that only make sense as "right now", not per-day. */
export interface LiveSnapshot {
  driversPending: number;
  driversApproved: number;
  driversSuspended: number;
  passengers: number;
  activeTrips: number;
  openDisputes: number;
  cnicPending: number;
  payoutsPending: number;
}

const emptyDay = (date: string): DailyStats => ({
  date,
  tripsRequested: 0,
  tripsCompleted: 0,
  tripsCancelled: 0,
  tripsPooled: 0,
  revenue: 0,
  commission: 0,
  driverPayout: 0,
  cashTrips: 0,
  walletTrips: 0,
  byRideType: {},
  intercity: 0,
  couriers: 0,
  freight: 0,
  specialRides: 0,
  scheduled: 0,
  newPassengers: 0,
  newDrivers: 0,
});

/** The Pakistan calendar date a moment falls on. */
export function dayKey(ms: number): string {
  return new Date(ms + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight PKT that starts the given Pakistan date, as epoch ms. */
function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - PKT_OFFSET_MS;
}

/** The last `days` Pakistan dates, oldest first, ending with today. */
function dateRange(days: number, nowMs: number): string[] {
  // Step in UTC days from the *midday* of today's PKT date, so the arithmetic
  // can never land on a boundary and round the wrong way.
  const noon = dayStartMs(dayKey(nowMs)) + 12 * 3_600_000;
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(noon - i * 86_400_000));
  return out;
}

/** Milliseconds out of a Firestore timestamp field, tolerating missing data. */
function tsMs(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * Walk one collection over a time window and hand each document to `apply`,
 * bucketed by the day of its `createdAt`. Documents with no usable timestamp
 * are skipped rather than dumped into an arbitrary day.
 */
async function bucket(
  collection: string,
  sinceMs: number,
  buckets: Map<string, DailyStats>,
  apply: (day: DailyStats, data: Record<string, unknown>) => void,
  timestampField = 'createdAt',
): Promise<number> {
  const snap = await db
    .collection(collection)
    .where(timestampField, '>=', Timestamp.fromMillis(sinceMs))
    .get();

  let counted = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const ms = tsMs(data[timestampField]);
    if (ms === null) continue;
    const day = buckets.get(dayKey(ms));
    if (!day) continue; // outside the window we were asked for
    apply(day, data);
    counted++;
  }
  return counted;
}

/** Compute every day in `dates` from raw collections. */
async function computeDays(dates: string[]): Promise<Map<string, DailyStats>> {
  const buckets = new Map(dates.map((d) => [d, emptyDay(d)]));
  const sinceMs = dayStartMs(dates[0]);

  await Promise.all([
    bucket('trips', sinceMs, buckets, (day, t) => {
      day.tripsRequested++;
      const rideType = typeof t.rideType === 'string' ? t.rideType : 'unknown';
      day.byRideType[rideType] = (day.byRideType[rideType] ?? 0) + 1;

      // A trip is counted as completed/cancelled on the day it was *requested*,
      // so a single day's row always reconciles: requested = completed +
      // cancelled + still-open. Money follows the same rule, which keeps the
      // revenue line and the trips line telling the same story.
      if (t.status === 'completed') {
        day.tripsCompleted++;
        if (t.pool === true) day.tripsPooled++;
        if (t.paymentMethod === 'wallet') day.walletTrips++;
        else day.cashTrips++;
        const s = (t.settlement ?? {}) as Record<string, unknown>;
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
        day.revenue += num(s.grossFare) || num(t.fare);
        day.commission += num(s.commission);
        day.driverPayout += num(s.driverPayout);
      } else if (t.status === 'cancelled') {
        day.tripsCancelled++;
      }
    }),
    bucket('intercityTrips', sinceMs, buckets, (day) => { day.intercity++; }),
    bucket('courierOrders', sinceMs, buckets, (day) => { day.couriers++; }),
    bucket('freightRequests', sinceMs, buckets, (day) => { day.freight++; }),
    bucket('specialRidesBookings', sinceMs, buckets, (day) => { day.specialRides++; }),
    bucket('scheduledRides', sinceMs, buckets, (day) => { day.scheduled++; }),
    // Everyone signs up as a passenger — `onUserCreate` writes role
    // 'passenger' for every account, and a driver only becomes one later. So
    // sign-ups are counted here, and drivers are counted separately from the
    // day they entered the onboarding funnel, which is the number that actually
    // says whether supply is keeping up.
    bucket('users', sinceMs, buckets, (day, u) => {
      if (u.role !== 'admin') day.newPassengers++;
    }),
    bucket('drivers', sinceMs, buckets, (day) => { day.newDrivers++; }, 'submittedAt'),
  ]);

  return buckets;
}

/** Count-only aggregation query; returns 0 rather than throwing on a bad path. */
async function countOf(build: () => FirebaseFirestore.Query): Promise<number> {
  try {
    const snap = await build().count().get();
    return snap.data().count;
  } catch (e) {
    logger.warn('analytics: count query failed', { e });
    return 0;
  }
}

async function liveSnapshot(): Promise<LiveSnapshot> {
  const [
    driversPending,
    driversApproved,
    driversSuspended,
    passengers,
    activeTrips,
    openDisputes,
    cnicPending,
    payoutsPending,
  ] = await Promise.all([
    countOf(() => db.collection('drivers').where('verificationStatus', '==', 'pending')),
    countOf(() => db.collection('drivers').where('verificationStatus', '==', 'approved')),
    countOf(() => db.collection('drivers').where('verificationStatus', '==', 'suspended')),
    countOf(() => db.collection('users').where('role', '==', 'passenger')),
    countOf(() =>
      db
        .collection('trips')
        .where('status', 'in', ['requested', 'matched', 'arriving', 'arrived', 'in_progress']),
    ),
    countOf(() => db.collection('disputes').where('status', '==', 'open')),
    countOf(() => db.collection('cnicVerifications').where('status', '==', 'pending')),
    countOf(() => db.collection('payouts').where('status', '==', 'pending')),
  ]);

  return {
    driversPending,
    driversApproved,
    driversSuspended,
    passengers,
    activeTrips,
    openDisputes,
    cnicPending,
    payoutsPending,
  };
}

const requestSchema = z.object({
  days: z.number().int().min(1).max(MAX_DAYS).optional(),
});

/**
 * The dashboard's single data call: a daily series plus a live snapshot.
 *
 * Finished days are served from — and, on first sight, written to — the
 * `analyticsDaily` cache. Today is always recomputed, so the numbers move as
 * the day does.
 */
export const adminGetAnalytics = onCall(async (req) => {
  requireAdmin(req);
  const parsed = requestSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');

  const days = parsed.data.days ?? 30;
  const nowMs = Date.now();
  const dates = dateRange(days, nowMs);
  const today = dates[dates.length - 1];

  // What is already cached? Only completed days are ever cached.
  const cachedSnaps = await db.getAll(
    ...dates.filter((d) => d !== today).map((d) => db.doc(`analyticsDaily/${d}`)),
  );
  const cached = new Map<string, DailyStats>();
  for (const snap of cachedSnaps) {
    if (snap.exists) cached.set(snap.id, { ...emptyDay(snap.id), ...(snap.data() as DailyStats) });
  }

  // Recompute today plus every finished day we have never seen. They are
  // computed as one contiguous window because Firestore charges per document
  // read, not per query, and the missing days are almost always contiguous.
  const missing = dates.filter((d) => !cached.has(d));
  let computed = new Map<string, DailyStats>();
  if (missing.length) computed = await computeDays(dates.slice(dates.indexOf(missing[0])));

  const series = dates.map((d) => computed.get(d) ?? cached.get(d) ?? emptyDay(d));

  // Persist the finished days we just computed so nobody pays for them twice.
  const toCache = series.filter((d) => d.date !== today && !cached.has(d.date));
  if (toCache.length) {
    const batch = db.batch();
    for (const day of toCache) batch.set(db.doc(`analyticsDaily/${day.date}`), day);
    await batch.commit().catch((e) => logger.warn('analytics: cache write failed', { e }));
  }

  const snapshot = await liveSnapshot();

  const totals = series.reduce(
    (acc, d) => ({
      revenue: acc.revenue + d.revenue,
      commission: acc.commission + d.commission,
      driverPayout: acc.driverPayout + d.driverPayout,
      tripsCompleted: acc.tripsCompleted + d.tripsCompleted,
      tripsRequested: acc.tripsRequested + d.tripsRequested,
      tripsCancelled: acc.tripsCancelled + d.tripsCancelled,
      newPassengers: acc.newPassengers + d.newPassengers,
      newDrivers: acc.newDrivers + d.newDrivers,
    }),
    {
      revenue: 0,
      commission: 0,
      driverPayout: 0,
      tripsCompleted: 0,
      tripsRequested: 0,
      tripsCancelled: 0,
      newPassengers: 0,
      newDrivers: 0,
    },
  );

  return { days, series, totals, snapshot, generatedAt: nowMs };
});
