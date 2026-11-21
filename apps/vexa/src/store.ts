/**
 * The whole app's data, in memory. No API, no Firebase: one module-level
 * object plus a subscribe/commit pair, so a row added on one screen is still
 * there when you come back from another. Reset by reloading the app.
 */
import { useEffect, useState } from 'react';

export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'google';
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
  days: number[]; // last 7 days of spend, for the chart
};

export type Lead = {
  id: string;
  name: string;
  phone: string;
  source: Platform | 'whatsapp';
  stage: 'new' | 'talking' | 'quoted' | 'won' | 'lost';
  value: number;
  city: string;
  at: string;
  notes: string[];
  thread: Array<{ from: 'them' | 'us'; text: string; at: string }>;
};

export type Account = {
  key: Platform;
  name: string;
  handle: string;
  state: 'connected' | 'off';
  followers?: number;
  synced?: string;
  scopes: string[];
};

export type Lesson = {
  id: string;
  kind: 'note' | 'link' | 'file';
  title: string;
  body: string;
  at: string;
  trained: boolean;
};

export type Report = {
  id: string;
  topic: string;
  at: string;
  sources: number;
  findings: Array<{ head: string; body: string }>;
};

export type Invoice = { id: string; no: string; date: string; amount: number; state: 'paid' | 'due' };
export type Card = { id: string; brand: string; last4: string; exp: string; primary: boolean };
export type Notice = { id: string; title: string; line: string; at: string; read: boolean; agent: Agent };
export type Agent = 'Research' | 'Content' | 'Ads' | 'Sales' | 'Vexa';
export type Act = { id: string; agent: Agent; text: string; at: string; day: 'Today' | 'Yesterday' };

export const uid = () => Math.random().toString(36).slice(2, 9);

/** YYYY-MM-DD, n days from today. */
export function day(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function prettyDay(iso: string) {
  if (iso === day(0)) return 'Today';
  if (iso === day(1)) return 'Tomorrow';
  if (iso === day(-1)) return 'Yesterday';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export const PLATFORMS: Platform[] = ['instagram', 'facebook', 'tiktok', 'youtube', 'google'];
export const PLATFORM_NAME: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  google: 'Google',
};

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
    plan: 'Pro' as 'Starter' | 'Pro' | 'Business',
    yearly: false,
    credits: { used: 2400, total: 3500 },
    notify: { posts: true, leads: true, ads: true, weekly: false },
    autoPost: true,
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
      at: '12 min ago',
      notes: ['Wants the navy shirt in large.'],
      thread: [
        { from: 'them', text: 'Is the navy shirt available in large?', at: '12 min ago' },
        { from: 'us', text: 'It is — large is in stock. Want me to hold one for you?', at: '10 min ago' },
        { from: 'them', text: 'Yes please. How long is delivery to Lahore?', at: '8 min ago' },
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
      at: '2 h ago',
      notes: ['Wedding order, 4 kurtas.', 'Asked for a discount on four.'],
      thread: [
        { from: 'them', text: 'I need 4 kurtas for a wedding on the 28th.', at: '2 h ago' },
        { from: 'us', text: 'We can do all four by the 24th. PKR 34,000 for the set.', at: '2 h ago' },
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
      at: '4 h ago',
      notes: [],
      thread: [{ from: 'them', text: 'Do you ship to Islamabad?', at: '4 h ago' }],
    },
    {
      id: uid(),
      name: 'Usman Raza',
      phone: '+92 301 5566778',
      source: 'tiktok',
      stage: 'won',
      value: 8500,
      city: 'Faisalabad',
      at: 'Yesterday',
      notes: ['Paid by bank transfer.'],
      thread: [
        { from: 'them', text: 'Saw the packing video. Ordering one shirt.', at: 'Yesterday' },
        { from: 'us', text: 'Thank you! Shipped this morning.', at: 'Yesterday' },
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
      at: '3 days ago',
      notes: ['Price too high for her.'],
      thread: [{ from: 'them', text: 'Too expensive for me, sorry.', at: '3 days ago' }],
    },
  ] as Lead[],

  accounts: [
    {
      key: 'instagram',
      name: 'Instagram',
      handle: '@berreto.studio',
      state: 'connected',
      followers: 18400,
      synced: '4 min ago',
      scopes: ['Post reels & photos', 'Read comments', 'Reply to DMs'],
    },
    {
      key: 'facebook',
      name: 'Facebook',
      handle: 'Berreto Studio',
      state: 'connected',
      followers: 9100,
      synced: '4 min ago',
      scopes: ['Post to Page', 'Read comments', 'Run ads'],
    },
    { key: 'tiktok', name: 'TikTok', handle: '@berreto', state: 'connected', followers: 26300, synced: '1 h ago', scopes: ['Upload videos', 'Read stats'] },
    { key: 'youtube', name: 'YouTube', handle: 'Berreto Studio', state: 'off', scopes: ['Upload videos', 'Read stats'] },
    { key: 'google', name: 'Google', handle: 'Berreto Studio', state: 'off', scopes: ['Business profile', 'Ads (read only)'] },
  ] as Account[],

  lessons: [
    {
      id: uid(),
      kind: 'note',
      title: 'Never promise next-day delivery',
      body: 'Courier takes 2–4 days outside Lahore. Always say 2–4 working days.',
      at: '2 days ago',
      trained: true,
    },
    {
      id: uid(),
      kind: 'note',
      title: 'Our prices are never negotiable below 10%',
      body: 'Maximum discount is 10%, and only on orders of three or more.',
      at: '5 days ago',
      trained: true,
    },
    {
      id: uid(),
      kind: 'link',
      title: 'Size guide page',
      body: 'berreto.com/size-guide',
      at: 'Last week',
      trained: true,
    },
    {
      id: uid(),
      kind: 'file',
      title: 'Winter catalogue.pdf',
      body: '14 pages, prices included',
      at: 'Last week',
      trained: false,
    },
  ] as Lesson[],

  reports: [
    {
      id: uid(),
      topic: 'What my competitors posted this week',
      at: 'Today, 09:12',
      sources: 24,
      findings: [
        { head: 'Three of four rivals went to reels only', body: 'Photo posts dropped to under a fifth of their output. Reels under 15 seconds got the most saves.' },
        { head: 'Everyone is running a winter discount', body: 'Between 15% and 30%. Two of them put the discount in the first frame of the video.' },
        { head: 'Nobody is answering comments', body: 'Average reply time over 14 hours. Answering inside an hour would stand out.' },
      ],
    },
    {
      id: uid(),
      topic: 'Best posting times for Lahore',
      at: 'Yesterday, 21:40',
      sources: 11,
      findings: [
        { head: '19:00 – 21:30 is your window', body: 'Engagement is 2.3× the day average. Friday evening is the single best slot.' },
        { head: 'Avoid 14:00 – 16:00', body: 'Lowest reach all week, every week.' },
      ],
    },
  ] as Report[],

  invoices: [
    { id: uid(), no: 'VX-2026-11', date: '01 Nov 2026', amount: 26, state: 'paid' },
    { id: uid(), no: 'VX-2026-10', date: '01 Oct 2026', amount: 26, state: 'paid' },
    { id: uid(), no: 'VX-2026-09', date: '01 Sep 2026', amount: 20, state: 'paid' },
  ] as Invoice[],

  cards: [{ id: uid(), brand: 'Visa', last4: '4242', exp: '09 / 29', primary: true }] as Card[],

  notices: [
    { id: uid(), title: 'Winter drop teaser is scheduled', line: 'Going out tonight at 19:30 on Instagram and TikTok.', at: '6 min ago', read: false, agent: 'Content' },
    { id: uid(), title: 'Ayesha Khan asked about delivery', line: 'Sales Agent answered and held a navy shirt in large.', at: '12 min ago', read: false, agent: 'Sales' },
    { id: uid(), title: 'Winter drop — Lahore has spent PKR 912', line: 'PKR 87 of today’s budget left. It stops itself at PKR 999.', at: '1 h ago', read: true, agent: 'Ads' },
    { id: uid(), title: 'Competitor research is ready', line: '24 sources read. Three things worth copying.', at: '3 h ago', read: true, agent: 'Research' },
  ] as Notice[],

  acts: [
    { id: uid(), agent: 'Content', text: 'Wrote and scheduled “Winter drop teaser” for 19:30.', at: '19:31', day: 'Today' },
    { id: uid(), agent: 'Sales', text: 'Answered Ayesha Khan about large sizes and delivery.', at: '18:22', day: 'Today' },
    { id: uid(), agent: 'Ads', text: 'Paused “Winter drop — Lahore” — daily budget reached.', at: '17:40', day: 'Today' },
    { id: uid(), agent: 'Research', text: 'Read 24 competitor posts and wrote this week’s brief.', at: '09:12', day: 'Today' },
    { id: uid(), agent: 'Content', text: 'Replied to 11 comments on “How we pack an order”.', at: '08:05', day: 'Today' },
    { id: uid(), agent: 'Sales', text: 'Quoted Bilal Ahmed PKR 34,000 for four kurtas.', at: '21:10', day: 'Yesterday' },
    { id: uid(), agent: 'Content', text: 'Posted “Eid sale is live” to 3 accounts.', at: '18:00', day: 'Yesterday' },
    { id: uid(), agent: 'Vexa', text: 'Learned a new rule: never promise next-day delivery.', at: '12:30', day: 'Yesterday' },
  ] as Act[],
};

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
