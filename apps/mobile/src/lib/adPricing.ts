/**
 * "Find your Customers" — what a radius costs, worked out on the phone.
 *
 * The owner's list (2026-11-14): one ad is a dollar and reaches a kilometre,
 * and every kilometre after that is twenty cents. Five numbers, so the phone
 * prices every radius itself as the slider moves — no call per step, and the
 * screen is priced on its first frame instead of after a cold function answers.
 *
 * The same five numbers come back from `getBusinessAdPlans` and replace these
 * the moment they land, so a reprice still needs no new build. These are only
 * what the screen shows while that is in the air — and the server re-derives
 * the price when the application arrives, so this file can never set a price.
 * It is the deliberate twin of backend/functions/src/businessAds/config.ts:
 * change the ladder there and change it here.
 */
import type { BusinessAdPlans } from '../api/client';

/** What the app assumes until the server's own numbers arrive. */
export const AD_PRICE_DEFAULTS = {
  baseUsd: 1,
  perKmUsd: 0.2,
  includedKm: 1,
  maxRadiusKm: 300,
  planDays: 30,
  usdToPkr: 285,
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

/** What one ad at this radius costs, in US cents — kept in cents so the ladder is exact. */
export function adPriceCents(p: AdPricing, radiusKm: number): number {
  const km = Math.min(Math.max(radiusKm, 0.5), p.maxRadiusKm);
  const extra = Math.max(0, km - p.includedKm);
  return Math.max(0, Math.round(Math.round(p.baseUsd * 100) + Math.round(p.perKmUsd * 100) * extra));
}

/** "$1.80" — the price as the screen writes it. */
export function adPriceLabel(p: AdPricing, radiusKm: number): string {
  const c = adPriceCents(p, radiusKm);
  return `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`;
}

/** The dollar price, to the cent. */
export const adPriceUsd = (p: AdPricing, radiusKm: number): number => adPriceCents(p, radiusKm) / 100;

/** The rupees to transfer, at the configured rate — the rails are PKR. */
export const adPricePkr = (p: AdPricing, radiusKm: number): number =>
  Math.round(adPriceUsd(p, radiusKm) * p.usdToPkr);
