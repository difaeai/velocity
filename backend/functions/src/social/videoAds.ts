/**
 * Video ads on YouTube (through Google Ads) and TikTok: what the ads desk calls
 * once the plan is written, the budget is held to the owner's limit and the reel
 * is rendered. `ads.ts` keeps the money rules; this file only speaks to the two
 * networks.
 *
 * YouTube is a Demand Gen campaign with its channels set to YouTube alone. That
 * is the campaign type the Google Ads API can create with a video ad, and it
 * needs the video on YouTube first. TikTok is campaign, ad group, ad.
 *
 * Both end by themselves on the last day, so `maxDays` holds even if nothing
 * here ever runs again.
 *
 * ⚠️ Neither has been run against a live account. Fields are from Google's v26
 * reference and TikTok's own SDK; the first real campaign is the test. Each
 * network's own sentence reaches the console when it refuses.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';

import { FieldValue } from '../lib/firebase';
import { metricsFrom, type AdMetrics, type AdPlanSpec } from './adsExpert';
import { gads, GoogleAdsError, inCurrency, linked, search, sumMetrics, type GoogleApp } from './googleAds';
import { open, tokenVaultReady, type SealedSecret } from './secrets';
import { sdb } from './workspace';

export type VideoNetwork = 'youtube' | 'tiktok';

const CONFIG_PATH = 'system/socialAds';
/** Beside Meta's `secret/credentials` and Google's `secret/google`. */
export const TIKTOK_SECRET_PATH = 'system/socialAds/secret/tiktok';
const TIKTOK_ADS = 'https://business-api.tiktok.com/open_api/v1.3';
// shortcut: TikTok ads run country-wide and in Pakistan only; read /tool/region/ for location ids when a customer elsewhere buys them.
const PAKISTAN_LOCATION = '1168579';

/** What both networks are handed. `budget` is a day's money in `currency`, the desk's own. */
export interface VideoAdInput {
  plan: AdPlanSpec;
  budget: number;
  currency: string;
  link: string;
  brand: string;
  market: string;
  launch: boolean;
  /** Campaign and budget names must be unique in an account. */
  stamp: string;
  endMs: number;
}

/** What the console shows for a connected TikTok ads account. */
export interface TikTokAdsLink {
  advertiserId: string;
  name: string;
  currency: string;
  connectedBy: string | null;
  connectedAtMs: number;
  /** The "who is this from" identity on every ad, made once. */
  identityId?: string | null;
  lastError: string | null;
}

const cut = (s: string, n: number) => s.trim().slice(0, n).trim();

// ── YouTube ─────────────────────────────────────────────────────────────────

/** A plan's words at Google's limits for a Demand Gen ad, repeats dropped. Pure. */
export function demandGenText(plan: AdPlanSpec, brand: string) {
  const headlines = [...new Set([plan.headline, ...plan.lines].map((l) => cut(l, 40)).filter(Boolean))].slice(0, 5);
  return {
    businessName: cut(brand, 25),
    headlines,
    longHeadlines: [cut(plan.lines[0] || plan.headline, 90)],
    descriptions: [cut(plan.primaryText, 90)],
  };
}

/** The last second of a day, as Google wants it. Pure. */
export const googleEnd = (ms: number): string => `${new Date(ms).toISOString().slice(0, 10)} 23:59:59`;

/** Budget, campaign, YouTube-only ad group, places, assets and ad: one atomic Google Ads mutate. Pure. */
export function demandGenOperations(p: {
  customerId: string;
  name: string;
  amountMicros: number;
  launch: boolean;
  end: string;
  link: string;
  geo: string[];
  youtubeId: string;
  logoBase64: string;
  text: ReturnType<typeof demandGenText>;
}): Record<string, unknown>[] {
  const temp = (kind: string, id: number) => `customers/${p.customerId}/${kind}/-${id}`;
  const budget = temp('campaignBudgets', 1);
  const campaign = temp('campaigns', 2);
  const adGroup = temp('adGroups', 3);
  const video = temp('assets', 4);
  const logo = temp('assets', 5);
  const texts = (lines: string[]) => lines.map((text) => ({ text }));
  return [
    {
      campaignBudgetOperation: {
        create: { resourceName: budget, name: p.name, amountMicros: String(p.amountMicros), deliveryMethod: 'STANDARD', explicitlyShared: false },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaign,
          name: p.name,
          advertisingChannelType: 'DEMAND_GEN',
          status: p.launch ? 'ENABLED' : 'PAUSED',
          campaignBudget: budget,
          // Maximize Clicks: the budget is the ceiling, and it needs no conversion tracking set up first.
          targetSpend: {},
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
          endDateTime: p.end,
        },
      },
    },
    {
      adGroupOperation: {
        create: {
          resourceName: adGroup,
          name: p.name,
          campaign,
          status: 'ENABLED',
          demandGenAdGroupSettings: {
            channelControls: {
              selectedChannels: { youtubeInFeed: true, youtubeInStream: true, youtubeShorts: true, gmail: false, discover: false, display: false },
            },
          },
        },
      },
    },
    ...p.geo.map((geoTargetConstant) => ({ adGroupCriterionOperation: { create: { adGroup, location: { geoTargetConstant } } } })),
    { assetOperation: { create: { resourceName: video, youtubeVideoAsset: { youtubeVideoId: p.youtubeId } } } },
    { assetOperation: { create: { resourceName: logo, name: `${p.name} logo`, imageAsset: { data: p.logoBase64 } } } },
    {
      adGroupAdOperation: {
        create: {
          adGroup,
          status: 'ENABLED',
          ad: {
            name: p.name,
            finalUrls: [p.link],
            demandGenVideoResponsiveAd: {
              businessName: { text: p.text.businessName },
              videos: [{ asset: video }],
              logoImages: [{ asset: logo }],
              headlines: texts(p.text.headlines),
              longHeadlines: texts(p.text.longHeadlines),
              descriptions: texts(p.text.descriptions),
            },
          },
        },
      },
    },
  ];
}

/** The plan's cities, else the market, as Google's place names; the first match for each. */
async function googlePlaces(app: GoogleApp, token: string, plan: AdPlanSpec, market: string): Promise<string[]> {
  const names = plan.audience.cities.length ? plan.audience.cities : [market];
  const res = await gads<{ geoTargetConstantSuggestions?: { searchTerm?: string; geoTargetConstant?: { resourceName?: string } }[] }>(
    app,
    token,
    'geoTargetConstants:suggest',
    { locale: 'en', ...(/pakistan/i.test(market) ? { countryCode: 'PK' } : {}), locationNames: { names } },
  );
  const first = new Map<string, string>();
  for (const s of res.geoTargetConstantSuggestions ?? []) {
    if (s.searchTerm && s.geoTargetConstant?.resourceName && !first.has(s.searchTerm)) first.set(s.searchTerm, s.geoTargetConstant.resourceName);
  }
  if (!first.size) throw new GoogleAdsError(`Google does not know where "${names.join(', ')}" is. Name a city or country in the brief.`);
  return [...new Set(first.values())];
}

/**
 * The campaign at Google, paused or live. Age and gender are left to Google.
 * shortcut: places only; Demand Gen takes age and gender through an Audience resource, add one when a campaign needs them.
 */
export async function createOnYouTube(input: VideoAdInput & { youtubeId: string; logo: Buffer }): Promise<string> {
  const { app, token, link } = await linked();
  const inAccount = inCurrency(input.budget, input.currency, link.currency);
  if (inAccount == null) throw new GoogleAdsError(`Your limit is in ${input.currency} and this Google Ads account bills in ${link.currency}.`);

  const out = await gads<{ mutateOperationResponses?: { campaignResult?: { resourceName?: string } }[] }>(
    app,
    token,
    `customers/${link.customerId}/googleAds:mutate`,
    {
      mutateOperations: demandGenOperations({
        customerId: link.customerId,
        name: `${input.plan.name} ${input.stamp}`,
        // Google takes money in steps of a hundredth of the currency.
        amountMicros: Math.round(inAccount * 100) * 10_000,
        launch: input.launch,
        end: googleEnd(input.endMs),
        link: input.link,
        geo: await googlePlaces(app, token, input.plan, input.market),
        youtubeId: input.youtubeId,
        logoBase64: input.logo.toString('base64'),
        text: demandGenText(input.plan, input.brand),
      }),
    },
  );
  const made = out.mutateOperationResponses?.map((r) => r.campaignResult?.resourceName).find(Boolean);
  if (!made) throw new GoogleAdsError('Google took the campaign but did not say which one it made.');
  return `yt-${made.split('/').pop()}`;
}

// ── TikTok ──────────────────────────────────────────────────────────────────

/** One Marketing API call; TikTok's own sentence on failure. A `form` goes multipart, as its upload endpoints expect. */
export async function tiktokAds<T>(
  token: string | null,
  path: string,
  init?: { json?: unknown; form?: Record<string, string>; query?: Record<string, string> },
): Promise<T> {
  const url = new URL(`${TIKTOK_ADS}${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) url.searchParams.set(k, v);
  const form = init?.form ? new FormData() : null;
  for (const [k, v] of Object.entries(init?.form ?? {})) form?.append(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.json || form ? 'POST' : 'GET',
      headers: { ...(token ? { 'Access-Token': token } : {}), ...(init?.json ? { 'content-type': 'application/json' } : {}) },
      body: init?.json ? JSON.stringify(init.json) : (form ?? undefined),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new Error(`TikTok Ads could not be reached: ${(e as Error).message}`);
  }
  const out = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null;
  if (out?.code !== 0) throw new Error(out?.message || `TikTok Ads returned HTTP ${res.status}.`);
  return out.data as T;
}

/** The connected ad account and its token. */
async function tiktokAccess(): Promise<{ link: TikTokAdsLink; token: string }> {
  const [cfg, sec] = await Promise.all([sdb.doc(CONFIG_PATH).get(), sdb.doc(TIKTOK_SECRET_PATH).get()]);
  const link = cfg.get('tiktok') as TikTokAdsLink | null | undefined;
  const sealed = sec.get('token') as SealedSecret | undefined;
  if (!link?.advertiserId || !sealed || !tokenVaultReady()) {
    throw new HttpsError('failed-precondition', 'No TikTok Ads account is connected. Connect one on Connected accounts.');
  }
  return { link, token: open(sealed) };
}

/** TikTok's age bands that overlap the plan's range; none when the range covers them all. Pure. */
export function tiktokAges(min: number, max: number): string[] | undefined {
  const bands: [string, number, number][] = [
    ['AGE_18_24', 18, 24],
    ['AGE_25_34', 25, 34],
    ['AGE_35_44', 35, 44],
    ['AGE_45_54', 45, 54],
    ['AGE_55_100', 55, 100],
  ];
  const picked = bands.filter(([, lo, hi]) => lo <= max && hi >= min).map(([name]) => name);
  return picked.length === bands.length ? undefined : picked;
}

/** TikTok's clock format, in UTC. Pure. */
export const tiktokTime = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** The ad group: a day's budget, the plan's people, clicks on TikTok itself, ending on the last day. Pure. */
export function tiktokAdGroup(p: { advertiserId: string; campaignId: string; name: string; budget: number; startMs: number; endMs: number; plan: AdPlanSpec }) {
  const { ageMin, ageMax, genders } = p.plan.audience;
  const ages = tiktokAges(ageMin, ageMax);
  return {
    advertiser_id: p.advertiserId,
    campaign_id: p.campaignId,
    adgroup_name: p.name,
    promotion_type: 'WEBSITE',
    placement_type: 'PLACEMENT_TYPE_NORMAL',
    placements: ['PLACEMENT_TIKTOK'],
    location_ids: [PAKISTAN_LOCATION],
    ...(ages ? { age_groups: ages } : {}),
    ...(genders !== 'all' ? { gender: genders === 'men' ? 'GENDER_MALE' : 'GENDER_FEMALE' } : {}),
    budget_mode: 'BUDGET_MODE_DAY',
    budget: p.budget,
    schedule_type: 'SCHEDULE_START_END',
    schedule_start_time: tiktokTime(p.startMs),
    schedule_end_time: tiktokTime(p.endMs),
    optimization_goal: 'CLICK',
    billing_event: 'CPC',
    bid_type: 'BID_TYPE_NO_BID',
    pacing: 'PACING_MODE_SMOOTH',
    operation_status: 'ENABLE',
  };
}

const uploadImage = async (token: string, advertiserId: string, imageUrl: string, stamp: string, tag: string) => {
  const data = await tiktokAds<{ image_id?: string }>(token, '/file/image/ad/upload/', {
    form: { advertiser_id: advertiserId, upload_type: 'UPLOAD_BY_URL', image_url: imageUrl, file_name: `${stamp}-${tag}.jpg` },
  });
  if (!data.image_id) throw new Error('TikTok took the picture but did not say where it put it.');
  return data.image_id;
};

/** The video, picture and identity at TikTok, then campaign, ad group and ad; the campaign removed again if a step fails. */
export async function createOnTikTok(input: VideoAdInput & { videoUrl: string; coverUrl: string; avatarUrl: string }): Promise<string> {
  if (!/pakistan/i.test(input.market)) throw new Error('TikTok ads run in Pakistan only for now.');
  const { link, token } = await tiktokAccess();
  const budget = inCurrency(input.budget, input.currency, link.currency);
  if (budget == null) throw new Error(`Your limit is in ${input.currency} and this TikTok account bills in ${link.currency}.`);
  const advertiser_id = link.advertiserId;
  const name = `${input.plan.name} ${input.stamp}`.slice(0, 100);

  const uploaded = await tiktokAds<{ video_id?: string } | { video_id?: string }[]>(token, '/file/video/ad/upload/', {
    form: { advertiser_id, upload_type: 'UPLOAD_BY_URL', video_url: input.videoUrl, file_name: `${input.stamp}.mp4` },
  });
  const video_id = (Array.isArray(uploaded) ? uploaded[0] : uploaded)?.video_id;
  if (!video_id) throw new Error('TikTok took the video but did not say where it put it.');
  const cover = await uploadImage(token, advertiser_id, input.coverUrl, input.stamp, 'cover');

  let identity_id = link.identityId ?? null;
  if (!identity_id) {
    const image_uri = await uploadImage(token, advertiser_id, input.avatarUrl, input.stamp, 'avatar');
    const made = await tiktokAds<{ identity_id?: string }>(token, '/identity/create/', {
      json: { advertiser_id, display_name: input.brand.slice(0, 100), image_uri },
    });
    identity_id = made.identity_id ?? null;
    if (!identity_id) throw new Error('TikTok did not make the ad identity.');
    await sdb.doc(CONFIG_PATH).set({ tiktok: { ...link, identityId: identity_id } }, { merge: true });
  }

  const { campaign_id } = await tiktokAds<{ campaign_id: string }>(token, '/campaign/create/', {
    json: {
      advertiser_id,
      campaign_name: name,
      objective_type: 'TRAFFIC',
      budget_mode: 'BUDGET_MODE_INFINITE',
      operation_status: input.launch ? 'ENABLE' : 'DISABLE',
    },
  });
  try {
    const { adgroup_id } = await tiktokAds<{ adgroup_id: string }>(token, '/adgroup/create/', {
      json: tiktokAdGroup({ advertiserId: advertiser_id, campaignId: campaign_id, name, budget, startMs: Date.now() + 10 * 60_000, endMs: input.endMs, plan: input.plan }),
    });
    await tiktokAds(token, '/ad/create/', {
      json: {
        advertiser_id,
        adgroup_id,
        creatives: [
          {
            ad_name: name,
            identity_type: 'CUSTOMIZED_USER',
            identity_id,
            ad_format: 'SINGLE_VIDEO',
            video_id,
            image_ids: [cover],
            ad_text: cut(input.plan.primaryText || input.plan.headline, 100),
            call_to_action: 'LEARN_MORE',
            landing_page_url: input.link,
          },
        ],
      },
    });
  } catch (e) {
    await tiktokAds(token, '/campaign/status/update/', {
      json: { advertiser_id, campaign_ids: [campaign_id], operation_status: 'DELETE' },
    }).catch(() => undefined);
    throw e;
  }
  return `tt-${campaign_id}`;
}

// ── running them ────────────────────────────────────────────────────────────

/** Switch one on or off, or end it for good. `docId` is the desk's `yt-…` or `tt-…`. */
export async function setVideoAdStatus(docId: string, what: 'run' | 'pause' | 'end'): Promise<void> {
  const id = docId.slice(3);
  if (docId.startsWith('yt-')) {
    const { app, token, link } = await linked();
    const resourceName = `customers/${link.customerId}/campaigns/${id}`;
    await gads(app, token, `customers/${link.customerId}/campaigns:mutate`, {
      operations: [what === 'end' ? { remove: resourceName } : { update: { resourceName, status: what === 'run' ? 'ENABLED' : 'PAUSED' }, updateMask: 'status' }],
    });
    return;
  }
  const { link, token } = await tiktokAccess();
  await tiktokAds(token, '/campaign/status/update/', {
    json: { advertiser_id: link.advertiserId, campaign_ids: [id], operation_status: what === 'run' ? 'ENABLE' : what === 'pause' ? 'DISABLE' : 'DELETE' },
  });
}

interface Numbers {
  spend: number;
  clicks: number;
  impressions: number;
}

/** A network's numbers as the card the Ads page already draws. Clicks are its results. Pure. */
export const videoMetrics = (n: Numbers | undefined): AdMetrics =>
  metricsFrom({ spend: String(n?.spend ?? 0), impressions: String(n?.impressions ?? 0), inline_link_clicks: String(n?.clicks ?? 0) }, 'link_click');

const inDesk = (n: Numbers, from: string, to: string): Numbers => ({ ...n, spend: inCurrency(n.spend, from, to) ?? n.spend });

/** Google's last 7 days and lifetime, by campaign id, in the desk's currency. */
async function youtubeNumbers(ids: string[], currency: string) {
  const { app, token, link } = await linked();
  const query = (when: string) =>
    `SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE campaign.id IN (${ids.join(',')})${when}`;
  const read = async (when: string) => {
    const byId = new Map<string, Numbers>();
    for (const row of await search(app, token, link.customerId, query(when))) {
      const sum = sumMetrics([row]);
      const had = byId.get(row.campaign?.id ?? '');
      byId.set(row.campaign?.id ?? '', {
        spend: (had?.spend ?? 0) + (inCurrency(sum.spend, link.currency, currency) ?? sum.spend),
        clicks: (had?.clicks ?? 0) + sum.clicks,
        impressions: (had?.impressions ?? 0) + sum.impressions,
      });
    }
    return byId;
  };
  const [week, life] = await Promise.all([read(' AND segments.date DURING LAST_7_DAYS'), read('')]);
  return { week, life };
}

interface TikTokRow {
  dimensions?: { campaign_id?: string };
  metrics?: { spend?: string; clicks?: string; impressions?: string };
}

const lastWeek = () => ({
  start_date: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
  end_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
});

/** TikTok's report for every campaign in the account, in the desk's currency. */
async function tiktokNumbers(currency: string) {
  const { link, token } = await tiktokAccess();
  const read = async (when: Record<string, string>) => {
    const data = await tiktokAds<{ list?: TikTokRow[] }>(token, '/report/integrated/get/', {
      query: {
        advertiser_id: link.advertiserId,
        report_type: 'BASIC',
        data_level: 'AUCTION_CAMPAIGN',
        dimensions: JSON.stringify(['campaign_id']),
        metrics: JSON.stringify(['spend', 'clicks', 'impressions']),
        page_size: '200',
        ...when,
      },
    });
    const byId = new Map<string, Numbers>();
    for (const r of data.list ?? []) {
      byId.set(
        r.dimensions?.campaign_id ?? '',
        inDesk({ spend: Number(r.metrics?.spend ?? 0), clicks: Number(r.metrics?.clicks ?? 0), impressions: Number(r.metrics?.impressions ?? 0) }, link.currency, currency),
      );
    }
    return byId;
  };
  const [week, life] = await Promise.all([read(lastWeek()), read({ query_lifetime: 'true' })]);
  return { week, life };
}

/**
 * Read the numbers of the desk's YouTube and TikTok campaigns onto their rows.
 * shortcut: read only — they launch, pause and end from the console but are not auto-steered like Meta's; feed these into `diagnose` once real campaigns have shown what the numbers look like.
 */
export async function syncVideoCampaigns(currency: string): Promise<void> {
  const snap = await sdb.collection('socialAds').where('managed', '==', true).get();
  const rows = snap.docs.filter((d) => /^(yt|tt)-/.test(d.id) && d.get('status') !== 'ARCHIVED');
  for (const [prefix, read] of [
    ['yt-', (ids: string[]) => youtubeNumbers(ids, currency)],
    ['tt-', () => tiktokNumbers(currency)],
  ] as const) {
    const mine = rows.filter((d) => d.id.startsWith(prefix));
    if (!mine.length) continue;
    try {
      const { week, life } = await read(mine.map((d) => d.id.slice(3)));
      await Promise.all(
        mine.map((d) => {
          const id = d.id.slice(3);
          return d.ref.set({ week: videoMetrics(week.get(id)), lifetime: videoMetrics(life.get(id)), syncedAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }),
      );
    } catch (e) {
      logger.warn('ads: could not read a video network', { prefix, error: (e as Error).message });
    }
  }
}

/** TikTok spend over the last seven days, for blended ROAS. Null when nothing is connected or it cannot be converted. */
export async function tiktokAdsSpend(currency: string): Promise<number | null> {
  const cfg = await sdb.doc(CONFIG_PATH).get();
  if (!(cfg.get('tiktok') as TikTokAdsLink | null | undefined)?.advertiserId) return null;
  try {
    const { week } = await tiktokNumbers(currency);
    return [...week.values()].reduce((sum, n) => sum + n.spend, 0);
  } catch (e) {
    logger.warn('ads: could not read TikTok spend for blended ROAS', { error: (e as Error).message });
    return null;
  }
}
