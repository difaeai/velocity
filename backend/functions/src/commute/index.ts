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
  const rounded = Math.round(m / 15) * 15;
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
