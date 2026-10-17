/**
 * The roads Velocity knows by name, and roughly where they are.
 * ----------------------------------------------------------------------------
 * WHY THIS IS A HAND-WRITTEN FILE AND NOT A GEOCODER CALL
 * -------------------------------------------------------
 * Three reasons, and any one of them would be enough.
 *
 *  1. LICENCE. Google Maps Platform lets us keep place IDs for ever and
 *     coordinates for thirty days. A traffic alert has to carry coordinates to
 *     be matched against a driver's route, and alerts are re-read and re-stored
 *     on every run — so geocoded coordinates would end up living in Firestore
 *     indefinitely under a thirty-day rule. `locations/registry.ts` exists
 *     because of exactly this problem. Hand-entered coordinates are our own
 *     measurement and are not covered by anybody's terms.
 *
 *  2. COST. Geocoding every road name in every story, every quarter of an hour,
 *     for ever, to look up the same forty roads.
 *
 *  3. IT IS A BETTER MATCHER. Traffic news does not name side streets. It names
 *     Shahrah-e-Faisal, Murree Road, the Islamabad Expressway, M-2. A closed
 *     list of the corridors that actually appear in Pakistani traffic reporting
 *     recognises them with their real spellings — including the four ways
 *     everyone spells Shahrah — where a geocoder would cheerfully return a
 *     coordinate for "the road to recovery".
 *
 * MATCHING AND THE CITY
 * ---------------------
 * An entry matching is also how an alert gets its city: a story naming Korangi
 * Road is a Karachi story whether or not the word "Karachi" appears in it. That
 * is the main reason the aliases are worth the typing.
 *
 * RADII ARE DELIBERATELY COARSE
 * -----------------------------
 * A road is a line; an entry is a circle. `radiusM` is set to roughly half the
 * corridor's length so the circle covers it, which means a match says "on or
 * near this road" and nothing finer. Every surface that renders an alert must
 * keep that honest — see `types.ts`. Narrowing these to look precise would be
 * inventing precision we do not have.
 *
 * ADDING A ROAD
 * -------------
 * Add an entry. Coordinates to four decimals are plenty at these radii. Put
 * every spelling you have actually seen in a Pakistani newspaper in `aliases` —
 * including the hyphenated, unhyphenated and "e" forms — and keep them
 * lowercase. Longer aliases are matched first, so "gt road" never shadows
 * "peshawar gt road".
 * ----------------------------------------------------------------------------
 */
import type { AlertPlace, TrafficScope } from './types';

export interface GazetteerEntry {
  /** Canonical display name — what a rider reads. */
  name: string;
  /** Registry city code, or null for an intercity highway. */
  cityCode: string | null;
  scope: TrafficScope;
  lat: number;
  lng: number;
  radiusM: number;
  /** Lowercase spellings seen in print. The canonical name is added for free. */
  aliases: string[];
}

/**
 * Islamabad and Rawalpindi are one travel market and one fare city
 * (`islamabad_rawalpindi`), so they share the ISB code here. A rider in Saddar
 * cares about Faizabad closing exactly as much as one in F-10 does.
 */
const ISLAMABAD_RAWALPINDI: GazetteerEntry[] = [
  { name: 'Faizabad Interchange', cityCode: 'ISB', scope: 'city', lat: 33.6601, lng: 73.0790, radiusM: 2000,
    aliases: ['faizabad', 'faizabad chowk', 'faizabad interchange', 'faizabad flyover'] },
  { name: 'Murree Road', cityCode: 'ISB', scope: 'city', lat: 33.6200, lng: 73.0680, radiusM: 7000,
    aliases: ['murree road', 'murree rd'] },
  { name: 'Islamabad Expressway', cityCode: 'ISB', scope: 'city', lat: 33.6400, lng: 73.1150, radiusM: 9000,
    aliases: ['islamabad expressway', 'islamabad express way', 'expressway'] },
  { name: 'Srinagar Highway', cityCode: 'ISB', scope: 'city', lat: 33.6950, lng: 72.9950, radiusM: 8000,
    aliases: ['srinagar highway', 'kashmir highway'] },
  { name: 'Jinnah Avenue', cityCode: 'ISB', scope: 'city', lat: 33.7120, lng: 73.0560, radiusM: 3000,
    aliases: ['jinnah avenue', 'blue area'] },
  { name: 'Constitution Avenue', cityCode: 'ISB', scope: 'city', lat: 33.7295, lng: 73.0890, radiusM: 2500,
    aliases: ['constitution avenue', 'd-chowk', 'd chowk', 'red zone'] },
  { name: 'Zero Point Interchange', cityCode: 'ISB', scope: 'city', lat: 33.6840, lng: 73.0580, radiusM: 2000,
    aliases: ['zero point', 'zero point interchange'] },
  { name: 'IJP Road', cityCode: 'ISB', scope: 'city', lat: 33.6230, lng: 73.0400, radiusM: 5000,
    aliases: ['ijp road', 'i.j.p road', 'ijp rd'] },
  { name: 'Peshawar Road', cityCode: 'ISB', scope: 'city', lat: 33.5880, lng: 72.9900, radiusM: 6000,
    aliases: ['peshawar road', 'peshawar rd'] },
  { name: 'Margalla Road', cityCode: 'ISB', scope: 'city', lat: 33.7320, lng: 73.0500, radiusM: 6000,
    aliases: ['margalla road', 'margalla avenue'] },
  { name: 'Rawal Dam Chowk', cityCode: 'ISB', scope: 'city', lat: 33.7020, lng: 73.1200, radiusM: 2500,
    aliases: ['rawal dam chowk', 'rawal dam', 'kashmir chowk'] },
  { name: 'Committee Chowk', cityCode: 'ISB', scope: 'city', lat: 33.6080, lng: 73.0680, radiusM: 1500,
    aliases: ['committee chowk'] },
  { name: 'Saddar Rawalpindi', cityCode: 'ISB', scope: 'city', lat: 33.5950, lng: 73.0530, radiusM: 2500,
    aliases: ['saddar rawalpindi', 'rawalpindi saddar', 'raja bazaar'] },
  { name: 'Pindi GT Road', cityCode: 'ISB', scope: 'city', lat: 33.6420, lng: 73.1600, radiusM: 8000,
    aliases: ['rawat', 'mandra', 'pindi gt road'] },
  { name: 'Khayaban-e-Suhrawardy', cityCode: 'ISB', scope: 'city', lat: 33.7080, lng: 73.0820, radiusM: 3000,
    aliases: ['khayaban-e-suhrawardy', 'khayaban e suhrawardy', 'serena chowk'] },
  { name: 'Islamabad Toll Plaza', cityCode: 'ISB', scope: 'city', lat: 33.7200, lng: 72.8500, radiusM: 4000,
    aliases: ['islamabad toll plaza', 'sangjani'] },
  { name: 'Murree Expressway', cityCode: 'ISB', scope: 'city', lat: 33.8600, lng: 73.3100, radiusM: 15000,
    aliases: ['murree expressway', 'murree road expressway', 'bhurban road'] },
];

const KARACHI: GazetteerEntry[] = [
  { name: 'Shahrah-e-Faisal', cityCode: 'KHI', scope: 'city', lat: 24.8650, lng: 67.0750, radiusM: 9000,
    aliases: ['shahrah-e-faisal', 'shahra-e-faisal', 'sharea faisal', 'shahrah e faisal', 'shara-e-faisal', 'faisal road'] },
  { name: 'I.I. Chundrigar Road', cityCode: 'KHI', scope: 'city', lat: 24.8500, lng: 67.0050, radiusM: 2500,
    aliases: ['i.i. chundrigar road', 'ii chundrigar road', 'i i chundrigar', 'chundrigar road'] },
  { name: 'M.A. Jinnah Road', cityCode: 'KHI', scope: 'city', lat: 24.8650, lng: 67.0220, radiusM: 4000,
    aliases: ['m.a. jinnah road', 'ma jinnah road', 'm a jinnah road', 'numaish', 'numaish chowrangi'] },
  { name: 'Lyari Expressway', cityCode: 'KHI', scope: 'city', lat: 24.8950, lng: 67.0400, radiusM: 8000,
    aliases: ['lyari expressway', 'lyari express way'] },
  { name: 'Korangi Road', cityCode: 'KHI', scope: 'city', lat: 24.8250, lng: 67.1150, radiusM: 7000,
    aliases: ['korangi road', 'korangi', 'korangi causeway', 'korangi industrial area'] },
  { name: 'Shahrah-e-Quaideen', cityCode: 'KHI', scope: 'city', lat: 24.8700, lng: 67.0400, radiusM: 3000,
    aliases: ['shahrah-e-quaideen', 'shahra-e-quaideen', 'sharea quaideen'] },
  { name: 'University Road', cityCode: 'KHI', scope: 'city', lat: 24.9100, lng: 67.1050, radiusM: 7000,
    aliases: ['university road karachi', 'nipa chowrangi', 'nipa'] },
  { name: 'Rashid Minhas Road', cityCode: 'KHI', scope: 'city', lat: 24.9250, lng: 67.0980, radiusM: 7000,
    aliases: ['rashid minhas road', 'rashid minhas'] },
  { name: 'Shahrah-e-Pakistan', cityCode: 'KHI', scope: 'city', lat: 24.9250, lng: 67.0600, radiusM: 6000,
    aliases: ['shahrah-e-pakistan', 'sharea pakistan', 'shahra-e-pakistan'] },
  { name: 'Sohrab Goth', cityCode: 'KHI', scope: 'city', lat: 24.9550, lng: 67.0900, radiusM: 3000,
    aliases: ['sohrab goth', 'al-asif square'] },
  { name: 'Clifton', cityCode: 'KHI', scope: 'city', lat: 24.8120, lng: 67.0300, radiusM: 4000,
    aliases: ['clifton', 'do darya', 'boat basin', 'teen talwar'] },
  { name: 'Saddar Karachi', cityCode: 'KHI', scope: 'city', lat: 24.8600, lng: 67.0220, radiusM: 2500,
    aliases: ['saddar karachi', 'karachi saddar', 'empress market'] },
  { name: 'Karachi Northern Bypass', cityCode: 'KHI', scope: 'city', lat: 25.0100, lng: 67.0300, radiusM: 12000,
    aliases: ['northern bypass', 'karachi northern bypass'] },
  { name: 'Karachi Super Highway', cityCode: 'KHI', scope: 'city', lat: 25.0300, lng: 67.2200, radiusM: 15000,
    aliases: ['super highway', 'karachi super highway'] },
];

const LAHORE: GazetteerEntry[] = [
  { name: 'Ferozepur Road', cityCode: 'LHE', scope: 'city', lat: 31.5050, lng: 74.3300, radiusM: 8000,
    aliases: ['ferozepur road', 'ferozpur road', 'firozepur road'] },
  { name: 'Canal Road', cityCode: 'LHE', scope: 'city', lat: 31.5150, lng: 74.3500, radiusM: 9000,
    aliases: ['canal road', 'canal bank road', 'canal view'] },
  { name: 'The Mall', cityCode: 'LHE', scope: 'city', lat: 31.5600, lng: 74.3300, radiusM: 3500,
    aliases: ['mall road lahore', 'the mall lahore', 'charing cross lahore'] },
  { name: 'Jail Road', cityCode: 'LHE', scope: 'city', lat: 31.5350, lng: 74.3340, radiusM: 3500,
    aliases: ['jail road'] },
  { name: 'Multan Road', cityCode: 'LHE', scope: 'city', lat: 31.5000, lng: 74.2700, radiusM: 8000,
    aliases: ['multan road lahore', 'chauburji'] },
  { name: 'Lahore Ring Road', cityCode: 'LHE', scope: 'city', lat: 31.6000, lng: 74.4100, radiusM: 16000,
    aliases: ['lahore ring road', 'ring road lahore'] },
  { name: 'Liberty Chowk', cityCode: 'LHE', scope: 'city', lat: 31.5160, lng: 74.3440, radiusM: 2000,
    aliases: ['liberty chowk', 'liberty market', 'gulberg lahore'] },
  { name: 'Kalma Chowk', cityCode: 'LHE', scope: 'city', lat: 31.5050, lng: 74.3350, radiusM: 2000,
    aliases: ['kalma chowk'] },
  { name: 'Thokar Niaz Baig', cityCode: 'LHE', scope: 'city', lat: 31.4700, lng: 74.2400, radiusM: 3500,
    aliases: ['thokar niaz baig', 'thokar'] },
  { name: 'Lahore GT Road', cityCode: 'LHE', scope: 'city', lat: 31.6300, lng: 74.3900, radiusM: 9000,
    aliases: ['shahdara', 'lahore gt road', 'ravi bridge', 'ravi road'] },
  { name: 'Raiwind Road', cityCode: 'LHE', scope: 'city', lat: 31.4300, lng: 74.2300, radiusM: 9000,
    aliases: ['raiwind road'] },
  { name: 'Azadi Chowk', cityCode: 'LHE', scope: 'city', lat: 31.5900, lng: 74.3100, radiusM: 2000,
    aliases: ['azadi chowk', 'data darbar', 'minar-e-pakistan'] },
  { name: 'Mall of Lahore Underpass', cityCode: 'LHE', scope: 'city', lat: 31.5230, lng: 74.3570, radiusM: 2000,
    aliases: ['walton road', 'cantt lahore'] },
];

const MULTAN: GazetteerEntry[] = [
  { name: 'Bosan Road', cityCode: 'MUX', scope: 'city', lat: 30.2300, lng: 71.4700, radiusM: 5000,
    aliases: ['bosan road'] },
  { name: 'Vehari Road', cityCode: 'MUX', scope: 'city', lat: 30.2000, lng: 71.5200, radiusM: 5000,
    aliases: ['vehari road'] },
  { name: 'Khanewal Road', cityCode: 'MUX', scope: 'city', lat: 30.2200, lng: 71.5300, radiusM: 6000,
    aliases: ['khanewal road'] },
  { name: 'Abdali Road', cityCode: 'MUX', scope: 'city', lat: 30.1960, lng: 71.4720, radiusM: 2500,
    aliases: ['abdali road', 'chowk kumharanwala', 'kumharanwala'] },
  { name: 'Nishtar Road', cityCode: 'MUX', scope: 'city', lat: 30.1900, lng: 71.4820, radiusM: 2500,
    aliases: ['nishtar road', 'nishtar chowk'] },
  { name: 'Multan Bypass', cityCode: 'MUX', scope: 'city', lat: 30.1700, lng: 71.5000, radiusM: 9000,
    aliases: ['multan bypass', 'multan northern bypass'] },
];

const PESHAWAR: GazetteerEntry[] = [
  { name: 'Peshawar GT Road', cityCode: 'PEW', scope: 'city', lat: 34.0150, lng: 71.5900, radiusM: 8000,
    aliases: ['peshawar gt road', 'g.t road peshawar'] },
  { name: 'University Road Peshawar', cityCode: 'PEW', scope: 'city', lat: 34.0020, lng: 71.5100, radiusM: 6000,
    aliases: ['university road peshawar', 'tehkal'] },
  { name: 'Peshawar Ring Road', cityCode: 'PEW', scope: 'city', lat: 34.0250, lng: 71.5600, radiusM: 10000,
    aliases: ['peshawar ring road', 'ring road peshawar'] },
  { name: 'Khyber Road', cityCode: 'PEW', scope: 'city', lat: 34.0050, lng: 71.5500, radiusM: 3500,
    aliases: ['khyber road', 'saddar peshawar'] },
  { name: 'Charsadda Road', cityCode: 'PEW', scope: 'city', lat: 34.0400, lng: 71.5450, radiusM: 6000,
    aliases: ['charsadda road'] },
  { name: 'Kohat Road', cityCode: 'PEW', scope: 'city', lat: 33.9750, lng: 71.5250, radiusM: 6000,
    aliases: ['kohat road'] },
  { name: 'Hayatabad', cityCode: 'PEW', scope: 'city', lat: 33.9900, lng: 71.4450, radiusM: 4000,
    aliases: ['hayatabad', 'bab-e-peshawar'] },
];

/**
 * Intercity roads. These never appear on a city booking screen — only on a
 * route that actually runs along them, which is what `scope: 'highway'` buys.
 * An M-5 closure is life-or-death to a Multan–Sukkur run and pure noise to
 * somebody going from Gulberg to Model Town.
 */
const HIGHWAYS: GazetteerEntry[] = [
  { name: 'M-1 Motorway', cityCode: null, scope: 'highway', lat: 33.8800, lng: 72.3500, radiusM: 70000,
    aliases: ['m-1 motorway', 'm1 motorway', 'islamabad-peshawar motorway', 'chachh interchange'] },
  { name: 'M-2 Motorway', cityCode: null, scope: 'highway', lat: 32.5000, lng: 73.5000, radiusM: 160000,
    aliases: ['m-2 motorway', 'm2 motorway', 'islamabad-lahore motorway', 'pindi bhattian', 'kallar kahar', 'salt range'] },
  { name: 'M-3 Motorway', cityCode: null, scope: 'highway', lat: 31.2000, lng: 73.2000, radiusM: 110000,
    aliases: ['m-3 motorway', 'm3 motorway', 'abdul hakeem'] },
  { name: 'M-4 Motorway', cityCode: null, scope: 'highway', lat: 30.9000, lng: 72.4000, radiusM: 120000,
    aliases: ['m-4 motorway', 'm4 motorway', 'gojra', 'shorkot interchange'] },
  { name: 'M-5 Motorway', cityCode: null, scope: 'highway', lat: 28.7000, lng: 70.2000, radiusM: 190000,
    aliases: ['m-5 motorway', 'm5 motorway', 'multan-sukkur motorway'] },
  { name: 'M-9 Motorway', cityCode: null, scope: 'highway', lat: 25.1000, lng: 67.6000, radiusM: 80000,
    aliases: ['m-9 motorway', 'm9 motorway', 'karachi-hyderabad motorway'] },
  { name: 'M-11 Motorway', cityCode: null, scope: 'highway', lat: 31.9000, lng: 74.2000, radiusM: 60000,
    aliases: ['m-11 motorway', 'm11 motorway', 'lahore-sialkot motorway'] },
  { name: 'N-5 National Highway', cityCode: null, scope: 'highway', lat: 31.0000, lng: 72.5000, radiusM: 400000,
    aliases: ['n-5 highway', 'n5 highway', 'grand trunk road', 'gt road', 'g.t. road', 'national highway'] },
  { name: 'N-25 Highway', cityCode: null, scope: 'highway', lat: 27.5000, lng: 66.8000, radiusM: 250000,
    aliases: ['n-25 highway', 'n25 highway', 'rcd highway', 'karachi-quetta highway', 'khuzdar'] },
  { name: 'Karakoram Highway', cityCode: null, scope: 'highway', lat: 35.5000, lng: 74.5000, radiusM: 250000,
    aliases: ['karakoram highway', 'kkh', 'n-35', 'babusar pass', 'babusar top', 'lowari tunnel'] },
  { name: 'Indus Highway', cityCode: null, scope: 'highway', lat: 30.5000, lng: 70.5000, radiusM: 350000,
    aliases: ['indus highway', 'n-55'] },
  { name: 'Hazara Motorway', cityCode: null, scope: 'highway', lat: 34.0000, lng: 72.9000, radiusM: 80000,
    aliases: ['e-35', 'hazara motorway', 'hazara expressway'] },
];

export const GAZETTEER: GazetteerEntry[] = [
  ...ISLAMABAD_RAWALPINDI,
  ...KARACHI,
  ...LAHORE,
  ...MULTAN,
  ...PESHAWAR,
  ...HIGHWAYS,
];

/** The cities this module will publish city-scope alerts for. */
export const SERVED_CITY_CODES = ['ISB', 'KHI', 'LHE', 'MUX', 'PEW'] as const;

/**
 * City names as they appear in a dateline or a headline, to their code.
 *
 * This is the weaker of the two ways an alert gets a city — a story that names
 * a road wins, because "Karachi" in a sentence about Karachi's water supply is
 * not a Karachi traffic story. It only decides when a road matched with no city
 * of its own, or when a city-wide event (a strike, a protest) names no road.
 */
export const CITY_WORDS: { word: string; code: string; name: string }[] = [
  { word: 'islamabad', code: 'ISB', name: 'Islamabad' },
  { word: 'rawalpindi', code: 'ISB', name: 'Rawalpindi' },
  { word: 'pindi', code: 'ISB', name: 'Rawalpindi' },
  { word: 'karachi', code: 'KHI', name: 'Karachi' },
  { word: 'lahore', code: 'LHE', name: 'Lahore' },
  { word: 'multan', code: 'MUX', name: 'Multan' },
  { word: 'peshawar', code: 'PEW', name: 'Peshawar' },
];

/** Canonical city names by code, for display. */
export const CITY_NAMES: Record<string, string> = {
  ISB: 'Islamabad · Rawalpindi',
  KHI: 'Karachi',
  LHE: 'Lahore',
  MUX: 'Multan',
  PEW: 'Peshawar',
};

/**
 * Every alias, longest first, paired with its entry.
 *
 * Longest-first is what stops "gt road" matching inside "peshawar gt road" and
 * filing a Peshawar story under the national highway. Built once at module
 * load; the list never changes at runtime.
 */
const ALIAS_INDEX: { alias: string; entry: GazetteerEntry }[] = GAZETTEER.flatMap((entry) =>
  [entry.name.toLowerCase(), ...entry.aliases].map((alias) => ({ alias, entry })),
).sort((a, b) => b.alias.length - a.alias.length);

/**
 * Word-boundary match for an alias inside already-lowercased text.
 *
 * A plain `includes` would find "thokar" inside a longer word and, worse, find
 * "clifton" in "Cliftonville". The boundary characters are deliberately NOT
 * `\b`: our aliases contain dots and hyphens ("i.i. chundrigar road", "m-2
 * motorway") where `\b` lands in the middle of the phrase.
 */
function containsAlias(haystack: string, alias: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(alias, from);
    if (at < 0) return false;
    const before = at === 0 ? ' ' : haystack[at - 1]!;
    const after = at + alias.length >= haystack.length ? ' ' : haystack[at + alias.length]!;
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = at + 1;
  }
}

export interface GazetteerMatch {
  entry: GazetteerEntry;
  /** The alias that matched, for debugging a false positive later. */
  alias: string;
}

/**
 * Every distinct road the text names, most specific first.
 *
 * A match CONSUMES the text it matched. Without that, "Peshawar GT Road closed"
 * matches the Peshawar entry on `peshawar gt road` and then matches the
 * national highway on the `gt road` still sitting inside it — and a Peshawar
 * street closure goes out as an N-5 alert to every intercity rider in the
 * country. Longest-first ordering decides which entry wins; consuming the span
 * is what stops the loser matching anyway.
 *
 * Masking with a space rather than deleting keeps the surrounding word
 * boundaries intact, so "gt road and n-5 highway" still finds the second road
 * after the first is consumed.
 *
 * `text` must already be lowercased.
 */
export function matchRoads(text: string): GazetteerMatch[] {
  const seen = new Set<string>();
  const out: GazetteerMatch[] = [];
  let remaining = text;

  for (const { alias, entry } of ALIAS_INDEX) {
    if (seen.has(entry.name)) continue;
    if (!containsAlias(remaining, alias)) continue;
    seen.add(entry.name);
    out.push({ entry, alias });
    remaining = remaining.split(alias).join(' '.repeat(alias.length));
  }
  return out;
}

export const asPlace = (entry: GazetteerEntry): AlertPlace => ({
  name: entry.name,
  lat: entry.lat,
  lng: entry.lng,
  radiusM: entry.radiusM,
});
