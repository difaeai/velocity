/**
 * The ads desk — Meta campaigns planned, made, launched, measured and steered
 * from the console, by the social media manager.
 *
 * Until this the ads expert wrote a brief and a human took it into Ads
 * Manager. Now a person says what they want ("drivers in Lahore, this week")
 * and the desk does the rest: the plan, the picture or the reel, the campaign
 * at Meta, and every few hours afterwards a reading of how it is doing against
 * what a click should cost in Pakistan — pausing what wastes money and putting
 * more behind what works, if the owner chose to let it.
 *
 * Money is the reason this file is careful:
 *
 * - **Nothing spends without a limit.** `dailyCap` is set by the owner and is
 *   the most the desk's campaigns may spend in a day, together. No limit, no
 *   campaign. Every campaign also ends: `maxDays` at most, so the worst case
 *   is the limit times the days, never an open tap.
 * - **The owner chooses once how much rope it has.** `mode` is asked the first
 *   time the Ads page opens: `ask` makes every new campaign wait paused for an
 *   Approve and every recommendation wait for an Apply; `direct` launches and
 *   applies them — still inside the limit.
 * - **Numbers that spend money are decided in code** (`adsExpert.ts`), never
 *   by the model. The model writes copy and argues strategy.
 * - **Campaigns made elsewhere are read and judged, never auto-steered.** The
 *   desk only acts on its own (`managed`) without a person pressing a button.
 *
 * The Marketing API takes a USER token, not a Page token. It is captured by the
 * same Facebook sign-in as Instagram, started from the Ads page with the ads
 * scopes added (see `meta.ts`), and lasts about sixty days.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { dateRange, statsFor } from '../analytics';
import { FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { deskCall, forEachWorkspace, isHouse, sdb, wsPath } from './workspace';
import {
  AD_OBJECTIVES,
  META_OBJECTIVE,
  blended,
  clampBudget,
  diagnose,
  forecast,
  fromMinor,
  learningBudget,
  localPlan,
  marketBenchmarks,
  metricsFrom,
  minDailyFor,
  money,
  normalisePlan,
  ownBenchmarks,
  resultActionFor,
  resultBand,
  toMinor,
  type AdMetrics,
  type AdObjective,
  type AdPlanSpec,
  type Benchmarks,
  type Blended,
  type InsightRow,
  type Verdict,
} from './adsExpert';
import { downloadAsset, refreshAssetUrls, storeFile } from './assets';
import { brandBlock, brandName, briefBlock, hardRules, marketName, standingInstructions, wordmark } from './crew';
import { activeTeam, employeeIntro } from './employees';
import { activeEngine, generateJson, modelReady } from './engine';
import { AD_NUMBERS } from './playbook';
import { planReel, renderReel } from './reel';
import { getSocialSettings } from './settings';
import { open, tokenVaultReady, type SealedSecret } from './secrets';
import { planStill, renderStill } from './still';
import { postMedia, type Employee, type SocialPost } from './types';

const REGION = 'asia-south1';
const GRAPH = 'https://graph.facebook.com/v24.0';
const CONFIG_PATH = 'system/socialAds';
const SECRET_PATH = 'system/socialAds/secret/credentials';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app';

const campaignRef = (id: string) => sdb.doc(`socialAds/${id}`);

export interface AdsConfig {
  adAccountId: string | null;
  accountName: string | null;
  currency: string;
  pageId: string | null;
  instagramId: string | null;
  tokenExpiresAtMs: number | null;
  /** Asked once, on the Ads page. Null until somebody answers. */
  mode: 'ask' | 'direct' | null;
  /** The most the desk's own campaigns may spend in a day, together. */
  dailyCap: number;
  /** No campaign the desk makes runs longer than this. */
  maxDays: number;
  /** Where the ads send people. */
  link: string;
  lastSyncAtMs: number | null;
  lastSyncStatus: string | null;
  review: { atMs: number; summary: string; moves: string[]; engine: string } | null;
}

const DEFAULTS: AdsConfig = {
  adAccountId: null,
  accountName: null,
  currency: 'PKR',
  pageId: null,
  instagramId: null,
  tokenExpiresAtMs: null,
  mode: null,
  dailyCap: 0,
  maxDays: 14,
  link: PLAY_URL,
  lastSyncAtMs: null,
  lastSyncStatus: null,
  review: null,
};

async function adsConfig(): Promise<AdsConfig> {
  const snap = await sdb.doc(CONFIG_PATH).get();
  return { ...DEFAULTS, ...((snap.data() as Partial<AdsConfig> | undefined) ?? {}) };
}

async function adsToken(): Promise<string> {
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const snap = await sdb.doc(SECRET_PATH).get();
  const sealed = snap.data()?.token as SealedSecret | undefined;
  if (!sealed) {
    throw new HttpsError('failed-precondition', 'No ad account is connected yet. Connect one on the Ads page.');
  }
  return open(sealed);
}

/** Connected and ready to spend: an account, a token, a limit. */
async function ready(): Promise<{ cfg: AdsConfig; token: string }> {
  const cfg = await adsConfig();
  if (!cfg.adAccountId) {
    throw new HttpsError('failed-precondition', 'No ad account is connected yet. Connect one on the Ads page.');
  }
  return { cfg, token: await adsToken() };
}

// ── talking to Meta ─────────────────────────────────────────────────────────

class AdsError extends Error {
  constructor(
    message: string,
    readonly expired = false,
  ) {
    super(message);
  }
}

/**
 * One Marketing API call. Meta's own sentence is what reaches the console —
 * `error_user_msg` when it wrote one for humans — because "Your ad account has
 * no payment method" is fixable and "request failed" is not.
 */
async function graph<T>(
  token: string,
  path: string,
  init?: { form?: Record<string, string | number>; method?: 'POST' | 'DELETE' },
): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  let options: RequestInit = {};
  if (init?.form) {
    const body = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(init.form)) body.set(k, String(v));
    options = { method: init.method ?? 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } };
  } else {
    url.searchParams.set('access_token', token);
    if (init?.method) options.method = init.method;
  }

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new AdsError(`Facebook could not be reached: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; error_user_msg?: string; code?: number };
  } & T;
  if (body?.error) {
    const e = body.error;
    throw new AdsError(e.error_user_msg || e.message || `Facebook returned HTTP ${res.status}.`, e.code === 190);
  }
  if (!res.ok) throw new AdsError(`Facebook returned HTTP ${res.status}.`);
  return body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** City names to Meta's location keys. A name Meta does not know is dropped. */
async function cityKeys(token: string, cities: string[]): Promise<{ key: string; name: string }[]> {
  const out: { key: string; name: string }[] = [];
  for (const city of cities) {
    const res = await graph<{ data?: { key: string; name: string; type: string }[] }>(
      token,
      `search?type=adgeolocation&location_types=${encodeURIComponent('["city"]')}&country_code=PK&limit=1&q=${encodeURIComponent(city)}`,
    ).catch(() => ({ data: [] }));
    const hit = res.data?.[0];
    if (hit?.key) out.push({ key: hit.key, name: hit.name });
  }
  return out;
}

/** Interest names to Meta's interest ids. Same rule: unknown means dropped. */
async function interestIds(token: string, names: string[]): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  for (const name of names) {
    const res = await graph<{ data?: { id: string; name: string }[] }>(
      token,
      `search?type=adinterest&limit=1&q=${encodeURIComponent(name)}`,
    ).catch(() => ({ data: [] }));
    const hit = res.data?.[0];
    if (hit?.id) out.push({ id: hit.id, name: hit.name });
  }
  return out;
}

async function uploadImage(token: string, cfg: AdsConfig, bytes: Buffer): Promise<string> {
  const res = await graph<{ images?: Record<string, { hash: string }> }>(token, `${cfg.adAccountId}/adimages`, {
    form: { bytes: bytes.toString('base64') },
  });
  const hash = Object.values(res.images ?? {})[0]?.hash;
  if (!hash) throw new AdsError('Facebook took the picture but did not say where it put it.');
  return hash;
}

/** Hand Meta a video by URL and wait until it can be used in an ad. */
async function uploadVideo(token: string, cfg: AdsConfig, fileUrl: string): Promise<string> {
  const { id } = await graph<{ id: string }>(token, `${cfg.adAccountId}/advideos`, { form: { file_url: fileUrl } });
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const v = await graph<{ status?: { video_status?: string } }>(token, `${id}?fields=status`);
    if (v.status?.video_status === 'ready') return id;
    if (v.status?.video_status === 'error') throw new AdsError('Facebook could not process the video.');
    if (Date.now() > deadline) throw new AdsError('Facebook is still processing the video after five minutes.');
    await sleep(5000);
  }
}

// ── the creative ────────────────────────────────────────────────────────────

const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('make') }),
  z.object({ kind: z.literal('post'), postId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('boost'), mediaId: z.string().regex(/^\d{5,40}$/) }),
]);
type CreativeSource = z.infer<typeof sourceSchema>;

interface BuiltCreative {
  /** What goes in `creative` on the ad. */
  spec: Record<string, unknown>;
  video: boolean;
  /** A picture of it for the console, in our own bucket. */
  previewUrl: string | null;
}

/**
 * Make the ad's creative and register it with Meta.
 *
 * Three ways in: the desk draws a new one from the plan (a typographic card or
 * a kinetic reel — the same renderers the organic desk uses), a piece the desk
 * already made is reused, or a post already live on Instagram is boosted as it
 * is. Boosting a proven organic winner is usually the cheapest result there is.
 */
async function buildCreative(
  token: string,
  cfg: AdsConfig,
  plan: AdPlanSpec,
  source: CreativeSource,
  stamp: string,
): Promise<BuiltCreative> {
  const cta = { type: plan.cta, value: { link: cfg.link } };
  const identity = { page_id: cfg.pageId, ...(cfg.instagramId ? { instagram_user_id: cfg.instagramId } : {}) };

  if (source.kind === 'boost') {
    const res = await graph<{ id: string }>(token, `${cfg.adAccountId}/adcreatives`, {
      form: {
        name: plan.name,
        object_id: cfg.pageId ?? '',
        ...(cfg.instagramId ? { instagram_user_id: cfg.instagramId } : {}),
        source_instagram_media_id: source.mediaId,
        ...(plan.objective === 'traffic' ? { call_to_action: JSON.stringify(cta) } : {}),
      },
    });
    return { spec: { creative_id: res.id }, video: false, previewUrl: null };
  }

  // The picture: drawn here, or taken from a piece the desk already made.
  let still: Buffer;
  let videoUrl: string | null = null;

  if (source.kind === 'post') {
    const post = (await sdb.doc(`socialPosts/${source.postId}`).get()).data() as SocialPost | undefined;
    if (!post) throw new HttpsError('not-found', 'No such piece.');
    const media = await refreshAssetUrls(postMedia(post));
    const video = media.find((m) => m.kind === 'video' && m.url);
    const image = media.find((m) => m.kind === 'image');
    if (!video && !image) throw new HttpsError('failed-precondition', 'That piece has no picture or video yet.');
    videoUrl = video?.url ?? null;
    still = image
      ? await downloadAsset(image)
      : await renderStill(planStill({ headline: post.script?.hook || plan.lines[0], aspect: '9:16' }), { wordmark: wordmark() });
  } else if (plan.format === 'video') {
    const reel = planReel({
      format: 'reel',
      script: {
        hook: plan.lines[0],
        hookVariants: [],
        frames: plan.lines.slice(1).map((overlay) => ({ scene: '', overlay })),
        voiceover: '',
        cta: plan.headline,
        rationale: '',
        viralHook: '',
      },
    });
    const stored = await storeFile({
      path: wsPath(`socialAds/${stamp}/video.mp4`),
      bytes: await renderReel(reel, { wordmark: wordmark() }),
      contentType: 'video/mp4',
    });
    videoUrl = stored.url;
    still = await renderStill(planStill({ headline: plan.lines[0], body: plan.headline, aspect: '9:16' }), { wordmark: wordmark() });
  } else {
    const body = plan.lines.slice(1).join(' ') || (plan.headline !== plan.lines[0] ? plan.headline : null);
    still = await renderStill(planStill({ headline: plan.lines[0], body, aspect: '4:5' }), { wordmark: wordmark() });
  }

  const preview = await storeFile({ path: wsPath(`socialAds/${stamp}/preview.jpg`), bytes: still, contentType: 'image/jpeg' });
  const imageHash = await uploadImage(token, cfg, still);

  const story = videoUrl
    ? {
        ...identity,
        video_data: {
          video_id: await uploadVideo(token, cfg, videoUrl),
          image_hash: imageHash,
          message: plan.primaryText,
          title: plan.headline,
          call_to_action: cta,
        },
      }
    : {
        ...identity,
        link_data: {
          link: cfg.link,
          message: plan.primaryText,
          name: plan.headline,
          image_hash: imageHash,
          call_to_action: cta,
        },
      };

  const res = await graph<{ id: string }>(token, `${cfg.adAccountId}/adcreatives`, {
    form: { name: plan.name, object_story_spec: JSON.stringify(story) },
  });
  return { spec: { creative_id: res.id }, video: Boolean(videoUrl), previewUrl: preview.url };
}

// ── making a campaign ───────────────────────────────────────────────────────

/** What the desk's own running campaigns already spend a day. */
async function committedDaily(exceptId?: string): Promise<number> {
  const snap = await sdb.collection('socialAds').where('managed', '==', true).get();
  const now = Date.now();
  return snap.docs
    .filter((d) => d.id !== exceptId)
    .map((d) => d.data() as { status?: string; dailyBudget?: number; endMs?: number | null })
    // One that has run its days spends nothing, whatever its switch says.
    .filter((c) => c.status === 'ACTIVE' && !(c.endMs && c.endMs < now))
    .reduce((sum, c) => sum + (c.dailyBudget ?? 0), 0);
}

/** The yardstick: our own medians once there are some, Pakistan's until then. */
async function benchmarksNow(cfg: AdsConfig): Promise<Benchmarks | null> {
  const snap = await sdb.collection('socialAds').limit(100).get();
  const history = snap.docs.map((d) => (d.data() as { lifetime?: AdMetrics }).lifetime).filter(Boolean) as AdMetrics[];
  // The built-in yardstick is Pakistan's; elsewhere there is none until the account has its own.
  return ownBenchmarks(history, /pakistan/i.test(marketName()) ? marketBenchmarks(cfg.currency) : null);
}

/** Whoever manages social runs the ads, and signs the plan. */
async function adsPerson(): Promise<Employee | null> {
  const team = await activeTeam();
  return team.find((e) => e.role === 'social-manager') ?? team.find((e) => e.role === 'youtube-ads-expert') ?? null;
}

/** What a media buyer knows that the rest of the desk does not. */
const ADS_CRAFT = `HOW PAID SOCIAL WORKS ON META IN 2026 — your craft:
- The creative IS the targeting now. Broad audiences with a strong creative beat narrow interest stacks; add interests only when the brief names a clear niche.
- The first three words of the primary text and the first second of a video decide everything. 125 characters show before "more". Headline 40 characters or fewer.
- One clear action. The picture must make sense with the sound off, on a phone, in a second.
- Looks native, not polished: real streets, real people, plain words, in the language the audience actually speaks.
- Meta policy: never assert a personal attribute ("Are you unemployed?", "Struggling with money?"), no income claims, no fake buttons, no before/after, nothing sensational.
- Structure: one campaign, one ad set, one ad, budget at campaign level. A test runs 7–14 days and is not edited in its first 48 hours.`;

/** Market notes for Pakistan: the house always, a customer only when that is where they sell. */
const PAKISTAN_ADS = `- Pakistan: CPMs are among the cheapest in the world; Instagram skews young and urban, Facebook broader and older; evenings to midnight are the busy hours; Karachi, Lahore and Islamabad are the most contested auctions. Urdu/English as people actually speak works.`;

function adsSystem(person: Employee | null, settings: Awaited<ReturnType<typeof getSocialSettings>>): string {
  const job = `run ${brandName()}'s paid social on Meta: you plan the campaigns, write the ads, decide the audience, and read the numbers afterwards — CPM, CTR, CPC, frequency, cost per result, cost per order and ROAS.`;
  return [
    person ? `${employeeIntro(person)}\n\nYou also ${job}` : `You ${job}`,
    brandBlock(),
    briefBlock(settings, 'social-manager'),
    hardRules(),
    /pakistan/i.test(marketName()) ? `${ADS_CRAFT}\n${PAKISTAN_ADS}` : ADS_CRAFT,
    AD_NUMBERS,
    standingInstructions(settings),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The expert's plan for a brief: the model's when there is one, ours when not. */
async function planAd(params: {
  brief: string;
  cfg: AdsConfig;
  bench: Benchmarks | null;
  requestedBudget?: number;
  requestedDays?: number;
  source: CreativeSource;
}): Promise<{ plan: AdPlanSpec; engine: string }> {
  const { cfg, bench } = params;
  const fallback = localPlan({
    brief: params.brief,
    bench,
    maxDays: cfg.maxDays,
    requestedBudget: params.requestedBudget,
    requestedDays: params.requestedDays,
  });
  if (!modelReady()) return { plan: fallback, engine: 'local' };

  const settings = await getSocialSettings();
  const past = (await sdb.collection('socialAds').limit(30).get()).docs
    .map((d) => d.data() as { name?: string; objectiveKind?: string; lifetime?: AdMetrics; verdict?: Verdict })
    .filter((c) => c.lifetime && c.lifetime.spend > 0)
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.name} (${c.objectiveKind}): spent ${money(c.lifetime!.spend, cfg.currency)}, ${c.lifetime!.results} results, ` +
        `CTR ${c.lifetime!.ctr.toFixed(2)}%, CPC ${money(c.lifetime!.cpc, cfg.currency)} — ${c.verdict?.headline ?? ''}`,
    );

  const committed = await committedDaily();
  const yard = bench
    ? `What things cost here (${bench.source === 'own' ? 'this account’s own medians' : 'typical for Pakistan'}), in ${cfg.currency}: ` +
      `CPM ${bench.cpm.low}–${bench.cpm.high}, CPC ${bench.cpc.low}–${bench.cpc.high}, link CTR ${bench.ctr.low}–${bench.ctr.high}%, ` +
      `cost per engagement ${bench.cpe.low}–${bench.cpe.high}. Learning needs about ` +
      AD_OBJECTIVES.map((o) => `${money(learningBudget(o, bench), cfg.currency)}/day for ${o}`).join(', ') +
      '.'
    : 'No cost yardstick for this currency.';

  const prompt = [
    `THE BRIEF, in the team lead's words:\n${params.brief}`,
    params.requestedBudget ? `They asked for ${money(params.requestedBudget, cfg.currency)} a day.` : '',
    params.requestedDays ? `They asked for ${params.requestedDays} days.` : '',
    params.source.kind === 'boost'
      ? 'The creative is an Instagram post that is already live — write the plan around boosting it; lines are unused.'
      : params.source.kind === 'post'
        ? 'The creative is a piece the desk already made — write the copy to go with it.'
        : 'The desk will draw the creative from your lines: lines[0] is the big hook on the picture, 2–8 words; up to three more short lines follow (or become the beats of a 20-second text reel if format is "video").',
    `MONEY: account currency ${cfg.currency}. The owner's daily limit for all campaigns together is ${money(cfg.dailyCap, cfg.currency)}; ` +
      `${money(committed, cfg.currency)} of it is already running. Minimum ${money(minDailyFor(cfg.currency), cfg.currency)} a day. ` +
      `At most ${cfg.maxDays} days. Ads send people to ${cfg.link}.`,
    yard,
    past.length ? `HOW OUR OWN CAMPAIGNS DID — evidence, weigh it above the yardstick:\n${past.join('\n')}` : '',
    `Decide the campaign and answer with ONE JSON object:
{
  "name": "short campaign name",
  "objective": "traffic" | "awareness" | "engagement",
  "audience": { "cities": ["Lahore", ...] (empty for the whole market), "ageMin": 18, "ageMax": 45, "genders": "all" | "men" | "women", "interests": ["only if clearly needed", ...] },
  "dailyBudget": number in ${cfg.currency} — enough to leave learning, inside the limit,
  "days": number,
  "format": "image" | "video",
  "primaryText": "the ad text, the first line carries it",
  "headline": "40 characters or fewer",
  "cta": "LEARN_MORE" | "DOWNLOAD" | "SIGN_UP" | "APPLY_NOW" | "BOOK_TRAVEL" | "GET_OFFER",
  "lines": ["hook", "line", "line"],
  "why": "3–5 sentences: why this objective, this audience, this budget, and the CPC/CTR it should hit"
}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: adsSystem(await adsPerson(), settings),
      prompt,
      what: 'The ad plan',
    });
    return { plan: normalisePlan(data, fallback, cfg.maxDays), engine: activeEngine() };
  } catch (e) {
    logger.warn('ads: the model plan failed, using the local one', { message: (e as Error).message });
    return { plan: fallback, engine: 'local' };
  }
}

/** Campaign → ad set → creative → ad, and the campaign removed again if any step fails. */
async function createAtMeta(params: {
  token: string;
  cfg: AdsConfig;
  plan: AdPlanSpec;
  budget: number;
  source: CreativeSource;
  launch: boolean;
  stamp: string;
}): Promise<{ campaignId: string; adsetId: string; adId: string; video: boolean; previewUrl: string | null; cities: string[]; interests: string[] }> {
  const { token, cfg, plan } = params;
  const meta = META_OBJECTIVE[plan.objective];

  const campaign = await graph<{ id: string }>(token, `${cfg.adAccountId}/campaigns`, {
    form: {
      name: plan.name,
      objective: meta.objective,
      status: 'PAUSED',
      special_ad_categories: '[]',
      daily_budget: toMinor(params.budget, cfg.currency),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    },
  });

  try {
    const [cities, interests] = await Promise.all([
      cityKeys(token, plan.audience.cities),
      interestIds(token, plan.audience.interests),
    ]);
    const creative = await buildCreative(token, cfg, plan, params.source, params.stamp);

    const targeting = {
      geo_locations: cities.length
        ? { cities: cities.map((c) => ({ key: c.key, radius: 20, distance_unit: 'kilometer' })) }
        : { countries: ['PK'] },
      age_min: plan.audience.ageMin,
      age_max: plan.audience.ageMax,
      ...(plan.audience.genders !== 'all' ? { genders: [plan.audience.genders === 'men' ? 1 : 2] } : {}),
      ...(interests.length ? { flexible_spec: [{ interests }] } : {}),
      // Our ages and cities are meant: do not let Meta widen them on its own.
      targeting_automation: { advantage_audience: 0 },
    };

    // A video bought for engagement is optimised for people who watch it.
    const engagementVideo = plan.objective === 'engagement' && creative.video;
    const start = new Date(Date.now() + 5 * 60_000);
    const end = new Date(start.getTime() + params.plan.days * 86_400_000);
    const adset = await graph<{ id: string }>(token, `${cfg.adAccountId}/adsets`, {
      form: {
        name: `${plan.name} — audience`,
        campaign_id: campaign.id,
        optimization_goal: engagementVideo ? 'THRUPLAY' : meta.optimization,
        billing_event: 'IMPRESSIONS',
        ...(meta.destination ? { destination_type: engagementVideo ? 'ON_VIDEO' : meta.destination } : {}),
        targeting: JSON.stringify(targeting),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: 'ACTIVE',
      },
    });

    const ad = await graph<{ id: string }>(token, `${cfg.adAccountId}/ads`, {
      form: { name: plan.name, adset_id: adset.id, creative: JSON.stringify(creative.spec), status: 'ACTIVE' },
    });

    // Everything below the campaign is live; the campaign is the one switch.
    if (params.launch) await graph(token, campaign.id, { form: { status: 'ACTIVE' } });

    return {
      campaignId: campaign.id,
      adsetId: adset.id,
      adId: ad.id,
      video: creative.video,
      previewUrl: creative.previewUrl,
      cities: cities.map((c) => c.name),
      interests: interests.map((i) => i.name),
    };
  } catch (e) {
    // A half-built campaign is clutter at best and a surprise at worst.
    await graph(token, campaign.id, { form: { status: 'DELETED' } }).catch(() => undefined);
    throw e;
  }
}

// ── reading and steering ────────────────────────────────────────────────────

const OBJECTIVE_KIND: Record<string, AdObjective> = {
  OUTCOME_TRAFFIC: 'traffic',
  LINK_CLICKS: 'traffic',
  OUTCOME_AWARENESS: 'awareness',
  REACH: 'awareness',
  BRAND_AWARENESS: 'awareness',
  OUTCOME_ENGAGEMENT: 'engagement',
  POST_ENGAGEMENT: 'engagement',
  VIDEO_VIEWS: 'engagement',
};

interface CampaignRow {
  id: string;
  name: string;
  objective: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  created_time?: string;
  stop_time?: string;
}

/** Read every campaign in the account, judge it, and steer the desk's own. */
async function syncAds(): Promise<string> {
  const { cfg, token } = await ready();
  const bench = await benchmarksNow(cfg);
  const now = Date.now();
  const act = cfg.adAccountId!;

  const insightFields = 'campaign_id,spend,impressions,reach,frequency,inline_link_clicks,actions,video_thruplay_watched_actions';
  const [campaigns, lifetime, week, series, ads, accountWeek] = await Promise.all([
    graph<{ data: CampaignRow[] }>(
      token,
      `${act}/campaigns?fields=id,name,objective,status,effective_status,daily_budget,created_time,stop_time&limit=100`,
    ),
    graph<{ data: (InsightRow & { campaign_id: string })[] }>(
      token,
      `${act}/insights?level=campaign&date_preset=maximum&limit=200&fields=${insightFields}`,
    ),
    graph<{ data: (InsightRow & { campaign_id: string })[] }>(
      token,
      `${act}/insights?level=campaign&date_preset=last_7d&limit=200&fields=${insightFields}`,
    ),
    graph<{ data: (InsightRow & { date_start: string })[] }>(
      token,
      `${act}/insights?level=account&date_preset=last_14d&time_increment=1&fields=spend,impressions,reach,inline_link_clicks`,
    ),
    graph<{ data: { campaign_id: string; effective_status: string; ad_review_feedback?: { global?: Record<string, string> } }[] }>(
      token,
      `${act}/ads?fields=campaign_id,effective_status,ad_review_feedback&limit=200`,
    ),
    // The week for the whole account, asked for at account level: people reached
    // by two campaigns are one person, and summing campaign reach would count
    // them twice and make "seen per person" look healthier than it is.
    graph<{ data?: InsightRow[] }>(
      token,
      `${act}/insights?level=account&date_preset=last_7d&fields=spend,impressions,reach,inline_link_clicks`,
    ),
  ]);

  const byId = <R extends { campaign_id: string }>(rows: R[]) => new Map(rows.map((r) => [r.campaign_id, r]));
  const life = byId(lifetime.data ?? []);
  const recent = byId(week.data ?? []);

  let committed = await committedDaily();
  const actions: string[] = [];
  const judged: { name: string; objective: AdObjective; verdict: Verdict; week: AdMetrics; managed: boolean }[] = [];

  for (const c of campaigns.data ?? []) {
    const ref = campaignRef(c.id);
    const mine = (await ref.get()).data() as
      | { managed?: boolean; objectiveKind?: AdObjective; video?: boolean; lastScaledMs?: number | null; endMs?: number | null }
      | undefined;
    const managed = mine?.managed === true;
    const objective = mine?.objectiveKind ?? OBJECTIVE_KIND[c.objective] ?? 'traffic';
    const resultAction = resultActionFor(c.objective, mine?.video);
    const lifetimeM = metricsFrom(life.get(c.id) ?? {}, resultAction);
    const weekM = metricsFrom(recent.get(c.id) ?? {}, resultAction);
    const dailyBudget = c.daily_budget ? fromMinor(Number(c.daily_budget), cfg.currency) : null;
    const endMs = c.stop_time ? Date.parse(c.stop_time) : (mine?.endMs ?? null);
    const active = c.effective_status === 'ACTIVE' && !(endMs && endMs < now);

    const verdict = diagnose({
      objective,
      // The last week is what the campaign is doing now; a young one only has its lifetime.
      m: weekM.impressions >= 1000 ? weekM : lifetimeM,
      bench,
      currency: cfg.currency,
      active,
      dailyBudget,
      ageHours: c.created_time ? (now - Date.parse(c.created_time)) / 3600_000 : 999,
      lastScaledMs: mine?.lastScaledMs ?? null,
      nowMs: now,
    });

    const rejected = (ads.data ?? []).filter((a) => a.campaign_id === c.id && a.effective_status === 'DISAPPROVED');
    const inReview = (ads.data ?? []).some((a) => a.campaign_id === c.id && a.effective_status === 'PENDING_REVIEW');
    const update: Record<string, unknown> = {
      id: c.id,
      name: c.name,
      objective: c.objective,
      objectiveKind: objective,
      status: c.status,
      effectiveStatus: c.effective_status,
      managed,
      dailyBudget,
      endMs,
      lifetime: lifetimeM,
      week: weekM,
      verdict,
      review: inReview
        ? 'In Meta review'
        : rejected.length
          ? `Rejected by Meta: ${rejected
              .flatMap((a) => Object.values(a.ad_review_feedback?.global ?? {}))
              .join(' ')
              .slice(0, 400) || 'no reason given'}`
          : null,
      syncedAtMs: now,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // The desk steers only what it made, and only when the owner said it may.
    if (managed && cfg.mode === 'direct' && active) {
      if (verdict.action.kind === 'pause') {
        await graph(token, c.id, { form: { status: 'PAUSED' } });
        update.status = 'PAUSED';
        committed -= dailyBudget ?? 0;
        actions.push(`Paused "${c.name}" — ${verdict.headline}`);
        update.autoActions = FieldValue.arrayUnion({ atMs: now, kind: 'pause', detail: verdict.action.why });
      } else if (verdict.action.kind === 'scale' && dailyBudget) {
        const { budget } = clampBudget({
          requested: verdict.action.to,
          cap: cfg.dailyCap,
          committed: committed - dailyBudget,
          minDaily: minDailyFor(cfg.currency),
          currency: cfg.currency,
        });
        if (budget && budget > dailyBudget) {
          await graph(token, c.id, { form: { daily_budget: toMinor(budget, cfg.currency) } });
          committed += budget - dailyBudget;
          update.dailyBudget = budget;
          update.lastScaledMs = now;
          actions.push(`Raised "${c.name}" to ${money(budget, cfg.currency)} a day — ${verdict.headline}`);
          update.autoActions = FieldValue.arrayUnion({
            atMs: now,
            kind: 'scale',
            detail: `${money(dailyBudget, cfg.currency)} → ${money(budget, cfg.currency)} a day`,
          });
        }
      }
    }

    await ref.set(update, { merge: true });
    judged.push({ name: c.name, objective, verdict, week: weekM, managed });
  }

  // The account at a glance, for the console's chart and tiles.
  const daily = (series.data ?? []).map((r) => {
    const m = metricsFrom(r, 'link_click');
    return { date: r.date_start, spend: m.spend, impressions: m.impressions, linkClicks: m.linkClicks };
  });
  const totals = metricsFrom(accountWeek.data?.[0] ?? {}, 'link_click');

  // Our own rides over the same week as Meta's last_7d: the seven days before today.
  // Only Velocity's desk has rides to count; a customer's orders are not ours to see.
  const rides = !isHouse()
    ? null
    : await statsFor(dateRange(8, now).slice(0, 7), now).catch((e) => {
        logger.warn('ads: could not read our own rides for cost per order', { message: (e as Error).message });
        return null;
      });
  const returns = rides
    ? blended({
        spend: totals.spend,
        currency: cfg.currency,
        orders: rides.reduce((n, d) => n + d.tripsCompleted, 0),
        commission: rides.reduce((n, d) => n + d.commission, 0),
      })
    : null;

  const status = `${judged.filter((j) => j.verdict.grade !== 'idle').length} running of ${judged.length}.${
    actions.length ? ` ${actions.join(' ')}` : ''
  }`;
  const patch: Record<string, unknown> = {
    account: { daily, week: totals, committed, bench, blended: returns },
    lastSyncAtMs: now,
    lastSyncStatus: status.slice(0, 600),
  };

  // The expert's read of the whole account, once a day.
  if (!cfg.review || now - cfg.review.atMs > 20 * 3600_000) {
    patch.review = await reviewAccount(cfg, judged, totals, returns);
  }
  await sdb.doc(CONFIG_PATH).set(patch, { merge: true });
  return status;
}

/** A few sentences on the whole account: what is working, where the next rupee goes. */
async function reviewAccount(
  cfg: AdsConfig,
  judged: { name: string; objective: AdObjective; verdict: Verdict; week: AdMetrics; managed: boolean }[],
  totals: AdMetrics,
  returns: Blended | null,
): Promise<AdsConfig['review']> {
  const live = judged.filter((j) => j.verdict.grade !== 'idle');
  const business =
    returns && totals.spend > 0
      ? `Across the whole business that week (blended — every completed ride, not only ones the ads brought): ` +
        `${returns.orders.toLocaleString('en-PK')} rides and ${money(returns.commission, 'PKR')} commission, so ` +
        `${returns.orders ? money(returns.costPerOrder, cfg.currency) : 'no rides to count'} of ads per order and ` +
        `ROAS ${returns.roas === null ? 'n/a' : returns.roas.toFixed(2)} (commission ÷ spend; 1.0 is break-even).`
      : '';
  const local = (): AdsConfig['review'] => ({
    atMs: Date.now(),
    summary: live.length
      ? `${live.length} campaign${live.length === 1 ? '' : 's'} running: ${['good', 'ok', 'bad', 'learning']
          .map((g) => `${live.filter((j) => j.verdict.grade === g).length} ${g === 'good' ? 'winning' : g === 'bad' ? 'underperforming' : g}`)
          .join(', ')}. ${money(totals.spend, cfg.currency)} spent this week. ${business}`.trim()
      : 'Nothing is running. Tell the desk what you want an ad to do and it will plan one.',
    moves: live.filter((j) => j.verdict.action.kind !== 'none').map((j) => `${j.name}: ${(j.verdict.action as { why: string }).why}`),
    engine: 'local',
  });
  if (!modelReady() || !live.length) return local();

  const settings = await getSocialSettings();
  const table = live
    .map(
      (j) =>
        `- ${j.name} (${j.objective}${j.managed ? ', made by the desk' : ''}): ${money(j.week.spend, cfg.currency)} this week, ` +
        `${j.week.results} results, CTR ${j.week.ctr.toFixed(2)}%, CPC ${money(j.week.cpc, cfg.currency)}, CPM ${money(j.week.cpm, cfg.currency)}, ` +
        `frequency ${j.week.frequency.toFixed(1)} — verdict: ${j.verdict.headline}`,
    )
    .join('\n');
  try {
    const { data } = await generateJson<{ summary?: string; moves?: string[] }>({
      model: settings.textModel,
      system: adsSystem(await adsPerson(), settings),
      prompt: `The paid account this week (${cfg.currency}; daily limit ${money(cfg.dailyCap, cfg.currency)}):\n${table}\n\n${business ? `${business}\n\n` : ''}Write the morning note to the owner. ONE JSON object: { "summary": "3–5 plain sentences: how it is going and where the next rupee should go", "moves": ["one concrete move", ...] (at most 4) }. Use only the numbers above.`,
      what: 'The ads review',
    });
    return {
      atMs: Date.now(),
      summary: (data.summary ?? '').slice(0, 1200) || local()!.summary,
      moves: (data.moves ?? []).filter((m) => typeof m === 'string').slice(0, 4).map((m) => m.slice(0, 300)),
      engine: activeEngine(),
    };
  } catch (e) {
    logger.warn('ads: the review failed, using the local one', { message: (e as Error).message });
    return local();
  }
}

/** Run a sync and record a failure on the config rather than throwing it away. */
async function syncAndRecord(): Promise<string> {
  try {
    return await syncAds();
  } catch (e) {
    const message =
      e instanceof AdsError && e.expired
        ? 'The Facebook sign-in for ads has expired. Press Reconnect on the Ads page.'
        : (e as Error).message;
    await sdb.doc(CONFIG_PATH).set({ lastSyncAtMs: Date.now(), lastSyncStatus: `Failed: ${message}`.slice(0, 600) }, { merge: true });
    throw e;
  }
}

// ── the schedule and the console ────────────────────────────────────────────

/** Every three hours: read the numbers, judge them, steer what the desk may. */
export const socialAdsSync = onSchedule(
  { schedule: 'every 3 hours', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: 300, memory: '512MiB' },
  () =>
    forEachWorkspace('ads', async () => {
      const cfg = await adsConfig();
      if (!cfg.adAccountId) return;
      await syncAndRecord().catch((e) => logger.error('ads: sync failed', { message: (e as Error).message }));
    }),
);

export const adminSyncAds = deskCall('ads', { timeoutSeconds: 300, memory: '512MiB' }, async () => {
  try {
    return { ok: true, status: await syncAndRecord() };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', (e as Error).message);
  }
});

export const adminSetAdsSettings = deskCall('ads', async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .object({
      mode: z.enum(['ask', 'direct']).optional(),
      dailyCap: z.number().min(0).max(10_000_000).optional(),
      maxDays: z.number().int().min(1).max(30).optional(),
      link: z.string().url().startsWith('https://').max(500).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid ads settings.');
  await sdb.doc(CONFIG_PATH).set({ ...parsed.data, updatedBy: ctx.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, config: await adsConfig() };
});

/**
 * "Make an ad" — the brief in, a campaign at Meta out.
 *
 * Launched straight away when the owner chose `direct` (or ticked "launch" on
 * this one), otherwise created paused and waiting for Approve. Either way the
 * budget has already been held to the daily limit by the time Meta hears of it.
 */
export const adminCreateAd = deskCall('ads', { timeoutSeconds: 540, memory: '2GiB' }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .object({
      brief: z.string().trim().min(5).max(2000),
      dailyBudget: z.number().positive().max(10_000_000).optional(),
      days: z.number().int().min(1).max(30).optional(),
      source: sourceSchema.optional(),
      launch: z.boolean().optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what the ad should do.');

  const { cfg, token } = await ready();
  if (!cfg.pageId) throw new HttpsError('failed-precondition', 'The ad account has no Facebook Page attached. Reconnect on the Ads page.');
  const source: CreativeSource = parsed.data.source ?? { kind: 'make' };
  const bench = await benchmarksNow(cfg);

  const { plan, engine } = await planAd({
    brief: parsed.data.brief,
    cfg,
    bench,
    requestedBudget: parsed.data.dailyBudget,
    requestedDays: parsed.data.days,
    source,
  });

  // The person's own number wins over the model's, and the limit wins over both.
  const requested = parsed.data.dailyBudget ?? plan.dailyBudget;
  const { budget, note } = clampBudget({
    requested,
    cap: cfg.dailyCap,
    committed: await committedDaily(),
    minDaily: minDailyFor(cfg.currency),
    currency: cfg.currency,
  });
  if (!budget) throw new HttpsError('failed-precondition', note ?? 'There is no room in the daily limit.');
  plan.dailyBudget = budget;
  if (parsed.data.days) plan.days = Math.min(parsed.data.days, cfg.maxDays);

  const launch = parsed.data.launch ?? cfg.mode === 'direct';
  const stamp = `${Date.now()}`;
  let made: Awaited<ReturnType<typeof createAtMeta>>;
  try {
    made = await createAtMeta({ token, cfg, plan, budget, source, launch, stamp });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', `Meta refused the campaign: ${(e as Error).message}`);
  }

  const expected = bench ? forecast({ objective: plan.objective, dailyBudget: budget, days: plan.days, bench }) : null;
  const person = await adsPerson();
  await campaignRef(made.campaignId).set({
    id: made.campaignId,
    name: plan.name,
    objective: META_OBJECTIVE[plan.objective].objective,
    objectiveKind: plan.objective,
    status: launch ? 'ACTIVE' : 'PAUSED',
    effectiveStatus: launch ? 'ACTIVE' : 'PAUSED',
    managed: true,
    approval: launch ? 'approved' : 'pending',
    dailyBudget: budget,
    endMs: Date.now() + plan.days * 86_400_000,
    adsetId: made.adsetId,
    adId: made.adId,
    video: made.video,
    previewUrl: made.previewUrl,
    source,
    brief: parsed.data.brief,
    plan,
    targeting: { cities: made.cities, interests: made.interests },
    forecast: expected,
    targets: bench
      ? { costPerResult: resultBand(plan.objective, bench).typical, ctr: bench.ctr.typical, cpc: bench.cpc.typical, cpm: bench.cpm.typical }
      : null,
    budgetNote: note,
    engine,
    plannedBy: person?.name ?? 'The desk',
    createdBy: ctx.uid,
    createdAtMs: Date.now(),
    lastScaledMs: null,
    verdict: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, campaignId: made.campaignId, launched: launch, budget, note, plan, forecast: expected };
});

/**
 * One button on a campaign row. Pause and end are always allowed; anything
 * that raises what the desk spends is held to the daily limit first.
 */
export const adminAdAction = deskCall('ads', { timeoutSeconds: 120 }, async (req) => {
  const ctx = requireAuth(req);
  const parsed = z
    .object({
      campaignId: z.string().regex(/^\d{5,40}$/),
      action: z.enum(['launch', 'pause', 'resume', 'budget', 'apply', 'end']),
      dailyBudget: z.number().positive().max(10_000_000).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { campaignId, action } = parsed.data;

  const { cfg, token } = await ready();
  const ref = campaignRef(campaignId);
  const doc = (await ref.get()).data() as
    | { managed?: boolean; dailyBudget?: number | null; verdict?: Verdict | null; name?: string }
    | undefined;
  if (!doc) throw new HttpsError('not-found', 'That campaign has not been read yet. Press Refresh.');

  /** Fit a daily budget for this campaign inside the limit, or refuse. */
  const fitBudget = async (requested: number): Promise<number> => {
    if (!doc.managed) return requested; // a campaign made by hand is the person's call
    const { budget, note } = clampBudget({
      requested,
      cap: cfg.dailyCap,
      committed: await committedDaily(campaignId),
      minDaily: minDailyFor(cfg.currency),
      currency: cfg.currency,
    });
    if (!budget) throw new HttpsError('failed-precondition', note ?? 'There is no room in the daily limit.');
    return budget;
  };

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  let what = '';

  /**
   * Switch it on — at a budget that fits. If the limit has less room than this
   * campaign's budget, the budget is lowered at Meta FIRST; checking the room
   * without changing the number would launch it past the limit.
   */
  const goLive = async (): Promise<string> => {
    const current = doc.dailyBudget ?? 0;
    let note = '';
    if (current > 0) {
      const fitted = await fitBudget(current);
      if (fitted < current) {
        await graph(token, campaignId, { form: { daily_budget: toMinor(fitted, cfg.currency) } });
        update.dailyBudget = fitted;
        note = ` Lowered to ${money(fitted, cfg.currency)} a day to stay inside your limit.`;
      }
    }
    await graph(token, campaignId, { form: { status: 'ACTIVE' } });
    Object.assign(update, { status: 'ACTIVE', effectiveStatus: 'ACTIVE', approval: 'approved' });
    return note;
  };
  const setBudget = async (requested: number) => {
    const budget = await fitBudget(requested);
    await graph(token, campaignId, { form: { daily_budget: toMinor(budget, cfg.currency) } });
    Object.assign(update, { dailyBudget: budget, lastScaledMs: Date.now() });
    return budget;
  };

  try {
    switch (action) {
      case 'launch':
      case 'resume': {
        const note = await goLive();
        what = `${action === 'launch' ? 'Launched.' : 'Running again.'}${note}`;
        break;
      }
      case 'pause':
        await graph(token, campaignId, { form: { status: 'PAUSED' } });
        Object.assign(update, { status: 'PAUSED', effectiveStatus: 'PAUSED' });
        what = 'Paused.';
        break;
      case 'end':
        await graph(token, campaignId, { form: { status: 'ARCHIVED' } });
        Object.assign(update, { status: 'ARCHIVED', effectiveStatus: 'ARCHIVED' });
        what = 'Ended. Its numbers stay here.';
        break;
      case 'budget': {
        if (!parsed.data.dailyBudget) throw new HttpsError('invalid-argument', 'Say the new daily budget.');
        what = `Now ${money(await setBudget(parsed.data.dailyBudget), cfg.currency)} a day.`;
        break;
      }
      case 'apply': {
        const next = doc.verdict?.action;
        if (!next || next.kind === 'none' || next.kind === 'refresh') {
          throw new HttpsError('failed-precondition', 'There is nothing to apply — make a new creative for it instead.');
        }
        if (next.kind === 'pause') {
          await graph(token, campaignId, { form: { status: 'PAUSED' } });
          Object.assign(update, { status: 'PAUSED', effectiveStatus: 'PAUSED' });
          what = 'Paused, as recommended.';
        } else {
          what = `Raised to ${money(await setBudget(next.to), cfg.currency)} a day, as recommended.`;
        }
        break;
      }
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', `Meta refused: ${(e as Error).message}`);
  }

  update.manualActions = FieldValue.arrayUnion({ atMs: Date.now(), by: ctx.uid, action, detail: what });
  await ref.set(update, { merge: true });
  return { ok: true, message: what };
});
