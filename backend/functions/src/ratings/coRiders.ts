/**
 * Riders rating the people they shared the car with.
 * ----------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * -------------------
 * Velocity had exactly one rating relationship: the rider rated the driver
 * (`submitRating`, next door). On a shared ride that leaves out the people a
 * rider actually has to sit beside. Someone deciding whether to get into a car
 * with two strangers could see the driver's four-and-a-half stars and nothing
 * at all about the strangers — so the only reputation in the car belonged to
 * the one person who was being paid to be there.
 *
 * This module adds the missing edge: every rider on a shared ride may rate
 * every other rider once the ride is over, and the resulting average travels
 * with them to the next shared ride they try to join.
 *
 * WHY A SEPARATE AVERAGE AND NOT `users/{uid}.rating`
 * --------------------------------------------------
 * `rating` on a user document is what DRIVERS think of a passenger — did they
 * show up, did they pay, were they where they said they would be. What a
 * co-rider knows is a different question entirely: were they decent company in
 * a confined space for forty minutes. Folding both into one number would mean a
 * woman checking who is already in a car could not tell a rider three drivers
 * liked from a rider three women liked, and the number she actually wants would
 * be diluted by the one she did not ask for. So co-rider ratings live in their
 * own pair of fields and are never mixed in:
 *
 *   users/{uid}.coRiderRating       rolling average, one decimal
 *   users/{uid}.coRiderRatingCount  how many co-riders have rated them
 *
 * WHAT THE RATEE IS TOLD
 * ----------------------
 * Nothing. A co-rider rating is anonymous to its subject, and deliberately:
 * these are strangers who shared a car and may share another, and "the woman
 * who got in at Model Town gave me two stars" is a sentence that must not be
 * derivable from anything the app shows. Only the admin desk — which exists to
 * answer a complaint or hand a file to the police — can see who said what.
 * That is why the aggregate is the only thing that ever reaches a client, and
 * why a single rating is withheld entirely: see RATINGS_BEFORE_SHOWN.
 *
 * WHO MAY RATE WHOM
 * -----------------
 * Both parties have to have been in the same car on a ride that finished, and
 * the window closes after a week. Reading the roster rather than `poolMembers`
 * matters here — see `rosterForTrip`, which treats the member list as the
 * authority on who was aboard and the roster as the authority on who they were.
 * ----------------------------------------------------------------------------
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rosterForTrip } from '../trips/poolRoster';

/**
 * How many co-riders must have rated somebody before their average is shown.
 *
 * One rating is not a reputation, it is an opinion — and an opinion with a
 * motive, since the person most likely to rate a stranger the moment they get
 * out of the car is the person who fell out with them in it. Below this
 * threshold the app shows "New rider" rather than a number, so nobody is
 * branded by a single bad night and nobody's first shared ride decides their
 * next twenty.
 */
export const RATINGS_BEFORE_SHOWN = 3;

/** How long after a ride ends co-riders may still rate each other. */
const RATING_WINDOW_DAYS = 7;

/** The public shape of somebody's co-rider standing. */
export interface CoRiderStanding {
  /** The average, or null when there is not enough of one to show. */
  coRiderRating: number | null;
  /** Always the true count, even when the average is withheld. */
  coRiderRatingCount: number;
}

/**
 * Somebody's co-rider standing, as it may be shown to another rider.
 *
 * Takes the raw user document (or nothing at all — plenty of call sites have a
 * uid and no snapshot) and applies the one rule every surface must apply
 * identically: below RATINGS_BEFORE_SHOWN there is no number. Centralised here
 * precisely so the join screen, the discovery feed and the roster snapshot
 * cannot drift into disagreeing about when a rider counts as rated.
 */
export function coRiderStanding(userData?: FirebaseFirestore.DocumentData | null): CoRiderStanding {
  const count = typeof userData?.coRiderRatingCount === 'number' ? userData.coRiderRatingCount : 0;
  const avg = typeof userData?.coRiderRating === 'number' ? userData.coRiderRating : null;
  return {
    coRiderRating: count >= RATINGS_BEFORE_SHOWN && avg !== null ? avg : null,
    coRiderRatingCount: count,
  };
}

/** Deterministic id, so a second rating of the same person is a doc that exists. */
function ratingDocId(tripId: string, raterUid: string, targetUid: string): string {
  return `${tripId}_corider_${raterUid}_${targetUid}`;
}

/** Timestamp-ish → millis, for the several shapes a trip's clock arrives in. */
function millisOf(value: unknown): number | null {
  const ts = value as { toMillis?: () => number; seconds?: number } | undefined;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts && typeof ts.seconds === 'number') return ts.seconds * 1000;
  return null;
}

const tripOnlySchema = z.object({ tripId: docId });

/**
 * Who the caller may rate on a finished shared ride, and whether they already
 * have.
 *
 * The app asks for this once, when a shared ride completes, and uses it to
 * drive the rating sheet. It answers "nobody" rather than failing for a solo
 * ride, a ride the caller was not on, or a ride still in progress, because the
 * screen that calls it does so on every completed trip and a thrown error there
 * is a red banner on top of somebody's receipt.
 */
export const getCoRiderRatingTargets = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = tripOnlySchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid request.');
  const { tripId } = parsed.data;

  const snap = await db.doc(`trips/${tripId}`).get();
  if (!snap.exists) return { targets: [], closesAtMs: null };

  const trip = snap.data() ?? {};
  if (trip.status !== 'completed') return { targets: [], closesAtMs: null };

  const roster = rosterForTrip(trip);
  if (!roster.some((r) => r.uid === ctx.uid)) return { targets: [], closesAtMs: null };

  const others = roster.filter((r) => r.uid !== ctx.uid);
  if (others.length === 0) return { targets: [], closesAtMs: null };

  const endedAt = millisOf(trip.completedAt) ?? millisOf(trip.updatedAt) ?? millisOf(trip.createdAt);
  const closesAtMs = endedAt === null ? null : endedAt + RATING_WINDOW_DAYS * 86_400_000;
  if (closesAtMs !== null && Date.now() > closesAtMs) return { targets: [], closesAtMs };

  // Two batched reads rather than a query: the rating ids are deterministic and
  // the user docs are keyed by uid, so neither needs an index — and a composite
  // (tripId, raterId) index on `ratings` would exist for this one screen alone.
  const ratingRefs = others.map((r) => db.doc(`ratings/${ratingDocId(tripId, ctx.uid, r.uid)}`));
  const userRefs = others.map((r) => db.doc(`users/${r.uid}`));
  const [ratingSnaps, userSnaps] = await Promise.all([
    db.getAll(...ratingRefs),
    db.getAll(...userRefs),
  ]);

  return {
    closesAtMs,
    targets: others.map((r, i) => ({
      uid: r.uid,
      // First names only, exactly as the trip document carries them. The rating
      // sheet is not a place to learn a stranger's full name.
      firstName: r.firstName,
      gender: r.gender,
      alreadyRated: ratingSnaps[i]?.exists === true,
      ...coRiderStanding(userSnaps[i]?.data()),
    })),
  };
});

const submitSchema = z.object({
  tripId: docId,
  targetUid: docId,
  stars: z.number().int().min(1).max(5),
  // nullish, not optional: the mobile Firebase SDK encodes an absent optional
  // field as null on the wire.
  comment: z.string().max(300).nullish(),
});

/**
 * One rider rates another on a shared ride they both finished.
 *
 * Mirrors `submitRating`'s shape — a `ratings` document plus a rolling average
 * in one transaction — but cannot borrow its double-submission guard. That one
 * sets a flag on the trip (`passengerRated` / `driverRated`), which works
 * because there is exactly one rating in each direction; a car with four people
 * in it has twelve, so the guard here is the existence of the rating document
 * itself, read inside the transaction.
 */
export const submitCoRiderRating = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = submitSchema.safeParse(req.data);
  if (!parsed.success) invalid(parsed.error.issues[0]?.message ?? 'Invalid rating data.');
  const { tripId, targetUid, stars, comment } = parsed.data;

  if (targetUid === ctx.uid) invalid('You cannot rate yourself.');

  const tripRef = db.doc(`trips/${tripId}`);
  const tripSnap = await tripRef.get();
  if (!tripSnap.exists) invalid('Ride not found.');

  const trip = tripSnap.data() ?? {};
  if (trip.status !== 'completed') invalid('This ride is not finished yet.');

  const roster = rosterForTrip(trip);
  if (!roster.some((r) => r.uid === ctx.uid)) {
    throw new HttpsError('permission-denied', 'You were not on this ride.');
  }
  if (!roster.some((r) => r.uid === targetUid)) {
    throw new HttpsError('permission-denied', 'That rider was not on this ride.');
  }

  const endedAt = millisOf(trip.completedAt) ?? millisOf(trip.updatedAt) ?? millisOf(trip.createdAt);
  if (endedAt !== null && Date.now() > endedAt + RATING_WINDOW_DAYS * 86_400_000) {
    invalid(`Ratings close ${RATING_WINDOW_DAYS} days after a ride.`);
  }

  const ratingRef = db.doc(`ratings/${ratingDocId(tripId, ctx.uid, targetUid)}`);
  // The seat may have been booked for somebody else (see PoolRosterEntry's
  // bookedForOther), in which case this lands on the account holder rather than
  // the person who was in the seat. That is the only identity the platform has,
  // and the booker is answerable for who they put in the car.
  const targetRef = db.doc(`users/${targetUid}`);

  await db.runTransaction(async (tx) => {
    // Firestore requires every read in a transaction to precede every write.
    const [existing, targetSnap] = await Promise.all([tx.get(ratingRef), tx.get(targetRef)]);
    if (existing.exists) invalid('You have already rated this rider.');

    tx.set(ratingRef, {
      tripId,
      stars,
      comment: comment ?? null,
      raterId: ctx.uid,
      targetUid,
      targetRole: 'coRider',
      createdAt: FieldValue.serverTimestamp(),
    });

    if (targetSnap.exists) {
      const prevRating: number = targetSnap.get('coRiderRating') ?? 0;
      const prevCount: number = targetSnap.get('coRiderRatingCount') ?? 0;
      const newCount = prevCount + 1;
      // Starts from the real history, not from an assumed 5.0. submitRating
      // seeds a driver's average at 5.0 because a driver is vouched for by
      // approval before anyone rides with them; a rider is vouched for by
      // nobody, so inventing four free stars here would mean the first two
      // ratings barely moved the number they are supposed to establish.
      const newRating = (prevRating * prevCount + stars) / newCount;
      tx.set(
        targetRef,
        {
          coRiderRating: Math.round(newRating * 10) / 10,
          coRiderRatingCount: newCount,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });

  logger.info('Co-rider rating submitted', { tripId, by: ctx.uid, targetUid, stars });
  return { ok: true };
});
