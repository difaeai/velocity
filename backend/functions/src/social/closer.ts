/**
 * The closer — Vexa answering leads on WhatsApp, from the client's own number,
 * and taking them from "kitna hai?" to a sale.
 *
 * Everything else on this desk brings strangers to the door. This is the half
 * that was missing: the ads run, the reels travel, somebody writes "price?" —
 * and then nothing happens until a human notices. Most small businesses lose
 * the lead there, not at the ad.
 *
 * HOW IT WORKS
 * ------------
 * The client registers their own WhatsApp number (its Cloud API phone-number id
 * and a token). Every inbound message to that number arrives at the one webhook
 * in `whatsapp/index.ts` and is routed here by `phone_number_id` — the only
 * thing on the payload that says whose number it is. The reply is written by
 * whoever answers the inbox on that desk (the same employee, the same brand
 * block, the same brief, and the same five-day directives from `review.ts`), and
 * it goes out from the client's number, so to the customer it is simply the
 * business answering.
 *
 * FOUR RULES THAT ARE NOT STYLE PREFERENCES
 * -----------------------------------------
 *  1. **Short, or it is not read.** WhatsApp is not email. `trimReply` cuts
 *     every outbound message to two sentences and 300 characters in code — not
 *     by asking the model nicely, because a model asked for "brief" writes six
 *     lines about a quarter of the time, and six lines is a message nobody
 *     reads. Owner's words: never long messages, users don't read them.
 *  2. **Their language, not ours.** `languageOf` reads what the person actually
 *     typed — English, Roman Urdu, or Urdu script — and the reply is written in
 *     that. Somebody who writes "bhai rate kya hai" and gets a paragraph of
 *     corporate English has been answered by a machine, and they know it.
 *  3. **A person-initiated conversation is always answered; a
 *     business-initiated one is rationed.** Meta lets a business reply freely
 *     for 24 hours after the customer's last message. Outside that window only
 *     an approved template may open a conversation, and every number has a
 *     daily business-initiated limit (new numbers start low — the hundred or so
 *     a day the owner had in mind, and it rises with the number's standing). So
 *     replies are never capped and outreach always is (`sendBudget`).
 *  4. **Stop means stop, and a sheet is not consent.** One "stop", "band karo",
 *     "بند" and that number is never messaged again. Uploading a list of
 *     numbers requires the client to state that those people asked to be
 *     contacted; the warning is in the callable and the claim is stored with
 *     the batch, because the number that gets reported is theirs.
 *
 * WHAT A HUMAN STILL DOES
 * -----------------------
 * Vexa hands a conversation over the moment the person asks for a human, says
 * anything that reads as a complaint, or has gone round the houses without
 * closing — and the client can take any chat over at any time from the console.
 * Money, delivery promises and anything legal are the client's to say, which is
 * what `HANDOVER_WORDS` and the system prompt exist to enforce.
 *
 * One number, one caveat worth knowing: a number on the Cloud API is a
 * business platform number. Meta's own coexistence feature is what lets the
 * client keep using it in the WhatsApp Business app at the same time, and it is
 * not available everywhere — either way the client can always read and take
 * over every conversation here.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue, SCHEDULE_REGION } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { classifySendError, postMessage, type SendResult } from '../whatsapp/client';
import { pktDayKey, pktHour, readInboundIntent } from '../whatsapp/policy';
import { loadCredentials } from './accounts';
import { brandName, systemFor } from './crew';
import { activeTeam, assign, creditWork } from './employees';
import { activeEngine, generateJson, modelReady } from './engine';
import { looksRomanUrdu } from './local';
import { listThreads, sendDm } from './platforms';
import { open, seal, tokenVaultReady, type SealedSecret } from './secrets';
import { getSocialSettings } from './settings';
import type { Employee } from './types';
import { canUse, type Workspace } from '../studio/plans';
import { currentWorkspace, deskCall, forEachWorkspace, inWorkspace, sdb, workspaceRef } from './workspace';

const CONFIG_PATH = 'system/whatsapp';
const SECRET_PATH = 'system/whatsapp/secret/credentials';

/** Which workspace a Cloud API number belongs to. Root level: the webhook has no workspace yet. */
export const numberRef = (phoneNumberId: string) => db.doc(`vexaNumbers/${phoneNumberId}`);
/** One lead's whole conversation, keyed by their WhatsApp id. */
export const chatRef = (waId: string) => sdb.doc(`salesChats/${waId}`);

/**
 * Instagram leads live in `salesChats` beside the WhatsApp ones — one funnel,
 * two doors — so the id has to say which inbox a reply goes back down. An
 * Instagram-scoped id is digits, exactly like a phone number, and a reply sent
 * down the wrong transport reaches a stranger or nobody at all.
 */
export const IG_PREFIX = 'ig_';
export const igsidOf = (waId: string): string | null =>
  waId.startsWith(IG_PREFIX) ? waId.slice(IG_PREFIX.length) : null;

/** The chat id for an inbound on either transport. */
export const chatIdFor = (channel: Channel, from: string): string =>
  channel === 'instagram' ? IG_PREFIX + from : (toNumber(from) ?? from);

/** A chat id as the console hands it back: already prefixed, or a phone number. */
export const chatIdOf = (raw: string): string => (raw.startsWith(IG_PREFIX) ? raw : (toNumber(raw) ?? raw));

/** Meta's service window: a free-form reply is only allowed this long after their last message. */
export const SERVICE_WINDOW_MS = 24 * 3600_000;
/** Nothing outbound before or after these hours, Pakistan time. A 3am pitch is a report. */
export const QUIET_BEFORE = 9;
export const QUIET_AFTER = 21;
/** Two sentences. Past this nobody reads it, so it is cut in code. */
export const MAX_REPLY_CHARS = 300;
/** How many business-initiated messages a day, until the client says otherwise. */
export const DEFAULT_DAILY_CAP = 100;
/** A quiet lead gets at most this many nudges, this far apart. */
export const MAX_FOLLOW_UPS = 2;
export const FOLLOW_UP_AFTER_MS = 20 * 3600_000;
/** Kept per chat: enough for the model to sound like it remembers, not enough to pay for a novel. */
export const KEEP_MESSAGES = 24;

// ── the shapes ──────────────────────────────────────────────────────────────

export type Lang = 'english' | 'roman-urdu' | 'urdu-script';

/** The two inboxes Vexa answers. Both land in the same conversation list. */
export type Channel = 'whatsapp' | 'instagram';

export const STAGES = ['new', 'talking', 'qualified', 'pitched', 'won', 'lost', 'needs_you', 'queued', 'stopped'] as const;
export type Stage = (typeof STAGES)[number];

export interface ChatMessage {
  from: 'them' | 'us';
  text: string;
  atMs: number;
  /** Set on an outbound that was drafted rather than sent, in approve mode. */
  draft?: boolean;
}

export interface SalesChat {
  /** Their WhatsApp id, which is the document id too. */
  waId: string;
  name: string | null;
  /** Where this lead came from. */
  source: 'whatsapp' | 'sheet' | 'instagram' | 'facebook' | 'comment';
  stage: Stage;
  language: Lang;
  messages: ChatMessage[];
  lastInboundAtMs: number | null;
  lastOutboundAtMs: number | null;
  /** What the conversation is about, one line, so the console reads at a glance. */
  summary: string;
  /**
   * What they are actually buying, in a few words — "2-day Hunza tour", "bridal
   * package". Separate from `summary` on purpose: the summary is a sentence
   * about this person, and the console needs a label it can count. Two sales of
   * the same thing have to land on the same string or "what sold today" is a
   * list of one-offs. Empty until Vexa knows.
   */
  wants: string;
  /** What Vexa intends to do next. */
  nextStep: string;
  followUps: number;
  /** A human has to take this one: asked for, or earned. */
  handover: boolean;
  /** Never message again: they said stop, or Meta says the number is dead. */
  blocked: boolean;
  blockedReason: string | null;
  /** For a sheet row: what the client said about them. */
  note?: string;
  /**
   * Instagram only — the timestamp of the last DM of theirs this desk has read,
   * in Meta's clock rather than ours. The inbox is polled, so the watermark
   * cannot be "when we last looked": a message that arrives while a sync is
   * running would then be older than the mark and never answered.
   */
  igSyncedUpToMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

/** The client's own WhatsApp, as this desk stores it (the token is sealed beside it). */
export interface CloserConfig {
  phoneNumberId: string | null;
  /** The number as people dial it, for the console. */
  displayNumber: string | null;
  wabaId: string | null;
  /** Approved MARKETING/UTILITY template, the only way to open a conversation. */
  templateName: string | null;
  templateLang: string;
  /** Business-initiated messages a day. */
  dailyCap: number;
  /** Whether Vexa sends by itself or drafts for the client. */
  sendMode: 'auto' | 'approve';
  sentDay: string | null;
  sentToday: number;
  connectedAtMs: number | null;
  lastInboundAtMs: number | null;
  /** The client's claim that the people on the sheet asked to be contacted. */
  outreachConsentAtMs: number | null;
}

export const DEFAULT_CONFIG: CloserConfig = {
  phoneNumberId: null,
  displayNumber: null,
  wabaId: null,
  templateName: null,
  templateLang: 'en',
  dailyCap: DEFAULT_DAILY_CAP,
  sendMode: 'auto',
  sentDay: null,
  sentToday: 0,
  connectedAtMs: null,
  lastInboundAtMs: null,
  outreachConsentAtMs: null,
};

// ── reading what they wrote ─────────────────────────────────────────────────

/** Urdu, Arabic and Persian script. */
const URDU_SCRIPT = /[\u0600-\u06FF\u0750-\u077F]/;

/**
 * What language to answer in, read from what they typed.
 *
 * Script wins outright. Roman Urdu is whatever the desk's own detector says it
 * is (`local/stages.ts`) rather than a second word list here: two detectors
 * that disagree about the same sentence is worse than one that is sometimes
 * thin, and improving that one improves the writer too.
 *
 * The fallback is the load-bearing part. Half of what people send is not
 * decisive — "ok", "2", "thanks", an emoji — and a conversation that has been
 * in Roman Urdu for ten messages must not turn into English because somebody
 * typed "ok". So only a message long enough to be decisive moves it. Pure.
 */
export function languageOf(text: string, fallback: Lang = 'english'): Lang {
  if (URDU_SCRIPT.test(text)) return 'urdu-script';
  if (looksRomanUrdu(text)) return 'roman-urdu';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.length >= 4 ? 'english' : fallback;
}

export const LANGUAGE_RULE: Record<Lang, string> = {
  english: 'They are writing in English. Reply in plain English. No Urdu words.',
  'roman-urdu':
    'They are mixing Roman Urdu with English, the way people in Pakistan actually message. Reply the same way — Roman Urdu in Latin letters with the English words people really use (price, booking, location). Never Urdu script, and never formal translated Urdu.',
  'urdu-script': 'They are writing in Urdu script. Reply in Urdu script, the way people speak it, not formal written Urdu.',
};

/**
 * Hold an outbound message to something a person will actually read: two
 * sentences, 300 characters, one line.
 *
 * Done here rather than trusted to the prompt, because this is the one rule the
 * owner stated twice and the one a model breaks most often. Pure.
 */
export function trimReply(raw: string): string {
  let s = String(raw ?? '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+/g, ' ')
    // A list or a paragraph break in a WhatsApp message is a wall of text.
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  if (!s) return '';
  // Two sentences at most. The split keeps the punctuation with its sentence.
  const parts = s.match(/[^.!?؟]+[.!?؟]*/g) ?? [s];
  if (parts.length > 2) s = parts.slice(0, 2).join('').trim();
  if (s.length > MAX_REPLY_CHARS) {
    const cut = s.slice(0, MAX_REPLY_CHARS);
    const space = cut.lastIndexOf(' ');
    s = `${(space > MAX_REPLY_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
  }
  return s;
}

/**
 * A WhatsApp number as anybody might write it: Pakistani in any of the four
 * usual shapes, or a full international number. Null when it is not a number we
 * could message.
 *
 * Wider than `whatsapp/client.ts`'s own normaliser on purpose: that one guards
 * Velocity's driver fan-out, where anything but a Pakistani mobile is a mistake.
 * A Vexa customer's leads are whoever writes to them. Pure.
 */
export function toNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0092')) d = d.slice(2);
  // A local number with no country code can only be read as the market's own,
  // and the market is Pakistan: 03xx xxxxxxx is eleven digits starting at zero.
  else if (d.startsWith('0') && d.length === 11) d = `92${d.slice(1)}`;
  else if (d.length === 10 && d.startsWith('3')) d = `92${d}`;
  // E.164: a country code and a subscriber number, no leading zero.
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

/** The number somebody typed into a sentence ("mera number 0317 581 2623 hai"). Pure. */
export function findNumber(text: string): string | null {
  // Longest digit runs first: "0317 5812623" is one number, not two.
  const runs = (text.match(/[+]?[\d][\d\s\-()]{7,20}\d/g) ?? []).sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length);
  for (const run of runs) {
    const n = toNumber(run);
    if (n) return n;
  }
  return null;
}

/** They said stop, in any of the three languages the drivers' bot already knows. Pure. */
export function isStop(text: string): boolean {
  return readInboundIntent(text) === 'stop';
}

/**
 * Words that mean this conversation is not Vexa's to have: a complaint, a
 * refund, a lawyer, or somebody plainly asking for a person.
 */
const HANDOVER_WORDS = [
  'refund', 'complaint', 'complain', 'legal', 'lawyer', 'police', 'fraud', 'scam', 'cheat',
  'manager', 'owner se', 'malik', 'baat karao', 'baat karwao', 'call me', 'call karo', 'phone karo',
  'speak to', 'talk to someone', 'human', 'shikayat', 'paisa wapas', 'wapas karo',
];

/** Whether this message has to go to a human. Pure. */
export function wantsHuman(text: string): boolean {
  const s = text.toLowerCase();
  return HANDOVER_WORDS.some((w) => s.includes(w));
}

/** The stage the model asked for, held to the list. Pure. */
export function cleanStage(raw: unknown, fallback: Stage): Stage {
  return STAGES.includes(raw as Stage) ? (raw as Stage) : fallback;
}

/**
 * How many business-initiated messages may still go out today.
 *
 * Replies inside the service window are not counted and never blocked: a person
 * who wrote to the business gets an answer, whatever the cap. This is the
 * number WhatsApp itself rations — a new number starts at a few hundred
 * conversations a day and earns more as its standing improves, so the client's
 * own cap is the floor of the two. Pure.
 */
export function sendBudget(cfg: Pick<CloserConfig, 'dailyCap' | 'sentDay' | 'sentToday'>, nowMs: number): number {
  const today = pktDayKey(nowMs);
  const used = cfg.sentDay === today ? cfg.sentToday : 0;
  return Math.max(0, Math.min(cfg.dailyCap, 1000) - used);
}

/** Whether a free-form message is allowed right now, or only a template. Pure. */
export function canFreeForm(lastInboundAtMs: number | null, nowMs: number): boolean {
  return lastInboundAtMs !== null && nowMs - lastInboundAtMs < SERVICE_WINDOW_MS;
}

/** Nothing goes out in the middle of the night. Pure. */
export function isQuiet(nowMs: number): boolean {
  const h = pktHour(nowMs);
  return h < QUIET_BEFORE || h >= QUIET_AFTER;
}

/** One pasted sheet of numbers, cleaned: deduped, normalised, capped. Pure. */
export function parseSheet(raw: string, max = 500): { number: string; name: string; note: string }[] {
  const out = new Map<string, { number: string; name: string; note: string }>();
  for (const line of raw.split(/[\r\n]+/)) {
    if (!line.trim()) continue;
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ''));
    // The number can be in any column: a sheet exported from a phone puts it second.
    let number: string | null = null;
    let numberAt = -1;
    for (let i = 0; i < cells.length; i++) {
      const n = toNumber(cells[i]);
      if (n) {
        number = n;
        numberAt = i;
        break;
      }
    }
    if (!number || out.has(number)) continue;
    const rest = cells.filter((_, i) => i !== numberAt).filter(Boolean);
    out.set(number, { number, name: (rest[0] ?? '').slice(0, 60), note: (rest[1] ?? '').slice(0, 160) });
    if (out.size >= max) break;
  }
  return [...out.values()];
}

/** A fresh chat row. Pure. */
export function newChat(params: { waId: string; name?: string | null; source: SalesChat['source']; note?: string; stage?: Stage; nowMs: number }): SalesChat {
  return {
    waId: params.waId,
    name: params.name ?? null,
    source: params.source,
    stage: params.stage ?? 'new',
    language: 'english',
    messages: [],
    lastInboundAtMs: null,
    lastOutboundAtMs: null,
    summary: '',
    wants: '',
    nextStep: '',
    followUps: 0,
    handover: false,
    blocked: false,
    blockedReason: null,
    ...(params.note ? { note: params.note } : {}),
    createdAtMs: params.nowMs,
    updatedAtMs: params.nowMs,
  };
}

/** The conversation so far, as the prompt reads it. Pure. */
export function transcript(chat: SalesChat): string {
  return chat.messages
    .slice(-KEEP_MESSAGES)
    .map((m) => `${m.from === 'them' ? 'THEM' : 'US'}: ${m.text}`)
    .join('\n');
}

// ── the client's number ─────────────────────────────────────────────────────

export async function closerConfig(): Promise<CloserConfig> {
  const snap = await sdb.doc(CONFIG_PATH).get();
  return { ...DEFAULT_CONFIG, ...((snap.data() as Partial<CloserConfig> | undefined) ?? {}) };
}

async function closerToken(): Promise<string | null> {
  const sealed = (await sdb.doc(SECRET_PATH).get()).data()?.token as SealedSecret | undefined;
  if (!sealed) return null;
  try {
    return open(sealed);
  } catch (e) {
    logger.error('closer: the stored WhatsApp token could not be opened', { error: (e as Error).message });
    return null;
  }
}

/** Which workspace a number belongs to, or null when it is not a Vexa number. */
export async function workspaceForNumber(phoneNumberId: string): Promise<string | null> {
  const snap = await numberRef(phoneNumberId).get();
  return (snap.data() as { wid?: string } | undefined)?.wid ?? null;
}

/** Put one message on the client's number. Never throws. */
async function send(to: string, body: string, cfg: CloserConfig, token: string): Promise<SendResult> {
  return postMessage(
    { token, phoneNumberId: cfg.phoneNumberId as string },
    { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: false } },
  );
}

/**
 * How a reply reaches this lead, or null when that inbox is not connected.
 *
 * The chat's own id decides it, never the caller: WhatsApp and Instagram are
 * two transports onto one conversation list, and a message put down the wrong
 * one is delivered to a stranger or to nobody at all.
 */
async function transportFor(waId: string): Promise<((text: string) => Promise<SendResult>) | null> {
  const igsid = igsidOf(waId);
  if (igsid) {
    const creds = await loadCredentials('instagram');
    if (!creds) return null;
    return async (text) => {
      try {
        const messageId = await sendDm('instagram', creds, igsid, text);
        return { ok: true, messageId: messageId || null };
      } catch (e) {
        // Meta's own words. "Outside the allowed window" and "this person
        // blocked you" need different answers from the console, and only the
        // message it sends back tells them apart.
        return { ok: false, code: null, action: 'ignore', detail: (e as Error).message.slice(0, 300) };
      }
    };
  }
  const cfg = await closerConfig();
  const token = await closerToken();
  if (!cfg.phoneNumberId || !token) return null;
  return (text) => send(waId, text, cfg, token);
}

/** Open a conversation with the client's approved template. Never throws. */
async function sendTemplate(to: string, cfg: CloserConfig, token: string, params: string[]): Promise<SendResult> {
  return postMessage(
    { token, phoneNumberId: cfg.phoneNumberId as string },
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: cfg.templateName as string,
        language: { code: cfg.templateLang || 'en' },
        ...(params.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
      },
    },
  );
}

/** Count one business-initiated message against today's cap. */
async function countSend(nowMs: number): Promise<void> {
  const today = pktDayKey(nowMs);
  const cfg = await closerConfig();
  await sdb.doc(CONFIG_PATH).set(
    { sentDay: today, sentToday: cfg.sentDay === today ? cfg.sentToday + 1 : 1 },
    { merge: true },
  );
}

/** What a failed send means for this lead. Meta's own classification decides. */
async function afterFailure(chat: SalesChat, result: Extract<SendResult, { ok: false }>): Promise<void> {
  if (result.action === 'drop-recipient') {
    await chatRef(chat.waId).set(
      { blocked: true, blockedReason: `WhatsApp cannot deliver to this number (${result.detail})`.slice(0, 200), updatedAtMs: Date.now() },
      { merge: true },
    );
    return;
  }
  logger.warn('closer: a message could not be sent', { wid: currentWorkspace(), code: result.code, action: result.action });
}

// ── what Vexa says ─────────────────────────────────────────────────────────

const CLOSER_SYSTEM = (brand: string, lang: Lang, needNumber: boolean): string => `You are answering this business's WhatsApp. The person on the other side is a real customer of ${brand}, and to them you are simply the business.

Your job is to turn a question into a sale: understand what they want, answer it straight, give the price or the next step, and ask for the one thing that moves it forward. Nothing else.

HOW YOU WRITE — these are hard rules:
- TWO SENTENCES. WhatsApp, not email. A long message does not get read, and a wall of text reads as a bot.
- ${LANGUAGE_RULE[lang]}
- Write like a person who works there: no greeting rituals, no "I hope this message finds you well", no bullet points, no emoji walls, at most one emoji and usually none.
- Ask ONE question at a time. Two questions in one message gets one answered.
- Never invent a price, a discount, a delivery time, a stock level or an address. If you were not told it, say you will confirm it and ask what you need to in order to confirm.
- Never promise a refund, settle a complaint or argue. Those belong to the owner.
- Never say you are an AI, a bot or an assistant, and never pretend to be a specific named person either.
${needNumber ? '- You do not have their phone number yet. Ask for it once, in the same breath as something useful to them ("send me your number and I will send you the full list").\n' : ''}
WHERE THE CONVERSATION IS GOING. Use the stage to decide what this message is for:
- new / talking: find out what they actually want and what it is for. One question.
- qualified: you know what they want — give the price or the offer, plainly.
- pitched: ask for the close. A time, a confirmation, an address, a payment — whatever the next real step is.
- won: they agreed. Confirm what happens next in one line.
- lost / stopped: say nothing more than a polite close.

Reply with one JSON object and nothing else:
{
  "reply": "the message, two sentences at most, in their language",
  "stage": "new | talking | qualified | pitched | won | lost | needs_you",
  "summary": "what this lead wants, one short line, in English, for the owner's console",
  "wants": "the thing they are buying, 2-5 words, in English, as the business itself would name it on a price list — the SAME words every time for the same thing, so the owner can count them. Empty string until you know.",
  "nextStep": "what you will do next, one short line, in English",
  "handover": true only if a human must take this over (a complaint, a refund, anything legal, or they asked for a person)
}`;

/**
 * Whether Vexa still has to get their phone number before it can carry on.
 *
 * A WhatsApp lead arrived with theirs. A lead that came from a comment or a DM
 * did not, and getting it is the first job of that conversation. Pure.
 */
export const needsNumber = (chat: Pick<SalesChat, 'source'>): boolean => chat.source !== 'whatsapp' && chat.source !== 'sheet';

/** Who answers the inbox on this desk. */
async function closerPerson(): Promise<Employee | null> {
  const team = await activeTeam();
  return assign(team, 'distribute')?.employee ?? assign(team, 'script')?.employee ?? null;
}

export interface Drafted {
  reply: string;
  stage: Stage;
  summary: string;
  wants: string;
  nextStep: string;
  handover: boolean;
}

/**
 * What to say next. One model call, held to two sentences by `trimReply` after
 * it answers. Null when there is no model, in which case nothing is sent at all
 * — a holding reply from a desk that cannot think is worse than a business that
 * has not replied yet.
 */
export async function draft(chat: SalesChat, needNumber: boolean): Promise<Drafted | null> {
  if (!modelReady()) return null;
  const settings = await getSocialSettings();
  const person = await closerPerson();
  if (!person) return null;

  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: [systemFor(person, settings), CLOSER_SYSTEM(brandName(), chat.language, needNumber)].join('\n\n'),
      what: 'A WhatsApp reply to a lead',
      prompt: [
        `STAGE: ${chat.stage}. ${chat.summary ? `WHAT WE KNOW: ${chat.summary}` : 'We know nothing about them yet.'}`,
        chat.note ? `WHAT THE OWNER SAID ABOUT THEM: ${chat.note}` : '',
        chat.name ? `THEIR NAME ON WHATSAPP: ${chat.name}` : '',
        '',
        'THE CONVERSATION SO FAR:',
        transcript(chat) || '(they have not written anything yet)',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    const reply = trimReply(typeof data.reply === 'string' ? data.reply : '');
    if (!reply) return null;
    await creditWork(person.id).catch(() => undefined);
    return {
      reply,
      stage: cleanStage(data.stage, chat.stage === 'new' ? 'talking' : chat.stage),
      summary: typeof data.summary === 'string' ? data.summary.trim().slice(0, 200) : chat.summary,
      // Never cleared once known: a later turn that drops the field would
      // otherwise wipe what this sale was for, and "sold today" would lose it.
      wants: (typeof data.wants === 'string' ? data.wants.trim().slice(0, 60) : '') || chat.wants || '',
      nextStep: typeof data.nextStep === 'string' ? data.nextStep.trim().slice(0, 200) : '',
      handover: data.handover === true,
    };
  } catch (e) {
    logger.warn('closer: could not write a reply', { wid: currentWorkspace(), error: (e as Error).message });
    return null;
  }
}

// ── the conversation ────────────────────────────────────────────────────────

/**
 * One inbound WhatsApp message to a client's number.
 *
 * Returns true when this was a Vexa number and has been dealt with, so the
 * driver-alert webhook leaves it alone.
 */
export async function handleInbound(params: {
  phoneNumberId: string;
  from: string;
  name: string | null;
  text: string;
}): Promise<boolean> {
  const wid = await workspaceForNumber(params.phoneNumberId);
  if (!wid) return false;
  // A trial that ended or a month that was not paid stops Vexa talking, but it
  // does not lose the lead: the message is kept, and the owner finds it waiting
  // when they come back. Without this check a lapsed workspace keeps selling on
  // somebody else's model budget.
  const ws = (await workspaceRef(wid).get()).data() as Workspace | undefined;
  const live = Boolean(ws) && canUse(ws as Workspace, 'sales', Date.now());
  await inWorkspace(wid, () => receive(params.from, params.name, params.text, live));
  return true;
}

/**
 * The body of it, inside the workspace.
 *
 * Their message is written to the conversation before anything slow happens.
 * Two messages seconds apart are ordinary — "salam", then "rate?" — and a
 * read-modify-write around a model call would quietly drop one of them, because
 * the second read happens before the first write lands. Every append here is an
 * `arrayUnion`, which is atomic, so nothing a customer says is ever lost.
 */
async function receive(
  from: string,
  name: string | null,
  text: string,
  live = true,
  channel: Channel = 'whatsapp',
  atMs?: number,
): Promise<void> {
  const nowMs = Date.now();
  // When they wrote, in Meta's clock, not when we read it. WhatsApp arrives on a
  // webhook, so the two are the same; Instagram is polled, and a DM can be hours
  // old by the time a sweep sees it. The 24-hour window runs from their message,
  // so stamping the time of the sync made the console offer a reply box on
  // threads every send to which Instagram refuses as "(#10) outside of allowed
  // window".
  const saidAtMs = atMs ?? nowMs;
  const waId = chatIdFor(channel, from);
  const said = text.trim().slice(0, 2000);
  if (!said) return;

  const ref = chatRef(waId);
  const existing = (await ref.get()).data() as SalesChat | undefined;
  const chat: SalesChat = existing ?? newChat({ waId, name, source: channel, nowMs });
  const theirs: ChatMessage = { from: 'them', text: said, atMs: saidAtMs };

  chat.name = chat.name ?? name;
  chat.language = languageOf(said, chat.language);
  chat.messages = [...chat.messages, theirs].slice(-KEEP_MESSAGES);
  chat.lastInboundAtMs = saidAtMs;
  chat.updatedAtMs = nowMs;

  /** Their message, the fields it moved, and whatever else this turn decided. */
  const keep = async (fields: Partial<SalesChat>, ours?: ChatMessage): Promise<void> => {
    const union = ours ? [theirs, ours] : [theirs];
    await ref.set(
      {
        // Everything but the array, which is appended to rather than replaced.
        ...(existing ? {} : newChat({ waId, name, source: channel, nowMs })),
        name: chat.name,
        language: chat.language,
        lastInboundAtMs: saidAtMs,
        updatedAtMs: Date.now(),
        ...fields,
        messages: FieldValue.arrayUnion(...union),
      } as unknown as Partial<SalesChat>,
      { merge: true },
    );
    // The array only ever grows through arrayUnion, so it is trimmed here when
    // it has outgrown what a prompt needs.
    // shortcut: the trim itself is a plain write, so a message that arrives in
    // the same instant could be trimmed away with the oldest ones. It only runs
    // on a chat already at the cap; move it into a transaction if a desk ever
    // runs long conversations where that window matters.
    if (chat.messages.length + (ours ? 1 : 0) > KEEP_MESSAGES) {
      await ref.set({ messages: [...chat.messages, ...(ours ? [ours] : [])].slice(-KEEP_MESSAGES) }, { merge: true });
    }
  };

  // Stop is absolute, and is the one thing that never waits for a model.
  if (isStop(said)) {
    await keep({ stage: 'stopped', blocked: true, blockedReason: 'They asked us to stop.' });
    await sdb.doc(CONFIG_PATH).set({ lastInboundAtMs: nowMs }, { merge: true });
    return;
  }

  if (wantsHuman(said)) chat.handover = true;

  const cfg = await closerConfig();
  await sdb.doc(CONFIG_PATH).set({ lastInboundAtMs: nowMs }, { merge: true });

  // A conversation a person has to take is not one Vexa keeps talking in.
  if (chat.handover) {
    await keep({ handover: true, stage: 'needs_you', nextStep: 'Waiting for you: they asked for a person, or it is a complaint.' });
    return;
  }

  if (!live) {
    await keep({
      stage: 'needs_you',
      nextStep: 'Vexa is paused because the plan has run out. Pay for a month and it answers again.',
    });
    return;
  }

  const written = await draft(chat, needsNumber(chat));
  if (!written) {
    await keep({ stage: 'needs_you', nextStep: 'Vexa could not write a reply, so this one is yours.' });
    return;
  }

  const moved: Partial<SalesChat> = {
    stage: written.handover ? 'needs_you' : written.stage,
    summary: written.summary,
    wants: written.wants,
    nextStep: written.nextStep,
    handover: written.handover,
  };

  const outbound = await transportFor(waId);
  if (cfg.sendMode === 'approve' || written.handover || !outbound) {
    await keep(moved, { from: 'us', text: written.reply, atMs: Date.now(), draft: true });
    return;
  }

  const result = await outbound(written.reply);
  if (result.ok) {
    await keep({ ...moved, lastOutboundAtMs: Date.now(), followUps: 0 }, { from: 'us', text: written.reply, atMs: Date.now() });
  } else {
    await keep(moved);
    await afterFailure(chat, result);
  }
}

/**
 * Read the Instagram inbox and hand anything new to the engine that already
 * answers WhatsApp.
 *
 * Polled rather than pushed, deliberately. An Instagram messages webhook needs
 * the Page subscribed to it, which is one more permission to justify at app
 * review, and a sales inbox read every fifteen minutes is not a worse product
 * than one read instantly.
 *
 * Nothing is answered outside Meta's 24-hour window. That is not manners: the
 * send would be refused anyway, and without the check, connecting an inbox with
 * months of old threads in it would try to answer every one of them at once.
 */
export async function syncInstagramDms(live = true): Promise<{ threads: number; answered: number }> {
  const creds = await loadCredentials('instagram');
  if (!creds) return { threads: 0, answered: 0 };

  const threads = await listThreads('instagram', creds, 25);
  const nowMs = Date.now();
  let answered = 0;

  for (const thread of threads) {
    const ref = chatRef(IG_PREFIX + thread.participantId);
    const existing = (await ref.get()).data() as SalesChat | undefined;
    const since = existing?.igSyncedUpToMs ?? 0;
    const fresh = thread.messages.filter((m) => !m.fromUs && m.atMs > since);
    const latest = fresh[fresh.length - 1];

    if (!latest || !canFreeForm(latest.atMs, nowMs)) {
      // Nothing to answer — but the window on this thread is still worth
      // correcting. A sweep before this one stamped the time it looked rather
      // than the time they wrote, which leaves the console offering a reply box
      // Instagram will refuse. Meta's own clock is the authority, so take it
      // from the inbox every time the inbox is open.
      const theirLast = thread.messages.filter((m) => !m.fromUs).pop()?.atMs;
      if (existing && theirLast !== undefined && existing.lastInboundAtMs !== theirLast) {
        await ref.set({ lastInboundAtMs: theirLast }, { merge: true });
      }
      continue;
    }

    // "salam", then "rate?" seconds later is one turn of a conversation.
    // Answering each separately is two model bills and two replies to somebody
    // who asked one question.
    const said = fresh
      .slice(-5)
      .map((m) => m.text)
      .join('\n');
    await receive(thread.participantId, thread.participantName, said, live, 'instagram', latest.atMs);
    // Written after the turn, so a crash mid-reply re-reads the message rather
    // than losing it.
    await ref.set({ igSyncedUpToMs: latest.atMs }, { merge: true });
    answered += 1;
  }

  return { threads: threads.length, answered };
}

/** A failed delivery reported later by Meta's webhook. */
export async function handleFailure(phoneNumberId: string, recipient: string, code: number | null, detail: string): Promise<boolean> {
  const wid = await workspaceForNumber(phoneNumberId);
  if (!wid) return false;
  if (classifySendError(code) !== 'drop-recipient') return true;
  await inWorkspace(wid, async () => {
    const waId = toNumber(recipient) ?? recipient;
    if ((await chatRef(waId).get()).exists) {
      await chatRef(waId).set({ blocked: true, blockedReason: `${detail} (${code})`.slice(0, 200), updatedAtMs: Date.now() }, { merge: true });
    }
  });
  return true;
}

// ── outreach, and the nudge ─────────────────────────────────────────────────

/**
 * The queued sheet rows and the leads who went quiet, in that order, inside
 * today's budget and never in the night.
 *
 * A queued row is opened with the approved template — the only legal way to
 * start a conversation — and the conversation itself then happens inside the
 * 24-hour window like any other. A quiet lead gets at most two nudges.
 */
export async function runOutreach(nowMs = Date.now()): Promise<string> {
  const cfg = await closerConfig();
  if (!cfg.phoneNumberId) return 'No WhatsApp number is connected.';
  if (isQuiet(nowMs)) return 'Quiet hours: nothing sent.';
  const token = await closerToken();
  if (!token) return 'The WhatsApp token for this number could not be read.';

  let budget = sendBudget(cfg, nowMs);
  let opened = 0;
  let nudged = 0;

  // ── the sheet ──
  if (budget > 0 && cfg.templateName && cfg.outreachConsentAtMs) {
    const queued = await sdb.collection('salesChats').where('stage', '==', 'queued').limit(Math.min(budget, 50)).get();
    for (const doc of queued.docs) {
      if (budget <= 0) break;
      const chat = doc.data() as SalesChat;
      if (chat.blocked) continue;
      const result = await sendTemplate(chat.waId, cfg, token, [chat.name || 'there']);
      if (result.ok) {
        budget--;
        opened++;
        await countSend(nowMs);
        await doc.ref.set(
          {
            stage: 'talking',
            lastOutboundAtMs: nowMs,
            updatedAtMs: nowMs,
            nextStep: 'Waiting for them to reply to the first message.',
            messages: FieldValue.arrayUnion({ from: 'us', text: `(${cfg.templateName})`, atMs: nowMs }),
          },
          { merge: true },
        );
      } else {
        await afterFailure(chat, result);
        // A template Meta refuses will be refused for every row: stop the batch.
        if (result.action === 'halt') break;
      }
    }
  }

  // ── the nudge ──
  const quiet = await sdb
    .collection('salesChats')
    .where('stage', 'in', ['talking', 'qualified', 'pitched'])
    .limit(40)
    .get();
  for (const doc of quiet.docs) {
    const chat = doc.data() as SalesChat;
    if (chat.blocked || chat.handover || chat.followUps >= MAX_FOLLOW_UPS) continue;
    const since = Math.max(chat.lastInboundAtMs ?? 0, chat.lastOutboundAtMs ?? 0);
    if (!since || nowMs - since < FOLLOW_UP_AFTER_MS) continue;
    // A nudge is for a lead who stopped replying to US. One whose own message
    // is the last thing in the thread is waiting on an answer, not a nudge —
    // and that answer is `receive`'s job, not this one's.
    if ((chat.lastInboundAtMs ?? 0) > (chat.lastOutboundAtMs ?? 0)) continue;

    const free = canFreeForm(chat.lastInboundAtMs, nowMs);
    if (!free && (budget <= 0 || !cfg.templateName)) continue;

    const written = free ? await draft(chat, needsNumber(chat)) : null;
    const result = free
      ? written
        ? await send(chat.waId, written.reply, cfg, token)
        : null
      : await sendTemplate(chat.waId, cfg, token, [chat.name || 'there']);
    if (!result) continue;
    if (result.ok) {
      nudged++;
      if (!free) {
        budget--;
        await countSend(nowMs);
      }
      await doc.ref.set(
        {
          followUps: chat.followUps + 1,
          lastOutboundAtMs: nowMs,
          updatedAtMs: nowMs,
          ...(written ? { summary: written.summary, wants: written.wants, nextStep: written.nextStep } : {}),
          messages: FieldValue.arrayUnion({ from: 'us', text: written ? written.reply : `(${cfg.templateName})`, atMs: nowMs }),
        },
        { merge: true },
      );
    } else {
      await afterFailure(chat, result);
    }
  }

  return `${opened} new conversations opened, ${nudged} leads nudged, ${budget} of today's messages left.`;
}

// ── the console ─────────────────────────────────────────────────────────────

/**
 * Register the client's own WhatsApp number.
 *
 * The phone-number id and a permanent token, both from their WhatsApp Business
 * account. The pair is proved against Meta before anything is stored, because a
 * typo here looks exactly like a silent product at 2am.
 */
export const vexaConnectWhatsApp = deskCall('sales', async (req) => {
  requireAuth(req);
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const parsed = z
    .object({
      phoneNumberId: z.string().trim().regex(/^\d{8,30}$/),
      token: z.string().trim().min(40).max(500),
      templateName: z.string().trim().max(80).optional(),
      templateLang: z.string().trim().max(10).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Paste the phone number ID and the access token from your WhatsApp Business account.');
  const { phoneNumberId, token } = parsed.data;

  // Whose number is this, and is the token really good for it?
  //
  // Only fields the phone-number node actually carries. It was also asked for
  // `whatsapp_business_account`, which that node does not have, so Meta answered
  // every connect with "(#100) Tried accessing nonexisting field" and no number
  // could ever be connected here. The id it would have returned is written to
  // the config and read by nobody — the cost reader has its own WHATSAPP_WABA_ID
  // — so it is not worth a second call to recover.
  let display: string | null = null;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string;
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(body.error?.message ?? `Meta answered ${res.status}`);
    display = body.display_phone_number ?? null;
  } catch (e) {
    throw new HttpsError('failed-precondition', `That number and token did not work together: ${(e as Error).message}`.slice(0, 300));
  }

  // One number belongs to one workspace: otherwise an inbound message has two homes.
  const taken = await workspaceForNumber(phoneNumberId);
  if (taken && taken !== currentWorkspace()) {
    throw new HttpsError('already-exists', 'That WhatsApp number is already connected to another Vexa workspace.');
  }

  await sdb.doc(SECRET_PATH).set({ token: seal(token) });
  await sdb.doc(CONFIG_PATH).set(
    {
      phoneNumberId,
      displayNumber: display,
      wabaId: null,
      connectedAtMs: Date.now(),
      ...(parsed.data.templateName ? { templateName: parsed.data.templateName } : {}),
      ...(parsed.data.templateLang ? { templateLang: parsed.data.templateLang } : {}),
    },
    { merge: true },
  );
  await numberRef(phoneNumberId).set({ wid: currentWorkspace(), atMs: Date.now() });
  return { ok: true, displayNumber: display, wabaId: null };
});

export const vexaDisconnectWhatsApp = deskCall('sales', async () => {
  const cfg = await closerConfig();
  if (cfg.phoneNumberId) await numberRef(cfg.phoneNumberId).delete();
  await sdb.doc(SECRET_PATH).delete();
  await sdb.doc(CONFIG_PATH).set({ phoneNumberId: null, displayNumber: null, wabaId: null, connectedAtMs: null }, { merge: true });
  return { ok: true };
});

export const vexaSetCloserSettings = deskCall('sales', async (req) => {
  requireAuth(req);
  const parsed = z
    .object({
      dailyCap: z.number().int().min(0).max(1000).optional(),
      sendMode: z.enum(['auto', 'approve']).optional(),
      templateName: z.string().trim().max(80).nullable().optional(),
      templateLang: z.string().trim().max(10).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid settings.');
  await sdb.doc(CONFIG_PATH).set({ ...parsed.data, updatedAtMs: Date.now() }, { merge: true });
  return { ok: true, config: await closerConfig() };
});

/**
 * A sheet of numbers to pitch.
 *
 * `consent` is not a formality: these are business-initiated marketing
 * messages, they go out on the client's own number, and a list of people who
 * never asked is how that number gets reported and then restricted. The claim
 * is stored with the batch.
 */
export const vexaUploadSheet = deskCall('sales', async (req) => {
  requireAuth(req);
  const parsed = z
    .object({ rows: z.string().min(3).max(200_000), consent: z.literal(true) })
    .safeParse(req.data ?? {});
  if (!parsed.success) {
    throw new HttpsError(
      'invalid-argument',
      'Paste the numbers, and confirm that these people asked to hear from you. WhatsApp restricts numbers that message people who did not.',
    );
  }
  const cfg = await closerConfig();
  if (!cfg.phoneNumberId) throw new HttpsError('failed-precondition', 'Connect your WhatsApp number first.');

  const rows = parseSheet(parsed.data.rows);
  if (!rows.length) throw new HttpsError('invalid-argument', 'No usable phone numbers in that. One number per line, or a CSV with the number in any column.');

  const nowMs = Date.now();
  let added = 0;
  let skipped = 0;
  for (const row of rows) {
    const ref = chatRef(row.number);
    const existing = (await ref.get()).data() as SalesChat | undefined;
    if (existing) {
      skipped++;
      continue;
    }
    await ref.set(newChat({ waId: row.number, name: row.name || null, source: 'sheet', note: row.note, stage: 'queued', nowMs }));
    added++;
  }
  await sdb.doc(CONFIG_PATH).set({ outreachConsentAtMs: nowMs }, { merge: true });
  return {
    ok: true,
    added,
    skipped,
    perDay: Math.min(cfg.dailyCap, 1000),
    templateReady: Boolean(cfg.templateName),
  };
});

/** Send a draft the client approved, or their own words, into a live chat. */
export const vexaSendMessage = deskCall('sales', async (req) => {
  requireAuth(req);
  const parsed = z.object({ waId: z.string().trim().min(6).max(64), text: z.string().trim().min(1).max(1000) }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what to send.');

  const waId = chatIdOf(parsed.data.waId);
  const chat = (await chatRef(waId).get()).data() as SalesChat | undefined;
  if (!chat) throw new HttpsError('not-found', 'No such conversation.');
  if (chat.blocked) throw new HttpsError('failed-precondition', 'This person asked us to stop, or cannot receive messages.');

  const onInstagram = Boolean(igsidOf(waId));
  const network = onInstagram ? 'Instagram' : 'WhatsApp';
  const outbound = await transportFor(waId);
  if (!outbound) {
    throw new HttpsError(
      'failed-precondition',
      onInstagram ? 'Connect your Instagram account first.' : 'Connect your WhatsApp number first.',
    );
  }

  const nowMs = Date.now();
  if (!canFreeForm(chat.lastInboundAtMs, nowMs)) {
    throw new HttpsError(
      'failed-precondition',
      onInstagram
        ? 'Instagram only allows a message within 24 hours of their last one, and it has no template to reopen a conversation with.'
        : 'WhatsApp only allows a free message within 24 hours of their last one. This conversation has to be opened with your approved template.',
    );
  }
  // The owner's own words go as typed; only Vexa's are cut to two sentences.
  const text = parsed.data.text.trim().slice(0, 1000);
  const result = await outbound(text);
  if (!result.ok) throw new HttpsError('unavailable', `${network} refused it: ${result.detail}`.slice(0, 300));
  await chatRef(waId).set(
    {
      messages: FieldValue.arrayUnion({ from: 'us', text, atMs: nowMs }),
      lastOutboundAtMs: nowMs,
      updatedAtMs: nowMs,
      followUps: 0,
    },
    { merge: true },
  );
  return { ok: true };
});

/** Take a conversation off Vexa, or give it back. */
export const vexaChatAction = deskCall('sales', async (req) => {
  requireAuth(req);
  const parsed = z
    .object({ waId: z.string().trim().min(6).max(64), action: z.enum(['take-over', 'give-back', 'won', 'lost', 'block']) })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Unknown action.');
  const waId = chatIdOf(parsed.data.waId);
  const ref = chatRef(waId);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'No such conversation.');

  const patch: Partial<SalesChat> = { updatedAtMs: Date.now() };
  if (parsed.data.action === 'take-over') Object.assign(patch, { handover: true, stage: 'needs_you' as Stage });
  if (parsed.data.action === 'give-back') Object.assign(patch, { handover: false, stage: 'talking' as Stage });
  if (parsed.data.action === 'won') Object.assign(patch, { stage: 'won' as Stage, handover: false });
  if (parsed.data.action === 'lost') Object.assign(patch, { stage: 'lost' as Stage, handover: false });
  if (parsed.data.action === 'block') Object.assign(patch, { blocked: true, blockedReason: 'You blocked this lead.', stage: 'stopped' as Stage });
  await ref.set(patch, { merge: true });
  return { ok: true };
});

/** The number, the cap, and how the funnel stands. */
export const vexaCloserState = deskCall('sales', async () => {
  const cfg = await closerConfig();
  const snap = await sdb.collection('salesChats').limit(500).get();
  const byStage: Record<string, number> = {};
  for (const d of snap.docs) {
    const stage = (d.data() as SalesChat).stage;
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }
  return {
    config: { ...cfg, connected: Boolean(cfg.phoneNumberId) },
    vaultReady: tokenVaultReady(),
    engine: activeEngine(),
    leftToday: sendBudget(cfg, Date.now()),
    byStage,
    total: snap.size,
  };
});

/** "Reply to them now" / "send the sheet now" from the console. */
export const vexaRunOutreach = deskCall('sales', { timeoutSeconds: 540 }, async () => ({ ok: true, status: await runOutreach() }));

/** "Check Instagram now" — the same read the sweep does, on demand. */
export const vexaSyncInstagramDms = deskCall('sales', { timeoutSeconds: 540 }, async () => ({
  ok: true,
  ...(await syncInstagramDms()),
}));

/**
 * Every fifteen minutes: open what is queued, nudge who went quiet.
 *
 * Not in `SLEEPY_JOBS`: a lead waiting on an answer is the whole product, and
 * it must not depend on the client having the console open.
 */
export const vexaCloserSweep = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Karachi', region: SCHEDULE_REGION, timeoutSeconds: 540, memory: '512MiB' },
  () =>
    forEachWorkspace('sales', async () => {
      // Instagram is read whether or not a WhatsApp number is connected: they
      // are two doors onto one funnel, and a desk that only sells on Instagram
      // still has leads waiting.
      const instagram = await syncInstagramDms().catch((e) => {
        logger.warn('closer: the Instagram inbox could not be read', {
          wid: currentWorkspace(),
          error: (e as Error).message,
        });
        return null;
      });
      const cfg = await closerConfig();
      if (!cfg.phoneNumberId) return;
      const status = await runOutreach();
      logger.info('closer: swept', { wid: currentWorkspace(), status, instagram });
    }),
);
