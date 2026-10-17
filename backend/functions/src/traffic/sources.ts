/**
 * The feeds, and reading XML without a dependency.
 * ----------------------------------------------------------------------------
 * EVERY ONE OF THESE WAS PROBED BY HAND, 2026-10-17
 * -------------------------------------------------
 * Not taken from a list of "Pakistani news RSS feeds" — fetched, status
 * checked, item count counted. What follows is only the feeds that answered
 * 200 with real items on that day. Several obvious candidates did not and are
 * recorded at the bottom so nobody re-probes them.
 *
 * SAME HOSTILITY AS THE FUEL SOURCES
 * ----------------------------------
 * These are free, unversioned, and owned by newsrooms with no obligation to us.
 * A feed that 404s, times out, or starts serving an HTML error page with a 200
 * contributes nothing and is not an error: the run continues with whatever else
 * answered. Nothing here decides anything — `classify.ts` does — so adding a
 * feed can only widen what is considered, never change what is believed.
 *
 * WHY NO XML LIBRARY
 * ------------------
 * Because we need four fields out of a document shape that has been stable
 * since 1999, and a parser here would be a new dependency in a Cloud Functions
 * bundle to do what forty lines of regex do. The parser below is deliberately
 * forgiving — it reads RSS 2.0 and Atom, tolerates CDATA, tolerates attributes
 * it does not understand, and returns nothing rather than throwing on anything
 * it cannot read. It never evaluates what it parses; every field is plain text
 * handed straight to `cleanText`.
 * ----------------------------------------------------------------------------
 */
import { logger } from 'firebase-functions';

import type { FeedItem } from './types';
import { pktMs } from './window';

/** A newsroom is slow, not broken, well before this. */
const FETCH_TIMEOUT_MS = 12_000;

/** Nobody reads past this many items per feed, and the feeds are date-ordered. */
const MAX_ITEMS_PER_FEED = 40;

export interface TrafficSource {
  id: string;
  /** Shown to the rider: "Dawn", not "dawn.com/feeds/pakistan". */
  name: string;
  url: string;
}

/**
 * Probed 2026-10-17: every entry returned HTTP 200 with the item count shown.
 * The city-section feeds are worth having separately from the national ones —
 * Tribune's Sindh and Punjab sections carry local road stories that never make
 * the national feed.
 */
export const TRAFFIC_SOURCES: TrafficSource[] = [
  { id: 'dawn', name: 'Dawn', url: 'https://www.dawn.com/feeds/pakistan' },                      // 30 items
  { id: 'dawn-home', name: 'Dawn', url: 'https://www.dawn.com/feeds/home' },                     // 26 items
  { id: 'tribune', name: 'The Express Tribune', url: 'https://tribune.com.pk/feed/pakistan' },   // 38 items
  { id: 'tribune-sindh', name: 'The Express Tribune', url: 'https://tribune.com.pk/feed/sindh' },// 19 items
  { id: 'tribune-punjab', name: 'The Express Tribune', url: 'https://tribune.com.pk/feed/punjab' },// 19 items
  { id: 'geo', name: 'Geo News', url: 'https://www.geo.tv/rss/1/1' },                            // 20 items
  { id: 'ary', name: 'ARY News', url: 'https://arynews.tv/category/pakistan/feed/' },            // 20 items
  { id: 'thenews', name: 'The News', url: 'https://www.thenews.com.pk/rss/1/1' },                // 50 items
  { id: 'propakistani', name: 'ProPakistani', url: 'https://propakistani.pk/feed/' },            // 10 items
  { id: 'pakobserver', name: 'Pakistan Observer', url: 'https://pakobserver.net/feed/' },        // 10 items
  { id: 'dailypakistan', name: 'Daily Pakistan', url: 'https://en.dailypakistan.com.pk/rss/' },  // 10 items
  { id: 'dailytimes', name: 'Daily Times', url: 'https://dailytimes.com.pk/feed/' },             // 10 items

  /**
   * ISLAMABAD AND RAWALPINDI, WHICH NEEDED THEIR OWN SOURCES — 2026-10-17
   * --------------------------------------------------------------------
   * The national feeds above report a Rawalpindi road the day it becomes a
   * national story, which is not the same as the day it is closed. These two
   * are where the capital's own traffic actually gets published.
   *
   * APP is the find. It is the state news agency, and it carries Islamabad
   * Traffic Police advisories VERBATIM, under an `ITP` category, within the
   * hour they are issued — the same advisories the popular alert accounts
   * relay. The item that proved it, read off the live feed while this was
   * written: "Cricket Teams' movement: ITP announces traffic diversions on
   * Islamabad Expressway, Srinagar Highway", filed 07:41 on 2026-10-17, naming
   * two corridors the gazetteer already knows. That is a first-party traffic
   * advisory arriving through a free, dated, UTF-8 RSS feed.
   */
  { id: 'app', name: 'APP', url: 'https://www.app.com.pk/feed/' },                                // 10 items, carries ITP
  { id: 'nation-isb', name: 'The Nation', url: 'https://www.nation.com.pk/rss/islamabad' },        // 100 items, undated — see dateFromLink
];

/**
 * CHAMP ALERTS, WHICH IS WHAT WAS ACTUALLY ASKED FOR AND CANNOT BE READ
 * ---------------------------------------------------------------------
 * ChampAlertsOnTheGo is the account Islamabad and Rawalpindi commuters really
 * use, and it has no machine-readable anything. Probed 2026-10-17:
 * champalertsonthego.org, www.champalertsonthego.org and /feed/ all return the
 * same 3 KB Squarespace parking page — `<title>Coming Soon</title>`, "We're
 * under construction" — so there is no site to read, let alone a feed. They
 * publish on X and Instagram, and reaching either in bulk means the paid X API
 * or a partnership with them (they list info@champalertsonthego.org). Both are
 * business decisions, not code, and neither is pretended at here.
 *
 * `app` above is the honest substitute: Champ Alerts' own primary source is ITP,
 * and APP carries ITP's advisories in a feed we can read.
 *
 * Probed and rejected on 2026-10-17 — do not re-add without re-probing:
 *   champalertsonthego.org        Squarespace parking page on every path
 *   tribune.com.pk/feed/islamabad 200 with 14 items, every one of them stamped
 *                                 29 May 2026 — the feed is not being updated,
 *                                 so the 48-hour age gate refuses all of it.
 *                                 Costs a request, returns nothing.
 *   app.com.pk/category/islamabad/feed/  200, zero items
 *   pakistantoday.com.pk/feed/    308 to a 404
 *   radio.gov.pk/feed             404
 *   brecorder.com/feeds/latest-news  200 with 30 items, but business copy
 *                                 end to end; no road has ever been in it
 *   arynews.tv/feed/              301 to a page with no items (the category
 *                                 feed above is the working one)
 *   samaa.tv/feed/                403, blocks non-browser agents
 *   nation.com.pk/rss             200 but zero <item> elements
 *   dawn.com/feeds/{city}         404 — Dawn has no per-city feeds
 *   itp.gov.pk                    no DNS answer; the Islamabad Traffic Police
 *                                 publish advisories on X and FM 92.4 only
 *   nhmp.gov.pk                   200 but an untrusted TLS chain and no feed
 *   TomTom / HERE incidents       Pakistani incident coverage could not be
 *                                 confirmed, and both need a paid key
 */

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? m[1]!.trim() : null;
};

/** Atom puts the URL in an attribute rather than in the element's text. */
const atomLink = (xml: string): string | null => {
  const m = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i.exec(xml);
  return m ? m[1]! : null;
};

/** Any of the date fields these feeds actually use, to epoch ms or null. */
export function parseDate(xml: string): number | null {
  for (const name of ['pubDate', 'dc:date', 'published', 'updated', 'lastBuildDate']) {
    const raw = tag(xml, name);
    if (!raw) continue;
    const ms = Date.parse(raw.replace(/<!\[CDATA\[|\]\]>/g, '').trim());
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/** Month names as a dated URL spells them, long or three-letter. */
const URL_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * The date out of a story's own URL, for feeds that ship items with no date.
 *
 * WHY THIS IS NOT OPTIONAL POLISH
 * -------------------------------
 * The Nation's Islamabad feed — the densest source of capital-region road
 * stories found anywhere — serves a hundred items with no `pubDate`, no
 * `dc:date`, nothing. An item with no date is read as "published now", which
 * means the 48-hour age gate waves it through and a four-day-old closure is
 * presented to a rider as current. Checked on 2026-10-17: those hundred items
 * spanned four days, 14th to 17th, and all hundred carried the date in the path
 * — `/17-Oct-2026/ihc-dismisses-38-petitions…`.
 *
 * So this reads the day off the URL. It is general rather than per-source,
 * because dated permalinks are a newsroom convention rather than one paper's
 * quirk, and it is a FALLBACK ONLY: a feed that states its own date is always
 * believed over its own URL.
 *
 * NOON, NOT MIDNIGHT
 * ------------------
 * A URL gives the day and nothing finer. Midnight would be the naive reading
 * and it is the wrong one: a three-hour congestion alert dated 00:00 has
 * already expired by breakfast, so every short-lived alert from such a feed
 * would be refused as over before anybody saw it. Noon PKT is the middle of the
 * day the paper itself claims, which keeps a same-day story inside its own
 * window and still ages a two-day-old one out.
 */
export function dateFromLink(link: string): number | null {
  // "/17-Oct-2026/" — The Nation.
  const dmy = /\/(\d{1,2})-([a-z]{3,9})-(\d{4})(?:\/|$)/i.exec(link);
  if (dmy) {
    const mo = URL_MONTHS.findIndex((m) => m.startsWith(dmy[2]!.toLowerCase().slice(0, 3)));
    const day = Number(dmy[1]);
    if (mo >= 0 && day >= 1 && day <= 31) return pktMs(Number(dmy[3]), mo + 1, day, 12);
  }

  // "/2026/10/17/" — the WordPress default, which half of these papers run.
  const ymd = /\/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\/|$)/.exec(link);
  if (ymd) {
    const y = Number(ymd[1]);
    const mo = Number(ymd[2]);
    const day = Number(ymd[3]);
    if (y > 2000 && mo >= 1 && mo <= 12 && day >= 1 && day <= 31) return pktMs(y, mo, day, 12);
  }

  return null;
}

/**
 * Pull items out of an RSS 2.0 or Atom document. Never throws.
 *
 * An item with no title or no link is dropped: the title is what gets
 * classified and the link is the alert's identity and its "read it yourself"
 * destination, so an item missing either cannot become an alert anyway.
 */
export function parseFeed(xml: string, source: TrafficSource): FeedItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const out: FeedItem[] = [];

  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = tag(block, 'title');
    const link = tag(block, 'link') ?? atomLink(block);
    if (!title || !link) continue;
    const url = link.replace(/<!\[CDATA\[|\]\]>/g, '').trim();

    const summary =
      tag(block, 'description') ??
      tag(block, 'content:encoded') ??
      tag(block, 'summary') ??
      tag(block, 'content') ??
      '';

    out.push({
      sourceId: source.id,
      sourceName: source.name,
      title,
      summary,
      link: url,
      // The feed's own date first, always. The URL is only consulted when the
      // item carried no date at all — see `dateFromLink`.
      publishedAt: parseDate(block) ?? dateFromLink(url),
    });
  }

  return out;
}

export interface FetchResult {
  sourceId: string;
  items: FeedItem[];
  error?: string;
}

/** Ask one feed. Never throws, never retries — the next run is in minutes. */
export async function fetchSource(source: TrafficSource): Promise<FetchResult> {
  try {
    const res = await fetch(source.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml, */*',
        // Named honestly. Two of these feeds 403 an unidentified agent, and
        // pretending to be Chrome to get around a newsroom's wishes is not a
        // thing to do on the way to telling riders we are trustworthy.
        'user-agent': 'VelocityRides/1.0 (+https://velocityrides.app)',
      },
    });
    if (!res.ok) return { sourceId: source.id, items: [], error: `HTTP ${res.status}` };

    const xml = await res.text();
    const items = parseFeed(xml, source);
    return {
      sourceId: source.id,
      items,
      ...(items.length === 0 ? { error: 'no usable items' } : {}),
    };
  } catch (e) {
    return { sourceId: source.id, items: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ask every feed at once. A slow feed costs the run its timeout, not more. */
export async function fetchAllSources(): Promise<FetchResult[]> {
  const results = await Promise.all(TRAFFIC_SOURCES.map(fetchSource));
  for (const r of results) {
    if (r.error) logger.warn('traffic feed contributed nothing', { source: r.sourceId, error: r.error });
  }
  return results;
}
