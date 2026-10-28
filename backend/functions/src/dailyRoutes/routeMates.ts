/**
 * "People on your route" — the Corporate, Students & daily screen's list, and
 * the ride request a rider sends them.
 *
 * getTravelAreas answers "how many"; this answers "who", for ONE route: the
 * other riders whose saved daily route starts and ends within SAME_WAY_KM of
 * the caller's. Only what a co-rider sees on a shared ride leaves the server:
 * a first name, a gender, the pickup and drop-off AREA and the usual time.
 * Never a uid, a phone, a photo or an address. The id handed out is the saved
 * route's own random document id, which names nobody.
 *
 * Two people are listed to each other only if they could actually sit in one
 * car: the same gender, or both have said any gender is fine (mixedRideOk) —
 * the rule every shared seat already goes through. Routes with alerts switched
 * off (`notify: false`) are never listed or messaged.
 *
 * inviteRouteMates sends the chosen people (from that list, or by username) a
 * push into the caller's own sharing ride ("pool-join" with its share code),
 * re-checking all of the above against the ride itself, at most once per
 * person per ride. The ride remembers who was asked (`invitedUids`, server-only),
 * which is what getMyRideInvites lists on the invitee's screen.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, requireAuth, invalid } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { haversineM } from '../lib/corridor';
import { notifyUser } from '../lib/fcm';
import { MAX_POOL_RIDERS, poolPerSeatFare } from '../domain/fares';
import { firstNameOf, rosterForTrip } from '../trips/poolRoster';
import { uidForUsername } from '../fleet';
import { areaLabel, parseRoute, type SavedRoute } from './travelAreas';

const SAME_WAY_KM = 3;
const MAX_MATES = 20;
const MAX_INVITES = 10;
/** Ride states a rider can still be invited into. */
const INVITABLE = new Set(['requested', 'matched', 'arriving']);

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

type LatLng = { lat: number; lng: number };
const km = (a: LatLng, b: LatLng) => haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;

export interface Person {
  gender: 'male' | 'female' | null;
  mixedRideOk: boolean;
}

/** Could these two share a car? Same known gender, or both fine with any. */
export function canShareWith(a: Person, b: Person): boolean {
  if (a.gender && a.gender === b.gender) return true;
  return a.mixedRideOk && b.mixedRideOk;
}

function personOf(snap: FirebaseFirestore.DocumentSnapshot): Person {
  const g = snap.get('gender');
  return { gender: g === 'male' || g === 'female' ? g : null, mixedRideOk: snap.get('mixedRideOk') === true };
}

interface RouteRow extends SavedRoute {
  routeId: string;
}

/** Every real saved route with alerts on, one per document. */
async function savedRoutes(): Promise<RouteRow[]> {
  // shortcut: full collection-group scan, as getTravelAreas and notifyDailyRouteMatches do; same ceiling (a few thousand routes).
  const snap = await db.collectionGroup('dailyRoutes').get();
  return snap.docs.flatMap((d) => {
    if (d.get('notify') === false) return [];
    const r = parseRoute(d.ref.parent.parent?.id, d.data());
    return r ? [{ ...r, routeId: d.id }] : [];
  });
}

/** Other people's routes near both ends, one route per person. */
export function matesFor(routes: RouteRow[], from: LatLng, to: LatLng, callerUid: string): RouteRow[] {
  const seen = new Set<string>();
  return routes.filter((r) => {
    if (r.uid === callerUid || seen.has(r.uid)) return false;
    if (km(r.pickup, from) > SAME_WAY_KM || km(r.dropoff, to) > SAME_WAY_KM) return false;
    seen.add(r.uid);
    return true;
  });
}

export const getRouteMates = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const p = z.object({ from: point, to: point }).safeParse(req.data);
  if (!p.success) invalid('Invalid route.');
  await rateLimit(uid, 'routeMates', 20, 60);

  const candidates = matesFor(await savedRoutes(), p.data.from, p.data.to, uid);
  if (candidates.length === 0) return { mates: [] };
  const snaps = await db.getAll(db.doc(`users/${uid}`), ...candidates.map((r) => db.doc(`users/${r.uid}`)));
  const me = personOf(snaps[0]!);
  const byUid = new Map(snaps.slice(1).map((s) => [s.id, s]));

  const mates = candidates.flatMap((r) => {
    const s = byUid.get(r.uid);
    if (!s?.exists || s.get('banned') === true) return [];
    const them = personOf(s);
    if (!canShareWith(me, them)) return [];
    return [{
      id: r.routeId,
      firstName: firstNameOf(s.get('name') ?? s.get('displayName')),
      gender: them.gender,
      fromArea: areaLabel(r.pickup.address),
      toArea: areaLabel(r.dropoff.address),
      time: r.time,
    }];
  });
  return { mates: mates.slice(0, MAX_MATES) };
});

const inviteSchema = z.object({
  tripId: docId,
  /** Saved-route ids from getRouteMates. */
  mateIds: z.array(docId).max(MAX_INVITES).default([]),
  /** Anyone by username, route or not (fleet usernames: 3-7 characters). */
  usernames: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
}).refine((d) => d.mateIds.length + d.usernames.length > 0, 'Choose someone to ask.');

export const inviteRouteMates = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const p = inviteSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid invite.');
  const { tripId, mateIds, usernames } = p.data;
  await rateLimit(uid, 'inviteRouteMates', 5, 60);

  const tripRef = db.doc(`trips/${tripId}`);
  const trip = await tripRef.get();
  if (!trip.exists || trip.get('passengerId') !== uid || trip.get('pool') !== true) {
    throw new HttpsError('permission-denied', 'You can only invite people into your own shared ride.');
  }
  const code = trip.get('shareCode') as string | undefined;
  if (!code || !INVITABLE.has(trip.get('status'))) {
    throw new HttpsError('failed-precondition', 'This ride is not taking riders any more.');
  }
  const pickup = trip.get('pickup') as LatLng;
  const dropoff = trip.get('dropoff') as LatLng & { address?: string };
  const already = new Set((trip.get('invitedUids') as string[] | undefined) ?? []);
  const members = new Set((trip.get('poolMembers') as string[] | undefined) ?? [uid]);

  // Route mates are re-derived against the ride itself: the ids are only a selection.
  const wanted = new Set(mateIds);
  const fromRoutes = mateIds.length > 0
    ? matesFor((await savedRoutes()).filter((r) => wanted.has(r.routeId)), pickup, dropoff, uid).map((r) => r.uid)
    : [];
  const notFound: string[] = [];
  const fromNames: string[] = [];
  for (const name of usernames) {
    const u = await uidForUsername(name.replace(/^@/, ''));
    if (u) fromNames.push(u);
    else notFound.push(name);
  }
  const targets = [...new Set([...fromRoutes, ...fromNames])]
    .filter((u) => u !== uid && !already.has(u) && !members.has(u));
  if (targets.length === 0) return { invited: 0, notFound };

  const snaps = await db.getAll(db.doc(`users/${uid}`), ...targets.map((u) => db.doc(`users/${u}`)));
  const host = snaps[0]!;
  const me = personOf(host);
  const okUids = snaps.slice(1).filter((s) => s.exists && s.get('banned') !== true && canShareWith(me, personOf(s))).map((s) => s.id);
  if (okUids.length === 0) return { invited: 0, notFound };

  const hostName = firstNameOf(host.get('name') ?? host.get('displayName'), 'A rider');
  const soloFare = (trip.get('fare') as number | null) ?? (trip.get('offeredFare') as number);
  const perSeat = poolPerSeatFare(soloFare, Math.max(2, members.size + 1));
  const to = dropoff.address ? areaLabel(dropoff.address) : 'your place';

  await tripRef.update({ invitedUids: FieldValue.arrayUnion(...okUids) });
  await Promise.all(okUids.map((u) => notifyUser(
    u,
    `🚗 ${hostName} wants to share a ride with you`,
    `Going to ${to} — about PKR ${perSeat} a seat. Tap to see the car and join the sharing ride.`,
    'ride',
    { tripId, screen: 'pool-join', code },
  ).catch((err) => logger.warn('route-mate invite failed', { tripId, err: String(err) }))));
  logger.info('Route mates invited', { tripId, invited: okUids.length });
  return { invited: okUids.length, notFound };
});

/**
 * The sharing-ride requests waiting for this rider: rides somebody asked them
 * into that are still taking riders and that they have not joined or declined.
 */
export const getMyRideInvites = onCall(async (req) => {
  const { uid } = requireAuth(req);
  await rateLimit(uid, 'myRideInvites', 30, 60);
  // array-contains alone needs no composite index; the rest is filtered here.
  const snap = await db.collection('trips').where('invitedUids', 'array-contains', uid).limit(30).get();
  const invites = snap.docs.flatMap((d) => {
    const t = d.data();
    const members = (t.poolMembers as string[] | undefined) ?? [];
    if (t.pool !== true || !t.shareCode || !INVITABLE.has(t.status)) return [];
    if (members.includes(uid) || members.length >= MAX_POOL_RIDERS) return [];
    const soloFare = (t.fare as number | null) ?? (t.offeredFare as number);
    const roster = rosterForTrip(t);
    const driver = t.driverInfo as { displayName?: string; vehicleLabel?: string } | undefined;
    return [{
      tripId: d.id,
      code: t.shareCode as string,
      hostName: roster[0]?.firstName ?? 'A rider',
      riders: members.length,
      fromArea: areaLabel((t.pickup?.address as string | undefined) ?? ''),
      toArea: areaLabel((t.dropoff?.address as string | undefined) ?? ''),
      rideType: t.rideType as string,
      perSeat: poolPerSeatFare(soloFare, members.length + 1),
      driver: driver?.displayName ? `${driver.displayName}${driver.vehicleLabel ? ` · ${driver.vehicleLabel}` : ''}` : null,
    }];
  });
  return { invites };
});

/** "Not now": take this rider off a ride's invite list. */
export const declineRideInvite = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const p = z.object({ tripId: docId }).safeParse(req.data);
  if (!p.success) invalid('Invalid request.');
  await db.doc(`trips/${p.data.tripId}`).update({ invitedUids: FieldValue.arrayRemove(uid) }).catch(() => undefined);
  return { ok: true };
});
