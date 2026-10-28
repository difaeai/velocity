/**
 * "People on your route": who is listed to whom, what leaves the server, and
 * the invite into the host's own shared ride.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { canShareWith, declineRideInvite, getMyRideInvites, getRouteMates, inviteRouteMates } from '../routeMates';

const HOME = { lat: 33.6938, lng: 73.0652, address: 'House 1, Street 13, G-9/2, Islamabad' };
const I8 = { lat: 33.6672, lng: 73.0726, address: 'D Watson, I-8 Markaz, Islamabad' };
const NEAR_I8 = { lat: 33.6690, lng: 73.0760, address: 'Office, I-8/3, Islamabad' };
const FAR = { lat: 33.5651, lng: 73.0169, address: 'Saddar, Rawalpindi' };

async function route(uid: string, id: string, pickup: object, dropoff: object, extra: object = {}) {
  await db().doc(`users/${uid}/dailyRoutes/${id}`).set({ pickup, dropoff, time: '08:30', ...extra });
}

beforeEach(async () => {
  await clearFirestore();
  await db().doc('users/me').set({ name: 'Hassan Khan', gender: 'male' });
  await db().doc('users/ali').set({ name: 'Ali Raza', gender: 'male', phoneNumber: '+923001234567' });
  await db().doc('users/sana').set({ name: 'Sana Ali', gender: 'female' });
  await db().doc('users/quiet').set({ name: 'Usman Tariq', gender: 'male' });
  await db().doc('users/far').set({ name: 'Bilal', gender: 'male' });
  await route('ali', 'r-ali', HOME, NEAR_I8);
  await route('sana', 'r-sana', HOME, I8);
  await route('quiet', 'r-quiet', HOME, I8, { notify: false });
  await route('far', 'r-far', HOME, FAR);
});

describe('canShareWith', () => {
  it('pairs the same gender, or two people fine with any', () => {
    expect(canShareWith({ gender: 'male', mixedRideOk: false }, { gender: 'male', mixedRideOk: false })).toBe(true);
    expect(canShareWith({ gender: 'male', mixedRideOk: true }, { gender: 'female', mixedRideOk: false })).toBe(false);
    expect(canShareWith({ gender: 'male', mixedRideOk: true }, { gender: 'female', mixedRideOk: true })).toBe(true);
    expect(canShareWith({ gender: null, mixedRideOk: false }, { gender: null, mixedRideOk: false })).toBe(false);
  });
});

describe('getRouteMates', () => {
  it('lists only people who could share the car, by first name and area', async () => {
    const res = (await getRouteMates.run(makeReq({ from: HOME, to: I8 }, 'me'))) as {
      mates: Record<string, unknown>[];
    };
    // Sana is a woman who has not said any gender is fine; Usman switched alerts off; Bilal goes elsewhere.
    expect(res.mates).toEqual([
      { id: 'r-ali', firstName: 'Ali', gender: 'male', fromArea: 'G-9', toArea: 'I-8', time: '08:30' },
    ]);
    expect(JSON.stringify(res)).not.toContain('+92');
  });
});

describe('inviteRouteMates', () => {
  beforeEach(async () => {
    await db().doc('trips/t1').set({
      passengerId: 'me', pool: true, status: 'requested', shareCode: 'ABCD2345',
      offeredFare: 400, fare: null, poolMembers: ['me'], pickup: HOME, dropoff: I8,
    });
  });

  it('asks each chosen mate once', async () => {
    const first = await inviteRouteMates.run(makeReq({ tripId: 't1', mateIds: ['r-ali', 'r-sana'] }, 'me'));
    expect(first).toEqual({ invited: 1, notFound: [] });
    expect((await db().doc('trips/t1').get()).get('invitedUids')).toEqual(['ali']);
    const again = await inviteRouteMates.run(makeReq({ tripId: 't1', mateIds: ['r-ali'] }, 'me'));
    expect(again).toEqual({ invited: 0, notFound: [] });
  });

  it('refuses anyone but the host', async () => {
    await expect(inviteRouteMates.run(makeReq({ tripId: 't1', mateIds: ['r-ali'] }, 'ali'))).rejects.toThrow(/your own shared ride/);
  });

  it('asks someone by username, and they see it until they decline', async () => {
    await db().doc('usernames/usman').set({ uid: 'quiet', username: 'Usman' });
    const res = await inviteRouteMates.run(makeReq({ tripId: 't1', usernames: ['@Usman', 'nobody'] }, 'me'));
    expect(res).toEqual({ invited: 1, notFound: ['nobody'] });

    const inbox = (await getMyRideInvites.run(makeReq({}, 'quiet'))) as { invites: Record<string, unknown>[] };
    expect(inbox.invites).toHaveLength(1);
    expect(inbox.invites[0]).toMatchObject({ tripId: 't1', code: 'ABCD2345', toArea: 'D Watson', riders: 1 });

    await declineRideInvite.run(makeReq({ tripId: 't1' }, 'quiet'));
    expect(((await getMyRideInvites.run(makeReq({}, 'quiet'))) as { invites: unknown[] }).invites).toEqual([]);
  });
});
