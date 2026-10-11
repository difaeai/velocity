/**
 * Driving the ladder: who is eligible, who holds the ride, and moving it on.
 * ----------------------------------------------------------------------------
 * The decisions are all in `dispatchLadder.ts` and none of them need Firebase.
 * This file is the reads and the writes around them, in the same relationship
 * `claimGate.ts` has to `driverQueue.ts`.
 *
 * WHY THE CANDIDATE QUERY IS OUTSIDE THE TRANSACTION
 * -------------------------------------------------
 * Finding candidates reads up to nine geohash ranges of driver documents. A
 * Firestore transaction holding that many reads would contend with every other
 * write to those documents — and drivers write `lastLocation` every thirty
 * seconds, so the transaction would retry until it failed.
 *
 * So the candidate list is computed first and the transaction only re-reads the
 * one request document. That makes the list up to a second stale: a driver may
 * have gone offline, or refused in the gap. Neither matters. A refusal landing
 * in between is caught because the transaction re-reads `declined` and
 * `pickNextOffer` filters on it again; a driver who went offline is offered a
 * ride they will not answer, their offer lapses, and the ladder moves on —
 * which is the behaviour for an ignored offer anyway.
 *
 * NOTHING HERE THROWS INTO A CALLER'S FACE
 * ----------------------------------------
 * `advancePoolLadder` is called from a pool being created, from a refusal, from
 * a driver's feed poll and from a sweeper. In three of those four a thrown
 * error would break something the driver or rider was actually doing, to report
 * a failure in a background ordering concern. So every failure is logged and
 * swallowed, and the pool stays where it is until the sweeper tries again.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';
import { distanceBetween } from 'geofire-common';

import { db, FieldValue } from '../lib/firebase';
import { queryNearbyDriverDocs } from '../lib/nearbyDrivers';
import { notifyUser } from '../lib/fcm';
import { commissionDue, getCommissionSettings } from '../domain/commission';
import { pktDayKey } from '../domain/dailyTarget';
import { isVehicleConfirmed } from '../domain/vehicleCheck';
import { encodeGeohash } from '../lib/geohash';
import { loadPricingConfig } from '../pricing/config';
import { zoneQueueFor } from '../pricing/claimGate';
import { rankOf } from '../pricing/driverQueue';
import {
  EMPTY_DISPATCH,
  offerIsLive,
  pickNextOffer,
  readDispatch,
  type DispatchCandidate,
  type LadderStep,
} from './dispatchLadder';

type GenderPref = 'male_only' | 'female_only' | 'any';

function genderAllowed(driverGender: string, pref: GenderPref): boolean {
  if (pref === 'any') return true;
  if (pref === 'male_only' && driverGender === 'male') return true;
  if (pref === 'female_only' && driverGender === 'female') return true;
  return false;
}

/**
 * Drivers who could actually complete this ride, with their queue rank.
 *
 * Every filter here mirrors a gate `driverRespondToRequest` enforces at accept.
 * That duplication is the point: a driver offered a ride they will be refused
 * at the last moment burns a rung of the ladder and `offerSeconds` of the
 * rider's time, and learns that Velocity offers them work it then takes away.
 * Where the accept path throws, this skips.
 */
export async function candidatesFor(request: {
  pickupLat: number;
  pickupLng: number;
  genderPref: GenderPref;
  leaderId: string;
  passengers: string[];
  radiusM: number;
}): Promise<DispatchCandidate[]> {
  const { pickupLat, pickupLng, genderPref, leaderId, passengers, radiusM } = request;

  const [docs, commissionSettings, config] = await Promise.all([
    queryNearbyDriverDocs(pickupLat, pickupLng, radiusM),
    getCommissionSettings(),
    loadPricingConfig(),
  ]);

  // The queue that gates solo bids in this zone, so a pool asks drivers in the
  // order the rest of the marketplace already asks them.
  const precision = Math.max(1, Math.trunc(config.peak.zonePrecision));
  let queueEntries: { driverId: string; queuedAt: number; lastSeenAt: number }[] = [];
  try {
    const { queue } = await zoneQueueFor({ lat: pickupLat, lng: pickupLng }, precision);
    queueEntries = queue?.entries ?? [];
  } catch (e) {
    // No queue is not an error — it orders everyone by distance instead.
    logger.debug('pool dispatch: zone queue unreadable, ordering by distance', e);
  }

  const inPool = new Set([leaderId, ...passengers]);
  const today = pktDayKey();
  const candidates: DispatchCandidate[] = [];

  for (const snap of docs) {
    const driverId = snap.id;
    // A pool's own members must never be offered it as the driver. The accept
    // path refuses the leader; a joiner driving their own pool would be worse.
    if (inPool.has(driverId)) continue;

    const loc = snap.get('lastLocation') as { lat?: number; lng?: number } | undefined;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
    // `queryNearbyDriverDocs` is a padded candidate set by contract — the exact
    // check is the caller's job, and this is the caller.
    const distanceM = distanceBetween([pickupLat, pickupLng], [loc.lat!, loc.lng!]) * 1000;
    if (distanceM > radiusM) continue;

    if (!genderAllowed((snap.get('gender') as string) ?? 'unspecified', genderPref)) continue;
    // Same two gates as accept: an unphotographed car and a day's unpaid
    // commission both end in a thrown accept, so do not spend a rung on them.
    if (!isVehicleConfirmed(snap)) continue;
    if (commissionDue(snap, commissionSettings, today) > 0) continue;
    // Only skip drivers who have explicitly chosen solo work. The field is
    // absent on every build that predates it, and absent must mean eligible or
    // the ladder would have nobody to climb on the installed base.
    if (snap.get('rideMode') === 'solo') continue;

    candidates.push({
      driverId,
      distanceM,
      rank: rankOf(queueEntries, driverId),
    });
  }

  return candidates;
}

/**
 * How many refusals a pool remembers.
 *
 * The ladder itself only ever makes `maxOffers` offers, so this is not about
 * the ladder — it is about the open-to-all phase afterwards, where ANY driver
 * may pass to get the card out of their feed. In a dense city that list would
 * otherwise grow without limit on a document that is read on every driver's
 * feed poll, and a 1 MB document is a hard Firestore failure rather than a
 * slow one.
 *
 * Oldest refusals are dropped first. A driver whose refusal is evicted may see
 * the pool once more, which is a far better failure than a pool nobody can read.
 */
const MAX_DECLINED = 200;

/** `declined` with `driverId` on the end, deduplicated and length-capped. */
function withDeclined(declined: string[], driverId: string | null): string[] {
  if (!driverId || declined.includes(driverId)) return declined;
  const next = [...declined, driverId];
  return next.length > MAX_DECLINED ? next.slice(next.length - MAX_DECLINED) : next;
}

export interface AdvanceOutcome {
  step: LadderStep['kind'] | 'skipped';
  driverId?: string;
  reason?: string;
}

/**
 * Move this pool's ladder on by one rung, if it is due to move.
 *
 * Safe to call from anywhere, as often as anything likes: a live offer is a
 * `hold` and writes nothing, so a feed poll from forty drivers in the same
 * second cannot shorten the offer the forty-first is holding.
 */
export async function advancePoolLadder(
  requestId: string,
  opts: { now?: number } = {},
): Promise<AdvanceOutcome> {
  const now = opts.now ?? Date.now();
  const ref = db.doc(`poolRideRequests/${requestId}`);

  try {
    const settings = (await loadPricingConfig()).dispatch;

    const first = await ref.get();
    if (!first.exists) return { step: 'skipped', reason: 'gone' };
    const head = first.data()!;
    // Only an open, driverless pool has a ladder. Everything else — taken,
    // cancelled, expired, full and under way — is somebody else's state.
    if (head.status !== 'open' || head.driverId) return { step: 'skipped', reason: 'not_open' };

    const { dispatch: headState, legacy: headLegacy } = readDispatch(head);
    // Two cheap exits before the geo query, which is the expensive part. The
    // transaction re-checks both, so these are optimisations and not the gate.
    if (offerIsLive(headState, now)) {
      return { step: 'hold', driverId: headState.offeredDriverId!, reason: 'offer_live' };
    }
    // A finished ladder has nothing left to decide. This exit is what stops the
    // sweeper from running a nine-range driver query every minute for every
    // exhausted pool in the country: Firestore sorts null before numbers, so
    // `dispatch.offerExpiresAt <= now` MATCHES the nulls left behind when a
    // ladder opens to all, and those documents come back on every sweep.
    if (headState.openToAll && !headLegacy) {
      return { step: 'skipped', reason: 'already_open' };
    }

    const candidates = settings.enabled
      ? await candidatesFor({
          pickupLat: head.pickupLat as number,
          pickupLng: head.pickupLng as number,
          genderPref: head.genderPref as GenderPref,
          leaderId: head.leaderId as string,
          passengers: (head.passengers as string[]) ?? [],
          radiusM: settings.radiusM,
        })
      : [];

    let outcome: AdvanceOutcome = { step: 'skipped', reason: 'unchanged' };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        outcome = { step: 'skipped', reason: 'gone' };
        return;
      }
      const data = snap.data()!;
      if (data.status !== 'open' || data.driverId) {
        outcome = { step: 'skipped', reason: 'not_open' };
        return;
      }

      const { dispatch, legacy } = readDispatch(data);
      const createdAtMs = toMillis(data.createdAt) ?? null;
      const step = pickNextOffer({ candidates, dispatch, settings, createdAtMs, now });

      if (step.kind === 'hold') {
        outcome = { step: 'hold', driverId: step.driverId, reason: 'offer_live' };
        return;
      }

      if (step.kind === 'open_to_all') {
        // Already open and not a legacy document: nothing to write. Writing
        // anyway would touch `updatedAt` on every poll of every exhausted pool.
        if (dispatch.openToAll && !legacy) {
          outcome = { step: 'skipped', reason: step.reason };
          return;
        }
        tx.update(ref, {
          dispatch: {
            ...dispatch,
            // The last driver to hold it let it lapse on the way here, so they
            // are a refusal like any other — otherwise the one driver who
            // ignored it would be the one it reappears for.
            declined: withDeclined(dispatch.declined, dispatch.offeredDriverId),
            openToAll: true,
            offeredDriverId: null,
            offeredAt: null,
            offerExpiresAt: null,
          },
          updatedAt: FieldValue.serverTimestamp(),
        });
        outcome = { step: 'open_to_all', reason: step.reason };
        return;
      }

      // An offer. The driver who was holding it, if any, has by now lapsed —
      // `offerIsLive` was false — so they join the declined list on their way
      // out. An ignored offer and a refused one cost the same, which is what
      // stops a driver farming rides by sitting on offers they never answer.
      const declined = withDeclined(dispatch.declined, dispatch.offeredDriverId);

      tx.update(ref, {
        dispatch: {
          offeredDriverId: step.driverId,
          offeredAt: now,
          offerExpiresAt: step.expiresAt,
          offers: step.offers,
          declined,
          openToAll: false,
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
      outcome = { step: 'offer', driverId: step.driverId };
    });

    if (outcome.step === 'offer' && outcome.driverId) {
      // After the commit, never inside it: `notifyUser` writes a notification
      // document and calls FCM, and a transaction retry would do both twice.
      await notifyOffered(outcome.driverId, requestId, head, settings.offerSeconds);
    }

    return outcome;
  } catch (e) {
    logger.warn('pool dispatch: could not advance ladder', { requestId, e });
    return { step: 'skipped', reason: 'error' };
  }
}

function toMillis(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = v as { toMillis?: () => number } | null | undefined;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  return null;
}

async function notifyOffered(
  driverId: string,
  requestId: string,
  request: Record<string, unknown>,
  offerSeconds: number,
): Promise<void> {
  try {
    const seats = Number(request.filledSlots ?? 1);
    const fare = Number(request.agreedFarePerSeat ?? request.proposedFarePerSeat ?? 0);
    await notifyUser(
      driverId,
      'A shared ride for you',
      `${request.pickupAreaName} → ${request.destinationAreaName} · ${seats} rider${seats === 1 ? '' : 's'} · Rs.${fare * seats}. Yours for ${offerSeconds}s.`,
      'ride',
      { kind: 'pool_offer', requestId },
    );
  } catch (e) {
    // A push that did not send is not a reason to undo an offer the driver can
    // still see in their feed.
    logger.warn('pool dispatch: offer push failed', { driverId, requestId, e });
  }
}

/**
 * A driver says no, and the ride goes to the next one.
 *
 * Recorded in the same transaction that clears the offer, so a refusal can
 * never be lost to a sweeper advancing the ladder at the same moment: whoever
 * commits second re-reads `declined` and sees the refusal already in it.
 */
export async function declinePoolOffer(
  requestId: string,
  driverId: string,
  opts: { now?: number } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const now = opts.now ?? Date.now();
  const ref = db.doc(`poolRideRequests/${requestId}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'gone' as string };
    const data = snap.data()!;
    if (data.driverId) return { ok: false, reason: 'taken' };
    if (data.status !== 'open') return { ok: false, reason: 'not_open' };

    const { dispatch } = readDispatch(data);
    const declined = withDeclined(dispatch.declined, driverId);

    // Only clear the hold if it is this driver's. A refusal from a driver who
    // never held the ride — an open-to-all pool they want out of their feed —
    // is still recorded, but it must not knock somebody else off their offer.
    const holding = dispatch.offeredDriverId === driverId;

    tx.update(ref, {
      dispatch: {
        ...dispatch,
        declined,
        ...(holding ? { offeredDriverId: null, offeredAt: null, offerExpiresAt: null } : {}),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });

  // Outside the transaction: advancing runs its own, and nesting them deadlocks.
  if (result.ok) await advancePoolLadder(requestId, { now });
  return result;
}

/**
 * Pools whose offer has run out, advanced.
 *
 * The backstop behind the opportunistic advance in `getNearbyPoolRequests`. In
 * a city with drivers polling their feed this almost never has work to do; it
 * exists for the pool whose offered driver closed the app in a zone where
 * nobody else is looking, which would otherwise sit until it aged out.
 */
export async function sweepLapsedPoolOffers(
  opts: { now?: number; limit?: number } = {},
): Promise<{ scanned: number; advanced: number }> {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 100;

  const snap = await db
    .collection('poolRideRequests')
    .where('status', '==', 'open')
    .where('dispatch.offerExpiresAt', '<=', now)
    .orderBy('dispatch.offerExpiresAt')
    .limit(limit)
    .get();

  let advanced = 0;
  for (const doc of snap.docs) {
    const outcome = await advancePoolLadder(doc.id, { now });
    if (outcome.step === 'offer' || outcome.step === 'open_to_all') advanced += 1;
  }
  return { scanned: snap.size, advanced };
}

/**
 * The ladder as it should start life, written by `createPoolRideRequest`.
 *
 * An explicit empty ladder rather than no field at all, so `readDispatch` can
 * tell a pool created today (and therefore governed by the ladder) from one
 * created before it existed (and therefore a broadcast).
 */
export const INITIAL_DISPATCH = { ...EMPTY_DISPATCH };

/** The zone a pickup sits in, for logs and the admin desk. */
export async function dispatchZoneFor(lat: number, lng: number): Promise<string> {
  const config = await loadPricingConfig();
  return encodeGeohash(lat, lng, Math.max(1, Math.trunc(config.peak.zonePrecision)));
}
