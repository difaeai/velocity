/**
 * Partner commission maths.
 *
 * The rule under test, and the one thing this program can never get wrong: a
 * fleet owner is paid a percentage of the PLATFORM COMMISSION, not of the fare.
 * A 1% partner rate on a 1000 PKR ride carrying a 10% (100 PKR) commission pays
 * 1 PKR — not 10. Getting this backwards would pay partners ten times what the
 * business earns on the ride.
 */
import { describe, it, expect } from 'vitest';

import { partnerCut, ratesForTier, splitCommission, DEFAULT_PARTNER_SETTINGS } from '../config';
import { computeLevel } from '../types';
import type { PartnerStats } from '../types';

describe('partnerCut', () => {
  it('takes its percentage from the commission, never from the fare', () => {
    // 1000 PKR fare, 10% platform commission = 100 PKR commission.
    const platformCommission = 100;
    // 1% of the COMMISSION is 1 PKR. 1% of the FARE would be 10 — the bug.
    expect(partnerCut(platformCommission, 0.01)).toBe(1);
    expect(partnerCut(platformCommission, 0.01)).not.toBe(partnerCut(1000, 0.01));
  });

  it('rounds to whole rupees', () => {
    expect(partnerCut(155, 0.01)).toBe(2); // 1.55 → 2
    expect(partnerCut(144, 0.01)).toBe(1); // 1.44 → 1
  });

  it('pays nothing on a zero or negative commission', () => {
    expect(partnerCut(0, 0.01)).toBe(0);
    expect(partnerCut(-50, 0.01)).toBe(0);
  });
});

describe('splitCommission', () => {
  const base = { platformCommission: 1000, franchiseCut: 0 };

  it('pays both fleets out of the commission and leaves the rest to Velocity', () => {
    const s = splitCommission({ ...base, driverFleetRate: 0.01, passengerFleetRate: 0.01 });
    expect(s.driverFleetCut).toBe(10);
    expect(s.passengerFleetCut).toBe(10);
    expect(s.velocityNet).toBe(980);
    // Nothing is created or destroyed.
    expect(s.driverFleetCut + s.passengerFleetCut + s.velocityNet).toBe(1000);
  });

  it('pays only the side that has a fleet behind it', () => {
    const s = splitCommission({ ...base, driverFleetRate: 0.01, passengerFleetRate: null });
    expect(s.driverFleetCut).toBe(10);
    expect(s.passengerFleetCut).toBe(0);
    expect(s.velocityNet).toBe(990);
  });

  it('takes the franchise cut before either fleet', () => {
    const s = splitCommission({
      platformCommission: 1000,
      franchiseCut: 300,
      driverFleetRate: 0.01,
      passengerFleetRate: 0.01,
    });
    expect(s.driverFleetCut).toBe(10);
    expect(s.passengerFleetCut).toBe(10);
    // 1000 − 300 franchise − 10 − 10 = 680
    expect(s.velocityNet).toBe(680);
  });

  it('never drives Velocity negative, however the rates are set', () => {
    // A franchise that has eaten the whole commission leaves nothing to share.
    const eaten = splitCommission({
      platformCommission: 100,
      franchiseCut: 100,
      driverFleetRate: 0.5,
      passengerFleetRate: 0.5,
    });
    expect(eaten.driverFleetCut).toBe(0);
    expect(eaten.passengerFleetCut).toBe(0);
    expect(eaten.velocityNet).toBe(0);

    // Max rates on both sides still cannot overspend the pot.
    const maxed = splitCommission({
      platformCommission: 100,
      franchiseCut: 60,
      driverFleetRate: 0.5,
      passengerFleetRate: 0.5,
    });
    expect(maxed.velocityNet).toBeGreaterThanOrEqual(0);
    expect(maxed.driverFleetCut + maxed.passengerFleetCut).toBeLessThanOrEqual(40);
  });

  it('pays the driver fleet first when the commission runs out mid-split', () => {
    // 10 PKR left after the franchise; each fleet wants 50% of 100 = 50.
    const s = splitCommission({
      platformCommission: 100,
      franchiseCut: 90,
      driverFleetRate: 0.5,
      passengerFleetRate: 0.5,
    });
    expect(s.driverFleetCut).toBe(10);
    expect(s.passengerFleetCut).toBe(0);
    expect(s.velocityNet).toBe(0);
  });

});

describe('tiers', () => {
  const s = DEFAULT_PARTNER_SETTINGS;

  it('ships free at 0.5% on both fleets', () => {
    expect(s.free.driverFleetRate).toBe(0.005);
    expect(s.free.passengerFleetRate).toBe(0.005);
  });

  it('ships Pro at 2% driver / 1.3% passenger behind a Rs 50,000 fee', () => {
    expect(s.pro.driverFleetRate).toBe(0.02);
    expect(s.pro.passengerFleetRate).toBe(0.013);
    expect(s.proFee).toBe(50000);
    expect(s.proFeeCurrency).toBe('PKR');
  });

  it('every tier rate is still a slice of the COMMISSION, not the fare', () => {
    // Rs 1,000 ride, 10% platform commission = Rs 100.
    const commission = 100;
    expect(partnerCut(commission, s.free.driverFleetRate)).toBe(1); // 0.5% of 100 → 0.5, rounds to 1
    expect(partnerCut(commission, s.pro.driverFleetRate)).toBe(2); // 2% of 100
    expect(partnerCut(commission, s.pro.passengerFleetRate)).toBe(1); // 1.3% of 100 → 1.3, rounds to 1

    // The fare-based numbers — what this must never pay — are an order of
    // magnitude bigger.
    expect(partnerCut(1000, s.pro.driverFleetRate)).toBe(20);
    expect(partnerCut(commission, s.pro.driverFleetRate)).not.toBe(20);
  });

  it('prices a Pro driver fleet above a free one on the same ride', () => {
    const pro = splitCommission({
      platformCommission: 1000,
      franchiseCut: 0,
      driverFleetRate: ratesForTier(s, 'pro').driverFleetRate,
      passengerFleetRate: null,
    });
    const free = splitCommission({
      platformCommission: 1000,
      franchiseCut: 0,
      driverFleetRate: ratesForTier(s, 'free').driverFleetRate,
      passengerFleetRate: null,
    });
    expect(pro.driverFleetCut).toBe(20);
    expect(free.driverFleetCut).toBe(5);
    expect(pro.velocityNet).toBe(980);
    expect(free.velocityNet).toBe(995);
  });

  it('pays each side at its own partner’s tier on the same ride', () => {
    // A Pro partner recruited the driver; a free partner recruited the rider.
    const split = splitCommission({
      platformCommission: 1000,
      franchiseCut: 0,
      driverFleetRate: ratesForTier(s, 'pro').driverFleetRate,
      passengerFleetRate: ratesForTier(s, 'free').passengerFleetRate,
    });
    expect(split.driverFleetCut).toBe(20); // 2%
    expect(split.passengerFleetCut).toBe(5); // 0.5%
    expect(split.velocityNet).toBe(975);
  });
});

describe('computeLevel', () => {
  const bronze: PartnerStats = {
    activeMembers: 0,
    completedRides: 0,
    lifetimeEarnings: 0,
    scamRate: 0,
    activeMonths: 0,
  };

  it('starts every partner at bronze', () => {
    expect(computeLevel(bronze)).toBe('bronze');
  });

  it('promotes on every threshold being met at once', () => {
    expect(
      computeLevel({
        activeMembers: 10,
        completedRides: 250,
        lifetimeEarnings: 5000,
        scamRate: 0.01,
        activeMonths: 2,
      }),
    ).toBe('silver');
  });

  it('does not promote on volume alone when a threshold is missed', () => {
    // Gold money and gold rides, but only silver's member count.
    expect(
      computeLevel({
        activeMembers: 11,
        completedRides: 5000,
        lifetimeEarnings: 100000,
        scamRate: 0,
        activeMonths: 6,
      }),
    ).toBe('silver');
  });

  it('caps a scammy partner however large they are', () => {
    // Diamond on every count except that a fifth of their rides are fraud.
    expect(
      computeLevel({
        activeMembers: 500,
        completedRides: 50000,
        lifetimeEarnings: 1_000_000,
        scamRate: 0.2,
        activeMonths: 12,
      }),
    ).toBe('bronze');
  });
});
