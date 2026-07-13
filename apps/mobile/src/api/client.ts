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
  seatsLeft: number;
  perSeatFareIfYouJoin: number;
  distanceKm: number;
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
    { lat: number; lng: number; radiusKm?: number },
    { pools: NearbyPublicPool[] }
  >('getNearbyPublicPoolTrips'),
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
  getPaymentOptions: callable<
    Record<string, never>,
    { ok: boolean; providers: ('jazzcash' | 'easypaisa')[]; mock: boolean; comingSoon?: boolean }
  >('getPaymentOptions'),
  createTopupIntent: callable<
    { amount: number; provider?: 'jazzcash' | 'easypaisa'; phone?: string },
    { ok: boolean; intentId: string; provider: string; redirectUrl: string | null; mock: boolean }
  >('createTopupIntent'),
  mockConfirmTopup: callable<{ intentId: string }, { ok: boolean }>('mockConfirmTopup'),
  requestPayout: callable<
    { amount: number; method?: 'jazzcash' | 'easypaisa' | 'bank'; account?: string },
    { ok: boolean; payoutId: string }
  >('requestPayout'),
  payCommission: callable<Record<string, never>, { ok: boolean; amountPaid: number }>('payCommission'),
  submitCommissionSettlement: callable<
    { proofPath: string; method?: 'easypaisa' | 'jazzcash' | 'bank' },
    { ok: boolean; settlementId: string; status: 'approved' | 'rejected' | 'pending_review'; amountDue: number; reason: string | null }
  >('submitCommissionSettlement'),
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
};

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
