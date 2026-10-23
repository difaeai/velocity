/**
 * Velocity Studio's plans, and what each one lets a workspace do.
 *
 * A customer gets exactly what they pay for and nothing else: the content desk,
 * the Meta Ad Expert, or both plus the sales agent. Every check that matters runs on
 * the server (`social/workspace.ts`); the console only hides what a plan does
 * not include. Pure, so the rules are tested without a database.
 *
 * Mirrored for the web in `lib/studio.ts` — change one, change the other.
 */

export type PlanId = 'content' | 'ads' | 'all';
export type Need = 'content' | 'ads' | 'sales' | 'any';

export const PLANS: Record<PlanId, { name: string; usd: number; can: Exclude<Need, 'any'>[] }> = {
  content: { name: 'Content', usd: 19, can: ['content'] },
  ads: { name: 'Meta Ad Expert', usd: 24, can: ['ads'] },
  all: { name: 'Everything', usd: 32, can: ['content', 'ads', 'sales'] },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** One free day, then a plan has to be paid for. */
export const TRIAL_MS = 24 * 3600_000;
/** What one approved payment buys. */
export const PERIOD_MS = 30 * 86_400_000;

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
}

/** Whether this workspace may do this, now. */
export function canUse(ws: Pick<Workspace, 'plan' | 'trialEndsAtMs' | 'paidUntilMs'>, need: Need, nowMs: number): boolean {
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) return false;
  return need === 'any' || PLANS[ws.plan].can.includes(need);
}

/** Why not, in words the customer can act on. Null when they can. */
export function refusal(
  ws: Pick<Workspace, 'plan' | 'trialEndsAtMs' | 'paidUntilMs'>,
  need: Need,
  nowMs: number,
): string | null {
  if (canUse(ws, need, nowMs)) return null;
  if (Math.max(ws.trialEndsAtMs, ws.paidUntilMs) <= nowMs) {
    return ws.paidUntilMs
      ? 'Your Velocity Studio plan has run out. Pay for the next month on the Billing page to carry on.'
      : 'Your free day is over. Choose a plan and pay on the Billing page to carry on.';
  }
  const what = need === 'ads' ? 'the Meta Ad Expert' : need === 'sales' ? 'the sales agent' : 'the content team';
  return `Your ${PLANS[ws.plan].name} plan does not include ${what}. Upgrade on the Billing page.`;
}

/**
 * The new paid-until after one approved payment: a month from whichever is
 * later, now or the end of what is already paid — so paying early never loses
 * days, and paying late does not back-date the month.
 */
export function extendPaid(paidUntilMs: number, nowMs: number): number {
  return Math.max(paidUntilMs, nowMs) + PERIOD_MS;
}
