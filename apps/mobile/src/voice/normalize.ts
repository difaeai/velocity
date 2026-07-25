/**
 * Text normalisation for voice input — the layer that makes one parser work
 * across every language spoken in Pakistan without asking the user to pick one.
 *
 * The problem this solves: the same spoken sentence reaches us in wildly
 * different written forms depending on which locale the device recogniser was
 * running in. "رکشہ" (Urdu locale), "rickshaw" (English locale) and "riksha"
 * (English locale, different guess) are the same word to the speaker and must
 * be the same token to us. On top of that, Urdu script arrives with inconsistent
 * character choices — Arabic ي vs Urdu ی, ك vs ک — because recognisers, fonts
 * and keyboards disagree about which codepoint to emit.
 *
 * Two functions do the work:
 *
 *   normalizeText()  folds the script-level variation — Arabic/Urdu digit forms,
 *                    letter variants, diacritics, zero-width joiners, and the
 *                    Urdu full stop "۔" — into one canonical form.
 *
 *   romanKey()       folds *transliteration* variation. Roman Urdu has no
 *                    spelling standard, so "chahiye", "chahiyay" and "chahye"
 *                    are all correct. This collapses the vowel-length and
 *                    digraph choices people vary on, so those three produce one
 *                    key. It is deliberately lossy: it is only ever used for
 *                    comparison, never displayed.
 *
 * Both are pure and cheap — they run on every keystroke of a partial transcript.
 */

// ── Script-level folding tables ──────────────────────────────────────────────

/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits → ASCII. */
const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Letter variants that mean the same thing to a reader but differ in codepoint.
 * Urdu, Arabic, Sindhi and Pashto keyboards each prefer different forms, and
 * speech recognisers emit whichever their language model was trained on.
 */
const LETTER_MAP: Record<string, string> = {
  // Ya variants → Urdu ye
  'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ۍ': 'ی', 'ې': 'ی',
  // Kaf variants → Urdu kaf
  'ك': 'ک', 'ڪ': 'ک',
  // Ha variants → Urdu ha (gol he)
  'ه': 'ہ', 'ۀ': 'ہ', 'ھ': 'ہ',
  // Alef variants → plain alef
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا',
  // Waw variants → plain waw
  'ؤ': 'و', 'ۇ': 'و', 'ۆ': 'و',
  // Sindhi/Pashto retroflex and aspirate forms → nearest Urdu base. Lossy on
  // purpose: it lets a Sindhi transcript match an Urdu gazetteer entry.
  'ٿ': 'ت', 'ٽ': 'ٹ', 'ڀ': 'ب', 'ٻ': 'ب', 'ڄ': 'ج', 'ڃ': 'ن',
  'ڊ': 'ڈ', 'ڏ': 'د', 'ڍ': 'ڈ', 'ڙ': 'ڑ', 'ڳ': 'گ', 'ڱ': 'ن',
  'ټ': 'ٹ', 'ډ': 'ڈ', 'ړ': 'ڑ', 'ږ': 'ز', 'ښ': 'ش', 'ڼ': 'ن', 'څ': 'چ', 'ځ': 'ز',
};

/** Combining marks: harakat, tanween, shadda, sukun, superscript alef. */
const DIACRITICS = /[ً-ْٓ-ٰٕۖ-ۭ]/g;

/** Zero-width joiner / non-joiner / marks — invisible, and they break matching. */
const ZERO_WIDTH = /[​-‏‪-‮﻿]/g;

/**
 * Fold a raw transcript to a comparable form: one case, one script variant per
 * letter, ASCII digits, no diacritics, single-spaced, no punctuation.
 */
export function normalizeText(input: string): string {
  if (!input) return '';

  let out = input.normalize('NFKC');

  out = out.replace(ZERO_WIDTH, '');
  out = out.replace(DIACRITICS, '');

  let mapped = '';
  for (const ch of out) {
    mapped += DIGIT_MAP[ch] ?? LETTER_MAP[ch] ?? ch;
  }
  out = mapped;

  out = out.toLowerCase();

  // Punctuation → space. Includes the Urdu full stop (۔), Arabic comma (،) and
  // question mark (؟), which recognisers add and which would otherwise glue
  // themselves to the word beside them.
  //
  // Hyphens and dashes matter more than they look: recognisers write Islamabad
  // sectors as "F-7", so without this "f-7" stays one token and never matches
  // the "f 7" / "f7" spellings in the gazetteer.
  out = out.replace(/[.,!?;:"'`()[\]{}\/\\|<>*_+=~^#$%&@۔،؟٬٫‐-―-]/g, ' ');

  // Collapse any run of 3+ identical letters ("acha!!!" → "acha", "haaaan" →
  // "haan"). Two is left alone because it is meaningful in Roman Urdu ("dd").
  out = out.replace(/(.)\1{2,}/g, '$1$1');

  return out.replace(/\s+/g, ' ').trim();
}

// ── Transliteration folding (Roman script only) ──────────────────────────────

/**
 * Ordered rewrite rules. Order matters: multi-character rules must run before
 * the single-character ones they contain, or "sh" would be eaten by "s".
 */
const ROMAN_RULES: Array<[RegExp, string]> = [
  // Digraphs people spell inconsistently
  [/ph/g, 'f'],
  [/gh/g, 'g'],
  [/kh/g, 'k'],
  [/dh/g, 'd'],
  [/th/g, 't'],
  [/bh/g, 'b'],
  [/ck/g, 'k'],
  [/sch/g, 'sh'],
  [/x/g, 'ks'],
  [/q/g, 'k'],
  [/w/g, 'v'],
  [/z/g, 'j'],
  // Long vowels → short. "chaar"/"char", "teen"/"tin", "pool"/"pol".
  [/aa+/g, 'a'],
  [/ee+/g, 'i'],
  [/ii+/g, 'i'],
  [/oo+/g, 'u'],
  [/uu+/g, 'u'],
  [/ay/g, 'e'],
  [/ai/g, 'e'],
  [/ei/g, 'e'],
  [/ou/g, 'o'],
  [/au/g, 'o'],
  // Trailing silent vowels: "chahiye" → "chahiy" → "chahi"
  [/[aeiou]+$/g, ''],
  // Any remaining doubled consonant → single
  [/(.)\1+/g, '$1'],
];

/**
 * Reduce a Roman-script word to a spelling-insensitive comparison key.
 * Non-Latin input is returned unchanged — Urdu script is already folded by
 * normalizeText() and must not be run through Latin transliteration rules.
 */
export function romanKey(word: string): string {
  if (!word) return '';
  if (!/[a-z]/i.test(word)) return word;

  let key = word.toLowerCase();
  for (const [pattern, replacement] of ROMAN_RULES) {
    key = key.replace(pattern, replacement);
  }
  return key;
}

/** Split normalised text into word tokens. */
export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/**
 * Both comparison keys for a token, so a caller can test either without
 * deciding up front which script it is looking at.
 */
export function keysFor(token: string): [normalized: string, roman: string] {
  return [token, romanKey(token)];
}
