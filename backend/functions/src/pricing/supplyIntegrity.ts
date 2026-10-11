/**
 * Telling real scarcity apart from manufactured scarcity.
 * ----------------------------------------------------------------------------
 * THE ATTACK
 * ----------
 * A hundred drivers are online. Fifty of them agree — in a WhatsApp group, in a
 * car park, it does not matter — to go offline at once. Supply halves, the peak
 * factor climbs, and they come back to collect the higher fare. Nobody worked
 * more, nobody drove further, and the rider paid for a shortage that was staged.
 *
 * Any engine that reads supply off "how many drivers are online" is exposed to
 * this, and ours is such an engine. So the factor is not a pure function of
 * current supply. It is a function of supply the engine BELIEVES, and this file
 * decides what to believe.
 *
 * THE SHAPE, AND WHY IT IS DISTINGUISHABLE
 * ----------------------------------------
 * Four tests, all of which a staged drop passes and ordinary evenings fail:
 *
 *  1. SIZE. The fall has to be big — `dropPct` of the window's baseline. Normal
 *     churn is a few drivers either way.
 *  2. SUDDENNESS. It has to happen within `maxSuddenSamples` ticks. Drivers
 *     finishing a shift leave over an hour; a coordinated walk-out lands inside
 *     two minutes. This is the test that does most of the work.
 *  3. DEMAND HELD. If riders left at the same time as the drivers, nothing is
 *     being staged — that is a city going to sleep, and the factor should fall,
 *     not freeze.
 *  4. SCALE. Below `minSupplyForShock` drivers, percentages are meaningless.
 *     Three drivers becoming one is not a conspiracy.
 *
 * WHAT HAPPENS WHEN IT FIRES
 * --------------------------
 * The factor is pinned to its pre-drop value for `freezeMinutes` (see
 * `peak.ts`, which takes the freeze as an input). The attack's entire payoff is
 * the higher factor, so denying the factor removes the incentive without
 * punishing anybody: a driver who genuinely stopped for the evening is not
 * accused of anything, and a driver who was never offline is unaffected.
 *
 * The return is recorded too. Coming back inside `returnWindowSec` of a shock
 * is the other half of the pattern, and `markOpportunisticReturn` notes it
 * against the driver so that a repeat pattern is visible to the admin desk
 * rather than having to be noticed by somebody.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It does not ban, fine or suspend. A false positive here is a driver losing
 * income over a tunnel with no signal, and the evidence — "several drivers went
 * offline at once" — is far too weak for that. It freezes a price and writes a
 * note. Everything stronger stays a human decision.
 * ----------------------------------------------------------------------------
 */
import type { IntegritySettings, SupplyShock, ZoneSample } from './types';

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const NO_SHOCK = (
  reason: SupplyShock['reason'],
  baselineSupply = 0,
  currentSupply = 0,
  droppedPct = 0,
  overSamples = 0,
): SupplyShock => ({
  suspicious: false,
  baselineSupply,
  currentSupply,
  droppedPct,
  overSamples,
  reason,
});

/**
 * Does this zone's recent history look like a staged shortage?
 *
 * `samples` is oldest-first; the last element is now. Reads `onlineDrivers`
 * rather than `availableDrivers` on purpose — the attack is drivers going
 * OFFLINE, whereas availability also falls when drivers pick up passengers,
 * which is exactly the healthy busy-ness the factor is supposed to price.
 */
export function detectSupplyShock(
  samples: ZoneSample[],
  settings: IntegritySettings,
  now: number = Date.now(),
): SupplyShock {
  if (!settings.enabled) return NO_SHOCK('none');

  const window = samples
    .filter((s) => now - s.at <= settings.lookbackSec * 1000)
    .sort((a, b) => a.at - b.at);

  const current = window.at(-1);
  // The baseline needs samples that predate the fall, so the window has to be
  // longer than the fall it is judging.
  const head = window.slice(0, Math.max(0, window.length - settings.maxSuddenSamples));
  if (!current || window.length < settings.maxSuddenSamples + 2 || head.length === 0) {
    return NO_SHOCK('insufficient_history');
  }

  const baselineSupply = median(head.map((s) => s.onlineDrivers));
  const currentSupply = current.onlineDrivers;

  if (baselineSupply < settings.minSupplyForShock) {
    return NO_SHOCK('too_few_drivers', baselineSupply, currentSupply);
  }

  const droppedPct = (baselineSupply - currentSupply) / baselineSupply;
  if (droppedPct < settings.dropPct) {
    return NO_SHOCK('none', baselineSupply, currentSupply, Math.max(0, round3(droppedPct)));
  }

  // How long the fall took. Walk back to the last sample still at roughly
  // baseline level; everything after it is the transition. A fall that took
  // longer than `maxSuddenSamples` ticks is a shift ending.
  const atBaseline = baselineSupply * (1 - settings.dropPct / 2);
  let overSamples = 0;
  for (let i = window.length - 1; i >= 0; i--) {
    if (window[i]!.onlineDrivers >= atBaseline) break;
    overSamples++;
  }
  if (overSamples > settings.maxSuddenSamples) {
    return NO_SHOCK('gradual', baselineSupply, currentSupply, round3(droppedPct), overSamples);
  }

  // Did the riders leave too? Then nothing is being staged.
  const baselineDemand = median(head.map((s) => s.openRequests));
  if (baselineDemand > 0 && current.openRequests < baselineDemand * 0.5) {
    return NO_SHOCK('demand_fell', baselineSupply, currentSupply, round3(droppedPct), overSamples);
  }

  return {
    suspicious: true,
    baselineSupply,
    currentSupply,
    droppedPct: round3(droppedPct),
    overSamples,
    reason: 'sudden_drop',
    detectedAt: now,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The factor to hold, and until when.
 *
 * `preShockMultiplier` is what the zone was advertising before supply fell —
 * the number the attack was trying to move. Holding there is what makes going
 * offline pointless.
 */
export function freezeFor(
  shock: SupplyShock,
  preShockMultiplier: number,
  settings: IntegritySettings,
  now: number = Date.now(),
): { multiplier: number; until: number } | null {
  if (!shock.suspicious) return null;
  return {
    multiplier: preShockMultiplier,
    until: now + settings.freezeMinutes * 60 * 1000,
  };
}

// ── Per-driver churn ────────────────────────────────────────────────────────

export interface PresenceEvent {
  at: number;
  /** True when this event put the driver online. */
  online: boolean;
}

export interface ChurnVerdict {
  /** Completed offline→online round trips inside the window. */
  cycles: number;
  flagged: boolean;
  /** True when a return landed inside a shock's return window. */
  opportunistic: boolean;
}

/**
 * How much a single driver has been flapping, and whether a return of theirs
 * coincided with a suspected shortage.
 *
 * A driver with one offline spell in an hour is having lunch. A driver with six
 * is either on terrible signal or is working the queue, and the two look
 * identical from here — which is exactly why the only consequences are the
 * queue position they already forfeited and a note for a human.
 */
export function churnVerdict(
  events: PresenceEvent[],
  settings: IntegritySettings,
  lastShockAt: number | null,
  now: number = Date.now(),
): ChurnVerdict {
  const hourAgo = now - 60 * 60 * 1000;
  const recent = events.filter((e) => e.at >= hourAgo).sort((a, b) => a.at - b.at);

  let cycles = 0;
  let sawOffline = false;
  let opportunistic = false;

  for (const event of recent) {
    if (!event.online) {
      sawOffline = true;
      continue;
    }
    if (sawOffline) {
      cycles++;
      sawOffline = false;
      if (
        lastShockAt !== null &&
        event.at >= lastShockAt &&
        event.at - lastShockAt <= settings.returnWindowSec * 1000
      ) {
        opportunistic = true;
      }
    }
  }

  return { cycles, flagged: cycles > settings.maxCyclesPerHour, opportunistic };
}

/** Keeps a driver's presence log bounded — the last `max` events, newest kept. */
export function trimPresenceEvents(events: PresenceEvent[], max = 40): PresenceEvent[] {
  return [...events].sort((a, b) => a.at - b.at).slice(-max);
}

/**
 * One line for the admin desk explaining what the engine decided and why.
 *
 * Written for somebody who has just been asked "why is Blue Area still at 1.0
 * when every driver says it is mad out there".
 */
export function describeShock(shock: SupplyShock): string {
  switch (shock.reason) {
    case 'sudden_drop':
      return `Supply fell ${Math.round(shock.droppedPct * 100)}% (${shock.baselineSupply} → ${shock.currentSupply} drivers) within ${shock.overSamples} tick(s) while demand held. Peak factor frozen.`;
    case 'gradual':
      return `Supply fell ${Math.round(shock.droppedPct * 100)}% but over ${shock.overSamples} ticks — treated as a shift ending, not a walk-out.`;
    case 'demand_fell':
      return 'Drivers and riders both went quiet together — a normal lull, no freeze.';
    case 'too_few_drivers':
      return `Only ${shock.baselineSupply} drivers in this zone — too few for a percentage to mean anything.`;
    case 'insufficient_history':
      return 'Not enough recent samples for this zone yet.';
    default:
      return 'Supply is stable.';
  }
}
