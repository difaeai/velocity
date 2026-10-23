/**
 * The sales agent — Harvey's loop, as a desk employee.
 *
 * Find businesses (map + verified web search) → read their sites → write one
 * short personal email each → wait for approval (or not, if the customer said
 * so once) → send from the customer's own mailbox, a few at a time, within a
 * daily cap. Or, in "find & write only", stop after writing: the customer copies
 * the email or opens it in their own mail app.
 *
 * What it deliberately does not do yet:
 * - follow-ups. One email per prospect. Without reading the inbox there is no
 *   safe way to stop a sequence when someone replies, and a follow-up to a
 *   person who already said no is the thing that gets a domain blacklisted.
 * - read replies. They land in the customer's own inbox; the lead is marked
 *   replied / won / lost / opted out by hand.
 *
 * Everything lives in the caller's workspace (`sdb`), and every callable needs
 * the `sales` part of a plan (Everything).
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
import { fetchPage, readSite } from './site';
import { draftEmail, withFooter, type Seller } from './write';

const REGION = 'asia-south1';
const SETTINGS = 'system/sales';
const SECRET = 'system/sales/secret/credentials';
const LEADS = 'salesLeads';
const SUPPRESS = 'salesSuppress';

/** Per pass of the sweep: a few at a time reads as a person, not a blast. */
const PER_PASS = 5;

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
  sentDay: string;
  sentCount: number;
  lastAutoDay: string;
  lastStatus: string | null;
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
  sentDay: '',
  sentCount: 0,
  lastAutoDay: '',
  lastStatus: null,
};

async function getSales(): Promise<SalesSettings> {
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

function seller(s: SalesSettings): Seller {
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
    const page = await fetchPage(lead.website);
    const site = readSite(page.html, page.url);
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

/** Send approved emails within today's cap. Returns how many went. */
async function sendApproved(): Promise<number> {
  const s = await getSales();
  if (s.mode !== 'mailbox' || !s.smtp) return 0;
  const today = pktDay();
  const sentToday = s.sentDay === today ? s.sentCount : 0;
  const room = Math.min(PER_PASS, s.dailyCap - sentToday);
  if (room <= 0) return 0;
  const secret = (await sdb.doc(SECRET).get()).data() as { pass?: SealedSecret } | undefined;
  if (!secret?.pass) return 0;
  const transport = nodemailer.createTransport({
    host: s.smtp.host,
    port: s.smtp.port,
    secure: s.smtp.port === 465,
    auth: { user: s.smtp.user, pass: open(secret.pass) },
  });

  const due = (await sdb.collection(LEADS).where('status', '==', 'approved').limit(room).get()).docs;
  let sent = 0;
  for (const doc of due) {
    const lead = doc.data() as { email: string | null; draft: { subject: string; body: string } | null };
    if (!lead.email || !lead.draft) {
      await doc.ref.update({ status: 'failed' as LeadStatus, error: 'No address or no email to send.' });
      continue;
    }
    if ((await sdb.doc(`${SUPPRESS}/${emailKey(lead.email)}`).get()).exists) {
      await doc.ref.update({ status: 'skipped' as LeadStatus, error: 'They asked not to be written to.' });
      continue;
    }
    try {
      await transport.sendMail({
        from: { name: s.senderName || s.senderCompany, address: s.smtp.from },
        to: lead.email,
        subject: lead.draft.subject,
        text: withFooter(lead.draft.body, s),
        headers: { 'List-Unsubscribe': `<mailto:${s.smtp.from}?subject=unsubscribe>` },
      });
      await doc.ref.update({ status: 'sent' as LeadStatus, sentAtMs: Date.now(), error: null });
      sent++;
    } catch (e) {
      await doc.ref.update({ status: 'failed' as LeadStatus, error: `Sending failed: ${(e as Error).message}`.slice(0, 200) });
    }
  }
  if (sent) await sdb.doc(SETTINGS).set({ sentDay: today, sentCount: sentToday + sent }, { merge: true });
  return sent;
}

// ── callables ───────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  product: z.string().trim().max(600).optional(),
  offer: z.string().trim().max(600).optional(),
  kinds: z.array(z.string().trim().min(2).max(40)).max(8).optional(),
  city: z.string().trim().max(80).optional(),
  senderName: z.string().trim().max(80).optional(),
  senderCompany: z.string().trim().max(80).optional(),
  senderAddress: z.string().trim().max(200).optional(),
  mode: z.enum(['copy', 'mailbox']).optional(),
  sendMode: z.enum(['approve', 'direct']).optional(),
  dailyCap: z.number().int().min(1).max(50).optional(),
  autoDaily: z.boolean().optional(),
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
    .object({ kind: z.string().trim().min(2).max(40), city: z.string().trim().min(2).max(80), write: z.boolean().optional() })
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
      action: z.enum(['approve', 'send', 'sent', 'skip', 'replied', 'won', 'lost', 'optout', 'edit']),
      subject: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(10).max(2000).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  const { leadId: id, action, subject, body } = parsed.data;
  const ref = sdb.doc(`${LEADS}/${id}`);
  const lead = (await ref.get()).data() as { email: string | null; draft: { subject: string; body: string } | null } | undefined;
  if (!lead) throw new HttpsError('not-found', 'No such lead.');

  if (action === 'edit') {
    if (!subject || !body) throw new HttpsError('invalid-argument', 'A subject and a body are both needed.');
    await ref.update({ draft: { subject, body }, problems: [] });
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
 * Every 15 minutes, per workspace with the sales agent: send what is approved
 * within the day's cap — and once a day, find and write for the next kind of
 * business on the list, so the pipeline fills itself.
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
      const sent = await sendApproved().catch((e) => {
        logger.warn('sales: sending failed', { message: (e as Error).message });
        return 0;
      });
      if (sent) notes.push(`Sent ${sent}.`);
      if (notes.length) await sdb.doc(SETTINGS).set({ lastStatus: `${today}: ${notes.join(' ')}` }, { merge: true });
    }),
);
