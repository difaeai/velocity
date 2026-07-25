/**
 * A small offline dictionary of places Pakistanis name out loud.
 *
 * DELIBERATELY NO COORDINATES. Each entry maps the many ways a place gets said
 * ("f seven markaz", "ایف سیون", "f-7") onto ONE canonical string, and stops
 * there. Resolving that string to a lat/lng is left to the booking screen's
 * existing autocomplete — the same path a typed destination takes.
 *
 * Two reasons for that split:
 *
 *   1. Correctness. A hardcoded coordinate that is subtly wrong sends a real
 *      passenger to the wrong place and charges them for it. Google's geocoder
 *      is maintained; a table in our repo is not.
 *   2. Cost. This adds no API calls. Speaking a destination costs exactly what
 *      typing it costs — nothing extra — and saved places / recent destinations
 *      short-circuit even that, because those already carry coordinates.
 *
 * The value here is disambiguation and recall, not geocoding: turning mangled
 * speech-to-text output into a string Google will actually recognise. "f seven
 * markaz" geocodes poorly; "F-7 Markaz, Islamabad" geocodes cleanly.
 *
 * Coverage is intentionally partial — the top destinations in the biggest
 * cities. Anything not listed still works: the parser falls back to handing the
 * raw spoken text to autocomplete, exactly as if the user had typed it.
 */
import { normalizeText, romanKey } from './normalize';

export interface Place {
  /** What we send onward for geocoding, and show the user. */
  readonly canonical: string;
  /** City, used to disambiguate same-named places (Saddar is in three cities). */
  readonly city: string;
  /** Every way we have heard this said or transcribed. */
  readonly aliases: readonly string[];
}

const PLACES: readonly Place[] = [
  // ── Islamabad ──────────────────────────────────────────────────────────────
  { canonical: 'F-6 Markaz (Super Market), Islamabad', city: 'Islamabad',
    aliases: ['f6 markaz', 'f 6 markaz', 'f six markaz', 'ایف سکس مرکز', 'ایف 6 مرکز', 'super market islamabad', 'سپر مارکیٹ'] },
  { canonical: 'F-7 Markaz (Jinnah Super), Islamabad', city: 'Islamabad',
    aliases: ['f7 markaz', 'f 7 markaz', 'f seven markaz', 'ایف سیون مرکز', 'ایف 7 مرکز', 'jinnah super', 'jinnah super market', 'جناح سپر'] },
  { canonical: 'F-8 Markaz, Islamabad', city: 'Islamabad',
    aliases: ['f8 markaz', 'f 8 markaz', 'f eight markaz', 'ایف ایٹ مرکز', 'ایف 8 مرکز'] },
  { canonical: 'F-10 Markaz, Islamabad', city: 'Islamabad',
    aliases: ['f10 markaz', 'f 10 markaz', 'f ten markaz', 'ایف ٹین مرکز', 'ایف 10 مرکز'] },
  { canonical: 'F-11 Markaz, Islamabad', city: 'Islamabad',
    aliases: ['f11 markaz', 'f 11 markaz', 'f eleven markaz', 'ایف الیون مرکز', 'ایف 11 مرکز'] },
  { canonical: 'G-9 Markaz (Karachi Company), Islamabad', city: 'Islamabad',
    aliases: ['g9 markaz', 'g 9 markaz', 'g nine markaz', 'جی نائن مرکز', 'karachi company', 'کراچی کمپنی'] },
  { canonical: 'G-11 Markaz, Islamabad', city: 'Islamabad',
    aliases: ['g11 markaz', 'g 11 markaz', 'g eleven markaz', 'جی الیون مرکز'] },
  { canonical: 'Blue Area, Islamabad', city: 'Islamabad',
    aliases: ['blue area', 'بلیو ایریا', 'بلو ایریا'] },
  { canonical: 'Centaurus Mall, Islamabad', city: 'Islamabad',
    aliases: ['centaurus', 'centaurus mall', 'سینٹورس', 'سنٹورس مال'] },
  { canonical: 'Faisal Mosque, Islamabad', city: 'Islamabad',
    aliases: ['faisal masjid', 'faisal mosque', 'فیصل مسجد', 'شاہ فیصل مسجد'] },
  { canonical: 'Islamabad International Airport', city: 'Islamabad',
    aliases: ['islamabad airport', 'اسلام آباد ایئرپورٹ', 'اسلام آباد ایرپورٹ', 'new airport', 'نیا ایئرپورٹ', 'benazir airport'] },
  { canonical: 'Bahria Town, Islamabad', city: 'Islamabad',
    aliases: ['bahria town', 'bahria', 'بحریہ ٹاؤن', 'بحریہ'] },
  { canonical: 'DHA Phase 2, Islamabad', city: 'Islamabad',
    aliases: ['dha phase 2 islamabad', 'dha two islamabad', 'ڈی ایچ اے فیز ٹو'] },

  // ── Rawalpindi ─────────────────────────────────────────────────────────────
  { canonical: 'Saddar, Rawalpindi', city: 'Rawalpindi',
    aliases: ['saddar rawalpindi', 'pindi saddar', 'صدر راولپنڈی', 'پنڈی صدر'] },
  { canonical: 'Raja Bazaar, Rawalpindi', city: 'Rawalpindi',
    aliases: ['raja bazaar', 'raja bazar', 'راجہ بازار'] },
  { canonical: 'Committee Chowk, Rawalpindi', city: 'Rawalpindi',
    aliases: ['committee chowk', 'کمیٹی چوک'] },
  { canonical: 'Faizabad, Rawalpindi', city: 'Rawalpindi',
    aliases: ['faizabad', 'فیض آباد', 'faizabad interchange'] },
  { canonical: 'Rawalpindi Railway Station', city: 'Rawalpindi',
    aliases: ['pindi station', 'rawalpindi station', 'railway station pindi', 'ریلوے اسٹیشن راولپنڈی'] },

  // ── Karachi ────────────────────────────────────────────────────────────────
  { canonical: 'Saddar, Karachi', city: 'Karachi',
    aliases: ['saddar karachi', 'صدر کراچی'] },
  { canonical: 'Empress Market, Karachi', city: 'Karachi',
    aliases: ['empress market', 'ایمپریس مارکیٹ'] },
  { canonical: 'Clifton, Karachi', city: 'Karachi',
    aliases: ['clifton', 'کلفٹن'] },
  { canonical: 'DHA Phase 6, Karachi', city: 'Karachi',
    aliases: ['dha phase 6', 'dha phase six', 'ڈی ایچ اے فیز سکس', 'ڈی ایچ اے فیز 6'] },
  { canonical: 'Gulshan-e-Iqbal, Karachi', city: 'Karachi',
    aliases: ['gulshan e iqbal', 'gulshan', 'گلشن اقبال', 'گلشن'] },
  { canonical: 'North Nazimabad, Karachi', city: 'Karachi',
    aliases: ['north nazimabad', 'نارتھ ناظم آباد'] },
  { canonical: 'Tariq Road, Karachi', city: 'Karachi',
    aliases: ['tariq road', 'طارق روڈ'] },
  { canonical: 'Jinnah International Airport, Karachi', city: 'Karachi',
    aliases: ['karachi airport', 'jinnah airport', 'کراچی ایئرپورٹ', 'جناح ایئرپورٹ'] },
  { canonical: 'Dolmen Mall Clifton, Karachi', city: 'Karachi',
    aliases: ['dolmen mall', 'dolmen', 'ڈولمن مال'] },
  { canonical: 'Korangi, Karachi', city: 'Karachi',
    aliases: ['korangi', 'کورنگی'] },
  { canonical: 'Lyari, Karachi', city: 'Karachi',
    aliases: ['lyari', 'لیاری'] },

  // ── Lahore ─────────────────────────────────────────────────────────────────
  { canonical: 'Liberty Market, Lahore', city: 'Lahore',
    aliases: ['liberty market', 'liberty', 'لبرٹی مارکیٹ', 'لبرٹی'] },
  { canonical: 'Anarkali Bazaar, Lahore', city: 'Lahore',
    aliases: ['anarkali', 'anarkali bazaar', 'انارکلی'] },
  { canonical: 'Gulberg, Lahore', city: 'Lahore',
    aliases: ['gulberg', 'گلبرگ'] },
  { canonical: 'DHA Phase 5, Lahore', city: 'Lahore',
    aliases: ['dha phase 5 lahore', 'dha phase five lahore', 'ڈی ایچ اے فیز فائیو'] },
  { canonical: 'Model Town, Lahore', city: 'Lahore',
    aliases: ['model town', 'ماڈل ٹاؤن'] },
  { canonical: 'Johar Town, Lahore', city: 'Lahore',
    aliases: ['johar town', 'جوہر ٹاؤن'] },
  { canonical: 'Allama Iqbal International Airport, Lahore', city: 'Lahore',
    aliases: ['lahore airport', 'allama iqbal airport', 'لاہور ایئرپورٹ'] },
  { canonical: 'Badshahi Mosque, Lahore', city: 'Lahore',
    aliases: ['badshahi masjid', 'badshahi mosque', 'بادشاہی مسجد'] },
  { canonical: 'Emporium Mall, Lahore', city: 'Lahore',
    aliases: ['emporium mall', 'emporium', 'ایمپوریم مال'] },
  { canonical: 'Lahore Railway Station', city: 'Lahore',
    aliases: ['lahore station', 'لاہور ریلوے اسٹیشن'] },

  // ── Peshawar ───────────────────────────────────────────────────────────────
  { canonical: 'Saddar, Peshawar', city: 'Peshawar',
    aliases: ['saddar peshawar', 'صدر پشاور'] },
  { canonical: 'Qissa Khwani Bazaar, Peshawar', city: 'Peshawar',
    aliases: ['qissa khwani', 'قصہ خوانی'] },
  { canonical: 'Hayatabad, Peshawar', city: 'Peshawar',
    aliases: ['hayatabad', 'حیات آباد'] },
  { canonical: 'University Road, Peshawar', city: 'Peshawar',
    aliases: ['university road peshawar', 'یونیورسٹی روڈ پشاور'] },

  // ── Quetta / Multan / Faisalabad ───────────────────────────────────────────
  { canonical: 'Zarghoon Road, Quetta', city: 'Quetta',
    aliases: ['zarghoon road', 'زرغون روڈ'] },
  { canonical: 'Cantt, Multan', city: 'Multan',
    aliases: ['multan cantt', 'ملتان کینٹ'] },
  { canonical: 'Clock Tower (Ghanta Ghar), Faisalabad', city: 'Faisalabad',
    aliases: ['ghanta ghar', 'clock tower faisalabad', 'گھنٹہ گھر'] },

  // ── Bare city names — the fallback when no area is given ───────────────────
  { canonical: 'Islamabad', city: 'Islamabad', aliases: ['islamabad', 'isb', 'اسلام آباد'] },
  { canonical: 'Rawalpindi', city: 'Rawalpindi', aliases: ['rawalpindi', 'pindi', 'راولپنڈی', 'پنڈی'] },
  { canonical: 'Karachi', city: 'Karachi', aliases: ['karachi', 'کراچی', 'ڪراچي'] },
  { canonical: 'Lahore', city: 'Lahore', aliases: ['lahore', 'لاہور'] },
  { canonical: 'Peshawar', city: 'Peshawar', aliases: ['peshawar', 'پشاور', 'پېښور'] },
  { canonical: 'Quetta', city: 'Quetta', aliases: ['quetta', 'کوئٹہ'] },
  { canonical: 'Multan', city: 'Multan', aliases: ['multan', 'ملتان'] },
  { canonical: 'Faisalabad', city: 'Faisalabad', aliases: ['faisalabad', 'فیصل آباد', 'lyallpur'] },
  { canonical: 'Hyderabad', city: 'Hyderabad', aliases: ['hyderabad', 'حیدرآباد'] },
  { canonical: 'Sialkot', city: 'Sialkot', aliases: ['sialkot', 'سیالکوٹ'] },
  { canonical: 'Gujranwala', city: 'Gujranwala', aliases: ['gujranwala', 'گوجرانوالہ'] },
  { canonical: 'Abbottabad', city: 'Abbottabad', aliases: ['abbottabad', 'ایبٹ آباد'] },
  { canonical: 'Sukkur', city: 'Sukkur', aliases: ['sukkur', 'سکھر', 'سکر'] },
];

/** Folded alias → place, plus the n-gram width the matcher needs to scan. */
interface GazetteerIndex {
  readonly lookup: ReadonlyMap<string, Place>;
  readonly maxWords: number;
}

function buildIndex(): GazetteerIndex {
  const lookup = new Map<string, Place>();
  let maxWords = 1;

  for (const place of PLACES) {
    for (const alias of place.aliases) {
      const normalized = normalizeText(alias);
      if (!normalized) continue;

      const words = normalized.split(' ');
      maxWords = Math.max(maxWords, words.length);

      if (!lookup.has(normalized)) lookup.set(normalized, place);

      const roman = words.map(romanKey).join(' ');
      if (roman && !lookup.has(roman)) lookup.set(roman, place);
    }
  }

  return { lookup, maxWords };
}

const INDEX = buildIndex();

export interface GazetteerHit {
  readonly place: Place;
  /** Token index where the match starts, inclusive. */
  readonly start: number;
  /** Token index where the match ends, exclusive. */
  readonly end: number;
}

/**
 * Find every known place in a token stream, preferring the longest match at any
 * position — so "saddar karachi" resolves to Karachi's Saddar rather than
 * matching bare "karachi" and losing the area.
 */
export function findPlaces(tokens: readonly string[]): GazetteerHit[] {
  const hits: GazetteerHit[] = [];
  let i = 0;

  while (i < tokens.length) {
    let matched: GazetteerHit | null = null;

    const widest = Math.min(INDEX.maxWords, tokens.length - i);
    for (let width = widest; width >= 1; width--) {
      const span = tokens.slice(i, i + width);
      const place =
        INDEX.lookup.get(span.join(' ')) ??
        INDEX.lookup.get(span.map(romanKey).join(' '));

      if (place) {
        matched = { place, start: i, end: i + width };
        break;
      }
    }

    if (matched) {
      hits.push(matched);
      i = matched.end;
    } else {
      i++;
    }
  }

  return hits;
}
