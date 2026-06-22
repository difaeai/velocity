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
