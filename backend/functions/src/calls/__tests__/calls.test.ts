/**
 * In-app calls: who may ring whom, and the way through when phones sit behind
 * carrier NAT. The audio itself never reaches the server, so this is the part
 * of calling that can be wrong in a way that matters — a call button that rings
 * a stranger, or a driver after the ride is over.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { calleeFor, iceServers, startCall as startCallFn, type RideParties } from '../index';

// The warm-ping branch widens the return type; every call below is a real one.
const startCall = {
  run: (r: Parameters<typeof startCallFn.run>[0]) => startCallFn.run(r) as Promise<{ callId: string }>,
};

describe('calleeFor', () => {
  const solo: RideParties = { driverId: 'd', riders: ['r'], live: true };
  const pool: RideParties = { driverId: 'd', riders: ['r1', 'r2'], live: true };

  it('puts a rider through to their driver, whatever they asked for', () => {
    expect(calleeFor(solo, 'r')).toBe('d');
    expect(calleeFor(pool, 'r2', 'r1')).toBe('d');
  });

  it('lets the driver of a one-rider ride call without naming them', () => {
    expect(calleeFor(solo, 'd')).toBe('r');
  });

  it('makes the driver of a shared ride name which rider', () => {
    expect(calleeFor(pool, 'd')).toBeNull();
    expect(calleeFor(pool, 'd', 'r2')).toBe('r2');
    expect(calleeFor(pool, 'd', 'someone-else')).toBeNull();
  });

  it('never connects a stranger, a finished ride or a ride with no driver yet', () => {
    expect(calleeFor(solo, 'stranger')).toBeNull();
    expect(calleeFor({ ...solo, live: false }, 'r')).toBeNull();
    expect(calleeFor({ ...solo, driverId: null }, 'r')).toBeNull();
  });
});

describe('iceServers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  });

  it('is free STUN only when no TURN key is configured', async () => {
    const servers = await iceServers();
    expect(servers.flatMap((s) => s.urls).every((u) => u.startsWith('stun:'))).toBe(true);
  });

  it('adds Cloudflare relay credentials, minus the port-53 URL', async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478'] },
          {
            urls: [
              'turn:turn.cloudflare.com:3478?transport=udp',
              'turn:turn.cloudflare.com:53?transport=udp',
              'turns:turn.cloudflare.com:443?transport=tcp',
            ],
            username: 'u',
            credential: 'c',
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const servers = await iceServers();
    const relay = servers.find((s) => s.username === 'u');
    expect(relay?.urls).toEqual([
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ]);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('/turn/keys/key/credentials/generate-ice-servers');
  });

  it('falls back to STUN when Cloudflare is down, rather than failing the call', async () => {
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const servers = await iceServers();
    expect(servers.flatMap((s) => s.urls).every((u) => u.startsWith('stun:'))).toBe(true);
  });
});

describe('startCall', () => {
  beforeEach(clearFirestore);

  async function seedTrip(id: string, fields: Record<string, unknown>) {
    await db().doc(`trips/${id}`).set({ passengerId: 'call-rider', driverId: 'call-driver', ...fields });
  }

  it('answers a warm ping without placing a call', async () => {
    await expect(startCallFn.run(makeReq({ warm: true }, 'call-rider'))).resolves.toEqual({ warm: true });
    expect((await db().collection('calls').get()).size).toBe(0);
  });

  it('rings the driver when a rider calls on a live ride', async () => {
    await seedTrip('t1', { status: 'arriving' });
    await db().doc('users/call-rider').set({ displayName: 'Sara Khan' });

    const { callId } = await startCall.run(makeReq({ rideKind: 'trip', rideId: 't1' }, 'call-rider'));

    const call = (await db().doc(`calls/${callId}`).get()).data()!;
    expect(call).toMatchObject({
      callerId: 'call-rider',
      calleeId: 'call-driver',
      driverId: 'call-driver',
      callerName: 'Sara',
      status: 'ringing',
      offer: null,
      answer: null,
    });
    expect(call.iceServers.length).toBeGreaterThan(0);
  });

  it('rings Android with a silent data push the app turns into a ringer, and iPhones with a notification', async () => {
    await seedTrip('t9', { status: 'arrived' });
    await db().doc('users/call-rider').set({ displayName: 'Sara' });
    await db().doc('users/call-driver/fcmTokens/a').set({ token: 'ExponentPushToken[android]', platform: 'android' });
    await db().doc('users/call-driver/fcmTokens/i').set({ token: 'ExponentPushToken[iphone]', platform: 'ios' });
    const sent: { to: string; title?: string; data: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(...JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }));

    const { callId } = await startCall.run(makeReq({ rideKind: 'trip', rideId: 't9' }, 'call-rider'));
    vi.unstubAllGlobals();

    const android = sent.find((m) => m.to === 'ExponentPushToken[android]')!;
    const iphone = sent.find((m) => m.to === 'ExponentPushToken[iphone]')!;
    expect(android.title).toBeUndefined();
    expect(android.data).toMatchObject({ screen: 'call', callId, callTitle: '📞 Sara is calling' });
    expect(iphone.title).toBe('📞 Sara is calling');
    expect(iphone.data).toMatchObject({ screen: 'call', callId });
  });

  it('refuses a stranger and a finished ride', async () => {
    await seedTrip('t2', { status: 'in_progress' });
    await seedTrip('t3', { status: 'completed' });

    await expect(
      startCall.run(makeReq({ rideKind: 'trip', rideId: 't2' }, 'call-stranger')),
    ).rejects.toThrow(/current ride/);
    await expect(
      startCall.run(makeReq({ rideKind: 'trip', rideId: 't3' }, 'call-rider')),
    ).rejects.toThrow(/current ride/);
  });

  it('lets the driver of a shared trip call the one rider they name', async () => {
    await seedTrip('t4', { status: 'matched', pool: true, poolMembers: ['call-rider', 'call-joiner'] });

    await expect(
      startCall.run(makeReq({ rideKind: 'trip', rideId: 't4' }, 'call-driver')),
    ).rejects.toThrow(/current ride/);
    const { callId } = await startCall.run(
      makeReq({ rideKind: 'trip', rideId: 't4', calleeId: 'call-joiner' }, 'call-driver'),
    );
    expect((await db().doc(`calls/${callId}`).get()).get('calleeId')).toBe('call-joiner');
  });

  it('reaches seated riders of a driver-hosted shared ride, not dropped-off ones', async () => {
    await db().doc('poolRides/p1').set({ driverId: 'call-driver', status: 'boarding' });
    await db().doc('poolRides/p1/passengers/call-rider').set({ status: 'driver_arrived' });
    await db().doc('poolRides/p1/passengers/call-gone').set({ status: 'dropped_off' });

    const { callId } = await startCall.run(
      makeReq({ rideKind: 'poolRide', rideId: 'p1', calleeId: 'call-rider' }, 'call-driver'),
    );
    expect((await db().doc(`calls/${callId}`).get()).get('calleeId')).toBe('call-rider');
    await expect(
      startCall.run(makeReq({ rideKind: 'poolRide', rideId: 'p1', calleeId: 'call-gone' }, 'call-driver')),
    ).rejects.toThrow(/current ride/);
    await expect(
      startCall.run(makeReq({ rideKind: 'poolRide', rideId: 'p1' }, 'call-gone')),
    ).rejects.toThrow(/current ride/);
  });
});

describe('one call per person at a time', () => {
  beforeEach(clearFirestore);

  const pool = () =>
    db().doc('trips/tp').set({
      passengerId: 'call-r1',
      driverId: 'call-driver',
      status: 'arriving',
      pool: true,
      poolMembers: ['call-r1', 'call-r2', 'call-r3'],
    });
  const ring = (uid: string, calleeId?: string) =>
    startCall.run(makeReq({ rideKind: 'trip', rideId: 'tp', ...(calleeId ? { calleeId } : {}) }, uid));

  it('rings the driver for ONE of three riders calling in the same second', async () => {
    await pool();
    const results = await Promise.allSettled([ring('call-r1'), ring('call-r2'), ring('call-r3')]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect(String((r as PromiseRejectedResult).reason)).toMatch(/Your driver is on another call/);
    }
    const ringing = await db().collection('calls').where('status', '==', 'ringing').get();
    expect(ringing.size).toBe(1);
  });

  it('frees the line the moment the call ends', async () => {
    await pool();
    const { callId } = await ring('call-r1');
    await expect(ring('call-r2')).rejects.toThrow(/on another call/);

    await db().doc(`calls/${callId}`).update({ status: 'ended' });
    await expect(ring('call-r2')).resolves.toHaveProperty('callId');
  });

  it('tells the driver they are already on a call instead of ringing a second rider', async () => {
    await pool();
    await ring('call-r1');
    await expect(ring('call-driver', 'call-r2')).rejects.toThrow(/already on a call/);
  });

  it('does not let a dead call hold the line for ever', async () => {
    await pool();
    await db().doc('calls/old').set({
      callerId: 'call-r1', calleeId: 'call-driver', status: 'ringing',
      createdAt: new Date(Date.now() - 5 * 60_000),
    });
    await db().doc('callLines/call-driver').set({ callId: 'old' });
    await expect(ring('call-r2')).resolves.toHaveProperty('callId');
  });

  it('replaces a rider’s own ringing call when they redial', async () => {
    await pool();
    const first = await ring('call-r1');
    const second = await ring('call-r1');
    expect(second.callId).not.toBe(first.callId);
    expect((await db().doc(`calls/${first.callId}`).get()).get('status')).toBe('ended');
  });
});
