/**
 * Typed wrappers around the backend callable functions.
 *
 * The app never writes privileged data (money, roles, trip state) to Firestore
 * directly — the security rules forbid it. Every action goes through one of
 * these callables, which run the server-authoritative logic.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { watchCallable } from '../lib/featureCheck';
import type { Gender, GeoPoint, PaymentMethod, PoolVisibility, RideType, TripStatus } from '../domain/types';
import type { FaceAgreement, FaceChallenge, FaceScanPurpose } from '../domain/faceScan';
import type { CityFareConfig, VehicleCategory } from '../lib/fareEngine';
import type {
  Competitor, CompetitorCategoryRates, MarketComparison,
} from '../lib/marketRates';

/**
 * The rider-facing shape of a market comparison: the comparison itself plus the
 * wording that has to appear beneath it. The disclaimer is not decoration — the
 * competitor figures are estimates from observed fares, and saying so is what
 * keeps the panel honest.
 */
export type MarketComparisonResult = MarketComparison & {
  disclaimer: string;
  undercutPct: number;
};

/**
 * What a safety alert is about. Mirrors EVENT_KINDS in the backend's
 * safety/index.ts — a kind this list has and the backend does not is rejected
 * by its zod schema, so the two move together.
 */
export type SafetyEventKind =
  | 'sos'
  | 'route_deviation'
  | 'police_called'
  | 'harassment'
  | 'accident'
  | 'unsafe_driving'
  | 'scam';

/** Complaint categories. Mirrors SUPPORT_CATEGORIES in the backend's support/types.ts. */
export type SupportCategory =
  | 'safety'
  | 'online_scam'
  | 'payment'
  | 'driver_issue'
  | 'passenger_issue'
  | 'commission'
  | 'account'
  | 'lost_item'
  | 'other';

export type SupportStatus = 'ai_handling' | 'waiting_human' | 'human_handling' | 'resolved';

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
  // Watched here rather than at the call sites. Every callable that carries a
  // promise to a user is timed and classified against what its feature was
  // built to do (src/lib/featureCheck.ts); a call belonging to no feature
  // contract is handed back untouched, so this costs the rest nothing.
  return watchCallable<Req, Res>(name, async (data: Req) => (await fn(stripUndefined(data) as Req)).data);
}

/**
 * One road alert, as the server shapes it for a screen.
 *
 * `alongM`/`offsetM` are present only on route results: how far into the
 * journey the alert sits, and how far off the road it is. Both are metres and
 * both are coarse — see the gazetteer note in the backend. Nothing here ever
 * carries a delay in minutes, because nothing measures one.
 */
export interface TrafficAlertView {
  id: string;
  kind: 'closure' | 'protest' | 'vip_movement' | 'accident' | 'weather' | 'construction' | 'congestion';
  severity: 'high' | 'medium' | 'low';
  headline: string;
  detail: string | null;
  roads: string[];
  cityName: string | null;
  source: { name: string; url: string };
  publishedAt: number;
  /**
   * The hours the story itself gave — "from 2pm to 6pm", "on Sunday". Absent
   * when it gave none, in which case the alert is shown for its kind's usual
   * lifetime and there is no honest time to print.
   */
  when?: { startsAt: number; endsAt: number };
  alongM?: number;
  offsetM?: number;
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
  /**
   * "I am going to the face scan now."
   *
   * This build has a face-scan screen and is about to open it, which tells the
   * backend to store the papers and hold the verdict until the scan lands —
   * documents first, face last, then one decision on all the evidence. Always
   * sent by this app; absent from older builds, which are decided immediately
   * on the uploaded photograph instead.
   */
  withFaceScan?: boolean;
}

/** One car on the driver's account, as the backend hands it back. */
export interface DriverVehicleDto {
  vehicleId: string;
  vehicleType: RideType;
  make: string;
  color: string;
  plate: string;
  label: string;
  photoUrl?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewReason?: string | null;
}

/** A new car, with the two documents that let an admin judge it. */
export interface AddVehicleInput {
  vehicleType: RideType;
  make: string;
  color: string;
  plate: string;
  /** Certificate of registration. */
  docPath: string;
  docUrl?: string;
  /** Front of the car, plate legible. */
  photoPath: string;
  photoUrl?: string;
}

/**
 * Who is actually travelling.
 *
 * The one gender-related thing a client may send, and it names a RELATIONSHIP
 * rather than a gender on purpose: the server derives the seat's gender from
 * the caller's own profile, so a rider can never assert a gender they do not
 * have. 'other' means "a person of the other gender is travelling" — the only
 * answer that changes anything, since a seat for someone of your own gender
 * matches exactly the same rides as a seat for yourself.
 */
export type BookedFor = 'self' | 'other';

/** A named place a rider can be told to wait at, by name. */
export interface PickupPoint {
  /** `velocity:<id>` — our own places registry, never a Google coordinate. */
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  /** How far the rider walks to it, in metres. */
  walkM: number;
  /** Metres it adds to the journey. Negative = it is closer to the destination. */
  detourM: number | null;
}

/** The one fare a shared ride costs, as the server computed it. */
export interface SharedFareQuote {
  /** The whole-car fare. Nobody can move it — not the host, not the driver. */
  fare: number;
  /** What each rider pays at 1, 2, 3 and 4 aboard. */
  perSeat: number[];
  /**
   * The cheapest other app's estimate for this trip, when there is a fresh
   * rate card for the city. Null when there is none — never a guess.
   */
  comparedTo: number | null;
  cityId: string | null;
}

export interface CreateTripInput {
  rideType: RideType;
  /**
   * What the rider offers the driver — SOLO RIDES ONLY.
   *
   * On a shared ride this is ignored by the backend, which prices the ride
   * itself (see `getSharedRideFare`). A shared ride has one fare that nobody
   * can move: a host who could haggle could lose the car for every rider who
   * had already taken a seat in it.
   */
  offeredFare: number;
  seats: number;
  passengerGender: Gender;
  /** Who the seat is for. Omitted means the rider themselves. */
  bookedFor?: BookedFor;
  /**
   * Declares that this build is SHOWING the rider the server's fixed shared
   * fare, so the backend may book at that figure.
   *
   * A capability, not a preference. Builds that predate the fixed fare put a
   * stepper on the sharing card and showed whatever it was set to; the backend
   * never charges such a build more than it displayed. Always send `true` from
   * here — this app reads the fare from `getSharedRideFare`.
   */
  sharedFareFixed?: boolean;
  pool?: boolean;
  /** Pool rides only: public → discoverable nearby, private → link-only. */
  poolVisibility?: PoolVisibility;
  /**
   * Every way the rider is willing to pay, in their order of preference. At
   * least one; the driver sees all of them on the request. `paymentMethod`
   * below is derived from this by the backend and kept only so an older build
   * still books.
   */
  paymentMethods?: PaymentMethod[];
  paymentMethod?: 'cash' | 'wallet';
  preferFemaleDriver?: boolean;
  promoCode?: string;
  pickup: GeoPoint;
  dropoff: GeoPoint;
}

/** One person already in a shared car, as a stranger is allowed to see them. */
export interface PoolCompanion {
  /** First name only. Never a full name, never a uid. */
  firstName: string;
  gender: Gender | string;
  /** How they came to be aboard — 'host' booked it, 'share' joined it. */
  kind?: 'host' | 'share' | 'enroute';
  /**
   * What previous co-riders made of them — the reputation that used to belong
   * only to the driver.
   *
   * Null means "not enough ratings to say", NOT zero: show "New" rather than a
   * number. The backend withholds the average below a threshold so one sour
   * rating cannot brand somebody (see ratings/coRiders), and the count comes
   * through regardless so the screen can say how solid the number is.
   */
  coRiderRating?: number | null;
  coRiderRatingCount?: number;
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
  /** Who is already in the car, by first name and gender. */
  companions: PoolCompanion[];
  maxRiders: number;
  seatsLeft: number;
  perSeatFareNow: number;
  perSeatFareIfYouJoin: number;
  joinable: boolean;
  /** Why this rider cannot join, when the car's gender rules say no. */
  blockedReason?: string | null;
  /**
   * The ride exists but has not settled a fare with a driver yet, so it cannot
   * be joined *yet* — which is a different thing from full or departed, and the
   * invite screen says so rather than showing a dead end.
   */
  awaitingDriver?: boolean;
  /**
   * Still inside the ten minutes in which a driverless pool gathers riders.
   * Joining one of these is instant — there is no driver to ask yet.
   */
  gathering?: boolean;
  /** Epoch-ms the gathering window closes, so the screen can count it down. */
  joinWindowEndsAt?: number | null;
  /** 'pending' | 'rejected' | 'accepted' | 'cancelled' — this rider's own ask. */
  requestStatus?: string | null;
  /** True when Join asks the driver rather than seating the rider outright. */
  needsDriverApproval?: boolean;
  /** Who is driving. Null only while the ride is still awaiting a driver. */
  driverName: string | null;
  driverVehicle: string | null;
  driverPlate: string | null;
  driverRating: number | null;
  alreadyJoined: boolean;
  tripId: string | null;
}

/** One rider waiting on a driver's yes or no for a seat. */
export interface PoolJoinRequest {
  riderId: string;
  riderName: string;
  riderGender: string;
  /** What the driver collects from them if taken on. Fixed by the pool. */
  farePerSeat: number;
  /** Where they get out — pool requests only; null on booking-flow pools. */
  dropoffAreaName?: string | null;
  /**
   * True when the booker is not the passenger. The gender above is then the
   * booker's word rather than a verified profile, which is the one fact that
   * makes this decision different from any other — and the reason the riders
   * already in the car are shown the queue at all.
   */
  bookedForOther?: boolean;
  /** Who answers: the driver, or the host on a ride that has none yet. */
  vetBy?: 'driver' | 'host';
}

/** Which pooling subsystem a suggested seat lives in. */
export type SuggestedRideKind = 'trip' | 'request' | 'ride';

/**
 * One shared car with a seat going spare, in the one shape the Suggested Rides
 * list renders. `kind` decides which join call the screen makes:
 *   'trip'    → joinPoolTrip({ code: id })
 *   'request' → joinPoolRideRequest({ requestId: id })
 *   'ride'    → joinPoolRide({ rideId: id, ... })
 */
export interface SuggestedRide {
  kind: SuggestedRideKind;
  id: string;
  pickupAreaName: string;
  destinationAreaName: string;
  destinationLat: number | null;
  destinationLng: number | null;
  dropRadiusM: number;
  /** What THIS rider pays. Set by whoever started the pool — never negotiable. */
  farePerSeat: number;
  seatsTotal: number;
  seatsLeft: number;
  riders: number;
  males: number;
  females: number;
  genderPref: string;
  distanceKm: number;
  hasDriver: boolean;
  driverName: string | null;
  driverVehicle: string | null;
  companions: PoolCompanion[];
  /** Epoch-ms a driverless pool stops gathering riders. */
  joinWindowEndsAt: number | null;
  /** Epoch-ms this car leaves. Only driver-posted rides are scheduled; null otherwise. */
  departureAtMs: number | null;
  /** Epoch-ms the pool was put up. */
  postedAtMs: number | null;
  /** Epoch-ms a driverless pool request gives up waiting for a driver. */
  expiresAtMs: number | null;
  /** True when Join sends a request to the driver instead of taking the seat. */
  needsDriverApproval: boolean;
  rideType: string | null;
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
  /**
   * Whether a driver has already agreed to carry this ride. False means the
   * pool is still gathering riders and joining is instant.
   */
  hasDriver?: boolean;
  /** Epoch-ms a driverless pool stops gathering. Null once it has a driver. */
  joinWindowEndsAt?: number | null;
  /** True when Join asks the driver rather than seating the rider outright. */
  needsDriverApproval?: boolean;
  /** Who is driving, so the rider is choosing a car and not just a price. */
  driverName?: string | null;
  driverVehicle?: string | null;
  /** Who is already aboard, by first name and gender. */
  companions?: PoolCompanion[];
  /** 'matched' · 'arriving' · 'arrived' — how far along the ride already is. */
  status?: TripStatus;
}

/** One blurred map pin — an opaque key and a coordinate, and nothing else. */
export interface ActivityPin {
  id: string;
  lat: number;
  lng: number;
  distanceKm: number;
  /**
   * Supply pins only: whether that chip is a bike or a car. Optional because the
   * demand dots never carry one, and because a response from an older backend
   * won't either — treat a missing value as a car.
   */
  vehicle?: 'bike' | 'car';
}

/**
 * The live picture around the passenger: cars that are online nearby, and the
 * people who have the app around them.
 *
 * `passengerCount` is everyone with Velocity installed and recently active
 * nearby — the red dots — not only the ones with a ride request open.
 * `waitingCount` is that smaller subset who are actually waiting for a car
 * right now.
 *
 * The counts are the full totals inside the radius, while the arrays are capped
 * at what a map can legibly hold — so read the counts for "how busy is it", not
 * `drivers.length`.
 */
export interface NearbyActivity {
  ok: boolean;
  radiusKm: number;
  driverCount: number;
  /** `driverCount` split by product — bikes and cars are separate answers. */
  bikeCount?: number;
  carCount?: number;
  passengerCount: number;
  waitingCount: number;
  drivers: ActivityPin[];
  passengers: ActivityPin[];
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
  /** A rider already in the car asked for this one by name. */
  askedByRider?: boolean;
  /** Metres off the route, there and back, to collect and drop this one rider. */
  detourM: number;
  pickupOffsetM: number;
  dropToDestM: number;
  alongM: number;
}

/**
 * Somebody standing on the rider's own road, and what taking them does to the
 * rider's fare.
 *
 * Every one of these has already passed, server-side, every gate the DRIVER's
 * feed applies — the corridor, the seats, the gender rules, the fare floor and
 * "the driver must not end up worse off". So the saving shown is one a driver
 * could really be offered, not an arithmetic possibility.
 *
 * Areas, never addresses: a waiting rider is told the car passes F-10 Markaz,
 * never which gate somebody is standing at.
 */
export interface EnRouteCandidateView {
  tripId: string;
  firstName: string;
  seats: number;
  pickupArea: string | null;
  dropoffArea: string | null;
  alongM: number;
  /** Your fare if the driver takes this one person. */
  myFareIfTaken: number;
  /** Theirs, so you can see the car is not subsidising anybody. */
  theirFare: number;
}

/** A co-rider as the people in the car are allowed to see them. */
export interface PoolRiderView {
  uid: string;
  name: string;
  gender: Gender;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  /** Drop-off coordinates, so the driver can navigate to each stop. Driver only. */
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  kind: 'host' | 'share' | 'enroute';
  /**
   * A number to ring when a passenger is not where they said they'd be. Driver
   * only — co-riders never see each other's phone numbers.
   */
  phone?: string | null;
  /**
   * Your own fare. Null for everybody else's — that is theirs, not yours. The
   * driver is the exception: they cannot collect the right cash from the right
   * person without seeing every fare.
   */
  fare: number | null;
  /** Already let out — the driver's remaining-stops list is what is left. */
  droppedOff?: boolean;
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
/**
 * Why someone is being reported. Mirrors REPORT_CATEGORIES in the backend's
 * travelMate/chatModeration.ts — a category the server does not know is
 * rejected by its zod enum, so the two lists have to stay in step.
 */
export type ReportCategory =
  | 'harassment'
  | 'threats'
  | 'sexual'
  | 'spam'
  | 'scam'
  | 'fake_profile'
  | 'underage'
  | 'other';

/** The report sheet's options, in the order they are offered. */
export const REPORT_REASONS: { id: ReportCategory; label: string; hint: string }[] = [
  { id: 'harassment',   label: 'Harassment or bullying', hint: 'Insults, abuse or repeated unwanted messages' },
  { id: 'threats',      label: 'Threats or violence',    hint: 'Threatening harm to someone' },
  { id: 'sexual',       label: 'Sexual or inappropriate', hint: 'Unwanted sexual messages or images' },
  { id: 'spam',         label: 'Spam',                   hint: 'Adverts, links or repeated junk' },
  { id: 'scam',         label: 'Scam or fraud',          hint: 'Asking for money, fake payment requests' },
  { id: 'fake_profile', label: 'Fake profile',           hint: 'Pretending to be someone else' },
  { id: 'underage',     label: 'Under 18',               hint: 'This person appears to be a minor' },
  { id: 'other',        label: 'Something else',         hint: 'Tell us what happened' },
];

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
  /**
   * Google's id — or, on a suggestion from our own map, `velocity:` + its
   * velocityId, so every row has a unique list key and older builds that only send
   * `placeId` still resolve it from our map (backend/functions/src/maps/index.ts).
   */
  placeId: string;
  /**
   * Our id, when this suggestion came from Velocity's own map rather than Google.
   *
   * Set only on our own suggestions, and preferred over `placeId` when resolving.
   * Resolving through it costs nothing and never expires, because the coordinate
   * behind it was measured by our own drivers — see
   * backend/functions/src/locations/registry.ts.
   */
  velocityId?: string;
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
  /**
   * The one callable invoked with no signed-in user: it trades the ID token from a
   * native (Play Integrity attested) phone verification for a custom token the JS
   * SDK can sign in with. See src/auth/phoneSignIn.ts.
   */
  exchangePhoneSession: callable<{ idToken: string }, { customToken: string }>('exchangePhoneSession'),
  /**
   * Sign-in codes over WhatsApp — the cheap channel, tried before Firebase SMS.
   *
   * `startWhatsAppOtp` answers `sent: false` rather than throwing whenever the
   * message could not go out, because the caller has to be free to fall back to
   * SMS; the only throw is the per-number ceiling. See src/auth/phoneSignIn.ts.
   */
  startWhatsAppOtp: callable<
    { phone: string },
    | { sent: true; via: 'whatsapp'; challengeId: string; expiresInSec: number }
    | { sent: false; via: 'sms'; reason: string }
  >('startWhatsAppOtp'),
  verifyWhatsAppOtp: callable<
    { challengeId: string; code: string },
    { customToken: string }
  >('verifyWhatsAppOtp'),
  /**
   * Wakes one sign-in function ahead of need, so the real request does not
   * meet a cold start. Does nothing else. See `warmPhoneSignIn` in
   * src/auth/phoneSignIn.ts.
   */
  warmSignIn: (name: 'startWhatsAppOtp' | 'verifyWhatsAppOtp' | 'exchangePhoneSession') =>
    callable<{ warm: true }, { warm: true }>(name)({ warm: true }),
  claimDriverRole: callable<Record<string, never>, { ok: boolean }>('claimDriverRole'),
  /**
   * Irreversible. Deletes the caller's own account, purges their personal data
   * and anonymises the records other people still need (a driver's trip
   * history, the money ledger). Takes no uid — the backend only ever deletes
   * the caller. Rejects with `failed-precondition` and a readable reason when
   * a ride is still running or money is owed in either direction.
   */
  deleteMyAccount: callable<{ confirm: 'DELETE' }, { ok: boolean }>('deleteMyAccount'),
  submitDriverOnboarding: callable<
    DriverOnboardingInput,
    {
      ok: boolean;
      verificationStatus: string;
      /** `awaiting_face_scan` while the last step is still to do. */
      verification: string;
      /**
       * True when the documents are stored and the engine is deliberately
       * waiting for the face scan. The app goes straight to the camera; the
       * scan itself is what starts the verification.
       */
      needsFaceScan: boolean;
    }
  >('submitDriverOnboarding'),

  // ── The live face scan ────────────────────────────────────────────────────
  /**
   * Begin a face scan and find out which poses to ask for.
   *
   * The poses come from the SERVER, after this call — the applicant cannot
   * know them in advance, which is the whole reason a photograph of a
   * photograph cannot pass. Expires in three minutes; start a new one rather
   * than reusing a stale `scanId`.
   */
  startFaceScan: callable<
    { purpose?: FaceScanPurpose },
    {
      ok: boolean;
      scanId: string;
      purpose: FaceScanPurpose;
      challenges: { challenge: FaceChallenge; prompt: string }[];
      expiresAtMs: number;
      frames: number;
    }
  >('startFaceScan'),
  /**
   * Hand in the captured frames, in the order the poses were asked, and get a
   * verdict back. Single-use: a scan id is spent whether it passes or not.
   */
  submitFaceScan: callable<
    { scanId: string; framePaths: string[] },
    {
      ok: boolean;
      /** Read from the stored scan, never from what the app asked for. */
      purpose: FaceScanPurpose;
      status: 'passed' | 'failed' | 'review';
      message: string;
      /**
       * Whose face it was. For an onboarding scan: both identity documents
       * combined — a `match` means the CNIC and the licence. For a daily check:
       * the comparison against the enrolled face.
       */
      identity: FaceAgreement;
      posesMatched: number;
      posesAsked: number;
      /**
       * Onboarding only: true when this pass has sent the application to the
       * verification engine, so the app can go straight to the status screen.
       */
      submitted?: boolean;
      canRetry: boolean;
    }
  >('submitFaceScan'),

  // ── The driver's cars ─────────────────────────────────────────────────────
  /**
   * Lift the onboarding car into `drivers/{uid}/vehicles` if it isn't there yet.
   *
   * Idempotent and cheap, called when a car screen opens. Drivers approved
   * before this feature existed have their car only in flat fields on the driver
   * document; without this their car list would look empty even though they are
   * plainly driving something.
   */
  ensureDriverVehicles: callable<
    Record<string, never>,
    { ok: boolean; activeVehicleId: string | null; vehicles: DriverVehicleDto[] }
  >('ensureDriverVehicles'),
  /** Register another car. Starts `pending` — an admin has to see its papers. */
  addDriverVehicle: callable<AddVehicleInput, { ok: boolean; vehicleId: string; status: string }>(
    'addDriverVehicle',
  ),
  /**
   * Switch cars. Mirrors the new car onto the driver document, clears the car
   * photo check and drops the driver offline, so the next shift starts with a
   * photo of the car they are actually in.
   */
  setActiveVehicle: callable<{ vehicleId: string }, { ok: boolean; activeVehicleId: string }>(
    'setActiveVehicle',
  ),
  deleteDriverVehicle: callable<{ vehicleId: string }, { ok: boolean }>('deleteDriverVehicle'),
  /**
   * "This is the car I'm driving right now." Satisfies the go-online gate
   * immediately; an admin reviews the picture afterwards.
   */
  confirmVehiclePhoto: callable<
    { photoPath: string; photoUrl?: string },
    { ok: boolean; vehicleId: string; validForDays: number }
  >('confirmVehiclePhoto'),

  createTrip: callable<CreateTripInput, { ok: boolean; tripId: string; shareCode: string | null }>('createTrip'),

  /**
   * What inDrive and Yango would charge for this trip, and what we charge
   * instead. Comes back `available: false` whenever there is no fresh,
   * well-sampled rate card for the city and category — the booking screen shows
   * nothing at all in that case rather than a guess.
   */
  getMarketComparison: callable<
    { cityId: string; category: VehicleCategory; distanceKm: number; durationMin: number },
    MarketComparisonResult
  >('getMarketComparison'),

  /**
   * The rider tells us what another app quoted them. This is what keeps the
   * rate cards true — riders here already open inDrive and Yango to compare
   * before they book, so we ask them what they saw.
   */
  reportCompetitorQuote: callable<
    {
      cityId: string;
      competitor: Competitor;
      category: VehicleCategory;
      quotedFare: number;
      distanceKm: number;
      durationMin: number;
      competitorClass?: string;
    },
    { ok: boolean }
  >('reportCompetitorQuote'),

  adminUpsertMarketRates: callable<
    {
      cityId: string;
      competitor: Competitor;
      category: VehicleCategory;
      rates: Omit<CompetitorCategoryRates, 'verifiedAt'>;
    },
    { ok: boolean; card: CompetitorCategoryRates }
  >('adminUpsertMarketRates'),

  adminDeleteMarketRates: callable<
    { cityId: string; competitor: Competitor; category: VehicleCategory },
    { ok: boolean }
  >('adminDeleteMarketRates'),

  /** Turn the pending rider reports for one tier into a fitted rate card. */
  adminFitMarketRates: callable<
    { cityId: string; competitor: Competitor; category: VehicleCategory; competitorClass?: string },
    { ok: boolean; reason?: string; card?: CompetitorCategoryRates; reportCount: number; needed?: number }
  >('adminFitMarketRates'),

  /** Where we stand against the market, category by category. */
  adminMarketPosition: callable<
    { cityId: string; distanceKm?: number; durationMin?: number },
    {
      cityId: string;
      distanceKm: number;
      durationMin: number;
      undercutPct: number;
      rows: (MarketComparison & { category: VehicleCategory })[];
    }
  >('adminMarketPosition'),

  /**
   * The driver's consent switch for WhatsApp ride alerts.
   *
   * This callable is the only way `optIn` is ever set — the backend refuses to
   * turn it on any other way, because a WhatsApp message nobody asked for is
   * what gets a business number reported and eventually restricted.
   */
  setWhatsAppAlerts: callable<
    { enabled: boolean; phone?: string },
    { ok: boolean; enabled: boolean; number?: string }
  >('setWhatsAppAlerts'),
  // Pool share links — invite codes on booking-flow pool trips
  getPoolTripByCode: callable<{ code: string }, PoolTripByCode>('getPoolTripByCode'),
  /**
   * Take a seat on a pool, or ask its driver for one.
   *
   * `pending: true` means the pool already has a driver and the request is now
   * with them — the rider is NOT in the car until that driver accepts.
   */
  joinPoolTrip: callable<
    { code: string; bookedFor?: BookedFor },
    {
      ok: boolean;
      tripId: string;
      riders: number;
      perSeatFare: number;
      alreadyJoined: boolean;
      pending?: boolean;
      /**
       * Who has to say yes. 'driver' once a driver is carrying the ride;
       * 'host' when there is none and the seat still needs vetting, which
       * happens when it was booked for somebody else.
       */
      vetBy?: 'driver' | 'host' | null;
      bookedForOther?: boolean;
    }
  >('joinPoolTrip'),
  /**
   * Somebody already in the car refuses a passenger who asked to join it.
   *
   * Binding, not advisory: one refusal closes the request. The driver decides
   * who rides in their car, but they are not the person who will be sitting in
   * the back seat, and the case this exists for — a seat booked by one person
   * for another — is exactly where the driver knows least.
   */
  coRiderObjectToPoolJoin: callable<
    { tripId: string; riderId: string },
    { ok: boolean; rejected: boolean }
  >('coRiderObjectToPoolJoin'),
  /**
   * The one fare a shared ride between these two points costs.
   *
   * There is no stepper on a shared ride and no bidding: this is the price.
   * `createTrip` recomputes the same number from the same function when the
   * ride is booked, so what the rider was shown cannot drift from what the
   * driver is offered.
   */
  getSharedRideFare: callable<
    { rideType: RideType; pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } },
    SharedFareQuote
  >('getSharedRideFare'),
  /**
   * How many other riders take this rider's own saved commute, by gender.
   *
   * Counts and area names only — never a uid, a name or an address. This is
   * what lets shared rides form at all at our volume: a commute is matched on
   * RECURRENCE (the same journey declared once) instead of on two strangers
   * happening to be online in the same ten minutes.
   */
  /**
   * Named spots near the rider they could be collected from instead of a raw
   * coordinate. Empty whenever our own places registry has nothing nearby,
   * which is the normal case until a city has traffic — callers fall back to
   * the rider's own position.
   */
  getPickupPoints: callable<
    {
      lat: number; lng: number;
      destLat?: number; destLng?: number;
      walkM?: number;
    },
    { points: PickupPoint[]; maxWalkM: number }
  >('getPickupPoints'),
  /**
   * Stamp this driver's map cell now rather than waiting for the once-a-minute
   * sweep. Called right after going online: until the cell exists the ride
   * broadcast cannot see this driver at all, and that is the worst minute to be
   * invisible. Writes only the cell — `online` stays the app's to write, under
   * the rules that gate it on a live car photo.
   */
  stampDriverCell: callable<
    { lat: number; lng: number },
    { ok: boolean; geohash: string }
  >('stampDriverCell'),
  getCommuteMatches: callable<
    Record<string, never>,
    {
      hasSchedule: boolean;
      total: number;
      males: number;
      females: number;
      destinationAreaName: string | null;
      morningTime: string | null;
      days: { day: string; count: number }[];
      slots: { time: string; destinationAreaName: string; count: number }[];
    }
  >('getCommuteMatches'),
  /** The driver's yes or no on somebody asking for a seat in their pool. */
  driverRespondToPoolJoin: callable<
    { tripId: string; riderId: string; action: 'accept' | 'reject' },
    { ok: boolean; accepted: boolean }
  >('driverRespondToPoolJoin'),
  /** The rider withdraws a seat request the driver has not answered. */
  cancelPoolTripJoinRequest: callable<{ tripId: string }, { ok: boolean }>('cancelPoolTripJoinRequest'),
  /** The queue of riders waiting on this driver's answer. */
  getPoolJoinRequests: callable<
    { tripId: string },
    { requests: PoolJoinRequest[] }
  >('getPoolJoinRequests'),
  /**
   * Every shared car near the caller that still has a seat — pool trips, pool
   * requests and driver-posted rides in one list. Full cars never appear.
   */
  getSuggestedRides: callable<
    {
      lat: number;
      lng: number;
      radiusKm?: number;
      destLat?: number;
      destLng?: number;
      destRadiusKm?: number;
      /**
       * Who the seat is for. 'other' rebuilds the feed for a passenger of the
       * other gender, so a rider booking for a sibling is shown the rides that
       * person can actually share.
       */
      bookedFor?: BookedFor;
    },
    { rides: SuggestedRide[] }
  >('getSuggestedRides'),
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
  // ── Home map activity layer: anonymised cars + waiting-rider dots ─────────
  // Coordinates come back deliberately blurred and carry no identity — enough
  // to answer "is anything moving around me?", never enough to follow anyone.
  getNearbyActivity: callable<
    { lat: number; lng: number; radiusKm?: number },
    NearbyActivity
  >('getNearbyActivity'),
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
    { polyline?: string; driverLat?: number; driverLng?: number; radiusM?: number },
    {
      matches: EnRouteMatch[];
      seatsLeft: number;
      /** The corridor this search used: the driver's choice within the admin maximum. */
      corridorRadiusM?: number;
      /** The widest corridor the driver may choose. */
      maxCorridorRadiusM?: number;
      /** The radius chips to offer, in metres. */
      radiusOptionsM?: number[];
      destRadiusM?: number;
      mode?: 'trip' | 'driver_route';
      walletTrip?: boolean;
    }
  >('getEnRouteMatches'),
  acceptEnRouteRider: callable<
    { tripId: string; polyline?: string; driverLat?: number; driverLng?: number; radiusM?: number },
    {
      ok: boolean;
      carrierTripId: string;
      riderName: string;
      fare: number;
      driverGross: number;
      earnExtra: number;
    }
  >('acceptEnRouteRider'),
  /**
   * The rider's side of the same corridor search: who is on your road, and what
   * your fare becomes if the driver picks them up.
   *
   * Answers an empty list for every ordinary "nothing to show" case — a quiet
   * road, a full car, the feature switched off — so the card simply does not
   * appear rather than the screen showing an error about good news.
   */
  getEnRouteSavings: callable<
    { tripId: string; polyline?: string },
    {
      candidates: EnRouteCandidateView[];
      /** What you are paying now. Null on a trip we cannot price yet. */
      myFareNow: number | null;
      /** What it becomes if the driver takes as many as the car holds. */
      myFareBest: number | null;
      seatsLeft?: number;
      /** False until a driver is on the trip — there is nobody to ask yet. */
      canAsk: boolean;
      ridersAboard?: number;
      full?: boolean;
    }
  >('getEnRouteSavings'),
  /** "Driver, please pick that one up." A nudge; the driver still decides. */
  askDriverEnRoutePickup: callable<
    { tripId: string; candidateTripId: string },
    { ok: boolean; alreadyAsked: boolean }
  >('askDriverEnRoutePickup'),
  getPoolRiders: callable<
    { tripId: string },
    { riders: PoolRiderView[]; yourFare: number | null; driverGross: number | null }
  >('getPoolRiders'),

  /**
   * Let one rider out of a shared car.
   *
   * Answers with how many are still aboard. At zero the ride is over and the
   * client calls completeTrip — this deliberately does not end the trip itself,
   * so the money logic lives in exactly one place.
   */
  dropOffRider: callable<
    { tripId: string; riderUid: string },
    { ok: boolean; remaining: number; fare: number; name: string }
  >('dropOffRider'),

  placeBid: callable<{ tripId: string; fare: number }, { ok: boolean; bidId: string }>('placeBid'),
  raiseTripFare: callable<{ tripId: string; fare: number }, { ok: boolean; offeredFare: number }>(
    'raiseTripFare',
  ),
  acceptBid: callable<{ tripId: string; bidId: string }, { ok: boolean; fare: number; driverId: string }>(
    'acceptBid',
  ),
  /**
   * Send an in-ride chat message.
   *
   * Goes through the backend rather than writing to Firestore directly so the
   * other side actually gets a push — a direct write notified nobody.
   */
  sendTripMessage: callable<{ tripId: string; text: string }, { ok: boolean }>('sendTripMessage'),
  /** Turn down one driver's price. Every other offer stands and the trip stays open. */
  declineBid: callable<{ tripId: string; bidId: string }, { ok: boolean }>('declineBid'),
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
  /**
   * Raise an alert on a live ride.
   *
   * `police_called` is not a cry for help — it is the app reporting that the
   * person on the ride has just dialled 15, so our safety desk learns about it
   * in the same second rather than from a police enquiry days later.
   */
  raiseSafetyEvent: callable<
    {
      tripId: string;
      kind?: SafetyEventKind;
      note?: string;
      location?: { lat: number; lng: number };
    },
    { ok: boolean; eventId: string }
  >('raiseSafetyEvent'),

  // ── Share my ride with my family ─────────────────────────────────────────
  /**
   * Mint a live tracking link for a ride. Returns the same token on repeat
   * calls, so sharing the ride twice does not give the family two URLs.
   */
  createTripWatchLink: callable<
    { tripId: string },
    { ok: boolean; token: string; reused: boolean }
  >('createTripWatchLink'),
  /** Kill a link that went to the wrong chat. Other links keep working. */
  revokeTripWatchLink: callable<{ token: string }, { ok: boolean }>('revokeTripWatchLink'),

  // ── Velocity Rapid Response System ───────────────────────────────────────
  /**
   * File a complaint. The AI answers first; safety and scam reports go straight
   * to a person, and `escalated` says which happened.
   */
  openSupportTicket: callable<
    {
      category: SupportCategory;
      subject: string;
      message: string;
      tripId?: string;
    },
    { ok: boolean; ticketId: string; status: SupportStatus; escalated: boolean }
  >('openSupportTicket'),
  sendSupportMessage: callable<
    { ticketId: string; text: string },
    { ok: boolean; status: SupportStatus; handledBy: 'ai' | 'human' }
  >('sendSupportMessage'),
  /** The explicit "talk to a human" button. */
  requestHumanAgent: callable<
    { ticketId: string; reason?: string },
    { ok: boolean; status: SupportStatus }
  >('requestHumanAgent'),
  markSupportTicketRead: callable<{ ticketId: string }, { ok: boolean }>('markSupportTicketRead'),
  /** "Did that help?" — a no re-opens the ticket for a person. */
  rateSupportResolution: callable<
    { ticketId: string; helpful: boolean },
    { ok: boolean }
  >('rateSupportResolution'),
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
  /**
   * Fund the balance by bank transfer: pay Velocity from any banking app,
   * upload the receipt, and our own OCR engine credits it on the spot. An
   * `approved` result means the money is already in the balance — and
   * `commissionSettled` says how much of a lock it cleared on the way in.
   */
  submitManualTopup: callable<
    { proofPath: string; amount: number; method?: 'easypaisa' | 'jazzcash' | 'bank' },
    {
      ok: boolean;
      topupId: string;
      status: 'approved' | 'rejected' | 'pending_review';
      credited: number;
      commissionSettled?: number;
      message: string;
    }
  >('submitManualTopup'),
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
    { reportedUid: string; matchId?: string | null; reason: string; category?: ReportCategory | null; alsoBlock?: boolean },
    { reportId: string; status: string; blocked: boolean }
  >('reportTravelMateUser'),

  // ── Chat management — leave / block / report ────────────────────────────────
  // Available in Travel Partner 1:1 and group chats. Deliberately absent from
  // the trip chat: you cannot walk out on a driver who is already on the way.
  leaveTravelMateChat: callable<{ matchId: string }, { left: boolean }>('leaveTravelMateChat'),
  leaveTravelMateGroupChat: callable<
    { groupId: string },
    { left: boolean; name: string }
  >('leaveTravelMateGroupChat'),
  reportTravelMateChat: callable<
    {
      scope: 'match' | 'group' | 'profile';
      roomId?: string | null;
      reportedUid: string;
      category?: ReportCategory | null;
      reason?: string | null;
      alsoBlock?: boolean;
    },
    { reportId: string; status: string; blocked: boolean }
  >('reportTravelMateChat'),

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
    {
      booked: boolean;
      /** A pool ride with a driver: the seat is a request the driver answers. */
      pending?: boolean;
      alreadyJoined: boolean;
      tripId: string | null;
      /** Your per-seat fare on a pool ride; null when you ride along on a solo one. */
      farePerSeat?: number | null;
    }
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
  /**
   * 'reject' is a real answer, not a hidden card: it records the refusal and
   * hands the ride to the next driver in the zone queue immediately. Ignoring
   * an offer does the same thing when it lapses, just slower.
   */
  driverRespondToRequest: callable<
    { requestId: string; action: 'accept' | 'reject' | 'counter'; counterFarePerSeat?: number },
    { ok: boolean; status: string }
  >('driverRespondToRequest'),
  leaderRespondToOffer: callable<
    { requestId: string; action: 'accept' | 'reject' },
    { ok: boolean; status: string }
  >('leaderRespondToOffer'),
  /** The driver's yes or no on a rider asking to join the pool they hold. */
  driverRespondToPoolRequestJoin: callable<
    { requestId: string; riderId: string; action: 'accept' | 'reject' },
    { ok: boolean; accepted: boolean }
  >('driverRespondToPoolRequestJoin'),
  /** The queue of riders waiting on this driver's answer, for a pool request. */
  getPoolRequestJoinRequests: callable<
    { requestId: string },
    { requests: PoolJoinRequest[] }
  >('getPoolRequestJoinRequests'),
  joinPoolRideRequest: callable<
    {
      requestId: string;
      // Optional drop-off inside the pool's drop zone; omitted = same destination.
      dropoffLat?: number; dropoffLng?: number; dropoffAreaName?: string;
      /** Who the seat is for. Omitted means the rider themselves. */
      bookedFor?: BookedFor;
    },
    { ok: boolean; farePerSeat: number; pending?: boolean }
  >('joinPoolRideRequest'),
  cancelPoolRideRequest: callable<
    { requestId: string },
    { ok: boolean }
  >('cancelPoolRideRequest'),
  // Ten minutes with no co-rider: leader and driver each say "go" (both needed)
  // or either one cancels.
  respondToPoolGoAnyway: callable<
    { requestId: string; action: 'go' | 'cancel' },
    { ok: boolean; status: string; confirmed: boolean }
  >('respondToPoolGoAnyway'),
  joinPoolRide: callable<
    {
      rideId: string; pickupLat: number; pickupLng: number; pickupAddress: string;
      dropoffAddress: string;
      // Optional drop-off pin — must fall inside the ride's drop zone.
      dropoffLat?: number; dropoffLng?: number;
      /** Who the seat is for. Omitted means the rider themselves. */
      bookedFor?: BookedFor;
    },
    {
      ok: boolean; queued: boolean; waitingSameGender?: number;
      /** True when the seat went to the driver to vet, not into the queue. */
      vetting?: boolean;
    }
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
    { ok: boolean; configured: boolean; predictions: PlacePrediction[]; fromOwnMap?: number }
  >('placesAutocomplete'),
  placeDetails: callable<
    { placeId?: string; velocityId?: string; sessionToken: string },
    { ok: boolean; configured: boolean; detail: PlaceDetail | null; fromOwnMap?: boolean }
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
    {
      recommendedFare: number;
      minAcceptableBid: number;
      suggestedMaxBid: number;
      surgeApplied: number;
      /** Null label = nothing to show. See pricing/peak.ts. */
      peak?: { multiplier: number; label: string | null; maxMultiplier: number };
      fuel?: { note: string | null; pricePkr: number | null; product: 'petrol' | 'diesel' };
    }
  >('getFareEstimate'),
  /**
   * The rate card to price this rider against, with today's fuel price already
   * in it, plus the zone's peak factor and the labels for both.
   *
   * The booking screen used to read `fareConfig/{cityId}` from Firestore and
   * price against that. The stored card is deliberately never fuel-adjusted —
   * the adjustment is derived on read, server-side — so the screen was showing
   * un-adjusted fares while the server charged and validated adjusted ones.
   * This is the one call that closes that gap, and the app keeps doing the
   * arithmetic so switching vehicle class stays instant.
   */
  getFareContext: callable<
    { lat?: number; lng?: number; category?: string; geohash?: string },
    {
      cityId: string;
      config: CityFareConfig;
      peak: { multiplier: number; label: string | null; maxMultiplier: number };
      fuel: { note: string | null; pricePkr: number | null; product: 'petrol' | 'diesel' };
    }
  >('getFareContext'),
  seedFareConfig: callable<Record<string, never>, { seeded: string[] }>('seedFareConfig'),

  // ── Pricing engine ────────────────────────────────────────────────────────
  // The apps cannot read surge/*, pricingZones/* or fuelPrices/* directly —
  // those are closed in firestore.rules, because a zone document carries the
  // area's whole driver queue and a live reading of Velocity's supply. These
  // two callables are the shaped views of it: a rider gets a multiplier and a
  // label, a driver gets their own queue position and nobody else's.
  // ── Road alerts ───────────────────────────────────────────────────────────
  // What is closed, blocked or crashed, read off Pakistani news feeds and
  // filtered hard on the server (backend/functions/src/traffic/classify.ts).
  // `trafficAlerts/*` is closed to clients in firestore.rules because what a
  // rider may see is a city filter and what a driver may see is a route
  // filter, and neither is expressible as a security rule.
  //
  // Pass `polyline` to get `route` as well: the alerts that journey actually
  // runs into, each with how far along it they sit, in driving order.
  getTrafficAlerts: callable<
    { lat: number; lng: number; polyline?: string },
    {
      cityName: string | null;
      city: TrafficAlertView[];
      route: TrafficAlertView[];
    }
  >('getTrafficAlerts'),

  getPricingSnapshot: callable<
    { pickup: { lat: number; lng: number }; category?: string; forDriver?: boolean },
    {
      peak: { multiplier: number; label: string | null; maxMultiplier: number };
      fuel: { note: string | null; pricePkr: number | null; product: 'petrol' | 'diesel' };
    }
  >('getPricingSnapshot'),
  getDriverQueueStatus: callable<
    { location: { lat: number; lng: number } },
    {
      enabled: boolean;
      /** Zero-based; null when this driver is not in the zone's queue yet. */
      rank: number | null;
      position: number | null;
      queueSize: number;
      label: string;
      /** How long after a request appears this driver may bid on it. */
      claimDelayMs: number;
      queuedSince: number | null;
      /** How long they may drop offline without losing their place. */
      graceSec: number;
      openToAllAfterSec: number;
      zone: string;
      queueAgeMs: number | null;
    }
  >('getDriverQueueStatus'),

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

  // ── Find your Customers — business proximity advertising ──────────────────
  getBusinessAdPlans: callable<Record<string, never>, BusinessAdPlans>('getBusinessAdPlans'),
  submitBusinessAdApplication: callable<
    BusinessAdApplicationInput,
    { ok: boolean; status: 'pending'; totalFee: number; monthlyFee: number; adSlots: number }
  >('submitBusinessAdApplication'),
  getBusinessAdDashboard: callable<Record<string, never>, BusinessAdDashboard>(
    'getBusinessAdDashboard',
  ),
  createBusinessAd: callable<
    { creative: BusinessAdCreative },
    { ok: boolean; adId: string; liveAds: number; adSlots: number }
  >('createBusinessAd'),
  updateBusinessAd: callable<
    { adId: string; creative: Partial<BusinessAdCreative> },
    { ok: boolean }
  >('updateBusinessAd'),
  setBusinessAdStatus: callable<
    { adId: string; status: BusinessAdStatus },
    { ok: boolean; status: BusinessAdStatus }
  >('setBusinessAdStatus'),
  /** Called on significant movement while the app is open. Server decides. */
  checkNearbyBusinessAds: callable<
    { lat: number; lng: number },
    { ok: boolean; notified: number; ads: NearbyBusinessAd[] }
  >('checkNearbyBusinessAds'),
  recordBusinessAdClick: callable<{ adId: string }, { ok: boolean; firstView?: boolean }>(
    'recordBusinessAdClick',
  ),
  sendBusinessAdQuery: callable<
    { adId: string; text: string },
    { ok: boolean; queryId: string; isNew: boolean }
  >('sendBusinessAdQuery'),
  replyBusinessAdQuery: callable<{ queryId: string; text: string }, { ok: boolean }>(
    'replyBusinessAdQuery',
  ),
  markBusinessAdQueryRead: callable<{ queryId: string }, { ok: boolean }>('markBusinessAdQueryRead'),
  setBusinessAdQueryBlock: callable<{ queryId: string; blocked: boolean }, { ok: boolean; blocked: boolean }>(
    'setBusinessAdQueryBlock',
  ),
  reportBusinessAdQuery: callable<
    { queryId: string; reason: BusinessAdQueryReportReason; note?: string; block?: boolean },
    { ok: boolean; reportId: string }
  >('reportBusinessAdQuery'),
  /**
   * Sends the mock KFC offer to the CALLER'S OWN phone, so a business owner can
   * see the notification they would be paying for. `delaySeconds` holds it back
   * long enough to close the app first. Reaches nobody else, and is counted in
   * nobody's advertising results.
   */
  sendBusinessAdDemoNotification: callable<
    { delaySeconds?: number },
    { ok: boolean; pushed: boolean; title: string; body: string; imageUrl: string }
  >('sendBusinessAdDemoNotification'),

  // ── Special Rides (Rent-a-Car) ──────────────────────────────────────────────
  submitSpecialRidesApplication: callable<
    {
      carDetails: Record<string, unknown>;
      location: { lat?: number; lng?: number; address: string; city: string };
      pricePerDay: number;
      photos: Array<{ url: string; uploadedAt: number }>;
      documentUrls: { insuranceProof: string; vehicleRegistration: string };
      ownerName: string;
      ownerPhone: string;
      instructions?: string;
    },
    { ok: boolean; applicationId: string; message: string }
  >('submitSpecialRidesApplication'),
  getSpecialRidesDashboard: callable<
    Record<string, never>,
    {
      ok: boolean;
      stage: 'none' | 'pending' | 'rejected' | 'active' | 'suspended';
      applications: Array<Record<string, unknown>>;
      activeListings: Array<Record<string, unknown>>;
      totalBookings?: number;
      totalEarnings?: number;
    }
  >('getSpecialRidesDashboard'),
  getSpecialRidesListings: callable<
    { city?: string; maxPrice?: number; page?: number },
    { ok: boolean; listings: Array<Record<string, unknown>>; total: number; hasMore: boolean }
  >('getSpecialRidesListings'),
  getSpecialRidesListingDetails: callable<
    { listingId: string; hostUid: string },
    { ok: boolean; listing: Record<string, unknown> }
  >('getSpecialRidesListingDetails'),
  updateSpecialRidesApplication: callable<
    { carDetails?: Record<string, unknown>; location?: Record<string, unknown>; pricePerDay?: number },
    { ok: boolean; message: string }
  >('updateSpecialRidesApplication'),
  deleteSpecialRidesListing: callable<
    Record<string, never>,
    { ok: boolean; message: string }
  >('deleteSpecialRidesListing'),
  bookSpecialRidesCar: callable<
    {
      listingId: string;
      hostUid: string;
      pickupDate: number;
      returnDate: number;
      includeDriver: boolean;
    },
    { ok: boolean; bookingId: string; totalPrice: number; message: string }
  >('bookSpecialRidesCar'),
  confirmSpecialRidesBooking: callable<
    { bookingId: string },
    { ok: boolean; message: string }
  >('confirmSpecialRidesBooking'),
  cancelSpecialRidesBooking: callable<
    { bookingId: string; reason?: string },
    { ok: boolean; message: string }
  >('cancelSpecialRidesBooking'),

  // ── Co-rider ratings ──────────────────────────────────────────────────────
  // Riders rating the people they shared the car with. A different relationship
  // from submitRating above, which is the rider↔driver one, and a separate
  // average: see the backend's ratings/coRiders.
  //
  // `coRiderRating` is null when too few people have rated them to show a
  // number — the screen says "New rider", it does not print a zero.
  getCoRiderRatingTargets: callable<
    { tripId: string },
    {
      targets: {
        uid: string;
        firstName: string;
        gender: string;
        alreadyRated: boolean;
        coRiderRating: number | null;
        coRiderRatingCount: number;
      }[];
      /** When the window shuts. Null on a ride with no clock to read. */
      closesAtMs: number | null;
    }
  >('getCoRiderRatingTargets'),
  submitCoRiderRating: callable<
    { tripId: string; targetUid: string; stars: number; comment?: string },
    { ok: boolean }
  >('submitCoRiderRating'),
};

// ── Find your Customers types ────────────────────────────────────────────────

export type BusinessAdStatus = 'active' | 'paused' | 'removed';
export type BusinessAdPlanMonths = 3 | 6 | 12;
export type BusinessAdPaymentMethod = 'bank' | 'easypaisa' | 'jazzcash';

/** Where the advertiser sits: no plan, in the queue, running, or lapsed. */
export type BusinessAdStage =
  | 'none'
  | 'pending'
  | 'rejected'
  | 'resubmit'
  | 'active'
  | 'suspended'
  | 'expired';

export interface BusinessAdTier {
  key: string;
  /** Inclusive ceiling: a 3 km band covers everything up to and including 3 km. */
  maxRadiusKm: number;
  monthlyFee: number;
  /** How many offers may run at once on this band. */
  adSlots: number;
}

export interface BusinessAdPlans {
  ok: boolean;
  tiers: BusinessAdTier[];
  currency: string;
  planMonths: BusinessAdPlanMonths[];
  maxRadiusKm: number;
  notifyCooldownHours: number;
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

export interface BusinessAdCreative {
  title: string;
  businessName: string;
  offerDetails: string;
  imageUrl: string;
}

export interface BusinessAdApplicationInput {
  radiusKm: number;
  months: BusinessAdPlanMonths;
  lat: number;
  lng: number;
  address?: string;
  city: string;
  contactPhone: string;
  creative: BusinessAdCreative;
  paymentProofUrl: string;
  paymentMethod: BusinessAdPaymentMethod;
  paymentReference?: string;
  acceptedTerms: true;
}

export interface BusinessAd extends BusinessAdCreative {
  adId: string;
  status: BusinessAdStatus;
  radiusKm: number;
  /** Pushes sent. Higher than `reach` when people re-enter the radius. */
  notified: number;
  /** Distinct people reached. */
  reach: number;
  /** Offer screen opens — the number that says the push worked. */
  clicks: number;
  /** Distinct people who opened it — "Seen by". */
  viewers: number;
  /** Conversations people started about this offer. */
  queries: number;
  moderationReason: string | null;
  createdAtMs: number | null;
}

export interface BusinessAdDayRow {
  day: string;
  notified: number;
  reach: number;
  clicks: number;
  viewers: number;
  queries: number;
}

/** One anonymous "someone opened your offer" row. Never says who. */
export interface BusinessAdRecentView {
  adId: string;
  adTitle: string;
  atMs: number;
}

/** A customer's conversation with a business about one offer. */
export interface BusinessAdQueryThread {
  queryId: string;
  adId: string;
  ownerUid: string;
  askerUid: string;
  /** First name only. */
  askerName: string;
  adTitle: string;
  businessName: string;
  adImageUrl: string | null;
  lastMessage: string;
  lastFrom: 'customer' | 'business';
  lastMessageAtMs: number | null;
  /** `waiting` = the customer spoke last. */
  status: 'waiting' | 'answered';
  ownerUnread: number;
  askerUnread: number;
  messageCount: number;
  /** The shop stopped this customer writing to it. */
  blockedByBusiness: boolean;
  /** The customer stopped this shop — and its offers. */
  blockedByCustomer: boolean;
  /** Velocity closed the conversation after a report. */
  blockedByAdmin: boolean;
}

export type BusinessAdQueryReportReason = 'spam' | 'abusive' | 'scam' | 'inappropriate' | 'other';

export interface BusinessAdQueryMessage {
  id: string;
  from: 'customer' | 'business';
  text: string;
  createdAtMs: number | null;
}

export interface BusinessAdDashboard {
  ok: boolean;
  stage: BusinessAdStage;
  application: {
    status: string;
    radiusKm: number;
    months: number;
    monthlyFee: number;
    totalFee: number;
    currency: string;
    rejectionReason: string | null;
    draft: BusinessAdCreative | null;
    submittedAtMs: number | null;
  } | null;
  advertiser: {
    businessName: string;
    city: string | null;
    contactPhone: string | null;
    radiusKm: number;
    adSlots: number;
    liveAds: number;
    months: number;
    monthlyFee: number;
    totalFee: number;
    currency: string;
    expiresAtMs: number | null;
    daysLeft: number | null;
    suspensionReason: string | null;
    draft: BusinessAdCreative | null;
    center: { lat: number; lng: number; address: string | null } | null;
  } | null;
  ads: BusinessAd[];
  series: BusinessAdDayRow[];
  totals: {
    notified: number;
    reach: number;
    clicks: number;
    ctr: number;
    /** Distinct people who opened any offer. Optional: older cached payloads lack it. */
    viewers?: number;
    queries?: number;
    /** viewers ÷ reach, as a percentage. */
    seenRate?: number;
  };
  recentViews?: BusinessAdRecentView[];
}

export interface NearbyBusinessAd extends BusinessAdCreative {
  adId: string;
  distanceM: number;
}

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

/** One rider in a pool: first name, what they pay, where they get off. */
export interface PoolMember {
  name: string;
  farePerSeat: number;
  dropoffAreaName: string;
}

export interface NearbyPoolRequest {
  requestId: string;
  pickupAreaName: string;
  destinationAreaName: string;
  proposedFarePerSeat: number;
  /** The fare each rider actually pays (fixed — pools are not negotiable). */
  farePerSeat: number;
  totalSlots: number;
  filledSlots: number;
  slotsAvailable: number;
  genderPref: PoolGenderPref;
  /** Everyone in the pool, leader first, in join order. */
  members: PoolMember[];
  /** farePerSeat × riders currently aboard. */
  totalFare: number;
  /** farePerSeat × totalSlots — what the pool pays if every seat fills. */
  totalFareIfFull: number;
  distanceKm: number;
  /**
   * This ride is offered to THIS driver alone until `offerExpiresAt`, and
   * nobody else can take it in the meantime. False means the offer ladder has
   * finished with it and it is open to every nearby driver, first tap wins.
   */
  exclusive?: boolean;
  /** Epoch ms the exclusive hold ends. Null when there is no hold. */
  offerExpiresAt?: number | null;
  /** The server's own wording for the countdown, when there is one. */
  offerNote?: string | null;
}

export interface NearbyActiveRide {
  type: 'request' | 'ride';
  id: string;
  /** Requests only: 'open' (still finding a driver), 'active' or 'full'. */
  status?: string;
  /** Requests only: whether a driver has already taken this pool. */
  hasDriver?: boolean;
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
  /** Every method the rider will accept when this books itself. */
  paymentMethods?: PaymentMethod[];
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
  /**
   * Book this route for me automatically each morning it runs.
   *
   * The one setting in the app that spends money without the rider opening it
   * that day, so it is off by default. A fresh booking sits at `requested`,
   * where cancelling is free, and the backend switches this off by itself if
   * the rides it books keep getting cancelled.
   */
  autoBook?: boolean;
  /** Which car to auto-book. Bikes cannot be shared, so never 'bike'. */
  autoBookRideType?: RideType;
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
  /** A pool ride seats partners through the pool; a solo ride lets them ride along. */
  pool?: boolean;
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
