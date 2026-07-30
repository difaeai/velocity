/**
 * Language engine — English (default) and Urdu, applied LIVE (no reload).
 *
 * Deliberately mirrors src/theme.ts: a module-level current value, a version
 * counter, and a listener set. The root layout subscribes and re-keys the route
 * subtree, so switching language re-renders every mounted screen instantly.
 *
 * Translation itself is delivered by the <Text>/<TextInput> wrappers in
 * src/ui/Text.tsx rather than by threading a t() call through every screen.
 * Passenger and driver screens import Text from that wrapper; ADMIN SCREENS DO
 * NOT — which is exactly how the admin console stays English-only, with no
 * runtime role check to get wrong.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { UR } from './ur';

export type Language = 'en' | 'ur';

const STORAGE_KEY = 'velocity_language';

let current: Language = 'en';

export function getLanguage(): Language {
  return current;
}

export function isUrdu(): boolean {
  return current === 'ur';
}

/**
 * The language a tap on the language button switches TO, and its name written
 * in that language ("اردو" while the app is English, "English" while it is
 * Urdu). Buttons label themselves with this instead of the current language:
 * the control is a switch, not a status line, and the destination is the only
 * thing the user needs to recognise — including the English speaker who landed
 * in Urdu by accident and has to find the way back out.
 *
 * These labels must be rendered with react-native's <Text>, NOT the translating
 * wrapper in src/ui/Text.tsx — "English" is itself a dictionary key ("انگریزی"),
 * so the wrapper would translate the one word that has to stay in Latin script.
 */
export function otherLanguage(): Language {
  return current === 'ur' ? 'en' : 'ur';
}

export function otherLanguageLabel(): string {
  return current === 'ur' ? 'English' : 'اردو';
}

/** Short form for the tight header pill on the passenger home. */
export function otherLanguageTag(): string {
  return current === 'ur' ? 'EN' : 'اردو';
}

/** Flip English ⇄ Urdu live. Same contract as setLanguage. */
export function toggleLanguage(): Promise<void> {
  return setLanguage(otherLanguage());
}

// ── Live-language version store ───────────────────────────────────────────────
let languageVersion = 0;
const listeners = new Set<() => void>();

export function getLanguageVersion(): number {
  return languageVersion;
}

export function subscribeLanguage(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Translate a single UI string. Unknown strings fall through to English, so a
 * missing entry degrades to the original label instead of blanking the UI.
 *
 * Lookup is tolerant of the whitespace that JSX introduces around literals and
 * of trailing punctuation, so "Where to?" and "  Where to? " both resolve.
 */
export function t(input: string): string {
  if (current !== 'ur') return input;

  const trimmed = input.trim();
  if (!trimmed) return input;

  const direct = UR[trimmed];
  if (direct !== undefined) return restoreSpacing(input, trimmed, direct);

  // Try again without a trailing separator, then re-attach it. Covers the many
  // labels that differ from a dictionary key only by a ":" or "…".
  const m = /^(.*?)([\s:·—–\-…]*)$/s.exec(trimmed);
  if (m && m[1] && m[2]) {
    const hit = UR[m[1]];
    if (hit !== undefined) return restoreSpacing(input, trimmed, hit + m[2]);
  }

  return input;
}

/** Re-attach the leading/trailing whitespace the raw JSX literal carried. */
function restoreSpacing(original: string, trimmed: string, translated: string): string {
  const start = original.indexOf(trimmed);
  return original.slice(0, start) + translated + original.slice(start + trimmed.length);
}

/** Load + apply the saved language. Resolves before the first screen renders. */
export async function loadLanguage(): Promise<Language> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    current = saved === 'ur' ? 'ur' : 'en';
  } catch {
    current = 'en';
  }
  return current;
}

/**
 * Apply a language LIVE, then persist.
 *
 * The swap happens synchronously and the AsyncStorage write trails behind it —
 * tapping a language must repaint the UI immediately, not wait on disk I/O. A
 * failed write costs the user the preference on next launch, never the switch
 * they just asked for.
 */
export function setLanguage(lang: Language): Promise<void> {
  current = lang;
  languageVersion += 1;
  listeners.forEach((l) => l());
  return AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
}

export const LANGUAGE_STORAGE_KEY = STORAGE_KEY;
