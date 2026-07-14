/**
 * Velocity Partner Program — the money rules.
 * ----------------------------------------------------------------------------
 * A partner earns a slice of the PLATFORM COMMISSION on rides run by people
 * they recruited. Never a slice of the fare. This distinction is the whole
 * economic safety of the program: the fare belongs to the driver, the
 * commission is Velocity's revenue, and a partner cut is Velocity choosing to
 * share its own revenue with whoever brought that driver or passenger in.
 *
 * So on a 1000 PKR ride with a 10% platform commission (= 100 PKR), a 2% Pro
 * driver rate pays the partner 2 PKR — 2% of 100, NOT 2% of 1000. Everything
 * downstream of `partnerCut()` depends on being handed the commission, and the
 * caller is the only one who can get that wrong, so trips/index.ts passes
 * `settlement.commission` and nothing else.
 *
 * TIERS
 * -----
 * Free partners earn 0.5% on both fleets. Pro partners pay a one-off
 * registration fee and earn 2% on their driver fleet and 1.3% on their
 * passenger fleet. The tier is stamped on the partner document at approval and
 * read at settlement, so upgrading a partner changes what their NEXT ride pays
 * and never retroactively re-prices rides already settled.
 *
 * Velocity's own net is what survives after the franchise cut and both partner
 * cuts, and it is never allowed to go negative: `splitCommission()` pays out in
 * priority order and stops when the commission is exhausted.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';
import type { PartnerTier } from './types';

export interface TierRates {
  /** Fraction of PLATFORM COMMISSION paid to a driver's fleet owner. */
  driverFleetRate: number;
  /** Fraction of PLATFORM COMMISSION paid to a passenger's fleet owner. */
  passengerFleetRate: number;
}

export interface PartnerSettings {
  free: TierRates;
  pro: TierRates;
  /** One-off Pro registration fee, in `proFeeCurrency`. */
  proFee: number;
  proFeeCurrency: string;
  /** Where a Pro applicant sends the fee. Admin-set; shown on the apply screen. */
  payment: {
    bankName: string | null;
    bankAccount: string | null;
    easypaisaAccount: string | null;
    jazzcashAccount: string | null;
  };
  /** Smallest withdrawal a partner may request, in PKR. */
  minWithdrawal: number;
  /**
   * Hours a commission sits in `pending` before it matures into a withdrawable
   * balance. The hold is the fraud window: a ride reported as a scam inside it
   * is clawed back for free, because the money never became spendable.
   */
  holdHours: number;
}

export const DEFAULT_PARTNER_SETTINGS: PartnerSettings = {
  free: { driverFleetRate: 0.005, passengerFleetRate: 0.005 },
  pro: { driverFleetRate: 0.02, passengerFleetRate: 0.013 },
  proFee: 175,
  proFeeCurrency: 'USD',
  payment: {
    bankName: null,
    bankAccount: null,
    easypaisaAccount: null,
    jazzcashAccount: null,
  },
  minWithdrawal: 500,
  holdHours: 72,
};

/** Clamp a rate into a sane band so a fat-fingered admin can't hand out 100%. */
function rate(value: unknown, fallback: number): number {
  return typeof value === 'number' && value >= 0 && value <= 0.5 ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Admin-configurable, from the dashboard Partner Program page. */
export async function getPartnerSettings(): Promise<PartnerSettings> {
  const snap = await db.doc('config/partnerSettings').get();
  const d = DEFAULT_PARTNER_SETTINGS;

  const minWithdrawal = snap.get('minWithdrawal') as unknown;
  const holdHours = snap.get('holdHours') as unknown;
  const proFee = snap.get('proFee') as unknown;
  const payment = (snap.get('payment') as Record<string, unknown> | undefined) ?? {};

  return {
    free: {
      driverFleetRate: rate(snap.get('free.driverFleetRate'), d.free.driverFleetRate),
      passengerFleetRate: rate(snap.get('free.passengerFleetRate'), d.free.passengerFleetRate),
    },
    pro: {
      driverFleetRate: rate(snap.get('pro.driverFleetRate'), d.pro.driverFleetRate),
      passengerFleetRate: rate(snap.get('pro.passengerFleetRate'), d.pro.passengerFleetRate),
    },
    proFee: typeof proFee === 'number' && proFee >= 0 ? proFee : d.proFee,
    proFeeCurrency: str(snap.get('proFeeCurrency')) ?? d.proFeeCurrency,
    payment: {
      bankName: str(payment.bankName),
      bankAccount: str(payment.bankAccount),
      easypaisaAccount: str(payment.easypaisaAccount),
      jazzcashAccount: str(payment.jazzcashAccount),
    },
    minWithdrawal:
      typeof minWithdrawal === 'number' && minWithdrawal >= 100 ? minWithdrawal : d.minWithdrawal,
    holdHours:
      typeof holdHours === 'number' && holdHours >= 0 && holdHours <= 720 ? holdHours : d.holdHours,
  };
}

/** The rates a given tier earns. */
export function ratesForTier(settings: PartnerSettings, tier: PartnerTier): TierRates {
  return tier === 'pro' ? settings.pro : settings.free;
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
