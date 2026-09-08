/**
 * Velocity domain model — single source of truth for the data shapes shared
 * across the backend. (These types are intended to be extracted into a shared
 * package consumed by the mobile app and admin panel in a later stage.)
 */

export type Role = 'passenger' | 'driver' | 'admin';

export type Gender = 'male' | 'female' | 'unspecified';

export type RideType = 'bike' | 'auto' | 'mini' | 'ac' | 'comfort' | 'xl';

export const RIDE_TYPES: readonly RideType[] = [
  'bike',
  'auto',
  'mini',
  'ac',
  'comfort',
  'xl',
] as const;

export type DriverVerificationStatus =
  | 'unregistered'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended';

/**
 * Trip lifecycle. Transitions are enforced server-side only (see trips module):
 *
 *   requested ─► matched ─► arriving ─► arrived ─► in_progress ─► completed
 *        │  └───────────────── cancelled ◄───────────────────┘
 *        └─► merged
 *
 * `merged` is the end of the line for a pool request that a driver picked up
 * along their route: the rider now travels on somebody else's trip (the carrier),
 * so their own request stops being a trip in its own right and points at it via
 * `mergedIntoTripId`. It is terminal, it is not active, and it never settles —
 * the carrier trip pays out for everyone. See trips/enRoute.
 */
export type TripStatus =
  | 'requested'
  | 'matched'
  | 'arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'merged';

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

/**
 * Everything a rider can offer to pay with. A booking carries a LIST of these,
 * not one: a rider who is happy with cash or JazzCash gets picked up by more
 * drivers than one who insists on a single method, and the driver decides which
 * of the offered methods they actually want.
 */
export type PaymentMethod = 'cash' | 'easypaisa' | 'jazzcash' | 'bank' | 'wallet';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash', 'easypaisa', 'jazzcash', 'bank', 'wallet',
] as const;

/**
 * Which ledger a booking settles through.
 *
 * EasyPaisa, JazzCash and a bank transfer are money that reaches the driver
 * directly, exactly like a banknote — the platform never holds it, and the
 * driver owes commission on it. Only a wallet ride settles inside Velocity, and
 * only when the rider offered nothing else. Every downstream money path
 * (commission, cash-in-hand, payouts) keys off this, so it stays the two values
 * that logic has always understood.
 */
export function settlementChannel(methods: PaymentMethod[]): 'cash' | 'wallet' {
  return methods.length === 1 && methods[0] === 'wallet' ? 'wallet' : 'cash';
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Minimal, non-sensitive driver info safe to denormalise onto a trip doc. */
export interface DriverPublicInfo {
  driverId: string;
  displayName: string;
  photoURL: string | null;
  vehicleLabel: string;
  plate: string;
  rating: number;
}

/** Money breakdown for a completed trip. All values are integers (PKR). */
export interface Settlement {
  grossFare: number;
  commission: number;
  driverPayout: number;
  passengerShare: number;
  seats: number;
}
