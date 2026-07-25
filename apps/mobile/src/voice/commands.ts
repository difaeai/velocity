/**
 * Driver voice commands — a closed grammar, deliberately not a conversation.
 *
 * The passenger side parses open-ended sentences because a passenger can want
 * to go anywhere. A driver wants one of about eight things, and is usually
 * moving while asking for it. That difference drives every decision here:
 *
 *   Fixed vocabulary. There are no slots to fill and nothing to disambiguate,
 *   so there is no follow-up question and no chance of the app talking at a
 *   driver mid-traffic. A phrase either is a command or it isn't.
 *
 *   Nothing that spends or settles money. Voice can put a driver online, take
 *   a ride, or open navigation. It cannot touch the wallet, commission, or
 *   cancellations — those keep their deliberate, on-screen, two-tap paths.
 *
 *   Highest-stakes match wins ties. "Accept" and "cancel" must never be
 *   confused with each other by a stray word, so rejection is checked before
 *   acceptance in resolveCommand(): a phrase containing both is treated as the
 *   safe one.
 *
 * Same six-language coverage as the passenger lexicon, and the same folding via
 * ./normalize, so "ٹھیک ہے قبول" and "theek hai qabool" are one command.
 */
import { NEGATION_WORDS } from './lexicon';
import { normalizeText, romanKey, tokenize } from './normalize';

/** How far from a command a negation word still cancels it. */
const NEGATION_WINDOW = 3;

/** Everything a driver can do by voice. */
export type DriverCommand =
  | 'goOnline'
  | 'goOffline'
  | 'acceptRide'
  | 'declineRide'
  | 'nextRequest'
  | 'readRequest'
  | 'navigate'
  | 'callPassenger'
  | 'endRoute';

interface CommandEntry {
  readonly command: DriverCommand;
  readonly phrases: readonly string[];
}

/**
 * Order matters only for building the table; resolveCommand() applies its own
 * safety precedence. Longer phrases are matched before shorter ones at any
 * position, so "band karo" beats a stray "karo".
 */
const COMMANDS: readonly CommandEntry[] = [
  {
    command: 'goOnline',
    phrases: [
      'online', 'go online', 'online karo', 'online kar do', 'online ho jao',
      'آن لائن', 'آن لائن کرو', 'آن لائن کر دو',
      'kaam shuru', 'کام شروع', 'shuru karo', 'شروع کرو', 'start', 'start karo',
      'duty start', 'ڈیوٹی شروع', 'chalu karo', 'چالو کرو',
      'کار شروع', 'ڪم شروع',
    ],
  },
  {
    command: 'goOffline',
    phrases: [
      'offline', 'go offline', 'offline karo', 'offline kar do', 'offline ho jao',
      'آف لائن', 'آف لائن کرو', 'آف لائن کر دو',
      'kaam band', 'کام بند', 'band karo', 'بند کرو', 'bas karo', 'بس کرو',
      'duty khatam', 'ڈیوٹی ختم', 'chutti', 'چھٹی', 'stop karo',
      'ڪم بند', 'کار بند',
    ],
  },
  {
    command: 'acceptRide',
    phrases: [
      'accept', 'accept karo', 'accept kar do', 'ایکسپٹ', 'قبول', 'قبول کرو',
      'qabool', 'qabool karo', 'le lo', 'لے لو', 'le lein', 'لے لیں',
      'haan le lo', 'ہاں لے لو', 'ride le lo', 'رائیڈ لے لو',
      'manzoor', 'منظور', 'ok karo', 'اوکے کرو', 'yes accept',
      'قبول کر', 'ومنه',
    ],
  },
  {
    command: 'declineRide',
    phrases: [
      'decline', 'reject', 'reject karo', 'ریجیکٹ', 'مسترد',
      'mat lo', 'مت لو', 'nahi lena', 'نہیں لینا', 'chor do', 'چھوڑ دو',
      'skip', 'skip karo', 'اسکپ', 'rehne do', 'رہنے دو',
      'cancel karo', 'کینسل کرو', 'na karo', 'نہ کرو',
    ],
  },
  {
    command: 'nextRequest',
    phrases: [
      'next', 'next request', 'agla', 'agli', 'اگلا', 'اگلی',
      'agli ride', 'اگلی رائیڈ', 'aage', 'آگے', 'dusra', 'دوسرا',
      'next wala', 'نیکسٹ',
    ],
  },
  {
    command: 'readRequest',
    phrases: [
      'read', 'padho', 'parho', 'پڑھو', 'batao', 'بتاؤ', 'kya hai', 'کیا ہے',
      'kahan jana hai', 'کہاں جانا ہے', 'details', 'تفصیل', 'tafseel',
      'kitna', 'کتنا', 'kitne ka', 'کتنے کا', 'sunao', 'سناؤ',
    ],
  },
  {
    command: 'navigate',
    phrases: [
      'navigate', 'navigation', 'نیویگیشن', 'map', 'maps', 'نقشہ',
      'rasta', 'راستہ', 'rasta batao', 'راستہ بتاؤ', 'direction', 'ڈائریکشن',
      'google map', 'گوگل میپ',
    ],
  },
  {
    command: 'callPassenger',
    phrases: [
      'call', 'call karo', 'کال', 'کال کرو', 'phone karo', 'فون کرو',
      'baat karo', 'بات کرو', 'rabta', 'رابطہ', 'call passenger',
      'sawari ko call', 'سواری کو کال',
    ],
  },
  {
    command: 'endRoute',
    phrases: [
      'end route', 'route khatam', 'روٹ ختم', 'route band', 'روٹ بند',
      'safar khatam', 'سفر ختم', 'trip khatam', 'ٹرپ ختم', 'khatam karo', 'ختم کرو',
      'finish', 'complete karo', 'مکمل کرو',
    ],
  },
];

/** Folded phrase → command. Built once at module load. */
interface CommandIndex {
  readonly lookup: ReadonlyMap<string, DriverCommand>;
  readonly maxWords: number;
}

function buildIndex(): CommandIndex {
  const lookup = new Map<string, DriverCommand>();
  let maxWords = 1;

  for (const entry of COMMANDS) {
    for (const phrase of entry.phrases) {
      const normalized = normalizeText(phrase);
      if (!normalized) continue;

      const words = normalized.split(' ');
      maxWords = Math.max(maxWords, words.length);

      if (!lookup.has(normalized)) lookup.set(normalized, entry.command);

      const roman = words.map(romanKey).join(' ');
      if (roman && !lookup.has(roman)) lookup.set(roman, entry.command);
    }
  }

  return { lookup, maxWords };
}

const INDEX = buildIndex();

/**
 * Commands ranked by how much damage the wrong call does. When one utterance
 * matches more than one command, the earliest in this list wins — so a muddled
 * "nahi, accept" declines rather than accepts, and a driver who says anything
 * resembling "stop" goes offline rather than taking a ride.
 */
const SAFETY_ORDER: readonly DriverCommand[] = [
  'declineRide',
  'goOffline',
  'endRoute',
  'acceptRide',
  'goOnline',
  'callPassenger',
  'navigate',
  'nextRequest',
  'readRequest',
];

/**
 * Resolve a spoken phrase to a command, or null when it matches nothing.
 *
 * Null is a normal outcome and the caller should simply do nothing visible
 * beyond a short "samajh nahi aaya" — a driver mishearing themselves into an
 * accidental action is far worse than a command that needs repeating.
 */
export function resolveCommand(transcript: string): DriverCommand | null {
  const tokens = tokenize(normalizeText(transcript));
  if (!tokens.length) return null;

  // Every command phrase in the utterance, with the span it occupies.
  const matches: Array<{ command: DriverCommand; start: number; end: number }> = [];

  let i = 0;
  while (i < tokens.length) {
    let matched: { command: DriverCommand; width: number } | null = null;
    const widest = Math.min(INDEX.maxWords, tokens.length - i);

    for (let width = widest; width >= 1; width--) {
      const span = tokens.slice(i, i + width);
      const command =
        INDEX.lookup.get(span.join(' ')) ??
        INDEX.lookup.get(span.map(romanKey).join(' '));

      if (command) {
        matched = { command, width };
        break;
      }
    }

    if (matched) {
      matches.push({ command: matched.command, start: i, end: i + matched.width });
      i += matched.width;
    } else {
      i++;
    }
  }

  if (!matches.length) return null;

  /**
   * Cancel negated commands.
   *
   * "accept mat karo" contains "accept" and means the opposite. A negated
   * command is discarded rather than reinterpreted: the negation of "accept" is
   * obvious, but the negation of "online" is not ("don't go online" is not "go
   * offline"), and guessing wrong puts a driver on a job they refused. Dropping
   * it costs one repeat.
   *
   * Each negation cancels exactly ONE command — the nearest, preferring the one
   * it follows, matching the passenger parser. A blanket window would let a
   * single "nahi" wipe out an unrelated command later in the same breath, so
   * "online nahi karna, offline karo" would do nothing at all.
   */
  const negated = new Set<(typeof matches)[number]>();

  for (let position = 0; position < tokens.length; position++) {
    const token = tokens[position] ?? '';
    const isNegation =
      NEGATION_WORDS.lookup.has(token) || NEGATION_WORDS.lookup.has(romanKey(token));
    if (!isNegation) continue;

    let best: (typeof matches)[number] | null = null;
    let bestScore = Infinity;

    for (const match of matches) {
      // A negation word INSIDE a command phrase is part of that phrase, not an
      // attack on it — "chor do" ("leave it") is itself the decline command.
      if (position >= match.start && position < match.end) continue;

      const distance =
        position < match.start ? match.start - position : position - (match.end - 1);
      if (distance > NEGATION_WINDOW) continue;

      const score = position >= match.end ? distance - 0.5 : distance;
      if (score < bestScore) {
        bestScore = score;
        best = match;
      }
    }

    if (best) negated.add(best);
  }

  const found = new Set<DriverCommand>();
  for (const match of matches) {
    if (!negated.has(match)) found.add(match.command);
  }

  if (!found.size) return null;

  for (const command of SAFETY_ORDER) {
    if (found.has(command)) return command;
  }
  return null;
}

/** Spoken acknowledgement for each command, in Urdu. */
export const COMMAND_ACK: Record<DriverCommand, string> = {
  goOnline: 'آپ آن لائن ہیں۔',
  goOffline: 'آپ آف لائن ہیں۔',
  acceptRide: 'رائیڈ قبول کر لی۔',
  declineRide: 'رائیڈ چھوڑ دی۔',
  nextRequest: 'اگلی درخواست۔',
  readRequest: 'درخواست کی تفصیل۔',
  navigate: 'راستہ کھول رہے ہیں۔',
  callPassenger: 'سواری کو کال کر رہے ہیں۔',
  endRoute: 'روٹ ختم کر دیا۔',
};

/** English label for the same command, for on-screen confirmation. */
export const COMMAND_LABEL: Record<DriverCommand, string> = {
  goOnline: 'Going online',
  goOffline: 'Going offline',
  acceptRide: 'Accepting ride',
  declineRide: 'Declining ride',
  nextRequest: 'Next request',
  readRequest: 'Reading request',
  navigate: 'Opening navigation',
  callPassenger: 'Calling passenger',
  endRoute: 'Ending route',
};

/** Prompt spoken when a driver opens the mic. */
export const DRIVER_PROMPT = 'حکم بولیں۔';

/** Spoken when nothing matched. */
export const DRIVER_NOT_UNDERSTOOD = 'سمجھ نہیں آیا۔ دوبارہ بولیں۔';
