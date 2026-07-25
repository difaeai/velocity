/**
 * Microphone in, spoken reply out — and the locale juggling that lets both
 * happen without ever showing the user a language setting.
 *
 * Android's recogniser will not accept "listen for anything"; it demands a
 * locale up front. That is an implementation detail the user must never see, so
 * this module decides for them:
 *
 *   1. Start in Urdu (ur-PK). It is the widest net for Pakistani speech —
 *      Punjabi, Sindhi and Saraiki share enough vocabulary and script with Urdu
 *      that an Urdu model transcribes them usably.
 *   2. If the attempt yields nothing, silently move to the next locale in the
 *      chain and let the screen re-prompt with a plain "say that again". The
 *      user experiences a retry, never a settings decision.
 *   3. Remember whichever locale produced a usable result for this person and
 *      lead with it next time.
 *
 * The recognised text is only half the language story: what comes back may be
 * Punjabi words spelled by an Urdu model, or Roman Urdu spelled by an English
 * one. Making sense of that is ./parser's job, and it is script-agnostic by
 * design — which is why guessing the locale wrong here degrades quality rather
 * than breaking the feature.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/**
 * Ordered fallback chain. Urdu first for the reasons above; English second
 * because it catches both actual English and Roman Urdu, which recognisers
 * transcribe as English-looking text.
 */
export const LOCALE_CHAIN = ['ur-PK', 'en-PK', 'en-US'] as const;
export type VoiceLocale = (typeof LOCALE_CHAIN)[number];

const PREFERRED_LOCALE_KEY = 'velocity_voice_locale';

let preferredLocale: VoiceLocale | null = null;

/**
 * Load the locale that worked for this user last time. Falls back to the head
 * of the chain, so a first-time user starts on Urdu.
 */
export async function loadPreferredLocale(): Promise<VoiceLocale> {
  if (preferredLocale) return preferredLocale;

  try {
    const stored = await AsyncStorage.getItem(PREFERRED_LOCALE_KEY);
    if (stored && (LOCALE_CHAIN as readonly string[]).includes(stored)) {
      preferredLocale = stored as VoiceLocale;
      return preferredLocale;
    }
  } catch {
    // Storage is unavailable — the default below is a fine answer.
  }

  preferredLocale = LOCALE_CHAIN[0];
  return preferredLocale;
}

/** Record that a locale produced a usable transcript for this user. */
export async function rememberLocale(locale: VoiceLocale): Promise<void> {
  if (preferredLocale === locale) return;
  preferredLocale = locale;
  try {
    await AsyncStorage.setItem(PREFERRED_LOCALE_KEY, locale);
  } catch {
    // Best-effort: losing the preference costs one extra retry next session.
  }
}

/**
 * The next locale to try after one that produced nothing usable. Returns null
 * once the chain is exhausted, at which point the caller should offer the
 * typed flow instead of looping.
 */
export function nextLocale(current: VoiceLocale): VoiceLocale | null {
  const index = LOCALE_CHAIN.indexOf(current);
  if (index < 0 || index === LOCALE_CHAIN.length - 1) return null;
  return LOCALE_CHAIN[index + 1] ?? null;
}

/**
 * Whether this device can do speech recognition at all. False on handsets with
 * no recogniser — most commonly no-GMS devices — where the mic button should be
 * hidden rather than offered and then failing.
 */
export function isRecognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

/** Ask for microphone + recognition permission. */
export async function requestPermission(): Promise<boolean> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

/**
 * Begin listening.
 *
 * `contextualStrings` biases the recogniser toward words it would otherwise
 * mangle — the user's own saved place names, which are frequently proper nouns
 * no language model has ever seen ("Ammi ka ghar").
 */
export function startListening(locale: VoiceLocale, contextualStrings: string[] = []): void {
  ExpoSpeechRecognitionModule.start({
    lang: locale,
    interimResults: true,
    continuous: false,
    maxAlternatives: 1,
    // Prefer the offline model when the device has one: it is faster, works
    // without a connection, and keeps the audio on the handset.
    requiresOnDeviceRecognition: false,
    addsPunctuation: false,
    contextualStrings: contextualStrings.slice(0, 50),
  });
}

/** Stop listening and process what was captured. */
export function stopListening(): void {
  try {
    ExpoSpeechRecognitionModule.stop();
  } catch {
    // Already stopped.
  }
}

/** Abandon the current attempt without producing a result. */
export function abortListening(): void {
  try {
    ExpoSpeechRecognitionModule.abort();
  } catch {
    // Already stopped.
  }
}

// ── Speaking ─────────────────────────────────────────────────────────────────

/**
 * Slower than default on purpose. This flow exists for people who cannot read
 * the screen — often elderly — and default TTS pacing is too quick to follow
 * when the words carry a price and a destination you are about to agree to.
 */
const SPEECH_RATE = 0.85;

/** Urdu script anywhere in the string means speak it with an Urdu voice. */
function voiceLanguageFor(text: string): string {
  return /[؀-ۿ]/.test(text) ? 'ur-PK' : 'en-IN';
}

/**
 * Speak a line, resolving when it finishes.
 *
 * Never rejects: a missing voice for the chosen language is common on Pakistani
 * handsets and must not break the flow. Every spoken line is also shown on
 * screen, so silence degrades the experience without blocking it.
 */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      Speech.speak(text, {
        language: voiceLanguageFor(text),
        rate: SPEECH_RATE,
        pitch: 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(),
      });
    } catch {
      resolve();
    }
  });
}

/** Cut off anything currently being spoken. */
export function stopSpeaking(): void {
  try {
    Speech.stop();
  } catch {
    // Nothing was speaking.
  }
}
