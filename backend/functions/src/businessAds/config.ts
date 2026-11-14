/**
 * "Find your Customers" — the price list and the notification budget.
 * ----------------------------------------------------------------------------
 * THE PRICE IS THE RADIUS (owner, 2026-11-14)
 * -------------------------------------------
 * One ad costs Rs 300 and reaches one kilometre. Every kilometre past that is
 * Rs 60, so a shop that wants the whole sector pays for the whole sector and
 * the shop on the corner pays three hundred:
 *
 *     1 km → Rs 300      6 km → Rs 600      26 km → Rs 1,800
 *     2 km → Rs 360     11 km → Rs 900      50 km → Rs 3,240
 *
 * The bands this replaced (3 km / 5 km, 5,500 and 7,000 a month, 3/6/12-month
 * plans) are gone: nobody could tell which band they were in, and the cheapest
 * way in was a year of rupees. Three hundred rupees and a slider is a price a
 * shopkeeper can say yes to in one go.
 *
 * RUPEES, NOT DOLLARS (owner, 2026-11-14, second pass)
 * ----------------------------------------------------
 * The ladder was briefly in dollars — $1 and 20¢ — with the rupees worked out
 * at a stored rate. The owner asked for it in rupees outright, which is also
 * what every rail this feature bills on (Easypaisa, JazzCash, a bank transfer)
 * actually moves. One currency, one number, no conversion to go stale: the
 * price is snapshotted onto the application, so a reprice during the review
 * cannot change what somebody already paid.
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
  /** What one ad costs at `includedKm`, in rupees. */
  basePkr: number;
  /** Every kilometre past `includedKm`, in rupees. */
  perKmPkr: number;
  /** The radius the base price already covers. */
  includedKm: number;
  /**
   * The widest radius sold. The picker on the phone stops at 50 — past that
   * there is no screen left — and the box under it types up to this.
   */
  maxRadiusKm: number;
  /** How long one paid ad runs from the day it is approved. */
  planDays: number;
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
  basePkr: 300,
  perKmPkr: 60,
  includedKm: 1,
  // 50 is as far as the picker goes; the manual box goes to here.
  maxRadiusKm: 300,
  planDays: 30,
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

/**
 * What one ad at this radius costs, in whole rupees. The radius is clamped to
 * what we sell: a client asking for 10,000 km is answered with the ceiling's
 * price, and the caller refuses the radius separately — silently over-charging
 * is worse than quoting the cap. Rounded, because nobody transfers paisa.
 */
export function adPrice(settings: BusinessAdSettings, radiusKm: number): number {
  const km = Math.min(Math.max(radiusKm, 0.5), settings.maxRadiusKm);
  const extra = Math.max(0, km - settings.includedKm);
  return Math.max(0, Math.round(settings.basePkr + settings.perKmPkr * extra));
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
    basePkr: num(snap.get('basePkr'), d.basePkr, 0, 10_000_000),
    perKmPkr: num(snap.get('perKmPkr'), d.perKmPkr, 0, 10_000_000),
    includedKm: num(snap.get('includedKm'), d.includedKm, 0.5, 50),
    maxRadiusKm: num(snap.get('maxRadiusKm'), d.maxRadiusKm, 1, 2000),
    planDays: Math.round(num(snap.get('planDays'), d.planDays, 1, 3650)),
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
