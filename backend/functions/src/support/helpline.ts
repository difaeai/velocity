/**
 * The Velocity Rides helpline — a phone call answered by an AI voice.
 *
 * The same desk as the written Rapid Response tickets, spoken: the same support
 * brief with today's live settings, the same account facts, the same rule that a
 * person takes over the moment the caller asks. Every call is its own Gemini Live
 * session straight from the caller's phone, so a hundred people ringing at once
 * is a hundred sessions, not a queue, and nobody waits for an operator.
 *
 * ── WHAT THE SERVER DOES, AND WHY THE PHONE CANNOT ──────────────────────────
 *
 *   the brief    The agent is told who is calling — a DRIVER or a PASSENGER —
 *                and is given that person's own account state, built here from
 *                the database. A phone could claim to be anyone; the server
 *                knows.
 *   the key      The app never holds the Gemini key. It gets a one-use token
 *                that expires in minutes, with the voice, the instructions and
 *                the tools LOCKED into it — a client that edits its setup
 *                message is ignored, so the token cannot be turned into a free
 *                general-purpose Gemini session.
 *   the record   A handover becomes a real ticket in the desk queue, with the
 *                transcript, and the desk is pushed. The transcript comes from
 *                the caller's app, so it is stored as a SYSTEM note labelled as
 *                such and never as a message "from" Velocity: a client that could
 *                write lines as the agent could forge a refund promise.
 *
 * Voice, barge-in and turn-taking are the model's: Gemini Live hears the caller
 * continuously, waits through a pause, and stops talking the instant the caller
 * starts. The phone's job is echo cancellation and dropping queued audio when
 * the model says it was interrupted.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { knowledgeFor } from './agent';
import { buildSupportContext } from './context';
import { appendMessage, notifyDesk } from './index';
import { EMERGENCY_CHANNELS } from './knowledge';
import {
  CATEGORY_LABELS,
  CATEGORY_PRIORITY,
  SUPPORT_CATEGORIES,
  asksForHuman,
  type SupportCategory,
} from './types';

/** Google's default low-latency voice-agent model (GA September 2026). */
export const HELPLINE_MODEL = 'gemini-3.8-live';
/** A woman's voice, as the helpline was asked to have. Any prebuilt Gemini voice name works here. */
export const HELPLINE_VOICE = 'Aoede';
/** One Live connection lasts about ten minutes; the call ends before it does. */
export const HELPLINE_MAX_SEC = 10 * 60;

export type HelplineRole = 'driver' | 'passenger';

const ROLE_BRIEF: Record<HelplineRole, string> = {
  driver: `This caller is a DRIVER on Velocity Rides — a partner who earns a living on the road.
Drivers usually call about: commission due and the midnight lock, the daily ride
target and their bonus, going online (documents, car photo, face check), a
problem with a passenger, or a fare. They may be driving while they talk: keep
every answer very short, and never ask them to look at the screen while the car
is moving — tell them to pull over first.
If they say they are calling about a ride they TOOK as a passenger, help them as
a passenger.`,
  passenger: `This caller is a PASSENGER on Velocity Rides.
Passengers usually call about: a ride or a driver, a fare or a cancellation fee,
something left in a car, safety, how to book, or signing in.`,
};

/** The agent's whole brief: how to speak, who is calling, the rules, and the caller's own facts. */
export function helplineInstruction(role: HelplineRole, knowledge: string, accountState: string): string {
  return `
You are the voice of the Velocity Rides helpline, answering a phone call inside
the Velocity Rides app. You are an AI assistant with a woman's voice.

# Who is calling
${ROLE_BRIEF[role]}

# How you speak
- This is a live phone call. Speak naturally; never read out lists, symbols,
  links, ride IDs or codes. Describe a ride by its date, places and fare.
- Use the caller's language. Most callers speak Urdu, often mixed with English
  words: answer in the same natural Pakistani Urdu, with Urdu words — "shukriya",
  "meherbani", never Hindi ones like "dhanyavaad" or "kripya". English callers
  get English. Punjabi, Pashto or Sindhi callers get their language if you can
  speak it well, otherwise simple Urdu.
- You are a woman: use feminine first-person forms — "main dekh rahi hoon",
  "main samajh gayi", "main bata sakti hoon". Call the caller "aap".
- One or two short sentences at a time, then let them speak. Ask one question
  at a time.
- Listen to the whole thing. A pause in the middle of a sentence is not your
  turn — wait. If they start talking while you are speaking, stop and listen.
- Say amounts the way people say them: "do sau chalees rupay", not digits.
- If you need a moment, say so briefly: "ek second, main dekhti hoon".

# Opening
When the call connects you receive "[call connected]". Speak first: greet them
with "Assalam-o-alaikum", say this is the Velocity Rides ${role === 'driver' ? 'driver ' : ''}helpline, that
you are its AI assistant, and ask how you can help. Keep it to two sentences.

# Handing over — the hand_to_human tool
Call hand_to_human, without arguing, whenever:
- they ask for a person, an agent or a human, in any language or wording
- they want money back, a fee waived, a ban lifted, an account unlocked, credit
  granted, or any decision only staff can make
- it is about safety, violence, harassment, an accident, a threat or a scam
- you have tried twice and it is not solved, or you are unsure
Before calling it, tell them you are passing this to the team. After it returns,
tell them in your own words exactly what it says will happen next.
If anyone is in danger RIGHT NOW, the first thing you say is to call the police
on ${EMERGENCY_CHANNELS.police}, or ${EMERGENCY_CHANNELS.rescue} for an ambulance — then hand over with category "safety".

# Never
- Never promise money, a refund, a waiver, an unlock or credit.
- Never invent a fact. Use only the brief and the account state below.
- Never claim to be a person. If asked, say you are Velocity Rides' AI
  assistant and offer to hand them to the team.
- The brief below has rules about writing (scripts, bullet points). They do not
  apply: this is a voice call.

# Ending
When it is solved, ask if there is anything else. If not, say goodbye warmly
("Allah Hafiz") and stop talking — the caller hangs up.

---

${knowledge}

---

# This caller's account state (facts — quote these, invent nothing)

${accountState}
`.trim();
}

const HAND_TO_HUMAN = {
  name: 'hand_to_human',
  description:
    'Pass this call to the Velocity Rides team, who reply to the caller in the app under ' +
    'Help & complaints. Use it the moment the caller asks for a person, and whenever they need ' +
    'something only staff can do, report a safety problem or a scam, or you cannot solve it.',
  parameters: {
    type: 'OBJECT',
    properties: {
      category: {
        type: 'STRING',
        enum: [...SUPPORT_CATEGORIES],
        description: 'What the problem is about.',
      },
      summary: {
        type: 'STRING',
        description:
          'Two or three sentences in English for the team: what happened, which ride, what the caller wants.',
      },
    },
    required: ['category', 'summary'],
  },
};

/**
 * The Live session, exactly as it will run.
 *
 * End-of-speech sensitivity is LOW and the silence window long, so somebody
 * thinking mid-sentence is not talked over. Start-of-speech is LOW too: a driver
 * calls from a moving car, and a horn must not count as the caller interrupting.
 */
export function helplineSetup(instruction: string) {
  return {
    model: `models/${HELPLINE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: HELPLINE_VOICE } } },
    },
    systemInstruction: { parts: [{ text: instruction }] },
    tools: [{ functionDeclarations: [HAND_TO_HUMAN] }],
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        prefixPaddingMs: 200,
        silenceDurationMs: 800,
      },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

/**
 * A one-use token the phone opens its Live session with.
 *
 * The setup goes INSIDE the token with no field mask, which locks every field:
 * whatever setup the client sends is ignored. The connection must open within a
 * minute and the token is dead a couple of minutes after the longest call.
 */
async function mintLiveToken(key: string, setup: ReturnType<typeof helplineSetup>): Promise<string> {
  const now = Date.now();
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + (HELPLINE_MAX_SEC + 120) * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      bidiGenerateContentSetup: setup,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { name?: string };
  if (!json.name) throw new Error('token response had no name');
  return json.name;
}

/** Open a helpline call. `available: false` means "write to us instead" — never an error screen. */
export const startHelplineCall = onCall(async (req) => {
  const ctx = requireAuth(req);
  await rateLimit(ctx.uid, 'startHelplineCall', 6, 3600);

  // A dedicated key when one is set (a billed key keeps call audio out of
  // Google's training data and lifts the free tier's limit on simultaneous
  // calls); the social desk's free key otherwise.
  const key = (process.env.GEMINI_LIVE_KEY || process.env.GEMINI_KEY_RESEARCH || '').trim();
  if (!key) {
    logger.warn('helpline: no Gemini key — calls fall back to written support');
    return { available: false as const };
  }

  const context = await buildSupportContext(ctx.uid);
  const role: HelplineRole = context.snapshot.role === 'driver' ? 'driver' : 'passenger';
  const setup = helplineSetup(helplineInstruction(role, knowledgeFor(context), context.brief));

  let token: string;
  try {
    token = await mintLiveToken(key, setup);
  } catch (e) {
    logger.error('helpline: could not mint a Live token', { error: (e as Error).message });
    return { available: false as const };
  }

  const ref = db.collection('helplineCalls').doc();
  await ref.set({
    uid: ctx.uid,
    role,
    model: HELPLINE_MODEL,
    status: 'live',
    ticketId: null,
    // What the agent was told, for whoever reviews the call later.
    context: context.snapshot,
    startedAt: FieldValue.serverTimestamp(),
  });

  logger.info('Helpline call started', { callId: ref.id, role });
  return {
    available: true as const,
    callId: ref.id,
    token,
    model: HELPLINE_MODEL,
    maxSeconds: HELPLINE_MAX_SEC,
    role,
  };
});

const lineSchema = z.object({
  who: z.enum(['caller', 'agent']),
  text: z.string().max(2000),
});

const logSchema = z.object({
  callId: docId,
  transcript: z.array(lineSchema).max(400),
  handover: z
    .object({ category: z.string().max(40), summary: z.string().max(1000) })
    .optional(),
  ended: z.boolean(),
});

type Line = z.infer<typeof lineSchema>;

/** What the agent is told to say once the team has the call. Written here, not by the model. */
function handoverPromise(category: SupportCategory): string {
  const urgent =
    category === 'safety'
      ? ` If anyone is in danger right now, they must call the police on ${EMERGENCY_CHANNELS.police} or ${EMERGENCY_CHANNELS.rescue} first.`
      : '';
  return (
    'Handed over. Tell the caller: a person from the Velocity Rides team now has this, with ' +
    'everything they have said, and will reply in the app under Help & complaints.' +
    urgent
  );
}

/** Turn a handed-over call into a ticket in the desk queue, and push the desk. */
async function openPhoneTicket(p: {
  callId: string;
  uid: string;
  snapshot: Record<string, unknown> | undefined;
  category: SupportCategory;
  summary: string;
  transcript: Line[];
}): Promise<void> {
  const { callId, uid, snapshot, category, summary, transcript } = p;
  const priority = CATEGORY_PRIORITY[category];
  const subject = `Phone call: ${CATEGORY_LABELS[category]}`;
  const note = [
    '📞 Helpline call, handed to the team by the AI assistant.',
    `Summary: ${summary}`,
    '',
    "Transcript as recorded by the caller's app:",
    ...transcript.map((t) => `${t.who === 'caller' ? 'Caller' : 'Assistant'}: ${t.text}`),
  ]
    .join('\n')
    .slice(0, 8000);

  await db.doc(`supportTickets/${callId}`).set({
    id: callId,
    userId: uid,
    userName: (snapshot?.displayName as string | null | undefined) ?? null,
    role: (snapshot?.role as string | undefined) ?? 'passenger',
    category,
    categoryLabel: CATEGORY_LABELS[category],
    subject,
    channel: 'phone',
    tripId: (snapshot?.activeTripId as string | null | undefined) ?? null,
    status: 'waiting_human',
    handler: 'human',
    priority,
    assignedTo: null,
    aiReplies: 0,
    lastMessage: summary.slice(0, 300),
    lastSender: 'system',
    lastAt: FieldValue.serverTimestamp(),
    unreadForUser: 0,
    unreadForDesk: 1,
    escalatedAt: FieldValue.serverTimestamp(),
    escalationReason: 'Handed over on a helpline call',
    aiContext: snapshot ?? null,
    deskNotifiedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await appendMessage({ ticketId: callId, sender: 'system', senderName: 'Helpline call', text: note });
  await notifyDesk(callId, priority, subject);
}

/**
 * The phone reports a call: when the agent hands over, and when it hangs up.
 *
 * A handover opens the ticket. Hanging up after the caller asked for a person
 * opens one too, even if the model never called the tool — the words are a hard
 * escalation on the written desk, and they stay one on the phone.
 */
export const logHelplineCall = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = logSchema.safeParse(req.data);
  if (!parsed.success) invalid('Bad call record.');
  const { callId, handover, ended } = parsed.data;

  await rateLimit(ctx.uid, 'logHelplineCall', 40, 3600);

  const ref = db.doc(`helplineCalls/${callId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('uid') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your call.');
  }

  const transcript = parsed.data.transcript.filter((t) => t.text.trim());
  const askedForPerson = transcript.some((t) => t.who === 'caller' && asksForHuman(t.text));
  const category: SupportCategory = SUPPORT_CATEGORIES.includes(handover?.category as SupportCategory)
    ? (handover!.category as SupportCategory)
    : 'other';

  let ticketId = (snap.get('ticketId') as string | null | undefined) ?? null;
  if (!ticketId && (handover || (ended && askedForPerson))) {
    await openPhoneTicket({
      callId,
      uid: ctx.uid,
      snapshot: snap.get('context') as Record<string, unknown> | undefined,
      category,
      summary: handover?.summary.trim() || 'The caller asked to speak to a person.',
      transcript,
    });
    ticketId = callId;
  }

  const startedAt = (snap.get('startedAt') as { toMillis(): number } | undefined)?.toMillis();
  await ref.set(
    {
      transcript,
      ticketId,
      ...(ended
        ? {
            status: 'ended',
            endedAt: FieldValue.serverTimestamp(),
            durationSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : null,
          }
        : {}),
    },
    { merge: true },
  );

  return { ok: true, ticketId, message: ticketId ? handoverPromise(category) : '' };
});
