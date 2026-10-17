/**
 * WHEN is the road broken? Read off the sentence that says so.
 * ----------------------------------------------------------------------------
 * THE PROBLEM THIS EXISTS FOR
 * ---------------------------
 * A story published at nine in the morning says a protest will block Murree
 * Road "from 2pm to 6pm". Until this file existed, that alert went up the
 * moment we read it and stayed up for twelve hours — the `protest` lifetime —
 * so a rider booking at 9:30am was shown a red banner about a road that was
 * completely clear, and a rider booking at 7pm was shown one about a protest
 * that had gone home. Both of them learn the same lesson about us: the strip is
 * noise, ignore it.
 *
 * So an alert now carries a WINDOW — when the disruption itself runs — which is
 * a different thing from how long we keep the document. The read path shows an
 * alert only inside its window, and the window comes from the story's own words
 * whenever the story gives them.
 *
 * OVER-WIDE IS THE SAFE ERROR
 * ---------------------------
 * The whole file is built around that one asymmetry. A window that is too wide
 * shows a rider something slightly stale, which is what we already did. A
 * window that is too narrow HIDES A ROAD THAT IS ACTUALLY CLOSED, which is the
 * only failure here that can put somebody in a jam they would have avoided.
 * Every judgement call below therefore resolves outwards:
 *
 *  · A bare clock with no preposition in front of it ("the 9pm deadline", "told
 *    reporters at 4pm") is IGNORED rather than guessed at, because reading it
 *    as a start time would hide the alert all morning.
 *  · A day with no usable clock ("closed on Sunday") becomes 06:00–23:00, the
 *    day as a commuter meets it, not a guessed-at hour inside it.
 *  · "today" tells us nothing we did not already assume, so it is not a window
 *    at all — the alert keeps its per-kind lifetime.
 *
 * WHAT IT READS, AND WHAT IT REFUSES TO READ
 * ------------------------------------------
 * The caller passes the sentence the classifier already decided is about the
 * road event, plus the headline — NOT the whole article. A time lifted from
 * some other paragraph is how you end up with a window built from the hour a
 * press conference started. `classify.ts` does the narrowing; this file trusts
 * what it is handed.
 *
 * Nothing here decides anything either. It reports what the words say, with
 * nulls where they say nothing, and `classify.ts` composes that with the kind's
 * own lifetime and decides whether an event too far ahead is an alert at all.
 *
 * PAKISTAN TIME IS A FIXED OFFSET
 * -------------------------------
 * UTC+5, no daylight saving (tried for two summers in 2008–09 and abandoned).
 * So the arithmetic is plain addition and this file needs no timezone database
 * and no `Intl` — which matters, because it has to stay pure enough to test
 * without a clock, a network or a Firebase.
 * ----------------------------------------------------------------------------
 */

/** Pakistan Standard Time. Fixed; see the note above. */
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The hours a day-wide window covers, when a story gives a day but no time.
 *
 * Not midnight to midnight: a closure "on Sunday" does not need announcing at
 * 3am, and starting at 06:00 keeps the window honest about when a commuter
 * actually meets the road. Ending at 23:00 rather than 23:59 is the same
 * thought from the other end.
 */
const DAY_WINDOW_START_H = 6;
const DAY_WINDOW_END_H = 23;

/** "tonight", with no hour given. */
const NIGHT_START_H = 18;
const NIGHT_END_H = 23;

export interface PktParts {
  y: number;
  /** 1–12, not 0–11. This is read by humans in log lines. */
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** 0 = Sunday. */
  dow: number;
}

/** Epoch ms → the wall clock a person in Pakistan would read off it. */
export function pktParts(ms: number): PktParts {
  const d = new Date(ms + PKT_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** A Pakistani wall clock → epoch ms. Month is 1–12. */
export function pktMs(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) - PKT_OFFSET_MS;
}

/** Midnight PKT at the start of whatever day `ms` falls in. */
function pktMidnight(ms: number): number {
  const p = pktParts(ms);
  return pktMs(p.y, p.mo, p.d);
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Written-out numbers, which is how a newspaper gives a short duration. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** What the text said. Nulls where it said nothing. */
export interface StatedWindow {
  /** When the disruption starts, or null if the text only gave an end. */
  startsAt: number | null;
  /** When it ends, or null if the text only gave a start. */
  endsAt: number | null;
  /** The words this was read from. Stored, so a wrong window is explicable. */
  phrase: string;
}

interface Clock {
  h: number;
  mi: number;
  /** Index in the searched string, so the words before it can be read. */
  at: number;
  /** Index just past the match, for reading the connective after it. */
  end: number;
  text: string;
}

/**
 * Every clock time in the string, in order.
 *
 * Three shapes, because Pakistani papers use all three: "9am" / "9:30 am" /
 * "9.30am" with a meridiem, "21:00" on the 24-hour clock, and "0900 hours" in
 * copy lifted straight from a police or army statement.
 *
 * The 24-hour branch takes a colon only. It used to accept a full stop too,
 * which meant "Rs 1.50 per litre" parsed as ten to two in the morning.
 */
const CLOCK_RE =
  /\b(?:(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|(\d{1,2}):(\d{2})(?:\s*(?:hours|hrs))?|(\d{4})\s*(?:hours|hrs))/gi;

export function findClocks(lower: string): Clock[] {
  const out: Clock[] = [];
  CLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = CLOCK_RE.exec(lower)) !== null) {
    let h: number;
    let mi: number;

    if (m[3]) {
      // 12-hour. "12am" is midnight and "12pm" is noon, which the obvious
      // arithmetic gets backwards.
      const raw = Number(m[1]);
      if (raw < 1 || raw > 12) continue;
      mi = m[2] ? Number(m[2]) : 0;
      const pm = m[3]!.startsWith('p');
      h = raw === 12 ? (pm ? 12 : 0) : pm ? raw + 12 : raw;
    } else if (m[4] !== undefined) {
      h = Number(m[4]);
      mi = Number(m[5]);
    } else {
      const hhmm = m[6]!;
      h = Number(hhmm.slice(0, 2));
      mi = Number(hhmm.slice(2));
    }

    if (!Number.isFinite(h) || !Number.isFinite(mi) || h > 23 || mi > 59) continue;
    out.push({ h, mi, at: m.index, end: m.index + m[0].length, text: m[0].trim() });
  }

  return out;
}

/** Words that put the clock after them at the START of something. */
const START_WORDS = [
  'from',
  'at',
  'after',
  'starting',
  'start',
  'starts',
  'commencing',
  'beginning',
  'between',
  'onward',
  'onwards',
  'effective',
  'w.e.f',
];

/** Words that put the clock after them at the END of something. */
const END_WORDS = [
  'till',
  'until',
  'untill',
  'upto',
  'up to',
  'by',
  'before',
  'through',
  'ends',
  'end',
  'ending',
  'reopen',
  'reopens',
  'restored',
];

/** The connectives that join two clocks into a range. */
const RANGE_JOINERS = ['to', 'till', 'until', 'untill', 'upto', 'up to', 'and', '-', '–', '—'];

/**
 * Is the text immediately before `at` one of `words`?
 *
 * Looks back a short way only — far enough for "from" or "up to", not far
 * enough to pick up a preposition belonging to some other clause.
 */
function precededBy(lower: string, at: number, words: string[]): string | null {
  const before = lower.slice(Math.max(0, at - 18), at);
  for (const w of words) {
    // Allow the filler a newspaper puts between the preposition and the time:
    // "from around 9am", "till about 6pm", "from 9am".
    const re = new RegExp(`(?:^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:around\\s+|about\\s+|approximately\\s+)?$`);
    if (re.test(before)) return w;
  }
  return null;
}

/** Are these two clocks joined into a single range? */
function joinedAsRange(lower: string, first: Clock, second: Clock): boolean {
  const gap = lower.slice(first.end, second.at).trim();
  return RANGE_JOINERS.includes(gap);
}

interface DayAnchor {
  /** Midnight PKT of the day the text pointed at. */
  base: number;
  phrase: string;
  /** False when the text gave no day and we fell back to the publication day. */
  explicit: boolean;
  /** "tonight" — a day AND a rough part of it. */
  night?: boolean;
}

/**
 * Which day the text is talking about. Falls back to the publication day.
 *
 * Checked in order of how specific each form is, so "on Sunday 19 October"
 * resolves on the date rather than on the weekday.
 */
export function dayAnchor(lower: string, publishedAt: number): DayAnchor {
  const today = pktMidnight(publishedAt);

  // An explicit calendar date. Both orders, full names and three-letter forms.
  const month = MONTHS.findIndex((name) => {
    const short = name.slice(0, 3);
    return new RegExp(`\\b(?:${name}|${short}\\.?)\\b`).test(lower);
  });
  if (month >= 0) {
    const name = MONTHS[month]!;
    const short = name.slice(0, 3);
    // THE DAY MUST NOT BE HALF OF A YEAR.
    //
    // Without the digit guards below, "in February 2027" matched
    // `february\s+(\d{1,2})` and read the "20" out of "2027" as the 20th.
    // Found by running this over 300 live headlines: "Canada Hockey team to
    // tour Pakistan in February 2027" came back as a window on 20 February.
    // Harmless on that story, which is not a road event — but the same misread
    // on one phrased "closed since March 2026" puts the window months away and
    // the alert is then refused as `not_yet`. A live closure silently dropped
    // is the one failure direction that actually matters here.
    const m = new RegExp(
      `(?:(?<!\\d)(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\s+(?:${name}|${short}\\.?)` +
        `|(?:${name}|${short}\\.?)\\s+(?<!\\d)(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?)`,
    ).exec(lower);
    const day = Number(m?.[1] ?? m?.[2]);
    if (m && Number.isFinite(day) && day >= 1 && day <= 31) {
      const p = pktParts(publishedAt);
      let base = pktMs(p.y, month + 1, day);
      // A date more than half a year behind the story is next year's: a story
      // filed on 28 December about "January 3" means days away, not months ago.
      if (base < today - 183 * DAY_MS) base = pktMs(p.y + 1, month + 1, day);
      return { base, phrase: m[0].trim(), explicit: true };
    }
  }

  if (/\btomorrow\b/.test(lower)) {
    return { base: today + DAY_MS, phrase: 'tomorrow', explicit: true };
  }

  // A weekday. "last Friday" and "on Friday" point in opposite directions, and
  // getting that wrong is the difference between an alert nobody needed and an
  // alert about something three days dead.
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const name = WEEKDAYS[i]!;
    const m = new RegExp(`\\b(last|next|this|on|from)?\\s*${name}\\b`).exec(lower);
    if (!m) continue;

    const dow = pktParts(publishedAt).dow;
    const forward = (i - dow + 7) % 7;
    const backward = (dow - i + 7) % 7;
    const base =
      m[1] === 'last'
        ? today - (backward === 0 ? 7 : backward) * DAY_MS
        : today + forward * DAY_MS;
    return { base, phrase: m[0].trim(), explicit: true };
  }

  if (/\btonight\b/.test(lower)) {
    return { base: today, phrase: 'tonight', explicit: true, night: true };
  }

  // "today" deliberately does NOT count as explicit. It tells us nothing we
  // had not already assumed, and treating it as a day-wide window would make a
  // three-hour jam sit on the screen until eleven at night.
  return { base: today, phrase: '', explicit: false };
}

/** "for three hours" / "for 2 days" / "for the next 48 hours". */
export function durationMs(lower: string): { ms: number; phrase: string } | null {
  const m = /\bfor\s+(?:the\s+next\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s*(hours?|hrs?|days?|weeks?)\b/.exec(
    lower,
  );
  if (!m) return null;

  const n = WORD_NUMBERS[m[1]!] ?? Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = m[2]!;
  const per = unit.startsWith('w') ? 7 * DAY_MS : unit.startsWith('d') ? DAY_MS : HOUR_MS;
  return { ms: n * per, phrase: m[0].trim() };
}

/** The longest window we will read out of a sentence, however it is worded. */
const MAX_WINDOW_MS = 7 * DAY_MS;

/**
 * Read a window out of the text, or null when it states nothing usable.
 *
 * Null is the common answer and the safe one — the caller then falls back to
 * the per-kind lifetime, which is exactly what every alert had before this file
 * existed.
 */
export function readWindow(text: string, publishedAt: number): StatedWindow | null {
  const lower = text.toLowerCase();
  const clocks = findClocks(lower);
  const day = dayAnchor(lower, publishedAt);
  const duration = durationMs(lower);
  const bits: string[] = [];

  let startsAt: number | null = null;
  let endsAt: number | null = null;

  const onDay = (c: Clock): number => day.base + c.h * HOUR_MS + c.mi * 60_000;

  // A RANGE: "from 9am to 5pm", "between 2pm and 6pm", "9pm-11pm".
  const range = clocks.length >= 2 && joinedAsRange(lower, clocks[0]!, clocks[1]!);
  if (range) {
    startsAt = onDay(clocks[0]!);
    endsAt = onDay(clocks[1]!);
    // "11pm to 2am" runs over midnight. Any end at or before its start does.
    if (endsAt <= startsAt) endsAt += DAY_MS;
    bits.push(lower.slice(clocks[0]!.at, clocks[1]!.end).trim());
  } else if (clocks.length >= 1) {
    // ONE CLOCK, and only if a word in front of it says which end it is.
    // A bare time is ignored on purpose: see the header.
    const c = clocks[0]!;
    const asStart = precededBy(lower, c.at, START_WORDS);
    const asEnd = precededBy(lower, c.at, END_WORDS);
    if (asEnd) {
      endsAt = onDay(c);
      bits.push(`${asEnd} ${c.text}`);
    } else if (asStart) {
      startsAt = onDay(c);
      bits.push(`${asStart} ${c.text}`);
    }
  }

  // A DURATION fills in whichever end is still missing.
  if (duration) {
    if (startsAt !== null && endsAt === null) {
      endsAt = startsAt + duration.ms;
    } else if (startsAt === null && endsAt === null) {
      // "closed for three days", no times at all. It starts when the story
      // says it starts, which is the day it names — or publication, when the
      // day is only the day the story was filed.
      startsAt = day.explicit ? day.base + DAY_WINDOW_START_H * HOUR_MS : publishedAt;
      endsAt = startsAt + duration.ms;
    }
    bits.push(duration.phrase);
  }

  // A DAY AND NOTHING ELSE. Only when the day was actually named — see the
  // note on "today" in `dayAnchor`.
  if (startsAt === null && endsAt === null) {
    if (!day.explicit) return null;
    const [fromH, toH] = day.night
      ? [NIGHT_START_H, NIGHT_END_H]
      : [DAY_WINDOW_START_H, DAY_WINDOW_END_H];
    startsAt = day.base + fromH * HOUR_MS;
    endsAt = day.base + toH * HOUR_MS;
    bits.push(day.phrase);
  } else if (day.explicit && day.phrase) {
    bits.unshift(day.phrase);
  }

  // A window that ends before it starts is a window we have misread. Drop it
  // rather than publish an alert that can never be inside its own hours.
  if (startsAt !== null && endsAt !== null && endsAt <= startsAt) return null;

  if (startsAt !== null && endsAt !== null && endsAt - startsAt > MAX_WINDOW_MS) {
    endsAt = startsAt + MAX_WINDOW_MS;
  }

  const phrase = [...new Set(bits)].join(' · ').slice(0, 90);
  return { startsAt, endsAt, phrase };
}
