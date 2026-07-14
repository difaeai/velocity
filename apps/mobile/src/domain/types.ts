/**
 * Client-side mirror of the backend domain model (backend/functions/src/domain).
 * These will be extracted into a shared package in a later stage so the app and
 * backend share one definition.
 */
export type Role = 'passenger' | 'driver' | 'admin';

export type Gender = 'male' | 'female' | 'unspecified';

export type RideType = 'bike' | 'auto' | 'mini' | 'ac' | 'comfort' | 'xl';

export type TripStatus =
  | 'requested'
  | 'matched'
  | 'arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  /**
   * This pool request was picked up by a driver along their route, so the rider
   * now travels on that driver's trip instead. `mergedIntoTripId` points there,
   * and their activeTripId already follows it — this document is just history.
   */
  | 'merged';

export interface GeoPoint {
  lat: number;
  lng: number;
  address?: string;
}

export const RIDE_TYPE_LABELS: Record<RideType, string> = {
  bike: 'Bike',
  auto: 'Rickshaw',
  mini: 'Mini',
  ac: 'AC Car',
  comfort: 'Comfort',
  xl: 'XL',
};

// ── Fare logic (mirrors the backend; the server remains authoritative) ──
export const COMMISSION_RATE = 0.1;
export const MAX_SEATS = 4;
export const BASE_FARES: Record<RideType, number> = {
  bike: 150,
  auto: 250,
  mini: 400,
  ac: 550,
  comfort: 750,
  xl: 1100,
};
const MIN_BID_FACTOR = 0.7;
const MAX_BID_FACTOR = 3.0;

export function fareBounds(rideType: RideType): { base: number; min: number; max: number } {
  const base = BASE_FARES[rideType];
  return { base, min: Math.round(base * MIN_BID_FACTOR), max: Math.round(base * MAX_BID_FACTOR) };
}

export interface DriverPublicInfo {
  driverId: string;
  displayName: string;
  photoURL: string | null;
  vehicleLabel: string;
  plate: string;
  rating: number;
}

export interface Settlement {
  grossFare: number;
  commission: number;
  driverPayout: number;
  passengerShare: number;
  seats: number;
}

export interface Bid {
  id: string;
  driverId: string;
  fare: number;
  status: string;
  driverInfo: DriverPublicInfo;
  /** Where the driver was when they made the offer (shown on the map). */
  driverLocation?: { lat: number; lng: number } | null;
}

export type PoolVisibility = 'public' | 'private';

/** One person in a shared car, and the slice of the road they are paying for. */
export interface PoolRider {
  uid: string;
  name: string;
  gender: Gender;
  seats: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  /** What they pay. Riders who boarded at different points pay different amounts. */
  fare: number;
  /** What they would have paid riding alone — the ceiling on the above. */
  soloFare: number;
  billableKm: number;
  /** 'host' booked it · 'share' joined by link · 'enroute' picked up on the way. */
  kind: 'host' | 'share' | 'enroute';
}

export interface Trip {
  id: string;
  status: TripStatus;
  passengerId: string;
  driverId: string | null;
  rideType: RideType;
  offeredFare: number;
  fare: number | null;
  seats: number;
  passengerGender: Gender;
  paymentMethod?: 'cash' | 'wallet';
  pool?: boolean;
  /** Pool rides only — share-link invite code + rider roster. */
  poolVisibility?: PoolVisibility;
  shareCode?: string;
  poolMembers?: string[];
  poolPerSeatFare?: number;
  maxPoolRiders?: number;
  /**
   * Riders picked up along the driver's route each rode a different piece of it,
   * so they each have their own fare — see the leg-split in the backend's
   * lib/enRouteFare. When this is present it, not `poolPerSeatFare`, is what
   * everyone actually owes.
   */
  poolRiders?: PoolRider[];
  poolFares?: Record<string, number>;
  /** The corridor the driver is running, once en-route pickups are in play. */
  enRoute?: {
    active: boolean;
    source: 'trip' | 'driver_route';
    origin: GeoPoint;
    destination: GeoPoint;
    polyline: string;
    corridorRadiusM: number;
    destRadiusM: number;
  };
  /** Set on a request that was absorbed into somebody else's trip. */
  mergedIntoTripId?: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  driverInfo?: DriverPublicInfo;
  settlement?: Settlement;
  activeSafetyEventId?: string;
  // Contact info stored when bid is accepted
  passengerPhone?: string | null;
  driverPhone?: string | null;
  // Rating flags (set once each side submits a rating)
  passengerRated?: boolean;
  driverRated?: boolean;
  arrivedAt?: { seconds: number; nanoseconds: number } | null;
  // Cancellation (set by cancelTrip)
  cancelledBy?: string;
  cancelledByRole?: 'passenger' | 'driver';
  cancelReason?: string | null;
  /** Null when the trip was cancelled before a driver accepted — those are free. */
  cancellationFee?: CancellationFee | null;
}

/** What a cancellation cost the person who walked away. All values in PKR. */
export interface CancellationFee {
  amount: number;
  /** Fraction of the locked fare the fee was charged at (e.g. 0.05). */
  rate: number;
  role: 'passenger' | 'driver';
  /** Part of the fee the wallet balance covered right away. */
  paidFromWallet: number;
  /** Part left owing to Velocity. */
  outstanding: number;
}
