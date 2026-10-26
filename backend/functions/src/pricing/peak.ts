/**
 * The peak factor: what demand and supply are allowed to do to a fare.
 * ----------------------------------------------------------------------------
 * `fare/fareFunctions.ts` has read a multiplier from `surge/{cityId}_{zone}`
 * since the fare engine was written. Nothing ever wrote that document, so
 * `getZoneSurge` has returned its `catch`-and-default 1.0 for every ride
 * Velocity has ever priced. This module is the missing half.
 *
 * WHAT MAKES THIS DIFFERENT FROM SURGE AS RIDERS KNOW IT
 * ------------------------------------------------------
 * The brief was explicit: manage demand and supply, but never raise the fare by
 * much. So the engine's own ceiling is 1.25x and it is deliberately not the
 * city's — `fareConfig.surge.maxMultiplier` is 1.8, and both apply, so the
 * lower of the two always wins. A Rs.400 ride can reach Rs.500 on the worst
 * evening of the year and cannot reach Rs.720.
 *
 * Three further properties, each of which exists because of a way surge is
 * normally unpleasant:
 *
 *  · IT RAMPS. At most +0.05 a tick up, -0.10 a tick down. A rider who refreshes
 *    cannot be quoted 1.0 and then 1.25 — and when the rush breaks, the fare
 *    comes down twice as fast as it went up.
 *  · IT IGNORES QUIET ZONES. Two requests and one driver at 4am is a ratio of
 *    2.0, which would earn 1.18x on the bands. `minActivity` throws that away:
 *    a multiplier from a sample that small is a rider overcharged by noise.
 *  · IT CAN BE FROZEN. When `supplyIntegrity` sees scarcity that looks
 *    manufactured, the factor is pinned to what it was before the drop. See
 *    `freeze` below — it is the whole defence against drivers driving the price.
 *
 * Pure. One function of a sample, the previous value and the settings.
 * ----------------------------------------------------------------------------
 */
import type { PeakDecision, PeakSettings, ZoneSample } from './types';

/**
 * The factor the bands alone would give this ratio.
 *
 * Bands are ascending; a ratio past the final band gets that band's
 * multiplier rather than falling through to 1.0,
 * because "busier than our busiest band" is not a reason to stop charging for
 * it.
 */
export function bandFor(ratio: number, settings: PeakSettings): number {
  const bands = [...settings.bands].sort((a, b) => a.ratio - b.ratio);
  for (const band of bands) {
    if (ratio <= band.ratio) return band.multiplier;
  }
  return bands.at(-1)?.multiplier ?? 1;
}

/** Move `from` toward `to`, by no more than one tick's allowance. */
export function rampToward(from: number, to: number, settings: PeakSettings): number {
  if (to > from) return Math.min(to, from + settings.rampUpPerTick);
  if (to < from) return Math.max(to, from - settings.rampDownPerTick);
  return to;
}

export interface PeakInput {
  sample: ZoneSample;
  /** The factor this zone is currently advertising. Ramping starts here. */
  previousMultiplier: number;
  settings: PeakSettings;
  /**
   * Set while a suspected supply manipulation is being ignored: the factor the
   * zone had BEFORE drivers started disappearing, and when the hold expires.
   */
  freeze?: { multiplier: number; until: number } | null;
  now?: number;
}

/**
 * The factor this zone should advertise.
 *
 * Order matters and is the whole design: band, then freeze, then ramp, then
 * clamp. Freezing before ramping means the hold is on the TARGET, so a frozen
 * zone still drifts down smoothly rather than stepping. Clamping last means no
 * combination of settings can produce a factor above the ceiling.
 */
export function computePeakFactor(input: PeakInput): PeakDecision {
  const { sample, previousMultiplier, settings, freeze = null, now = Date.now() } = input;

  if (!settings.enabled) {
    return { multiplier: 1, targetMultiplier: 1, ratio: null, reason: 'disabled' };
  }

  const supply = Math.max(0, sample.availableDrivers);
  const demand = Math.max(0, sample.openRequests);
  const activity = supply + demand;

  // Too quiet to read. Ramped rather than snapped so a zone that empties out at
  // the end of the evening does not drop a rider's quote in one step.
  if (activity < settings.minActivity) {
    const multiplier = clamp(rampToward(previousMultiplier, 1, settings), settings);
    return { multiplier, targetMultiplier: 1, ratio: null, reason: 'low_activity' };
  }

  // No supply at all is the highest ratio there is, not a division by zero.
  const ratio = demand / Math.max(supply, 1);
  let target = bandFor(ratio, settings);
  let frozen = false;

  if (freeze && now < freeze.until) {
    // Hold at the pre-drop factor — but only ever downwards. If demand has
    // since fallen far enough that the honest factor is lower than the frozen
    // one, the rider gets the lower number. A freeze is there to deny a
    // manipulation its gain, not to license an old high price.
    target = Math.min(target, freeze.multiplier);
    frozen = true;
  }

  const ramped = rampToward(previousMultiplier, target, settings);
  const multiplier = clamp(ramped, settings);

  const reason: PeakDecision['reason'] = frozen
    ? 'frozen_supply_shock'
    : multiplier !== ramped
      ? 'capped'
      : ramped !== target
        ? 'ramped'
        : 'banded';

  return {
    multiplier,
    targetMultiplier: round2(target),
    ratio: Math.round(ratio * 100) / 100,
    reason,
    ...(frozen && freeze ? { frozenUntil: freeze.until } : {}),
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function clamp(value: number, settings: PeakSettings): number {
  const lo = Math.min(settings.minMultiplier, settings.maxMultiplier);
  const hi = Math.max(settings.minMultiplier, settings.maxMultiplier);
  return round2(Math.min(Math.max(value, lo), hi));
}

/**
 * What a rider is told, or nothing at all.
 *
 * Returns null at 1.0, which is most of the time, and the booking screen then
 * shows no badge rather than a reassuring "normal fares" label nobody asked
 * for. English only — the app's UI language is English and Urdu arrives through
 * i18n, never hard-coded here.
 */
export function riderPeakLabel(multiplier: number): string | null {
  if (multiplier <= 1.001) return null;
  if (multiplier < 1.06) return 'Busier than usual';
  if (multiplier < 1.13) return 'Busy right now';
  return 'Very busy right now';
}

/** The same state, from the driver's side, where it is good news. */
export function driverPeakLabel(multiplier: number): string | null {
  if (multiplier <= 1.001) return null;
  const pct = Math.round((multiplier - 1) * 100);
  return `High demand — fares ${pct}% higher here`;
}

/**
 * The honest sentence about why a fare moved, for the fare breakdown.
 *
 * A rider who is being charged more is owed the reason in the same place as the
 * number, not in a help article.
 */
export function explainPeak(decision: PeakDecision): string | null {
  if (decision.multiplier <= 1.001) return null;
  const pct = Math.round((decision.multiplier - 1) * 100);
  if (decision.ratio === null) return `Peak demand: +${pct}%`;
  return `More riders than available cars nearby right now: +${pct}%`;
}
