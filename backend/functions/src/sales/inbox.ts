/**
 * Closing the loop: reading the replies, so the agent can follow up safely and
 * answer the people who wrote back.
 *
 * The sales agent used to write once and stop, on purpose: without reading the
 * inbox there was no safe way to stop a follow-up to someone who had already
 * answered — and a follow-up to a person who said no is how a domain gets
 * blacklisted. Reading the inbox changes that, and only that, so the rules are:
 *
 * - a reply is matched to its lead by the thread first, then the address, then
 *   the company's own domain (never a free-mail one) — and that lead gets
 *   nothing automatic again;
 * - follow-ups (two at most, three and seven days on, in the same thread) go
 *   only in a pass whose inbox read succeeded, so a reply is always seen first;
 * - the answer to a reply is drafted, never sent unread.
 *
 * The mailbox is the one the owner connected for sending — same user, same app
 * password — over IMAP on the matching host. Written from RFC 3501 and
 * imapflow's documentation; not yet run against a live mailbox.
 */
import { ImapFlow, type MessageStructureObject } from 'imapflow';
import type { Readable } from 'node:stream';

import { textOf } from './site';

/** Addresses anybody can have: a reply from one proves nothing about a company. */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'yandex.com',
  'gmx.com',
  'mail.com',
]);

/** The IMAP server that goes with an SMTP server, for the mailboxes people actually use. Pure. */
export function imapHostFor(smtpHost: string): string {
  const h = smtpHost.trim().toLowerCase();
  if (h === 'smtp.office365.com' || h === 'smtp-mail.outlook.com') return 'outlook.office365.com';
  if (/^smtp[.-]/.test(h)) return h.replace(/^smtp[.-]/, 'imap.');
  if (h.startsWith('mail.')) return h; // mail.example.com usually serves both
  return `imap.${h}`;
}

/** What they wrote, without the quoted thread hanging under it. Pure. */
export function freshText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*>/.test(line)) continue;
    // Gmail and Apple Mail: "On <date>, <name> wrote:" — often wrapped onto two lines.
    if (/^\s*On\s/i.test(line) && (/wrote:\s*$/i.test(line) || /wrote:\s*$/i.test(lines[i + 1] ?? ''))) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    // Outlook: a "From:" line followed closely by "Sent:" or "Date:".
    if (/^\s*From:\s/i.test(line) && lines.slice(i + 1, i + 4).some((l) => /^\s*(Sent|Date):\s/i.test(l))) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

/** Where the readable body is: plain text by preference, HTML when that is all there is. Pure. */
export function textPart(node: MessageStructureObject | undefined): { part: string; html: boolean } | null {
  const find = (n: MessageStructureObject, type: string): string | null => {
    if (n.childNodes?.length) {
      for (const child of n.childNodes) {
        const hit = find(child, type);
        if (hit) return hit;
      }
      return null;
    }
    if (n.disposition === 'attachment') return null;
    // A message that is not multipart keeps its body in part 1.
    return n.type === type ? (n.part ?? '1') : null;
  };
  if (!node) return null;
  const plain = find(node, 'text/plain');
  if (plain) return { part: plain, html: false };
  const html = find(node, 'text/html');
  return html ? { part: html, html: true } : null;
}

export interface LeadRef {
  id: string;
  email: string;
  /** Message-IDs of everything we sent them, first email and follow-ups. */
  threadIds: string[];
}

/** Which lead a message answers: by the thread first, then the address, then the company's own domain. Pure. */
export function matchLead(msg: { from: string; inReplyTo: string }, leads: LeadRef[]): LeadRef | null {
  const from = msg.from.toLowerCase();
  if (msg.inReplyTo) {
    const thread = leads.find((l) => l.threadIds.some((t) => t && msg.inReplyTo.includes(t)));
    if (thread) return thread;
  }
  const exact = leads.find((l) => l.email.toLowerCase() === from);
  if (exact) return exact;
  const domain = from.split('@')[1] ?? '';
  if (!domain || FREE_MAIL.has(domain)) return null;
  return leads.find((l) => l.email.toLowerCase().split('@')[1] === domain) ?? null;
}

/**
 * Whether a lead that has not answered is due a follow-up, and which: the
 * first three days after the email, the second four days after that, and
 * never a third. Only ones we sent ourselves (`messageId`), because a follow-up
 * has to sit in the thread it follows. Pure.
 */
export function followUpDue(
  lead: { status: string; messageId?: string | null; followUps?: number; lastSentAtMs?: number | null; sentAtMs?: number | null },
  nowMs: number,
): 1 | 2 | null {
  if (lead.status !== 'sent' || !lead.messageId) return null;
  const n = lead.followUps ?? 0;
  if (n >= 2) return null;
  const last = lead.lastSentAtMs ?? lead.sentAtMs ?? null;
  if (!last) return null;
  return nowMs - last >= (n === 0 ? 3 : 4) * 86_400_000 ? ((n + 1) as 1 | 2) : null;
}

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export interface InboxReply {
  leadId: string;
  from: string;
  messageId: string;
  atMs: number;
  text: string;
}

/**
 * The replies to our leads that arrived since `sinceMs`. Only messages from a
 * lead are opened at all; everything else in the owner's inbox is left unread
 * — not downloaded, not flagged, not moved.
 */
export async function readReplies(params: {
  host: string;
  user: string;
  pass: string;
  sinceMs: number;
  leads: LeadRef[];
}): Promise<InboxReply[]> {
  const client = new ImapFlow({
    host: params.host,
    port: 993,
    secure: true,
    auth: { user: params.user, pass: params.pass },
    logger: false,
  });
  await client.connect();
  const out: InboxReply[] = [];
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      // The whole list first: imapflow cannot download while a fetch is still streaming.
      const messages = await client.fetchAll({ since: new Date(params.sinceMs) }, { envelope: true, bodyStructure: true, uid: true });
      for (const msg of messages.slice(-300)) {
        const env = msg.envelope;
        const from = env?.from?.[0]?.address?.toLowerCase() ?? '';
        const lead = from ? matchLead({ from, inReplyTo: env?.inReplyTo ?? '' }, params.leads) : null;
        if (!lead) continue;
        const where = textPart(msg.bodyStructure);
        let text = '';
        if (where) {
          const file = await client.download(String(msg.uid), where.part, { uid: true, maxBytes: 64_000 });
          if (file.content) text = await streamText(file.content);
          if (where.html) text = textOf(text);
        }
        out.push({
          leadId: lead.id,
          from,
          messageId: env?.messageId ?? '',
          atMs: env?.date ? new Date(env.date).getTime() : Date.now(),
          text: freshText(text) || '(no text — open it in your inbox)',
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  return out;
}
