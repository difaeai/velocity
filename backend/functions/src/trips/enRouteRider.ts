/**
 * Riders on YOUR way — the same engine, told to the rider instead of the driver.
 * ----------------------------------------------------------------------------
 * THE PROBLEM THIS FIXES
 * Ali books a shared ride F-10 → F-6 and nobody joins. He is watching a screen
 * that says we are looking for a driver, with no idea that two people are
 * standing on the road he is about to drive down, each of whom would cut his
 * fare if the driver picked them up. Everything needed to know that already
 * existed — it was simply only ever shown to the driver (trips/enRoute.ts).
 *
 * So this is the rider's side of the same corridor search. It answers two
 * questions and nothing else:
 *
 *   WHAT WOULD I PAY?   The people on your road right now, and what your own
 *                       fare becomes if the driver takes them. Not an invented
 *                       discount: the figure comes from the same leg-split that
 *                       will actually bill the ride (lib/enRouteFare), through
 *                       the same four corridor gates the driver's feed uses.
 *   WILL YOU ASK?       Once a driver is on the trip, the rider can point at
 *                       one of them and say "pick that one up".
 *
 * WHY THE RIDER CANNOT ADD ANYONE THEMSELVES
 * It is the driver's car and the driver's detour. An "ask" is a nudge with a
 * push notification attached, nothing more; the driver's own screen runs every
 * gate — seats, gender rules, the fare floor, their own earnings — before
 * anybody is added. A rider who could add riders could also drag a driver off
 * their road, and the pickup would still have to be priced and consented to
 * afterwards, so there is nothing to gain from letting them.
 *
 * WHY "IT MIGHT GO DOWN" IS WORTH SHOWING AT ALL
 * Because the alternative is a rider cancelling a perfectly good ride during the
 * quiet minute before it fills. The card is deliberately honest about being
 * conditional — the fare shown is what it BECOMES if the driver takes them, and
 * the copy says so. Nothing here ever promises a fare, and nothing here ever
 * writes one: the pricing of record still happens in acceptEnRouteRider.
 *
 * WHEN A SAVING ACTUALLY EXISTS — measured, not assumed
 * A shared-ride fare is already server-priced well below the solo fare, and the
 * tier the rider was quoted is a CEILING they can never be pushed above. So the
 * leg-split does not automatically make the waiting rider cheaper: for a short
 * hop along a long route, the split's own figure for the host comes out at or
 * above the fixed fare they were quoted, the ceiling pins them there, and the
 * whole gain from the pickup goes to the driver (their gross rises because each
 * extra rider adds a base fare). The host only starts saving once enough of
 * THEIR road is genuinely shared — a rider going most of the way, or two or
 * three riders between them covering it.
 *
 * That is why every candidate here is filtered on `myFareIfTaken < myFareNow`
 * and the card renders nothing when the list is empty. A rider is never shown
 * somebody under a promise of a lower fare that the billing would then not
 * honour. If the product later decides a waiting rider should get a cut of the
 * driver's extra gross on every pickup, that is a pricing change in
 * lib/enRouteFare and domain/fares — not a change here, and not something this
 * surface should quietly imply.
 *
 * WHY THE DRIVER-SIDE GATES ARE RE-RUN HERE
 * A card offering a saving the driver's own feed would never show them is worse
 * than no card. So the rider is only shown candidates that pass, right now,
 * every test the driver's feed applies — including "the driver must not end up
 * worse off", which is what stops us advertising a discount nobody would ever
 * agree to serve.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { sendToUser } from '../lib/fcm';
import { MAX_POOL_RIDERS } from '../domain/fares';
import { checkCorridorFit, type EnRouteSettings } from '../lib/enRouteMatch';
import { driverIsNotWorseOff } from '../lib/enRouteFare';
import { firstNameOf } from './poolRoster';
import {
  RIDE_TO_CAT,
  agreedFareOf,
  agreedGrossOf,
  buildCandidate,
  genderGate,
  loadFareConfig,
  priceRiders,
  ridersOnTrip,
  resolveCorridor,
  seatsUsed,
  type PoolRider,
} from './enRoute';

/** Statuses in which a rider is on a trip that is still going somewhere. */
const LIVE = new Set(['requested', 'matched', 'arriving', 'arrived', 'in_progress']);

/** Open pool requests read per search. The same ceiling the driver feed uses. */
const CANDIDATE_SCAN = 150;

/** Asks kept on a trip. Enough for a full car several times over. */
const MAX_ASKS = 12;

const savingsSchema = z.object({
  tripId: docId,
  /**
   * The road, as the rider's own map drew it. Only a fallback — when the
   * backend has its own Maps key it fetches the route itself and ignores this.
   */
  polyline: z.string().min(4).max(60_000).optional(),
});

/** One person standing on the rider's road, as the rider may see them. */
interface CandidateView {
  tripId: string;
  firstName: string;
  seats: number;
  /** Where they get in and out — area names only, never a house. */
  pickupArea: string | null;
  dropoffArea: string | null;
  /** How far into the journey they are picked up, for ordering the list. */
  alongM: number;
  /** What THIS rider would pay if the driver took this one person. */
  myFareIfTaken: number;
  /** Their own fare, so the rider can see the car is not being subsidised. */
  theirFare: number;
}

/**
 * How much the rider's own fare moves, and who would have to be picked up.
 *
 * Returns an empty list rather than an error for every ordinary "nothing to
 * show" case — a quiet road, a full car, a wallet trip, the feature switched
 * off. The card simply does not appear, which is the right behaviour for a
 * surface whose whole job is to be good news when there is any.
 */
export const getEnRouteSavings = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'getEnRouteSavings', 40, 60);
  const parsed = savingsSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the ride to look along.');
  const { tripId, polyline } = parsed.data;

  const tripSnap = await db.doc(`trips/${tripId}`).get();
  if (!tripSnap.exists) throw new HttpsError('not-found', 'That ride no longer exists.');
  const trip = tripSnap.data()!;

  // Only the people actually on the trip may look along it: the list says who
  // is standing where, and that is not public information.
  const members = (trip.poolMembers as string[] | undefined) ?? [trip.passengerId as string];
  if (trip.passengerId !== ctx.uid && !members.includes(ctx.uid)) {
    throw new HttpsError('permission-denied', 'That is not your ride.');
  }

  const empty = { candidates: [] as CandidateView[], myFareNow: null, myFareBest: null, canAsk: false };
  if (trip.pool !== true || !LIVE.has((trip.status as string) ?? '')) return empty;
  // Cash only, on both sides — an en-route pickup cannot be paid for out of a
  // wallet hold taken at bid time, so a wallet trip can never gain one.
  if (((trip.paymentMethod as string) ?? 'cash') !== 'cash') return empty;

  let resolved;
  try {
    resolved = await resolveCorridor((trip.driverId as string) ?? '', polyline, tripSnap);
  } catch (e) {
    // The feature is off, or we could not work out the road. Neither is
    // something to put in front of a rider waiting for a car.
    logger.info('enRouteSavings: no corridor', { tripId, error: (e as Error)?.message });
    return empty;
  }

  const cfg = await loadFareConfig(resolved.origin);
  const { corridor, destination } = resolved;
  // The admin's default corridor, not a driver's chosen one: no driver has
  // chosen anything yet, and the rider must not be shown a saving that depends
  // on a wider radius than the average driver will be searching with.
  const settings: Pick<EnRouteSettings, 'corridorRadiusM' | 'destRadiusM'> = {
    corridorRadiusM: resolved.settings.corridorRadiusM,
    destRadiusM: resolved.settings.destRadiusM,
  };

  const existing: PoolRider[] = ridersOnTrip(trip, corridor, cfg);
  const me = existing.find((r) => r.uid === ctx.uid);
  const myFareNow = me?.fare ?? (trip.poolPerSeatFare as number | undefined) ?? null;
  const seatsLeft = MAX_POOL_RIDERS - seatsUsed(existing);
  const canAsk = typeof trip.driverId === 'string' && trip.driverId.length > 0;
  if (seatsLeft <= 0) return { ...empty, myFareNow, myFareBest: myFareNow, full: true };

  const category = RIDE_TO_CAT[(trip.rideType as string) ?? 'mini'] ?? 'mini';
  const tierBase = agreedFareOf(trip, me?.soloFare ?? 0);
  const grossBefore = agreedGrossOf(trip);

  const openSnap = await db
    .collection('openRequests')
    .where('pool', '==', true)
    .limit(CANDIDATE_SCAN)
    .get();

  const views: CandidateView[] = [];
  /** Kept in corridor order so the cumulative best case follows the road. */
  const priced: { candidate: PoolRider; view: CandidateView }[] = [];

  for (const doc of openSnap.docs) {
    if (doc.id === tripId) continue; // our own request
    const d = doc.data();
    const pickup = d.pickup as { lat?: number; lng?: number; address?: string } | undefined;
    const dropoff = d.dropoff as { lat?: number; lng?: number; address?: string } | undefined;
    if (typeof pickup?.lat !== 'number' || typeof dropoff?.lat !== 'number') continue;

    const seats = (d.seats as number) ?? 1;
    if (seats > seatsLeft) continue;
    if (((d.paymentMethod as string) ?? 'cash') !== 'cash') continue;
    if (members.includes(d.passengerId as string)) continue; // already aboard

    // The same four geometric gates the driver's feed runs. `driverAlongM` is
    // deliberately omitted: this is about the road as a whole, and where the
    // car happens to be this second is the driver's screen's business.
    const fit = checkCorridorFit(
      corridor,
      destination,
      { lat: pickup.lat!, lng: pickup.lng! },
      { lat: dropoff.lat!, lng: dropoff.lng! },
      settings,
    );
    if (!fit.ok) continue;

    const candidate = await buildCandidate(doc.id, d, fit.fit, cfg);
    if (!candidate) continue;
    if (!genderGate(existing, candidate).allowed) continue;

    const withThem = priceRiders([...existing, candidate], cfg, category, tierBase || candidate.soloFare);
    const theirFare = withThem.fares[candidate.uid]!;
    // Never advertise a saving the driver's own feed would refuse to offer.
    if (theirFare > (d.offeredFare as number)) continue;
    if (!driverIsNotWorseOff(grossBefore, withThem.driverGross)) continue;

    const myFareIfTaken = withThem.fares[ctx.uid];
    if (typeof myFareIfTaken !== 'number') continue;
    // A rider is only shown people who make their own fare smaller. One who
    // leaves it exactly where it is belongs on the driver's screen, not here.
    if (myFareNow != null && myFareIfTaken >= myFareNow) continue;

    const view: CandidateView = {
      tripId: doc.id,
      firstName: firstNameOf(d.passengerName as string | undefined),
      seats,
      pickupArea: areaOf(pickup.address),
      dropoffArea: areaOf(dropoff.address),
      alongM: Math.round(fit.fit.boardM),
      myFareIfTaken,
      theirFare,
    };
    views.push(view);
    priced.push({ candidate, view });
  }

  views.sort((a, b) => a.alongM - b.alongM);
  priced.sort((a, b) => a.view.alongM - b.view.alongM);

  /**
   * What the fare becomes if the driver takes as many of them as the car holds.
   *
   * Priced as one car rather than by adding up individual savings, because the
   * split is not additive — each extra rider changes everybody's share of every
   * leg. Adding up the one-at-a-time figures would overstate it, and a headline
   * number the final bill cannot match is the one thing this card must not do.
   */
  let myFareBest = myFareNow;
  if (priced.length > 0 && myFareNow != null) {
    const taken: PoolRider[] = [];
    for (const { candidate } of priced) {
      if (seatsUsed([...existing, ...taken, candidate]) > MAX_POOL_RIDERS) break;
      taken.push(candidate);
    }
    const all = priceRiders([...existing, ...taken], cfg, category, tierBase || taken[0]!.soloFare);
    const mine = all.fares[ctx.uid];
    if (typeof mine === 'number' && mine < myFareBest!) myFareBest = mine;
  }

  return {
    candidates: views.slice(0, 6),
    myFareNow,
    myFareBest,
    seatsLeft,
    canAsk,
    /** Everyone aboard right now, so the card can say "you are on your own". */
    ridersAboard: existing.length,
  };
});

/** "F-10 Markaz, Islamabad" → "F-10 Markaz". A road, not a doorstep. */
function areaOf(address?: string | null): string | null {
  if (!address) return null;
  const first = address.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first.slice(0, 48) : null;
}

const askSchema = z.object({
  tripId: docId,
  /** The open pool request the rider wants picked up. */
  candidateTripId: docId,
});

/**
 * "Driver, please pick that one up."
 *
 * Writes the ask onto the trip and notifies the driver. It does not add anybody
 * and cannot: the driver's own feed marks the request as asked-for and runs
 * every gate when they tap it (see acceptEnRouteRider).
 *
 * The ask is stored as a plain Timestamp inside an array, never
 * FieldValue.serverTimestamp(). Firestore rejects sentinel values inside
 * arrays, and that one mistake is what made every single en-route pickup fail
 * for weeks — it is worth the sentence here to keep the next person from
 * reintroducing it.
 */
export const askDriverEnRoutePickup = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'askDriverEnRoutePickup', 10, 300);
  const parsed = askSchema.safeParse(req.data);
  if (!parsed.success) invalid('Provide the ride and the rider to ask about.');
  const { tripId, candidateTripId } = parsed.data;
  if (tripId === candidateTripId) invalid('That is your own ride.');

  const tripRef = db.doc(`trips/${tripId}`);
  const [tripSnap, candidateSnap] = await Promise.all([
    tripRef.get(),
    db.doc(`trips/${candidateTripId}`).get(),
  ]);
  if (!tripSnap.exists) throw new HttpsError('not-found', 'That ride no longer exists.');

  const trip = tripSnap.data()!;
  const members = (trip.poolMembers as string[] | undefined) ?? [trip.passengerId as string];
  if (trip.passengerId !== ctx.uid && !members.includes(ctx.uid)) {
    throw new HttpsError('permission-denied', 'That is not your ride.');
  }
  const driverId = trip.driverId as string | undefined;
  if (!driverId) {
    throw new HttpsError(
      'failed-precondition',
      'Once a driver has taken your ride you can ask them to pick somebody up on the way.',
    );
  }
  if (!LIVE.has((trip.status as string) ?? '')) {
    throw new HttpsError('failed-precondition', 'That ride is no longer going anywhere.');
  }
  if (!candidateSnap.exists || candidateSnap.get('status') !== 'requested') {
    throw new HttpsError('failed-precondition', 'That rider has already been picked up by someone else.');
  }

  const asks = (trip.enRouteAsks as { candidateTripId?: string }[] | undefined) ?? [];
  if (asks.some((a) => a.candidateTripId === candidateTripId)) {
    return { ok: true, alreadyAsked: true };
  }
  if (asks.length >= MAX_ASKS) {
    throw new HttpsError('failed-precondition', 'You have already asked about enough riders on this trip.');
  }

  await tripRef.set(
    {
      enRouteAsks: FieldValue.arrayUnion({
        candidateTripId,
        byUid: ctx.uid,
        at: Timestamp.now(),
      }),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const who = firstNameOf(candidateSnap.get('passengerName') as string | undefined);
  await sendToUser(
    driverId,
    'Your passenger asked for a pickup',
    `${who} is waiting on your route. Open "Riders on your way" to see what it pays.`,
    { type: 'enroute_ask', tripId, candidateTripId },
  ).catch((e) => logger.warn('enRouteSavings: could not notify the driver', e));

  return { ok: true, alreadyAsked: false };
});
