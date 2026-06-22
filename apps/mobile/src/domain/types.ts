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
  | 'cancelled';

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
  pool?: boolean;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  driverInfo?: DriverPublicInfo;
  settlement?: Settlement;
  activeSafetyEventId?: string;
}
