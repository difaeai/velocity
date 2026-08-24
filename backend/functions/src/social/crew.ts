/**
 * The room — what everybody on the team knows, and the standup they hold before
 * any of them starts working.
 *
 * The shared half matters more than the individual half. Every employee is
 * given the same brand block, the same hard rules, the same standing
 * instructions from the admin and the same plan; what differs is who they are
 * and what their job is. That is what stops the designer drawing something the
 * script never mentions, and what makes "tell them all something" one settings
 * field rather than eight.
 */
import { employeeIntro } from './employees';
import { generateJson } from './claude';
import {
  FORMAT_SPECS,
  ROLE_SPECS,
  type ContentFormat,
  type ContentPlan,
  type ContentResearch,
  type Employee,
  type SocialSettings,
} from './types';

/**
 * The only things about Velocity worth saying. Shared by everyone so the
 * designer and the writer are selling the same product.
 */
export const BRAND = `Velocity is a ride-hailing app in Pakistan. Its actual differences, which are the only things worth saying:
- The passenger offers their own fare and drivers bid on it. There is no surge pricing.
- Cash is a first-class payment method, because most of Pakistan pays in cash.
- Riders can pool a ride with people going the same way and split the fare per seat.
- It also does intercity seats, couriers and freight, not just city rides.
- Every driver's CNIC is verified. Riders can require a female driver.
- Fleet owners can run several cars through a partner portal.
- There is a partner programme: bring drivers and riders, earn a share of Velocity's commission.

Look and feel: near-black (#1a1c1c) and bright lime (#ccff00). Modern Pakistani streets — Lahore, Karachi, Islamabad. Real cars, real people, natural daylight. Confident, never cheesy, never stock-footage.`;

/** The rules nobody breaks, whatever their own brief says. */
export const HARD_RULES = `Rules no instruction overrides:
1. Every number you use must come from the FACTS block. Never invent, round up or extrapolate a figure. If a fact is zero or missing, write around it — do not imply a scale the platform has not reached.
2. Never name a competitor in the output. You may read about them; you may not mention them.
3. No guaranteed-income language ("earn X per month"). Describe how earnings work, not what someone will make.
4. Urdu/English code-switching is natural for this audience — use it where it sounds right. Keep on-screen text short and mostly English.
5. Nothing that would embarrass a driver, a rider, or a regulator reading it back a year later.`;

/** What the admin has told the whole team. */
export function standingInstructions(settings: SocialSettings): string {
  const text = settings.crewInstructions.trim();
  return text
    ? `STANDING INSTRUCTIONS FROM THE TEAM LEAD — these apply to everyone, on every job:\n${text}`
    : '';
}

/** The system prompt one employee starts from. */
export function systemFor(employee: Employee, settings: SocialSettings): string {
  return [employeeIntro(employee), '', BRAND, '', HARD_RULES, '', standingInstructions(settings)]
    .join('\n')
    .trim();
}

/** The research block, rendered for a prompt. Empty when research was skipped. */
export function researchBlock(research: ContentResearch | null): string {
  if (!research || research.error) return '';
  const lines = [
    research.trends.length ? `Travelling right now: ${research.trends.join(' | ')}` : '',
    research.competitorMoves.length ? `What the other apps are doing: ${research.competitorMoves.join(' | ')}` : '',
    research.opportunities.length ? `Gaps we can take: ${research.opportunities.join(' | ')}` : '',
    research.hookPatterns.length ? `Hook shapes that are working: ${research.hookPatterns.join(' | ')}` : '',
    research.avoid.length ? `Being done to death — avoid: ${research.avoid.join(' | ')}` : '',
  ].filter(Boolean);
  return lines.length ? `MARKET READ (from this morning):\n${lines.join('\n')}` : '';
}

/** Feedback the admin has given on this piece, oldest first. */
export function feedbackBlock(feedback: string[]): string {
  if (!feedback.length) return '';
  return `THE TEAM LEAD HAS ASKED FOR CHANGES. Every point below must be addressed in this version:\n${feedback
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n')}`;
}

/** Who is in the room, for the standup prompt. */
function roster(team: Employee[]): string {
  return team.map((e) => `- ${e.name} (id: ${e.id}) — ${e.title}. ${ROLE_SPECS[e.role].blurb}`).join('\n');
}

// ── the standup ─────────────────────────────────────────────────────────────

/**
 * Everyone in the room agrees what they are making before any of them makes it.
 *
 * One model call rather than one per person: the value is a single decision
 * every downstream prompt can inherit, and eight calls that each re-read the
 * brief would cost eight times as much to arrive at the same paragraph. The
 * people present are named in the prompt and answer in their own names, so the
 * console can show who said what.
 */
export async function planContent(params: {
  settings: SocialSettings;
  team: Employee[];
  format: ContentFormat;
  angle: string;
  facts: Record<string, number | string>;
  research: ContentResearch | null;
  recentConcepts: string[];
  feedback: string[];
}): Promise<ContentPlan> {
  const spec = FORMAT_SPECS[params.format];

  const system = `You are running the daily standup of Velocity's social content team.

${BRAND}

${HARD_RULES}

IN THE ROOM TODAY:
${roster(params.team)}

Your job is to settle ONE concept the team will then execute. Argue it briefly in their voices — use their real names — then commit. A concept is not a topic: "drivers earn well" is a topic, "a driver counts out today's cash on his bonnet while the fare he refused scrolls past" is a concept.

What travels in this market: a specific person in a specific place; a number that surprises; a frustration everyone has had with getting around a Pakistani city; something that resolves in under three seconds. What does not: slogans, stock smiles, app screenshots with no human in them.

Only give notes to people who are actually in the room, keyed by the id shown above.

Reply with one JSON object and nothing else:
{
  "concept": "one sentence, concrete, filmable",
  "audience": "who exactly this is for",
  "why": "why this today",
  "hookDirection": "the shape of the opening — not the words, the writer writes those",
  "visualDirection": "what the designer is making: subject, light, colour, type treatment",
  "editDirection": "what the editor is cutting: pacing, the interrupt, the sound. Empty string for still formats.",
  "distribution": "what the manager does with it: per-network angle, best time, what to say to the first ten comments",
  "notes": { "<employee id>": "one line in that person's voice, about their part" }
}`;

  const { data } = await generateJson<{
    concept?: string;
    audience?: string;
    why?: string;
    hookDirection?: string;
    visualDirection?: string;
    editDirection?: string;
    distribution?: string;
    notes?: Record<string, unknown>;
  }>({
    model: params.settings.textModel,
    system: `${system}\n\n${standingInstructions(params.settings)}`,
    what: "The team's plan",
    prompt: [
      `FORMAT: ${spec.label} — ${spec.brief}`,
      `Aspect ${spec.aspect}${spec.seconds ? `, about ${spec.seconds} seconds` : ''}${spec.slides > 1 ? `, ${spec.slides} slides` : ''}.`,
      `TODAY'S ANGLE: ${params.angle}`,
      '',
      `FACTS (the only numbers anyone may use):\n${JSON.stringify(params.facts, null, 2)}`,
      '',
      researchBlock(params.research),
      params.recentConcepts.length
        ? `ALREADY MADE RECENTLY — do not repeat these:\n- ${params.recentConcepts.join('\n- ')}`
        : '',
      feedbackBlock(params.feedback),
    ]
      .filter(Boolean)
      .join('\n'),
  });

  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  // Only keep notes addressed to somebody who is actually on the team — a
  // hallucinated colleague showing up in the console would be worse than a
  // missing line.
  const notes: Record<string, string> = {};
  for (const employee of params.team) {
    const line = str(data.notes?.[employee.id], 300);
    if (line) notes[employee.id] = line;
  }

  const concept = str(data.concept, 400);
  if (!concept) throw new Error('The standup did not produce a concept.');

  return {
    atMs: Date.now(),
    concept,
    audience: str(data.audience, 200),
    why: str(data.why, 300),
    hookDirection: str(data.hookDirection, 300),
    visualDirection: str(data.visualDirection, 500),
    editDirection: spec.kind === 'video' ? str(data.editDirection, 500) : '',
    distribution: str(data.distribution, 600),
    notes,
  };
}

/** The plan, rendered for the prompt of whoever works next. */
export function planBlock(plan: ContentPlan | null, employee: Employee): string {
  if (!plan) return '';
  const mine = plan.notes[employee.id];
  return [
    'THE TEAM AGREED THIS AT STANDUP. Execute it; do not re-decide it.',
    `Concept: ${plan.concept}`,
    plan.audience ? `Audience: ${plan.audience}` : '',
    plan.hookDirection ? `Hook direction: ${plan.hookDirection}` : '',
    employee.role === 'designer' && plan.visualDirection ? `Visual direction: ${plan.visualDirection}` : '',
    employee.role === 'video-editor' && plan.editDirection ? `Edit direction: ${plan.editDirection}` : '',
    employee.role === 'social-manager' && plan.distribution ? `Distribution: ${plan.distribution}` : '',
    mine ? `What you said at standup: ${mine}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
