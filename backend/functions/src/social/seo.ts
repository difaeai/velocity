/**
 * The three search-and-spend desks: in-platform SEO, Google/YouTube search, and
 * the YouTube ads brief.
 *
 * They are together in one file because they share a premise the rest of the
 * team does not: a post is not finished when the feed stops showing it. A reel
 * that answers "Lahore se Islamabad kitna kiraya" is still being found in
 * eight months; one that says "Velocity — the smarter way to move" is gone in
 * eight hours.
 *
 * What each actually changes, so none of this is decoration:
 *
 * - **SEO** runs *before* the writer, and its keywords and hashtags are handed
 *   into the writing prompt. Its alt text is written onto the media assets, so
 *   it reaches the networks that accept alt text.
 * - **Search** writes the YouTube title, description and tags, and the YouTube
 *   adapter posts those instead of the hook and the caption.
 * - **Ads** writes a campaign brief. It does not spend money: this backend
 *   holds no Google Ads credential, and a language model with a budget is a
 *   different product with a different risk profile. A human takes the brief
 *   into Ads Manager.
 */
import { logger } from 'firebase-functions';

import { feedbackBlock, marketName, planBlock, systemFor } from './crew';
import { generateJson, modelReady } from './engine';
import { localAdPlan, localSearchPack, localSeoPack } from './local';
import {
  FORMAT_SPECS,
  type AdPlan,
  type ContentFormat,
  type ContentPlan,
  type ContentResearch,
  type Employee,
  type PostScript,
  type SearchPack,
  type SeoPack,
  type SocialSettings,
} from './types';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map((x) => x.trim().slice(0, len))
    : [];

// ── in-platform SEO ─────────────────────────────────────────────────────────

/**
 * Runs before the writer, so the words are in the piece rather than bolted on.
 *
 * Returns null on failure rather than throwing: a piece with weaker discovery
 * is a worse piece, not a failed run, and the writer works fine without this.
 */
export async function seoPass(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  angle: string;
  plan: ContentPlan | null;
  research: ContentResearch | null;
  /**
   * The run's figures. Unused by the model prompt and needed by the local
   * engine, which previews the draft it is about to brief so it never asks for
   * a phrase the piece will not contain.
   */
  facts: Record<string, number | string>;
  feedback: string[];
}): Promise<SeoPack | null> {
  const spec = FORMAT_SPECS[params.format];

  // Locally this is cheap and, unusually, verifiable: the brief is filtered
  // against the draft the writer is about to produce, so it never asks for a
  // phrase the piece will not contain. See `localSeoPack`.
  if (!modelReady()) {
    return localSeoPack({ angle: params.angle, format: params.format, facts: params.facts });
  }

  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: params.settings.textModel,
      system: `${systemFor(params.employee, params.settings, params.format)}

You are briefing the writer *before* they write, so your words end up inside the piece rather than stapled to the end of it.

Hashtags: exactly FIVE, no # prefix. Instagram capped a caption at five on 18 December 2025 and tags past the fifth do nothing at all. Size them rather than chasing volume: two niche (small enough that we can actually rank in them, a route or a city), two mid (the category somebody browses), one broad. Choose each because a human types it into the search box, not because it is big, and keep most of them local. Never #viral, #fyp, #explore, #trending, #instagood or #reels — they describe nothing and they rank for nothing.

Alt text: one per frame, in order, ${spec.slides} of them. A real description of the picture for someone who cannot see it — not a keyword list.

Reply with one JSON object and nothing else:
{
  "searchIntent": "the query this piece should answer, in the words someone would type",
  "keywords": ["4-8 phrases that belong in the spoken or on-screen copy"],
  "hashtags": ["exactly 5 tags, no # prefix: 2 niche, 2 mid, 1 broad"],
  "altTexts": ["one per frame, in order"],
  "note": "one line for the console: the call you made and why"
}`,
      what: 'The SEO brief',
      prompt: [
        `FORMAT: ${spec.label}, ${spec.slides} frame${spec.slides === 1 ? '' : 's'}.`,
        `ANGLE: ${params.angle}`,
        planBlock(params.plan, params.employee),
        params.research?.trends.length
          ? `What is being searched and watched right now: ${params.research.trends.slice(0, 5).join(' | ')}`
          : '',
        feedbackBlock(params.feedback),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    return {
      searchIntent: str(data.searchIntent, 200),
      keywords: list(data.keywords, 10, 80),
      hashtags: list(data.hashtags, 10, 40).map((h) => h.replace(/^#/, '')),
      altTexts: list(data.altTexts, 10, 300),
      note: str(data.note, 200) || 'Search brief written.',
    };
  } catch (e) {
    logger.warn('social: the SEO pass failed; writing without it', { error: (e as Error).message });
    return null;
  }
}

// ── Google and YouTube search ───────────────────────────────────────────────

/**
 * Runs after the script, because a YouTube title has to promise what the piece
 * actually delivers. For formats that never reach YouTube it still writes the
 * web angle, which is the half that feeds the marketing site.
 */
export async function searchPass(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  caption: string;
  seo: SeoPack | null;
  plan: ContentPlan | null;
  /** Both unused by the model prompt; both needed by the local engine. */
  angle: string;
  facts: Record<string, number | string>;
  feedback: string[];
}): Promise<SearchPack | null> {
  const spec = FORMAT_SPECS[params.format];
  const forYouTube = spec.kind === 'video';

  if (!modelReady()) {
    return localSearchPack({
      angle: params.angle,
      format: params.format,
      script: params.script,
      caption: params.caption,
      seo: params.seo,
      facts: params.facts,
    });
  }

  try {
    const { data } = await generateJson<{ youtube?: Record<string, unknown>; webAngle?: unknown; note?: unknown }>({
      model: params.settings.textModel,
      system: `${systemFor(params.employee, params.settings)}

${
  forYouTube
    ? `This piece is going to YouTube${params.format === 'reel' ? ' as a Short' : ''}. Write the metadata it is posted with — it is used verbatim, so it has to be right.

Title: under 60 characters, the phrase someone would type at the front, no clickbait a viewer would resent afterwards.
Description: first two lines answer the query and stand alone in search results; then the app link (https://play.google.com/store/apps/details?id=com.velocityridzpk.app) and the site (https://velocityrides.app); then a short paragraph. Under 1500 characters.
Tags: 8-15, mixing the exact query, its Urdu/Roman-Urdu form, and the city.`
    : 'This piece is not going to YouTube, so return null for the youtube field. Do the web angle only.'
}

Web angle: name the single query velocityrides.app should try to own off the back of this piece — a real search with real intent, not a slogan. If this piece does not support one, say so plainly in the field rather than inventing one.

Reply with one JSON object and nothing else:
{
  "youtube": ${forYouTube ? '{ "title": "...", "description": "...", "tags": ["..."] }' : 'null'},
  "webAngle": "the query, or an honest sentence saying there is not one",
  "note": "one line for the console"
}`,
      what: 'The search pack',
      prompt: [
        `FORMAT: ${spec.label}`,
        planBlock(params.plan, params.employee),
        '',
        `HOOK: ${params.script.hook}`,
        params.script.voiceover ? `VOICEOVER: ${params.script.voiceover}` : '',
        `CAPTION: ${params.caption}`,
        params.seo?.searchIntent ? `THE SEO DESK IS TARGETING: ${params.seo.searchIntent}` : '',
        params.seo?.keywords.length ? `Their keywords: ${params.seo.keywords.join(', ')}` : '',
        feedbackBlock(params.feedback),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const yt = data.youtube;
    const title = yt ? str(yt.title, 100) : '';

    return {
      youtube:
        forYouTube && title
          ? {
              title,
              description: str(yt?.description, 4500),
              tags: list(yt?.tags, 15, 40),
            }
          : null,
      webAngle: str(data.webAngle, 300),
      note: str(data.note, 200) || 'Search metadata written.',
    };
  } catch (e) {
    logger.warn('social: the search pass failed', { error: (e as Error).message });
    return null;
  }
}

// ── the ads brief ───────────────────────────────────────────────────────────

/**
 * The campaign brief for a finished video.
 *
 * Nothing here books, bids or spends. It produces the document a human pastes
 * into Google Ads — which is deliberate: connecting a Google Ads credential to
 * an unattended language model is a decision about money, and it is not one the
 * content desk should be allowed to make on someone's behalf.
 */
export async function adPass(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  script: PostScript;
  facts: Record<string, number | string>;
  plan: ContentPlan | null;
  search: SearchPack | null;
  /** Unused by the model prompt; the local engine reads its material from it. */
  angle: string;
  feedback: string[];
}): Promise<AdPlan | null> {
  if (!modelReady()) {
    return localAdPlan({ angle: params.angle, script: params.script, facts: params.facts });
  }

  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: params.settings.textModel,
      system: `${systemFor(params.employee, params.settings)}

You are writing the brief for one YouTube campaign built around one finished video. A human runs it; you do not have an account and you must not pretend to.

Be concrete about ${marketName()}: name real cities, real audience segments, and realistic daily budgets in the local currency for a growing business rather than a multinational. The first five seconds are the whole job on a skippable ad, so your hook variants are five-second openings, not slogans.

Reply with one JSON object and nothing else:
{
  "objective": "what this campaign is for, in one line",
  "campaignType": "e.g. Video views, Video action, Demand gen — and why that one",
  "hookVariants": ["3-4 different first-five-seconds to test"],
  "targeting": { "locations": ["cities"], "ages": "e.g. 18-34", "interests": ["real interest or in-market segments"] },
  "budgetNote": "a daily budget range in PKR and what it realistically buys",
  "cta": "the call to action on the ad",
  "whatToTest": "the one A/B that matters first",
  "successLooksLike": "the number that would mean it worked"
}`,
      what: 'The ad brief',
      prompt: [
        `THE VIDEO: ${params.script.hook}`,
        params.script.voiceover ? `Voiceover: ${params.script.voiceover}` : '',
        params.script.cta ? `It ends on: ${params.script.cta}` : '',
        planBlock(params.plan, params.employee),
        params.search?.youtube?.title ? `On YouTube it is titled: ${params.search.youtube.title}` : '',
        '',
        `FACTS (the only numbers you may use):\n${JSON.stringify(params.facts, null, 2)}`,
        feedbackBlock(params.feedback),
      ]
        .filter(Boolean)
        .join('\n'),
    });

    const targeting = (data.targeting ?? {}) as Record<string, unknown>;
    const objective = str(data.objective, 300);
    if (!objective) return null;

    return {
      objective,
      campaignType: str(data.campaignType, 200),
      hookVariants: list(data.hookVariants, 5, 300),
      targeting: {
        locations: list(targeting.locations, 8, 60),
        ages: str(targeting.ages, 40),
        interests: list(targeting.interests, 10, 80),
      },
      budgetNote: str(data.budgetNote, 300),
      cta: str(data.cta, 120),
      whatToTest: str(data.whatToTest, 300),
      successLooksLike: str(data.successLooksLike, 300),
    };
  } catch (e) {
    logger.warn('social: the ads brief failed', { error: (e as Error).message });
    return null;
  }
}
