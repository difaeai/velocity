/**
 * The GPS-manipulation arm of the partner fraud check.
 *
 * WHY THIS SUITE EXISTS AT ALL
 * ----------------------------
 * This arm had no test, and that is not a coincidence — it had never run. It
 * divides a distance by the gap between `trips.startedAt` and `completedAt`,
 * and until the ride-record work (2026-10-16) nothing in the codebase ever
 * wrote `startedAt`. So it arrived null on every ride and the branch was always
 * skipped, while `completeTrip` passed the field the whole time: code that read
 * like a working fraud check and was dead on arrival.
 *
 * Switching it on is where the real design problem showed up. The driver taps
 * Start, so the gap it measured was the driver's to choose — which breaks it in
 * BOTH directions:
 *
 *   • an honest driver who forgets to tap until they arrive records a real
 *     journey as a few seconds, and gets their partner's credit zeroed
 *   • a fabricated ride hides the same way, by tapping Start at the very end
 *
 * A minimum assessable duration fixes the first and opens a hole in the second
 * (claim 100 km, complete 90 seconds after tapping, never get assessed). A
 * clamp fixes the second and breaks the first (a late tap on a Lahore run reads
 * as 380 km in a minute, and intercity is a real product here). So the window
 * comes from `requestedAt` — `trips.createdAt`, server-written before any
 * driver was involved — and the LONGER of the two windows wins.
 *
 * Both failure directions are pinned below. The 90-second case is the one worth
 * keeping: it is the hole a duration floor would have left.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore } from '../../travelMate/__tests__/helpers';
import { assessRide } from '../fraud';

const DRIVER = 'fraud-gps-driver';
const PASSENGER = 'fraud-gps-passenger';
const PARTNER = 'fraud-gps-partner';

/** Islamabad to Lahore — about 270 km apart. */
const ISLAMABAD = { lat: 33.6844, lng: 73.0479 };
const LAHORE = { lat: 31.5204, lng: 74.3587 };
/** Two points inside Islamabad, about 4 km apart. An ordinary short hop. */
const F7 = { lat: 33.6844, lng: 73.0479 };
const G9 = { lat: 33.7215, lng: 73.0433 };

const MIN = 60_000;

/** The shape `completeTrip` builds, with only the clock varied per test. */
function ride(args: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  /** Minutes before completion that the driver tapped Start. Null = never. */
  startedMinAgo: number | null;
  /** Minutes before completion that the RIDER requested the ride. */
  requestedMinAgo: number | null;
}) {
  const completedAt = new Date();
  return {
    tripId: 'fraud-gps-trip',
    driverId: DRIVER,
    passengerId: PASSENGER,
    // A partner stands to be paid, which is what makes a ride worth checking.
    driverPartnerId: PARTNER,
    passengerPartnerId: null,
    pickup: args.pickup,
    dropoff: args.dropoff,
    startedAt:
      args.startedMinAgo === null
        ? null
        : new Date(completedAt.getTime() - args.startedMinAgo * MIN),
    requestedAt:
      args.requestedMinAgo === null
        ? null
        : new Date(completedAt.getTime() - args.requestedMinAgo * MIN),
    completedAt,
  };
}

beforeEach(async () => {
  await clearFirestore();
});

describe('the GPS-manipulation arm', () => {
  it('flags a ride that could not physically have happened', async () => {
    // 270 km between request and completion twelve minutes later.
    const verdict = await assessRide(
      ride({
        pickup: ISLAMABAD,
        dropoff: LAHORE,
        startedMinAgo: 10,
        requestedMinAgo: 12,
      }),
    );
    expect(verdict.status).toBe('scam');
    expect(verdict.kind).toBe('gps_manipulation');
  });

  it('catches the ride a duration floor would have waved through', async () => {
    // THE HOLE THIS DESIGN EXISTS TO CLOSE. Tap Start ninety seconds before
    // completing and any "too short to assess" rule skips the ride entirely,
    // so the fraud gets easier the moment you add one. Here the request clock
    // is ninety seconds too — the driver never had time to go anywhere — and
    // the ride is caught on that instead.
    const verdict = await assessRide(
      ride({
        pickup: ISLAMABAD,
        dropoff: LAHORE,
        startedMinAgo: 1.5,
        requestedMinAgo: 1.5,
      }),
    );
    expect(verdict.status).toBe('scam');
    expect(verdict.kind).toBe('gps_manipulation');
  });

  it('does NOT flag a driver who tapped Start late on a short hop', async () => {
    // 4 km recorded as three seconds of driving is 4,800 km/h on paper, and is
    // a driver who completed the ride moments after remembering to start it.
    // The request clock says twenty minutes, which is what actually happened.
    const verdict = await assessRide(
      ride({ pickup: F7, dropoff: G9, startedMinAgo: 0.05, requestedMinAgo: 20 }),
    );
    expect(verdict.status).toBe('completed');
    expect(verdict.kind).toBeNull();
  });

  it('does NOT flag a late tap on a long intercity run', async () => {
    // The case that rules a clamp out: 270 km is entirely possible in the five
    // hours since the rider asked, however late the driver tapped Start.
    const verdict = await assessRide(
      ride({
        pickup: ISLAMABAD,
        dropoff: LAHORE,
        startedMinAgo: 1,
        requestedMinAgo: 5 * 60,
      }),
    );
    expect(verdict.status).toBe('completed');
  });

  it('does not flag an ordinary ride across the city', async () => {
    const verdict = await assessRide(
      ride({ pickup: F7, dropoff: G9, startedMinAgo: 18, requestedMinAgo: 25 }),
    );
    expect(verdict.status).toBe('completed');
  });

  it('is skipped entirely when the trip carries no clock at all', async () => {
    // Every ride taken before `startedAt` was stamped. History must not be
    // retrospectively accused of fraud over a field that did not exist.
    const verdict = await assessRide(
      ride({
        pickup: ISLAMABAD,
        dropoff: LAHORE,
        startedMinAgo: null,
        requestedMinAgo: null,
      }),
    );
    expect(verdict.status).toBe('completed');
  });

  it('still assesses a legacy ride on its request clock alone', async () => {
    // A ride from before the Start stamp existed is not unassessable — the
    // request clock was always there.
    const verdict = await assessRide(
      ride({
        pickup: ISLAMABAD,
        dropoff: LAHORE,
        startedMinAgo: null,
        requestedMinAgo: 3,
      }),
    );
    expect(verdict.kind).toBe('gps_manipulation');
  });

  it('does not flag an impossible ride when no partner would be paid for it', async () => {
    // The check protects the referral payout, not rides in general — there is
    // nothing to withhold from nobody.
    const verdict = await assessRide({
      ...ride({
        pickup: ISLAMABAD,
        dropoff: LAHORE,
        startedMinAgo: 10,
        requestedMinAgo: 12,
      }),
      driverPartnerId: null,
      passengerPartnerId: null,
    });
    expect(verdict.status).toBe('completed');
  });
});
