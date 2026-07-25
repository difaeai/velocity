/**
 * The rules engine: spoken sentence → booking slots. Runs entirely on device,
 * costs nothing, and works with no network.
 *
 * Strategy is "consume the confident parts, keep the rest". Tokens are claimed
 * in order of how certain we are about them:
 *
 *   1. Known places   — most specific, and they can legitimately contain digits
 *                       ("F 7"), so they must claim their tokens before the
 *                       number scan gets a chance to read them as seat counts.
 *   2. Keywords       — ride type, pool/solo, seat counts, sentence markers.
 *   3. Whatever is left, minus filler, is the destination the user spoke but we
 *      don't have in the gazetteer. It goes to autocomplete as typed text.
 *
 * Two behaviours are worth calling out because a naive keyword scan gets them
 * backwards:
 *
 *   Negation — "AC nahi chahiye" contains "ac". A match is discarded if a
 *   negation word sits within NEGATION_WINDOW tokens on either side.
 *
 *   Self-correction — "mini... nahi nahi AC wali" is normal speech. The LAST
 *   surviving match wins rather than the first, so corrections take effect.
 *
 * What this cannot do is inferred meaning with no keyword behind it. That is a
 * deliberate trade: the parser never guesses. When a slot is absent it is
 * reported in `missing`, and the voice screen asks for it out loud — which is
 * cheaper and more predictable than a model that occasionally invents a value.
 */
import { MAX_SEATS, type RideType } from '../domain/types';

import { findPlaces, type GazetteerHit, type Place } from './gazetteer';
import {
  AFFIRM_WORDS,
  AmbientTables,
  DENY_WORDS,
  DEST_MARKERS,
  FILLER_WORDS,
  NEGATION_WORDS,
  NUMBER_WORDS,
  ORIGIN_MARKERS,
  POOL_WORDS,
  RIDE_TYPES,
  SEAT_UNIT_WORDS,
  SOLO_WORDS,
  type PhraseTable,
} from './lexicon';
import { normalizeText, romanKey, tokenize } from './normalize';

/** How far from a keyword a negation word still applies to it. */
const NEGATION_WINDOW = 3;

/** How far from a number a unit word ("log", "seats") still binds to it. */
const SEAT_UNIT_WINDOW = 2;

/** Slots the booking flow cannot proceed without. */
export type VoiceSlot = 'destination' | 'rideType';

export interface VoiceIntent {
  /** The transcript this was parsed from, unmodified — shown back to the user. */
  readonly transcript: string;
  /** Gazetteer hit for the destination, when we recognised it. */
  readonly destinationPlace: Place | null;
  /** Destination as text — canonical when recognised, else the spoken words. */
  readonly destinationText: string | null;
  /** Pickup, only when the user said "X se" explicitly. Null means "use GPS". */
  readonly pickupText: string | null;
  readonly rideType: RideType | null;
  /** True = pool, false = explicitly solo, null = not mentioned. */
  readonly pool: boolean | null;
  readonly seats: number;
  /** Slots still needed before this can be booked. */
  readonly missing: readonly VoiceSlot[];
  /** False when the sentence carried no booking signal at all. */
  readonly understood: boolean;
}

/** One keyword match, with the token span it claimed. */
interface Match<T> {
  readonly value: T;
  readonly start: number;
  readonly end: number;
}

/** Final element, or null. Used wherever "the last one wins" is the rule. */
function last<T>(items: readonly T[]): T | null {
  return items.length ? (items[items.length - 1] as T) : null;
}

/**
 * Sweep a token stream for entries of a phrase table, longest match first,
 * skipping tokens already claimed by an earlier pass.
 */
function findMatches<T>(
  tokens: readonly string[],
  table: PhraseTable<T>,
  claimed: readonly boolean[],
): Array<Match<T>> {
  const matches: Array<Match<T>> = [];
  let i = 0;

  while (i < tokens.length) {
    if (claimed[i]) {
      i++;
      continue;
    }

    let hit: Match<T> | null = null;
    const widest = Math.min(table.maxWords, tokens.length - i);

    for (let width = widest; width >= 1; width--) {
      // A phrase may not straddle tokens another pass already took.
      let free = true;
      for (let k = i; k < i + width; k++) {
        if (claimed[k]) { free = false; break; }
      }
      if (!free) continue;

      const span = tokens.slice(i, i + width);
      const value =
        table.lookup.get(span.join(' ')) ??
        table.lookup.get(span.map(romanKey).join(' '));

      if (value !== undefined) {
        hit = { value, start: i, end: i + width };
        break;
      }
    }

    if (hit) {
      matches.push(hit);
      i = hit.end;
    } else {
      i++;
    }
  }

  return matches;
}

/**
 * Token indices holding a negation word, with runs collapsed to their first
 * index. "nahi nahi" is one emphatic refusal, not two — counting it twice let
 * the second one spill onto the following word and cancel the very thing the
 * speaker was correcting to.
 */
function negationPositions(tokens: readonly string[]): number[] {
  const positions: number[] = [];
  let previousWasNegation = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const isNegation =
      NEGATION_WORDS.lookup.has(token) || NEGATION_WORDS.lookup.has(romanKey(token));

    if (isNegation && !previousWasNegation) positions.push(i);
    previousWasNegation = isNegation;
  }

  return positions;
}

/**
 * Merge neighbouring matches carrying the same value into one span.
 *
 * "mini gari" is a single noun phrase that happens to contain two words we map
 * to `mini`. Left as two matches, a negation could cancel one and leave the
 * other standing — so "mini gari nahi, AC wali" would still come out as mini.
 */
function mergeAdjacent<T>(matches: ReadonlyArray<Match<T>>): Array<Match<T>> {
  const merged: Array<Match<T>> = [];

  for (const match of matches) {
    const previous = merged[merged.length - 1];
    if (previous && previous.value === match.value && previous.end === match.start) {
      merged[merged.length - 1] = { value: previous.value, start: previous.start, end: match.end };
    } else {
      merged.push(match);
    }
  }

  return merged;
}

/**
 * Decide which matches a sentence's negation words actually cancel.
 *
 * Each negation binds to exactly ONE match — the nearest within the window,
 * preferring a match that comes BEFORE it. Urdu puts negation after its target
 * ("AC nahi chahiye" = not AC), while English puts it before ("no AC"), and the
 * prefer-preceding rule satisfies both.
 *
 * Binding one negation to one match is what makes correction work. In "mini
 * nahi nahi AC wali", both negations land on "mini" — the word they follow — so
 * "AC" survives and becomes the answer, which is what the speaker meant.
 */
function negatedMatches<T>(
  tokens: readonly string[],
  matches: ReadonlyArray<Match<T>>,
): ReadonlySet<Match<T>> {
  const negated = new Set<Match<T>>();
  if (!matches.length) return negated;

  for (const position of negationPositions(tokens)) {
    let best: Match<T> | null = null;
    let bestScore = Infinity;

    for (const match of matches) {
      // Distance from the negation to the nearest edge of the match.
      const distance =
        position < match.start ? match.start - position
        : position >= match.end ? position - (match.end - 1)
        : 0;

      if (distance > NEGATION_WINDOW) continue;

      // A match ending before the negation wins ties — hence the half-point
      // bonus rather than a separate comparison pass.
      const score = position >= match.end ? distance - 0.5 : distance;

      if (score < bestScore) {
        bestScore = score;
        best = match;
      }
    }

    if (best) negated.add(best);
  }

  return negated;
}

/** Mark a span as claimed so later passes skip it. */
function claim(claimed: boolean[], match: Match<unknown>): void {
  for (let i = match.start; i < match.end; i++) claimed[i] = true;
}

/**
 * Pull the passenger count out of number/unit pairs. A bare number is ignored —
 * "F 7" and "phase 6" are places, not headcounts — so a unit word must be near.
 */
function extractSeats(
  tokens: readonly string[],
  numbers: ReadonlyArray<Match<number>>,
  claimed: boolean[],
): number | null {
  for (const number of numbers) {
    const from = Math.max(0, number.start - SEAT_UNIT_WINDOW);
    const to = Math.min(tokens.length, number.end + SEAT_UNIT_WINDOW);

    let hasUnit = false;
    for (let i = from; i < to; i++) {
      if (i >= number.start && i < number.end) continue;
      // A token another table already took is not available as a unit. Without
      // this, the "log" inside the pool phrase "aur log bhi" counted as a
      // headcount marker and silently added a seat.
      if (claimed[i]) continue;

      const token = tokens[i] ?? '';
      if (SEAT_UNIT_WORDS.lookup.has(token) || SEAT_UNIT_WORDS.lookup.has(romanKey(token))) {
        hasUnit = true;
        break;
      }
    }

    if (hasUnit) {
      claim(claimed, number);
      // Spoken counts above the vehicle limit clamp rather than fail — someone
      // saying "6 log" wants the biggest thing we have, not an error.
      return Math.min(Math.max(number.value, 1), MAX_SEATS);
    }
  }

  return null;
}

/** A bare-city gazetteer entry, as opposed to an area or landmark within one. */
function isBareCity(hit: GazetteerHit): boolean {
  return hit.place.canonical === hit.place.city;
}

/**
 * Drop a bare city name that sits next to a more specific place in that same
 * city. "islamabad f7 markaz" and "liberty market lahore" each produce two
 * hits, and keeping both loses the useful half — the specific one already
 * carries its city in the canonical string.
 */
function collapseCityHits(hits: readonly GazetteerHit[]): GazetteerHit[] {
  return hits.filter((hit, index) => {
    if (!isBareCity(hit)) return true;

    const before = hits[index - 1];
    const after = hits[index + 1];

    const redundantWith = (other: GazetteerHit | undefined) =>
      Boolean(other) && !isBareCity(other!) && other!.place.city === hit.place.city;

    return !redundantWith(before) && !redundantWith(after);
  });
}

/**
 * Locate a genuine "from X" split, or -1.
 *
 * The bar is deliberately high: the marker must be immediately preceded by a
 * recognised place. "se" is one of the most common words in Urdu and usually
 * means nothing about pickup — in "is se mera fare kam aye ga" ("this will make
 * my fare lower") it is part of a reason, not an address. Requiring a place
 * before it is what stops that phrase from hijacking the whole sentence.
 */
function findOriginSplit(
  markers: ReadonlyArray<Match<unknown>>,
  gazetteerHits: readonly GazetteerHit[],
  userHits: ReadonlyArray<Match<string>>,
): number {
  for (const marker of markers) {
    const precededByPlace =
      gazetteerHits.some((hit) => hit.end === marker.start) ||
      userHits.some((hit) => hit.end === marker.start);

    if (precededByPlace) return marker.start;
  }
  return -1;
}

/** Last place hit falling entirely inside [from, to), or null. */
function lastHitWithin(
  hits: readonly GazetteerHit[],
  from: number,
  to: number,
): GazetteerHit | null {
  let found: GazetteerHit | null = null;
  for (const hit of hits) {
    if (hit.start >= from && hit.end <= to) found = hit;
  }
  return found;
}

/**
 * Collect the unclaimed, non-filler tokens in a range as a place string.
 * Returns null when nothing meaningful survives.
 */
function leftoverText(
  tokens: readonly string[],
  claimed: readonly boolean[],
  from: number,
  to: number,
): string | null {
  const words: string[] = [];

  for (let i = from; i < to; i++) {
    if (claimed[i]) continue;
    const token = tokens[i];
    if (!token) continue;
    if (FILLER_WORDS.lookup.has(token) || FILLER_WORDS.lookup.has(romanKey(token))) continue;
    words.push(token);
  }

  return words.length ? words.join(' ') : null;
}

/**
 * Parse a spoken booking request.
 *
 * `knownPlaces` are the user's saved places and recent destinations — matching
 * those first means the common case (a repeat trip) resolves with no geocoding
 * at all, because those records already carry coordinates.
 */
export function parseBooking(transcript: string, knownPlaces: readonly string[] = []): VoiceIntent {
  const normalized = normalizeText(transcript);
  const tokens = tokenize(normalized);

  if (!tokens.length) {
    return {
      transcript,
      destinationPlace: null,
      destinationText: null,
      pickupText: null,
      rideType: null,
      pool: null,
      seats: 1,
      missing: ['destination', 'rideType'],
      understood: false,
    };
  }

  const claimed: boolean[] = new Array(tokens.length).fill(false);

  // ── Pass 1: places ────────────────────────────────────────────────────────
  // The user's own places outrank the gazetteer: if they have a saved place
  // called "Office", that beats any national landmark of the same name.
  const userPlaceTable = AmbientTables.forKnownPlaces(knownPlaces);
  const userHits = findMatches(tokens, userPlaceTable, claimed);
  for (const hit of userHits) claim(claimed, hit);

  const rawHits = findPlaces(tokens).filter((hit) => {
    for (let i = hit.start; i < hit.end; i++) if (claimed[i]) return false;
    return true;
  });
  const gazetteerHits = collapseCityHits(rawHits);
  for (const hit of gazetteerHits) {
    for (let i = hit.start; i < hit.end; i++) claimed[i] = true;
  }
  // Tokens of hits dropped by the collapse are claimed too, so a discarded
  // "lahore" in "liberty market lahore" cannot resurface as free text.
  for (const hit of rawHits) {
    for (let i = hit.start; i < hit.end; i++) claimed[i] = true;
  }

  // ── Pass 2: sentence markers ──────────────────────────────────────────────
  // Located before the keyword passes so we know where the origin/destination
  // boundary sits, but their tokens are claimed too — "se" is not a place name.
  const originMarkers = findMatches(tokens, ORIGIN_MARKERS, claimed);
  const originSplit = findOriginSplit(originMarkers, gazetteerHits, userHits);
  for (const marker of originMarkers) claim(claimed, marker);

  const destMarkers = findMatches(tokens, DEST_MARKERS, claimed);
  for (const marker of destMarkers) claim(claimed, marker);

  // ── Pass 3: ride type ─────────────────────────────────────────────────────
  const rideCandidates = mergeAdjacent(findMatches(tokens, RIDE_TYPES, claimed));
  for (const match of rideCandidates) claim(claimed, match);
  const negatedRides = negatedMatches(tokens, rideCandidates);
  const rideMatches = rideCandidates.filter((match) => !negatedRides.has(match));
  // Last one wins — later words are corrections of earlier ones.
  const rideType = last(rideMatches)?.value ?? null;

  // ── Pass 4: pool vs solo ──────────────────────────────────────────────────
  const poolMatches = findMatches(tokens, POOL_WORDS, claimed);
  const soloMatches = findMatches(tokens, SOLO_WORDS, claimed);
  for (const match of [...poolMatches, ...soloMatches]) claim(claimed, match);

  const negatedPool = negatedMatches(tokens, poolMatches);
  const negatedSolo = negatedMatches(tokens, soloMatches);

  const wantsPool = poolMatches.some((match) => !negatedPool.has(match));
  const wantsSolo =
    soloMatches.some((match) => !negatedSolo.has(match)) ||
    // "pool nahi" is an explicit request for solo, not merely absence of pool.
    (poolMatches.length > 0 && poolMatches.every((match) => negatedPool.has(match)));

  const pool = wantsPool ? true : wantsSolo ? false : null;

  // ── Pass 5: seats ─────────────────────────────────────────────────────────
  const numbers = findMatches(tokens, NUMBER_WORDS, claimed);
  const seats = extractSeats(tokens, numbers, claimed) ?? 1;

  // ── Pass 6: destination and pickup ────────────────────────────────────────
  // With "X se Y", everything before the marker is pickup and everything after
  // is destination. Without it, the whole sentence describes the destination.
  let destinationPlace: Place | null = null;
  let destinationText: string | null = null;
  let pickupText: string | null = null;

  // Free text only becomes a destination when the sentence actually pointed at
  // one — a "jana hai" / "chalo" / "X se" marker. Without that guard any
  // unrecognised noise ("aaaa bbb ccc") would be handed to autocomplete as an
  // address and the user would be asked to confirm nonsense.
  const hasDestinationSignal = destMarkers.length > 0 || originSplit >= 0;

  if (originSplit >= 0) {
    const before = lastHitWithin(gazetteerHits, 0, originSplit);
    const after = lastHitWithin(gazetteerHits, originSplit, tokens.length);

    pickupText = before
      ? before.place.canonical
      : leftoverText(tokens, claimed, 0, originSplit);

    if (after) {
      destinationPlace = after.place;
      destinationText = after.place.canonical;
    } else {
      destinationText = leftoverText(tokens, claimed, originSplit, tokens.length);
    }
  } else {
    // No origin given. Prefer the last recognised place — in "Saddar se nahi,
    // Clifton chalo" style corrections the later one is what they settled on.
    const lastHit = last(gazetteerHits);
    if (lastHit) {
      destinationPlace = lastHit.place;
      destinationText = lastHit.place.canonical;
    } else if (userHits.length) {
      // A saved place matched by name is used verbatim — the booking screen
      // resolves it against records that already hold coordinates.
      destinationText = last(userHits)?.value ?? null;
    } else if (hasDestinationSignal) {
      destinationText = leftoverText(tokens, claimed, 0, tokens.length);
    }
  }

  const missing: VoiceSlot[] = [];
  if (!destinationText) missing.push('destination');
  if (!rideType) missing.push('rideType');

  return {
    transcript,
    destinationPlace,
    destinationText,
    pickupText,
    rideType,
    pool,
    seats,
    missing,
    understood: Boolean(destinationText || rideType || pool !== null),
  };
}

// ── Follow-up turns ──────────────────────────────────────────────────────────
// Short answers to a single spoken question. Narrower and more forgiving than
// full sentence parsing, because the question already established the context.

/** Read a ride type out of an answer to "which vehicle?". */
export function parseRideTypeAnswer(transcript: string): RideType | null {
  const tokens = tokenize(normalizeText(transcript));
  if (!tokens.length) return null;

  const claimed: boolean[] = new Array(tokens.length).fill(false);
  const candidates = mergeAdjacent(findMatches(tokens, RIDE_TYPES, claimed));
  const negated = negatedMatches(tokens, candidates);
  const matches = candidates.filter((match) => !negated.has(match));

  return last(matches)?.value ?? null;
}

/** Read a destination out of an answer to "where to?". */
export function parseDestinationAnswer(
  transcript: string,
  knownPlaces: readonly string[] = [],
): { text: string | null; place: Place | null } {
  const tokens = tokenize(normalizeText(transcript));
  if (!tokens.length) return { text: null, place: null };

  const claimed: boolean[] = new Array(tokens.length).fill(false);

  const userHits = findMatches(tokens, AmbientTables.forKnownPlaces(knownPlaces), claimed);
  for (const hit of userHits) claim(claimed, hit);
  if (userHits.length) {
    return { text: last(userHits)?.value ?? null, place: null };
  }

  const lastHit = last(findPlaces(tokens));
  if (lastHit) {
    return { text: lastHit.place.canonical, place: lastHit.place };
  }

  for (const marker of findMatches(tokens, DEST_MARKERS, claimed)) claim(claimed, marker);
  return { text: leftoverText(tokens, claimed, 0, tokens.length), place: null };
}

/**
 * Read a yes/no out of a confirmation answer. Returns null when the reply is
 * neither — the caller re-asks rather than assuming.
 */
export function parseYesNo(transcript: string): boolean | null {
  const tokens = tokenize(normalizeText(transcript));
  if (!tokens.length) return null;

  const empty: boolean[] = new Array(tokens.length).fill(false);

  // Denial is checked first: "nahi" appears in both tables (as a standalone
  // "no" and inside affirmative phrases), and a refusal must never be read as
  // consent on a screen whose next step charges money.
  if (findMatches(tokens, DENY_WORDS, empty).length > 0) return false;
  if (findMatches(tokens, AFFIRM_WORDS, empty).length > 0) return true;

  return null;
}
