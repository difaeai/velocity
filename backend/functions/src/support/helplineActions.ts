/**
 * What the helpline's AI can DO on a call, not only say.
 *
 * People ring because something on their account is wrong: the app says they
 * are on a ride that is over, they were charged for a driver who never came, a
 * bag is still in somebody's car. A good desk agent fixes those there and then,
 * and so does this one — with tools, on the call — and it says what it did. It
 * never "transfers" anybody: there is nobody to transfer to.
 *
 * ── THE PHONE RUNS THE SESSION, SO THE RIDE RECORD DECIDES ──────────────────
 *
 * Gemini Live talks to the caller's phone directly, so its tool calls arrive on
 * the phone and the phone forwards them here. Anything a phone forwards, a
 * tampered app can send with no AI involved at all. So no tool trusts the
 * model's judgement or the caller's word: each one re-reads the ride and acts
 * only when the ride's own timestamps prove it — a driver who had not arrived
 * half an hour after accepting, a passenger who never came out to a waiting
 * car, a ride still "running" hours past any honest length. What the record
 * cannot prove (a rude driver, cash paid twice) is registered for the team.
 *
 * ── ONE COMPLAINT PER CALL ──────────────────────────────────────────────────
 *
 * Every call that says anything lands on the desk as `supportTickets/{callId}`,
 * on the side of whoever rang — the driver side or the passenger side —
 * whether the assistant fixed it or not, with every action it took or was
 * refused. A fix nobody can see is a fix nobody can check.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { docId, invalid, isDocId, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser, sendToUsers } from '../lib/fcm';
import { isWarmPing, warmUp } from '../lib/warmup';
import { walletOutstanding } from '../domain/cancellation';
import { haversineKm } from '../trips/index';
import { forceEndTrip } from '../trips/stuckTrips';
import { postTripMessage, tripParticipants } from '../trips/chat';
import { appendMessage, notifyDesk } from './index';
import { EMERGENCY_CHANNELS } from './knowledge';
import {
  CATEGORY_LABELS,
  CATEGORY_PRIORITY,
  HUMAN_ONLY_CATEGORIES,
  SUPPORT_CATEGORIES,
  type SupportCategory,
  type SupportStatus,
} from './types';

/** Minutes after accepting by which a driver who has not reached the pickup counts as not coming. */
export const DRIVER_NO_SHOW_MIN = 30;
/** Minutes a driver waits at the pickup before a passenger who never came out counts as a no-show. */
export const RIDER_NO_SHOW_MIN = 10;
/** A running ride is never called stuck sooner than this, however short it is. */
export const STUCK_RIDE_FLOOR_MIN = 180;
/** How far back a passenger can report something left in a car. */
const LOST_ITEM_DAYS = 14;

// ── The tools, as the model sees them ────────────────────────────────────────

const RIDE_ID = {
  type: 'STRING',
  description: "The ride's id from the account state. Never say it aloud.",
};

export const HELPLINE_TOOLS = [
  {
    name: 'end_stuck_ride',
    description:
      'Release the caller from a ride they cannot get out of: nobody took the request, the driver ' +
      'never came, the passenger never came out to the waiting car, or a ride that is long over ' +
      'still shows as running. No cancellation fee. The ride record decides whether it is stuck.',
    parameters: { type: 'OBJECT', properties: { ride_id: RIDE_ID }, required: ['ride_id'] },
  },
  {
    name: 'waive_cancellation_fee',
    description:
      'Check a cancellation fee the caller was charged and take it off when the ride record shows ' +
      'the other side caused it: a driver who had not arrived long after accepting, or a passenger ' +
      'who never came out while the driver waited.',
    parameters: { type: 'OBJECT', properties: { ride_id: RIDE_ID }, required: ['ride_id'] },
  },
  {
    name: 'report_lost_item',
    description:
      "A passenger left something in the car: message that ride's driver in the app's ride chat " +
      'and on their phone, so the two can arrange to get it back.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ride_id: RIDE_ID,
        item: { type: 'STRING', description: 'What was left, in English — e.g. "a black backpack".' },
      },
      required: ['ride_id', 'item'],
    },
  },
  {
    name: 'register_complaint',
    description:
      "Register this call's complaint on the Velocity Rides complaints desk. Use it on EVERY call " +
      'before it ends, and again if the outcome changes: "resolved" when you fixed or answered it, ' +
      '"needs_team" when something is left that only staff can do.',
    parameters: {
      type: 'OBJECT',
      properties: {
        category: { type: 'STRING', enum: [...SUPPORT_CATEGORIES], description: 'What it is about.' },
        summary: {
          type: 'STRING',
          description: 'Two or three sentences in English: what happened, which ride, what you did, what is still wanted.',
        },
        outcome: { type: 'STRING', enum: ['resolved', 'needs_team'] },
        ride_id: RIDE_ID,
      },
      required: ['category', 'summary', 'outcome'],
    },
  },
];

// ── Shared ───────────────────────────────────────────────────────────────────

export interface HelplineCaller {
  uid: string;
  callId: string;
  /** What the agent was told when the call started: name, role, live ride. */
  snapshot: Record<string, unknown> | undefined;
}

/** `result` is what the model is told to say; `detail` is the line the desk reads. */
export interface ActionOutcome {
  done: boolean;
  detail: string;
  result: string;
}

type Side = 'passenger' | 'driver';
type Trip = FirebaseFirestore.DocumentSnapshot;

function refused(detail: string, say: string): ActionOutcome {
  return { done: false, detail, result: `Not done: ${say}` };
}

/** Which side of this ride the caller is on, or null when it is not theirs. */
function sideOf(trip: Trip, uid: string): Side | null {
  if (!trip.exists) return null;
  if (trip.get('driverId') === uid) return 'driver';
  if (!tripParticipants(trip).has(uid)) return null;
  return 'passenger';
}

/** Whole minutes since a trip timestamp, or null when it was never stamped. */
function minutesSince(trip: Trip, field: string, now: number): number | null {
  const ms = (trip.get(field) as Timestamp | undefined)?.toMillis?.();
  return typeof ms === 'number' ? Math.floor((now - ms) / 60_000) : null;
}

/** How a ride is named to a caller: by its day and destination, never its id. */
function rideName(trip: Trip): string {
  const at = (trip.get('createdAt') as Timestamp | undefined)?.toDate();
  const day = at ? at.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Karachi' }) : '';
  const to = trip.get('dropoff.address') as string | undefined;
  return `the ride${day ? ` on ${day}` : ''}${to ? ` to ${to.split(',')[0]}` : ''}`;
}

/**
 * The call's one complaint, keyed by the call id. Created by whichever needs it
 * first — a tool, the hand-over of an older app, or the hang-up.
 *
 * `lastSender: 'user'` until the call is settled, so a call whose phone never
 * reports back is caught and escalated by the desk's stale-ticket sweep.
 */
export async function ensureCallTicket(caller: HelplineCaller): Promise<FirebaseFirestore.DocumentReference> {
  const ref = db.doc(`supportTickets/${caller.callId}`);
  const s = caller.snapshot;
  try {
    await ref.create({
      id: caller.callId,
      userId: caller.uid,
      userName: (s?.displayName as string | null | undefined) ?? null,
      // The side of the desk it lands on: 'driver', or the passenger side.
      role: (s?.role as string | undefined) ?? 'passenger',
      category: 'other' as SupportCategory,
      categoryLabel: CATEGORY_LABELS.other,
      subject: 'Phone call',
      channel: 'phone',
      tripId: (s?.activeTripId as string | null | undefined) ?? null,
      status: 'ai_handling' as SupportStatus,
      handler: 'ai',
      priority: 'normal',
      assignedTo: null,
      aiReplies: 0,
      aiActions: [],
      lastMessage: 'Helpline call',
      lastSender: 'user',
      lastAt: FieldValue.serverTimestamp(),
      unreadForUser: 0,
      unreadForDesk: 1,
      aiContext: s ?? null,
      deskNotifiedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.doc(`helplineCalls/${caller.callId}`).set({ ticketId: caller.callId }, { merge: true });
  } catch (e) {
    // ALREADY_EXISTS: an earlier tool on this call made it.
    if ((e as { code?: number }).code !== 6) throw e;
  }
  return ref;
}

// ── register_complaint ───────────────────────────────────────────────────────

/** Record the call's complaint — fixed on the call, or waiting for the team. */
export async function registerComplaint(caller: HelplineCaller, raw: Record<string, unknown>): Promise<ActionOutcome> {
  const category: SupportCategory = SUPPORT_CATEGORIES.includes(raw.category as SupportCategory)
    ? (raw.category as SupportCategory)
    : 'other';
  // Safety and scams are a person's from the first second, whatever the model said.
  const needsTeam = raw.outcome !== 'resolved' || HUMAN_ONLY_CATEGORIES.has(category);
  const summary = String(raw.summary ?? '').trim().slice(0, 1000) || 'The caller rang the helpline.';
  const rideId = isDocId(raw.ride_id) ? raw.ride_id : null;
  const tripId = rideId && sideOf(await db.doc(`trips/${rideId}`).get(), caller.uid) ? rideId : null;
  const priority = HUMAN_ONLY_CATEGORIES.has(category) ? 'urgent' : CATEGORY_PRIORITY[category];
  const subject = `Phone call: ${CATEGORY_LABELS[category]}`;

  const ref = await ensureCallTicket(caller);
  await ref.set(
    {
      category,
      categoryLabel: CATEGORY_LABELS[category],
      subject,
      ...(tripId ? { tripId } : {}),
      status: (needsTeam ? 'waiting_human' : 'resolved') as SupportStatus,
      handler: needsTeam ? 'human' : 'ai',
      priority,
      lastMessage: summary.slice(0, 300),
      lastSender: 'ai',
      lastAt: FieldValue.serverTimestamp(),
      ...(needsTeam
        ? {
            escalatedAt: FieldValue.serverTimestamp(),
            escalationReason: 'Registered on a helpline call for the team',
            deskNotifiedAt: null,
            resolvedAt: FieldValue.delete(),
            resolvedBy: FieldValue.delete(),
          }
        : { resolvedAt: FieldValue.serverTimestamp(), resolvedBy: 'ai', escalationReason: null }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await appendMessage({
    ticketId: caller.callId,
    sender: 'system',
    senderName: 'Helpline call',
    text: `📞 ${needsTeam ? 'Registered for the team' : 'Resolved on the call by the AI assistant'}.\n${summary}`,
  });
  if (needsTeam) await notifyDesk(caller.callId, priority, subject);

  return {
    done: true,
    detail: `Registered: ${needsTeam ? 'for the team' : 'resolved'} (${CATEGORY_LABELS[category]})`,
    result: needsTeam
      ? 'Registered for the team. Tell the caller their complaint is registered and the Velocity Rides ' +
        'team will act on it and reply in the app under Help & complaints. Do not say the call is being ' +
        'transferred, and do not promise what the team will decide.' +
        (category === 'safety'
          ? ` If anyone is in danger right now, they must call the police on ${EMERGENCY_CHANNELS.police} or ${EMERGENCY_CHANNELS.rescue} first.`
          : '')
      : 'Registered as resolved. Tell the caller it is recorded and ask if there is anything else.',
  };
}

// ── end_stuck_ride ───────────────────────────────────────────────────────────

/** The longest a ride of this distance can honestly still be running, in minutes. */
function rideLimitMin(trip: Trip): number {
  const p = trip.get('pickup') as { lat?: number; lng?: number } | undefined;
  const d = trip.get('dropoff') as { lat?: number; lng?: number } | undefined;
  const km =
    typeof p?.lat === 'number' && typeof p.lng === 'number' && typeof d?.lat === 'number' && typeof d.lng === 'number'
      ? haversineKm(p.lat, p.lng, d.lat, d.lng)
      : 0;
  // Twice the time at a 25 km/h crawl, plus an hour: past that it is not a ride any more.
  return Math.max(STUCK_RIDE_FLOOR_MIN, Math.round((km / 25) * 60 * 2 + 60));
}

/**
 * Is this live ride stuck for this caller? Read from the ride's own clock only.
 * Each "no" says why, because the caller is told it.
 */
export function stuckVerdict(trip: Trip, side: Side, now: number): { stuck: boolean; why: string } {
  const status = trip.get('status') as string;
  if (status === 'requested') {
    return side === 'passenger'
      ? { stuck: true, why: 'no driver had taken the request yet' }
      : { stuck: false, why: 'no driver is on that ride' };
  }
  if (status === 'matched' || status === 'arriving') {
    if (side === 'driver') {
      return { stuck: false, why: 'the driver is still due at the pickup; a driver can cancel in the app, where a fee applies' };
    }
    const m = minutesSince(trip, 'matchedAt', now);
    return m !== null && m >= DRIVER_NO_SHOW_MIN
      ? { stuck: true, why: `the driver had not reached the pickup ${m} minutes after accepting` }
      : { stuck: false, why: `the driver accepted ${m ?? 0} minutes ago and may still be on the way; after ${DRIVER_NO_SHOW_MIN} minutes it can be released with no fee` };
  }
  if (status === 'arrived') {
    if (side === 'passenger') return { stuck: false, why: 'the driver is waiting at the pickup right now' };
    const m = minutesSince(trip, 'arrivedAt', now);
    return m !== null && m >= RIDER_NO_SHOW_MIN
      ? { stuck: true, why: `the passenger had not come out ${m} minutes after the driver arrived` }
      : { stuck: false, why: `the driver arrived ${m ?? 0} minutes ago; a passenger counts as not coming after ${RIDER_NO_SHOW_MIN} minutes` };
  }
  if (status === 'in_progress') {
    // The driver ends a running ride with End ride; closing it for them would wipe a ride they drove.
    if (side === 'driver') return { stuck: false, why: 'a running ride is ended by the driver with End ride in the app' };
    const m = minutesSince(trip, 'startedAt', now) ?? minutesSince(trip, 'matchedAt', now);
    return m !== null && m >= rideLimitMin(trip)
      ? { stuck: true, why: `it started ${Math.floor(m / 60)} hours ago, far longer than a ride that long takes` }
      : { stuck: false, why: 'the ride is still within its normal time; the driver ends it when it finishes' };
  }
  return { stuck: false, why: `that ride is already ${status ?? 'over'}` };
}

async function endStuckRide(caller: HelplineCaller, raw: Record<string, unknown>): Promise<ActionOutcome> {
  if (!isDocId(raw.ride_id)) return refused('No ride given', 'say which ride you mean.');
  const tripId = raw.ride_id;
  const trip = await db.doc(`trips/${tripId}`).get();
  const side = sideOf(trip, caller.uid);
  if (!side) return refused(`Ride ${tripId} is not on this account`, 'that ride is not on this caller’s account.');

  const now = Date.now();
  const verdict = stuckVerdict(trip, side, now);
  if (!verdict.stuck) {
    return refused(`Did not release ride ${tripId}: ${verdict.why}`, `${verdict.why}.`);
  }
  // Re-checked inside the transaction, so a driver arriving or ending it this second wins.
  const ended = await forceEndTrip(
    tripId,
    { uid: 'helpline', role: 'system' },
    `Released by the helpline: ${verdict.why}`,
    (t) => stuckVerdict(t, side, Date.now()).stuck,
  );
  if (!ended) return refused(`Ride ${tripId} was no longer live`, 'that ride has just ended by itself, so there is nothing to release.');

  const driverId = trip.get('driverId') as string | undefined;
  const riders = [...tripParticipants(trip)].filter((u) => u !== driverId);
  if (side === 'passenger' && driverId) {
    await sendToUser(driverId, 'Ride closed', `Velocity Rides closed ${rideName(trip)}: ${verdict.why}.`, { tripId }).catch(() => {});
  } else if (side === 'driver') {
    await sendToUsers(riders, 'Ride closed', `Velocity Rides closed ${rideName(trip)}: ${verdict.why}.`, { tripId }).catch(() => {});
  }
  return {
    done: true,
    detail: `Released ride ${tripId} with no fee: ${verdict.why}`,
    result:
      `Done: ${rideName(trip)} is closed with no cancellation fee, because ${verdict.why}. ` +
      `The caller can ${side === 'driver' ? 'take new rides' : 'book again'} right away.`,
  };
}

// ── waive_cancellation_fee ───────────────────────────────────────────────────

interface FeeRecord {
  amount?: number;
  role?: Side;
  paidFromWallet?: number;
  paidFromCredit?: number;
  outstanding?: number;
  waivedAt?: unknown;
}

/** When the ride was cancelled. Older rides predate `cancelledAt`; their fee row was written in the same transaction. */
async function cancelledAtMs(trip: Trip): Promise<number | null> {
  const stamped = (trip.get('cancelledAt') as Timestamp | undefined)?.toMillis?.();
  if (typeof stamped === 'number') return stamped;
  const rows = await db.collection('platformLedger').where('tripId', '==', trip.id).limit(20).get();
  const fee = rows.docs.find((d) => d.get('type') === 'cancellation_fee');
  return (fee?.get('createdAt') as Timestamp | undefined)?.toMillis?.() ?? null;
}

/** Did the OTHER side cause this cancellation? Only the ride's timestamps can say yes. */
export function feeVerdict(trip: Trip, cancelledAt: number | null): { waive: boolean; why: string } {
  const from = trip.get('cancelledFrom') as string | undefined;
  const role = trip.get('cancelledByRole') as string | undefined;
  if (cancelledAt === null) return { waive: false, why: 'the ride record does not say when it was cancelled' };
  if (role === 'passenger' && (from === 'matched' || from === 'arriving')) {
    const m = minutesSince(trip, 'matchedAt', cancelledAt);
    return m !== null && m >= DRIVER_NO_SHOW_MIN
      ? { waive: true, why: `the driver still had not reached the pickup ${m} minutes after accepting` }
      : { waive: false, why: `the passenger cancelled ${m ?? 0} minutes after the driver accepted, before the driver was late` };
  }
  if (role === 'driver' && from === 'arrived') {
    const m = minutesSince(trip, 'arrivedAt', cancelledAt);
    return m !== null && m >= RIDER_NO_SHOW_MIN
      ? { waive: true, why: `the passenger had not come out ${m} minutes after the driver arrived` }
      : { waive: false, why: `the driver cancelled ${m ?? 0} minutes after arriving, before the passenger counted as not coming` };
  }
  if (role === 'passenger' && from === 'arrived') {
    return { waive: false, why: 'the driver was already waiting at the pickup when the passenger cancelled' };
  }
  return { waive: false, why: 'the driver cancelled before reaching the pickup' };
}

async function waiveCancellationFee(caller: HelplineCaller, raw: Record<string, unknown>): Promise<ActionOutcome> {
  if (!isDocId(raw.ride_id)) return refused('No ride given', 'say which ride the fee was for.');
  const tripId = raw.ride_id;
  const tripRef = db.doc(`trips/${tripId}`);
  const trip = await tripRef.get();
  const side = sideOf(trip, caller.uid);
  if (!side) return refused(`Ride ${tripId} is not on this account`, 'that ride is not on this caller’s account.');

  const fee = trip.get('cancellationFee') as FeeRecord | null | undefined;
  if (trip.get('status') !== 'cancelled' || !fee || !((fee.amount ?? 0) > 0)) {
    return refused(`No fee on ride ${tripId}`, 'no cancellation fee was charged on that ride.');
  }
  if (trip.get('cancelledBy') !== caller.uid) {
    return refused(`Fee on ride ${tripId} was not this caller's`, 'the fee on that ride was charged to the other person, not to this caller.');
  }
  if (fee.waivedAt) return refused(`Fee on ride ${tripId} already waived`, 'that fee was already taken off.');

  const verdict = feeVerdict(trip, await cancelledAtMs(trip));
  if (!verdict.waive) {
    return refused(
      `Kept the PKR ${fee.amount} fee on ride ${tripId}: ${verdict.why}`,
      `the record shows ${verdict.why}, so the fee stands. If they still say it was not their fault, register the complaint as needs_team for the team to review.`,
    );
  }

  const walletRef = db.doc(`wallets/${caller.uid}`);
  const driverRef = db.doc(`drivers/${caller.uid}`);
  const userRef = db.doc(`users/${caller.uid}`);
  const out = await db.runTransaction(async (tx) => {
    const [t, wallet, user] = await Promise.all([tx.get(tripRef), tx.get(walletRef), tx.get(userRef)]);
    const f = t.get('cancellationFee') as FeeRecord | null | undefined;
    if (!f || f.waivedAt || !((f.amount ?? 0) > 0)) return null;
    // A rider's unpaid fee is stamped on the ride they are in (payments/nextRideFees);
    // clearing it mid-ride would leave the driver collecting cash for a debt that is gone.
    const liveId = user.get('activeTripId') as string | undefined;
    if (side === 'passenger' && liveId && (await tx.get(db.doc(`trips/${liveId}`))).get('status') === 'in_progress') {
      return 'riding' as const;
    }

    const owedPart = Math.max(0, Math.round(f.outstanding ?? 0));
    const cleared = Math.min(walletOutstanding(wallet), owedPart);
    // Paid since by transfer or on a later ride: real money, returned by a person.
    const alreadyPaid = owedPart - cleared;
    const backToWallet = Math.max(0, Math.round(f.paidFromWallet ?? 0));
    const backToCredit = Math.max(0, Math.round(f.paidFromCredit ?? 0));
    const reason = `Cancellation fee taken off by the helpline: ${verdict.why}`;

    tx.set(
      walletRef,
      {
        ...(cleared > 0 ? { outstanding: FieldValue.increment(-cleared) } : {}),
        ...(backToWallet > 0 ? { balance: FieldValue.increment(backToWallet) } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(walletRef.collection('transactions').doc(), {
      type: 'cancellation_fee_waived',
      amount: backToWallet,
      cleared,
      tripId,
      by: 'helpline',
      createdAt: FieldValue.serverTimestamp(),
    });
    if (backToCredit > 0) {
      tx.set(
        driverRef,
        {
          commissionCredit: FieldValue.increment(backToCredit),
          commissionCreditUsed: FieldValue.increment(-backToCredit),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      // admin_grant: the row type every shipped driver app knows how to show.
      tx.set(driverRef.collection('commissionCredits').doc(), {
        type: 'admin_grant',
        source: 'helpline',
        ref: tripId,
        amount: backToCredit,
        reason,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection('platformLedger').doc(), {
      type: 'cancellation_fee_waived',
      tripId,
      userId: caller.uid,
      role: side,
      amount: f.amount,
      clearedOutstanding: cleared,
      refundedWallet: backToWallet,
      refundedCredit: backToCredit,
      alreadyPaid,
      reason,
      by: 'helpline',
      callId: caller.callId,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      db.doc('system/counters'),
      {
        cancellationFeesWaived: FieldValue.increment(f.amount ?? 0),
        cancellationFeesOutstanding: FieldValue.increment(-cleared),
        cancellationFeesCollected: FieldValue.increment(-(backToWallet + backToCredit)),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    tx.set(
      tripRef,
      { cancellationFee: { waivedAt: FieldValue.serverTimestamp(), waivedBy: 'helpline', waivedReason: verdict.why } },
      { merge: true },
    );
    return { amount: f.amount ?? 0, alreadyPaid };
  });

  if (out === 'riding') {
    return refused('Fee waiver waits for the live ride to end', 'the caller is on a ride right now; this fee can be checked again as soon as that ride ends.');
  }
  if (!out) return refused(`Fee on ride ${tripId} already waived`, 'that fee was already taken off.');

  await sendToUser(caller.uid, 'Cancellation fee removed', `PKR ${out.amount} for ${rideName(trip)} has been taken off.`, { tripId }).catch(() => {});
  return {
    done: true,
    detail: `Took off the PKR ${out.amount} fee on ride ${tripId}: ${verdict.why}` +
      (out.alreadyPaid > 0 ? ` (PKR ${out.alreadyPaid} was already paid — the team must return it)` : ''),
    result:
      `Done: the PKR ${out.amount} cancellation fee for ${rideName(trip)} is taken off, because ${verdict.why}.` +
      (out.alreadyPaid > 0
        ? ` PKR ${out.alreadyPaid} of it had already been paid, and returning money needs the team — register the complaint as needs_team for that part.`
        : ''),
  };
}

// ── report_lost_item ─────────────────────────────────────────────────────────

async function reportLostItem(caller: HelplineCaller, raw: Record<string, unknown>): Promise<ActionOutcome> {
  if (!isDocId(raw.ride_id)) return refused('No ride given', 'say which ride the item was left on.');
  const item = String(raw.item ?? '').trim().slice(0, 200);
  if (item.length < 2) return refused('No item described', 'ask what was left in the car.');
  const tripId = raw.ride_id;
  const trip = await db.doc(`trips/${tripId}`).get();
  const side = sideOf(trip, caller.uid);
  if (side !== 'passenger') return refused(`Ride ${tripId} is not one this caller rode`, 'that is not a ride this caller took as a passenger.');
  if (!trip.get('driverId')) return refused(`Ride ${tripId} had no driver`, 'no driver ever took that ride.');
  const age = minutesSince(trip, 'createdAt', Date.now());
  if (age === null || age > LOST_ITEM_DAYS * 24 * 60) {
    return refused(`Ride ${tripId} is too old to message`, `that ride is more than ${LOST_ITEM_DAYS} days old; register the complaint as needs_team.`);
  }
  try {
    await rateLimit(caller.uid, `helplineLostItem_${tripId}`, 1, 86_400);
  } catch {
    return refused(`Lost item on ride ${tripId} already sent today`, 'the driver of that ride was already messaged about it today.');
  }

  const name = (caller.snapshot?.displayName as string | null | undefined) ?? 'Your passenger';
  await postTripMessage({
    tripId,
    participants: tripParticipants(trip),
    senderId: caller.uid,
    senderName: name,
    text:
      `🎒 Lost item, sent for me by the Velocity Rides helpline: I think I left ${item} in your car on this ride. ` +
      'Please check and reply here so we can arrange to get it back.',
  });
  return {
    done: true,
    detail: `Messaged the driver of ride ${tripId} about a lost item: ${item}`,
    result:
      `Done: the driver of ${rideName(trip)} has a message about ${item} in the ride chat and a notification on their phone. ` +
      "Tell the caller to watch Messages in the app for the driver's reply. Do not promise the item is there.",
  };
}

// ── The callable the phone forwards every tool call to ──────────────────────

const lineSchema = z.object({ who: z.enum(['caller', 'agent']), text: z.string().max(2000) });

const actionSchema = z.object({
  callId: docId,
  name: z.string().max(60),
  args: z.record(z.unknown()).default({}),
  transcript: z.array(lineSchema).max(400).optional(),
});

const ACTIONS: Record<string, (caller: HelplineCaller, args: Record<string, unknown>) => Promise<ActionOutcome>> = {
  register_complaint: registerComplaint,
  end_stuck_ride: endStuckRide,
  waive_cancellation_fee: waiveCancellationFee,
  report_lost_item: reportLostItem,
};

/** Run one of the agent's tools for the caller, on their own live call. */
export const helplineAction = onCall(async (req) => {
  const ctx = requireAuth(req);
  if (isWarmPing(req.data)) return warmUp();
  const parsed = actionSchema.safeParse(req.data);
  if (!parsed.success) invalid('Bad tool call.');
  const { callId, name, args, transcript } = parsed.data;
  await rateLimit(ctx.uid, 'helplineAction', 30, 3600);

  const callRef = db.doc(`helplineCalls/${callId}`);
  const call = await callRef.get();
  if (!call.exists || call.get('uid') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your call.');
  }
  // The tools live exactly as long as the conversation: not before it, not after.
  const expires = (call.get('expiresAt') as Timestamp | undefined)?.toMillis?.() ?? 0;
  if (call.get('status') !== 'live' || expires < Date.now()) {
    throw new HttpsError('failed-precondition', 'This call has ended.');
  }

  const caller: HelplineCaller = { uid: ctx.uid, callId, snapshot: call.get('context') as Record<string, unknown> | undefined };
  const run = ACTIONS[name];
  let outcome: ActionOutcome;
  try {
    outcome = run ? await run(caller, args) : refused(`Unknown tool ${name}`, 'there is no such tool; register the complaint instead.');
  } catch (e) {
    logger.error('helpline: tool failed', { callId, name, error: (e as Error).message });
    outcome = refused(`${name} failed: ${(e as Error).message}`.slice(0, 300), 'something went wrong on our side. Register the complaint as needs_team so the team finishes it.');
  }

  // Every attempt, done or refused, is on the record: the call's, and the complaint's on the desk.
  const entry = { name, done: outcome.done, detail: outcome.detail, at: Timestamp.now() };
  await callRef.set(
    { actions: FieldValue.arrayUnion(entry), ...(transcript ? { transcript } : {}) },
    { merge: true },
  );
  if (name !== 'register_complaint') {
    const ticket = await ensureCallTicket(caller);
    await ticket.set({ aiActions: FieldValue.arrayUnion(entry), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await appendMessage({ ticketId: callId, sender: 'system', senderName: 'Helpline call', text: `🤖 ${outcome.detail}` });
  }
  logger.info('helpline: tool', { callId, name, done: outcome.done });
  return { ok: true, result: outcome.result, ticketId: callId };
});
