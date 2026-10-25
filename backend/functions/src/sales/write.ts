/**
 * One short cold email per prospect, the way Harvey writes them: like a real
 * person, about something specific to them, under 75 words, one question, no
 * pitch and no links. The model writes; plain code decides whether it is fit to
 * send (`emailProblems`), and gets one rewrite if it is not.
 *
 * The footer — who is writing, a postal address, how to say no — is added by
 * `withFooter`, never by the model: it is the part the law cares about.
 */
import { generateJson } from '../social/engine';

export interface Draft {
  subject: string;
  body: string;
}

export interface LeadFacts {
  name: string;
  website: string | null;
  title: string;
  description: string;
  signals: string[];
}

export interface Seller {
  product: string;
  offer: string;
  senderName: string;
  senderCompany: string;
  senderAddress: string;
  language: string;
}

/** Lines that mark an email as machine-written or salesy. From Harvey's ban list. */
export const BANNED = [
  'i hope this finds you well',
  'i hope this email finds you',
  'i wanted to reach out',
  'reaching out',
  'circling back',
  'touch base',
  'just following up',
  'just checking in',
  'bumping this',
  'synergy',
  'game-changer',
  'game changer',
  'revolutionize',
  'revolutionise',
  'cutting-edge',
  'leverage',
  'dear sir',
  'dear madam',
  'to whom it may concern',
  'act now',
  'limited time',
  'guaranteed',
];

/** What is wrong with a draft, in words. Empty means send-ready. Pure. */
export function emailProblems(
  d: Draft,
  words: { min: number; max: number; target: number } = { min: 20, max: 90, target: 75 },
): string[] {
  const out: string[] = [];
  const body = d.body.toLowerCase();
  const count = d.body.trim().split(/\s+/).filter(Boolean).length;
  if (!d.subject.trim()) out.push('no subject');
  if (d.subject.length > 60) out.push('subject over 60 characters');
  if (count > words.max) out.push(`${count} words — keep it under ${words.target}`);
  if (count < words.min) out.push('too short to say anything');
  if (/https?:\/\/|www\./i.test(d.body)) out.push('a link in a first email');
  if (/\{\{|\}\}|\[name\]|\[company\]/i.test(`${d.subject} ${d.body}`)) out.push('an unfilled placeholder');
  for (const phrase of BANNED) if (body.includes(phrase) || d.subject.toLowerCase().includes(phrase)) out.push(`"${phrase}"`);
  if ((d.body.match(/\?/g) ?? []).length === 0) out.push('no question to answer');
  return out;
}

/** The part of every email the law cares about: who, where, and how to say no. */
export function withFooter(body: string, s: Pick<Seller, 'senderName' | 'senderCompany' | 'senderAddress'>): string {
  return [
    body.trim(),
    '',
    `${s.senderName}, ${s.senderCompany}`,
    s.senderAddress,
    'Not interested? Reply "no" and I won’t write again.',
  ].join('\n');
}

const RULES = `HOW TO WRITE IT — every rule matters:
- Write like a real person sending a real email to one person. Plain text.
- The first line is about THEM: something specific from what we saw about their business. Never sound like you scanned them ("I noticed your website lacks…" is a scan).
- Then one sentence on what we do that is relevant to that, in plain words. No feature list.
- End with one easy question they can answer in a line. Never ask for a call in the first email.
- 40 to 75 words in the body. Subject: 2 to 5 words, lower case is fine, no clickbait.
- No links, no attachments, no numbers you were not given, no promises, no flattery.
- Never use: ${BANNED.map((b) => `"${b}"`).join(', ')}.
- Do NOT add a signature, address or unsubscribe line — that is added for you.`;

export async function draftEmail(params: { model: string; seller: Seller; lead: LeadFacts }): Promise<Draft & { problems: string[] }> {
  const { seller, lead } = params;
  const system = [
    `You write first-touch cold emails for ${seller.senderName} at ${seller.senderCompany}.`,
    `What ${seller.senderCompany} sells: ${seller.product}`,
    seller.offer ? `What we can offer someone like this: ${seller.offer}` : '',
    `Write in ${seller.language || 'English'}.`,
    RULES,
    'Reply with one JSON object and nothing else: {"subject": "...", "body": "..."}',
  ]
    .filter(Boolean)
    .join('\n\n');
  const about = [
    `The business: ${lead.name}${lead.website ? ` (${lead.website})` : ''}.`,
    lead.title ? `Their site's title: ${lead.title}` : '',
    lead.description ? `How they describe themselves: ${lead.description}` : '',
    lead.signals.length ? `What we saw: ${lead.signals.join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const ask = async (extra: string) =>
    (await generateJson<{ subject?: string; body?: string }>({ model: params.model, what: 'The sales email', system, prompt: `${about}${extra}` }))
      .data;
  const clean = (d: { subject?: string; body?: string }): Draft => ({
    subject: String(d.subject ?? '').trim().slice(0, 120),
    body: String(d.body ?? '').trim().slice(0, 2000),
  });

  let draft = clean(await ask(''));
  let problems = emailProblems(draft);
  if (problems.length) {
    // One rewrite, kept only if it is better — never a loop.
    const second = clean(await ask(`\n\nYour last draft had these problems: ${problems.join('; ')}. Write it again without them.`));
    const again = emailProblems(second);
    if (again.length < problems.length) [draft, problems] = [second, again];
  }
  return { ...draft, problems };
}

const FOLLOW_RULES = (n: 1 | 2) => `HOW TO WRITE IT — every rule matters:
- ${n === 1 ? '25 to 50 words' : '15 to 35 words, and say plainly that this is the last email'}. Plain text, like a person.
- Do not repeat the first email. Give one new, specific reason to answer: a detail about them, or a small easy next step.
- End with one question they can answer in a line.
- No links, no pressure, no guilt. Never use: ${BANNED.map((b) => `"${b}"`).join(', ')}.
- Do NOT add a signature, address or unsubscribe line — that is added for you.`;

/**
 * A follow-up to someone who has not answered, in the same thread: shorter than
 * the first email, one new reason to reply, and the second one says it is the
 * last. Checked like the first email, against shorter limits.
 */
export async function draftFollowUp(params: {
  model: string;
  seller: Seller;
  lead: LeadFacts;
  first: Draft;
  n: 1 | 2;
}): Promise<Draft & { problems: string[] }> {
  const { seller, lead, first, n } = params;
  const { data } = await generateJson<{ body?: string }>({
    model: params.model,
    what: 'The follow-up',
    system: [
      `You write follow-up emails for ${seller.senderName} at ${seller.senderCompany}. They wrote once and have heard nothing back.`,
      `What ${seller.senderCompany} sells: ${seller.product}`,
      seller.offer ? `What we can offer someone like this: ${seller.offer}` : '',
      `Write in ${seller.language || 'English'}.`,
      FOLLOW_RULES(n),
      'Reply with one JSON object and nothing else: {"body": "..."}',
    ]
      .filter(Boolean)
      .join('\n\n'),
    prompt: `THE FIRST EMAIL:\nSubject: ${first.subject}\n${first.body}\n\nThe business: ${lead.name}${
      lead.description ? ` — ${lead.description}` : ''
    }.\n\nWrite follow-up number ${n}.`,
  });
  const draft = { subject: /^re:/i.test(first.subject) ? first.subject : `Re: ${first.subject}`, body: String(data.body ?? '').trim().slice(0, 1200) };
  return { ...draft, problems: emailProblems(draft, { min: 10, max: 60, target: 50 }) };
}

export type ReplyIntent = 'interested' | 'question' | 'not_now' | 'not_interested' | 'unsubscribe' | 'other';
const INTENTS: ReplyIntent[] = ['interested', 'question', 'not_now', 'not_interested', 'unsubscribe', 'other'];

const REPLY_RULES = `HOW TO ANSWER:
- First decide what they meant: interested, asking a question, "not now", not interested, or asking not to be written to again.
- Not interested, or asking not to be written to: no answer at all — the body is empty. Nobody argues with a no.
- Otherwise answer exactly what they asked, in 30 to 90 words, then propose ONE concrete next step: a short call at a time they choose, a sample, a visit, or a price for their case.
- Never invent a price, a date, a discount, a client or any fact you were not given — say you will confirm it instead.
- Plain text, warm and direct, no pressure. Do NOT add a signature or address — that is added for you.`;

/**
 * Read a reply and draft the answer that moves it one honest step towards a
 * sale. The answer always waits for the owner: it speaks to a real person about
 * a real deal, often about prices nobody told the model.
 */
export async function answerReply(params: {
  model: string;
  seller: Seller;
  lead: LeadFacts;
  ours: Draft;
  theirs: string;
}): Promise<{ intent: ReplyIntent; body: string }> {
  const { seller, lead } = params;
  const { data } = await generateJson<{ intent?: string; body?: string }>({
    model: params.model,
    what: 'The answer to a reply',
    system: [
      `You answer replies to cold emails for ${seller.senderName} at ${seller.senderCompany}. A prospect wrote back.`,
      `What ${seller.senderCompany} sells: ${seller.product}`,
      seller.offer ? `What we can offer: ${seller.offer}` : '',
      `Write in ${seller.language || 'English'}.`,
      REPLY_RULES,
      `Reply with one JSON object and nothing else: {"intent": ${INTENTS.map((i) => `"${i}"`).join(' | ')}, "body": "the answer, or empty"}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    prompt: `OUR EMAIL:\nSubject: ${params.ours.subject}\n${params.ours.body}\n\nTHEIR REPLY (from ${lead.name}):\n${params.theirs.slice(0, 3000)}`,
  });
  const intent = INTENTS.includes(data.intent as ReplyIntent) ? (data.intent as ReplyIntent) : 'other';
  const closed = intent === 'not_interested' || intent === 'unsubscribe';
  return { intent, body: closed ? '' : String(data.body ?? '').trim().slice(0, 2000) };
}

/** Who a calling agent is and what the call is for — set up on the Sales page. */
export interface Caller {
  name: string;
  language: 'urdu' | 'english' | 'mixed';
  goal: string;
  opener: string;
  points: string;
}

/** What to say on one call, in the order it is said. */
export interface CallScript {
  opener: string;
  pitch: string[];
  questions: string[];
  objections: { they: string; you: string }[];
  close: string;
}

const LANGUAGE: Record<Caller['language'], string> = {
  urdu: 'Urdu, written in Roman Urdu (Latin letters) so it can be read aloud from a screen',
  english: 'English',
  mixed: 'the everyday mix of Urdu and English people in Pakistan actually speak, written in Roman Urdu',
};

/** A plain script from the setup alone — what the caller says when no model answers. Pure. */
export function callScriptFallback(caller: Caller, seller: Pick<Seller, 'product' | 'offer' | 'senderCompany'>, lead: Pick<LeadFacts, 'name'>): CallScript {
  return {
    opener:
      caller.opener.trim() ||
      `${caller.language === 'english' ? 'Hello' : 'Assalam o alaikum'}, ${caller.name} from ${seller.senderCompany} here. ` +
        `Am I speaking with someone at ${lead.name}?`,
    pitch: [
      `We help businesses like ${lead.name}: ${seller.product}`.slice(0, 300),
      ...caller.points
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 3),
      ...(seller.offer ? [`For a new customer: ${seller.offer}`] : []),
    ],
    questions: ['How do you handle this today?', 'Who decides on this at your business?'],
    objections: [
      { they: 'We are not interested.', you: 'No problem at all — may I send a short message on WhatsApp in case it is useful later?' },
      { they: 'Send me the details.', you: 'Of course. Which WhatsApp number or email should I send them to?' },
    ],
    close: caller.goal.trim() ? `Ask for: ${caller.goal.trim()}` : 'Ask for a short meeting or a WhatsApp number to send details.',
  };
}

/**
 * A call script for one business: an opener about them, the pitch in three
 * short beats, two questions, the likely objections with an answer each, and
 * the ask. Read from the screen by the person dialling, so it is written to be
 * spoken — short sentences, no lists of features.
 */
export async function writeCallScript(params: {
  model: string;
  seller: Seller;
  caller: Caller;
  lead: LeadFacts;
}): Promise<CallScript> {
  const { seller, caller, lead } = params;
  const fallback = callScriptFallback(caller, seller, lead);
  try {
    const { data } = await generateJson<Partial<CallScript>>({
      model: params.model,
      what: 'The call script',
      system: [
        `You write sales call scripts for ${caller.name}, who phones businesses for ${seller.senderCompany}.`,
        `What ${seller.senderCompany} sells: ${seller.product}`,
        seller.offer ? `What we can offer a new customer: ${seller.offer}` : '',
        `What the call is for: ${caller.goal || 'a short meeting or a WhatsApp number to send details to'}.`,
        caller.points ? `Points the owner wants made:\n${caller.points}` : '',
        `Write in ${LANGUAGE[caller.language]}. It is read aloud: short spoken sentences, polite, never pushy, no numbers or promises you were not given.`,
        'Reply with one JSON object and nothing else: {"opener": "first 2 sentences, about THEM", "pitch": ["3 short beats"], "questions": ["2 easy questions"], "objections": [{"they": "what they may say", "you": "a calm answer"}], "close": "the one thing to ask for"}',
      ]
        .filter(Boolean)
        .join('\n\n'),
      prompt: [
        `The business: ${lead.name}${lead.website ? ` (${lead.website})` : ''}.`,
        lead.title ? `Their site's title: ${lead.title}` : '',
        lead.description ? `How they describe themselves: ${lead.description}` : '',
        lead.signals.length ? `What we saw: ${lead.signals.join('; ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    const line = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const lines = (v: unknown, n: number) =>
      Array.isArray(v) ? v.map((x) => line(x, 300)).filter(Boolean).slice(0, n) : [];
    const objections = Array.isArray(data.objections)
      ? data.objections
          .map((o) => ({ they: line(o?.they, 200), you: line(o?.you, 300) }))
          .filter((o) => o.they && o.you)
          .slice(0, 4)
      : [];
    return {
      opener: line(data.opener, 400) || fallback.opener,
      pitch: lines(data.pitch, 4).length ? lines(data.pitch, 4) : fallback.pitch,
      questions: lines(data.questions, 3).length ? lines(data.questions, 3) : fallback.questions,
      objections: objections.length ? objections : fallback.objections,
      close: line(data.close, 300) || fallback.close,
    };
  } catch {
    // No model, or one that answered in a shape we cannot read: the plain script still works on a call.
    return fallback;
  }
}
