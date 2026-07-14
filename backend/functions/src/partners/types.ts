/**
 * Partner Program — shared shapes and the level ladder.
 *
 * Levels are derived, never stored as an admin decision: `computeLevel()` runs
 * over a partner's lifetime stats every time those stats move, so a badge can
 * never drift out of sync with what the partner actually did.
 */

export type PartnerApplicationStatus = 'pending' | 'approved' | 'rejected' | 'resubmit';

/** `suspended` partners keep their history and stop earning. */
export type PartnerStatus = 'active' | 'suspended';

export type FleetType = 'driver' | 'passenger';

/**
 * The status of a ride as the partner sees it. Only `completed` ever pays.
 * `scam` and `fraud` are set by the fraud engine or an admin and force the cut
 * to zero — retroactively, if the money was already credited.
 */
export type PartnerRideStatus = 'completed' | 'cancelled' | 'scam' | 'fraud';

export type PartnerTxnStatus =
  /** Credited, still inside the fraud-hold window. Not withdrawable. */
  | 'pending'
  /** Hold elapsed, moved into the withdrawable balance. */
  | 'available'
  /** Reversed because the ride turned out to be fraudulent. */
  | 'reversed';

export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export type WithdrawalMethod = 'easypaisa' | 'jazzcash' | 'bank';

export type PartnerLevel = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface PartnerStats {
  /** Members who completed at least one ride in the last 30 days. */
  activeMembers: number;
  /** Lifetime completed rides across both fleets. */
  completedRides: number;
  /** Lifetime commission earned, PKR. */
  lifetimeEarnings: number;
  /** Rides flagged scam/fraud ÷ all rides. 0 when there are no rides yet. */
  scamRate: number;
  /** Distinct months with at least one completed ride — the consistency signal. */
  activeMonths: number;
}

interface LevelRule {
  level: PartnerLevel;
  minActiveMembers: number;
  minCompletedRides: number;
  minEarnings: number;
  minActiveMonths: number;
  /** A partner above this scam rate cannot hold the level, however big they are. */
  maxScamRate: number;
}

/**
 * Ordered best-first, so `computeLevel` returns the highest rung a partner
 * fully clears. Every threshold must be met — volume alone never buys a level,
 * and a partner running a scammy network is capped no matter their revenue.
 */
const LEVELS: LevelRule[] = [
  { level: 'diamond',  minActiveMembers: 200, minCompletedRides: 10000, minEarnings: 200000, minActiveMonths: 6, maxScamRate: 0.02 },
  { level: 'platinum', minActiveMembers: 100, minCompletedRides: 4000,  minEarnings: 75000,  minActiveMonths: 4, maxScamRate: 0.03 },
  { level: 'gold',     minActiveMembers: 40,  minCompletedRides: 1200,  minEarnings: 25000,  minActiveMonths: 3, maxScamRate: 0.05 },
  { level: 'silver',   minActiveMembers: 10,  minCompletedRides: 250,   minEarnings: 5000,   minActiveMonths: 2, maxScamRate: 0.08 },
  { level: 'bronze',   minActiveMembers: 0,   minCompletedRides: 0,     minEarnings: 0,      minActiveMonths: 0, maxScamRate: 1 },
];

export function computeLevel(stats: PartnerStats): PartnerLevel {
  for (const rule of LEVELS) {
    if (
      stats.activeMembers >= rule.minActiveMembers &&
      stats.completedRides >= rule.minCompletedRides &&
      stats.lifetimeEarnings >= rule.minEarnings &&
      stats.activeMonths >= rule.minActiveMonths &&
      stats.scamRate <= rule.maxScamRate
    ) {
      return rule.level;
    }
  }
  return 'bronze';
}

/** What the partner still needs for the next rung — drives the progress UI. */
export function nextLevelTarget(level: PartnerLevel): LevelRule | null {
  const idx = LEVELS.findIndex((l) => l.level === level);
  // LEVELS is best-first, so the next rung up is the entry BEFORE this one.
  return idx > 0 ? LEVELS[idx - 1] : null;
}

export const LEVEL_RULES = LEVELS;
