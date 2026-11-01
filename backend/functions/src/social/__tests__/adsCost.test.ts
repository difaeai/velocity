/**
 * Why a campaign's views cost what they do, and the platform where its money
 * buys least — read from rows shaped the way Meta's breakdowns arrive.
 */
import { describe, expect, it } from 'vitest';

import {
  findWaste,
  peopleLabel,
  placementLabel,
  readCost,
  slicesFrom,
  withoutPlatform,
  worstRanking,
  type BreakdownRow,
  type Slice,
} from '../adsCost';

const row = (over: Partial<BreakdownRow>, spend: number, impressions: number, clicks: number): BreakdownRow => ({
  spend: String(spend),
  impressions: String(impressions),
  inline_link_clicks: String(clicks),
  ...over,
});

const BAND = { low: 60, typical: 120, high: 250 };

const placements = slicesFrom(
  [
    row({ publisher_platform: 'instagram', platform_position: 'reels' }, 6200, 20_000, 300),
    row({ publisher_platform: 'facebook', platform_position: 'feed' }, 2800, 30_000, 260),
    row({ publisher_platform: 'audience_network', platform_position: 'an_classic' }, 1000, 25_000, 10),
  ],
  (r) => `${r.publisher_platform}/${r.platform_position}`,
  (r) => placementLabel(r.publisher_platform!, r.platform_position),
  'link_click',
);
const platforms = slicesFrom(
  [
    row({ publisher_platform: 'instagram' }, 6200, 20_000, 300),
    row({ publisher_platform: 'facebook' }, 2800, 30_000, 260),
    row({ publisher_platform: 'audience_network' }, 1000, 25_000, 10),
  ],
  (r) => r.publisher_platform!,
  (r) => placementLabel(r.publisher_platform!),
  'link_click',
);

describe('labels', () => {
  it('names placements and people the way an owner reads them', () => {
    expect(placementLabel('instagram', 'reels')).toBe('Instagram Reels');
    expect(placementLabel('facebook', 'feed')).toBe('Facebook Feed');
    expect(placementLabel('audience_network', 'an_classic')).toBe('Audience Network');
    expect(peopleLabel('female', '25-34')).toBe('Women 25–34');
  });
});

describe('slicesFrom', () => {
  it('sums each cut, orders it by spend and prices it', () => {
    expect(placements.map((s) => s.label)).toEqual(['Instagram Reels', 'Facebook Feed', 'Audience Network']);
    expect(placements[0].share).toBeCloseTo(0.62, 2);
    expect(placements[0].cpm).toBe(310);
    expect(placements[1].costPerResult).toBeCloseTo(2800 / 260, 6);
  });
});

describe('worstRanking', () => {
  it('takes the worst rating among ads Meta has rated, ignoring ones with too few views', () => {
    const rows = [
      { impressions: '4000', quality_ranking: 'AVERAGE' },
      { impressions: '3000', quality_ranking: 'BELOW_AVERAGE_20' },
      { impressions: '100', quality_ranking: 'BELOW_AVERAGE_10' },
      { impressions: '9000', quality_ranking: 'UNKNOWN' },
    ];
    expect(worstRanking(rows, 'quality_ranking')).toBe('BELOW_AVERAGE_20');
    expect(worstRanking([], 'quality_ranking')).toBeNull();
  });
});

describe('readCost', () => {
  const base = {
    atMs: 1,
    band: BAND,
    currency: 'PKR',
    placements,
    platforms,
    people: [] as Slice[],
    regions: [] as Slice[],
    quality: null,
    engagement: null,
    conversion: null,
  };

  it('says why a high CPM is high: the ad’s rating first, then where the money went', () => {
    const r = readCost({
      ...base,
      week: { cpm: 300, impressions: 75_000, frequency: 3.6, results: 570, costPerResult: 10000 / 570 },
      quality: 'BELOW_AVERAGE_20',
    });
    expect(r.level).toBe('high');
    expect(r.reasons[0]).toMatch(/bottom 20% for quality/);
    expect(r.reasons[1]).toMatch(/^62% of the money went to Instagram Reels at Rs 310 per thousand views; Audience Network costs Rs 40/);
    expect(r.reasons.at(-1)).toMatch(/seen it 3\.6 times/);
  });

  it('calls a cheap CPM cheap, and warns when the views come from Audience Network', () => {
    const an = slicesFrom(
      [row({ publisher_platform: 'audience_network' }, 700, 30_000, 5), row({ publisher_platform: 'facebook' }, 900, 15_000, 120)],
      (r) => r.publisher_platform!,
      (r) => placementLabel(r.publisher_platform!),
      'link_click',
    );
    const r = readCost({ ...base, placements: an, platforms: an, week: { cpm: 35, impressions: 45_000, frequency: 1.4, results: 125, costPerResult: 12.8 } });
    expect(r.level).toBe('low');
    expect(r.reasons.join(' ')).toMatch(/Audience Network: cheap to show, rarely acted on/);
  });

  it('knows too little to judge a campaign under a thousand views', () => {
    const r = readCost({ ...base, week: { cpm: 400, impressions: 600, frequency: 1, results: 3, costPerResult: 80 } });
    expect(r.level).toBe('unknown');
  });
});

describe('findWaste', () => {
  it('names the platform buying results at twice the price or more, and what it cost', () => {
    // 570 clicks for Rs 10,000 overall (~Rs 17.5 each); Audience Network: Rs 1,000 for 10 clicks (Rs 100 each).
    const w = findWaste(platforms, { results: 570, costPerResult: 10000 / 570 });
    expect(w).toMatchObject({ platform: 'audience_network', label: 'Audience Network', weekSpend: 1000 });
    expect(w!.timesDearer).toBeCloseTo(5.7, 1);
    expect(w!.saveWeek).toBeCloseTo(1000 - 10 * (10000 / 570), 6);
  });

  it('stays quiet with too few results to be sure, or when nothing is out of line', () => {
    expect(findWaste(platforms, { results: 12, costPerResult: 800 })).toBeNull();
    const even = slicesFrom(
      [row({ publisher_platform: 'facebook' }, 1000, 10_000, 100), row({ publisher_platform: 'instagram' }, 1100, 10_000, 100)],
      (r) => r.publisher_platform!,
      (r) => placementLabel(r.publisher_platform!),
      'link_click',
    );
    expect(findWaste(even, { results: 200, costPerResult: 10.5 })).toBeNull();
  });

  it('never cuts the only platform that delivers', () => {
    const one = slicesFrom(
      [row({ publisher_platform: 'instagram' }, 5000, 40_000, 60), row({ publisher_platform: 'facebook' }, 400, 3000, 0)],
      (r) => r.publisher_platform!,
      (r) => placementLabel(r.publisher_platform!),
      'link_click',
    );
    // Instagram is dear but it is the only one with results; Facebook bought nothing but took under 10%.
    expect(findWaste(one, { results: 60, costPerResult: 20 })).toBeNull();
  });
});

describe('withoutPlatform', () => {
  it('drops one platform from automatic placements and keeps the rest of the targeting', () => {
    const t = withoutPlatform({ geo_locations: { countries: ['PK'] }, age_min: 18 }, 'audience_network');
    expect(t).toEqual({
      geo_locations: { countries: ['PK'] },
      age_min: 18,
      publisher_platforms: ['facebook', 'instagram', 'messenger'],
    });
  });

  it('takes Messenger with Facebook, and its positions with it', () => {
    const t = withoutPlatform({ publisher_platforms: ['facebook', 'instagram', 'messenger'], facebook_positions: ['feed'] }, 'facebook');
    expect(t).toEqual({ publisher_platforms: ['instagram'] });
  });

  it('refuses a cut that leaves neither Facebook nor Instagram, or changes nothing', () => {
    expect(withoutPlatform({ publisher_platforms: ['instagram', 'audience_network'] }, 'instagram')).toBeNull();
    expect(withoutPlatform({ publisher_platforms: ['facebook'] }, 'audience_network')).toBeNull();
  });
});
