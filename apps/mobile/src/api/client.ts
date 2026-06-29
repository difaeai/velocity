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

  // ── Travel Mate Phase 3 — social ─────────────────────────────────────────
  sendTravelMateMessage: callable<
    { matchId: string; text: string },
    { messageId: string }
  >('sendTravelMateMessage'),
  unmatchTravelMate: callable<
    { matchId: string },
    { status: string }
  >('unmatchTravelMate'),
  reportTravelMateUser: callable<
    { reportedUid: string; matchId?: string; reason: string },
    { reportId: string; status: string }
  >('reportTravelMateUser'),

  // ── Travel Mate Phase 4 — groups ─────────────────────────────────────────
  createTravelMateGroup: callable<
    { name?: string; destinationName?: string; schedule?: { days: TravelMateDay[]; departTime: string } },
    { groupId: string }
  >('createTravelMateGroup'),
  joinTravelMateGroup: callable<
    { groupId: string },
    { joined: boolean; alreadyMember?: boolean }
  >('joinTravelMateGroup'),
  settleTravelMateSplit: callable<
    { groupId: string; tripId: string; riderUids: string[]; amountPKR?: number },
    { settled: boolean; fare: number; share: number; riders: number; collected: number; bookerNetCost: number }
  >('settleTravelMateSplit'),

  // ── Pool ride requests — InDrive-style negotiation (Task 1) ───────────────
  createPoolRideRequest: callable<
    {
      pickupLat: number; pickupLng: number; pickupAreaName: string;
      destinationLat: number; destinationLng: number; destinationAreaName: string;
      proposedFarePerSeat: number; totalSlots: number;
      genderPref: 'male_only' | 'female_only' | 'any';
    },
    { ok: boolean; requestId: string }
  >('createPoolRideRequest'),
  driverRespondToRequest: callable<
    { requestId: string; action: 'accept' | 'counter'; counterFarePerSeat?: number },
    { ok: boolean; status: string }
  >('driverRespondToRequest'),
  leaderRespondToOffer: callable<
    { requestId: string; action: 'accept' | 'reject' },
    { ok: boolean; status: string }
  >('leaderRespondToOffer'),
  joinPoolRideRequest: callable<
    { requestId: string },
    { ok: boolean; farePerSeat: number }
  >('joinPoolRideRequest'),
  cancelPoolRideRequest: callable<
    { requestId: string },
    { ok: boolean }
  >('cancelPoolRideRequest'),

  // ── Nearby active rides — anonymised discovery (Task 2) ───────────────────
  getNearbyPoolRequests: callable<
    { lat: number; lng: number; radiusKm?: number },
    { requests: NearbyPoolRequest[] }
  >('getNearbyPoolRequests'),
  getNearbyActiveRides: callable<
    { lat: number; lng: number; radiusKm?: number },
    { rides: NearbyActiveRide[] }
  >('getNearbyActiveRides'),

  // ── Commute schedule (Task 3) ─────────────────────────────────────────────
  upsertCommuteSchedule: callable<CommuteScheduleInput, { ok: boolean }>('upsertCommuteSchedule'),
  deleteCommuteSchedule: callable<Record<string, never>, { ok: boolean }>('deleteCommuteSchedule'),
  getCommuteDemand: callable<
    { lat: number; lng: number; radiusKm?: number },
    { demand: CommuteDemandSlot[] }
  >('getCommuteDemand'),
};

// ── Pool ride request / nearby ride types ────────────────────────────────────

export type PoolGenderPref = 'male_only' | 'female_only' | 'any';
export type CommuteDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface NearbyPoolRequest {
  requestId: string;
  pickupAreaName: string;
  destinationAreaName: string;
  proposedFarePerSeat: number;
  totalSlots: number;
  filledSlots: number;
  slotsAvailable: number;
  genderPref: PoolGenderPref;
  distanceKm: number;
}

export interface NearbyActiveRide {
  type: 'request' | 'ride';
  id: string;
  pickupAreaName: string;
  destinationAreaName: string;
  farePerSeat: number;
  totalSlots: number;
  slotsAvailable: number;
  genderPref: PoolGenderPref;
  rideCategory?: string;
  distanceKm: number;
}

export interface CommuteScheduleInput {
  homeAreaName: string;
  homeLat: number;
  homeLng: number;
  destinationAreaName: string;
  destinationLat: number;
  destinationLng: number;
  morningTime: string;
  eveningTime?: string | null;
  activeDays: CommuteDay[];
  genderPref: PoolGenderPref;
  active?: boolean;
}

export interface CommuteDemandSlot {
  time: string;
  destinationAreaName: string;
  count: number;
  genderBreakdown: { male: number; female: number; any: number };
}

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
