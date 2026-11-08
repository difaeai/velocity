/**
 * Vexa's subtitles: each narration line (siteVoice.json) cut into short cues,
 * and the cue for a point in its audio.
 */

import LINES from './siteVoice.json';

/** A line cut into cues: one per sentence, and a long sentence again at its commas, `max` letters at most where it can. */
export function cues(text: string, max = 90): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?:;])\s+/)) {
    let cur = '';
    for (const part of sentence.split(/(?<=,)\s+/)) {
      if (cur && cur.length + 1 + part.length > max) {
        out.push(cur);
        cur = part;
      } else cur = cur ? `${cur} ${part}` : part;
    }
    if (cur) out.push(cur);
  }
  return out;
}

const BY_FILE = new Map(LINES.map((l) => [`${l.key}.mp3`, cues(l.text)]));

/**
 * How far through line `key` (0 to 1) she starts saying each bullet, -1 if she never does.
 * A plan's bullets are her own words, less the "I " a list repeats.
 */
export function bulletMarks(key: string, bullets: string[]): number[] {
  const text = LINES.find((l) => l.key === key)?.text.toLowerCase() ?? '';
  return bullets.map((b) => {
    const at = text.indexOf(b.replace(/^I /, '').toLowerCase());
    return at < 0 ? -1 : at / text.length;
  });
}

/**
 * The cue `at` seconds into the line playing from `src`, `length` seconds long.
 * shortcut: a cue's time is its share of the line's letters, not the voice's real timings — close for an
 * even TTS voice; render Kokoro's per-chunk timings into siteVoice.json if cues ever drift.
 */
export function captionAt(src: string, at: number, length: number): string | null {
  const list = BY_FILE.get(src.slice(src.lastIndexOf('/') + 1));
  if (!list) return null;
  if (!length) return list[0];
  let pos = (at / length) * list.reduce((n, c) => n + c.length, 0);
  for (const c of list) {
    if (pos < c.length) return c;
    pos -= c.length;
  }
  return list[list.length - 1];
}
