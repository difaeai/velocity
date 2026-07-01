export type GenderComposition = 'all' | 'male' | 'female' | 'none';
export type DriverGenderPref  = 'male_only' | 'female_only' | 'any';

/**
 * Derives which gender(s) may still JOIN a pool given its current passenger
 * composition and the driver/leader's hard gender preference.
 *
 * Rules (Pakistani cultural norms):
 *   - Driver pref 'male_only' / 'female_only' = hard cap; composition doesn't matter.
 *   - 1M + 1F already mixed → 'all' (only mixedRideOk users shown client-side)
 *   - 2M+1F or 1M+2F → 'none' (seating is too cramped / uncomfortable)
 *   - 2M or 3M → 'male' only (never show to women)
 *   - 1M only → 'all' (females need mixedRideOk opt-in, checked client/join-side)
 *   - 2F → 'female' only
 *   - 3F → 'all' (a male is welcome in the front seat next to the driver)
 *   - 1F only → 'all' (males need mixedRideOk, checked client/join-side)
 *   - empty → 'all'
 *   - full → 'none'
 */
export function computeGenderAccess(
  maleSeats:  number,
  femaleSeats: number,
  maxSeats:   number,
  driverPref: DriverGenderPref = 'any',
): GenderComposition {
  const total = maleSeats + femaleSeats;

  if (total >= maxSeats) return 'none';

  // Driver / leader hard preference overrides composition.
  if (driverPref === 'male_only')   return 'male';
  if (driverPref === 'female_only') return 'female';

  // ── Mixed composition already in pool ──────────────────────────────────────
  if (maleSeats >= 1 && femaleSeats >= 1) {
    // 2M+1F or 1M+2F — the third rider makes seating uncomfortable; close it.
    if (total >= 3) return 'none';
    // 1M+1F with space — still shown (mixedRideOk checked at discovery/join time).
    return 'all';
  }

  // ── Pure male passengers ───────────────────────────────────────────────────
  if (maleSeats >= 2) return 'male';   // 2M or 3M — females never shown
  if (maleSeats === 1) return 'all';   // 1M — females see it only if mixedRideOk

  // ── Pure female passengers ─────────────────────────────────────────────────
  if (femaleSeats === 3) return 'all';    // 3F — a male can take the front seat
  if (femaleSeats === 2) return 'female'; // 2F — females only
  if (femaleSeats === 1) return 'all';    // 1F — males see it only if mixedRideOk

  return 'all'; // empty pool
}

/**
 * Returns true if the joining passenger's gender is permitted by the pool's
 * current genderComposition AND their mixedRideOk preference is sufficient.
 *
 * Throws a descriptive reason string when blocked so callers can surface it.
 */
export function canJoinPool(opts: {
  currentComposition: GenderComposition;
  maleSeats:  number;
  femaleSeats: number;
  joinerGender: string;
  joinerMixedRideOk: boolean;
}): { allowed: true } | { allowed: false; reason: string } {
  const { currentComposition, maleSeats, femaleSeats, joinerGender, joinerMixedRideOk } = opts;

  if (currentComposition === 'none') {
    return { allowed: false, reason: 'This ride is full or no longer accepting passengers.' };
  }
  if (currentComposition === 'male' && joinerGender !== 'male') {
    return { allowed: false, reason: 'This pool is for male passengers only.' };
  }
  if (currentComposition === 'female' && joinerGender !== 'female') {
    return { allowed: false, reason: 'This pool is for female passengers only.' };
  }

  // composition === 'all' — check whether joining creates a mixed pool and whether
  // the passenger has opted in.
  if (currentComposition === 'all') {
    const newMale   = maleSeats   + (joinerGender === 'male'   ? 1 : 0);
    const newFemale = femaleSeats + (joinerGender === 'female' ? 1 : 0);
    const willBeMixed = newMale >= 1 && newFemale >= 1;

    // Exception: 3 females already seated → male takes front seat, no opt-in needed.
    const is3FPlusMale = femaleSeats === 3 && joinerGender === 'male';

    if (willBeMixed && !is3FPlusMale && !joinerMixedRideOk) {
      return {
        allowed: false,
        reason:
          'This ride would be shared with passengers of the opposite gender. ' +
          'Enable "Open to mixed-gender rides" in your pool preferences to join.',
      };
    }
  }

  return { allowed: true };
}
