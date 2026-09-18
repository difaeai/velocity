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
  bike: 'Moto',
  auto: 'Rickshaw',
  mini: 'Mini',
  ac: 'AC Car',
  comfort: 'Comfort',
  xl: 'XL',
};

// ── How a rider will pay ────────────────────────────────────────────────────
/**
 * Everything a rider can offer to pay with. A booking carries a LIST of these,
 * not one: a rider who is happy with cash or JazzCash gets picked up by more
 * drivers than one who insists on a single method, and the driver decides
 * which of the offered methods they actually want.
 *
 * `wallet` is the only one that settles inside Velocity. Cash, EasyPaisa,
 * JazzCash and a bank transfer all end with the rider paying the driver
 * directly, which is why `settlementChannel` folds them together — see there.
 */
export type PaymentMethod = 'cash' | 'easypaisa' | 'jazzcash' | 'bank' | 'wallet';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  easypaisa: 'EasyPaisa',
  jazzcash: 'JazzCash',
  bank: 'Bank transfer',
  wallet: 'Wallet',
};

/** Short forms for the driver's request card, where space is tight. */
export const PAYMENT_METHOD_SHORT: Record<PaymentMethod, string> = {
  cash: 'Cash',
  easypaisa: 'EasyPaisa',
  jazzcash: 'JazzCash',
  bank: 'Bank',
  wallet: 'Wallet',
};

/** The methods a rider can pick at booking, in the order they are shown. */
export const BOOKABLE_PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'easypaisa', 'jazzcash', 'bank', 'wallet',
];

/**
 * Which ledger a booking settles through.
 *
 * EasyPaisa, JazzCash and a bank transfer are money that reaches the driver
 * directly, exactly like a banknote — the platform never holds it, and the
 * driver owes commission on it. Only a wallet ride settles inside Velocity, and
 * only when the rider offered nothing else. Everything downstream of a
 * completed trip (commission, cash-in-hand, payouts) keys off this, so it stays
 * the two values that logic has always understood.
 */
export function settlementChannel(methods: PaymentMethod[]): 'cash' | 'wallet' {
  return methods.length === 1 && methods[0] === 'wallet' ? 'wallet' : 'cash';
}

// ── Fare logic (mirrors the backend; the server remains authoritative) ──
export const COMMISSION_RATE = 0.1;
export const MAX_SEATS = 4;
export const BASE_FARES: Record<RideType, number> = {
  bike: 100,
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

/** One rider on a destination pool, as recorded on the trip document. */
export interface PoolRosterEntry {
  uid: string;
  /** First name only — this document is readable by every other rider. */
  firstName: string;
  gender: Gender | string;
  /** 'host' booked the ride · 'share' joined it by link or from discovery. */
  kind: 'host' | 'share';
  pickupAddress: string | null;
  dropoffAddress: string | null;
  joinedAt?: { seconds: number } | null;
  /** Set once the driver has let them out. Absent while they are still aboard. */
  droppedAt?: { seconds: number } | null;
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
  /** The settlement channel — see settlementChannel(). */
  paymentMethod?: 'cash' | 'wallet';
  /** Every method the rider offered to pay with. Always at least one. */
  paymentMethods?: PaymentMethod[];
  /**
   * Where the driver was, last time they reported it.
   *
   * A copy, kept on the trip because the passenger cannot read `drivers/{uid}`
   * — that document is the driver's own. Without it a rider watching the screen
   * has no way to tell whether the car is around the corner or across the city.
   * Written by the assigned driver only, and only while the ride is live.
   */
  driverLocation?: { lat: number; lng: number } | null;
  driverLocationAt?: { seconds: number } | null;
  pool?: boolean;
  /** Pool rides only — share-link invite code + rider roster. */
  poolVisibility?: PoolVisibility;
  shareCode?: string;
  poolMembers?: string[];
  poolPerSeatFare?: number;
  maxPoolRiders?: number;
  /**
   * When the trip was created. Present on pools so the screen can count down
   * the ten minutes in which riders going the same way may still hop in.
   */
  createdAt?: { seconds: number } | null;
  /**
   * Riders picked up along the driver's route each rode a different piece of it,
   * so they each have their own fare — see the leg-split in the backend's
   * lib/enRouteFare. When this is present it, not `poolPerSeatFare`, is what
   * everyone actually owes.
   */
  poolRiders?: PoolRider[];
  /**
   * Who is in a DESTINATION pool — one booked on the booking screen and joined
   * by invite code or from nearby discovery.
   *
   * A separate field from `poolRiders` on purpose: that one carries the
   * en-route leg-split (boarding offsets along the driver's road, a per-rider
   * billable distance) and the fare engine reads its presence as "already
   * priced against a route". A destination pool has none of that — everyone
   * rides the same road for the same flat tier fare — so it records only who is
   * aboard. See the backend's trips/poolRoster.
   *
   * Every co-rider can read the trip document, so this deliberately carries
   * first names and nothing more; full names and fares reach the driver through
   * the `getPoolRiders` callable instead.
   */
  poolRoster?: PoolRosterEntry[];
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
  /**
   * Summary of the in-ride chat, written by sendTripMessage alongside the
   * message itself.
   *
   * Denormalised on purpose. The Messages inbox lists every ride the rider has
   * talked to a driver on; reading that from `trips/{id}/chat` would be one
   * subcollection query per ride in their history, for a list that is mostly
   * rides nobody ever typed on. Absent on chats whose last message predates
   * this, which read as "no messages" rather than wrongly.
   */
  chatLastMessage?: string | null;
  chatLastMessageAt?: { seconds: number } | null;
  chatLastSenderId?: string | null;
  chatLastSenderName?: string | null;
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
