/**
 * "Find your Customers" — the price list and the notification budget.
 * ----------------------------------------------------------------------------
 * THE PRICE IS THE RADIUS (owner, 2026-11-14)
 * -------------------------------------------
 * One ad costs a dollar and reaches one kilometre. Every kilometre past that is
 * twenty cents, so a shop that wants the whole sector pays for the whole sector
 * and the shop on the corner pays a dollar:
 *
 *     1 km → $1.00      6 km → $2.00      26 km → $6.00
 *     2 km → $1.20     11 km → $3.00      50 km → $10.80
 *
 * The bands this replaced (3 km / 5 km, 5,500 and 7,000 a month, 3/6/12-month
 * plans) are gone: nobody could tell which band they were in, and the cheapest
 * way in was a year of rupees. A dollar and a slider is a price a shopkeeper can
 * say yes to in one go.
 *
 * WHY THE PRICE IS IN DOLLARS AND THE TRANSFER IS IN RUPEES
 * ---------------------------------------------------------
 * The owner set the list in dollars, and Velocity Studio already sells in them.
 * The rails an Islamabad shop actually pays on are Easypaisa, JazzCash and a
 * bank transfer, all in rupees — so every quote carries both: the dollar price
 * it was bought at, and the rupees to send, converted at `usdToPkr`. Both are
 * snapshotted onto the application, so a rate that moves during the review does
 * not change what somebody already paid.
 *
 * THE NOTIFICATION BUDGET
 * -----------------------
 * This part protects the users rather than the revenue. An advertiser on a busy
 * road would otherwise push the same commuter every time they drove past, and
 * the only thing a person can do about that is turn Velocity notifications off
 * — which also kills the ride alerts they actually want. So: one push per ad per
 * person per cooldown window, and a hard daily ceiling across ALL advertisers.
 * ----------------------------------------------------------------------------
 */
import { db } from '../lib/firebase';

export interface BusinessAdSettings {
  /** What one ad costs at `includedKm`, in US dollars. */
  baseUsd: number;
  /** Every kilometre past `includedKm`, in US dollars. */
  perKmUsd: number;
  /** The radius the base price already covers. */
  includedKm: number;
  /**
   * The widest radius sold. The picker on the phone stops at 50 — past that
   * there is no screen left — and the box under it types up to this.
   */
  maxRadiusKm: number;
  /** How long one paid ad runs from the day it is approved. */
  planDays: number;
  /** Rupees to the dollar: the price list is USD, the transfer is PKR. */
  usdToPkr: number;
  /** How many offers one paid ad may have running at a time. */
  adSlots: number;
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
  baseUsd: 1,
  perKmUsd: 0.2,
  includedKm: 1,
  // 50 is as far as the picker goes; the manual box goes to here.
  maxRadiusKm: 300,
  planDays: 30,
  // Roughly the open-market rate in November 2026. An admin keeps it current —
  // it only decides what rupee figure the payment step asks for.
  usdToPkr: 285,
  adSlots: 1,
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

/** A money amount in cents, so the ladder never lands on 1.2000000000000002. */
function cents(usd: number): number {
  return Math.round(usd * 100);
}

/**
 * What one ad at this radius costs, in US cents. The radius is clamped to what
 * we sell: a client asking for 10,000 km is answered with the ceiling's price,
 * and the caller refuses the radius separately — silently over-charging is
 * worse than quoting the cap.
 */
export function adPriceCents(settings: BusinessAdSettings, radiusKm: number): number {
  const km = Math.min(Math.max(radiusKm, 0.5), settings.maxRadiusKm);
  const extra = Math.max(0, km - settings.includedKm);
  return Math.max(0, Math.round(cents(settings.baseUsd) + cents(settings.perKmUsd) * extra));
}

/** The same price as dollars, to two decimal places. */
export function adPriceUsd(settings: BusinessAdSettings, radiusKm: number): number {
  return adPriceCents(settings, radiusKm) / 100;
}

/** The rupees to transfer for a dollar price, at the configured rate. */
export function pricePkr(settings: BusinessAdSettings, priceUsd: number): number {
  return Math.round(priceUsd * settings.usdToPkr);
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
 * written config doc (an admin who set the price but never the bank accounts)
 * must still produce a usable price list, not an empty one.
 */
export async function getBusinessAdSettings(): Promise<BusinessAdSettings> {
  const snap = await db.doc('config/businessAdSettings').get();
  const d = DEFAULT_BUSINESS_AD_SETTINGS;
  if (!snap.exists) return d;

  const payment = (snap.get('payment') as Record<string, unknown> | undefined) ?? {};

  return {
    baseUsd: num(snap.get('baseUsd'), d.baseUsd, 0, 1000),
    perKmUsd: num(snap.get('perKmUsd'), d.perKmUsd, 0, 1000),
    includedKm: num(snap.get('includedKm'), d.includedKm, 0.5, 50),
    maxRadiusKm: num(snap.get('maxRadiusKm'), d.maxRadiusKm, 1, 2000),
    planDays: Math.round(num(snap.get('planDays'), d.planDays, 1, 3650)),
    usdToPkr: num(snap.get('usdToPkr'), d.usdToPkr, 1, 100_000),
    adSlots: Math.round(num(snap.get('adSlots'), d.adSlots, 1, 20)),
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
