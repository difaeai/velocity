/**
 * The Pricing Engine.
 *
 *   types.ts            settings, defaults and persisted shapes
 *   fuel.ts             believing a pump price, and moving per-km rates with it
 *   fuelSources.ts      the HTTP mirrors of the OGRA notifications
 *   fuelJob.ts          the daily run that writes fuelPrices/current
 *   peak.ts             what demand and supply may do to a fare
 *   supplyIntegrity.ts  telling real scarcity from manufactured scarcity
 *   driverQueue.ts      first come, first served; offline forfeits your place
 *   engine.ts           the once-a-minute tick that computes and writes it all
 *   claimGate.ts        the server-side "is it your turn" used by acceptTrip
 *   config.ts           loading the settings and the believed fuel price
 *   functions.ts        the callable surface
 *
 * The four files in the middle are pure. Every decision about somebody's money
 * is in them, and none of them needs Firebase to be tested.
 */
export {
  getPricingSnapshot,
  getDriverQueueStatus,
  adminGetPricingEngine,
  adminUpdatePricingEngine,
  adminRefreshFuelPrices,
  adminRunPricingTick,
  adminSetFuelPrice,
  adminClearSupplyFreeze,
  seedPricingEngine,
} from './functions';

export { refreshFuelPrices } from './fuelJob';
export { runPricingTick } from './engine';

export { claimGateFor, waitMessage, zoneQueueFor } from './claimGate';
export { loadFuelPrices, loadPricingConfig } from './config';
export { fuelFactorFor, describeFuelAdjustment, withFuelAdjustedRates } from './fuel';
export { riderPeakLabel, driverPeakLabel, explainPeak } from './peak';
export {
  claimDecision,
  claimDelayMs,
  describeQueuePosition,
  effectiveDelayMs,
  orderClaimable,
  rankOf,
} from './driverQueue';
export * from './types';
