/**
 * The pooling engine end to end, on the REAL Corporate / Students coordinates.
 * ----------------------------------------------------------------------------
 * The owner's mandatory test (2026-11-14): two riders travelling from the same
 * place to two DIFFERENT destinations must end up in one car, with one driver,
 * one consolidated trip, an optimal drop order, a fare below each rider's solo
 * fare, and no second ride for that driver until the pool is done.
 *
 * Every step goes through the callables the apps call, against the emulator.
 * The coordinates are the ones the route cards carry (apps/mobile/src/domain/
 * sharingRoutes.ts), not invented test points.
 *
 * WHAT THIS TEST FOUND, and why it reads the way it does:
 *
 *   The spec's own example is refused as shipped. G-10 lies 1,276 m off the
 *   PWD → F-10 line, and the engine seats a rider only within 1 km of the
 *   route. It is refused by 276 metres — not by economics: once seated the
 *   detour is 0.47 km and 1.6 minutes, and both riders save 45%. So the test
 *   asserts the refusal first, with its reason, and then raises the radius in
 *   `config/poolingSettings` — no deploy — and runs the whole journey.
 *
 *   That is the case for the radius being a setting rather than a constant,
 *   and it is the number the dashboard's Ride Pooling page exists to move.
 * ----------------------------------------------------------------------------
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { clearFirestore, confirmedCar, db, makeReq } from '../../travelMate/__tests__/helpers';
import { DEFAULT_ISLAMABAD_RAWALPINDI } from '../../fare/fareEngine';
import { completeTrip, placeBid, updateTripStatus } from '../../trips';
import { boardPoolRider, dropOffRider } from '../../trips/dropOff';
import { getPoolRiders } from '../../trips/enRoute';
import { DEFAULT_POOLING } from '../../domain/poolingSettings';
import {
  clearNearbyCarsCache,
  createSharedPool,
  getDriverPools,
  getSharedPools,
  joinSharedPool,
  startSharedRide,
  type DriverPoolView,
  type PoolCard,
} from '../index';

// The real card coordinates — PWD is where people live, the rest are where
// they go. `route:PWD>F-10` and `route:PWD>G-10` are NOT among the 3,430
// generated cards (the generator only builds routes to daily destinations:
// universities, offices, hospitals, markets). A rider reaches them the way the
// Corporate / Students screen does when no card matches their search: their own
// pickup and drop-off, through createSharedPool.
const PWD = { lat: 33.5713, lng: 73.1448, address: 'PWD Housing Society, Islamabad' };
const F10 = { lat: 33.6959, lng: 73.0125, address: 'F-10 Markaz, Islamabad' };
const G10 = { lat: 33.6767, lng: 73.0145, address: 'G-10 Markaz, Islamabad' };
const I9 = { lat: 33.6562, lng: 73.0631, address: 'I-9 Industrial Area, Islamabad' };
// A third destination, for the "nobody joins a pool that has started" check.
const BLUE = { lat: 33.7089, lng: 73.0574, address: 'Blue Area, Islamabad' };

const RIDERS = { asad: 'male', bilal: 'male', chaudhry: 'male' } as const;
const D1 = 'drv-one';
const D2 = 'drv-two';

function driverReq<T>(data: T, uid: string): CallableRequest<T> {
  return {
    data,
    auth: { uid, token: { uid, role: 'driver' } as unknown as admin.auth.DecodedIdToken },
    acceptsStreaming: false,
    rawRequest: {} as never,
  } as unknown as CallableRequest<T>;
}

const trip = async (id: string) => (await db().doc(`trips/${id}`).get()).data()!;

const search = async (uid: string, from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
  (await getSharedPools.run(makeReq({ city: 'islamabad', from, to }, uid))) as { pools: PoolCard[] };

/** Move one pooling parameter, as the dashboard's Ride Pooling page does. */
const setPooling = (patch: Record<string, unknown>) =>
  db().doc('config/poolingSettings').set({ ...DEFAULT_POOLING, ...patch });

/** Every verdict the engine recorded. Only joins are judged, never first seats. */
async function decisions() {
  const snap = await db().collection('poolDecisions').get();
  return snap.docs.map((d) => d.data());
}

/** "HH:MM" in Pakistan time, `ms` from now — a pool whose car has not gone yet. */
const pktClock = (ms: number) => new Date(Date.now() + ms + 5 * 3600_000).toISOString().slice(11, 16);

beforeEach(async () => {
  await clearFirestore();
  clearNearbyCarsCache();
  await db().doc('fareConfig/islamabad_rawalpindi').set(DEFAULT_ISLAMABAD_RAWALPINDI);
  for (const [uid, gender] of Object.entries(RIDERS)) {
    await db().doc(`users/${uid}`).set({ name: `${uid[0]!.toUpperCase()}${uid.slice(1)} Khan`, gender, mixedRideOk: true });
  }
  for (const [uid, name, plate] of [[D1, 'Imran', 'LEB-1001'], [D2, 'Sana', 'ISB-2002']] as const) {
    await db().doc(`users/${uid}`).set({ displayName: name, name, gender: 'male' });
    await db().doc(`drivers/${uid}`).set({
      verificationStatus: 'approved',
      online: true,
      lastLocation: { lat: PWD.lat, lng: PWD.lng },
      vehicleLabel: 'Suzuki Cultus',
      plate,
      rating: 4.9,
      ...confirmedCar(),
    });
  }
});

describe('PWD → F-10 and PWD → G-10: the spec’s own example, end to end', () => {
  it('is refused as shipped, and the reason is geometry rather than economics', async () => {
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', label: 'F-10 Markaz', departTime: null,
      rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'asad'))) as { poolId: string };

    // Bilal is going to G-10. The 5 km candidate radius shows him Asad's car...
    const found = await search('bilal', PWD, G10);
    expect(found.pools.map((p) => p.id)).toContain(made.poolId);

    // ...but seating him is a different question, and the answer is no: G-10 is
    // 1,276 m off the PWD → F-10 line and the engine seats within 1 km.
    await expect(joinSharedPool.run(makeReq({ poolId: made.poolId, pickup: PWD, dropoff: G10 }, 'bilal')))
      .rejects.toThrow(/1 km off this shared ride/);

    // Nothing economic objected: no verdict was ever reached, because the
    // journey never got past the route check.
    expect(await decisions()).toHaveLength(0);
  });

  it('combines both riders into one car once the radius allows it, and runs the whole journey', async () => {
    // The admin widens the seating radius to 1.5 km. No deploy.
    await setPooling({ matchRadiusM: 1500 });

    // ── 1. Both bookings are made through the existing booking flow ──────────
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', label: 'F-10 Markaz', departTime: null,
      rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'asad'))) as { poolId: string; tripId: string | null; perSeatFare: number };
    const asadSolo = made.perSeatFare;

    const forBilal = (await search('bilal', PWD, G10)).pools.find((p) => p.id === made.poolId)!;
    const bilalQuote = forBilal.farePerSeat;
    const joined = (await joinSharedPool.run(makeReq({ poolId: made.poolId, pickup: PWD, dropoff: G10 }, 'bilal'))) as
      { status: string; perSeatFare: number; tripId: string | null };
    expect(joined.perSeatFare).toBe(bilalQuote);

    // ── 2. The engine recorded what it thought of the combination ────────────
    const [verdict] = await decisions();
    expect(verdict).toMatchObject({ mode: 'shadow', ok: true, refused: false, reason: null, riders: 2 });
    expect(verdict!.detourKm as number).toBeLessThan(1);
    expect(verdict!.driverGain as number).toBeGreaterThan(0);
    expect(verdict!.worstSavingPct as number).toBeGreaterThan(0.3);

    // Counters for the dashboard, without reading a single row.
    const totals = (await db().doc('analytics/pooling').get()).data()!;
    expect(totals).toMatchObject({ evaluated: 1, passed: 1, refused: 0, wouldRefuse: 0 });

    // ── 3. One car, one driver, one consolidated trip ────────────────────────
    const tripId = joined.tripId ?? made.tripId!;
    const car = await trip(tripId);
    expect(car.poolMembers.sort()).toEqual(['asad', 'bilal']);

    const fares = car.poolFares as Record<string, number>;
    // Each rider pays less than riding alone, and the driver collects the sum.
    expect(fares.asad).toBeLessThan(asadSolo);
    expect(fares.bilal).toBeLessThan(verdict!.joinerSoloFare as number);
    expect(car.poolDriverGross).toBe(fares.asad! + fares.bilal!);
    // The whole point: the car earns more than Asad alone would have paid.
    expect(car.poolDriverGross).toBeGreaterThan(asadSolo);

    const job = ((await getDriverPools.run(driverReq({ lat: PWD.lat, lng: PWD.lng }, D1))) as { pools: DriverPoolView[] })
      .pools.find((j) => j.liveTripId === tripId || j.id === made.poolId)!;
    expect(job.riders).toBe(2);

    await placeBid.run(driverReq({ tripId, fare: car.poolDriverGross as number }, D1));
    expect((await trip(tripId)).driverId).toBe(D1);

    // ── 4. The driver sees both riders’ stops, in the optimal order ──────────
    const manifest = (await getPoolRiders.run(driverReq({ tripId }, D1))) as {
      riders: { uid: string }[]; stops: { uid: string; kind: string }[];
    };
    expect(manifest.riders).toHaveLength(2);
    expect(manifest.stops).toHaveLength(4);
    expect(manifest.stops.slice(0, 2).every((s) => s.kind === 'pickup')).toBe(true);
    // G-10 is passed before F-10, so Bilal gets out first — whatever the
    // booking order was. Geography decides, not the clock.
    const drops = manifest.stops.filter((s) => s.kind === 'dropoff').map((s) => s.uid);
    expect(drops).toEqual(['bilal', 'asad']);

    // ── 5. Once it has started, the pool is locked ───────────────────────────
    // Start comes before boarding: boarding moves the car to in_progress, and
    // a car can only be started while its driver is still on the way.
    await updateTripStatus.run(driverReq({ tripId, to: 'arrived' }, D1));
    await startSharedRide.run(driverReq({ tripId }, D1));
    for (const r of ['asad', 'bilal']) await boardPoolRider.run(driverReq({ tripId, riderUid: r }, D1));

    // Chaudhry wants the empty seat. The car has started: no.
    await expect(joinSharedPool.run(makeReq({ poolId: made.poolId, pickup: PWD, dropoff: BLUE }, 'chaudhry')))
      .rejects.toThrow();

    // ── 6. And the driver cannot take another ride while it runs ─────────────
    const other = db().collection('trips').doc();
    await other.set({
      passengerId: 'chaudhry', status: 'requested', rideType: 'mini',
      pickup: PWD, dropoff: BLUE, offeredFare: 900, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await expect(placeBid.run(driverReq({ tripId: other.id, fare: 900 }, D1))).rejects.toThrow();

    // ── 7. Both dropped, pool completed, driver free again ───────────────────
    for (const r of ['bilal', 'asad']) {
      const dropped = (await dropOffRider.run(driverReq({ tripId, riderUid: r }, D1))) as { fare: number };
      expect(dropped.fare).toBe(fares[r]);
    }
    await completeTrip.run(driverReq({ tripId }, D1));
    expect((await trip(tripId)).status).toBe('completed');
    expect((await db().doc(`drivers/${D1}`).get()).get('activeTripId')).toBeFalsy();

    // Free: the same bid the active pool refused now goes through.
    await placeBid.run(driverReq({ tripId: other.id, fare: 900 }, D1));
    expect((await trip(other.id)).driverId).toBe(D1);
  });
});

describe('the drop order is geography, not booking time', () => {
  it('drops the rider who booked LAST first, because their stop comes first', async () => {
    await setPooling({ matchRadiusM: 2000 });

    // Asad books PWD → G-10 first.
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', label: 'G-10 Markaz', departTime: null,
      rideType: 'mini', pickup: PWD, dropoff: G10,
    }, 'asad'))) as { poolId: string; tripId: string | null };

    // Bilal books PWD → I-9 afterwards — and I-9 is passed on the way.
    const joined = (await joinSharedPool.run(makeReq({ poolId: made.poolId, pickup: PWD, dropoff: I9 }, 'bilal'))) as
      { tripId: string | null };

    const tripId = joined.tripId ?? made.tripId!;
    await placeBid.run(driverReq({ tripId, fare: (await trip(tripId)).poolDriverGross as number }, D1));
    const manifest = (await getPoolRiders.run(driverReq({ tripId }, D1))) as { stops: { uid: string; kind: string }[] };
    expect(manifest.stops.filter((s) => s.kind === 'dropoff').map((s) => s.uid)).toEqual(['bilal', 'asad']);
  });
});

describe('live mode refuses what shadow mode only records', () => {
  it('seats a join in shadow and refuses the same join in live, for the same reason', async () => {
    // A detour limit this combination cannot satisfy, so the verdict is never
    // in doubt. Both pools have a departure time, so their car has not gone out
    // and the two riders are judged as one car rather than two first seats.
    const limits = { matchRadiusM: 1500, maxDetourKm: 0.1, maxDetourMin: 1 };
    const departTime = pktClock(2 * 3600_000);
    await setPooling({ ...limits, mode: 'shadow' });

    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', departTime, rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'asad'))) as { poolId: string };

    // Shadow: measured, recorded as a failure — and seated anyway.
    const seated = (await joinSharedPool.run(makeReq({ poolId: made.poolId, pickup: PWD, dropoff: G10 }, 'bilal'))) as
      { status: string };
    expect(seated.status).toBe('booked');
    const shadow = (await decisions())[0]!;
    expect(shadow).toMatchObject({ mode: 'shadow', ok: false, refused: false, riders: 2 });
    expect(shadow.reason as string).toMatch(/detour .* over the/);

    // The same combination in live mode is turned down, and says why.
    await setPooling({ ...limits, mode: 'live' });
    const second = (await createSharedPool.run(makeReq({
      city: 'islamabad', departTime, rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'chaudhry'))) as { poolId: string };
    await expect(joinSharedPool.run(makeReq({ poolId: second.poolId, pickup: PWD, dropoff: G10 }, 'bilal')))
      .rejects.toThrow(/not a good match/);

    // Two verdicts, both failing; one of them actually turned a rider away.
    const totals = (await db().doc('analytics/pooling').get()).data()!;
    expect(totals).toMatchObject({ evaluated: 2, passed: 0, refused: 1, wouldRefuse: 2 });
  });
});

describe('the timing and seat settings each take effect on their own', () => {
  it('closes JOINS before a timed departure once a cutoff is set, but never the pool’s own first seat', async () => {
    // A pool leaving in an hour, asked for ten minutes before — so its car has
    // NOT gone out yet and the bookings are still gathering. The cutoff is 90
    // minutes, which this hour-away departure is inside.
    //
    // Its creator is choosing that time, so a cutoff must never refuse them: it
    // is only a late JOINER who is late.
    const departTime = pktClock(60 * 60_000);
    await setPooling({ bookingCutoffMin: 90, matchWindowMin: 10 });
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', departTime, rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'asad'))) as { poolId: string; status: string };
    expect(made.status).toBe('booked');

    // Bilal is inside the window: this car is about to be asked for.
    await expect(joinSharedPool.run(makeReq({ poolId: made.poolId }, 'bilal')))
      .rejects.toThrow(/closed 90 minutes before it leaves/);

    // The default — 0, no cutoff — is how the engine shipped: the seat is taken.
    await setPooling({ bookingCutoffMin: 0 });
    expect((await joinSharedPool.run(makeReq({ poolId: made.poolId }, 'bilal'))) as { status: string })
      .toMatchObject({ status: 'booked' });
  });

  it('books only as many seats as maxRiders allows', async () => {
    await setPooling({ maxRiders: 2 });
    const departTime = pktClock(2 * 3600_000);
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', departTime, rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'asad'))) as { poolId: string };
    // Asad holds seat one; Bilal takes the second; Chaudhry finds it full.
    await joinSharedPool.run(makeReq({ poolId: made.poolId }, 'bilal'));
    await expect(joinSharedPool.run(makeReq({ poolId: made.poolId }, 'chaudhry')))
      .rejects.toThrow(/full/);
  });

  it('asks for the car matchWindowMin before departure, and tells the rider that time', async () => {
    const departTime = pktClock(3 * 3600_000);
    await setPooling({ matchWindowMin: 25 });
    const made = (await createSharedPool.run(makeReq({
      city: 'islamabad', departTime, rideType: 'mini', pickup: PWD, dropoff: F10,
    }, 'asad'))) as { poolId: string; departsAtMs: number | null };

    // dispatchAt is the departure less the window; the lead is stored on the
    // pool so a later settings change cannot move a departure already promised.
    const pool = (await db().doc(`sharedPools/${made.poolId}`).get()).data()!;
    expect(pool.dispatchLeadMs).toBe(25 * 60_000);
    const dispatchMs = (pool.dispatchAt as { toMillis(): number }).toMillis();
    expect(made.departsAtMs! - dispatchMs).toBe(25 * 60_000);

    // Moving the window now leaves this pool's promised departure untouched.
    await setPooling({ matchWindowMin: 5 });
    const after = (await getSharedPools.run(makeReq({ city: 'islamabad', mine: true }, 'asad'))) as { pools: PoolCard[] };
    expect(after.pools.find((p) => p.id === made.poolId)!.departsAtMs).toBe(made.departsAtMs);
  });
});
