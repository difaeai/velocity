/**
 * The ads expert's judgement, as arithmetic.
 *
 * Everything that decides a number which spends money lives here, and it is
 * pure: what a click should cost in Pakistan, how much budget Meta's learning
 * phase needs, whether a campaign is learning, winning or wasting money, and
 * how a plan is clamped to the owner's limits. A model writes the copy and
 * argues the strategy (see `ads.ts`); it never chooses a figure that leaves the
 * account unchecked by this file.
 *
 * The benchmarks are a starting point, not a quote. They are what Meta
 * campaigns in Pakistan typically see, and they are replaced by this account's
 * own medians as soon as it has enough campaigns to have a normal — the same
 * rule the organic desk uses: our own history is evidence, a market average is
 * a hint.
 */

export const AD_OBJECTIVES = ['traffic', 'awareness', 'engagement'] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];

export const AD_CTAS = ['LEARN_MORE', 'DOWNLOAD', 'SIGN_UP', 'APPLY_NOW', 'BOOK_TRAVEL', 'GET_OFFER'] as const;
export type AdCta = (typeof AD_CTAS)[number];

/** What each objective is called at Meta, and what counts as its result. */
export const META_OBJECTIVE: Record<
  AdObjective,
  { objective: string; optimization: string; destination: string | null; resultLabel: string }
> = {
  traffic: { objective: 'OUTCOME_TRAFFIC', optimization: 'LINK_CLICKS', destination: 'WEBSITE', resultLabel: 'link clicks' },
  awareness: { objective: 'OUTCOME_AWARENESS', optimization: 'REACH', destination: null, resultLabel: 'people reached' },
  engagement: {
    objective: 'OUTCOME_ENGAGEMENT',
    optimization: 'POST_ENGAGEMENT',
    destination: 'ON_POST',
    resultLabel: 'engagements',
  },
};

// ── money ───────────────────────────────────────────────────────────────────

/** Currencies Meta counts in whole units; every other one is in cents. */
const ZERO_DECIMAL = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);

/** Meta takes budgets in the currency's minor unit: Rs 500 is `50000`. */
export const toMinor = (amount: number, currency: string): number =>
  Math.round(amount * (ZERO_DECIMAL.has(currency) ? 1 : 100));

export const fromMinor = (minor: number, currency: string): number =>
  minor / (ZERO_DECIMAL.has(currency) ? 1 : 100);

export function money(amount: number, currency: string): string {
  const small = Math.abs(amount) < 100;
  const n = amount.toLocaleString('en-PK', { maximumFractionDigits: small ? 2 : 0 });
  if (currency === 'PKR') return `Rs ${n}`;
  if (currency === 'USD') return `$${amount.toLocaleString('en-US', { maximumFractionDigits: small ? 3 : 0 })}`;
  return `${n} ${currency}`;
}

// ── what things should cost ─────────────────────────────────────────────────

export interface Band {
  low: number;
  typical: number;
  high: number;
}

export interface Benchmarks {
  /** Per thousand impressions. */
  cpm: Band;
  /** Per link click. */
  cpc: Band;
  /** Link click-through rate, percent. Higher is better, unlike the rest. */
  ctr: Band;
  /** Per engagement (post engagement or ThruPlay). */
  cpe: Band;
  /** Where the typical values came from. */
  source: 'pakistan' | 'own';
}

/**
 * Meta feed + Reels + Stories in Pakistan, 2025–26, in rupees. Wide bands on
 * purpose: Karachi and a district town are different auctions, and so are a
 * Ramadan evening and a Tuesday morning.
 */
const PAKISTAN_PKR: Omit<Benchmarks, 'source'> = {
  cpm: { low: 60, typical: 120, high: 250 },
  cpc: { low: 4, typical: 9, high: 20 },
  ctr: { low: 0.6, typical: 1.2, high: 2.2 },
  cpe: { low: 0.5, typical: 1.2, high: 3 },
};

// shortcut: a fixed rate converts the rupee benchmarks and commission for a
// dollar account. It only moves the yardstick and ROAS, never a budget; replace
// with a live rate if a non-PKR account ever becomes the main one.
export const PKR_PER_USD = 280;

const scale = (b: Band, f: number): Band => ({ low: b.low * f, typical: b.typical * f, high: b.high * f });

/** The market yardstick in the account's currency, or null if we have none. */
export function marketBenchmarks(currency: string): Benchmarks | null {
  const f = currency === 'PKR' ? 1 : currency === 'USD' ? 1 / PKR_PER_USD : null;
  if (f === null) return null;
  return {
    cpm: scale(PAKISTAN_PKR.cpm, f),
    cpc: scale(PAKISTAN_PKR.cpc, f),
    ctr: PAKISTAN_PKR.ctr,
    cpe: scale(PAKISTAN_PKR.cpe, f),
    source: 'pakistan',
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Our own normal, once there is one: the median over campaigns big enough to
 * mean something. Two campaigns is the floor — one is an anecdote.
 */
export function ownBenchmarks(history: AdMetrics[], fallback: Benchmarks | null): Benchmarks | null {
  const clicked = history.filter((m) => m.linkClicks >= 100 && m.impressions >= 5000);
  if (clicked.length < 2) return fallback;
  const band = (typical: number): Band => ({ low: typical * 0.6, typical, high: typical * 1.5 });
  return {
    cpm: band(median(clicked.map((m) => m.cpm))),
    cpc: band(median(clicked.map((m) => m.cpc))),
    ctr: band(median(clicked.map((m) => m.ctr))),
    cpe: fallback?.cpe ?? band(0),
    source: 'own',
  };
}

// ── what Meta tells us ──────────────────────────────────────────────────────

export interface AdMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  linkClicks: number;
  /** Link CTR, percent. */
  ctr: number;
  /** Per link click. */
  cpc: number;
  cpm: number;
  /** The objective's own result: link clicks, people reached, engagements. */
  results: number;
  costPerResult: number;
  /**
   * What the money was actually for — sales, leads, WhatsApp chats, sign-ups or
   * installs — when Meta can see them (a pixel on the site, a lead form, a
   * click-to-chat ad). Zero when it cannot. Absent on campaigns read before
   * 2026-10-23.
   */
  conversions?: number;
  conversionKind?: ConversionKind | null;
  /** What those conversions were worth, when Meta knows (purchase value). */
  conversionValue?: number;
  costPerConversion?: number;
  /** Return on ad spend: worth ÷ spend. Null when nothing says what a conversion is worth. */
  roas?: number | null;
}

/** One row of the Insights API, as it arrives (numbers as strings). */
export interface InsightRow {
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  video_thruplay_watched_actions?: { action_type: string; value: string }[];
}

export type ConversionKind = 'purchase' | 'lead' | 'message' | 'signup' | 'install';

/**
 * What counts as a conversion, best first. Meta reports one purchase under
 * several names at once (`omni_purchase`, `purchase`, the pixel's own), so
 * adding them up counts every sale two or three times: the first family with
 * anything in it is the one counted, by the first name it is reported under.
 */
const CONVERSIONS: { kind: ConversionKind; types: string[] }[] = [
  { kind: 'purchase', types: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'] },
  { kind: 'lead', types: ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'] },
  { kind: 'message', types: ['onsite_conversion.messaging_conversation_started_7d'] },
  { kind: 'signup', types: ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration'] },
  { kind: 'install', types: ['mobile_app_install', 'app_install'] },
];

export function conversionsFrom(row: InsightRow): { kind: ConversionKind | null; count: number; value: number } {
  for (const family of CONVERSIONS) {
    for (const type of family.types) {
      const count = num(row.actions?.find((a) => a.action_type === type)?.value);
      if (count > 0) {
        return { kind: family.kind, count, value: num(row.action_values?.find((a) => a.action_type === type)?.value) };
      }
    }
  }
  return { kind: null, count: 0, value: 0 };
}

const num = (v: string | number | undefined): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
};

/** What a Meta objective counts as a result, for campaigns we did not make. */
export function resultActionFor(metaObjective: string, video = false): string {
  switch (metaObjective) {
    case 'OUTCOME_AWARENESS':
    case 'REACH':
    case 'BRAND_AWARENESS':
      return 'reach';
    case 'OUTCOME_ENGAGEMENT':
    case 'POST_ENGAGEMENT':
    case 'VIDEO_VIEWS':
      return video ? 'thruplay' : 'post_engagement';
    case 'OUTCOME_APP_PROMOTION':
    case 'APP_INSTALLS':
      return 'mobile_app_install';
    case 'OUTCOME_LEADS':
    case 'LEAD_GENERATION':
      return 'lead';
    default:
      return 'link_click';
  }
}

/**
 * Turn one Insights row into the numbers the expert reasons with.
 *
 * `valuePerConversion` is what the owner said one sale or lead is worth to
 * them. It prices conversions Meta counts but cannot value (a lead form, a
 * WhatsApp chat); a real purchase value from the pixel always wins over it.
 */
export function metricsFrom(row: InsightRow, resultAction: string, valuePerConversion = 0): AdMetrics {
  const spend = num(row.spend);
  const impressions = num(row.impressions);
  const reach = num(row.reach);
  const linkClicks = num(row.inline_link_clicks);
  const action = (type: string) => num(row.actions?.find((a) => a.action_type === type)?.value);

  const results =
    resultAction === 'reach'
      ? reach
      : resultAction === 'link_click'
        ? linkClicks
        : resultAction === 'thruplay'
          ? num(row.video_thruplay_watched_actions?.[0]?.value)
          : action(resultAction);

  const conv = conversionsFrom(row);
  const worth = conv.value > 0 ? conv.value : conv.count * valuePerConversion;

  return {
    spend,
    impressions,
    reach,
    frequency: reach > 0 ? impressions / reach : num(row.frequency),
    linkClicks,
    ctr: impressions > 0 ? (linkClicks / impressions) * 100 : 0,
    cpc: linkClicks > 0 ? spend / linkClicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    results,
    // Reach is priced per thousand people, the way anyone reading it thinks of it.
    costPerResult: results > 0 ? (resultAction === 'reach' ? (spend / results) * 1000 : spend / results) : 0,
    conversions: conv.count,
    conversionKind: conv.kind,
    conversionValue: worth,
    costPerConversion: conv.count > 0 ? spend / conv.count : 0,
    // Nothing worth anything yet is a ROAS of 0 only once something says what a conversion is worth.
    roas: spend > 0 && (conv.value > 0 || valuePerConversion > 0) ? worth / spend : null,
  };
}

/**
 * Cost per order and ROAS, blended: every ride completed in the week and the
 * commission on it, against the week's whole ad bill. Meta cannot see a ride
 * booked in the app, so no campaign can be credited with an order — this is a
 * ceiling on what the ads did, never a measure of one campaign.
 */
export interface Blended {
  /** Completed rides. */
  orders: number;
  /** Velocity's commission on them, in rupees. */
  commission: number;
  /** In the account's currency; 0 with no orders. */
  costPerOrder: number;
  /** Commission ÷ spend, 1 is break-even; null with no spend or no rupee rate. */
  roas: number | null;
}

export function blended(p: { spend: number; currency: string; orders: number; commission: number }): Blended {
  const perRupee = p.currency === 'PKR' ? 1 : p.currency === 'USD' ? 1 / PKR_PER_USD : null;
  return {
    orders: p.orders,
    commission: p.commission,
    costPerOrder: p.orders > 0 ? p.spend / p.orders : 0,
    roas: perRupee !== null && p.spend > 0 ? (p.commission * perRupee) / p.spend : null,
  };
}

/** What one result should cost, by objective. Reach is per thousand people. */
export function resultBand(objective: AdObjective, bench: Benchmarks): Band {
  if (objective === 'awareness') return scale(bench.cpm, 1.6); // ~1.6 impressions per person in a week
  if (objective === 'engagement') return bench.cpe;
  return bench.cpc;
}

// ── how much to spend ───────────────────────────────────────────────────────

/**
 * The daily budget Meta's learning phase needs: about fifty results in the
 * first week. Below this a campaign never leaves "learning" and its numbers
 * never settle — the most common way a small budget is wasted.
 */
export function learningBudget(objective: AdObjective, bench: Benchmarks): number {
  if (objective === 'awareness') return Math.ceil(bench.cpm.typical * 5); // ~5,000 impressions a day
  return Math.ceil((50 / 7) * resultBand(objective, bench).typical * 1.2);
}

/**
 * The smallest daily budget worth creating: Meta's own floor for an
 * impression-billed ad set is about a dollar a day, and below that it refuses.
 * Zero for a currency we have no number for — Meta then says so itself.
 */
export function minDailyFor(currency: string): number {
  return currency === 'PKR' ? 300 : currency === 'USD' ? 1.5 : 0;
}

/**
 * Fit a requested budget inside the owner's daily limit.
 *
 * `committed` is what the desk's other running campaigns already spend a day.
 * Refuses rather than shrinking below Meta's minimum, because a budget too
 * small to deliver is money spent on nothing.
 */
export function clampBudget(params: {
  requested: number;
  cap: number;
  committed: number;
  minDaily: number;
  currency: string;
}): { budget: number | null; note: string | null } {
  const { requested, cap, committed, minDaily, currency } = params;
  const room = Math.max(0, cap - committed);
  if (room < minDaily) {
    return {
      budget: null,
      note:
        cap <= 0
          ? 'No daily limit is set yet. Set one on the Ads page before the desk spends anything.'
          : `Your daily limit is ${money(cap, currency)} and ${money(committed, currency)} of it is already running. ` +
            `Raise the limit or end a campaign first.`,
    };
  }
  const budget = Math.round(Math.min(Math.max(requested, minDaily), room));
  return {
    budget,
    note:
      budget < requested
        ? `Asked for ${money(requested, currency)} a day; held to ${money(budget, currency)} by your daily limit.`
        : null,
  };
}

/** What the money should buy, as a range — never a single promised number. */
export function forecast(params: {
  objective: AdObjective;
  dailyBudget: number;
  days: number;
  bench: Benchmarks;
}): { spend: number; results: [number, number]; label: string; costPerResult: Band } {
  const spend = params.dailyBudget * params.days;
  const band = resultBand(params.objective, params.bench);
  const per = params.objective === 'awareness' ? 1000 : 1;
  return {
    spend,
    results: [Math.round((spend / band.high) * per), Math.round((spend / band.low) * per)],
    label: META_OBJECTIVE[params.objective].resultLabel,
    costPerResult: band,
  };
}

// ── the verdict ─────────────────────────────────────────────────────────────

export type AdAction =
  | { kind: 'none' }
  | { kind: 'pause'; why: string }
  | { kind: 'scale'; to: number; why: string }
  | { kind: 'refresh'; why: string };

export interface Verdict {
  grade: 'idle' | 'learning' | 'good' | 'ok' | 'bad';
  headline: string;
  reasons: string[];
  action: AdAction;
}

/** Scale a winner at most this often: Meta resets learning on a big jump. */
export const SCALE_EVERY_MS = 72 * 3600_000;
/** And by this much — the step that does not reset learning. */
export const SCALE_STEP = 1.2;

/** Paying back this many times what it costs, with enough sales to trust it, is a winner. */
export const ROAS_WIN = 2;
/** Below this, with enough data, it loses money. */
export const ROAS_LOSE = 0.7;
/** A tired campaign gets a fresh creative at most this often, and at most this many times. */
export const REFRESH_EVERY_MS = 4 * 86_400_000;
export const MAX_REFRESHES = 3;

const CONVERSION_LABEL: Record<ConversionKind, string> = {
  purchase: 'sales',
  lead: 'leads',
  message: 'chats',
  signup: 'sign-ups',
  install: 'installs',
};

/**
 * Read a campaign the way a media buyer would, in order: is it running, is it
 * still learning, is it wasting money, is it worn out, is it a winner.
 */
export function diagnose(input: {
  objective: AdObjective;
  m: AdMetrics;
  bench: Benchmarks | null;
  currency: string;
  active: boolean;
  dailyBudget: number | null;
  ageHours: number;
  lastScaledMs: number | null;
  nowMs: number;
  /** What the owner said one conversion is worth; 0 when they have not. */
  valuePerConversion?: number;
}): Verdict {
  const { objective, m, bench, currency } = input;
  const $ = (n: number) => money(n, currency);
  const label = META_OBJECTIVE[objective].resultLabel;
  const canScale = () =>
    input.dailyBudget !== null && (input.lastScaledMs === null || input.nowMs - input.lastScaledMs >= SCALE_EVERY_MS);

  if (!input.active) {
    return {
      grade: 'idle',
      headline: m.spend > 0 ? `Not running. It spent ${$(m.spend)} for ${m.results.toLocaleString()} ${label}.` : 'Not running.',
      reasons: [],
      action: { kind: 'none' },
    };
  }

  if (m.impressions < 1000 || input.ageHours < 48) {
    return {
      grade: 'learning',
      headline: 'Still learning — leave it alone for now.',
      reasons: [
        'Meta needs about two days and roughly fifty results before the numbers mean anything. Changing it now restarts that.',
      ],
      action: { kind: 'none' },
    };
  }

  // When the account can see what the money bought — sales, leads, chats with
  // a worth on them — that decides, ahead of what a click costs: a dear click
  // that sells beats a cheap one that does not. Too few to trust, and the
  // click numbers below decide instead.
  if (m.roas != null) {
    const conv = m.conversions ?? 0;
    const what = m.conversionKind ? CONVERSION_LABEL[m.conversionKind] : 'conversions';
    const per = input.valuePerConversion ?? 0;
    if (m.roas < ROAS_LOSE && (conv >= 5 || (per > 0 && m.spend >= per * 5))) {
      return {
        grade: 'bad',
        headline: `Losing money — ${$(m.spend)} spent, ${$(m.conversionValue ?? 0)} back (ROAS ${m.roas.toFixed(2)}).`,
        reasons: [`It returns ${m.roas.toFixed(2)} for every 1 it costs; under ${ROAS_LOSE} with this much data is not bad luck.`],
        action: { kind: 'pause', why: 'It pays back less than it costs, with enough data to be sure. Pause it and try a new creative or offer.' },
      };
    }
    if (m.roas >= ROAS_WIN && conv >= 5) {
      return {
        grade: 'good',
        headline: `Winning — ROAS ${m.roas.toFixed(2)}: ${conv.toLocaleString()} ${what} for ${$(m.spend)}.`,
        reasons: [`${$(m.costPerConversion ?? 0)} per ${what.replace(/s$/, '')}, paying back ${m.roas.toFixed(1)} times its cost.`],
        action: canScale()
          ? {
              kind: 'scale',
              to: Math.round(input.dailyBudget! * SCALE_STEP),
              why: 'It pays back well over its cost with enough sales to trust it. Twenty percent more a day keeps it out of re-learning.',
            }
          : { kind: 'none' },
      };
    }
    if (conv >= 5) {
      // Paying its way or close to it: it keeps running. Only a worn-out
      // creative is worth touching — the audience has stopped seeing it.
      const tired = m.frequency > 3.5;
      return {
        grade: m.roas >= 1 ? 'ok' : 'bad',
        headline: `Paying back ${m.roas.toFixed(2)}× — ${conv.toLocaleString()} ${what} at ${$(m.costPerConversion ?? 0)} each.`,
        reasons: tired ? [`The same people have seen it ${m.frequency.toFixed(1)} times on average — they have stopped noticing it.`] : [],
        action: tired
          ? { kind: 'refresh', why: 'Make a fresh creative for it — new picture, new first line — and keep the targeting.' }
          : { kind: 'none' },
      };
    }
  }

  if (!bench) {
    return {
      grade: 'ok',
      headline: `${$(m.spend)} spent, ${m.results.toLocaleString()} ${label}.`,
      reasons: ['No yardstick for this currency yet — it will be judged against its own history once there is some.'],
      action: { kind: 'none' },
    };
  }

  const reasons: string[] = [];
  const band = resultBand(objective, bench);
  const cpr = m.costPerResult;
  const target = band.typical;

  // The click is the creative's job: below the floor, people saw it and kept scrolling.
  const weakCtr = objective !== 'awareness' && m.impressions >= 3000 && m.ctr < bench.ctr.low;
  if (weakCtr) {
    reasons.push(`Only ${m.ctr.toFixed(2)}% click — ${bench.ctr.low}% is the floor here. The picture or the first line is not stopping thumbs.`);
  }
  const expensive = m.results >= 20 && cpr > band.high;
  if (expensive) {
    reasons.push(`Each of the ${label} costs ${$(cpr)}; ${$(band.typical)} is normal and ${$(band.high)} is the top of the range.`);
  }
  const tired = m.frequency > 3.5;
  if (tired) {
    reasons.push(`The same people have seen it ${m.frequency.toFixed(1)} times on average — they have stopped noticing it.`);
  }

  // Wasting money: pause. Strong evidence only — a pause throws away learning.
  const burning =
    (m.results >= 30 && cpr > band.high * 1.5) ||
    (objective !== 'awareness' && m.impressions >= 5000 && m.ctr < bench.ctr.low * 0.6) ||
    (m.results === 0 && m.spend >= band.high * 25);
  if (burning) {
    return {
      grade: 'bad',
      headline: `Wasting money — ${$(m.spend)} spent for ${m.results.toLocaleString()} ${label}.`,
      reasons,
      action: { kind: 'pause', why: 'Costs are far past the normal range with enough data to be sure. Pause it and try a new creative.' },
    };
  }

  if (weakCtr || expensive || tired) {
    return {
      grade: weakCtr || expensive ? 'bad' : 'ok',
      headline: tired && !weakCtr && !expensive ? 'Working, but the audience is worn out.' : 'Underperforming.',
      reasons,
      action: { kind: 'refresh', why: 'Make a fresh creative for it — new picture, new first line — and keep the targeting.' },
    };
  }

  const winning = m.results >= 30 && cpr > 0 && cpr <= target * 0.8;
  if (winning) {
    reasons.push(`${$(cpr)} per result against a normal of ${$(target)}.`);
    return {
      grade: 'good',
      headline: `Winning — ${m.results.toLocaleString()} ${label} at ${$(cpr)} each.`,
      reasons,
      action: canScale()
        ? {
            kind: 'scale',
            to: Math.round(input.dailyBudget! * SCALE_STEP),
            why: 'Cheaper than normal with enough results to trust it. Twenty percent more a day keeps it out of re-learning.',
          }
        : { kind: 'none' },
    };
  }

  return {
    grade: 'ok',
    headline: `On track — ${m.results.toLocaleString()} ${label}${cpr ? ` at ${$(cpr)} each` : ''}.`,
    reasons: cpr ? [`Normal here is ${$(band.low)}–${$(band.high)}.`] : [],
    action: { kind: 'none' },
  };
}

// ── the plan ────────────────────────────────────────────────────────────────

/** A campaign the expert has decided on, before it exists at Meta. */
export interface AdPlanSpec {
  name: string;
  objective: AdObjective;
  audience: {
    cities: string[];
    ageMin: number;
    ageMax: number;
    genders: 'all' | 'men' | 'women';
    interests: string[];
  };
  dailyBudget: number;
  days: number;
  format: 'image' | 'video';
  primaryText: string;
  headline: string;
  cta: AdCta;
  /** The words on the picture: the hook first. */
  lines: string[];
  /** The expert's case for all of the above, in a few sentences. */
  why: string;
}

const clip = (s: unknown, max: number): string => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const strings = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.map((x) => clip(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/**
 * Whatever the model sent, made into a plan that can be trusted with money.
 * Every field is clamped; the budget is only *proposed* here — `clampBudget`
 * still decides it against the limit.
 */
export function normalisePlan(raw: Record<string, unknown>, fallback: AdPlanSpec, maxDays: number): AdPlanSpec {
  const audience = (raw.audience ?? {}) as Record<string, unknown>;
  const objective = AD_OBJECTIVES.includes(raw.objective as AdObjective) ? (raw.objective as AdObjective) : fallback.objective;
  const ageMin = int(audience.ageMin, 18, 64, fallback.audience.ageMin);
  const lines = strings(raw.lines, 4, 90);
  return {
    name: clip(raw.name, 80) || fallback.name,
    objective,
    audience: {
      cities: strings(audience.cities, 10, 40),
      ageMin,
      ageMax: int(audience.ageMax, ageMin + 1, 65, Math.max(ageMin + 1, fallback.audience.ageMax)),
      genders: ['all', 'men', 'women'].includes(audience.genders as string)
        ? (audience.genders as AdPlanSpec['audience']['genders'])
        : 'all',
      interests: strings(audience.interests, 8, 60),
    },
    dailyBudget: int(raw.dailyBudget, 1, 10_000_000, fallback.dailyBudget),
    days: int(raw.days, 1, maxDays, Math.min(fallback.days, maxDays)),
    format: raw.format === 'video' ? 'video' : 'image',
    primaryText: clip(raw.primaryText, 600) || fallback.primaryText,
    headline: clip(raw.headline, 60) || fallback.headline,
    cta: AD_CTAS.includes(raw.cta as AdCta) ? (raw.cta as AdCta) : fallback.cta,
    lines: lines.length ? lines : fallback.lines,
    why: clip(raw.why, 1200) || fallback.why,
  };
}

/** Pakistan's cities as people type them, for reading a brief without a model. */
export const PK_CITIES = [
  'Karachi',
  'Lahore',
  'Islamabad',
  'Rawalpindi',
  'Faisalabad',
  'Multan',
  'Peshawar',
  'Quetta',
  'Sialkot',
  'Gujranwala',
  'Hyderabad',
  'Bahawalpur',
  'Sargodha',
  'Abbottabad',
];

/**
 * A plan with no model at all: the objective and cities read from the brief,
 * broad targeting (which is what Meta's delivery does best with anyway), and
 * a budget sized to get out of learning. Plain, and it never invents a figure.
 */
export function localPlan(params: {
  brief: string;
  bench: Benchmarks | null;
  maxDays: number;
  requestedBudget?: number;
  requestedDays?: number;
}): AdPlanSpec {
  const text = params.brief.trim();
  const lower = text.toLowerCase();
  const objective: AdObjective = /\b(reach|awareness|brand|pehchan|log jaan)/.test(lower)
    ? 'awareness'
    : /\b(engage|like|comment|views?|boost)/.test(lower)
      ? 'engagement'
      : 'traffic';
  const drivers = /\b(driver|captain|earn|kamai|car owner|rickshaw|bike)/.test(lower);
  const cities = PK_CITIES.filter((c) => lower.includes(c.toLowerCase()));
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  // Forty characters, ending on a whole word — "…to sign up th" reads as a mistake.
  const headline = (first.length > 40 ? first.slice(0, 41).replace(/\s+\S*$/, '') : first).trim() || 'Velocity Rides';
  const learn = params.bench ? learningBudget(objective, params.bench) : 0;

  return {
    name: `${drivers ? 'Drivers' : 'Riders'} — ${cities.length ? cities.join(', ') : 'Pakistan'} — ${objective}`,
    objective,
    audience: { cities, ageMin: drivers ? 21 : 18, ageMax: drivers ? 55 : 45, genders: 'all', interests: [] },
    dailyBudget: params.requestedBudget ?? Math.max(learn * 2, learn),
    days: Math.min(params.requestedDays ?? 7, params.maxDays),
    format: 'image',
    primaryText: text.slice(0, 600),
    headline,
    cta: objective === 'traffic' ? 'DOWNLOAD' : 'LEARN_MORE',
    lines: [headline],
    why:
      'Written without a model: broad targeting so Meta can find the cheapest people itself, a budget sized to get ' +
      'out of the learning phase in a week, and your own words as the copy.',
  };
}

const GOAL_IN_WORDS: Record<AdObjective, string> = {
  traffic: 'get people to tap through to your link',
  awareness: 'show it to as many of the right people as possible, as cheaply as possible',
  engagement: 'get likes, comments, shares and views',
};

/** A plan said back in plain words — what someone who is not an ads expert needs to say yes to it. Pure. */
export function explainPlan(plan: AdPlanSpec, currency: string): string {
  const a = plan.audience;
  const who = `${a.genders === 'all' ? 'people' : a.genders} aged ${a.ageMin}–${a.ageMax} in ${
    a.cities.length ? a.cities.join(', ') : 'the whole country'
  }${a.interests.length ? `, interested in ${a.interests.join(', ')}` : ''}`;
  return (
    `I would run "${plan.name}" to ${GOAL_IN_WORDS[plan.objective]}. It is shown to ${who}, ` +
    `at ${money(plan.dailyBudget, currency)} a day for ${plan.days} days — ${money(plan.dailyBudget * plan.days, currency)} at most. ` +
    `The ad opens with "${plan.lines[0] ?? plan.headline}".`
  );
}

/**
 * The owner's answer applied to the plan with no model: the money ("Rs 1,500 a
 * day"), the days, the ages ("22 to 50"), who ("only women"), the cities and
 * what people should do. Anything it does not recognise leaves the plan as it
 * was; `normalisePlan` still clamps the result. Pure.
 */
export function applyAnswer(plan: AdPlanSpec, said: string, maxDays: number): AdPlanSpec {
  const t = said.toLowerCase().replace(/(\d),(?=\d{3})/g, '$1');
  const next = structuredClone(plan);
  const perDay = t.match(/(?:rs\.?|pkr|\$)?\s*(\d+(?:\.\d+)?)\s*(?:rs|rupees|pkr)?\s*(?:a|per|\/|each)\s*day/) ?? t.match(/(?:rs\.?|pkr)\s*(\d+(?:\.\d+)?)/);
  if (perDay) next.dailyBudget = Number(perDay[1]);
  const days = t.match(/(\d+)\s*days?\b/) ?? (/\b(a|one) week\b/.test(t) ? ['', '7'] : /\b(two|2) weeks\b/.test(t) ? ['', '14'] : null);
  if (days) next.days = Number(days[1]);
  const ages = t.match(/\b(\d{2})\s*(?:-|–|to)\s*(\d{2})\b/);
  if (ages) [next.audience.ageMin, next.audience.ageMax] = [Number(ages[1]), Number(ages[2])];
  const women = /\b(women|woman|female|ladies|girls)\b/.test(t);
  const men = /\b(men|man|male|boys)\b/.test(t);
  if (women !== men) next.audience.genders = women ? 'women' : 'men';
  else if (women || /\b(everyone|all genders)\b/.test(t)) next.audience.genders = 'all';
  const cities = PK_CITIES.filter((c) => t.includes(c.toLowerCase()));
  if (cities.length) next.audience.cities = cities;
  else if (/\b(whole|all of|across) (the )?(country|pakistan)\b/.test(t)) next.audience.cities = [];
  const cta: AdCta | null = /\b(download|install)/.test(t) ? 'DOWNLOAD' : /\b(sign ?up|register|join)\b/.test(t) ? 'SIGN_UP' : null;
  if (cta) {
    next.objective = 'traffic';
    next.cta = cta;
  } else if (/\b(awareness|know (us|about)|reach)\b/.test(t)) next.objective = 'awareness';
  return normalisePlan(next as unknown as Record<string, unknown>, plan, maxDays);
}

/** What a brief has not said yet that would change the plan, as at most three questions. Pure. */
export function missingAnswers(plan: AdPlanSpec, asked: string): string[] {
  const out: string[] = [];
  if (!plan.audience.cities.length) out.push('Which cities should it run in — or the whole country?');
  if (!/\d/.test(asked)) out.push('How much can it spend a day, and for how many days?');
  if (!/\b(download|install|sign ?up|register|join|book|order|buy|call|message|whatsapp|visit|apply)/i.test(asked)) {
    out.push('What should people do after they see it — download the app, sign up, message you, or buy?');
  }
  return out.slice(0, 3);
}
