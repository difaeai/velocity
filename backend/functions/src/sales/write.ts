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
export function emailProblems(d: Draft): string[] {
  const out: string[] = [];
  const body = d.body.toLowerCase();
  const words = d.body.trim().split(/\s+/).filter(Boolean).length;
  if (!d.subject.trim()) out.push('no subject');
  if (d.subject.length > 60) out.push('subject over 60 characters');
  if (words > 90) out.push(`${words} words — keep it under 75`);
  if (words < 20) out.push('too short to say anything');
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
