/**
 * The AI half of the Velocity Rapid Response System.
 *
 * It works the way a good first-line support person works: it reads the
 * complaint, it reads the customer's actual account, it answers if it can, and
 * it hands over the moment it cannot — or the moment it is asked to.
 *
 * ── THE HANDOVER IS NOT THE MODEL'S DECISION ALONE ──────────────────────────
 *
 * Four separate things escalate a ticket, and only one of them is the model's
 * judgement:
 *
 *   the words        `asksForHuman()` runs on the raw message BEFORE any API
 *                    call. "Mujhe insaan se baat karao" is a hard escalation
 *                    even if the key is missing, the API is down or the model
 *                    would rather keep helping.
 *   the category     safety and online_scam never belong to a machine.
 *   the model        it says `needsHuman` when it is out of its depth or being
 *                    asked for money.
 *   the clock        MAX_AI_REPLIES, so nobody can be trapped in a loop.
 *
 * ── WHAT A FAILURE LOOKS LIKE ───────────────────────────────────────────────
 *
 * Everything here degrades to "a person will be with you". No API key, a refusal,
 * a timeout, unparseable JSON — all of them produce a plain acknowledgement and
 * a ticket in the human queue. A support system whose failure mode is silence
 * is worse than having no AI in it at all, so there is no path through this
 * file that leaves a message unanswered.
 */
import { logger } from 'firebase-functions';

import { claudeReady, extractJson, generateText } from '../social/claude';
import { buildSupportContext, type SupportContext } from './context';
import { EMERGENCY_CHANNELS, supportKnowledge } from './knowledge';
import {
  CATEGORY_LABELS,
  HUMAN_ONLY_CATEGORIES,
  asksForHuman,
  type SupportCategory,
  type SupportPriority,
} from './types';

/**
 * Which model answers support.
 *
 * Not the one the social desk writes campaigns with. That desk produces a
 * handful of long, high-stakes pieces a day and wants the most capable model
 * there is; this one answers hundreds of short messages where the facts are
 * already in the prompt and latency is felt by somebody standing on a road.
 * Sonnet is the right shape for that, and the whole brief fits in it.
 */
const SUPPORT_MODEL = 'claude-sonnet-5-5';

/** One turn of the conversation, as stored. */
export interface SupportTurn {
  sender: 'user' | 'ai' | 'agent' | 'system';
  text: string;
}

export interface AgentReply {
  /** What to post into the thread. Always non-empty. */
  text: string;
  /** Hand to a human now. */
  needsHuman: boolean;
  /** Why, for the desk queue. */
  reason: string | null;
  /** The agent believes this is answered. */
  resolved: boolean;
  /** Raised when the agent reads something more serious than the category said. */
  priority: SupportPriority | null;
  /** False when this reply came from the fallback path, not the model. */
  fromModel: boolean;
}

/** What the model is asked to return. */
interface ModelVerdict {
  reply?: unknown;
  needs_human?: unknown;
  reason?: unknown;
  resolved?: unknown;
  priority?: unknown;
}

/**
 * The reply a safety or fraud report gets instantly, before any human is free.
 *
 * Written out rather than generated: when somebody is in trouble the one thing
 * that must not depend on an API being up is the sentence with the phone number
 * in it.
 */
function emergencyAcknowledgement(category: SupportCategory): string {
  if (category === 'safety') {
    return (
      `If you are in danger right now, call the police on ${EMERGENCY_CHANNELS.police} ` +
      `— or ${EMERGENCY_CHANNELS.rescue} for an ambulance. Do that first.\n\n` +
      'This report has gone straight to Velocity Rides\' safety team as urgent, ' +
      'and a real person is picking it up now — not a bot. Please tell us the ' +
      'driver\'s name or number plate and where you are if you can.'
    );
  }
  return (
    'Thank you for reporting this — it is with a real person at Velocity Rides now, marked urgent.\n\n' +
    'Two things to do straight away:\n' +
    `1. Report it to Pakistan's cybercrime agency, NCCIA, on ${EMERGENCY_CHANNELS.nccia} ` +
    `or at ${EMERGENCY_CHANNELS.ncciaComplaintUrl} — only they can investigate and recover money.\n` +
    '2. Keep every screenshot, the number that contacted you and any transaction ID.\n\n' +
    'Velocity Rides staff never ask for an OTP, a PIN, a card number, or a transfer ' +
    'to a personal account. Anyone who did was not us.'
  );
}

/** The fallback when the model cannot be reached. Never blames the user. */
function fallbackReply(): AgentReply {
  return {
    text:
      'Thanks for getting in touch — your message is with the Velocity Rides team and ' +
      'a person will reply here shortly. If this is an emergency, call the police on ' +
      `${EMERGENCY_CHANNELS.police}.`,
    needsHuman: true,
    reason: 'Automatic assistant unavailable',
    resolved: false,
    priority: null,
    fromModel: false,
  };
}

const SYSTEM_RULES = `
You are "Velocity Rides Rapid Response" — the first-line support agent inside
the Velocity Rides app, for both passengers and drivers in Pakistan.

Answer ONLY from the support brief and the customer's account state you are
given. Be warm, direct and brief.

Reply with a single JSON object and nothing else:

{
  "reply": "what to say to the customer",
  "needs_human": true | false,
  "reason": "one short line for the human queue, or null",
  "resolved": true | false,
  "priority": "normal" | "high" | "urgent"
}

Set "needs_human": true whenever ANY of these is true:
- they ask for a person, an agent, or a human, in any language or wording
- they want money back, a fee waived, a ban lifted, an account unlocked, credit
  granted, or any other decision only staff can make
- it is about safety, violence, harassment, an accident, a threat, or a scam
- they have asked the same thing twice and your answer has not helped
- you are not certain, for any reason at all

When you set "needs_human", your "reply" must still be useful: acknowledge the
specific problem in their words, say a person is taking it, and give any
emergency number that applies. Never say "I cannot help".
`.trim();

export interface RunAgentInput {
  uid: string;
  category: SupportCategory;
  subject: string;
  /** The conversation so far, oldest first, including the new message. */
  turns: SupportTurn[];
  /** Pre-built context, when the caller already has it. Saves the reads. */
  context?: SupportContext;
}

/**
 * Produce the next support reply.
 *
 * Returns the context it used so the caller can store the same snapshot on the
 * ticket — the desk should be able to see exactly what the AI was looking at
 * when it said whatever it said.
 */
export async function runSupportAgent(
  input: RunAgentInput,
): Promise<{ reply: AgentReply; context: SupportContext }> {
  const { uid, category, subject, turns } = input;
  const context = input.context ?? (await buildSupportContext(uid));

  const lastUserMessage = [...turns].reverse().find((t) => t.sender === 'user')?.text ?? '';

  // ── Hard escalations, decided without the model ──────────────────────────
  if (HUMAN_ONLY_CATEGORIES.has(category)) {
    return {
      context,
      reply: {
        text: emergencyAcknowledgement(category),
        needsHuman: true,
        reason: category === 'safety' ? 'Safety report' : 'Online scam report',
        resolved: false,
        priority: 'urgent',
        fromModel: false,
      },
    };
  }
  if (asksForHuman(lastUserMessage)) {
    return {
      context,
      reply: {
        text:
          'Of course — I am connecting you with a member of the Velocity Rides team now. ' +
          'They will reply in this same chat, and everything you have written is already with them.',
        needsHuman: true,
        reason: 'Customer asked for a human',
        resolved: false,
        priority: null,
        fromModel: false,
      },
    };
  }
  if (!claudeReady()) {
    logger.warn('support: ANTHROPIC_API_KEY missing — every ticket goes to the desk');
    return { context, reply: fallbackReply() };
  }

  // ── Ask the model ─────────────────────────────────────────────────────────
  const knowledge = supportKnowledge({
    commissionRatePct: Math.round(context.commission.rate * 100),
    dailyTargetEnabled: context.commission.dailyTargetEnabled,
    dailyTargetRides: context.commission.dailyTargetRides,
    dailyTargetBonus: context.commission.dailyTargetBonus,
    dailyTargetWaives: context.commission.dailyTargetWaivesCommission,
    dailyTargetPoolOnly: context.commission.dailyTargetPoolOnly,
    cancellationPassengerPct: Math.round(context.cancellation.passengerFeeRate * 100),
    cancellationDriverPct: Math.round(context.cancellation.driverFeeRate * 100),
    outstandingLimit: context.cancellation.outstandingLimit,
    // The launch posture: the wallet is hidden until top-ups officially open.
    walletLive: false,
  });

  const transcript = turns
    .map((t) => {
      const who =
        t.sender === 'user' ? 'CUSTOMER' : t.sender === 'agent' ? 'VELOCITY STAFF' : t.sender === 'ai' ? 'YOU' : 'SYSTEM';
      return `${who}: ${t.text}`;
    })
    .join('\n\n');

  const prompt = [
    `# Support brief\n\n${knowledge}`,
    `# This customer's account state (facts — quote these, invent nothing)\n\n${context.brief}`,
    `# Ticket\n\nCategory: ${CATEGORY_LABELS[category]}\nSubject: ${subject}`,
    `# Conversation so far\n\n${transcript}`,
    'Write the next reply as the JSON object described in your instructions.',
  ].join('\n\n---\n\n');

  try {
    const result = await generateText({
      model: SUPPORT_MODEL,
      system: `${SYSTEM_RULES}\n\n---\n\n${knowledge}`,
      prompt,
    });
    const verdict = extractJson<ModelVerdict>(result.text);
    const text = typeof verdict?.reply === 'string' ? verdict.reply.trim() : '';
    if (!text) {
      logger.warn('support: model reply had no usable text', { preview: result.text.slice(0, 300) });
      return { context, reply: fallbackReply() };
    }
    const priority = verdict?.priority;
    return {
      context,
      reply: {
        text,
        needsHuman: verdict?.needs_human === true,
        reason: typeof verdict?.reason === 'string' && verdict.reason.trim() ? verdict.reason.trim() : null,
        resolved: verdict?.resolved === true && verdict?.needs_human !== true,
        priority:
          priority === 'urgent' || priority === 'high' || priority === 'normal' ? priority : null,
        fromModel: true,
      },
    };
  } catch (e) {
    // A refusal, a rate limit, a spent balance — all the same from here: the
    // customer gets an answer and a human gets the ticket.
    logger.error('support: agent call failed', { error: (e as Error).message });
    return { context, reply: fallbackReply() };
  }
}
