/**
 * Why a campaign's thousand views cost what they do, and where its money buys least.
 *
 * Meta sells attention by auction. Three things set the price: the people (who
 * else is bidding for them), the place (Reels, Feed and Audience Network are
 * different auctions), and the ad itself (Meta charges more to show an ad it
 * ranks below average). The sync asks Meta for the same week cut three ways —
 * by placement, by age and gender, by region — plus each ad's quality rankings,
 * and this file turns that into reasons a shop owner can act on. It also finds
 * the platform where results cost so much more that the money is better spent
 * elsewhere, which the expert stops on its own in `direct` mode.
 *
 * Pure, so every rule is tested without Meta.
 */
import { metricsFrom, money, type Band, type InsightRow } from './adsExpert';

/** One cut of a campaign's week: a placement, an age and gender, or a region. */
export interface Slice {
  key: string;
  label: string;
  spend: number;
  impressions: number;
  results: number;
  /** Of the campaign's spend across this cut, 0–1. */
  share: number;
  cpm: number;
  /** 0 when the slice bought no results. */
  costPerResult: number;
}

/** Meta's own rating of an ad against ads competing for the same people. */
export type Ranking = 'ABOVE_AVERAGE' | 'AVERAGE' | 'BELOW_AVERAGE_35' | 'BELOW_AVERAGE_20' | 'BELOW_AVERAGE_10';

/** The platform to stop showing on, and what it cost this week. */
export interface Waste {
  /** Meta's `publisher_platforms` value. */
  platform: string;
  label: string;
  weekSpend: number;
  /** Its cost per result over the campaign's; null when it bought nothing at all. */
  timesDearer: number | null;
  /** What the week's spend there cost beyond what those results cost everywhere else. */
  saveWeek: number;
}

export interface CostRead {
  atMs: number;
  cpm: number;
  level: 'high' | 'normal' | 'low' | 'unknown';
  /** Plain reasons, the biggest first. */
  reasons: string[];
  placements: Slice[];
  people: Slice[];
  regions: Slice[];
  /** The worst across the campaign's ads with enough views to be rated; null when Meta has not rated one. */
  quality: Ranking | null;
  engagement: Ranking | null;
  conversion: Ranking | null;
  waste: Waste | null;
}

/** A breakdown row: the Insights fields plus whichever breakdown columns were asked for. */
export type BreakdownRow = InsightRow & {
  campaign_id?: string;
  publisher_platform?: string;
  platform_position?: string;
  age?: string;
  gender?: string;
  region?: string;
};

export type RankingRow = {
  campaign_id?: string;
  impressions?: string;
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
};

const PLATFORM: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  audience_network: 'Audience Network',
  messenger: 'Messenger',
};

const POSITION: Record<string, string> = {
  feed: 'Feed',
  story: 'Stories',
  reels: 'Reels',
  facebook_reels: 'Reels',
  instagram_reels: 'Reels',
  instream_video: 'in-stream video',
  video_feeds: 'video feeds',
  marketplace: 'Marketplace',
  right_hand_column: 'right column',
  search: 'search',
  instagram_explore: 'Explore',
  instagram_explore_grid_home: 'Explore home',
  instagram_profile_feed: 'profile feed',
  instagram_search: 'search',
  an_classic: '',
  rewarded_video: 'rewarded video',
  messenger_inbox: 'inbox',
  messenger_stories: 'Stories',
};

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function placementLabel(platform: string, position?: string): string {
  const p = PLATFORM[platform] ?? titleCase(platform);
  const where = position === undefined ? '' : (POSITION[position] ?? position.replace(/_/g, ' '));
  return where ? `${p} ${where}` : p;
}

export function peopleLabel(gender: string, age: string): string {
  const who = gender === 'female' ? 'Women' : gender === 'male' ? 'Men' : 'People';
  return age && age !== 'Unknown' ? `${who} ${age.replace('-', '–')}` : who;
}

/** Rows cut the same way, summed per key and ordered by spend. */
export function slicesFrom(
  rows: BreakdownRow[],
  keyOf: (r: BreakdownRow) => string,
  labelOf: (r: BreakdownRow) => string,
  resultAction: string,
): Slice[] {
  const sums = new Map<string, { label: string; spend: number; impressions: number; results: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!key) continue;
    const m = metricsFrom(r, resultAction);
    const s = sums.get(key) ?? { label: labelOf(r), spend: 0, impressions: 0, results: 0 };
    s.spend += m.spend;
    s.impressions += m.impressions;
    s.results += m.results;
    sums.set(key, s);
  }
  const total = [...sums.values()].reduce((n, s) => n + s.spend, 0);
  const perResult = (spend: number, results: number) =>
    results > 0 ? (resultAction === 'reach' ? (spend / results) * 1000 : spend / results) : 0;
  return [...sums.entries()]
    .map(([key, s]) => ({
      key,
      label: s.label,
      spend: s.spend,
      impressions: s.impressions,
      results: s.results,
      share: total > 0 ? s.spend / total : 0,
      cpm: s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0,
      costPerResult: perResult(s.spend, s.results),
    }))
    .sort((a, b) => b.spend - a.spend);
}

const RANK_ORDER: Ranking[] = ['BELOW_AVERAGE_10', 'BELOW_AVERAGE_20', 'BELOW_AVERAGE_35', 'AVERAGE', 'ABOVE_AVERAGE'];

/** The worst rating across ads Meta has rated; an ad needs about 500 views before it is. */
export function worstRanking(rows: RankingRow[], field: 'quality_ranking' | 'engagement_rate_ranking' | 'conversion_rate_ranking'): Ranking | null {
  let worst: Ranking | null = null;
  for (const r of rows) {
    if (Number(r.impressions ?? 0) < 500) continue;
    const v = r[field] as Ranking | undefined;
    if (!v || !RANK_ORDER.includes(v)) continue;
    if (worst === null || RANK_ORDER.indexOf(v) < RANK_ORDER.indexOf(worst)) worst = v;
  }
  return worst;
}

const BOTTOM: Partial<Record<Ranking, string>> = {
  BELOW_AVERAGE_35: 'the bottom 35%',
  BELOW_AVERAGE_20: 'the bottom 20%',
  BELOW_AVERAGE_10: 'the bottom 10%',
};

/** Enough of a cut to say something about: a real share of the money and of the views. */
const counts = (s: Slice) => s.share >= 0.05 && s.impressions >= 300;

/** The dearest slice that took a big share, against the cheapest one that counts; null when nothing stands out. */
function dearShare(slices: Slice[]): { dear: Slice; cheap: Slice } | null {
  const usable = slices.filter(counts);
  if (usable.length < 2) return null;
  const cheap = usable.reduce((a, b) => (b.cpm < a.cpm ? b : a));
  const dear = usable.filter((s) => s.share >= 0.25).sort((a, b) => b.cpm - a.cpm)[0];
  return dear && dear.key !== cheap.key && dear.cpm >= cheap.cpm * 1.4 ? { dear, cheap } : null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Where the money buys least: a platform that took a real share of the week
 * and bought its results at twice the campaign's price or more (or none at
 * all), while another platform still delivers. Only a whole platform is ever
 * named — the one cut that can be made without rebuilding the audience.
 */
export function findWaste(platforms: Slice[], overall: { results: number; costPerResult: number }): Waste | null {
  if (overall.results < 20 || overall.costPerResult <= 0) return null;
  const delivering = platforms.filter((p) => p.results > 0);
  const candidates = platforms
    .filter(
      (p) =>
        p.share >= 0.1 &&
        p.spend >= overall.costPerResult * 3 &&
        (p.results === 0 || p.costPerResult >= overall.costPerResult * 2) &&
        delivering.some((d) => d.key !== p.key),
    )
    .sort((a, b) => b.spend - a.spend);
  const p = candidates[0];
  if (!p) return null;
  const saveWeek = Math.max(0, p.spend - p.results * overall.costPerResult);
  return {
    platform: p.key,
    label: p.label,
    weekSpend: p.spend,
    timesDearer: p.results > 0 ? Math.round((p.costPerResult / overall.costPerResult) * 10) / 10 : null,
    saveWeek,
  };
}

/**
 * The week's read of one campaign: whether its CPM is high, normal or low
 * against the yardstick, why — in the order that matters most — and the waste.
 */
export function readCost(input: {
  atMs: number;
  week: { cpm: number; impressions: number; frequency: number; results: number; costPerResult: number };
  band: Band | null;
  currency: string;
  placements: Slice[];
  platforms: Slice[];
  people: Slice[];
  regions: Slice[];
  quality: Ranking | null;
  engagement: Ranking | null;
  conversion: Ranking | null;
}): CostRead {
  const { week, band, currency } = input;
  const $ = (n: number) => money(n, currency);
  const level: CostRead['level'] =
    !band || week.impressions < 1000 ? 'unknown' : week.cpm > band.high ? 'high' : week.cpm < band.low ? 'low' : 'normal';
  const reasons: string[] = [];

  if (input.quality && BOTTOM[input.quality]) {
    reasons.push(
      `Meta rates the ad in ${BOTTOM[input.quality]} for quality against ads chasing the same people, and charges a weak ad more to show it. A new picture and first line is the fix.`,
    );
  } else if (input.quality === 'ABOVE_AVERAGE' && level !== 'high') {
    reasons.push('Meta rates the ad above average for quality, so it pays less than most to be seen.');
  }
  if (input.engagement && BOTTOM[input.engagement]) {
    reasons.push(`Fewer people react to it than to similar ads (${BOTTOM[input.engagement]}): the hook is not landing.`);
  }

  const place = dearShare(input.placements);
  if (place) {
    reasons.push(
      `${pct(place.dear.share)} of the money went to ${place.dear.label} at ${$(place.dear.cpm)} per thousand views; ${place.cheap.label} costs ${$(place.cheap.cpm)}.`,
    );
  }
  const who = dearShare(input.people);
  if (who) {
    reasons.push(
      `${who.dear.label} — ${pct(who.dear.share)} of the money — cost ${$(who.dear.cpm)} per thousand views, against ${$(who.cheap.cpm)} for ${who.cheap.label.toLowerCase()}: the most contested people here.`,
    );
  }
  const where = dearShare(input.regions);
  if (where) {
    reasons.push(
      `${where.dear.label} took ${pct(where.dear.share)} of the money at ${$(where.dear.cpm)} per thousand views; ${where.cheap.label} costs ${$(where.cheap.cpm)}.`,
    );
  }
  if (week.frequency > 3) {
    reasons.push(
      `The same people have seen it ${week.frequency.toFixed(1)} times; as they stop reacting, Meta charges more to keep showing it.`,
    );
  }

  // Cheap is not always good: views nobody acts on are the cheapest kind.
  const an = input.platforms.find((p) => p.key === 'audience_network');
  if (level === 'low' && an && an.share >= 0.3) {
    reasons.push(`${pct(an.share)} of the views came from Audience Network: cheap to show, rarely acted on.`);
  }
  if (!reasons.length && level !== 'unknown') {
    reasons.push(
      level === 'high'
        ? 'Nothing in Meta’s breakdowns stands out: the whole audience is a crowded auction this week. A broader audience or a fresh creative usually brings it down.'
        : level === 'low'
          ? 'Broad enough to find cheap attention, and nothing in the breakdowns is out of line.'
          : 'In the normal range, and nothing in the breakdowns is out of line.',
    );
  }

  return {
    atMs: input.atMs,
    cpm: week.cpm,
    level,
    reasons,
    placements: input.placements.slice(0, 8),
    people: input.people.slice(0, 8),
    regions: input.regions.slice(0, 8),
    quality: input.quality,
    engagement: input.engagement,
    conversion: input.conversion,
    waste: findWaste(input.platforms, week),
  };
}

/**
 * The ad set's targeting without one platform. Messenger needs Facebook, so
 * dropping Facebook drops it too, and at least one of Facebook or Instagram is
 * always left. Null when the cut would leave nothing worth running.
 */
export function withoutPlatform(targeting: Record<string, unknown>, platform: string): Record<string, unknown> | null {
  const all = ['facebook', 'instagram', 'messenger', 'audience_network'];
  const current = Array.isArray(targeting.publisher_platforms) ? (targeting.publisher_platforms as string[]) : all;
  const gone = new Set([platform, ...(platform === 'facebook' ? ['messenger'] : [])]);
  const left = current.filter((p) => !gone.has(p));
  if (!left.includes('facebook') && !left.includes('instagram')) return null;
  if (left.length === current.length) return null;
  const next: Record<string, unknown> = { ...targeting, publisher_platforms: left };
  for (const p of gone) delete next[`${p}_positions`];
  return next;
}
