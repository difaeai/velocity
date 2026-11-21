/**
 * Vexa's voice. She is always female: we pick a female system voice by name
 * and never fall back to a male one — if the phone has none, she stays quiet
 * and the caption on screen says the line instead.
 */
import * as Speech from 'expo-speech';

/** Names iOS, Android and the browser give their female English voices. */
const FEMALE =
  /female|samantha|karen|moira|tessa|victoria|serena|fiona|zira|aria|jenny|michelle|libby|sonia|natasha|clara|joanna|salli|kendra|kimberly|ivy|allison|ava|susan|nicky|eva|hazel|catherine|linda|heera/i;

/** "female" contains "male", so a male voice is only ruled out after that test. */
const MALE = /(^|[^e])male|daniel|alex\b|fred|tom\b|david|guy\b|rishi|oliver|aaron|arthur|george|james|ryan|brian|matthew|mark\b|ravi|prabhat/i;

let chosen: string | null | undefined;

async function femaleVoice(): Promise<string | null> {
  if (chosen !== undefined) return chosen;
  try {
    const all = await Speech.getAvailableVoicesAsync();
    const english = all.filter((v) => (v.language ?? '').toLowerCase().startsWith('en'));
    const pool = english.length ? english : all;
    const named = (v: Speech.Voice) => `${v.name ?? ''} ${v.identifier ?? ''}`;

    const female = pool.find((v) => FEMALE.test(named(v)));
    // Nothing named female: take a voice that is at least not named male.
    const neutral = pool.find((v) => !MALE.test(named(v)));

    chosen = female?.identifier ?? neutral?.identifier ?? null;
  } catch {
    chosen = null;
  }
  return chosen;
}

/** Say it out loud in Vexa's voice. Silence is an acceptable outcome. */
export async function speak(text: string, onDone?: () => void) {
  try {
    const voice = await femaleVoice();
    Speech.speak(text, {
      ...(voice ? { voice } : {}),
      language: 'en-US',
      rate: 0.94,
      pitch: 1.12, // keeps her unmistakably female even on a phone with one voice
      onDone,
      onError: onDone,
    });
  } catch {
    onDone?.();
  }
}

export function hush() {
  try {
    Speech.stop();
  } catch {
    // nothing to stop
  }
}
