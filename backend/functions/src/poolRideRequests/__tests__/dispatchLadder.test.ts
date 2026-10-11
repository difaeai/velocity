/**
 * The offer ladder's decisions, with no Firestore anywhere near them.
 *
 * Verified invariants:
 *  - readDispatch tells "no ladder" (a pool from before this shipped) apart
 *    from an empty one, because the two must behave differently
 *  - poolVisibleToDriver hides a pool under offer from everyone but its holder,
 *    and keeps hiding it from anyone who has refused it
 *  - every way the ladder can end puts the ride in front of every nearby driver
 *  - orderCandidates asks the zone queue's most senior driver first and sends
 *    unqueued drivers to the tail
 *  - pickNextOffer never overwrites a live offer, never re-offers a refusal,
 *    and opens up rather than stranding a pool nobody can be found for
 */
import { describe, it, expect } from 'vitest';

import {
  EMPTY_DISPATCH,
  agedOut,
  describeOffer,
  offerHasLapsed,
  offerIsLive,
  orderCandidates,
  pickNextOffer,
  poolVisibleToDriver,
  readDispatch,
  type DispatchCandidate,
  type PoolDispatchState,
} from '../dispatchLadder';
import type { DispatchSettings } from '../../pricing/types';

const SETTINGS: DispatchSettings = {
  enabled: true,
  offerSeconds: 25,
  maxOffers: 8,
  radiusM: 5000,
  openToAllAfterSec: 240,
};

const NOW = 1_800_000_000_000;

const state = (over: Partial<PoolDispatchState> = {}): PoolDispatchState => ({
  ...EMPTY_DISPATCH,
  ...over,
});

const offered = (driverId: string, msLeft = 10_000): PoolDispatchState =>
  state({ offeredDriverId: driverId, offeredAt: NOW - 1000, offerExpiresAt: NOW + msLeft, offers: 1 });

const candidate = (driverId: string, over: Partial<DispatchCandidate> = {}): DispatchCandidate => ({
  driverId,
  distanceM: 1000,
  rank: null,
  ...over,
});

// ── readDispatch ────────────────────────────────────────────────────────────

describe('readDispatch', () => {
  it('reports a pool created before the ladder as having no ladder at all', () => {
    const { dispatch, legacy } = readDispatch({ status: 'open' });
    expect(legacy).toBe(true);
    expect(dispatch).toEqual(EMPTY_DISPATCH);
  });

  it('distinguishes an explicitly empty ladder from a missing one', () => {
    const { legacy } = readDispatch({ dispatch: EMPTY_DISPATCH });
    expect(legacy).toBe(false);
  });

  it('reads a ladder in flight', () => {
    const { dispatch, legacy } = readDispatch({
      dispatch: {
        offeredDriverId: 'd2',
        offeredAt: NOW,
        offerExpiresAt: NOW + 25_000,
        offers: 2,
        declined: ['d1'],
        openToAll: false,
      },
    });
    expect(legacy).toBe(false);
    expect(dispatch.offeredDriverId).toBe('d2');
    expect(dispatch.offers).toBe(2);
    expect(dispatch.declined).toEqual(['d1']);
  });

  it('survives a half-written ladder rather than throwing on it', () => {
    const { dispatch, legacy } = readDispatch({
      dispatch: { offeredDriverId: 42, offers: 'lots', declined: ['ok', 7, null], openToAll: 'yes' },
    });
    expect(legacy).toBe(false);
    expect(dispatch.offeredDriverId).toBeNull();
    expect(dispatch.offers).toBe(0);
    // The one usable id is kept and the junk dropped — a corrupt entry must not
    // silently un-decline a driver who already refused.
    expect(dispatch.declined).toEqual(['ok']);
    expect(dispatch.openToAll).toBe(false);
  });

  it('treats an array as no ladder, not as an empty one', () => {
    expect(readDispatch({ dispatch: [] }).legacy).toBe(true);
  });
});

// ── offer lifetime ──────────────────────────────────────────────────────────

describe('offer lifetime', () => {
  it('is live while there is time left and lapsed once there is not', () => {
    expect(offerIsLive(offered('d1', 1), NOW)).toBe(true);
    expect(offerHasLapsed(offered('d1', 1), NOW)).toBe(false);

    const expired = state({ offeredDriverId: 'd1', offerExpiresAt: NOW });
    // The boundary belongs to the lapse: a driver whose clock reads 0 has had
    // their time, and the server must not hold the ride for another tick.
    expect(offerIsLive(expired, NOW)).toBe(false);
    expect(offerHasLapsed(expired, NOW)).toBe(true);
  });

  it('is neither live nor lapsed when nobody has been offered it', () => {
    expect(offerIsLive(EMPTY_DISPATCH, NOW)).toBe(false);
    expect(offerHasLapsed(EMPTY_DISPATCH, NOW)).toBe(false);
  });

  it('ages out on the boundary, and treats an unknown creation time as old', () => {
    expect(agedOut(NOW - 240_000, SETTINGS, NOW)).toBe(true);
    expect(agedOut(NOW - 239_999, SETTINGS, NOW)).toBe(false);
    // No age to measure must never mean "hide it".
    expect(agedOut(null, SETTINGS, NOW)).toBe(true);
  });
});

// ── poolVisibleToDriver ─────────────────────────────────────────────────────

describe('poolVisibleToDriver', () => {
  const see = (dispatch: PoolDispatchState, driverId: string, over: Partial<{ legacy: boolean; createdAtMs: number | null; settings: DispatchSettings }> = {}) =>
    poolVisibleToDriver({
      dispatch,
      legacy: false,
      driverId,
      createdAtMs: NOW - 5_000,
      settings: SETTINGS,
      now: NOW,
      ...over,
    });

  it('shows a pool under offer to its holder, exclusively, with the clock', () => {
    const v = see(offered('d1'), 'd1');
    expect(v.visible).toBe(true);
    expect(v.exclusive).toBe(true);
    expect(v.offerExpiresAt).toBe(NOW + 10_000);
    expect(v.reason).toBe('yours');
  });

  it('hides that same pool from every other nearby driver', () => {
    const v = see(offered('d1'), 'd2');
    expect(v.visible).toBe(false);
    expect(v.reason).toBe('offered_elsewhere');
  });

  it('keeps a refused pool out of the refuser’s feed even once it opens to all', () => {
    const v = see(state({ declined: ['d1'], openToAll: true }), 'd1');
    expect(v.visible).toBe(false);
    expect(v.reason).toBe('declined');
  });

  it('shows an exhausted ladder to everybody, with no clock on it', () => {
    const v = see(state({ openToAll: true, offers: 8 }), 'd9');
    expect(v).toMatchObject({ visible: true, exclusive: false, reason: 'open_to_all' });
  });

  it('shows an aged-out pool to everybody even mid-ladder', () => {
    const v = see(state({ offers: 2 }), 'd9', { createdAtMs: NOW - 300_000 });
    expect(v).toMatchObject({ visible: true, exclusive: false, reason: 'aged_out' });
  });

  it('does NOT let an aged-out pool break a live exclusive offer', () => {
    // Age opens a pool up, but not out from under the driver holding it: they
    // are mid-decision on a card with a running clock.
    const v = see(offered('d1'), 'd2', { createdAtMs: NOW - 300_000 });
    expect(v.visible).toBe(false);
    expect(v.reason).toBe('offered_elsewhere');
    expect(see(offered('d1'), 'd1', { createdAtMs: NOW - 300_000 }).exclusive).toBe(true);
  });

  it('falls open in the gap between one offer lapsing and the next being made', () => {
    const v = see(state({ offeredDriverId: 'd1', offerExpiresAt: NOW - 1, offers: 1 }), 'd2');
    expect(v.visible).toBe(true);
    expect(v.exclusive).toBe(false);
    expect(v.reason).toBe('lapsed_gap');
  });

  it('broadcasts a pool from before the ladder shipped, rather than hiding it', () => {
    const v = see(EMPTY_DISPATCH, 'd9', { legacy: true });
    expect(v).toMatchObject({ visible: true, exclusive: false, reason: 'legacy' });
  });

  it('broadcasts everything when the ladder is switched off', () => {
    const v = see(offered('d1'), 'd2', { settings: { ...SETTINGS, enabled: false } });
    expect(v).toMatchObject({ visible: true, exclusive: false, reason: 'disabled' });
  });
});

// ── orderCandidates ─────────────────────────────────────────────────────────

describe('orderCandidates', () => {
  it('asks the zone queue in its own order, not by distance', () => {
    const ordered = orderCandidates([
      candidate('far-but-senior', { distanceM: 4800, rank: 0 }),
      candidate('near-but-junior', { distanceM: 150, rank: 3 }),
    ]);
    expect(ordered.map((c) => c.driverId)).toEqual(['far-but-senior', 'near-but-junior']);
  });

  it('puts unqueued drivers behind every queued one, nearest first', () => {
    const ordered = orderCandidates([
      candidate('unqueued-near', { distanceM: 100 }),
      candidate('queued-last', { distanceM: 4000, rank: 9 }),
      candidate('unqueued-far', { distanceM: 3000 }),
    ]);
    expect(ordered.map((c) => c.driverId)).toEqual(['queued-last', 'unqueued-near', 'unqueued-far']);
  });

  it('breaks exact ties by id, so the order cannot shuffle between two reads', () => {
    const tied = [candidate('zebra', { rank: 1 }), candidate('alpha', { rank: 1 })];
    expect(orderCandidates(tied).map((c) => c.driverId)).toEqual(['alpha', 'zebra']);
    expect(orderCandidates([...tied].reverse()).map((c) => c.driverId)).toEqual(['alpha', 'zebra']);
  });

  it('does not mutate what it was given', () => {
    const input = [candidate('b', { rank: 2 }), candidate('a', { rank: 1 })];
    orderCandidates(input);
    expect(input.map((c) => c.driverId)).toEqual(['b', 'a']);
  });
});

// ── pickNextOffer ───────────────────────────────────────────────────────────

describe('pickNextOffer', () => {
  const pick = (over: Partial<Parameters<typeof pickNextOffer>[0]> = {}) =>
    pickNextOffer({
      candidates: [candidate('d1', { rank: 0 }), candidate('d2', { rank: 1 }), candidate('d3', { rank: 2 })],
      dispatch: EMPTY_DISPATCH,
      settings: SETTINGS,
      createdAtMs: NOW - 1_000,
      now: NOW,
      ...over,
    });

  it('offers the first ride to the most senior driver in the zone', () => {
    expect(pick()).toEqual({ kind: 'offer', driverId: 'd1', expiresAt: NOW + 25_000, offers: 1 });
  });

  it('holds — and writes nothing — while an offer is still live', () => {
    const step = pick({ dispatch: offered('d1') });
    expect(step).toEqual({ kind: 'hold', driverId: 'd1', expiresAt: NOW + 10_000 });
  });

  it('walks down the queue as drivers refuse', () => {
    const afterOne = pick({ dispatch: state({ declined: ['d1'], offers: 1 }) });
    expect(afterOne).toMatchObject({ kind: 'offer', driverId: 'd2', offers: 2 });

    const afterTwo = pick({ dispatch: state({ declined: ['d1', 'd2'], offers: 2 }) });
    expect(afterTwo).toMatchObject({ kind: 'offer', driverId: 'd3', offers: 3 });
  });

  it('does not hand the ride back to the driver whose offer just lapsed', () => {
    // The holder is NOT on `declined` at this point — the writer adds them in
    // the same update that records the next offer. Treating a lapsed offer as a
    // refusal has to happen here, or the ladder offers d1 the ride for ever and
    // never reaches d2.
    const lapsed = state({ offeredDriverId: 'd1', offerExpiresAt: NOW - 1, offers: 1, declined: [] });
    expect(pick({ dispatch: lapsed })).toMatchObject({ kind: 'offer', driverId: 'd2', offers: 2 });
  });

  it('opens up when the only candidate is the driver who let it lapse', () => {
    const lapsed = state({ offeredDriverId: 'd1', offerExpiresAt: NOW - 1, offers: 1 });
    expect(pick({ candidates: [candidate('d1', { rank: 0 })], dispatch: lapsed }))
      .toEqual({ kind: 'open_to_all', reason: 'no_candidates' });
  });

  it('re-filters the declined list, because it is read a moment after the candidates', () => {
    // d1 refused in the gap between the geo query and the transaction. The
    // candidate list still has them; the ladder must not offer it to them again.
    const step = pick({
      candidates: [candidate('d1', { rank: 0 })],
      dispatch: state({ declined: ['d1'], offers: 1 }),
    });
    expect(step).toEqual({ kind: 'open_to_all', reason: 'no_candidates' });
  });

  it('opens up when everybody nearby has refused', () => {
    expect(pick({ dispatch: state({ declined: ['d1', 'd2', 'd3'], offers: 3 }) }))
      .toEqual({ kind: 'open_to_all', reason: 'no_candidates' });
  });

  it('opens up when no driver could be found at all', () => {
    // The case that would stranded a pool created in an empty zone: a driver
    // who comes online a minute later has to be able to find it.
    expect(pick({ candidates: [] })).toEqual({ kind: 'open_to_all', reason: 'no_candidates' });
  });

  it('stops laddering after maxOffers however many drivers are left', () => {
    const step = pick({
      candidates: Array.from({ length: 20 }, (_, i) => candidate(`d${i}`, { rank: i })),
      dispatch: state({ offers: 8 }),
    });
    expect(step).toEqual({ kind: 'open_to_all', reason: 'max_offers' });
  });

  it('opens up once the ride is old, before it even looks for candidates', () => {
    expect(pick({ createdAtMs: NOW - 300_000 })).toEqual({ kind: 'open_to_all', reason: 'aged_out' });
  });

  it('checks age before maxOffers, so an old pool is never reported as exhausted', () => {
    const step = pick({ createdAtMs: NOW - 300_000, dispatch: state({ offers: 99 }) });
    expect(step).toEqual({ kind: 'open_to_all', reason: 'aged_out' });
  });

  it('is a no-op on a ladder that already opened to all', () => {
    expect(pick({ dispatch: state({ openToAll: true }) }))
      .toEqual({ kind: 'open_to_all', reason: 'already_open' });
  });

  it('opens everything when the ladder is switched off', () => {
    expect(pick({ settings: { ...SETTINGS, enabled: false } }))
      .toEqual({ kind: 'open_to_all', reason: 'disabled' });
  });

  it('respects an admin shortening the offer window', () => {
    const step = pick({ settings: { ...SETTINGS, offerSeconds: 10 } });
    expect(step).toMatchObject({ kind: 'offer', expiresAt: NOW + 10_000 });
  });

  it('never offers a zero-length window, whatever is in the config', () => {
    const step = pick({ settings: { ...SETTINGS, offerSeconds: 0 } });
    expect(step).toMatchObject({ kind: 'offer' });
    expect((step as { expiresAt: number }).expiresAt).toBeGreaterThan(NOW);
  });
});

// ── describeOffer ───────────────────────────────────────────────────────────

describe('describeOffer', () => {
  it('counts the seconds the driver has left', () => {
    expect(describeOffer(NOW + 20_000, NOW)).toBe('Yours for 20s — accept or pass and it goes to the next driver.');
  });

  it('rounds up, so a card never shows 0s while the offer is still good', () => {
    expect(describeOffer(NOW + 1, NOW)).toContain('1s');
  });

  it('says the ride has gone once the time is up', () => {
    expect(describeOffer(NOW, NOW)).toBe('This ride has moved on to another driver.');
    expect(describeOffer(NOW - 5_000, NOW)).toBe('This ride has moved on to another driver.');
  });
});
