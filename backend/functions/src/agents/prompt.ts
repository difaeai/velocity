/**
 * What an AI agent is told, on a call and on WhatsApp. Pure.
 *
 * The same few rules hold in both places, because they are what keeps a
 * business's number and name out of trouble:
 *  - It says it is an AI assistant calling for the business, in the first breath.
 *  - It states only what the owner wrote down (product, offer, the knowledge
 *    box). A price, discount or date nobody gave it is never invented.
 *  - "Don't call me" / "stop" ends it, at once, and is recorded so it sticks.
 *  - WhatsApp details go only to someone who said yes to them on the call.
 */
import type { Caller, LeadFacts, Seller } from '../sales/write';

/** One calling agent as the Sales page sets it up. */
export interface AgentSetup extends Caller {
  id: string;
  voice: 'female' | 'male';
  /** Prices, packages, FAQs, delivery areas — the only facts it may state. */
  knowledge?: string;
}

/** Gemini Live voices: a woman's and a man's, both clear on a phone line. */
export const VOICE_NAMES: Record<AgentSetup['voice'], string> = { female: 'Aoede', male: 'Charon' };

/** The Live model the calls run on — the one the helpline already proved in Urdu. */
export const CALL_MODEL = 'gemini-3.8-live';
/** A Live session lasts about ten minutes; a sales call ends well before. */
export const CALL_MAX_SEC = 8 * 60;

const SPOKEN: Record<Caller['language'], string> = {
  urdu: 'Speak Pakistani Urdu (everyday words, not Hindi), in a warm, polite voice.',
  english: 'Speak clear, simple English with a Pakistani listener in mind.',
  mixed: 'Speak the everyday Urdu-English mix people in Pakistan actually use, in a warm, polite voice.',
};

export const CALL_RESULTS = ['interested', 'meeting', 'deal', 'callback', 'not_interested', 'do_not_call', 'wrong_number', 'voicemail'] as const;
export type CallResult = (typeof CALL_RESULTS)[number];

/** The one tool a call has: how it ended. The bridge hangs up after the goodbye. */
export const FINISH_CALL = {
  name: 'finish_call',
  description:
    'Call this once, when the conversation is over (after you have said goodbye, or at once if it is voicemail or the wrong number). It records how the call went.',
  parameters: {
    type: 'OBJECT',
    properties: {
      result: { type: 'STRING', enum: [...CALL_RESULTS], description: 'How the call ended.' },
      summary: { type: 'STRING', description: 'Two or three sentences in English for the business owner: who you spoke to, what they said, what happens next.' },
      whatsapp_ok: { type: 'BOOLEAN', description: 'True only if they said yes to receiving the details on WhatsApp on this number.' },
      callback_when: { type: 'STRING', description: 'When they asked to be called back, in their words. Empty otherwise.' },
      deal: { type: 'STRING', description: 'What they agreed to buy or book, with any details they gave. Empty otherwise.' },
    },
    required: ['result', 'summary', 'whatsapp_ok'],
  },
};

const facts = (seller: Seller, agent: AgentSetup): string =>
  [
    `The business: ${seller.senderCompany}.`,
    `What it sells: ${seller.product || 'not written down — ask what they need and offer to send details'}.`,
    seller.offer ? `What it can offer a new customer: ${seller.offer}` : '',
    agent.knowledge?.trim() ? `What you know (prices, packages, questions people ask). These are the ONLY facts you may state:\n${agent.knowledge.trim()}` : '',
    agent.points?.trim() ? `Points the owner wants made:\n${agent.points.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

const about = (lead: LeadFacts & { phone?: string | null }): string =>
  [
    `You are calling: ${lead.name}${lead.website ? ` (${lead.website})` : ''}.`,
    lead.title ? `Their site's title: ${lead.title}.` : '',
    lead.description ? `How they describe themselves: ${lead.description}` : '',
    lead.signals.length ? `What we saw: ${lead.signals.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

/** The system instruction for one outbound call. */
export function callInstruction(agent: AgentSetup, seller: Seller, lead: LeadFacts): string {
  return [
    `You are ${agent.name}, an AI sales assistant phoning businesses on behalf of ${seller.senderCompany}. This is a real phone call.`,
    SPOKEN[agent.language],
    facts(seller, agent),
    about(lead),
    `What this call is for: ${agent.goal || 'interest them enough to agree to a short follow-up, or to receive the details on WhatsApp'}.`,
    agent.opener?.trim() ? `How the owner likes calls to open: ${agent.opener.trim()}` : '',
    [
      'How you work:',
      `- First sentence: greet, say your name, that you are an AI assistant calling for ${seller.senderCompany}, and ask if it is a good moment.`,
      '- Short spoken sentences. Ask one question at a time and listen. Never talk over them.',
      '- Learn what they need before pitching; then connect what we sell to it.',
      '- State ONLY the facts above. If they ask something you were not told, say the team will confirm it on WhatsApp.',
      '- Never promise a price, discount, date or result that is not written above. Never pressure.',
      '- If they want details, ask: "Kya main yeh details aap ko isi number par WhatsApp kar doon?" and only set whatsapp_ok when they say yes.',
      '- If they want to buy or book, repeat back exactly what and when, and record it as the deal.',
      '- If they say they are not interested, thank them and end. If they say not to call again, apologise briefly and end with result do_not_call.',
      '- If it is voicemail, an automated menu or the wrong business, end at once.',
      '- Keep the whole call under four minutes. When it is done: say goodbye, then call finish_call.',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The Live session for a call, locked inside the token (no field mask). */
export function callSetup(agent: AgentSetup, instruction: string) {
  return {
    model: `models/${CALL_MODEL}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAMES[agent.voice] } } },
    },
    systemInstruction: { parts: [{ text: instruction }] },
    tools: [{ functionDeclarations: [FINISH_CALL] }],
    realtimeInputConfig: {
      automaticActivityDetection: {
        // A shop has a counter and a street behind it: noise must not count as them talking.
        startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
        endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
        prefixPaddingMs: 200,
        silenceDurationMs: 700,
      },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
}

export const WA_INTENTS = ['question', 'interested', 'meeting', 'deal', 'not_interested', 'stop', 'human'] as const;
export type WaIntent = (typeof WA_INTENTS)[number];

/** The system instruction for one WhatsApp reply. */
export function whatsappInstruction(agent: AgentSetup, seller: Seller, lead: LeadFacts | null): string {
  return [
    `You are ${agent.name}, the AI assistant answering WhatsApp for ${seller.senderCompany}. If anyone asks, you are an AI assistant and a person from the team can take over.`,
    facts(seller, agent),
    lead ? about(lead).replace('You are calling:', 'You are talking to:') : 'You are talking to someone who messaged the business.',
    `What you are working towards: ${agent.goal || 'answer their questions and, when they are ready, take the order or book the meeting'}.`,
    [
      'How you work:',
      '- Reply in the language and script they write in (Urdu, Roman Urdu or English). Short WhatsApp messages: one to four lines, no long lists.',
      '- State ONLY the facts above. Something you were not told: say the team will confirm, and set intent "human".',
      '- Never invent a price, discount, delivery date or stock.',
      '- When they want to buy or book: collect what, how many, when, where and their name; repeat it back; when they confirm, set intent "deal" (or "meeting") and put the details in "deal".',
      '- "Stop", "band karo", "no more messages": say sorry and that you will not message again; intent "stop".',
      '- They ask for a person, or are upset: tell them a person from the team will reply; intent "human".',
    ].join('\n'),
    'Reply with one JSON object and nothing else: {"reply": "the message to send", "intent": "question|interested|meeting|deal|not_interested|stop|human", "deal": "details when intent is deal or meeting, else empty"}',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The conversation so far, oldest first, as the model reads it. */
export function whatsappPrompt(messages: { from: 'them' | 'us'; text: string }[]): string {
  return messages
    .slice(-30)
    .map((m) => `${m.from === 'them' ? 'THEM' : 'US'}: ${m.text}`)
    .join('\n');
}
