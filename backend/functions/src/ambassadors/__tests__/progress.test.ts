/**
 * Velocity Ambassador Program — the targets and the pay (pure, no emulator).
 *
 * This decides whether a real person is paid PKR 50,000 or a commission, so
 * every rule the owner gave is pinned here by name:
 *
 *   • 100 users is COMPULSORY — no salary without it, however many plans sold;
 *   • the salary unlocks only when BOTH targets are met;
 *   • short of that it is commission, for as much work as was actually done;
 *   • salary and commission are never both owed.
 */
import { describe, it, expect } from 'vitest';

import { DEFAULT_AMBASSADOR_SETTINGS as S, progress } from '../config';

/** Settings with a commission rate an admin has set, for the shortfall cases. */
const PAID = { ...S, commissionPerPartnerPkr: 1_000 };

describe('the owner’s targets', () => {
  it('is 100 users and 15 partners for PKR 50,000', () => {
    expect(S.userTarget).toBe(100);
    expect(S.partnerTarget).toBe(15);
    expect(S.salaryPkr).toBe(50_000);
  });

  it('counts down the way the dashboard reads: 99, 98, … and 14, 13, …', () => {
    expect(progress({ usersOnboarded: 1, partnersSold: 1 }, S).usersRemaining).toBe(99);
    expect(progress({ usersOnboarded: 3, partnersSold: 1 }, S).usersRemaining).toBe(97);
    expect(progress({ usersOnboarded: 1, partnersSold: 1 }, S).partnersRemaining).toBe(14);
    expect(progress({ usersOnboarded: 1, partnersSold: 2 }, S).partnersRemaining).toBe(13);
  });

  it('never counts below zero, or past the target', () => {
    const over = progress({ usersOnboarded: 250, partnersSold: 40 }, S);
    expect(over.usersRemaining).toBe(0);
    expect(over.partnersRemaining).toBe(0);
    // A counter corrected by hand can read negative; a dashboard must not.
    const under = progress({ usersOnboarded: -5, partnersSold: -2 }, S);
    expect(under.usersOnboarded).toBe(0);
    expect(under.partnersSold).toBe(0);
    expect(under.usersRemaining).toBe(100);
  });
});

describe('the salary', () => {
  it('unlocks only when BOTH targets are met', () => {
    expect(progress({ usersOnboarded: 100, partnersSold: 15 }, S).salaryUnlocked).toBe(true);
    expect(progress({ usersOnboarded: 100, partnersSold: 15 }, S).payPkr).toBe(50_000);
    expect(progress({ usersOnboarded: 100, partnersSold: 15 }, S).payKind).toBe('salary');
  });

  it('stays locked on 99 users, however many plans were sold', () => {
    // The 100 is compulsory: selling the whole year's partners does not buy it.
    const p = progress({ usersOnboarded: 99, partnersSold: 500 }, PAID);
    expect(p.userTargetMet).toBe(false);
    expect(p.salaryUnlocked).toBe(false);
    expect(p.payKind).toBe('commission');
  });

  it('stays locked on 14 partners, however many users were onboarded', () => {
    const p = progress({ usersOnboarded: 1_000, partnersSold: 14 }, PAID);
    expect(p.partnerTargetMet).toBe(false);
    expect(p.salaryUnlocked).toBe(false);
  });

  it('does not pay more for overshooting', () => {
    expect(progress({ usersOnboarded: 400, partnersSold: 90 }, PAID).payPkr).toBe(50_000);
  });
});

describe('the commission, when the targets are missed', () => {
  it('pays for as much work as was actually done', () => {
    expect(progress({ usersOnboarded: 50, partnersSold: 0 }, PAID).payPkr).toBe(0);
    expect(progress({ usersOnboarded: 50, partnersSold: 1 }, PAID).payPkr).toBe(1_000);
    expect(progress({ usersOnboarded: 50, partnersSold: 9 }, PAID).payPkr).toBe(9_000);
  });

  it('is never paid alongside the salary — one or the other, never both', () => {
    for (const [users, partners] of [
      [0, 0],
      [99, 14],
      [100, 14],
      [99, 15],
      [100, 15],
      [500, 500],
    ] as const) {
      const p = progress({ usersOnboarded: users, partnersSold: partners }, PAID);
      expect(p.payKind === 'salary').toBe(p.salaryUnlocked);
      // Whichever it is, it is a single figure — the other is not added to it.
      expect(p.payPkr).toBe(p.salaryUnlocked ? PAID.salaryPkr : partners * PAID.commissionPerPartnerPkr);
    }
  });

  it('says the rate is unset rather than quoting PKR 0 as a decision', () => {
    // Ships at zero until an admin sets it (ambassadors/config.ts), so a
    // shortfall must read "to be confirmed", never "we are paying you nothing".
    const unset = progress({ usersOnboarded: 50, partnersSold: 9 }, S);
    expect(unset.rateUnset).toBe(true);
    expect(unset.payPkr).toBe(0);
    // Once the rate exists it is a real figure, not a blank.
    expect(progress({ usersOnboarded: 50, partnersSold: 9 }, PAID).rateUnset).toBe(false);
  });

  it('never calls a met salary "unset", whatever the commission rate is', () => {
    expect(progress({ usersOnboarded: 100, partnersSold: 15 }, S).rateUnset).toBe(false);
  });
});

describe('a re-targeted ambassador', () => {
  it('is measured against the targets stored on their own document', () => {
    // An ambassador approved on different targets keeps them (the approval
    // snapshots them), so progress must honour what it is handed, not defaults.
    const theirs = { ...S, userTarget: 50, partnerTarget: 5 };
    const p = progress({ usersOnboarded: 50, partnersSold: 5 }, theirs);
    expect(p.salaryUnlocked).toBe(true);
    expect(progress({ usersOnboarded: 50, partnersSold: 5 }, S).salaryUnlocked).toBe(false);
  });
});
