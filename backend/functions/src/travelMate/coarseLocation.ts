/**
 * Travel Partner profiles never say where someone is to closer than ~1 km.
 *
 * `travelMateProfiles/{uid}` is readable by every signed-in user — that is how
 * the swipe deck works — and the setup screen used to save the phone's GPS fix
 * at full precision, which is usually the person's home, next to their name,
 * photo, age and gender. The deck only needs it for "within N km", which two
 * decimal places (~1.1 km) answers just as well.
 *
 * New builds round before saving. This job rounds everything else: what older
 * builds keep writing until they update, and every profile saved before the fix
 * (its first run is the backfill).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';

type Point = { lat: number; lng: number };

/** Two decimal places, about 1.1 km. Null and malformed values pass through. */
export function coarseLocation(p: unknown): Point | null {
  if (!p || typeof p !== 'object') return null;
  const { lat, lng } = p as Partial<Point>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

// shortcut: reads every profile's location each hour — fine to ~20k profiles;
// past that, query by `lastActive` since the last run, or drop this job once no
// build older than the rounding one is still in use.
export const coarsenTravelMateLocations = onSchedule('every 1 hours', async () => {
  const snap = await db.collection('travelMateProfiles').select('location').get();
  const batch = db.batch();
  let n = 0;
  for (const doc of snap.docs) {
    const raw = doc.get('location') as Point | null | undefined;
    const coarse = coarseLocation(raw);
    if (!coarse || (coarse.lat === raw!.lat && coarse.lng === raw!.lng)) continue;
    batch.update(doc.ref, { location: coarse });
    if (++n === 450) break; // one batch per run; the rest go next hour
  }
  if (n) await batch.commit();
  if (n) logger.info('Coarsened Travel Partner locations', { count: n });
});
