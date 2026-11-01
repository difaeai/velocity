/**
 * Competitors' live ads, fetched — the automatic half of the Research
 * Assistant's competitor watch (the owner can still paste one: competitorAds.ts).
 *
 * Meta's own Ad Library API returns commercial ads only for ads shown in the
 * EU, and the Library website cannot be read from a server: it walls off
 * data-centre addresses, and scraping it breaks Meta's terms. SearchApi runs
 * that read as a service. One request returns a competitor's active ads in a
 * country ordered by impressions, highest first — the closest thing to "the ad
 * that is working" anyone outside the advertiser can see — with when each
 * started and how many versions of it run. No one's Meta account is involved.
 * Spend is still never shown: Meta does not publish it for these ads.
 *
 * Velocity's admin pastes the SearchApi key once (sealed at the root, shared by
 * every workspace); each workspace spends a capped number of searches a month.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { z } from 'zod';

import { db, FieldValue } from '../lib/firebase';
import { requireAdmin, requireAuth } from '../lib/guards';
import { rateLimit } from '../lib/ratelimit';
import { brandBlock, brandName } from './crew';
import { activeEngine, generateJson, modelReady } from './engine';
import { competitorAdsRef, type CompetitorAd } from './competitorAds';
import { open, seal, tokenVaultReady, type SealedSecret } from './secrets';
import { getSocialSettings } from './settings';
import { deskCall, forEachWorkspace, isHouse, sdb } from './workspace';

const ENDPOINT = 'https://www.searchapi.io/api/v1/search';
/** Root, not per workspace: one provider account serves every desk. */
const KEY_DOC = 'system/adLibrary';
const KEY_SECRET = 'system/adLibrary/secret/credentials';
/** Searches a customer workspace may make a month; the house is not capped this tightly. */
export const MONTHLY_SEARCHES = 40;
const HOUSE_MONTHLY = 300;
/** The top of a competitor's list is what matters: the ads with the most impressions. */
const KEEP = 10;
const DAY = 86_400_000;
// shortcut: every Studio customer sells in Pakistan today; read the country from the brand's market when one does not.
const COUNTRY = 'PK';

/** One ad as SearchApi returns it, the fields used here only. */
export interface LibraryAd {
  ad_archive_id?: string;
  page_name?: string;
  is_active?: boolean;
  start_date?: string;
  end_date?: string;
  collation_count?: number;
  publisher_platform?: string[];
  snapshot?: {
    title?: string;
    body?: { text?: string };
    link_url?: string;
    cta_text?: string;
    cards?: { title?: string; body?: string; link_url?: string }[];
  };
}

/** A competitor ad fetched from the Library: the pasted kind, plus where it ranks by impressions. */
export type FetchedAd = CompetitorAd & {
  /** 1 = the competitor's ad with the most impressions right now. */
  impressionsRank: number;
  pageName: string;
  platforms: string[];
  link: string;
  cta: string;
};

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The search's answer as competitor ads, in the order Meta ranks them by
 * impressions. When the competitor's own Page is among the results only its
 * ads are kept — a keyword search also returns other pages that mention the
 * name. Days running count to today for a live ad, to its end for one that
 * stopped. Pure.
 */
export function fromLibrary(ads: LibraryAd[], competitor: string, nowMs: number): Omit<FetchedAd, 'hook' | 'offer' | 'angle' | 'lesson' | 'engine'>[] {
  const name = fold(competitor);
  const theirs = ads.filter((a) => {
    const page = fold(a.page_name ?? '');
    return page && name && (page.includes(name) || name.includes(page));
  });
  return (theirs.length ? theirs : ads).slice(0, KEEP).map((a, i) => {
    const start = Date.parse(a.start_date ?? '');
    const end = a.is_active === false ? Date.parse(a.end_date ?? '') : nowMs;
    const until = Number.isFinite(end) ? Math.min(end, nowMs) : nowMs;
    const card = a.snapshot?.cards?.[0];
    const text = [a.snapshot?.title || card?.title, a.snapshot?.body?.text || card?.body].filter(Boolean).join('\n').trim();
    return {
      atMs: nowMs,
      competitor,
      text: text.slice(0, 3000),
      startedOn: Number.isFinite(start) ? new Date(start).toISOString().slice(0, 10) : null,
      daysRunning: Number.isFinite(start) && start <= until ? Math.floor((until - start) / DAY) + 1 : null,
      versions: typeof a.collation_count === 'number' && a.collation_count > 0 ? a.collation_count : null,
      libraryId: a.ad_archive_id ?? null,
      source: 'library' as const,
      impressionsRank: i + 1,
      pageName: a.page_name ?? '',
      platforms: (a.publisher_platform ?? []).map((p) => p.toLowerCase()),
      link: a.snapshot?.link_url ?? card?.link_url ?? '',
      cta: a.snapshot?.cta_text ?? '',
    };
  });
}

async function libraryKey(): Promise<string | null> {
  const sealed = (await db.doc(KEY_SECRET).get()).get('key') as SealedSecret | undefined;
  if (sealed) return open(sealed);
  return process.env.SEARCHAPI_KEY?.trim() || null;
}

async function search(key: string, q: string): Promise<LibraryAd[]> {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries({
    engine: 'meta_ad_library',
    q,
    country: COUNTRY,
    active_status: 'active',
    ad_type: 'all',
    sort_by: 'impressions_high_to_low',
  })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45_000) });
  const body = (await res.json().catch(() => ({}))) as { ads?: LibraryAd[]; error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `The Ad Library service answered ${res.status}.`);
  return Array.isArray(body.ads) ? body.ads : [];
}

const READ_MANY = `Read these competitor ads and say what makes each work, so our own ads can learn the pattern. Never repeat their words, never suggest copying.

Reply with ONE JSON object and nothing else:
{ "ads": [{ "n": 1, "hook": "what stops the scroll, a few words", "offer": "what it offers, or empty", "angle": "price, fear of missing out, social proof, convenience…", "lesson": "one sentence: the pattern our ads should take from it" }] }`;

/** One model call for the whole list; the first line of each when there is no model. */
async function readMany(competitor: string, ads: { text: string }[]) {
  const plain = ads.map((a) => ({ hook: a.text.split('\n')[0]?.slice(0, 120) ?? '', offer: '', angle: '', lesson: '' }));
  if (!modelReady() || !ads.length) return { reads: plain, engine: 'local' };
  try {
    const settings = await getSocialSettings();
    const { data } = await generateJson<{ ads?: Record<string, unknown>[] }>({
      model: settings.textModel,
      what: 'Competitor ads from the Library',
      system: [`You study the competition for ${brandName()}.`, brandBlock(), READ_MANY].join('\n\n'),
      prompt: `COMPETITOR: ${competitor}\n\n${ads.map((a, i) => `AD ${i + 1}:\n${a.text}`).join('\n\n')}`,
    });
    const s = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const byN = new Map((data.ads ?? []).map((r) => [Number(r.n), r]));
    return {
      reads: plain.map((p, i) => {
        const r = byN.get(i + 1);
        return r ? { hook: s(r.hook, 160) || p.hook, offer: s(r.offer, 200), angle: s(r.angle, 80), lesson: s(r.lesson, 300) } : p;
      }),
      engine: activeEngine(),
    };
  } catch (e) {
    logger.warn('research: could not read the Library ads', { error: (e as Error).message });
    return { reads: plain, engine: 'local' };
  }
}

const monthKey = (ms: number) => new Date(ms + 5 * 3600_000).toISOString().slice(0, 7);

/** Count one search against this workspace's month, or refuse when it is spent. */
async function spendSearch(nowMs: number): Promise<void> {
  const ref = sdb.doc('system/adLibraryUsage');
  const cap = isHouse() ? HOUSE_MONTHLY : MONTHLY_SEARCHES;
  const month = monthKey(nowMs);
  await db.runTransaction(async (tx) => {
    const u = (await tx.get(ref)).data() as { month?: string; count?: number } | undefined;
    const used = u?.month === month ? (u.count ?? 0) : 0;
    if (used >= cap) {
      throw new HttpsError('resource-exhausted', `This month's ${cap} Ad Library searches are used up. They start again on the 1st.`);
    }
    tx.set(ref, { month, count: used + 1 });
  });
}

/**
 * Fetch a competitor's live ads and keep them, replacing this competitor's
 * previous fetch (ads that stopped drop out). Returns how many were kept.
 */
export async function fetchCompetitor(competitor: string, nowMs = Date.now()): Promise<number> {
  const key = await libraryKey();
  if (!key) throw new HttpsError('failed-precondition', 'Automatic competitor ads are not switched on yet: Velocity has not added the Ad Library key.');
  await spendSearch(nowMs);
  const found = fromLibrary(await search(key, competitor), competitor, nowMs).filter((a) => a.text.length >= 8);
  const { reads, engine } = await readMany(competitor, found);

  const old = await competitorAdsRef().where('competitor', '==', competitor).get();
  const batch = db.batch();
  for (const d of old.docs) if ((d.data() as CompetitorAd).source === 'library') batch.delete(d.ref);
  found.forEach((a, i) => {
    const ref = a.libraryId ? competitorAdsRef().doc(`lib-${a.libraryId}`) : competitorAdsRef().doc();
    batch.set(ref, { ...a, ...reads[i], engine } satisfies FetchedAd);
  });
  await batch.commit();
  return found.length;
}

export const researchFetchCompetitorAds = deskCall('research', { timeoutSeconds: 120 }, async (req) => {
  await rateLimit(requireAuth(req).uid, 'adLibraryFetch', 15, 3600);
  const parsed = z.object({ competitor: z.string().trim().min(2).max(80) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Name the competitor — their page or brand name.');
  try {
    return { ok: true, kept: await fetchCompetitor(parsed.data.competitor) };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('unavailable', `The Ad Library could not be read: ${(e as Error).message}`);
  }
});

/** Whether automatic fetching is on, and this month's searches — what the Research page needs to show the button. */
export const researchAdLibraryState = deskCall('research', async () => {
  const [key, usage] = await Promise.all([libraryKey(), sdb.doc('system/adLibraryUsage').get()]);
  const u = usage.data() as { month?: string; count?: number } | undefined;
  return {
    available: Boolean(key),
    used: u?.month === monthKey(Date.now()) ? (u.count ?? 0) : 0,
    cap: isHouse() ? HOUSE_MONTHLY : MONTHLY_SEARCHES,
  };
});

/** Admin: store the SearchApi key, proved with one search first. */
export const adminSetAdLibraryKey = onCall({ timeoutSeconds: 60 }, async (req) => {
  const ctx = requireAdmin(req);
  if (!tokenVaultReady()) throw new HttpsError('failed-precondition', 'SOCIAL_TOKEN_KEY is not configured.');
  const parsed = z.object({ key: z.string().trim().regex(/^[A-Za-z0-9_-]{16,200}$/) }).safeParse(req.data);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Paste the SearchApi key from searchapi.io → API key.');
  try {
    await search(parsed.data.key, 'Velocity');
  } catch (e) {
    throw new HttpsError('failed-precondition', `SearchApi refused the key: ${(e as Error).message}`);
  }
  await db.doc(KEY_SECRET).set({ key: seal(parsed.data.key) });
  await db.doc(KEY_DOC).set({ last4: parsed.data.key.slice(-4), setAtMs: Date.now(), setBy: ctx.uid }, { merge: true });
  await db.collection('auditLogs').add({ type: 'adLibrary.keySet', actor: ctx.uid, createdAt: FieldValue.serverTimestamp() });
  return { ok: true, last4: parsed.data.key.slice(-4) };
});

/** Every Monday morning: each competitor already being watched, fetched again so the list stays current. */
export const competitorAdsWeekly = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'Asia/Karachi', region: 'asia-south1', timeoutSeconds: 540 },
  () =>
    forEachWorkspace('research', async () => {
      if (!(await libraryKey())) return;
      const snap = await competitorAdsRef().where('source', '==', 'library').get();
      const names = [...new Set(snap.docs.map((d) => (d.data() as CompetitorAd).competitor))].slice(0, 5);
      for (const name of names) {
        await fetchCompetitor(name).catch((e) => logger.warn('research: a weekly Library fetch failed', { name, error: (e as Error).message }));
      }
    }),
);
