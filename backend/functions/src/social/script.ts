/**
 * The writer. Claude drafts one day's post from Velocity's own numbers.
 *
 * The point of feeding it live figures rather than letting it invent them is
 * not tone, it's liability: "drivers earn PKR 730,000" is a claim, and a claim
 * that came out of a language model's imagination is one an advertising
 * regulator, a driver, or a competitor can hold against you. Everything the
 * script asserts traces back to a number in `facts`, and the facts are stored
 * on the post so any published claim can be audited later.
 *
 * Uses the same ANTHROPIC_API_KEY secret as commission-proof verification. With
 * no key the pipeline stops before it spends anything — the same
 * fail-closed rule the rest of the backend follows.
 *
 * Note on the SDK: @anthropic-ai/sdk 0.70.1 predates typed adaptive thinking
 * and structured outputs, so this reads JSON out of the reply the way
 * lib/paymentProofAI.ts does. Bump the SDK if you want output_config instead.
 */
import Anthropic from '@anthropic-ai/sdk';
import { logger } from 'firebase-functions';

import { db } from '../lib/firebase';
import { dayKey } from '../analytics';
import type { PostScript } from './types';

const MODEL = 'claude-opus-5';

/** True when the writer can run at all. */
export function writerConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === 'string' && key.trim() !== '';
}

/** What each angle is actually about, so the model isn't guessing from a slug. */
const ANGLE_BRIEFS: Record<string, string> = {
  'driver-earnings': 'What a driver takes home. Velocity charges commission only on completed rides, and the driver keeps the rest of the fare in cash on the spot.',
  'fleet-owner-maths': 'Owning cars and putting other drivers on them through the Pro fleet portal — how the numbers work for someone with 2–10 vehicles.',
  'rider-savings': 'The rider names their own fare instead of accepting a surge price. Show the difference on a real route.',
  safety: 'Verified CNIC on every driver, live trip sharing, an SOS button, and the option to prefer a female driver.',
  'how-it-works': 'The three taps from opening the app to a driver accepting. Aimed at someone who has never used a ride-hailing app.',
  pooling: 'Splitting a ride with people going the same way, and what that does to the per-seat fare.',
  intercity: 'City-to-city seats — Lahore to Islamabad and similar — versus the bus.',
  couriers: 'Sending a parcel across the city with a rider who is already going that way.',
  'partner-program': 'Earning a share of Velocity’s commission by bringing drivers and riders onto the platform.',
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
    db
      .collection('analyticsDaily')
      .orderBy('date', 'desc')
      .limit(7)
      .get(),
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

const SYSTEM = `You write short-form vertical video posts for Velocity, a ride-hailing app in Pakistan.

Velocity's actual differences, which are the only things worth saying:
- The passenger offers their own fare and drivers bid on it. There is no surge pricing.
- Cash is a first-class payment method, because most of Pakistan pays in cash.
- Riders can pool a ride with people going the same way and split the fare per seat.
- The app also does intercity seats, couriers and freight, not just city rides.
- Every driver's CNIC is verified. Riders can require a female driver.
- Fleet owners can run several cars through a partner portal.

Rules you do not break:
1. Every number you use must come from the FACTS block. Never invent, round up, or
   extrapolate a figure. If a fact is zero or missing, write around it — do not
   imply a scale the platform has not reached.
2. No claim about competitors by name.
3. No guaranteed-income language ("earn X per month"). Describe how earnings
   work, not what someone will make.
4. Urdu/English code-switching is natural for this audience. Use it in the
   voiceover where it sounds right; keep on-screen text short and mostly English.
5. Nine-second to thirty-second video. The hook has to work with the sound off.

Reply with one JSON object and nothing else:
{
  "hook": "first line, under 12 words",
  "beats": ["shot 1 description", "shot 2", "shot 3"],
  "voiceover": "the full script as spoken, 40-75 words",
  "onScreenText": ["3-5 short overlays"],
  "cta": "closing line",
  "rationale": "one sentence: why this angle today",
  "caption": "the post caption, 1-3 sentences, no hashtags",
  "hashtags": ["5-8 tags, no # prefix"]
}`;

export interface DraftedPost {
  script: PostScript;
  caption: string;
  hashtags: string[];
}

/** Ask Claude for today's post. Throws with the model's own error on failure. */
export async function draftPost(params: {
  angle: string;
  facts: Record<string, number | string>;
  brandVoice: string;
  /** Hooks already used this fortnight, so the feed doesn't repeat itself. */
  recentHooks: string[];
}): Promise<DraftedPost> {
  if (!writerConfigured()) {
    throw new Error('ANTHROPIC_API_KEY is not configured, so the daily script cannot be written.');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const brief = ANGLE_BRIEFS[params.angle] ?? params.angle;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `TODAY'S ANGLE: ${params.angle}`,
          brief,
          '',
          `FACTS (the only numbers you may use):\n${JSON.stringify(params.facts, null, 2)}`,
          '',
          params.brandVoice ? `EXTRA DIRECTION FROM THE TEAM:\n${params.brandVoice}` : '',
          params.recentHooks.length
            ? `HOOKS ALREADY USED RECENTLY — write something different:\n- ${params.recentHooks.join('\n- ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });

  const text = message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  const parsed = parseDraft(text);
  if (!parsed) {
    logger.error('social: could not parse the drafted post', { text: text.slice(0, 500) });
    throw new Error('The writer returned something that was not a usable post.');
  }
  return parsed;
}

function parseDraft(text: string): DraftedPost | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const list = (v: unknown, max: number, len: number) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map((x) => x.trim().slice(0, len)) : [];

    const hook = str(raw.hook, 160);
    const voiceover = str(raw.voiceover, 1200);
    if (!hook || !voiceover) return null;

    return {
      script: {
        hook,
        beats: list(raw.beats, 6, 240),
        voiceover,
        onScreenText: list(raw.onScreenText, 6, 60),
        cta: str(raw.cta, 160),
        rationale: str(raw.rationale, 300),
      },
      caption: str(raw.caption, 2000) || hook,
      hashtags: list(raw.hashtags, 10, 40).map((t) => t.replace(/^#/, '')),
    };
  } catch {
    return null;
  }
}

/**
 * The video prompt, assembled from the script. Kept here rather than in the
 * video provider so that swapping vendors doesn't change what gets rendered.
 */
export function videoPrompt(script: PostScript, aspect: string): string {
  return [
    `A ${aspect} short-form advert for Velocity, a ride-hailing app in Pakistan.`,
    'Look: modern Pakistani city streets — Lahore, Karachi, Islamabad — real cars, real drivers, natural daylight.',
    'Brand palette: near-black (#1a1c1c) and bright lime (#ccff00). Clean, confident, no stock-footage cheesiness.',
    '',
    'Shots:',
    ...script.beats.map((b, i) => `${i + 1}. ${b}`),
    '',
    `Spoken voiceover: "${script.voiceover}"`,
    script.onScreenText.length ? `On-screen text overlays: ${script.onScreenText.join(' / ')}` : '',
    `Ends on: ${script.cta}`,
  ]
    .filter(Boolean)
    .join('\n');
}
