/**
 * "How many pool rides left before today is free?" — the driver's side of the
 * daily target.
 *
 * Pure, and a deliberate mirror of the backend. TWO implementations of this rule
 * exist and they must agree:
 *
 *   · here — what the progress card and the earnings screen show;
 *   · backend/functions/src/domain/dailyTarget.ts — what actually decides
 *     whether the day's commission is waived.
 *
 * The app does not get a vote. It reads the same day document the backend
 * writes (`drivers/{uid}/dailyTargets/{YYYY-MM-DD}`) and the same admin settings
 * the backend reads (`config/commissionSettings`), and recomputes the same
 * answer so the card moves the instant a ride completes instead of waiting on a
 * round trip. If the two ever disagree, the backend is right and this is the
 * bug — which is why the shapes and the field names are kept identical rather
 * than "adapted for the client".
 *
 * THE DEAL, as the driver experiences it: sixteen pool rides in one Pakistan day
 * and that whole day costs no commission. Fewer, and the day owes 5% of the cash
 * it took — payable at midnight, and nothing new can be accepted until it is
 * cleared. There is no separate cash bonus; the free day is the reward.
 */

/** Pakistan Standard Time, UTC+05:00. No DST. Mirrors the backend. */
const PKT_OFFSET_MS = 5 * 60 * 60_000;

/** Today in the driver's own timezone, as `YYYY-MM-DD`. */
export function pktDayKey(at: Date = new Date()): string {
  return new Date(at.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Admin-set shape of the incentive, from config/commissionSettings. */
export interface DailyTargetSettings {
  dailyTargetEnabled: boolean;
  dailyTargetRides: number;
  /** Cash bonus on top of the free day. 0 by default — see the file header. */
  dailyTargetBonus: number;
  dailyTargetWaivesCommission: boolean;
  /** Only pool / sharing rides count toward the target. */
  dailyTargetPoolOnly: boolean;
  dailyTargetMinRideFare: number;
  dailyTargetMinRiders: number;
  dailyTargetMinDayFare: number;
}

export const DEFAULT_DAILY_TARGET: DailyTargetSettings = {
  dailyTargetEnabled: true,
  dailyTargetRides: 16,
  dailyTargetBonus: 0,
  dailyTargetWaivesCommission: true,
  dailyTargetPoolOnly: true,
  dailyTargetMinRideFare: 150,
  dailyTargetMinRiders: 5,
  dailyTargetMinDayFare: 2000,
};

/** One driver-day, as the backend writes it. */
export interface DailyTargetDay {
  day: string;
  rides: number;
  poolRides: number;
  qualifyingRides: number;
  grossFare: number;
  cashFare: number;
  riderIds: string[];
  granted: boolean;
  bonusGranted: number;
  waiverGranted: number;
}

export function emptyDay(day: string): DailyTargetDay {
  return {
    day,
    rides: 0,
    poolRides: 0,
    qualifyingRides: 0,
    grossFare: 0,
    cashFare: 0,
    riderIds: [],
    granted: false,
    bonusGranted: 0,
    waiverGranted: 0,
  };
}

export interface TargetBlocker {
  key: 'rides' | 'riders' | 'dayFare';
  label: string;
  have: number;
  need: number;
}

export interface DailyTargetProgress {
  day: string;
  enabled: boolean;
  rides: number;
  target: number;
  ridesToGo: number;
  poolOnly: boolean;
  bonus: number;
  met: boolean;
  granted: boolean;
  blockers: TargetBlocker[];
  commissionWaived: boolean;
}

/** Where the day stands. Mirrors `dailyTargetProgress` on the backend exactly. */
export function dailyTargetProgress(
  day: DailyTargetDay,
  settings: DailyTargetSettings,
): DailyTargetProgress {
  const target = Math.max(1, Math.round(settings.dailyTargetRides));
  const poolOnly = settings.dailyTargetPoolOnly;
  const blockers: TargetBlocker[] = [];

  if (day.qualifyingRides < target) {
    const kind = poolOnly ? 'pool rides' : 'rides';
    blockers.push({
      key: 'rides',
      label:
        settings.dailyTargetMinRideFare > 0
          ? `${target} ${kind} of PKR ${settings.dailyTargetMinRideFare}+`
          : `${target} ${kind}`,
      have: day.qualifyingRides,
      need: target,
    });
  }
  if (settings.dailyTargetMinRiders > 0 && day.riderIds.length < settings.dailyTargetMinRiders) {
    blockers.push({
      key: 'riders',
      label: `${settings.dailyTargetMinRiders} different passengers`,
      have: day.riderIds.length,
      need: settings.dailyTargetMinRiders,
    });
  }
  if (settings.dailyTargetMinDayFare > 0 && day.grossFare < settings.dailyTargetMinDayFare) {
    blockers.push({
      key: 'dayFare',
      label: `PKR ${settings.dailyTargetMinDayFare.toLocaleString()} in fares`,
      have: Math.round(day.grossFare),
      need: settings.dailyTargetMinDayFare,
    });
  }

  const granted = day.granted || day.bonusGranted > 0;
  const met = blockers.length === 0;
  return {
    day: day.day,
    enabled: settings.dailyTargetEnabled,
    rides: day.qualifyingRides,
    target,
    ridesToGo: Math.max(0, target - day.qualifyingRides),
    poolOnly,
    bonus: Math.round(settings.dailyTargetBonus),
    met,
    granted,
    blockers,
    commissionWaived:
      settings.dailyTargetEnabled && settings.dailyTargetWaivesCommission && (met || granted),
  };
}
