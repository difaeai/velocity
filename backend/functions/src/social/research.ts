/**
 * Qalam's morning read.
 *
 * Before anything is written, the writer searches: what is travelling on
 * Pakistani feeds this week, what the other ride-hailing apps are posting, and
 * which hook shapes keep coming back. Gemini's own Google Search grounding does
 * the looking, which matters for two reasons — the model reports the pages it
 * actually read, and we are not scraping anyone's site or app to get it.
 *
 * The competitor list is a settings field, not a constant. It is a list of
 * *names and public pages to read around*: the crew is explicitly barred from
 * naming a competitor in the output (see HARD_RULES). Reading the market and
 * copying it are different jobs, and only one of them is legal to publish.
 *
 * The result is stored on the post next to the script, so any claim about "what
 * was working that week" can be traced back to the pages it came from.
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { BRAND } from './crew';
import { generateJson } from './gemini';
import type { ContentResearch, SocialSettings } from './types';

/** Kept per day so a second run of the same morning does not pay for it twice. */
const researchRef = (date: string) => db.doc(`socialResearch/${date}`);

const SYSTEM = `You are the researcher for Velocity's content crew, working the Pakistani market.

${BRAND}

You have Google Search. Use it. Look for: what short-form content about transport, commuting, fuel prices, driver income and city life in Pakistan is getting traction in the last two weeks; what the other ride-hailing and delivery apps in Pakistan are publishing and how it is landing; hook and format patterns that keep recurring on Reels and TikTok in this market.

Report what you found, not what you assume. If the search returns little on a point, say so in that field rather than filling it with plausible-sounding filler — an empty list is a usable answer and an invented one is not.

Never suggest copying a competitor's post. Patterns and gaps only.

Reply with one JSON object and nothing else:
{
  "trends": ["4-7 short observations about what is travelling right now, each with the specific thing that made it travel"],
  "competitorMoves": ["3-6 things the other apps are actually doing this month"],
  "opportunities": ["3-6 gaps Velocity can take, each one specific enough to film"],
  "hookPatterns": ["3-6 hook shapes that are working, as patterns not copy"],
  "avoid": ["2-4 things that are done to death or that would land badly here"]
}`;

const list = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map((x) => x.trim().slice(0, len))
    : [];

/**
 * Search the market. Returns a research object even on failure — with `error`
 * set — because a failed search should cost the day's post its extra context,
 * not the day's post.
 */
export async function runResearch(settings: SocialSettings, date: string): Promise<ContentResearch> {
  const empty: ContentResearch = {
    atMs: Date.now(),
    trends: [],
    competitorMoves: [],
    opportunities: [],
    hookPatterns: [],
    avoid: [],
    sources: [],
    error: null,
  };

  if (!settings.researchEnabled) return { ...empty, error: 'Research is switched off in settings.' };

  // One read a day. The market does not move fast enough to pay for a grounded
  // search per post, and every post that day should be working from the same
  // picture anyway.
  const cached = await researchRef(date).get();
  if (cached.exists) return cached.data() as ContentResearch;

  const competitors = settings.competitors.filter((c) => c.name.trim());

  try {
    const { data, sources } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: SYSTEM,
      what: 'The market read',
      grounded: true,
      temperature: 0.7,
      maxOutputTokens: 3000,
      prompt: [
        `Date: ${date}. Market: Pakistan.`,
        competitors.length
          ? `The apps to read around (never to name in our own posts):\n${competitors
              .map((c) => `- ${c.name}${c.url ? ` — ${c.url}` : ''}`)
              .join('\n')}`
          : 'No competitor list was configured — search for the main ride-hailing and delivery apps operating in Pakistan yourself.',
        '',
        'Search first, then answer. Include what you actually found this time, not what was true last year.',
      ].join('\n'),
    });

    const research: ContentResearch = {
      atMs: Date.now(),
      trends: list(data.trends, 8, 300),
      competitorMoves: list(data.competitorMoves, 8, 300),
      opportunities: list(data.opportunities, 8, 300),
      hookPatterns: list(data.hookPatterns, 8, 200),
      avoid: list(data.avoid, 6, 200),
      sources: sources.slice(0, 20).map((s) => ({ title: s.title.slice(0, 200), url: s.url.slice(0, 500) })),
      error: null,
    };

    await researchRef(date).set({ ...research, date });
    return research;
  } catch (e) {
    const message = (e as Error).message;
    logger.warn('social: the market read failed; writing without it', { date, message });
    // Deliberately not cached: a failure should be retried tomorrow, or by the
    // next run today, rather than poisoning the whole day.
    return { ...empty, error: message.slice(0, 400) };
  }
}
