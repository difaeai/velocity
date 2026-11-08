/**
 * Velocity Studio's plans, for the web: prices for the public page, and what a
 * workspace may open for the console. No Firebase here — the sales page at
 * /studio imports it and must stay free of the SDK.
 *
 * Mirrors `backend/functions/src/studio/plans.ts`; the server is what enforces
 * it. Change one, change the other.
 */

export type StudioPlanId = 'research' | 'content' | 'all' | 'sales' | 'ads';
export type StudioNeed = 'research' | 'content' | 'ads' | 'sales' | 'any';
/** One part of a plan, or several of which any one will do — a page two plans share. */
export type StudioNeeds = StudioNeed | readonly StudioNeed[];

export const STUDIO_PLANS: Record<
  StudioPlanId,
  { name: string; usd: number; can: Exclude<StudioNeed, 'any'>[]; tagline: string; includes: string[] }
> = {
  research: {
    name: 'Research Assistant for Social Media',
    usd: 20,
    can: ['research'],
    tagline: 'Researches your market and tests every campaign for free, before you spend.',
    includes: [
      'Reads your market and your competitors — plus your own notes and links',
      'Analyses your Instagram and Facebook: what travelled, and how your profile looks to a stranger',
      'Runs a dummy campaign before any real one: a simulated audience reacts, nothing is spent',
      'Shows what the money would buy, what put people off, and a better version of the ad',
      'Hands every result to the Social Media Manager — ours on the full team, or your own',
    ],
  },
  content: {
    name: 'Content',
    usd: 26,
    can: ['content'],
    tagline: 'Your social media team, posting every day.',
    includes: [
      'A market analysis of your business on day one — plus your own notes and links',
      '30 days of content made ahead on a calendar you can change',
      'Reels with voice-over and music, posts, stories, carousels',
      'Posts at your time to Instagram and Facebook, answers comments',
      'Learns from your own best posts',
    ],
  },
  all: {
    name: 'Social Media Manager + Meta & Google Ad Expert',
    usd: 32,
    can: ['research', 'content', 'ads', 'sales'],
    tagline: 'The whole team: research, content, Meta & Google ads, and sales by email and phone.',
    includes: [
      'Everything in the Research Assistant and Content',
      'Social Media Manager: plans every campaign from the Research Assistant’s free dummy runs',
      'Meta & Google Ad Expert: runs Facebook & Instagram ads inside your daily limit, reads Google Ads beside them',
      'Sales agents and email marketing: finds buyers, writes from your own mailbox, follows up twice',
      'AI calling & WhatsApp agents for your leads — a package on top of the plan',
    ],
  },
  // No longer sold: kept so a workspace already on one keeps working.
  sales: {
    name: 'Sales agents',
    usd: 17,
    can: ['sales'],
    tagline: 'Sales agents that research your market and bring you customers.',
    includes: [
      'Market research on day one: your buyers, your competitors and an audience test',
      'Finds businesses that could buy from you, with their email and WhatsApp',
      'Writes each one a short, personal cold email from your own mailbox',
      'Follows up twice, and drafts your answer to every reply',
      'A sales funnel built from the research',
    ],
  },
  ads: {
    name: 'Meta Ad Expert (ads only)',
    usd: 24,
    can: ['ads'],
    tagline: 'A Meta ads specialist that runs and improves your ads every day.',
    includes: [
      'Plans, writes and launches Facebook & Instagram ads',
      'Watches cost, conversions and ROAS every day',
      'Keeps winners running, pauses losers, refreshes tired ads on its own',
      'Reads the market and your competitors before every move',
      'Your daily budget limit, enforced in code',
    ],
  },
};

/** The plans on sale, left to right as the pricing page shows them. */
export const STUDIO_PLAN_IDS: StudioPlanId[] = ['research', 'content', 'all'];

/** The "From $… a month" the pages quote: the cheapest plan on sale. */
export const STUDIO_FROM_USD = Math.min(...STUDIO_PLAN_IDS.map((id) => STUDIO_PLANS[id].usd));

/** Paid a month at a time, or a year up front for less. */
export type StudioBilling = 'month' | 'year';
export const STUDIO_YEAR_DISCOUNT_PCT = 3;

/** A year is twelve months less exactly 3%, to the cent — never more (owner); a month is never discounted. Mirrors backend priceUsd. */
export const studioPriceUsd = (plan: StudioPlanId, billing: StudioBilling): number =>
  billing === 'year'
    ? Math.round(STUDIO_PLANS[plan].usd * 12 * (100 - STUDIO_YEAR_DISCOUNT_PCT)) / 100
    : STUDIO_PLANS[plan].usd;

/** The rupees to send for `usd`: whole rupees, rounded up so a year's saving never passes 3%. Mirrors backend pricePkr. */
export const studioPkr = (usd: number): number => Math.ceil((Math.round(usd * 100) * PKR_PER_USD) / 100);

/** "$232.80", or "$20" for whole dollars. */
export const studioUsd = (usd: number): string => `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;

export const STUDIO_TRIAL_HOURS = 24;

/** Credits: a day of the team's work for $1, used only when a plan runs out or a month's AI work is used up. Mirrors the backend. */
export const STUDIO_CREDIT_DAY_USD = 1;
/** The packs on sale, in days (one day = one dollar). */
export const STUDIO_CREDIT_PACKS = [5, 10, 20] as const;

// shortcut: one fixed rate for the PKR a customer is asked to send; mirrored in backend studio/plans.ts. Read it from config when the rupee moves.
export const PKR_PER_USD = 280;

/** `workspaces/{id}` as the console reads it. */
export interface StudioWorkspace {
  name: string;
  ownerUid: string;
  ownerEmail: string | null;
  plan: StudioPlanId;
  trialEndsAtMs: number;
  paidUntilMs: number;
  accessUntilMs: number;
  createdAtMs: number;
  brand: {
    name: string;
    what: string;
    audience: string;
    market: string;
    language: string;
    differences: string;
    website: string;
  };
  /** Paused by a Velocity admin. */
  suspended?: boolean;
  /** Credit days bought and not yet used. */
  creditDays?: number;
  /** The Pakistan day the last credit day was spent. */
  creditDayOn?: string;
}

/** `workspaces/{id}/creditLog/{id}`: what the customer sees of their credits — never what a day really cost. */
export interface StudioCreditEntry {
  atMs: number;
  day: string;
  /** +n bought, −1 spent. */
  days: number;
  usd: number;
  why: 'bought' | 'lapsed' | 'allowance';
}

/** `studioUsers/{uid}`: everyone who started a Studio sign-up, finished or not. Admin-only. */
export interface StudioUserDoc {
  uid: string;
  email: string | null;
  name: string | null;
  method: 'google' | 'email';
  emailVerified: boolean;
  createdAtMs: number;
  lastSeenAtMs: number;
  verifiedAtMs?: number;
  workspaceId?: string;
  /** The admin's own note on this customer — here, because the workspace doc is the customer's to read. */
  adminNote?: string;
}

const STUDIO_PERIOD_MS = 30 * 86_400_000;

/**
 * Paid-until once a payment for `plan` is approved: days still paid on another
 * plan carry over at what they were worth. Mirrors `paidAfter` in the backend.
 */
export function studioPaidAfter(
  ws: Pick<StudioWorkspace, 'plan' | 'paidUntilMs'>,
  plan: StudioPlanId,
  billing: StudioBilling,
  nowMs: number,
): number {
  const period = billing === 'year' ? 365 * 86_400_000 : STUDIO_PERIOD_MS;
  const left = ws.paidUntilMs - nowMs;
  if (plan === ws.plan || left <= 0) return Math.max(ws.paidUntilMs, nowMs) + period;
  return nowMs + Math.floor((left * STUDIO_PLANS[ws.plan].usd) / STUDIO_PLANS[plan].usd) + period;
}

export function studioCanUse(
  ws: Pick<StudioWorkspace, 'plan' | 'trialEndsAtMs' | 'paidUntilMs' | 'suspended'>,
  need: StudioNeeds,
  nowMs: number,
): boolean {
  if (ws.suspended) return false;
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) return false;
  return planIncludes(ws.plan, need);
}

/** Whether the plan includes `need` (or any one of several) at all, live or not — for what the nav shows. */
export const planIncludes = (plan: StudioPlanId, need: StudioNeeds): boolean =>
  (typeof need === 'string' ? [need] : need).some((n) => n === 'any' || STUDIO_PLANS[plan].can.includes(n));
