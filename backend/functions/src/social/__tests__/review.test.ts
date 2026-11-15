/**
 * The five-day review, where it is arithmetic rather than opinion.
 *
 * This is the part worth testing hardest, for the same reason `insights.test.ts`
 * exists: a wrong number here does not fail loudly. It writes a confident
 * shortcoming into every employee's prompt and the desk follows it for five
 * days — and then the next review measures the damage and writes another one.
 *
 * So: every rung of the "why is there no reach" ladder fires only on its own
 * evidence, the money yardstick is the one Meta's learning phase actually
 * needs, the score ignores dimensions it cannot judge instead of scoring them
 * zero, and nothing identifying can cross from one customer's workspace into
 * another's.
 */
import { describe, expect, it } from 'vitest';

import {
  beforeWindow,
  competitorGap,
  delivery,
  expectedPieces,
  findingsFor,
  industryLines,
  industryOf,
  inWindow,
  isDue,
  localDirectives,
  localSummary,
  measurable,
  mergeLessons,
  reachRead,
  scoreOf,
  scrubLesson,
  spendRead,
  windowDates,
  WINDOW_DAYS,
  type AdsRead,
  type Delivery,
  type IndustryLessons,
  type ReachRead,
  type SpendRead,
} from '../review';
import type { PageRead, ProfileAudit, RankedPost } from '../insights';
import { DEFAULT_SETTINGS, type AccountRead, type SocialPost, type SocialSettings } from '../types';
import type { Brand } from '../../studio/plans';

const DAY = 86_400_000;
/** A fixed "now": 2026-11-15T12:00Z, which is 17:00 in Pakistan. */
const NOW = Date.parse('2026-11-15T12:00:00Z');

const settings = (over: Partial<SocialSettings> = {}): SocialSettings => ({
  ...DEFAULT_SETTINGS,
  enabled: true,
  postsPerDay: 1,
  dailyStory: true,
  ...over,
});

/** A post, with only the fields the review reads filled in. */
const post = (date: string, status: string, format = 'reel'): SocialPost =>
  ({ date, status, format }) as unknown as SocialPost;

const ranked = (over: Partial<RankedPost> = {}): RankedPost => ({
  mediaId: Math.random().toString(36).slice(2),
  permalink: null,
  mediaType: 'REELS',
  postedAtMs: NOW - DAY,
  hook: 'Rs 320 is what this ride cost.',
  reach: 1000,
  saves: 10,
  sends: 5,
  comments: 4,
  likes: 60,
  multiple: 1,
  sendRate: 5,
  saveRate: 10,
  hookScore: 80,
  ...over,
});

const pageRead = (best: RankedPost[], worst: RankedPost[] = []): PageRead => ({
  atMs: NOW,
  date: '2026-11-15',
  sampled: best.length + worst.length,
  medianReach: 1000,
  best,
  worst,
  lessons: [],
  useMore: [],
  useLess: [],
  error: null,
});

const brand = (over: Partial<Brand> = {}): Brand => ({
  name: 'Acme',
  what: 'we sell things',
  audience: 'people',
  market: 'Lahore',
  language: 'Urdu',
  differences: '',
  website: '',
  ...over,
});

const ads = (over: Partial<AdsRead> = {}): AdsRead => ({
  currency: 'PKR',
  dailyCap: 2000,
  committed: 0,
  daily: [],
  ctr: 1.5,
  conversions: 0,
  valuePerConversion: 0,
  bench: null,
  campaigns: [],
  ...over,
});

const emptyDelivery = (over: Partial<Delivery> = {}): Delivery => ({
  expected: 10,
  made: 10,
  published: 10,
  waiting: 0,
  failed: 0,
  quietDays: 0,
  ...over,
});

const emptyReach = (over: Partial<ReachRead> = {}): ReachRead => ({
  sampled: 6,
  medianReach: 1000,
  beforeMedian: 1000,
  trendPct: 0,
  medianHookScore: 80,
  sendRate: 5,
  saveRate: 10,
  reels: 2,
  profileScore: 80,
  ...over,
});

// ── which pile a business belongs in ────────────────────────────────────────

describe('industryOf', () => {
  it('reads the trade out of what the business says it sells', () => {
    expect(industryOf(brand({ what: 'We are an estate agency selling plots in DHA' }))).toBe('real-estate');
    expect(industryOf(brand({ what: 'A family restaurant doing biryani' }))).toBe('food');
    expect(industryOf(brand({ what: 'Ladies salon, hair and skincare' }))).toBe('beauty');
    expect(industryOf(brand({ what: 'We run a courier and delivery service' }))).toBe('transport');
  });

  it('puts property investment with estate agents, not with banks', () => {
    // The pile is what matters: a lesson about selling plots is useless to an
    // insurance broker, so the order of the keyword list is load-bearing.
    expect(industryOf(brand({ what: 'property investment advisory' }))).toBe('real-estate');
  });

  it('is transport for the house desk, which has no Brand', () => {
    expect(industryOf(null)).toBe('transport');
  });

  it('files what it cannot read under other rather than guessing', () => {
    expect(industryOf(brand({ what: 'we do bespoke widget things', audience: 'everyone', differences: '' }))).toBe('other');
  });

  it('reads the audience and the differences too, not just the one line', () => {
    expect(industryOf(brand({ what: 'we help people', audience: 'students at our academy' }))).toBe('education');
  });
});

// ── the window ──────────────────────────────────────────────────────────────

describe('windowDates', () => {
  it('is five Pakistan days, today last', () => {
    expect(windowDates(NOW)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('uses the Pakistan day, not UTC: 20:00 UTC is already tomorrow in Karachi', () => {
    expect(windowDates(Date.parse('2026-11-15T20:00:00Z')).at(-1)).toBe('2026-11-16');
  });
});

describe('expectedPieces', () => {
  it('counts the rotation and the daily story', () => {
    expect(expectedPieces(settings({ postsPerDay: 2, dailyStory: true }))).toBe(15);
    expect(expectedPieces(settings({ postsPerDay: 2, dailyStory: false }))).toBe(10);
  });

  it('expects nothing from a desk that is switched off', () => {
    expect(expectedPieces(settings({ enabled: false }))).toBe(0);
  });
});

describe('delivery', () => {
  const dates = windowDates(NOW);

  it('counts what went out, what is stuck and the days with nothing on the feed', () => {
    const d = delivery(
      [
        post('2026-11-11', 'published'),
        post('2026-11-12', 'partial'),
        post('2026-11-13', 'awaiting_approval'),
        post('2026-11-14', 'failed'),
        post('2026-11-15', 'ready'),
      ],
      dates,
      settings(),
    );
    expect(d.published).toBe(2);
    expect(d.waiting).toBe(2);
    expect(d.failed).toBe(1);
    expect(d.made).toBe(5);
    // Nothing published on the 13th, 14th or 15th.
    expect(d.quietDays).toBe(3);
    expect(d.expected).toBe(10);
  });

  it('counts a day once however many pieces went out on it', () => {
    const d = delivery([post('2026-11-15', 'published'), post('2026-11-15', 'published', 'story')], dates, settings());
    expect(d.quietDays).toBe(4);
  });
});

// ── reach ───────────────────────────────────────────────────────────────────

describe('inWindow and beforeWindow', () => {
  it('splits the posts either side of the window edge', () => {
    const posts = [
      ranked({ postedAtMs: NOW - 2 * DAY }),
      ranked({ postedAtMs: NOW - 6 * DAY }),
      ranked({ postedAtMs: NOW - 12 * DAY }),
    ];
    expect(inWindow(posts, NOW)).toHaveLength(1);
    expect(beforeWindow(posts, NOW)).toHaveLength(1);
  });

  it('leaves out anything older than both windows', () => {
    expect(beforeWindow([ranked({ postedAtMs: NOW - 40 * DAY })], NOW)).toHaveLength(0);
  });
});

describe('reachRead', () => {
  it('reads the trend against the five days before', () => {
    const r = reachRead({
      read: pageRead([
        ranked({ postedAtMs: NOW - DAY, reach: 500 }),
        ranked({ postedAtMs: NOW - 2 * DAY, reach: 500 }),
        ranked({ postedAtMs: NOW - 7 * DAY, reach: 1000 }),
        ranked({ postedAtMs: NOW - 8 * DAY, reach: 1000 }),
      ]),
      audit: null,
      posts: [],
      nowMs: NOW,
    });
    expect(r.sampled).toBe(2);
    expect(r.medianReach).toBe(500);
    expect(r.beforeMedian).toBe(1000);
    expect(r.trendPct).toBe(-50);
  });

  it('has no trend when there is nothing before to compare with', () => {
    const r = reachRead({ read: pageRead([ranked()]), audit: null, posts: [], nowMs: NOW });
    expect(r.trendPct).toBeNull();
  });

  it('counts the same post once when it is in both the best and the worst list', () => {
    // A short account's eight best and five worst overlap, and counting a post
    // twice would move the median it is measured against.
    const one = ranked({ mediaId: 'same', reach: 100 });
    const r = reachRead({ read: pageRead([one, ranked({ mediaId: 'other', reach: 900 })], [one]), audit: null, posts: [], nowMs: NOW });
    expect(r.sampled).toBe(2);
    expect(r.medianReach).toBe(500);
  });

  it('counts a reel from the pieces, not the insights: one posted today has no numbers yet', () => {
    const r = reachRead({
      read: pageRead([]),
      audit: null,
      posts: [post('2026-11-15', 'published', 'reel'), post('2026-11-14', 'awaiting_approval', 'reel'), post('2026-11-13', 'published', 'post')],
      nowMs: NOW,
    });
    expect(r.reels).toBe(1);
  });

  it('leaves the profile unscored when the audit failed', () => {
    const audit = { atMs: NOW, score: 0, profile: null, items: [], rewrites: [], error: 'no model' } as ProfileAudit;
    expect(reachRead({ read: null, audit, posts: [], nowMs: NOW }).profileScore).toBeNull();
  });
});

// ── the money ───────────────────────────────────────────────────────────────

describe('spendRead', () => {
  const dates = windowDates(NOW);

  it('adds up only the days inside the window', () => {
    const s = spendRead(
      ads({
        daily: [
          { date: '2026-11-09', spend: 1000 },
          { date: '2026-11-12', spend: 500 },
          { date: '2026-11-15', spend: 300 },
        ],
        campaigns: [{ objective: 'traffic', grade: 'good', active: true }],
      }),
      dates,
    );
    expect(s.spent).toBe(800);
  });

  it('says plainly that nothing ran when nothing ran', () => {
    const s = spendRead(ads({ dailyCap: 2000 }), dates);
    expect(s.running).toBe(0);
    expect(s.verdict).toContain('Nothing ran');
  });

  it('calls a budget too thin to leave the learning phase', () => {
    // Traffic, Pakistan: about 9 rupees a click typical, fifty results a week
    // → roughly 77 a day. Five days of 20 is nowhere near it.
    const s = spendRead(
      ads({
        daily: dates.map((date) => ({ date, spend: 20 })),
        campaigns: [{ objective: 'traffic', grade: 'learning', active: true }],
      }),
      dates,
    );
    expect(s.spent).toBe(100);
    expect(s.shouldHave).toBeGreaterThan(300);
    expect(s.verdict).toContain('Too thin');
  });

  it('never advises spending more than the owner allows', () => {
    const s = spendRead(
      ads({
        dailyCap: 50,
        daily: dates.map((date) => ({ date, spend: 50 })),
        campaigns: [
          { objective: 'traffic', grade: 'ok', active: true },
          { objective: 'traffic', grade: 'ok', active: true },
        ],
      }),
      dates,
    );
    expect(s.shouldHave).toBe(250);
    expect(s.verdict).toContain('right size');
  });

  it('blames the creative, not the budget, when nobody taps', () => {
    const s = spendRead(
      ads({
        dailyCap: 1000,
        ctr: 0.2,
        daily: dates.map((date) => ({ date, spend: 1000 })),
        campaigns: [{ objective: 'traffic', grade: 'ok', active: true }],
      }),
      dates,
    );
    expect(s.verdict).toContain('the ads themselves are the problem');
  });

  it('ignores a campaign that is not running when it sizes the budget', () => {
    const s = spendRead(
      ads({
        daily: dates.map((date) => ({ date, spend: 500 })),
        campaigns: [
          { objective: 'traffic', grade: 'good', active: true },
          { objective: 'awareness', grade: 'idle', active: false },
        ],
      }),
      dates,
    );
    expect(s.running).toBe(1);
  });
});

// ── somebody else ───────────────────────────────────────────────────────────

const account = (over: Partial<AccountRead> = {}): AccountRead => ({
  username: 'rival',
  followers: 10_000,
  medianEngagement: 500,
  top: [{ caption: 'This flat cost less than you think.\nmore', mediaType: 'REELS', permalink: null, likes: 900, comments: 40, multiple: 2 }],
  ...over,
});

describe('competitorGap', () => {
  it('is null when nobody else has been read', () => {
    expect(competitorGap({ accounts: [], ranked: [], followers: 1000, nowMs: NOW })).toBeNull();
  });

  it('compares per thousand followers, so size is taken out of it', () => {
    const gap = competitorGap({
      accounts: [account({ followers: 100_000, medianEngagement: 1000 })],
      ranked: [ranked({ likes: 95, comments: 5 })],
      followers: 1000,
      nowMs: NOW,
    });
    // Theirs: 10 per thousand. Ours: 100 per thousand. We are ahead despite being a hundredth of the size.
    expect(gap?.theirsPerK).toBe(10);
    expect(gap?.oursPerK).toBe(100);
    expect(gap?.ahead).toBeNull();
  });

  it('names the account that is ahead of us', () => {
    const gap = competitorGap({
      accounts: [account({ username: 'big', followers: 1000, medianEngagement: 200 })],
      ranked: [ranked({ likes: 5, comments: 0 })],
      followers: 1000,
      nowMs: NOW,
    });
    expect(gap?.ahead).toBe('big');
  });

  it('leaves our side unknown rather than zero on a read stored before likes were kept', () => {
    const old = ranked({ comments: 0 });
    delete (old as { likes?: number }).likes;
    const gap = competitorGap({ accounts: [account()], ranked: [old], followers: 1000, nowMs: NOW });
    expect(gap?.oursPerK).toBeNull();
    expect(gap?.ahead).toBeNull();
  });

  it('leaves our side unknown when nobody has counted the followers', () => {
    expect(competitorGap({ accounts: [account()], ranked: [ranked()], followers: null, nowMs: NOW })?.oursPerK).toBeNull();
  });

  it('reports what is working for them as shapes, and keeps their openings for the writer', () => {
    const gap = competitorGap({ accounts: [account()], ranked: [], followers: null, nowMs: NOW });
    expect(gap?.theirShapes[0]).toContain('reels');
    expect(gap?.theirHooks[0]).toBe('This flat cost less than you think.');
  });

  it('skips an account with no followers or no engagement rather than dividing by nothing', () => {
    expect(competitorGap({ accounts: [account({ followers: 0 })], ranked: [], followers: null, nowMs: NOW })).toBeNull();
  });
});

// ── can anybody tell whether it worked ──────────────────────────────────────

describe('measurable', () => {
  it('is false with no goal at all', () => {
    expect(measurable({ settings: settings({ goal: '' }), ads: null, storeOrders: 3, read: null })).toBe(false);
  });

  it('wants something that counts money when the goal is about money', () => {
    const goal = settings({ goal: 'I want more sales every month' });
    expect(measurable({ settings: goal, ads: null, storeOrders: null, read: null })).toBe(false);
    expect(measurable({ settings: goal, ads: null, storeOrders: 0, read: null })).toBe(true);
    // A connected ad account proves nothing: Meta cannot see an order without a
    // pixel, and cannot value a lead until the owner says what one is worth.
    expect(
      measurable({ settings: goal, ads: ads({ campaigns: [{ objective: 'traffic', grade: 'ok', active: true }] }), storeOrders: null, read: null }),
    ).toBe(false);
    expect(measurable({ settings: goal, ads: ads({ valuePerConversion: 500 }), storeOrders: null, read: null })).toBe(true);
    expect(measurable({ settings: goal, ads: ads({ conversions: 3 }), storeOrders: null, read: null })).toBe(true);
  });

  it('settles for the page read when the goal is about being known', () => {
    const goal = settings({ goal: 'I want people in Lahore to know the name' });
    expect(measurable({ settings: goal, ads: null, storeOrders: null, read: pageRead([ranked()]) })).toBe(true);
    expect(measurable({ settings: goal, ads: null, storeOrders: null, read: null })).toBe(false);
  });
});

// ── the dig ─────────────────────────────────────────────────────────────────

const ids = (over: Parameters<typeof findingsFor>[0]) => findingsFor(over).map((f) => f.id);

const dig = (over: Partial<Parameters<typeof findingsFor>[0]> = {}) =>
  ids({
    settings: settings({ goal: 'more customers', competitors: [] }),
    delivery: emptyDelivery(),
    reach: emptyReach(),
    spend: null,
    // 64 likes and comments on a thousand followers, against their 500 on ten
    // thousand: we are ahead per follower, so the default dig finds nothing.
    competitors: competitorGap({ accounts: [account()], ranked: [ranked()], followers: 1000, nowMs: NOW }),
    measurable: true,
    posts: [],
    days: WINDOW_DAYS,
    ...over,
  });

describe('findingsFor', () => {
  it('finds nothing to report when the desk did its job', () => {
    expect(dig()).toEqual([]);
  });

  it('leads with the desk being switched off, and does not then nag about delivery', () => {
    const found = dig({ settings: settings({ enabled: false, goal: 'x' }), delivery: emptyDelivery({ expected: 0, made: 0, published: 0, quietDays: 5 }) });
    expect(found[0]).toBe('desk_off');
    expect(found).not.toContain('nothing_published');
  });

  it('says nothing reached anybody, and blames the queue when the queue is where it stopped', () => {
    const found = findingsFor({
      settings: settings({ goal: 'x' }),
      delivery: emptyDelivery({ published: 0, waiting: 8, quietDays: 5 }),
      reach: emptyReach({ sampled: 0 }),
      spend: null,
      competitors: null,
      measurable: true,
      posts: [],
      days: WINDOW_DAYS,
    });
    const first = found[0];
    expect(first.id).toBe('nothing_published');
    expect(first.severity).toBe('blocking');
    expect(first.fix).toContain('Post on its own');
  });

  it('reports under-delivery only when it is real', () => {
    expect(dig({ delivery: emptyDelivery({ published: 7 }) })).not.toContain('under_delivered');
    expect(dig({ delivery: emptyDelivery({ published: 6, waiting: 4 }) })).toContain('under_delivered');
  });

  it('never fires a reach cause without the numbers to fire on', () => {
    // A brand-new account: too few measured posts, so no lecture about hooks,
    // sends or reels — only that there is not enough to judge yet.
    const found = dig({ reach: emptyReach({ sampled: 1, medianHookScore: 0, sendRate: 0, saveRate: 0, reels: 0, profileScore: null }) });
    expect(found).toEqual(['too_new']);
  });

  it('works through the reach causes one by one', () => {
    expect(dig({ reach: emptyReach({ trendPct: -40 }) })).toContain('reach_falling');
    expect(dig({ reach: emptyReach({ trendPct: -10 }) })).not.toContain('reach_falling');
    expect(dig({ reach: emptyReach({ reels: 0 }) })).toContain('no_reels');
    expect(dig({ reach: emptyReach({ medianHookScore: 40 }) })).toContain('weak_hooks');
    expect(dig({ reach: emptyReach({ sendRate: 0.2 }) })).toContain('not_sent');
    expect(dig({ reach: emptyReach({ profileScore: 30 }) })).toContain('weak_profile');
  });

  it('does not ask for reels the owner took out of the rotation', () => {
    expect(dig({ settings: settings({ goal: 'x', formats: ['carousel', 'story'] }), reach: emptyReach({ reels: 0 }) })).not.toContain('no_reels');
  });

  it('asks for the goal, then for a way to count it', () => {
    expect(dig({ settings: settings({ goal: '' }) })).toContain('no_goal');
    expect(dig({ measurable: false })).toContain('not_measurable');
    // Not both: an empty goal is the same complaint twice.
    expect(dig({ settings: settings({ goal: '' }), measurable: false })).not.toContain('not_measurable');
  });

  it('reads the money as one thing at a time', () => {
    const idle = { ...spendRead(ads({ dailyCap: 2000 }), windowDates(NOW)) };
    expect(dig({ spend: idle })).toContain('ads_idle');

    const thin: SpendRead = { ...idle, running: 1, spent: 100, shouldHave: 400 };
    expect(dig({ spend: thin })).toContain('ads_too_thin');

    const ignored: SpendRead = { ...idle, running: 1, spent: 400, shouldHave: 400, ctr: 0.2, ctrLow: 0.6 };
    expect(dig({ spend: ignored })).toContain('ads_creative');

    const losing: SpendRead = { ...idle, running: 2, spent: 400, shouldHave: 400, wasting: 1 };
    const found = findingsFor({
      settings: settings({ goal: 'x' }),
      delivery: emptyDelivery(),
      reach: emptyReach(),
      spend: losing,
      competitors: null,
      measurable: true,
      posts: [],
      days: WINDOW_DAYS,
    });
    const waste = found.find((f) => f.id === 'ads_wasting');
    expect(waste?.who).toBe('vexa');
    expect(waste?.fix).toContain('Nothing for you to do');
  });

  it('only calls us behind when somebody is meaningfully ahead', () => {
    const close = competitorGap({ accounts: [account({ followers: 1000, medianEngagement: 11 })], ranked: [ranked({ likes: 10, comments: 0 })], followers: 1000, nowMs: NOW });
    expect(dig({ competitors: close })).not.toContain('behind_competitor');

    const far = competitorGap({ accounts: [account({ followers: 1000, medianEngagement: 100 })], ranked: [ranked({ likes: 10, comments: 0 })], followers: 1000, nowMs: NOW });
    expect(dig({ competitors: far })).toContain('behind_competitor');
  });

  it('puts an unanswered lead above everything else it found', () => {
    const found = findingsFor({
      settings: settings({ goal: 'x' }),
      delivery: emptyDelivery(),
      reach: emptyReach(),
      spend: null,
      competitors: null,
      sales: { live: 2, waiting: 3, won: 0, lost: 0, queued: 0 },
      measurable: true,
      posts: [],
      days: WINDOW_DAYS,
    });
    expect(found[0].id).toBe('leads_waiting');
    expect(found[0].severity).toBe('blocking');
    expect(found[0].who).toBe('you');
  });

  it('says so when conversations happen and nothing closes', () => {
    expect(dig({ sales: { live: 4, waiting: 0, won: 0, lost: 0, queued: 0 } })).toContain('nothing_closing');
    expect(dig({ sales: { live: 4, waiting: 0, won: 1, lost: 0, queued: 0 } })).not.toContain('nothing_closing');
  });

  it('notices a sheet that never went out', () => {
    expect(dig({ sales: { live: 0, waiting: 0, won: 0, lost: 0, queued: 40 } })).toContain('sheet_not_moving');
  });

  it('says nothing about a funnel that does not exist', () => {
    const found = dig({ sales: null });
    expect(found).not.toContain('leads_waiting');
    expect(found).not.toContain('nothing_closing');
  });

  it('asks for competitor handles when there are none', () => {
    expect(dig({ competitors: null })).toContain('no_competitors');
  });

  it('puts the blocking findings before the small ones', () => {
    const found = findingsFor({
      settings: settings({ goal: 'x' }),
      delivery: emptyDelivery({ published: 0, waiting: 5, quietDays: 5 }),
      reach: emptyReach({ sampled: 0 }),
      spend: null,
      competitors: null,
      measurable: true,
      posts: [],
      days: WINDOW_DAYS,
    });
    const severities = found.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ['blocking', 'big', 'small'].indexOf(a) - ['blocking', 'big', 'small'].indexOf(b)));
  });

  it('gives every finding its evidence and its fix', () => {
    const found = findingsFor({
      settings: settings({ goal: '' }),
      delivery: emptyDelivery({ published: 2, quietDays: 4 }),
      reach: emptyReach({ sampled: 4, trendPct: -60, reels: 0, medianHookScore: 30, sendRate: 0, saveRate: 0, profileScore: 20 }),
      spend: spendRead(ads({ dailyCap: 500 }), windowDates(NOW)),
      competitors: null,
      measurable: false,
      posts: [],
      days: WINDOW_DAYS,
    });
    expect(found.length).toBeGreaterThan(5);
    for (const f of found) {
      expect(f.evidence.length).toBeGreaterThan(10);
      expect(f.fix.length).toBeGreaterThan(10);
    }
  });
});

// ── the score ───────────────────────────────────────────────────────────────

describe('scoreOf', () => {
  it('is nought when there is nothing at all to judge', () => {
    expect(scoreOf({ delivery: emptyDelivery({ expected: 0 }), reach: emptyReach({ sampled: 0, profileScore: null }), spend: null })).toBe(0);
  });

  it('judges a desk that did everything well highly', () => {
    expect(scoreOf({ delivery: emptyDelivery(), reach: emptyReach({ trendPct: 20 }), spend: null })).toBeGreaterThan(85);
  });

  it('does not punish a new account for having no trend yet', () => {
    // Delivery perfect, nothing else knowable: it should not be dragged to 40.
    const score = scoreOf({ delivery: emptyDelivery(), reach: emptyReach({ sampled: 0, profileScore: null }), spend: null });
    expect(score).toBe(100);
  });

  it('halves the score of a desk that published half of what it promised', () => {
    const score = scoreOf({ delivery: emptyDelivery({ published: 5 }), reach: emptyReach({ sampled: 0, profileScore: null }), spend: null });
    expect(score).toBe(50);
  });

  it('never rewards spending more than the yardstick', () => {
    const over = scoreOf({ delivery: emptyDelivery(), reach: emptyReach({ sampled: 0, profileScore: null }), spend: { ...spendRead(ads(), windowDates(NOW)), spent: 10_000, shouldHave: 400, running: 1 } });
    const right = scoreOf({ delivery: emptyDelivery(), reach: emptyReach({ sampled: 0, profileScore: null }), spend: { ...spendRead(ads(), windowDates(NOW)), spent: 400, shouldHave: 400, running: 1 } });
    expect(over).toBe(right);
  });

  it('marks a falling account down', () => {
    const falling = scoreOf({ delivery: emptyDelivery(), reach: emptyReach({ trendPct: -80, sendRate: 0 }), spend: null });
    expect(falling).toBeLessThan(60);
  });
});

// ── what leaves the workspace ───────────────────────────────────────────────

describe('scrubLesson', () => {
  it('drops a line carrying a figure big enough to identify anybody', () => {
    expect(scrubLesson('Posts about plots under 5000 rupees did well', ['Acme'])).toBeNull();
    expect(scrubLesson('The account went from 1200 to 9400 followers', ['Acme'])).toBeNull();
  });

  it('keeps small numbers, which are craft rather than identity', () => {
    expect(scrubLesson('Five hashtags beat thirty, and 3 seconds decides the hook', ['Acme'])).toContain('3 seconds');
  });

  it('takes the client out of its own lesson', () => {
    expect(scrubLesson('Acme posts do better with a face in frame', ['Acme'])).toBe('the business posts do better with a face in frame');
  });

  it('strips handles and links', () => {
    expect(scrubLesson('Reels tagged @acmelahore and linked to https://acme.pk travelled furthest', ['Acme'])).not.toMatch(/@|http/);
  });

  it('refuses a line with nothing useful left', () => {
    expect(scrubLesson('@acme', ['Acme'])).toBeNull();
    expect(scrubLesson('  ', ['Acme'])).toBeNull();
  });

  it('is not fooled by a brand name with regex characters in it', () => {
    expect(scrubLesson('A+ Motors (Pvt) posts travel on reels', ['A+ Motors (Pvt)'])).toBe('the business posts travel on reels');
  });
});

describe('mergeLessons', () => {
  it('counts a lesson again rather than keeping it twice', () => {
    const first = mergeLessons(null, ['Reels with a face in frame travel furthest'], 'real-estate', NOW);
    const second = mergeLessons(first, ['reels with a face in frame travel furthest!'], 'real-estate', NOW + DAY);
    expect(second.lessons).toHaveLength(1);
    expect(second.lessons[0].seen).toBe(2);
    expect(second.reviews).toBe(2);
  });

  it('puts the most-confirmed lesson first', () => {
    let doc: IndustryLessons | null = null;
    doc = mergeLessons(doc, ['one that keeps coming back'], 'food', NOW);
    doc = mergeLessons(doc, ['one that keeps coming back', 'a lesson seen only once'], 'food', NOW + DAY);
    expect(doc.lessons[0].text).toBe('one that keeps coming back');
  });

  it('keeps at most twelve', () => {
    const doc = mergeLessons(null, Array.from({ length: 30 }, (_, i) => `lesson number ${String.fromCharCode(97 + i)} about this trade`), 'food', NOW);
    expect(doc.lessons).toHaveLength(12);
  });

  it('counts the review even when it had nothing to add', () => {
    expect(mergeLessons(null, [], 'other', NOW).reviews).toBe(1);
  });
});

describe('industryLines', () => {
  it('has nothing to give when nothing has been learned', () => {
    expect(industryLines(null)).toEqual([]);
  });

  it('passes a lesson on early, then waits for a second workspace to confirm it', () => {
    const young = mergeLessons(null, ['a first lesson about this trade'], 'beauty', NOW);
    expect(industryLines(young)).toHaveLength(1);

    const mature: IndustryLessons = { ...young, reviews: 9, lessons: [{ text: 'seen once only', seen: 1, lastAtMs: NOW }] };
    expect(industryLines(mature)).toEqual([]);
  });
});

// ── the clock, and the words ────────────────────────────────────────────────

describe('isDue', () => {
  it('waits five days from the last review', () => {
    expect(isDue(NOW - 4 * DAY, NOW - 40 * DAY, NOW)).toBe(false);
    expect(isDue(NOW - 5 * DAY, NOW - 40 * DAY, NOW)).toBe(true);
  });

  it('counts from the desk starting when there has never been a review', () => {
    expect(isDue(null, NOW - DAY, NOW)).toBe(false);
    expect(isDue(null, NOW - 6 * DAY, NOW)).toBe(true);
  });
});

describe('localDirectives', () => {
  it('turns the findings into instructions the team can follow', () => {
    const findings = findingsFor({
      settings: settings({ goal: 'x' }),
      delivery: emptyDelivery(),
      reach: emptyReach({ reels: 0, medianHookScore: 30, sendRate: 0 }),
      spend: null,
      competitors: null,
      measurable: true,
      posts: [],
      days: WINDOW_DAYS,
    });
    const d = localDirectives(findings, emptyReach({ reels: 0 }), null, NOW);
    expect(d.doMore.join(' ')).toContain('reel');
    expect(d.stopDoing.length).toBeGreaterThan(0);
    expect(d.watchOut.length).toBeGreaterThan(0);
    expect(d.doMore.length).toBeLessThanOrEqual(6);
  });

  it('says nothing when there is nothing to say', () => {
    const d = localDirectives([], emptyReach({ saveRate: 0 }), null, NOW);
    expect(d.doMore).toEqual([]);
    expect(d.stopDoing).toEqual([]);
  });
});

describe('localSummary', () => {
  it('writes the verdict with no model, and names the fixes in order', () => {
    const findings = findingsFor({
      settings: settings({ goal: 'x' }),
      delivery: emptyDelivery({ published: 0, waiting: 4, quietDays: 5 }),
      reach: emptyReach({ sampled: 0 }),
      spend: null,
      competitors: null,
      measurable: true,
      posts: [],
      days: WINDOW_DAYS,
    });
    const text = localSummary({ score: 12, delivery: emptyDelivery({ published: 0 }), reach: emptyReach(), spend: null, findings, goal: 'x' }, WINDOW_DAYS);
    expect(text).toContain('12 out of 100');
    expect(text).toContain('1.');
    expect(text).toContain('No ad account is connected');
  });
});
