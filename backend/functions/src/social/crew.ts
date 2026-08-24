/**
 * The crew — who the four agents are, what they all know, and the standup they
 * hold before any of them starts working.
 *
 * The shared half matters more than the individual half. Every agent is given
 * the same brand block, the same standing instructions from the admin, and the
 * same plan; what differs is the job. That is what stops the designer drawing
 * something the script never mentions, and what makes "add an instruction
 * everyone follows" a single settings field rather than four.
 */
import type {
  AgentId,
  ContentFormat,
  ContentPlan,
  ContentResearch,
  SocialSettings,
} from './types';
import { AGENT_NAMES, FORMAT_SPECS } from './types';
import { generateJson } from './gemini';

/** What each agent is for, in the agent's own terms. */
export const AGENT_CHARTER: Record<AgentId, string> = {
  qalam:
    'You are Qalam, the content writer. You read the market before you write — what is travelling on Pakistani feeds this week, and what the other ride-hailing apps are saying — and then you write the hook, the frames and the caption. You are ruthless about the first three seconds and you never write a number you were not given.',
  rang:
    'You are Rang, the designer. You turn a script into pictures: what is in the frame, what the light is doing, what words are burned onto it. You think in thumbnails — the picture has to work at 40 pixels wide, in a feed, with the sound off.',
  raftar:
    'You are Raftar, the video editor. You decide the cut: what happens in each second, where the pattern interrupt lands, what the camera does, what the audio is doing under it. You are the reason someone is still watching at second seven.',
  awaaz:
    'You are Awaaz, the social media manager. You decide where a post goes, when, and with which caption per network. Once it is up, you are the one talking to the people in the comments — in their language, briefly, and like a human who works here.',
};

/**
 * The only things about Velocity worth saying. Shared by all four so the
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

/** The rules nobody on the crew is allowed to break, whatever the brief says. */
export const HARD_RULES = `Rules no instruction overrides:
1. Every number you use must come from the FACTS block. Never invent, round up or extrapolate a figure. If a fact is zero or missing, write around it — do not imply a scale the platform has not reached.
2. Never name a competitor in the output. You may read about them; you may not mention them.
3. No guaranteed-income language ("earn X per month"). Describe how earnings work, not what someone will make.
4. Urdu/English code-switching is natural for this audience — use it where it sounds right. Keep on-screen text short and mostly English.
5. Nothing that would embarrass a driver, a rider, or a regulator reading it back a year later.`;

/**
 * Everything the admin has told the crew, assembled once. `crewInstructions`
 * goes to all four; `agentNotes` is the one-agent override.
 */
export function standingInstructions(settings: SocialSettings, agent: AgentId): string {
  const parts: string[] = [];
  if (settings.crewInstructions.trim()) {
    parts.push(`STANDING INSTRUCTIONS FROM THE TEAM — these apply to every agent, every run:\n${settings.crewInstructions.trim()}`);
  }
  const note = settings.agentNotes?.[agent]?.trim();
  if (note) parts.push(`DIRECTION FOR YOU SPECIFICALLY (${AGENT_NAMES[agent]}):\n${note}`);
  return parts.join('\n\n');
}

/** The system prompt every agent starts from. */
export function agentSystem(agent: AgentId, settings: SocialSettings): string {
  return [AGENT_CHARTER[agent], '', BRAND, '', HARD_RULES, '', standingInstructions(settings, agent)]
    .filter((s) => s !== undefined)
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
  return lines.length ? `MARKET READ (from this morning's search):\n${lines.join('\n')}` : '';
}

/** Feedback the admin has given on this post, oldest first. */
export function feedbackBlock(feedback: string[]): string {
  if (!feedback.length) return '';
  return `THE ADMIN HAS ASKED FOR CHANGES. Every point below must be addressed in this version:\n${feedback
    .map((f, i) => `${i + 1}. ${f}`)
    .join('\n')}`;
}

// ── the standup ─────────────────────────────────────────────────────────────

const PLAN_SYSTEM = `You are running the daily standup of Velocity's four-person content crew.

${BRAND}

${HARD_RULES}

The crew:
- Qalam, content writer — hooks, script, caption.
- Rang, designer — the frames, the type, the colour.
- Raftar, video editor — the cut, the pacing, the sound.
- Awaaz, social media manager — where it goes, and the comments afterwards.

Your job is to settle ONE concept the four of them will then execute. Argue it briefly in their voices, then commit. A concept is not a topic: "drivers earn well" is a topic, "a driver counts out today's cash on his bonnet while the fare he refused scrolls past" is a concept.

What travels in this market: a specific person in a specific place; a number that surprises; a frustration everyone has had with getting around a Pakistani city; something that resolves in under three seconds. What does not: slogans, stock smiles, app screenshots with no human in them.

Reply with one JSON object and nothing else:
{
  "concept": "one sentence, concrete, filmable",
  "audience": "who exactly this is for",
  "why": "why this today",
  "hookDirection": "the shape of the opening — not the words, Qalam writes those",
  "visualDirection": "what Rang is making: subject, light, colour, type treatment",
  "editDirection": "what Raftar is cutting: pacing, the interrupt, the sound. Empty string for still formats.",
  "distribution": "what Awaaz does with it: per-network angle, best time, what to say to the first ten comments",
  "notes": { "qalam": "one line in Qalam's voice", "rang": "one line", "raftar": "one line", "awaaz": "one line" }
}`;

/**
 * The four of them agree what they are making before any of them makes it.
 *
 * One model call rather than four round trips: the value is a single decision
 * every downstream prompt can inherit, and four calls that each re-read the
 * brief would cost four times as much to arrive at the same paragraph.
 */
export async function planContent(params: {
  settings: SocialSettings;
  format: ContentFormat;
  angle: string;
  facts: Record<string, number | string>;
  research: ContentResearch | null;
  recentConcepts: string[];
  feedback: string[];
}): Promise<ContentPlan> {
  const spec = FORMAT_SPECS[params.format];

  const { data } = await generateJson<{
    concept?: string;
    audience?: string;
    why?: string;
    hookDirection?: string;
    visualDirection?: string;
    editDirection?: string;
    distribution?: string;
    notes?: Record<string, string>;
  }>({
    model: params.settings.textModel,
    system: `${PLAN_SYSTEM}\n\n${standingInstructions(params.settings, 'qalam')}`,
    what: "The crew's plan",
    temperature: 1,
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
  const notes: Partial<Record<AgentId, string>> = {};
  for (const agent of Object.keys(AGENT_NAMES) as AgentId[]) {
    const line = str(data.notes?.[agent], 300);
    if (line) notes[agent] = line;
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

/** The plan, rendered for the prompt of whichever agent works next. */
export function planBlock(plan: ContentPlan | null, agent: AgentId): string {
  if (!plan) return '';
  const mine = plan.notes[agent];
  return [
    'THE CREW AGREED THIS AT STANDUP. Execute it; do not re-decide it.',
    `Concept: ${plan.concept}`,
    plan.audience ? `Audience: ${plan.audience}` : '',
    plan.hookDirection ? `Hook direction: ${plan.hookDirection}` : '',
    agent === 'rang' && plan.visualDirection ? `Visual direction: ${plan.visualDirection}` : '',
    agent === 'raftar' && plan.editDirection ? `Edit direction: ${plan.editDirection}` : '',
    agent === 'awaaz' && plan.distribution ? `Distribution: ${plan.distribution}` : '',
    mine ? `Your own note from standup: ${mine}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
