/**
 * What the competition's ads are doing — the part of the Research Assistant's
 * job Meta will not do for us.
 *
 * Meta's Ad Library API returns commercial ads only for ads shown in the EU;
 * for Pakistan it gives political ads alone, and scraping the Library website
 * breaks Meta's terms. So the owner brings the ads: the Research page opens a
 * competitor's live ads in the Ad Library, and the owner pastes an ad's card or
 * drops a screenshot of it. A screenshot is read on our own machine (Tesseract,
 * no AI bill); the card's own lines say when the ad started running and how
 * many versions of it run. An ad that has run for weeks is paying for itself —
 * the only "best performer" signal anyone outside the advertiser can see — so
 * that is how they are ranked. Spend is never shown: Meta does not publish it
 * for these ads, and a guess would be a made-up number.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { readImageText } from '../lib/localVision';
import { brandBlock, brandName } from './crew';
import { activeEngine, generateJson, modelReady } from './engine';
import { ownUpload } from './pipeline';
import { getSocialSettings } from './settings';
import { deskCall, sdb } from './workspace';

const DAY = 86_400_000;

/** `competitorAds/{id}` — one competitor ad as the owner brought it, read and ranked. */
export interface CompetitorAd {
  atMs: number;
  competitor: string;
  /** The ad's words as they reached us, Library lines removed. */
  text: string;
  /** `YYYY-MM-DD`, from "Started running on …"; null when the card did not say. */
  startedOn: string | null;
  /** Days it has run up to when it was added; null without a start date. */
  daysRunning: number | null;
  /** "N ads use this creative and text": how far they scaled it. */
  versions: number | null;
  libraryId: string | null;
  hook: string;
  offer: string;
  angle: string;
  /** The pattern to learn from it, never its words. */
  lesson: string;
  /** Pasted or screenshotted by the owner, or fetched from the Library (adLibrary.ts). */
  source: 'paste' | 'screenshot' | 'library';
  engine: string;
  /** Fetched ads only: 1 = the competitor's ad with the most impressions right now. */
  impressionsRank?: number;
}

/** The order the owner and the manager read them in: most impressions first, then the longest-running. Pure. */
export const byStrength = (a: CompetitorAd, b: CompetitorAd): number =>
  (a.impressionsRank ?? 999) - (b.impressionsRank ?? 999) || (b.daysRunning ?? -1) - (a.daysRunning ?? -1);

export const competitorAdsRef = () => sdb.collection('competitorAds');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "12 Oct 2026", "Oct 12, 2026" or "12 October 2026" as a UTC day; null otherwise. */
function dayOf(text: string): number | null {
  const m =
    text.match(/(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/i) ?? text.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!m) return null;
  const [day, month] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const mi = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  if (mi < 0) return null;
  const ms = Date.UTC(Number(m[3]), mi, Number(day));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * What an Ad Library card says about itself — when it started, how many
 * versions run, its Library ID — and the ad's own words with those lines taken
 * out. Pure.
 */
export function readLibraryCard(raw: string, nowMs: number): Pick<CompetitorAd, 'text' | 'startedOn' | 'daysRunning' | 'versions' | 'libraryId'> {
  const started = raw.match(/started running on\s+([^\n]{6,40})/i);
  const startMs = started ? dayOf(started[1]) : null;
  const versions = raw.match(/(\d+)\s+ads?\s+uses?\s+this\s+creative\s+and\s+text/i);
  const library = raw.match(/library\s+id:?\s*(\d{6,25})/i);
  const text = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !/^(active|inactive|sponsored|see (ad|summary) details|platforms|library id|started running on|\d+\s+ads?\s+uses? this)/i.test(l),
    )
    .join('\n')
    .slice(0, 3000);
  return {
    text,
    startedOn: startMs !== null ? new Date(startMs).toISOString().slice(0, 10) : null,
    daysRunning: startMs !== null && startMs <= nowMs ? Math.floor((nowMs - startMs) / DAY) + 1 : null,
    versions: versions ? Number(versions[1]) : null,
    libraryId: library ? library[1] : null,
  };
}

const READ_TASK = `Read one competitor's ad and say what makes it work, so our own ads can learn the pattern. Never repeat its words, never suggest copying it.

Reply with ONE JSON object and nothing else:
{ "hook": "what stops the scroll, in a few words", "offer": "what it offers, or empty", "angle": "the angle in a short phrase (price, fear of missing out, social proof, convenience…)", "lesson": "one sentence: the pattern our ads should take from it, in our own voice" }`;

/** What the ad does, in the owner's terms: the model's read, or the first line with none. */
async function readAd(competitor: string, text: string): Promise<Pick<CompetitorAd, 'hook' | 'offer' | 'angle' | 'lesson' | 'engine'>> {
  const first = text.split('\n')[0]?.slice(0, 120) ?? '';
  const plain = { hook: first, offer: '', angle: '', lesson: '', engine: 'local' };
  if (!modelReady()) return plain;
  try {
    const settings = await getSocialSettings();
    const { data } = await generateJson<Record<string, unknown>>({
      model: settings.textModel,
      what: 'A competitor ad',
      system: [`You study the competition for ${brandName()}.`, brandBlock(), READ_TASK].join('\n\n'),
      prompt: `COMPETITOR: ${competitor}\nTHE AD:\n${text}`,
    });
    const s = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    return { hook: s(data.hook, 160) || first, offer: s(data.offer, 200), angle: s(data.angle, 80), lesson: s(data.lesson, 300), engine: activeEngine() };
  } catch (e) {
    logger.warn('research: could not read a competitor ad', { error: (e as Error).message });
    return plain;
  }
}

export const researchAddCompetitorAd = deskCall('research', { timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
  await rateLimit(requireAuth(req).uid, 'competitorAd', 30, 3600);
  const parsed = z
    .object({
      competitor: z.string().trim().min(1).max(80),
      text: z.string().max(6000).optional(),
      storagePath: z.string().max(300).optional(),
    })
    .safeParse(req.data);
  if (!parsed.success || (!parsed.data.text?.trim() && !parsed.data.storagePath)) {
    throw new HttpsError('invalid-argument', 'Name the competitor, then paste the ad’s text or add a screenshot of it.');
  }
  const { competitor, storagePath } = parsed.data;
  let raw = parsed.data.text?.trim() ?? '';
  if (storagePath) {
    if (!ownUpload(storagePath)) throw new HttpsError('permission-denied', 'Add a screenshot uploaded from this console.');
    const { storage } = await import('../lib/firebase');
    const file = storage.bucket().file(storagePath);
    const [bytes] = await file.download().catch(() => {
      throw new HttpsError('not-found', 'The screenshot did not arrive. Try again.');
    });
    const read = await readImageText(bytes);
    await file.delete().catch(() => undefined);
    if (!read?.text.trim()) throw new HttpsError('failed-precondition', 'No words could be read off that screenshot. Paste the ad’s text instead.');
    raw = [raw, read.text].filter(Boolean).join('\n');
  }

  const card = readLibraryCard(raw, Date.now());
  if (card.text.length < 8) throw new HttpsError('invalid-argument', 'There are too few of the ad’s own words to read. Paste more of it.');
  const ad: CompetitorAd = {
    atMs: Date.now(),
    competitor,
    ...card,
    ...(await readAd(competitor, card.text)),
    source: storagePath ? 'screenshot' : 'paste',
  };
  // The same Library ad added twice is one ad, read again.
  const ref = card.libraryId ? competitorAdsRef().doc(`lib-${card.libraryId}`) : competitorAdsRef().doc();
  await ref.set(ad);
  return { ok: true, id: ref.id };
});

export const researchRemoveCompetitorAd = deskCall('research', async (req) => {
  const parsed = z.object({ id: z.string().regex(/^[\w-]{1,60}$/) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Invalid request.');
  await competitorAdsRef().doc(parsed.data.id).delete();
  return { ok: true };
});

/** The competition's strongest ads, for the Social Media Manager's plan: patterns, never words. */
export async function competitorAdsBlock(): Promise<string> {
  const snap = await competitorAdsRef().orderBy('atMs', 'desc').limit(60).get();
  const ads = snap.docs
    .map((d) => d.data() as CompetitorAd)
    .sort(byStrength)
    .slice(0, 5);
  if (!ads.length) return '';
  return `THE COMPETITION'S STRONGEST ADS — the most impressions right now, and the ones running longest (an ad that runs for weeks is paying for itself). Learn the pattern; never copy their words:\n${ads
    .map(
      (a) =>
        `- ${a.competitor}: ${a.impressionsRank ? `#${a.impressionsRank} by impressions, ` : ''}${a.daysRunning !== null ? `running ${a.daysRunning} days` : 'start unknown'}` +
        (a.versions ? `, ${a.versions} versions` : '') +
        `; hook "${a.hook}"` +
        (a.offer ? `; offer: ${a.offer}` : '') +
        (a.angle ? `; angle: ${a.angle}` : '') +
        (a.lesson ? ` — ${a.lesson}` : ''),
    )
    .join('\n')}`;
}
