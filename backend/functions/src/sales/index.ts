/**
 * The sales agent — Harvey's loop, as a desk employee.
 *
 * Find businesses (map + verified web search) → read their sites → write one
 * short personal email each → wait for approval (or not, if the customer said
 * so once) → send from the customer's own mailbox, a few at a time, within a
 * daily cap. Or, in "find & write only", stop after writing: the customer copies
 * the email or opens it in their own mail app.
 *
 * And then the close (`inbox.ts`): in mailbox mode it reads the same mailbox
 * for replies. A reply stops everything automatic for that lead and gets an
 * answer drafted for the owner to send; "no" and "stop" close the lead. A lead
 * that has not answered gets two short follow-ups in the same thread — only in
 * a pass whose inbox read worked, because a follow-up to someone who already
 * said no is the thing that gets a domain blacklisted. Won and lost are still
 * the owner's call.
 *
 * The email agent shares the mailbox: turned on, the same inbox read takes what
 * people write to the business and drafts each an answer for the owner to send
 * (`mailInbox`); and "tell every customer this" writes each customer on the
 * list (`mailCustomers`) their own email, sent within the same daily cap.
 *
 * Everything lives in the caller's workspace (`sdb`), and every callable needs
 * the `sales` part of a plan (Social Media Manager + Meta & Google Ad Expert).
 */
import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import nodemailer from 'nodemailer';
import { z } from 'zod';

import { FieldValue } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { getSocialSettings } from '../social/settings';
import { open, seal, tokenVaultReady, type SealedSecret } from '../social/secrets';
import { deskCall, forEachWorkspace, sdb, workspaceBrand } from '../social/workspace';
import { findBySearch, findOnMap, type FoundBusiness } from './find';
import { followUpDue, imapHostFor, readReplies, type InboxMail, type LeadRef } from './inbox';
import { readBusiness } from './site';
import {
  answerCustomer,
  answerReply,
  draftCustomerEmail,
  draftEmail,
  draftFollowUp,
  withFooter,
  writeCallScript,
  type Caller,
  type Draft,
  type MailKind,
  type Seller,
} from './write';

const REGION = 'asia-south1';
const SETTINGS = 'system/sales';
const SECRET = 'system/sales/secret/credentials';
const LEADS = 'salesLeads';
const SUPPRESS = 'salesSuppress';
/** The email agent: what people wrote to the mailbox, and the customers it writes to. */
const INBOX = 'mailInbox';
const CUSTOMERS = 'mailCustomers';

/** Per pass of the sweep: a few at a time reads as a person, not a blast. */
const PER_PASS = 5;

export const SALES_SETTINGS = SETTINGS;
export const SALES_LEADS = LEADS;

export type LeadStatus = 'new' | 'drafted' | 'approved' | 'sent' | 'replied' | 'won' | 'lost' | 'skipped' | 'failed';

interface SalesSettings {
  product: string;
  offer: string;
  kinds: string[];
  city: string;
  senderName: string;
  senderCompany: string;
  senderAddress: string;
  /** "copy": find & write only. "mailbox": send from the customer's own address. */
  mode: 'copy' | 'mailbox';
  /** Asked once: does every email wait for approval? */
  sendMode: 'approve' | 'direct' | null;
  dailyCap: number;
  smtp: { host: string; port: number; user: string; from: string } | null;
  autoDaily: boolean;
  /** Two follow-ups to a lead that has not answered — only ever after the inbox was read. */
  followUps: boolean;
  /** The mailbox's IMAP server; empty means the one that goes with the SMTP server. */
  imapHost: string;
  inboxCheckedAtMs: number;
  inboxStatus: string | null;
  sentDay: string;
  sentCount: number;
  lastAutoDay: string;
  lastStatus: string | null;
  /** Calling agents: each writes the script for a call a person makes. At most five. */
  callAgents: CallAgent[];
  /** The email agent reads every email a person sends the mailbox and drafts an answer. Off until the owner turns it on. */
  inboxAgent: boolean;
  /** Prices, timings, policies — the only facts its answers may state. */
  mailKnowledge: string;
  /** Arrival time up to which people's emails have been read. */
  mailCheckedAtMs: number;
  /** What the owner last asked to tell every customer; each customer is written to once per campaign. */
  campaign: { brief: string; atMs: number } | null;
}

/** One calling agent as set up on the Sales page. */
export interface CallAgent extends Caller {
  id: string;
  voice: 'female' | 'male';
  /** Pakistan hours it is fine to ring a business, from–to. */
  hoursFrom: number;
  hoursTo: number;
  dailyCap: number;
  active: boolean;
  /** "script": writes what a person says. "ai": dials and talks itself (agents/calls.ts). Absent = script. */
  mode?: 'script' | 'ai';
  /** Prices, packages, FAQs — the only facts the AI may state on a call or on WhatsApp. */
  knowledge?: string;
  /** Rings new leads with a phone number on its own, inside its hours and caps. */
  autoCall?: boolean;
}

const DEFAULTS: SalesSettings = {
  product: '',
  offer: '',
  kinds: [],
  city: '',
  senderName: '',
  senderCompany: '',
  senderAddress: '',
  mode: 'copy',
  sendMode: null,
  dailyCap: 20,
  smtp: null,
  autoDaily: true,
  followUps: true,
  imapHost: '',
  inboxCheckedAtMs: 0,
  inboxStatus: null,
  sentDay: '',
  sentCount: 0,
  lastAutoDay: '',
  lastStatus: null,
  callAgents: [],
  inboxAgent: false,
  mailKnowledge: '',
  mailCheckedAtMs: 0,
  campaign: null,
};

/** A lead as stored, with the close: the thread we started and what came back. */
export interface LeadDoc {
  name: string;
  website: string | null;
  email: string | null;
  title: string;
  description: string;
  signals: string[];
  status: LeadStatus;
  draft: Draft | null;
  sentAtMs: number | null;
  /** Message-ID of the first email: what a follow-up threads under. */
  messageId?: string | null;
  /** Every Message-ID we sent them, for matching a reply to its thread. */
  threadIds?: string[];
  followUps?: number;
  lastSentAtMs?: number | null;
  reply?: { atMs: number; text: string; messageId: string; intent: string } | null;
  replyDraft?: Draft | null;
  answeredAtMs?: number | null;
  phone?: string | null;
  /** Asked on a call or on WhatsApp never to be contacted again. */
  doNotContact?: boolean;
  lastCall?: { atMs: number; outcome: string } | null;
  /** AI calls placed to this lead. */
  aiCalls?: number;
}

export async function getSales(): Promise<SalesSettings> {
  const stored = ((await sdb.doc(SETTINGS).get()).data() ?? {}) as Partial<SalesSettings>;
  const brand = workspaceBrand();
  return {
    ...DEFAULTS,
    // A Studio customer's sign-up answers are a fair first draft of what they sell.
    product: brand?.what ?? '',
    senderCompany: brand?.name ?? '',
    city: brand?.market ?? '',
    ...stored,
  };
}

const pktDay = (ms = Date.now()) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 10);

/** One id per business, whichever source found it: website host, then email, then name. Pure. */
export function leadId(b: Pick<FoundBusiness, 'name' | 'website' | 'email'>): string {
  let key = b.name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (b.website) {
    try {
      key = new URL(b.website).hostname.replace(/^www\./, '');
    } catch {
      /* keep the name */
    }
  } else if (b.email) key = b.email.toLowerCase();
  return createHash('sha1').update(key).digest('hex').slice(0, 20);
}

const emailKey = (email: string) => createHash('sha1').update(email.trim().toLowerCase()).digest('hex');

export function seller(s: SalesSettings): Seller {
  return {
    product: s.product,
    offer: s.offer,
    senderName: s.senderName || 'The team',
    senderCompany: s.senderCompany,
    senderAddress: s.senderAddress,
    language: workspaceBrand()?.language ?? 'English',
  };
}

/** Save what was found, skipping anyone already on the list. Returns the new ids. */
async function addLeads(found: FoundBusiness[], city: string): Promise<string[]> {
  const added: string[] = [];
  for (const b of found) {
    const id = leadId(b);
    const ref = sdb.doc(`${LEADS}/${id}`);
    if ((await ref.get()).exists) continue;
    await ref.set({
      name: b.name,
      website: b.website,
      email: b.email,
      phone: b.phone,
      city,
      source: b.source,
      status: 'new' as LeadStatus,
      title: '',
      description: '',
      signals: [],
      draft: null,
      problems: [],
      createdAtMs: Date.now(),
      sentAtMs: null,
      error: null,
    });
    added.push(id);
  }
  return added;
}

/** Read a lead's site for an address and something specific to say. Never fatal. */
async function profile(id: string): Promise<void> {
  const ref = sdb.doc(`${LEADS}/${id}`);
  const lead = (await ref.get()).data() as { website: string | null; email: string | null; phone: string | null } | undefined;
  if (!lead?.website) return;
  try {
    const { site } = await readBusiness(lead.website);
    await ref.update({
      title: site.title,
      description: site.description,
      signals: site.signals,
      email: lead.email ?? site.emails[0] ?? null,
      phone: lead.phone ?? site.phones[0] ?? null,
    });
  } catch (e) {
    await ref.update({ error: `Could not read the site: ${(e as Error).message}`.slice(0, 200) });
  }
}

/** Find, save and read up to `max` new businesses of one kind. */
async function findAndProfile(kind: string, city: string, max: number): Promise<{ found: number; added: number; note: string }> {
  const settings = await getSocialSettings();
  const notes: string[] = [];
  const map = await findOnMap(kind, city).catch((e) => {
    notes.push(`map: ${(e as Error).message}`);
    return [] as FoundBusiness[];
  });
  const searched = await findBySearch(kind, city, settings.textModel).catch((e) => {
    notes.push(`search: ${(e as Error).message}`);
    return [] as FoundBusiness[];
  });
  // Reachable first: an address to write to beats a phone number.
  const all = [...searched, ...map].sort((a, b) => Number(Boolean(b.email || b.website)) - Number(Boolean(a.email || a.website)));
  const added = (await addLeads(all, city)).slice(0, max);
  for (const id of added) await profile(id);
  return { found: all.length, added: added.length, note: notes.join('; ') };
}

/** Write emails for leads that have none yet (and someone to send to, in mailbox mode). */
async function writeFor(ids: string[] | null, max: number): Promise<number> {
  const s = await getSales();
  const settings = await getSocialSettings();
  const snap = ids
    ? await Promise.all(ids.slice(0, max).map((id) => sdb.doc(`${LEADS}/${id}`).get()))
    : (await sdb.collection(LEADS).where('status', '==', 'new').limit(max * 3).get()).docs;
  let written = 0;
  for (const doc of snap) {
    if (written >= max) break;
    const lead = doc.data() as { name: string; website: string | null; email: string | null; title: string; description: string; signals: string[]; status: LeadStatus } | undefined;
    if (!lead || !['new', 'drafted', 'failed'].includes(lead.status)) continue;
    if (s.mode === 'mailbox' && !lead.email) continue;
    try {
      const d = await draftEmail({ model: settings.textModel, seller: seller(s), lead });
      await doc.ref.update({
        draft: { subject: d.subject, body: d.body },
        problems: d.problems,
        // "Send directly", chosen once, skips the approval — but never for a draft the checks failed.
        status: (s.mode === 'mailbox' && s.sendMode === 'direct' && !d.problems.length ? 'approved' : 'drafted') as LeadStatus,
        error: null,
      });
      written++;
    } catch (e) {
      await doc.ref.update({ status: 'failed' as LeadStatus, error: (e as Error).message.slice(0, 200) });
    }
  }
  return written;
}

/** The mailbox password, opened from the vault; null when none is stored. */
async function mailboxPassword(): Promise<string | null> {
  const secret = (await sdb.doc(SECRET).get()).data() as { pass?: SealedSecret } | undefined;
  return secret?.pass ? open(secret.pass) : null;
}

/** One email from the owner's mailbox; the Message-ID it went out under. */
async function sendOne(
  s: SalesSettings,
  pass: string,
  /** `plain`: an answer to someone who wrote to us — a sign-off, not the opt-out footer. */
  mail: { to: string; subject: string; body: string; inReplyTo?: string; references?: string[]; plain?: boolean },
): Promise<string> {
  const smtp = s.smtp!;
  const info = await nodemailer
    .createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass } })
    .sendMail({
      from: { name: s.senderName || s.senderCompany, address: smtp.from },
      to: mail.to,
      subject: mail.subject,
      text: mail.plain ? `${mail.body.trim()}\n\n${s.senderName}, ${s.senderCompany}` : withFooter(mail.body, s),
      ...(mail.plain ? {} : { headers: { 'List-Unsubscribe': `<mailto:${smtp.from}?subject=unsubscribe>` } }),
      ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.references ?? [mail.inReplyTo] } : {}),
    });
  return String(info.messageId ?? '');
}

/** How many more emails may go today, and the bookkeeping to call after sending some. */
function dayRoom(s: SalesSettings): { room: number; record: (n: number) => Promise<void> } {
  const today = pktDay();
  const sentToday = s.sentDay === today ? s.sentCount : 0;
  return {
    room: Math.max(0, s.dailyCap - sentToday),
    record: async (n) => {
      if (n) await sdb.doc(SETTINGS).set({ sentDay: today, sentCount: sentToday + n }, { merge: true });
    },
  };
}

/** Send approved emails within today's cap. Returns how many went. */
async function sendApproved(): Promise<number> {
  const s = await getSales();
  if (s.mode !== 'mailbox' || !s.smtp) return 0;
  const day = dayRoom(s);
  const room = Math.min(PER_PASS, day.room);
  if (room <= 0) return 0;
  const pass = await mailboxPassword();
  if (!pass) return 0;

  const due = (await sdb.collection(LEADS).where('status', '==', 'approved').limit(room).get()).docs;
  let sent = 0;
  for (const doc of due) {
    const lead = doc.data() as LeadDoc;
    if (!lead.email || !lead.draft) {
      await doc.ref.update({ status: 'failed' as LeadStatus, error: 'No address or no email to send.' });
      continue;
    }
    if ((await sdb.doc(`${SUPPRESS}/${emailKey(lead.email)}`).get()).exists) {
      await doc.ref.update({ status: 'skipped' as LeadStatus, error: 'They asked not to be written to.' });
      continue;
    }
    try {
      const messageId = await sendOne(s, pass, { to: lead.email, subject: lead.draft.subject, body: lead.draft.body });
      await doc.ref.update({
        status: 'sent' as LeadStatus,
        sentAtMs: Date.now(),
        lastSentAtMs: Date.now(),
        messageId: messageId || null,
        threadIds: messageId ? [messageId] : [],
        followUps: 0,
        error: null,
      });
      sent++;
    } catch (e) {
      await doc.ref.update({ status: 'failed' as LeadStatus, error: `Sending failed: ${(e as Error).message}`.slice(0, 200) });
    }
  }
  await day.record(sent);
  return sent;
}

/**
 * Read the mailbox for replies to the leads we wrote to. A reply stops
 * everything automatic for that lead and gets an answer drafted for the owner;
 * "no" and "stop" close it, and "stop" keeps the address off every list.
 * With the inbox agent on, the same read also takes what people wrote to the
 * business (`answerInbox`). `ok` is what lets follow-ups go in the same pass.
 */
async function checkInbox(s: SalesSettings): Promise<{ ok: boolean; replies: number; mail: number }> {
  if (s.mode !== 'mailbox' || !s.smtp) return { ok: false, replies: 0, mail: 0 };
  const pass = await mailboxPassword();
  if (!pass) return { ok: false, replies: 0, mail: 0 };
  const waiting = (await sdb.collection(LEADS).where('status', '==', 'sent').limit(300).get()).docs;
  const leads: LeadRef[] = waiting
    .map((d) => ({ id: d.id, ...(d.data() as LeadDoc) }))
    .filter((l) => l.email)
    .map((l) => ({ id: l.id, email: l.email!, threadIds: l.threadIds ?? (l.messageId ? [l.messageId] : []) }));
  const startedAtMs = Date.now();
  if (!leads.length && !s.inboxAgent) {
    await sdb.doc(SETTINGS).set({ inboxCheckedAtMs: startedAtMs }, { merge: true });
    return { ok: true, replies: 0, mail: 0 };
  }

  // Ten minutes of overlap for a clock that drifts; on the first pass, the last two days only.
  const mailAfterMs = Math.max(s.mailCheckedAtMs - 10 * 60_000, startedAtMs - 2 * 86_400_000);
  // A day of overlap for lead replies, because IMAP's SINCE is a date, not a moment; two weeks at most.
  const leadSinceMs = Math.max(s.inboxCheckedAtMs - 86_400_000, startedAtMs - 14 * 86_400_000);
  let read;
  try {
    read = await readReplies({
      host: s.imapHost || imapHostFor(s.smtp.host),
      user: s.smtp.user,
      pass,
      sinceMs: leads.length ? Math.min(leadSinceMs, mailAfterMs) : mailAfterMs,
      leads,
      ...(s.inboxAgent
        ? {
            mail: {
              own: [s.smtp.user, s.smtp.from],
              afterMs: mailAfterMs,
              max: 10,
              known: async (messageId: string) => (await sdb.doc(`${INBOX}/${mailKey(messageId)}`).get()).exists,
            },
          }
        : {}),
    });
  } catch (e) {
    await sdb.doc(SETTINGS).set({ inboxStatus: `Could not read the inbox: ${(e as Error).message}`.slice(0, 300) }, { merge: true });
    return { ok: false, replies: 0, mail: 0 };
  }

  const settings = await getSocialSettings();
  let answered = 0;
  for (const reply of read.replies) {
    const ref = sdb.doc(`${LEADS}/${reply.leadId}`);
    const lead = (await ref.get()).data() as LeadDoc | undefined;
    if (!lead || lead.status !== 'sent') continue; // already handled, or closed by hand
    answered++;
    let intent = 'other';
    let draft: Draft | null = null;
    try {
      const out = await answerReply({ model: settings.textModel, seller: seller(s), lead, ours: lead.draft ?? { subject: '', body: '' }, theirs: reply.text });
      intent = out.intent;
      if (out.body) draft = { subject: /^re:/i.test(lead.draft?.subject ?? '') ? lead.draft!.subject : `Re: ${lead.draft?.subject ?? ''}`.trim(), body: out.body };
    } catch (e) {
      logger.warn('sales: could not draft an answer', { lead: reply.leadId, error: (e as Error).message });
    }
    const closed = intent === 'not_interested' || intent === 'unsubscribe';
    if (intent === 'unsubscribe' && lead.email) await sdb.doc(`${SUPPRESS}/${emailKey(lead.email)}`).set({ atMs: Date.now() });
    await ref.update({
      status: (closed ? 'lost' : 'replied') as LeadStatus,
      reply: { atMs: reply.atMs, text: reply.text, messageId: reply.messageId, intent },
      replyDraft: draft,
      error: closed ? (intent === 'unsubscribe' ? 'Asked not to be written to.' : 'Said no.') : null,
    });
  }
  for (const mail of read.mail) await answerInbox(s, settings.textModel, mail);
  await sdb.doc(SETTINGS).set(
    { inboxCheckedAtMs: startedAtMs, inboxStatus: null, ...(s.inboxAgent ? { mailCheckedAtMs: read.cursorMs ?? startedAtMs } : {}) },
    { merge: true },
  );
  return { ok: true, replies: answered, mail: read.mail.length };
}

const mailKey = (messageId: string) => createHash('sha1').update(messageId).digest('hex').slice(0, 24);

/** An email a person sent, as kept at `mailInbox/{id}`, with the answer the agent drafted. */
interface InboxDoc extends InboxMail {
  kind: MailKind;
  summary: string;
  draft: Draft | null;
  /** "open": waits for the owner. "answered": sent from here. "done": needs nothing (or the owner said so). */
  status: 'open' | 'answered' | 'done';
  answeredAtMs: number | null;
  error: string | null;
}

/**
 * One email a person sent the business: what they want, and the answer drafted
 * for the owner to send. "Stop emailing me" puts them on the do-not-write list;
 * a pitch to us is filed as needing nothing. Anyone else becomes (or stays) a
 * customer, with what they last wrote, so a customer email can start from it.
 */
async function answerInbox(s: SalesSettings, model: string, mail: InboxMail): Promise<void> {
  let out: { kind: MailKind; summary: string; body: string } = { kind: 'other', summary: '', body: '' };
  let error: string | null = null;
  try {
    out = await answerCustomer({ model, seller: seller(s), knowledge: s.mailKnowledge, mail });
  } catch (e) {
    error = `Could not draft an answer: ${(e as Error).message}`.slice(0, 200);
  }
  const quiet = out.kind === 'sales_pitch' || out.kind === 'unsubscribe';
  const doc: InboxDoc = {
    ...mail,
    kind: out.kind,
    summary: out.summary,
    draft: out.body ? { subject: (/^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`.trim()).slice(0, 120), body: out.body } : null,
    status: quiet ? 'done' : 'open',
    answeredAtMs: null,
    error,
  };
  await sdb.doc(`${INBOX}/${mailKey(mail.messageId)}`).set(doc);
  const key = emailKey(mail.from);
  const ref = sdb.doc(`${CUSTOMERS}/${key}`);
  if (out.kind === 'unsubscribe') {
    await sdb.doc(`${SUPPRESS}/${key}`).set({ atMs: Date.now() });
    if ((await ref.get()).exists) await ref.update({ status: 'unsubscribed' as CustomerStatus, draft: null });
    return;
  }
  if (quiet) return;
  const seen = { lastWroteAtMs: mail.atMs, lastText: mail.text.slice(0, 600) };
  if ((await ref.get()).exists) await ref.update(seen);
  else await ref.set(newCustomer({ email: mail.from, name: mail.name, note: '', source: 'inbox' }, seen));
}

// ── customers ───────────────────────────────────────────────────────────────

type CustomerStatus = 'idle' | 'drafted' | 'approved' | 'sent' | 'failed' | 'skipped' | 'unsubscribed';

/** A customer as kept at `mailCustomers/{emailKey}`, with this campaign's email to them. */
interface CustomerDoc {
  email: string;
  name: string;
  note: string;
  source: 'inbox' | 'list';
  createdAtMs: number;
  lastWroteAtMs: number | null;
  lastText: string;
  status: CustomerStatus;
  draft: Draft | null;
  problems: string[];
  /** The campaign this customer's email belongs to; below the current one means not written yet. */
  campaignAtMs: number;
  sentAtMs: number | null;
  error: string | null;
}

function newCustomer(c: Pick<CustomerDoc, 'email' | 'name' | 'note' | 'source'>, seen: Partial<CustomerDoc> = {}): CustomerDoc {
  return {
    ...c,
    createdAtMs: Date.now(),
    lastWroteAtMs: null,
    lastText: '',
    status: 'idle',
    draft: null,
    problems: [],
    campaignAtMs: 0,
    sentAtMs: null,
    error: null,
    ...seen,
  };
}

/**
 * Write the current campaign's email to up to `max` customers who have none
 * yet, each its own. "Send directly", chosen once on the Sales page, approves
 * a draft that passed the checks. Returns how many were written, and whether
 * more are waiting.
 */
async function writeCustomers(max: number): Promise<{ written: number; more: boolean }> {
  const s = await getSales();
  const c = s.campaign;
  if (!c) return { written: 0, more: false };
  const model = (await getSocialSettings()).textModel;
  const docs = (await sdb.collection(CUSTOMERS).where('campaignAtMs', '<', c.atMs).limit(max).get()).docs;
  let written = 0;
  for (const doc of docs) {
    const cu = doc.data() as CustomerDoc;
    if (cu.status === 'unsubscribed' || (await sdb.doc(`${SUPPRESS}/${doc.id}`).get()).exists) {
      await doc.ref.update({ campaignAtMs: c.atMs, status: 'unsubscribed' as CustomerStatus, draft: null });
      continue;
    }
    try {
      const d = await draftCustomerEmail({ model, seller: seller(s), brief: c.brief, customer: cu });
      const direct = s.mode === 'mailbox' && s.sendMode === 'direct' && !d.problems.length;
      await doc.ref.update({
        draft: { subject: d.subject, body: d.body },
        problems: d.problems,
        status: (direct ? 'approved' : 'drafted') as CustomerStatus,
        campaignAtMs: c.atMs,
        error: null,
      });
      written++;
    } catch (e) {
      await doc.ref.update({ status: 'failed' as CustomerStatus, campaignAtMs: c.atMs, error: (e as Error).message.slice(0, 200) });
    }
  }
  return { written, more: docs.length === max };
}

/** Send approved customer emails within today's cap — the same cap the sales emails keep. Returns how many went. */
async function sendCustomers(): Promise<number> {
  const s = await getSales();
  if (s.mode !== 'mailbox' || !s.smtp) return 0;
  const day = dayRoom(s);
  const room = Math.min(PER_PASS, day.room);
  if (room <= 0) return 0;
  const pass = await mailboxPassword();
  if (!pass) return 0;
  const due = (await sdb.collection(CUSTOMERS).where('status', '==', 'approved').limit(room).get()).docs;
  let sent = 0;
  for (const doc of due) {
    const cu = doc.data() as CustomerDoc;
    if (!cu.draft) {
      await doc.ref.update({ status: 'failed' as CustomerStatus, error: 'No email to send.' });
      continue;
    }
    if ((await sdb.doc(`${SUPPRESS}/${doc.id}`).get()).exists) {
      await doc.ref.update({ status: 'unsubscribed' as CustomerStatus });
      continue;
    }
    try {
      await sendOne(s, pass, { to: cu.email, subject: cu.draft.subject, body: cu.draft.body });
      await doc.ref.update({ status: 'sent' as CustomerStatus, sentAtMs: Date.now(), error: null });
      sent++;
    } catch (e) {
      await doc.ref.update({ status: 'failed' as CustomerStatus, error: `Sending failed: ${(e as Error).message}`.slice(0, 200) });
    }
  }
  await day.record(sent);
  return sent;
}

/** Two follow-ups at most to a lead that has not answered, within today's cap. Returns how many went. */
async function sendFollowUps(s: SalesSettings): Promise<number> {
  if (!s.followUps || s.mode !== 'mailbox' || !s.smtp) return 0;
  const day = dayRoom(s);
  const room = Math.min(PER_PASS, day.room);
  if (room <= 0) return 0;
  const pass = await mailboxPassword();
  if (!pass) return 0;
  const settings = await getSocialSettings();
  const now = Date.now();
  const due = (await sdb.collection(LEADS).where('status', '==', 'sent').limit(300).get()).docs
    .map((d) => ({ ref: d.ref, lead: d.data() as LeadDoc, n: followUpDue(d.data() as LeadDoc, now) }))
    .filter((x) => x.n !== null && x.lead.email && x.lead.draft)
    .slice(0, room);

  let sent = 0;
  for (const { ref, lead, n } of due) {
    if ((await sdb.doc(`${SUPPRESS}/${emailKey(lead.email!)}`).get()).exists) continue;
    try {
      const d = await draftFollowUp({ model: settings.textModel, seller: seller(s), lead, first: lead.draft!, n: n! });
      // A follow-up the checks failed is not sent: the lead simply waits for the next pass.
      if (d.problems.length) continue;
      const messageId = await sendOne(s, pass, {
        to: lead.email!,
        subject: d.subject,
        body: d.body,
        inReplyTo: lead.messageId!,
        references: lead.threadIds ?? [lead.messageId!],
      });
      await ref.update({
        followUps: n,
        lastSentAtMs: Date.now(),
        ...(messageId ? { threadIds: FieldValue.arrayUnion(messageId) } : {}),
      });
      sent++;
    } catch (e) {
      logger.warn('sales: a follow-up failed', { error: (e as Error).message });
    }
  }
  await day.record(sent);
  return sent;
}

/** What the launch sequence needs to know about the sales agent. */
export async function salesReadiness(): Promise<{ mailbox: boolean; kinds: number; city: string }> {
  const s = await getSales();
  return { mailbox: s.mode === 'mailbox' && Boolean(s.smtp), kinds: s.kinds.length, city: s.city };
}

/** Fill the sales agent's empty settings from the launch funnel — never over anything the owner wrote. */
export async function seedSales(p: { offer: string; kinds: string[]; city: string }): Promise<void> {
  const stored = ((await sdb.doc(SETTINGS).get()).data() ?? {}) as Partial<SalesSettings>;
  const patch: Partial<SalesSettings> = {};
  if (!stored.offer && p.offer) patch.offer = p.offer.slice(0, 600);
  if (!stored.kinds?.length && p.kinds.length) patch.kinds = p.kinds.slice(0, 8).map((k) => k.slice(0, 80));
  if (!stored.city && p.city) patch.city = p.city.slice(0, 80);
  if (Object.keys(patch).length) await sdb.doc(SETTINGS).set(patch, { merge: true });
}

// ── callables ───────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  product: z.string().trim().max(600).optional(),
  offer: z.string().trim().max(600).optional(),
  kinds: z.array(z.string().trim().min(2).max(80)).max(8).optional(),
  city: z.string().trim().max(80).optional(),
  senderName: z.string().trim().max(80).optional(),
  senderCompany: z.string().trim().max(80).optional(),
  senderAddress: z.string().trim().max(200).optional(),
  mode: z.enum(['copy', 'mailbox']).optional(),
  sendMode: z.enum(['approve', 'direct']).optional(),
  dailyCap: z.number().int().min(1).max(50).optional(),
  autoDaily: z.boolean().optional(),
  followUps: z.boolean().optional(),
  inboxAgent: z.boolean().optional(),
  mailKnowledge: z.string().trim().max(4000).optional(),
  imapHost: z.string().trim().max(120).regex(/^([a-z0-9.-]+)?$/i).optional(),
  smtp: z
    .object({
      host: z.string().trim().min(3).max(120).regex(/^[a-z0-9.-]+$/i),
      port: z.union([z.literal(465), z.literal(587)]),
      user: z.string().trim().min(3).max(200),
      from: z.string().trim().email().max(200),
      /** Only sent when it changes; never read back. */
      pass: z.string().min(4).max(200).optional(),
    })
    .optional(),
  callAgents: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{3,40}$/),
        name: z.string().trim().min(1).max(40),
        voice: z.enum(['female', 'male']),
        language: z.enum(['urdu', 'english', 'mixed']),
        goal: z.string().trim().max(300),
        opener: z.string().trim().max(400),
        points: z.string().trim().max(1200),
        hoursFrom: z.number().int().min(0).max(23),
        hoursTo: z.number().int().min(1).max(24),
        dailyCap: z.number().int().min(1).max(200),
        active: z.boolean(),
        mode: z.enum(['script', 'ai']).optional(),
        knowledge: z.string().trim().max(3000).optional(),
        autoCall: z.boolean().optional(),
      }),
    )
    .max(5)
    .optional(),
});

export const salesGetSettings = deskCall('sales', async () => {
  const s = await getSales();
  const hasPassword = Boolean(((await sdb.doc(SECRET).get()).data() as { pass?: unknown } | undefined)?.pass);
  return { settings: s, hasPassword, vaultReady: tokenVaultReady() };
});

export const salesSaveSettings = deskCall('sales', async (req) => {
  const ctx = requireAuth(req);
  const parsed = settingsSchema.safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Check the sales settings — something is not valid.');
  const { smtp, ...rest } = parsed.data;
  const next = { ...(await getSales()), ...rest };
  if (next.mode === 'mailbox' && !next.senderAddress) {
    throw new HttpsError('invalid-argument', 'Add a postal address — every cold email has to carry one.');
  }

  if (smtp) {
    const secret = (await sdb.doc(SECRET).get()).data() as { pass?: SealedSecret } | undefined;
    const pass = smtp.pass ?? (secret?.pass ? open(secret.pass) : '');
    if (!pass) throw new HttpsError('invalid-argument', 'Add the mailbox app password.');
    if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'Passwords cannot be stored safely right now.');
    // Proved before it is kept: a wrong password should fail here, not on the first send.
    try {
      await nodemailer
        .createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: { user: smtp.user, pass } })
        .verify();
    } catch (e) {
      throw new HttpsError('failed-precondition', `The mailbox refused the sign-in: ${(e as Error).message}`);
    }
    if (smtp.pass) await sdb.doc(SECRET).set({ pass: seal(smtp.pass), updatedAt: FieldValue.serverTimestamp() });
    await sdb.doc(SETTINGS).set({ smtp: { host: smtp.host, port: smtp.port, user: smtp.user, from: smtp.from } }, { merge: true });
  }
  await sdb.doc(SETTINGS).set({ ...rest, updatedBy: ctx.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, settings: await getSales() };
});

export const salesFindLeads = deskCall('sales', { timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  const parsed = z
    .object({ kind: z.string().trim().min(2).max(80), city: z.string().trim().min(2).max(80), write: z.boolean().optional() })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what kind of business, and which city.');
  const res = await findAndProfile(parsed.data.kind, parsed.data.city, 25);
  const written = parsed.data.write === false ? 0 : await writeFor(null, 10);
  return { ok: true, ...res, written };
});

export const salesAddLeads = deskCall('sales', { timeoutSeconds: 120 }, async (req) => {
  const parsed = z.object({ lines: z.string().max(20_000), city: z.string().trim().max(80).optional() }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Paste one business per line: name, email, website.');
  const found: FoundBusiness[] = parsed.data.lines
    .split('\n')
    .map((l) => l.split(/[,\t]/).map((x) => x.trim()))
    .filter((p) => p[0])
    .slice(0, 200)
    .map(([name, a = '', b = '']) => {
      const email = [a, b].find((x) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(x)) ?? null;
      const site = [a, b].find((x) => x && !x.includes('@')) ?? null;
      return {
        name: name.slice(0, 120),
        email: email?.toLowerCase() ?? null,
        website: site ? (/^https?:\/\//.test(site) ? site : `https://${site}`).slice(0, 300) : null,
        phone: null,
        source: 'search' as const,
      };
    });
  const added = await addLeads(found, parsed.data.city ?? '');
  for (const id of added.slice(0, 25)) await profile(id);
  return { ok: true, added: added.length };
});

export const salesWriteEmails = deskCall('sales', { timeoutSeconds: 300 }, async (req) => {
  const parsed = z.object({ leadIds: z.array(z.string().regex(/^[a-f0-9]{20}$/)).max(10).optional() }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  return { ok: true, written: await writeFor(parsed.data.leadIds ?? null, 10) };
});

export const salesLeadAction = deskCall('sales', { timeoutSeconds: 120 }, async (req) => {
  const parsed = z
    .object({
      leadId: z.string().regex(/^[a-f0-9]{20}$/),
      action: z.enum(['approve', 'send', 'sent', 'skip', 'replied', 'won', 'lost', 'optout', 'edit', 'editReply', 'sendReply', 'call']),
      subject: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(10).max(2000).optional(),
      /** How a call went, for `call`. */
      outcome: z.enum(['interested', 'callback', 'not_interested', 'no_answer', 'wrong_number']).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { leadId: id, action, subject, body } = parsed.data;
  const ref = sdb.doc(`${LEADS}/${id}`);
  const lead = (await ref.get()).data() as LeadDoc | undefined;
  if (!lead) throw new HttpsError('not-found', 'No such lead.');

  // A call someone made from the calling agent's script: logged, and it moves the lead like a reply would.
  if (action === 'call') {
    const outcome = parsed.data.outcome;
    if (!outcome) throw new HttpsError('invalid-argument', 'Say how the call went.');
    const call = { atMs: Date.now(), outcome, note: parsed.data.note ?? '', by: requireAuth(req).uid };
    const moved: LeadStatus | null =
      outcome === 'interested' ? 'replied' : outcome === 'not_interested' || outcome === 'wrong_number' ? 'lost' : null;
    await ref.update({
      calls: FieldValue.arrayUnion(call),
      lastCall: { atMs: call.atMs, outcome },
      ...(moved && !['won', 'lost'].includes(lead.status) ? { status: moved } : {}),
    });
    return { ok: true };
  }

  if (action === 'edit' || action === 'editReply') {
    if (!subject || !body) throw new HttpsError('invalid-argument', 'A subject and a body are both needed.');
    await ref.update(action === 'edit' ? { draft: { subject, body }, problems: [] } : { replyDraft: { subject, body } });
    return { ok: true };
  }
  // The answer to someone who wrote back: always pressed by the owner, never sent by the sweep.
  if (action === 'sendReply') {
    const s = await getSales();
    const pass = await mailboxPassword();
    if (s.mode !== 'mailbox' || !s.smtp || !pass) {
      throw new HttpsError('failed-precondition', 'Connect the mailbox on this page to send from here — or copy the answer into your own email.');
    }
    if (!lead.email || !lead.replyDraft) throw new HttpsError('failed-precondition', 'There is no drafted answer to send.');
    const thread = [...(lead.threadIds ?? []), lead.reply?.messageId].filter((t): t is string => Boolean(t));
    try {
      await sendOne(s, pass, {
        to: lead.email,
        subject: lead.replyDraft.subject,
        body: lead.replyDraft.body,
        ...(lead.reply?.messageId ? { inReplyTo: lead.reply.messageId, references: thread } : {}),
      });
    } catch (e) {
      throw new HttpsError('unavailable', `The mailbox refused it: ${(e as Error).message}`);
    }
    await ref.update({ answeredAtMs: Date.now() });
    return { ok: true };
  }
  if (action === 'optout') {
    if (lead.email) await sdb.doc(`${SUPPRESS}/${emailKey(lead.email)}`).set({ atMs: Date.now() });
    await ref.update({ status: 'lost' as LeadStatus, error: 'Asked not to be written to.' });
    return { ok: true };
  }
  if (action === 'approve' || action === 'send') {
    if (!lead.draft) throw new HttpsError('failed-precondition', 'Write the email first.');
    await ref.update({ status: 'approved' as LeadStatus });
    // "Send now" goes out in this call, inside the same daily cap the sweep keeps.
    if (action === 'send') return { ok: true, sent: await sendApproved() };
    return { ok: true };
  }
  const next: Record<string, LeadStatus> = { sent: 'sent', skip: 'skipped', replied: 'replied', won: 'won', lost: 'lost' };
  await ref.update({ status: next[action], ...(action === 'sent' ? { sentAtMs: Date.now() } : {}) });
  return { ok: true };
});

/**
 * A calling agent writes what to say to one business — read from the screen by
 * whoever dials. It never places a call itself: that needs a phone line, and
 * none is connected.
 */
export const salesCallScript = deskCall('sales', { timeoutSeconds: 120 }, async (req) => {
  const parsed = z
    .object({ leadId: z.string().regex(/^[a-f0-9]{20}$/), agentId: z.string().regex(/^[a-z0-9-]{3,40}$/) })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const s = await getSales();
  const agent = s.callAgents.find((a) => a.id === parsed.data.agentId);
  if (!agent) throw new HttpsError('not-found', 'Set up that calling agent first.');
  const ref = sdb.doc(`${LEADS}/${parsed.data.leadId}`);
  const lead = (await ref.get()).data() as LeadDoc | undefined;
  if (!lead) throw new HttpsError('not-found', 'No such lead.');
  const script = await writeCallScript({ model: (await getSocialSettings()).textModel, seller: seller(s), caller: agent, lead });
  await ref.update({ callScript: { ...script, agentId: agent.id, atMs: Date.now() } });
  return { ok: true, script };
});

// ── the email agent's callables ─────────────────────────────────────────────

const docIdRe = /^[a-f0-9]{20,40}$/;

/** The inbox: send the drafted answer (edited or not), file one as needing nothing, or read the mailbox now. */
export const mailInboxAction = deskCall('sales', { timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  const parsed = z
    .object({
      action: z.enum(['send', 'done', 'check']),
      id: z.string().regex(docIdRe).optional(),
      subject: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(2).max(3000).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { action, id, subject, body } = parsed.data;
  const s = await getSales();
  if (action === 'check') {
    if (s.mode !== 'mailbox' || !s.smtp) throw new HttpsError('failed-precondition', 'Connect your mailbox on the Sales page first.');
    if (!s.inboxAgent) throw new HttpsError('failed-precondition', 'Turn the inbox agent on first.');
    const r = await checkInbox(s);
    if (!r.ok) throw new HttpsError('unavailable', (await getSales()).inboxStatus ?? 'Could not read the inbox.');
    return { ok: true, mail: r.mail, replies: r.replies };
  }
  if (!id) throw new HttpsError('invalid-argument', 'Which email?');
  const ref = sdb.doc(`${INBOX}/${id}`);
  const mail = (await ref.get()).data() as InboxDoc | undefined;
  if (!mail) throw new HttpsError('not-found', 'No such email.');
  if (action === 'done') {
    await ref.update({ status: 'done' });
    return { ok: true };
  }
  // The answer to a customer: always pressed by the owner, never sent by the sweep.
  const draft = subject && body ? { subject, body } : mail.draft;
  if (!draft) throw new HttpsError('invalid-argument', 'Write the answer first.');
  const pass = await mailboxPassword();
  if (s.mode !== 'mailbox' || !s.smtp || !pass) throw new HttpsError('failed-precondition', 'Connect your mailbox on the Sales page to send from here.');
  try {
    await sendOne(s, pass, { to: mail.from, ...draft, inReplyTo: mail.messageId, references: [mail.messageId], plain: true });
  } catch (e) {
    throw new HttpsError('unavailable', `The mailbox refused it: ${(e as Error).message}`);
  }
  await ref.update({ draft, status: 'answered', answeredAtMs: Date.now() });
  return { ok: true };
});

/** Paste customers, one per line: name, email, and a note about them (what they bought, when, anything). */
export const mailAddCustomers = deskCall('sales', async (req) => {
  const parsed = z.object({ lines: z.string().max(100_000) }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Paste one customer per line: name, email, note.');
  let added = 0;
  let updated = 0;
  for (const c of parseCustomers(parsed.data.lines)) {
    const ref = sdb.doc(`${CUSTOMERS}/${emailKey(c.email)}`);
    if ((await ref.get()).exists) {
      await ref.update({ ...(c.name ? { name: c.name } : {}), ...(c.note ? { note: c.note } : {}) });
      updated++;
    } else {
      await ref.set(newCustomer({ ...c, source: 'list' }));
      added++;
    }
  }
  return { ok: true, added, updated };
});

/** Customers from pasted lines — the address wherever it sits, then the first other field as the name and the rest as the note; lines without an address are dropped. Pure. */
export function parseCustomers(lines: string): { email: string; name: string; note: string }[] {
  const seen = new Set<string>();
  const out: { email: string; name: string; note: string }[] = [];
  for (const line of lines.split('\n').slice(0, 2000)) {
    const parts = line.split(/[,\t;]/).map((x) => x.trim());
    const at = parts.findIndex((x) => /^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i.test(x));
    if (at < 0) continue;
    const email = parts[at].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    const rest = parts.filter((_, i) => i !== at);
    out.push({ email, name: (rest[0] ?? '').slice(0, 80), note: rest.slice(1).filter(Boolean).join(', ').slice(0, 300) });
  }
  return out;
}

/**
 * "Tell every customer this": starts a campaign — one personal email per
 * customer — and writes the first few now; the sweep writes the rest. With no
 * brief it carries on the current one.
 */
export const mailWriteCustomers = deskCall('sales', { timeoutSeconds: 300 }, async (req) => {
  const parsed = z.object({ brief: z.string().trim().min(5).max(2000).optional() }).safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Say what to tell your customers, in a sentence or two.');
  const s = await getSales();
  if (!s.product || !s.senderCompany || !s.senderName) {
    throw new HttpsError('failed-precondition', 'Fill in what you sell and who is writing on the Sales page first.');
  }
  if ((await sdb.collection(CUSTOMERS).limit(1).get()).empty) {
    throw new HttpsError('failed-precondition', 'No customers yet — paste your customer list on the Email page, or turn the inbox agent on.');
  }
  if (parsed.data.brief) await sdb.doc(SETTINGS).set({ campaign: { brief: parsed.data.brief, atMs: Date.now() } }, { merge: true });
  else if (!s.campaign) throw new HttpsError('invalid-argument', 'Say what to tell your customers.');
  const r = await writeCustomers(8);
  return { ok: true, ...r, direct: s.mode === 'mailbox' && Boolean(s.smtp) && s.sendMode === 'direct' };
});

/** One customer's email: approve, send now, skip, write again, edit, or stop writing to them. `approveAll` takes no id. */
export const mailCustomerAction = deskCall('sales', { timeoutSeconds: 120 }, async (req) => {
  const parsed = z
    .object({
      action: z.enum(['approve', 'send', 'skip', 'rewrite', 'edit', 'optout', 'approveAll']),
      id: z.string().regex(docIdRe).optional(),
      subject: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(10).max(3000).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { action, id, subject, body } = parsed.data;
  if (action === 'approveAll') {
    const drafted = (await sdb.collection(CUSTOMERS).where('status', '==', 'drafted').limit(500).get()).docs;
    for (const d of drafted) await d.ref.update({ status: 'approved' as CustomerStatus });
    return { ok: true, approved: drafted.length };
  }
  if (!id) throw new HttpsError('invalid-argument', 'Which customer?');
  const ref = sdb.doc(`${CUSTOMERS}/${id}`);
  const cu = (await ref.get()).data() as CustomerDoc | undefined;
  if (!cu) throw new HttpsError('not-found', 'No such customer.');
  if (action === 'edit') {
    if (!subject || !body) throw new HttpsError('invalid-argument', 'A subject and a body are both needed.');
    await ref.update({ draft: { subject, body }, problems: [] });
    return { ok: true };
  }
  if (action === 'optout') {
    await sdb.doc(`${SUPPRESS}/${id}`).set({ atMs: Date.now() });
    await ref.update({ status: 'unsubscribed' as CustomerStatus, draft: null });
    return { ok: true };
  }
  if (action === 'skip') {
    await ref.update({ status: 'skipped' as CustomerStatus });
    return { ok: true };
  }
  if (action === 'rewrite') {
    await ref.update({ campaignAtMs: 0 });
    return { ok: true, ...(await writeCustomers(1)) };
  }
  if (!cu.draft) throw new HttpsError('failed-precondition', 'There is no email written for them yet.');
  if (cu.status === 'unsubscribed') throw new HttpsError('failed-precondition', 'They asked not to be written to.');
  await ref.update({ status: 'approved' as CustomerStatus });
  // "Send now" goes out in this call, inside the same daily cap the sweep keeps.
  return action === 'send' ? { ok: true, sent: await sendCustomers() } : { ok: true };
});

/** Whether salesSweep would do anything here now: the day's search, leads or customers to write to or send to, or an inbox to read. The sleeper asks. */
export async function salesHasWork(): Promise<boolean> {
  const s = await getSales();
  if (!s.product || !s.senderCompany) return false;
  if (s.autoDaily && s.kinds.length && s.city && s.lastAutoDay !== pktDay()) return true;
  if (s.campaign && !(await sdb.collection(CUSTOMERS).where('campaignAtMs', '<', s.campaign.atMs).limit(1).get()).empty) return true;
  if (s.mode !== 'mailbox' || !s.smtp) return false;
  // shortcut: an inbox agent keeps the sweep awake every 15 minutes; if that costs too much, poll it on a slower schedule of its own.
  if (s.inboxAgent) return true;
  if (!(await sdb.collection(CUSTOMERS).where('status', '==', 'approved').limit(1).get()).empty) return true;
  return !(await sdb.collection(LEADS).where('status', 'in', ['approved', 'sent']).limit(1).get()).empty;
}

/**
 * Every 15 minutes, per workspace with the sales agent: read the replies, send
 * what is approved and the follow-ups that are due, within the day's cap — and
 * once a day, find and write for the next kind of business on the list, so the
 * pipeline fills itself.
 */
export const salesSweep = onSchedule(
  { schedule: 'every 15 minutes', region: REGION, timeoutSeconds: 540, memory: '512MiB' },
  () =>
    forEachWorkspace('sales', async () => {
      const s = await getSales();
      if (!s.product || !s.senderCompany) return; // never set up
      const today = pktDay();
      const notes: string[] = [];
      if (s.autoDaily && s.kinds.length && s.city && s.lastAutoDay !== today) {
        await sdb.doc(SETTINGS).set({ lastAutoDay: today }, { merge: true });
        const kind = s.kinds[new Date().getUTCDate() % s.kinds.length];
        const found = await findAndProfile(kind, s.city, 10).catch((e) => ({ found: 0, added: 0, note: (e as Error).message }));
        const written = await writeFor(null, 10).catch(() => 0);
        notes.push(`Found ${found.added} new ${kind} in ${s.city}, wrote ${written}.`);
      }
      // Replies first: whoever answered must be off the follow-up list before it is read.
      const inbox = await checkInbox(s).catch((e) => {
        logger.warn('sales: the inbox check failed', { error: (e as Error).message });
        return { ok: false, replies: 0, mail: 0 };
      });
      if (inbox.replies) notes.push(`${inbox.replies} replied — answers drafted.`);
      if (inbox.mail) notes.push(`${inbox.mail} new email${inbox.mail === 1 ? '' : 's'} in the inbox — answers drafted.`);
      const sent = await sendApproved().catch((e) => {
        logger.warn('sales: sending failed', { error: (e as Error).message });
        return 0;
      });
      if (sent) notes.push(`Sent ${sent}.`);
      const wrote = await writeCustomers(10).catch((e) => {
        logger.warn('sales: customer emails failed', { error: (e as Error).message });
        return { written: 0, more: false };
      });
      if (wrote.written) notes.push(`Wrote ${wrote.written} customer email${wrote.written === 1 ? '' : 's'}.`);
      const toCustomers = await sendCustomers().catch((e) => {
        logger.warn('sales: sending to customers failed', { error: (e as Error).message });
        return 0;
      });
      if (toCustomers) notes.push(`Sent ${toCustomers} to customers.`);
      if (inbox.ok) {
        const followed = await sendFollowUps(await getSales()).catch((e) => {
          logger.warn('sales: follow-ups failed', { error: (e as Error).message });
          return 0;
        });
        if (followed) notes.push(`Followed up ${followed}.`);
      }
      if (notes.length) await sdb.doc(SETTINGS).set({ lastStatus: `${today}: ${notes.join(' ')}` }, { merge: true });
    }),
);
