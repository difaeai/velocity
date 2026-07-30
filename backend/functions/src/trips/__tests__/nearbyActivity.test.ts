/**
 * Integration tests for getNearbyActivity — the passenger home map's activity layer.
 *
 * The invariants worth defending here are all about what must NOT leak or lie:
 *  - no uid, name, plate, fare or address ever appears in the response
 *  - coordinates are blurred, but stably: the same input returns the same pin
 *  - offline, unapproved, stale and out-of-radius drivers are all excluded
 *  - the caller never sees their own car or their own open request as activity
 *  - an empty area returns zero counts (the "pitch Earn with Velocity" signal),
 *    which is a real answer and must not be confused with an error
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';

import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { encodeGeohash } from '../../lib/geohash';
import { getNearbyActivity } from '../nearbyActivity';

const ME = 'rider-uid';

// Islamabad F-7, and points at known distances from it.
const HERE = { lat: 33.7100, lng: 73.0550 };
/** ~1.1 km north. */
const NEAR = { lat: 33.7200, lng: 73.0550 };
/** ~22 km north — outside every radius this function accepts. */
const FAR = { lat: 33.9100, lng: 73.0550 };

interface Pin { id: string; lat: number; lng: number; distanceKm: number }
interface Result {
  ok: boolean;
  radiusKm: number;
  driverCount: number;
  passengerCount: number;
  waitingCount: number;
  drivers: Pin[];
  passengers: Pin[];
}

/** `.run()` invokes the handler directly; calling the export runs the HTTP wrapper. */
function run(req: unknown): Promise<Result> {
  return (getNearbyActivity as unknown as { run: (r: unknown) => Promise<Result> }).run(req);
}

function call(uid = ME, radiusKm?: number): Promise<Result> {
  return run(makeReq({ lat: HERE.lat, lng: HERE.lng, ...(radiusKm ? { radiusKm } : {}) }, uid));
}

async function seedDriver(
  uid: string,
  loc: { lat: number; lng: number } | null,
  overrides: Record<string, unknown> = {},
) {
  await db().doc(`drivers/${uid}`).set({
    online: true,
    verificationStatus: 'approved',
    fullName: 'Very Identifiable Person',
    plate: 'ABC-123',
    vehicleLabel: 'Toyota Corolla',
    ...(loc ? { lastLocation: loc } : {}),
    lastSeenAt: admin.firestore.Timestamp.now(),
    ...overrides,
  });
}

async function seedOpenTrip(id: string, passengerId: string, pickup: { lat: number; lng: number }) {
  await db().doc(`trips/${id}`).set({
    passengerId,
    status: 'requested',
    pickup: { ...pickup, address: 'Street address nobody should see' },
    dropoff: { lat: 33.65, lng: 73.10, address: 'G-9' },
    fare: 450,
  });
}

/**
 * The presence doc a handset writes for itself. `geohash` must be the precision-5
 * cell, exactly as apps/mobile/src/lib/geohash.ts produces it — the lookup is an
 * equality match on it, so a wrong cell means invisible rather than misplaced.
 */
async function seedPresence(
  uid: string,
  loc: { lat: number; lng: number },
  ageMs = 0,
) {
  await db().doc(`userPresence/${uid}`).set({
    uid,
    lat: loc.lat,
    lng: loc.lng,
    geohash: encodeGeohash(loc.lat, loc.lng, 5),
    lastSeenAt: admin.firestore.Timestamp.fromMillis(Date.now() - ageMs),
  });
}

async function seedPoolRequest(id: string, leaderId: string, pickup: { lat: number; lng: number }) {
  await db().doc(`poolRideRequests/${id}`).set({
    leaderId,
    status: 'open',
    pickupLat: pickup.lat,
    pickupLng: pickup.lng,
    pickupAreaName: 'F-7',
    proposedFarePerSeat: 200,
  });
}

// The rate limiter shares one counter doc per uid per window, and clearFirestore
// wipes it between tests, so each test starts with a fresh allowance.
beforeEach(async () => {
  await clearFirestore();
});

describe('getNearbyActivity — supply', () => {
  it('returns a nearby online approved driver as one blurred pin', async () => {
    await seedDriver('d1', NEAR);
    const res = await call();

    expect(res.ok).toBe(true);
    expect(res.driverCount).toBe(1);
    expect(res.drivers).toHaveLength(1);

    const pin = res.drivers[0]!;
    // Blurred: close to the truth, but not the truth.
    expect(pin.lat).not.toBe(NEAR.lat);
    expect(pin.lng).not.toBe(NEAR.lng);
    expect(Math.abs(pin.lat - NEAR.lat)).toBeLessThan(0.004); // well under ~400 m
    expect(Math.abs(pin.lng - NEAR.lng)).toBeLessThan(0.004);
  });

  it('never returns a uid or any identifying driver field', async () => {
    await seedDriver('d1', NEAR);
    const res = await call();

    const serialised = JSON.stringify(res);
    expect(serialised).not.toContain('d1');
    expect(serialised).not.toContain('Very Identifiable Person');
    expect(serialised).not.toContain('ABC-123');
    expect(serialised).not.toContain('Corolla');
    expect(Object.keys(res.drivers[0]!).sort()).toEqual(['distanceKm', 'id', 'lat', 'lng']);
  });

  it('blurs the same driver to the same point on every call', async () => {
    await seedDriver('d1', NEAR);
    const a = await call();
    const b = await call();
    expect(b.drivers[0]).toEqual(a.drivers[0]);
  });

  it('excludes offline, unapproved, location-less, stale and distant drivers', async () => {
    await seedDriver('offline', NEAR, { online: false });
    await seedDriver('pending', NEAR, { verificationStatus: 'pending' });
    await seedDriver('nogps', null);
    await seedDriver('stale', NEAR, {
      lastSeenAt: admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000),
    });
    await seedDriver('faraway', FAR);

    const res = await call();
    expect(res.driverCount).toBe(0);
    expect(res.drivers).toEqual([]);
  });

  it('does not show the caller their own car', async () => {
    await seedDriver(ME, NEAR);
    const res = await call(ME);
    expect(res.driverCount).toBe(0);
  });
});

describe('getNearbyActivity — the red dots are everyone with the app', () => {
  it('shows a nearby app user who has no ride request at all', async () => {
    await seedPresence('just-has-the-app', NEAR);

    const res = await call();
    expect(res.passengerCount).toBe(1);
    expect(res.passengers).toHaveLength(1);
    // Present, but not waiting for anything.
    expect(res.waitingCount).toBe(0);
  });

  it('counts open trips and open pool requests as waiting, on top of presence', async () => {
    await seedPresence('lurker', NEAR);
    await seedOpenTrip('t1', 'other-rider', NEAR);
    await seedPoolRequest('p1', 'another-rider', NEAR);

    const res = await call();
    expect(res.passengerCount).toBe(3);
    expect(res.waitingCount).toBe(2);
  });

  it('is one dot per person, not one per document', async () => {
    // Same human: app open, a ride request out, and a pool request out.
    await seedPresence('busy-person', NEAR);
    await seedOpenTrip('t1', 'busy-person', NEAR);
    await seedPoolRequest('p1', 'busy-person', NEAR);

    const res = await call();
    expect(res.passengerCount).toBe(1);
    expect(res.passengers).toHaveLength(1);
    expect(res.waitingCount).toBe(1);
  });

  it('drops presence that has gone stale', async () => {
    await seedPresence('yesterday', NEAR, 24 * 60 * 60 * 1000);
    const res = await call();
    expect(res.passengerCount).toBe(0);
  });

  it('does not draw an online driver as a dot as well as a car', async () => {
    await seedDriver('d1', NEAR);
    await seedPresence('d1', NEAR);

    const res = await call();
    expect(res.driverCount).toBe(1);
    expect(res.passengerCount).toBe(0);
  });

  it('never returns a uid, address or fare for anyone', async () => {
    await seedPresence('lurker', NEAR);
    await seedOpenTrip('t1', 'other-rider', NEAR);
    const res = await call();

    const serialised = JSON.stringify(res);
    expect(serialised).not.toContain('lurker');
    expect(serialised).not.toContain('other-rider');
    expect(serialised).not.toContain('Street address nobody should see');
    expect(serialised).not.toContain('450');
    expect(Object.keys(res.passengers[0]!).sort()).toEqual(['distanceKm', 'id', 'lat', 'lng']);
  });

  it('blurs dots away from the real position', async () => {
    await seedPresence('lurker', NEAR);
    const pin = (await call()).passengers[0]!;
    expect(pin.lat).not.toBe(NEAR.lat);
    expect(pin.lng).not.toBe(NEAR.lng);
    expect(Math.abs(pin.lat - NEAR.lat)).toBeLessThan(0.005);
  });

  it('keeps a person\'s dot in the same place as their trip documents come and go', async () => {
    await seedPresence('someone', NEAR);
    const before = (await call()).passengers[0]!;
    await seedOpenTrip('t1', 'someone', NEAR);
    const after = (await call()).passengers[0]!;
    // Seeded by uid, so the blur — and the React key — survive the new document.
    expect(after.id).toBe(before.id);
    expect(after.lat).toBe(before.lat);
    expect(after.lng).toBe(before.lng);
  });

  it('ignores matched trips, distant people and the caller themselves', async () => {
    await db().doc('trips/matched').set({
      passengerId: 'someone',
      status: 'matched',
      pickup: NEAR,
    });
    await seedOpenTrip('t-far', 'someone-else', FAR);
    await seedPresence('far-lurker', FAR);
    await seedOpenTrip('t-mine', ME, NEAR);
    await seedPoolRequest('p-mine', ME, NEAR);
    await seedPresence(ME, NEAR);

    const res = await call(ME);
    expect(res.passengerCount).toBe(0);
    expect(res.passengers).toEqual([]);
  });
});

describe('getNearbyActivity — the empty case that drives the Earn pitch', () => {
  it('reports zeroes rather than failing when nothing is around', async () => {
    const res = await call();
    expect(res.ok).toBe(true);
    expect(res.driverCount).toBe(0);
    expect(res.passengerCount).toBe(0);
    expect(res.waitingCount).toBe(0);
    expect(res.drivers).toEqual([]);
    expect(res.passengers).toEqual([]);
  });

  it('stops being empty as soon as one person nearby has the app', async () => {
    await seedPresence('somebody', NEAR);
    expect((await call()).passengerCount).toBe(1);
  });
});

describe('getNearbyActivity — validation', () => {
  it('rejects a missing location', async () => {
    await expect(run(makeReq({}, ME))).rejects.toThrow();
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(run({ data: HERE, auth: undefined })).rejects.toThrow();
  });

  it('honours a tighter radius', async () => {
    await seedDriver('d1', NEAR); // ~1.1 km away
    expect((await call(ME, 6)).driverCount).toBe(1);
    await clearFirestore();
    await seedDriver('d1', NEAR);
    expect((await call(ME, 1)).driverCount).toBe(0);
  });
});
