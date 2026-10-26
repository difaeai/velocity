/**
 * Velocity Studio's plans, for the web: prices for the public page, and what a
 * workspace may open for the console. No Firebase here — the sales page at
 * /studio imports it and must stay free of the SDK.
 *
 * Mirrors `backend/functions/src/studio/plans.ts`; the server is what enforces
 * it. Change one, change the other.
 */

export type StudioPlanId = 'sales' | 'content' | 'ads' | 'all';
export type StudioNeed = 'content' | 'ads' | 'sales' | 'any';

export const STUDIO_PLANS: Record<
  StudioPlanId,
  { name: string; usd: number; can: Exclude<StudioNeed, 'any'>[]; tagline: string; includes: string[] }
> = {
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
  content: {
    name: 'Content',
    usd: 24,
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
  // No longer sold: kept so a workspace already on it keeps working.
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
  all: {
    name: 'Meta Ad Expert + Everything',
    usd: 32,
    can: ['content', 'ads', 'sales'],
    tagline: 'The Meta Ad Expert with the whole team: content, ads and sales.',
    includes: [
      'Everything in Sales agents and Content',
      'Meta Ad Expert: plans, writes and launches Facebook & Instagram ads',
      'Watches cost, conversions and ROAS every day — keeps winners, pauses losers',
      'Refreshes tired ads on its own, inside your daily budget limit',
      'Reads the market and your competitors before every move',
    ],
  },
};

/** The plans on sale, left to right as the pricing page shows them. */
export const STUDIO_PLAN_IDS: StudioPlanId[] = ['sales', 'content', 'all'];

/** The "From $… a month" the pages quote: the cheapest plan on sale. */
export const STUDIO_FROM_USD = Math.min(...STUDIO_PLAN_IDS.map((id) => STUDIO_PLANS[id].usd));

/** Paid a month at a time, or a year up front for less. */
export type StudioBilling = 'month' | 'year';
export const STUDIO_YEAR_DISCOUNT_PCT = 13;

/** A year is twelve months less 13%, rounded down so the saving is never under 13%. */
export const studioPriceUsd = (plan: StudioPlanId, billing: StudioBilling): number =>
  billing === 'year'
    ? Math.floor((STUDIO_PLANS[plan].usd * 12 * (100 - STUDIO_YEAR_DISCOUNT_PCT)) / 100)
    : STUDIO_PLANS[plan].usd;

export const STUDIO_TRIAL_HOURS = 24;

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
  need: StudioNeed,
  nowMs: number,
): boolean {
  if (ws.suspended) return false;
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) return false;
  return need === 'any' || STUDIO_PLANS[ws.plan].can.includes(need);
}

/** Whether the plan includes `need` at all, live or not — for what the nav shows. */
export const planIncludes = (plan: StudioPlanId, need: StudioNeed): boolean =>
  need === 'any' || STUDIO_PLANS[plan].can.includes(need);
