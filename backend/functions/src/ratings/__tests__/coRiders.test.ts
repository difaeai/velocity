/**
 * Riders rating the people they shared the car with.
 *
 * The relationship this adds is the one Velocity never had: before it, the only
 * reputation in a shared car belonged to the driver, so a rider weighing up
 * whether to get in with two strangers could see four-and-a-half stars for the
 * one person being paid to be there and nothing at all about the strangers.
 *
 * Verified here:
 *  - a co-rider on a completed shared ride can rate the other riders, and the
 *    average lands in `coRiderRating` — NOT in `rating`, which is what drivers
 *    think of a passenger and must not be diluted by this
 *  - the same rating cannot be submitted twice
 *  - nobody can rate themselves, somebody who was not in the car, or anybody at
 *    all from outside the car
 *  - a ride still in progress cannot be rated, and the window shuts after a week
 *  - the average is withheld until RATINGS_BEFORE_SHOWN people have rated, so
 *    one sour rating cannot brand a rider — and the count is published anyway
 *  - a solo ride offers nobody to rate rather than failing
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clearFirestore, db, makeReq } from '../../travelMate/__tests__/helpers';
import { createTrip } from '../../trips/index';
import { joinPoolTrip } from '../../trips/poolShare';
import { getCoRiderRatingTargets, submitCoRiderRating, RATINGS_BEFORE_SHOWN } from '../coRiders';

const HOST = 'corider-host';
const RIDER = 'corider-rider';
const THIRD = 'corider-third';
const DRIVER = 'corider-driver';
const OUTSIDER = 'corider-outsider';

const PICKUP = { lat: 33.6844, lng: 73.0479, address: 'F-7 Markaz, Islamabad' };
const DROPOFF = { lat: 33.7215, lng: 73.0433, address: 'G-9 Markaz, Islamabad' };

const BASE_TRIP = {
  rideType: 'mini' as const,
  offeredFare: 400,
  seats: 1,
  passengerGender: 'male' as const,
  pool: true,
  paymentMethod: 'cash' as const,
  pickup: PICKUP,
  dropoff: DROPOFF,
};

/** What acceptBid leaves behind — the point at which a pool has a driver. */
async function confirmWithDriver(tripId: string) {
  await db().doc(`openRequests/${tripId}`).delete();
  await db().doc(`trips/${tripId}`).set(
    {
      status: 'matched',
      fare: 400,
      driverId: DRIVER,
      driverInfo: {
        driverId: DRIVER,
        displayName: 'Bilal Khan',
        vehicleLabel: 'Corolla',
        plate: 'ABC-123',
        rating: 4.8,
      },
    },
    { merge: true },
  );
}

/**
 * A finished shared ride with `riders` people in it, host first.
 *
 * Riders join while the pool is still gathering, which is the order it happens
 * in — joining a pool a driver has already taken is a request for that driver
 * to answer, not a seat.
 */
async function completedPool(riders: string[] = [RIDER]) {
  const res = await createTrip.run(makeReq(BASE_TRIP, HOST));
  const { tripId, shareCode } = res as { tripId: string; shareCode: string };
  for (const uid of riders) {
    await joinPoolTrip.run(makeReq({ code: shareCode }, uid));
  }
  await confirmWithDriver(tripId);
  await db()
    .doc(`trips/${tripId}`)
    .set({ status: 'completed', completedAt: new Date() }, { merge: true });
  return tripId;
}

beforeEach(async () => {
  await clearFirestore();
  // createTrip reads the gender off the PROFILE, not the booking request, so
  // these seeds are what make the pool joinable at all.
  await db()
    .doc(`users/${HOST}`)
    .set({ name: 'Usman Tariq', gender: 'male', phoneNumber: '+923001111111' });
  // Both joiners opted into mixed rides — the host is a man, and that consent
  // is what every door into a shared car now asks for.
  await db()
    .doc(`users/${RIDER}`)
    .set({ name: 'Ayesha Malik', gender: 'female', mixedRideOk: true });
  await db()
    .doc(`users/${THIRD}`)
    .set({ name: 'Hamza Sheikh', gender: 'male', mixedRideOk: true });
  await db().doc(`users/${OUTSIDER}`).set({ name: 'Nobody' });
});

describe('getCoRiderRatingTargets', () => {
  it('offers each rider the others, and nobody themselves', async () => {
    const tripId = await completedPool([RIDER, THIRD]);

    const forHost = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    expect(forHost.targets.map((t) => t.uid).sort()).toEqual([RIDER, THIRD].sort());
    expect(forHost.targets.map((t) => t.firstName).sort()).toEqual(['Ayesha', 'Hamza']);

    const forRider = await getCoRiderRatingTargets.run(makeReq({ tripId }, RIDER));
    expect(forRider.targets.map((t) => t.uid).sort()).toEqual([HOST, THIRD].sort());
  });

  it('carries first names only — the sheet is not a directory', async () => {
    const tripId = await completedPool([RIDER]);
    const res = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    expect(res.targets[0]!.firstName).toBe('Ayesha');
    expect(JSON.stringify(res.targets)).not.toContain('Malik');
  });

  it('offers nobody on a solo ride instead of failing', async () => {
    const res = await createTrip.run(
      makeReq({ ...BASE_TRIP, pool: false }, HOST),
    );
    const { tripId } = res as { tripId: string };
    await db()
      .doc(`trips/${tripId}`)
      .set({ status: 'completed', completedAt: new Date() }, { merge: true });

    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    expect(out.targets).toEqual([]);
  });

  it('offers nobody while the ride is still running', async () => {
    const tripId = await completedPool([RIDER]);
    await db().doc(`trips/${tripId}`).set({ status: 'in_progress' }, { merge: true });

    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    expect(out.targets).toEqual([]);
  });

  it('offers nobody to somebody who was not in the car', async () => {
    const tripId = await completedPool([RIDER]);
    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, OUTSIDER));
    expect(out.targets).toEqual([]);
  });

  it('marks a rider as already rated once they have been', async () => {
    const tripId = await completedPool([RIDER]);
    await submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 5 }, HOST));

    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    expect(out.targets[0]!.alreadyRated).toBe(true);

    // And only for the person who did the rating — the other rider's own sheet
    // is untouched by somebody else's submission.
    const theirs = await getCoRiderRatingTargets.run(makeReq({ tripId }, RIDER));
    expect(theirs.targets.find((t) => t.uid === HOST)!.alreadyRated).toBe(false);
  });

  it('closes the window a week after the ride', async () => {
    const tripId = await completedPool([RIDER]);
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    await db().doc(`trips/${tripId}`).set({ completedAt: eightDaysAgo }, { merge: true });

    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    expect(out.targets).toEqual([]);
    expect(out.closesAtMs).toBeLessThan(Date.now());
  });
});

describe('submitCoRiderRating', () => {
  it('records the rating and averages it into coRiderRating', async () => {
    const tripId = await completedPool([RIDER]);
    await submitCoRiderRating.run(
      makeReq({ tripId, targetUid: RIDER, stars: 4, comment: 'Good company' }, HOST),
    );

    const user = await db().doc(`users/${RIDER}`).get();
    expect(user.get('coRiderRating')).toBe(4);
    expect(user.get('coRiderRatingCount')).toBe(1);

    const rating = await db().doc(`ratings/${tripId}_corider_${HOST}_${RIDER}`).get();
    expect(rating.exists).toBe(true);
    expect(rating.get('stars')).toBe(4);
    expect(rating.get('raterId')).toBe(HOST);
    expect(rating.get('targetRole')).toBe('coRider');
    expect(rating.get('comment')).toBe('Good company');
  });

  it('never touches `rating`, which is what DRIVERS think of a passenger', async () => {
    // The whole reason the two averages are stored apart: a woman checking who
    // is already in a car wants to know what riders made of them, and that
    // number must not be diluted by a judgement she did not ask for.
    await db().doc(`users/${RIDER}`).set({ rating: 5, ratingCount: 10 }, { merge: true });
    const tripId = await completedPool([RIDER]);
    await submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 1 }, HOST));

    const user = await db().doc(`users/${RIDER}`).get();
    expect(user.get('rating')).toBe(5);
    expect(user.get('ratingCount')).toBe(10);
    expect(user.get('coRiderRating')).toBe(1);
    expect(user.get('coRiderRatingCount')).toBe(1);
  });

  it('averages from the real history rather than an assumed 5.0', async () => {
    // A driver's average starts at 5.0 because approval vouches for them before
    // anyone rides with them. A rider is vouched for by nobody, so four free
    // stars here would mean the first ratings barely moved the number.
    const tripId = await completedPool([RIDER, THIRD]);
    await submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 2 }, HOST));
    await submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 4 }, THIRD));

    const user = await db().doc(`users/${RIDER}`).get();
    expect(user.get('coRiderRating')).toBe(3);
    expect(user.get('coRiderRatingCount')).toBe(2);
  });

  it('refuses a second rating of the same person on the same ride', async () => {
    const tripId = await completedPool([RIDER]);
    await submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 5 }, HOST));
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 1 }, HOST)),
    ).rejects.toThrow(/already rated/i);

    const user = await db().doc(`users/${RIDER}`).get();
    expect(user.get('coRiderRatingCount')).toBe(1);
  });

  it('refuses to let anybody rate themselves', async () => {
    const tripId = await completedPool([RIDER]);
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: HOST, stars: 5 }, HOST)),
    ).rejects.toThrow(/cannot rate yourself/i);
  });

  it('refuses somebody who was not in the car', async () => {
    const tripId = await completedPool([RIDER]);
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 1 }, OUTSIDER)),
    ).rejects.toThrow(/not on this ride/i);
  });

  it('refuses a target who was not in the car', async () => {
    const tripId = await completedPool([RIDER]);
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: OUTSIDER, stars: 1 }, HOST)),
    ).rejects.toThrow(/was not on this ride/i);
  });

  it('refuses a ride that is not finished', async () => {
    const tripId = await completedPool([RIDER]);
    await db().doc(`trips/${tripId}`).set({ status: 'in_progress' }, { merge: true });
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 5 }, HOST)),
    ).rejects.toThrow(/not finished/i);
  });

  it('refuses once the window has closed', async () => {
    const tripId = await completedPool([RIDER]);
    await db()
      .doc(`trips/${tripId}`)
      .set({ completedAt: new Date(Date.now() - 8 * 86_400_000) }, { merge: true });
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 5 }, HOST)),
    ).rejects.toThrow(/close/i);
  });

  it('refuses a star count outside 1–5', async () => {
    const tripId = await completedPool([RIDER]);
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 6 }, HOST)),
    ).rejects.toThrow();
    await expect(
      submitCoRiderRating.run(makeReq({ tripId, targetUid: RIDER, stars: 0 }, HOST)),
    ).rejects.toThrow();
  });
});

describe('the threshold before an average is shown', () => {
  it('withholds the number until enough riders have rated, but publishes the count', async () => {
    // Seeded directly: this is about what coRiderStanding() discloses, not
    // about how the ratings got there.
    await db()
      .doc(`users/${RIDER}`)
      .set({ coRiderRating: 1.5, coRiderRatingCount: RATINGS_BEFORE_SHOWN - 1 }, { merge: true });

    const tripId = await completedPool([RIDER]);
    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    const target = out.targets.find((t) => t.uid === RIDER)!;
    expect(target.coRiderRating).toBeNull();
    expect(target.coRiderRatingCount).toBe(RATINGS_BEFORE_SHOWN - 1);
  });

  it('shows it once the threshold is reached', async () => {
    await db()
      .doc(`users/${RIDER}`)
      .set({ coRiderRating: 4.3, coRiderRatingCount: RATINGS_BEFORE_SHOWN }, { merge: true });

    const tripId = await completedPool([RIDER]);
    const out = await getCoRiderRatingTargets.run(makeReq({ tripId }, HOST));
    const target = out.targets.find((t) => t.uid === RIDER)!;
    expect(target.coRiderRating).toBe(4.3);
    expect(target.coRiderRatingCount).toBe(RATINGS_BEFORE_SHOWN);
  });
});
