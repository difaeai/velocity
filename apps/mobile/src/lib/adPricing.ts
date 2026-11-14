/**
 * "Find your Customers" — what a radius costs, worked out on the phone.
 *
 * The owner's list (2026-11-14): one ad is Rs 300 and reaches a kilometre, and
 * every kilometre after that is Rs 60. Four numbers, so the phone prices every
 * radius itself as the slider moves — no call per step, and the screen is
 * priced on its first frame instead of after a cold function answers.
 *
 * The same numbers come back from `getBusinessAdPlans` and replace these the
 * moment they land, so a reprice still needs no new build. These are only what
 * the screen shows while that is in the air — and the server re-derives the
 * price when the application arrives, so this file can never set a price.
 * It is the deliberate twin of backend/functions/src/businessAds/config.ts:
 * change the ladder there and change it here.
 */
import type { BusinessAdPlans } from '../api/client';

/** What the app assumes until the server's own numbers arrive. */
export const AD_PRICE_DEFAULTS = {
  basePkr: 300,
  perKmPkr: 60,
  includedKm: 1,
  maxRadiusKm: 300,
  planDays: 30,
  adSlots: 1,
  notifyCooldownHours: 12,
};

export type AdPricing = typeof AD_PRICE_DEFAULTS;

/** The server's ladder when it is here, this build's when it is not. */
export function adPricing(plans: BusinessAdPlans | null): AdPricing {
  return plans ? { ...AD_PRICE_DEFAULTS, ...plans } : AD_PRICE_DEFAULTS;
}

/** The radius picker's widest step. Past this the screen runs out, so a box takes a typed number. */
export const RADIUS_PICKER_MAX_KM = 50;

/** What one ad at this radius costs, in whole rupees. */
export function adPrice(p: AdPricing, radiusKm: number): number {
  const km = Math.min(Math.max(radiusKm, 0.5), p.maxRadiusKm);
  const extra = Math.max(0, km - p.includedKm);
  return Math.max(0, Math.round(p.basePkr + p.perKmPkr * extra));
}
