/**
 * Vexa's voice. She is always female.
 *
 * The trap this solves: the voice list is empty on the first call (the browser
 * and Android both fill it a moment later), and every platform's *default*
 * voice may well be male — on this machine it is "Microsoft George". So we
 * wait for the list, score it, and only then speak. She never goes silent: if
 * a phone really has nothing but male voices, she still talks, pitched up.
 */
import * as Speech from 'expo-speech';

/** Names iOS, Android and the browsers give their female English voices. */
const FEMALE =
  /female|woman|samantha|karen|moira|tessa|victoria|serena|fiona|zira|aria|jenny|michelle|libby|sonia|natasha|clara|joanna|salli|kendra|kimberly|ivy|allison|ava|susan|nicky|eva|hazel|catherine|linda|heera|amy|emma|olivia|sophia|lucy|nora|zoe|anna|maria|wendy|julie|kate/i;

/** "female" contains "male", so male is only ever tested after that. */
const MALE =
  /(^|[^e])male|george|daniel|alex|fred|\btom\b|david|\bguy\b|rishi|oliver|aaron|arthur|james|ryan|brian|matthew|\bmark\b|ravi|prabhat|rowan|\blee\b|\bwill\b|paul|john|peter|eric|liam|noah/i;

type Pick = { id?: string; pitch: number };

let picked: Pick | null = null; // only a *successful* pick is remembered

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The web implementation can hang forever when no voice list ever arrives. */
function capped<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, sleep(ms).then(() => null)]) as Promise<T | null>;
}

async function voiceList(): Promise<Speech.Voice[]> {
  for (let i = 0; i < 6; i++) {
    const list = await capped(Speech.getAvailableVoicesAsync(), 500).catch(() => null);
    if (list && list.length) return list;
    await sleep(200);
  }
  return [];
}

function score(v: Speech.Voice) {
  const name = `${v.name ?? ''} ${v.identifier ?? ''}`;
  const lang = (v.language ?? '').toLowerCase();
  let s = 0;
  if (FEMALE.test(name)) s += 100;
  else if (MALE.test(name)) s -= 200;
  if (lang.startsWith('en')) s += 15;
  if (lang.startsWith('en-us') || lang.startsWith('en-gb')) s += 8;
  if (/natural|neural|enhanced|premium/i.test(name)) s += 5;
  return s;
}

async function choose(): Promise<Pick> {
  const list = await voiceList();
  if (!list.length) return { pitch: 1.3 }; // nothing to choose from: speak anyway, pitched up

  const best = list.reduce((a, b) => (score(b) > score(a) ? b : a));
  const female = score(best) >= 100;
  const pick: Pick = { id: best.identifier, pitch: female ? 1.06 : 1.3 };
  if (female) picked = pick; // a failure is never cached, so the next try looks again
  return pick;
}

/** Say it out loud in Vexa's voice. */
export async function speak(text: string, onDone?: () => void) {
  try {
    const pick = picked ?? (await choose());
    Speech.speak(text, {
      ...(pick.id ? { voice: pick.id } : {}),
      language: 'en-US',
      rate: 0.95,
      pitch: pick.pitch,
      volume: 1,
      onDone,
      onError: onDone,
      onStopped: onDone,
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
