/**
 * Velocity Studio's plans, for the web: prices for the public page, and what a
 * workspace may open for the console. No Firebase here — the sales page at
 * /studio imports it and must stay free of the SDK.
 *
 * Mirrors `backend/functions/src/studio/plans.ts`; the server is what enforces
 * it. Change one, change the other.
 */

export type StudioPlanId = 'content' | 'ads' | 'all';
export type StudioNeed = 'content' | 'ads' | 'sales' | 'any';

export const STUDIO_PLANS: Record<
  StudioPlanId,
  { name: string; usd: number; can: Exclude<StudioNeed, 'any'>[]; tagline: string; includes: string[] }
> = {
  content: {
    name: 'Content',
    usd: 19,
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
  ads: {
    name: 'Meta Ad Expert',
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
    name: 'Everything',
    usd: 32,
    can: ['content', 'ads', 'sales'],
    tagline: 'Content, the Meta Ad Expert and a sales agent — the whole team.',
    includes: [
      'Everything in Content',
      'Meta Ad Expert: runs and improves your ads every day',
      'A sales funnel built from your market analysis',
      'Sales agent: finds leads, emails them, follows up twice',
      'Every reply answered with a draft you send in one tap',
    ],
  },
};

export const STUDIO_PLAN_IDS = Object.keys(STUDIO_PLANS) as StudioPlanId[];

export const STUDIO_TRIAL_HOURS = 24;

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
}

export function studioCanUse(
  ws: Pick<StudioWorkspace, 'plan' | 'trialEndsAtMs' | 'paidUntilMs'>,
  need: StudioNeed,
  nowMs: number,
): boolean {
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) return false;
  return need === 'any' || STUDIO_PLANS[ws.plan].can.includes(need);
}

/** Whether the plan includes `need` at all, live or not — for what the nav shows. */
export const planIncludes = (plan: StudioPlanId, need: StudioNeed): boolean =>
  need === 'any' || STUDIO_PLANS[plan].can.includes(need);
