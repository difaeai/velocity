/**
 * "How close am I to today's PKR 2,000?" — the driver's side of the daily target.
 *
 * Pure, and a deliberate mirror of the backend. TWO implementations of this rule
 * exist and they must agree:
 *
 *   · here — what the progress card and the earnings screen show;
 *   · backend/functions/src/domain/dailyTarget.ts — what actually decides
 *     whether the bonus is paid and whether the day's commission is waived.
 *
 * The app does not get a vote. It reads the same day document the backend
 * writes (`drivers/{uid}/dailyTargets/{YYYY-MM-DD}`) and the same admin settings
 * the backend reads (`config/commissionSettings`), and recomputes the same
 * answer so the card moves the instant a ride completes instead of waiting on a
 * round trip. If the two ever disagree, the backend is right and this is the
 * bug — which is why the shapes and the field names are kept identical rather
 * than "adapted for the client".
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
  dailyTargetBonus: number;
  dailyTargetWaivesCommission: boolean;
  dailyTargetMinRideFare: number;
  dailyTargetMinRiders: number;
  dailyTargetMinDayFare: number;
}

export const DEFAULT_DAILY_TARGET: DailyTargetSettings = {
  dailyTargetEnabled: true,
  dailyTargetRides: 15,
  dailyTargetBonus: 2000,
  dailyTargetWaivesCommission: true,
  dailyTargetMinRideFare: 150,
  dailyTargetMinRiders: 5,
  dailyTargetMinDayFare: 2500,
};

/** One driver-day, as the backend writes it. */
export interface DailyTargetDay {
  day: string;
  rides: number;
  qualifyingRides: number;
  grossFare: number;
  cashFare: number;
  riderIds: string[];
  bonusGranted: number;
  waiverGranted: number;
}

export function emptyDay(day: string): DailyTargetDay {
  return {
    day,
    rides: 0,
    qualifyingRides: 0,
    grossFare: 0,
    cashFare: 0,
    riderIds: [],
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
  const blockers: TargetBlocker[] = [];

  if (day.qualifyingRides < target) {
    blockers.push({
      key: 'rides',
      label:
        settings.dailyTargetMinRideFare > 0
          ? `${target} rides of PKR ${settings.dailyTargetMinRideFare}+`
          : `${target} rides`,
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

  const granted = day.bonusGranted > 0;
  const met = blockers.length === 0;
  return {
    day: day.day,
    enabled: settings.dailyTargetEnabled,
    rides: day.qualifyingRides,
    target,
    ridesToGo: Math.max(0, target - day.qualifyingRides),
    bonus: Math.round(settings.dailyTargetBonus),
    met,
    granted,
    blockers,
    commissionWaived:
      settings.dailyTargetEnabled && settings.dailyTargetWaivesCommission && (met || granted),
  };
}
