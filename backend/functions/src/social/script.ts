/**
 * The writing stage — whoever holds the content-writer job runs it.
 *
 * They write one piece from the concept the team agreed at standup, in whatever
 * format the rotation landed on: shots for a reel, slides for a carousel, one
 * frame for a post or a story.
 *
 * The point of feeding them live figures rather than letting them invent them
 * is not tone, it is liability: "drivers earn PKR 730,000" is a claim, and a
 * claim that came out of a language model's imagination is one an advertising
 * regulator, a driver, or a competitor can hold against you. Everything the
 * script asserts traces back to a number in `facts`, and the facts are stored
 * on the post so any published claim can be audited later.
 *
 * Engine: Claude, through claude.ts — the same key the whole desk runs on, and
 * since the renderer was removed, the only one it needs.
 */
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { dayKey } from '../analytics';
import { feedbackBlock, planBlock, researchBlock, systemFor } from './crew';
import { generateJson, modelReady } from './engine';
import { localDraft, localRewriteCaption } from './local';
import { reviewDraft, type QualityReport } from './lint';
import {
  FORMAT_SPECS,
  type ContentFormat,
  type ContentPlan,
  type ContentResearch,
  type Employee,
  type Frame,
  type PostScript,
  type SeoPack,
  type SocialSettings,
} from './types';

/** What each angle is actually about, so the model isn't guessing from a slug. */
const ANGLE_BRIEFS: Record<string, string> = {
  'driver-earnings':
    'What a driver takes home. Velocity Rides charges commission only on completed rides, and the driver keeps the rest of the fare in cash on the spot.',
  'fleet-owner-maths':
    'Owning cars and putting other drivers on them through the Pro fleet portal — how the numbers work for someone with 2–10 vehicles.',
  'rider-savings':
    'The rider names their own fare instead of accepting a surge price. Show the difference on a real route.',
  safety:
    'Verified CNIC on every driver, live trip sharing, an SOS button, and the option to prefer a female driver.',
  'how-it-works':
    'The three taps from opening the app to a driver accepting. Aimed at someone who has never used a ride-hailing app.',
  pooling: 'Splitting a ride with people going the same way, and what that does to the per-seat fare.',
  intercity: 'City-to-city seats — Lahore to Islamabad and similar — versus the bus.',
  couriers: 'Sending a parcel across the city with a rider who is already going that way.',
  'partner-program':
    'Earning a share of Velocity Rides’ commission by bringing drivers and riders onto the platform.',
  'city-spotlight': 'One city, its routes and its drivers. Local and specific.',
};

/**
 * The numbers the writer is allowed to use. Read live so the post is about
 * this week rather than about launch day.
 */
export async function gatherFacts(): Promise<Record<string, number | string>> {
  const [counters, commission, driversApproved, tripsLast7] = await Promise.all([
    db.doc('system/counters').get(),
    db.doc('config/commissionSettings').get(),
    db.collection('drivers').where('verificationStatus', '==', 'approved').count().get(),
    db.collection('analyticsDaily').orderBy('date', 'desc').limit(7).get(),
  ]);

  const recent = tripsLast7.docs.map((d) => d.data() as { tripsCompleted?: number; revenue?: number });
  const weekTrips = recent.reduce((n, d) => n + (d.tripsCompleted ?? 0), 0);
  const weekRevenue = recent.reduce((n, d) => n + (d.revenue ?? 0), 0);
  const rate = (commission.get('rate') as number | undefined) ?? 0.1;

  return {
    date: dayKey(Date.now()),
    totalTripsCompleted: (counters.get('totalTrips') as number | undefined) ?? 0,
    totalDriverPayoutPKR: (counters.get('totalDriverPayout') as number | undefined) ?? 0,
    approvedDrivers: driversApproved.data().count,
    tripsLast7Days: weekTrips,
    grossFaresLast7DaysPKR: weekRevenue,
    commissionRatePercent: Math.round(rate * 100),
    averageFarePKR: weekTrips > 0 ? Math.round(weekRevenue / weekTrips) : 0,
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.velocityridzpk.app',
    website: 'https://velocityrides.app',
  };
}

/** What "frames" means changes with the format, and the prompt has to say so. */
function frameBrief(format: ContentFormat): string {
  const spec = FORMAT_SPECS[format];
  switch (format) {
    case 'reel':
    case 'video': {
      // Speech runs at about 2.75 words a second, so the seconds are a word
      // budget. Saying it in words is what stops a 90-word script arriving for
      // a 20-second cut, which is the commonest way a piece comes back wrong.
      const budget = Math.floor((spec.seconds ?? 20) * 2.75);
      return `${spec.seconds} seconds, ${spec.aspect}. That is about ${budget} spoken words IN TOTAL, hook included — write to it, not past it. Write 3–5 shots. Shot one IS the hook and has to work with the sound off. No single line runs longer than four seconds (about 11 words) without something changing on screen. Somewhere around second five, break the pattern: a cut, a reveal, a number appearing. Close by looping back to a word from the hook.`;
    }
    case 'carousel':
      return `${spec.slides} slides, ${spec.aspect}. Slide one is the hook and nothing else. Middle slides carry exactly one idea each. The last slide asks for the tap.`;
    case 'post':
      return `One image, ${spec.aspect}. The overlay is the whole message — six words at most. The scene has to make someone stop scrolling before they read it.`;
    case 'story':
      return `One vertical frame, ${spec.aspect}. Read in under two seconds, thumb already moving. One line, one image, one instruction.`;
  }
}

const RESPONSE_SHAPE = `Reply with one JSON object and nothing else:
{
  "hook": "the opening line, 5-12 words, payload in the first three",
  "hookFormula": "the number and name of the formula you used, e.g. '3 Nobody Tells You'",
  "hookVariants": ["2-3 other openings for the same concept, from DIFFERENT formulas, in case the first is weak"],
  "frames": [{ "scene": "what is in the picture", "overlay": "the words burned onto it, 6 words max" }],
  "voiceover": "the full spoken script. Empty string for still formats.",
  "cta": "the closing line",
  "rationale": "one sentence: why this angle today",
  "viralHook": "one sentence: the specific reason someone sends this to one friend, or saves it",
  "caption": "the post caption, no hashtags. Line one carries the whole hook inside 125 characters, because the feed cuts there",
  "hashtags": ["exactly 5 tags, no # prefix: 2 niche, 2 mid, 1 broad"]
}`;

export interface DraftedPost {
  script: PostScript;
  caption: string;
  hashtags: string[];
  /** What the deterministic checks made of it, after any rewrite. */
  quality: QualityReport;
  /**
   * How the piece was arrived at, when that is worth recording. The local
   * engine fills it with which opening it chose and out of how many, because
   * with no model in the loop that is the only trace of the decision. The
   * model path leaves it unset: its reasoning is not ours to summarise.
   */
  note?: string;
}

/** Write the piece. Throws with the model's own error on failure. */
export async function draftPost(params: {
  employee: Employee;
  settings: SocialSettings;
  format: ContentFormat;
  angle: string;
  plan: ContentPlan | null;
  facts: Record<string, number | string>;
  research: ContentResearch | null;
  /** The SEO expert's brief, when they have already been round. */
  seo: SeoPack | null;
  /** Hooks already used this fortnight, so the feed doesn't repeat itself. */
  recentHooks: string[];
  /** Change requests from the admin, oldest first. */
  feedback: string[];
}): Promise<DraftedPost> {
  // The local engine writes from the brand material and the facts, scoring its
  // own candidates against `lint.ts`. It cannot read `feedback` — a change
  // request is prose, and prose is the one input it has no way to act on — so
  // the caller says so rather than appearing to have applied it.
  if (!modelReady()) {
    return localDraft({
      angle: params.angle,
      format: params.format,
      facts: params.facts,
      recentHooks: params.recentHooks,
      seo: params.seo,
    });
  }

  const spec = FORMAT_SPECS[params.format];
  const brief = ANGLE_BRIEFS[params.angle] ?? params.angle;
  const system = `${systemFor(params.employee, params.settings, params.format)}\n\n${RESPONSE_SHAPE}`;

  const prompt = [
    `FORMAT: ${spec.label}. ${frameBrief(params.format)}`,
    `TODAY'S ANGLE: ${params.angle} — ${brief}`,
    '',
    planBlock(params.plan, params.employee),
    '',
    `FACTS (the only numbers you may use):\n${JSON.stringify(params.facts, null, 2)}`,
    '',
    researchBlock(params.research),
    params.seo ? seoBrief(params.seo) : '',
    params.recentHooks.length
      ? `HOOKS ALREADY USED RECENTLY — write something different:\n- ${params.recentHooks.join('\n- ')}`
      : '',
    feedbackBlock(params.feedback),
  ]
    .filter(Boolean)
    .join('\n');

  const { data } = await generateJson<Record<string, unknown>>({
    model: params.settings.textModel,
    system,
    what: "Today's script",
    prompt,
  });

  const draft = parseDraft(data, params.format, params.seo);
  return reviseIfNeeded({ draft, system, prompt, params });
}

/**
 * The second pass, and only when it is earned.
 *
 * `lint.ts` scores every draft for nothing, so the expensive half of quality
 * control is already done by the time this runs. If the checks found a
 * dealbreaker — a hook that opens on a greeting, six hashtags where the cap is
 * five, ninety words of script for a twenty-second cut — it is worth one more
 * call to fix it. If they did not, it is not.
 *
 * Exactly one retry, never a loop: an unattended run that can call itself
 * until it is happy is an unattended run that can spend a month's budget
 * overnight. A piece that still fails after one rewrite goes to the queue with
 * its scorecard attached, which is a decision for a person.
 */
async function reviseIfNeeded(args: {
  draft: DraftedPost;
  system: string;
  prompt: string;
  params: { settings: SocialSettings; format: ContentFormat; seo: SeoPack | null };
}): Promise<DraftedPost> {
  const { draft, params } = args;
  if (draft.quality.verdict !== 'FIX') return draft;

  logger.info('social: the checks sent the draft back once', {
    format: params.format,
    score: Math.round(draft.quality.score),
    notes: draft.quality.notes,
  });

  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: params.settings.textModel,
      system: args.system,
      what: 'The revised script',
      prompt: [
        args.prompt,
        '',
        'YOU ALREADY WROTE THIS, AND IT DID NOT PASS THE CHECKS:',
        JSON.stringify(
          { hook: draft.script.hook, caption: draft.caption, hashtags: draft.hashtags },
          null,
          2,
        ),
        '',
        'EVERY POINT BELOW HAS TO BE FIXED IN THIS VERSION:',
        ...draft.quality.notes.map((n, i) => `${i + 1}. ${n}`),
        '',
        'Keep the concept. Change only what the points above name. Reply with the same JSON object.',
      ].join('\n'),
    });

    const revised = parseDraft(data, params.format, params.seo);
    // Only keep the rewrite if it actually scored better. A second pass that
    // trades a weak hook for a weaker one is worse than the first.
    return revised.quality.score > draft.quality.score ? revised : draft;
  } catch (e) {
    // A failed rewrite is not a failed run: the first draft is readable, and
    // its scorecard tells the admin exactly what the checks did not like.
    logger.warn('social: the rewrite failed; keeping the first draft', { message: (e as Error).message });
    return draft;
  }
}

/** The SEO expert's words, handed to whoever is writing. */
export function seoBrief(seo: SeoPack): string {
  return [
    'FROM THE SEO DESK — work these in where they sound natural, never at the cost of the sentence:',
    seo.searchIntent ? `The query this should answer: ${seo.searchIntent}` : '',
    seo.keywords.length ? `Phrases to use: ${seo.keywords.join(', ')}` : '',
    seo.hashtags.length ? `Hashtags to close on: ${seo.hashtags.map((h) => `#${h}`).join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function parseDraft(
  raw: Record<string, unknown>,
  format: ContentFormat,
  seo: SeoPack | null,
): DraftedPost {
  const spec = FORMAT_SPECS[format];
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = (v: unknown, max: number, len: number) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map((x) => x.trim().slice(0, len))
      : [];

  const hook = str(raw.hook, 160);
  if (!hook) throw new Error('The writer returned a piece with no hook.');

  const frames: Frame[] = Array.isArray(raw.frames)
    ? (raw.frames as unknown[])
        .map((f) => {
          const obj = (f ?? {}) as Record<string, unknown>;
          return { scene: str(obj.scene, 300), overlay: str(obj.overlay, 80) };
        })
        .filter((f) => f.scene || f.overlay)
        .slice(0, Math.max(spec.slides, 6))
    : [];

  // A still format with no frame has nothing for the designer to draw, so the
  // hook becomes the frame rather than the run failing on a formatting slip.
  if (!frames.length) frames.push({ scene: hook, overlay: hook.slice(0, 60) });

  const caption = str(raw.caption, 2000) || hook;
  const hashtags = list(raw.hashtags, 10, 40).map((t) => t.replace(/^#/, ''));
  const voiceover = spec.kind === 'video' ? str(raw.voiceover, 1200) : '';

  const script: PostScript = {
    hook,
    hookVariants: list(raw.hookVariants, 4, 160).filter((h) => h !== hook),
    frames,
    voiceover,
    cta: str(raw.cta, 160),
    rationale: str(raw.rationale, 300),
    viralHook: str(raw.viralHook, 300),
  };

  return {
    script,
    caption,
    hashtags,
    // Scored against the tags that will actually be posted: the SEO desk's win
    // where they exist, which is the same rule the pipeline applies.
    quality: reviewDraft({
      hook,
      caption,
      hashtags: seo?.hashtags.length ? seo.hashtags : hashtags,
      voiceover,
      seconds: spec.seconds,
      keywords: seo?.keywords ?? [],
    }),
  };
}

/** Rewrite only the caption — the common change request, and the cheapest. */
export async function rewriteCaption(params: {
  employee: Employee;
  settings: SocialSettings;
  script: PostScript;
  currentCaption: string;
  hashtags: string[];
  feedback: string[];
}): Promise<{ caption: string; hashtags: string[]; quality: QualityReport }> {
  // Without a model the request itself cannot be read, so nothing pretends to
  // have read it: the existing sentences are kept, cleaned and reordered for
  // the best score the critic will give them. See `localRewriteCaption`.
  if (!modelReady()) {
    return localRewriteCaption({
      script: params.script,
      currentCaption: params.currentCaption,
      hashtags: params.hashtags,
    });
  }

  const { data } = await generateJson<{ caption?: unknown; hashtags?: unknown }>({
    model: params.settings.textModel,
    system: `${systemFor(params.employee, params.settings)}\n\nReply with one JSON object and nothing else:\n{ "caption": "the rewritten caption, no hashtags. Line one carries the hook inside 125 characters", "hashtags": ["exactly 5 tags, no # prefix: 2 niche, 2 mid, 1 broad"] }`,
    what: 'The rewritten caption',
    prompt: [
      `The piece is already made. Its hook is: ${params.script.hook}`,
      params.script.cta ? `It closes on: ${params.script.cta}` : '',
      '',
      `CURRENT CAPTION:\n${params.currentCaption}`,
      '',
      feedbackBlock(params.feedback),
      'Rewrite the caption only. Do not change what the piece is about.',
    ]
      .filter(Boolean)
      .join('\n'),
  });

  const caption = typeof data.caption === 'string' ? data.caption.trim().slice(0, 2000) : params.currentCaption;
  const hashtags = Array.isArray(data.hashtags)
    ? (data.hashtags as unknown[])
        .filter((x): x is string => typeof x === 'string')
        .slice(0, 10)
        .map((t) => t.trim().replace(/^#/, '').slice(0, 40))
    : params.hashtags;

  // A caption rewrite is the cheapest change request there is, and it is also
  // the one most likely to reintroduce six hashtags or a first line that gets
  // cut mid-clause. The checks cost nothing, so they run here too.
  return {
    caption,
    hashtags,
    quality: reviewDraft({ hook: params.script.hook, caption, hashtags }),
  };
}
