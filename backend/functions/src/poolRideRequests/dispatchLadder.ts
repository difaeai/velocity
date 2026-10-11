/**
 * One shared ride, one driver at a time, and the next one when they pass.
 * ----------------------------------------------------------------------------
 * WHAT THIS REPLACES
 * ------------------
 * `getNearbyPoolRequests` showed every open pool to every nearby driver whose
 * gender matched, sorted by distance, and `driverRespondToRequest` let the
 * first tap win:
 *
 *     if (data.driverId !== null) throw 'Another driver has already responded'
 *
 * So a pool was a race. Three things follow from that, and all three are the
 * reason this file exists:
 *
 *  · THERE WAS NO "NO". A driver could accept or ignore; `action` was
 *    `'accept' | 'counter'` and counter is dead. Ignoring is invisible, so the
 *    pool sat in forty feeds until somebody tapped or it expired at 30 minutes.
 *    A driver who has decided they do not want a ride cannot say so, and the
 *    system cannot learn anything from the decision.
 *  · SENIORITY WAS IGNORED. `pricing/driverQueue.ts` exists to make waiting
 *    pay — first come, first served, and going offline forfeits your place. It
 *    gates `placeBid` on solo requests. Pools bypassed it completely, so the
 *    fairest half of the marketplace was the half with no queue in it.
 *  · THE FASTEST PHONE WON. Which is the thing the queue was written to stop.
 *
 * THE LADDER
 * ----------
 * A pool is offered to one driver, exclusively, for `offerSeconds`. They may
 * accept it or refuse it. Refusing — or letting the offer lapse — puts them on
 * the `declined` list, which they are never offered this pool from again, and
 * the ride moves to the next candidate. Candidates are ordered by the SAME zone
 * queue that gates solo bids, so the driver who has been online longest in the
 * pickup's zone is asked first.
 *
 * WHY IT ALWAYS ENDS IN A BROADCAST
 * ---------------------------------
 * After `maxOffers` refusals, or `openToAllAfterSec` since the pool was
 * created, or when there is nobody left to ask, the ride opens to every nearby
 * driver and the old first-tap-wins behaviour returns. That is not a fallback
 * bolted on for safety — it is the same guarantee `queue.openToAllAfterSec`
 * makes in `driverQueue.ts`, and for the same reason stated there: a rider
 * waiting is a worse outcome than a driver served out of turn. An ordering
 * policy may never become a precondition for the marketplace working.
 *
 * FAILING OPEN, AND THE ONE GAP WHERE IT COSTS SOMETHING
 * -----------------------------------------------------
 * A pool whose offer has LAPSED but which nothing has advanced yet is visible
 * to everybody, not nobody. During that gap a fast-polling driver can take a
 * ride the ladder would have offered to someone more senior.
 *
 * That is deliberate, and it is the cheaper of the two mistakes. The gap is
 * closed by `getNearbyPoolRequests` advancing a lapsed ladder the moment any
 * driver's feed touches it, and by a one-minute sweeper behind that; so in
 * practice it is milliseconds, and it resolves in the queue's favour anyway
 * because the advance picks by seniority rather than by who polled. The
 * alternative — hiding a ride that no driver currently holds — risks a pool
 * that is invisible to the entire city because one offer was written badly.
 *
 * Pure. Every Firestore read and write is in `dispatch.ts`.
 * ----------------------------------------------------------------------------
 */
import type { DispatchSettings } from '../pricing/types';

/**
 * The ladder's state, stored as `dispatch` on the `poolRideRequests` document.
 *
 * One nested map rather than six top-level fields so that advancing the ladder
 * is a single-key update, and so a reader can tell "never dispatched" from
 * "dispatched, nobody holds it" — see `readDispatch`.
 */
export interface PoolDispatchState {
  /** The driver holding the exclusive offer, or null when nobody does. */
  offeredDriverId: string | null;
  offeredAt: number | null;
  /** Epoch ms the current offer lapses at. */
  offerExpiresAt: number | null;
  /** How many offers this pool has made, refusals included. */
  offers: number;
  /** Everyone who has refused or let an offer lapse. Never re-offered. */
  declined: string[];
  /** The ladder is finished — every nearby driver may take the ride. */
  openToAll: boolean;
}

export const EMPTY_DISPATCH: PoolDispatchState = {
  offeredDriverId: null,
  offeredAt: null,
  offerExpiresAt: null,
  offers: 0,
  declined: [],
  openToAll: false,
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The ladder state on a request document, and whether there is one at all.
 *
 * `legacy` is the important half. Every pool created before this shipped has no
 * `dispatch` field, and so does every pool created by a build that predates it.
 * Treating a missing ladder as an empty one would make all of them invisible to
 * every driver the moment this deploys — the whole open-pool backlog, gone from
 * every feed. So "no ladder" is reported as such and read as a broadcast, which
 * is exactly the behaviour those documents were created under.
 */
export function readDispatch(data: unknown): { dispatch: PoolDispatchState; legacy: boolean } {
  const raw = (data as { dispatch?: unknown } | null | undefined)?.dispatch;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { dispatch: { ...EMPTY_DISPATCH }, legacy: true };
  }
  const d = raw as Record<string, unknown>;
  return {
    legacy: false,
    dispatch: {
      offeredDriverId: typeof d.offeredDriverId === 'string' ? d.offeredDriverId : null,
      offeredAt: num(d.offeredAt),
      offerExpiresAt: num(d.offerExpiresAt),
      offers: Math.max(0, Math.trunc(num(d.offers) ?? 0)),
      declined: Array.isArray(d.declined) ? d.declined.filter((x): x is string => typeof x === 'string') : [],
      openToAll: d.openToAll === true,
    },
  };
}

/** True while a named driver still holds this pool exclusively. */
export function offerIsLive(dispatch: PoolDispatchState, now: number): boolean {
  return (
    dispatch.offeredDriverId !== null &&
    dispatch.offerExpiresAt !== null &&
    dispatch.offerExpiresAt > now
  );
}

/** True when somebody was offered this pool and their time ran out. */
export function offerHasLapsed(dispatch: PoolDispatchState, now: number): boolean {
  return (
    dispatch.offeredDriverId !== null &&
    dispatch.offerExpiresAt !== null &&
    dispatch.offerExpiresAt <= now
  );
}

/** Whether the ride is past the age at which it opens to everybody. */
export function agedOut(
  createdAtMs: number | null,
  settings: DispatchSettings,
  now: number,
): boolean {
  if (createdAtMs === null) return true; // no age to measure — do not hide it
  return now - createdAtMs >= Math.max(0, settings.openToAllAfterSec) * 1000;
}

// ── Who sees what ───────────────────────────────────────────────────────────

export type VisibilityReason =
  /** The ladder is switched off — behave as before this file existed. */
  | 'disabled'
  /** A pool created before the ladder shipped. Broadcast, as it always was. */
  | 'legacy'
  /** The ladder finished. Anybody nearby may take it. */
  | 'open_to_all'
  /** Old enough that the ladder no longer gets to hold it back. */
  | 'aged_out'
  /** This driver is holding the exclusive offer. */
  | 'yours'
  /** Somebody else is holding it. */
  | 'offered_elsewhere'
  /** An offer ran out and nothing has advanced the ladder yet. */
  | 'lapsed_gap'
  /** This driver has already refused this pool. */
  | 'declined';

export interface Visibility {
  visible: boolean;
  /** True only when this driver alone may accept, with a countdown running. */
  exclusive: boolean;
  /** Epoch ms their exclusive hold ends, when they have one. */
  offerExpiresAt: number | null;
  reason: VisibilityReason;
}

/**
 * May this driver see — and therefore accept — this pool right now?
 *
 * This is the function that makes dispatch sequential rather than a broadcast,
 * and `getNearbyPoolRequests` filters its whole feed through it. The ordering
 * in `pickNextOffer` decides who gets asked; this decides who can answer.
 *
 * A driver who has already refused stays hidden even once the ride opens to
 * all. They said no to this ride; putting it back in their feed four minutes
 * later is how a dispatcher teaches drivers to ignore it.
 */
export function poolVisibleToDriver(input: {
  dispatch: PoolDispatchState;
  legacy: boolean;
  driverId: string;
  createdAtMs: number | null;
  settings: DispatchSettings;
  now: number;
}): Visibility {
  const { dispatch, legacy, driverId, createdAtMs, settings, now } = input;

  const open = (reason: VisibilityReason): Visibility => ({
    visible: true,
    exclusive: false,
    offerExpiresAt: null,
    reason,
  });

  if (!settings.enabled) return open('disabled');
  if (legacy) return open('legacy');

  // Checked before every open-to-all path: a refusal is permanent for this
  // pool, and that is the point of recording it.
  if (dispatch.declined.includes(driverId)) {
    return { visible: false, exclusive: false, offerExpiresAt: null, reason: 'declined' };
  }

  if (offerIsLive(dispatch, now)) {
    if (dispatch.offeredDriverId === driverId) {
      return {
        visible: true,
        exclusive: true,
        offerExpiresAt: dispatch.offerExpiresAt,
        reason: 'yours',
      };
    }
    // Somebody else is holding it. The one case where a nearby, eligible driver
    // is shown nothing — which is the entire feature.
    return { visible: false, exclusive: false, offerExpiresAt: null, reason: 'offered_elsewhere' };
  }

  if (dispatch.openToAll) return open('open_to_all');
  if (agedOut(createdAtMs, settings, now)) return open('aged_out');

  // No live offer and the ladder is not finished: either it has not started or
  // an offer has just lapsed. Open, not hidden — see the header.
  return open('lapsed_gap');
}

// ── Choosing the next driver ────────────────────────────────────────────────

export interface DispatchCandidate {
  driverId: string;
  /** Exact metres from the pickup, for the tail ordering and the card. */
  distanceM: number;
  /** Place in the pickup zone's FIFO queue, or null when not queued there. */
  rank: number | null;
}

/**
 * Seniority first, then proximity.
 *
 * Drivers queued in the pickup's zone are ordered by that queue, because it is
 * the one the solo side already honours and a pool that ordered drivers
 * differently would make "whose turn is it" unanswerable. Drivers with no rank
 * — just across a cell boundary, or online since after the last tick — go
 * behind all of them, nearest first, for the reason `claimDecision` gives for
 * giving them the tail rather than refusing them: a geohash edge is arbitrary
 * and must not cost somebody the work.
 *
 * `driverId` is the final tie-break so that two drivers at an identical rank or
 * an identical distance do not swap places between one call and the next.
 */
export function orderCandidates(candidates: DispatchCandidate[]): DispatchCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.rank !== null && b.rank !== null) {
      return a.rank - b.rank || a.driverId.localeCompare(b.driverId);
    }
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.distanceM - b.distanceM || a.driverId.localeCompare(b.driverId);
  });
}

export type LadderStep =
  | { kind: 'offer'; driverId: string; expiresAt: number; offers: number }
  | { kind: 'hold'; driverId: string; expiresAt: number }
  | {
      kind: 'open_to_all';
      reason: 'disabled' | 'max_offers' | 'aged_out' | 'no_candidates' | 'already_open';
    };

/**
 * The ladder's next move.
 *
 * `hold` means an offer is still live and nothing should be written — the
 * caller is a sweeper or a feed read that arrived mid-offer, and overwriting a
 * live offer would take a ride off a driver who is still looking at it.
 *
 * `candidates` must already exclude everyone on `dispatch.declined`; this
 * filters again anyway, because the two are computed at different moments and a
 * refusal landing in between is exactly the race the re-check exists for.
 */
export function pickNextOffer(input: {
  candidates: DispatchCandidate[];
  dispatch: PoolDispatchState;
  settings: DispatchSettings;
  createdAtMs: number | null;
  now: number;
}): LadderStep {
  const { candidates, dispatch, settings, createdAtMs, now } = input;

  if (!settings.enabled) return { kind: 'open_to_all', reason: 'disabled' };
  if (dispatch.openToAll) return { kind: 'open_to_all', reason: 'already_open' };

  if (offerIsLive(dispatch, now)) {
    return {
      kind: 'hold',
      driverId: dispatch.offeredDriverId!,
      expiresAt: dispatch.offerExpiresAt!,
    };
  }

  // Age is checked before the candidate list so that an old pool opens up even
  // on a tick where the geo query happened to come back empty.
  if (agedOut(createdAtMs, settings, now)) return { kind: 'open_to_all', reason: 'aged_out' };
  if (dispatch.offers >= Math.max(1, Math.trunc(settings.maxOffers))) {
    return { kind: 'open_to_all', reason: 'max_offers' };
  }

  const declined = new Set(dispatch.declined);
  // A driver whose offer ran out has had their turn, and they are not on
  // `declined` yet — the writer adds them in the same update that records the
  // next offer, which is AFTER this choice is made. Without this line the
  // ladder hands the ride straight back to the driver who just let it lapse,
  // for ever, and never reaches the second driver at all.
  if (dispatch.offeredDriverId && offerHasLapsed(dispatch, now)) {
    declined.add(dispatch.offeredDriverId);
  }
  const next = orderCandidates(candidates).find((c) => !declined.has(c.driverId));
  // Nobody left to ask. Opening up rather than waiting is what stops a pool
  // created in an empty zone from staying invisible until it ages out: a driver
  // who comes online a minute later finds it in their feed.
  if (!next) return { kind: 'open_to_all', reason: 'no_candidates' };

  return {
    kind: 'offer',
    driverId: next.driverId,
    expiresAt: now + Math.max(1, Math.trunc(settings.offerSeconds)) * 1000,
    offers: dispatch.offers + 1,
  };
}

/**
 * What the driver app puts on the card while they hold a ride.
 *
 * Seconds, because a countdown is the only honest way to say "decide now" —
 * and the number has to match the one the server will enforce, or a driver
 * taps at what their screen calls 3s and is told they were too late.
 */
export function describeOffer(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  if (seconds === 0) return 'This ride has moved on to another driver.';
  return `Yours for ${seconds}s — accept or pass and it goes to the next driver.`;
}
