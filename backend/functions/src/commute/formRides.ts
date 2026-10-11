/**
 * Turning a matched commute into an actual shared ride, every morning.
 * ----------------------------------------------------------------------------
 * `getCommuteMatches` tells a rider that four people take their route. That
 * answers "is sharing possible for me", and it is the half that was missing.
 * It does not get anybody into a car. This is that half.
 *
 * WHAT THIS DOES, AND WHY IT IS A NUDGE RATHER THAN A BOOKING
 * ----------------------------------------------------------
 * Ten minutes before a commute group's departure, everyone in it gets one push:
 * "your route is going now, N others are on it". Whoever taps first books the
 * shared ride through the ordinary booking flow; the others land on it and take
 * a seat through the ordinary join. Nothing here writes a trip.
 *
 * Auto-booking was the obvious alternative and it is a worse product:
 *
 *   - It spends money nobody confirmed this morning. A commute is a standing
 *     intention, not today's decision — somebody is on leave, somebody is ill,
 *     somebody already left. A ride booked for a rider who is not coming is a
 *     no-show, a driver out of pocket and a cancellation-fee argument, and it
 *     would teach exactly the people we most want sharing that the app books
 *     things behind their back.
 *   - It would need a third copy of the pool-trip write (createTrip has one,
 *     scheduledRides has its own for solo rides). Those copies drift, and the
 *     things that drift here are seat counts, gender tallies and money.
 *
 * And the nudge does not reintroduce the problem it exists to solve. The reason
 * on-the-spot pools fail is that two STRANGERS must want the same journey in
 * the same ten minutes. Here the group is already known — everyone in it
 * declared this exact journey in advance, and they are all being told at the
 * same moment. Coincidence is replaced by an appointment.
 *
 * WHAT IT NEVER DOES
 * ------------------
 *  - No names, no counts of who. The push says how many, exactly as
 *    `getCommuteMatches` does; a stranger's daily movements are not ours to
 *    broadcast.
 *  - Never twice in a day for the same rider. `lastNudgeDate` on the schedule
 *    is claimed before anything is sent, so an overlapping tick cannot double
 *    up and a crash mid-run cannot either.
 *  - Never to a rider already on a trip. Somebody with a ride in progress does
 *    not need to be told their route exists.
 *  - Never to a group of one. A nudge whose honest content is "nobody else is
 *    going your way" is a notification that costs a rider something and gives
 *    them nothing.
 * ----------------------------------------------------------------------------
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, FieldValue } from '../lib/firebase';
import { notifyUser } from '../lib/fcm';
import { commuteGroupFor } from './index';

/**
 * How long before departure the group is told.
 *
 * Long enough to get downstairs, short enough that the ride is the next thing
 * they do. Earlier than this and the first tapper's ten-minute gathering window
 * closes before anyone else is ready to leave.
 */
const NUDGE_LEAD_MIN = 10;
/** The width of the window a tick looks at — must exceed the cron interval. */
const NUDGE_WINDOW_MIN = 10;

/** Day, minutes-past-midnight and YYYY-MM-DD, in the only timezone we run in. */
export function karachiNow(at: Date = new Date()): {
  day: string; minutes: number; date: string;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = parseInt(get('hour'), 10) % 24;
  return {
    day: get('weekday').toLowerCase().slice(0, 3),
    minutes: hour * 60 + parseInt(get('minute'), 10),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** "08:30" → minutes past midnight. Null for anything malformed. */
function minutesOfDay(time: unknown): number | null {
  if (typeof time !== 'string') return null;
  const [h, m] = time.split(':');
  const hh = parseInt(h ?? '', 10);
  const mm = parseInt(m ?? '', 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

/**
 * Whether this schedule should be nudged on this tick.
 *
 * Pure, so the window arithmetic is testable without a clock or a database.
 * The departure has to fall inside [now + lead, now + lead + window), today has
 * to be one of its days, and today must not already have been claimed.
 */
export function isNudgeDue(args: {
  activeDays: string[];
  morningTime: string;
  active: boolean;
  lastNudgeDate: string | null;
  nowDay: string;
  nowMinutes: number;
  todayDate: string;
}): boolean {
  if (!args.active) return false;
  if (args.lastNudgeDate === args.todayDate) return false;
  if (!args.activeDays.includes(args.nowDay)) return false;

  const depart = minutesOfDay(args.morningTime);
  if (depart === null) return false;

  const from = args.nowMinutes + NUDGE_LEAD_MIN;
  return depart >= from && depart < from + NUDGE_WINDOW_MIN;
}

/** The sentence a rider gets. Counts only — never who. */
export function nudgeBody(others: number, females: number, males: number): string {
  const company =
    females > 0 && males === 0 ? `${females} ${females === 1 ? 'woman' : 'women'}`
      : males > 0 && females === 0 ? `${males} ${males === 1 ? 'man' : 'men'}`
        : `${others} ${others === 1 ? 'rider' : 'riders'}`;
  return `${company} on your route ${others === 1 ? 'is' : 'are'} leaving about now. `
    + 'Open Velocity to share a car — a seat costs a fraction of the whole fare.';
}

// ── runCommuteRideFormation (cron) ───────────────────────────────────────────

export const runCommuteRideFormation = onSchedule(
  { schedule: 'every 10 minutes', timeZone: 'Asia/Karachi' },
  async () => {
    const now = karachiNow();
    const snap = await db.collection('commuteSchedules').where('active', '==', true).get();
    if (snap.empty) return;

    let nudged = 0;
    let alone = 0;

    for (const doc of snap.docs) {
      const d = doc.data();
      if (!isNudgeDue({
        activeDays: Array.isArray(d.activeDays) ? d.activeDays : [],
        morningTime: (d.morningTime as string) ?? '',
        active: d.active === true,
        lastNudgeDate: (d.lastNudgeDate as string | null) ?? null,
        nowDay: now.day,
        nowMinutes: now.minutes,
        todayDate: now.date,
      })) continue;

      // Claim today up front, before anything is sent. An overlapping tick or a
      // crash halfway through must not be able to nudge the same rider twice —
      // a duplicate push about a ride they may already have booked is worse
      // than a missed one.
      await doc.ref.set(
        { lastNudgeDate: now.date, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );

      try {
        // Somebody already in a car does not need to be told their route runs.
        const userSnap = await db.doc(`users/${doc.id}`).get();
        if (userSnap.get('activeTripId')) continue;

        const group = await commuteGroupFor(doc.id);
        if (!group.mine) continue;

        // Only the people who travel TODAY. The group is matched over the whole
        // week, and "4 riders on your route" is a lie on the one day three of
        // them do not travel.
        const today = group.members.filter((m) => m.days.includes(now.day));
        if (today.length === 0) {
          alone += 1;
          continue;
        }

        await notifyUser(
          doc.id,
          `🛣️ Your route is going now`,
          nudgeBody(
            today.length,
            today.filter((m) => m.gender === 'female').length,
            today.filter((m) => m.gender === 'male').length,
          ),
          'ride',
        ).catch(() => {});
        nudged += 1;
      } catch (e) {
        // One rider's bad data must not stop the morning for everybody else.
        logger.warn('commute nudge failed', { uid: doc.id, error: String(e) });
      }
    }

    if (nudged > 0 || alone > 0) {
      logger.info('Commute ride formation tick', { nudged, alone, day: now.day });
    }
  },
);
