/**
 * "Find your Customers" — the price list and the notification budget.
 * ----------------------------------------------------------------------------
 * Two bands, because that is what the product sells: a short radius that costs
 * less and carries one ad, and a wider radius that costs more and carries three.
 * Both live in `config/businessAdSettings` so an admin can reprice without
 * shipping a build — the same reason the partner-program fee does.
 *
 * The notification budget is the part that protects the users rather than the
 * revenue. An advertiser on a busy road would otherwise push the same commuter
 * every time they drove past, and the only thing a person can do about that is
 * turn Velocity notifications off — which also kills the ride alerts they
 * actually want. So: one push per ad per person per cooldown window, and a hard
 * daily ceiling across ALL advertisers.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';
import type { BusinessAdPlanMonths, BusinessAdTier } from './types';

export interface BusinessAdSettings {
  /** Ordered by ceiling, smallest first. Always at least one band. */
  tiers: BusinessAdTier[];
  currency: string;
  /** Plan lengths an advertiser may buy, in months. */
  planMonths: BusinessAdPlanMonths[];
  /**
   * Hours before the same ad may notify the same person again. This is a clock,
   * not a re-entry trigger: someone who lives inside the radius and never leaves
   * hears from the advertiser once every window, which is the point — the offer
   * is aimed at the neighbourhood, not only at people walking in from outside.
   */
  notifyCooldownHours: number;
  /** Hard ceiling on business-ad pushes one person can receive in a day. */
  maxNotifPerUserPerDay: number;
  /** Where the advertiser sends the fee. Shown verbatim on the payment step. */
  payment: {
    bankName: string | null;
    bankAccountTitle: string | null;
    bankAccount: string | null;
    easypaisaTitle: string | null;
    easypaisaAccount: string | null;
    jazzcashTitle: string | null;
    jazzcashAccount: string | null;
  };
}

export const DEFAULT_BUSINESS_AD_SETTINGS: BusinessAdSettings = {
  tiers: [
    { key: 'near', maxRadiusKm: 3, monthlyFee: 5500, adSlots: 1 },
    { key: 'wide', maxRadiusKm: 5, monthlyFee: 7000, adSlots: 3 },
  ],
  currency: 'PKR',
  planMonths: [3, 6, 12],
  // Twice a day per offer. Anyone inside the radius hears from the advertiser
  // every 12 hours, whether they walked in or live there.
  notifyCooldownHours: 12,
  // Six is 12-hourly delivery for up to three offers. The ceiling exists so a
  // dense market street cannot fill someone's shade with offers.
  maxNotifPerUserPerDay: 6,
  payment: {
    bankName: null,
    bankAccountTitle: null,
    bankAccount: null,
    easypaisaTitle: null,
    easypaisaAccount: null,
    jazzcashTitle: null,
    jazzcashAccount: null,
  },
};

/** The widest radius any band sells — the cap the radius picker is clamped to. */
export function maxRadiusKm(settings: BusinessAdSettings): number {
  return settings.tiers[settings.tiers.length - 1].maxRadiusKm;
}

/**
 * The band a radius falls into. Bands are inclusive of their ceiling, so 3 km
 * is the cheap band and 3.1 km is the wide one. A radius above every ceiling
 * resolves to the widest band rather than throwing — the caller validates the
 * radius separately, and silently over-serving is worse than over-charging.
 */
export function tierForRadius(settings: BusinessAdSettings, radiusKm: number): BusinessAdTier {
  return (
    settings.tiers.find((t) => radiusKm <= t.maxRadiusKm) ??
    settings.tiers[settings.tiers.length - 1]
  );
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

/**
 * Reads the admin-configured settings, falling back field by field. A partially
 * written config doc (an admin who set the prices but never the bank accounts)
 * must still produce a usable price list, not an empty one.
 */
export async function getBusinessAdSettings(): Promise<BusinessAdSettings> {
  const snap = await db.doc('config/businessAdSettings').get();
  const d = DEFAULT_BUSINESS_AD_SETTINGS;
  if (!snap.exists) return d;

  const rawTiers = snap.get('tiers') as unknown;
  let tiers = d.tiers;
  if (Array.isArray(rawTiers) && rawTiers.length > 0) {
    const parsed = rawTiers
      .map((t, i) => {
        const row = (t ?? {}) as Record<string, unknown>;
        const fallback = d.tiers[Math.min(i, d.tiers.length - 1)];
        return {
          key: str(row.key) ?? fallback.key,
          maxRadiusKm: num(row.maxRadiusKm, fallback.maxRadiusKm, 0.5, 50),
          monthlyFee: num(row.monthlyFee, fallback.monthlyFee, 0, 10_000_000),
          adSlots: Math.round(num(row.adSlots, fallback.adSlots, 1, 20)),
        };
      })
      .sort((a, b) => a.maxRadiusKm - b.maxRadiusKm);
    if (parsed.length > 0) tiers = parsed;
  }

  const rawMonths = snap.get('planMonths') as unknown;
  const planMonths = Array.isArray(rawMonths)
    ? (rawMonths.filter((m): m is BusinessAdPlanMonths => m === 3 || m === 6 || m === 12) as
        BusinessAdPlanMonths[])
    : d.planMonths;

  const payment = (snap.get('payment') as Record<string, unknown> | undefined) ?? {};

  return {
    tiers,
    currency: str(snap.get('currency')) ?? d.currency,
    planMonths: planMonths.length > 0 ? planMonths : d.planMonths,
    notifyCooldownHours: num(snap.get('notifyCooldownHours'), d.notifyCooldownHours, 1, 720),
    maxNotifPerUserPerDay: Math.round(
      num(snap.get('maxNotifPerUserPerDay'), d.maxNotifPerUserPerDay, 1, 20),
    ),
    payment: {
      bankName: str(payment.bankName),
      bankAccountTitle: str(payment.bankAccountTitle),
      bankAccount: str(payment.bankAccount),
      easypaisaTitle: str(payment.easypaisaTitle),
      easypaisaAccount: str(payment.easypaisaAccount),
      jazzcashTitle: str(payment.jazzcashTitle),
      jazzcashAccount: str(payment.jazzcashAccount),
    },
  };
}

/** What a plan costs in total: the band's monthly fee times the months bought. */
export function quoteFee(monthlyFee: number, months: number): number {
  return Math.round(monthlyFee * months);
}

/**
 * `2026-07-30` in Pakistan time. Every daily bucket in this module — the
 * per-person notification budget and the per-ad rollups the analytics chart
 * reads — is keyed on this, so "today" means the advertiser's today and not
 * UTC's.
 */
export function pkDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
