import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';

import { db, FieldValue } from '../lib/firebase';
import { requireRole, invalid } from '../lib/guards';

// ── upsertCommuteSchedule ─────────────────────────────────────────────────────

const UpsertSchema = z.object({
  homeAreaName:        z.string().trim().min(1).max(120),
  homeLat:             z.number().min(-90).max(90),
  homeLng:             z.number().min(-180).max(180),
  destinationAreaName: z.string().trim().min(1).max(120),
  destinationLat:      z.number().min(-90).max(90),
  destinationLng:      z.number().min(-180).max(180),
  morningTime:         z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'morningTime must be HH:MM'),
  eveningTime:         z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  activeDays:          z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1).max(7),
  genderPref:          z.enum(['male_only', 'female_only', 'any']),
  active:              z.boolean().optional().default(true),
});

export const upsertCommuteSchedule = onCall(async (req) => {
  // Any signed-in user (passenger role) may save a commute schedule.
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const p = UpsertSchema.safeParse(req.data);
  if (!p.success) invalid(p.error.issues[0]?.message ?? 'Invalid data.');
  const d = p.data;

  const homeGeohash = geohashForLocation([d.homeLat, d.homeLng]);
  const destGeohash = geohashForLocation([d.destinationLat, d.destinationLng]);

  await db.doc(`commuteSchedules/${uid}`).set(
    {
      uid,
      homeAreaName:        d.homeAreaName,
      homeGeohash,
      homeLat:             d.homeLat,
      homeLng:             d.homeLng,
      destinationAreaName: d.destinationAreaName,
      destinationGeohash:  destGeohash,
      destinationLat:      d.destinationLat,
      destinationLng:      d.destinationLng,
      morningTime:         d.morningTime,
      eveningTime:         d.eveningTime ?? null,
      activeDays:          d.activeDays,
      genderPref:          d.genderPref,
      active:              d.active ?? true,
      updatedAt:           FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { ok: true };
});

// ── deleteCommuteSchedule ─────────────────────────────────────────────────────

export const deleteCommuteSchedule = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  await db.doc(`commuteSchedules/${req.auth.uid}`).delete();
  return { ok: true };
});

// ── getCommuteDemand (driver) — fully anonymised ──────────────────────────────

const DemandSchema = z.object({
  lat:      z.number().min(-90).max(90),
  lng:      z.number().min(-180).max(180),
  radiusKm: z.number().min(0.5).max(15).default(5),
});

function roundTo15(time: string): string {
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const rounded = Math.ceil(m / 15) * 15;
  if (rounded === 60) return `${String(h + 1).padStart(2, '0')}:00`;
  return `${String(h).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`;
}

export const getCommuteDemand = onCall(async (req) => {
  const ctx = requireRole(req, 'driver');
  const p = DemandSchema.safeParse(req.data);
  if (!p.success) invalid('Invalid location data.');
  const { lat, lng, radiusKm } = p.data;

  // Fetch driver gender for demand filtering.
  const driverSnap = await db.doc(`drivers/${ctx.uid}`).get();
  const driverGender: string = driverSnap.exists ? (driverSnap.data()!.gender ?? 'unspecified') : 'unspecified';

  const radiusM = radiusKm * 1000;
  const bounds = geohashQueryBounds([lat, lng], radiusM);

  // Query active commute schedules whose HOME is near the driver.
  const snapshots = await Promise.all(
    bounds.map((b) =>
      db.collection('commuteSchedules')
        .where('active', '==', true)
        .where('homeGeohash', '>=', b[0])
        .where('homeGeohash', '<=', b[1])
        .get()
    )
  );

  // Aggregate: group by (roundedMorningTime, destinationAreaName)
  // NEVER include: uid, exact coords, exact home address.
  const slots = new Map<
    string,
    {
      time: string;
      destinationAreaName: string;
      count: number;
      genderBreakdown: { male: number; female: number; any: number };
    }
  >();

  const seen = new Set<string>();
  const today = new Date();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayName = dayNames[today.getDay()];

  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);

      const d = doc.data();

      // Precise distance.
      const distKm = distanceBetween([lat, lng], [d.homeLat as number, d.homeLng as number]);
      if (distKm > radiusKm) continue;

      // Only show demand for active days (today or upcoming).
      const activeDays: string[] = d.activeDays ?? [];
      if (!activeDays.includes(todayName)) continue;

      // Gender compatibility: hide schedules incompatible with driver gender.
      const pref = d.genderPref as string;
      const compatible =
        pref === 'any' ||
        (pref === 'male_only' && driverGender === 'male') ||
        (pref === 'female_only' && driverGender === 'female');
      if (!compatible) continue;

      const roundedTime = roundTo15(d.morningTime as string);
      const destName = d.destinationAreaName as string;
      const key = `${roundedTime}::${destName}`;

      const existing = slots.get(key) ?? {
        time: roundedTime,
        destinationAreaName: destName,
        count: 0,
        genderBreakdown: { male: 0, female: 0, any: 0 },
      };

      existing.count += 1;
      if (pref === 'male_only') existing.genderBreakdown.male += 1;
      else if (pref === 'female_only') existing.genderBreakdown.female += 1;
      else existing.genderBreakdown.any += 1;

      slots.set(key, existing);
    }
  }

  // Sort by time ascending.
  const demand = Array.from(slots.values()).sort((a, b) => a.time.localeCompare(b.time));

  return { demand };
});

// ── getCommuteMatches (rider) — the missing half ─────────────────────────────

/**
 * How many other riders take this rider's commute, and who they are by gender.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------
 * Commute schedules were write-only for riders. They were saved by riders and
 * read by exactly one thing — `getCommuteDemand`, which shows DRIVERS where the
 * demand is. So two women who both travel Gulberg → Blue Area at 08:30 every
 * weekday had no way of ever learning the other existed. The data to pair them
 * was sitting in the same collection the whole time.
 *
 * That gap is why shared rides struggle to form. A pool booked on the spot needs
 * two strangers to want the same journey within the same ten minutes, and in a
 * city with few riders online that almost never happens — the pool opens, nobody
 * joins, and the host pays the solo fare. Nobody loses money, but the saving the
 * app advertised never arrives, and a rider who sees that twice stops believing
 * in shared rides.
 *
 * A commute does not need simultaneity. It needs RECURRENCE: the same journey,
 * declared once, matched against everyone else who declared it. The matching
 * window becomes days wide instead of minutes wide, which is the difference
 * between a feature that works at our volume and one that needs Uber's.
 *
 * WHAT IS RETURNED, AND WHAT NEVER IS
 * -----------------------------------
 * Counts and area names. Never a uid, never a home address, never a coordinate,
 * never a name — the same discipline `getCommuteDemand` already applies to the
 * driver side, for the same reason: "four women take your route" is all a rider
 * needs in order to decide to share, and anything more identifies a stranger's
 * home and daily movements to somebody who has not met them.
 *
 * Pairing people up by name happens later and by consent, when a shared ride is
 * actually formed and each rider chooses to take a seat in it.
 * ----------------------------------------------------------------------------
 */

/** How close two homes must be to count as the same pickup area. */
const MATCH_HOME_RADIUS_KM = 3;
/** How close two destinations must be to count as the same journey. */
const MATCH_DEST_RADIUS_KM = 3;
/** How far apart two departure times may be and still share a car, in minutes. */
const MATCH_TIME_WINDOW_MIN = 30;

/** "08:30" to minutes past midnight. Null for anything malformed. */
function minutesOfDay(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const [h, m] = time.split(':');
  const hh = parseInt(h ?? '', 10);
  const mm = parseInt(m ?? '', 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/**
 * Whether two riders would accept each other's company.
 *
 * Both sides' preferences have to hold, not just the caller's. A woman who asked
 * for women only must not be counted as a match for a man simply because he is
 * open to anyone — her preference is the binding one for her seat, and counting
 * her would promise him a companion who will not share with him.
 */
function commuteGenderCompatible(
  myGender: string,
  myPref: string,
  theirGender: string,
  theirPref: string,
): boolean {
  const accepts = (pref: string, otherGender: string) =>
    pref === 'any'
    || (pref === 'male_only' && otherGender === 'male')
    || (pref === 'female_only' && otherGender === 'female');
  return accepts(myPref, theirGender) && accepts(theirPref, myGender);
}

/** A rider's own gender, for the both-sides compatibility test. */
async function riderGenderOf(uid: string): Promise<string> {
  const snap = await db.doc(`users/${uid}`).get();
  return (snap.exists ? (snap.data()!.gender as string | undefined) : undefined) ?? 'unspecified';
}

/**
 * Everyone who shares a rider's commute, as uids plus the two public facts.
 *
 * Lifted out of `getCommuteMatches` so the formation cron below runs the exact
 * same definition of "on this route". Two codepaths with two slightly different
 * ideas of who matches is how a rider gets told four people share their route
 * and then gets a ride offered to two of them.
 *
 * Returns uids because a caller that forms a ride needs to know WHO. The
 * callable strips them back out before anything reaches a client — see the
 * privacy note on this module.
 */
export async function commuteGroupFor(uid: string): Promise<{
  mine: FirebaseFirestore.DocumentData | null;
  members: {
    uid: string;
    gender: string;
    /** Days both this rider and the caller travel. */
    days: string[];
    /** Their departure, rounded to the quarter hour, for the slot view. */
    time: string;
    destinationAreaName: string;
  }[];
}> {
  const [mineSnap, meSnap] = await Promise.all([
    db.doc(`commuteSchedules/${uid}`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  if (!mineSnap.exists || mineSnap.get('active') !== true) {
    return { mine: null, members: [] };
  }
  const mine = mineSnap.data()!;
  const myGender = (meSnap.exists ? (meSnap.data()!.gender as string | undefined) : undefined)
    ?? 'unspecified';
  const myPref = (mine.genderPref as string) ?? 'any';
  const myTime = minutesOfDay(mine.morningTime);
  const myDays: string[] = Array.isArray(mine.activeDays) ? mine.activeDays : [];

  const bounds = geohashQueryBounds(
    [mine.homeLat as number, mine.homeLng as number],
    MATCH_HOME_RADIUS_KM * 1000,
  );
  const snapshots = await Promise.all(
    bounds.map((b) =>
      db.collection('commuteSchedules')
        .where('active', '==', true)
        .where('homeGeohash', '>=', b[0])
        .where('homeGeohash', '<=', b[1])
        .get()
    )
  );

  const members: {
    uid: string; gender: string; days: string[]; time: string; destinationAreaName: string;
  }[] = [];
  const seen = new Set<string>();

  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      if (doc.id === uid || seen.has(doc.id)) continue;
      seen.add(doc.id);
      const d = doc.data();

      // Same pickup area.
      if (distanceBetween(
        [mine.homeLat as number, mine.homeLng as number],
        [d.homeLat as number, d.homeLng as number],
      ) > MATCH_HOME_RADIUS_KM) continue;

      // Same destination — a shared car is one journey, not two that happen to
      // start together.
      if (distanceBetween(
        [mine.destinationLat as number, mine.destinationLng as number],
        [d.destinationLat as number, d.destinationLng as number],
      ) > MATCH_DEST_RADIUS_KM) continue;

      // Close enough in time to be the same car.
      const theirTime = minutesOfDay(d.morningTime);
      if (myTime === null || theirTime === null) continue;
      if (Math.abs(myTime - theirTime) > MATCH_TIME_WINDOW_MIN) continue;

      // At least one day both of them travel.
      const theirDays: string[] = Array.isArray(d.activeDays) ? d.activeDays : [];
      const sharedDays = myDays.filter((day) => theirDays.includes(day));
      if (sharedDays.length === 0) continue;

      // Both sides have to be willing. See `commuteGenderCompatible`.
      const theirGender = await riderGenderOf(doc.id);
      if (!commuteGenderCompatible(myGender, myPref, theirGender, (d.genderPref as string) ?? 'any')) {
        continue;
      }

      members.push({
        uid: doc.id,
        gender: theirGender,
        days: sharedDays,
        time: roundTo15(d.morningTime as string),
        destinationAreaName: (d.destinationAreaName as string) ?? 'their destination',
      });
    }
  }

  return { mine, members };
}

export const getCommuteMatches = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const group = await commuteGroupFor(uid);
  // No saved commute means nothing to match against — not an error, just an
  // empty answer the screen renders as its "save your route" prompt.
  if (!group.mine) {
    return {
      hasSchedule: false,
      total: 0,
      males: 0,
      females: 0,
      destinationAreaName: null,
      morningTime: null,
      days: [],
      slots: [],
    };
  }
  const mine = group.mine;

  /**
   * Reduce the group to what a client may see. `commuteGroupFor` knows the
   * uids; nothing below ever puts one in the response — see the privacy note
   * at the top of this section.
   */
  const matches = group.members;
  const slots = new Map<string, { time: string; destinationAreaName: string; count: number }>();
  for (const m of matches) {
    const key = `${m.time}::${m.destinationAreaName}`;
    const slot = slots.get(key)
      ?? { time: m.time, destinationAreaName: m.destinationAreaName, count: 0 };
    slot.count += 1;
    slots.set(key, slot);
  }

  // Which days of the caller's week actually have somebody else on them. A
  // rider who travels six days and has company on two should see that, not a
  // single number that implies every morning is covered.
  const dayCounts = new Map<string, number>();
  for (const m of matches) {
    for (const day of m.days) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  return {
    hasSchedule: true,
    total: matches.length,
    males: matches.filter((m) => m.gender === 'male').length,
    females: matches.filter((m) => m.gender === 'female').length,
    destinationAreaName: (mine.destinationAreaName as string) ?? null,
    morningTime: (mine.morningTime as string) ?? null,
    days: Array.from(dayCounts.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.count - a.count),
    slots: Array.from(slots.values()).sort((a, b) => a.time.localeCompare(b.time)),
  };
});
