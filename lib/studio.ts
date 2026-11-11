/**
 * Velocity Studio's plans, for the web: prices for the public page, and what a
 * workspace may open for the console. No Firebase here — the sales page at
 * /studio imports it and must stay free of the SDK.
 *
 * Mirrors `backend/functions/src/studio/plans.ts`; the server is what enforces
 * it. Change one, change the other.
 */

import type { SocialPlatform } from './api';

export type StudioPlanId = 'research' | 'content' | 'all' | 'sales' | 'ads';
export type StudioNeed = 'research' | 'content' | 'ads' | 'sales' | 'any';
/** One part of a plan, or several of which any one will do — a page two plans share. */
export type StudioNeeds = StudioNeed | readonly StudioNeed[];

export const STUDIO_PLANS: Record<
  StudioPlanId,
  {
    name: string;
    usd: number;
    can: Exclude<StudioNeed, 'any'>[];
    tagline: string;
    /** On a plan on sale: Vexa's own words from the plan's line in siteVoice.json, in her order (PlanJobs lights each as she says it). */
    includes: string[];
  }
> = {
  research: {
    name: 'Research Assistant for Social Media',
    usd: 20,
    can: ['research'],
    tagline: 'Researches your market and tests every campaign for free, before you spend.',
    includes: [
      'I read your market and your competitors',
      'I study your Instagram and Facebook',
      'I test every campaign on a simulated audience',
      'You see what works before you spend',
    ],
  },
  content: {
    name: 'Content',
    usd: 26,
    can: ['content'],
    tagline: 'Your social media team, posting every day.',
    includes: [
      'I plan thirty days ahead',
      'I make your reels, posts and stories',
      'I post them at your time every day',
      'I answer your comments',
    ],
  },
  all: {
    name: 'Social Media Manager + Meta & Google Ad Expert',
    usd: 32,
    can: ['research', 'content', 'ads', 'sales'],
    tagline: 'The whole team: research, content, Meta & Google ads, and sales by email and phone.',
    includes: [
      'I analyse your product',
      'I study your competition',
      'I plan your campaigns',
      'I make your content and videos, and post them every day',
      'I run your Facebook and Instagram ads inside your daily limit',
      'I read your Google ads beside them',
      'I reply to the comments on your posts',
      'I find new buyers, email each one from your own mailbox, and follow up',
      'All on my own, with no human intervention',
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

/**
 * The title on Velocity's bank account, exactly as the bank prints it: the one
 * word, not the company's long legal name (owner, 2026-11-11). It is the only
 * way Vexa is paid: the mobile wallets in `config/settlementAccounts` are the
 * rides side's.
 * shortcut: in code rather than in that document — move it there if the
 * company's bank account is ever held in another name.
 */
export const STUDIO_BANK_TITLE = 'Berreto';

/** Paid a month at a time, or a year up front for less. */
export type StudioBilling = 'month' | 'year';
export const STUDIO_YEAR_DISCOUNT_PCT = 3;

/** What a month of any plan costs more once a customer's own 3 days are over (backend studio/priceClock.ts). Mirrors the backend. */
export const STUDIO_PRICE_RISE_USD = 2;
/** How long each visitor keeps today's price. Mirrors the backend. */
export const STUDIO_PRICE_WINDOW_MS = 3 * 86_400_000;

/** A year is twelve months less exactly 3%, to the cent — never more (owner); a month is never discounted. Mirrors backend priceUsd. */
export const studioPriceUsd = (plan: StudioPlanId, billing: StudioBilling, raised = false): number => {
  const month = STUDIO_PLANS[plan].usd + (raised ? STUDIO_PRICE_RISE_USD : 0);
  return billing === 'year' ? Math.round(month * 12 * (100 - STUDIO_YEAR_DISCOUNT_PCT)) / 100 : month;
};

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

/** A price in the visitor's own money. `exact` is false when a floating rate makes it a guide, not the amount owed. */
export interface StudioMoney {
  text: string;
  exact: boolean;
}

/**
 * The money each place is quoted in. Every plan is priced in dollars; Pakistan
 * is quoted in the rupees it is actually asked to send, the pegged Gulf
 * currencies convert exactly, and a floating currency is a guide shown beside
 * the dollars that are really charged. Everywhere else sees dollars.
 *
 * shortcut: fixed rates, read 2026-11-11 — the pegs hold, EUR and GBP drift,
 * which is why those two are never presented as the amount owed. Move them to
 * `config` or an FX feed if the drift starts to matter.
 */
const MONEY: readonly { code: string; per: number; exact: boolean; zones: readonly string[] }[] = [
  { code: 'PKR', per: PKR_PER_USD, exact: true, zones: ['Asia/Karachi'] },
  { code: 'AED', per: 3.6725, exact: true, zones: ['Asia/Dubai'] },
  { code: 'SAR', per: 3.75, exact: true, zones: ['Asia/Riyadh'] },
  { code: 'GBP', per: 0.74, exact: false, zones: ['Europe/London'] },
  {
    code: 'EUR',
    per: 0.87,
    exact: false,
    // The euro's own clocks. A country that keeps its own money (Zurich, Prague, Warsaw…) is not here, and sees dollars.
    zones: [
      'Europe/Dublin', 'Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris', 'Europe/Brussels', 'Europe/Amsterdam',
      'Europe/Luxembourg', 'Europe/Berlin', 'Europe/Rome', 'Europe/Vienna', 'Europe/Ljubljana', 'Europe/Bratislava',
      'Europe/Zagreb', 'Europe/Athens', 'Europe/Nicosia', 'Europe/Helsinki', 'Europe/Tallinn', 'Europe/Riga',
      'Europe/Vilnius', 'Europe/Malta', 'Europe/Monaco', 'Europe/Andorra', 'Europe/San_Marino', 'Europe/Vatican',
      'Europe/Podgorica', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores',
    ],
  },
];

/**
 * `usd` as the money of whoever is looking, from the IANA zone their browser
 * keeps (`useStudioMoney` reads it). An unknown zone — and the server, which
 * cannot know — gets dollars, which is what the plan is priced in anyway.
 */
export const studioMoney = (usd: number, zone: string): StudioMoney => {
  const m = MONEY.find((x) => x.zones.includes(zone));
  if (!m) return { text: studioUsd(usd), exact: true };
  if (m.code === 'PKR') return { text: `Rs ${studioPkr(usd).toLocaleString('en-PK')}`, exact: true };
  const amount = Math.round(usd * m.per * 100) / 100;
  return {
    text: new Intl.NumberFormat('en', {
      style: 'currency',
      currency: m.code,
      currencyDisplay: 'narrowSymbol',
      // No ".00" on a round figure, as the dollar price is written.
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount),
    exact: m.exact,
  };
};

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
  /** The networks chosen at sign-up: the console asks to connect these first. */
  platforms?: SocialPlatform[];
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
