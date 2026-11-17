/**
 * Velocity Ambassador Program — the targets and the money.
 * ----------------------------------------------------------------------------
 * The owner's brief (2026-11-18): an ambassador is the third way into "Earn
 * with Velocity", and the only one you do not buy. They apply, an admin
 * approves them, and then they work two targets:
 *
 *   100 users   installed the app and put the ambassador's code in their
 *               profile. COMPULSORY — the salary does not unlock without it.
 *    15 partners one of those users went on to buy an Earn with Velocity plan
 *               (either tier) on the same code.
 *
 * Hit both and the salary unlocks: PKR 50,000. Fall short and they are paid
 * commission instead, for as much of the work as they actually did — and that
 * commission exists ONLY on the Earn with Velocity travel program, never on
 * anything else Velocity sells.
 *
 * SALARY *OR* COMMISSION, NEVER BOTH
 * ----------------------------------
 * This is the one rule the whole file exists to hold. `earnings()` returns one
 * or the other from a single branch, so there is no arrangement of targets that
 * pays a salary and a commission for the same month. An ambassador who hits
 * both targets is a salaried ambassador; one who does not is a commissioned
 * one. The figure shown on their dashboard and the figure an admin pays are the
 * same function.
 *
 * WHY THE RATE IS A CONFIG AND NOT A CONSTANT
 * -------------------------------------------
 * `commissionPerPartnerPkr` is real money leaving the business per sale, and
 * the owner has not named a figure. It therefore ships at zero: an ambassador
 * who misses the targets is shown "to be confirmed" rather than a number this
 * file invented, and an admin sets the rate in the Ambassadors desk before
 * anybody is paid. A wrong number here would be quoted to a person as a
 * promise, which is worse than an honest blank.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';

export interface AmbassadorSettings {
  /** App installs that put this ambassador's code in their profile. Compulsory. */
  userTarget: number;
  /** Of those, how many must buy an Earn with Velocity plan. */
  partnerTarget: number;
  /** Paid in full only when BOTH targets are met, in rupees. */
  salaryPkr: number;
  /**
   * What one Earn with Velocity sale pays an ambassador who misses the targets,
   * in rupees. Zero until an admin sets it — see the note above.
   */
  commissionPerPartnerPkr: number;
  /** Shown on the apply screen so nobody applies without knowing the deal. */
  currency: string;
}

export const DEFAULT_AMBASSADOR_SETTINGS: AmbassadorSettings = {
  userTarget: 100,
  partnerTarget: 15,
  salaryPkr: 50_000,
  commissionPerPartnerPkr: 0,
  currency: 'PKR',
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * The admin-configured targets, falling back field by field — a half-written
 * config document must still produce a usable set of targets, never a zero one.
 * A `userTarget` of zero would mean every ambassador has already met it.
 */
export async function getAmbassadorSettings(): Promise<AmbassadorSettings> {
  const d = DEFAULT_AMBASSADOR_SETTINGS;
  const snap = await db.doc('config/ambassadorSettings').get();
  if (!snap.exists) return d;
  return {
    userTarget: Math.round(num(snap.get('userTarget'), d.userTarget, 1, 100_000)),
    partnerTarget: Math.round(num(snap.get('partnerTarget'), d.partnerTarget, 1, 100_000)),
    salaryPkr: Math.round(num(snap.get('salaryPkr'), d.salaryPkr, 0, 100_000_000)),
    commissionPerPartnerPkr: Math.round(
      num(snap.get('commissionPerPartnerPkr'), d.commissionPerPartnerPkr, 0, 10_000_000),
    ),
    currency: typeof snap.get('currency') === 'string' ? (snap.get('currency') as string) : d.currency,
  };
}

export interface AmbassadorProgress {
  usersOnboarded: number;
  partnersSold: number;
  usersRemaining: number;
  partnersRemaining: number;
  /** The compulsory one. Without it there is no salary, whatever else is true. */
  userTargetMet: boolean;
  partnerTargetMet: boolean;
  /** Both met. The only state in which a salary is owed. */
  salaryUnlocked: boolean;
  /** What is owed right now, in rupees. */
  payPkr: number;
  /** Which of the two the `payPkr` figure is. */
  payKind: 'salary' | 'commission';
  /**
   * True when the commission rate has not been set yet, so `payPkr` is 0
   * because nobody has decided the rate — not because no work was done. The UI
   * says "to be confirmed" rather than "PKR 0", which would read as a refusal.
   */
  rateUnset: boolean;
}

/**
 * Where an ambassador stands, and what they are owed.
 *
 * Counts are clamped at zero rather than trusted: they are stored as
 * `FieldValue.increment` counters, and a counter that has been corrected by
 * hand can briefly read negative. "-3 users onboarded" on somebody's own
 * dashboard is worse than a floor.
 */
export function progress(
  counts: { usersOnboarded?: number; partnersSold?: number },
  s: AmbassadorSettings,
): AmbassadorProgress {
  const usersOnboarded = Math.max(0, Math.floor(counts.usersOnboarded ?? 0));
  const partnersSold = Math.max(0, Math.floor(counts.partnersSold ?? 0));

  const userTargetMet = usersOnboarded >= s.userTarget;
  const partnerTargetMet = partnersSold >= s.partnerTarget;
  // The 100 is compulsory (owner), so it is an AND and the user half can never
  // be bought out by over-performing on the other.
  const salaryUnlocked = userTargetMet && partnerTargetMet;

  return {
    usersOnboarded,
    partnersSold,
    usersRemaining: Math.max(0, s.userTarget - usersOnboarded),
    partnersRemaining: Math.max(0, s.partnerTarget - partnersSold),
    userTargetMet,
    partnerTargetMet,
    salaryUnlocked,
    // One branch, so a salary and a commission can never both be owed.
    payPkr: salaryUnlocked
      ? s.salaryPkr
      : partnersSold * s.commissionPerPartnerPkr,
    payKind: salaryUnlocked ? 'salary' : 'commission',
    rateUnset: !salaryUnlocked && s.commissionPerPartnerPkr === 0,
  };
}
