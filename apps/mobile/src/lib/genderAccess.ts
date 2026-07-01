/**
 * Client-side mirror of backend/functions/src/lib/genderAccess.ts
 * Used for pool ride discovery filtering before the user attempts to join.
 */

export type GenderComposition = 'all' | 'male' | 'female' | 'none';
export type DriverGenderPref  = 'male_only' | 'female_only' | 'any';

export function computeGenderAccess(
  maleSeats: number,
  femaleSeats: number,
  maxSeats: number,
  driverPref: DriverGenderPref = 'any',
): GenderComposition {
  const total = maleSeats + femaleSeats;
  if (total >= maxSeats) return 'none';
  if (driverPref === 'male_only') return 'male';
  if (driverPref === 'female_only') return 'female';
  if (maleSeats >= 1 && femaleSeats >= 1) {
    if (total >= 3) return 'none';
    return 'all';
  }
  if (maleSeats >= 2) return 'male';
  if (maleSeats === 1) return 'all';
  if (femaleSeats === 3) return 'all';
  if (femaleSeats === 2) return 'female';
  if (femaleSeats === 1) return 'all';
  return 'all';
}

export function canJoinPool(opts: {
  currentComposition: GenderComposition;
  maleSeats: number;
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

  if (currentComposition === 'all') {
    const newMale   = maleSeats   + (joinerGender === 'male'   ? 1 : 0);
    const newFemale = femaleSeats + (joinerGender === 'female' ? 1 : 0);
    const willBeMixed = newMale >= 1 && newFemale >= 1;
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

export interface RideGenderFields {
  genderComposition?: GenderComposition;
  maleSeats?: number;
  femaleSeats?: number;
  maxSeats?: number;
  genderPref?: DriverGenderPref;
}

/** Whether a pool ride should appear in the browsing user's feed. */
export function isRideVisibleToUser(
  ride: RideGenderFields,
  userGender: string,
  mixedRideOk: boolean,
): boolean {
  const maleSeats   = ride.maleSeats   ?? 0;
  const femaleSeats = ride.femaleSeats ?? 0;
  const maxSeats    = ride.maxSeats    ?? 4;
  const driverPref  = ride.genderPref  ?? 'any';

  const composition =
    ride.genderComposition ??
    computeGenderAccess(maleSeats, femaleSeats, maxSeats, driverPref);

  if (composition === 'none') return false;

  // Unspecified gender: only empty open pools (safest default).
  if (userGender === 'unspecified') {
    return (
      composition === 'all' &&
      maleSeats === 0 &&
      femaleSeats === 0 &&
      driverPref === 'any'
    );
  }

  return canJoinPool({
    currentComposition: composition,
    maleSeats,
    femaleSeats,
    joinerGender: userGender,
    joinerMixedRideOk: mixedRideOk,
  }).allowed;
}

export function genderLabel(gender: string): string {
  if (gender === 'male') return '♂ Male';
  if (gender === 'female') return '♀ Female';
  return '? Unspecified';
}
