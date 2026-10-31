/**
 * The launch sequence — what a new Velocity Studio workspace does on its own,
 * in order, from the minute it exists:
 *
 *   1. market   read the market: the owner's own knowledge and links, a
 *               grounded search, and a pre-launch audience test
 *   2. content  plan the month (and the next) from that read, fill the empty
 *               parts of the brief, and start making the calendar 30 days ahead
 *   3. execute  switch the desk on once an account is connected and the owner
 *               has said "ask me first" or "post directly"
 *   4. funnel   the path from a stranger to a sale: the offer, the first Meta
 *               campaign, and who the sales agent goes after
 *   5. close    the sales agent's mailbox: cold emails, two follow-ups, and an
 *               answer drafted for every reply
 *
 * A step starts when the one before it is done — or has done its part and is
 * waiting on the owner (`needs_you`), so a customer still waiting on Meta's app
 * review for Instagram still gets a funnel and a sales agent. The state lives in
 * `socialLaunch/state`; the console draws the five boxes straight from it.
 *
 * Studio only: the house desk ran for months before this existed and is left
 * exactly as it is.
 *
 * The audience test is MiroFish's idea at the size this desk can afford.
 * Rather than thousands of agents arguing on a simulated network for forty
 * rounds (a Python service, a memory store and a heavy model bill), one call
 * builds a panel of ten realistic people from the market read and shows each of
 * them the offer. Cheap enough to rerun whenever the owner adds what they know,
 * and called a simulation everywhere it is shown.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { dayKey } from '../analytics';
import { db, SCHEDULE_REGION } from '../lib/firebase';
import { requireAuth } from '../lib/guards';
import { fetchPage, readSite, textOf } from '../sales/site';
import { salesReadiness, seedSales } from '../sales';
import { PLANS, type Workspace } from '../studio/plans';
import { adsReady, launchCampaign } from './ads';
import { brandBlock, brandName, marketName } from './crew';
import { activeTeam } from './employees';
import { activeEngine, generateJson, type GroundedSource } from './engine';
import {
  marketRef,
  normaliseAnalysis,
  personas,
  planningResearch,
  topObjections,
  verdictFor,
  type AudienceTest,
  type MarketAnalysis,
} from './market';
import { getSocialSettings, patchSettings } from './settings';
import { planMonth, planRef } from './strategy';
import { currentWorkspace, deskCall, forEachWorkspace, isHouse, sdb, workspaceBrand, workspaceRef } from './workspace';

export const STEPS = ['market', 'content', 'execute', 'funnel', 'close'] as const;
export type StepId = (typeof STEPS)[number];
export type StepStatus = 'waiting' | 'working' | 'done' | 'needs_you' | 'failed' | 'skipped';

export interface StepState {
  status: StepStatus;
  atMs: number | null;
  note: string | null;
}

export interface LaunchState {
  startedAtMs: number;
  /** What the owner knows about their business and market, in their own words. */
  knowledge: string;
  /** Pages the owner asked the team to read. */
  links: string[];
  steps: Record<StepId, StepState>;
}

/** The funnel the team designs from the market read. */
export interface FunnelPlan {
  atMs: number;
  engine: string;
  offer: string;
  cta: string;
  landing: string;
  stages: { stage: string; how: string }[];
  /** The first Meta campaign, as a brief for the Meta Ad Expert. */
  adBrief: string;
  /** Kinds of business the sales agent should write to; empty when the business sells to the public. */
  salesKinds: string[];
  salesCity: string;
  openingLine: string;
  campaignId: string | null;
}

export const stateRef = () => sdb.doc('socialLaunch/state');
export const funnelRef = () => sdb.doc('socialLaunch/funnel');

/** How many days ahead the calendar is kept made once the launch plans it. */
export const MAKE_AHEAD_DAYS = 30;
export const MAX_LINKS = 6;
/** A step marked working for longer than this belongs to a function that died. */
const STALE_MS = 15 * 60_000;
/** A step that failed is tried again after this long, not every ten minutes. */
const RETRY_MS = 60 * 60_000;

export function freshLaunch(nowMs: number): LaunchState {
  const waiting: StepState = { status: 'waiting', atMs: null, note: null };
  return {
    startedAtMs: nowMs,
    knowledge: '',
    links: [],
    steps: { market: waiting, content: waiting, execute: waiting, funnel: waiting, close: waiting },
  };
}

/** The owner's links, made fetchable: web addresses only, `https://` added to a bare domain, no repeats. Pure. */
export function cleanLinks(raw: string[]): string[] {
  const out = new Set<string>();
  for (const line of raw) {
    const v = line.trim();
    if (!v || /\s/.test(v)) continue;
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(url);
      if (u.hostname.includes('.')) out.add(u.toString());
    } catch {
      /* not an address */
    }
  }
  return [...out].slice(0, MAX_LINKS);
}

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The funnel as the model sent it, held to the shape the console draws. Pure. */
export function normaliseFunnel(data: Record<string, unknown>): Omit<FunnelPlan, 'atMs' | 'engine' | 'campaignId'> {
  const stages = Array.isArray(data.stages)
    ? data.stages
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s) => ({ stage: clip(s.stage, 30), how: clip(s.how, 300) }))
        .filter((s) => s.stage && s.how)
        .slice(0, 5)
    : [];
  return {
    offer: clip(data.offer, 300),
    cta: clip(data.cta, 60),
    landing: clip(data.landing, 160),
    stages,
    adBrief: clip(data.adBrief, 600),
    salesKinds: Array.isArray(data.salesKinds)
      ? data.salesKinds.map((k) => clip(k, 80)).filter((k) => k.length >= 2).slice(0, 6)
      : [],
    salesCity: clip(data.salesCity, 80),
    openingLine: clip(data.openingLine, 200),
  };
}

// ── the steps ───────────────────────────────────────────────────────────────

interface Outcome {
  status: StepStatus;
  note: string;
}

/** Read the owner's links: public pages only (the fetch refuses anything else), a few thousand characters each. */
async function readLinks(links: string[]): Promise<{ url: string; title: string; text: string; error: string | null }[]> {
  const out = [];
  for (const url of links.slice(0, MAX_LINKS)) {
    try {
      const page = await fetchPage(url);
      out.push({ url, title: readSite(page.html, page.url).title, text: textOf(page.html).slice(0, 6000), error: null });
    } catch (e) {
      out.push({ url, title: '', text: '', error: (e as Error).message.slice(0, 160) });
    }
  }
  return out;
}

const ANALYSIS_TASK = (search: boolean, links: boolean) => `${
  search
    ? 'You have Google Search. Use it.'
    : 'You cannot search the web today: work from the owner\'s knowledge, their pages and what you know for certain, and leave out anything you would have to guess.'
} Read the market for ${brandName()} in ${marketName()} the way a strategist does before a launch:
- who actually buys this: 3-5 kinds of buyer, and what each of them wants
- the businesses people choose instead — real ones${search ? ' you found, with their website if you found it' : ''} — and what each is known for
- how ${brandName()} can stand out, in one sentence
- 4-6 opportunities specific enough to act on this month
- 2-4 risks: what would stop people buying
- where these buyers spend their time online, most important first
- 3-5 offers or hooks likely to pull them in${links ? '\n- for every page the owner gave you, one line on what you took from it' : ''}

Weigh the owner's own knowledge above anything you assume. Report what you found, not what is usually true somewhere else; an empty list is a usable answer and an invented one is not. Never invent a competitor, a number or an address.

Reply with ONE JSON object and nothing else:
{ "summary": "3-4 sentences a busy owner reads first", "segments": [{ "who": "...", "wants": "..." }], "competitors": [{ "name": "...", "url": "https://... or empty", "knownFor": "..." }], "positioning": "...", "opportunities": ["..."], "risks": ["..."], "channels": ["..."], "offers": ["..."], "fromLinks": [{ "url": "...", "takeaway": "..." }] }`;

const TEST_TASK = `Run a pre-launch audience test the way a swarm simulation does. Build a panel of 10 realistic people from the kinds of buyer below — different ages, incomes, places and attitudes, at least three of them sceptics, because most people ignore most offers — and show each of them the offer as if it had just appeared in their feed. Each one reacts in character and honestly: would they stop scrolling, would they buy, what is in the way, what would make them say yes. Write the reactions in English.

Reply with ONE JSON object and nothing else:
{ "panel": [{ "name": "a first name", "who": "age, place, situation", "reaction": "what they think, one or two sentences in their own voice", "wouldBuy": "yes" | "maybe" | "no", "objection": "the one thing in the way, or empty", "wouldShare": true | false }], "bestHook": "the opening line this panel responded to best", "changes": ["what to change before launch, most important first"] }`;

/** The market read, then the audience test on its best offer. */
async function analyseMarket(knowledge: string, links: string[]): Promise<MarketAnalysis> {
  const settings = await getSocialSettings();
  const pages = await readLinks(links);
  const brand = workspaceBrand();
  const prompt = [
    `Today: ${dayKey(Date.now())}. Market: ${marketName()}.`,
    knowledge.trim() ? `THE OWNER'S OWN KNOWLEDGE — weigh it above anything you assume:\n${knowledge.trim()}` : '',
    pages.length
      ? `PAGES THE OWNER ASKED YOU TO READ:\n${pages
          .map((p) => `--- ${p.url}${p.title ? ` (${p.title})` : ''}\n${p.error ? `[could not be read: ${p.error}]` : p.text}`)
          .join('\n\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const system = (search: boolean) =>
    [
      `You lead research for ${brandName()}'s marketing team. Before the team plans a single post, you read the market.`,
      brandBlock(),
      ANALYSIS_TASK(search, pages.length > 0),
    ].join('\n\n');

  // Searched when the engine can; when it cannot, said so rather than dressed up as a search.
  let grounded = true;
  let result: { data: Record<string, unknown>; sources: GroundedSource[] };
  try {
    result = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: system(true),
      prompt,
      grounded: true,
      what: 'The market analysis',
    });
  } catch (e) {
    logger.warn('launch: the grounded market read failed; reading without search', { error: (e as Error).message });
    grounded = false;
    result = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      system: system(false),
      prompt,
      what: 'The market analysis',
    });
  }
  const read = normaliseAnalysis(result.data);
  if (!read.summary) throw new Error('The market analysis came back empty.');

  const offer = read.offers[0] || brand?.what || brandName();
  let test: AudienceTest | null = null;
  try {
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      what: 'The audience test',
      system: [`You run pre-launch audience tests for ${brandName()}.`, brandBlock(), TEST_TASK].join('\n\n'),
      prompt: [
        `THE MARKET READ:\n${read.summary}`,
        read.segments.length ? `THE KINDS OF BUYER:\n${read.segments.map((s) => `- ${s.who}: ${s.wants}`).join('\n')}` : '',
        `THE OFFER TO TEST, from ${brandName()}: ${offer}`,
        knowledge.trim() ? `What the owner knows:\n${knowledge.trim().slice(0, 2000)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    const panel = personas(data.panel);
    if (panel.length) {
      test = {
        ...verdictFor(panel),
        offer,
        panel,
        objections: topObjections(panel),
        bestHook: clip(data.bestHook, 160),
        changes: Array.isArray(data.changes) ? data.changes.map((c) => clip(c, 200)).filter(Boolean).slice(0, 4) : [],
      };
    }
  } catch (e) {
    // The read stands without its test; the box says the test did not run.
    logger.warn('launch: the audience test failed', { error: (e as Error).message });
  }

  return {
    ...read,
    atMs: Date.now(),
    engine: activeEngine(),
    grounded,
    test,
    sources: result.sources.slice(0, 20).map((s) => ({ title: s.title.slice(0, 200), url: s.url.slice(0, 500) })),
  };
}

const VERDICT_WORDS: Record<AudienceTest['verdict'], string> = {
  go: 'the panel would buy',
  adjust: 'the panel is interested, with changes',
  not_yet: 'the panel is not convinced yet',
};

async function stepMarket(): Promise<Outcome> {
  const state = (await stateRef().get()).data() as LaunchState;
  const a = await analyseMarket(state.knowledge, state.links);
  await marketRef().set(a);
  return {
    status: 'done',
    note: [
      `${a.segments.length} kinds of buyer, ${a.competitors.length} competitors`,
      a.test ? `audience test: ${VERDICT_WORDS[a.test.verdict]} (${Math.round(a.test.score * 100)}%)` : 'the audience test did not run',
      a.grounded ? '' : 'not searched live',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

/** `YYYY-MM` of a moment, in Pakistan's calendar like every other desk date. */
const monthOf = (ms: number) => dayKey(ms).slice(0, 7);

/** What this workspace's plan includes. */
async function planCan(): Promise<string[]> {
  const ws = (await workspaceRef(currentWorkspace()).get()).data() as Workspace | undefined;
  return ws ? PLANS[ws.plan].can : [];
}

/**
 * Why a plan leaves a step out, or null when the step is in it. The steps and
 * the sweep both ask, so an upgrade brings a skipped step back and a downgrade
 * takes a finished one out again. Pure.
 */
export function notInPlan(id: StepId, can: readonly string[]): Outcome | null {
  if (id === 'content' || id === 'execute') {
    return can.includes('content')
      ? null
      : { status: 'skipped', note: 'The content team comes with the Content and Meta Ad Expert + Everything plans.' };
  }
  if (id === 'funnel') {
    return can.includes('ads') || can.includes('sales')
      ? null
      : { status: 'skipped', note: 'The sales funnel comes with the Sales agents and Meta Ad Expert + Everything plans.' };
  }
  if (id === 'close') {
    return can.includes('sales')
      ? null
      : { status: 'skipped', note: 'The sales agent comes with the Sales agents and Meta Ad Expert + Everything plans.' };
  }
  return null;
}

async function stepContent(): Promise<Outcome> {
  const off = notInPlan('content', await planCan());
  if (off) return off;
  const a = (await marketRef().get()).data() as MarketAnalysis | undefined;
  if (!a) return { status: 'failed', note: 'There is no market analysis to plan from yet.' };
  const settings = await getSocialSettings();

  // What the team reads on every job — only where the owner left it empty.
  const brief = { ...settings.brief };
  if (!brief.posts.trim()) {
    brief.posts = [
      a.positioning ? `Stand out by: ${a.positioning}` : '',
      a.offers.length ? `Offers that pull people in: ${a.offers.join('; ')}` : '',
      a.test?.objections.length ? `Answer these doubts in the posts: ${a.test.objections.join('; ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (!brief.viral.trim()) {
    brief.viral = [
      a.segments.length ? `Who we talk to: ${a.segments.map((s) => `${s.who} (${s.wants})`).join('; ')}` : '',
      a.channels.length ? `Where they spend time: ${a.channels.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  await patchSettings({
    brief,
    // Only searched names: the researcher reads around these every morning.
    ...(!settings.competitors.length && a.grounded && a.competitors.length
      ? { competitors: a.competitors.map((c) => ({ name: c.name, url: c.url })) }
      : {}),
    ...(settings.makeAheadDays === 0 ? { makeAheadDays: MAKE_AHEAD_DAYS } : {}),
  });

  // This month and the next, so the 30 days ahead are always on the calendar. Never over a plan that exists.
  const research = await planningResearch();
  let planned = 0;
  for (const month of [...new Set([monthOf(Date.now()), monthOf(Date.now() + MAKE_AHEAD_DAYS * 86_400_000)])]) {
    if ((await planRef(month).get()).exists) continue;
    planned += Object.keys((await planMonth(month, research)).days).length;
  }
  return {
    status: 'done',
    note: planned
      ? `Planned ${planned} days from the market read. The calendar fills ${MAKE_AHEAD_DAYS} days ahead once the desk is on.`
      : 'The month was already planned; the brief now carries the market read.',
  };
}

async function stepExecute(): Promise<Outcome> {
  const off = notInPlan('execute', await planCan());
  if (off) return off;
  const [settings, team, accounts] = await Promise.all([
    getSocialSettings(),
    activeTeam(),
    sdb.collection('socialAccounts').where('status', '==', 'connected').limit(1).get(),
  ]);
  const missing = [
    team.length ? '' : 'put at least a content writer on the team',
    accounts.empty ? 'connect Instagram or Facebook' : '',
    settings.publishModeChosen ? '' : 'choose "ask me first" or "post directly"',
  ].filter(Boolean);
  if (missing.length) return { status: 'needs_you', note: `To start posting: ${missing.join(', then ')}.` };

  // The same switches "Start the desk" sets on the overview.
  if (!settings.enabled) {
    await patchSettings({ enabled: true, dailyStory: true, autoRenderVideo: true, learnFromOwnPage: true, engagementEnabled: true });
  }
  return {
    status: 'done',
    note: `Posting every day at ${String(settings.runHour).padStart(2, '0')}:00 Pakistan time, ${
      settings.autoPublish ? 'straight out' : 'after your Approve'
    }.`,
  };
}

const FUNNEL_TASK = (sales: boolean) => `Design ${brandName()}'s sales funnel from the market read below: the path from a stranger seeing a post to a paying customer, using only what this team actually has — daily posts and reels, Meta ads run by the Meta Ad Expert${sales ? ', and a sales agent that finds businesses and emails them' : ''}.

Reply with ONE JSON object and nothing else:
{ "offer": "the one offer that pulls people in, in a sentence", "cta": "what people are asked to do, 2-6 words", "landing": "where they land: the website, WhatsApp or Instagram messages — one that exists", "stages": [{ "stage": "See", "how": "..." }, { "stage": "Click", "how": "..." }, { "stage": "Talk", "how": "..." }, { "stage": "Buy", "how": "..." }], "adBrief": "the first Meta campaign in one or two sentences: who, where, and what it should make them do", "salesKinds": [${sales ? '"kinds of business to email if this business sells to other businesses — empty if it only sells to the public"' : ''}], "salesCity": "${sales ? 'the city to look in, or empty' : ''}", "openingLine": "${sales ? 'the first line of the cold email, or empty' : ''}" }`;

async function stepFunnel(): Promise<Outcome> {
  const can = await planCan();
  const off = notInPlan('funnel', can);
  if (off) return off;
  const ads = can.includes('ads');
  const sales = can.includes('sales');

  let funnel = (await funnelRef().get()).data() as FunnelPlan | undefined;
  if (!funnel) {
    const a = (await marketRef().get()).data() as MarketAnalysis | undefined;
    if (!a) return { status: 'failed', note: 'There is no market analysis to build the funnel from yet.' };
    const settings = await getSocialSettings();
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      what: 'The sales funnel',
      system: [`You are ${brandName()}'s head of growth.`, brandBlock(), FUNNEL_TASK(sales)].join('\n\n'),
      prompt: [
        `THE MARKET READ:\n${a.summary}`,
        a.positioning ? `How we stand out: ${a.positioning}` : '',
        a.offers.length ? `Offers that should pull: ${a.offers.join('; ')}` : '',
        a.test ? `The audience test: ${VERDICT_WORDS[a.test.verdict]}. Doubts: ${a.test.objections.join('; ') || 'none'}. Best hook: ${a.test.bestHook}` : '',
        a.channels.length ? `Where buyers are: ${a.channels.join(', ')}` : '',
        workspaceBrand()?.website ? `Website: ${workspaceBrand()!.website}` : 'There is no website.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    funnel = { ...normaliseFunnel(data), atMs: Date.now(), engine: activeEngine(), campaignId: null };
    if (!funnel.offer || !funnel.adBrief) throw new Error('The funnel came back without an offer.');
    await funnelRef().set(funnel);
    // Only what the owner has not filled in themselves.
    if (sales) await seedSales({ offer: funnel.offer, kinds: funnel.salesKinds, city: funnel.salesCity });
  }

  if (!ads || funnel.campaignId) {
    return { status: 'done', note: `Offer: ${funnel.offer}` };
  }
  if (!(await adsReady())) {
    return {
      status: 'needs_you',
      note: 'Funnel ready. Connect your ad account on Connected accounts and set a daily limit on the Ads page — the Meta Ad Expert launches the first campaign the moment you do.',
    };
  }
  const made = await launchCampaign({ brief: funnel.adBrief, by: 'launch' });
  await funnelRef().set({ campaignId: made.campaignId }, { merge: true });
  return {
    status: 'done',
    note: made.launched
      ? `First campaign is live: "${made.plan.name}".`
      : `First campaign "${made.plan.name}" is made and waiting for your Approve on the Ads page.`,
  };
}

async function stepClose(): Promise<Outcome> {
  const off = notInPlan('close', await planCan());
  if (off) return off;
  const s = await salesReadiness();
  if (!s.kinds) {
    return {
      status: 'skipped',
      note: 'Your customers are the public, so there are no businesses to write to. Add kinds of business on the Sales page if you also sell to companies.',
    };
  }
  if (!s.mailbox) {
    return {
      status: 'needs_you',
      note: 'Connect the mailbox the sales agent sends from on the Sales page — it then writes, follows up twice and drafts an answer to every reply.',
    };
  }
  return { status: 'done', note: `Writing to ${s.city ? `businesses in ${s.city}` : 'businesses'} every day, following up twice, answering every reply.` };
}

const RUN: Record<StepId, () => Promise<Outcome>> = {
  market: stepMarket,
  content: stepContent,
  execute: stepExecute,
  funnel: stepFunnel,
  close: stepClose,
};

const WORKING_NOTE: Record<StepId, string> = {
  market: 'Reading your links and searching the market…',
  content: 'Planning the month from the market read…',
  execute: 'Checking the accounts…',
  funnel: 'Designing the funnel…',
  close: 'Setting up the sales agent…',
};

// ── moving it along ─────────────────────────────────────────────────────────

/** Take a step for this pass, unless something else is working on it right now. */
async function claim(id: StepId): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const state = (await tx.get(stateRef())).data() as LaunchState | undefined;
    if (!state) return false;
    const step = state.steps[id];
    if (step.status === 'working' && Date.now() - (step.atMs ?? 0) < STALE_MS) return false;
    tx.update(stateRef(), { [`steps.${id}`]: { status: 'working', atMs: Date.now(), note: WORKING_NOTE[id] } });
    return true;
  });
}

/** Record how a step ended — and nothing at all when a re-check found it unchanged. */
async function settle(id: StepId, out: Outcome): Promise<void> {
  await db.runTransaction(async (tx) => {
    const step = ((await tx.get(stateRef())).data() as LaunchState | undefined)?.steps[id];
    if (!step || (step.status === out.status && step.note === out.note)) return;
    tx.update(stateRef(), { [`steps.${id}`]: { status: out.status, atMs: Date.now(), note: out.note.slice(0, 400) } });
  });
}

/**
 * Move the sequence as far as it can go right now, in order. A step waiting on
 * the owner is checked again (cheaply) every pass and lets the next one go
 * ahead; one being worked on elsewhere, or one that failed within the hour,
 * holds everything after it. A step the plan leaves out shows that, also one
 * done before a downgrade; a step skipped for the plan runs after an upgrade.
 */
export async function advanceLaunch(): Promise<void> {
  if (!(await stateRef().get()).exists) return;
  const can = await planCan();
  for (const id of STEPS) {
    const step = ((await stateRef().get()).data() as LaunchState).steps[id];
    const off = notInPlan(id, can);
    if (off) {
      if (step.status !== off.status || step.note !== off.note) await settle(id, off);
      continue;
    }
    if (step.status === 'done') continue;
    const age = Date.now() - (step.atMs ?? 0);
    if (step.status === 'working' && age < STALE_MS) return;
    if (step.status === 'failed' && age < RETRY_MS) return;
    // The sales step's own skip (no businesses to write to) ends when kinds are added: re-checked like needs_you.
    const recheck = step.status === 'needs_you' || (step.status === 'skipped' && id === 'close');
    if (!recheck && !(await claim(id))) return;
    const out = await RUN[id]().catch(
      (e: Error): Outcome => ({ status: 'failed', note: `Could not finish: ${e.message}`.slice(0, 400) }),
    );
    await settle(id, out);
    if (out.status === 'failed') return;
  }
}

/** Every ten minutes, every live workspace: carry on where its sequence stopped. */
export const socialLaunchSweep = onSchedule(
  // 2GiB because the funnel step may draw the first campaign's creative.
  { schedule: 'every 10 minutes', region: SCHEDULE_REGION, timeoutSeconds: 540, memory: '2GiB' },
  () => forEachWorkspace('any', advanceLaunch),
);

/**
 * "Start" / "Analyse again" in the market box: save what the owner knows and
 * the links they gave, read the market now, and carry on down the sequence
 * while the call is open. The console shows each box change as it happens.
 */
export const adminLaunchMarket = deskCall('any', { timeoutSeconds: 540, memory: '2GiB' }, async (req) => {
  requireAuth(req);
  if (isHouse()) throw new HttpsError('failed-precondition', 'The launch sequence runs for Velocity Studio workspaces.');
  const parsed = z
    .object({
      knowledge: z.string().max(6000).optional(),
      links: z.array(z.string().max(500)).max(20).optional(),
    })
    .safeParse(req.data ?? {});
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Up to 6,000 characters of what you know, and a few links.');

  await db.runTransaction(async (tx) => {
    const state = ((await tx.get(stateRef())).data() as LaunchState | undefined) ?? freshLaunch(Date.now());
    const market = state.steps.market;
    if (market.status === 'working' && Date.now() - (market.atMs ?? 0) < STALE_MS) {
      throw new HttpsError('already-exists', 'The team is already reading the market. It takes a minute or two.');
    }
    tx.set(stateRef(), {
      ...state,
      knowledge: parsed.data.knowledge?.trim() ?? state.knowledge,
      links: parsed.data.links ? cleanLinks(parsed.data.links) : state.links,
      steps: { ...state.steps, market: { status: 'working', atMs: Date.now(), note: WORKING_NOTE.market } },
    });
  });

  const out = await stepMarket().catch(
    (e: Error): Outcome => ({ status: 'failed', note: `Could not read the market: ${e.message}`.slice(0, 400) }),
  );
  await settle('market', out);
  if (out.status === 'failed') throw new HttpsError('unavailable', out.note);
  await advanceLaunch().catch((e) => logger.warn('launch: could not carry on', { error: (e as Error).message }));
  return { ok: true };
});
