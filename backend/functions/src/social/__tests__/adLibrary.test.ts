/**
 * Competitors' live ads fetched from the Ad Library service: their own Page's
 * ads in impressions order, how long each has run, kept per competitor (a new
 * fetch replaces the last, what the owner pasted stays), and a month's
 * searches capped — against the emulators, the service and the model answered
 * here.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('../engine')>();
  return {
    ...real,
    modelReady: () => true,
    activeEngine: () => 'gemini',
    generateJson: async () => ({
      data: { ads: [{ n: 1, hook: 'Rs 3,999 lawn', offer: 'Free delivery', angle: 'price', lesson: 'Lead with the price.' }] },
      sources: [],
    }),
  };
});

const KEY = process.env.SOCIAL_TOKEN_KEY;
process.env.SOCIAL_TOKEN_KEY = Buffer.alloc(32, 5).toString('base64');

import { clearFirestore, db } from '../../travelMate/__tests__/helpers';
import { MONTHLY_SEARCHES, fetchCompetitor, fromLibrary, type LibraryAd } from '../adLibrary';
import { seal } from '../secrets';
import { inWorkspace } from '../workspace';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const ad = (id: string, page: string, start: string, over: Partial<LibraryAd> = {}): LibraryAd => ({
  ad_archive_id: id,
  page_name: page,
  is_active: true,
  start_date: start,
  collation_count: 2,
  publisher_platform: ['FACEBOOK', 'INSTAGRAM'],
  snapshot: { title: `${page} Eid lawn`, body: { text: 'From Rs 3,999. Free delivery.' }, link_url: 'https://biglawn.pk', cta_text: 'Shop now' },
  ...over,
});

describe('fromLibrary', () => {
  const rows = fromLibrary(
    [
      ad('901', 'Big Lawn Co', '2026-09-01T07:00:00Z'),
      ad('902', 'Someone Mentioning Big Lawn', '2026-10-30T07:00:00Z'),
      ad('903', 'Big Lawn Co.', '2026-10-20T07:00:00Z', { is_active: false, end_date: '2026-10-25T07:00:00Z', collation_count: 0 }),
      ad('904', 'big lawn co', '2026-10-31T07:00:00Z', { snapshot: { cards: [{ title: 'Card title', body: 'Card body' }] } }),
    ],
    'Big Lawn Co',
    NOW,
  );

  it('keeps only the competitor’s own Page when it is among the results, in impressions order', () => {
    expect(rows.map((r) => r.libraryId)).toEqual(['901', '903', '904']);
    expect(rows.map((r) => r.impressionsRank)).toEqual([1, 2, 3]);
  });

  it('counts days to today while live, to the end once stopped', () => {
    expect(rows[0]).toMatchObject({ startedOn: '2026-09-01', daysRunning: 62, versions: 2, platforms: ['facebook', 'instagram'] });
    expect(rows[1]).toMatchObject({ daysRunning: 6, versions: null });
  });

  it('reads the words from the snapshot, or its first card', () => {
    expect(rows[0].text).toBe('Big Lawn Co Eid lawn\nFrom Rs 3,999. Free delivery.');
    expect(rows[2].text).toBe('Card title\nCard body');
  });

  it('keeps the keyword results when the competitor’s own Page is not among them', () => {
    expect(fromLibrary([ad('905', 'Other Shop', '2026-10-01T00:00:00Z')], 'Big Lawn Co', NOW)).toHaveLength(1);
  });
});

describe('fetchCompetitor', () => {
  const realFetch = globalThis.fetch;
  let served: LibraryAd[] = [];

  beforeEach(async () => {
    await clearFirestore();
    served = [ad('901', 'Big Lawn Co', '2026-09-01T07:00:00Z')];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname !== 'www.searchapi.io') return realFetch(input, init);
      expect(url.searchParams.get('engine')).toBe('meta_ad_library');
      expect(url.searchParams.get('country')).toBe('PK');
      expect(url.searchParams.get('sort_by')).toBe('impressions_high_to_low');
      return new Response(JSON.stringify({ ads: served }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await db().doc('system/adLibrary/secret/credentials').set({ key: seal('sa-test-key-0000') });
    await db().doc('workspaces/w1').set({ name: 'Shop', ownerUid: 'o', brand: { name: 'Shop', market: 'Lahore, Pakistan' } });
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    if (KEY === undefined) delete process.env.SOCIAL_TOKEN_KEY;
    else process.env.SOCIAL_TOKEN_KEY = KEY;
  });

  it('keeps the competitor’s ads read, replaces its last fetch, and leaves what the owner pasted', async () => {
    await inWorkspace('w1', async () => {
      await db().doc('workspaces/w1/competitorAds/lib-old').set({ competitor: 'Big Lawn Co', source: 'library' });
      await db().doc('workspaces/w1/competitorAds/pasted').set({ competitor: 'Big Lawn Co', source: 'paste' });
      expect(await fetchCompetitor('Big Lawn Co', NOW)).toBe(1);
    });
    const ads = await db().collection('workspaces/w1/competitorAds').get();
    expect(ads.docs.map((d) => d.id).sort()).toEqual(['lib-901', 'pasted']);
    expect(ads.docs.find((d) => d.id === 'lib-901')!.data()).toMatchObject({
      competitor: 'Big Lawn Co',
      source: 'library',
      impressionsRank: 1,
      hook: 'Rs 3,999 lawn',
      angle: 'price',
    });
    expect((await db().doc('workspaces/w1/system/adLibraryUsage').get()).get('count')).toBe(1);
  });

  it('stops at the month’s searches, and says plainly when there is no key', async () => {
    await db().doc('workspaces/w1/system/adLibraryUsage').set({ month: '2026-11', count: MONTHLY_SEARCHES });
    await expect(inWorkspace('w1', () => fetchCompetitor('Big Lawn Co', NOW))).rejects.toThrow(/searches are used up/);
    await db().doc('system/adLibrary/secret/credentials').delete();
    const env = process.env.SEARCHAPI_KEY;
    delete process.env.SEARCHAPI_KEY;
    await expect(inWorkspace('w1', () => fetchCompetitor('Big Lawn Co', NOW))).rejects.toThrow(/not switched on yet/);
    if (env !== undefined) process.env.SEARCHAPI_KEY = env;
  });
});
