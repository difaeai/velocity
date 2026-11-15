/**
 * The desk marking its own homework, every five days.
 *
 * Everything else here decides what to make and makes it. `insights.ts` says
 * which pieces travelled. Nothing until now asked the only question a customer
 * actually pays for an answer to: **is this working, and if not, why not?**
 *
 * So every five days — and whenever somebody presses the button — the desk puts
 * its own work in front of itself and answers, in this order:
 *
 *  1. **Was the job done at all?** What the owner's settings promised against
 *     what actually went out. A piece that sat in the queue for five days did
 *     not happen, however good it was.
 *  2. **Did it reach anybody, and if not, why?** Not a shrug about the
 *     algorithm: a ladder of causes, each one only reported when this account's
 *     own numbers show it — nothing published, no reels, weak openings, nothing
 *     being forwarded, a profile strangers do not follow, a feed that went
 *     quiet.
 *  3. **Is the money the right size?** What was spent against what Meta's
 *     learning phase actually needs (`adsExpert.learningBudget`) and what the
 *     owner allows. Under-spending is the commonest waste there is: a budget
 *     too thin to leave learning buys nothing at all.
 *  4. **What is somebody else doing better?** The competitor accounts already
 *     read through Business Discovery, compared per thousand followers so a big
 *     account and a small one can be compared at all.
 *  5. **What changes now?** The findings are ranked, each with the numbers it
 *     came from and the fix, and the ones the desk can act on itself are
 *     written into `settings.learned` — which `crew.ts` renders into every
 *     employee's prompt on every job from that moment. That is the part that
 *     matters: the owner is not asked to do anything with this report. The desk
 *     reads it, and the next five days are different.
 *
 * **And the desk gets better at businesses it has never seen.** Each review's
 * lessons are merged into `vexaLessons/{industry}` — shared across every
 * workspace, which is the point: the twentieth estate agent to sign up should
 * not start where the first one did. What crosses that line is deliberately
 * thin, and enforced in code by `scrubLesson`: shapes only, no client name, no
 * handle, no URL, and no figure big enough to identify anybody. A new
 * workspace is seeded from it on day one (`launch.ts`, step content), so Vexa
 * turns up to a new estate agent already knowing what works for estate agents.
 *
 * Nothing here calls a network: every number comes from what the desk already
 * stored — free reads of documents the daily jobs write anyway. One model call
 * turns the findings into the paragraph a person reads, and with no key the
 * same paragraph is assembled from the findings in code. The arithmetic that
 * decides the score, the findings and the directives is pure and tested, which
 * is the half that must not be a model's opinion: a review that quietly
 * invents a shortcoming teaches the desk the wrong lesson for a month.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { dayKey } from '../analytics';
import { db, SCHEDULE_REGION } from '../lib/firebase';
import type { Brand } from '../studio/plans';
import { learningBudget, marketBenchmarks, money, type AdObjective, type Benchmarks } from './adsExpert';
import { brandBlock, briefBlock, hardRules, standingInstructions } from './crew';
import { activeTeam, assign } from './employees';
import { activeEngine, generateJson, modelReady } from './engine';
import { latestPageRead, type PageRead, type ProfileAudit, type RankedPost } from './insights';
import { getSocialSettings, patchSettings } from './settings';
import { planRef, type MonthPlan } from './strategy';
import type { AccountRead, ContentResearch, LearnedDirectives, SocialPost, SocialSettings } from './types';
import { currentWorkspace, forEachWorkspace, deskCall, isHouse, sdb, workspaceBrand } from './workspace';

const DAY = 86_400_000;

/** How many days one review looks at, and how often it runs. */
export const WINDOW_DAYS = 5;

/** The latest review. One document: the console reads it back, the history rides inside it. */
const REVIEW_PATH = 'socialInsights/review';
/** What the desk has learned about one kind of business, across every workspace. Never scoped. */
export const lessonsRef = (industry: Industry) => db.doc(`vexaLessons/${industry}`);

// ── what kind of business this is ───────────────────────────────────────────

export const INDUSTRIES = [
  'real-estate',
  'food',
  'retail-fashion',
  'beauty',
  'fitness',
  'health',
  'education',
  'travel',
  'transport',
  'ecommerce',
  'software',
  'auto',
  'home-services',
  'finance',
  'other',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/**
 * The words that put a business in one of them, first match wins — so the
 * order matters: "property investment" is an estate agent, not a bank, and a
 * bakery is food before it is retail.
 *
 * A keyword list rather than a model call on purpose. It runs on every review
 * and every sign-up, it has to give the same answer twice, and a model that
 * files one estate agent under `real-estate` and the next under `finance`
 * splits the very pile this exists to build.
 */
const INDUSTRY_WORDS: [Industry, string[]][] = [
  ['real-estate', ['real estate', 'realestate', 'property', 'properties', 'estate agent', 'realtor', 'housing society', 'plot', 'apartment', 'landlord', 'letting']],
  ['food', ['restaurant', 'cafe', 'coffee', 'bakery', 'bakers', 'food', 'catering', 'pizza', 'burger', 'biryani', 'kitchen', 'sweets', 'dhaba', 'tea brand']],
  ['beauty', ['salon', 'spa', 'beauty', 'skincare', 'skin care', 'cosmetic', 'makeup', 'barber', 'hair studio', 'nails']],
  ['fitness', ['gym', 'fitness', 'workout', 'personal trainer', 'crossfit', 'yoga', 'pilates', 'sports club']],
  ['health', ['clinic', 'hospital', 'doctor', 'dentist', 'dental', 'physio', 'pharmacy', 'medical', 'therapist', 'diagnostic', 'lab test']],
  ['education', ['school', 'academy', 'tuition', 'tutor', 'coaching', 'college', 'university', 'course', 'training institute', 'learning', 'students']],
  ['travel', ['hotel', 'travel agency', 'tour', 'tours', 'resort', 'guest house', 'umrah', 'hajj', 'visa', 'holiday', 'trip package']],
  ['transport', ['ride-hailing', 'ride hailing', 'taxi', 'cab', 'courier', 'delivery service', 'logistics', 'freight', 'cargo', 'transport', 'movers', 'rent a car']],
  ['auto', ['car dealer', 'car showroom', 'workshop', 'garage', 'auto parts', 'spare parts', 'bike shop', 'motorcycle', 'tyres', 'car wash', 'denting']],
  ['home-services', ['plumber', 'electrician', 'cleaning service', 'pest control', 'interior design', 'carpenter', 'painter', 'ac service', 'renovation', 'construction', 'solar install']],
  ['retail-fashion', ['clothing', 'clothes', 'fashion', 'boutique', 'lawn collection', 'unstitched', 'shoes', 'jewellery', 'jewelry', 'furniture', 'retail', 'shop', 'store', 'brand of']],
  ['ecommerce', ['ecommerce', 'e-commerce', 'online store', 'online shop', 'dropship', 'marketplace seller', 'woocommerce', 'shopify']],
  ['software', ['software', 'saas', 'app development', 'mobile app', 'web development', 'it company', 'agency', 'marketing agency', 'startup', 'platform for', 'crm']],
  ['finance', ['insurance', 'takaful', 'accounting', 'accountant', 'tax', 'loan', 'investment', 'brokerage', 'financial']],
];

/** Which pile this business belongs in. Velocity's own desk is transport. Pure. */
export function industryOf(brand: Brand | null): Industry {
  if (!brand) return 'transport';
  const hay = [brand.what, brand.audience, brand.differences, brand.name].join(' ').toLowerCase();
  for (const [industry, words] of INDUSTRY_WORDS) {
    if (words.some((w) => hay.includes(w))) return industry;
  }
  return 'other';
}

// ── the shapes ──────────────────────────────────────────────────────────────

export type Severity = 'blocking' | 'big' | 'small';

/** One thing that is wrong, what says so, and what to do about it. */
export interface Finding {
  /** Stable, so the same shortcoming coming back twice is recognisable. */
  id: string;
  severity: Severity;
  /** What is wrong, one line, no jargon. */
  what: string;
  /** The numbers it was concluded from. Never empty: a finding with no evidence is a guess. */
  evidence: string;
  /** What fixes it. */
  fix: string;
  /** Who can act: the desk itself, or only the owner. */
  who: 'vexa' | 'you';
}

export interface Delivery {
  /** What the settings promised over the window. */
  expected: number;
  made: number;
  published: number;
  /** Finished and waiting for an Approve that never came. */
  waiting: number;
  failed: number;
  /** Days in the window with nothing published. */
  quietDays: number;
}

export interface ReachRead {
  /** Measured posts inside the window. */
  sampled: number;
  medianReach: number;
  /** The same length of time before it, for a trend. 0 when there is no before. */
  beforeMedian: number;
  /** Percent change against that. Null when there is nothing to compare with. */
  trendPct: number | null;
  medianHookScore: number;
  /** Sends and saves per thousand reached, median over the window. */
  sendRate: number;
  saveRate: number;
  /** Reels published in the window: the only format that reaches non-followers. */
  reels: number;
  profileScore: number | null;
}

export interface SpendRead {
  currency: string;
  /** What went out over the window. */
  spent: number;
  /** What it needed to be for the campaigns that ran to mean anything. */
  shouldHave: number;
  /** The owner's own daily limit, and what the running campaigns commit of it. */
  dailyCap: number;
  committed: number;
  ctr: number | null;
  ctrLow: number | null;
  running: number;
  wasting: number;
  learning: number;
  winning: number;
  /** Whether the size of the money is the problem, in one line. */
  verdict: string;
}

export interface CompetitorGap {
  /** Likes and comments per thousand followers — the only way a big account and a small one compare. */
  oursPerK: number | null;
  theirsPerK: number | null;
  /** The account read that is ahead of us, by handle, for the owner to look at. */
  ahead: string | null;
  /** What is earning them reach, as shapes: "reels — 4 of their 6 best". */
  theirShapes: string[];
  /** Their best openings, for the writer to learn the shape from. Never copied, never attributed. */
  theirHooks: string[];
}

/** The sales funnel at the moment the review ran (`closer.ts`). */
export interface SalesRead {
  /** Conversations open right now. */
  live: number;
  /** Sitting in needs_you: a person has to answer them, and nobody has. */
  waiting: number;
  /** Closed inside the window. */
  won: number;
  lost: number;
  /** Queued sheet rows not yet opened. */
  queued: number;
}

export interface Review {
  atMs: number;
  date: string;
  windowDays: number;
  engine: string;
  industry: Industry;
  /** Out of 100, over the dimensions that could be judged at all. */
  score: number;
  previousScore: number | null;
  /** The owner's own goal, as it stood when this ran. */
  goal: string;
  /** Whether anything in the account can actually show that goal moving. */
  measurable: boolean;
  delivery: Delivery;
  reach: ReachRead;
  /** Null with no ad account connected. */
  spend: SpendRead | null;
  /** Null until some other account has been read. */
  competitors: CompetitorGap | null;
  /** Null with no WhatsApp number connected: there is no funnel to read. */
  sales: SalesRead | null;
  /** Worst first. */
  findings: Finding[];
  /** The report, in the words of whoever on the team wrote it. */
  summary: string;
  /** What the desk now does differently, without being asked. */
  directives: LearnedDirectives;
  /** Score over time, oldest first, at most 12 — so "are we improving" has an answer. */
  history: { atMs: number; score: number }[];
  error: string | null;
}

/** Everything a review is decided from: documents the desk already wrote. */
export interface ReviewInput {
  nowMs: number;
  settings: SocialSettings;
  /** This month's plan, for the goal it set itself. */
  plan: MonthPlan | null;
  /** Every piece whose date falls inside the window. */
  posts: SocialPost[];
  read: PageRead | null;
  audit: ProfileAudit | null;
  ads: AdsRead | null;
  /** Other accounts, as the morning research last read them. */
  accounts: AccountRead[];
  /** The owner's store, when one is connected: orders over the last week. */
  storeOrders: number | null;
  /** Followers, from the profile audit, for the competitor comparison. */
  followers: number | null;
  /** The WhatsApp funnel, or null with no number connected. */
  sales: SalesRead | null;
}

/**
 * The ads side as `ads.ts` stores it at `system/socialAds`. Declared here
 * rather than imported so a review never drags the whole Meta client in: it
 * reads documents, it does not talk to Meta.
 */
export interface AdsRead {
  currency: string;
  dailyCap: number;
  committed: number;
  /** Account spend by Pakistan date, last 14 days. */
  daily: { date: string; spend: number }[];
  /** The week for the whole account: CTR is the one that scores the creative. */
  ctr: number | null;
  /** Sales, leads or chats Meta could actually see over that week. */
  conversions: number;
  /**
   * What the owner said one sale or enquiry is worth. Zero means they have not
   * said, and Meta cannot value a lead form or a WhatsApp chat on its own — so
   * zero, with no store and no pixel conversions, is a goal about money that
   * nothing in the account can count.
   */
  valuePerConversion: number;
  bench: Benchmarks | null;
  /** Every campaign as the three-hourly sync last judged it. */
  campaigns: { objective: AdObjective; grade: string; active: boolean }[];
}

// ── the arithmetic ──────────────────────────────────────────────────────────

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const round = (n: number, dp = 1): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** The Pakistan dates the window covers, oldest first, today last. Pure. */
export function windowDates(nowMs: number, days = WINDOW_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => dayKey(nowMs - (days - 1 - i) * DAY));
}

/** What the settings promised over the window: the rotation, plus a story a day. Pure. */
export function expectedPieces(settings: SocialSettings, days = WINDOW_DAYS): number {
  if (!settings.enabled) return 0;
  return (Math.max(1, settings.postsPerDay) + (settings.dailyStory ? 1 : 0)) * days;
}

const PUBLISHED = new Set(['published', 'partial']);
const WAITING = new Set(['awaiting_approval', 'changes_requested', 'ready']);

/** What actually happened to the window's pieces. Pure. */
export function delivery(posts: SocialPost[], dates: string[], settings: SocialSettings): Delivery {
  const published = posts.filter((p) => PUBLISHED.has(p.status));
  const live = new Set(published.map((p) => p.date));
  return {
    expected: expectedPieces(settings, dates.length),
    made: posts.length,
    published: published.length,
    waiting: posts.filter((p) => WAITING.has(p.status)).length,
    failed: posts.filter((p) => p.status === 'failed' || p.status === 'rejected').length,
    quietDays: dates.filter((d) => !live.has(d)).length,
  };
}

/** The window's own posts out of everything the page read ranked. Pure. */
export function inWindow(ranked: RankedPost[], nowMs: number, days = WINDOW_DAYS): RankedPost[] {
  return ranked.filter((p) => p.postedAtMs > nowMs - days * DAY);
}

/** And the same length of time before it, which is what a trend needs. Pure. */
export function beforeWindow(ranked: RankedPost[], nowMs: number, days = WINDOW_DAYS): RankedPost[] {
  const from = nowMs - 2 * days * DAY;
  const to = nowMs - days * DAY;
  return ranked.filter((p) => p.postedAtMs > from && p.postedAtMs <= to);
}

/** How the window's own posts did, and against what came before. Pure. */
export function reachRead(input: {
  read: PageRead | null;
  audit: ProfileAudit | null;
  posts: SocialPost[];
  nowMs: number;
  days?: number;
}): ReachRead {
  const days = input.days ?? WINDOW_DAYS;
  const all = [...(input.read?.best ?? []), ...(input.read?.worst ?? [])];
  // best and worst overlap on a short account: the same post must not be counted twice.
  const unique = [...new Map(all.map((p) => [p.mediaId, p])).values()];
  const mine = inWindow(unique, input.nowMs, days);
  const before = beforeWindow(unique, input.nowMs, days);
  const medianReach = Math.round(median(mine.map((p) => p.reach)));
  const beforeMedian = Math.round(median(before.map((p) => p.reach)));
  return {
    sampled: mine.length,
    medianReach,
    beforeMedian,
    trendPct: beforeMedian > 0 && mine.length ? Math.round(((medianReach - beforeMedian) / beforeMedian) * 100) : null,
    medianHookScore: Math.round(median(mine.map((p) => p.hookScore))),
    sendRate: round(median(mine.map((p) => p.sendRate))),
    saveRate: round(median(mine.map((p) => p.saveRate))),
    // From the pieces themselves, not the insights: a reel that went out today
    // has no numbers yet and still counts as a reel that went out.
    reels: input.posts.filter((p) => p.format === 'reel' && PUBLISHED.has(p.status)).length,
    profileScore: input.audit && !input.audit.error ? input.audit.score : null,
  };
}

/**
 * What the money should have been.
 *
 * Meta's learning phase needs about fifty results a week before a campaign's
 * numbers settle; below that the spend buys an unsteered guess. So the
 * yardstick is `learningBudget` for each campaign that actually ran, over the
 * window — held to the owner's own daily limit, because the desk may never
 * recommend spending more than they allowed. Pure.
 */
export function spendRead(ads: AdsRead, dates: string[]): SpendRead {
  const days = dates.length;
  const inside = new Set(dates);
  const spent = round(ads.daily.filter((d) => inside.has(d.date)).reduce((n, d) => n + d.spend, 0), 2);
  const live = ads.campaigns.filter((c) => c.active && c.grade !== 'idle');
  const bench = ads.bench ?? marketBenchmarks(ads.currency);
  const perDay = bench
    ? live.length
      ? live.reduce((n, c) => n + learningBudget(c.objective, bench), 0)
      : learningBudget('traffic', bench)
    : 0;
  // Never above what the owner allows: their limit is the ceiling on advice too.
  const shouldHave = Math.round(Math.min(perDay, ads.dailyCap > 0 ? ads.dailyCap : perDay) * days);
  const grades = (g: string) => ads.campaigns.filter((c) => c.active && c.grade === g).length;
  const $ = (n: number) => money(n, ads.currency);

  const ctrLow = bench ? round(bench.ctr.low, 2) : null;
  const verdict = !live.length
    ? ads.dailyCap > 0
      ? `Nothing ran. You allow ${$(ads.dailyCap)} a day and none of it was spent, so the ads brought nobody.`
      : 'Nothing ran, and no daily limit is set, so the ad desk cannot spend anything.'
    : spent < shouldHave * 0.6
      ? `Too thin to learn: ${$(spent)} over ${days} days where ${$(shouldHave)} is what these ${live.length} campaign${
          live.length === 1 ? '' : 's'
        } needed to leave Meta's learning phase. Money spent below that buys an unsteered guess.`
      : ads.ctr !== null && ctrLow !== null && ads.ctr < ctrLow
        ? `The size of the money is fine (${$(spent)} over ${days} days); the ads themselves are the problem — ${ads.ctr}% of people who saw them tapped, against ${ctrLow}% at the bottom of this market's normal range. A bigger budget buys more of the same ignoring.`
        : grades('bad') > 0
          ? `${$(spent)} over ${days} days, and ${grades('bad')} campaign${grades('bad') === 1 ? ' is' : 's are'} losing money. The desk pauses and replaces those itself.`
          : `${$(spent)} over ${days} days, which is the right size for what ran.`;

  return {
    currency: ads.currency,
    spent,
    shouldHave,
    dailyCap: ads.dailyCap,
    committed: ads.committed,
    ctr: ads.ctr,
    ctrLow,
    running: live.length,
    wasting: grades('bad'),
    learning: grades('learning'),
    winning: grades('good'),
    verdict,
  };
}

/**
 * Us against the accounts the morning read looked at, per thousand followers.
 *
 * Raw likes compare nothing: an account ten times our size doing twice our
 * numbers is doing badly. Null when neither side has numbers to compare. Pure.
 */
export function competitorGap(params: {
  accounts: AccountRead[];
  ranked: RankedPost[];
  followers: number | null;
  nowMs: number;
  days?: number;
}): CompetitorGap | null {
  const theirs = params.accounts.filter((a) => a.followers > 0 && a.medianEngagement > 0);
  if (!theirs.length) return null;

  const mine = inWindow(params.ranked, params.nowMs, params.days ?? WINDOW_DAYS);
  // likes was added to the ranking in November 2026; a read stored before it
  // has none, and a comparison against zero would read as a thrashing.
  const ourEngagement = median(mine.map((p) => (p.likes ?? 0) + p.comments).filter((n) => n > 0));
  const oursPerK = params.followers && params.followers > 0 && ourEngagement > 0 ? round((ourEngagement / params.followers) * 1000) : null;

  const rated = theirs
    .map((a) => ({ a, perK: (a.medianEngagement / a.followers) * 1000 }))
    .sort((x, y) => y.perK - x.perK);
  const best = rated[0];

  const formats = new Map<string, number>();
  const hooks: string[] = [];
  for (const { a } of rated) {
    for (const t of a.top) {
      const kind = t.mediaType === 'VIDEO' || t.mediaType === 'REELS' ? 'reels' : t.mediaType === 'CAROUSEL_ALBUM' ? 'carousels' : 'single pictures';
      formats.set(kind, (formats.get(kind) ?? 0) + 1);
      const line = t.caption.split('\n')[0]?.trim() ?? '';
      if (line && hooks.length < 5) hooks.push(line.slice(0, 140));
    }
  }
  const total = [...formats.values()].reduce((a, b) => a + b, 0);

  return {
    oursPerK,
    theirsPerK: round(best.perK),
    ahead: oursPerK !== null && best.perK > oursPerK ? best.a.username : null,
    theirShapes: [...formats.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => `${kind} — ${n} of the ${total} posts beating their own normal`),
    theirHooks: hooks,
  };
}

/** Whether anything in this account could show the owner's goal moving. Pure. */
export function measurable(input: Pick<ReviewInput, 'settings' | 'ads' | 'storeOrders' | 'read'>): boolean {
  const goal = input.settings.goal.toLowerCase();
  const wantsSales = /sale|sell|order|revenue|profit|lead|enquir|inquir|booking|customer|client/.test(goal);
  if (!goal.trim()) return false;
  // A connected ad account is not a way of counting sales: Meta cannot see an
  // order unless a pixel tells it, and it cannot value a lead or a chat unless
  // the owner says what one is worth. So: a store, a price on a conversion, or
  // conversions Meta really reported.
  if (wantsSales) {
    return input.storeOrders !== null || (input.ads?.valuePerConversion ?? 0) > 0 || (input.ads?.conversions ?? 0) > 0;
  }
  // A reach or name goal is measured by the page read, which every connected account gives us.
  return Boolean(input.read && !input.read.error && input.read.sampled > 0);
}

/** A hook panel score below this is the opening line's fault, not the algorithm's. */
export const WEAK_HOOK = 55;
/** Sends per thousand reached below this means nobody forwarded anything. */
export const WEAK_SEND_RATE = 1;
/** A profile scoring below this loses the strangers the posts bring. */
export const WEAK_PROFILE = 55;

const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, big: 1, small: 2 };

/**
 * The dig. Every check that fires names the numbers it fired on, and no check
 * fires without them — "post more reels" with no reel data is the kind of
 * advice that makes a report worthless. Worst first. Pure.
 */
export function findingsFor(input: {
  settings: SocialSettings;
  delivery: Delivery;
  reach: ReachRead;
  spend: SpendRead | null;
  competitors: CompetitorGap | null;
  sales?: SalesRead | null;
  measurable: boolean;
  posts: SocialPost[];
  days: number;
}): Finding[] {
  const f: Finding[] = [];
  const d = input.delivery;
  const r = input.reach;
  const add = (x: Finding) => f.push(x);

  // ── was the job done ──
  if (!input.settings.enabled) {
    add({
      id: 'desk_off',
      severity: 'blocking',
      what: 'The desk is switched off, so nothing was made or posted at all.',
      evidence: `Automation off for the whole of the last ${input.days} days.`,
      fix: 'Turn the desk on in Settings. Nothing else in this review can improve while it is off.',
      who: 'you',
    });
  } else if (d.published === 0) {
    add({
      id: 'nothing_published',
      severity: 'blocking',
      what: 'Nothing reached anybody: not one piece went out.',
      evidence: `${d.made} pieces made, ${d.published} published, ${d.waiting} waiting for an Approve, ${d.failed} failed, over ${input.days} days.`,
      fix: d.waiting
        ? 'Everything finished is sitting in the queue waiting for you. Approve them, or switch on "Post on its own" so the desk publishes without waiting.'
        : d.made === 0
          ? 'The team made nothing. Check that somebody is hired and an account is connected.'
          : 'Publishing failed. Reconnect the account on Connected accounts.',
      who: 'you',
    });
  } else if (d.expected > 0 && d.published < d.expected * 0.7) {
    add({
      id: 'under_delivered',
      severity: 'big',
      what: `Only ${d.published} of the ${d.expected} pieces your settings promised went out.`,
      evidence: `${d.made} made, ${d.published} published, ${d.waiting} waiting for an Approve, ${d.failed} failed. ${d.quietDays} of ${input.days} days had nothing on the feed.`,
      fix: d.waiting > d.failed
        ? 'The gap is approvals, not the team: switch on "Post on its own", or clear the queue every day.'
        : 'The gap is failures. Check the connected accounts and the last error on the queue.',
      who: 'you',
    });
  }

  if (d.published > 0 && d.quietDays >= 3) {
    add({
      id: 'feed_quiet',
      severity: 'big',
      what: `The feed went quiet: ${d.quietDays} of ${input.days} days had nothing on it.`,
      evidence: `Published on ${input.days - d.quietDays} of ${input.days} days.`,
      fix: 'A feed with gaps is shown to fewer of its own followers. Make the calendar ahead of time so a bad day is still covered.',
      who: 'vexa',
    });
  }

  // ── can anybody tell whether it worked ──
  if (!input.settings.goal.trim()) {
    add({
      id: 'no_goal',
      severity: 'big',
      what: 'Nobody has said what all this is for, so "is it working" has no answer.',
      evidence: 'The goal box is empty, and every employee reads it on every job.',
      fix: 'Write one sentence in Settings: sales, enquiries, or being known. The team writes differently for each.',
      who: 'you',
    });
  } else if (!input.measurable) {
    add({
      id: 'not_measurable',
      severity: 'big',
      what: 'Your goal is about money, and nothing here can count money.',
      evidence: `The goal says "${input.settings.goal.slice(0, 80)}" and there is no store connected and no ad account reporting results.`,
      fix: 'Connect your store on Connected accounts, or tell the Ads page what one sale or enquiry is worth. Until then every judgement here is about reach, not revenue.',
      who: 'you',
    });
  }

  // ── reach, cause by cause ──
  if (r.sampled < 3) {
    add({
      id: 'too_new',
      severity: 'small',
      what: 'There are too few measured posts to say anything about reach yet.',
      evidence: `${r.sampled} posts in the window have numbers back from the network.`,
      fix: 'Keep posting. Reach is judged against this account’s own normal, and there is no normal yet.',
      who: 'vexa',
    });
  } else {
    if (r.trendPct !== null && r.trendPct <= -30) {
      add({
        id: 'reach_falling',
        severity: 'big',
        what: `Reach is falling: ${Math.abs(r.trendPct)}% below the five days before.`,
        evidence: `Median reach ${r.medianReach.toLocaleString('en-US')} against ${r.beforeMedian.toLocaleString('en-US')} before, over ${r.sampled} posts.`,
        fix: 'The causes below are the ones this account’s own numbers point at. Fix the top one first.',
        who: 'vexa',
      });
    }
    if (r.reels === 0 && input.settings.formats.includes('reel')) {
      add({
        id: 'no_reels',
        severity: 'big',
        what: 'No reel went out, and reels are the only format that reaches people who do not follow you.',
        evidence: `0 reels published in ${input.days} days; the rotation includes reels.`,
        fix: 'Put a reel in every second day. Carousels go deeper with the people you already have; they do not bring new ones.',
        who: 'vexa',
      });
    }
    if (r.medianHookScore > 0 && r.medianHookScore < WEAK_HOOK) {
      add({
        id: 'weak_hooks',
        severity: 'big',
        what: 'The openings are the problem: most of them do not earn the second line.',
        evidence: `Median hook score ${r.medianHookScore}/100 over ${r.sampled} posts, against ${WEAK_HOOK} as the floor.`,
        fix: 'Open on a number, a place or a person, inside the first three words. No greetings, no "in this video", no setup.',
        who: 'vexa',
      });
    }
    if (r.sendRate < WEAK_SEND_RATE) {
      add({
        id: 'not_sent',
        severity: r.saveRate < 1 ? 'big' : 'small',
        what: 'Nobody is forwarding the posts, which is the strongest reach signal there is.',
        evidence: `${r.sendRate} sends and ${r.saveRate} saves per thousand reached, median over ${r.sampled} posts.`,
        fix: 'Before anything goes out, ask whether one person would send it to one specific friend. If the answer is no, it is a post nobody asked for. Lists, fare breakdowns and before/afters get sent and saved.',
        who: 'vexa',
      });
    }
    if (r.profileScore !== null && r.profileScore < WEAK_PROFILE) {
      add({
        id: 'weak_profile',
        severity: 'big',
        what: 'The posts do bring strangers, and the profile they land on does not convert them.',
        evidence: `The profile scores ${r.profileScore}/100 against the twelve-point rubric.`,
        fix: 'Analytics has the rewrites written out, worst item first. The name field and bio line one are worth more than any single post.',
        who: 'you',
      });
    }
  }

  // ── the money ──
  if (input.spend) {
    const s = input.spend;
    if (!s.running && s.dailyCap > 0) {
      add({
        id: 'ads_idle',
        severity: 'big',
        what: 'The ad money sat still.',
        evidence: s.verdict,
        fix: 'The Ad Expert proposes a campaign on its own once a week. If it has not, the ad account or the page is not connected.',
        who: 'vexa',
      });
    } else if (s.running && s.spent < s.shouldHave * 0.6) {
      add({
        id: 'ads_too_thin',
        severity: 'big',
        what: 'The budget is too small to learn from, which is the most expensive way to spend a little.',
        evidence: s.verdict,
        fix: `Either raise the daily limit towards ${money(Math.round(s.shouldHave / Math.max(1, input.days)), s.currency)} a day for the campaigns you are running, or run one campaign instead of several.`,
        who: 'you',
      });
    } else if (s.ctr !== null && s.ctrLow !== null && s.ctr < s.ctrLow) {
      add({
        id: 'ads_creative',
        severity: 'big',
        what: 'The ads are being seen and ignored, so more budget would buy more ignoring.',
        evidence: s.verdict,
        fix: 'The picture and the first line are what a low tap rate measures. The desk rewrites worn-out creatives itself; a brand-new one this weak needs a different offer, not a different headline.',
        who: 'vexa',
      });
    }
    if (s.wasting > 0) {
      add({
        id: 'ads_wasting',
        severity: 'small',
        what: `${s.wasting} campaign${s.wasting === 1 ? '' : 's'} are spending more than they bring back.`,
        evidence: s.verdict,
        fix: 'Already handled: the three-hourly sync pauses a loser and writes a fresh creative. Nothing for you to do.',
        who: 'vexa',
      });
    }
  }

  // ── the leads themselves ──
  if (input.sales) {
    const s = input.sales;
    if (s.waiting > 0) {
      f.push({
        id: 'leads_waiting',
        severity: s.waiting >= 3 ? 'blocking' : 'big',
        what: `${s.waiting} ${s.waiting === 1 ? 'person is' : 'people are'} waiting on WhatsApp for an answer only you can give.`,
        evidence: `${s.waiting} conversations in "needs you", ${s.live} live, ${s.won} won and ${s.lost} lost in the last ${input.days} days.`,
        fix: 'Open WhatsApp sales and answer them. Vexa stopped on purpose — a complaint, a refund or somebody asking for a person is yours, and a lead left waiting is the dearest thing on this desk.',
        who: 'you',
      });
    }
    if (s.live > 0 && s.won === 0 && s.lost === 0) {
      f.push({
        id: 'nothing_closing',
        severity: 'big',
        what: 'Conversations are happening and none of them is closing.',
        evidence: `${s.live} live conversations, nothing won or lost in ${input.days} days.`,
        fix: 'A chat that never reaches a price or a date is not a sale. Give the price plainly, then ask for one thing: a time, an address or a confirmation.',
        who: 'vexa',
      });
    }
    if (s.queued > 0 && s.won + s.lost + s.live === 0) {
      f.push({
        id: 'sheet_not_moving',
        severity: 'small',
        what: `${s.queued} numbers from your sheet have not been messaged yet.`,
        evidence: 'They are queued, and nothing has gone out to them.',
        fix: 'Check that an approved template name is saved on the WhatsApp page: without one, WhatsApp will not let anybody open a conversation.',
        who: 'you',
      });
    }
  }

  // ── somebody else ──
  if (!input.competitors) {
    add({
      id: 'no_competitors',
      severity: 'small',
      what: 'Nobody else’s numbers were read, so "what is working for them" is unanswered.',
      evidence: 'No competitor account has been read through Instagram yet.',
      fix: 'Add their Instagram handles in Settings. Their real post numbers are free to read and are the best evidence there is.',
      who: 'you',
    });
  } else if (input.competitors.ahead && input.competitors.oursPerK !== null && input.competitors.theirsPerK !== null) {
    const times = round(input.competitors.theirsPerK / Math.max(0.01, input.competitors.oursPerK));
    if (times >= 1.5) {
      add({
        id: 'behind_competitor',
        severity: 'big',
        what: `@${input.competitors.ahead} gets ${times}x more engagement than we do per thousand followers.`,
        evidence: `${input.competitors.theirsPerK} likes and comments per thousand followers against our ${input.competitors.oursPerK}. What is working for them: ${input.competitors.theirShapes.join('; ')}.`,
        fix: 'Take the shape, never the post: what format, what opening, what promise. The writer has their best openings in front of it from now on.',
        who: 'vexa',
      });
    }
  }

  return f.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * The score: the weighted mean over the dimensions that can be judged, which
 * is not the same as scoring an account out of 100 for things it cannot do
 * yet. A workspace with nothing published scores badly on delivery and is not
 * also punished for having no reach trend. Pure.
 */
export function scoreOf(input: { delivery: Delivery; reach: ReachRead; spend: SpendRead | null }): number {
  const parts: { weight: number; value: number }[] = [];
  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  if (input.delivery.expected > 0) parts.push({ weight: 40, value: clamp(input.delivery.published / input.delivery.expected) });
  if (input.reach.sampled >= 3) {
    if (input.reach.trendPct !== null) parts.push({ weight: 25, value: clamp(1 + input.reach.trendPct / 100) });
    // Two sends per thousand reached is a piece people pass on; that is the bar.
    parts.push({ weight: 15, value: clamp(input.reach.sendRate / 2) });
  }
  if (input.reach.profileScore !== null) parts.push({ weight: 10, value: clamp(input.reach.profileScore / 100) });
  if (input.spend && input.spend.shouldHave > 0) {
    // Right-sized and not wasting. Over-spending is not rewarded: the ratio is capped at 1.
    const sized = clamp(input.spend.spent / input.spend.shouldHave);
    const clean = input.spend.running > 0 ? clamp(1 - input.spend.wasting / input.spend.running) : 1;
    parts.push({ weight: 10, value: (sized + clean) / 2 });
  }

  if (!parts.length) return 0;
  const weight = parts.reduce((n, p) => n + p.weight, 0);
  return Math.round((parts.reduce((n, p) => n + p.weight * p.value, 0) / weight) * 100);
}

// ── what changes, and what other workspaces get to know ─────────────────────

/**
 * The directives, worked out from the findings alone when there is no model.
 *
 * Deliberately not a summary of the report: these go into every employee's
 * prompt, so each line has to be an instruction somebody can follow on the
 * next job. Pure.
 */
export function localDirectives(findings: Finding[], reach: ReachRead, competitors: CompetitorGap | null, nowMs: number): LearnedDirectives {
  const has = (id: string) => findings.some((x) => x.id === id);
  const doMore: string[] = [];
  const stopDoing: string[] = [];
  const watchOut: string[] = [];

  if (has('no_reels')) doMore.push('A reel every second day: it is the only format that reaches people who do not follow us.');
  if (has('weak_hooks')) doMore.push('Open on a number, a place or a person inside the first three words. Never a greeting or a setup line.');
  if (has('not_sent')) doMore.push('Make pieces one person would send to one friend: lists, price breakdowns, before and after.');
  if (has('behind_competitor') && competitors?.theirShapes.length) doMore.push(`The shapes earning reach next door right now: ${competitors.theirShapes[0]}.`);
  if (has('feed_quiet')) doMore.push('Keep the calendar made ahead, so a quiet day never leaves the feed empty.');
  if (reach.saveRate >= 2) doMore.push('Keep making the kind of piece people save: this account’s saves are its strongest signal.');

  if (has('weak_hooks')) stopDoing.push('No "stop scrolling", no "in this video", no greeting, no hashtag in the hook.');
  if (has('not_sent')) stopDoing.push('No post that nobody would forward: pretty and pointless is the commonest waste here.');
  if (has('ads_creative')) stopDoing.push('No more budget behind an ad people are already ignoring: change the picture and the first line instead.');

  for (const x of findings.filter((y) => y.who === 'vexa' && y.severity !== 'small').slice(0, 3)) watchOut.push(`${x.what} (${x.evidence})`);

  return { atMs: nowMs, doMore: doMore.slice(0, 6), stopDoing: stopDoing.slice(0, 4), watchOut: watchOut.slice(0, 3), fromIndustry: [] };
}

/** The report in words with no model: the findings, in the order they must be fixed. Pure. */
export function localSummary(r: Pick<Review, 'score' | 'delivery' | 'reach' | 'spend' | 'findings' | 'goal'> & { sales?: SalesRead | null }, days: number): string {
  const lines = [
    `Over the last ${days} days: ${r.delivery.published} of ${r.delivery.expected || r.delivery.made} pieces went out, ` +
      `median reach ${r.reach.medianReach.toLocaleString('en-US')}${
        r.reach.trendPct === null ? '' : ` (${r.reach.trendPct >= 0 ? '+' : ''}${r.reach.trendPct}% against the five days before)`
      }. Scored ${r.score} out of 100 on the parts that could be judged.`,
    r.spend ? r.spend.verdict : 'No ad account is connected, so nothing was spent.',
    r.sales
      ? `On WhatsApp: ${r.sales.live} conversations live, ${r.sales.waiting} waiting for you, ${r.sales.won} won and ${r.sales.lost} lost.`
      : '',
    r.findings.length
      ? `What to fix, worst first:\n${r.findings.slice(0, 5).map((x, i) => `${i + 1}. ${x.what} ${x.evidence} → ${x.fix}`).join('\n')}`
      : 'Nothing is obviously wrong, which with this little data means "nothing is obviously wrong yet".',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** What one kind of business has taught the desk, across every workspace. */
export interface IndustryLessons {
  industry: Industry;
  atMs: number;
  /** How many reviews have fed this. */
  reviews: number;
  /** Most-confirmed first. */
  lessons: { text: string; seen: number; lastAtMs: number }[];
}

/**
 * What a lesson is allowed to carry out of a workspace.
 *
 * This is the whole privacy contract of the cross-client memory, so it is a
 * function rather than a convention: the client's name goes, every handle and
 * URL goes, and any run of four or more digits goes with the line that held it
 * — a follower count, a rupee figure or a phone number is somebody's business
 * and is worthless to the next workspace anyway. What survives is the shape,
 * which is the only part that transfers. Null when nothing useful is left.
 * Pure.
 */
export function scrubLesson(raw: string, names: string[]): string | null {
  let s = raw.trim();
  if (!s) return null;
  // A figure big enough to identify an account or a bank balance.
  if (/\d{4,}/.test(s)) return null;
  s = s.replace(/https?:\/\/\S+/g, '').replace(/@[A-Za-z0-9._]{2,}/g, '');
  for (const name of names) {
    const n = name.trim();
    if (n.length < 3) continue;
    s = s.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'the business');
  }
  s = s.replace(/\s{2,}/g, ' ').trim();
  return s.length >= 15 ? s.slice(0, 200) : null;
}

/** Fold this review's lessons into what the industry already taught us, most-confirmed first. Pure. */
export function mergeLessons(current: IndustryLessons | null, incoming: string[], industry: Industry, nowMs: number): IndustryLessons {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const byKey = new Map((current?.lessons ?? []).map((l) => [key(l.text), { ...l }]));
  for (const text of incoming) {
    const k = key(text);
    if (!k) continue;
    const seen = byKey.get(k);
    if (seen) byKey.set(k, { ...seen, seen: seen.seen + 1, lastAtMs: nowMs });
    else byKey.set(k, { text, seen: 1, lastAtMs: nowMs });
  }
  return {
    industry,
    atMs: nowMs,
    reviews: (current?.reviews ?? 0) + 1,
    lessons: [...byKey.values()].sort((a, b) => b.seen - a.seen || b.lastAtMs - a.lastAtMs).slice(0, 12),
  };
}

/** The industry's lessons as directive lines, best-confirmed first. Pure. */
export function industryLines(lessons: IndustryLessons | null, max = 5): string[] {
  return (lessons?.lessons ?? []).filter((l) => l.seen >= 2 || (lessons?.reviews ?? 0) <= 2).slice(0, max).map((l) => l.text);
}

// ── reading what the desk already stored ────────────────────────────────────

/** The ads side, or null with no ad account connected. */
async function readAds(): Promise<AdsRead | null> {
  const cfg = (await sdb.doc('system/socialAds').get()).data() as
    | {
        adAccountId?: string | null;
        currency?: string;
        dailyCap?: number;
        valuePerConversion?: number;
        account?: {
          daily?: { date: string; spend: number }[];
          week?: { ctr?: number; conversions?: number };
          committed?: number;
          bench?: Benchmarks | null;
        };
      }
    | undefined;
  if (!cfg?.adAccountId) return null;
  const campaigns = (await sdb.collection('socialAds').limit(100).get()).docs.map((d) => {
    const c = d.data() as { objectiveKind?: AdObjective; verdict?: { grade?: string } | null };
    return {
      objective: c.objectiveKind ?? 'traffic',
      grade: c.verdict?.grade ?? 'idle',
      active: (c.verdict?.grade ?? 'idle') !== 'idle',
    };
  });
  return {
    currency: cfg.currency ?? 'PKR',
    dailyCap: cfg.dailyCap ?? 0,
    committed: cfg.account?.committed ?? 0,
    daily: cfg.account?.daily ?? [],
    ctr: typeof cfg.account?.week?.ctr === 'number' ? cfg.account.week.ctr : null,
    conversions: cfg.account?.week?.conversions ?? 0,
    valuePerConversion: cfg.valuePerConversion ?? 0,
    bench: cfg.account?.bench ?? null,
    campaigns,
  };
}

/** Everything a review is decided from. No network: documents the desk already wrote. */
export async function gather(nowMs: number): Promise<ReviewInput> {
  const dates = windowDates(nowMs);
  const settings = await getSocialSettings();
  const [posts, read, auditSnap, plan, research, store, ads, chats, whatsapp] = await Promise.all([
    sdb.collection('socialPosts').where('date', '>=', dates[0]).get(),
    latestPageRead().catch(() => null),
    sdb.doc('socialInsights/profile').get(),
    planRef(dayKey(nowMs).slice(0, 7)).get(),
    sdb.collection('socialResearch').orderBy('date', 'desc').limit(1).get(),
    sdb.doc('system/store').get(),
    readAds().catch(() => null),
    sdb.collection('salesChats').limit(300).get(),
    sdb.doc('system/whatsapp').get(),
  ]);
  const audit = auditSnap.exists ? (auditSnap.data() as ProfileAudit) : null;
  // The funnel only means anything where there is a number for leads to arrive on.
  const connected = Boolean((whatsapp.data() as { phoneNumberId?: string | null } | undefined)?.phoneNumberId);
  const windowStart = nowMs - dates.length * DAY;
  const sales: SalesRead | null = connected
    ? chats.docs.reduce(
        (n, d) => {
          const c = d.data() as { stage?: string; updatedAtMs?: number };
          if (c.stage === 'needs_you') n.waiting++;
          if (c.stage === 'queued') n.queued++;
          if (['new', 'talking', 'qualified', 'pitched'].includes(c.stage ?? '')) n.live++;
          if ((c.updatedAtMs ?? 0) >= windowStart) {
            if (c.stage === 'won') n.won++;
            if (c.stage === 'lost') n.lost++;
          }
          return n;
        },
        { live: 0, waiting: 0, won: 0, lost: 0, queued: 0 } as SalesRead,
      )
    : null;
  const latest = research.empty ? null : (research.docs[0].data() as ContentResearch);
  const storeSales = store.data() as { sales?: { week?: { orders?: number } } } | undefined;
  return {
    nowMs,
    settings,
    plan: plan.exists ? (plan.data() as MonthPlan) : null,
    posts: posts.docs.map((d) => d.data() as SocialPost).filter((p) => dates.includes(p.date)),
    read,
    audit,
    ads,
    accounts: latest?.accounts ?? [],
    storeOrders: storeSales?.sales?.week?.orders ?? null,
    followers: audit?.profile?.followers ?? null,
    sales,
  };
}

// ── the review ──────────────────────────────────────────────────────────────

const SYSTEM = `You are the social lead reading back five days of your own team's work, in front of the numbers, for the business owner who pays for it.

You are not writing a report nobody reads. You are answering four questions, in this order, in plain words a busy person understands in one read:
1. Did we do the job you hired us for, or not?
2. If reach did not come, which of these causes is it? Name the one that matters most, not all of them.
3. Is the ad money the right size, and is it buying anything?
4. What is somebody else doing better than us, as a shape we can use?

Rules:
- Every claim must stand on a number you were given. You may not add a number, round one up, or guess at one.
- The findings below were computed in code, not by you. Do not argue with them, do not add new ones, and do not soften them. Your job is to say which matters most and what it means.
- No comfort. "Engagement is building nicely" in front of a falling trend is why nobody trusts these reports.
- Short sentences. No "delve", "leverage", "elevate", "in today's fast-paced world", no em dashes.
- The owner is not expected to act on this: the directives you write are instructions the team carries from now on. Write them as instructions, not as observations.

Reply with one JSON object and nothing else:
{
  "summary": "4 to 8 sentences. The verdict first, then why, then what happens next.",
  "doMore": ["2-5 instructions the team follows on every job from now on"],
  "stopDoing": ["1-3 things the team stops doing"],
  "watchOut": ["1-3 shortcomings to keep checking, each with the number it came from"],
  "lessons": ["1-3 lessons about this KIND of business that would help a different business of the same kind. Shapes only: no names, no handles, no figures. Leave empty if nothing here generalises."]
}`;

const list = (v: unknown, max: number, len = 300): string[] =>
  Array.isArray(v)
    ? (v as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .map((s) => s.trim().slice(0, len))
        .filter(Boolean)
        .slice(0, max)
    : [];

/** Run one review for the workspace in scope, store it, and apply what it decided. */
export async function review(nowMs = Date.now()): Promise<Review> {
  const input = await gather(nowMs);
  const dates = windowDates(nowMs);
  const industry = industryOf(workspaceBrand());

  const del = delivery(input.posts, dates, input.settings);
  const reach = reachRead({ read: input.read, audit: input.audit, posts: input.posts, nowMs });
  const spend = input.ads ? spendRead(input.ads, dates) : null;
  const ranked = [...(input.read?.best ?? []), ...(input.read?.worst ?? [])];
  const competitors = competitorGap({ accounts: input.accounts, ranked, followers: input.followers, nowMs });
  const canTell = measurable(input);
  const findings = findingsFor({
    settings: input.settings,
    delivery: del,
    reach,
    spend,
    competitors,
    sales: input.sales,
    measurable: canTell,
    posts: input.posts,
    days: dates.length,
  });
  const score = scoreOf({ delivery: del, reach, spend });

  const previous = (await sdb.doc(REVIEW_PATH).get()).data() as Review | undefined;
  const history = [...(previous?.history ?? []), { atMs: nowMs, score }].slice(-12);

  let directives = localDirectives(findings, reach, competitors, nowMs);
  let summary = '';
  let lessons: string[] = [];
  let error: string | null = null;

  if (modelReady()) {
    try {
      const team = await activeTeam();
      const lead = assign(team, 'distribute')?.employee ?? assign(team, 'research')?.employee ?? null;
      const { data } = await generateJson<Record<string, unknown>>({
        model: input.settings.textModel,
        system: [
          lead ? `You are ${lead.name}, ${lead.title}.` : '',
          brandBlock(),
          briefBlock(input.settings, null),
          hardRules(),
          SYSTEM,
          standingInstructions(input.settings),
        ]
          .filter(Boolean)
          .join('\n\n'),
        what: 'The five-day review',
        prompt: [
          `THE LAST ${dates.length} DAYS (${dates[0]} to ${dates[dates.length - 1]}).`,
          input.settings.goal.trim() ? `WHAT THE OWNER WANTS: ${input.settings.goal.trim()}` : 'The owner has not said what they want out of this.',
          input.plan?.goal ? `WHAT THE MONTH PLAN SET OUT TO DO: ${input.plan.goal}` : '',
          '',
          `DELIVERY: ${del.published} published of ${del.expected} promised, ${del.made} made, ${del.waiting} waiting for an Approve, ${del.failed} failed, ${del.quietDays} days with nothing on the feed.`,
          `REACH: median ${reach.medianReach} over ${reach.sampled} measured posts${
            reach.trendPct === null ? ' (no earlier period to compare with)' : `, ${reach.trendPct}% against the ${dates.length} days before`
          }. ${reach.sendRate} sends and ${reach.saveRate} saves per thousand reached. Median hook score ${reach.medianHookScore}/100. ${reach.reels} reels published. Profile ${
            reach.profileScore === null ? 'not scored' : `${reach.profileScore}/100`
          }.`,
          spend ? `MONEY: ${spend.verdict} Running ${spend.running}, winning ${spend.winning}, still learning ${spend.learning}, losing money ${spend.wasting}.` : 'MONEY: no ad account connected.',
          input.sales
            ? `THE LEADS ON WHATSAPP: ${input.sales.live} conversations live, ${input.sales.waiting} waiting for the owner, ${input.sales.won} won and ${input.sales.lost} lost in these ${dates.length} days, ${input.sales.queued} still queued.`
            : 'THE LEADS ON WHATSAPP: no number is connected, so nobody can be answered or closed there.',
          competitors
            ? `SOMEBODY ELSE: ${competitors.theirsPerK} likes and comments per thousand followers against our ${
                competitors.oursPerK ?? 'unknown'
              }. What is beating their own normal: ${competitors.theirShapes.join('; ')}. Their best openings: ${competitors.theirHooks.map((h) => `"${h}"`).join(' · ')}`
            : 'SOMEBODY ELSE: no other account has been read.',
          '',
          `WHAT THE CHECKS FOUND, worst first:\n${
            findings.length ? findings.map((f) => `- [${f.severity}] ${f.what} Evidence: ${f.evidence} Fix: ${f.fix}`).join('\n') : '- Nothing fired.'
          }`,
          `SCORE: ${score}/100${previous ? `, against ${previous.score} last time` : ''}.`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      summary = typeof data.summary === 'string' ? data.summary.trim().slice(0, 2500) : '';
      const doMore = list(data.doMore, 6);
      const stopDoing = list(data.stopDoing, 4);
      const watchOut = list(data.watchOut, 3);
      if (doMore.length || stopDoing.length) directives = { atMs: nowMs, doMore, stopDoing, watchOut, fromIndustry: [] };
      lessons = list(data.lessons, 3, 200);
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
      logger.warn('review: the model could not write the review', { error });
    }
  }
  if (!summary) summary = localSummary({ score, delivery: del, reach, spend, findings, goal: input.settings.goal, sales: input.sales }, dates.length);

  // What other businesses of this kind have taught us, carried into this
  // workspace's own directives — and this review's lessons back out to them.
  const names = [workspaceBrand()?.name ?? 'Velocity Rides', workspaceBrand()?.website ?? ''].filter(Boolean);
  const clean = (lessons.length ? lessons : directives.doMore).map((l) => scrubLesson(l, names)).filter((l): l is string => Boolean(l));
  let shared: IndustryLessons | null = null;
  try {
    shared = (await lessonsRef(industry).get()).data() as IndustryLessons | undefined ?? null;
    if (clean.length) {
      shared = mergeLessons(shared, clean, industry, nowMs);
      await lessonsRef(industry).set(shared);
    }
  } catch (e) {
    logger.warn('review: could not reach the shared lessons', { industry, error: (e as Error).message });
  }
  // Only lessons other workspaces confirmed: our own are already in doMore.
  directives.fromIndustry = industryLines(shared).filter((l) => !clean.includes(l)).slice(0, 4);

  const out: Review = {
    atMs: nowMs,
    date: dayKey(nowMs),
    windowDays: dates.length,
    engine: activeEngine(),
    industry,
    score,
    previousScore: previous?.score ?? null,
    goal: input.settings.goal,
    measurable: canTell,
    delivery: del,
    reach,
    spend,
    competitors,
    sales: input.sales,
    findings,
    summary,
    directives,
    history,
    error,
  };
  await sdb.doc(REVIEW_PATH).set(out);
  // The part the owner does not have to do anything with: from here, every
  // employee reads this on every job.
  await patchSettings({ learned: directives });
  return out;
}

/** What a brand-new workspace is given before it has a review of its own, from every other workspace of its kind. */
export async function seedLearned(brand: Brand | null, nowMs = Date.now()): Promise<LearnedDirectives | null> {
  const industry = industryOf(brand);
  const shared = ((await lessonsRef(industry).get()).data() as IndustryLessons | undefined) ?? null;
  const lines = industryLines(shared, 5);
  return lines.length ? { atMs: nowMs, doMore: [], stopDoing: [], watchOut: [], fromIndustry: lines } : null;
}

// ── the clock, and the button ───────────────────────────────────────────────

/** Whether this workspace is due a review. Pure. */
export function isDue(last: number | null, startedAtMs: number, nowMs: number, days = WINDOW_DAYS): boolean {
  return nowMs - (last ?? startedAtMs) >= days * DAY;
}

/**
 * Once a day, every workspace whose five days are up.
 *
 * A daily schedule with a per-workspace clock rather than a five-day cron:
 * every workspace then counts from its own last review instead of from one
 * shared Tuesday, and a review missed because the desk was asleep is simply
 * taken the next morning.
 *
 * Deliberately not in `SLEEPY_JOBS`: this is the one job whose whole purpose is
 * to run for a customer who never opens the console.
 */
export const socialSelfReview = onSchedule(
  { schedule: '30 7 * * *', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION, timeoutSeconds: 540, memory: '1GiB' },
  () =>
    forEachWorkspace('content', async () => {
      const now = Date.now();
      const last = (await sdb.doc(REVIEW_PATH).get()).data() as Review | undefined;
      const settings = await getSocialSettings();
      // Nothing has been set up at all: a review of an empty desk is noise.
      if (!settings.enabled && !last) return;
      if (!isDue(last?.atMs ?? null, settings.lastRunAtMs ?? now - WINDOW_DAYS * DAY, now)) return;
      const out = await review(now);
      logger.info('review: five days marked', {
        wid: currentWorkspace(),
        house: isHouse(),
        score: out.score,
        findings: out.findings.length,
      });
    }),
);

/** "Review now" on the Analytics page. The report is the return value and the stored document both. */
export const adminSelfReview = deskCall('content', { timeoutSeconds: 540, memory: '1GiB' }, () => review());
