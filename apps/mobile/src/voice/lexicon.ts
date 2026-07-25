/**
 * The vocabulary of booking a ride, in the languages Pakistanis actually use.
 *
 * Every list below mixes Urdu script, Roman Urdu, English, Punjabi, Pashto and
 * Sindhi in one bucket on purpose. The parser never asks "which language is
 * this?" — it asks "does this word mean pool?". That is what lets the app work
 * with no language selector: a sentence like "mujhe pool wich jana hai" mixes
 * three languages and still resolves, because each word is looked up
 * independently.
 *
 * Loanwords carry more weight than they look like they should. Regardless of
 * mother tongue, almost everyone says "rickshaw", "AC" and "bike" — so those
 * spellings, plus their transliteration variants, cover most real traffic. The
 * regional entries are what rescue the remainder.
 *
 * Matching is done through the folded keys from ./normalize, so each entry here
 * only needs to be written once in its most natural spelling; "rickshaw" also
 * matches "riksha", "ricksha" and "rikshaw" without those being listed.
 */
import type { RideType } from '../domain/types';

import { normalizeText, romanKey } from './normalize';

/**
 * A phrase table folded into a lookup. Handles multi-word entries by keying on
 * the whole phrase, which the parser scans for using an n-gram sweep.
 */
export interface PhraseTable<T> {
  /** Folded phrase → value. Contains both script and Roman keys. */
  readonly lookup: ReadonlyMap<string, T>;
  /** Longest entry in words — bounds the parser's n-gram window. */
  readonly maxWords: number;
}

/** Build a lookup that answers to both the script form and the Roman form. */
function buildTable<T>(entries: Array<[phrases: string[], value: T]>): PhraseTable<T> {
  const lookup = new Map<string, T>();
  let maxWords = 1;

  for (const [phrases, value] of entries) {
    for (const phrase of phrases) {
      const normalized = normalizeText(phrase);
      if (!normalized) continue;

      const words = normalized.split(' ');
      maxWords = Math.max(maxWords, words.length);

      // Script/normalised form, and the transliteration-folded form. First
      // writer wins, so earlier entries take precedence on collision.
      if (!lookup.has(normalized)) lookup.set(normalized, value);

      const roman = words.map(romanKey).join(' ');
      if (roman && !lookup.has(roman)) lookup.set(roman, value);
    }
  }

  return { lookup, maxWords };
}

// ── Ride types ───────────────────────────────────────────────────────────────

/**
 * Ordered most-specific first: "ac car" must win over the bare "car" that maps
 * to mini, and "bari gari" (big car) must win over "gari".
 */
export const RIDE_TYPES = buildTable<RideType>([
  [
    [
      'ac', 'a c', 'ac car', 'ac wali', 'ac wali gari', 'ac gari', 'air conditioned',
      'اے سی', 'اےسی', 'اے سی کار', 'اے سی والی', 'اے سی گاڑی',
      'thandi', 'thandi gari', 'ٹھنڈی', 'ٹھنڈی گاڑی',
      'سرد', 'sarad',
    ],
    'ac',
  ],
  [
    [
      'xl', 'x l', 'ایکس ایل', 'bari gari', 'badi gari', 'بڑی گاڑی', 'وڏي گاڏي',
      'large car', 'big car', 'six seater', 'chay seater', 'chhe seater',
      'van', 'ván', 'وین', 'hiace', 'ہائی ایس', 'غټه موټر',
    ],
    'xl',
  ],
  [
    [
      'comfort', 'کمفرٹ', 'aramdeh', 'aram deh', 'آرام دہ', 'premium', 'پریمیم',
      'luxury', 'لگژری', 'behtar gari', 'بہتر گاڑی',
    ],
    'comfort',
  ],
  [
    [
      'rickshaw', 'riksha', 'auto', 'auto rickshaw', 'رکشہ', 'رکشا', 'آٹو',
      'chingchi', 'chand gari', 'چنگچی', 'ٹانگہ رکشہ', 'ريڪشا', 'رckشا',
      'tuk tuk', 'ٹک ٹک',
    ],
    'auto',
  ],
  [
    [
      'bike', 'moto', 'motorcycle', 'motor cycle', 'motorbike', 'bykea',
      'بائیک', 'موٹر سائیکل', 'موٹرسائیکل', 'موٹر بائیک', ' موٹو',
      'cycle', 'سائیکل', 'موټر سایکل', 'موٽر سائيڪل',
    ],
    'bike',
  ],
  [
    [
      'mini', 'منی', 'مني', 'car', 'gari', 'gaari', 'گاڑی', 'گاڏي', 'موټر',
      'taxi', 'ٹیکسی', 'ٹیکسی گاڑی', 'cab', 'کیب',
      'choti gari', 'چھوٹی گاڑی', 'sasti gari', 'سستی گاڑی', 'normal', 'عام',
      'chota', 'small car', 'suzuki', 'سوزوکی', 'alto', 'آلٹو',
    ],
    'mini',
  ],
]);

// ── Pool vs solo ─────────────────────────────────────────────────────────────

export const POOL_WORDS = buildTable<true>([
  [
    [
      'pool', 'pool ride', 'پول', 'پول رائیڈ',
      'share', 'sharing', 'share ride', 'shared', 'شیئر', 'شیئرنگ', 'شیئرڈ',
      'saath', 'sath', 'ساتھ', 'mil ke', 'mil kar', 'مل کے', 'مل کر',
      'mushtarka', 'مشترکہ', 'sanjha', 'sanjhi', 'سانجھا', 'سانجھی',
      'gadd', 'ګډ', 'گڏ', 'گڏجي',
      'aur log', 'or log', 'aur bhi log', 'دوسرے لوگ', 'اور لوگ',
      'car pool', 'carpool', 'کار پول',
    ],
    true,
  ],
]);

export const SOLO_WORDS = buildTable<true>([
  [
    [
      'solo', 'سولو', 'akela', 'akela jana', 'اکیلا', 'اکیلے',
      'private', 'پرائیویٹ', 'zaati', 'ذاتی', 'apni', 'اپنی',
      'alone', 'sirf mein', 'صرف میں', 'یکلا', 'اڪيلو',
      'full car', 'poori gari', 'پوری گاڑی',
    ],
    true,
  ],
]);

// ── Negation ─────────────────────────────────────────────────────────────────

/**
 * Negation is why a bare keyword scan is not enough: "AC nahi chahiye" contains
 * "ac" and means the opposite. The parser looks for these within a small window
 * around a matched keyword and inverts it.
 */
export const NEGATION_WORDS = buildTable<true>([
  [
    [
      'nahi', 'nahin', 'nai', 'na', 'نہیں', 'نہ', 'نا',
      'mat', 'مت', 'no', 'not', 'never',
      'bina', 'baghair', 'bagair', 'بنا', 'بغیر', 'without',
      'chor', 'chhor', 'چھوڑ', 'ناهي', 'نه', 'نلري',
    ],
    true,
  ],
]);

// ── Seat counts ──────────────────────────────────────────────────────────────

/** Capped at MAX_SEATS (4) by the parser — larger spoken numbers clamp down. */
export const NUMBER_WORDS = buildTable<number>([
  [['1', 'ek', 'aik', 'ik', 'one', 'ایک', 'اک', 'hik', 'هڪ', 'yaw', 'يو'], 1],
  // Sindhi "be" (2) is deliberately absent in Roman form: it folds to the same
  // key as "bhi" ("also"), which appears in almost every pool request, and made
  // "aur log bhi" book two seats. The script form ٻه is unambiguous, so it stays.
  [['2', 'do', 'dou', 'two', 'دو', 'ٻہ', 'ٻه', 'dwa', 'دوه'], 2],
  [['3', 'teen', 'tin', 'three', 'تین', 'ٽي', 'tre', 'dre', 'درې'], 3],
  [['4', 'char', 'chaar', 'four', 'چار', 'چار', 'tsalor', 'څلور', 'chaar'], 4],
  [['5', 'panch', 'paanch', 'five', 'پانچ'], 5],
  [['6', 'chay', 'chhe', 'six', 'چھ'], 6],
]);

/**
 * Words that mark a preceding number as a passenger count rather than part of a
 * place name — "2 log" is a seat count, "F 7" is not.
 */
export const SEAT_UNIT_WORDS = buildTable<true>([
  [
    [
      'log', 'logo', 'logon', 'لوگ', 'لوگوں',
      'banda', 'banday', 'bande', 'بندے', 'بندہ',
      'afraad', 'افراد', 'aadmi', 'آدمی', 'sawaar', 'سوار',
      'seat', 'seats', 'سیٹ', 'سیٹیں', 'seaten',
      'passenger', 'passengers', 'مسافر', 'musafir',
      'person', 'people', 'خلک', 'ماڻهو',
    ],
    true,
  ],
]);
// Deliberately NOT unit words: "jane"/"jane wale"/"hain". They fold to the same
// Roman key as "jana" ("to go"), so including them made every "... jana hai"
// sentence read the nearest digit as a passenger count.

// ── Sentence-structure markers ───────────────────────────────────────────────

/**
 * Words that mean "the thing before/around this is where I am going". Used to
 * locate the destination span inside the sentence.
 */
export const DEST_MARKERS = buildTable<true>([
  [
    [
      'jana hai', 'jana', 'jaana', 'jaana hai', 'jana chahta hun', 'jana chahti hun',
      'جانا ہے', 'جانا', 'جاؤں گا', 'جاؤں گی', 'جانا چاہتا ہوں', 'جانا چاہتی ہوں',
      'chalna hai', 'chalo', 'chalna', 'le chalo', 'le chal', 'chal',
      'چلنا ہے', 'چلو', 'لے چلو', 'لے چل', 'چلنا',
      'tak', 'تک', 'to', 'towards', 'pohanchna', 'پہنچنا', 'پہنچا do', 'drop',
      'jaunga', 'jaungi', 'wenda', 'وينڊو', 'ځم', 'tlal',
      'kay liye', 'ke liye',
    ],
    true,
  ],
]);

/** Words that mark the span before them as the pickup point. */
export const ORIGIN_MARKERS = buildTable<true>([
  [
    ['se', 'sy', 'سے', 'from', 'kahan se', 'کہاں سے', 'کان', 'ná', 'nه'],
    true,
  ],
]);

/**
 * Noise words to strip out of a candidate place name. Without this, "mujhe
 * islamabad f7 markaz jana hai" yields the place "mujhe islamabad f7 markaz".
 */
export const FILLER_WORDS = buildTable<true>([
  [
    [
      'mujhe', 'muje', 'mjhe', 'mujhy', 'مجھے', 'mein', 'main', 'میں',
      'mere liye', 'mery liye', 'meray liye', 'میرے لیے', 'mera', 'meri', 'میرا', 'میری',
      'hum', 'humein', 'ہم', 'ہمیں',
      'book', 'booking', 'بک', 'بکنگ', 'karo', 'kro', 'kar do', 'karde', 'کرو', 'کر دو',
      'chahiye', 'chaiye', 'chahie', 'چاہیے', 'chahta', 'chahti', 'چاہتا', 'چاہتی',
      'ride', 'رائیڈ', 'trip', 'ٹرپ', 'safar', 'سفر',
      'please', 'plz', 'پلیز', 'bhai', 'بھائی', 'baji', 'باجی', 'sir', 'سر',
      'ek', 'aik', 'ایک', 'koi', 'کوئی',
      'ab', 'abhi', 'اب', 'ابھی', 'jaldi', 'جلدی', 'now',
      'ho', 'hai', 'hain', 'ہے', 'ہو', 'ہیں', 'ka', 'ki', 'ke', 'کا', 'کی', 'کے',
      'aur', 'or', 'اور', 'phir', 'پھر',
      'wala', 'wali', 'والا', 'والی',
      'i', 'want', 'to', 'go', 'need', 'get', 'me', 'a', 'please',
    ],
    true,
  ],
]);

// ── Confirmation ─────────────────────────────────────────────────────────────

export const AFFIRM_WORDS = buildTable<true>([
  [
    [
      'haan', 'han', 'ha', 'ji', 'ji haan', 'jee', 'ہاں', 'جی', 'جی ہاں',
      'yes', 'yeah', 'yep', 'ok', 'okay', 'theek', 'thik', 'theek hai',
      'ٹھیک', 'ٹھیک ہے', 'اوکے', 'bilkul', 'بالکل',
      'confirm', 'کنفرم', 'karo', 'کرو', 'kar do', 'کر دو',
      'sahi', 'صحیح', 'درست', 'ho', 'ھو', 'آهي',
    ],
    true,
  ],
]);

export const DENY_WORDS = buildTable<true>([
  [
    [
      'nahi', 'nahin', 'nai', 'نہیں', 'no', 'nope',
      'cancel', 'کینسل', 'band', 'بند', 'chor do', 'چھوڑ دو',
      'rehne do', 'رہنے دو', 'ruko', 'رکو', 'stop', 'wait',
      'galat', 'غلط', 'wrong', 'change', 'تبدیل', 'badlo', 'بدلو',
    ],
    true,
  ],
]);

// ── Per-user vocabulary ──────────────────────────────────────────────────────

/**
 * Tables built at runtime from data belonging to one user, rather than shipped
 * with the app.
 *
 * The important one is the user's own place names. Someone whose saved places
 * include "Office" and "Ammi ka ghar" is going to say exactly those words, and
 * no national gazetteer will ever contain them. Matching against their own
 * records is both the most accurate path and the cheapest — those records
 * already carry coordinates, so a hit here skips geocoding altogether.
 */
export const AmbientTables = {
  /**
   * Build (and cache) a lookup over a user's saved place and recent destination
   * names. The value is the original string, so the caller can hand it back to
   * the booking screen exactly as stored.
   */
  forKnownPlaces(names: readonly string[]): PhraseTable<string> {
    const cacheKey = names.join(' ');
    const cached = knownPlaceCache.get(cacheKey);
    if (cached) return cached;

    const table = buildTable<string>(names.map((name) => [[name], name]));

    // Only the most recent list is worth holding; the set changes as the user
    // books, and a stale entry is pure memory with no chance of a hit.
    knownPlaceCache.clear();
    knownPlaceCache.set(cacheKey, table);

    return table;
  },
};

const knownPlaceCache = new Map<string, PhraseTable<string>>();
