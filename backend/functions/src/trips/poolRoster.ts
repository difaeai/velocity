/**
 * Who is in a shared car — for the destination pools people actually book.
 * ----------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * -------------------
 * Velocity grew two ways of putting several people in one car, and only one of
 * them ever wrote down who they were:
 *
 *   • EN-ROUTE pickups (`trips/enRoute`) store a rich `poolRiders` array — every
 *     rider's name, gender, boarding point and their own leg-split fare.
 *   • DESTINATION pools (booked on the booking screen, joined by invite code or
 *     from nearby discovery) stored `poolMembers: string[]` and nothing else.
 *
 * So on the pool a normal rider actually books, `poolRiders` was empty, and
 * everything downstream of it silently degraded:
 *   – the driver's drop-off panel fell back to one "Complete trip" button, so
 *     the first passenger out ended everybody's ride and the driver had no list
 *     of who was still aboard or what each of them owed;
 *   – the passenger's "sharing this car" card never rendered, so riders got in a
 *     car with strangers they were never told about, and never learned that
 *     their own ride was being shared at all.
 *
 * This module is the missing half: a roster written when a pool is created and
 * appended to when somebody joins.
 *
 * WHY A SECOND FIELD AND NOT `poolRiders`
 * ---------------------------------------
 * `poolRiders` carries the en-route fare split — boardM/alightM offsets along
 * the driver's corridor and a per-rider billable distance — and `ridersOnTrip`
 * treats its presence as "these riders are already priced against a road". A
 * destination pool has none of that (everyone rides the same route for the same
 * flat tier fare), so seeding `poolRiders` with zeroed offsets would quietly
 * feed the leg-split engine geometry that means nothing and change what people
 * are charged. `poolRoster` says only who is aboard, and the money keeps coming
 * from exactly where it came from before.
 *
 * WHAT IS SAFE TO PUT HERE
 * ------------------------
 * The trip document is readable by every pool member (see firestore.rules), so
 * the roster carries only what a co-rider is already entitled to know: a first
 * name, a gender, and the ends of their journey. Full names, phone numbers and
 * fares are never written here — the driver, who genuinely needs them to collect
 * the right cash from the right person, gets them from `getPoolRiders`, which
 * looks them up per caller.
 * ----------------------------------------------------------------------------
 */
import { Timestamp } from '../lib/firebase';

/** How somebody came to be in the car. */
export type PoolRosterKind = 'host' | 'share';

/** One rider on a destination pool, as stored on the trip document. */
export interface PoolRosterEntry {
  uid: string;
  /** First name only — every co-rider can read this document. */
  firstName: string;
  /** 'male' | 'female' | 'unspecified'. Drives the make-up shown before joining. */
  gender: string;
  kind: PoolRosterKind;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  /**
   * Ordering, so the driver's list reads in the order people got on rather than
   * in whatever order the array happens to be in. A plain `Timestamp`, not
   * `serverTimestamp()` — Firestore refuses sentinel values inside arrays.
   */
  joinedAt: Timestamp;
  /** Set once the driver has let them out. Absent while they are still aboard. */
  droppedAt?: Timestamp | null;
}

/** First name, for a document co-riders can read. Never the full name. */
export function firstNameOf(full: unknown, fallback = 'Rider'): string {
  const s = typeof full === 'string' ? full.trim() : '';
  if (!s) return fallback;
  return s.split(/\s+/)[0] ?? fallback;
}

const addressOf = (place: unknown): string | null => {
  const a = (place as { address?: unknown } | undefined)?.address;
  return typeof a === 'string' && a.trim() ? a.trim() : null;
};

/**
 * The roster entry for whoever booked the pool. Written by `createTrip`, so a
 * pool has a roster from the moment it exists rather than from its first joiner.
 */
export function hostRosterEntry(args: {
  uid: string;
  name: unknown;
  gender: unknown;
  pickup: unknown;
  dropoff: unknown;
}): PoolRosterEntry {
  return {
    uid: args.uid,
    firstName: firstNameOf(args.name),
    gender: typeof args.gender === 'string' ? args.gender : 'unspecified',
    kind: 'host',
    pickupAddress: addressOf(args.pickup),
    dropoffAddress: addressOf(args.dropoff),
    joinedAt: Timestamp.now(),
  };
}

/**
 * The roster entry for somebody joining by invite code or from discovery.
 *
 * A joiner rides the host's route, so their pickup and drop-off are the trip's —
 * they never picked their own. Recording them anyway keeps every entry the same
 * shape as an en-route rider's, which is what lets one drop-off list mix them.
 */
export function joinerRosterEntry(args: {
  uid: string;
  name: unknown;
  gender: unknown;
  pickup: unknown;
  dropoff: unknown;
}): PoolRosterEntry {
  return { ...hostRosterEntry(args), kind: 'share' };
}

/**
 * The roster for a trip, however that trip records its riders.
 *
 * Three sources, in the order they can be trusted:
 *   1. `poolRoster` — written by createTrip/joinPoolTrip. Complete.
 *   2. `poolMembers` — pools booked before this module existed. We know they are
 *      aboard and nothing else, so they read as "Rider" rather than being
 *      dropped from the list: a driver being told "4 riders, one unnamed" is far
 *      better than being told there are three.
 *   3. Nothing at all — a solo trip. Empty list.
 *
 * En-route riders are NOT merged in here; `getPoolRiders` prefers the richer
 * `poolRiders` array whenever a trip has one, and that array is already the full
 * picture for those trips.
 */
export function rosterForTrip(trip: FirebaseFirestore.DocumentData): PoolRosterEntry[] {
  const stored = trip.poolRoster as PoolRosterEntry[] | undefined;
  const members = (trip.poolMembers as string[] | undefined) ?? [];
  if (Array.isArray(stored) && stored.length > 0) {
    // Members is the authority on who is aboard; the roster is the authority on
    // who they are. A member with no roster row (joined during a deploy, say)
    // still has to appear, or the driver loses a passenger.
    const byUid = new Map(stored.map((r) => [r.uid, r]));
    const ordered = members.length ? members : stored.map((r) => r.uid);
    return ordered.map(
      (uid, i) =>
        byUid.get(uid) ?? {
          uid,
          firstName: 'Rider',
          gender: 'unspecified',
          kind: i === 0 ? 'host' : 'share',
          pickupAddress: addressOf(trip.pickup),
          dropoffAddress: addressOf(trip.dropoff),
          joinedAt: Timestamp.fromMillis(0),
        },
    );
  }
  if (members.length === 0) return [];
  return members.map((uid, i) => ({
    uid,
    firstName: i === 0 ? firstNameOf(trip.passengerName) : 'Rider',
    gender:
      i === 0 && typeof trip.passengerGender === 'string' ? trip.passengerGender : 'unspecified',
    kind: (i === 0 ? 'host' : 'share') as PoolRosterKind,
    pickupAddress: addressOf(trip.pickup),
    dropoffAddress: addressOf(trip.dropoff),
    joinedAt: Timestamp.fromMillis(0),
  }));
}
