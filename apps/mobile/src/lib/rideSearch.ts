/**
 * Searching, grouping and timing the shared-ride feed.
 * ---------------------------------------------------------------------------
 * The Shared rides screen asks three questions of the same list of cars, and
 * all three are answered here rather than inside the screen, because all three
 * are rules a rider will be annoyed by if they are even slightly wrong:
 *
 *   1. "Is anything going to Blue Area?"  -> `rideMatchesSearch`
 *   2. "Which areas have cars at all?"    -> `groupRidesByArea`
 *   3. "When does it leave?"              -> `rideTimeInfo`
 *
 * TIME IS THE HONEST PART
 * Only a driver-posted ride is scheduled, so only it can say "leaves 6:30 PM".
 * A shared ride somebody booked leaves when a driver takes it; a gathering one
 * leaves when its window closes; a request with no driver may never leave at
 * all. The feed therefore has four different kinds of "when", and
 * `rideTimeInfo` names which one a row is showing instead of printing a clock
 * time that was guessed.
 *
 * Everything here is pure and takes `now` as an argument, so the tests can sit
 * at a fixed instant and a row never renders a clock nobody recomputed.
 */
import { poolAudience, type PoolAudience } from './genderAccess';

/** The slice of a SuggestedRide these helpers read. */
export interface SearchableRide {
  pickupAreaName: string;
  destinationAreaName: string;
  farePerSeat: number;
  hasDriver: boolean;
  joinWindowEndsAt: number | null;
  departureAtMs: number | null;
  postedAtMs: number | null;
  expiresAtMs: number | null;
  genderPref?: string;
  males?: number;
  females?: number;
}

// -- Area names --------------------------------------------------------------

/**
 * "Blue Area, Islamabad, Islamabad Capital Territory 44000, Pakistan"
 *   -> "Blue Area"
 *
 * Google hands back a postal address; a rider thinks in the first line of it.
 * The country, the province and the postcode are dropped because they are the
 * same for every row on screen - they cost width and buy nothing. A name that
 * is only a plot or street number keeps its second segment, since "Street 12"
 * on its own locates nothing.
 */
export function shortAreaName(address: string): string {
  const parts = (address ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\d{4,6}$/.test(s) && !/^pakistan$/i.test(s));
  // Nothing survived the filter (an address that was only "Pakistan", or only a
  // postcode): show what we were given rather than a row that names nowhere.
  if (parts.length === 0) return (address ?? '').trim() || 'Unknown area';
  const head = parts[0]!;
  if (/^[\d\s/-]+$/.test(head) || /^(street|st|house|plot|block)\s*#?\s*[\w-]*$/i.test(head)) {
    return parts[1] ? `${head}, ${parts[1]}` : head;
  }
  return head;
}

/** Lower-cased, punctuation-free, single-spaced - the form both sides of a match use. */
export function normaliseArea(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// -- Search ------------------------------------------------------------------

/** The typed query, as the tokens a row has to satisfy. Empty query -> no tokens. */
export function searchTokens(query: string): string[] {
  const n = normaliseArea(query);
  return n.length === 0 ? [] : n.split(' ');
}

/** Which end of the journey the search matched - what the row then says it is. */
export type MatchedEnd = 'to' | 'from' | 'both' | null;

/**
 * Does this car touch the place the rider typed?
 *
 * Every token must appear at one end of the journey, so "blue area" narrows and
 * "blue islamabad" narrows further, instead of widening to everything that
 * contains "islamabad". The destination is tested first because "rides going to
 * where I am going" is the question riders actually type into the box.
 */
export function rideSearchMatch(ride: SearchableRide, tokens: string[]): MatchedEnd {
  if (tokens.length === 0) return null;
  const to = normaliseArea(ride.destinationAreaName);
  const from = normaliseArea(ride.pickupAreaName);
  const hitsTo = tokens.every((t) => to.includes(t));
  const hitsFrom = tokens.every((t) => from.includes(t));
  if (hitsTo && hitsFrom) return 'both';
  if (hitsTo) return 'to';
  if (hitsFrom) return 'from';
  return null;
}

export function rideMatchesSearch(ride: SearchableRide, tokens: string[]): boolean {
  return tokens.length === 0 || rideSearchMatch(ride, tokens) !== null;
}

// -- Time --------------------------------------------------------------------

/**
 * Which kind of "when" a row has:
 *   scheduled - a driver posted a departure time, so there is a real clock time
 *   now       - a driver is confirmed, or the posted time has arrived: it goes now
 *   window    - driverless but still gathering riders; it leaves when that closes
 *   waiting   - driverless and only waiting for a driver, until it expires
 *   posted    - nothing to promise but when it went up
 */
export type RideTimeKind = 'scheduled' | 'now' | 'window' | 'waiting' | 'posted' | 'unknown';

export interface RideTimeInfo {
  kind: RideTimeKind;
  /** Full line for a ride row. */
  label: string;
  /** Two or three words, for an area card. */
  short: string;
  /** Epoch-ms used to order "leaves soonest first". */
  sortMs: number;
}

/** "6:30 PM" - written out rather than left to Intl, which varies by device. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "25 min", "2 h 5 min", "1 day" - a gap, with no tense of its own. */
export function humanGap(ms: number): string {
  // Floored, not rounded: "in 25 min" must never be more time than the rider
  // really has to reach the pickup.
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rem = mins % 60;
  if (h < 24) return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
  const days = Math.round(h / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

/**
 * When this car leaves, in the strongest terms the data actually supports.
 *
 * The order of the checks is the order of certainty: a scheduled time beats a
 * confirmed driver, a confirmed driver beats a gathering window, and a window
 * beats "it is still looking". Nothing here invents a departure - a row with no
 * time at all says when it was posted and stops there.
 */
export function rideTimeInfo(ride: SearchableRide, now: number): RideTimeInfo {
  const dep = ride.departureAtMs;
  if (dep !== null && dep > now) {
    return {
      kind: 'scheduled',
      label: `Leaves ${clockTime(dep)} · in ${humanGap(dep - now)}`,
      short: clockTime(dep),
      sortMs: dep,
    };
  }
  // A posted time that has arrived, or a driver already assigned: it is going.
  if (dep !== null || ride.hasDriver) {
    return { kind: 'now', label: 'Leaving now', short: 'Now', sortMs: now };
  }
  if (ride.joinWindowEndsAt !== null && ride.joinWindowEndsAt > now) {
    return {
      kind: 'window',
      label: `Leaves by ${clockTime(ride.joinWindowEndsAt)} · still gathering riders`,
      short: `by ${clockTime(ride.joinWindowEndsAt)}`,
      sortMs: ride.joinWindowEndsAt,
    };
  }
  if (ride.expiresAtMs !== null && ride.expiresAtMs > now) {
    return {
      kind: 'waiting',
      label: `Waiting for a driver · until ${clockTime(ride.expiresAtMs)}`,
      short: `by ${clockTime(ride.expiresAtMs)}`,
      sortMs: ride.expiresAtMs,
    };
  }
  if (ride.postedAtMs !== null) {
    const ago = now - ride.postedAtMs;
    return {
      kind: 'posted',
      label: `Posted ${ago < 60000 ? 'just now' : `${humanGap(ago)} ago`}`,
      short: 'Soon',
      sortMs: ride.postedAtMs,
    };
  }
  return { kind: 'unknown', label: '', short: '', sortMs: Number.MAX_SAFE_INTEGER };
}

// -- Areas -------------------------------------------------------------------

export interface RideAreaGroup<T extends SearchableRide> {
  /** Normalised destination - the identity of the group. */
  key: string;
  /** What the card shows: "Blue Area". */
  area: string;
  rides: T[];
  /** Cheapest seat going there. */
  cheapestFare: number;
  /** The soonest departure in the group, already worded. */
  nextLabel: string;
  nextMs: number;
  /** Up to three places those cars start from. */
  pickupAreas: string[];
  /** How many of each kind of car go there. */
  audiences: Record<PoolAudience, number>;
}

/**
 * The same cars, grouped by where they are going - the "which areas have rides"
 * view. Sorted by what leaves soonest, because an area with a car leaving in
 * five minutes is more use than one with four cars leaving tonight.
 *
 * Grouping is on the destination only. A rider browsing areas is asking where
 * they could get to from here; the pickups are listed inside the card as the
 * answer to "from where", not used to split one destination into four cards.
 */
export function groupRidesByArea<T extends SearchableRide>(
  rides: T[],
  now: number,
): RideAreaGroup<T>[] {
  const groups = new Map<string, RideAreaGroup<T>>();

  for (const ride of rides) {
    const area = shortAreaName(ride.destinationAreaName);
    const key = normaliseArea(area) || normaliseArea(ride.destinationAreaName);
    const time = rideTimeInfo(ride, now);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        area,
        rides: [],
        cheapestFare: ride.farePerSeat,
        nextLabel: time.label,
        nextMs: time.sortMs,
        pickupAreas: [],
        audiences: { female: 0, male: 0, mixed: 0, open: 0 },
      };
      groups.set(key, g);
    }
    g.rides.push(ride);
    g.cheapestFare = Math.min(g.cheapestFare, ride.farePerSeat);
    if (time.sortMs < g.nextMs) {
      g.nextMs = time.sortMs;
      g.nextLabel = time.label;
    }
    const pickup = shortAreaName(ride.pickupAreaName);
    if (
      g.pickupAreas.length < 3
      && !g.pickupAreas.some((p) => normaliseArea(p) === normaliseArea(pickup))
    ) {
      g.pickupAreas.push(pickup);
    }
    g.audiences[poolAudience(ride)] += 1;
  }

  return [...groups.values()].sort((a, b) => a.nextMs - b.nextMs || b.rides.length - a.rides.length);
}
