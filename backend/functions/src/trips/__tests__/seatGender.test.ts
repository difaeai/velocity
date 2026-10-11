/**
 * Booking a shared ride for somebody else.
 * ----------------------------------------------------------------------------
 * The case these tests are about: a woman books a shared ride for her brother.
 * Before seats carried their own gender, the trip was recorded against HER
 * profile, so the app offered her women's rides and the server seated a man in
 * one. Nobody lied — the schema simply could not say "the passenger is not me".
 *
 * Three defences are checked here, in the order they fire:
 *   1. The seat's gender is DERIVED from a relationship, never dictated by the
 *      client, so the anti-spoofing property of the old field survives.
 *   2. Such a seat never takes an instant place in a single-gender car, even
 *      when the car has no driver and the composition rules would allow it.
 *   3. Anyone already in the car can refuse it, and their refusal is final.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import {
  oppositeGender,
  requiresVettingToJoin,
  resolveSeatOccupant,
  type SeatGender,
} from '../../lib/seatGender';
import { createTrip } from '../index';
import {
  joinPoolTrip,
  driverRespondToPoolJoin,
  coRiderObjectToPoolJoin,
  getPoolJoinRequests,
} from '../poolShare';

const WOMAN   = 'seat-woman';
const WOMAN2  = 'seat-woman-2';
const MAN     = 'seat-man';

const PICKUP  = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'unspecified' as const, // ignored by the server, as ever
  pool: true,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

async function createPool(uid: string, overrides: Record<string, unknown> = {}) {
  const res = await createTrip.run(makeReq({ ...BASE_TRIP, ...overrides }, uid));
  return res as { tripId: string; shareCode: string | null };
}

beforeEach(async () => {
  await clearFirestore();
  await db().doc(`users/${WOMAN}`).set({ displayName: 'Ayesha Khan', gender: 'female' });
  await db().doc(`users/${WOMAN2}`).set({ displayName: 'Sana Ali', gender: 'female' });
  await db().doc(`users/${MAN}`).set({ displayName: 'Bilal Ahmed', gender: 'male' });
});

// ── Defence 1: the gender is derived, never dictated ────────────────────────

describe('resolveSeatOccupant', () => {
  it('books for yourself by default — the behaviour that was always there', () => {
    expect(resolveSeatOccupant('female', null)).toEqual({
      seatGender: 'female', bookedForOther: false,
    });
    expect(resolveSeatOccupant('male', 'self')).toEqual({
      seatGender: 'male', bookedForOther: false,
    });
  });

  it('turns "for someone else" into the other gender, without being told which', () => {
    // This is the whole trick: the client sends a relationship, so it never
    // gets to name a gender, and a man cannot claim "female" to be seated in a
    // women's ride. In a two-gender question "the other one" is unambiguous.
    expect(resolveSeatOccupant('female', 'other')).toEqual({
      seatGender: 'male', bookedForOther: true,
    });
    expect(resolveSeatOccupant('male', 'other')).toEqual({
      seatGender: 'female', bookedForOther: true,
    });
  });

  it('has no opposite to offer when the profile never said', () => {
    // We do not know what it is the opposite OF. The seat stays unspecified,
    // which every gate already treats as "could be either" — conservative, and
    // the reason riders are asked their gender at sign-up.
    expect(resolveSeatOccupant(undefined, 'other')).toEqual({
      seatGender: 'unspecified', bookedForOther: true,
    });
    expect(oppositeGender('unspecified')).toBe('unspecified');
  });
});

// ── Defence 2: vetting before an instant seat ───────────────────────────────

describe('requiresVettingToJoin', () => {
  const self = (g: SeatGender) => ({ seatGender: g, bookedForOther: false });
  const other = (g: SeatGender) => ({ seatGender: g, bookedForOther: true });

  it('never vets a rider travelling themselves', () => {
    expect(requiresVettingToJoin(self('male'), ['female'])).toBe(false);
    expect(requiresVettingToJoin(self('female'), ['male', 'male'])).toBe(false);
  });

  it('vets a booked-for-other seat in a single-gender car — above all when it FITS', () => {
    // The seat that fits is the dangerous one: a man books "for someone else",
    // is handed a female seat, and the composition rules wave him into a car of
    // women precisely BECAUSE the claim matches. A mismatch needs no help from
    // here — `canJoinPool` already refuses it.
    expect(requiresVettingToJoin(other('female'), ['female', 'female'])).toBe(true);
    expect(requiresVettingToJoin(other('male'), ['male'])).toBe(true);
    expect(requiresVettingToJoin(other('male'), ['female', 'female'])).toBe(true);
    expect(requiresVettingToJoin(other('female'), ['male'])).toBe(true);
  });

  it('does not vet an empty car, or one that is already mixed', () => {
    // Nobody is relying on a same-gender promise in either case.
    expect(requiresVettingToJoin(other('male'), [])).toBe(false);
    expect(requiresVettingToJoin(other('male'), ['male', 'female'])).toBe(false);
  });

  it('vets an unspecified seat booked for somebody else', () => {
    expect(requiresVettingToJoin(other('unspecified'), ['female'])).toBe(true);
  });
});

// ── The whole flow, through the real callables ──────────────────────────────

describe('booking a shared ride for someone of the other gender', () => {
  it('records the PASSENGER’s gender on the trip, not the booker’s', async () => {
    const { tripId } = await createPool(WOMAN, { bookedFor: 'other' });
    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;

    // A woman booked it for her brother, so this is a man's ride and the app
    // will match it against men's rides — which is the entire point.
    expect(trip.passengerGender).toBe('male');
    expect(trip.bookedForOther).toBe(true);
    expect(trip.poolGenders).toEqual({ male: 1, female: 0 });
    expect(trip.poolRoster[0].gender).toBe('male');
    expect(trip.poolRoster[0].bookedForOther).toBe(true);

    // And the driver feed says the same thing, so it is never matched as a
    // women's ride anywhere.
    const feed = (await db().doc(`openRequests/${tripId}`).get()).data()!;
    expect(feed.passengerGender).toBe('male');
    expect(feed.bookedForOther).toBe(true);
  });

  it('still ignores a gender the client tries to assert directly', async () => {
    // `passengerGender` on the wire has always been accepted-and-ignored, and
    // adding `bookedFor` must not have opened a side door into it.
    const { tripId } = await createPool(MAN, { passengerGender: 'female' });
    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.passengerGender).toBe('male');
    expect(trip.bookedForOther).toBe(false);
  });

  it('asks the HOST before seating such a seat in her driverless ride', async () => {
    // Ayesha is riding alone and no driver has taken the ride yet. Normally a
    // joiner is seated instantly — there is nobody to ask. But this seat was
    // booked by a man "for someone else", so somebody has to say yes, and with
    // no driver that somebody is the host.
    const { tripId, shareCode } = await createPool(WOMAN);
    const res = await joinPoolTrip.run(
      makeReq({ code: shareCode!, bookedFor: 'other' as const }, MAN),
    );

    expect(res.pending).toBe(true);
    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([WOMAN]); // not seated

    const reqDoc = (await db().doc(`trips/${tripId}/joinRequests/${MAN}`).get()).data()!;
    expect(reqDoc.status).toBe('pending');
    expect(reqDoc.vetBy).toBe('host');
    expect(reqDoc.vetReason).toBe('booked_for_other');
    expect(reqDoc.bookedForOther).toBe(true);
    // The claimed passenger is a woman — derived from the male booker.
    expect(reqDoc.riderGender).toBe('female');
  });

  it('lets the host accept, and seats the passenger the host agreed to', async () => {
    const { tripId, shareCode } = await createPool(WOMAN);
    await joinPoolTrip.run(makeReq({ code: shareCode!, bookedFor: 'other' as const }, MAN));

    await driverRespondToPoolJoin.run(
      makeReq({ tripId, riderId: MAN, action: 'accept' as const }, WOMAN),
    );

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toContain(MAN);
    // Seated as the woman the host was told about — NOT re-derived from the
    // booker's male profile, which would have quietly undone the whole thing.
    const entry = trip.poolRoster.find((r: { uid: string }) => r.uid === MAN)!;
    expect(entry.gender).toBe('female');
    expect(entry.bookedForOther).toBe(true);
    expect(trip.poolGenders).toEqual({ male: 0, female: 2 });
  });

  it('seats an ordinary joiner instantly — vetting is not a new tax on everyone', async () => {
    // The guard must be narrow. A woman joining a woman's gathering ride is
    // seated on the spot exactly as before; making every joiner wait for an
    // approval is how pools die.
    const { tripId, shareCode } = await createPool(WOMAN);
    const res = await joinPoolTrip.run(makeReq({ code: shareCode! }, WOMAN2));

    expect(res.pending).toBe(false);
    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).toEqual([WOMAN, WOMAN2]);
  });

  it('SECURITY: a stranger cannot answer a host’s join request', async () => {
    const { tripId, shareCode } = await createPool(WOMAN);
    await joinPoolTrip.run(makeReq({ code: shareCode!, bookedFor: 'other' as const }, MAN));

    await expect(driverRespondToPoolJoin.run(
      makeReq({ tripId, riderId: MAN, action: 'accept' as const }, WOMAN2),
    )).rejects.toThrow(/Only the rider whose shared ride this is/);
  });
});

// ── Defence 3: a co-rider's refusal is final ────────────────────────────────

describe('coRiderObjectToPoolJoin', () => {
  /** Two women aboard a driverless ride, with a man asking for a seat for "her". */
  async function twoWomenAndAnAsk() {
    const { tripId, shareCode } = await createPool(WOMAN);
    await joinPoolTrip.run(makeReq({ code: shareCode! }, WOMAN2));
    await joinPoolTrip.run(makeReq({ code: shareCode!, bookedFor: 'other' as const }, MAN));
    return { tripId, shareCode: shareCode! };
  }

  it('closes the request on one refusal, from anyone aboard', async () => {
    const { tripId } = await twoWomenAndAnAsk();

    // Sana is not the host — she is the second rider — and her word is enough.
    const res = await coRiderObjectToPoolJoin.run(
      makeReq({ tripId, riderId: MAN }, WOMAN2),
    );
    expect(res.rejected).toBe(true);

    const reqDoc = (await db().doc(`trips/${tripId}/joinRequests/${MAN}`).get()).data()!;
    expect(reqDoc.status).toBe('rejected');
    expect(reqDoc.rejectedBy).toBe('co_rider');
    expect(reqDoc.objections).toEqual([WOMAN2]);

    const trip = (await db().doc(`trips/${tripId}`).get()).data()!;
    expect(trip.poolMembers).not.toContain(MAN);
  });

  it('stops the host accepting over the top of a refusal', async () => {
    const { tripId } = await twoWomenAndAnAsk();
    await coRiderObjectToPoolJoin.run(makeReq({ tripId, riderId: MAN }, WOMAN2));

    await expect(driverRespondToPoolJoin.run(
      makeReq({ tripId, riderId: MAN, action: 'accept' as const }, WOMAN),
    )).rejects.toThrow(/has already been answered|has refused/);
  });

  it('SECURITY: only people actually in the car may refuse for it', async () => {
    const { tripId } = await twoWomenAndAnAsk();
    await db().doc(`users/outsider`).set({ displayName: 'Nobody', gender: 'female' });

    await expect(coRiderObjectToPoolJoin.run(
      makeReq({ tripId, riderId: MAN }, 'outsider'),
    )).rejects.toThrow(/riders already in this car/);
  });

  it('refuses to answer a request that is already decided', async () => {
    const { tripId } = await twoWomenAndAnAsk();
    await coRiderObjectToPoolJoin.run(makeReq({ tripId, riderId: MAN }, WOMAN2));

    await expect(coRiderObjectToPoolJoin.run(
      makeReq({ tripId, riderId: MAN }, WOMAN),
    )).rejects.toThrow(/already been answered/);
  });

  it('shows the pending request to the people who get to answer it', async () => {
    const { tripId } = await twoWomenAndAnAsk();
    const list = await getPoolJoinRequests.run(makeReq({ tripId }, WOMAN));
    const rows = (list as { requests: { riderId: string; bookedForOther?: boolean }[] }).requests;
    const row = rows.find((r) => r.riderId === MAN);
    expect(row).toBeTruthy();
    // The one fact that makes this decision different from any other.
    expect(row!.bookedForOther).toBe(true);
  });
});
