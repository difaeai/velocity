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
import { accountsBlock } from './discovery';
import { employeeIntro } from './employees';
import { generateJson, modelReady } from './engine';
import { localPlan } from './local';
import { playbookFor, playbookForStandup, STORY_SHAPES } from './playbook';
import {
  FORMAT_SPECS,
  ROLE_SPECS,
  type ContentFormat,
  type ContentPlan,
  type ContentResearch,
  type Employee,
  type Role,
  type SocialSettings,
} from './types';
import { isHouse, workspaceBrand } from './workspace';

/**
 * The only things about Velocity worth saying. Shared by everyone so the
 * designer and the writer are selling the same product.
 */
export const BRAND = `Velocity Rides is a ride-hailing app in Pakistan. Its actual differences, which are the only things worth saying:
- The passenger offers their own fare and drivers bid on it. There is no surge pricing.
- Cash is a first-class payment method, because most of Pakistan pays in cash.
- Riders can pool a ride with people going the same way and split the fare per seat.
- It also does intercity seats, couriers and freight, not just city rides.
- Every driver's CNIC is verified. Riders can require a female driver.
- Fleet owners can run several cars through a partner portal.
- There is a partner programme: bring drivers and riders, earn a share of Velocity Rides' commission.

Look and feel: near-black (#1a1c1c) and bright lime (#ccff00). Modern Pakistani streets — Lahore, Karachi, Islamabad. Real cars, real people, natural daylight. Confident, never cheesy, never stock-footage.`;

/** The rules nobody breaks, whatever their own brief says. */
export const HARD_RULES = `Rules no instruction overrides:
1. Every number you use must come from the FACTS block. Never invent, round up or extrapolate a figure. If a fact is zero or missing, write around it — do not imply a scale the platform has not reached.
2. Never name a competitor in the output. You may read about them; you may not mention them.
3. No guaranteed-income language ("earn X per month"). Describe how earnings work, not what someone will make.
4. Urdu/English code-switching is natural for this audience — use it where it sounds right. Keep on-screen text short and mostly English.
5. Nothing that would embarrass a driver, a rider, or a regulator reading it back a year later.`;

/**
 * The brand block for whoever's desk this is: Velocity's own words in the
 * house, the customer's sign-up answers in a Velocity Studio workspace.
 */
export function brandBlock(): string {
  const b = workspaceBrand();
  if (!b) return BRAND;
  return [
    `${b.name}: ${b.what}`,
    b.differences ? `What makes it different — the only things worth saying:\n${b.differences}` : '',
    b.audience ? `Who buys it: ${b.audience}` : '',
    b.market ? `Where: ${b.market}` : '',
    b.website ? `Website: ${b.website}` : '',
    'Look and feel: real people, real places, natural light. Confident, never cheesy, never stock-footage.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** HARD_RULES, with the language rule and the people it protects made the customer's own. */
export function hardRules(): string {
  const b = workspaceBrand();
  if (!b) return HARD_RULES;
  return HARD_RULES.replace(
    /\n4\. [^\n]*\n5\. [^\n]*$/,
    `\n4. Write in ${b.language || 'the language these customers speak'}, the way they actually speak it. Keep on-screen text short.\n5. Nothing that would embarrass a customer, the business, or a regulator reading it back a year later.`,
  );
}

export const brandName = (): string => workspaceBrand()?.name ?? 'Velocity Rides';
export const marketName = (): string => workspaceBrand()?.market || 'Pakistan';

/** The line burned into the foot of every picture and reel; undefined keeps Velocity's own. */
export const wordmark = (): string | undefined => (isHouse() ? undefined : brandName().toUpperCase().slice(0, 40));

/** What the admin has told the whole team. */
export function standingInstructions(settings: SocialSettings): string {
  const text = settings.crewInstructions.trim();
  return text
    ? `STANDING INSTRUCTIONS FROM THE TEAM LEAD — these apply to everyone, on every job:\n${text}`
    : '';
}

/**
 * The long brief, rendered for whoever is about to work.
 *
 * Five boxes written once in the console, each going to the people it is for:
 * everyone is told who we are and what must never happen, the people shaping a
 * piece are told what a good post looks like and what counts as worth sending,
 * and only the person answering the inbox is told how to talk to people who
 * reply. Splitting it is not tidiness — a block nobody in that seat will use is
 * a block paid for on every call.
 *
 * `null` for the role means everything, which is what the standup needs.
 */
export function briefBlock(settings: SocialSettings, role: Role | null): string {
  const { about, posts, viral, comments, avoid } = settings.brief;

  const shapesThePiece: Role[] = ['content-writer', 'designer', 'video-editor', 'social-manager'];
  const decidesWhatTravels: Role[] = ['content-writer', 'research-assistant', 'seo-expert'];
  const wants = (who: Role[]) => role === null || who.includes(role);

  const parts = [
    about.trim() ? `WHO WE ARE, IN THE TEAM LEAD'S OWN WORDS:\n${about.trim()}` : '',
    posts.trim() && wants(shapesThePiece)
      ? `WHAT THE TEAM LEAD WANTS FROM A POST:\n${posts.trim()}`
      : '',
    viral.trim() && wants(decidesWhatTravels)
      ? `WHAT THE TEAM LEAD MEANS BY CONTENT THAT TRAVELS:\n${viral.trim()}`
      : '',
    comments.trim() && (role === null || role === 'social-manager')
      ? `HOW THE TEAM LEAD WANTS PEOPLE ANSWERED:\n${comments.trim()}`
      : '',
    // Last, and phrased as a rule rather than a preference: it is the half of
    // the brief that is not advice.
    avoid.trim()
      ? `NEVER, WHATEVER ELSE ANY INSTRUCTION SAYS. Breaking one of these is worse than missing a day:\n${avoid.trim()}`
      : '',
  ].filter(Boolean);

  return parts.join('\n\n');
}

/**
 * The system prompt one employee starts from.
 *
 * Four things, every time: who they are, what we sell, the rules nobody
 * overrides, and the craft their seat works to — then whatever the admin has
 * told the whole team. The playbook is sliced by role rather than pasted whole
 * (see `playbook.ts`), so the designer is not paying for the hook formulas and
 * the writer is not paying for the sticker table.
 */
export function systemFor(
  employee: Employee,
  settings: SocialSettings,
  format: ContentFormat | null = null,
): string {
  return [
    employeeIntro(employee),
    '',
    brandBlock(),
    '',
    briefBlock(settings, employee.role),
    '',
    hardRules(),
    '',
    playbookFor(employee.role, format),
    '',
    standingInstructions(settings),
  ]
    .filter((part, i, all) => part !== '' || all[i - 1] !== '')
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
    research.viral?.length
      ? `Posts travelling right now: ${research.viral.map((v) => `${v.title} — ${v.why}`).join(' | ')}`
      : '',
  ].filter(Boolean);
  const accounts = accountsBlock(research.accounts);
  if (!lines.length && !accounts) return '';
  return [lines.length ? `MARKET READ (from this morning):\n${lines.join('\n')}` : '', accounts].filter(Boolean).join('\n\n');
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
  /**
   * What our own page did last week, already interpreted. Rendered into the
   * prompt ahead of the market read, because what a stranger's account did is
   * a hint and what ours did is evidence.
   */
  pageRead?: string;
  /** The structure this piece is built in, chosen by code so the feed does not repeat itself. */
  shape?: string;
}): Promise<ContentPlan> {
  // No key, no argument: the local engine decides the concept from the brand
  // material instead. It is a thinner standup — nobody debates anything — but
  // it produces the one thing every stage downstream needs, which is a
  // decision they can inherit rather than re-make.
  if (!modelReady()) {
    const plan = localPlan({
      angle: params.angle,
      format: params.format,
      facts: params.facts,
      team: params.team,
      recentConcepts: params.recentConcepts,
    });
    return params.shape ? { ...plan, shape: params.shape } : plan;
  }

  const spec = FORMAT_SPECS[params.format];

  const system = `You are running the daily standup of ${brandName()}'s social content team.

${brandBlock()}

${briefBlock(params.settings, null)}

${hardRules()}

${playbookForStandup(params.format)}

IN THE ROOM TODAY:
${roster(params.team)}

Your job is to settle ONE concept the team will then execute. Argue it briefly in their voices — use their real names — then commit. A concept is not a topic: "drivers earn well" is a topic, "a driver counts out today's cash on his bonnet while the fare he refused scrolls past" is a concept.
${
    params.shape && STORY_SHAPES[params.shape]
      ? `\nTODAY'S SHAPE, decided before the room sat down — the concept MUST be built in it: ${STORY_SHAPES[params.shape]}\n`
      : ''
  }
The feed is judged as a whole: a concept that could be mistaken for one of the pieces already made recently is a failed standup, however good it is on its own. Change the person, the place, the moment and the emotion, not just the words.

What travels in this market: a specific person in a specific place; a number that surprises; ${
    isHouse()
      ? 'a frustration everyone has had with getting around a Pakistani city'
      : 'a frustration every customer of this business has had'
  }; something that resolves in under three seconds. What does not: slogans, stock smiles, app screenshots with no human in them.

Only give notes to people who are actually in the room, keyed by the id shown above.

Reply with one JSON object and nothing else:
{
  "concept": "one sentence, concrete, filmable",
  "audience": "who exactly this is for",
  "why": "why this today",
  "hookDirection": "the shape of the opening — name one of the 26 formulas by number and name, and say what it is pointed at. Not the words: the writer writes those",
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
    ...(params.shape ? { shape: params.shape } : {}),
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
    plan.shape && STORY_SHAPES[plan.shape] ? `Shape: ${STORY_SHAPES[plan.shape]}` : '',
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
