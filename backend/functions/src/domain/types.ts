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
 *        └──────────────────── cancelled ◄───────────────────┘
 */
export type TripStatus =
  | 'requested'
  | 'matched'
  | 'arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

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
