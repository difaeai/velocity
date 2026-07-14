/**
 * Velocity Partner Program — the money rules.
 * ----------------------------------------------------------------------------
 * A partner earns a slice of the PLATFORM COMMISSION on rides run by people
 * they recruited. Never a slice of the fare. This distinction is the whole
 * economic safety of the program: the fare belongs to the driver, the
 * commission is Velocity's revenue, and a partner cut is Velocity choosing to
 * share its own revenue with whoever brought that driver or passenger in.
 *
 * So on a 1000 PKR ride with a 10% platform commission (= 100 PKR), a 1%
 * partner rate pays the partner 1 PKR — 1% of 100, NOT 1% of 1000. Everything
 * downstream of `partnerCut()` depends on being handed the commission, and the
 * caller is the only one who can get that wrong, so trips/index.ts passes
 * `settlement.commission` and nothing else.
 *
 * Velocity's own net is what survives after the franchise cut and both partner
 * cuts, and it is never allowed to go negative: `splitCommission()` pays out in
 * priority order and stops when the commission is exhausted.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';

export interface PartnerSettings {
  /** Fraction of PLATFORM COMMISSION paid to a driver's fleet owner. Default 1%. */
  driverFleetRate: number;
  /** Fraction of PLATFORM COMMISSION paid to a passenger's fleet owner. Default 1%. */
  passengerFleetRate: number;
  /** Smallest withdrawal a partner may request, in PKR. */
  minWithdrawal: number;
  /**
   * Hours a commission sits in `pending` before it matures into a withdrawable
   * balance. The hold is the fraud window: a ride reported as a scam inside it
   * is clawed back for free, because the money never became spendable.
   */
  holdHours: number;
  /** Referral codes only bind to accounts younger than this. See referrals.ts. */
  claimWindowHours: number;
}

export const DEFAULT_PARTNER_SETTINGS: PartnerSettings = {
  driverFleetRate: 0.01,
  passengerFleetRate: 0.01,
  minWithdrawal: 500,
  holdHours: 72,
  claimWindowHours: 72,
};

/** Clamp a rate into a sane band so a fat-fingered admin can't hand out 100%. */
function rate(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= 0.5 ? value : fallback;
}

/** Admin-configurable, from the dashboard Partner Program page. */
export async function getPartnerSettings(): Promise<PartnerSettings> {
  const snap = await db.doc('config/partnerSettings').get();
  const d = DEFAULT_PARTNER_SETTINGS;
  const minWithdrawal = snap.get('minWithdrawal') as unknown;
  const holdHours = snap.get('holdHours') as unknown;
  const claimWindowHours = snap.get('claimWindowHours') as unknown;

  return {
    driverFleetRate: rate(snap.get('driverFleetRate'), d.driverFleetRate),
    passengerFleetRate: rate(snap.get('passengerFleetRate'), d.passengerFleetRate),
    minWithdrawal:
      typeof minWithdrawal === 'number' && minWithdrawal >= 100 ? minWithdrawal : d.minWithdrawal,
    holdHours:
      typeof holdHours === 'number' && holdHours >= 0 && holdHours <= 720 ? holdHours : d.holdHours,
    claimWindowHours:
      typeof claimWindowHours === 'number' && claimWindowHours > 0 && claimWindowHours <= 8760
        ? claimWindowHours
        : d.claimWindowHours,
  };
}

/**
 * A partner's cut of one ride, in whole rupees.
 *
 * `platformCommission` — Velocity's commission on the ride. NOT the fare.
 */
export function partnerCut(platformCommission: number, fleetRate: number): number {
  if (!(platformCommission > 0) || !(fleetRate > 0)) return 0;
  return Math.round(platformCommission * fleetRate);
}

export interface CommissionSplit {
  /** Paid to the driver's fleet owner. */
  driverFleetCut: number;
  /** Paid to the passenger's fleet owner. */
  passengerFleetCut: number;
  /** What Velocity keeps after the franchise and both partner cuts. */
  velocityNet: number;
}

/**
 * Divide the platform commission between the franchise, the two fleet owners
 * and Velocity — paying in priority order and never overspending.
 *
 * The franchise is senior (it is an older, contractual arrangement, and its cut
 * is already computed by the caller), then the driver fleet, then the passenger
 * fleet. If commission runs out mid-way a later party is simply paid less, or
 * nothing. Velocity's net can reach zero but never goes below it.
 */
export function splitCommission(args: {
  platformCommission: number;
  franchiseCut: number;
  driverFleetRate: number | null;
  passengerFleetRate: number | null;
}): CommissionSplit {
  const { platformCommission, franchiseCut } = args;

  let remaining = Math.max(0, platformCommission - Math.max(0, franchiseCut));

  const driverFleetCut = Math.min(
    remaining,
    args.driverFleetRate ? partnerCut(platformCommission, args.driverFleetRate) : 0,
  );
  remaining -= driverFleetCut;

  const passengerFleetCut = Math.min(
    remaining,
    args.passengerFleetRate ? partnerCut(platformCommission, args.passengerFleetRate) : 0,
  );
  remaining -= passengerFleetCut;

  return { driverFleetCut, passengerFleetCut, velocityNet: remaining };
}
