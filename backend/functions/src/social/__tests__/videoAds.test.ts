/**
 * What money and a connection depend on for YouTube and TikTok: that a YouTube
 * campaign stays on YouTube, starts paused when it should and ends on its day;
 * that TikTok's upload chunks follow its rules; that a sign-in comes back to
 * the right card.
 */
import { describe, expect, it } from 'vitest';

import type { AdPlanSpec } from '../adsExpert';
import { tiktokChunks, tiktokErrorText } from '../platforms';
import { demandGenOperations, demandGenText, googleEnd, tiktokAdGroup, tiktokAges, tiktokTime, videoMetrics } from '../videoAds';
import { consentUrl, providerOf } from '../videoConnect';

const plan = {
  name: 'Lahore riders',
  objective: 'traffic',
  audience: { cities: ['Lahore'], ageMin: 18, ageMax: 34, genders: 'men', interests: [] },
  dailyBudget: 2000,
  days: 7,
  format: 'video',
  primaryText: 'P'.repeat(200),
  headline: 'H'.repeat(60),
  cta: 'LEARN_MORE',
  lines: ['Name your own fare', 'H'.repeat(60)],
  why: '',
} as unknown as AdPlanSpec;

const MB = 1024 * 1024;

function ops(launch: boolean) {
  return demandGenOperations({
    customerId: '1234567890',
    name: 'Ad 1',
    amountMicros: 7_000_000,
    launch,
    end: '2026-11-15 23:59:59',
    link: 'https://velocityrides.app',
    geo: ['geoTargetConstants/2586'],
    youtubeId: 'dQw4w9WgXcQ',
    logoBase64: 'AAAA',
    text: demandGenText(plan, 'Velocity Rides'),
  }) as Record<string, { create: Record<string, never> }>[];
}

describe('a YouTube campaign', () => {
  it('runs on YouTube alone', () => {
    const group = ops(false).find((o) => o.adGroupOperation)!.adGroupOperation.create as Record<string, Record<string, Record<string, unknown>>>;
    expect(group.demandGenAdGroupSettings.channelControls.selectedChannels).toEqual({
      youtubeInFeed: true,
      youtubeInStream: true,
      youtubeShorts: true,
      gmail: false,
      discover: false,
      display: false,
    });
  });

  it('waits paused unless it was told to launch, and always has an end', () => {
    const paused = ops(false).find((o) => o.campaignOperation)!.campaignOperation.create as Record<string, unknown>;
    const live = ops(true).find((o) => o.campaignOperation)!.campaignOperation.create as Record<string, unknown>;
    expect(paused.status).toBe('PAUSED');
    expect(live.status).toBe('ENABLED');
    expect(paused.endDateTime).toBe('2026-11-15 23:59:59');
    expect(paused.advertisingChannelType).toBe('DEMAND_GEN');
    expect(googleEnd(Date.UTC(2026, 10, 15, 8))).toBe('2026-11-15 23:59:59');
  });

  it('never shares its budget', () => {
    const budget = ops(false)[0].campaignBudgetOperation.create as Record<string, unknown>;
    expect(budget.explicitlyShared).toBe(false);
    expect(budget.amountMicros).toBe('7000000');
  });

  it('makes the assets before the ad that points at them', () => {
    const order = ops(false).map((o) => Object.keys(o)[0]);
    expect(order.indexOf('assetOperation')).toBeGreaterThan(order.indexOf('adGroupOperation'));
    expect(order[order.length - 1]).toBe('adGroupAdOperation');
  });

  it("cuts the plan's words to Google's limits and drops repeats", () => {
    const t = demandGenText(plan, 'A brand name far longer than twenty five letters');
    expect(t.businessName.length).toBeLessThanOrEqual(25);
    expect(t.headlines.every((h) => h.length <= 40)).toBe(true);
    expect(t.headlines).toHaveLength(2);
    expect(t.longHeadlines[0].length).toBeLessThanOrEqual(90);
    expect(t.descriptions[0].length).toBeLessThanOrEqual(90);
  });
});

describe('a TikTok campaign', () => {
  it("uses a day's budget, the plan's people, and an end", () => {
    const g = tiktokAdGroup({
      advertiserId: '7',
      campaignId: '9',
      name: 'Ad',
      budget: 25,
      startMs: Date.UTC(2026, 10, 8, 10),
      endMs: Date.UTC(2026, 10, 15, 10),
      plan,
    });
    expect(g.budget_mode).toBe('BUDGET_MODE_DAY');
    expect(g.budget).toBe(25);
    expect(g.schedule_end_time).toBe('2026-11-15 10:00:00');
    expect(g.gender).toBe('GENDER_MALE');
    expect(g.age_groups).toEqual(['AGE_18_24', 'AGE_25_34']);
  });

  it('sends no age limit for everyone', () => {
    expect(tiktokAges(18, 65)).toBeUndefined();
    expect(tiktokTime(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
  });
});

describe("TikTok's upload", () => {
  it('sends one chunk up to 64 MB', () => {
    expect(tiktokChunks(4 * MB)).toEqual({ chunkSize: 4 * MB, count: 1 });
    expect(tiktokChunks(64 * MB)).toEqual({ chunkSize: 64 * MB, count: 1 });
  });

  it('keeps every chunk, and the last one that takes the remainder, inside the rules', () => {
    const size = 100 * MB + 123;
    const { chunkSize, count } = tiktokChunks(size);
    expect(count).toBe(Math.floor(size / chunkSize));
    expect(chunkSize).toBeGreaterThanOrEqual(5 * MB);
    expect(chunkSize).toBeLessThanOrEqual(64 * MB);
    expect(size - (count - 1) * chunkSize).toBeLessThanOrEqual(128 * MB);
  });

  it('says what an unaudited app has to do', () => {
    expect(tiktokErrorText('unaudited_client_can_only_post_to_private_accounts', 'x')).toMatch(/audit/);
    expect(tiktokErrorText('rate_limit_exceeded', 'slow down')).toBe('rate_limit_exceeded: slow down');
  });
});

describe('the sign-in', () => {
  it('comes back to the card that started it', () => {
    expect(providerOf('yt.abc')).toBe('youtube');
    expect(providerOf('tt.abc')).toBe('tiktok');
    expect(providerOf('ta.abc')).toBe('tiktok-ads');
    expect(providerOf('abc')).toBeNull();
  });

  it('asks Google for a refresh token, and only for what posting needs', () => {
    const u = new URL(consentUrl('youtube', 'id', 'yt.s', 'https://velocityrides.app/connect/video'));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('scope')).toContain('youtube.upload');
    expect(u.searchParams.get('state')).toBe('yt.s');
  });

  it('asks TikTok to post, not for more', () => {
    const u = new URL(consentUrl('tiktok', 'key', 'tt.s', 'https://velocityrides.app/connect/video'));
    expect(u.searchParams.get('client_key')).toBe('key');
    expect(u.searchParams.get('scope')).toBe('user.info.basic,video.publish');
  });
});

describe("the numbers on a row", () => {
  it('reads clicks as results and is safe with nothing', () => {
    const m = videoMetrics({ spend: 100, clicks: 20, impressions: 2000 });
    expect(m.results).toBe(20);
    expect(m.cpc).toBe(5);
    expect(videoMetrics(undefined).spend).toBe(0);
  });
});
