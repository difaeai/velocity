/**
 * The launch market analysis — what the team learned about a new customer's
 * market before it planned a single post — and how it reaches the rest of the
 * desk.
 *
 * Kept apart from `launch.ts` so the month planner can read it without
 * importing the whole sequence. Everything here except the two document reads
 * is pure, and tested.
 */
import { sdb } from './workspace';
import type { ContentResearch } from './types';

export interface Segment {
  who: string;
  wants: string;
}

export interface FoundCompetitor {
  name: string;
  /** Their site, when the search found one; empty otherwise. */
  url: string;
  knownFor: string;
}

/** One simulated person on the audience-test panel. */
export interface Persona {
  name: string;
  /** Age, city, situation. */
  who: string;
  /** What they think, in their own words. */
  reaction: string;
  wouldBuy: 'yes' | 'maybe' | 'no';
  objection: string;
  wouldShare: boolean;
}

/**
 * MiroFish's idea at the size this desk can afford: a panel of realistic people
 * built from the market read, each shown the offer before anything is posted.
 * A simulation, and labelled as one wherever it is shown.
 */
export interface AudienceTest {
  verdict: 'go' | 'adjust' | 'not_yet';
  /** Share of the panel that would buy, maybes counted half; 0–1. */
  score: number;
  /** The offer the panel was shown. */
  offer: string;
  panel: Persona[];
  /** What stood in the way most often, most common first. */
  objections: string[];
  /** The opening line this panel responded to best. */
  bestHook: string;
  /** What to change before launch, most important first. */
  changes: string[];
}

export interface MarketAnalysis {
  atMs: number;
  engine: string;
  /** False when the engine could not search and the read came from the owner's words and the model alone. */
  grounded: boolean;
  summary: string;
  segments: Segment[];
  competitors: FoundCompetitor[];
  /** How to stand out, in one sentence. */
  positioning: string;
  opportunities: string[];
  risks: string[];
  /** Where this audience spends time, most important first. */
  channels: string[];
  /** Offers or hooks likely to pull people in. */
  offers: string[];
  /** What the team took from each page the owner gave it. */
  fromLinks: { url: string; takeaway: string }[];
  test: AudienceTest | null;
  sources: { title: string; url: string }[];
}

export const marketRef = () => sdb.doc('socialLaunch/market');

/** Held to `max` characters, cut between words rather than through one ("…product listings, visibilit"). */
const text = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:(–-]+$/, '');
};
const texts = (v: unknown, n: number, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => text(x, max)).filter(Boolean).slice(0, n) : [];
const objects = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : [];
const httpsOnly = (v: unknown): string => {
  const url = text(v, 300);
  return /^https?:\/\/[^\s/]+\.[^\s]+$/.test(url) ? url : '';
};

/** Whatever the model sent, held to the shape the console draws. Pure. */
export function normaliseAnalysis(
  data: Record<string, unknown>,
): Pick<
  MarketAnalysis,
  'summary' | 'segments' | 'competitors' | 'positioning' | 'opportunities' | 'risks' | 'channels' | 'offers' | 'fromLinks'
> {
  return {
    summary: text(data.summary, 900),
    segments: objects(data.segments)
      .map((s) => ({ who: text(s.who, 120), wants: text(s.wants, 240) }))
      .filter((s) => s.who)
      .slice(0, 5),
    competitors: objects(data.competitors)
      .map((c) => ({ name: text(c.name, 80), url: httpsOnly(c.url), knownFor: text(c.knownFor, 200) }))
      .filter((c) => c.name)
      .slice(0, 8),
    positioning: text(data.positioning, 300),
    opportunities: texts(data.opportunities, 6, 240),
    risks: texts(data.risks, 4, 240),
    channels: texts(data.channels, 6, 80),
    offers: texts(data.offers, 5, 200),
    fromLinks: objects(data.fromLinks)
      .map((l) => ({ url: text(l.url, 500), takeaway: text(l.takeaway, 300) }))
      .filter((l) => l.url && l.takeaway)
      .slice(0, 6),
  };
}

/** The panel as the model sent it, held to shape. Pure. */
export function personas(v: unknown): Persona[] {
  return objects(v)
    .map((p) => ({
      name: text(p.name, 40),
      who: text(p.who, 160),
      reaction: text(p.reaction, 400),
      wouldBuy: (['yes', 'maybe', 'no'].includes(p.wouldBuy as string) ? p.wouldBuy : 'no') as Persona['wouldBuy'],
      objection: text(p.objection, 200),
      wouldShare: p.wouldShare === true,
    }))
    .filter((p) => p.name && p.reaction)
    .slice(0, 12);
}

/**
 * The verdict, decided in code rather than by the model that played the
 * panel: a model asked "is this a go?" about its own simulation says yes.
 * Maybes count half. Pure.
 */
export function verdictFor(panel: Persona[]): { verdict: AudienceTest['verdict']; score: number } {
  if (!panel.length) return { verdict: 'not_yet', score: 0 };
  const points = panel.reduce((n, p) => n + (p.wouldBuy === 'yes' ? 1 : p.wouldBuy === 'maybe' ? 0.5 : 0), 0);
  const score = Math.round((points / panel.length) * 100) / 100;
  return { verdict: score >= 0.55 ? 'go' : score >= 0.3 ? 'adjust' : 'not_yet', score };
}

/** What stood in the way most often, most common first. Pure. */
export function topObjections(panel: Persona[], n = 3): string[] {
  const counts = new Map<string, { text: string; count: number }>();
  for (const p of panel) {
    const key = p.objection.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    if (!key) continue;
    const seen = counts.get(key);
    counts.set(key, { text: seen?.text ?? p.objection, count: (seen?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, n).map((o) => o.text);
}

/** The analysis as a market read the month planner already understands. Pure. */
export function asResearch(a: MarketAnalysis): ContentResearch {
  return {
    atMs: a.atMs,
    trends: a.segments.map((s) => `${s.who} want ${s.wants}`).slice(0, 6),
    competitorMoves: a.competitors.map((c) => `${c.name}${c.knownFor ? ` — ${c.knownFor}` : ''}`).slice(0, 6),
    opportunities: [...a.opportunities, ...a.offers.map((o) => `Offer: ${o}`)].slice(0, 8),
    hookPatterns: a.test?.bestHook ? [a.test.bestHook] : [],
    avoid: [...a.risks, ...(a.test?.objections ?? []).map((o) => `An objection to answer, never ignore: ${o}`)].slice(0, 6),
    sources: a.sources,
    error: null,
  };
}

/** This morning's search first, the launch analysis under it, as one read. Pure. */
export function mergeResearch(daily: ContentResearch | null, launch: ContentResearch | null): ContentResearch | null {
  if (!daily || daily.error) return launch ?? daily;
  if (!launch) return daily;
  const both = (a: string[], b: string[], n: number) => [...new Set([...a, ...b])].slice(0, n);
  return {
    ...daily,
    trends: both(daily.trends, launch.trends, 10),
    competitorMoves: both(daily.competitorMoves, launch.competitorMoves, 10),
    opportunities: both(daily.opportunities, launch.opportunities, 10),
    hookPatterns: both(daily.hookPatterns, launch.hookPatterns, 8),
    avoid: both(daily.avoid, launch.avoid, 8),
  };
}

/** The freshest picture of the market to plan with: the latest morning read and the launch analysis together. */
export async function planningResearch(): Promise<ContentResearch | null> {
  const [latest, market] = await Promise.all([
    sdb.collection('socialResearch').orderBy('date', 'desc').limit(1).get(),
    marketRef().get(),
  ]);
  const analysis = market.data() as MarketAnalysis | undefined;
  return mergeResearch(
    latest.empty ? null : (latest.docs[0].data() as ContentResearch),
    analysis?.summary ? asResearch(analysis) : null,
  );
}
