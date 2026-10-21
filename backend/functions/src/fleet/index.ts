/**
 * Usernames, and the personal fleet built on top of them.
 * ----------------------------------------------------------------------------
 * A FLEET is the handful of people a rider actually travels with: neighbours on
 * the same morning run, colleagues going to the same office. Travel Partner
 * introduces strangers; a fleet is the people you already know, added by
 * username and kept.
 *
 * It exists for one reason — to fill a shared car BEFORE a driver is asked.
 * Today a host books, a driver accepts, and only then do seats fill, which is
 * why a shared ride so often arrives as a solo one. A fleet inverts that: the
 * host asks their circle first ("I'm going to Gulberg now, coming?"), the
 * people who say yes are seated, and the ride that reaches a driver is already
 * full. Nobody waits.
 *
 * NOTHING ABOUT A BOOKING IS REIMPLEMENTED HERE.
 * The fare comes from `sharedRideFare`, the four trip documents from
 * `writeTripDocuments`, every co-rider from `joinPoolTripAsRider` — the same
 * code paths a human booking uses, so the fixed per-seat fare, the gender
 * rules, the seat caps and the roster all apply unchanged. See
 * commute/formRides, which forms a ride from a matched group the same way; the
 * only difference is that this one is asked for by a person, not by a cron.
 *
 * WHY THE DATA IS SHAPED THE WAY IT IS
 * Incoming requests and pending asks are MIRRORED into per-user subcollections
 * (`fleets/{uid}/requests`, `fleets/{uid}/asks`) instead of being queried out
 * of a top-level collection, and the host's open ask is remembered by id on
 * their own fleet document. A fleet is small, the mirrors are tiny, and none
 * of it needs a composite index — which matters, because every index in this
 * project is hand-declared.
 *
 * CLIENTS NEVER READ ANY OF THIS DIRECTLY. `fleets/**` is closed in the rules:
 * answering "who is in my fleet" means reading other people's `users/{uid}`
 * documents for a name and a photo, and those are owner-only. `getMyFleet` is
 * the one way in, and it returns only what a fleet-mate is entitled to see.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { notifyUser } from '../lib/fcm';
import { rateLimit } from '../lib/ratelimit';
import { hasRealCoords } from '../lib/poolRadius';
import { resolveSeatOccupant } from '../lib/seatGender';
import { sharedRideFare } from '../fare/sharedRideFare';
import { writeTripDocuments, generateShareCode } from '../trips/poolTripFactory';
import { joinPoolTripAsRider } from '../trips/poolShare';
import { broadcastTripToNearbyDrivers } from '../trips';

/** Nobody holds more than this many people in one fleet. */
const MAX_FLEET_MEMBERS = 24;
/** How long an "I'm going now, coming?" stays answerable. */
const ASK_TTL_MIN = 20;
/** Two saved routes count as the same run inside these. */
const SUGGEST_PICKUP_KM = 2;
const SUGGEST_DROPOFF_KM = 3;
/** Cap on the strangers offered as "people who take your route". */
const MAX_SUGGESTIONS = 12;

// ── Usernames ────────────────────────────────────────────────────────────────

/**
 * Validate and canonicalise a username.
 *
 * Three to seven characters, and SPECIAL CHARACTERS ARE ALLOWED — that was
 * asked for, and it is why this is a hand-written check rather than a
 * `[a-z0-9_]` regex. What is rejected is only what would break something:
 *
 *  - whitespace and control characters, because a name nobody can type back is
 *    not an address;
 *  - '/', because the slug becomes a Firestore document id and the Admin SDK
 *    reads a slash as a path separator (see lib/guards.docId);
 *  - '.' and '..', and anything wrapped in '__', which Firestore reserves.
 *
 * Uniqueness is case-insensitive: `Ali` and `ali` are one person's claim, so
 * the lowercase `slug` is what the registry is keyed on, while `username`
 * keeps the capitals the owner typed.
 *
 * Pure on purpose. The app validates with the same rules as you type (see
 * apps/mobile/app/username.tsx) and this is what the test pins.
 */
export function normalizeUsername(raw: unknown):
  | { ok: true; username: string; slug: string }
  | { ok: false; reason: string } {
  if (typeof raw !== 'string') return { ok: false, reason: 'Pick a username.' };
  const username = raw.trim();
  // Counted in code points, not UTF-16 units, so one emoji is one character.
  const length = [...username].length;
  if (length < 3) return { ok: false, reason: 'Usernames are at least 3 characters.' };
  if (length > 7) return { ok: false, reason: 'Usernames are at most 7 characters.' };
  // The control characters are the point: a name carrying a NUL or a newline
  // is not a name anybody can type back at you.
  // eslint-disable-next-line no-control-regex
  if (/[\s/\u0000-\u001f\u007f]/.test(username)) {
    return { ok: false, reason: 'No spaces or slashes in a username.' };
  }
  if (username === '.' || username === '..' || /^__.*__$/.test(username)) {
    return { ok: false, reason: 'That username is reserved.' };
  }
  return { ok: true, username, slug: username.toLowerCase() };
}

/**
 * Take a username, for good.
 *
 * The claim is a transaction over `usernames/{slug}`, so two people typing the
 * same name at the same moment cannot both get it. Changing one afterwards is
 * refused rather than supported: a username is how fleet-mates address each
 * other, and one that moves between people is a way to be added to the wrong
 * circle.
 */
export const claimUsername = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = normalizeUsername((req.data ?? {}).username);
  if (!parsed.ok) invalid(parsed.reason);
  const { username, slug } = parsed;

  const userRef = db.doc(`users/${uid}`);
  const slugRef = db.doc(`usernames/${slug}`);

  await db.runTransaction(async (tx) => {
    const [mine, taken] = await Promise.all([tx.get(userRef), tx.get(slugRef)]);
    const existing = mine.get('username') as string | undefined;
    if (existing && existing.toLowerCase() !== slug) {
      throw new HttpsError('failed-precondition', `You are already @${existing}.`);
    }
    if (taken.exists && taken.get('uid') !== uid) {
      throw new HttpsError('already-exists', `@${username} is already taken.`);
    }
    tx.set(slugRef, { uid, username, createdAt: FieldValue.serverTimestamp() });
    tx.set(userRef, { username, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  logger.info('Username claimed', { uid, slug });
  return { ok: true, username };
});

/** The uid behind a username, or null. Case-insensitive, like the claim. */
async function uidForUsername(raw: string): Promise<string | null> {
  const parsed = normalizeUsername(raw);
  if (!parsed.ok) return null;
  const snap = await db.doc(`usernames/${parsed.slug}`).get();
  return snap.exists ? ((snap.get('uid') as string | null) ?? null) : null;
}

// ── The fleet itself ─────────────────────────────────────────────────────────

const PointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(1).max(160),
});
type Point = z.infer<typeof PointSchema>;

const RouteSchema = z.object({ pickup: PointSchema, dropoff: PointSchema });

/**
 * Where this rider goes. Saved before anyone can be added, because "people who
 * take your route" means nothing until we know what the route is — and because
 * a fleet of people going nowhere near each other cannot share a car.
 */
export const setFleetRoute = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = RouteSchema.safeParse(req.data);
  if (!parsed.success) invalid('Pick where you start and where you go.');
  const { pickup, dropoff } = parsed.data;
  // (0,0) is what an unresolved geocode looks like, and a route there matches
  // every other broken route in the country — commuteSchedules filled up with
  // exactly this.
  if (!hasRealCoords(pickup.lat, pickup.lng) || !hasRealCoords(dropoff.lat, dropoff.lng)) {
    invalid('We could not place one of those addresses on the map. Try picking it again.');
  }

  await db.doc(`fleets/${uid}`).set({
    uid,
    pickup,
    dropoff,
    pickupGeohash: geohashForLocation([pickup.lat, pickup.lng]),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

/** The bits of a person a fleet-mate is allowed to see. */
interface Person {
  uid: string;
  username: string | null;
  name: string;
  photoURL: string | null;
}

async function peopleFor(uids: string[]): Promise<Person[]> {
  if (uids.length === 0) return [];
  const snaps = await db.getAll(...uids.map((u) => db.doc(`users/${u}`)));
  return snaps.filter((s) => s.exists).map((s) => ({
    uid: s.id,
    username: (s.get('username') as string | null) ?? null,
    name: (s.get('name') as string | undefined)
      ?? (s.get('displayName') as string | undefined) ?? 'Rider',
    photoURL: (s.get('photoURL') as string | null) ?? null,
  }));
}

/** A rider's own display name, however their profile happens to spell it. */
async function nameOf(uid: string): Promise<string> {
  const snap = await db.doc(`users/${uid}`).get();
  return (snap.get('name') as string | undefined)
    ?? (snap.get('displayName') as string | undefined) ?? 'A rider';
}

/**
 * Ask somebody to join your fleet.
 *
 * It is a REQUEST, not an add: being in somebody's fleet means they can push a
 * ride invitation at you, so it takes a yes. The message rides along because
 * "@ahmed wants you in his fleet" from a username you half-recognise is not
 * enough to answer on.
 */
export const sendFleetRequest = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({
    username: z.string().min(1).max(32),
    message: z.string().trim().max(200).optional(),
  }).safeParse(req.data);
  if (!parsed.success) invalid('Enter a username.');

  // Every call pushes a notification to somebody else's phone.
  await rateLimit(uid, 'sendFleetRequest', 10, 3600);

  const targetUid = await uidForUsername(parsed.data.username);
  if (!targetUid) throw new HttpsError('not-found', 'No rider has that username.');
  if (targetUid === uid) invalid('That is you.');

  const mineSnap = await db.doc(`fleets/${uid}`).get();
  if (!mineSnap.exists || !mineSnap.get('pickup')) {
    throw new HttpsError('failed-precondition', 'Save where you travel before adding people.');
  }
  const members = (mineSnap.get('members') as string[] | undefined) ?? [];
  if (members.includes(targetUid)) invalid('They are already in your fleet.');
  if (members.length >= MAX_FLEET_MEMBERS) {
    throw new HttpsError('failed-precondition', `A fleet holds up to ${MAX_FLEET_MEMBERS} people.`);
  }

  // Keyed by sender, so asking twice overwrites instead of stacking up — and
  // asking again while the first is still waiting does not ping them again.
  const requestRef = db.doc(`fleets/${targetUid}/requests/${uid}`);
  const alreadyWaiting = (await requestRef.get()).exists;
  await requestRef.set({
    fromUid: uid,
    message: parsed.data.message ?? '',
    createdAt: FieldValue.serverTimestamp(),
  });
  if (alreadyWaiting) return { ok: true };

  await notifyUser(
    targetUid,
    '🚘 Join my fleet',
    `${await nameOf(uid)} travels your way and wants you in their fleet — `
    + 'you would get first offer of a seat.',
    'ride',
    { route: '/passenger/fleet' },
  ).catch(() => {});

  return { ok: true };
});

/**
 * Answer a request. Accepting makes the two of you fleet-mates BOTH ways.
 *
 * Deliberately mutual: the point of a fleet is a circle that can offer each
 * other seats, and a one-directional edge would let the person who asked
 * invite you while you could never invite them.
 */
export const respondFleetRequest = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({ fromUid: docId, accept: z.boolean() }).safeParse(req.data);
  if (!parsed.success) invalid('Say which request, and yes or no.');
  const { fromUid, accept } = parsed.data;

  const reqRef = db.doc(`fleets/${uid}/requests/${fromUid}`);
  const snap = await reqRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That request is no longer waiting.');
  await reqRef.delete();
  if (!accept) return { ok: true, accepted: false };

  const mineRef = db.doc(`fleets/${uid}`);
  const theirsRef = db.doc(`fleets/${fromUid}`);
  await db.runTransaction(async (tx) => {
    const [mine, theirs] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
    const mineMembers = (mine.get('members') as string[] | undefined) ?? [];
    const theirMembers = (theirs.get('members') as string[] | undefined) ?? [];
    if (mineMembers.length >= MAX_FLEET_MEMBERS || theirMembers.length >= MAX_FLEET_MEMBERS) {
      throw new HttpsError('failed-precondition', 'One of these fleets is full.');
    }
    tx.set(mineRef, {
      uid, members: FieldValue.arrayUnion(fromUid), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(theirsRef, {
      uid: fromUid, members: FieldValue.arrayUnion(uid), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await notifyUser(
    fromUid, '✅ Fleet joined',
    `${await nameOf(uid)} is in your fleet now. Offer them a seat next time you ride.`,
    'ride', { route: '/passenger/fleet' },
  ).catch(() => {});

  return { ok: true, accepted: true };
});

/** Leave somebody's fleet, or drop them from yours. Both sides, as adding was. */
export const removeFleetMember = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({ memberUid: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Say who.');
  const { memberUid } = parsed.data;

  const batch = db.batch();
  batch.set(db.doc(`fleets/${uid}`), {
    members: FieldValue.arrayRemove(memberUid), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.doc(`fleets/${memberUid}`), {
    members: FieldValue.arrayRemove(uid), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { ok: true };
});

/**
 * Riders whose saved route is near enough to yours to share a car.
 *
 * A geohash range over the pickup narrows it to the right part of the city in
 * one indexed read (single-field, automatic), and the destination is filtered
 * in memory on what comes back — the same two-step `commuteGroupFor` uses, for
 * the same reason: a shared car is one journey, not two that start together.
 */
async function suggestionsFor(
  uid: string,
  mine: FirebaseFirestore.DocumentData,
  exclude: Set<string>,
): Promise<Person[]> {
  const pickup = mine.pickup as Point;
  const dropoff = mine.dropoff as Point | undefined;
  if (!dropoff) return [];

  const bounds = geohashQueryBounds([pickup.lat, pickup.lng], SUGGEST_PICKUP_KM * 1000);
  const snaps = await Promise.all(bounds.map((b) =>
    db.collection('fleets')
      .where('pickupGeohash', '>=', b[0])
      .where('pickupGeohash', '<=', b[1])
      .limit(60)
      .get()));

  const hits: string[] = [];
  const seen = new Set<string>();
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (doc.id === uid || exclude.has(doc.id) || seen.has(doc.id)) continue;
      seen.add(doc.id);
      const their = doc.data();
      const tp = their.pickup as Point | undefined;
      const td = their.dropoff as Point | undefined;
      if (!tp || !td) continue;
      if (distanceBetween([pickup.lat, pickup.lng], [tp.lat, tp.lng]) > SUGGEST_PICKUP_KM) continue;
      if (distanceBetween([dropoff.lat, dropoff.lng], [td.lat, td.lng]) > SUGGEST_DROPOFF_KM) continue;
      hits.push(doc.id);
      if (hits.length >= MAX_SUGGESTIONS) break;
    }
  }
  return peopleFor(hits);
}

/**
 * Everything the fleet screen draws, in one call.
 *
 * A callable rather than a listener because none of it is client-readable:
 * members, requesters and suggestions are other people's profiles, and the
 * rules keep those owner-only.
 */
export const getMyFleet = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const [meSnap, fleetSnap, reqSnap, askSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc(`fleets/${uid}`).get(),
    db.collection(`fleets/${uid}/requests`).limit(50).get(),
    db.collection(`fleets/${uid}/asks`).limit(20).get(),
  ]);

  const fleet = fleetSnap.exists ? fleetSnap.data()! : null;
  const members = (fleet?.members as string[] | undefined) ?? [];
  const requesters = reqSnap.docs.map((d) => d.id);

  const [memberPeople, requestPeople] = await Promise.all([
    peopleFor(members),
    peopleFor(requesters),
  ]);
  const suggestions = fleet?.pickup
    ? await suggestionsFor(uid, fleet, new Set([...members, ...requesters]))
    : [];

  const now = Date.now();
  // Expired mirrors are swept as they are read: the ask they point at is dead,
  // each document is a few bytes, and this is cheaper than a cron whose only
  // job would be deleting a handful of rows a day.
  //
  // shortcut: a member who never opens this screen again keeps their expired
  // mirrors forever, and the `fleetAsks` document itself is never deleted at
  // all. Upgrade to a sweep inside the existing sweepStaleSharedRides schedule
  // when fleets are in daily use — not before, because an onSchedule function
  // that deletes twenty rows a day costs more than the rows.
  const stale = askSnap.docs.filter((d) => millis(d.get('expiresAt')) <= now);
  if (stale.length) await Promise.all(stale.map((d) => d.ref.delete().catch(() => undefined)));

  const inbox = askSnap.docs
    .filter((d) => millis(d.get('expiresAt')) > now)
    .map((d) => ({
      askId: d.id,
      hostUid: d.get('hostUid') as string,
      hostName: (d.get('hostName') as string) ?? 'A fleet-mate',
      dropoffAddress: (d.get('dropoffAddress') as string) ?? '',
      note: (d.get('note') as string) ?? '',
      accepted: d.get('accepted') === true,
      expiresAt: millis(d.get('expiresAt')),
    }));

  return {
    username: (meSnap.get('username') as string | null) ?? null,
    route: fleet?.pickup ? { pickup: fleet.pickup, dropoff: fleet.dropoff } : null,
    members: memberPeople,
    requests: reqSnap.docs.map((d) => ({
      fromUid: d.id,
      message: (d.get('message') as string) ?? '',
      person: requestPeople.find((p) => p.uid === d.id) ?? null,
    })),
    suggestions,
    inbox,
    hosted: await hostedAsk(fleet?.openAskId as string | undefined),
  };
});

/** Firestore Timestamp | nothing → epoch millis. */
function millis(value: unknown): number {
  const ts = value as { toMillis?: () => number } | undefined;
  return typeof ts?.toMillis === 'function' ? ts.toMillis() : 0;
}

/**
 * The ask this rider is hosting, if it is still open.
 *
 * Found by the id kept on their own fleet document rather than by a query, so
 * no composite index exists for one lookup per screen open.
 */
async function hostedAsk(askId: string | undefined) {
  if (!askId) return null;
  const snap = await db.doc(`fleetAsks/${askId}`).get();
  if (!snap.exists || snap.get('status') !== 'open') return null;
  if (millis(snap.get('expiresAt')) <= Date.now()) return null;
  return {
    askId: snap.id,
    dropoffAddress: ((snap.get('dropoff') as Point | undefined)?.address) ?? '',
    note: (snap.get('note') as string) ?? '',
    expiresAt: millis(snap.get('expiresAt')),
    accepted: await peopleFor((snap.get('acceptedUids') as string[] | undefined) ?? []),
  };
}

// ── "I'm going now — coming?" ────────────────────────────────────────────────

/**
 * The combined request. One push to the whole fleet, before any driver is
 * asked, so the seats go to people who said yes rather than to whoever happens
 * to find the ride afterwards.
 *
 * It expires. An unanswered "I'm leaving now" twenty minutes later is a lie,
 * and a stale one sitting in somebody's screen is how a rider ends up seated
 * on a car that left.
 */
export const askFleetForRide = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({
    dropoff: PointSchema.optional(),
    note: z.string().trim().max(160).optional(),
  }).safeParse(req.data);
  if (!parsed.success) invalid('Say where you are going.');

  const fleetSnap = await db.doc(`fleets/${uid}`).get();
  const fleet = fleetSnap.exists ? fleetSnap.data()! : null;
  if (!fleet?.pickup) throw new HttpsError('failed-precondition', 'Save where you travel first.');
  const members = (fleet.members as string[] | undefined) ?? [];
  if (members.length === 0) throw new HttpsError('failed-precondition', 'Your fleet is empty.');

  // One open ask at a time. Two live asks would let the same fleet-mate say
  // yes to two cars leaving at once.
  if (await hostedAsk(fleet.openAskId as string | undefined)) {
    throw new HttpsError('already-exists', 'You already have an open request to your fleet.');
  }

  const pickup = fleet.pickup as Point;
  const dropoff = parsed.data.dropoff ?? (fleet.dropoff as Point | undefined);
  if (!dropoff || !hasRealCoords(dropoff.lat, dropoff.lng)) {
    invalid('We could not place that destination.');
  }

  const hostName = await nameOf(uid);
  const note = parsed.data.note ?? '';
  const expiresAt = new Date(Date.now() + ASK_TTL_MIN * 60_000);
  const askRef = db.collection('fleetAsks').doc();

  const batch = db.batch();
  batch.set(askRef, {
    hostUid: uid, hostName, pickup, dropoff, note,
    memberUids: members, acceptedUids: [], status: 'open', tripId: null,
    expiresAt, createdAt: FieldValue.serverTimestamp(),
  });
  batch.set(db.doc(`fleets/${uid}`), { openAskId: askRef.id }, { merge: true });
  for (const m of members) {
    batch.set(db.doc(`fleets/${m}/asks/${askRef.id}`), {
      hostUid: uid, hostName,
      dropoffAddress: dropoff.address,
      note,
      accepted: false,
      expiresAt, createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  await Promise.all(members.map((m) => notifyUser(
    m,
    `🚗 ${hostName} is going to ${dropoff.address}`,
    'Coming along? Say yes and your seat is on the same car — a share costs a fraction of the fare.',
    'ride',
    { route: '/passenger/fleet' },
  ).catch(() => {})));

  return { ok: true, askId: askRef.id, expiresAt: expiresAt.getTime() };
});

/** A fleet-mate's yes or no. Yes only puts them on the list — the host books. */
export const respondFleetRideAsk = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({ askId: docId, accept: z.boolean() }).safeParse(req.data);
  if (!parsed.success) invalid('Say which request, and yes or no.');
  const { askId, accept } = parsed.data;

  const askRef = db.doc(`fleetAsks/${askId}`);
  const mirrorRef = db.doc(`fleets/${uid}/asks/${askId}`);

  const hostUid = await db.runTransaction(async (tx) => {
    const snap = await tx.get(askRef);
    if (!snap.exists || snap.get('status') !== 'open') {
      throw new HttpsError('failed-precondition', 'That ride has already gone.');
    }
    if (millis(snap.get('expiresAt')) <= Date.now()) {
      throw new HttpsError('failed-precondition', 'That request has expired.');
    }
    if (!((snap.get('memberUids') as string[] | undefined) ?? []).includes(uid)) {
      throw new HttpsError('permission-denied', 'That request was not sent to you.');
    }
    tx.update(askRef, {
      acceptedUids: accept ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid),
    });
    if (accept) tx.set(mirrorRef, { accepted: true }, { merge: true });
    else tx.delete(mirrorRef);
    return snap.get('hostUid') as string;
  });

  if (accept) {
    await notifyUser(
      hostUid, '🙋 Coming with you',
      `${await nameOf(uid)} wants a seat. Book when your fleet is in.`,
      'ride', { route: '/passenger/fleet' },
    ).catch(() => {});
  }
  return { ok: true, accepted: accept };
});

/** Drop an ask without booking it. */
export const cancelFleetRideAsk = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({ askId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Say which request.');
  const askRef = db.doc(`fleetAsks/${parsed.data.askId}`);
  const snap = await askRef.get();
  if (!snap.exists || snap.get('hostUid') !== uid) {
    throw new HttpsError('permission-denied', 'That is not your request.');
  }
  await closeAsk(askRef, snap.data()!, 'cancelled', null);
  return { ok: true };
});

/** Mark an ask finished and clear the mirrors it put in members' screens. */
async function closeAsk(
  askRef: FirebaseFirestore.DocumentReference,
  ask: FirebaseFirestore.DocumentData,
  status: 'booked' | 'cancelled',
  tripId: string | null,
) {
  const batch = db.batch();
  batch.update(askRef, { status, tripId });
  batch.set(db.doc(`fleets/${ask.hostUid as string}`), { openAskId: null }, { merge: true });
  for (const m of ((ask.memberUids as string[] | undefined) ?? [])) {
    batch.delete(db.doc(`fleets/${m}/asks/${askRef.id}`));
  }
  await batch.commit();
}

/**
 * Book the ride the fleet already agreed to.
 *
 * The host's trip is written first — fare, seat gender and the four documents
 * all from the shared booking code — and then every rider who said yes is
 * seated with `joinPoolTripAsRider`, the same function the app's own join
 * button calls. Only once the car is full does it go out to drivers, which is
 * the whole point: a driver sees a four-seat job, not a solo one that might
 * grow.
 *
 * A rider who cannot be seated (the gender rules, a trip of their own already
 * running) is skipped and counted back to the host rather than failing the
 * booking for everybody.
 */
export const bookFleetRide = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({
    askId: docId,
    rideType: z.enum(['bike', 'auto', 'mini', 'ac', 'comfort', 'xl']).optional(),
  }).safeParse(req.data);
  if (!parsed.success) invalid('Say which request.');
  const rideType = parsed.data.rideType ?? 'mini';

  const askRef = db.doc(`fleetAsks/${parsed.data.askId}`);
  const askSnap = await askRef.get();
  if (!askSnap.exists || askSnap.get('hostUid') !== uid) {
    throw new HttpsError('permission-denied', 'That is not your request.');
  }
  if (askSnap.get('status') !== 'open') {
    throw new HttpsError('failed-precondition', 'That request has already been booked.');
  }
  const ask = askSnap.data()!;
  const pickup = ask.pickup as Point;
  const dropoff = ask.dropoff as Point;
  const crew = ((ask.acceptedUids as string[] | undefined) ?? []).filter((u) => u !== uid);

  const quote = await sharedRideFare(rideType, pickup, dropoff);
  const shareCode = generateShareCode();
  const tripRef = db.collection('trips').doc();

  await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.doc(`users/${uid}`));
    const seat = resolveSeatOccupant(userSnap.get('gender'), null);
    writeTripDocuments(tx, tripRef, {
      uid,
      rideType,
      fare: quote.fare,
      seats: 1,
      passengerGender: seat.seatGender,
      bookedForOther: seat.bookedForOther,
      pool: true,
      // Private: the seats are spoken for by the fleet, and a stranger finding
      // it would be joining a car that is already full.
      poolVisibility: 'private',
      shareCode,
      paymentMethod: 'cash',
      paymentMethods: ['cash'],
      pickup,
      dropoff,
      passengerName: (userSnap.get('name') as string | undefined)
        ?? (userSnap.get('displayName') as string | undefined),
      passengerRating: userSnap.get('rating') as number | undefined,
      passengerRatingCount: userSnap.get('ratingCount') as number | undefined,
      coRiderRating: userSnap.get('coRiderRating') as number | undefined,
      coRiderRatingCount: userSnap.get('coRiderRatingCount') as number | undefined,
      // So support can tell at a glance why this car arrived full.
      provenance: { fleetFormed: true, fleetAskId: askRef.id },
    });
  });

  const seated: string[] = [];
  let skipped = 0;
  for (const member of crew) {
    try {
      await joinPoolTripAsRider(member, tripRef);
      seated.push(member);
    } catch (e) {
      skipped += 1;
      logger.warn('fleet member could not be seated', {
        tripId: tripRef.id, member, error: String(e),
      });
    }
  }

  await closeAsk(askRef, ask, 'booked', tripRef.id);

  // Drivers are told LAST, deliberately — see the note on this function.
  broadcastTripToNearbyDrivers(tripRef.id, pickup, true, rideType, { fare: quote.fare })
    .catch((err) => logger.error('fleet broadcast failed', { tripId: tripRef.id, err }));

  await Promise.all(seated.map((m) => notifyUser(
    m, '🚗 Your fleet ride is booked',
    `You have a seat to ${dropoff.address}. Open it to see the car and your share of the fare.`,
    'ride', { route: `/passenger/trip/${tripRef.id}`, tripId: tripRef.id },
  ).catch(() => {})));

  return { ok: true, tripId: tripRef.id, seated: seated.length, skipped };
});

/**
 * Invite the fleet onto a ride that is ALREADY booked.
 *
 * The other door into the same idea: a host who booked through the ordinary
 * flow and then remembered their circle. Nobody is seated here — they are sent
 * the invite and join the usual way — so no join rule is bypassed by a
 * shortcut from this side.
 */
export const inviteFleetToRide = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const parsed = z.object({ tripId: docId }).safeParse(req.data);
  if (!parsed.success) invalid('Say which ride.');

  const [tripSnap, fleetSnap] = await Promise.all([
    db.doc(`trips/${parsed.data.tripId}`).get(),
    db.doc(`fleets/${uid}`).get(),
  ]);
  if (!tripSnap.exists || tripSnap.get('passengerId') !== uid) {
    throw new HttpsError('permission-denied', 'That is not your ride.');
  }
  if (tripSnap.get('pool') !== true) {
    throw new HttpsError('failed-precondition', 'Only a shared ride can take other riders.');
  }
  const members = (fleetSnap.get('members') as string[] | undefined) ?? [];
  if (members.length === 0) throw new HttpsError('failed-precondition', 'Your fleet is empty.');

  const shareCode = tripSnap.get('shareCode') as string | undefined;
  const name = await nameOf(uid);
  const where = (tripSnap.get('dropoff') as Point | undefined)?.address ?? 'their destination';

  await Promise.all(members.map((m) => notifyUser(
    m, `🚗 ${name} has a seat going to ${where}`,
    'They are in your fleet and their shared ride has room. Tap to take a seat.',
    'ride',
    shareCode ? { route: `/passenger/pool-join/${shareCode}`, shareCode } : { route: '/passenger/fleet' },
  ).catch(() => {})));

  return { ok: true, invited: members.length };
});
