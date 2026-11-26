/**
 * The whole app's data and the rules that move it.
 *
 * One module-level object plus a subscribe/commit pair: something added on one
 * screen is still there when you come back from another, and every screen
 * derives what it shows from here. Nothing is written into a screen by hand —
 * times are real timestamps, credits come out of a ledger, and every piece of
 * work a feature does goes through `record()`.
 *
 * It lives in memory: no API, no Firebase. Reloading the app starts it again.
 */
import { useEffect, useState } from 'react';

/* ───────────────────────────── time ───────────────────────────── */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const now = () => Date.now();
const ago = (ms: number) => Date.now() - ms;

/** Plans renew, and credits refill, on the 1st. */
export function firstOfNextMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

/** "Just now", "12 min ago", "2 h ago", "Yesterday", "3 days ago". */
export function timeAgo(at: number): string {
  const d = Date.now() - at;
  if (d < 0) return inWords(at);
  if (d < 90_000) return 'Just now';
  if (d < HOUR) return `${Math.round(d / MIN)} min ago`;
  if (d < 20 * HOUR) return `${Math.round(d / HOUR)} h ago`;
  if (sameDay(at, Date.now() - DAY)) return 'Yesterday';
  if (d < 7 * DAY) return `${Math.round(d / DAY)} days ago`;
  return inWords(at);
}

/** "Tomorrow, 19:30" for something still to happen, else a short date. */
function inWords(at: number) {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const clockOf = (at: number) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function sameDay(a: number, b: number) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "Today" / "Yesterday" / "Mon 24 Nov" — how the activity list groups itself. */
export function dayBucket(at: number): string {
  if (sameDay(at, Date.now())) return 'Today';
  if (sameDay(at, Date.now() - DAY)) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** YYYY-MM-DD, n days from today — the calendar's day key. */
export function day(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function prettyDay(iso: string) {
  if (iso === day(0)) return 'Today';
  if (iso === day(1)) return 'Tomorrow';
  if (iso === day(-1)) return 'Yesterday';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const uid = () => Math.random().toString(36).slice(2, 9);

/* ───────────────────────────── what things are ───────────────────────────── */

export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'google';
export type Channel = Platform | 'gmail' | 'whatsapp';

export const PLATFORMS: Platform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'google'];
export const CHANNELS: Channel[] = [...PLATFORMS, 'gmail', 'whatsapp'];

export const CHANNEL_NAME: Record<Channel, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google: 'Google',
  gmail: 'Gmail',
  whatsapp: 'WhatsApp',
};
/** Kept for the screens that only ever deal in the social platforms. */
export const PLATFORM_NAME = CHANNEL_NAME as Record<Platform, string>;

export type Agent = 'Research' | 'Content' | 'Ads' | 'Sales' | 'Vexa';

/** What each team is called on screen. */
export const TEAM: Record<Agent, string> = {
  Research: 'Research Team',
  Content: 'Content Team',
  Ads: 'Ads Expert',
  Sales: 'Sales Team',
  Vexa: 'Vexa',
};

/** What each piece of her work costs, in credits. One place, used by the
 *  features that do the work and by the Usage screen that explains it. */
export const COST = {
  post: 4,
  reel: 12,
  reply: 1,
  brief: 25,
  campaign: 15,
  lesson: 2,
  outreach: 2, // per person written to
  search: 8,
} as const;

export const COST_LIST: Array<[string, keyof typeof COST]> = [
  ['A written post with hashtags', 'post'],
  ['A reel script and its edit', 'reel'],
  ['An answer to a customer', 'reply'],
  ['A research brief', 'brief'],
  ['A campaign built and launched', 'campaign'],
  ['Finding people for you', 'search'],
  ['Writing to one of them', 'outreach'],
];

export type Plan = 'Starter' | 'Pro' | 'Business';

export const PLANS: Array<{ key: Plan; month: number; credits: number; accounts: number; line: string; has: string[] }> = [
  {
    key: 'Starter',
    month: 20,
    credits: 1500,
    accounts: 1,
    line: 'One account, posts written and scheduled for you.',
    has: ['1 connected account', '40 pieces a month', 'Answers your DMs', '1,500 credits'],
  },
  {
    key: 'Pro',
    month: 26,
    credits: 3500,
    accounts: 5,
    line: 'Every account, ads included, and she answers customers herself.',
    has: ['5 connected accounts', 'Unlimited pieces', 'Runs your ads', '3,500 credits', 'Research briefs', 'Learns your rules'],
  },
  {
    key: 'Business',
    month: 32,
    credits: 10000,
    accounts: 15,
    line: 'For a team: more hands, more accounts, someone to call.',
    has: ['15 connected accounts', 'Everything in Pro', '10,000 credits', 'Three people on the account', 'A human to call'],
  },
];

export type PostKind = 'reel' | 'post' | 'story';
export type PostStatus = 'draft' | 'approve' | 'scheduled' | 'posted';

export type Post = {
  id: string;
  title: string;
  caption: string;
  kind: PostKind;
  platforms: Platform[];
  day: string; // YYYY-MM-DD
  time: string; // HH:MM
  status: PostStatus;
  hashtags: string[];
  views?: number;
  likes?: number;
  comments?: number;
};

export type Campaign = {
  id: string;
  name: string;
  goal: 'Leads' | 'Sales' | 'Reach' | 'Followers';
  status: 'live' | 'paused' | 'draft' | 'ended';
  platforms: Platform[];
  budget: number; // PKR per day
  city: string;
  age: string;
  interests: string[];
  creative: string;
  spend: number;
  reach: number;
  leads: number;
  roas: number;
  days: number[]; // spend over the last 7 days, oldest first
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  source: Channel;
  stage: 'new' | 'talking' | 'quoted' | 'won' | 'lost';
  value: number;
  city: string;
  at: number;
  notes: string[];
  thread: Array<{ from: 'them' | 'us'; text: string; at: number }>;
};

export type Account = {
  key: Channel;
  name: string;
  handle: string;
  state: 'connected' | 'off';
  followers?: number;
  synced?: number;
  scopes: string[];
};

/** Somebody she found for you, and where that has got to. */
export type Prospect = {
  id: string;
  name: string;
  handle: string; // @handle, an email address or a number
  channel: Channel;
  who: string;
  city: string;
  reach: number;
  why: string;
  state: 'found' | 'queued' | 'sent' | 'replied' | 'won' | 'skipped';
  at: number;
  note?: string;
};

/** One run of "find these people and write to them". */
export type Run = {
  id: string;
  title: string;
  who: string;
  channels: Channel[];
  city: string;
  asked: string;
  found: number;
  sent: number;
  replied: number;
  at: number;
  state: 'draft' | 'sending' | 'done';
  message: string;
  subject?: string;
};

/** A message she reuses: a DM or an email. */
export type Template = {
  id: string;
  name: string;
  channel: Channel;
  subject?: string;
  body: string;
  used: number;
};

export type Lesson = {
  id: string;
  kind: 'note' | 'link' | 'file';
  title: string;
  body: string;
  at: number;
  trained: boolean;
};

export type Report = {
  id: string;
  topic: string;
  at: number;
  sources: number;
  findings: Array<{ head: string; body: string }>;
};

export type Invoice = { id: string; no: string; at: number; amount: number; state: 'paid' | 'due' };
export type Card = { id: string; brand: string; last4: string; exp: string; primary: boolean };
export type Notice = { id: string; title: string; line: string; at: number; read: boolean; agent: Agent };
export type Act = { id: string; agent: Agent; text: string; at: number };
/** One line of the credit ledger: who spent what, on what. */
export type Spend = { id: string; agent: Agent; credits: number; what: string; at: number };

/* ───────────────────────────── the data ───────────────────────────── */

export const db = {
  me: {
    name: 'Hassan Zahir',
    email: 'hassam@berreto.com',
    phone: '+92 300 1234567',
    business: 'Berreto Studio',
    trade: 'Clothing brand',
    city: 'Lahore',
    about: 'Hand-finished shirts and kurtas, made in Lahore, shipped all over Pakistan.',
    voice: 'Warm, short sentences, never pushy. English with the odd Urdu word.',
    hours: '11:00 – 20:00, closed Sunday',
    plan: 'Pro' as Plan,
    yearly: false,
    renews: firstOfNextMonth(),
    notify: { posts: true, leads: true, ads: true, weekly: false },
    autoPost: true,
    autoTopUp: false,
    /** Bought credits on top of the plan's monthly allowance. */
    extraCredits: 0,
  },

  posts: [
    {
      id: uid(),
      title: 'Winter drop teaser',
      caption: 'The winter drop lands Friday. Three shirts, one coat, nothing repeated.',
      kind: 'reel',
      platforms: ['instagram', 'tiktok'],
      day: day(0),
      time: '19:30',
      status: 'scheduled',
      hashtags: ['#berreto', '#winterdrop', '#lahore'],
    },
    {
      id: uid(),
      title: 'Behind the stitch',
      caption: 'Forty minutes on one collar. This is why it sits flat all day.',
      kind: 'post',
      platforms: ['instagram', 'facebook'],
      day: day(0),
      time: '13:00',
      status: 'approve',
      hashtags: ['#madeinpakistan', '#craft'],
    },
    {
      id: uid(),
      title: 'Customer in Karachi',
      caption: 'Ahmed wore his for a wedding and three people asked where it came from.',
      kind: 'story',
      platforms: ['instagram'],
      day: day(1),
      time: '11:00',
      status: 'draft',
      hashtags: ['#berreto'],
    },
    {
      id: uid(),
      title: 'Eid sale is live',
      caption: 'Flat 20% until Sunday night. Free delivery over PKR 5,000.',
      kind: 'post',
      platforms: ['instagram', 'facebook', 'google'],
      day: day(-1),
      time: '18:00',
      status: 'posted',
      hashtags: ['#eidsale', '#berreto'],
      views: 18400,
      likes: 1260,
      comments: 83,
    },
    {
      id: uid(),
      title: 'How we pack an order',
      caption: 'Tissue, box, card, tape. Ninety seconds, every single time.',
      kind: 'reel',
      platforms: ['tiktok', 'youtube'],
      day: day(-2),
      time: '20:00',
      status: 'posted',
      hashtags: ['#smallbusiness', '#packing'],
      views: 41200,
      likes: 3180,
      comments: 204,
    },
  ] as Post[],

  campaigns: [
    {
      id: uid(),
      name: 'Winter drop — Lahore',
      goal: 'Sales',
      status: 'live',
      platforms: ['instagram', 'facebook'],
      budget: 999,
      city: 'Lahore',
      age: '22 – 38',
      interests: ['Fashion', 'Shopping', 'Weddings'],
      creative: 'Winter drop teaser (reel)',
      spend: 6993,
      reach: 48200,
      leads: 61,
      roas: 3.4,
      days: [900, 999, 999, 940, 999, 999, 912],
    },
    {
      id: uid(),
      name: 'WhatsApp enquiries',
      goal: 'Leads',
      status: 'paused',
      platforms: ['facebook'],
      budget: 500,
      city: 'Karachi',
      age: '25 – 45',
      interests: ['Gifting', 'Menswear'],
      creative: 'Behind the stitch (photo)',
      spend: 3500,
      reach: 21400,
      leads: 34,
      roas: 2.1,
      days: [500, 500, 500, 0, 0, 0, 0],
    },
    {
      id: uid(),
      name: 'Eid remarketing',
      goal: 'Sales',
      status: 'ended',
      platforms: ['instagram', 'google'],
      budget: 1500,
      city: 'All Pakistan',
      age: '18 – 50',
      interests: ['Eid', 'Fashion'],
      creative: 'Eid sale is live (photo)',
      spend: 21000,
      reach: 164000,
      leads: 212,
      roas: 4.8,
      days: [1500, 1500, 1500, 1500, 1500, 1500, 1500],
    },
  ] as Campaign[],

  leads: [
    {
      id: uid(),
      name: 'Ayesha Khan',
      phone: '+92 321 4455667',
      source: 'instagram',
      stage: 'talking',
      value: 12000,
      city: 'Lahore',
      at: ago(12 * MIN),
      notes: ['Wants the navy shirt in large.'],
      thread: [
        { from: 'them', text: 'Is the navy shirt available in large?', at: ago(12 * MIN) },
        { from: 'us', text: 'It is — large is in stock. Want me to hold one for you?', at: ago(10 * MIN) },
        { from: 'them', text: 'Yes please. How long is delivery to Lahore?', at: ago(8 * MIN) },
      ],
    },
    {
      id: uid(),
      name: 'Bilal Ahmed',
      phone: '+92 333 1122334',
      source: 'whatsapp',
      stage: 'quoted',
      value: 34000,
      city: 'Karachi',
      at: ago(2 * HOUR),
      notes: ['Wedding order, 4 kurtas.', 'Asked for a discount on four.'],
      thread: [
        { from: 'them', text: 'I need 4 kurtas for a wedding on the 28th.', at: ago(2 * HOUR) },
        { from: 'us', text: 'We can do all four by the 24th. PKR 34,000 for the set.', at: ago(2 * HOUR - 4 * MIN) },
      ],
    },
    {
      id: uid(),
      name: 'Sana Tariq',
      phone: '+92 345 9988776',
      source: 'facebook',
      stage: 'new',
      value: 0,
      city: 'Islamabad',
      at: ago(4 * HOUR),
      notes: [],
      thread: [{ from: 'them', text: 'Do you ship to Islamabad?', at: ago(4 * HOUR) }],
    },
    {
      id: uid(),
      name: 'Usman Raza',
      phone: '+92 301 5566778',
      source: 'tiktok',
      stage: 'won',
      value: 8500,
      city: 'Faisalabad',
      at: ago(DAY),
      notes: ['Paid by bank transfer.'],
      thread: [
        { from: 'them', text: 'Saw the packing video. Ordering one shirt.', at: ago(DAY) },
        { from: 'us', text: 'Thank you! Shipped this morning.', at: ago(DAY - 2 * HOUR) },
      ],
    },
    {
      id: uid(),
      name: 'Hina Malik',
      phone: '+92 312 3344556',
      source: 'instagram',
      stage: 'lost',
      value: 0,
      city: 'Multan',
      at: ago(3 * DAY),
      notes: ['Price too high for her.'],
      thread: [{ from: 'them', text: 'Too expensive for me, sorry.', at: ago(3 * DAY) }],
    },
  ] as Lead[],

  accounts: [
    {
      key: 'instagram',
      name: 'Instagram',
      handle: '@berreto.studio',
      state: 'connected',
      followers: 18400,
      synced: ago(4 * MIN),
      scopes: ['Post reels & photos', 'Read comments', 'Reply to DMs'],
    },
    {
      key: 'facebook',
      name: 'Facebook',
      handle: 'Berreto Studio',
      state: 'connected',
      followers: 9100,
      synced: ago(4 * MIN),
      scopes: ['Post to Page', 'Read comments', 'Run ads'],
    },
    {
      key: 'tiktok',
      name: 'TikTok',
      handle: '@berreto',
      state: 'connected',
      followers: 26300,
      synced: ago(HOUR),
      scopes: ['Upload videos', 'Read stats'],
    },
    { key: 'youtube', name: 'YouTube', handle: 'Berreto Studio', state: 'off', scopes: ['Upload videos', 'Read stats'] },
    { key: 'google', name: 'Google', handle: 'Berreto Studio', state: 'off', scopes: ['Business profile', 'Ads (read only)'] },
    {
      key: 'gmail',
      name: 'Gmail',
      handle: 'hello@berreto.com',
      state: 'connected',
      synced: ago(9 * MIN),
      scopes: ['Send email as you', 'Read replies to what she sent', 'Nothing else in your mailbox'],
    },
    { key: 'whatsapp', name: 'WhatsApp', handle: '+92 300 1234567', state: 'off', scopes: ['Send messages', 'Read replies'] },
  ] as Account[],

  prospects: [
    {
      id: uid(),
      name: 'Zafar Iqbal',
      handle: '@zafar.ventures',
      channel: 'instagram',
      who: 'Investor',
      city: 'Karachi',
      reach: 41200,
      why: 'Backs three Pakistani clothing brands; posts about early cheques.',
      state: 'replied',
      at: ago(DAY),
      note: 'Asked for last year’s numbers.',
    },
    {
      id: uid(),
      name: 'Lahore Angels',
      handle: 'hello@lahoreangels.pk',
      channel: 'gmail',
      who: 'Investor',
      city: 'Lahore',
      reach: 0,
      why: 'Writes PKR 5–20m cheques to local retail.',
      state: 'sent',
      at: ago(DAY + 3 * HOUR),
    },
    {
      id: uid(),
      name: 'Mehreen Shah',
      handle: '@mehreen.styles',
      channel: 'instagram',
      who: 'Creator',
      city: 'Lahore',
      reach: 86300,
      why: 'Her audience is exactly your buyer, and she takes barter deals.',
      state: 'found',
      at: ago(5 * HOUR),
    },
  ] as Prospect[],

  runs: [
    {
      id: uid(),
      title: 'Investors on Instagram + Gmail',
      who: 'Investors',
      channels: ['instagram', 'gmail'],
      city: 'Karachi',
      asked: 'find me investors on instagram and email them',
      found: 42,
      sent: 28,
      replied: 3,
      at: ago(DAY),
      state: 'done',
      message:
        'Hello — I run Berreto Studio, a clothing brand in Lahore doing PKR 1.4m a month. We are raising a small round to open a second workshop. Could I send you one page on it?',
      subject: 'Berreto Studio — a small round, one page',
    },
  ] as Run[],

  templates: [
    {
      id: uid(),
      name: 'Investor first touch',
      channel: 'gmail',
      subject: 'Berreto Studio — a small round, one page',
      body: 'Hello {name},\n\nI run Berreto Studio, a clothing brand in Lahore. We did PKR 1.4m last month, mostly repeat buyers, and we are raising a small round to open a second workshop.\n\nMay I send you one page on it?\n\nHassan',
      used: 28,
    },
    {
      id: uid(),
      name: 'Creator barter',
      channel: 'instagram',
      body: 'Hi {name} — your winter posts are lovely. We make shirts in Lahore and would love to send you one, no strings. If you like it, say so; if not, keep it anyway.',
      used: 11,
    },
  ] as Template[],

  lessons: [
    {
      id: uid(),
      kind: 'note',
      title: 'Never promise next-day delivery',
      body: 'Courier takes 2–4 days outside Lahore. Always say 2–4 working days.',
      at: ago(2 * DAY),
      trained: true,
    },
    {
      id: uid(),
      kind: 'note',
      title: 'Our prices are never negotiable below 10%',
      body: 'Maximum discount is 10%, and only on orders of three or more.',
      at: ago(5 * DAY),
      trained: true,
    },
    { id: uid(), kind: 'link', title: 'Size guide page', body: 'berreto.com/size-guide', at: ago(8 * DAY), trained: true },
    { id: uid(), kind: 'file', title: 'Winter catalogue.pdf', body: '14 pages, prices included', at: ago(9 * DAY), trained: false },
  ] as Lesson[],

  reports: [
    {
      id: uid(),
      topic: 'What my competitors posted this week',
      at: ago(5 * HOUR),
      sources: 24,
      findings: [
        {
          head: 'Three of four rivals went to reels only',
          body: 'Photo posts dropped to under a fifth of their output. Reels under 15 seconds got the most saves.',
        },
        {
          head: 'Everyone is running a winter discount',
          body: 'Between 15% and 30%. Two of them put the discount in the first frame of the video.',
        },
        {
          head: 'Nobody is answering comments',
          body: 'Average reply time over 14 hours. Answering inside an hour would stand out.',
        },
      ],
    },
    {
      id: uid(),
      topic: 'Best posting times for Lahore',
      at: ago(DAY + 2 * HOUR),
      sources: 11,
      findings: [
        { head: '19:00 – 21:30 is your window', body: 'Engagement is 2.3× the day average. Friday evening is the single best slot.' },
        { head: 'Avoid 14:00 – 16:00', body: 'Lowest reach all week, every week.' },
      ],
    },
  ] as Report[],

  /** What her rivals did this week — the Research screen reads this, nothing
   *  is typed into the screen itself. */
  market: {
    rivalPosts: [14, 18, 11, 22, 26, 19, 16],
    avgDiscount: 22,
    shareOfVoice: 14,
    lastWeekPosts: 108,
  },

  invoices: [
    { id: uid(), no: 'VX-2026-11', at: ago(25 * DAY), amount: 26, state: 'paid' },
    { id: uid(), no: 'VX-2026-10', at: ago(55 * DAY), amount: 26, state: 'paid' },
    { id: uid(), no: 'VX-2026-09', at: ago(85 * DAY), amount: 20, state: 'paid' },
  ] as Invoice[],

  cards: [{ id: uid(), brand: 'Visa', last4: '4242', exp: '09 / 29', primary: true }] as Card[],

  notices: [
    {
      id: uid(),
      title: 'Winter drop teaser is scheduled',
      line: 'Going out tonight at 19:30 on Instagram and TikTok.',
      at: ago(6 * MIN),
      read: false,
      agent: 'Content',
    },
    {
      id: uid(),
      title: 'Ayesha Khan asked about delivery',
      line: 'She answered and held a navy shirt in large.',
      at: ago(12 * MIN),
      read: false,
      agent: 'Sales',
    },
    {
      id: uid(),
      title: 'Winter drop — Lahore has spent PKR 912',
      line: 'PKR 87 of today’s budget left. It stops itself at PKR 999.',
      at: ago(HOUR),
      read: true,
      agent: 'Ads',
    },
    {
      id: uid(),
      title: 'Competitor research is ready',
      line: '24 sources read. Three things worth copying.',
      at: ago(5 * HOUR),
      read: true,
      agent: 'Research',
    },
  ] as Notice[],

  acts: [
    { id: uid(), agent: 'Content', text: 'Wrote and scheduled “Winter drop teaser” for 19:30.', at: ago(20 * MIN) },
    { id: uid(), agent: 'Sales', text: 'Answered Ayesha Khan about large sizes and delivery.', at: ago(10 * MIN) },
    { id: uid(), agent: 'Ads', text: 'Held “Winter drop — Lahore” at today’s budget.', at: ago(HOUR) },
    { id: uid(), agent: 'Research', text: 'Read 24 competitor posts and wrote this week’s brief.', at: ago(5 * HOUR) },
    { id: uid(), agent: 'Content', text: 'Replied to 11 comments on “How we pack an order”.', at: ago(7 * HOUR) },
    { id: uid(), agent: 'Sales', text: 'Quoted Bilal Ahmed PKR 34,000 for four kurtas.', at: ago(DAY + 2 * HOUR) },
    { id: uid(), agent: 'Content', text: 'Posted “Eid sale is live” to 3 accounts.', at: ago(DAY + 5 * HOUR) },
    { id: uid(), agent: 'Vexa', text: 'Learned a new rule: never promise next-day delivery.', at: ago(DAY + 9 * HOUR) },
    { id: uid(), agent: 'Ads', text: 'Moved PKR 400 from Facebook to Instagram — cheaper reach.', at: ago(2 * DAY) },
    { id: uid(), agent: 'Sales', text: 'Chased two enquiries that had gone quiet for a day.', at: ago(2 * DAY + 3 * HOUR) },
    { id: uid(), agent: 'Research', text: 'Found a rival cutting prices 25% in Karachi.', at: ago(2 * DAY + 6 * HOUR) },
  ] as Act[],

  /** The credit ledger. Usage is worked out from this and nothing else. */
  usage: [
    { id: uid(), agent: 'Content', credits: COST.reel, what: 'Winter drop teaser', at: ago(20 * MIN) },
    { id: uid(), agent: 'Sales', credits: COST.reply, what: 'Answer to Ayesha Khan', at: ago(10 * MIN) },
    { id: uid(), agent: 'Research', credits: COST.brief, what: 'Competitor brief', at: ago(5 * HOUR) },
    { id: uid(), agent: 'Content', credits: 11 * COST.reply, what: '11 comment replies', at: ago(7 * HOUR) },
    { id: uid(), agent: 'Content', credits: COST.post, what: 'Behind the stitch', at: ago(9 * HOUR) },
    { id: uid(), agent: 'Ads', credits: COST.campaign, what: 'Winter drop — Lahore', at: ago(DAY) },
    { id: uid(), agent: 'Sales', credits: 28 * COST.outreach, what: '28 investors written to', at: ago(DAY + HOUR) },
    { id: uid(), agent: 'Content', credits: 3 * COST.post + COST.reel, what: 'Last week’s calendar', at: ago(2 * DAY) },
    { id: uid(), agent: 'Research', credits: COST.brief, what: 'Posting times brief', at: ago(2 * DAY + 2 * HOUR) },
    { id: uid(), agent: 'Ads', credits: COST.campaign, what: 'Eid remarketing', at: ago(3 * DAY) },
    { id: uid(), agent: 'Content', credits: 24 * COST.post, what: 'The month ahead', at: ago(4 * DAY) },
    { id: uid(), agent: 'Sales', credits: 60 * COST.reply, what: 'Customer answers', at: ago(5 * DAY) },
    { id: uid(), agent: 'Content', credits: 40 * COST.post, what: 'Earlier this month', at: ago(12 * DAY) },
    { id: uid(), agent: 'Ads', credits: 8 * COST.campaign, what: 'Campaign work', at: ago(16 * DAY) },
    { id: uid(), agent: 'Research', credits: 20 * COST.brief, what: 'Market reading', at: ago(20 * DAY) },
    { id: uid(), agent: 'Content', credits: 60 * COST.reel, what: 'Reels this month', at: ago(22 * DAY) },
  ] as Spend[],
};

/* ───────────────────────────── derived ───────────────────────────── */

/** The plan's monthly allowance plus anything bought on top. */
export function creditsTotal() {
  return (PLANS.find((p) => p.key === db.me.plan)?.credits ?? 0) + db.me.extraCredits;
}

/** Everything spent since the month began — the ledger, nothing else. */
export function creditsUsed() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return db.usage.filter((u) => u.at >= start.getTime()).reduce((n, u) => n + u.credits, 0);
}

export function creditsLeft() {
  return Math.max(0, creditsTotal() - creditsUsed());
}

/** Spent between `from` and now. */
export function spentSince(ms: number) {
  const from = Date.now() - ms;
  return db.usage.filter((u) => u.at >= from).reduce((n, u) => n + u.credits, 0);
}

/** Credits per agent this month, biggest first. */
export function spendByAgent(): Array<{ agent: Agent; credits: number }> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const sums = new Map<Agent, number>();
  db.usage
    .filter((u) => u.at >= start.getTime())
    .forEach((u) => sums.set(u.agent, (sums.get(u.agent) ?? 0) + u.credits));
  return [...sums.entries()]
    .map(([agent, credits]) => ({ agent, credits }))
    .sort((a, b) => b.credits - a.credits);
}

/** The last seven days of credit spend, oldest first, with day initials. */
export function spendWeek(): { data: number[]; labels: string[] } {
  const data: number[] = [];
  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const from = new Date(d).setHours(0, 0, 0, 0);
    const to = from + DAY;
    data.push(db.usage.filter((u) => u.at >= from && u.at < to).reduce((n, u) => n + u.credits, 0));
    labels.push(d.toLocaleDateString('en-GB', { weekday: 'short' }));
  }
  return { data, labels };
}

/** How long the credits last at the last seven days' rate. */
export function daysOfCreditsLeft() {
  const perDay = spentSince(7 * DAY) / 7;
  if (perDay <= 0) return Infinity;
  return Math.max(0, Math.round(creditsLeft() / perDay));
}

export const actsOn = (at: number) => db.acts.filter((a) => sameDay(a.at, at));
export const connected = () => db.accounts.filter((a) => a.state === 'connected');

/** Today's jobs, and how many are behind her — what the drawer ring shows. */
export function todayProgress() {
  const todaysActs = db.acts.filter((a) => sameDay(a.at, Date.now())).length;
  const waiting =
    db.posts.filter((p) => p.status === 'approve').length +
    db.leads.filter((l) => l.stage === 'new').length +
    db.prospects.filter((p) => p.state === 'found').length;
  const all = todaysActs + waiting;
  return { done: todaysActs, waiting, all, pct: all ? todaysActs / all : 0 };
}

/* ───────────────────────────── writing ───────────────────────────── */

const subs = new Set<() => void>();

/** Re-render this screen whenever anything in the store changes. */
export function useDb() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return db;
}

/** Call after every mutation. */
export function commit() {
  subs.forEach((f) => f());
}

/**
 * One place that books a piece of her work: it spends the credits, writes the
 * activity line, and tells you if it is something you should know about.
 * Every feature goes through here, so Activity, Usage and Notifications can
 * never drift apart from what actually happened.
 */
export function record(opts: {
  agent: Agent;
  text: string;
  credits?: number;
  what?: string;
  notice?: { title: string; line: string };
}) {
  const at = Date.now();
  db.acts.unshift({ id: uid(), agent: opts.agent, text: opts.text, at });
  if (opts.credits) {
    db.usage.unshift({ id: uid(), agent: opts.agent, credits: opts.credits, what: opts.what ?? opts.text, at });
  }
  if (opts.notice) {
    db.notices.unshift({ id: uid(), title: opts.notice.title, line: opts.notice.line, at, read: false, agent: opts.agent });
  }
  commit();
}

/* ───────────────────────────── ad estimates ───────────────────────────── */

/** Roughly how many adults are reachable in each city we sell in. */
const CITY_REACH: Record<string, number> = {
  Lahore: 13_000_000,
  Karachi: 17_000_000,
  Islamabad: 1_200_000,
  Rawalpindi: 2_300_000,
  Faisalabad: 3_700_000,
  Multan: 2_100_000,
  Peshawar: 2_300_000,
  Quetta: 1_100_000,
  Sialkot: 900_000,
  Dubai: 3_500_000,
  'All Pakistan': 240_000_000,
};

/** What a campaign's audience comes to, from the city and the interests. */
export function audienceOf(city: string, interests: string[]) {
  const people = CITY_REACH[city] ?? 1_000_000;
  const narrow = Math.max(0.004, 0.02 - interests.length * 0.004);
  return Math.round((people * narrow) / 1000) * 1000;
}

/** What you have actually paid per thousand people reached, so far. */
export function cpmPkr() {
  const spend = db.campaigns.reduce((n, c) => n + c.spend, 0);
  const reach = db.campaigns.reduce((n, c) => n + c.reach, 0);
  if (!reach) return 120;
  return Math.round((spend / reach) * 1000);
}

/** What each enquiry has cost you across every campaign. */
export function costPerLead() {
  const spend = db.campaigns.reduce((n, c) => n + c.spend, 0);
  const leads = db.campaigns.reduce((n, c) => n + c.leads, 0);
  return leads ? Math.round(spend / leads) : 0;
}

/** The app's own version, shown in the drawer and on Profile. */
export const APP_VERSION = '2.1.0';
export const OWNER = 'Berreto (Private) Limited';

/** Where a bank transfer should go. */
export const BANK: Array<[string, string]> = [
  ['Title', 'Berreto'],
  ['Bank', 'Meezan Bank'],
  ['Account', 'PK36 MEZN 0001 2345 6789 0123'],
  ['Branch', 'Gulberg III, Lahore'],
];
