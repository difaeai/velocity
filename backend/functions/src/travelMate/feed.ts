/**
 * Velocity – Travel Mate – getTravelMateFeed (callable, v2)
 * ----------------------------------------------------------------------------
 * Serves the swipe deck. Because security rules forbid clients from reading
 * other users' travelMateProfiles directly, ALL candidate data comes through
 * this function (Admin SDK). It applies every match rule server-side:
 *   - active === true, not self, not already swiped (and not in the client's
 *     current deck, via excludeUids)
 *   - MUTUAL gender compatibility (when enforceMutualGender)
 *   - route overlap: destination within discoveryRadiusKm (geohash proximity)
 *   - at least one overlapping commute day
 *   - ranked by closest departure time to the requester's
 *
 * Returns only minimal public card fields – never home address, never any
 * ride-identity data.
 *
 * Wire-up: export { getTravelMateFeed } from './travelMate/feed';
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const REGION = 'asia-south1';

const Input = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  // Cards already in the client's deck (not yet swiped) – exclude to avoid dupes.
  excludeUids: z.array(z.string()).max(200).default([]),
});

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function genderCompatible(
  myGender: string, myPref: string, candGender: string, candPref: string,
): boolean {
  const iWantThem = myPref === 'any' || myPref === candGender;
  const theyWantMe = candPref === 'any' || candPref === myGender;
  return iWantThem && theyWantMe;
}

export const getTravelMateFeed = onCall({ region: REGION }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { limit, excludeUids } = parsed.data;

  // 1) My profile (need gender/pref, destination geo, depart time, days).
  const meSnap = await db.doc(`travelMateProfiles/${uid}`).get();
  if (!meSnap.exists) {
    throw new HttpsError('failed-precondition', 'Set up your Travel Mate profile first.');
  }
  const me = meSnap.data()!;
  if (!me.destination?.lat || !me.destination?.lng) {
    throw new HttpsError('failed-precondition', 'Add your destination to start matching.');
  }

  // 2) Settings.
  const settings = (await db.doc('config/travelMateSettings').get()).data() || {};
  const radiusKm: number = settings.discoveryRadiusKm ?? 3;
  const enforceGender: boolean = settings.enforceMutualGender !== false;
  const radiusM = radiusKm * 1000;
  const center: [number, number] = [me.destination.lat, me.destination.lng];

  // 3) Exclusion set: me + already swiped + client's current deck.
  const swipedSnap = await db.collection(`travelMateProfiles/${uid}/swipes`).select().get();
  const excluded = new Set<string>([uid, ...excludeUids, ...swipedSnap.docs.map((d) => d.id)]);

  // 4) Geo query around my destination (geohash bounds), then precise filter.
  const bounds = geohashQueryBounds(center, radiusM);
  const snaps = await Promise.all(bounds.map(([start, end]) =>
    db.collection('travelMateProfiles')
      .orderBy('destination.geohash')
      .startAt(start)
      .endAt(end)
      .limit(50) // cap reads per bound; precise filter trims below
      .get(),
  ));

  const myDays: string[] = me.schedule?.days ?? [];
  const myDepart = me.schedule?.departTime ? toMinutes(me.schedule.departTime) : 0;

  type Card = {
    uid: string; displayName: string; photoURL: string | null;
    destinationName: string; departTime: string; returnTime: string;
    commonDays: string[]; distanceKm: number; ratingAvg: number; ratingCount: number;
    _rank: number;
  };
  const byId = new Map<string, Card>();

  for (const snap of snaps) {
    for (const doc of snap.docs) {
      if (byId.has(doc.id) || excluded.has(doc.id)) continue;
      const c = doc.data();

      if (c.active === false) continue;
      if (!c.destination?.lat || !c.destination?.lng) continue;

      // Precise radius (geohash bounds are approximate).
      const distKm = distanceBetween([c.destination.lat, c.destination.lng], center);
      if (distKm * 1000 > radiusM) continue;

      // Mutual gender.
      if (enforceGender &&
          !genderCompatible(me.gender, me.genderPreference, c.gender, c.genderPreference)) {
        continue;
      }

      // Schedule overlap (at least one shared commute day).
      const candDays: string[] = c.schedule?.days ?? [];
      const commonDays = candDays.filter((d) => myDays.includes(d));
      if (commonDays.length === 0) continue;

      // Rank: closeness of departure time (smaller = better).
      const candDepart = c.schedule?.departTime ? toMinutes(c.schedule.departTime) : 0;
      const rank = Math.abs(candDepart - myDepart);

      byId.set(doc.id, {
        uid: doc.id,
        displayName: c.displayName ?? 'Traveler',
        photoURL: c.photoURL ?? null,
        destinationName: c.destination.name ?? '',
        departTime: c.schedule?.departTime ?? '',
        returnTime: c.schedule?.returnTime ?? '',
        commonDays,
        distanceKm: Math.round(distKm * 10) / 10,
        ratingAvg: c.ratingAvg ?? 0,
        ratingCount: c.ratingCount ?? 0,
        _rank: rank,
      });
    }
  }

  const cards = [...byId.values()]
    .sort((a, b) => a._rank - b._rank || a.distanceKm - b.distanceKm)
    .slice(0, limit)
    .map(({ _rank, ...card }) => card); // strip internal rank

  return { candidates: cards, count: cards.length };
});
