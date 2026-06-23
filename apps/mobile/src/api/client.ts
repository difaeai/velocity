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
  cnicDocPath: string;
  vehicleDocPath: string;
  // Optional richer fields (stored once the backend is redeployed):
  cnicBackDocPath?: string;
  photoDocPath?: string;
  selfieDocPath?: string;
  email?: string;
  dob?: string;
}

export interface CreateTripInput {
  rideType: RideType;
  offeredFare: number;
  seats: number;
  passengerGender: Gender;
  pool?: boolean;
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export const api = {
  submitDriverOnboarding: callable<DriverOnboardingInput, { ok: boolean; verificationStatus: string }>(
    'submitDriverOnboarding',
  ),
  createTrip: callable<CreateTripInput, { ok: boolean; tripId: string }>('createTrip'),
  placeBid: callable<{ tripId: string; fare: number }, { ok: boolean; bidId: string }>('placeBid'),
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
};
