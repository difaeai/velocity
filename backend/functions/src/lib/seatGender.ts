/**
 * Seat gender — who is actually sitting in the seat, not whose account booked it.
 * ----------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * -------------------
 * Every shared-ride gate in Velocity used to read one field: the BOOKER's
 * profile gender. That is right almost all of the time and wrong in the one
 * case Pakistani riders hit constantly — booking a ride for somebody else.
 *
 * A woman books a shared ride for her brother. The booker is female, so the
 * trip was recorded female, so the app offered her women's rides and the server
 * happily seated a man in one. Nobody lied; the schema simply had no way to say
 * "the person travelling is not me". Every gate downstream — the running
 * tally, `computeGenderAccess`, Suggested Rides, en-route pickups — inherited
 * the same wrong answer, because they all read the same field.
 *
 * So a seat now carries its own gender, and the booker's profile gender is only
 * one way of arriving at it.
 *
 * WHY THE CLIENT NEVER NAMES A GENDER
 * -----------------------------------
 * `passengerGender` on createTrip has been accepted-and-ignored for exactly one
 * reason: a field the client fills is a field the client can lie about, and
 * claiming 'female' to be seated in a women's ride is the precise abuse these
 * rules exist to prevent. That property must survive this change.
 *
 * It does, because the client does not send a gender. It sends a RELATIONSHIP —
 * 'self' or 'other' — and the server derives the gender from the caller's own
 * verified profile:
 *
 *   bookedFor 'self'  → the profile gender. Unchanged from before.
 *   bookedFor 'other' → the OPPOSITE of the profile gender.
 *
 * "The opposite" is not an assumption we invented; it is what the question
 * means. A rider booking for someone of their own gender has no reason to
 * answer anything but 'self' — the seat lands in the same pools either way, so
 * there is nothing to gain by saying 'other'. The only answer that changes
 * anything is the one that means "a person of the other gender is travelling",
 * and in a two-gender question that names them without the client ever being
 * trusted with the word.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not make an opposite-gender seat trustworthy. A man can still say
 * "for someone else", get a female seat and turn up himself. Deriving the
 * gender safely is only the first of three defences, and this module is just
 * the first:
 *
 *   1. HERE: the seat's gender is derived, never dictated.
 *   2. `requiresVettingToJoin` below: an opposite-gender seat may never take an
 *      instant place in a same-gender car. Somebody has to say yes first, even
 *      when the car has no driver yet and the rules would otherwise seat them.
 *   3. The people in the car: co-riders are told a seat was booked for someone
 *      else BEFORE they decide, any of them may object, and an objection is
 *      binding (see `coRiderObjectToPoolJoin`). The driver, who is the only one
 *      who actually sees who gets in, keeps the last word.
 *
 * Misrepresentation is already punishable: `users/{uid}.poolBookingBlocked`
 * shuts an account out of shared rides entirely, and the join gates read it.
 * ----------------------------------------------------------------------------
 */

/** A verified gender, as stored on a user profile. */
export type KnownGender = 'male' | 'female';

/** What a seat's gender can be. 'unspecified' means the profile never said. */
export type SeatGender = KnownGender | 'unspecified';

/**
 * Who the booker says is travelling. The only gender input a client ever sends,
 * and it names a relationship rather than a gender — see the file note.
 */
export type BookedFor = 'self' | 'other';

/** The opposite of a known gender. Undefined for 'unspecified'. */
export function oppositeGender(gender: SeatGender): SeatGender {
  if (gender === 'male') return 'female';
  if (gender === 'female') return 'male';
  return 'unspecified';
}

/** Narrow whatever a profile holds down to a gender we will act on. */
export function normalizeGender(raw: unknown): SeatGender {
  return raw === 'male' || raw === 'female' ? raw : 'unspecified';
}

export interface SeatOccupant {
  /** The gender of the person who will be in the seat. */
  seatGender: SeatGender;
  /**
   * True when the booker is not the passenger. Carried all the way to the
   * roster and shown to co-riders and the driver before anyone agrees to share
   * a car with this seat — see defence 3 in the file note.
   */
  bookedForOther: boolean;
}

/**
 * Resolve a booking into the gender of the person who will actually travel.
 *
 * `profileGender` must come from the caller's own user document, read
 * server-side. `bookedFor` is the client's answer and is the only part a rider
 * controls; it cannot name a gender, only a relationship to one.
 *
 * An 'unspecified' profile cannot produce an opposite: we do not know what it
 * is the opposite OF. Such a seat stays 'unspecified', which every gate already
 * treats as "could be either" and therefore as needing everyone else's
 * mixed-ride opt-in — the conservative answer, and the reason riders are asked
 * for their gender at sign-up.
 */
export function resolveSeatOccupant(
  profileGender: unknown,
  bookedFor: BookedFor | null | undefined,
): SeatOccupant {
  const mine = normalizeGender(profileGender);
  if (bookedFor !== 'other') {
    return { seatGender: mine, bookedForOther: false };
  }
  const theirs = oppositeGender(mine);
  // An unknown profile gender has no opposite. The seat is still somebody
  // else's, and saying so is what gets it vetted rather than seated.
  return { seatGender: theirs, bookedForOther: true };
}

/**
 * Whether this seat must be approved by a human before it joins `aboard`,
 * regardless of what the composition rules alone would allow.
 *
 * Defence 2 from the file note, and the rule that makes the whole feature safe
 * to ship. A driverless pool normally seats a joiner instantly — there is
 * nobody to ask, and making riders wait for an approval that can never come is
 * how pools die. But "nobody to ask" is exactly the wrong answer for a seat
 * whose occupant we are taking the booker's word for: it would let a man book
 * "for someone else", be handed a female seat, and walk into a gathering
 * women's ride with no human anywhere in the loop.
 *
 * So an opposite-gender seat joining a car that is currently single-gender is
 * always a request, never a seating. In a car that is already mixed, or empty,
 * there is no same-gender expectation to break and the normal rules stand.
 *
 * @param aboard genders of the riders already in the car
 */
export function requiresVettingToJoin(
  seat: SeatOccupant,
  aboard: readonly SeatGender[],
): boolean {
  if (!seat.bookedForOther) return false;
  if (aboard.length === 0) return false;

  const males = aboard.filter((g) => g === 'male').length;
  const females = aboard.filter((g) => g === 'female').length;

  // Already mixed — nobody in this car is relying on a same-gender promise, so
  // there is nothing for a claim to exploit.
  if (males > 0 && females > 0) return false;

  /**
   * A single-gender car. Vetted whether or not the claimed gender fits it —
   * and the case where it FITS is the important one.
   *
   * It is tempting to vet only a mismatch, because a mismatch is what looks
   * wrong. It is exactly backwards. A seat whose claimed gender does not fit is
   * already refused by `canJoinPool` on the composition rules, so it needs no
   * help from here. The dangerous seat is the one that fits: a man books "for
   * someone else", is handed a female seat, and the rules wave him into a car
   * of women precisely BECAUSE the claim matches. The claim is the thing
   * getting him in, which is the one circumstance where a claim must not be
   * enough on its own.
   */
  return true;
}

/** The sentence co-riders and drivers are shown about such a seat. */
export const BOOKED_FOR_OTHER_NOTE =
  'This seat was booked by someone else on the passenger’s behalf.';
