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

/**
 * Who is already aboard a pool, as a short chip caption.
 *
 * Counts only — the discovery feeds are anonymous, so this never names anyone.
 * It is the one thing a rider needs before tapping "Join": whether they'd be
 * sharing the car with the opposite gender, which the cultural seating rules
 * in `canJoinPool` then enforce for real.
 */
/**
 * Which pool this is, in the only terms a rider cares about: is it the women's
 * car, the men's car, a mixed one, or nobody's yet.
 *
 * The driver's hard preference wins where it exists — a "Women only" route is a
 * women's car whether or not anyone has boarded. Otherwise it is read off who is
 * actually aboard, because that is what the seating rules in `computeGenderAccess`
 * will go on to enforce: a car with two men in it is a men's car from then on,
 * nobody declared it one.
 */
export type PoolAudience = 'female' | 'male' | 'mixed' | 'open';

export function poolAudience(ride: {
  genderPref?: string;
  males?: number;
  females?: number;
}): PoolAudience {
  if (ride.genderPref === 'female_only') return 'female';
  if (ride.genderPref === 'male_only') return 'male';
  const males = ride.males ?? 0;
  const females = ride.females ?? 0;
  if (males > 0 && females > 0) return 'mixed';
  if (females > 0) return 'female';
  if (males > 0) return 'male';
  return 'open';
}

/**
 * Section headings for a feed split by audience.
 *
 * "Rides", not "pools": this is read by a rider, and the app says ride sharing
 * everywhere a rider can see. The `pool*` identifiers underneath keep their
 * names — they are the schema, not the wording.
 */
export const POOL_AUDIENCE_LABEL: Record<PoolAudience, string> = {
  female: '♀ Women’s rides',
  male: '♂ Men’s rides',
  mixed: '♂♀ Mixed rides',
  open: '👥 Open — no one aboard yet',
};

/** The same thing as a chip on a single row. */
export const POOL_AUDIENCE_CHIP: Record<PoolAudience, string> = {
  female: '♀ Women',
  male: '♂ Men',
  mixed: '♂♀ Mixed',
  open: '👥 Open',
};

/** What a heading needs to say about why these rides are grouped together. */
export const POOL_AUDIENCE_NOTE: Record<PoolAudience, string> = {
  female: 'Only women are aboard or allowed',
  male: 'Only men are aboard or allowed',
  mixed: 'Men and women already sharing',
  open: 'The first rider sets who can join',
};

/** The same four groups as a filter chip, with no heading grammar. */
export const POOL_AUDIENCE_FILTER: Record<PoolAudience, string> = {
  female: '♀ Women',
  male: '♂ Men',
  mixed: '♂♀ Mixed',
  open: '👥 Open',
};

export function poolGenderSummary(males: number, females: number): string {
  if (males <= 0 && females <= 0) return '👥 Empty — you’d be first';
  const parts: string[] = [];
  if (males   > 0) parts.push(`♂ ${males}`);
  if (females > 0) parts.push(`♀ ${females}`);
  const mixed = males > 0 && females > 0 ? ' · mixed' : '';
  return `${parts.join('  ')} aboard${mixed}`;
}
