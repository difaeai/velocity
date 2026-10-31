/**
 * Reading our own page — the half of a social team's job that is not writing.
 *
 * Everything else on this desk decides what to make. This decides what to make
 * *next*, from what already happened: which of our own posts travelled, how far
 * past our own normal they went, which hook shape each of them used, and what
 * the profile they all land on actually looks like to a stranger.
 *
 * Two rules it is built on, both of them the point rather than details:
 *
 * 1. **Raw numbers are not evidence.** A post with 400,000 views means one
 *    thing on an account that usually does 5,000 and something else entirely
 *    on one that usually does 2,000,000. Everything here is ranked by the
 *    multiple over *our own* median, which is the only baseline that says
 *    anything about the post rather than about the account.
 * 2. **Sends and saves before likes.** That is the order Instagram itself
 *    weights them in, and it is also the order that predicts whether a shape
 *    is worth repeating. A like costs nothing and means nothing; forwarding
 *    something to one friend is the strongest signal on the platform.
 *
 * What comes out goes straight back into the standup, so the team argues this
 * morning's concept in front of what its own audience did last week instead of
 * in front of nothing. That loop — make, measure, feed it back — is the whole
 * difference between a team and a content generator.
 *
 * The reads are free: Instagram's insights cost nothing through the Graph API.
 * One model call a day summarises them, and one a month scores the profile.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { FieldValue } from '../lib/firebase';
import { deskCall, forEachWorkspace, sdb } from './workspace';

import { dayKey } from '../analytics';
import { connectedPlatforms, loadCredentials } from './accounts';
import { generateJson, modelReady } from './engine';
import { localLessons } from './local';
import { brandBlock, briefBlock, hardRules, standingInstructions } from './crew';
import { activeTeam, assign } from './employees';
import { scoreHook } from './lint';
import { ADAPTERS, type PostPerformance, type ProfileDetail } from './platforms';
import { PROFILE_RUBRIC } from './playbook';
import { getSocialSettings } from './settings';
import type { Employee, SocialSettings } from './types';

/** Same region as the rest of the desk; a cross-region read would be slower for nothing. */
const REGION = 'asia-south1';

const INSIGHTS_PATH = 'socialInsights/latest';
const AUDIT_PATH = 'socialInsights/profile';

/** Enough history to have a median worth dividing by, without paging forever. */
const SAMPLE = 40;

// ── ranking ─────────────────────────────────────────────────────────────────

export interface RankedPost {
  mediaId: string;
  permalink: string | null;
  mediaType: string;
  postedAtMs: number;
  /** The first line of the caption, which is the hook as the feed showed it. */
  hook: string;
  reach: number;
  saves: number;
  sends: number;
  comments: number;
  /** How far past our own normal this went. 1.0 is an ordinary day. */
  multiple: number;
  /** Sends per thousand reached — the number that actually predicts reach. */
  sendRate: number;
  saveRate: number;
  /** What the hook panel makes of the opening line, for the pattern. */
  hookScore: number;
}

export interface PageRead {
  atMs: number;
  date: string;
  /** How many posts the numbers came from. */
  sampled: number;
  medianReach: number;
  /** Our own posts, best first. */
  best: RankedPost[];
  /** And the ones that did not travel, which are the more useful half. */
  worst: RankedPost[];
  /** What the team should take from it. One model call, in plain words. */
  lessons: string[];
  /** Hook shapes to use more of, and to stop using. */
  useMore: string[];
  useLess: string[];
  error: string | null;
}

/** The median, which is the only honest baseline for an account's own posts. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rank our own posts against our own normal.
 *
 * Pure, so the arithmetic that decides what the team is told is testable
 * without a network anywhere near it.
 */
export function rank(posts: PostPerformance[]): {
  ranked: RankedPost[];
  medianReach: number;
} {
  // Posts with no reach at all are ones the insights window has aged out, not
  // ones that failed. Counting them would halve the median and make every
  // recent post look like a triumph.
  const measured = posts.filter((p) => p.reach > 0);
  const baseline = median(measured.map((p) => p.reach)) || 1;

  const ranked = measured
    .map((post): RankedPost => {
      const hook = (post.caption.split('\n')[0] ?? '').trim().slice(0, 160);
      return {
        mediaId: post.mediaId,
        permalink: post.permalink,
        mediaType: post.mediaType,
        postedAtMs: post.postedAtMs,
        hook,
        reach: post.reach,
        saves: post.saves,
        sends: post.sends,
        comments: post.comments,
        multiple: Math.round((post.reach / baseline) * 100) / 100,
        sendRate: Math.round((post.sends / post.reach) * 10000) / 10,
        saveRate: Math.round((post.saves / post.reach) * 10000) / 10,
        hookScore: hook ? Math.round(scoreHook(hook).score) : 0,
      };
    })
    .sort((a, b) => b.multiple - a.multiple);

  return { ranked, medianReach: baseline };
}

// ── the daily read ──────────────────────────────────────────────────────────

const LESSON_SYSTEM = `You are reading this account's own numbers and telling the team what to do differently.

You are not writing a report. Nobody wants a report. You are answering one question: given what our own audience did, what should the next five posts be more of, and less of?

Rules:
- Compare like with like. A post that beat our median by 4x is interesting; one that got more raw views than another because it is older is not.
- Sends and saves outrank likes and even reach. A post with half the reach and triple the sends found something.
- Name the shape, not the post. "The ones that open on a number travelled; the ones that open on a feeling did not" is useful. "Post 3 did well" is not.
- If the sample is too small or too flat to say anything, say that instead of inventing a pattern. A made-up lesson is worse than none, because the team will follow it.

Reply with one JSON object and nothing else:
{
  "lessons": ["2-4 sentences, each a thing we now know that we did not"],
  "useMore": ["2-4 hook shapes or subjects to do more of"],
  "useLess": ["1-3 to stop doing"]
}`;

/**
 * Read the page, rank it, and ask what it means. `interpret: false` keeps the
 * reading to arithmetic (`localLessons`): between batches nothing is being
 * written, so a model call a day to interpret it would only be read by nobody.
 */
export async function readOwnPage(settings: SocialSettings, opts: { interpret?: boolean } = {}): Promise<PageRead> {
  const date = dayKey(Date.now());
  const empty = (error: string | null): PageRead => ({
    atMs: Date.now(),
    date,
    sampled: 0,
    medianReach: 0,
    best: [],
    worst: [],
    lessons: [],
    useMore: [],
    useLess: [],
    error,
  });

  const connected = await connectedPlatforms();
  const platforms = connected.filter((p) => ADAPTERS[p].recentPosts);
  if (!platforms.length) return empty('No connected account can report its own numbers yet.');

  const posts: PostPerformance[] = [];
  for (const platform of platforms) {
    try {
      const credentials = await loadCredentials(platform);
      if (!credentials) continue;
      posts.push(...(await ADAPTERS[platform].recentPosts!(credentials, SAMPLE)));
    } catch (e) {
      logger.warn('social: could not read our own numbers', { platform, error: (e as Error).message });
    }
  }

  if (posts.length < 3) {
    return empty(
      posts.length
        ? 'Too few posts to have a normal to compare against yet. Post a few more.'
        : 'Nothing published yet, so there is nothing to learn from.',
    );
  }

  const { ranked, medianReach } = rank(posts);
  const best = ranked.slice(0, 8);
  const worst = ranked.slice(-5).reverse();

  const read: PageRead = {
    ...empty(null),
    sampled: ranked.length,
    medianReach,
    best,
    worst,
  };

  // No key: the lesson is computed instead of described. For this one question
  // that is an upgrade — "which format travels" is a mean over a group, and
  // "is the hook panel tracking reach" is two means compared, both of which
  // arithmetic answers exactly and a model was being asked to eyeball.
  if (!modelReady() || opts.interpret === false) {
    const read_ = localLessons({ best, worst, medianReach, sampled: ranked.length });
    read.lessons = read_.lessons;
    read.useMore = read_.useMore;
    read.useLess = read_.useLess;
    return read;
  }

  // Whoever reads the market also reads our own page: it is the same job, and
  // it keeps the lesson in one person's voice rather than a system's.
  const team = await activeTeam();
  const reader = assign(team, 'research')?.employee ?? null;

  try {
    const { data } = await generateJson<{ lessons?: unknown; useMore?: unknown; useLess?: unknown }>({
      model: settings.textModel,
      system: [
        reader ? `You are ${reader.name}, ${reader.title}.` : '',
        brandBlock(),
        briefBlock(settings, 'research-assistant'),
        hardRules(),
        LESSON_SYSTEM,
        standingInstructions(settings),
      ]
        .filter(Boolean)
        .join('\n\n'),
      what: 'What our own numbers mean',
      prompt: [
        `Our median reach across the last ${ranked.length} posts is ${medianReach}.`,
        '',
        'OUR BEST, by multiple over that median:',
        ...best.map(
          (p) =>
            `- ${p.multiple}x · ${p.mediaType} · reach ${p.reach}, ${p.sends} sends (${p.sendRate}/1k), ` +
            `${p.saves} saves (${p.saveRate}/1k), ${p.comments} comments · hook scored ${p.hookScore}/100 · "${p.hook}"`,
        ),
        '',
        'OUR WORST:',
        ...worst.map(
          (p) =>
            `- ${p.multiple}x · ${p.mediaType} · reach ${p.reach}, ${p.sends} sends, ${p.saves} saves · ` +
            `hook scored ${p.hookScore}/100 · "${p.hook}"`,
        ),
      ].join('\n'),
    });

    const list = (v: unknown, max: number) =>
      Array.isArray(v)
        ? (v as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .slice(0, max)
            .map((s) => s.trim().slice(0, 300))
            .filter(Boolean)
        : [];

    read.lessons = list(data.lessons, 4);
    read.useMore = list(data.useMore, 4);
    read.useLess = list(data.useLess, 3);
  } catch (e) {
    logger.warn('social: could not interpret our own numbers', { error: (e as Error).message });
  }

  return read;
}

/** The last read, for the standup and the console. */
export async function latestPageRead(): Promise<PageRead | null> {
  const snap = await sdb.doc(INSIGHTS_PATH).get();
  return snap.exists ? (snap.data() as PageRead) : null;
}

/**
 * What our own page taught us, rendered for the standup prompt.
 *
 * This outranks the market read in the prompt order for a reason: what a
 * stranger's account did is a hint, and what ours did is evidence.
 */
export function pageReadBlock(read: PageRead | null): string {
  if (!read || read.error || !read.sampled) return '';
  const lines = [
    `OUR OWN PAGE, from the last ${read.sampled} posts (median reach ${read.medianReach}). This is evidence about our audience, and it outranks anything found elsewhere:`,
    read.lessons.length ? read.lessons.map((l) => `- ${l}`).join('\n') : '',
    read.useMore.length ? `Do more of: ${read.useMore.join(' | ')}` : '',
    read.useLess.length ? `Stop doing: ${read.useLess.join(' | ')}` : '',
    read.best.length
      ? `Our best recent openings: ${read.best
          .slice(0, 4)
          .map((p) => `"${p.hook}" (${p.multiple}x)`)
          .join(' · ')}`
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}

// ── the profile audit ───────────────────────────────────────────────────────

export interface ProfileAudit {
  atMs: number;
  score: number;
  profile: ProfileDetail | null;
  /** Item by item, worst first — the order to fix them in. */
  items: { id: string; label: string; scored: number; outOf: number; why: string; fix: string }[];
  /** The rewrites, ready to paste. */
  rewrites: { field: string; now: string; better: string }[];
  error: string | null;
}

const AUDIT_SYSTEM = `You are auditing this Instagram profile against a fixed rubric, and then rewriting what lost points.

${PROFILE_RUBRIC}

How to score:
- Score honestly. Most first-pass profiles land in the 30s and 40s, and a generous score helps nobody.
- Order the items worst first, because that is the order they should be fixed in.
- For every item that lost points, write the rewrite rather than describing it. "The bio should be clearer" is useless; the new bio is not.
- Rewrites must fit the real limits: the name field is 30 characters, the bio is 150.
- Never invent a number, a follower count or a result. If a rewrite needs a figure nobody gave you, leave {{the number}} in it.

Reply with one JSON object and nothing else:
{
  "score": 0-100,
  "items": [{ "id": "name_field", "label": "Name field", "scored": 4, "outOf": 12, "why": "what is wrong, one line", "fix": "what to do, one line" }],
  "rewrites": [{ "field": "Name field", "now": "what is there", "better": "what it should say" }]
}`;

/** Score the profile and rewrite what lost points. */
export async function auditProfile(settings: SocialSettings): Promise<ProfileAudit> {
  const empty = (error: string | null): ProfileAudit => ({
    atMs: Date.now(),
    score: 0,
    profile: null,
    items: [],
    rewrites: [],
    error,
  });

  const connected = await connectedPlatforms();
  const platform = connected.find((p) => ADAPTERS[p].profileDetail);
  if (!platform) return empty('No connected account can report its profile yet.');
  // The one stage with no local equivalent: a profile audit is a judgement
  // about twelve things a page either does or does not do, and unlike the
  // writing stages there is no candidate set to score. It waits for a key.
  if (!modelReady()) return empty('The profile audit needs a model, and no model key is configured.');

  let profile: ProfileDetail;
  try {
    const credentials = await loadCredentials(platform);
    if (!credentials) return empty('That account is connected but its credential could not be read.');
    profile = await ADAPTERS[platform].profileDetail!(credentials);
  } catch (e) {
    return empty(`Could not read the profile: ${(e as Error).message}`);
  }

  const team = await activeTeam();
  const auditor: Employee | null = assign(team, 'seo')?.employee ?? assign(team, 'script')?.employee ?? null;

  try {
    const { data } = await generateJson<{ score?: unknown; items?: unknown; rewrites?: unknown }>({
      model: settings.textModel,
      system: [
        auditor ? `You are ${auditor.name}, ${auditor.title}.` : '',
        brandBlock(),
        briefBlock(settings, auditor?.role ?? null),
        hardRules(),
        AUDIT_SYSTEM,
        standingInstructions(settings),
      ]
        .filter(Boolean)
        .join('\n\n'),
      what: 'The profile audit',
      prompt: [
        'THE PROFILE AS IT IS RIGHT NOW:',
        `Handle: ${profile.username ?? 'unknown'}`,
        `Name field (the bold line): ${profile.displayName ?? '(empty)'}`,
        `Bio: ${profile.biography ?? '(empty)'}`,
        `Link: ${profile.website ?? '(none)'}`,
        `Followers: ${profile.followers ?? 'unknown'} · Posts: ${profile.posts ?? 'unknown'}`,
        `Profile photo set: ${profile.avatarUrl ? 'yes' : 'no'}`,
        `Posts visible in the first nine: ${profile.recentThumbnails.length}`,
        '',
        'You cannot see the images, so score the grid and the photo on what is knowable — whether they exist, how many there are, and whether the account looks active — and say plainly that the visual judgement needs a human eye.',
      ].join('\n'),
    });

    const num = (v: unknown, max: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0;

    const items = Array.isArray(data.items)
      ? (data.items as Record<string, unknown>[]).slice(0, 14).map((i) => ({
          id: String(i.id ?? '').slice(0, 40),
          label: String(i.label ?? '').slice(0, 60),
          scored: num(i.scored, 100),
          outOf: num(i.outOf, 100) || 1,
          why: String(i.why ?? '').slice(0, 300),
          fix: String(i.fix ?? '').slice(0, 300),
        }))
      : [];

    const rewrites = Array.isArray(data.rewrites)
      ? (data.rewrites as Record<string, unknown>[]).slice(0, 8).map((r) => ({
          field: String(r.field ?? '').slice(0, 60),
          now: String(r.now ?? '').slice(0, 400),
          better: String(r.better ?? '').slice(0, 400),
        }))
      : [];

    return {
      atMs: Date.now(),
      score: num(data.score, 100),
      profile,
      items: items.sort((a, b) => a.scored / a.outOf - b.scored / b.outOf),
      rewrites,
      error: null,
    };
  } catch (e) {
    return { ...empty((e as Error).message), profile };
  }
}

// ── the jobs ────────────────────────────────────────────────────────────────

/**
 * Read our own page every morning, an hour before the team starts.
 *
 * Before rather than after, because the whole value is that the standup sees
 * it. A read that lands at noon is a read nobody used.
 */
export const socialPageRead = onSchedule(
  { schedule: '0 * * * *', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: 540, memory: '1GiB' },
  () =>
    forEachWorkspace('content', async () => {
      const settings = await getSocialSettings();
      if (!settings.enabled || !settings.learnFromOwnPage) return;

      const nowPkt = new Date(Date.now() + 5 * 3600_000);
      const hour = (settings.runHour + 23) % 24;
      if (nowPkt.getUTCHours() !== hour) return;

      // The model reads it only while a batch is being written — the only time anything reads the lesson.
      const read = await readOwnPage(settings, { interpret: Boolean(settings.batchUntil) });
      await sdb.doc(INSIGHTS_PATH).set(read);
      logger.info('social: read our own page', {
        sampled: read.sampled,
        median: read.medianReach,
        error: read.error,
      });
    }),
);

/** Score the profile once a week. It changes slowly; a daily call would be waste. */
export const socialProfileAudit = onSchedule(
  { schedule: '0 9 * * 1', timeZone: 'Asia/Karachi', region: REGION, timeoutSeconds: 540, memory: '1GiB' },
  () =>
    forEachWorkspace('content', async () => {
      const settings = await getSocialSettings();
      if (!settings.enabled || !settings.learnFromOwnPage) return;
      const audit = await auditProfile(settings);
      await sdb.doc(AUDIT_PATH).set(audit);
      logger.info('social: scored the profile', { score: audit.score, error: audit.error });
    }),
);

// ── on demand ───────────────────────────────────────────────────────────────

export const adminReadOwnPage = deskCall('content', { timeoutSeconds: 540, memory: '1GiB' }, async () => {
  const read = await readOwnPage(await getSocialSettings());
  await sdb.doc(INSIGHTS_PATH).set(read);
  return read;
});

export const adminAuditProfile = deskCall('content', { timeoutSeconds: 540, memory: '1GiB' }, async () => {
  const audit = await auditProfile(await getSocialSettings());
  await sdb.doc(AUDIT_PATH).set({ ...audit, updatedAt: FieldValue.serverTimestamp() });
  return audit;
});
