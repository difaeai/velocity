/**
 * Typed wrappers around the backend callable functions.
 *
 * The app never writes privileged data (money, roles, trip state) to Firestore
 * directly — the security rules forbid it. Every action goes through one of
 * these callables, which run the server-authoritative logic.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { Gender, GeoPoint, RideType } from '../domain/types';

function callable<Req, Res>(name: string): (data: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await fn(data)).data;
}

export interface DriverOnboardingInput {
  fullName: string;
  cnic: string;
  vehicleType: RideType;
  vehicleLabel: string;
  plate: string;
  licenseDocPath: string;
  licenseDocUrl?: string;
  cnicDocPath: string;
  cnicDocUrl?: string;
  cnicBackDocPath?: string;
  cnicBackDocUrl?: string;
  vehicleDocPath: string;
  vehicleDocUrl?: string;
  photoDocPath?: string;
  photoDocUrl?: string;
  selfieDocPath?: string;
  selfieDocUrl?: string;
  vehiclePhotoDocPath?: string;
  vehiclePhotoDocUrl?: string;
  email?: string;
  dob?: string;
  licenseExpiry?: string;
  cnicExpiry?: string;
  vehicleDocExpiry?: string;
}

export interface CreateTripInput {
  rideType: RideType;
  offeredFare: number;
  seats: number;
  passengerGender: Gender;
  pool?: boolean;
  paymentMethod?: 'cash' | 'wallet';
  preferFemaleDriver?: boolean;
  promoCode?: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export const api = {
  claimDriverRole: callable<Record<string, never>, { ok: boolean }>('claimDriverRole'),
  submitDriverOnboarding: callable<DriverOnboardingInput, { ok: boolean; verificationStatus: string }>(
    'submitDriverOnboarding',
  ),
  createTrip: callable<CreateTripInput, { ok: boolean; tripId: string }>('createTrip'),
  placeBid: callable<{ tripId: string; fare: number }, { ok: boolean; bidId: string }>('placeBid'),
  raiseTripFare: callable<{ tripId: string; fare: number }, { ok: boolean; offeredFare: number }>(
    'raiseTripFare',
  ),
  acceptBid: callable<{ tripId: string; bidId: string }, { ok: boolean; fare: number; driverId: string }>(
    'acceptBid',
  ),
  updateTripStatus: callable<
    { tripId: string; to: 'arriving' | 'arrived' | 'in_progress' },
    { ok: boolean; status: string }
  >('updateTripStatus'),
  cancelTrip: callable<{ tripId: string; reason?: string }, { ok: boolean }>('cancelTrip'),
  completeTrip: callable<{ tripId: string }, { ok: boolean }>('completeTrip'),
  raiseSafetyEvent: callable<
    { tripId: string; kind?: 'sos' | 'route_deviation'; note?: string },
    { ok: boolean; eventId: string }
  >('raiseSafetyEvent'),
  createTopupIntent: callable<
    { amount: number; phone?: string },
    { ok: boolean; intentId: string; redirectUrl: string | null; mock: boolean }
  >('createTopupIntent'),
  mockConfirmTopup: callable<{ intentId: string }, { ok: boolean }>('mockConfirmTopup'),
  requestPayout: callable<
    { amount: number; method?: 'jazzcash' | 'easypaisa' | 'bank'; account?: string },
    { ok: boolean; payoutId: string }
  >('requestPayout'),
  payCommission: callable<Record<string, never>, { ok: boolean }>('payCommission'),
  submitRating: callable<
    { tripId: string; stars: number; comment?: string; targetRole: 'driver' | 'passenger' },
    { ok: boolean }
  >('submitRating'),
  startPoolBoarding: callable<
    { rideId: string; driverLat: number; driverLng: number },
    { ok: boolean; pickupOrder: string[] }
  >('startPoolBoarding'),
  poolArrivePassenger: callable<{ rideId: string; passengerId: string }, { ok: boolean }>('poolArrivePassenger'),
  poolPassengerBoarded: callable<{ rideId: string; passengerId: string }, { ok: boolean }>('poolPassengerBoarded'),
  completePoolRide: callable<{ rideId: string }, { ok: boolean }>('completePoolRide'),
  registerFcmToken: callable<{ token: string; platform?: 'ios' | 'android' | 'web' }, { ok: boolean }>('registerFcmToken'),

  // ── Travel Mate ──────────────────────────────────────────────────────────────
  requestTravelMateSubscription: callable<
    { planId: string; paymentMethod: 'wallet' | 'easypaisa' | 'jazzcash' | 'bank'; paymentProofURL?: string },
    { subscriptionId: string; status: string }
  >('requestTravelMateSubscription'),
  upsertTravelMateProfile: callable<UpsertTravelMateInput, { profile: Record<string, unknown> }>('upsertTravelMateProfile'),
  getTravelMateFeed: callable<
    { limit?: number; excludeUids?: string[] },
    { candidates: TravelMateCard[]; count: number }
  >('getTravelMateFeed'),
  travelMateSwipe: callable<
    { targetUid: string; direction: 'like' | 'pass' },
    { matched: boolean; matchId?: string; remaining?: number; tier?: 'free' | 'subscribed'; direction?: 'pass' }
  >('travelMateSwipe'),
};

// ── Travel Mate types ─────────────────────────────────────────────────────────

export type TravelMateDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TravelMateCard {
  uid: string;
  displayName: string;
  photoURL: string | null;
  destinationName: string;
  departTime: string;
  returnTime: string;
  commonDays: TravelMateDay[];
  distanceKm: number;
  ratingAvg: number;
  ratingCount: number;
}

export interface UpsertTravelMateInput {
  displayName: string;
  gender: 'male' | 'female';
  genderPreference: 'male' | 'female' | 'any';
  bio?: string;
  home: { lat: number; lng: number; address?: string };
  destination: {
    type: 'office' | 'university' | 'other';
    name: string;
    lat: number;
    lng: number;
    address?: string;
  };
  schedule: {
    days: TravelMateDay[];
    departTime: string; // HH:MM
    returnTime: string; // HH:MM
  };
  active?: boolean;
  photoURL?: string;
  copyRidePhoto?: boolean;
}
