/**
 * The Pricing Engine's settings, and the shapes it persists.
 * ----------------------------------------------------------------------------
 * WHAT THIS ENGINE IS FOR
 * -----------------------
 * Four jobs that used to be done by hand, or not at all:
 *
 *  1. FUEL. The Government of Pakistan re-notifies petrol and diesel prices on
 *     its own schedule, and every one of those notifications changes what a
 *     kilometre costs a driver. Nobody can hand-edit `fareConfig/{cityId}` the
 *     morning after each one, so until now it did not get edited — the driver
 *     absorbed the increase. `pricing/fuel.ts` reads the notified price every
 *     day and moves the per-kilometre rates with it.
 *
 *  2. PEAK. `fare/fareFunctions.ts` has always read a demand multiplier from
 *     `surge/{cityId}_{zone}`, and nothing in this repository has ever written
 *     that document — so the multiplier was 1.0 for every ride ever taken on
 *     Velocity. `pricing/peak.ts` computes it from real demand and supply.
 *
 *  3. INTEGRITY. A multiplier driven by how many drivers are online is a
 *     multiplier drivers can drive. If fifty of a hundred go offline together,
 *     wait for the price to rise and come back, the engine has been played and
 *     the rider pays for it. `pricing/supplyIntegrity.ts` detects that shape
 *     and freezes the factor instead of rewarding it.
 *
 *  4. FAIRNESS. Requests were broadcast to every nearby driver at once, sorted
 *     by distance, first tap wins. That is a race, and a race is why drivers
 *     sit on the app all day — the reward goes to whoever is staring at the
 *     screen, not whoever has been waiting longest. `pricing/driverQueue.ts`
 *     serves them in the order they came online.
 *
 * WHERE THE NUMBERS LIVE
 * ----------------------
 * In `adminConfig/pricingEngine`, following the convention established by
 * `adminConfig/platformCosts`: the catalogue of what exists is in code, the
 * amounts are in Firestore where an admin can move them without a deploy. The
 * defaults below are what applies before anyone has touched that document, and
 * they are deliberately the timid end of every range — an engine that has never
 * been tuned should be close to a no-op, not close to its cap.
 * ----------------------------------------------------------------------------
 */
import type { VehicleCategory } from '../fare/fareEngine';

/** The two products whose notified price moves a fare. */
export type FuelProduct = 'petrol' | 'diesel';

export const FUEL_PRODUCTS: FuelProduct[] = ['petrol', 'diesel'];

/** One source's reading of one product, before anything has been believed. */
export interface FuelObservation {
  product: FuelProduct;
  /** PKR per litre, as published. */
  pricePkr: number;
  /** Which feed said so — kept on the stored price for traceability. */
  sourceId: string;
  /** ISO date (YYYY-MM-DD) the price takes effect, as the source states it. */
  effectiveDate: string;
  fetchedAt: number;
}

/** A price the engine has decided to believe, and why. */
export interface ConfirmedFuelPrice {
  product: FuelProduct;
  pricePkr: number;
  effectiveDate: string;
  /** How many independent sources agreed, and which. */
  confirmations: number;
  sources: string[];
  confirmedAt: number;
  /** True when the move was larger than one step allows and was limited. */
  stepLimited: boolean;
  /** What it was before, so a wrong move can be read and undone by a human. */
  previousPkr: number | null;
}

export interface FuelSettings {
  /** Off → fares ignore fuel entirely and the rate cards stand as written. */
  enabled: boolean;
  /**
   * The litre price each city's hand-written rate card was authored against.
   *
   * Every adjustment is measured from HERE, never from yesterday's adjusted
   * value. That is what stops the factor compounding: twenty days of +1% must
   * leave fares 1% above baseline if the price came back, not 22% above it.
   */
  baseline: Record<FuelProduct, number>;
  /** Which product's price moves each vehicle class. */
  productFor: Record<VehicleCategory, FuelProduct>;
  /**
   * How much of a per-kilometre rate is fuel, per class. A 10% fuel rise moves
   * a `mini`'s per-km rate by 10% x 0.35 = 3.5%, not by 10%: the rest of that
   * rate is the driver's time, the car's depreciation and the platform's cut,
   * and none of those moved when OGRA published.
   */
  fuelShare: Record<VehicleCategory, number>;
  /** Two sources must land within this fraction of each other to be believed. */
  agreementTolerance: number;
  /** How many agreeing sources a price needs. Below this, nothing changes. */
  minConfirmations: number;
  /** The most the believed price may move in one update, as a fraction. */
  maxStepPct: number;
  /** A litre price outside this range is a parse error, not a price. */
  bounds: { minPkr: number; maxPkr: number };
  /** A confirmed price older than this stops being applied to fares. */
  maxAgeDays: number;
  /** Hard limit on the total fuel adjustment, however far the price has moved. */
  maxAdjustmentPct: number;
}

export interface PeakSettings {
  /** Off → every zone reports 1.0 and `surge/*` stops being written. */
  enabled: boolean;
  /**
   * The engine's own ceiling, separate from and tighter than the city's
   * `surge.maxMultiplier`. Both apply; the lower one wins. 1.25 is the answer
   * to "never raise it too much" — a Rs.400 ride can become Rs.500 at the worst
   * moment of the worst day, and no more.
   */
  maxMultiplier: number;
  /**
   * The floor. 1.0 means the engine never discounts. Set below 1.0 to let a
   * zone with idle drivers advertise a cheaper ride; `minAcceptableBid` still
   * protects the driver, so this can only ever eat the platform's margin.
   */
  minMultiplier: number;
  /** Most the factor may rise in one tick. Rises are gradual on purpose. */
  rampUpPerTick: number;
  /** Most it may fall in one tick. Larger than the rise: relief is immediate. */
  rampDownPerTick: number;
  /**
   * demand/supply thresholds, ascending, each with the factor it earns. The
   * first band whose `ratio` the zone does not exceed decides the factor.
   */
  bands: { ratio: number; multiplier: number }[];
  /**
   * Below this much total activity a zone is not surged at all. Two requests
   * and one driver at 4am is noise, and noise at 1.25x is a rider overcharged
   * because nothing was happening.
   */
  minActivity: number;
  /**
   * Geohash prefix length defining a zone. 5 is ~5km, and is what
   * `fare/fareFunctions.ts:getZoneSurge` already slices to read the factor.
   */
  zonePrecision: number;
  /** How long a written factor stays valid if the tick stops running. */
  staleAfterSec: number;
}

export interface IntegritySettings {
  /** Off → supply drops are taken at face value. */
  enabled: boolean;
  /** A supply fall at least this large, against the window's baseline, is a shock. */
  dropPct: number;
  /** How far back the baseline is measured. */
  lookbackSec: number;
  /**
   * A drop spread over more than this many samples is a shift ending, not a
   * coordinated walk-out. Only sudden falls are treated as suspicious.
   */
  maxSuddenSamples: number;
  /** How long the factor stays frozen at its pre-drop value. */
  freezeMinutes: number;
  /**
   * Coming back within this long after a shock is the other half of the
   * pattern: offline to make it scarce, online to collect. Recorded per driver.
   */
  returnWindowSec: number;
  /** online→offline→online cycles in an hour before a driver is flagged. */
  maxCyclesPerHour: number;
  /** Minimum drivers in a zone before a percentage drop means anything. */
  minSupplyForShock: number;
}

export interface QueueSettings {
  /** Off → every driver may claim every request the moment it appears. */
  enabled: boolean;
  /** How many drivers share each release tier. */
  tierSize: number;
  /** Seconds between one tier opening and the next. */
  tierSeconds: number;
  /**
   * After this long every driver may claim, whatever their rank. No request is
   * ever held hostage to the queue — a rider waiting is worse than a driver
   * served out of turn.
   */
  openToAllAfterSec: number;
  /**
   * How long a driver may vanish from the online set and keep their place. One
   * missed poll is a tunnel or a dropped packet, not a decision to stop working.
   */
  graceSec: number;
}

export interface PricingEngineConfig {
  fuel: FuelSettings;
  peak: PeakSettings;
  integrity: IntegritySettings;
  queue: QueueSettings;
  updatedAt: number;
  updatedBy?: string;
}

// ── Defaults ────────────────────────────────────────────────────────────────

/**
 * Rickshaws carry the highest fuel share and luxury the lowest, which looks
 * backwards until you divide: a rickshaw's Rs.16/km is almost entirely fuel,
 * while Rs.60/km for a luxury car is mostly the car. The shares are of the
 * RATE, not of the driver's wallet.
 */
const FUEL_SHARE: Record<VehicleCategory, number> = {
  moto: 0.30,
  rickshaw: 0.38,
  mini: 0.35,
  ac_car: 0.33,
  luxury: 0.26,
};

const PRODUCT_FOR: Record<VehicleCategory, FuelProduct> = {
  moto: 'petrol',
  rickshaw: 'petrol',
  mini: 'petrol',
  ac_car: 'petrol',
  luxury: 'diesel',
};

export const DEFAULT_PRICING_CONFIG: PricingEngineConfig = {
  fuel: {
    enabled: true,
    // The rate cards in fare/fareEngine.ts were written against mid-2026 pump
    // prices. Anyone re-authoring those cards must move these with them, or the
    // engine will re-apply a move that is already baked into the card.
    baseline: { petrol: 398.3, diesel: 396.24 },
    productFor: PRODUCT_FOR,
    fuelShare: FUEL_SHARE,
    agreementTolerance: 0.01,
    minConfirmations: 2,
    maxStepPct: 0.15,
    bounds: { minPkr: 50, maxPkr: 1500 },
    maxAgeDays: 45,
    maxAdjustmentPct: 0.35,
  },
  peak: {
    enabled: true,
    maxMultiplier: 1.25,
    minMultiplier: 1.0,
    rampUpPerTick: 0.05,
    rampDownPerTick: 0.1,
    bands: [
      { ratio: 0.5, multiplier: 1.0 },
      { ratio: 1.0, multiplier: 1.05 },
      { ratio: 1.5, multiplier: 1.1 },
      { ratio: 2.5, multiplier: 1.18 },
      { ratio: Number.POSITIVE_INFINITY, multiplier: 1.25 },
    ],
    minActivity: 4,
    zonePrecision: 5,
    staleAfterSec: 600,
  },
  integrity: {
    enabled: true,
    dropPct: 0.35,
    lookbackSec: 900,
    maxSuddenSamples: 2,
    freezeMinutes: 30,
    returnWindowSec: 900,
    maxCyclesPerHour: 4,
    minSupplyForShock: 5,
  },
  queue: {
    enabled: true,
    tierSize: 3,
    tierSeconds: 8,
    openToAllAfterSec: 60,
    graceSec: 90,
  },
  // Zero, not Date.now(): a module constant evaluated at import time would make
  // "when were these settings last changed" mean "when did this instance start".
  // Zero reads as what it is — nobody has ever edited them.
  updatedAt: 0,
};

// ── Persisted shapes ────────────────────────────────────────────────────────

/** One reading of a zone's demand and supply. The tick appends one per run. */
export interface ZoneSample {
  at: number;
  /** Approved drivers whose last known cell is in this zone and who are online. */
  onlineDrivers: number;
  /** Of those, the ones not already on a trip. */
  availableDrivers: number;
  /** Requests waiting for a driver in this zone. */
  openRequests: number;
}

export interface PeakDecision {
  multiplier: number;
  /** What the bands alone asked for, before ramping and freezing. */
  targetMultiplier: number;
  /** demand/supply, or null when the zone was too quiet to judge. */
  ratio: number | null;
  reason:
    | 'disabled'
    | 'low_activity'
    | 'banded'
    | 'ramped'
    | 'frozen_supply_shock'
    | 'capped';
  /** Set while a suspected manipulation is holding the factor down. */
  frozenUntil?: number;
}

export interface SupplyShock {
  suspicious: boolean;
  /** The supply level the zone had before the fall. */
  baselineSupply: number;
  currentSupply: number;
  droppedPct: number;
  /** Over how many samples the fall happened. */
  overSamples: number;
  reason:
    | 'none'
    | 'insufficient_history'
    | 'too_few_drivers'
    | 'gradual'
    | 'demand_fell'
    | 'sudden_drop';
  detectedAt?: number;
}

export interface QueueEntry {
  driverId: string;
  /** When this driver's current unbroken online run began. Their seniority. */
  queuedAt: number;
  /** Last tick that saw them online — drives the grace window. */
  lastSeenAt: number;
  /** Times they have left and rejoined this queue today. Diagnostics only. */
  rejoins?: number;
}

export interface ZoneQueue {
  cityId: string;
  zone: string;
  entries: QueueEntry[];
  updatedAt: number;
}

/** What the tick writes to `pricingZones/{cityId}_{zone}`. */
export interface ZoneState {
  cityId: string;
  zone: string;
  samples: ZoneSample[];
  multiplier: number;
  decision: PeakDecision;
  shock: SupplyShock;
  queue: QueueEntry[];
  updatedAt: number;
}

/** How many samples a zone keeps. 30 ticks at 60s is half an hour of history. */
export const MAX_ZONE_SAMPLES = 30;
