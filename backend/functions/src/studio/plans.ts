/**
 * Velocity Studio's plans, and what each one lets a workspace do.
 *
 * A customer gets exactly what they pay for and nothing else: the Research
 * Assistant, the content desk, or the whole team — the Social Media Manager with
 * the Meta & Google Ad Expert, the sales, calling and email agents and the
 * Research Assistant feeding them. Every check that matters runs on the server
 * (`social/workspace.ts`); the console only hides what a plan does not include.
 * Pure, so the rules are tested without a database.
 *
 * Mirrored for the web in `lib/studio.ts` — change one, change the other.
 */

export type PlanId = 'research' | 'content' | 'all' | 'sales' | 'ads';
export type Need = 'research' | 'content' | 'ads' | 'sales' | 'any';
/** One part of a plan, or several of which any one will do — a page two plans share. */
export type Needs = Need | readonly Need[];

/**
 * `aiUsd` is the Gemini a plan may spend in a month, in real dollars — the
 * allowance `ai/config.ts` caps and paces. Server-only: the customer never sees
 * it. Content's 30 days of reels, posts, carousels and comment replies fit in
 * $3, and so do the Research Assistant's market reads and dummy campaigns; the
 * Ad Expert's daily reads of every campaign take the whole team to $5.
 */
export const PLANS: Record<PlanId, { name: string; usd: number; aiUsd: number; can: Exclude<Need, 'any'>[] }> = {
  research: { name: 'Research Assistant for Social Media', usd: 20, aiUsd: 3, can: ['research'] },
  content: { name: 'Content', usd: 26, aiUsd: 3, can: ['content'] },
  all: {
    name: 'Social Media Manager + Meta & Google Ad Expert',
    usd: 32,
    aiUsd: 5,
    can: ['research', 'content', 'ads', 'sales'],
  },
  // No longer sold: kept so a workspace already on one keeps working.
  sales: { name: 'Sales agents', usd: 17, aiUsd: 3, can: ['sales'] },
  ads: { name: 'Meta Ad Expert (ads only)', usd: 24, aiUsd: 5, can: ['ads'] },
};

/** Who does each part, as a refusal names them. */
const WHO: Record<Exclude<Need, 'any'>, string> = {
  research: 'the Research Assistant',
  content: 'the content team',
  ads: 'the Meta & Google Ad Expert',
  sales: 'the sales, calling and email agents',
};

/**
 * Credits: the team's work bought a day at a time, on top of a plan. $5 buys
 * five days; each day the team works on credit, the customer sees $1 spent.
 * Mirrored in lib/studio.ts.
 */
export const CREDIT_DAY_USD = 1;
/** What one credit day may spend on Gemini. The rest of the dollar is the margin; never shown to a customer. */
export const CREDIT_DAY_AI_USD = 0.2;
/** The packs on sale, in days (one day = one dollar). Mirrored in lib/studio.ts. */
export const CREDIT_PACKS = [5, 10, 20] as const;

/** The plans on sale, left to right as the pricing page shows them. */
export const PLAN_IDS: PlanId[] = ['research', 'content', 'all'];

/** Paid a month at a time, or a year up front for less. */
export type Billing = 'month' | 'year';
export const YEAR_DISCOUNT_PCT = 3;

/** What a month of any plan costs more once a customer's own 3 days are over (`priceClock.ts`). Mirrors lib/studio.ts. */
export const PRICE_RISE_USD = 2;

/** A year is twelve months less exactly 3%, to the cent — never more (owner); a month is never discounted. Mirrors lib/studio.ts. */
export const priceUsd = (plan: PlanId, billing: Billing, raised = false): number => {
  const month = PLANS[plan].usd + (raised ? PRICE_RISE_USD : 0);
  return billing === 'year' ? Math.round(month * 12 * (100 - YEAR_DISCOUNT_PCT)) / 100 : month;
};

// shortcut: one fixed rate for the PKR a customer is asked to send; mirrored in lib/studio.ts. Read it from config when the rupee moves.
export const PKR_PER_USD = 280;

/** What this plan costs in rupees, the figure the Billing page asks for. */
/** Whole rupees, rounded up so a year's saving never passes 3%. Mirrors lib/studio.ts studioPkr. */
export const pricePkr = (plan: PlanId, billing: Billing, raised = false): number =>
  Math.ceil((Math.round(priceUsd(plan, billing, raised) * 100) * PKR_PER_USD) / 100);

/** One free day, then a plan has to be paid for. */
export const TRIAL_MS = 24 * 3600_000;
/** What one approved monthly payment buys. */
export const PERIOD_MS = 30 * 86_400_000;
/** What one approved yearly payment buys. */
export const YEAR_MS = 365 * 86_400_000;

/** What the desk is told about a business, from the sign-up form. */
export interface Brand {
  name: string;
  /** What it sells, in a sentence or two. */
  what: string;
  /** Who buys it. */
  audience: string;
  /** Where — a country, or the cities it serves. */
  market: string;
  /** The language(s) posts are written in. */
  language: string;
  /** Why someone picks it over the alternatives. */
  differences: string;
  website: string;
}

import type { Platform } from '../social/types';

export interface Workspace {
  name: string;
  ownerUid: string;
  ownerEmail: string | null;
  plan: PlanId;
  trialEndsAtMs: number;
  paidUntilMs: number;
  /** max(trial end, paid until) — kept on the doc so the schedulers can query live workspaces. */
  accessUntilMs: number;
  createdAtMs: number;
  brand: Brand;
  /** Paused by a Velocity admin: no desk, no schedules, whatever is paid. */
  suspended?: boolean;
  /** Credit days bought and not yet used (`studio/credits.ts`). */
  creditDays?: number;
  /** The Pakistan day (`YYYY-MM-DD`) the last credit day was spent: one a day at most. */
  creditDayOn?: string;
  /** The networks the owner said they post on at sign-up: what the console asks them to connect first. */
  platforms?: Platform[];
}

/** A plan paid for before the business was described (`studioUsers/{uid}.prepaid`): the next workspace starts on it. */
export interface Prepaid {
  plan: PlanId;
  billing: Billing;
  paymentId: string;
  atMs: number;
  /** The day, not the plan: a payment of TRIAL_USD that buys 24 hours (owner, 2026-11-11). */
  trial?: boolean;
}

/**
 * What the trial day costs. It is not free any more (owner, 2026-11-11): the
 * day is bought like anything else, by card or by a transfer of this much with
 * its receipt, and only an approved payment starts it. A dollar is small enough
 * not to be the decision and large enough to prove the payer is real — which is
 * the whole reason for it.
 */
export const TRIAL_USD = 1;

/** A new workspace's time: the day that was paid for, or the plan that was. */
export function startTerms(prepaid: Prepaid, nowMs: number): Pick<Workspace, 'trialEndsAtMs' | 'paidUntilMs' | 'accessUntilMs'> {
  if (prepaid.trial) return { trialEndsAtMs: nowMs + TRIAL_MS, paidUntilMs: 0, accessUntilMs: nowMs + TRIAL_MS };
  const paidUntilMs = nowMs + (prepaid.billing === 'year' ? YEAR_MS : PERIOD_MS);
  return { trialEndsAtMs: nowMs, paidUntilMs, accessUntilMs: paidUntilMs };
}

/** Whether this workspace may do this, now. */
export function canUse(
  ws: Pick<Workspace, 'plan' | 'trialEndsAtMs' | 'paidUntilMs' | 'suspended'>,
  need: Needs,
  nowMs: number,
): boolean {
  if (ws.suspended) return false;
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) return false;
  return (typeof need === 'string' ? [need] : need).some((n) => n === 'any' || PLANS[ws.plan].can.includes(n));
}

/** Why not, in words the customer can act on. Null when they can. */
export function refusal(
  ws: Pick<Workspace, 'plan' | 'trialEndsAtMs' | 'paidUntilMs' | 'suspended'>,
  need: Needs,
  nowMs: number,
): string | null {
  if (canUse(ws, need, nowMs)) return null;
  if (ws.suspended) return 'Velocity has paused this workspace. Email business@velocityrides.app to sort it out.';
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) {
    return ws.paidUntilMs
      ? 'Your Vexa plan has run out. Pay for the next month — or buy credits, $1 a day — on the Billing page to carry on.'
      : 'Your free day is over. Choose a plan — or buy credits, $1 a day — on the Billing page to carry on.';
  }
  // 'any' never gets here: it is refused only for time or a pause, both answered above.
  const first = (typeof need === 'string' ? need : need[0]) as Exclude<Need, 'any'>;
  return `Your ${PLANS[ws.plan].name} plan does not include ${WHO[first]}. Upgrade on the Billing page.`;
}

/**
 * The new paid-until after one approved payment: a month (or a year) from
 * whichever is later, now or the end of what is already paid — so paying early
 * never loses days, and paying late does not back-date the period.
 */
export function extendPaid(paidUntilMs: number, nowMs: number, periodMs = PERIOD_MS): number {
  return Math.max(paidUntilMs, nowMs) + periodMs;
}

/**
 * The new paid-until after an approved payment for `plan`. Time still paid on
 * a different plan carries over at what it was worth — 30 days of Content
 * become about 24 of the whole team, 30 of the whole team about 37 of Content — so one
 * dear month never turns a cheap year into a dear one, and a cheaper plan
 * never throws away days already paid for.
 */
export function paidAfter(
  ws: Pick<Workspace, 'plan' | 'paidUntilMs'>,
  plan: PlanId,
  nowMs: number,
  periodMs = PERIOD_MS,
): number {
  const left = ws.paidUntilMs - nowMs;
  if (plan === ws.plan || left <= 0) return extendPaid(ws.paidUntilMs, nowMs, periodMs);
  return nowMs + Math.floor((left * PLANS[ws.plan].usd) / PLANS[plan].usd) + periodMs;
}
