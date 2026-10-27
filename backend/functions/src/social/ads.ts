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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { dateRange, dayKey, statsFor } from '../analytics';
import { FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { currentWorkspace, deskCall, forEachWorkspace, isHouse, sdb, workspaceBrand, wsPath } from './workspace';
import {
  AD_OBJECTIVES,
  META_OBJECTIVE,
  applyAnswer,
  blended,
  clampBudget,
  diagnose,
  explainPlan,
  forecast,
  fromMinor,
  learningBudget,
  localPlan,
  marketBenchmarks,
  MAX_REFRESHES,
  metricsFrom,
  minDailyFor,
  missingAnswers,
  money,
  normalisePlan,
  ownBenchmarks,
  REFRESH_EVERY_MS,
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
import { brandBlock, brandName, briefBlock, hardRules, marketName, researchBlock, standingInstructions, wordmark } from './crew';
import { activeTeam, employeeIntro } from './employees';
import { activeEngine, generateJson, modelReady } from './engine';
import { personas, planningResearch, topObjections, verdictFor, type AudienceTest, type Persona } from './market';
import { AD_NUMBERS } from './playbook';
import { underlay } from './footage';
import { latestPageRead } from './insights';
import { pictureFor } from './picture';
import { planReel, renderReel, stockQuery } from './reel';
import { getSocialSettings } from './settings';
import { planRef, type MonthPlan } from './strategy';
import { open, tokenVaultReady, type SealedSecret } from './secrets';
import { accentFor, planStill, renderStill } from './still';
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
  /**
   * What one sale or lead is worth to the owner, in the account's currency.
   * Prices the conversions Meta counts but cannot value (a lead form, a WhatsApp
   * chat), which is what makes ROAS possible without a pixel. 0 = not said.
   */
  valuePerConversion: number;
  lastSyncAtMs: number | null;
  lastSyncStatus: string | null;
  review: { atMs: number; summary: string; moves: string[]; engine: string } | null;
  /** When the expert last proposed a campaign of its own (`proposeIfIdle`). */
  lastProposalAtMs?: number | null;
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
  valuePerConversion: 0,
  lastSyncAtMs: null,
  lastSyncStatus: null,
  review: null,
};

async function adsConfig(): Promise<AdsConfig> {
  const snap = await sdb.doc(CONFIG_PATH).get();
  // A customer's ads go to their own site, never to Velocity's app listing.
  const site = workspaceBrand()?.website.trim() ?? '';
  const link = isHouse() ? PLAY_URL : site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : '';
  return { ...DEFAULTS, link, ...((snap.data() as Partial<AdsConfig> | undefined) ?? {}) };
}

async function adsToken(): Promise<string> {
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const snap = await sdb.doc(SECRET_PATH).get();
  const sealed = snap.data()?.token as SealedSecret | undefined;
  if (!sealed) {
    throw new HttpsError('failed-precondition', 'No ad account is connected yet. Connect one on Connected accounts.');
  }
  return open(sealed);
}

/** Connected and ready to spend: an account, a token, a limit. */
async function ready(): Promise<{ cfg: AdsConfig; token: string }> {
  const cfg = await adsConfig();
  if (!cfg.adAccountId) {
    throw new HttpsError('failed-precondition', 'No ad account is connected yet. Connect one on Connected accounts.');
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
  // What the photograph shows: the expert's own idea, else the ad's words as a scene.
  const scene = plan.picture?.trim() || `${plan.headline}. ${plan.lines.join('. ')}`;
  const accent = accentFor(isHouse() ? null : currentWorkspace());
  const dir = await mkdtemp(path.join(tmpdir(), 'velocity-ad-'));

  try {
    if (source.kind === 'post') {
      const post = (await sdb.doc(`socialPosts/${source.postId}`).get()).data() as SocialPost | undefined;
      if (!post) throw new HttpsError('not-found', 'No such piece.');
      const media = await refreshAssetUrls(postMedia(post));
      const video = media.find((m) => m.kind === 'video' && m.url);
      // A reel's cover is its picture; a still piece's first slide is.
      const image = media.find((m) => m.kind === 'image') ?? (post.cover?.storagePath ? post.cover : undefined);
      if (!video && !image) throw new HttpsError('failed-precondition', 'That piece has no picture or video yet.');
      videoUrl = video?.url ?? null;
      still = image
        ? await downloadAsset(image)
        : await renderStill(planStill({ headline: post.script?.hook || plan.lines[0], aspect: '9:16', layout: 'top' }), { wordmark: wordmark(), accent });
    } else if (plan.format === 'video') {
      const reel = planReel({
        format: 'reel',
        script: {
          hook: plan.lines[0],
          hookVariants: [],
          frames: plan.lines.slice(1).map((overlay) => ({ scene: overlay, overlay })),
          voiceover: '',
          cta: plan.headline,
          rationale: '',
          viralHook: '',
        },
      });
      // Real footage, a track and a voice under the words — the same as the organic reels.
      const under = await underlay({
        postId: `ad-${stamp}`,
        scenes: reel.beats.map((b) => b.scene),
        orientation: 'portrait',
        footage: true,
        voiceover: [plan.lines.join('. '), plan.headline].join('. '),
      });
      const pic = await pictureFor({ scene, query: stockQuery(scene), aspect: '9:16', layout: 'top', out: path.join(dir, 'picture.jpg') });
      try {
        const stored = await storeFile({
          path: wsPath(`socialAds/${stamp}/video.mp4`),
          bytes: await renderReel(reel, {
            wordmark: wordmark(),
            localClips: under.clips,
            localImages: under.clips.length || !pic ? [] : [pic.path],
            music: under.music,
            voice: under.voice,
          }),
          contentType: 'video/mp4',
        });
        videoUrl = stored.url;
      } finally {
        await under.cleanup();
      }
      still = await renderStill(planStill({ headline: plan.lines[0], body: plan.headline, aspect: '9:16', layout: 'top' }), {
        wordmark: wordmark(),
        photo: pic?.path,
        accent,
      });
    } else {
      const body = plan.lines.slice(1).join(' ') || (plan.headline !== plan.lines[0] ? plan.headline : null);
      const pic = await pictureFor({ scene, query: stockQuery(scene), aspect: '4:5', out: path.join(dir, 'picture.jpg') });
      still = await renderStill(planStill({ headline: plan.lines[0], body, aspect: '4:5', layout: 'bottom' }), {
        wordmark: wordmark(),
        photo: pic?.path,
        accent,
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
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
  const prompt = [
    `THE BRIEF, in the team lead's words:\n${params.brief}`,
    params.requestedBudget ? `They asked for ${money(params.requestedBudget, cfg.currency)} a day.` : '',
    params.requestedDays ? `They asked for ${params.requestedDays} days.` : '',
    params.source.kind === 'boost'
      ? 'The creative is an Instagram post that is already live — write the plan around boosting it; lines are unused.'
      : params.source.kind === 'post'
        ? 'The creative is a piece the desk already made — write the copy to go with it.'
        : 'The desk will draw the creative from your lines: lines[0] is the big hook on the picture, 2–8 words; up to three more short lines follow (or become the beats of a 20-second text reel if format is "video").',
    await planContext(cfg, bench),
    `Decide the campaign and answer with ONE JSON object:\n${planShape(cfg.currency)}`,
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

// ── the test audience ───────────────────────────────────────────────────────

/** What a simulated panel made of an ad, before Meta saw it. */
export interface AdPretest {
  verdict: AudienceTest['verdict'];
  /** Share of the panel that would act, maybes counted half; 0–1. */
  score: number;
  objections: string[];
  /** The score before the one rewrite, when the rewrite won. */
  firstScore: number | null;
  rewritten: boolean;
}

const AD_TEST_TASK = `Test this ad on a panel before it spends anything. Build 10 realistic people from its audience (the cities, ages, genders and interests below), at least three of them sceptics, because most people scroll past most ads. Show each one the ad exactly as it would appear in their feed — the words on the picture, the text above it, the headline and the button — and let them react honestly, in character: would they stop, would they tap and do what it asks, what is in the way. A reaction may be in English, Urdu or Roman Urdu, as that person would think it.

Reply with ONE JSON object and nothing else:
{ "panel": [{ "name": "a first name", "who": "age, place, situation", "reaction": "one or two sentences in their own voice", "wouldBuy": "yes" | "maybe" | "no", "objection": "the one thing in the way, or empty", "wouldShare": true | false }], "rewrite": { "lines": ["the hook on the picture, 2-8 words"], "primaryText": "...", "headline": "..." } }
The rewrite answers the panel's biggest objection and promises nothing the ad did not.`;

const cut = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** One panel run on an ad. Null with no model: the local engine cannot play people. */
async function panelOn(plan: AdPlanSpec): Promise<{ panel: Persona[]; rewrite: Partial<AdPlanSpec> } | null> {
  if (!modelReady()) return null;
  const settings = await getSocialSettings();
  const a = plan.audience;
  const { data } = await generateJson<Record<string, unknown>>({
    model: settings.textModel,
    what: 'The ad test audience',
    system: [`You test ${brandName()}'s ads on a simulated audience before a rupee is spent.`, brandBlock(), AD_TEST_TASK].join('\n\n'),
    prompt: [
      `AUDIENCE: ${a.cities.join(', ') || marketName()}; ages ${a.ageMin}-${a.ageMax}; ${a.genders}; interests: ${a.interests.join(', ') || 'broad'}.`,
      `THE AD — on the picture: ${plan.lines.join(' / ') || '(a piece the desk already made)'}\nText above it: ${plan.primaryText}\nHeadline: ${plan.headline}\nButton: ${plan.cta}`,
    ].join('\n\n'),
  });
  const r = (data.rewrite ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines.map((l) => cut(l, 60)).filter(Boolean).slice(0, 4) : [];
  return {
    panel: personas(data.panel),
    rewrite: {
      ...(lines.length ? { lines } : {}),
      ...(cut(r.primaryText, 500) ? { primaryText: cut(r.primaryText, 500) } : {}),
      ...(cut(r.headline, 60) ? { headline: cut(r.headline, 60) } : {}),
    },
  };
}

/**
 * The ad meets a test audience before Meta does — free of ad spend, a model
 * playing ten people from its own audience — and a weak result gets one rewrite
 * against its main objection and a retest; the better version is the one that
 * goes to Meta. A simulation, so it advises: only an unconvinced panel holds an
 * automatic launch for the owner's Approve. The verdict is code's, not the model's.
 */
export async function pretestAd(plan: AdPlanSpec): Promise<AdPretest | null> {
  const first = await panelOn(plan).catch(() => null);
  if (!first?.panel.length) return null;
  const a = verdictFor(first.panel);
  const firstResult: AdPretest = { ...a, objections: topObjections(first.panel), firstScore: null, rewritten: false };
  if (a.verdict === 'go' || !Object.keys(first.rewrite).length) return firstResult;

  const was = { lines: plan.lines, primaryText: plan.primaryText, headline: plan.headline };
  Object.assign(plan, first.rewrite);
  const second = await panelOn(plan).catch(() => null);
  const b = second?.panel.length ? verdictFor(second.panel) : null;
  if (!b || b.score <= a.score) {
    Object.assign(plan, was);
    return firstResult;
  }
  return { ...b, objections: topObjections(second!.panel), firstScore: a.score, rewritten: true };
}

/** The plan as JSON, the one shape both planning and designing answer in. */
const planShape = (currency: string) => `{
  "name": "short campaign name",
  "objective": "traffic" | "awareness" | "engagement",
  "audience": { "cities": ["Lahore", ...] (empty for the whole market), "ageMin": 18, "ageMax": 45, "genders": "all" | "men" | "women", "interests": ["only if clearly needed", ...] },
  "dailyBudget": number in ${currency} — enough to leave learning, inside the limit,
  "days": number,
  "format": "image" | "video",
  "primaryText": "the ad text, the first line carries it",
  "headline": "40 characters or fewer",
  "cta": "LEARN_MORE" | "DOWNLOAD" | "SIGN_UP" | "APPLY_NOW" | "BOOK_TRAVEL" | "GET_OFFER",
  "lines": ["hook", "line", "line"],
  "picture": "the photograph behind the words: who or what, where, the light — a real scene in this market, no text in it",
  "why": "3–5 sentences: why this objective, this audience, this budget, and the CPC/CTR it should hit"
}`;

/** What the planner weighs besides the brief: the money, the yardstick, our own history and the market. */
async function planContext(cfg: AdsConfig, bench: Benchmarks | null): Promise<string> {
  const past = (await sdb.collection('socialAds').limit(30).get()).docs
    .map((d) => d.data() as { name?: string; objectiveKind?: string; lifetime?: AdMetrics; verdict?: Verdict })
    .filter((c) => c.lifetime && c.lifetime.spend > 0)
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.name} (${c.objectiveKind}): spent ${money(c.lifetime!.spend, cfg.currency)}, ${c.lifetime!.results} results, ` +
        `CTR ${c.lifetime!.ctr.toFixed(2)}%, CPC ${money(c.lifetime!.cpc, cfg.currency)}` +
        (c.lifetime!.conversions ? `, ${c.lifetime!.conversions} conversions` : '') +
        (c.lifetime!.roas != null ? `, ROAS ${c.lifetime!.roas.toFixed(2)}` : '') +
        ` — ${c.verdict?.headline ?? ''}`,
    );

  const committed = await committedDaily();
  const yard = bench
    ? `What things cost here (${bench.source === 'own' ? 'this account’s own medians' : 'typical for Pakistan'}), in ${cfg.currency}: ` +
      `CPM ${bench.cpm.low}–${bench.cpm.high}, CPC ${bench.cpc.low}–${bench.cpc.high}, link CTR ${bench.ctr.low}–${bench.ctr.high}%, ` +
      `cost per engagement ${bench.cpe.low}–${bench.cpe.high}. Learning needs about ` +
      AD_OBJECTIVES.map((o) => `${money(learningBudget(o, bench), cfg.currency)}/day for ${o}`).join(', ') +
      '.'
    : 'No cost yardstick for this currency.';

  return [
    `MONEY: account currency ${cfg.currency}. The owner's daily limit for all campaigns together is ${money(cfg.dailyCap, cfg.currency)}; ` +
      `${money(committed, cfg.currency)} of it is already running. Minimum ${money(minDailyFor(cfg.currency), cfg.currency)} a day. ` +
      `At most ${cfg.maxDays} days. Ads send people to ${cfg.link}.`,
    yard,
    past.length ? `HOW OUR OWN CAMPAIGNS DID — evidence, weigh it above the yardstick:\n${past.join('\n')}` : '',
    // The market and the competition, so the angle is one nobody else is already running.
    researchBlock(await planningResearch()),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * "Design it with me": the expert reads the conversation and the plan so far,
 * says in plain words what it would run and why, asks what would sharpen it,
 * and hands back the updated plan. Nothing reaches Meta and nothing is spent —
 * creating it is a separate call that still holds the budget to the limit.
 */
async function designAd(params: {
  chat: { from: 'you' | 'expert'; text: string }[];
  draft: Record<string, unknown> | null;
  cfg: AdsConfig;
  bench: Benchmarks | null;
}): Promise<{ reply: string; questions: string[]; plan: AdPlanSpec; engine: string; note: string | null }> {
  const { cfg, bench, chat } = params;
  const asked = chat
    .filter((m) => m.from === 'you')
    .map((m) => m.text)
    .join('\n');
  const committed = await committedDaily();
  // The money as it would actually run — held to the limit and Meta's minimum — before anything is said about it.
  const fit = (p: AdPlanSpec): { plan: AdPlanSpec; note: string | null } => {
    const f = clampBudget({ requested: p.dailyBudget, cap: cfg.dailyCap, committed, minDaily: minDailyFor(cfg.currency), currency: cfg.currency });
    return { plan: f.budget ? { ...p, dailyBudget: f.budget } : p, note: f.note };
  };
  const base = localPlan({ brief: asked, bench, maxDays: cfg.maxDays });
  const latest = chat[chat.length - 1].text;
  const draft = fit(applyAnswer(params.draft ? normalisePlan(params.draft, base, cfg.maxDays) : base, latest, cfg.maxDays));
  const local = () => ({
    reply: explainPlan(draft.plan, cfg.currency),
    questions: missingAnswers(draft.plan, asked),
    plan: draft.plan,
    note: draft.note,
    engine: 'local',
  });
  if (!modelReady()) return local();

  const settings = await getSocialSettings();
  try {
    const { data } = await generateJson<{ reply?: unknown; questions?: unknown; plan?: Record<string, unknown> }>({
      model: settings.textModel,
      system: adsSystem(await adsPerson(), settings),
      what: 'The campaign design',
      prompt: [
        `THE CONVERSATION SO FAR, oldest first:\n${chat.map((m) => `${m.from === 'you' ? 'OWNER' : 'YOU'}: ${m.text}`).join('\n')}`,
        params.draft ? `THE PLAN SO FAR:\n${JSON.stringify(draft.plan)}` : '',
        await planContext(cfg, bench),
        `You are designing this campaign WITH the owner, who is not an ads expert. Answer with ONE JSON object:
{
  "reply": "4–7 plain sentences with no jargon (explain any number you use — CPC is what one tap costs): what you understood they want, the campaign you recommend and why — the goal, who sees it, the money and what it should buy. If their latest message asks a question, answer it first.",
  "questions": ["at most 3 short questions whose answers would change the plan; none when nothing important is missing"],
  "plan": ${planShape(cfg.currency)}
}
Change only what their latest message asks for or what your answer requires; keep the rest of the plan as it was.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    const { plan, note } = fit(normalisePlan(data.plan ?? {}, draft.plan, cfg.maxDays));
    const reply = typeof data.reply === 'string' ? data.reply.trim().slice(0, 1600) : '';
    const questions = Array.isArray(data.questions)
      ? data.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, 3).map((q) => q.trim().slice(0, 200))
      : [];
    return { reply: reply || explainPlan(plan, cfg.currency), questions, plan, note, engine: activeEngine() };
  } catch (e) {
    logger.warn('ads: the campaign design failed, using the local one', { message: (e as Error).message });
    return local();
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

// ── a fresh creative for a tired campaign ───────────────────────────────────

/** What the desk keeps on a campaign it made, beyond what Meta reports. */
interface CampaignDoc {
  managed?: boolean;
  name?: string;
  objectiveKind?: AdObjective;
  video?: boolean;
  dailyBudget?: number | null;
  lastScaledMs?: number | null;
  endMs?: number | null;
  verdict?: Verdict | null;
  adsetId?: string;
  adId?: string;
  /** The ad a fresh creative replaces, paused once the new one is approved. */
  retireAdId?: string | null;
  plan?: AdPlanSpec;
  previewUrl?: string | null;
  refreshes?: number;
  lastRefreshMs?: number | null;
}

/**
 * The expert's rewrite of a worn-out creative: a different hook, opening line
 * and picture for the same offer and the same people — the targeting and the
 * money are not what wore out, so they are held to the old plan. Null without a
 * model, or when it only says the same thing again: re-rendering the same words
 * changes nothing.
 */
async function rewriteCreative(plan: AdPlanSpec, verdict: Verdict, cfg: AdsConfig): Promise<AdPlanSpec | null> {
  if (!modelReady()) return null;
  const settings = await getSocialSettings();
  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: adsSystem(await adsPerson(), settings),
      what: 'The fresh creative',
      prompt: [
        `This campaign's creative has worn out: ${verdict.headline} ${verdict.reasons.join(' ')}`,
        `What it says now — hook on the picture: "${plan.lines[0] ?? ''}"; ad text: "${plan.primaryText.slice(0, 300)}"; headline: "${plan.headline}".`,
        researchBlock(await planningResearch()),
        'Write a new version for the same offer and the same people: a different hook, a different first line, a different picture idea. Answer with ONE JSON object: { "primaryText": "the ad text, the first line carries it", "headline": "40 characters or fewer", "lines": ["hook", "line", "line"], "why": "one or two sentences: what changed and why it should stop thumbs again" }',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    const next = normalisePlan(
      { ...data, name: plan.name, objective: plan.objective, audience: plan.audience, dailyBudget: plan.dailyBudget, days: plan.days, format: plan.format, cta: plan.cta },
      plan,
      cfg.maxDays,
    );
    return next.lines[0] && next.lines[0] !== plan.lines[0] ? next : null;
  } catch (e) {
    logger.warn('ads: the creative rewrite failed', { message: (e as Error).message });
    return null;
  }
}

/**
 * Put a fresh creative into a campaign: a new ad in the same ad set, beside
 * the old one. The old ad is paused by the next reading once Meta has approved
 * the new one, so the campaign never sits dark through a review. Returns the
 * line for the log, or null when there was nothing better to say.
 */
async function refreshCreative(
  token: string,
  cfg: AdsConfig,
  campaignId: string,
  doc: CampaignDoc,
  verdict: Verdict,
): Promise<string | null> {
  if (!doc.adsetId || !doc.plan) return null;
  const plan = await rewriteCreative(doc.plan, verdict, cfg);
  if (!plan) return null;
  const version = (doc.refreshes ?? 0) + 2;
  const creative = await buildCreative(token, cfg, plan, { kind: 'make' }, `${Date.now()}`);
  const ad = await graph<{ id: string }>(token, `${cfg.adAccountId}/ads`, {
    form: { name: `${plan.name} — v${version}`, adset_id: doc.adsetId, creative: JSON.stringify(creative.spec), status: 'ACTIVE' },
  });
  await campaignRef(campaignId).set(
    {
      plan,
      adId: ad.id,
      retireAdId: doc.adId ?? null,
      previewUrl: creative.previewUrl ?? doc.previewUrl ?? null,
      refreshes: version - 1,
      lastRefreshMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return `new creative v${version}: "${plan.lines[0]}"`;
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

  const insightFields =
    'campaign_id,spend,impressions,reach,frequency,inline_link_clicks,actions,action_values,video_thruplay_watched_actions';
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
    graph<{
      data: { id: string; campaign_id: string; effective_status: string; ad_review_feedback?: { global?: Record<string, string> } }[];
    }>(token, `${act}/ads?fields=id,campaign_id,effective_status,ad_review_feedback&limit=200`),
    // The week for the whole account, asked for at account level: people reached
    // by two campaigns are one person, and summing campaign reach would count
    // them twice and make "seen per person" look healthier than it is.
    graph<{ data?: InsightRow[] }>(
      token,
      `${act}/insights?level=account&date_preset=last_7d&fields=spend,impressions,reach,inline_link_clicks,actions,action_values`,
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
    const mine = (await ref.get()).data() as CampaignDoc | undefined;
    const managed = mine?.managed === true;
    const objective = mine?.objectiveKind ?? OBJECTIVE_KIND[c.objective] ?? 'traffic';
    const resultAction = resultActionFor(c.objective, mine?.video);
    const lifetimeM = metricsFrom(life.get(c.id) ?? {}, resultAction, cfg.valuePerConversion);
    const weekM = metricsFrom(recent.get(c.id) ?? {}, resultAction, cfg.valuePerConversion);
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
      valuePerConversion: cfg.valuePerConversion,
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

    // A refreshed campaign's old creative steps aside once Meta has approved the
    // new one — finishing a change already made, so it does not wait on the mode.
    if (mine?.retireAdId) {
      const takenOver = (ads.data ?? []).some(
        (a) => a.campaign_id === c.id && a.id !== mine.retireAdId && a.effective_status === 'ACTIVE',
      );
      if (takenOver) {
        await graph(token, mine.retireAdId, { form: { status: 'PAUSED' } }).catch(() => undefined);
        update.retireAdId = null;
      }
    }

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
      } else if (
        verdict.action.kind === 'refresh' &&
        !mine?.retireAdId &&
        (mine?.refreshes ?? 0) < MAX_REFRESHES &&
        now - (mine?.lastRefreshMs ?? 0) >= REFRESH_EVERY_MS
      ) {
        // Improving it, not just judging it: a worn-out creative gets a new one.
        const did = await refreshCreative(token, cfg, c.id, mine ?? {}, verdict).catch((e) => {
          logger.warn('ads: could not refresh a creative', { campaign: c.id, message: (e as Error).message });
          return null;
        });
        if (did) {
          actions.push(`Refreshed "${c.name}" — ${did}.`);
          update.autoActions = FieldValue.arrayUnion({ atMs: now, kind: 'refresh', detail: did });
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
  const totals = metricsFrom(accountWeek.data?.[0] ?? {}, 'link_click', cfg.valuePerConversion);

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

  // Not waiting to be asked: with nothing of the desk's running, it proposes something.
  const proposed = await proposeIfIdle(cfg, now);
  if (proposed) patch.lastSyncStatus = `${status} ${proposed}`.slice(0, 600);

  // The expert's read of the whole account, once a day.
  if (!cfg.review || now - cfg.review.atMs > 20 * 3600_000) {
    patch.review = await reviewAccount(cfg, judged, totals, returns);
  }
  await sdb.doc(CONFIG_PATH).set(patch, { merge: true });
  return status;
}

/** How long the expert waits after one proposal before it makes another. */
const PROPOSE_EVERY_MS = 7 * 86_400_000;

/**
 * The expert does not wait to be asked. When none of the desk's own campaigns
 * is running or waiting for an Approve, it proposes one — at most once a week:
 * boosting our best recent Instagram post (the cheapest result there is: it
 * already proved it lands with nobody paying for it), or, with none, the first
 * paid campaign the month plan named. `ask` mode creates it paused for Approve,
 * so nothing is spent until a person says so; `direct` launches it inside the
 * daily limit, which is what the owner chose that mode for. Every rupee still
 * goes through `clampBudget` inside `launchCampaign`.
 */
async function proposeIfIdle(cfg: AdsConfig, now: number): Promise<string | null> {
  if (!cfg.pageId || !cfg.mode || cfg.dailyCap <= 0 || !cfg.link) return null;
  if (now - (cfg.lastProposalAtMs ?? 0) < PROPOSE_EVERY_MS) return null;
  const ours = (await sdb.collection('socialAds').where('managed', '==', true).get()).docs.map(
    (d) => d.data() as CampaignDoc & { status?: string; approval?: string },
  );
  if (ours.some((c) => (c.status === 'ACTIVE' && !(c.endMs && c.endMs < now)) || c.approval === 'pending')) return null;

  const read = await latestPageRead().catch(() => null);
  const best = (read?.best ?? []).find(
    // Instagram media ids are all digits; that is also the only kind Meta boosts as a post.
    (p) => /^\d{5,40}$/.test(p.mediaId) && p.multiple >= 1.5 && now - p.postedAtMs < 30 * 86_400_000,
  );
  const idea = best ? null : (((await planRef(dayKey(now).slice(0, 7)).get()).data() as MonthPlan | undefined)?.ads?.[0] ?? null);
  if (!best && !idea) return null;

  // Before trying, so one that fails is not retried — and its model calls paid for — every three hours.
  await sdb.doc(CONFIG_PATH).set({ lastProposalAtMs: now }, { merge: true });
  const goal = isHouse() ? 'install the app and book a ride' : 'become customers';
  const brief = best
    ? `Boost our best recent Instagram post — on its own it reached ${best.multiple}x our usual audience: "${best.hook.slice(0, 160)}". Put money behind it to reach new people in ${marketName()} who would ${goal}.`
    : `${idea} (from this month's plan)`;
  try {
    const made = await launchCampaign({
      brief,
      by: 'meta-ad-expert',
      days: Math.min(7, cfg.maxDays),
      ...(best ? { source: { kind: 'boost' as const, mediaId: best.mediaId } } : {}),
    });
    return `Proposed "${made.plan.name}" (${best ? `boosting our best post, ${best.multiple}x our normal` : "from this month's plan"}) — ${
      made.launched ? `live at ${money(made.budget, cfg.currency)} a day` : 'waiting for your Approve'
    }.`;
  } catch (e) {
    logger.warn('ads: the expert could not propose a campaign', { message: (e as Error).message });
    return `Tried to propose a campaign but could not: ${(e as Error).message}`.slice(0, 300);
  }
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
      : totals.conversions
        ? `What the ads bought that week, as Meta saw it: ${totals.conversions.toLocaleString('en-PK')} conversions at ` +
          `${money(totals.costPerConversion ?? 0, cfg.currency)} each` +
          (totals.roas != null ? `, ROAS ${totals.roas.toFixed(2)} (worth ÷ spend; 1.0 is break-even).` : '.')
        : '';
  const local = (): AdsConfig['review'] => ({
    atMs: Date.now(),
    summary: live.length
      ? `${live.length} campaign${live.length === 1 ? '' : 's'} running: ${['good', 'ok', 'bad', 'learning']
          .map((g) => `${live.filter((j) => j.verdict.grade === g).length} ${g === 'good' ? 'winning' : g === 'bad' ? 'underperforming' : g}`)
          .join(', ')}. ${money(totals.spend, cfg.currency)} spent this week. ${business}`.trim()
      : 'Nothing is running. The expert proposes a campaign on its own once a week — or tell it what you want an ad to do.',
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
        `frequency ${j.week.frequency.toFixed(1)}` +
        (j.week.conversions ? `, ${j.week.conversions} conversions at ${money(j.week.costPerConversion ?? 0, cfg.currency)}` : '') +
        (j.week.roas != null ? `, ROAS ${j.week.roas.toFixed(2)}` : '') +
        ` — verdict: ${j.verdict.headline}`,
    )
    .join('\n');
  try {
    const market = researchBlock(await planningResearch());
    const { data } = await generateJson<{ summary?: string; moves?: string[] }>({
      model: settings.textModel,
      system: adsSystem(await adsPerson(), settings),
      prompt: [
        `The paid account this week (${cfg.currency}; daily limit ${money(cfg.dailyCap, cfg.currency)}):\n${table}`,
        business,
        market ? `${market}\n\nRead the market and the competition before you suggest a move — an angle everyone else is already running is not one.` : '',
        `Write the morning note to the owner. Say which campaign is doing best and that it keeps running untouched. ONE JSON object: { "summary": "3–5 plain sentences: how it is going and where the next rupee should go", "moves": ["one concrete move", ...] (at most 4) }. Use only the numbers above.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
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
        ? 'The Facebook sign-in for ads has expired. Sign in again on Connected accounts — or paste a never-expiring System User token there.'
        : (e as Error).message;
    await sdb.doc(CONFIG_PATH).set({ lastSyncAtMs: Date.now(), lastSyncStatus: `Failed: ${message}`.slice(0, 600) }, { merge: true });
    throw e;
  }
}

// ── the schedule and the console ────────────────────────────────────────────

/**
 * Every three hours: read the numbers, judge them, steer what the desk may.
 * 2GiB and nine minutes because steering now includes drawing a fresh
 * creative — a picture, or a reel cut with ffmpeg — for a worn-out campaign.
 */
export const socialAdsSync = onSchedule(
  { schedule: 'every 3 hours', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: 540, memory: '2GiB' },
  () =>
    forEachWorkspace('ads', async () => {
      const cfg = await adsConfig();
      if (!cfg.adAccountId) return;
      await syncAndRecord().catch((e) => logger.error('ads: sync failed', { message: (e as Error).message }));
    }),
);

export const adminSyncAds = deskCall('ads', { timeoutSeconds: 540, memory: '2GiB' }, async () => {
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
      valuePerConversion: z.number().min(0).max(100_000_000).optional(),
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
  await rateLimit(ctx.uid, 'adsCreate', 10, 3600);
  const parsed = z
    .object({
      brief: z.string().trim().min(5).max(2000),
      dailyBudget: z.number().positive().max(10_000_000).optional(),
      days: z.number().int().min(1).max(30).optional(),
      source: sourceSchema.optional(),
      launch: z.boolean().optional(),
      /** The plan the owner designed with the expert; every field is clamped again here. */
      plan: z.record(z.unknown()).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what the ad should do.');
  return { ok: true, ...(await launchCampaign({ ...parsed.data, by: ctx.uid })) };
});

/**
 * "Design a campaign with me": one turn of the conversation on the Ads page.
 * Works before the ad account is connected — understanding a campaign costs
 * nothing — and never touches Meta. The budget it shows is already held to the
 * owner's limit, the same way the create call will hold it.
 */
export const adminDesignAd = deskCall('ads', { timeoutSeconds: 120 }, async (req) => {
  // One model call a turn: the AI month caps the cost, this caps a runaway tab.
  await rateLimit(requireAuth(req).uid, 'adsDesign', 40, 3600);
  const parsed = z
    .object({
      chat: z
        .array(z.object({ from: z.enum(['you', 'expert']), text: z.string().trim().min(1).max(2000) }))
        .min(1)
        .max(24),
      draft: z.record(z.unknown()).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success || parsed.data.chat[parsed.data.chat.length - 1].from !== 'you') {
    throw new HttpsError('invalid-argument', 'Say what you want from the campaign.');
  }
  const cfg = await adsConfig();
  const bench = await benchmarksNow(cfg);
  const res = await designAd({ chat: parsed.data.chat, draft: parsed.data.draft ?? null, cfg, bench });
  return {
    ok: true,
    ...res,
    currency: cfg.currency,
    forecast: bench ? forecast({ objective: res.plan.objective, dailyBudget: res.plan.dailyBudget, days: res.plan.days, bench }) : null,
  };
});

/** Whether the ads desk may make a campaign right now: an account, a page, a limit and an answer to "ask or launch". */
export async function adsReady(): Promise<boolean> {
  const cfg = await adsConfig();
  return Boolean(cfg.adAccountId && cfg.pageId && cfg.dailyCap > 0 && cfg.mode && cfg.link);
}

/**
 * Plan, make and create one campaign: "Make an ad" on the console, and the
 * launch sequence's first campaign. Launched straight away when the owner
 * chose `direct` (or asked for it on this one), otherwise created paused and
 * waiting for Approve. Either way the budget has already been held to the daily
 * limit by the time Meta hears of it.
 */
export async function launchCampaign(params: {
  brief: string;
  /** Who asked: a uid, or the launch sequence. */
  by: string;
  dailyBudget?: number;
  days?: number;
  source?: CreativeSource;
  launch?: boolean;
  /** Designed with the owner: used as it is (clamped), not planned again. */
  plan?: Record<string, unknown>;
}) {
  const { cfg, token } = await ready();
  if (!cfg.pageId) throw new HttpsError('failed-precondition', 'The ad account has no Facebook Page attached. Connect the Page on Connected accounts.');
  if (!cfg.link) throw new HttpsError('failed-precondition', 'Say where the ads should send people — your website or WhatsApp link — on the Ads page.');
  const source: CreativeSource = params.source ?? { kind: 'make' };
  const bench = await benchmarksNow(cfg);

  const { plan, engine } = params.plan
    ? {
        plan: normalisePlan(params.plan, localPlan({ brief: params.brief, bench, maxDays: cfg.maxDays }), cfg.maxDays),
        engine: 'designed with the owner',
      }
    : await planAd({
        brief: params.brief,
        cfg,
        bench,
        requestedBudget: params.dailyBudget,
        requestedDays: params.days,
        source,
      });

  // The person's own number wins over the model's, and the limit wins over both.
  const requested = params.dailyBudget ?? plan.dailyBudget;
  const { budget, note } = clampBudget({
    requested,
    cap: cfg.dailyCap,
    committed: await committedDaily(),
    minDaily: minDailyFor(cfg.currency),
    currency: cfg.currency,
  });
  if (!budget) throw new HttpsError('failed-precondition', note ?? 'There is no room in the daily limit.');
  plan.dailyBudget = budget;
  if (params.days) plan.days = Math.min(params.days, cfg.maxDays);

  // Before Meta sees it: the test audience, and one rewrite if it is weak. A boost keeps the live post's own words.
  const pretest = source.kind === 'boost' ? null : await pretestAd(plan);
  // The owner's own Launch stands; an automatic one waits for an Approve when the panel was not convinced.
  const launch = params.launch ?? (cfg.mode === 'direct' && pretest?.verdict !== 'not_yet');
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
    brief: params.brief,
    plan,
    targeting: { cities: made.cities, interests: made.interests },
    forecast: expected,
    targets: bench
      ? { costPerResult: resultBand(plan.objective, bench).typical, ctr: bench.ctr.typical, cpc: bench.cpc.typical, cpm: bench.cpm.typical }
      : null,
    budgetNote: note,
    pretest,
    engine,
    plannedBy: person?.name ?? 'The desk',
    createdBy: params.by,
    createdAtMs: Date.now(),
    lastScaledMs: null,
    verdict: null,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { campaignId: made.campaignId, launched: launch, budget, note, plan, forecast: expected, pretest };
}

/**
 * One button on a campaign row. Pause and end are always allowed; anything
 * that raises what the desk spends is held to the daily limit first.
 */
// Nine minutes and 2GiB because "apply" on a worn-out campaign draws its new creative.
export const adminAdAction = deskCall('ads', { timeoutSeconds: 540, memory: '2GiB' }, async (req) => {
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
  const doc = (await ref.get()).data() as CampaignDoc | undefined;
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
        if (!next || next.kind === 'none') throw new HttpsError('failed-precondition', 'There is nothing to apply.');
        if (next.kind === 'refresh') {
          if (!doc.managed) {
            throw new HttpsError('failed-precondition', 'Only a campaign the desk made can have its creative changed from here.');
          }
          const did = await refreshCreative(token, cfg, campaignId, doc, doc.verdict!);
          if (!did) throw new HttpsError('failed-precondition', 'The expert could not write a better version right now. Try again later.');
          what = `Made a ${did}. The old one steps aside once Meta approves it.`;
        } else if (next.kind === 'pause') {
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
