/**
 * The month plan — what the team will post every day this month, and why.
 *
 * A desk that decides each morning what to make has no arc: no theme that runs
 * for a week, no build-up to a payday or a holiday, no idea where the month is
 * going. This is the plan a social lead writes on the 1st — one goal, a few
 * content pillars, a theme per week and a slot for every day — plus the paid
 * campaigns and sales moves that ride with it.
 *
 * It is stored at `socialPlans/{YYYY-MM}` and read by the daily run: a day with
 * planned slots makes exactly those (format and topic), and a day without falls
 * back to the rotation. The plan is made on the first run of a month, or on
 * demand from the calendar.
 *
 * Without a model there is no strategy to think up, so the local version is the
 * rotation laid out over the month — honest about being a rotation.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db } from '../lib/firebase';
import { deskCall, sdb } from './workspace';

import { brandBlock, researchBlock, systemFor } from './crew';
import { activeTeam, assign } from './employees';
import { activeEngine, generateJson, modelReady } from './engine';
import { planningResearch } from './market';
import { getSocialSettings } from './settings';
import { DEFAULT_SETTINGS, FORMATS, type ContentFormat, type ContentResearch, type SocialSettings } from './types';

export interface PlannedSlot {
  format: ContentFormat;
  /** What the piece is about, specific enough to film. */
  topic: string;
  /** The opening line, as an idea for the writer. */
  hook: string;
  pillar: string;
}

export interface MonthPlan {
  month: string;
  atMs: number;
  by: string;
  engine: string;
  goal: string;
  pillars: string[];
  weeks: { theme: string; focus: string }[];
  /** Keyed by `YYYY-MM-DD`. */
  days: Record<string, PlannedSlot[]>;
  /** Paid campaigns worth running this month, one line each. */
  ads: string[];
  /** Who to approach and with what, one line each. */
  sales: string[];
}

export const planRef = (month: string) => sdb.doc(`socialPlans/${month}`);

/** Every date in `YYYY-MM`, in order. */
export function daysOf(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lines = (v: unknown, n: number, max: number) =>
  Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, n) : [];

/**
 * Hold the model's plan to what the desk can actually make: dates inside the
 * month, known formats, no more slots a day than the desk posts, one of each
 * format a day (a post id is date + format), and nothing empty.
 */
export function normalisePlan(
  data: Record<string, unknown>,
  month: string,
  perDay: number,
): Omit<MonthPlan, 'atMs' | 'by' | 'engine'> {
  const rawDays = (data.days && typeof data.days === 'object' ? data.days : {}) as Record<string, unknown>;
  const days: Record<string, PlannedSlot[]> = {};
  for (const date of daysOf(month)) {
    const raw = Array.isArray(rawDays[date]) ? (rawDays[date] as unknown[]) : [];
    const seen = new Set<string>();
    const slots: PlannedSlot[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const s = item as Record<string, unknown>;
      const format = FORMATS.includes(s.format as ContentFormat) ? (s.format as ContentFormat) : null;
      const topic = text(s.topic, 240);
      if (!format || !topic || seen.has(format)) continue;
      seen.add(format);
      slots.push({ format, topic, hook: text(s.hook, 160), pillar: text(s.pillar, 60) });
      if (slots.length >= perDay) break;
    }
    if (slots.length) days[date] = slots;
  }
  const weeks = Array.isArray(data.weeks)
    ? data.weeks
        .map((w) => (w && typeof w === 'object' ? (w as Record<string, unknown>) : {}))
        .map((w) => ({ theme: text(w.theme, 120), focus: text(w.focus, 300) }))
        .filter((w) => w.theme)
        .slice(0, 6)
    : [];
  return {
    month,
    goal: text(data.goal, 300),
    pillars: lines(data.pillars, 6, 80),
    weeks,
    days,
    ads: lines(data.ads, 6, 300),
    sales: lines(data.sales, 6, 300),
  };
}

/** No model: the rotation, laid over the month so the calendar still shows what is coming. */
export function localMonthPlan(month: string, settings: SocialSettings): Omit<MonthPlan, 'atMs' | 'by' | 'engine'> {
  const angles = settings.angles.length ? settings.angles : DEFAULT_SETTINGS.angles;
  const formats = settings.formats.length ? settings.formats : DEFAULT_SETTINGS.formats;
  const perDay = Math.max(1, Math.min(settings.postsPerDay, FORMATS.length));
  const days: Record<string, PlannedSlot[]> = {};
  let n = 0;
  for (const date of daysOf(month)) {
    const slots: PlannedSlot[] = [];
    for (let k = 0; k < perDay * 2 && slots.length < perDay; k++, n++) {
      const format = formats[n % formats.length];
      if (slots.some((s) => s.format === format)) continue;
      const angle = angles[n % angles.length];
      slots.push({ format, topic: angle, hook: '', pillar: angle });
    }
    days[date] = slots;
  }
  return {
    month,
    goal: 'Post every day on the rotation. A model writes a real strategy; without one this is the rotation, laid out.',
    pillars: angles.slice(0, 5),
    weeks: [],
    days,
    ads: [],
    sales: [],
  };
}

const TASK = (month: string, perDay: number) => `Plan the whole of ${month} for this account, the way a social media lead does on the 1st.

- One goal for the month, in one sentence, that the numbers can show.
- 3-5 content pillars: the recurring kinds of story this account tells.
- A theme for each week, and what that week builds towards.
- For EVERY day of the month: ${perDay} piece${perDay === 1 ? '' : 's'}, each with a format (one of: ${FORMATS.join(', ')}), a topic specific enough to film or design today, a hook line, and the pillar it belongs to. No two pieces on one day share a format. Vary the formats across the week; reels carry reach.
- Lean on dates that matter to this audience this month — paydays, holidays, the season — but only ones you are sure of.
- 3-5 paid campaigns worth running this month: objective, who, and the offer, one line each.
- 3-5 sales moves: which kind of customer or business to approach this month, and the opening line, one line each.

Use the market read and the brief. Every number must come from the facts you were given; otherwise write without numbers.

Reply with one JSON object and nothing else:
{
  "goal": "...",
  "pillars": ["..."],
  "weeks": [{ "theme": "...", "focus": "..." }],
  "days": { "${month}-01": [{ "format": "reel", "topic": "...", "hook": "...", "pillar": "..." }] },
  "ads": ["..."],
  "sales": ["..."]
}`;

/** Make the month's plan and store it. Throws only when nobody could make it. */
export async function planMonth(month: string, research: ContentResearch | null = null): Promise<MonthPlan> {
  const settings = await getSocialSettings();
  const perDay = Math.max(1, Math.min(settings.postsPerDay, FORMATS.length));

  let body: Omit<MonthPlan, 'atMs' | 'by' | 'engine'>;
  let by = 'The rotation';
  if (!modelReady()) {
    body = localMonthPlan(month, settings);
  } else {
    const team = await activeTeam();
    const lead = assign(team, 'distribute') ?? assign(team, 'script');
    if (!lead) throw new Error('Nobody on the team can plan the month. Hire a social media manager or a writer.');
    by = lead.employee.name;
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: [systemFor(lead.employee, settings), brandBlock(), TASK(month, perDay)].join('\n\n'),
      what: 'The month plan',
      prompt: [`Month: ${month}. Today: ${new Date().toISOString().slice(0, 10)}.`, researchBlock(research)]
        .filter(Boolean)
        .join('\n\n'),
    });
    body = normalisePlan(data, month, perDay);
    if (!Object.keys(body.days).length) throw new Error('The month plan came back with no days in it.');
  }

  const plan: MonthPlan = { ...body, atMs: Date.now(), by, engine: activeEngine() };
  await planRef(month).set(plan);
  return plan;
}

/** Today's planned pieces, or none — the daily run falls back to the rotation. */
export async function plannedSlots(date: string): Promise<PlannedSlot[]> {
  const plan = (await planRef(date.slice(0, 7)).get()).data() as MonthPlan | undefined;
  return plan?.days?.[date] ?? [];
}

/** The first run of a month makes its plan. Never fatal: a missing plan is the rotation. */
export async function ensureMonthPlan(month: string): Promise<void> {
  if ((await planRef(month).get()).exists) return;
  try {
    await planMonth(month, await planningResearch());
  } catch (e) {
    logger.warn('social: could not plan the month; the rotation carries on', { month, message: (e as Error).message });
  }
}

/**
 * Change one planned day from the calendar — the topic and the opening line —
 * before the team makes it. A piece already made is changed the other way, with
 * a change request on the piece itself.
 */
export const adminEditPlanSlot = deskCall('content', async (req) => {
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/),
      format: z.enum(FORMATS),
      topic: z.string().trim().min(3).max(240),
      hook: z.string().trim().max(160).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what the day should be about.');
  const { date, format, topic, hook } = parsed.data;

  const ref = planRef(date.slice(0, 7));
  await db.runTransaction(async (tx) => {
    const plan = (await tx.get(ref)).data() as MonthPlan | undefined;
    const slots = plan?.days?.[date] ?? [];
    const i = slots.findIndex((s) => s.format === format);
    if (i < 0) throw new HttpsError('not-found', 'That day has no such piece planned. Plan the month first.');
    slots[i] = { ...slots[i], topic, hook: hook ?? slots[i].hook };
    // A merge replaces only this day's list; every other day stays as it was.
    tx.set(ref, { days: { [date]: slots } }, { merge: true });
  });
  return { ok: true };
});

export const adminPlanSocialMonth = deskCall('content', { timeoutSeconds: 300, memory: '1GiB' }, async (req) => {
  const parsed = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Pass the month as YYYY-MM.');
  try {
    const plan = await planMonth(parsed.data.month, await planningResearch());
    return { ok: true, days: Object.keys(plan.days).length };
  } catch (e) {
    throw new HttpsError('internal', (e as Error).message);
  }
});
