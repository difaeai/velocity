/**
 * The daily ride target and the day-based commission — the rules that decide
 * what a driver pays.
 *
 * What these tests actually protect:
 *
 *  1. **The day boundary is Pakistan's, not UTC's.** Get this wrong and a
 *     driver's evening rides land on tomorrow, splitting the shift that would
 *     have gone commission-free across two days that each fall short.
 *  2. **Only pool rides count.** A solo ride still earns its fare and still
 *     owes its commission; it must not move the counter.
 *  3. **The target is granted exactly once per day.** It is granted inside the
 *     same transaction that settles a ride, so a double-tapped "end ride" or a
 *     transaction retry must not waive twice — and with the cash bonus at zero,
 *     `bonusGranted > 0` is no longer able to be the guard.
 *  4. **The waiver is not a free gift of past commission.** Crossing the target
 *     credits the commission already accrued TODAY — capped at what the cycle
 *     still actually holds, so a driver who settled at noon is not paid again
 *     for the morning.
 *  5. **Nothing is owed mid-day, and everything is owed at midnight.** This is
 *     the whole new rule: at 23:59 a short day locks nobody, at 00:00 the same
 *     figures lock the driver, and no job runs in between.
 *  6. **A day the bonus covers clears itself** rather than locking a driver who
 *     does not actually have to find any money.
 *  7. **The anti-farming floors hold.** Sixteen rides around a car park with
 *     one friend must not go free.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { FieldValue } from '../../lib/firebase';
import {
  DEFAULT_DAILY_TARGET,
  dailyTargetProgress,
  emptyDay,
  pktDayKey,
  pktPreviousDay,
  rideQualifies,
  type DailyTargetDay,
  type DayKey,
} from '../../domain/dailyTarget';
import {
  closedCycle,
  commissionBreakdown,
  commissionDue,
  commissionOwedInFull,
  getCommissionSettings,
  isCommissionLocked,
  openCycle,
  readCycle,
  type CommissionSettings,
} from '../../domain/commission';
import { dailyTargetRef, readDailyTargetDay, recordRideOnDailyTarget } from '../dailyTarget';
import { applyRideToCycle } from '../cycle';
import { applyCommissionCredit } from '../commissionCredit';

const DRIVER = 'driver-target';
const DAY = '2026-10-01';
const NEXT_DAY = '2026-10-02';

/** Admin settings as the tests want them, with the shipped defaults underneath. */
function settings(over: Partial<CommissionSettings> = {}): CommissionSettings {
  return {
    rate: 0.05,
    ...DEFAULT_DAILY_TARGET,
    ...over,
  };
}

function day(over: Partial<DailyTargetDay> = {}): DailyTargetDay {
  return { ...emptyDay(DAY), ...over };
}

/** Sixteen different passengers, so the anti-farming check is not the subject. */
function riders(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `rider-${i}`);
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
    // 19:00 UTC is midnight — the day rolls over, and a short day becomes due.
    expect(pktDayKey(new Date('2026-10-01T19:00:00Z'))).toBe('2026-10-02');
  });

  it('steps back a day without tripping over the month end', () => {
    expect(pktPreviousDay('2026-10-01')).toBe('2026-09-30');
    expect(pktPreviousDay('2026-01-01')).toBe('2025-12-31');
    expect(pktPreviousDay('2028-03-01')).toBe('2028-02-29'); // leap year
  });
});

// ── 2. The pure progress rule ────────────────────────────────────────────────

describe('dailyTargetProgress', () => {
  it('counts down in rides, not percentages', () => {
    const p = dailyTargetProgress(day({ qualifyingRides: 9 }), settings());
    expect(p.target).toBe(16);
    expect(p.ridesToGo).toBe(7);
    expect(p.met).toBe(false);
  });

  it('says "pool rides" while only pool rides count', () => {
    const p = dailyTargetProgress(day({ qualifyingRides: 1 }), settings());
    expect(p.poolOnly).toBe(true);
    expect(p.blockers.find((b) => b.key === 'rides')!.label).toBe('16 pool rides of PKR 150+');

    const anyRide = dailyTargetProgress(day(), settings({ dailyTargetPoolOnly: false }));
    expect(anyRide.blockers.find((b) => b.key === 'rides')!.label).toBe('16 rides of PKR 150+');
  });

  it('names every unmet condition, not just the ride count', () => {
    // Sixteen rides, but all from one friend and barely any money taken.
    const p = dailyTargetProgress(
      day({ qualifyingRides: 16, riderIds: ['friend'], grossFare: 1600 }),
      settings(),
    );
    expect(p.met).toBe(false);
    expect(p.blockers.map((b) => b.key).sort()).toEqual(['dayFare', 'riders']);
    // The driver is told the real figures so the day is fixable before midnight.
    const riderBlocker = p.blockers.find((b) => b.key === 'riders')!;
    expect(riderBlocker).toMatchObject({ have: 1, need: 5 });
  });

  it('is met only when every condition clears, and then the day is free', () => {
    const p = dailyTargetProgress(
      day({ qualifyingRides: 16, riderIds: riders(5), grossFare: 4800 }),
      settings(),
    );
    expect(p.met).toBe(true);
    expect(p.blockers).toEqual([]);
    // No separate cash bonus any more: the commission-free day IS the reward.
    expect(p.bonus).toBe(0);
    expect(p.commissionWaived).toBe(true);
  });

  it('keeps the waiver on a day already granted, even if the admin raises the target', () => {
    // An admin editing the target mid-day must not retroactively make a driver
    // owe commission on rides they already drove commission-free.
    const granted = day({ qualifyingRides: 16, granted: true, riderIds: ['a'], grossFare: 100 });
    const p = dailyTargetProgress(granted, settings({ dailyTargetRides: 30 }));
    expect(p.met).toBe(false);
    expect(p.granted).toBe(true);
    expect(p.commissionWaived).toBe(true);
  });

  it('recognises a day written before `granted` existed by its bonus', () => {
    const legacy = day({ qualifyingRides: 15, bonusGranted: 2000 });
    expect(dailyTargetProgress(legacy, settings()).granted).toBe(true);
  });

  it('never waives when the admin has the waiver switched off', () => {
    const met = day({ qualifyingRides: 16, riderIds: riders(5), grossFare: 4800 });
    const p = dailyTargetProgress(met, settings({ dailyTargetWaivesCommission: false }));
    expect(p.met).toBe(true);
    expect(p.commissionWaived).toBe(false);
  });

  it('drops every check the admin zeroes out', () => {
    const open = settings({ dailyTargetMinRiders: 0, dailyTargetMinDayFare: 0, dailyTargetMinRideFare: 0 });
    const p = dailyTargetProgress(day({ qualifyingRides: 16 }), open);
    expect(p.met).toBe(true);
  });
});

describe('rideQualifies', () => {
  it('holds the fare floor', () => {
    expect(rideQualifies(149, settings(), true)).toBe(false);
    expect(rideQualifies(150, settings(), true)).toBe(true);
  });
  it('refuses a solo ride while only pool rides count', () => {
    expect(rideQualifies(5000, settings(), false)).toBe(false);
    expect(rideQualifies(5000, settings({ dailyTargetPoolOnly: false }), false)).toBe(true);
  });
  it('lets everything through when the floor is zero', () => {
    expect(rideQualifies(1, settings({ dailyTargetMinRideFare: 0 }), true)).toBe(true);
  });
});

// ── 3. Open day versus closed day ────────────────────────────────────────────

describe('the cycle split', () => {
  beforeEach(clearFirestore);

  async function driverSnap(fields: Record<string, unknown>) {
    await db().doc(`drivers/${DRIVER}`).set(fields);
    return db().doc(`drivers/${DRIVER}`).get();
  }

  it('owes nothing while the day is still running', async () => {
    const snap = await driverSnap({
      cycleGrossFare: 9000,
      cycleCashFare: 9000,
      cycleDay: DAY,
      cycleGrossToday: 9000,
      cycleCashToday: 9000,
    });
    // 23:59 on the day itself: the driver has taken PKR 9,000 in cash and owes
    // nothing at all, because the day can still reach its target.
    expect(commissionDue(snap, settings(), DAY)).toBe(0);
    expect(isCommissionLocked(snap, settings(), DAY)).toBe(false);
  });

  it('owes the whole day the moment midnight passes', async () => {
    const snap = await driverSnap({
      cycleGrossFare: 9000,
      cycleCashFare: 9000,
      cycleDay: DAY,
      cycleGrossToday: 9000,
      cycleCashToday: 9000,
    });
    // Same document, one day key later. Nothing was written in between.
    expect(commissionDue(snap, settings(), NEXT_DAY)).toBe(450); // 5% of 9,000
    expect(isCommissionLocked(snap, settings(), NEXT_DAY)).toBe(true);
  });

  it('charges yesterday and leaves today alone when both are in the cycle', async () => {
    // A trip accepted before midnight finished after it, so the cycle holds
    // 2,000 of yesterday and 500 of today.
    const snap = await driverSnap({
      cycleGrossFare: 2500,
      cycleCashFare: 2500,
      cycleDay: NEXT_DAY,
      cycleGrossToday: 500,
      cycleCashToday: 500,
    });
    const b = commissionBreakdown(snap, settings(), NEXT_DAY);
    expect(b.settleableCash).toBe(2000);
    expect(b.grossDue).toBe(100); // 5% of 2,000 — today's 500 is untouched
    expect(openCycle(readCycle(snap), NEXT_DAY)).toEqual({ gross: 500, cash: 500 });
  });

  it('gives a driver carried over from the old scheme one day of grace', async () => {
    // No `cycleDay`: the whole cycle reads as open, so nobody is locked out by
    // the deploy itself.
    const snap = await driverSnap({ cycleGrossFare: 6000, cycleCashFare: 6000 });
    expect(readCycle(snap).day).toBeNull();
    expect(closedCycle(readCycle(snap), DAY)).toEqual({ gross: 0, cash: 0 });
    expect(commissionDue(snap, settings(), DAY)).toBe(0);
  });

  it('treats a legacy cycle with no cash figure as all cash', async () => {
    const snap = await driverSnap({ cycleGrossFare: 4000, cycleDay: DAY, cycleCashToday: 0 });
    // `cycleCashFare` missing → the cycle was all cash, and the clamp keeps the
    // open portion from claiming more than the cycle holds.
    expect(readCycle(snap).cash).toBe(4000);
    expect(commissionDue(snap, settings(), NEXT_DAY)).toBe(200);
  });

  it('splits the commission between the bonus and the driver', async () => {
    const snap = await driverSnap({
      cycleGrossFare: 10_000,
      cycleCashFare: 10_000,
      cycleDay: DAY,
      commissionCredit: 300,
    });
    expect(commissionBreakdown(snap, settings(), NEXT_DAY)).toEqual({
      grossDue: 500,
      creditApplied: 300,
      due: 200,
      creditRemaining: 0,
      settleableCash: 10_000,
      settleableGross: 10_000,
    });
  });

  it('charges the driver nothing while their bonus covers the day', async () => {
    const snap = await driverSnap({
      cycleGrossFare: 10_000,
      cycleCashFare: 10_000,
      cycleDay: DAY,
      commissionCredit: 2000,
    });
    const b = commissionBreakdown(snap, settings(), NEXT_DAY);
    expect(b).toMatchObject({ grossDue: 500, creditApplied: 500, due: 0, creditRemaining: 1500 });
    expect(isCommissionLocked(snap, settings(), NEXT_DAY)).toBe(false);
  });

  it('ignores a negative or junk bonus value rather than paying out on it', async () => {
    const snap = await driverSnap({
      cycleGrossFare: 10_000,
      cycleCashFare: 10_000,
      cycleDay: DAY,
      commissionCredit: -5000,
    });
    expect(commissionDue(snap, settings(), NEXT_DAY)).toBe(500);
  });

  it('never reports more cash than the cycle grossed', async () => {
    // Production keeps cash ≤ gross by construction. A document that says
    // otherwise is damaged, and the clamp stops it inventing a debt.
    const snap = await driverSnap({ cycleGrossFare: 1000, cycleCashFare: 9000, cycleDay: DAY });
    expect(readCycle(snap).cash).toBe(1000);
  });

  it('collects the open day too when the driver is leaving for good', async () => {
    // Account deletion is the one place the running day is charged — otherwise
    // "delete account" is the cheapest way to skip a day's commission.
    const snap = await driverSnap({
      cycleGrossFare: 9000,
      cycleCashFare: 9000,
      cycleDay: DAY,
      cycleGrossToday: 9000,
      cycleCashToday: 9000,
    });
    expect(commissionDue(snap, settings(), DAY)).toBe(0);
    expect(commissionOwedInFull(snap, settings())).toBe(450);
  });

  it('locks nobody when there is no commission to find', async () => {
    const snap = await driverSnap({ cycleGrossFare: 0, cycleCashFare: 0 });
    expect(isCommissionLocked(snap, settings(), DAY)).toBe(false);
  });
});

// ── 4. Recording a ride ──────────────────────────────────────────────────────

describe('recordRideOnDailyTarget', () => {
  beforeEach(clearFirestore);

  /**
   * Run a whole settlement the way `completeTrip` and `completePoolRide` do:
   * record the ride against the day, fold it into the cycle, and write the
   * driver document once. Anything less and the test is not testing production.
   */
  async function record(params: {
    grossFare: number;
    cashFare?: number;
    riderIds?: string[];
    rideId?: string;
    isPoolRide?: boolean;
    day?: DayKey;
    config?: Partial<CommissionSettings>;
  }) {
    const s = settings(params.config);
    const onDay = params.day ?? DAY;
    const driverRef = db().doc(`drivers/${DRIVER}`);
    const dayRef = dailyTargetRef(DRIVER, onDay);
    return db().runTransaction(async (tx) => {
      const [driverSnap, daySnap] = await Promise.all([tx.get(driverRef), tx.get(dayRef)]);
      const target = recordRideOnDailyTarget({
        tx,
        driverId: DRIVER,
        driverSnap,
        daySnap,
        day: onDay,
        settings: s,
        grossFare: params.grossFare,
        cashFare: params.cashFare ?? params.grossFare,
        riderIds: params.riderIds ?? ['rider-1'],
        isPoolRide: params.isPoolRide ?? true,
        rideId: params.rideId ?? 'trip-1',
      });
      const cycle = applyRideToCycle({
        tx,
        driverId: DRIVER,
        driverSnap,
        settings: s,
        today: onDay,
        grossFare: params.grossFare,
        commissionableCashFare: target.commissionableCashFare,
        rideId: params.rideId ?? 'trip-1',
      });
      tx.set(
        driverRef,
        {
          ...cycle.fields,
          // `increment`, exactly like the callers: `applyRideToCycle` may have
          // spent credit through its own write to this document, and an absolute
          // value here would quietly undo that.
          ...(target.creditDelta > 0
            ? { commissionCredit: FieldValue.increment(target.creditDelta) }
            : {}),
        },
        { merge: true },
      );
      return { ...target, cycle };
    });
  }

  /** Drive a qualifying day: `n` pool rides of `fare`, each from a new rider. */
  async function driveDay(n: number, fare = 300, onDay: DayKey = DAY) {
    for (let i = 0; i < n; i += 1) {
      await record({ grossFare: fare, riderIds: [`rider-${i}`], rideId: `trip-${i}`, day: onDay });
    }
  }

  const driverDoc = () => db().doc(`drivers/${DRIVER}`).get();
  const storedDay = async (onDay: DayKey = DAY) =>
    readDailyTargetDay(await dailyTargetRef(DRIVER, onDay).get(), onDay);

  it('counts rides and tracks distinct riders', async () => {
    await driveDay(3);
    const stored = await storedDay();
    expect(stored.rides).toBe(3);
    expect(stored.poolRides).toBe(3);
    expect(stored.qualifyingRides).toBe(3);
    expect(stored.grossFare).toBe(900);
    expect(stored.riderIds).toHaveLength(3);
  });

  it('does not count a solo ride toward the target, but does charge it', async () => {
    await record({ grossFare: 900, isPoolRide: false });
    const stored = await storedDay();
    // The ride happened, the fare counts, the commission is owed — it simply is
    // not the kind of ride the target is paying for.
    expect(stored.rides).toBe(1);
    expect(stored.poolRides).toBe(0);
    expect(stored.qualifyingRides).toBe(0);
    expect((await driverDoc()).get('cycleCashFare')).toBe(900);
  });

  it('counts a solo ride when the admin turns pool-only off', async () => {
    await record({ grossFare: 900, isPoolRide: false, config: { dailyTargetPoolOnly: false } });
    expect((await storedDay()).qualifyingRides).toBe(1);
  });

  it('does not count a ride below the fare floor toward the target', async () => {
    await record({ grossFare: 100 });
    const stored = await storedDay();
    expect(stored.rides).toBe(1);
    expect(stored.poolRides).toBe(1);
    expect(stored.qualifyingRides).toBe(0);
    expect(stored.grossFare).toBe(100);
  });

  it('waives the day on the ride that completes the target, once', async () => {
    await driveDay(15);
    expect((await storedDay()).granted).toBe(false);

    const crossing = await record({ grossFare: 300, riderIds: ['rider-15'], rideId: 'trip-15' });
    expect(crossing.progress.met).toBe(true);
    expect(crossing.granted).toBe(true);
    // No cash bonus, and 15 earlier rides × 300 = 4,500 of cash in the cycle at
    // 5% — so the day's commission so far is cancelled and nothing else is paid.
    expect(crossing.bonusGranted).toBe(0);
    expect(crossing.waiverGranted).toBe(225);
    expect(crossing.creditDelta).toBe(225);

    // A seventeenth ride must not waive again. This is the regression the
    // `granted` flag exists for: `bonusGranted > 0` is 0 forever now.
    const after = await record({ grossFare: 300, riderIds: ['rider-16'], rideId: 'trip-16' });
    expect(after.granted).toBe(false);
    expect(after.creditDelta).toBe(0);

    const stored = await storedDay();
    expect(stored.granted).toBe(true);
    expect(stored.waiverGranted).toBe(225);
    expect((await driverDoc()).get('commissionCredit')).toBe(225);
  });

  it('pays a cash bonus on top when an admin has set one', async () => {
    const withBonus = { dailyTargetBonus: 1000 };
    for (let i = 0; i < 15; i += 1) {
      await record({ grossFare: 300, riderIds: [`rider-${i}`], rideId: `trip-${i}`, config: withBonus });
    }
    const crossing = await record({
      grossFare: 300,
      riderIds: ['rider-15'],
      rideId: 'trip-15',
      config: withBonus,
    });
    expect(crossing.bonusGranted).toBe(1000);
    expect(crossing.creditDelta).toBe(1225); // bonus + the day's waiver
  });

  it('stops the day adding to the commissionable cycle once the target is met', async () => {
    await driveDay(16);
    const before = (await driverDoc()).get('cycleCashFare') as number;
    const next = await record({ grossFare: 300, riderIds: ['rider-x'], rideId: 'trip-x' });
    expect(next.commissionableCashFare).toBe(0);
    expect((await driverDoc()).get('cycleCashFare')).toBe(before);
  });

  it('leaves a full target day owing nothing at midnight', async () => {
    await driveDay(16);
    const snap = await driverDoc();
    // 4,500 of cash is still sitting in the cycle, matched by 225 of waiver
    // credit — so when the day closes the driver owes exactly nothing.
    expect(commissionDue(snap, settings(), NEXT_DAY)).toBe(0);
    expect(isCommissionLocked(snap, settings(), NEXT_DAY)).toBe(false);
  });

  it('caps the retroactive waiver at what the cycle still holds', async () => {
    // The driver drove 15 rides and then settled: the cycle is empty, so the
    // morning's commission has already been paid. Crossing the target must not
    // credit it again — that would be a gift, not a waiver.
    await driveDay(15);
    await db().doc(`drivers/${DRIVER}`).set(
      { cycleGrossFare: 0, cycleCashFare: 0, cycleGrossToday: 0, cycleCashToday: 0 },
      { merge: true },
    );
    const crossing = await record({ grossFare: 300, riderIds: ['rider-15'], rideId: 'trip-15' });
    expect(crossing.granted).toBe(true);
    expect(crossing.waiverGranted).toBe(0);
  });

  it('refuses to waive a day farmed with one friend', async () => {
    for (let i = 0; i < 20; i += 1) {
      await record({ grossFare: 200, riderIds: ['the-same-friend'], rideId: `trip-${i}` });
    }
    const stored = await storedDay();
    expect(stored.qualifyingRides).toBe(20);
    expect(stored.granted).toBe(false); // one rider, needs five
    expect((await driverDoc()).get('commissionCredit')).toBeUndefined();
  });

  it('refuses to waive a day of sixteen trips round the block', async () => {
    // Different riders, each ride just over the per-ride floor, but the day
    // never adds up to a real shift: 16 × 150 = 2,400 against a 2,500 minimum.
    for (let i = 0; i < 16; i += 1) {
      await record({
        grossFare: 150,
        riderIds: [`rider-${i}`],
        rideId: `trip-${i}`,
        config: { dailyTargetMinDayFare: 2500 },
      });
    }
    const stored = await storedDay();
    expect(stored.qualifyingRides).toBe(16);
    expect(stored.grossFare).toBe(2400);
    expect(stored.granted).toBe(false);
    // And because it did not qualify, the whole 2,400 is commissionable.
    expect((await driverDoc()).get('cycleCashFare')).toBe(2400);
  });

  it('waives a day that lands exactly on the floors', async () => {
    // The boundary belongs to the driver: 16 × 150 = 2,400 against the shipped
    // 2,000 day minimum qualifies, and must.
    await driveDay(16, 150);
    expect((await storedDay()).granted).toBe(true);
  });

  it('counts a full pool as one ride but several passengers', async () => {
    await record({ grossFare: 900, riderIds: ['a', 'b', 'c'], rideId: 'pool-1' });
    const stored = await storedDay();
    expect(stored.rides).toBe(1);
    expect(stored.riderIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('tracks the day but waives nothing while the programme is switched off', async () => {
    for (let i = 0; i < 20; i += 1) {
      await record({
        grossFare: 400,
        riderIds: [`rider-${i}`],
        rideId: `trip-${i}`,
        config: { dailyTargetEnabled: false },
      });
    }
    const stored = await storedDay();
    // Rides and fares are still recorded, so switching the target on mid-day
    // does not show every driver at zero.
    expect(stored.rides).toBe(20);
    expect(stored.qualifyingRides).toBe(0);
    expect(stored.granted).toBe(false);
    // And every rupee of it is commissionable.
    expect((await driverDoc()).get('cycleCashFare')).toBe(8000);
  });

  it('nudges exactly once, on the ride that leaves one to go', async () => {
    await driveDay(14);
    const penultimate = await record({ grossFare: 300, riderIds: ['rider-14'], rideId: 'trip-14' });
    expect(penultimate.nudge).toBe(true);
    // A non-qualifying ride after it leaves the count alone and must not re-nudge.
    const cheap = await record({ grossFare: 50, riderIds: ['rider-y'], rideId: 'trip-y' });
    expect(cheap.nudge).toBe(false);
  });

  // ── The day roll ──────────────────────────────────────────────────────────

  it('carries a short day forward as a debt and reports the driver locked', async () => {
    await driveDay(10); // ten pool rides of 300 = 3,000 of cash, target missed
    expect((await driverDoc()).get('cycleCashFare')).toBe(3000);

    // The next ride lands on the next day — a ride that was already in flight,
    // since the driver is locked out of accepting anything new.
    const next = await record({ grossFare: 300, riderIds: ['rider-new'], day: NEXT_DAY, rideId: 't-n' });
    expect(next.cycle.locked).toBe(true);
    expect(next.cycle.due).toBe(150); // 5% of yesterday's 3,000
    expect(next.cycle.autoCleared).toBe(false);

    const snap = await driverDoc();
    // Yesterday's debt survived the ride; today's 300 sits apart from it.
    expect(snap.get('cycleCashFare')).toBe(3300);
    expect(snap.get('cycleCashToday')).toBe(300);
    expect(snap.get('cycleDay')).toBe(NEXT_DAY);
    expect(commissionDue(snap, settings(), NEXT_DAY)).toBe(150);
  });

  it('clears a closed day by itself when the bonus covers it', async () => {
    // A full target day: 4,500 of cash in the cycle and 225 of waiver credit.
    await driveDay(16);

    // First ride of the next day rolls yesterday. It owed 225, the bonus paid
    // it, so it is cleared here and never locks the driver.
    const next = await record({ grossFare: 300, riderIds: ['rider-new'], day: NEXT_DAY, rideId: 't-n' });
    expect(next.cycle.autoCleared).toBe(true);
    expect(next.cycle.grossDue).toBe(225);
    expect(next.cycle.creditApplied).toBe(225);
    expect(next.cycle.locked).toBe(false);

    const snap = await driverDoc();
    expect(snap.get('cycleCashFare')).toBe(300); // only today's ride is left
    expect(snap.get('commissionCredit')).toBe(0); // the bonus was spent on it

    // Both sides of it are on the books: revenue earned, and what it cost us.
    const revenue = await db()
      .collection('platformLedger')
      .where('type', '==', 'ride_commission')
      .get();
    expect(revenue.size).toBe(1);
    expect(revenue.docs[0]!.get('amount')).toBe(225);
    const incentive = await db()
      .collection('platformLedger')
      .where('type', '==', 'driver_incentive')
      .get();
    expect(incentive.size).toBe(1);
    expect(incentive.docs[0]!.get('amount')).toBe(225);
  });

  it('clears an all-online day without charging or ledgering anything', async () => {
    // Wallet rides: commission was taken at completion, so the day is closed
    // owing nothing and must not lock the driver.
    await record({ grossFare: 900, cashFare: 0, rideId: 'wallet-1' });
    expect((await driverDoc()).get('cycleCashFare')).toBe(0);

    const next = await record({ grossFare: 300, day: NEXT_DAY, rideId: 't-n' });
    expect(next.cycle.autoCleared).toBe(true);
    expect(next.cycle.locked).toBe(false);
    expect((await driverDoc()).get('cycleGrossFare')).toBe(300);
    expect((await db().collection('platformLedger').get()).empty).toBe(true);
  });

  it('files a ride on the day it is told to, not the day the clock says', async () => {
    // The callers resolve the day key before the transaction precisely so a
    // retry seconds after midnight cannot move a ride onto the next day.
    await record({ grossFare: 300, day: DAY, rideId: 'late' });
    expect((await storedDay(DAY)).rides).toBe(1);
    expect((await storedDay(NEXT_DAY)).rides).toBe(0);
  });
});

// ── 5. Spending the bonus ────────────────────────────────────────────────────

describe('applyCommissionCredit', () => {
  beforeEach(clearFirestore);

  it('spends the bonus, ledgers the incentive, and leaves the remainder', async () => {
    const driverRef = db().doc(`drivers/${DRIVER}`);
    await driverRef.set({
      cycleGrossFare: 10_000,
      cycleCashFare: 10_000,
      cycleDay: DAY,
      commissionCredit: 2000,
    });

    const breakdown = await db().runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      return applyCommissionCredit({
        tx,
        driverId: DRIVER,
        driverSnap: snap,
        settings: settings(),
        today: NEXT_DAY,
        source: 'manual_bank',
        ref: 'settlement-1',
      });
    });

    expect(breakdown).toMatchObject({
      grossDue: 500,
      creditApplied: 500,
      due: 0,
      creditRemaining: 1500,
    });

    const driver = await driverRef.get();
    expect(driver.get('commissionCredit')).toBe(1500);
    expect(driver.get('commissionCreditUsed')).toBe(500);

    // Revenue and the incentive that paid it are recorded separately, so the
    // cost of the programme is visible rather than hidden inside a smaller
    // revenue number.
    const incentive = await db()
      .collection('platformLedger')
      .where('type', '==', 'driver_incentive')
      .get();
    expect(incentive.size).toBe(1);
    expect(incentive.docs[0]!.get('amount')).toBe(500);
    expect(incentive.docs[0]!.get('grossCommission')).toBe(500);

    const statement = await driverRef.collection('commissionCredits').get();
    expect(statement.size).toBe(1);
    expect(statement.docs[0]!.get('amount')).toBe(-500); // reads like a statement
  });

  it('writes nothing at all when there is no bonus to spend', async () => {
    const driverRef = db().doc(`drivers/${DRIVER}`);
    await driverRef.set({ cycleGrossFare: 10_000, cycleCashFare: 10_000, cycleDay: DAY });

    const breakdown = await db().runTransaction(async (tx) => {
      const snap = await tx.get(driverRef);
      return applyCommissionCredit({
        tx,
        driverId: DRIVER,
        driverSnap: snap,
        settings: settings(),
        today: NEXT_DAY,
        source: 'wallet',
      });
    });

    expect(breakdown.creditApplied).toBe(0);
    expect(breakdown.due).toBe(500);
    expect((await db().collection('platformLedger').get()).empty).toBe(true);
    expect((await driverRef.collection('commissionCredits').get()).empty).toBe(true);
  });
});

// ── 6. The admin-set values are what the backend actually reads ──────────────

describe('getCommissionSettings', () => {
  beforeEach(clearFirestore);

  it('reads the admin values the dashboard saves', async () => {
    await db().doc('config/commissionSettings').set({
      rate: 0.08,
      dailyTargetRides: 20,
      dailyTargetBonus: 3000,
      dailyTargetWaivesCommission: false,
      dailyTargetPoolOnly: false,
      dailyTargetMinRideFare: 200,
      dailyTargetMinRiders: 8,
      dailyTargetMinDayFare: 5000,
    });
    const s = await getCommissionSettings();
    expect(s).toMatchObject({
      rate: 0.08,
      dailyTargetEnabled: true,
      dailyTargetRides: 20,
      dailyTargetBonus: 3000,
      dailyTargetWaivesCommission: false,
      dailyTargetPoolOnly: false,
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
    expect(s.rate).toBe(0.05);
  });

  it('treats a missing config as the shipped defaults', async () => {
    const s = await getCommissionSettings();
    expect(s.rate).toBe(0.05);
    expect(s.dailyTargetRides).toBe(16);
    expect(s.dailyTargetBonus).toBe(0);
    expect(s.dailyTargetPoolOnly).toBe(true);
    expect(s.dailyTargetEnabled).toBe(true);
  });
});
