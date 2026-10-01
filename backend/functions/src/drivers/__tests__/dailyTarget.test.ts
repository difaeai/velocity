/**
 * The daily ride target — the rule that hands drivers real money.
 *
 * What these tests actually protect:
 *
 *  1. **The day boundary is Pakistan's, not UTC's.** Get this wrong and a
 *     driver's evening rides land on tomorrow, splitting the shift that earned
 *     the bonus across two days that each fall short.
 *  2. **The bonus is paid exactly once per day.** It is granted inside the same
 *     transaction that settles a ride, so a double-tapped "end ride" or a
 *     transaction retry must not pay twice.
 *  3. **The waiver is not a free gift of past commission.** Crossing the target
 *     credits the commission already accrued TODAY — capped at what the cycle
 *     still actually holds, so a driver who settled at noon is not paid again
 *     for the morning.
 *  4. **Credit nets off what the driver owes, and only once.** This is the whole
 *     promise ("it comes off the 2,000, I don't pay separately"), and the thing
 *     most likely to break silently when a fourth settlement path is added.
 *  5. **The anti-farming floors hold.** Fifteen rides around a car park with one
 *     friend must not pay out.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import {
  DEFAULT_DAILY_TARGET,
  dailyTargetProgress,
  emptyDay,
  pktDayKey,
  rideQualifies,
  type DailyTargetDay,
} from '../../domain/dailyTarget';
import {
  commissionBreakdown,
  getCommissionSettings,
  type CommissionSettings,
} from '../../domain/commission';
import { dailyTargetRef, readDailyTargetDay, recordRideOnDailyTarget } from '../dailyTarget';
import { applyCommissionCredit } from '../commissionCredit';

const DRIVER = 'driver-target';
const DAY = '2026-10-01';

/** Admin settings as the tests want them, with the shipped defaults underneath. */
function settings(over: Partial<CommissionSettings> = {}): CommissionSettings {
  return {
    rate: 0.10,
    threshold: 5000,
    ...DEFAULT_DAILY_TARGET,
    ...over,
  };
}

function day(over: Partial<DailyTargetDay> = {}): DailyTargetDay {
  return { ...emptyDay(DAY), ...over };
}

// ── 1. The day boundary ──────────────────────────────────────────────────────

describe('pktDayKey', () => {
  it('reads the Pakistan calendar day, not the UTC one', () => {
    // 20:00 UTC on 30 Sept is 01:00 on 1 Oct in Karachi — a driver finishing a
    // late shift. UTC would file this ride under September.
    expect(pktDayKey(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    // 02:00 UTC is 07:00 the same morning — the start of the next shift.
    expect(pktDayKey(new Date('2026-10-01T02:00:00Z'))).toBe('2026-10-01');
    // 18:59 UTC is 23:59 — still the same Pakistan day.
    expect(pktDayKey(new Date('2026-10-01T18:59:00Z'))).toBe('2026-10-01');
    // 19:00 UTC is midnight — the day rolls over.
    expect(pktDayKey(new Date('2026-10-01T19:00:00Z'))).toBe('2026-10-02');
  });
});

// ── 2. The pure progress rule ────────────────────────────────────────────────

describe('dailyTargetProgress', () => {
  it('counts down in rides, not percentages', () => {
    const p = dailyTargetProgress(day({ qualifyingRides: 9 }), settings());
    expect(p.target).toBe(15);
    expect(p.ridesToGo).toBe(6);
    expect(p.met).toBe(false);
  });

  it('names every unmet condition, not just the ride count', () => {
    // Fifteen rides, but all from one friend and barely any money taken.
    const p = dailyTargetProgress(
      day({ qualifyingRides: 15, riderIds: ['friend'], grossFare: 1600 }),
      settings(),
    );
    expect(p.met).toBe(false);
    expect(p.blockers.map((b) => b.key).sort()).toEqual(['dayFare', 'riders']);
    // The driver is told the real figures so the day is fixable before midnight.
    const riders = p.blockers.find((b) => b.key === 'riders')!;
    expect(riders).toMatchObject({ have: 1, need: 5 });
  });

  it('is met only when every condition clears', () => {
    const p = dailyTargetProgress(
      day({
        qualifyingRides: 15,
        riderIds: ['a', 'b', 'c', 'd', 'e'],
        grossFare: 4200,
      }),
      settings(),
    );
    expect(p.met).toBe(true);
    expect(p.blockers).toEqual([]);
    expect(p.bonus).toBe(2000);
    expect(p.commissionWaived).toBe(true);
  });

  it('keeps the waiver on a day already paid, even if the admin raises the target', () => {
    // An admin editing the target mid-day must not retroactively make a driver
    // owe commission on rides they already drove commission-free.
    const paid = day({ qualifyingRides: 15, bonusGranted: 2000, riderIds: ['a'], grossFare: 100 });
    const p = dailyTargetProgress(paid, settings({ dailyTargetRides: 30 }));
    expect(p.met).toBe(false);
    expect(p.granted).toBe(true);
    expect(p.commissionWaived).toBe(true);
  });

  it('never waives when the admin has the waiver switched off', () => {
    const met = day({ qualifyingRides: 15, riderIds: ['a', 'b', 'c', 'd', 'e'], grossFare: 4200 });
    const p = dailyTargetProgress(met, settings({ dailyTargetWaivesCommission: false }));
    expect(p.met).toBe(true);
    expect(p.commissionWaived).toBe(false);
  });

  it('drops every check the admin zeroes out', () => {
    const open = settings({ dailyTargetMinRiders: 0, dailyTargetMinDayFare: 0, dailyTargetMinRideFare: 0 });
    const p = dailyTargetProgress(day({ qualifyingRides: 15 }), open);
    expect(p.met).toBe(true);
  });
});

describe('rideQualifies', () => {
  it('holds the fare floor', () => {
    expect(rideQualifies(149, settings())).toBe(false);
    expect(rideQualifies(150, settings())).toBe(true);
  });
  it('lets everything through when the floor is zero', () => {
    expect(rideQualifies(1, settings({ dailyTargetMinRideFare: 0 }))).toBe(true);
  });
});

// ── 3. Credit nets off what is owed ──────────────────────────────────────────

describe('commissionBreakdown', () => {
  beforeEach(clearFirestore);

  async function driverSnap(fields: Record<string, unknown>) {
    await db().doc(`drivers/${DRIVER}`).set(fields);
    return db().doc(`drivers/${DRIVER}`).get();
  }

  it('splits the commission between the credit and the driver', async () => {
    const snap = await driverSnap({ cycleGrossFare: 10_000, cycleCashFare: 10_000, commissionCredit: 600 });
    expect(commissionBreakdown(snap, settings())).toEqual({
      grossDue: 1000,
      creditApplied: 600,
      due: 400,
      creditRemaining: 0,
    });
  });

  it('charges the driver nothing while their credit covers the cycle', async () => {
    // The promise, in one assertion: 2,000 of credit against 1,000 of
    // commission means the driver pays nothing and keeps 1,000.
    const snap = await driverSnap({ cycleGrossFare: 10_000, cycleCashFare: 10_000, commissionCredit: 2000 });
    expect(commissionBreakdown(snap, settings())).toEqual({
      grossDue: 1000,
      creditApplied: 1000,
      due: 0,
      creditRemaining: 1000,
    });
  });

  it('ignores a negative or junk credit value rather than paying out on it', async () => {
    const snap = await driverSnap({ cycleCashFare: 10_000, commissionCredit: -5000 });
    expect(commissionBreakdown(snap, settings()).due).toBe(1000);
  });
});

// ── 4. Recording a ride ──────────────────────────────────────────────────────

describe('recordRideOnDailyTarget', () => {
  beforeEach(clearFirestore);

  /** Run the recorder inside a real transaction, like the settlement paths do. */
  async function record(params: {
    grossFare: number;
    cashFare?: number;
    riderIds?: string[];
    rideId?: string;
    config?: Partial<CommissionSettings>;
  }) {
    const s = settings(params.config);
    const driverRef = db().doc(`drivers/${DRIVER}`);
    const dayRef = dailyTargetRef(DRIVER, DAY);
    return db().runTransaction(async (tx) => {
      const [driverSnap, daySnap] = await Promise.all([tx.get(driverRef), tx.get(dayRef)]);
      const result = recordRideOnDailyTarget({
        tx,
        driverId: DRIVER,
        driverSnap,
        daySnap,
        day: DAY,
        settings: s,
        grossFare: params.grossFare,
        cashFare: params.cashFare ?? params.grossFare,
        riderIds: params.riderIds ?? ['rider-1'],
        rideId: params.rideId ?? 'trip-1',
      });
      // The callers fold the credit into their own driver write — mirror that
      // here so the stored balance matches production.
      tx.set(
        driverRef,
        {
          cycleGrossFare: ((driverSnap.get('cycleGrossFare') as number | undefined) ?? 0) + params.grossFare,
          cycleCashFare:
            ((driverSnap.get('cycleCashFare') as number | undefined) ?? 0) + result.commissionableCashFare,
          ...(result.creditDelta > 0
            ? { commissionCredit: ((driverSnap.get('commissionCredit') as number | undefined) ?? 0) + result.creditDelta }
            : {}),
        },
        { merge: true },
      );
      return result;
    });
  }

  /** Drive a qualifying day: `n` rides of `fare`, each from a different rider. */
  async function driveDay(n: number, fare = 300) {
    for (let i = 0; i < n; i += 1) {
      await record({ grossFare: fare, riderIds: [`rider-${i}`], rideId: `trip-${i}` });
    }
  }

  it('counts rides and tracks distinct riders', async () => {
    await driveDay(3);
    const snap = await dailyTargetRef(DRIVER, DAY).get();
    const stored = readDailyTargetDay(snap, DAY);
    expect(stored.rides).toBe(3);
    expect(stored.qualifyingRides).toBe(3);
    expect(stored.grossFare).toBe(900);
    expect(stored.riderIds).toHaveLength(3);
  });

  it('does not count a ride below the fare floor toward the target', async () => {
    await record({ grossFare: 100 });
    const stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    // The ride happened and the fare counts — it just does not count as progress.
    expect(stored.rides).toBe(1);
    expect(stored.qualifyingRides).toBe(0);
    expect(stored.grossFare).toBe(100);
  });

  it('grants the bonus on the ride that completes the target, once', async () => {
    await driveDay(14);
    let stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    expect(stored.bonusGranted).toBe(0);

    const crossing = await record({ grossFare: 300, riderIds: ['rider-14'], rideId: 'trip-14' });
    expect(crossing.progress.met).toBe(true);
    expect(crossing.bonusGranted).toBe(2000);
    // 14 earlier rides × 300 = 4,200 of cash already in the cycle at 10%.
    expect(crossing.waiverGranted).toBe(420);
    expect(crossing.creditDelta).toBe(2420);

    // A 16th ride must not pay again.
    const after = await record({ grossFare: 300, riderIds: ['rider-15'], rideId: 'trip-15' });
    expect(after.bonusGranted).toBe(0);
    expect(after.creditDelta).toBe(0);

    stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    expect(stored.bonusGranted).toBe(2000);
    expect(stored.waiverGranted).toBe(420);

    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('commissionCredit')).toBe(2420);
  });

  it('stops the day adding to the commissionable cycle once the target is met', async () => {
    await driveDay(15);
    const before = (await db().doc(`drivers/${DRIVER}`).get()).get('cycleCashFare') as number;
    const next = await record({ grossFare: 300, riderIds: ['rider-x'], rideId: 'trip-x' });
    expect(next.commissionableCashFare).toBe(0);
    const after = (await db().doc(`drivers/${DRIVER}`).get()).get('cycleCashFare') as number;
    expect(after).toBe(before);
  });

  it('caps the retroactive waiver at what the cycle still holds', async () => {
    // The driver drove 14 rides and then settled: the cycle is empty, so the
    // morning's commission has already been paid. Crossing the target must pay
    // the bonus and nothing more — crediting it again would be a gift.
    await driveDay(14);
    await db().doc(`drivers/${DRIVER}`).set(
      { cycleGrossFare: 0, cycleCashFare: 0 },
      { merge: true },
    );
    const crossing = await record({ grossFare: 300, riderIds: ['rider-14'], rideId: 'trip-14' });
    expect(crossing.bonusGranted).toBe(2000);
    expect(crossing.waiverGranted).toBe(0);
  });

  it('refuses to pay a day farmed with one friend', async () => {
    for (let i = 0; i < 20; i += 1) {
      await record({ grossFare: 200, riderIds: ['the-same-friend'], rideId: `trip-${i}` });
    }
    const stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    expect(stored.qualifyingRides).toBe(20);
    expect(stored.bonusGranted).toBe(0); // one rider, needs five
    const driver = await db().doc(`drivers/${DRIVER}`).get();
    expect(driver.get('commissionCredit')).toBeUndefined();
  });

  it('refuses to pay a day of fifteen trips round the block', async () => {
    // Different riders, each ride over the floor, but the day never reaches the
    // minimum total — PKR 150 × 15 = 2,250 against a 2,500 floor.
    for (let i = 0; i < 15; i += 1) {
      await record({ grossFare: 150, riderIds: [`rider-${i}`], rideId: `trip-${i}` });
    }
    const stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    expect(stored.qualifyingRides).toBe(15);
    expect(stored.bonusGranted).toBe(0);
  });

  it('counts a full pool as one ride but several passengers', async () => {
    await record({ grossFare: 900, riderIds: ['a', 'b', 'c'], rideId: 'pool-1' });
    const stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    expect(stored.rides).toBe(1);
    expect(stored.riderIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('tracks the day but pays nothing while the programme is switched off', async () => {
    for (let i = 0; i < 20; i += 1) {
      await record({
        grossFare: 400,
        riderIds: [`rider-${i}`],
        rideId: `trip-${i}`,
        config: { dailyTargetEnabled: false },
      });
    }
    const stored = readDailyTargetDay(await dailyTargetRef(DRIVER, DAY).get(), DAY);
    // Rides and fares are still recorded, so switching the target on mid-day
    // does not show every driver at zero.
    expect(stored.rides).toBe(20);
    expect(stored.qualifyingRides).toBe(0);
    expect(stored.bonusGranted).toBe(0);
  });

  it('nudges exactly once, on the ride that leaves one to go', async () => {
    await driveDay(13);
    const penultimate = await record({ grossFare: 300, riderIds: ['rider-13'], rideId: 'trip-13' });
    expect(penultimate.nudge).toBe(true);
    // A non-qualifying ride after it leaves the count alone and must not re-nudge.
    const cheap = await record({ grossFare: 50, riderIds: ['rider-y'], rideId: 'trip-y' });
    expect(cheap.nudge).toBe(false);
  });
});

// ── 5. Spending the credit ───────────────────────────────────────────────────

describe('applyCommissionCredit', () => {
  beforeEach(clearFirestore);

  it('spends the credit, ledgers the incentive, and leaves the remainder', async () => {
    const driverRef = db().doc(`drivers/${DRIVER}`);
    await driverRef.set({ cycleGrossFare: 10_000, cycleCashFare: 10_000, commissionCredit: 2000 });

    const breakdown = await db().runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      return applyCommissionCredit({
        tx,
        driverId: DRIVER,
        driverSnap: snap,
        settings: settings(),
        source: 'manual_bank',
        ref: 'settlement-1',
      });
    });

    expect(breakdown).toEqual({ grossDue: 1000, creditApplied: 1000, due: 0, creditRemaining: 1000 });

    const driver = await driverRef.get();
    expect(driver.get('commissionCredit')).toBe(1000);
    expect(driver.get('commissionCreditUsed')).toBe(1000);

    // Revenue and the incentive that paid it are recorded separately, so the
    // cost of the programme is visible rather than hidden inside a smaller
    // revenue number.
    const incentive = await db()
      .collection('platformLedger')
      .where('type', '==', 'driver_incentive')
      .get();
    expect(incentive.size).toBe(1);
    expect(incentive.docs[0]!.get('amount')).toBe(1000);
    expect(incentive.docs[0]!.get('grossCommission')).toBe(1000);

    const statement = await driverRef.collection('commissionCredits').get();
    expect(statement.size).toBe(1);
    expect(statement.docs[0]!.get('amount')).toBe(-1000); // reads like a statement
  });

  it('writes nothing at all when there is no credit to spend', async () => {
    const driverRef = db().doc(`drivers/${DRIVER}`);
    await driverRef.set({ cycleGrossFare: 10_000, cycleCashFare: 10_000 });

    const breakdown = await db().runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      return applyCommissionCredit({
        tx,
        driverId: DRIVER,
        driverSnap: snap,
        settings: settings(),
        source: 'wallet',
      });
    });

    expect(breakdown.creditApplied).toBe(0);
    expect(breakdown.due).toBe(1000);
    expect((await db().collection('platformLedger').get()).empty).toBe(true);
    expect((await driverRef.collection('commissionCredits').get()).empty).toBe(true);
  });
});

// ── 6. The admin-set values are what the backend actually reads ──────────────

describe('getCommissionSettings', () => {
  beforeEach(clearFirestore);

  it('reads the admin values the dashboard saves', async () => {
    await db().doc('config/commissionSettings').set({
      rate: 0.12,
      threshold: 8000,
      dailyTargetRides: 20,
      dailyTargetBonus: 3000,
      dailyTargetWaivesCommission: false,
      dailyTargetMinRideFare: 200,
      dailyTargetMinRiders: 8,
      dailyTargetMinDayFare: 5000,
    });
    const s = await getCommissionSettings();
    expect(s).toMatchObject({
      rate: 0.12,
      threshold: 8000,
      dailyTargetEnabled: true,
      dailyTargetRides: 20,
      dailyTargetBonus: 3000,
      dailyTargetWaivesCommission: false,
      dailyTargetMinRideFare: 200,
      dailyTargetMinRiders: 8,
      dailyTargetMinDayFare: 5000,
    });
  });

  it('falls back to the default rather than paying out a typo', async () => {
    // 200000 in a bonus box is a slipped zero, not an intention. Clamping it to
    // the maximum would pay PKR 50,000 a day, which is just as wrong.
    await db().doc('config/commissionSettings').set({
      dailyTargetBonus: 200_000,
      dailyTargetRides: 0,
      rate: 5,
    });
    const s = await getCommissionSettings();
    expect(s.dailyTargetBonus).toBe(DEFAULT_DAILY_TARGET.dailyTargetBonus);
    expect(s.dailyTargetRides).toBe(DEFAULT_DAILY_TARGET.dailyTargetRides);
    expect(s.rate).toBe(0.10);
  });

  it('treats a missing config as the shipped defaults', async () => {
    const s = await getCommissionSettings();
    expect(s.dailyTargetRides).toBe(15);
    expect(s.dailyTargetBonus).toBe(2000);
    expect(s.dailyTargetEnabled).toBe(true);
  });
});
