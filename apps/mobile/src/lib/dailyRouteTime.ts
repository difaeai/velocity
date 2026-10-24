/**
 * The time on a saved daily route (users/{uid}/dailyRoutes), which is OPTIONAL.
 *
 * Stored as "HH:MM" (24-hour, Asia/Karachi wall clock) or `null` for "any
 * time". Null rather than a missing field because the routes are read with
 * orderBy('time'), and Firestore drops a document from an ordered query when the
 * field is absent — a null still sorts (first). The backend matcher reads
 * anything that is not an "HH:MM" string as "match at any hour" (see
 * backend/functions/src/dailyRoutes/index.ts → routeMatchesPool).
 */

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

/** "08:30" → "8:30 AM", "17:05" → "5:05 PM"; null or malformed → null (any time). */
export function clockLabel(time: string | null | undefined): string | null {
  const m = typeof time === 'string' ? HHMM_RE.exec(time) : null;
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A picked Date as the stored "HH:MM". */
export function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The Date a time picker should open on: the saved time today, or `fallback`. */
export function fromHHMM(time: string | null | undefined, fallback: Date): Date {
  const m = typeof time === 'string' ? HHMM_RE.exec(time) : null;
  if (!m) return fallback;
  const d = new Date(fallback);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}
