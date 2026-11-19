/**
 * A whole conversation, end to end, with Meta and the model both faked.
 *
 * This is the test that would have caught the things a unit test cannot: that
 * an inbound message finds the right workspace from nothing but a phone-number
 * id, that what goes on the wire is a WhatsApp text addressed to the right
 * person, that the reply is cut to two sentences before it is sent and not
 * after, that "band karo" ends it for good, and that the daily ration is spent
 * by outreach and never by a reply.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../lib/firebase';
import {
  closerConfig,
  handleFailure,
  handleInbound,
  numberRef,
  runOutreach,
  syncInstagramDms,
  type SalesChat,
} from '../closer';
import { seal } from '../secrets';
import { inWorkspace, workspaceRef } from '../workspace';
import { DEFAULT_SETTINGS } from '../types';
import { activeEngine } from '../engine';

const WID = 'wscloser1';
const PN = '555000111';
const LEAD = '923175812623';
const WS = `workspaces/${WID}`;
const saved = { free: process.env.FREE_MODEL_KEY, vault: process.env.SOCIAL_TOKEN_KEY, anthropic: process.env.ANTHROPIC_API_KEY, gemini: process.env.GEMINI_KEY_RESEARCH };

/** Everything Meta was asked to send, in order. */
let sent: { url: string; body: Record<string, unknown> }[] = [];
/** What the model answers next. */
let modelReply: Record<string, unknown> = {};
/** What the Instagram inbox holds next. */
let igInbox: Record<string, unknown> = { data: [] };

function stubFetch() {
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    // WhatsApp is sent as JSON and Instagram as a form, so the harness has to
    // read both or a form body throws here instead of in the code under test.
    let body: Record<string, unknown> = {};
    if (init?.body) {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = Object.fromEntries(new URLSearchParams(init.body));
      }
    }
    if (url.includes('/chat/completions')) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ choices: [{ message: { content: JSON.stringify(modelReply) }, finish_reason: 'stop' }] }),
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelReply) }, finish_reason: 'stop' }] }),
      } as unknown as Response;
    }
    if (url.includes('/conversations')) {
      sent.push({ url, body });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => igInbox,
        text: async () => JSON.stringify(igInbox),
      } as unknown as Response;
    }
    if (url.includes('graph.facebook.com')) {
      sent.push({ url, body });
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ messages: [{ id: `wamid.${sent.length}` }] }),
        text: async () => JSON.stringify({ messages: [{ id: `wamid.${sent.length}` }] }),
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
}

beforeAll(async () => {
  // A 32-byte key, so a token can be sealed and read back.
  process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  // The cheapest engine that talks over plain fetch, so one stub serves both.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_KEY_RESEARCH;
  process.env.FREE_MODEL_KEY = 'test-key';

  await workspaceRef(WID).set({
    name: 'Shahzad Estates',
    ownerUid: 'u1',
    ownerEmail: null,
    plan: 'all',
    trialEndsAtMs: Date.now() + 86_400_000,
    paidUntilMs: Date.now() + 30 * 86_400_000,
    accessUntilMs: Date.now() + 30 * 86_400_000,
    createdAtMs: Date.now(),
    brand: {
      name: 'Shahzad Estates',
      what: 'An estate agency selling plots in Bahria Town',
      audience: 'Overseas Pakistanis',
      market: 'Lahore',
      language: 'Urdu and English',
      differences: 'Only verified listings',
      website: 'https://shahzadestates.pk',
    },
  });
});

beforeEach(async () => {
  sent = [];
  modelReply = { reply: 'Rate 2500 se shuru hota hai. Aap kis area mein dekh rahe hain?', stage: 'talking', summary: 'Wants a plot in Bahria', nextStep: 'Find out the area', handover: false };
  stubFetch();

  // A connected number, its sealed token, and somebody hired to answer.
  await numberRef(PN).set({ wid: WID, atMs: Date.now() });
  await db.doc(`${WS}/system/whatsapp`).set({
    phoneNumberId: PN,
    displayNumber: '+92 42 1111111',
    templateName: 'first_hello',
    templateLang: 'en',
    dailyCap: 2,
    sendMode: 'auto',
    sentDay: null,
    sentToday: 0,
    outreachConsentAtMs: Date.now(),
  });
  await db.doc(`${WS}/system/whatsapp/secret/credentials`).set({ token: seal('EAAG-test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') });
  await db.doc(`${WS}/system/socialAutomation`).set({ ...DEFAULT_SETTINGS, enabled: true });
  await db.doc(`${WS}/socialEmployees/e1`).set({
    id: 'e1',
    name: 'Hira',
    role: 'social-manager',
    title: 'Social media manager',
    status: 'active',
    hiredAtMs: Date.now(),
    instructions: '',
    pieces: 0,
  });

  for (const doc of (await db.collection(`${WS}/salesChats`).get()).docs) await doc.ref.delete();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const chat = async (waId = LEAD): Promise<SalesChat | undefined> =>
  (await db.doc(`${WS}/salesChats/${waId}`).get()).data() as SalesChat | undefined;

describe('a lead writes to the client’s WhatsApp', () => {
  it('runs on the engine the stub serves', () => {
    expect(activeEngine()).toBe('free');
  });

  it('finds the workspace from the phone number id alone, and answers', async () => {
    const claimed = await handleInbound({ phoneNumberId: PN, from: LEAD, name: 'Bilal', text: 'bhai rate kya hai' });
    expect(claimed).toBe(true);

    const out = sent.filter((s) => s.url.includes('/messages'));
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain(PN);
    expect(out[0].body.to).toBe(LEAD);
    expect(out[0].body.type).toBe('text');
    expect((out[0].body.text as { body: string }).body).toContain('2500');

    const row = await chat();
    expect(row?.stage).toBe('talking');
    expect(row?.language).toBe('roman-urdu');
    expect(row?.summary).toBe('Wants a plot in Bahria');
    expect(row?.messages).toHaveLength(2);
    expect(row?.messages[0].from).toBe('them');
    expect(row?.messages[1].from).toBe('us');
  });

  it('remembers what they are buying, and never forgets it mid-conversation', async () => {
    // `wants` is what the console counts under "what they booked today", so two
    // sales of the same thing have to land on the same string. The failure that
    // matters is the second one: a later turn where the model simply leaves the
    // field out must not wipe what the sale was for.
    modelReply = { ...modelReply, wants: '5 marla plot' };
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: 'Bilal', text: 'bhai rate kya hai' });
    expect((await chat())?.wants).toBe('5 marla plot');

    modelReply = { reply: 'Theek hai, kal visit karwa dete hain.', stage: 'won', summary: 'Agreed', nextStep: 'Book the visit', handover: false };
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: 'Bilal', text: 'theek hai, book kar dein' });
    const row = await chat();
    expect(row?.stage).toBe('won');
    expect(row?.wants).toBe('5 marla plot');
  });

  it('leaves a number that belongs to nobody alone', async () => {
    expect(await handleInbound({ phoneNumberId: '999999', from: LEAD, name: null, text: 'hello' })).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('cuts a long-winded model down before it reaches the person', async () => {
    modelReply = {
      ...modelReply,
      reply:
        'Thank you so much for getting in touch with us today, we really appreciate it. We have many options for you. Prices start at 2500. We also arrange visits. Shall I send the list?',
    };
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'price?' });
    const body = (sent.find((s) => s.url.includes('/messages'))?.body.text as { body: string }).body;
    expect(body.length).toBeLessThanOrEqual(301);
    expect(body.split(/[.!?]/).filter((x) => x.trim()).length).toBeLessThanOrEqual(2);
  });

  it('stops for good when they say band karo, without asking the model', async () => {
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'band karo' });
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
    const row = await chat();
    expect(row?.blocked).toBe(true);
    expect(row?.stage).toBe('stopped');
  });

  it('hands a complaint to a human and says nothing itself', async () => {
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'mujhe refund chahiye, shikayat hai' });
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
    const row = await chat();
    expect(row?.handover).toBe(true);
    expect(row?.stage).toBe('needs_you');
  });

  it('drafts instead of sending when the client asked to approve first', async () => {
    await db.doc(`${WS}/system/whatsapp`).set({ sendMode: 'approve' }, { merge: true });
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'kitna hai' });
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
    const row = await chat();
    expect(row?.messages.at(-1)?.draft).toBe(true);
  });

  it('keeps answering replies after the daily ration is spent', async () => {
    // The ration is for messages the business starts. Somebody who wrote in is
    // always answered: that is Meta's rule and the right behaviour anyway.
    await db.doc(`${WS}/system/whatsapp`).set({ sentDay: new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10), sentToday: 999 }, { merge: true });
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'kya rate hai' });
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(1);
  });

  it('loses nothing when two messages arrive seconds apart', async () => {
    // The real shape of this: somebody sends "salam", then "rate?" while the
    // first reply is still being written. A read-modify-write around the model
    // call drops one of them, and the customer's own words are the last thing
    // this desk may lose.
    await Promise.all([
      handleInbound({ phoneNumberId: PN, from: LEAD, name: 'Bilal', text: 'salam' }),
      handleInbound({ phoneNumberId: PN, from: LEAD, name: 'Bilal', text: 'rate kya hai' }),
    ]);
    const said = (await chat())?.messages.filter((m) => m.from === 'them').map((m) => m.text) ?? [];
    expect(said).toContain('salam');
    expect(said).toContain('rate kya hai');
  });

  it('keeps the lead but stops talking when the plan has run out', async () => {
    await workspaceRef(WID).set({ accessUntilMs: Date.now() - 86_400_000, paidUntilMs: Date.now() - 86_400_000, trialEndsAtMs: Date.now() - 86_400_000 }, { merge: true });
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'kitna hai' });
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
    const row = await chat();
    expect(row?.messages.some((m) => m.text === 'kitna hai')).toBe(true);
    expect(row?.stage).toBe('needs_you');
    expect(row?.nextStep).toContain('plan has run out');

    await workspaceRef(WID).set(
      { accessUntilMs: Date.now() + 30 * 86_400_000, paidUntilMs: Date.now() + 30 * 86_400_000, trialEndsAtMs: Date.now() + 86_400_000 },
      { merge: true },
    );
  });

  it('marks a number Meta says is undeliverable, and never writes to it again', async () => {
    await handleInbound({ phoneNumberId: PN, from: LEAD, name: null, text: 'rate?' });
    // 131026: the recipient is not on WhatsApp.
    expect(await handleFailure(PN, LEAD, 131026, 'Message undeliverable')).toBe(true);
    expect((await chat())?.blocked).toBe(true);
  });
});

describe('the sheet the client uploaded', () => {
  const rows = ['923001112222', '923001113333', '923001114444'];

  beforeEach(async () => {
    for (const number of rows) {
      await db.doc(`${WS}/salesChats/${number}`).set({
        waId: number,
        name: 'Ali',
        source: 'sheet',
        stage: 'queued',
        language: 'english',
        messages: [],
        lastInboundAtMs: null,
        lastOutboundAtMs: null,
        summary: '',
        nextStep: '',
        followUps: 0,
        handover: false,
        blocked: false,
        blockedReason: null,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
    }
  });

  it('opens conversations with the approved template, and stops at the daily cap', async () => {
    const status = await inWorkspace(WID, () => runOutreach(Date.parse('2026-11-15T09:00:00Z')));
    const out = sent.filter((s) => s.url.includes('/messages'));
    // The cap on this workspace is two.
    expect(out).toHaveLength(2);
    for (const call of out) {
      expect(call.body.type).toBe('template');
      expect((call.body.template as { name: string }).name).toBe('first_hello');
    }
    expect(status).toContain('2 new conversations opened');

    const cfg = await inWorkspace(WID, closerConfig);
    expect(cfg.sentToday).toBe(2);
    // The third row is still waiting for tomorrow's allowance.
    const stages = await Promise.all(rows.map(async (n) => (await chat(n))?.stage));
    expect(stages.filter((st) => st === 'queued')).toHaveLength(1);
    expect(stages.filter((st) => st === 'talking')).toHaveLength(2);
  });

  it('sends nothing in the middle of the night', async () => {
    const status = await inWorkspace(WID, () => runOutreach(Date.parse('2026-11-15T22:00:00Z')));
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
    expect(status).toContain('Quiet hours');
  });

  it('will not open a conversation without the client’s consent on the batch', async () => {
    await db.doc(`${WS}/system/whatsapp`).set({ outreachConsentAtMs: null }, { merge: true });
    await inWorkspace(WID, () => runOutreach(Date.parse('2026-11-15T09:00:00Z')));
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
  });

  it('will not open one with no approved template either', async () => {
    await db.doc(`${WS}/system/whatsapp`).set({ templateName: null }, { merge: true });
    await inWorkspace(WID, () => runOutreach(Date.parse('2026-11-15T09:00:00Z')));
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
  });
});

describe('the nudge', () => {
  it('follows up a lead who went quiet on us, inside the 24-hour window', async () => {
    const nowMs = Date.parse('2026-11-15T09:00:00Z');
    await db.doc(`${WS}/salesChats/${LEAD}`).set({
      waId: LEAD,
      name: 'Bilal',
      source: 'whatsapp',
      stage: 'pitched',
      language: 'roman-urdu',
      messages: [{ from: 'them', text: 'rate kya hai', atMs: nowMs - 22 * 3600_000 }],
      lastInboundAtMs: nowMs - 22 * 3600_000,
      lastOutboundAtMs: nowMs - 21 * 3600_000,
      summary: 'Wants a plot',
      nextStep: '',
      followUps: 0,
      handover: false,
      blocked: false,
      blockedReason: null,
      createdAtMs: nowMs - 22 * 3600_000,
      updatedAtMs: nowMs - 21 * 3600_000,
    });
    await inWorkspace(WID, () => runOutreach(nowMs));
    const out = sent.filter((s) => s.url.includes('/messages'));
    expect(out).toHaveLength(1);
    // Inside the window, so a real message rather than a template — and it does
    // not count against the ration.
    expect(out[0].body.type).toBe('text');
    expect((await chat())?.followUps).toBe(1);
    expect((await inWorkspace(WID, closerConfig)).sentToday).toBe(0);
  });

  it('does not nudge somebody who is waiting on an answer from us', async () => {
    const nowMs = Date.parse('2026-11-15T09:00:00Z');
    await db.doc(`${WS}/salesChats/${LEAD}`).set({
      waId: LEAD,
      name: null,
      source: 'whatsapp',
      stage: 'talking',
      language: 'english',
      messages: [],
      // Their message is the last thing in the thread.
      lastInboundAtMs: nowMs - 21 * 3600_000,
      lastOutboundAtMs: nowMs - 22 * 3600_000,
      summary: '',
      nextStep: '',
      followUps: 0,
      handover: false,
      blocked: false,
      blockedReason: null,
      createdAtMs: nowMs - 22 * 3600_000,
      updatedAtMs: nowMs - 21 * 3600_000,
    });
    await inWorkspace(WID, () => runOutreach(nowMs));
    expect(sent.filter((s) => s.url.includes('/messages'))).toHaveLength(0);
  });
});

/**
 * The second door onto the same funnel.
 *
 * The inbox is polled rather than pushed, which makes two things the only
 * thing standing between a connected account and a mess: the watermark, so a
 * DM is not answered again every fifteen minutes, and the 24-hour window, so
 * connecting an account with months of old threads in it does not message
 * every one of those people at once.
 */
describe('a lead sends a DM on Instagram', () => {
  const IG_ME = '17841400000000000';
  const THEM = '17841499999999999';
  const CHAT = `${WS}/salesChats/ig_${THEM}`;

  const inboxAt = (atMs: number) => ({
    data: [
      {
        participants: { data: [{ id: IG_ME, username: 'shahzadestates' }, { id: THEM, username: 'ali' }] },
        messages: {
          data: [{ id: 'm1', from: { id: THEM }, message: 'price kya hai?', created_time: new Date(atMs).toISOString() }],
        },
      },
    ],
  });

  const dmsSent = () => sent.filter((s) => s.url.includes(`/${IG_ME}/messages`));

  beforeEach(async () => {
    igInbox = { data: [] };
    await db.doc(`${WS}/socialAccounts/instagram/secret/credentials`).set({
      accessToken: seal('EAAG-instagram-token-bbbbbbbbbbbbbbbbbbbbbbbbbb'),
      externalId: IG_ME,
    });
  });

  it('answers a fresh DM, from the account itself, and files it as one lead', async () => {
    igInbox = inboxAt(Date.now() - 60_000);
    expect(await inWorkspace(WID, () => syncInstagramDms())).toEqual({ threads: 1, answered: 1 });

    const chat = (await db.doc(CHAT).get()).data() as SalesChat;
    expect(chat.source).toBe('instagram');
    expect(chat.name).toBe('@ali');

    // Addressed to them by their Instagram-scoped id, not to a thread or a number.
    expect(dmsSent()).toHaveLength(1);
    expect(JSON.parse(dmsSent()[0].body.recipient as string)).toEqual({ id: THEM });
  });

  it('never answers a thread that has gone cold, which Meta would refuse anyway', async () => {
    igInbox = inboxAt(Date.now() - 3 * 86_400_000);
    expect(await inWorkspace(WID, () => syncInstagramDms())).toEqual({ threads: 1, answered: 0 });
    expect((await db.doc(CHAT).get()).exists).toBe(false);
    expect(dmsSent()).toHaveLength(0);
  });

  it('does not answer the same DM again the next time the inbox is read', async () => {
    igInbox = inboxAt(Date.now() - 60_000);
    await inWorkspace(WID, () => syncInstagramDms());
    expect(await inWorkspace(WID, () => syncInstagramDms())).toEqual({ threads: 1, answered: 0 });
    expect(dmsSent()).toHaveLength(1);
  });

  it('stamps their DM with the time they wrote it, not the time the inbox was read', async () => {
    const wrote = Date.now() - 20 * 3600_000;
    igInbox = inboxAt(wrote);
    await inWorkspace(WID, () => syncInstagramDms());

    // Four hours of Meta's window are left, not a fresh twenty-four. Stamping
    // the sync's own clock here is what made the console offer a reply box on
    // threads Instagram refuses with "(#10) outside of allowed window".
    const chat = (await db.doc(CHAT).get()).data() as SalesChat;
    expect(chat.lastInboundAtMs).toBe(wrote);
    expect(chat.messages.find((m) => m.from === 'them')?.atMs).toBe(wrote);
  });

  it('corrects a stamp an earlier sweep wrote with its own clock', async () => {
    const wrote = Date.now() - 3 * 86_400_000;
    // What the old code left behind: a three-day-old DM, read and marked as
    // read, but stamped as though it had arrived an hour ago.
    await db.doc(CHAT).set({ waId: `ig_${THEM}`, source: 'instagram', lastInboundAtMs: Date.now() - 3600_000, igSyncedUpToMs: wrote });
    igInbox = inboxAt(wrote);

    expect(await inWorkspace(WID, () => syncInstagramDms())).toEqual({ threads: 1, answered: 0 });
    expect(((await db.doc(CHAT).get()).data() as SalesChat).lastInboundAtMs).toBe(wrote);
    expect(dmsSent()).toHaveLength(0);
  });

  it('says nothing and sends nothing when no Instagram account is connected', async () => {
    await db.doc(`${WS}/socialAccounts/instagram/secret/credentials`).delete();
    igInbox = inboxAt(Date.now() - 60_000);
    expect(await inWorkspace(WID, () => syncInstagramDms())).toEqual({ threads: 0, answered: 0 });
    expect(sent).toHaveLength(0);
  });
});

afterEach(() => {
  process.env.FREE_MODEL_KEY = saved.free;
  process.env.SOCIAL_TOKEN_KEY = saved.vault;
  if (saved.anthropic) process.env.ANTHROPIC_API_KEY = saved.anthropic;
  if (saved.gemini) process.env.GEMINI_KEY_RESEARCH = saved.gemini;
  process.env.FREE_MODEL_KEY = 'test-key';
  process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
});
