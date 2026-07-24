/**
 * Typed wrappers around the backend callable functions.
 *
 * The app never writes privileged data (money, roles, trip state) to Firestore
 * directly — the security rules forbid it. Every action goes through one of
 * these callables, which run the server-authoritative logic.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import type { Gender, GeoPoint, PoolVisibility, RideType, TripStatus } from '../domain/types';

/**
 * The Firebase callable serializer encodes `undefined` object values as
 * `null` on the wire, which the backend zod schemas reject for `.optional()`
 * fields ("Invalid post data." etc.). Drop undefined keys before sending so
 * optional fields are truly absent.
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value !== null && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

function callable<Req, Res>(name: string): (data: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await fn(stripUndefined(data) as Req)).data;
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
  vehiclePhotoDocPath?: string;
  vehiclePhotoDocUrl?: string;
  extraVehiclePhotoDocPaths?: string[];
  extraVehiclePhotoDocUrls?: string[];
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
  /** Pool rides only: public → discoverable nearby, private → link-only. */
  poolVisibility?: PoolVisibility;
  paymentMethod?: 'cash' | 'wallet';
  preferFemaleDriver?: boolean;
  promoCode?: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

export interface PoolTripByCode {
  code: string;
  status: TripStatus;
  pickupAddress: string;
  dropoffAddress: string;
  rideType: RideType;
  visibility: PoolVisibility;
  hostName: string;
  riders: number;
  males: number;
  females: number;
  maxRiders: number;
  seatsLeft: number;
  perSeatFareNow: number;
  perSeatFareIfYouJoin: number;
  joinable: boolean;
  alreadyJoined: boolean;
  tripId: string | null;
}

export interface NearbyPublicPool {
  code: string;
  pickupAddress: string;
  dropoffAddress: string;
  rideType: RideType;
  riders: number;
  /** Riders already aboard, broken down by gender (names are never exposed). */
  males: number;
  females: number;
  seatsLeft: number;
  perSeatFareIfYouJoin: number;
  distanceKm: number;
  /** A driver has already accepted this pool — it's on the way, not waiting. */
  hasDriver?: boolean;
}

/**
 * A pool request sitting on the driver's route that they are cleared to take:
 * seats, gender rules, the corridor and the fare gate have all already passed on
 * the server. Tapping accept cannot be refused for a reason the card did not show.
 */
export interface EnRouteMatch {
  tripId: string;
  passengerName: string;
  passengerGender: Gender;
  passengerRating: number;
  rideType: RideType;
  seats: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  /** What this rider pays — already cut for sharing the road. */
  fare: number;
  /** What they'd have paid alone, so the driver can see the deal they're giving. */
  soloFare: number;
  offeredFare: number;
  /** What the whole car is worth with them aboard, and what that adds. */
  driverGrossAfter: number;
  driverGrossBefore: number;
  earnExtra: number;
  /** Everyone already in the car — and what taking this rider does to their fare. */
  ridersAfter: { uid: string; name: string; fareNow: number; fareAfter: number }[];
  /** Metres off the route, there and back, to collect and drop this one rider. */
  detourM: number;
  pickupOffsetM: number;
  dropToDestM: number;
  alongM: number;
}

/** A co-rider as the people in the car are allowed to see them. */
export interface PoolRiderView {
  uid: string;
  name: string;
  gender: Gender;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  kind: 'host' | 'share' | 'enroute';
  /** Your own fare. Null for everybody else's — that is theirs, not yours. */
  fare: number | null;
}

/** One chat attachment — a photo or a document uploaded to Velocity storage. */
export interface ChatAttachment {
  url: string;
  name?: string | null;
  size?: number | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * A Travel Partner chat message can carry text and/or exactly one attachment:
 * a photo, a shared GPS location, a phone contact, or a file/document.
 */
export interface TravelMateMessageInput {
  matchId: string;
  text?: string;
  image?: ChatAttachment;
  file?: ChatAttachment;
  location?: { lat: number; lng: number; label?: string | null };
  contact?: { name: string; phone: string };
}

/** Reasons a driver can flag an open ride request with. Mirrors the backend enum. */
export type ReportReason =
  | 'sexual_content'
  | 'advertisement'
  | 'drugs'
  | 'suspicious_activity'
  | 'too_low_price'
  | 'too_long_distance'
  | 'other';

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  sexual_content:      'Sexual content',
  advertisement:       'Advertisement',
  drugs:               'Drugs',
  suspicious_activity: 'Suspicious activity',
  too_low_price:       'Too low price',
  too_long_distance:   'Too long distance',
  other:               'Other',
};

/** One address suggestion from the backend Places proxy. */
export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

/** A resolved place: where it is and what to call it. */
export interface PlaceDetail {
  lat: number;
  lng: number;
  address: string;
}

/** Gateways the backend can send a top-up to. `payfast` fronts several rails. */
export type TopupProvider = 'jazzcash' | 'easypaisa' | 'payfast';

/** What kind of account a saved instrument is. Mirrors the backend enum. */
export type SavedMethodKind = 'easypaisa' | 'jazzcash' | 'card' | 'bank';

/**
 * A connected payment method as the backend returns it. Display data only —
 * the gateway token that can actually charge the account never leaves the
 * server (see backend/functions/src/payments/paymentMethods.ts).
 */
export interface SavedMethodView {
  id: string;
  kind: SavedMethodKind;
  label: string;
  maskedAccount: string | null;
  brand: string | null;
  isDefault: boolean;
  status: 'active' | 'revoked' | 'expired';
  createdAt: number | null;
}

export const api = {
  claimDriverRole: callable<Record<string, never>, { ok: boolean }>('claimDriverRole'),
  submitDriverOnboarding: callable<DriverOnboardingInput, { ok: boolean; verificationStatus: string }>(
    'submitDriverOnboarding',
  ),
  createTrip: callable<CreateTripInput, { ok: boolean; tripId: string; shareCode: string | null }>('createTrip'),
  // Pool share links — invite codes on booking-flow pool trips
  getPoolTripByCode: callable<{ code: string }, PoolTripByCode>('getPoolTripByCode'),
  joinPoolTrip: callable<
    { code: string },
    { ok: boolean; tripId: string; riders: number; perSeatFare: number; alreadyJoined: boolean }
  >('joinPoolTrip'),
  setPoolVisibility: callable<
    { tripId: string; visibility: PoolVisibility },
    { ok: boolean; visibility: PoolVisibility }
  >('setPoolVisibility'),
  getNearbyPublicPoolTrips: callable<
    {
      lat: number;
      lng: number;
      radiusKm?: number;
      destLat?: number;
      destLng?: number;
      destRadiusKm?: number;
    },
    { pools: NearbyPublicPool[] }
  >('getNearbyPublicPoolTrips'),
  // ── En-route pickups: riders on the driver's way ──────────────────────────
  // `polyline` is a FALLBACK, and optional. When the backend has its own Maps key
  // (GOOGLE_MAPS_SERVER_KEY) it fetches the road itself and never looks at ours.
  // Without one it uses ours — but re-derives the corridor's endpoints from
  // Firestore and refuses any polyline that does not actually connect them, so
  // even then the corridor is not a thing the client gets to choose.
  setDriverRoute: callable<
    { origin: GeoPoint; destination: GeoPoint; polyline?: string },
    { ok: boolean; routeLengthM: number; corridorRadiusM: number; destRadiusM: number }
  >('setDriverRoute'),
  endDriverRoute: callable<Record<string, never>, { ok: boolean }>('endDriverRoute'),
  getEnRouteMatches: callable<
    { polyline?: string; driverLat?: number; driverLng?: number },
    {
      matches: EnRouteMatch[];
      seatsLeft: number;
      corridorRadiusM?: number;
      destRadiusM?: number;
      mode?: 'trip' | 'driver_route';
      walletTrip?: boolean;
    }
  >('getEnRouteMatches'),
  acceptEnRouteRider: callable<
    { tripId: string; polyline?: string; driverLat?: number; driverLng?: number },
    {
      ok: boolean;
      carrierTripId: string;
      riderName: string;
      fare: number;
      driverGross: number;
      earnExtra: number;
    }
  >('acceptEnRouteRider'),
  getPoolRiders: callable<
    { tripId: string },
    { riders: PoolRiderView[]; yourFare: number | null; driverGross: number | null }
  >('getPoolRiders'),

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
  cancelTrip: callable<
    { tripId: string; reason?: string },
    // `fee` is 0 when the trip was still searching for a driver. Otherwise it is
    // split into what the wallet balance covered and what is now owed.
    { ok: boolean; fee: number; paidFromWallet: number; outstanding: number }
  >('cancelTrip'),
  completeTrip: callable<{ tripId: string }, { ok: boolean }>('completeTrip'),
  raiseSafetyEvent: callable<
    { tripId: string; kind?: 'sos' | 'route_deviation'; note?: string },
    { ok: boolean; eventId: string }
  >('raiseSafetyEvent'),
  getPaymentOptions: callable<
    Record<string, never>,
    { ok: boolean; providers: TopupProvider[]; mock: boolean; comingSoon?: boolean }
  >('getPaymentOptions'),
  createTopupIntent: callable<
    { amount: number; provider?: TopupProvider; phone?: string },
    { ok: boolean; intentId: string; provider: string; redirectUrl: string | null; mock: boolean }
  >('createTopupIntent'),
  mockConfirmTopup: callable<{ intentId: string }, { ok: boolean }>('mockConfirmTopup'),

  // ── Saved payment methods — connected accounts, inDrive style ─────────────
  getPaymentMethods: callable<
    Record<string, never>,
    {
      ok: boolean;
      comingSoon: boolean;
      methods: SavedMethodView[];
      supportedKinds: SavedMethodKind[];
    }
  >('getPaymentMethods'),
  createPaymentMethodSetup: callable<
    { kind: SavedMethodKind; phone?: string },
    { ok: boolean; setupId: string; redirectUrl: string; mock: boolean }
  >('createPaymentMethodSetup'),
  mockConfirmPaymentMethod: callable<{ setupId: string }, { ok: boolean; methodId: string }>(
    'mockConfirmPaymentMethod',
  ),
  setDefaultPaymentMethod: callable<{ methodId: string }, { ok: boolean }>('setDefaultPaymentMethod'),
  deletePaymentMethod: callable<{ methodId: string }, { ok: boolean }>('deletePaymentMethod'),
  topupWithSavedMethod: callable<
    { methodId: string; amount: number },
    { ok: boolean; intentId: string; amount: number }
  >('topupWithSavedMethod'),
  requestPayout: callable<
    { amount: number; method?: 'jazzcash' | 'easypaisa' | 'bank'; account?: string },
    { ok: boolean; payoutId: string }
  >('requestPayout'),
  payCommission: callable<Record<string, never>, { ok: boolean; amountPaid: number }>('payCommission'),
  submitCommissionSettlement: callable<
    { proofPath: string; method?: 'easypaisa' | 'jazzcash' | 'bank' },
    { ok: boolean; settlementId: string; status: 'approved' | 'rejected' | 'pending_review'; amountDue: number; reason: string | null }
  >('submitCommissionSettlement'),
  submitCancellationFeeSettlement: callable<
    { proofPath: string; method?: 'easypaisa' | 'jazzcash' | 'bank' },
    { ok: boolean; settlementId: string; status: 'approved' | 'rejected' | 'pending_review'; amountDue: number; reason: string | null }
  >('submitCancellationFeeSettlement'),
  adminReviewCommissionSettlement: callable<
    { settlementId: string; approve: boolean; reason?: string },
    { ok: boolean; status: string }
  >('adminReviewCommissionSettlement'),
  submitRating: callable<
    { tripId: string; stars: number; comment?: string; targetRole: 'driver' | 'passenger' },
    { ok: boolean }
  >('submitRating'),
  createDispute: callable<
    { tripId: string; category: 'fare' | 'behaviour' | 'safety' | 'lost_item' | 'other'; description: string },
    { ok: boolean; disputeId: string }
  >('createDispute'),
  reportOpenRequest: callable<
    { tripId: string; reasons: ReportReason[]; description?: string },
    { ok: boolean; reportId: string; alreadyReported: boolean }
  >('reportOpenRequest'),
  startPoolBoarding: callable<
    { rideId: string; driverLat: number; driverLng: number },
    { ok: boolean; pickupOrder: string[] }
  >('startPoolBoarding'),
  poolArrivePassenger: callable<{ rideId: string; passengerId: string }, { ok: boolean }>('poolArrivePassenger'),
  poolPassengerBoarded: callable<{ rideId: string; passengerId: string }, { ok: boolean }>('poolPassengerBoarded'),
  completePoolRide: callable<
    { rideId: string; driverLat?: number; driverLng?: number },
    { ok: boolean }
  >('completePoolRide'),
  registerFcmToken: callable<{ token: string; platform?: 'ios' | 'android' | 'web' }, { ok: boolean }>('registerFcmToken'),

  // ── Travel Partner ──────────────────────────────────────────────────────────────
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

  // ── Travel Partner Phase 3 — social ─────────────────────────────────────────
  sendTravelMateMessage: callable<TravelMateMessageInput, { messageId: string }>(
    'sendTravelMateMessage',
  ),
  reactToTravelMateMessage: callable<
    { matchId: string; messageId: string; emoji: string | null },
    { ok: boolean; cleared: boolean }
  >('reactToTravelMateMessage'),
  unmatchTravelMate: callable<
    { matchId: string },
    { status: string }
  >('unmatchTravelMate'),
  // Message requests — a first message from someone you haven't matched with
  // waits in the recipient's inbox until they answer it.
  acceptTravelMateMessageRequest: callable<
    { matchId: string },
    { accepted: boolean }
  >('acceptTravelMateMessageRequest'),
  declineTravelMateMessageRequest: callable<
    { matchId: string },
    { declined: boolean }
  >('declineTravelMateMessageRequest'),
  reportTravelMateUser: callable<
    { reportedUid: string; matchId?: string; reason: string },
    { reportId: string; status: string }
  >('reportTravelMateUser'),

  // ── Travel Partner Phase 4 — groups ─────────────────────────────────────────
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

  // ── Travel Partner Phase 5 — ride links + group chat + private DMs ──────────
  shareTravelMateRide: callable<
    { tripId: string; groupId?: string },
    { shareId: string; reused: boolean }
  >('shareTravelMateRide'),
  getSharedTravelMateRide: callable<
    { shareId: string },
    SharedTravelMateRideResult
  >('getSharedTravelMateRide'),
  bookSharedTravelMateRide: callable<
    { shareId: string },
    { booked: boolean; alreadyJoined: boolean; tripId: string | null }
  >('bookSharedTravelMateRide'),
  sendTravelMateGroupMessage: callable<
    { groupId: string; text: string },
    { messageId: string }
  >('sendTravelMateGroupMessage'),
  openTravelMateDirectChat: callable<
    { targetUid: string; groupId: string },
    { matchId: string; created: boolean }
  >('openTravelMateDirectChat'),
  previewTravelMateGroup: callable<
    { groupId: string },
    TravelMateGroupPreview
  >('previewTravelMateGroup'),

  // ── Travel Partner Phase 6 — community feed ──────────────────────────────────
  createTravelMatePost: callable<
    { text: string; imageBase64?: string; videoPath?: string; communityId?: string },
    { postId: string; mediaURL: string | null; mediaType: 'image' | 'video' | null }
  >('createTravelMatePost'),
  deleteTravelMatePost: callable<{ postId: string }, { deleted: boolean }>('deleteTravelMatePost'),
  likeTravelMatePost: callable<
    { postId: string },
    { liked: boolean; likeCount: number }
  >('likeTravelMatePost'),
  commentTravelMatePost: callable<
    { postId: string; text: string },
    { commentId: string }
  >('commentTravelMatePost'),
  deleteTravelMateComment: callable<
    { postId: string; commentId: string },
    { deleted: boolean }
  >('deleteTravelMateComment'),
  createTravelMateCommunity: callable<
    { name: string; city: string; description?: string },
    { communityId: string }
  >('createTravelMateCommunity'),
  joinTravelMateCommunity: callable<
    { communityId: string },
    { joined: boolean; alreadyMember: boolean }
  >('joinTravelMateCommunity'),
  leaveTravelMateCommunity: callable<{ communityId: string }, { left: boolean }>('leaveTravelMateCommunity'),
  openTravelMateFeedChat: callable<
    { targetUid: string },
    { matchId: string; created: boolean }
  >('openTravelMateFeedChat'),
  blockTravelMateUser: callable<{ targetUid: string }, { blocked: boolean }>('blockTravelMateUser'),
  unblockTravelMateUser: callable<{ targetUid: string }, { unblocked: boolean }>('unblockTravelMateUser'),
  adminUpdateTravelMatePost: callable<
    { postId: string; text: string },
    { updated: boolean }
  >('adminUpdateTravelMatePost'),
  adminUpsertTravelMateCommunity: callable<
    { communityId?: string; name: string; city: string; description?: string },
    { communityId: string; created: boolean }
  >('adminUpsertTravelMateCommunity'),
  adminDeleteTravelMateCommunity: callable<
    { communityId: string },
    { deleted: boolean; postsDetached: number }
  >('adminDeleteTravelMateCommunity'),

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
    {
      requestId: string;
      // Optional drop-off inside the pool's drop zone; omitted = same destination.
      dropoffLat?: number; dropoffLng?: number; dropoffAreaName?: string;
    },
    { ok: boolean; farePerSeat: number }
  >('joinPoolRideRequest'),
  cancelPoolRideRequest: callable<
    { requestId: string },
    { ok: boolean }
  >('cancelPoolRideRequest'),
  joinPoolRide: callable<
    {
      rideId: string; pickupLat: number; pickupLng: number; pickupAddress: string;
      dropoffAddress: string;
      // Optional drop-off pin — must fall inside the ride's drop zone.
      dropoffLat?: number; dropoffLng?: number;
    },
    { ok: boolean; queued: boolean; waitingSameGender?: number }
  >('joinPoolRide'),
  driverAcceptPoolBatch: callable<
    { rideId: string; gender: 'male' | 'female' },
    { ok: boolean; accepted: number }
  >('driverAcceptPoolBatch'),
  cancelPoolJoinRequest: callable<{ rideId: string }, { ok: boolean }>('cancelPoolJoinRequest'),
  driverBlockPoolPassenger: callable<
    { rideId: string; passengerId: string; reason?: string },
    { ok: boolean }
  >('driverBlockPoolPassenger'),
  reportPoolGenderMisrepresentation: callable<
    { rideId: string; reportedUid: string; note?: string },
    { ok: boolean }
  >('reportPoolGenderMisrepresentation'),

  // ── Nearby active rides — anonymised discovery (Task 2) ───────────────────
  getNearbyPoolRequests: callable<
    { lat: number; lng: number; radiusKm?: number },
    { requests: NearbyPoolRequest[] }
  >('getNearbyPoolRequests'),
  getNearbyActiveRides: callable<
    { lat: number; lng: number; radiusKm?: number },
    { rides: NearbyActiveRide[] }
  >('getNearbyActiveRides'),

  // ── Scheduled rides — auto-booked frequent rides ──────────────────────────
  upsertScheduledRide: callable<ScheduledRideInput, { ok: boolean; scheduleId: string }>('upsertScheduledRide'),
  deleteScheduledRide: callable<{ scheduleId: string }, { ok: boolean }>('deleteScheduledRide'),

  // ── Commute schedule (Task 3) ─────────────────────────────────────────────
  upsertCommuteSchedule: callable<CommuteScheduleInput, { ok: boolean }>('upsertCommuteSchedule'),
  deleteCommuteSchedule: callable<Record<string, never>, { ok: boolean }>('deleteCommuteSchedule'),
  getCommuteDemand: callable<
    { lat: number; lng: number; radiusKm?: number },
    { demand: CommuteDemandSlot[] }
  >('getCommuteDemand'),

  // ── Maps proxy ────────────────────────────────────────────────────────────
  // Places and directions run on the backend with GOOGLE_MAPS_SERVER_KEY. The
  // app deliberately holds no Google key that can spend money: an Android-
  // restricted key cannot authorise a REST call anyway (the native SDK, not
  // fetch, is what proves the package name), and an unrestricted one shipped
  // inside the APK is extractable. `configured: false` means the server key is
  // unset — callers show "search unavailable" rather than failing.
  placesAutocomplete: callable<
    { input: string; sessionToken: string },
    { ok: boolean; configured: boolean; predictions: PlacePrediction[] }
  >('placesAutocomplete'),
  placeDetails: callable<
    { placeId: string; sessionToken: string },
    { ok: boolean; configured: boolean; detail: PlaceDetail | null }
  >('placeDetails'),
  geocodeAddress: callable<
    { text: string },
    { ok: boolean; configured: boolean; detail: PlaceDetail | null }
  >('geocodeAddress'),
  getDirections: callable<
    { origin: { lat: number; lng: number }; destination: { lat: number; lng: number } },
    {
      ok: boolean;
      configured: boolean;
      route: { polyline: string; distanceM: number; durationSec: number } | null;
    }
  >('getDirections'),

  // ── Fare engine ───────────────────────────────────────────────────────────
  getFareEstimate: callable<
    { cityId: string; category: string; distanceKm: number; durationMin: number; geohash?: string },
    { recommendedFare: number; minAcceptableBid: number; suggestedMaxBid: number; surgeApplied: number }
  >('getFareEstimate'),
  seedFareConfig: callable<Record<string, never>, { seeded: string[] }>('seedFareConfig'),

  // ── Intercity travel ──────────────────────────────────────────────────────
  createIntercityBooking: callable<
    { tripId: string; seatsBooked: number; paymentMethod: 'cash' | 'wallet' },
    { ok: boolean; bookingId: string }
  >('createIntercityBooking'),
  cancelIntercityBooking: callable<
    { bookingId: string },
    { ok: boolean }
  >('cancelIntercityBooking'),
  sendIntercityMessage: callable<
    { tripId: string; text: string },
    { ok: boolean; messageId: string }
  >('sendIntercityMessage'),
  adminCreateIntercityTrip: callable<{
    fromCityId: string; fromCityName: string;
    toCityId: string;   toCityName: string;
    departureTime: number;
    estimatedArrivalTime?: number;
    vehicleType: string;
    totalSeats: number;
    farePerSeat: number;
    operatorName?: string;
    pickupPoint?: string;
    dropoffPoint?: string;
    driverName?: string;
    driverPhone?: string;
    plateNumber?: string;
    notes?: string;
  }, { ok: boolean; tripId: string }>('adminCreateIntercityTrip'),
  adminUpdateIntercityTrip: callable<{
    tripId: string;
    status?: string;
    driverName?: string;
    driverPhone?: string;
    plateNumber?: string;
    notes?: string;
    estimatedArrivalTime?: number;
    pickupPoint?: string;
    dropoffPoint?: string;
  }, { ok: boolean }>('adminUpdateIntercityTrip'),
  adminCancelIntercityTrip: callable<
    { tripId: string; reason?: string },
    { ok: boolean; affectedPassengers: number }
  >('adminCancelIntercityTrip'),
  seedIntercityTrips: callable<Record<string, never>, { ok: boolean; seeded: number }>('seedIntercityTrips'),

  // ── CNIC verification — required before any courier order ─────────────────
  submitCnicVerification: callable<
    { cnicNumber: string; fullName: string; frontUrl: string; backUrl: string },
    { ok: boolean; status: CnicStatus }
  >('submitCnicVerification'),
  adminReviewCnicVerification: callable<
    { uid: string; approve: boolean; reason?: string },
    { ok: boolean; status: CnicStatus }
  >('adminReviewCnicVerification'),

  // ── Courier delivery ──────────────────────────────────────────────────────
  createCourierOrder: callable<
    { pickup: string; dropoff: string; packageType: 'document' | 'parcel' | 'box'; offeredFare: number; recipientName: string; recipientPhone: string; instructions?: string },
    { ok: boolean; orderId: string }
  >('createCourierOrder'),
  cancelCourierOrder: callable<{ orderId: string }, { ok: boolean }>('cancelCourierOrder'),
  adminUpdateCourierStatus: callable<
    { orderId: string; status: string; driverName?: string; driverPhone?: string; note?: string },
    { ok: boolean }
  >('adminUpdateCourierStatus'),

  // ── Freight / business delivery ───────────────────────────────────────────
  createFreightRequest: callable<
    { businessName: string; contactPerson: string; contactPhone: string; pickup: string; dropoff: string; priority: string; loadType: string; notes?: string; estimatedQuote: number },
    { ok: boolean; requestId: string }
  >('createFreightRequest'),
  cancelFreightRequest: callable<{ requestId: string }, { ok: boolean }>('cancelFreightRequest'),
  acceptFreightQuote: callable<{ requestId: string }, { ok: boolean }>('acceptFreightQuote'),
  adminUpdateFreightStatus: callable<
    { requestId: string; status: string; finalQuote?: number; adminNote?: string },
    { ok: boolean }
  >('adminUpdateFreightStatus'),

  // ── Admin push notifications ──────────────────────────────────────────────
  adminSendPushNotification: callable<
    { title: string; body: string; type?: string; target?: string },
    { ok: boolean; sent: number }
  >('adminSendPushNotification'),

  // ── Earn with Velocity — the Partner Program ──────────────────────────────
  getPartnerTiers: callable<Record<string, never>, PartnerTiers>('getPartnerTiers'),
  submitPartnerApplication: callable<PartnerApplicationInput, { ok: boolean; status: 'pending' }>(
    'submitPartnerApplication',
  ),
  previewPartnerFleet: callable<
    { code: string },
    { ok: boolean; code: string; partnerName: string; partnerLevel: PartnerLevel; partnerTier: PartnerTier }
  >('previewPartnerFleet'),
  claimPartnerReferral: callable<
    { code: string; deviceId?: string },
    { ok: boolean; type: FleetType; fleetId: string; partnerName: string | null }
  >('claimPartnerReferral'),
  getMyReferral: callable<Record<string, never>, MyReferral>('getMyReferral'),
  getPartnerDashboard: callable<Record<string, never>, PartnerDashboard>('getPartnerDashboard'),
  getPartnerFleetMembers: callable<
    { type: FleetType; limit?: number },
    { ok: boolean; members: FleetMember[] }
  >('getPartnerFleetMembers'),
  getPartnerMemberRides: callable<
    { memberUid: string; limit?: number },
    { ok: boolean; rides: PartnerRide[] }
  >('getPartnerMemberRides'),
  requestPartnerWithdrawal: callable<
    {
      amount: number;
      method: WithdrawalMethod;
      accountName: string;
      accountNumber: string;
      bankName?: string;
    },
    { ok: boolean; requestId: string }
  >('requestPartnerWithdrawal'),
};

// ── Partner Program types ────────────────────────────────────────────────────

export type FleetType = 'driver' | 'passenger';
export type PartnerLevel = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type PartnerTier = 'free' | 'pro';
export type WithdrawalMethod = 'easypaisa' | 'jazzcash' | 'bank';
export type PartnerRideStatus = 'completed' | 'cancelled' | 'scam' | 'fraud';
export type PartnerTxnStatus = 'pending' | 'available' | 'reversed';

export interface TierRates {
  driverFleetRate: number;
  passengerFleetRate: number;
}

/** How long a Pro plan can be bought for, in months. */
export type ProPlanMonths = 3 | 6 | 12;

/** The tier menu + where a Pro applicant sends the fee. Admin-configurable. */
export interface PartnerTiers {
  ok: boolean;
  free: TierRates;
  pro: TierRates;
  /** Pro price per month; the bill is this × the plan length (3, 6 or 12). */
  proMonthlyFee: number;
  proFeeCurrency: string;
  payment: {
    bankName: string | null;
    bankAccountTitle: string | null;
    bankAccount: string | null;
    easypaisaTitle: string | null;
    easypaisaAccount: string | null;
    jazzcashTitle: string | null;
    jazzcashAccount: string | null;
  };
}

export interface MyReferral {
  ok: boolean;
  bound: boolean;
  type: FleetType;
  code?: string;
  partnerName?: string;
  completedRides?: number;
  boundAt?: number | null;
}

/** Which document the applicant's ID photos show. */
export type IdDocType = 'cnic' | 'university_card' | 'driving_license' | 'passport' | 'other';

export interface PartnerApplicationInput {
  tier: PartnerTier;
  fullName: string;
  mobile: string;
  idType: IdDocType;
  /** The number printed on the ID — hyphenated 13 digits when it is a CNIC. */
  cnicNumber: string;
  cnicFrontUrl: string;
  /** Required for a CNIC; other documents may not have a meaningful back. */
  cnicBackUrl?: string;
  city: string;
  /** Pro only — a screenshot of the registration-fee transfer. */
  paymentProofUrl?: string;
  paymentMethod?: WithdrawalMethod;
  paymentReference?: string;
  /** Pro only — plan length bought: 3, 6 or 12 months. */
  proMonths?: ProPlanMonths;
  acceptedTerms: true;
}

/** Today / week / month / lifetime, the four windows every revenue card shows. */
export interface RevenueBuckets {
  today: number;
  week: number;
  month: number;
  lifetime: number;
}

export interface FleetSummary {
  id: string;
  code: string;
  name: string;
  members: number;
}

export interface FleetMember {
  uid: string;
  name: string;
  photoURL: string | null;
  joinedAt: number | null;
  lastRideAt: number | null;
  online: boolean;
  active: boolean;
  completedRides: number;
  flaggedRides: number;
  totalRideValue: number;
  platformCommissionGenerated: number;
  fleetCommissionGenerated: number;
}

export interface PartnerRide {
  id: string;
  tripId: string;
  date: number | null;
  pickup: string | null;
  dropoff: string | null;
  fare: number;
  platformCommission: number;
  fleetCommission: number;
  rideStatus: PartnerRideStatus;
  paymentStatus: PartnerTxnStatus;
  fraudReason: string | null;
}

export interface PartnerDashboard {
  ok: boolean;
  partner: {
    uid: string;
    fullName: string;
    city: string;
    status: 'active' | 'suspended';
    tier: PartnerTier;
    /** The one 5-digit code both fleets share. */
    referralCode: string | null;
    level: PartnerLevel;
    nextLevel: {
      level: PartnerLevel;
      minActiveMembers: number;
      minCompletedRides: number;
      minEarnings: number;
    } | null;
  };
  fleets: { driver: FleetSummary | null; passenger: FleetSummary | null };
  wallet: { balance: number; pending: number; withdrawn: number; lifetimeEarnings: number };
  overview: {
    totalDrivers: number;
    totalPassengers: number;
    completedRides: number;
    flaggedRides: number;
    lifetimeEarnings: number;
    scamRate: number;
    avgCommissionPerRide: number;
  };
  revenue: { combined: RevenueBuckets; driver: RevenueBuckets; passenger: RevenueBuckets };
  rides: { combined: RevenueBuckets; driver: RevenueBuckets; passenger: RevenueBuckets };
  series: { date: string; earnings: number; rides: number }[];
}

// ── CNIC verification ────────────────────────────────────────────────────────

/**
 * Where a passenger stands with identity verification. Only `verified` opens
 * the courier flow; ordinary rides never look at this.
 * `undefined` (no record at all) = never submitted.
 */
export type CnicStatus = 'pending' | 'verified' | 'rejected';

export interface CnicVerification {
  status: CnicStatus;
  cnicNumber?: string;
  fullName?: string;
  rejectionReason?: string | null;
  submittedAt?: { seconds: number };
  reviewedAt?: { seconds: number } | null;
}

// ── Pool ride request / nearby ride types ────────────────────────────────────

export type PoolGenderPref     = 'male_only' | 'female_only' | 'any';
export type GenderComposition  = 'all' | 'male' | 'female' | 'none';
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
  /** Pool destination pin + drop zone — joiner drop-offs must fall inside it. */
  destinationLat?: number | null;
  destinationLng?: number | null;
  dropRadiusM?: number;
  farePerSeat: number;
  totalSlots: number;
  slotsAvailable: number;
  genderPref: PoolGenderPref;
  maleSeats?: number;
  femaleSeats?: number;
  genderComposition?: GenderComposition;
  rideCategory?: string;
  distanceKm: number;
}

export interface ScheduledRideInput {
  scheduleId?: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  rideType: RideType;
  offeredFare: number;
  seats: number;
  passengerGender: Gender;
  paymentMethod?: 'cash' | 'wallet';
  days: CommuteDay[];
  time: string; // HH:MM
  active?: boolean;
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

// ── Travel Partner types ─────────────────────────────────────────────────────────

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

export interface SharedTravelMateRide {
  sharerUid: string;
  sharerInfo: { displayName: string; photoURL: string | null };
  pickupAddress: string;
  dropoffAddress: string;
  rideType: string | null;
  fare: number | null;
  status: 'open' | 'closed';
  groupId: string | null;
  coRiderCount: number;
  maxCoRiders: number;
  coRiderNames: string[];
  tripId: string | null;
}

export type SharedTravelMateRideResult =
  | { ride: SharedTravelMateRide; eligible: true; alreadyJoined: boolean }
  | { ride: SharedTravelMateRide; eligible: false; reason: 'no_profile' | 'not_partner' };

export interface TravelMateGroupPreview {
  group: {
    name: string;
    destinationName: string;
    schedule: { days: TravelMateDay[]; departTime: string } | null;
    memberCount: number;
    maxSize: number;
    status: string;
    memberNames: string[];
  };
  alreadyMember: boolean;
  canJoin: boolean;
  reason: 'member' | 'no_profile' | 'not_partner' | 'ok';
}

// ── Travel Partner community feed types ─────────────────────────────────────────

export interface TMPost {
  id: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string | null;
  text: string;
  mediaType: 'image' | 'video' | null;
  mediaURL: string | null;
  communityId: string | null;
  communityName: string | null;
  communityCity: string | null;
  likeCount: number;
  commentCount: number;
  createdAt?: { seconds: number };
}

export interface TMComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorPhotoURL: string | null;
  text: string;
  createdAt?: { seconds: number };
}

export interface TMCommunity {
  id: string;
  name: string;
  city: string;
  description?: string;
  createdBy: string;
  creatorName?: string;
  members: string[];
  memberCount: number;
  createdAt?: { seconds: number };
  lastPostAt?: { seconds: number } | null;
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
