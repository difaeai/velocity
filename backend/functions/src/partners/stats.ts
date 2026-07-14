/**
 * Partner Program — dashboard aggregation and level assignment.
 *
 * The mobile dashboard asks one callable one question ("what is my program
 * worth?") and gets every number on the screen back in a single round trip.
 * Doing this server-side is not just a latency choice: the client must never be
 * able to compute its own revenue, or a patched client would report whatever it
 * liked into a screen a partner then screenshots and disputes.
 *
 * Revenue is summed from `partner_transactions`, which is the immutable receipt
 * of what was actually credited — never re-derived from rides, so a number on
 * the dashboard always traces to a row a partner can open.
 */
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAuth, invalid } from '../lib/guards';
import { requirePartner } from './applications';
import { computeLevel, nextLevelTarget } from './types';
import type { FleetType, PartnerLevel, PartnerStats } from './types';

const DAY = 86_400_000;

/** Reversed rows paid nothing, so they must not appear in any revenue total. */
function paid(doc: FirebaseFirestore.QueryDocumentSnapshot): number {
  return doc.get('status') === 'reversed' ? 0 : ((doc.get('fleetCommission') as number) ?? 0);
}

interface Buckets {
  today: number;
  week: number;
  month: number;
  lifetime: number;
}

const ZERO: Buckets = { today: 0, week: 0, month: 0, lifetime: 0 };

function bucketize(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  value: (d: FirebaseFirestore.QueryDocumentSnapshot) => number,
): Buckets {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const out = { ...ZERO };
  for (const d of docs) {
    const v = value(d);
    if (v === 0) continue;
    const at = (d.get('createdAt') as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
    out.lifetime += v;
    if (at >= startOfToday.getTime()) out.today += v;
    if (at >= now - 7 * DAY) out.week += v;
    if (at >= now - 30 * DAY) out.month += v;
  }
  return out;
}

/**
 * Everything the partner dashboard renders.
 *
 * Bounded to the last 120 days of rows for the time series; `lifetime` totals
 * come from the counters on the partner doc, which are maintained incrementally
 * at credit time and so do not need the full history scanned.
 */
export const getPartnerDashboard = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const partner = await requirePartner(uid);

  const since = new Date(Date.now() - 120 * DAY);
  const [txns, driverFleet, passengerFleet, wallet] = await Promise.all([
    db
      .collection('partner_transactions')
      .where('partnerId', '==', uid)
      .where('createdAt', '>=', since)
      .orderBy('createdAt', 'desc')
      .limit(2000)
      .get(),
    partner.get('driverFleetId')
      ? db.doc(`partner_fleets/${partner.get('driverFleetId')}`).get()
      : Promise.resolve(null),
    partner.get('passengerFleetId')
      ? db.doc(`partner_fleets/${partner.get('passengerFleetId')}`).get()
      : Promise.resolve(null),
    db.doc(`partner_wallets/${uid}`).get(),
  ]);

  const rows = txns.docs;
  const driverRows = rows.filter((d) => d.get('fleetType') === 'driver');
  const passengerRows = rows.filter((d) => d.get('fleetType') === 'passenger');

  const revenue = {
    combined: bucketize(rows, paid),
    driver: bucketize(driverRows, paid),
    passenger: bucketize(passengerRows, paid),
  };
  const rides = {
    combined: bucketize(rows, (d) => (d.get('rideStatus') === 'completed' ? 1 : 0)),
    driver: bucketize(driverRows, (d) => (d.get('rideStatus') === 'completed' ? 1 : 0)),
    passenger: bucketize(passengerRows, (d) => (d.get('rideStatus') === 'completed' ? 1 : 0)),
  };

  // Daily series for the charts — 30 points, oldest first.
  const series: { date: string; earnings: number; rides: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * DAY);
    day.setHours(0, 0, 0, 0);
    const next = day.getTime() + DAY;
    const dayRows = rows.filter((d) => {
      const at = (d.get('createdAt') as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      return at >= day.getTime() && at < next;
    });
    series.push({
      date: day.toISOString().slice(0, 10),
      earnings: dayRows.reduce((sum, d) => sum + paid(d), 0),
      rides: dayRows.filter((d) => d.get('rideStatus') === 'completed').length,
    });
  }

  const completedRides = (partner.get('completedRides') as number) ?? 0;
  const flaggedRides = (partner.get('flaggedRides') as number) ?? 0;
  const lifetimeEarnings = (partner.get('lifetimeEarnings') as number) ?? 0;
  const totalRides = completedRides + flaggedRides;

  const level = (partner.get('level') as PartnerLevel) ?? 'bronze';
  const next = nextLevelTarget(level);

  return {
    ok: true,
    partner: {
      uid,
      fullName: partner.get('fullName'),
      city: partner.get('city'),
      status: partner.get('status'),
      level,
      nextLevel: next
        ? {
            level: next.level,
            minActiveMembers: next.minActiveMembers,
            minCompletedRides: next.minCompletedRides,
            minEarnings: next.minEarnings,
          }
        : null,
    },
    fleets: {
      driver: driverFleet?.exists
        ? {
            id: driverFleet.id,
            code: driverFleet.get('code'),
            name: driverFleet.get('name'),
            members: driverFleet.get('members') ?? 0,
          }
        : null,
      passenger: passengerFleet?.exists
        ? {
            id: passengerFleet.id,
            code: passengerFleet.get('code'),
            name: passengerFleet.get('name'),
            members: passengerFleet.get('members') ?? 0,
          }
        : null,
    },
    wallet: {
      balance: (wallet.get('balance') as number) ?? 0,
      pending: (wallet.get('pending') as number) ?? 0,
      withdrawn: (wallet.get('withdrawn') as number) ?? 0,
      lifetimeEarnings: (wallet.get('lifetimeEarnings') as number) ?? 0,
    },
    overview: {
      totalDrivers: (partner.get('totalDrivers') as number) ?? 0,
      totalPassengers: (partner.get('totalPassengers') as number) ?? 0,
      completedRides,
      flaggedRides,
      lifetimeEarnings,
      scamRate: totalRides > 0 ? flaggedRides / totalRides : 0,
      avgCommissionPerRide: completedRides > 0 ? lifetimeEarnings / completedRides : 0,
    },
    revenue,
    rides,
    series,
  };
});

const membersSchema = z.object({
  type: z.enum(['driver', 'passenger']),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * The fleet roster. Joins each referral edge to the member's live profile so the
 * list can show a photo, a name and — for drivers — whether they are online now.
 */
export const getPartnerFleetMembers = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await requirePartner(uid);

  const parsed = membersSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');
  const { type } = parsed.data;
  const limit = parsed.data.limit ?? 100;

  const edges = await db
    .collection(type === 'driver' ? 'driver_referrals' : 'passenger_referrals')
    .where('partnerId', '==', uid)
    .orderBy('boundAt', 'desc')
    .limit(limit)
    .get();

  if (edges.empty) return { ok: true, members: [] };

  const members = await Promise.all(
    edges.docs.map(async (edge) => {
      const memberUid = edge.get('uid') as string;
      const [user, driver] = await Promise.all([
        db.doc(`users/${memberUid}`).get(),
        type === 'driver' ? db.doc(`drivers/${memberUid}`).get() : Promise.resolve(null),
      ]);
      const lastRideAt = edge.get('lastRideAt') as FirebaseFirestore.Timestamp | null;
      return {
        uid: memberUid,
        name: (user.get('displayName') as string) ?? 'Velocity user',
        photoURL: (user.get('photoURL') as string) ?? null,
        joinedAt: (edge.get('boundAt') as FirebaseFirestore.Timestamp | null)?.toMillis() ?? null,
        lastRideAt: lastRideAt?.toMillis() ?? null,
        online: driver?.exists ? driver.get('online') === true : false,
        // "Active" is a ride in the last 30 days, the same definition the level
        // ladder uses — two different meanings of active across one product is
        // how a partner ends up arguing with support about their own numbers.
        active: lastRideAt ? Date.now() - lastRideAt.toMillis() < 30 * DAY : false,
        completedRides: (edge.get('completedRides') as number) ?? 0,
        flaggedRides: (edge.get('flaggedRides') as number) ?? 0,
        totalRideValue: (edge.get('totalRideValue') as number) ?? 0,
        platformCommissionGenerated: (edge.get('platformCommissionGenerated') as number) ?? 0,
        fleetCommissionGenerated: (edge.get('fleetCommissionGenerated') as number) ?? 0,
      };
    }),
  );

  return { ok: true, members };
});

const memberRidesSchema = z.object({
  memberUid: z.string().min(1).max(128),
  limit: z.number().int().min(1).max(200).optional(),
});

/** One member's full ride history — including the rides that paid nothing. */
export const getPartnerMemberRides = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await requirePartner(uid);

  const parsed = memberRidesSchema.safeParse(req.data);
  if (!parsed.success) invalid('Invalid request.');

  const rows = await db
    .collection('partner_transactions')
    .where('partnerId', '==', uid)
    .where('memberUid', '==', parsed.data.memberUid)
    .orderBy('createdAt', 'desc')
    .limit(parsed.data.limit ?? 100)
    .get();

  const rides = await Promise.all(
    rows.docs.map(async (row) => {
      const trip = await db.doc(`trips/${row.get('tripId')}`).get();
      return {
        id: row.id,
        tripId: row.get('tripId'),
        date: (row.get('createdAt') as FirebaseFirestore.Timestamp | null)?.toMillis() ?? null,
        pickup: (trip.get('pickupLabel') as string) ?? null,
        dropoff: (trip.get('dropoffLabel') as string) ?? null,
        fare: (row.get('rideFare') as number) ?? 0,
        platformCommission: (row.get('platformCommission') as number) ?? 0,
        fleetCommission: (row.get('status') === 'reversed' ? 0 : row.get('fleetCommission')) ?? 0,
        rideStatus: row.get('rideStatus'),
        paymentStatus: row.get('status'),
        fraudReason: row.get('fraudReason') ?? null,
      };
    }),
  );

  return { ok: true, rides };
});

/**
 * Recompute every partner's level nightly.
 *
 * Levels move on lifetime aggregates that only ever drift slowly, so doing this
 * on a schedule instead of on every ride keeps the hot settlement path free of
 * a read it does not need.
 */
export const recomputePartnerLevels = onSchedule('every day 03:00', async () => {
  const partners = await db.collection('partners').where('status', '==', 'active').get();

  for (const partner of partners.docs) {
    try {
      const uid = partner.id;
      const completedRides = (partner.get('completedRides') as number) ?? 0;
      const flaggedRides = (partner.get('flaggedRides') as number) ?? 0;
      const lifetimeEarnings = (partner.get('lifetimeEarnings') as number) ?? 0;
      const totalRides = completedRides + flaggedRides;

      const [driverEdges, passengerEdges] = await Promise.all([
        db.collection('driver_referrals').where('partnerId', '==', uid).get(),
        db.collection('passenger_referrals').where('partnerId', '==', uid).get(),
      ]);

      const cutoff = Date.now() - 30 * DAY;
      const activeMembers = [...driverEdges.docs, ...passengerEdges.docs].filter((e) => {
        const last = e.get('lastRideAt') as FirebaseFirestore.Timestamp | null;
        return last ? last.toMillis() >= cutoff : false;
      }).length;

      // Distinct calendar months in which the partner earned anything — the
      // consistency signal the ladder asks for.
      const txns = await db
        .collection('partner_transactions')
        .where('partnerId', '==', uid)
        .where('rideStatus', '==', 'completed')
        .select('createdAt')
        .get();
      const months = new Set<string>();
      for (const t of txns.docs) {
        const at = (t.get('createdAt') as FirebaseFirestore.Timestamp | undefined)?.toDate();
        if (at) months.add(`${at.getUTCFullYear()}-${at.getUTCMonth()}`);
      }

      const stats: PartnerStats = {
        activeMembers,
        completedRides,
        lifetimeEarnings,
        scamRate: totalRides > 0 ? flaggedRides / totalRides : 0,
        activeMonths: months.size,
      };
      const level = computeLevel(stats);

      if (level !== partner.get('level')) {
        await partner.ref.set(
          { level, activeMembers, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        logger.info('Partner level changed', { uid, from: partner.get('level'), to: level });
      } else {
        await partner.ref.set({ activeMembers }, { merge: true });
      }
    } catch (err) {
      logger.error('Failed to recompute partner level', { uid: partner.id, err });
    }
  }
});

export type { FleetType };
