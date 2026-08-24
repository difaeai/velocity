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
 * Engine: Gemini, through gemini.ts. The same key as the designer and the
 * renderer, so the whole desk lives or dies on one secret rather than three.
 */
import { db } from '../lib/firebase';
import { dayKey } from '../analytics';
import { feedbackBlock, planBlock, researchBlock, systemFor } from './crew';
import { generateJson } from './claude';
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
    'What a driver takes home. Velocity charges commission only on completed rides, and the driver keeps the rest of the fare in cash on the spot.',
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
    'Earning a share of Velocity’s commission by bringing drivers and riders onto the platform.',
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
    case 'video':
      return `${spec.seconds} seconds, ${spec.aspect}. Write 3–5 shots. Shot one IS the hook — it has to work with the sound off. Somewhere around second five, break the pattern: a cut, a reveal, a number appearing.`;
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
  "hook": "the opening line, under 12 words",
  "hookVariants": ["2-3 other openings for the same concept, in case the first is weak"],
  "frames": [{ "scene": "what is in the picture", "overlay": "the words burned onto it, 6 words max" }],
  "voiceover": "the full spoken script, 40-75 words. Empty string for still formats.",
  "cta": "the closing line",
  "rationale": "one sentence: why this angle today",
  "viralHook": "one sentence: the specific reason someone stops scrolling and sends this to a friend",
  "caption": "the post caption, 1-3 sentences, no hashtags",
  "hashtags": ["5-8 tags, no # prefix, mixed local and general"]
}`;

export interface DraftedPost {
  script: PostScript;
  caption: string;
  hashtags: string[];
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
  const spec = FORMAT_SPECS[params.format];
  const brief = ANGLE_BRIEFS[params.angle] ?? params.angle;

  const { data } = await generateJson<Record<string, unknown>>({
    model: params.settings.textModel,
    system: `${systemFor(params.employee, params.settings)}\n\n${RESPONSE_SHAPE}`,
    what: "Today's script",
    prompt: [
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
      .join('\n'),
  });

  return parseDraft(data, params.format);
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

function parseDraft(raw: Record<string, unknown>, format: ContentFormat): DraftedPost {
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
  return {
    script: {
      hook,
      hookVariants: list(raw.hookVariants, 4, 160).filter((h) => h !== hook),
      frames,
      voiceover: spec.kind === 'video' ? str(raw.voiceover, 1200) : '',
      cta: str(raw.cta, 160),
      rationale: str(raw.rationale, 300),
      viralHook: str(raw.viralHook, 300),
    },
    caption,
    hashtags: list(raw.hashtags, 10, 40).map((t) => t.replace(/^#/, '')),
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
}): Promise<{ caption: string; hashtags: string[] }> {
  const { data } = await generateJson<{ caption?: unknown; hashtags?: unknown }>({
    model: params.settings.textModel,
    system: `${systemFor(params.employee, params.settings)}\n\nReply with one JSON object and nothing else:\n{ "caption": "the rewritten caption, no hashtags", "hashtags": ["5-8 tags, no # prefix"] }`,
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
  return { caption, hashtags };
}
