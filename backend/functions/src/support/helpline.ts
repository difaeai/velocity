/**
 * The Velocity Rides helpline — a phone call answered by an AI voice.
 *
 * The same desk as the written Rapid Response tickets, spoken: the same support
 * brief with today's live settings and the same account facts — but the voice
 * fixes things on the call (support/helplineActions.ts) instead of passing the
 * caller on. Every call is its own Gemini Live session straight from the
 * caller's phone, so a hundred people ringing at once is a hundred sessions,
 * not a queue, and nobody waits for an operator.
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
 *   the record   Every call becomes a complaint on the desk, on the caller's
 *                side, with the transcript. The transcript comes from the
 *                caller's app, so it is stored as a SYSTEM note labelled as
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

import { geminiKey, loadAi } from '../ai/config';
import { LIVE_USD_PER_MIN, recordAi } from '../ai/usage';
import { db, FieldValue, Timestamp } from '../lib/firebase';
import { docId, invalid, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { knowledgeFor } from './agent';
import { buildSupportContext } from './context';
import { HELPLINE_TOOLS, ensureCallTicket, registerComplaint, type HelplineCaller } from './helplineActions';
import { appendMessage } from './index';
import { EMERGENCY_CHANNELS } from './knowledge';
import { SUPPORT_CATEGORIES, asksForHuman, type SupportStatus } from './types';

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

/** How the agent gets things done, with the tools a current app can run. */
const SOLVE_WITH_TOOLS = `
# You solve it, on this call
You are the helpline, not a switchboard: solve the caller's problem yourself.
1. Understand it: which ride (by its date and places), what went wrong, what they want.
2. If one of your tools can fix it, say you are checking ("ek second, main check
   karti hoon"), use it, then tell them plainly what it says happened.
3. A tool decides from the ride's own record. When it says no, tell them the
   reason in your own words — do not argue, and do not try it again for that ride.
4. On EVERY call, register the complaint with register_complaint before the call
   ends: "resolved" when you fixed or answered it, "needs_team" when something is
   left that only staff can do. The summary is short English and says what you did.

Your tools:
- end_stuck_ride — the app still shows a ride they cannot get out of: nobody
  took the request, the driver never came, the passenger never came out to the
  waiting car, or a ride long over still shows as running. Releases it with no fee.
- waive_cancellation_fee — they were charged a cancellation fee they say was not
  their fault. Takes it off when the ride record shows the other side caused it.
- report_lost_item — a passenger left something in the car. Messages that
  ride's driver in the app's ride chat.
- register_complaint — records the call's complaint on the complaints desk.

Only staff can: return money already paid, take off a fee the ride record does
not prove was wrong, look into a driver's or a passenger's behaviour, lift a
ban, clear commission, add a bonus. For these, register the complaint as
"needs_team" and say: "Maine aap ki complaint register kar di hai. Velocity Rides
ki team ise dekh kar app mein Help & complaints mein jawab degi." Do not promise
what the team will decide.

If they ask for a person, do not argue: register the complaint as "needs_team"
straight away, tell them the team will reply in the app under Help & complaints,
and keep helping if they want to go on.`;

/** An app from before the helpline could act runs one tool, which registers the complaint. */
const SOLVE_WITHOUT_TOOLS = `
# You solve it, on this call
You are the helpline, not a switchboard: answer and explain what you can
yourself — why a fee was charged, what is owed, what to do next — from the
brief and the account state.
When something needs a change only the team can make — money back, a fee taken
off, a ride closed, a ban, commission — or they ask for a person, call
hand_to_human: it registers the complaint on the complaints desk. After it
returns, tell them their complaint is registered and the team will reply in the
app under Help & complaints.`;

/** The agent's whole brief: how to speak, who is calling, the rules, and the caller's own facts. */
export function helplineInstruction(
  role: HelplineRole,
  knowledge: string,
  accountState: string,
  canAct = true,
): string {
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

${canAct ? SOLVE_WITH_TOOLS : SOLVE_WITHOUT_TOOLS}

# Danger, harassment, scams
If anyone is in danger RIGHT NOW, the first thing you say is to call the police
on ${EMERGENCY_CHANNELS.police}, or ${EMERGENCY_CHANNELS.rescue} for an ambulance. Then register it with category
"safety" (or "online_scam" for fraud): it reaches the team as urgent.

# Never
- Never say you are transferring, connecting or forwarding the call, or putting
  them through to anyone. There is nobody to transfer to: you are the helpline.
- Never promise money, a refund, a waiver, an unlock or credit that a tool has
  not just confirmed.
- Never invent a fact. Use only the brief, the account state below and what
  your tools tell you.
- Never claim to be a person. If asked, say you are Velocity Rides' AI assistant.
- The brief below has rules for the WRITTEN support desk — handing over, scripts,
  bullet points. They do not apply to this call; the rules above do.

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

/** The one tool an app from before the helpline could act knows how to run. */
const HAND_TO_HUMAN = {
  name: 'hand_to_human',
  description:
    "Register this caller's complaint on the Velocity Rides complaints desk; the team replies in " +
    'the app under Help & complaints. Use it when the caller asks for a person, needs something ' +
    'only staff can do, or reports a safety problem or a scam.',
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
export function helplineSetup(instruction: string, canAct = true) {
  return {
    model: `models/${HELPLINE_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: HELPLINE_VOICE } } },
    },
    systemInstruction: { parts: [{ text: instruction }] },
    tools: [{ functionDeclarations: canAct ? HELPLINE_TOOLS : [HAND_TO_HUMAN] }],
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

  // The voice slot on AI keys & usage, else GEMINI_LIVE_KEY (a billed key keeps
  // call audio out of Google's training data and lifts the free tier's limit
  // on simultaneous calls), else the desk's key.
  await loadAi();
  const key = geminiKey('voice');
  if (!key) {
    logger.warn('helpline: no Gemini key — calls fall back to written support');
    return { available: false as const };
  }

  const context = await buildSupportContext(ctx.uid);
  const role: HelplineRole = context.snapshot.role === 'driver' ? 'driver' : 'passenger';
  // Only an app that forwards every tool call to helplineAction says so; older ones run hand_to_human alone.
  const canAct = (req.data as { actions?: unknown } | null)?.actions === true;
  const setup = helplineSetup(helplineInstruction(role, knowledgeFor(context), context.brief, canAct), canAct);

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
    canAct,
    ticketId: null,
    // What the agent was told, for whoever reviews the call later.
    context: context.snapshot,
    startedAt: FieldValue.serverTimestamp(),
    // The tools stop working with the token, whatever the phone says.
    expiresAt: Timestamp.fromMillis(Date.now() + (HELPLINE_MAX_SEC + 120) * 1000),
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
  /** Why Gemini closed a call that never connected, e.g. "1011 Your prepayment credits are depleted". */
  error: z.string().max(300).optional(),
});

type Line = z.infer<typeof lineSchema>;

/**
 * Settle the call's complaint when the phone hangs up.
 *
 * Every call where the caller said anything is on the desk. One the agent never
 * registered was answered on the call — unless the caller asked for a person,
 * which stays a hard escalation on the phone, as it is on the written desk, even
 * if the model never acted on it. The transcript goes on as one labelled note.
 */
async function settleCallTicket(caller: HelplineCaller, transcript: Line[]): Promise<string | null> {
  if (!transcript.some((t) => t.who === 'caller')) return null;
  const ref = await ensureCallTicket(caller);
  if ((await ref.get()).get('status') === 'ai_handling') {
    if (transcript.some((t) => t.who === 'caller' && asksForHuman(t.text))) {
      await registerComplaint(caller, { summary: 'The caller asked to speak to a person.', outcome: 'needs_team' });
    } else {
      await ref.set(
        {
          status: 'resolved' as SupportStatus,
          handler: 'ai',
          lastMessage: 'Answered on the helpline call',
          lastSender: 'ai',
          lastAt: FieldValue.serverTimestamp(),
          resolvedAt: FieldValue.serverTimestamp(),
          resolvedBy: 'ai',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }
  const note = [
    "📞 Helpline call — transcript as recorded by the caller's app:",
    ...transcript.map((t) => `${t.who === 'caller' ? 'Caller' : 'Assistant'}: ${t.text}`),
  ]
    .join('\n')
    .slice(0, 8000);
  await appendMessage({ ticketId: caller.callId, sender: 'system', senderName: 'Helpline call', text: note });
  return ref.id;
}

/**
 * The phone reports a call: when an older app's agent hands over, and when it hangs up.
 *
 * The hand-over of an app from before the helpline could act registers the
 * complaint for the team. The first hang-up settles the call's complaint and
 * puts the call on the AI meter.
 */
export const logHelplineCall = onCall(async (req) => {
  const ctx = requireAuth(req);
  const parsed = logSchema.safeParse(req.data);
  if (!parsed.success) invalid('Bad call record.');
  const { callId, handover, ended, error } = parsed.data;

  await rateLimit(ctx.uid, 'logHelplineCall', 40, 3600);
  // The phone said "busy" for two days while Google was refusing for billing; this is the line that says which.
  if (error) logger.error('helpline: Live closed before it connected', { callId, error });

  const ref = db.doc(`helplineCalls/${callId}`);
  const snap = await ref.get();
  if (!snap.exists || snap.get('uid') !== ctx.uid) {
    throw new HttpsError('permission-denied', 'This is not your call.');
  }

  const transcript = parsed.data.transcript.filter((t) => t.text.trim());
  const caller: HelplineCaller = { uid: ctx.uid, callId, snapshot: snap.get('context') as Record<string, unknown> | undefined };
  const firstEnd = ended && snap.get('status') !== 'ended';

  const message = handover
    ? (await registerComplaint(caller, { category: handover.category, summary: handover.summary, outcome: 'needs_team' })).result
    : '';
  let ticketId = handover ? callId : ((snap.get('ticketId') as string | null | undefined) ?? null);
  if (firstEnd) ticketId = (await settleCallTicket(caller, transcript)) ?? ticketId;

  const startedAt = (snap.get('startedAt') as { toMillis(): number } | undefined)?.toMillis();
  // Live is billed by the minute; the first `ended` puts the call on the AI meter, capped at the call limit.
  if (firstEnd && startedAt) {
    const seconds = Math.min(Math.round((Date.now() - startedAt) / 1000), HELPLINE_MAX_SEC);
    void recordAi({ model: HELPLINE_MODEL, usd: (seconds / 60) * LIVE_USD_PER_MIN, seconds, what: 'Helpline call' });
  }
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

  return { ok: true, ticketId, message };
});
