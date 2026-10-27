/**
 * Turning a matched commute into an actual shared ride, every morning.
 * ----------------------------------------------------------------------------
 * `getCommuteMatches` tells a rider that four people take their route. That
 * answers "is sharing possible for me" and gets nobody into a car. This is the
 * half that gets them into one.
 *
 * TWO PATHS, AND THE RIDER CHOOSES WHICH
 * --------------------------------------
 * Ten minutes before a group's departure:
 *
 *   autoBook ON  → the ride is BOOKED. The first member of the group whose
 *                  departure comes up creates the shared ride; everyone else
 *                  who opted in is joined onto that same ride as their own
 *                  time arrives. Nobody has to open the app.
 *   autoBook OFF → one push ("N riders on your route are leaving about now").
 *                  Whoever taps books through the ordinary flow and the rest
 *                  join through the ordinary join.
 *
 * Both paths coexist deliberately: a rider who has not asked us to spend their
 * money is still told their route is running.
 *
 * WHY AUTO-BOOKING IS SAFE TO DO AT ALL
 * -------------------------------------
 * Booking on somebody's behalf is the one thing in this codebase that spends a
 * rider's money without them touching the app that morning, so it is fenced:
 *
 *  - OPT-IN, per schedule, off by default, revocable from the commute screen.
 *  - A fresh booking sits at `requested`, where cancelling is FREE (see
 *    domain/cancellation — no driver has committed yet). A rider who is on
 *    leave loses nothing by cancelling when the push lands.
 *  - STRIKES. If the ride we booked yesterday ended up cancelled, that is a
 *    strike; at `MAX_AUTO_STRIKES` auto-booking switches itself off and the
 *    rider is told. We do not keep booking cars for somebody who keeps not
 *    wanting them — that is how a convenience turns into a cancellation-fee
 *    argument and a deleted app.
 *  - Never when the rider already has an active trip.
 *  - Never twice in a day: `lastNudgeDate` is claimed before anything happens.
 *
 * ONE RIDE PER GROUP, NOT ONE PER RIDER
 * -------------------------------------
 * The hard part. Group members depart up to half an hour apart, so they do not
 * all come due on the same tick — and every one of them computes the same
 * group. Without a shared claim, four riders would create four pools and share
 * nothing.
 *
 * So the group gets a canonical key (its members' uids, sorted, hashed — every
 * member computes the identical key) and a claim document per key per day. The
 * first member due creates the ride and records it; everyone after joins the
 * recorded one. The claim is written in the same transaction that reads it, so
 * two simultaneous ticks cannot both win.
 *
 * The ride itself is created through `writeTripDocuments` and joined through
 * `joinPoolTripAsRider` — the same code paths the app uses, so the fixed fare,
 * the gender rules, the seat limits and the roster all apply exactly as they do
 * to a human booking. Nothing here reimplements any of that.
 * ----------------------------------------------------------------------------
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { createHash } from 'crypto';

import { db, FieldValue, SCHEDULE_REGION } from '../lib/firebase';
import { notifyUser } from '../lib/fcm';
import { resolveSeatOccupant } from '../lib/seatGender';
import { sharedRideFare } from '../fare/sharedRideFare';
import { writeTripDocuments, generateShareCode } from '../trips/poolTripFactory';
import { joinPoolTripAsRider } from '../trips/poolShare';
import { broadcastTripToNearbyDrivers } from '../trips';
import { commuteGroupFor } from './index';

/**
 * How long before departure the group is acted on.
 *
 * Long enough to get downstairs, short enough that the ride is the next thing
 * they do. Earlier than this and the pool's ten-minute gathering window closes
 * before anyone is ready to leave.
 */
const NUDGE_LEAD_MIN = 10;
/** The width of the window a tick looks at — must exceed the cron interval. */
const NUDGE_WINDOW_MIN = 10;

/** Cancelled auto-booked rides before auto-booking turns itself off. */
export const MAX_AUTO_STRIKES = 2;

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
 * Whether this schedule should be acted on this tick.
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

/**
 * The key every member of a group computes identically.
 *
 * Sorted so membership, not discovery order, decides it; hashed so the id stays
 * a sane length and carries no uids in a path that ends up in logs.
 */
export function groupKey(uids: string[], date: string): string {
  const canonical = [...new Set(uids)].sort().join('|');
  return `${createHash('sha1').update(canonical).digest('hex').slice(0, 20)}_${date}`;
}

/** The sentence a rider gets when they have NOT opted into auto-booking. */
export function nudgeBody(others: number, females: number, males: number): string {
  const company =
    females > 0 && males === 0 ? `${females} ${females === 1 ? 'woman' : 'women'}`
      : males > 0 && females === 0 ? `${males} ${males === 1 ? 'man' : 'men'}`
        : `${others} ${others === 1 ? 'rider' : 'riders'}`;
  return `${company} on your route ${others === 1 ? 'is' : 'are'} leaving about now. `
    + 'Open Velocity to share a car — a seat costs a fraction of the whole fare.';
}

/**
 * Did the ride we booked for this rider last time end up cancelled?
 *
 * One read, no index: the schedule remembers the trip it booked, so we look at
 * that one document rather than querying the rider's history.
 */
async function lastAutoRideWasCancelled(lastAutoTripId: unknown): Promise<boolean> {
  if (typeof lastAutoTripId !== 'string' || !lastAutoTripId) return false;
  const snap = await db.doc(`trips/${lastAutoTripId}`).get();
  return snap.exists && snap.get('status') === 'cancelled';
}

/**
 * Create the group's shared ride, with this rider as its host.
 *
 * Everything that makes a booking correct is borrowed, not rebuilt: the fare
 * comes from `sharedRideFare` (fixed, server-computed, nobody can negotiate
 * it), the seat's gender from `resolveSeatOccupant`, and the four documents
 * from `writeTripDocuments`. A commuter is booking for themselves, so
 * `bookedFor` is 'self'.
 */
async function bookRideForHost(args: {
  uid: string;
  schedule: FirebaseFirestore.DocumentData;
  rideType: string;
}): Promise<string> {
  const { uid, schedule, rideType } = args;
  const pickup = {
    lat: schedule.homeLat as number,
    lng: schedule.homeLng as number,
    address: (schedule.homeAreaName as string) ?? 'Home',
  };
  const dropoff = {
    lat: schedule.destinationLat as number,
    lng: schedule.destinationLng as number,
    address: (schedule.destinationAreaName as string) ?? 'Work',
  };

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
      // Public: the whole point is that the rest of the group — and anyone else
      // going the same way — can find and join it.
      poolVisibility: 'public',
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
      // So support can tell at a glance why a rider has a trip they do not
      // remember booking, and so the strike check can find it tomorrow.
      provenance: { autoBooked: true, commuteFormed: true },
    });
  });

  broadcastTripToNearbyDrivers(tripRef.id, pickup, true, rideType, { fare: quote.fare })
    .catch((err) => logger.error('auto-book broadcast failed', { tripId: tripRef.id, err }));

  return tripRef.id;
}

// ── runCommuteRideFormation (cron) ───────────────────────────────────────────

export const runCommuteRideFormation = onSchedule(
  { schedule: 'every 10 minutes', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION },
  async () => {
    const now = karachiNow();
    const snap = await db.collection('commuteSchedules').where('active', '==', true).get();
    if (snap.empty) return;

    let booked = 0;
    let joined = 0;
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

      // Claim today up front, before anything is sent or booked. An
      // overlapping tick or a crash halfway through must not be able to book
      // the same rider two cars.
      await doc.ref.set(
        { lastNudgeDate: now.date, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );

      try {
        // Somebody already in a car needs neither a ride nor a reminder.
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

        const wantsAuto = d.autoBook === true;

        if (!wantsAuto) {
          await notifyUser(
            doc.id,
            '🛣️ Your route is going now',
            nudgeBody(
              today.length,
              today.filter((m) => m.gender === 'female').length,
              today.filter((m) => m.gender === 'male').length,
            ),
            'ride',
          ).catch(() => {});
          nudged += 1;
          continue;
        }

        // ── Auto-booking from here ────────────────────────────────────────
        // Yesterday's car went unused? That is a strike, and enough strikes
        // turns this off rather than booking another one.
        if (await lastAutoRideWasCancelled(d.lastAutoTripId)) {
          const strikes = ((d.autoBookStrikes as number) ?? 0) + 1;
          const give_up = strikes >= MAX_AUTO_STRIKES;
          await doc.ref.set({
            autoBookStrikes: strikes,
            ...(give_up ? { autoBook: false } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          if (give_up) {
            await notifyUser(
              doc.id,
              'Automatic booking switched off',
              'The last rides we booked for your route were cancelled, so we have stopped '
              + 'booking them. You can turn it back on from your daily route any time.',
              'ride',
            ).catch(() => {});
            continue;
          }
        }

        /**
         * The crew this ride is for: everybody in the group who opted in,
         * including this rider. Riders who did not opt in are not counted —
         * they get the nudge on their own tick and may join by hand.
         */
        const crew = [doc.id, ...today.filter((m) => m.autoBook).map((m) => m.uid)];
        const key = groupKey(crew, now.date);
        const claimRef = db.doc(`commuteRideClaims/${key}`);

        /**
         * Claim the group's ride for today, or find the one already claimed.
         * Read and write in one transaction so two ticks cannot both create a
         * ride for the same group.
         */
        const claim = await db.runTransaction(async (tx) => {
          const existing = await tx.get(claimRef);
          if (existing.exists) {
            return { tripId: (existing.get('tripId') as string | null) ?? null, mine: false };
          }
          tx.set(claimRef, {
            hostUid: doc.id,
            tripId: null,
            crew,
            date: now.date,
            createdAt: FieldValue.serverTimestamp(),
          });
          return { tripId: null, mine: true };
        });

        if (claim.mine) {
          // First one due: this rider hosts the ride.
          const rideType = (d.autoBookRideType as string) ?? 'mini';
          const tripId = await bookRideForHost({ uid: doc.id, schedule: group.mine, rideType });
          await claimRef.set({ tripId }, { merge: true });
          await doc.ref.set(
            { lastAutoTripId: tripId, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
          booked += 1;
          await notifyUser(
            doc.id,
            '🚗 Your shared ride is booked',
            `We booked your daily route and ${today.length} `
            + `${today.length === 1 ? 'rider' : 'riders'} may share it. `
            + 'Open it to see the fare, or cancel — it is free until a driver accepts.',
            'ride',
          ).catch(() => {});
        } else if (claim.tripId) {
          // Somebody already hosts today's ride: take a seat on it. Every gate
          // a human join runs applies here too — gender rules, seat limits,
          // the fixed per-seat fare.
          const outcome = await joinPoolTripAsRider(doc.id, db.doc(`trips/${claim.tripId}`));
          await doc.ref.set(
            { lastAutoTripId: claim.tripId, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
          joined += 1;
          await notifyUser(
            doc.id,
            outcome.pending ? '🙋 Asked for your seat' : '🚗 You have a seat on your route',
            outcome.pending
              ? 'Your usual route is going and we asked for a seat for you — you will hear either way.'
              : `PKR ${outcome.perSeatFare} for your seat. Open it to see the car, or cancel.`,
            'ride',
          ).catch(() => {});
        }
      } catch (e) {
        // One rider's bad data must not stop the morning for everybody else.
        logger.warn('commute formation failed for rider', { uid: doc.id, error: String(e) });
      }
    }

    if (booked || joined || nudged || alone) {
      logger.info('Commute ride formation tick', { booked, joined, nudged, alone, day: now.day });
    }
  },
);
