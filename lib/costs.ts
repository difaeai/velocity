/**
 * What Velocity pays other people, so Velocity can run.
 *
 * Every other money screen in this console answers "what did we take in".
 * This one answers the other half — the third-party bill behind the product:
 * Firebase under all of it, Meta's WhatsApp numbers, Claude and Gemini on the
 * social desk, Maps behind every fare estimate, the Play account, the blue tick.
 *
 * WHY THE CATALOGUE LIVES IN CODE AND THE MONEY LIVES IN FIRESTORE
 * ---------------------------------------------------------------
 * Which vendors we use is a fact about this repository: `social/claude.ts`
 * calls Anthropic, so Anthropic is on the bill whether or not anybody has
 * typed a number into the console. So CATALOGUE below owns the *list*, and
 * Firestore stores only what each line *costs*. Wire up a new integration, add
 * a line here, and it shows up in the console as "not priced yet" instead of
 * quietly going missing from the total.
 *
 * NOTHING HERE READS A REAL INVOICE
 * ---------------------------------
 * Google, Meta and Anthropic all keep spend behind billing APIs this app has no
 * credentials for, so the amounts are typed in by an admin. For the usage-billed
 * lines that means "last month's invoice". A plausible number refreshed
 * automatically would be a worse lie than an honest blank, which is why unpriced
 * lines are counted and shown rather than defaulted to something that looks
 * right.
 */

export type Billing = 'monthly' | 'yearly' | 'one-time' | 'usage';
export type CostStatus = 'active' | 'planned' | 'free' | 'paused';
export type CostCurrency = 'PKR' | 'USD';

export const CATEGORIES = [
  'Cloud & infrastructure',
  'AI',
  'Messaging',
  'Maps & places',
  'Distribution',
  'Social & brand',
  'Payments',
  'Domain & mail',
] as const;

export type CostCategory = (typeof CATEGORIES)[number];

export interface CostItem {
  id: string;
  /** Who sends the bill. */
  platform: string;
  /** The specific product on that bill. */
  service: string;
  category: CostCategory;
  /** What Velocity gets for the money, in one line. */
  purpose: string;
  amount: number;
  currency: CostCurrency;
  billing: Billing;
  status: CostStatus;
  /** True until somebody types the real number — the total says how many. */
  estimate: boolean;
  /** How this vendor bills, or where the figure came from. */
  note?: string;
  /** The vendor's own billing console, for checking the number. */
  billingUrl?: string;
  /** Added from the console rather than shipped in the catalogue. */
  custom?: boolean;
}

/**
 * Rupees per dollar. Every foreign vendor here quotes USD, and none of them
 * bill at the rate that was true when this file was written, so it is a field
 * in the console rather than a constant.
 */
export const DEFAULT_USD_TO_PKR = 280;

/**
 * The bill, as the repository knows it. Amounts start at zero and `estimate:
 * true` except where the price is a published flat fee, because guessing
 * somebody's cloud spend is not a service to them.
 */
export const CATALOGUE: CostItem[] = [
  // ── Cloud & infrastructure ────────────────────────────────────────────────
  {
    id: 'firebase-firestore',
    platform: 'Google Firebase',
    service: 'Cloud Firestore',
    category: 'Cloud & infrastructure',
    purpose: 'Every trip, driver, pool, chat and profile document in the product.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Blaze plan, billed per read, write and delete plus stored bytes. Enter last month’s invoice line.',
    billingUrl: 'https://console.firebase.google.com/project/velocity-fe379/usage',
  },
  {
    id: 'firebase-functions',
    platform: 'Google Firebase',
    service: 'Cloud Functions (asia-south1)',
    category: 'Cloud & infrastructure',
    purpose: 'The whole backend — matching, fares, payouts, the social desk’s scheduled runs.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per invocation, per GB-second, and on outbound networking.',
    billingUrl: 'https://console.firebase.google.com/project/velocity-fe379/usage',
  },
  {
    id: 'firebase-storage',
    platform: 'Google Firebase',
    service: 'Cloud Storage',
    category: 'Cloud & infrastructure',
    purpose: 'CNIC scans, driver documents, profile photos, and every asset the social desk renders.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per GB stored and per GB downloaded.',
    billingUrl: 'https://console.firebase.google.com/project/velocity-fe379/usage',
  },
  {
    id: 'firebase-app-hosting',
    platform: 'Google Firebase',
    service: 'App Hosting',
    category: 'Cloud & infrastructure',
    purpose: 'Serves velocityrides.app and this console — 1 vCPU, 512 MiB, up to 2 instances.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Build minutes plus instance time. It scales to zero, so a quiet month is close to free.',
    billingUrl: 'https://console.firebase.google.com/project/velocity-fe379/apphosting',
  },
  {
    id: 'firebase-auth-phone',
    platform: 'Google Firebase',
    service: 'Authentication — phone sign-in',
    category: 'Cloud & infrastructure',
    purpose: 'The SMS code every rider and driver types in to get into the app.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per successful verification once the free monthly allowance is used up. This is the line most likely to grow with sign-ups.',
    billingUrl: 'https://console.firebase.google.com/project/velocity-fe379/authentication/usage',
  },
  {
    id: 'firebase-fcm',
    platform: 'Google Firebase',
    service: 'Cloud Messaging (FCM)',
    category: 'Cloud & infrastructure',
    purpose: 'Every push to the rider and driver apps — ride offers, chat, business ads.',
    amount: 0,
    currency: 'USD',
    billing: 'monthly',
    status: 'free',
    estimate: false,
    note: 'Free at any volume. Listed so the push channel is visible on the bill even though it costs nothing.',
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  {
    id: 'anthropic-claude',
    platform: 'Anthropic',
    service: 'Claude API',
    category: 'AI',
    purpose: 'The social desk’s eight employees think here, and it reads driver payment-proof screenshots.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per input and output token. The daily social run is the bulk of it; payment proofs are a handful of images a day.',
    billingUrl: 'https://console.anthropic.com/settings/billing',
  },
  {
    id: 'google-gemini',
    platform: 'Google AI',
    service: 'Gemini API — images and Veo video',
    category: 'AI',
    purpose: 'Draws the social posts and renders the video cuts — the pixels Claude cannot make.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per image and per second of rendered video. Video is far and away the expensive half.',
    billingUrl: 'https://aistudio.google.com/app/billing',
  },

  // ── Messaging ─────────────────────────────────────────────────────────────
  {
    id: 'meta-whatsapp',
    platform: 'Meta',
    service: 'WhatsApp Cloud API',
    category: 'Messaging',
    purpose: 'Utility templates telling a driver with the app closed that there is a fare a few streets away.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per utility conversation at the Pakistan rate, not per message. The alert policy caps how many can be opened in a day.',
    billingUrl: 'https://business.facebook.com/billing_hub/accounts',
  },

  // ── Maps & places ─────────────────────────────────────────────────────────
  {
    id: 'google-maps',
    platform: 'Google Maps Platform',
    service: 'Directions, Distance Matrix, Places, Android SDK',
    category: 'Maps & places',
    purpose: 'Every fare estimate, route line, address search and map screen in both apps.',
    amount: 0,
    currency: 'USD',
    billing: 'usage',
    status: 'active',
    estimate: true,
    note: 'Billed per API call after the monthly credit. Places autocomplete is usually the biggest line.',
    billingUrl: 'https://console.cloud.google.com/google/maps-apis/metrics',
  },

  // ── Distribution ──────────────────────────────────────────────────────────
  {
    id: 'google-play',
    platform: 'Google Play',
    service: 'Developer account',
    category: 'Distribution',
    purpose: 'The account the Android app is published from.',
    amount: 25,
    currency: 'USD',
    billing: 'one-time',
    status: 'active',
    estimate: true,
    note: 'The published registration fee, paid once. Worth confirming against what was actually charged.',
    billingUrl: 'https://play.google.com/console',
  },
  {
    id: 'expo-eas',
    platform: 'Expo',
    service: 'EAS Build',
    category: 'Distribution',
    purpose: 'Builds the signed Android release that goes to Play.',
    amount: 0,
    currency: 'USD',
    billing: 'monthly',
    status: 'free',
    estimate: false,
    note: 'Free plan: 15 Android builds a month, resetting on the 1st. A paid tier only matters if releases outgrow that.',
    billingUrl: 'https://expo.dev/accounts',
  },

  // ── Social & brand ────────────────────────────────────────────────────────
  {
    id: 'meta-verified',
    platform: 'Meta',
    service: 'Meta Verified — Instagram and Facebook blue tick',
    category: 'Social & brand',
    purpose: 'The blue tick on @velocityrides.app, with the impersonation protection and support that come with it.',
    amount: 0,
    currency: 'USD',
    billing: 'monthly',
    status: 'planned',
    estimate: true,
    note: 'A monthly subscription per profile; the business tier costs more than the personal one. Nothing is being paid until this is switched to Paying.',
    billingUrl: 'https://www.facebook.com/business/verified',
  },
  {
    id: 'x-api',
    platform: 'X (Twitter)',
    service: 'API access tier',
    category: 'Social & brand',
    purpose: 'Posting to X from the social desk — the free tier will not carry a publishing schedule.',
    amount: 0,
    currency: 'USD',
    billing: 'monthly',
    status: 'planned',
    estimate: true,
    note: 'Only needed once the X account is connected. Facebook, Instagram, YouTube, TikTok, Threads and LinkedIn all publish on free API access.',
    billingUrl: 'https://developer.x.com/en/portal/products',
  },
  {
    id: 'social-ad-spend',
    platform: 'Meta and Google Ads',
    service: 'Paid reach',
    category: 'Social & brand',
    purpose: 'Money put behind the posts the desk publishes, and behind app-install campaigns.',
    amount: 0,
    currency: 'PKR',
    billing: 'monthly',
    status: 'planned',
    estimate: true,
    note: 'Discretionary — the one line here that is a decision rather than a bill.',
    billingUrl: 'https://business.facebook.com/billing_hub/accounts',
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    id: 'payfast',
    platform: 'PayFast',
    service: 'Aggregator transaction fees',
    category: 'Payments',
    purpose: 'The cut taken on wallet top-ups and card payments once checkout goes live.',
    amount: 0,
    currency: 'PKR',
    billing: 'usage',
    status: 'planned',
    estimate: true,
    note: 'A percentage of each transaction, netted off settlements rather than invoiced. Zero for as long as rides stay cash-only.',
  },

  // ── Domain & mail ─────────────────────────────────────────────────────────
  {
    id: 'domain-velocityrides',
    platform: 'Domain registrar',
    service: 'velocityrides.app',
    category: 'Domain & mail',
    purpose: 'The public origin every share link, legal page and Play listing URL is built from.',
    amount: 20,
    currency: 'USD',
    billing: 'yearly',
    status: 'active',
    estimate: true,
    note: '.app renews yearly and the exact figure depends on the registrar. Replace this with the renewal you were charged.',
  },
  {
    id: 'workspace-mail',
    platform: 'Google Workspace',
    service: 'Mailbox for support@velocityrides.app',
    category: 'Domain & mail',
    purpose: 'A real inbox behind the support address printed on the legal pages and the Play listing.',
    amount: 0,
    currency: 'USD',
    billing: 'monthly',
    status: 'planned',
    estimate: true,
    note: 'Billed per user per month. Still outstanding — the address is published but has nowhere to land.',
    billingUrl: 'https://admin.google.com/ac/billing',
  },
];

/** Where the amounts live. Admin-only — this is what the company spends. */
export const COST_COLLECTION = 'adminConfig';
export const COST_DOC = 'platformCosts';

/** The half of a line an admin can change. */
export type CostOverride = Partial<
  Pick<CostItem, 'amount' | 'currency' | 'billing' | 'status' | 'estimate' | 'note'>
>;

export interface StoredCostConfig {
  usdToPkr?: number;
  overrides?: Record<string, CostOverride>;
  custom?: CostItem[];
  updatedAt?: number;
  updatedBy?: string | null;
}

const BILLINGS: Billing[] = ['monthly', 'yearly', 'one-time', 'usage'];
const STATUSES: CostStatus[] = ['active', 'planned', 'free', 'paused'];

/** Stored documents get hand-edited often enough to be worth checking. */
function clean(raw: unknown): CostOverride {
  const o = (raw ?? {}) as Record<string, unknown>;
  const out: CostOverride = {};
  if (typeof o.amount === 'number' && isFinite(o.amount) && o.amount >= 0) out.amount = o.amount;
  if (o.currency === 'PKR' || o.currency === 'USD') out.currency = o.currency;
  if (BILLINGS.includes(o.billing as Billing)) out.billing = o.billing as Billing;
  if (STATUSES.includes(o.status as CostStatus)) out.status = o.status as CostStatus;
  if (typeof o.estimate === 'boolean') out.estimate = o.estimate;
  if (typeof o.note === 'string') out.note = o.note;
  return out;
}

/**
 * The catalogue with the stored amounts laid over it, plus any lines added from
 * the console. The catalogue always supplies the identity of a line: an
 * override can change what a service costs, never what it is.
 */
export function resolveCosts(stored: StoredCostConfig | undefined | null): {
  items: CostItem[];
  usdToPkr: number;
} {
  const overrides = stored?.overrides ?? {};
  const items: CostItem[] = CATALOGUE.map((base) => ({ ...base, ...clean(overrides[base.id]) }));

  for (const raw of Array.isArray(stored?.custom) ? stored.custom : []) {
    if (!raw || typeof raw.id !== 'string' || !raw.id) continue;
    if (items.some((i) => i.id === raw.id)) continue;
    items.push({
      id: raw.id,
      platform: typeof raw.platform === 'string' ? raw.platform : 'Unnamed',
      service: typeof raw.service === 'string' ? raw.service : '',
      category: (CATEGORIES as readonly string[]).includes(raw.category)
        ? raw.category
        : 'Cloud & infrastructure',
      purpose: typeof raw.purpose === 'string' ? raw.purpose : '',
      amount: 0,
      currency: 'PKR',
      billing: 'monthly',
      status: 'active',
      estimate: false,
      billingUrl: typeof raw.billingUrl === 'string' ? raw.billingUrl : undefined,
      custom: true,
      ...clean(raw),
    });
  }

  const rate =
    typeof stored?.usdToPkr === 'number' && stored.usdToPkr > 0
      ? stored.usdToPkr
      : DEFAULT_USD_TO_PKR;

  return { items, usdToPkr: rate };
}

/** Only what differs from the catalogue is worth storing. */
export function overrideFor(item: CostItem): CostOverride | null {
  const base = CATALOGUE.find((c) => c.id === item.id);
  if (!base) return null;
  const diff: CostOverride = {};
  if (item.amount !== base.amount) diff.amount = item.amount;
  if (item.currency !== base.currency) diff.currency = item.currency;
  if (item.billing !== base.billing) diff.billing = item.billing;
  if (item.status !== base.status) diff.status = item.status;
  if (item.estimate !== base.estimate) diff.estimate = item.estimate;
  if ((item.note ?? '') !== (base.note ?? '')) diff.note = item.note ?? '';
  return Object.keys(diff).length ? diff : null;
}

export function toPkr(amount: number, currency: CostCurrency, usdToPkr: number): number {
  return currency === 'USD' ? amount * usdToPkr : amount;
}

/**
 * One line as rupees a month. A yearly bill is spread across twelve; a
 * usage-billed line is already a month of usage; a one-time fee is not a run
 * rate at all and is counted separately.
 */
export function monthlyPkr(item: CostItem, usdToPkr: number): number {
  if (item.billing === 'one-time') return 0;
  const amount = toPkr(item.amount, item.currency, usdToPkr);
  return item.billing === 'yearly' ? amount / 12 : amount;
}

export interface CostSummary {
  /** Rupees a month across everything currently being paid for. */
  monthly: number;
  /** The same, over a year. */
  yearly: number;
  /** Set-up fees that are not part of any run rate. */
  oneTime: number;
  /** What the planned lines would add to the monthly figure if switched on. */
  planned: number;
  activeCount: number;
  plannedCount: number;
  /** Lines being paid for that have never had a real number typed in. */
  unpriced: CostItem[];
  /** Priced lines still carrying a guessed figure. */
  estimated: CostItem[];
  byPlatform: { label: string; value: number }[];
  byCategory: { label: string; value: number }[];
}

export function summarise(items: CostItem[], usdToPkr: number): CostSummary {
  let monthly = 0;
  let oneTime = 0;
  let planned = 0;
  let activeCount = 0;
  let plannedCount = 0;
  const unpriced: CostItem[] = [];
  const estimated: CostItem[] = [];
  const platform = new Map<string, number>();
  const category = new Map<string, number>();

  for (const item of items) {
    const perMonth = monthlyPkr(item, usdToPkr);

    if (item.status === 'active') {
      activeCount += 1;
      monthly += perMonth;
      if (item.billing === 'one-time') oneTime += toPkr(item.amount, item.currency, usdToPkr);
      if (item.amount === 0) unpriced.push(item);
      else if (item.estimate) estimated.push(item);
      if (perMonth > 0) {
        platform.set(item.platform, (platform.get(item.platform) ?? 0) + perMonth);
        category.set(item.category, (category.get(item.category) ?? 0) + perMonth);
      }
    } else if (item.status === 'planned') {
      plannedCount += 1;
      planned += perMonth;
    }
  }

  const rank = (m: Map<string, number>) =>
    [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

  return {
    monthly,
    yearly: monthly * 12,
    oneTime,
    planned,
    activeCount,
    plannedCount,
    unpriced,
    estimated,
    byPlatform: rank(platform),
    byCategory: rank(category),
  };
}

/** `148320` → `148,320 PKR`. Whole rupees; nobody budgets in paisa. */
export function pkr(n: number): string {
  return `${Math.round(n).toLocaleString('en-PK')} PKR`;
}

export const BILLING_LABELS: Record<Billing, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  'one-time': 'One-off',
  usage: 'Per use',
};

export const STATUS_LABELS: Record<CostStatus, string> = {
  active: 'Paying',
  planned: 'Planned',
  free: 'Free tier',
  paused: 'Paused',
};
