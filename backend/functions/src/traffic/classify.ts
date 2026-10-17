/**
 * Deciding whether a news story is a road alert. Mostly, it is not.
 * ----------------------------------------------------------------------------
 * THE REFUSALS ARE THE FEATURE
 * ----------------------------
 * These are general news feeds. On any given afternoon they carry perhaps two
 * genuine road events and two hundred other things, and a great many of those
 * two hundred contain the words "road" and "closed". Real examples pulled from
 * the live feeds while writing this:
 *
 *   "A road is not a corridor"                      — an opinion column about
 *                                                     Afghanistan
 *   "...petition seeking the account's closure"     — a court story
 *   "Islamabad's H-9, G-6 weekly bazaars closed"    — not a road
 *   "Karachi to Remove 2 Traffic Signals"           — a plan, not an event
 *   "First phase of Hinglaj road construction..."   — finished months of work
 *
 * Every one of those would pass a keyword filter. A rider who is shown
 * "ROAD CLOSED" and finds the road open does not conclude that one alert was
 * wrong; they conclude the feature is wrong, and they are right to, because
 * they can no longer tell which of our alerts to act on. Precision is the only
 * thing worth having here. A missed closure costs a rider ten minutes. A
 * fabricated one costs us the right to tell them anything.
 *
 * HOW IT WORKS
 * ------------
 * Sentence by sentence, not document by document. A story can mention a road in
 * its third paragraph and a closure in its eighth without the two having
 * anything to do with each other — which is precisely the "account's closure"
 * failure. A sentence has to carry BOTH, with no veto in it, to count.
 *
 * Then, in order:
 *
 *   GATE 1  the item is recent enough to still be about now
 *   GATE 2  some sentence names a road AND an event
 *   GATE 3  that sentence carries no veto word
 *   GATE 4  the story can be placed — a known road, or a city we serve
 *   GATE 5  it is happening at a time somebody can usefully be shown
 *
 * Only after all five does anything get a kind, a severity and a window.
 *
 * GATE 5 is the newest and it is about the other half of "is this about now".
 * The first four ask whether a story is a road event at all; the fifth asks
 * whether that event is running. A morning jam reported at seven in the evening
 * passes every other gate and is still not an alert — see `windowFor`, and
 * `window.ts` for how the hours are read off the sentence.
 *
 * Pure. No Firebase, no network, no clock of its own — `now` is a parameter —
 * so every rule in here is unit-testable against the exact headline that broke
 * it. When a false positive gets through, the fix is a test with that headline
 * in it and a word in one of the lists below, in that order.
 * ----------------------------------------------------------------------------
 */
import {
  asPlace,
  CITY_NAMES,
  CITY_WORDS,
  matchRoads,
  type GazetteerMatch,
} from './gazetteer';
import type {
  AlertWindow,
  FeedItem,
  TrafficAlert,
  TrafficKind,
  TrafficScope,
  TrafficSeverity,
} from './types';
import { readWindow } from './window';

const HOUR_MS = 60 * 60 * 1000;

/**
 * A story older than this is history, not traffic. Generous because feeds
 * backfill and a 2am closure is still a 9am problem, but finite because the
 * expiry clock runs from publication and a week-old jam is not an alert.
 */
export const MAX_ITEM_AGE_MS = 48 * HOUR_MS;

// ── The word lists ──────────────────────────────────────────────────────────

/**
 * Generic road words, for stories that name no road we know. A story matching
 * only these can still become a city-wide alert ("roads blocked across
 * Karachi"), it just carries no coordinates.
 */
const ROAD_NOUNS = [
  'road', 'roads', 'highway', 'motorway', 'expressway', 'avenue', 'chowk',
  'flyover', 'underpass', 'overhead bridge', 'interchange', 'bypass',
  'carriageway', 'service road', 'toll plaza', 'tunnel', 'ring road',
  'metro bus', 'brt', 'intersection', 'junction', 'thoroughfare',
  // "traffic" ALONE is not a road noun, however much it looks like one. A
  // Council of Islamic Ideology story was published as an Islamabad road
  // closure off the phrase "maritime traffic due to the closure of the Strait
  // of Hormuz". Air traffic, data traffic and human trafficking are all one
  // bare keyword away from the same mistake, so the word only counts when
  // something in it says road.
  'vehicular traffic', 'road traffic', 'traffic police', 'traffic plan',
];

/** Event words, grouped by what they mean. First group to match wins the kind. */
const EVENT_GROUPS: { kind: TrafficKind; terms: string[] }[] = [
  {
    kind: 'protest',
    terms: [
      'protest', 'protesters', 'sit-in', 'sit in', 'dharna', 'rally', 'march',
      'procession', 'demonstration', 'wheel-jam', 'wheel jam', 'shutter-down',
      'containers placed', 'containers have been placed', 'blockade',
    ],
  },
  {
    kind: 'vip_movement',
    terms: [
      'vip movement', 'vvip movement', 'protocol', 'convoy', 'motorcade',
      'team movement', 'security plan', 'dignitaries', 'foreign delegation',
    ],
  },
  {
    kind: 'accident',
    terms: [
      'accident', 'road accident', 'crash', 'collision', 'overturned',
      'pile-up', 'pile up', 'head-on', 'rammed into', 'ran over',
    ],
  },
  {
    kind: 'weather',
    terms: [
      'landslide', 'landsliding', 'land sliding', 'heavy snowfall', 'snowfall',
      'waterlogged', 'water logging', 'inundated', 'urban flooding', 'flooded',
      'dense fog', 'heavy rain', 'rainfall disrupted', 'smog',
    ],
  },
  {
    kind: 'closure',
    terms: [
      'closed', 'closure', 'shut down', 'sealed', 'sealed off', 'seal off',
      'blocked', 'cordoned off', 'no entry', 'traffic diverted', 'diversion',
      'diverted', 'one-way', 'suspended', 'restricted', 'barricaded',
      'off-limits', 'out of bounds',
    ],
  },
  /**
   * NO `construction` GROUP, DELIBERATELY.
   *
   * It had one — 'repair work', 'excavation', 'resurfacing' — and every single
   * thing it ever matched was a progress report: "installation of barriers,
   * excavation of the underpasses, relocation of utility services and road
   * construction were in progress". None of that tells a rider anything they
   * can act on this afternoon.
   *
   * Roadworks that DO affect a commute are always reported with a closure or a
   * diversion in the same breath — "dug up, traffic diverted via Jail Road" —
   * and the `closure` group above catches those, ahead of where this group
   * would have sat. So removing it costs no real alert and removes a whole
   * category of false ones. The `construction` kind survives in the type for a
   * curated source to use; nothing in the news pipeline can produce it.
   */
  {
    kind: 'congestion',
    terms: [
      'traffic jam', 'traffic jams', 'gridlock', 'heavy traffic',
      'traffic chaos', 'traffic mess', 'bumper to bumper', 'long queues of vehicles',
    ],
  },
];

/**
 * Words that disqualify the sentence they appear in, whatever else it says.
 *
 * Checked AFTER the matched road names are masked out of the sentence, which is
 * the only reason "University Road Peshawar closed" survives a veto list
 * containing "university". Masking first means a veto can only fire on words
 * that are not part of a road's name.
 */
const VETOES: { reason: string; terms: string[] }[] = [
  {
    // Somewhere else's roads. We serve Pakistan.
    reason: 'foreign',
    terms: [
      'kabul', 'afghanistan', 'afghan', 'wakhan', 'badakhshan', 'kandahar',
      'herat', 'new delhi', 'india', 'indian', 'gaza', 'israel', 'tehran',
      'beijing', 'moscow', 'ukraine', 'washington', 'london', 'dhaka',
      'colombo', 'kathmandu', 'myanmar', 'riyadh', 'iran', 'hormuz',
    ],
  },
  {
    // Somebody else's right of way. A closed shipping lane or a grounded
    // flight is not a road event, and both are reported in exactly the
    // vocabulary a road event uses.
    reason: 'not-road-transport',
    terms: [
      'strait', 'maritime', 'shipping lines', 'shipping lane', 'vessels',
      'air traffic', 'flights', 'airline', 'railway', 'train service',
      'seaport', 'port qasim', 'runway',
    ],
  },
  {
    // The thing that closed is not a road.
    reason: 'not-a-road',
    terms: [
      'bazaar', 'bazaars', 'shops', 'shopping centre', 'school', 'schools',
      'college', 'offices', 'factory', 'mill', 'account', 'petition', 'case',
      'inquiry', 'airspace', 'bank branch', 'restaurant', 'cinema', 'park',
      'stadium gates', 'border crossing for trade', 'investigation',
    ],
  },
  {
    // "the road to recovery", "a roadmap for reform".
    reason: 'figurative',
    terms: [
      'road to recovery', 'roadmap', 'road map', 'road show', 'road ahead',
      'long road', 'bumpy road', 'path to', 'road not taken', 'road is not',
    ],
  },
  {
    // It has not happened and may never: a plan, a tender, a ribbon-cutting.
    reason: 'not-an-event',
    terms: [
      'will be built', 'to be built', 'feasibility', 'tender', 'groundbreaking',
      'foundation stone', 'approved the construction', 'plans to build',
      'allocated for', 'phase of', 'to remove', 'proposal', 'summary approved',
      'in progress', 'under way', 'underway', 'had been completed',
    ],
  },
  {
    // It is over. Shouting CLOSED at a reopened road is the same lie, inverted.
    reason: 'resolved',
    terms: [
      'reopened', 're-opened', 'reopen', 'restored', 'opened to traffic',
      'cleared the', 'traffic restored', 'resumed normal', 'back to normal',
      'lifted the ban', 'removed the containers',
    ],
  },
];

/** Phrases that make a closure worse than the default for its kind. */
const ESCALATORS = [
  'completely closed', 'fully closed', 'all traffic', 'indefinitely',
  'until further notice', 'both directions', 'sealed', 'for all vehicles',
  'shut for', 'killed', 'dead', 'fatal',
];

/** Phrases that make it milder. */
const DEESCALATORS = [
  'partially', 'partial', 'one lane', 'briefly', 'for a short', 'minor',
  'may be', 'might be', 'likely to', 'expected to', 'could be',
];

/** How long an alert of each kind stays up, from publication. */
const LIFETIME_HOURS: Record<TrafficKind, number> = {
  closure: 24,
  protest: 12,
  vip_movement: 10,
  accident: 5,
  weather: 14,
  construction: 120,
  congestion: 3,
};

/**
 * How far ahead a stated window may start and still be worth showing.
 *
 * Past this it is news, not an alert. A story filed three weeks before a
 * month-long closure is a true and useful thing to have read, and a red banner
 * about a road that is fine today is not — so it is refused rather than held.
 *
 * Nothing that matters is lost: the feeds are re-read every twenty minutes and
 * Pakistani papers re-report a closure on the morning it happens, which is the
 * telling that lands inside this horizon and becomes the alert.
 */
const WINDOW_HORIZON_MS = 7 * 24 * HOUR_MS;

/** Base severity per kind, before escalators and de-escalators. */
const BASE_SEVERITY: Record<TrafficKind, TrafficSeverity> = {
  closure: 'high',
  protest: 'high',
  vip_movement: 'medium',
  accident: 'medium',
  weather: 'medium',
  construction: 'low',
  congestion: 'low',
};

// ── Text handling ───────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&#8217;': '’', '&#8216;': '‘',
  '&#8220;': '“', '&#8221;': '”', '&hellip;': '…', '&#8230;': '…',
  '&ndash;': '–', '&mdash;': '—',
};

const decode = (s: string): string =>
  s.replace(/&#?[a-z0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ');

/**
 * Feed text to readable plain text.
 *
 * TWO THINGS HERE ARE LOAD-BEARING AND LOOK LIKE FUSSINESS.
 *
 * 1. ENTITIES ARE DECODED BEFORE TAGS ARE STRIPPED. Dawn serves its summaries
 *    with the markup entity-encoded — `&lt;p&gt;ISLAMABAD: …` — so stripping
 *    tags first finds none, and decoding afterwards puts live `<p>` tags back
 *    into text we have already declared clean. A second strip after decoding
 *    catches anything the first pass could not have seen.
 *
 * 2. BLOCK TAGS BECOME FULL STOPS, not spaces. This is the one that matters.
 *    `classify` works sentence by sentence precisely so that a road in
 *    paragraph one and a closure in paragraph eight cannot be read as one
 *    claim — and if `</p>` collapses to a space, an entire article becomes a
 *    single sentence and that protection silently disappears. It did: a Council
 *    of Islamic Ideology story was published as an Islamabad road closure
 *    because every paragraph of it had been glued into one line.
 */
export function cleanText(raw: string): string {
  return decode(
    decode(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)\s*>|<br\s*\/?>/gi, ' . ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/<[^>]*>/g, ' ')
    // The injected stops leave "word ." and runs of ". . ." where tags nested.
    .replace(/\s*\.\s*(\.\s*)+/g, '. ')
    .replace(/\s+\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split into sentences.
 *
 * Deliberately crude: a full stop, question mark, exclamation, semicolon or
 * bullet followed by a space. Pakistani newspaper style puts several distinct
 * facts behind semicolons in one sentence ("road closed to all traffic; police
 * rescue tourists"), and those really are separate claims, so semicolons split.
 * Over-splitting is the safe error — it can only make the proximity rule
 * stricter, never looser.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;•])\s+|\s+[•·]\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const hasTerm = (haystack: string, term: string): boolean => {
  const at = haystack.indexOf(term);
  if (at < 0) return false;
  // Same boundary rule as the gazetteer: terms contain spaces and hyphens, so
  // \b is unusable. "march" must not match inside "marching" or "marchers".
  const before = at === 0 ? ' ' : haystack[at - 1]!;
  const after = at + term.length >= haystack.length ? ' ' : haystack[at + term.length]!;
  if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) {
    return hasTerm(haystack.slice(at + 1), term);
  }
  return true;
};

const anyTerm = (haystack: string, terms: string[]): string | null =>
  terms.find((t) => hasTerm(haystack, t)) ?? null;

// ── The verdict ─────────────────────────────────────────────────────────────

export type RefusalReason =
  | 'too_old'
  | 'no_event'
  | 'no_road'
  | 'vetoed'
  | 'unplaceable'
  /** The story's own hours had already run out by the time we read it. */
  | 'over'
  /** It states a window, but one too far ahead to be an alert about today. */
  | 'not_yet';

export interface Classification {
  kept: boolean;
  reason?: RefusalReason;
  /** The veto word that killed it, when one did. For tuning the lists. */
  vetoedBy?: string;
  alert?: Omit<TrafficAlert, 'id' | 'createdAt'>;
}

interface SentenceHit {
  sentence: string;
  kind: TrafficKind;
  roads: GazetteerMatch[];
}

/**
 * Find the first sentence that is actually about a road event.
 *
 * "First" rather than "best": news writing puts the event in the lede, and a
 * later sentence matching more words is usually background. Taking the first
 * also makes `detail` the sentence a reader would have read first.
 */
function findEventSentence(text: string): { hit: SentenceHit | null; veto: string | null } {
  let firstVeto: string | null = null;

  for (const sentence of sentences(text)) {
    const lower = sentence.toLowerCase();

    const group = EVENT_GROUPS.find((g) => anyTerm(lower, g.terms));
    if (!group) continue;

    const roads = matchRoads(lower);
    const generic = roads.length === 0 ? anyTerm(lower, ROAD_NOUNS) : null;
    if (roads.length === 0 && !generic) continue;

    // Mask the road names before looking for vetoes, so a road called
    // "University Road" cannot be vetoed by the word "university".
    let masked = lower;
    for (const { alias } of roads) masked = masked.split(alias).join(' ');

    const veto = VETOES.map((v) => anyTerm(masked, v.terms)).find((t) => t !== null) ?? null;
    if (veto) {
      firstVeto ??= veto;
      continue;
    }

    return {
      hit: { sentence, kind: group.kind, roads },
      veto: null,
    };
  }

  return { hit: null, veto: firstVeto };
}

function severityFor(kind: TrafficKind, lower: string): TrafficSeverity {
  const base = BASE_SEVERITY[kind];
  const up = anyTerm(lower, ESCALATORS) !== null;
  const down = anyTerm(lower, DEESCALATORS) !== null;
  // A sentence can carry both ("partially closed indefinitely"). They cancel,
  // which leaves the kind's own default — the right answer for a mixed signal.
  if (up === down) return base;
  const ladder: TrafficSeverity[] = ['high', 'medium', 'low'];
  const at = ladder.indexOf(base);
  return ladder[Math.min(ladder.length - 1, Math.max(0, at + (up ? -1 : 1)))]!;
}

/** One step gentler, for a claim we are less sure is about right now. */
function soften(severity: TrafficSeverity): TrafficSeverity {
  return severity === 'high' ? 'medium' : 'low';
}

/**
 * Where this alert belongs.
 *
 * A matched road decides it, because a road knows its own city and the word
 * "Karachi" in a story does not make the story about Karachi's traffic. City
 * words are the fallback for a city-wide event that names no road.
 */
function placeOf(hit: SentenceHit, wholeText: string): {
  scope: TrafficScope;
  cityCode: string | null;
  cityName: string | null;
} | null {
  const cityRoad = hit.roads.find((r) => r.entry.scope === 'city');
  if (cityRoad) {
    const code = cityRoad.entry.cityCode!;
    return { scope: 'city', cityCode: code, cityName: CITY_NAMES[code] ?? code };
  }

  const highway = hit.roads.find((r) => r.entry.scope === 'highway');
  if (highway) return { scope: 'highway', cityCode: null, cityName: null };

  const city = CITY_WORDS.find((c) => hasTerm(wholeText, c.word));
  if (city) {
    return { scope: 'city', cityCode: city.code, cityName: CITY_NAMES[city.code] ?? city.name };
  }

  return null;
}

/**
 * Drop the connective a body sentence starts with.
 *
 * Only matters when a buried sentence becomes the alert's headline: "Besides,
 * two routes of electric buses were suspended" reads as half of a thought,
 * because it is. The connective pointed at the paragraph before it, which the
 * rider is never going to see.
 */
const dropLeadIn = (s: string): string =>
  s.replace(
    /^(besides|meanwhile|however|moreover|also|further|furthermore|in addition|on the other hand)\s*,?\s+/i,
    '',
  );

/** Trim a sentence to something that fits two lines on a phone. */
const clip = (s: string, max = 180): string =>
  s.length <= max ? s : `${s.slice(0, max - 1).replace(/[\s,;:]+\S*$/, '')}…`;

/**
 * WHEN this alert should be on somebody's screen.
 *
 * Reads the story's own hours if it gave any, and otherwise falls back to the
 * kind's lifetime running from publication — which is what every alert used
 * before windows existed, so a story that states no time behaves exactly as it
 * always did.
 *
 * ONLY THE EVENT SENTENCE IS SEARCHED FOR TIMES
 * ---------------------------------------------
 * Not the whole article, and this is a real restraint rather than laziness. A
 * time taken from somewhere else in the copy is how you get a window built out
 * of the hour a press conference started — "police told reporters at 4pm that
 * Murree Road is closed" would hide a live closure until four in the afternoon.
 * The sentence the classifier already decided is about the road event is the
 * only text with any claim to say when that event runs.
 *
 * The cost is honest: a headline closure whose hours sit in a later paragraph
 * keeps its kind lifetime instead of a tighter window. That is the same answer
 * we gave before, so nothing regresses — we just do not improve that case.
 * Widening this is possible but wants its own thinking, not a bigger string.
 */
function windowFor(
  kind: TrafficKind,
  sentence: string,
  published: number,
  now: number,
): { window: AlertWindow } | { refusal: RefusalReason } {
  const lifetime = LIFETIME_HOURS[kind] * HOUR_MS;
  const stated = readWindow(sentence, published);

  if (!stated) {
    return {
      window: { startsAt: published, endsAt: published + lifetime, basis: 'kind', phrase: null },
    };
  }

  // Whichever end the text did not give, the kind supplies. "till 6pm" starts
  // when the story was filed; "from 2pm" runs as long as its kind normally
  // would.
  const startsAt = stated.startsAt ?? published;
  const endsAt = stated.endsAt ?? startsAt + lifetime;

  // ALREADY OVER. The single most common way the old behaviour looked stupid:
  // an evening story about a morning jam, shown as live for another three
  // hours. The story is true; the alert would not be.
  if (endsAt <= now) return { refusal: 'over' };

  if (startsAt - now > WINDOW_HORIZON_MS) return { refusal: 'not_yet' };

  return {
    window: { startsAt, endsAt, basis: 'stated', phrase: stated.phrase || null },
  };
}

/**
 * One feed item in, a publishable alert or a reason out.
 *
 * `now` is a parameter so the age gate and the expiry are testable.
 */
export function classify(item: FeedItem, now: number = Date.now()): Classification {
  const published = item.publishedAt ?? now;

  // GATE 1 — old news is not traffic.
  if (now - published > MAX_ITEM_AGE_MS) return { kept: false, reason: 'too_old' };

  const title = cleanText(item.title);
  const summary = cleanText(item.summary);
  // The headline is searched first and on its own, so a story whose headline is
  // the event gets the headline as its detail rather than a stray body line.
  const text = `${title}. ${summary}`;

  const { hit, veto } = findEventSentence(text);
  if (!hit) {
    if (veto) return { kept: false, reason: 'vetoed', vetoedBy: veto };
    const lower = text.toLowerCase();
    const sawEvent = EVENT_GROUPS.some((g) => anyTerm(lower, g.terms));
    return { kept: false, reason: sawEvent ? 'no_road' : 'no_event' };
  }

  // GATE 4 — an alert we cannot put on a map or in a city is not an alert.
  const where = placeOf(hit, text.toLowerCase());
  if (!where) return { kept: false, reason: 'unplaceable' };

  const lower = hit.sentence.toLowerCase();
  const places = hit.roads.map((r) => asPlace(r.entry));

  /**
   * IS THE ROAD EVENT WHAT THE STORY IS ABOUT, OR SOMETHING IT MENTIONS?
   *
   * This decides two things, and getting it wrong looks dishonest even when the
   * classification is right. A Dawn piece headlined "Communication and Works
   * Dept told to complete Rawalpindi's underpasses by November" turned out to
   * say, eleven paragraphs down, that two electric bus routes had been
   * suspended. That is a true and useful fact. Published as a red HIGH banner
   * reading "Communication and Works Dept told to complete…", it is neither —
   * the rider is shown a severity that belongs to a sentence they cannot see,
   * over a headline that does not support it.
   *
   * So when the headline does not itself carry the event, the alert LEADS WITH
   * THE SENTENCE THAT DOES and keeps the headline underneath as provenance,
   * and the severity drops one step — a fact buried in the body is a weaker
   * claim about right now than a fact somebody chose as the headline.
   */
  const headlineCarriesIt = findEventSentence(title).hit !== null;
  const severity = headlineCarriesIt
    ? severityFor(hit.kind, lower)
    : soften(severityFor(hit.kind, lower));

  // GATE 5 — is it happening at a time anybody can be shown?
  const when = windowFor(hit.kind, hit.sentence, published, now);
  if ('refusal' in when) return { kept: false, reason: when.refusal };

  return {
    kept: true,
    alert: {
      scope: where.scope,
      cityCode: where.cityCode,
      cityName: where.cityName,
      kind: hit.kind,
      severity,
      headline: clip(headlineCarriesIt ? title : dropLeadIn(hit.sentence), 140),
      detail: headlineCarriesIt
        ? // Only worth carrying when it says something the headline did not.
          (hit.sentence === title ? null : clip(hit.sentence))
        : clip(title, 140),
      roads: hit.roads.map((r) => r.entry.name),
      places,
      source: { id: item.sourceId, name: item.sourceName, url: item.link },
      publishedAt: published,
      window: when.window,
      // The document dies with the window, not with the kind's clock. A Friday
      // story about a Sunday closure has to outlive Saturday's sweep.
      expiresAt: when.window.endsAt,
    },
  };
}
