import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import type { StudioBilling, StudioPlanId } from './studio';

/**
 * The Firebase callable serializer encodes `undefined` object values as `null`
 * on the wire, which the backend zod schemas reject for `.optional()` fields —
 * the caller sees a bare "Invalid request." with no clue which field is at
 * fault. Drop undefined keys before sending so optional fields are truly absent.
 *
 * This bit the Reactivate button on the partners page: reactivating passes no
 * suspension reason, so `reason: undefined` arrived as `reason: null` and
 * failed `z.string().optional()`. Every admin call with an optional field had
 * the same latent bug, hence fixing it here rather than at one call site.
 *
 * Mirrors the identical helper in apps/mobile/src/api/client.ts — keep the two
 * in step.
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

function callable<Req, Res>(name: string, timeout?: number): (data: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name, timeout ? { timeout } : undefined);
  return async (data: Req) => (await fn(stripUndefined(data) as Req)).data;
}

/**
 * For calls the backend allows fifteen minutes: a team run, a render, a post
 * to Instagram that waits for the reel to process. The SDK gives up after 70
 * seconds by default and reports "deadline-exceeded" while the function keeps
 * working — which is how a post that went out looked like an error.
 */
const LONG_CALL_MS = 16 * 60_000;

/** One row of Velocity's own map, as the Locations desk lists it. */
export interface VelocityLocationRow {
  id: string;
  velocityId: string;
  name: string;
  city: string | null;
  aliases: string[];
  /** Google's permanent id for the same place. The one thing we may keep forever. */
  placeId: string | null;
  lat: number;
  lng: number;
  /** Provenance. There is deliberately no Google option. */
  coordSource: 'trip_gps' | 'admin_pin';
  confirmations: number;
  status: 'pending' | 'verified' | 'rejected';
  lastConfirmedAt: number | null;
}

/**
 * One driver's commission position, as the dashboard needs to see it.
 *
 * Derived server-side rather than on this client: `due` is net of credit, and
 * the admin panel computing that for itself is how the panel and the driver's
 * own app end up quoting different numbers for the same money.
 */
export interface DriverCommissionReport {
  settings: {
    rate: number;
    dailyTargetEnabled: boolean;
    dailyTargetRides: number;
    dailyTargetBonus: number;
    dailyTargetWaivesCommission: boolean;
    dailyTargetPoolOnly: boolean;
    dailyTargetMinRideFare: number;
    dailyTargetMinRiders: number;
    dailyTargetMinDayFare: number;
  };
  driver: {
    driverId: string;
    fullName: string | null;
    phone: string | null;
    cycleGrossFare: number;
    cycleCashFare: number;
    /** The Pakistan day the open part of the cycle belongs to, if any. */
    cycleDay: string | null;
    commissionCredit: number;
    commissionCreditEarned: number;
    commissionCreditUsed: number;
    /** Commission the closed days earned, before the bonus. */
    grossDue: number;
    /** How much of it the bonus is covering. */
    creditApplied: number;
    /** What the driver still has to transfer. */
    due: number;
    creditRemaining: number;
    /** Cash from days that have closed — what `grossDue` was charged on. */
    settleableCash: number;
    settleableGross: number;
  };
  days: {
    day: string;
    rides: number;
    poolRides: number;
    qualifyingRides: number;
    grossFare: number;
    cashFare: number;
    riders: number;
    bonusGranted: number;
    waiverGranted: number;
    met: boolean;
  }[];
  credits: {
    id: string;
    type: string;
    amount: number;
    day: string | null;
    reason: string | null;
    createdAt: { seconds: number } | null;
  }[];
}

/** Admin-only backend actions (each guarded by requireAdmin server-side). */
/**
 * What the daily market run did — see backend/functions/src/fare/marketRefresh.ts.
 * One row per city × competitor × vehicle class it considered.
 */
export interface MarketRunRow {
  cityId: string;
  competitor: 'indrive' | 'yango';
  category: 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury';
  outcome:
    | 'no_reports' | 'insufficient_data' | 'poor_fit'
    | 'confirmed' | 'updated' | 'created' | 'rejected_jump';
  reportCount: number;
  previousFare: number | null;
  newFare: number | null;
  movePct: number | null;
  fitError: number | null;
  ageDaysBefore: number | null;
}

export interface MarketRunReport {
  ranAt: number;
  citiesScanned: number;
  reportsConsidered: number;
  rows: MarketRunRow[];
  updated: number;
  confirmed: number;
  wentStale: { cityId: string; competitor: string; category: string; ageDays: number }[];
  degraded: boolean;
}

export const adminApi = {
  // ── Market desk ─────────────────────────────────────────────────────────
  // Competitor rate cards and the undercut rule. Nothing here scrapes anyone:
  // the cards hold fares somebody observed, and the backend refuses one without
  // a source and a sample size.
  adminUpsertMarketRates: callable<
    {
      cityId: string;
      competitor: 'indrive' | 'yango';
      category: 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury';
      rates: {
        base: number; includedKm: number; includedMin: number;
        perKm: number; perMin: number; minFare: number;
        competitorClass: string;
        source: 'ops_survey' | 'rider_reports' | 'published';
        sampleSize: number;
        note?: string;
      };
    },
    { ok: boolean }
  >('adminUpsertMarketRates'),
  adminDeleteMarketRates: callable<
    {
      cityId: string;
      competitor: 'indrive' | 'yango';
      category: 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury';
    },
    { ok: boolean }
  >('adminDeleteMarketRates'),
  adminFitMarketRates: callable<
    {
      cityId: string;
      competitor: 'indrive' | 'yango';
      category: 'moto' | 'rickshaw' | 'mini' | 'ac_car' | 'luxury';
    },
    { ok: boolean; reason?: string; reportCount: number; needed?: number }
  >('adminFitMarketRates'),
  adminMarketPosition: callable<
    { cityId: string; distanceKm?: number; durationMin?: number },
    { cityId: string; distanceKm: number; durationMin: number; undercutPct: number; rows: unknown[] }
  >('adminMarketPosition'),
  /**
   * The daily run that refits every rate card from rider reports, and the
   * report of what it last did. Running it by hand is for the desk — the
   * schedule does this at 05:40 Asia/Karachi without being asked.
   */
  adminRefreshMarketRates: callable<Record<string, never>, { ok: boolean; report: MarketRunReport }>(
    'adminRefreshMarketRates',
  ),
  adminMarketRunReport: callable<Record<string, never>, { ok: boolean; report: MarketRunReport | null }>(
    'adminMarketRunReport',
  ),
  approveDriver: callable<{ driverId: string }, { ok: boolean }>('approveDriver'),
  /**
   * Run the verification engine over one driver again.
   *
   * The same code path the automatic check uses, so an admin pressing this gets
   * the answer the engine would give today — useful after a threshold change,
   * or when a driver swears the document it refused is the right one.
   */
  adminRerunDriverVerification: callable<
    { driverId: string },
    {
      ok: boolean;
      status: 'approved' | 'rejected' | 'review' | 'skipped';
      riskScore: number | null;
      reasons: { code: string; detail: string; severity: 'fatal' | 'major' | 'minor' }[];
    }
  >('adminRerunDriverVerification'),
  /** Read or change the engine's thresholds; omit `patch` to just read them. */
  adminVerificationSettings: callable<
    {
      patch?: {
        mode?: 'full' | 'suggest' | 'off';
        autoApproveMaxRisk?: number;
        autoRejectMinRisk?: number;
        minDaysBeforeExpiry?: number;
        requireHighConfidence?: boolean;
        rejectOnDuplicateCnic?: boolean;
        requireFaceScan?: boolean;
        requireLicenceFaceMatch?: boolean;
        dailyFaceCheckIn?: boolean;
      };
    },
    {
      ok: boolean;
      config: {
        mode: 'full' | 'suggest' | 'off';
        autoApproveMaxRisk: number;
        autoRejectMinRisk: number;
        minDaysBeforeExpiry: number;
        requireHighConfidence: boolean;
        rejectOnDuplicateCnic: boolean;
        /** Approval needs the face on the CNIC *and* on the licence. */
        requireLicenceFaceMatch: boolean;
        requireFaceScan: boolean;
        /** Approved drivers face-check once per Pakistan day before working. */
        dailyFaceCheckIn: boolean;
      };
      /**
       * Whether the engine's own machinery came up — the face networks and the
       * text reader, both local. Replaces `aiConfigured`, which only ever said
       * whether a secret existed; an engine can be perfectly configured and
       * still not be running, and that gap is what once sent every applicant
       * to a human for weeks while looking careful.
       */
      engineReady: boolean;
    }
  >('adminVerificationSettings'),
  rejectDriver: callable<
    { driverId: string; reason?: string; suspend?: boolean; rejectedSections?: string[] },
    { ok: boolean }
  >('rejectDriver'),
  /**
   * Approve or reject a car a driver added after signup. Nothing else lets that
   * car be driven — `setActiveVehicle` refuses anything but an approved one.
   */
  adminReviewDriverVehicle: callable<
    { driverId: string; vehicleId: string; approve: boolean; reason?: string },
    { ok: boolean }
  >('adminReviewDriverVehicle'),
  /**
   * Judge the photo a driver took of the car they are driving. Rejecting takes
   * them offline immediately and forces a new photo before they can go back on.
   */
  adminReviewVehiclePhoto: callable<
    { driverId: string; approve: boolean; reason?: string },
    { ok: boolean }
  >('adminReviewVehiclePhoto'),
  setUserRole: callable<{ targetUid: string; role: 'passenger' | 'driver' | 'admin' }, { ok: boolean }>(
    'setUserRole',
  ),
  resolveSafetyEvent: callable<{ eventId: string; resolution?: string }, { ok: boolean }>(
    'resolveSafetyEvent',
  ),

  // ── Driver rewards ──────────────────────────────────────────────────────
  /**
   * Grant or claw back a driver's commission credit by hand.
   *
   * The manual counterpart to a gateway top-up that does not exist yet: a
   * driver who paid cash at the office, or who is owed a target bonus a bug
   * lost, is made whole here. Negative claws credit back from someone who
   * farmed it. The reason is required and every adjustment is audit-logged.
   */
  adminAdjustCommissionCredit: callable<
    { driverId: string; amount: number; reason: string; notify?: boolean },
    { ok: boolean; applied: number }
  >('adminAdjustCommissionCredit'),
  /** A driver's target days, credit statement and what they owe right now. */
  adminGetDriverCommission: callable<
    { driverId: string; days?: number },
    DriverCommissionReport
  >('adminGetDriverCommission'),

  // ── Velocity Rapid Response ─────────────────────────────────────────────
  replySupportTicket: callable<
    { ticketId: string; text: string; resolve?: boolean },
    { ok: boolean }
  >('adminReplySupportTicket'),
  setSupportTicketStatus: callable<
    {
      ticketId: string;
      status: 'ai_handling' | 'waiting_human' | 'human_handling' | 'resolved';
      priority?: 'normal' | 'high' | 'urgent';
      note?: string;
    },
    { ok: boolean }
  >('adminSetSupportTicketStatus'),
  markPayoutPaid: callable<{ payoutId: string }, { ok: boolean }>('markPayoutPaid'),
  /** A payout that cannot be sent: turned down, and the money returned to the driver's balance. */
  rejectPayout: callable<{ payoutId: string; reason?: string }, { ok: boolean }>('adminRejectPayout'),
  adminCreateDriver: callable<
    {
      fullName: string;
      email: string;
      phone?: string;
      vehicleType: string;
      vehicleLabel: string;
      plate: string;
      cnic?: string;
      franchiseId?: string;
    },
    { ok: boolean; uid: string; passwordResetLink: string | null }
  >('adminCreateDriver'),
  updateDriver: callable<
    {
      driverId: string;
      fullName?: string;
      phone?: string;
      vehicleType?: string;
      vehicleLabel?: string;
      plate?: string;
      cnic?: string;
      franchiseId?: string | null;
    },
    { ok: boolean }
  >('updateDriver'),
  deleteDriver: callable<{ driverId: string }, { ok: boolean }>('deleteDriver'),
  adminCreateFranchise: callable<
    { name: string; ownerName: string; email: string; phone?: string; city?: string },
    { ok: boolean; franchiseId: string }
  >('adminCreateFranchise'),
  adminAssignFranchise: callable<
    { driverId: string; franchiseId: string | null },
    { ok: boolean }
  >('adminAssignFranchise'),
  banPassenger: callable<
    { passengerId: string; banned: boolean },
    { ok: boolean }
  >('banPassenger'),
  adminCreatePassenger: callable<
    { displayName: string; email?: string; phone?: string; gender?: string; password?: string },
    { ok: boolean; uid: string }
  >('adminCreatePassenger'),
  adminUpdatePassenger: callable<
    { passengerId: string; displayName?: string; email?: string; gender?: string; role?: string },
    { ok: boolean }
  >('adminUpdatePassenger'),
  adminDeletePassenger: callable<
    { passengerId: string },
    { ok: boolean }
  >('adminDeletePassenger'),
  resolveDispute: callable<
    { disputeId: string; resolution: string; refundAmount?: number },
    { ok: boolean }
  >('resolveDispute'),
  adminReviewCommissionSettlement: callable<
    { settlementId: string; approve: boolean; reason?: string },
    { ok: boolean; status: string }
  >('adminReviewCommissionSettlement'),

  /**
   * The accounts Velocity receives money into. Merge-writes, so a field left
   * out is kept rather than cleared — pass an empty string to clear one.
   */
  adminSetSettlementAccounts: callable<
    {
      easypaisaNumber?: string;
      jazzcashNumber?: string;
      bankName?: string;
      bankIban?: string;
      accountTitle?: string;
    },
    { ok: boolean }
  >('adminSetSettlementAccounts'),

  /**
   * Decide a bank-transfer top-up our own OCR engine would not credit by
   * itself. `amount` overrides what to credit; leaving it out credits the
   * amount the engine read off the receipt, never the one the driver typed.
   */
  adminReviewManualTopup: callable<
    { topupId: string; approve: boolean; amount?: number; note?: string },
    { ok: boolean; status: 'approved' | 'rejected' | 'reversed'; credited: number; commissionSettled?: number }
  >('adminReviewManualTopup'),

  /** Passenger CNIC verification — the identity gate in front of couriers. */
  adminReviewCnicVerification: callable<
    { uid: string; approve: boolean; reason?: string },
    { ok: boolean; status: 'verified' | 'rejected' }
  >('adminReviewCnicVerification'),

  // ── Locations — Velocity's own map ─────────────────────────────────────────
  // The registry fills itself from completed trips; these are the judgement calls
  // a person has to make. Note what is absent: there is no "create a location at
  // these coordinates" call, because every point in that collection has to be a
  // first-party measurement — a driver's GPS fix or an admin dropping a pin and
  // owning it. See backend/functions/src/locations/registry.ts.
  listLocations: callable<
    {
      status?: 'pending' | 'verified' | 'rejected' | 'all';
      search?: string;
      city?: string;
      limit?: number;
    },
    {
      ok: boolean;
      counts: { pending: number; verified: number; rejected: number };
      locations: VelocityLocationRow[];
    }
  >('adminListVelocityLocations'),
  reviewLocation: callable<
    {
      id: string;
      status?: 'pending' | 'verified' | 'rejected';
      name?: string;
      lat?: number;
      lng?: number;
    },
    { ok: boolean }
  >('adminReviewVelocityLocation'),
  aliasLocation: callable<
    { id: string; alias: string; action?: 'add' | 'remove' },
    { ok: boolean; alias: string }
  >('adminAliasVelocityLocation'),
  mergeLocations: callable<{ keepId: string; mergeId: string }, { ok: boolean }>(
    'adminMergeVelocityLocations',
  ),

  // ── Travel Mate admin ─────────────────────────────────────────────────────
  approveTravelMateSubscription: callable<
    { subscriptionId: string },
    { status: string; uid: string; endAt: string; dailyAllowance: number }
  >('approveTravelMateSubscription'),
  rejectTravelMateSubscription: callable<
    { subscriptionId: string; reason?: string },
    { status: string }
  >('rejectTravelMateSubscription'),
  adminCreateTravelMatePlan: callable<
    { name: string; billingPeriod: 'weekly' | 'yearly'; pricePKR: number; dailyLikeAllowance: number; active?: boolean },
    { ok: boolean; planId: string }
  >('adminCreateTravelMatePlan'),
  adminUpdateTravelMatePlan: callable<
    { planId: string; name?: string; billingPeriod?: 'weekly' | 'yearly'; pricePKR?: number; dailyLikeAllowance?: number; active?: boolean },
    { ok: boolean }
  >('adminUpdateTravelMatePlan'),
  adminDeleteTravelMatePlan: callable<
    { planId: string },
    { ok: boolean }
  >('adminDeleteTravelMatePlan'),
  adminSuspendTravelMateProfile: callable<
    { targetUid: string; reason?: string },
    { ok: boolean }
  >('adminSuspendTravelMateProfile'),
  /**
   * Close a chat report out. Before this the queue could only grow: reports
   * arrived, nothing could resolve them, and the count on the tab measured the
   * age of the product rather than the work waiting.
   */
  adminResolveTravelMateReport: callable<
    { reportId: string; outcome: 'dismissed' | 'warned' | 'suspended' | 'banned'; note?: string | null },
    { ok: boolean; outcome: string }
  >('adminResolveTravelMateReport'),

  // ── Travel Mate community feed admin (full CRUD) ──────────────────────────
  adminUpdateTravelMatePost: callable<
    { postId: string; text: string },
    { updated: boolean }
  >('adminUpdateTravelMatePost'),
  // deleteTravelMatePost / deleteTravelMateComment honour the admin claim
  // server-side, so the dashboard calls the same CFs users do.
  deleteTravelMatePost: callable<{ postId: string }, { deleted: boolean }>('deleteTravelMatePost'),
  deleteTravelMateComment: callable<
    { postId: string; commentId: string },
    { deleted: boolean }
  >('deleteTravelMateComment'),
  adminUpsertTravelMateCommunity: callable<
    { communityId?: string; name: string; city: string; description?: string },
    { communityId: string; created: boolean }
  >('adminUpsertTravelMateCommunity'),
  adminDeleteTravelMateCommunity: callable<
    { communityId: string },
    { deleted: boolean; postsDetached: number }
  >('adminDeleteTravelMateCommunity'),

  // ── Earn with Velocity — the Partner Program ──────────────────────────────
  adminReviewPartnerApplication: callable<
    {
      uid: string;
      decision: 'approve' | 'reject' | 'resubmit';
      reason?: string;
      /** Approve onto a tier — lets an admin let a Pro applicant in as Free when
       * the registration fee never actually landed. */
      tier?: 'free' | 'pro';
    },
    { ok: boolean; status: string; code: string | null }
  >('adminReviewPartnerApplication'),
  adminReviewWithdrawal: callable<
    { requestId: string; decision: 'approve' | 'reject' | 'paid'; reason?: string },
    { ok: boolean }
  >('adminReviewWithdrawal'),
  adminSuspendPartner: callable<
    { partnerId: string; suspended: boolean; reason?: string },
    { ok: boolean }
  >('adminSuspendPartner'),

  // ── Special Rides (rent-a-car) ──────────────────────────────────────────
  // The console used to POST these to /api/admin/special-rides/{approve,reject}.
  // There is no `app/api` directory in this project and never has been, so both
  // buttons answered 404 and reported "Failed to approve" — every car listing
  // ever submitted is still sitting in the queue. Suspend and Reactivate were
  // broken a second way: they wrote to specialRidesListings straight from the
  // browser, and that collection is `allow write: if false`.
  adminReviewSpecialRidesApplication: callable<
    {
      uid: string;
      decision: 'approve' | 'reject' | 'resubmit';
      rejectionReason?: string;
      maxDailyRate?: number;
    },
    { ok: boolean }
  >('adminReviewSpecialRidesApplication'),
  adminSuspendHost: callable<
    { uid: string; suspended: boolean; reason?: string },
    { ok: boolean; message: string }
  >('adminSuspendHost'),
  adminUpdatePartner: callable<
    {
      partnerId: string;
      fullName?: string;
      city?: string;
      mobile?: string;
      tier?: 'free' | 'pro';
    },
    { ok: boolean }
  >('adminUpdatePartner'),
  adminDeletePartner: callable<
    { partnerId: string; reason?: string },
    { ok: boolean; unboundDrivers: number; unboundPassengers: number }
  >('adminDeletePartner'),
  adminMarkRideStatus: callable<
    { tripId: string; status: 'completed' | 'cancelled' | 'scam' | 'fraud'; reason?: string },
    { ok: boolean; status: string; rows: number }
  >('adminMarkRideStatus'),
  adminReassignReferral: callable<
    { uid: string; type: 'driver' | 'passenger'; fleetId?: string | null; reason?: string },
    { ok: boolean }
  >('adminReassignReferral'),

  // ── Advertise — "Find your Customers" business proximity ads ───────────────
  adminReviewBusinessAdApplication: callable<
    {
      uid: string;
      decision: 'approve' | 'reject' | 'resubmit';
      reason?: string;
      /** Approve onto a different radius/plan than asked for — e.g. the transfer
       * that landed only covers the cheaper band. */
      radiusKm?: number;
      months?: 3 | 6 | 12;
    },
    { ok: boolean; status: string }
  >('adminReviewBusinessAdApplication'),
  adminSetBusinessAdStatus: callable<
    { adId: string; status: 'active' | 'paused' | 'removed'; reason?: string },
    { ok: boolean; status: string }
  >('adminSetBusinessAdStatus'),
  adminSuspendAdvertiser: callable<
    { uid: string; suspended: boolean; reason?: string },
    { ok: boolean }
  >('adminSuspendAdvertiser'),
  adminListDriverSubmissions: callable<
    { status?: 'pending' | 'approved' | 'rejected'; limit?: number },
    { ok: boolean; submissions: Record<string, unknown>[] }
  >('adminListDriverSubmissions'),
  adminReviewDriverSubmission: callable<
    { submissionId: string; decision: 'approve' | 'reject'; reason?: string },
    { ok: boolean; status: string; driverUid?: string; fleetBound?: boolean }
  >('adminReviewDriverSubmission'),
  adminRotatePartnerPortal: callable<
    { uid: string; reason?: string },
    { ok: boolean; portalId: string }
  >('adminRotatePartnerPortal'),
  adminUpdateBusinessAdSettings: callable<
    {
      tiers?: { key: string; maxRadiusKm: number; monthlyFee: number; adSlots: number }[];
      currency?: string;
      notifyCooldownHours?: number;
      maxNotifPerUserPerDay?: number;
      payment?: Record<string, string | null>;
    },
    { ok: boolean }
  >('adminUpdateBusinessAdSettings'),
  adminResolveBusinessAdQueryReport: callable<
    { reportId: string; action: 'dismiss' | 'block' | 'unblock'; note?: string },
    { ok: boolean }
  >('adminResolveBusinessAdQueryReport'),
  adminBackfillBusinessAdViewers: callable<
    Record<string, never>,
    { ok: boolean; scanned: number; stamped: number; ads: number; viewers: number }
  >('adminBackfillBusinessAdViewers'),

  // ── The ride record ──────────────────────────────────────────────────────
  // Every trip the platform has run, and the full file on any one of them.
  // See backend/functions/src/admin/rideHistory.ts — in particular why only one
  // equality filter reaches Firestore and the rest are applied in memory.
  adminListRides: callable<RideHistoryFilters, RideHistoryPage>('adminListRides'),
  adminGetRideDetail: callable<{ tripId: string }, RideDetail>('adminGetRideDetail'),
  adminForceEndTrip: callable<{ tripId: string; reason: string }, { ok: boolean }>('adminForceEndTrip'),
  adminSearchRideParties: callable<
    { term: string },
    { people: RideParty[] }
  >('adminSearchRideParties'),
};

/** What the ride ledger can be narrowed by. Every field is optional. */
export interface RideHistoryFilters {
  driverId?: string;
  passengerId?: string;
  riderId?: string;
  status?: string;
  pool?: boolean;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  beforeMs?: number;
}

/** One row of the ledger. Names and plate are as they were ON THE DAY. */
export interface RideHistoryRow {
  id: string;
  status: string | null;
  rideType: string | null;
  pool: boolean;
  driverId: string | null;
  driverName: string | null;
  plate: string | null;
  passengerId: string | null;
  passengerName: string | null;
  riders: number;
  riderNames: string[];
  pickupAddress: string | null;
  dropoffAddress: string | null;
  fare: number | null;
  grossFare: number | null;
  commission: number | null;
  driverPayout: number | null;
  paymentMethod: string | null;
  createdAtMs: number | null;
  completedAtMs: number | null;
  cancelledByRole: string | null;
  hasSafetyEvent: boolean;
  disputed: boolean;
}

export interface RideHistoryPage {
  rides: RideHistoryRow[];
  /** Feed back as `beforeMs` for the next page; null when the list is done. */
  nextBeforeMs: number | null;
  /**
   * Filters that could not be pushed into a Firestore index and were applied
   * over the page instead. Shown in the UI because it explains why a page can
   * come back shorter than the limit asked for.
   */
  filteredInCode: string[];
  scanned: number;
  /**
   * False when the result is a capped snapshot rather than a page. The rider
   * view merges two queries (rides booked + rides joined) and so has no single
   * cursor to carry; it answers the most recent RIDER_MODE_CAP instead.
   */
  pageable: boolean;
}

/** One person on a ride, by full identity. Admin-only, by definition. */
export interface RideRiderFile {
  uid: string;
  name: string | null;
  phone: string | null;
  gender: string | null;
  cnic: string | null;
  accountCreatedMs: number | null;
  banned: boolean;
  /** What drivers make of them. */
  driverGivenRating: number | null;
  driverGivenRatingCount: number;
  /** What fellow riders make of them — anonymous everywhere but here. */
  coRiderRating: number | null;
  coRiderRatingCount: number;
  fareOnThisRide: number | null;
}

export interface RideDetail {
  ride: {
    id: string;
    status: string | null;
    rideType: string | null;
    pool: boolean;
    poolVisibility: string | null;
    seats: number | null;
    pickup: { lat?: number; lng?: number; address?: string } | null;
    dropoff: { lat?: number; lng?: number; address?: string } | null;
    route: string | null;
    lastDriverLocation: { lat: number; lng: number } | null;
    lastDriverLocationMs: number | null;
    mergedIntoTripId: string | null;
  };
  timeline: {
    requestedMs: number | null;
    arrivedMs: number | null;
    startedMs: number | null;
    completedMs: number | null;
    cancelledMs: number | null;
    lastWriteMs: number | null;
  };
  driver: {
    uid: string;
    nameAtRide: string | null;
    plateAtRide: string | null;
    vehicleAtRide: string | null;
    phoneAtRide: string | null;
    nameNow: string | null;
    phoneNow: string | null;
    cnic: string | null;
    licenseNumber: string | null;
    plateNow: string | null;
    vehicleNow: string | null;
    verificationStatusNow: string | null;
    ratingNow: number | null;
    ratingCountNow: number;
  } | null;
  riders: RideRiderFile[];
  money: {
    offeredFare: number | null;
    fare: number | null;
    paymentMethod: string | null;
    paymentMethods: string[] | null;
    settlement: {
      grossFare: number;
      commission: number;
      driverPayout: number;
      passengerShare: number;
      seats: number;
    } | null;
    perSeatFare: number | null;
    poolFares: Record<string, number> | null;
    cancellationFee: { amount: number; rate: number; role: string } | null;
    cancelledBy: string | null;
    cancelledByRole: string | null;
    cancelReason: string | null;
  };
  ratings: {
    id: string;
    targetRole: string | null;
    raterId: string | null;
    targetUid: string | null;
    stars: number | null;
    comment: string | null;
    createdAtMs: number | null;
  }[];
  safetyEvents: {
    id: string;
    kind: string | null;
    critical: boolean;
    status: string | null;
    reportedBy: string | null;
    reportedByRole: string | null;
    location: { lat: number; lng: number } | null;
    note: string | null;
    createdAtMs: number | null;
  }[];
  disputes: {
    id: string;
    status: string | null;
    reason: string | null;
    raisedBy: string | null;
    resolution: string | null;
    createdAtMs: number | null;
  }[];
}

/** A driver or rider found by phone or name, for the ledger's filter. */
export interface RideParty {
  uid: string;
  name: string | null;
  phone: string | null;
  role: string;
  gender: string | null;
  banned: boolean;
}

/* ── franchise portal ─────────────────────────────────────────────────────
 * Called from the Pro partner's own web portal, not from the admin console.
 * Each is guarded server-side by `requirePortalOwner`, which re-derives
 * ownership from the signed-in uid — the portalId in the payload is a claim,
 * never a credential.
 * ------------------------------------------------------------------------- */

export interface PortalSubmission {
  id: string;
  fullName: string;
  phone: string;
  vehicleType: string;
  vehicleLabel: string;
  plate: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
  fleetBound: boolean;
  createdAt: { seconds: number } | null;
  reviewedAt: { seconds: number } | null;
}

export interface PortalPayload {
  ok: boolean;
  partner: {
    uid: string;
    fullName: string | null;
    city: string | null;
    mobile: string | null;
    tier: string;
    level: string;
    referralCode: string | null;
    portalId: string;
    totalDrivers: number;
    totalPassengers: number;
    completedRides: number;
    lifetimeEarnings: number;
  };
  wallet: { balance: number; pending: number; withdrawn: number; currency: string } | null;
  submissions: { pending: number; approved: number; rejected: number };
}

export interface PortalDriverInput {
  portalId: string;
  fullName: string;
  phone: string;
  email?: string;
  cnic: string;
  licenseNumber?: string;
  vehicleType: string;
  vehicleLabel: string;
  plate: string;
  vehicleYear?: number;
  vehicleColor?: string;
  notes?: string;
}

export const portalApi = {
  getPortal: callable<{ portalId: string }, PortalPayload>('getFranchisePortal'),
  listDrivers: callable<
    { portalId: string; status?: string; limit?: number },
    { ok: boolean; drivers: PortalSubmission[] }
  >('franchiseListDrivers'),
  submitDriver: callable<PortalDriverInput, { ok: boolean; submissionId: string; status: string }>(
    'franchiseSubmitDriver',
  ),
  withdrawSubmission: callable<{ portalId: string; submissionId: string }, { ok: boolean }>(
    'franchiseWithdrawSubmission',
  ),
};

// ── Dashboard analytics ─────────────────────────────────────────────────────

/** One Pakistan day of platform activity. Mirrors DailyStats on the backend. */
export interface DailyStats {
  date: string;
  tripsRequested: number;
  tripsCompleted: number;
  tripsCancelled: number;
  tripsPooled: number;
  revenue: number;
  commission: number;
  driverPayout: number;
  cashTrips: number;
  walletTrips: number;
  byRideType: Record<string, number>;
  intercity: number;
  couriers: number;
  freight: number;
  specialRides: number;
  scheduled: number;
  newPassengers: number;
  newDrivers: number;
}

export interface AnalyticsPayload {
  days: number;
  series: DailyStats[];
  totals: {
    revenue: number;
    commission: number;
    driverPayout: number;
    tripsCompleted: number;
    tripsRequested: number;
    tripsCancelled: number;
    newPassengers: number;
    newDrivers: number;
  };
  snapshot: {
    driversPending: number;
    driversApproved: number;
    driversSuspended: number;
    passengers: number;
    activeTrips: number;
    openDisputes: number;
    cnicPending: number;
    payoutsPending: number;
  };
  generatedAt: number;
}

export const analyticsApi = {
  get: callable<{ days?: number }, AnalyticsPayload>('adminGetAnalytics'),
};

// ── Cost of Velocity ────────────────────────────────────────────────────────

/** What one refresh run found, per vendor. Mirrors backend costs/index.ts. */
export interface CostRefreshOutcome {
  /** The month every fetched amount covers — `2026-07`. */
  window: string;
  fetchedAt: number;
  sources: Record<
    'googleCloud' | 'anthropic' | 'meta',
    { state: 'ok' | 'not-configured' | 'error'; detail?: string; lines?: number; unmapped?: string[] }
  >;
  lines: number;
}

export const costsApi = {
  /** Pull last month's spend from Google Cloud, Anthropic and Meta, now. */
  refresh: callable<Record<string, never>, CostRefreshOutcome>('adminRefreshPlatformCosts'),
};

// ── Pricing engine ──────────────────────────────────────────────────────────
// Fuel-linked per-km rates, the capped peak factor, the manufactured-scarcity
// detector and the FIFO driver queue. Backend: backend/functions/src/pricing.

/** A believed pump price and how well corroborated it is. */
export interface FuelPriceRow {
  product: 'petrol' | 'diesel';
  pricePkr: number | null;
  effectiveDate: string | null;
  /** Days since it was confirmed. Null when there is no price at all. */
  ageDays: number | null;
  /** How many independent sources agreed. One means somebody typed it in. */
  confirmations: number;
  sources: string[];
}

/** One zone's live state, as the desk lists it. */
export interface PricingZoneRow {
  key: string;
  cityId?: string;
  zone?: string;
  multiplier: number;
  onlineDrivers: number;
  availableDrivers: number;
  openRequests: number;
  queueSize: number;
  /** True while a suspected walk-out is holding the factor down. */
  frozen: boolean;
  reason: string;
  explanation: string | null;
  shock: string | null;
  suspicious: boolean;
  updatedAt?: number;
}

export interface PricingEngineSettings {
  fuel: {
    enabled: boolean;
    baseline: { petrol: number; diesel: number };
    agreementTolerance: number;
    minConfirmations: number;
    maxStepPct: number;
    maxAgeDays: number;
    maxAdjustmentPct: number;
  };
  peak: {
    enabled: boolean;
    maxMultiplier: number;
    minMultiplier: number;
    rampUpPerTick: number;
    rampDownPerTick: number;
    bands: { ratio: number; multiplier: number }[];
    minActivity: number;
    zonePrecision: number;
    staleAfterSec: number;
  };
  integrity: {
    enabled: boolean;
    dropPct: number;
    lookbackSec: number;
    maxSuddenSamples: number;
    freezeMinutes: number;
    returnWindowSec: number;
    maxCyclesPerHour: number;
    minSupplyForShock: number;
  };
  queue: {
    enabled: boolean;
    tierSize: number;
    tierSeconds: number;
    openToAllAfterSec: number;
    graceSec: number;
  };
  updatedAt: number;
  updatedBy?: string;
}

export interface PricingDashboard {
  config: PricingEngineSettings;
  defaults: PricingEngineSettings;
  fuel: {
    prices: FuelPriceRow[];
    baseline: { petrol: number; diesel: number };
    stale: boolean;
  };
  zones: PricingZoneRow[];
  summary: {
    zonesTracked: number;
    surging: number;
    frozen: number;
    flaggedDrivers: number;
  };
  flaggedDrivers: {
    driverId: string;
    cyclesLastHour?: number;
    lastOpportunisticReturnAt?: number;
    updatedAt?: number;
  }[];
}

/** What one fuel run saw, source by source. The audit trail for a price move. */
export interface FuelRunReport {
  ranAt: number;
  sources: { sourceId: string; rows: number; error?: string }[];
  products: {
    product: 'petrol' | 'diesel';
    pricePkr: number | null;
    previousPkr: number | null;
    confirmations: number;
    rejection?: string;
    stepLimited?: boolean;
    observed: { sourceId: string; pricePkr: number }[];
  }[];
  changed: boolean;
  /** True when no product could be confirmed — the state worth acting on. */
  degraded: boolean;
}

/** Settings are sent as a partial: anything omitted keeps its current value. */
export type PricingSettingsPatch = {
  fuel?: Partial<PricingEngineSettings['fuel']>;
  peak?: Partial<PricingEngineSettings['peak']>;
  integrity?: Partial<PricingEngineSettings['integrity']>;
  queue?: Partial<PricingEngineSettings['queue']>;
};

export const pricingApi = {
  dashboard: callable<Record<string, never>, PricingDashboard>('adminGetPricingEngine'),
  update: callable<PricingSettingsPatch, { config: PricingEngineSettings }>('adminUpdatePricingEngine'),
  /** Ask the fuel mirrors now, and see exactly what each one said. */
  refreshFuel: callable<Record<string, never>, { report: FuelRunReport }>('adminRefreshFuelPrices'),
  /** Run the minute tick now — for watching a settings change land. */
  runTick: callable<
    Record<string, never>,
    {
      report: {
        ranAt: number;
        zonesConsidered: number;
        zonesPriced: number;
        surging: number;
        frozen: number;
        joined: number;
        forfeited: number;
        truncated: boolean;
      };
    }
  >('adminRunPricingTick'),
  /** The escape hatch for the day both mirrors are wrong. */
  setFuelPrice: callable<
    { product: 'petrol' | 'diesel'; pricePkr: number; effectiveDate: string },
    { price: FuelPriceRow }
  >('adminSetFuelPrice'),
  /** Release a freeze the detector got wrong — a cordon, a power cut. */
  clearFreeze: callable<{ zoneKey: string }, { cleared: string }>('adminClearSupplyFreeze'),
  seed: callable<Record<string, never>, { seeded: boolean }>('seedPricingEngine'),
};

// ── Social desk ─────────────────────────────────────────────────────────────

export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'threads',
  'x',
  'linkedin',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_FORMATS = ['reel', 'video', 'carousel', 'post', 'story'] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];

/** The jobs you can hire for. Mirrors ROLES in the backend's social/types.ts. */
export const SOCIAL_ROLES = [
  'research-assistant',
  'content-writer',
  'seo-expert',
  'google-seo-expert',
  'designer',
  'video-editor',
  'youtube-ads-expert',
  'social-manager',
] as const;
export type SocialRole = (typeof SOCIAL_ROLES)[number];

/** The stages of one piece, in the order they happen. */
export const SOCIAL_STAGES = [
  'research',
  'seo',
  'script',
  'search',
  'design',
  'video',
  'ads',
  'distribute',
] as const;
export type SocialStage = (typeof SOCIAL_STAGES)[number];

/** Which networks take which formats. Mirrors PLATFORM_FORMATS on the backend. */
export const PLATFORM_FORMATS: Record<SocialPlatform, SocialFormat[]> = {
  facebook: ['reel', 'video', 'carousel', 'post', 'story'],
  instagram: ['reel', 'carousel', 'post', 'story'],
  youtube: ['reel', 'video'],
  tiktok: ['reel', 'video'],
  threads: ['reel', 'post', 'carousel'],
  x: ['post'],
  linkedin: ['post'],
};

export function platformTakes(platform: SocialPlatform, format: SocialFormat): boolean {
  return PLATFORM_FORMATS[platform].includes(format);
}

/** Which stages a format actually runs. */
export const FORMAT_STAGES: Record<SocialFormat, SocialStage[]> = {
  reel: [...SOCIAL_STAGES],
  video: [...SOCIAL_STAGES],
  carousel: ['research', 'seo', 'script', 'search', 'design', 'distribute'],
  post: ['research', 'seo', 'script', 'search', 'design', 'distribute'],
  story: ['research', 'seo', 'script', 'search', 'design', 'distribute'],
};

/** The console-visible half of a connection (never the token itself). */
export interface SocialAccountDoc {
  platform: SocialPlatform;
  status: 'connected' | 'error' | 'disconnected';
  displayName?: string;
  handle?: string | null;
  externalId?: string;
  followers?: number | null;
  avatarUrl?: string | null;
  canPublishVideo?: boolean;
  tokenHint?: string | null;
  lastError?: string | null;
  connectedBy?: string | null;
}

export interface ConnectField {
  key: 'accessToken' | 'externalId' | 'clientId' | 'clientSecret';
  label: string;
  hint: string;
  secret: boolean;
}

export interface ConnectSchema {
  vaultReady: boolean;
  platforms: {
    platform: SocialPlatform;
    label: string;
    canPublishVideo: boolean;
    fields: ConnectField[];
  }[];
}

// ── the staff ───────────────────────────────────────────────────────────────

export interface SocialEmployee {
  id: string;
  name: string;
  role: SocialRole;
  title: string;
  status: 'active' | 'off_duty';
  instructions: string;
  colour: string;
  hiredAtMs: number;
  hiredBy: string | null;
  lastWorkedAtMs: number | null;
  piecesWorked: number;
}

export interface SocialRoleOption {
  role: SocialRole;
  label: string;
  blurb: string;
  stage: SocialStage;
  titles: string[];
}

export interface SocialTeamMemberRef {
  id: string;
  name: string;
  role: SocialRole;
  title: string;
}

export interface SocialWorkEntry {
  stage: SocialStage;
  employeeId: string | null;
  name: string;
  role: SocialRole | null;
  state: 'working' | 'done' | 'briefed' | 'skipped' | 'failed';
  note: string | null;
  error: string | null;
  startedAtMs: number | null;
  finishedAtMs: number | null;
}

export interface SocialCompetitor {
  name: string;
  url: string;
  /** Their Instagram username, read every morning with its real numbers. */
  instagram?: string;
}

/**
 * The long brief — what the team is told once and reads forever.
 *
 * Five boxes rather than one, because the five go to different people: the
 * inbox does not need to know what you think travels, and the designer does
 * not need your rules for answering a complaint.
 */
export interface SocialBrief {
  /** Who we are and what matters. Everyone reads this. */
  about: string;
  /** What a good post looks like to you. Standup, writer, designer, editor. */
  posts: string;
  /** What "worth sending to a friend" means here. Standup, writer, research. */
  viral: string;
  /** How people who reply are talked to. The social manager and the inbox. */
  comments: string;
  /** The things that must never happen. Everyone, as a rule. */
  avoid: string;
}

export interface SocialSettings {
  enabled: boolean;
  /** Pakistan hour the team starts — and the hour a piece made ahead goes out on its day. */
  runHour: number;
  postsPerDay: number;
  /** Days one batch of the calendar covers; 0 makes each day on the day. */
  makeAheadDays: number;
  /** The last day the made calendar reaches; the desk only posts until it runs low. */
  calendarUntil?: string | null;
  /** Set while a batch is being made: the day it fills to. */
  batchUntil?: string | null;
  /** A story every day on top of the rotation, rather than a turn at a slot. */
  dailyStory: boolean;
  platforms: SocialPlatform[];

  angles: string[];
  lastAngleIndex: number;
  formats: SocialFormat[];
  lastFormatIndex: number;

  /** Read by every employee, on every job. */
  crewInstructions: string;
  /** The long brief: said once, read on every job. See SocialBrief. */
  brief: SocialBrief;
  /** Render the reel here rather than stopping at the cut brief. */
  autoRenderVideo: boolean;
  /** Publish the moment the team is finished, with no gate in front of it. */
  autoPublish: boolean;
  /** The owner has answered "ask me first, or post directly?" once. */
  publishModeChosen: boolean;
  /** Read our own numbers daily and feed them back into the standup. */
  learnFromOwnPage: boolean;

  researchEnabled: boolean;
  competitors: SocialCompetitor[];

  /**
   * The Claude model the desk writes and decides with. There is no image or
   * video model: nothing is rendered by the backend — the designer and the
   * editor write briefs, and you make the files and attach them from the queue.
   */
  textModel: string;

  engagementEnabled: boolean;
  autoReply: boolean;

  lastRunAtMs: number | null;
  lastRunStatus: string | null;
  lastEngagementAtMs: number | null;
  lastEngagementStatus: string | null;
}

export interface SocialReadiness {
  /**
   * Whether anybody on the desk can produce anything. Always true now: with no
   * model key at all the backend writes with its local engine instead.
   */
  writer: boolean;
  /**
   * Which engine a run would use today. `claude` is the paid model, `gemini` is
   * Google's free tier — the only free one that can also search, so the only
   * free one with a live market read — `free` is whichever OpenAI-compatible
   * endpoint is configured, and `local` is the key-free engine that composes
   * from the brand material and scores its own candidates. The last is
   * reliable and noticeably plainer, so the console says which is running
   * rather than leaving it to be inferred.
   */
  engine: 'claude' | 'gemini' | 'free' | 'local';
  tokenVault: boolean;
}

export type SocialPostStatus =
  | 'planning'
  | 'researching'
  | 'drafting'
  | 'optimising'
  | 'designing'
  | 'rendering'
  | 'awaiting_approval'
  | 'changes_requested'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'rejected';

export interface SocialMediaAsset {
  kind: 'video' | 'image';
  provider: string;
  url: string | null;
  storagePath: string | null;
  aspect: string;
  slide: number;
  alt: string;
}

export interface SocialPlan {
  concept: string;
  audience: string;
  why: string;
  hookDirection: string;
  visualDirection: string;
  editDirection: string;
  distribution: string;
  /** Keyed by employee id. */
  notes: Record<string, string>;
}

export interface SocialResearch {
  atMs: number;
  trends: string[];
  competitorMoves: string[];
  opportunities: string[];
  hookPatterns: string[];
  avoid: string[];
  sounds?: string[];
  /** Real posts travelling this week, found by the morning search. */
  viral?: { title: string; url: string; why: string }[];
  /** Other Instagram accounts read with their real numbers. Mirrors `AccountRead` in social/types.ts. */
  accounts?: {
    username: string;
    followers: number;
    medianEngagement: number;
    top: { caption: string; mediaType: string; permalink: string | null; likes: number; comments: number; multiple: number }[];
  }[];
  sources: { title: string; url: string }[];
  error: string | null;
}

/** The month's strategy at `socialPlans/{YYYY-MM}`. Mirrors `MonthPlan` in social/strategy.ts. */
export interface SocialMonthPlan {
  month: string;
  atMs: number;
  by: string;
  engine: string;
  goal: string;
  pillars: string[];
  weeks: { theme: string; focus: string }[];
  days: Record<string, { format: SocialFormat; topic: string; hook: string; pillar: string }[]>;
  ads: string[];
  sales: string[];
}

// ── The launch sequence ─────────────────────────────────────────────────────
// A new Studio workspace's first days, at `socialLaunch/*`. Mirrors
// backend/functions/src/social/launch.ts and market.ts.

export type LaunchStepId = 'market' | 'content' | 'execute' | 'funnel' | 'close';
export const LAUNCH_STEPS: LaunchStepId[] = ['market', 'content', 'execute', 'funnel', 'close'];
export type LaunchStepStatus = 'waiting' | 'working' | 'done' | 'needs_you' | 'failed' | 'skipped';

/** `socialLaunch/state` */
export interface LaunchStateDoc {
  startedAtMs: number;
  knowledge: string;
  links: string[];
  steps: Record<LaunchStepId, { status: LaunchStepStatus; atMs: number | null; note: string | null }>;
}

export interface AudiencePersona {
  name: string;
  who: string;
  reaction: string;
  wouldBuy: 'yes' | 'maybe' | 'no';
  objection: string;
  wouldShare: boolean;
}

/** `socialLaunch/market` */
export interface MarketAnalysisDoc {
  atMs: number;
  engine: string;
  grounded: boolean;
  summary: string;
  segments: { who: string; wants: string }[];
  competitors: { name: string; url: string; knownFor: string }[];
  positioning: string;
  opportunities: string[];
  risks: string[];
  channels: string[];
  offers: string[];
  fromLinks: { url: string; takeaway: string }[];
  test: {
    verdict: 'go' | 'adjust' | 'not_yet';
    score: number;
    offer: string;
    panel: AudiencePersona[];
    objections: string[];
    bestHook: string;
    changes: string[];
  } | null;
  sources: { title: string; url: string }[];
}

/** `socialLaunch/funnel` */
export interface FunnelPlanDoc {
  atMs: number;
  offer: string;
  cta: string;
  landing: string;
  stages: { stage: string; how: string }[];
  adBrief: string;
  salesKinds: string[];
  salesCity: string;
  openingLine: string;
  campaignId: string | null;
}

/** What the team saw in a video it was asked to make something like. Mirrors `ReferenceRead`. */
export interface SocialReferenceRead {
  atMs: number;
  source: string;
  summary: string;
  hook: string;
  beats: { at: string; what: string; onScreen: string }[];
  seconds: number | null;
  pacing: string;
  look: string;
  sound: string;
  whyItWorks: string[];
  market: string;
  ourVersion: string;
  dontCopy: string[];
  sources: { title: string; url: string }[];
}

export interface SocialSeoPack {
  searchIntent: string;
  keywords: string[];
  hashtags: string[];
  altTexts: string[];
  note: string;
}

export interface SocialSearchPack {
  youtube: { title: string; description: string; tags: string[] } | null;
  webAngle: string;
  note: string;
}

export interface SocialAdPlan {
  objective: string;
  campaignType: string;
  hookVariants: string[];
  targeting: { locations: string[]; ages: string; interests: string[] };
  budgetNote: string;
  cta: string;
  whatToTest: string;
  successLooksLike: string;
}

export type SocialRevisionScope = 'script' | 'design' | 'video' | 'caption' | 'seo' | 'ads';

export interface SocialRevision {
  atMs: number;
  by: string;
  feedback: string;
  scope: SocialRevisionScope[];
}

export interface SocialPostDoc {
  id: string;
  date: string;
  format?: SocialFormat;
  angle: string;
  status: SocialPostStatus;
  /** "Make one now" chose to post it the moment it is finished. */
  autoPublish?: boolean | null;
  /** When it was approved to go out; the five-minute sweep posts it from here. */
  publishQueuedAtMs?: number;
  /** Approved before its own day: goes out on that day at the desk's hour. */
  scheduled?: boolean;
  publishingSinceMs?: number;
  team?: SocialTeamMemberRef[];
  work?: Partial<Record<SocialStage, SocialWorkEntry>>;
  plan?: SocialPlan | null;
  script: {
    hook: string;
    hookVariants?: string[];
    frames?: { scene: string; overlay: string }[];
    voiceover: string;
    cta: string;
    rationale: string;
    viralHook?: string;
    /** Written before formats existed. */
    beats?: string[];
    onScreenText?: string[];
  } | null;
  caption: string;
  captions?: Partial<Record<SocialPlatform, string>>;
  hashtags: string[];
  facts: Record<string, number | string>;
  research?: SocialResearch | null;
  reference?: SocialReferenceRead | null;
  seo?: SocialSeoPack | null;
  search?: SocialSearchPack | null;
  ads?: SocialAdPlan | null;
  direction?: { prompt: string; overlay: string; alt: string }[] | null;
  cut?: { prompt: string; note: string } | null;
  media?: SocialMediaAsset[];
  /** Posts made before carousels existed carry one video here. */
  video?: { url: string | null; provider: string; aspect: string } | null;
  targets: SocialPlatform[];
  results: Partial<
    Record<SocialPlatform, { ok: boolean; id: string | null; url: string | null; error: string | null; atMs?: number }>
  >;
  /**
   * What the backend's own checks made of the writing, scored in code rather
   * than by a model: the hook panel, the caption lint against the 125-character
   * fold and the five-hashtag cap, the machine-voice panel, and the beat
   * timings. Absent on anything written before the checks existed.
   */
  quality?: SocialQualityReport | null;
  /**
   * Which engine wrote this piece — `claude` for the paid model, `gemini` for
   * Google's free tier, `free` for the configured OpenAI-compatible endpoint,
   * `local` for the key-free engine that composes from the brand material.
   * Absent on anything written before the second engine shipped.
   */
  engine?: 'claude' | 'gemini' | 'free' | 'local' | null;
  revisions?: SocialRevision[];
  error: string | null;
  approvedBy: string | null;
}

/**
 * The scorecard. Mirrors `QualityReport` in `backend/functions/src/social/lint.ts`
 * — the two have to move together, and the queue reads this one.
 */
export interface SocialQualityReport {
  atMs: number;
  score: number;
  verdict: 'READY' | 'REVIEW' | 'FIX';
  hook: { text: string; score: number; verdict: 'STRONG' | 'OK' | 'WEAK'; weakest: string | null };
  caption: { score: number; verdict: 'READY' | 'REVIEW' | 'FIX'; visible: string; hashtags: number };
  human: { score: number; verdict: 'PASS' | 'REVIEW' | 'FLAGGED'; weakest: string | null };
  timing: { seconds: number; target: number | null; overruns: boolean } | null;
  /** What would have to change, in the words the writer was handed. */
  notes: string[];
}

/** Everything on a piece that can be shown, in either shape. */
export function postAssets(post: SocialPostDoc): SocialMediaAsset[] {
  if (post.media?.length) return [...post.media].sort((a, b) => a.slide - b.slide);
  if (post.video?.url) {
    return [
      {
        kind: 'video',
        provider: post.video.provider,
        url: post.video.url,
        storagePath: null,
        aspect: post.video.aspect,
        slide: 1,
        alt: '',
      },
    ];
  }
  return [];
}

export interface SocialCommentDoc {
  id: string;
  platform: SocialPlatform;
  mediaId: string;
  postId: string | null;
  commentId: string;
  authorName: string;
  text: string;
  permalink: string | null;
  createdAtMs: number;
  status: 'new' | 'drafted' | 'replied' | 'ignored' | 'escalated';
  intent: 'praise' | 'question' | 'complaint' | 'safety' | 'spam' | 'other' | null;
  draftReply: string | null;
  draftedBy?: string | null;
  sentReply: string | null;
  sentAtMs: number | null;
  error: string | null;
}

/** One of our own posts, measured against this account's own normal. */
export interface SocialRankedPost {
  mediaId: string;
  permalink: string | null;
  mediaType: string;
  postedAtMs: number;
  hook: string;
  reach: number;
  saves: number;
  sends: number;
  comments: number;
  /** How far past our own median this went. 1.0 is an ordinary day. */
  multiple: number;
  sendRate: number;
  saveRate: number;
  hookScore: number;
}

/** What our own page did, and what the research desk made of it. */
export interface SocialPageRead {
  atMs: number;
  date: string;
  sampled: number;
  medianReach: number;
  best: SocialRankedPost[];
  worst: SocialRankedPost[];
  lessons: string[];
  useMore: string[];
  useLess: string[];
  error: string | null;
}

/** The profile, scored out of 100 against the twelve-point rubric. */
export interface SocialProfileAudit {
  atMs: number;
  score: number;
  profile: {
    username: string | null;
    displayName: string | null;
    biography: string | null;
    website: string | null;
    followers: number | null;
    posts: number | null;
  } | null;
  items: { id: string; label: string; scored: number; outOf: number; why: string; fix: string }[];
  rewrites: { field: string; now: string; better: string }[];
  error: string | null;
}

/**
 * Where /connect/instagram leaves its result when it could not postMessage it.
 * Both halves of the handshake read it from here so they cannot drift apart.
 */
export const META_HANDOFF_KEY = 'velocity.social.metaConnect';
/** The console page a connect started from — where the callback walks back to. */
export const META_RETURN_KEY = 'velocity.social.metaConnect.return';

/** What the callback page hands back, by postMessage or by localStorage. */
export interface MetaHandoff {
  kind: 'velocity:meta-connect';
  code: string | null;
  state: string | null;
  error: string | null;
  atMs: number;
}

/** Whether the console can offer "Continue with Facebook" at all, and from where. */
export interface MetaConnectState {
  ready: boolean;
  vaultReady: boolean;
  appId: string | null;
  /** 'whatsapp' means the Meta app already configured for WhatsApp is being reused. */
  source: 'console' | 'env' | 'whatsapp' | null;
  /** The exact string that has to be whitelisted in the Meta console. */
  redirectUri: string;
  scopes: string[];
}

/** One ad account the signed-in admin can run, as the grant reported it. */
export interface MetaAdAccountChoice {
  id: string;
  name: string;
  currency: string;
  active: boolean;
}

/** One Facebook Page the signed-in admin administers, as the grant reported it. */
export interface MetaPageChoice {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramHandle: string | null;
  followers: number | null;
  avatarUrl: string | null;
}

/** A customer's "I paid", waiting for an admin, at `studioPayments/{id}`. */
export interface StudioPaymentDoc {
  id: string;
  wid: string;
  uid: string;
  business: string;
  email: string | null;
  plan: StudioPlanId;
  /** Absent on payments sent before yearly billing existed: those were monthly. */
  billing?: StudioBilling;
  amountUsd: number;
  txnId: string | null;
  screenshotPath: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAtMs: number;
  decidedAtMs: number | null;
  note: string | null;
  /** What the AI check read off the receipt. Null while it runs; absent on payments sent before it existed. */
  analysis?: StudioPaymentAnalysis | null;
  /** A month of AI agents, or credit days, rather than a plan; `plan` is then the plan the workspace already had. */
  kind?: 'agents' | 'credits';
  agents?: AgentPackage;
  /** Credit days bought, a dollar each. */
  credits?: number;
  /** What was asked in rupees, when it was not the plan price (an agent package, credits). */
  amountPkr?: number;
}

/** What a Studio payment bought, in words. */
export function studioPaymentLabel(p: Pick<StudioPaymentDoc, 'kind' | 'credits' | 'plan'>, planName: string): string {
  if (p.kind === 'agents') return 'AI agents package';
  if (p.kind === 'credits') return `Credits · ${p.credits} day${p.credits === 1 ? '' : 's'}`;
  return planName;
}

/** Mirrors `PaymentAnalysis` in backend/functions/src/studio/paymentCheck.ts. */
export interface StudioPaymentAnalysis {
  verdict: 'match' | 'check' | 'mismatch';
  summary: string;
  checks: { key: string; ok: boolean | null; label: string }[];
  read: { amount: number | null; transactionRef: string | null; sourceApp: string | null; ocrConfidence: number | null };
  atMs: number;
}

export type SalesLeadStatus = 'new' | 'drafted' | 'approved' | 'sent' | 'replied' | 'won' | 'lost' | 'skipped' | 'failed';

/** A business the sales agent found, at `salesLeads/{id}`. Mirrors the backend's lead record. */
export interface SalesLeadDoc {
  id: string;
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string;
  source: 'map' | 'search';
  status: SalesLeadStatus;
  title: string;
  description: string;
  signals: string[];
  draft: { subject: string; body: string } | null;
  problems: string[];
  createdAtMs: number;
  sentAtMs: number | null;
  error: string | null;
  /** Follow-ups sent so far (two at most), in the first email's thread. */
  followUps?: number;
  lastSentAtMs?: number | null;
  /** What they wrote back, read from the mailbox. */
  reply?: { atMs: number; text: string; messageId: string; intent: string } | null;
  /** The answer the agent drafted for it — sent only when the owner presses Send. */
  replyDraft?: { subject: string; body: string } | null;
  answeredAtMs?: number | null;
  /** What a calling agent wrote for a call to them, and every call made. */
  callScript?: SalesCallScript & { agentId: string; atMs: number };
  calls?: { atMs: number; outcome: SalesCallOutcome; note: string; by: string }[];
  lastCall?: { atMs: number; outcome: SalesCallOutcome };
}

export type SalesCallOutcome = 'interested' | 'callback' | 'not_interested' | 'no_answer' | 'wrong_number';

export interface SalesCallScript {
  opener: string;
  pitch: string[];
  questions: string[];
  objections: { they: string; you: string }[];
  close: string;
}

/** A calling agent: who rings, in what voice and language, to say what, and when. */
export interface SalesCallAgent {
  id: string;
  name: string;
  voice: 'female' | 'male';
  language: 'urdu' | 'english' | 'mixed';
  goal: string;
  opener: string;
  points: string;
  hoursFrom: number;
  hoursTo: number;
  dailyCap: number;
  active: boolean;
  /** "script": writes what a person says. "ai": dials and talks itself. Absent = script. */
  mode?: 'script' | 'ai';
  /** Prices, packages, FAQs — the only facts the AI may state. */
  knowledge?: string;
  /** Rings new leads with a phone number on its own, inside its hours and caps. */
  autoCall?: boolean;
}

export interface SalesSettingsDoc {
  product: string;
  offer: string;
  kinds: string[];
  city: string;
  senderName: string;
  senderCompany: string;
  senderAddress: string;
  mode: 'copy' | 'mailbox';
  sendMode: 'approve' | 'direct' | null;
  dailyCap: number;
  smtp: { host: string; port: number; user: string; from: string } | null;
  autoDaily: boolean;
  /** Two follow-ups to a lead that has not answered — only ever after the inbox was read. */
  followUps: boolean;
  /** The mailbox's IMAP server; empty means the one that goes with the SMTP server. */
  imapHost: string;
  inboxCheckedAtMs: number;
  inboxStatus: string | null;
  sentDay: string;
  sentCount: number;
  lastStatus: string | null;
  callAgents: SalesCallAgent[];
}

/** The sales agent: settings, finding, writing, and what happens to each lead. */
export const salesApi = {
  getSettings: callable<Record<string, never>, { settings: SalesSettingsDoc; hasPassword: boolean; vaultReady: boolean }>(
    'salesGetSettings',
  ),
  saveSettings: callable<
    Partial<Omit<SalesSettingsDoc, 'smtp' | 'sendMode'>> & {
      sendMode?: 'approve' | 'direct';
      smtp?: { host: string; port: 465 | 587; user: string; from: string; pass?: string };
    },
    { ok: boolean; settings: SalesSettingsDoc }
  >('salesSaveSettings'),
  findLeads: callable<
    { kind: string; city: string; write?: boolean },
    { ok: boolean; found: number; added: number; written: number; note: string }
  >('salesFindLeads', LONG_CALL_MS),
  addLeads: callable<{ lines: string; city?: string }, { ok: boolean; added: number }>('salesAddLeads', LONG_CALL_MS),
  writeEmails: callable<{ leadIds?: string[] }, { ok: boolean; written: number }>('salesWriteEmails', LONG_CALL_MS),
  leadAction: callable<
    {
      leadId: string;
      action: 'approve' | 'send' | 'sent' | 'skip' | 'replied' | 'won' | 'lost' | 'optout' | 'edit' | 'editReply' | 'sendReply' | 'call';
      subject?: string;
      body?: string;
      outcome?: SalesCallOutcome;
      note?: string;
    },
    { ok: boolean; sent?: number }
  >('salesLeadAction'),
  callScript: callable<{ leadId: string; agentId: string }, { ok: boolean; script: SalesCallScript }>(
    'salesCallScript',
    LONG_CALL_MS,
  ),
};

// ── AI keys & usage (admins) ────────────────────────────────────────────────

export type AiKeySlot = 'house' | 'customers' | 'voice';

export interface AiKeyStatus {
  slot: AiKeySlot;
  /** console = typed on the page; deploy = the GitHub secret; house = borrowing the house key. */
  source: 'console' | 'deploy' | 'house' | 'missing';
  last4: string;
  setAtMs: number | null;
  testedAtMs: number | null;
  lastError: string | null;
  lastErrorAtMs: number | null;
}

export interface AiBudgets {
  houseUsd: number;
  customerUsd: number;
  perWorkspace: Record<string, number>;
}

export interface AiUsageRow {
  wid: string;
  name: string;
  usd: number;
  calls: number;
  inTok: number;
  outTok: number;
  grounded: number;
  seconds: number;
  /** Pieces of content a model made this month. */
  pieces: number;
  /** What this desk's month plan asks it to make (backend `countPlanned`). */
  planned?: { pieces: number; byFormat: Record<string, number> };
  /** The part of `usd` that counts against the budget — AI calls are paid apart. */
  allowanceUsd?: number;
  budgetUsd: number;
  byFeature: Record<string, { usd: number; calls: number }>;
  byService: Record<string, { usd?: number; calls?: number }>;
  byWhat: Record<string, { usd?: number; calls?: number }>;
  byModel: Record<string, { usd?: number; calls?: number }>;
  byDay: Record<string, number>;
  /** Calls and finished pieces per day of the month — counted since 28 Oct 2026, absent before. */
  byDayCalls?: Record<string, number>;
  byDayPieces?: Record<string, number>;
}

export interface AiOverview {
  month: string;
  slots: AiKeyStatus[];
  budgets: AiBudgets;
  vaultReady: boolean;
  workspaces: AiUsageRow[];
  lastMonthUsd: number;
}

export const aiApi = {
  overview: callable<{ month?: string }, AiOverview>('adminAiOverview'),
  setKey: callable<{ slot: AiKeySlot; key: string }, { ok: boolean; last4: string }>('adminAiSetKey'),
  removeKey: callable<{ slot: AiKeySlot }, { ok: boolean }>('adminAiRemoveKey'),
  testKey: callable<{ slot: AiKeySlot }, { ok: boolean; error: string | null }>('adminAiTestKey'),
  setBudgets: callable<AiBudgets, { ok: boolean; budgets: AiBudgets }>('adminAiSetBudgets'),
};

// ── AI agents: calls, WhatsApp, billing ─────────────────────────────────────

export interface AgentRateCard {
  cost: { callPerMin: number; aiVoicePerMin: number; numberPerMonth: number; waTemplate: number; waMessage: number; aiReply: number };
  price: { perAgentMonth: number; perNumberMonth: number; perMin: number; perWaMessage: number };
  usdToPkr: number;
}

export interface AgentPackage {
  agents: number;
  numbers: number;
  callsPerDay: number;
  avgCallMin: number;
  waMessagesPerMonth: number;
}

export interface AgentPlan extends AgentPackage {
  minutesPerMonth: number;
  priceUsd: number;
  paidUntilMs: number;
  setAtMs: number;
  setBy: string;
}

export interface AgentUsage {
  calls: number;
  answered: number;
  seconds: number;
  lineMin: number;
  waTemplates: number;
  waOut: number;
  waIn: number;
  aiReplies: number;
  costUsd: number;
}

export interface AgentNumber {
  sid: string;
  phone: string;
  name: string;
  kind: 'twilio' | 'verified';
  wid: string | null;
  agentId: string | null;
}

export interface AgentWaLine {
  phoneNumberId: string;
  displayNumber: string;
  verifiedName: string;
  templateName: string;
  templateLang: string;
  templateHasName: boolean;
  autoReply: boolean;
  agentId: string | null;
  verifyToken: string;
  connectedAtMs: number;
}

/** One AI call, at `agentCalls/{id}` in the workspace. */
export interface AgentCallDoc {
  id: string;
  leadId: string;
  leadName: string;
  agentId: string;
  agentName: string;
  to: string;
  from: string;
  state: 'dialing' | 'live' | 'ended' | 'no-answer' | 'busy' | 'failed';
  by: string;
  createdAtMs: number;
  answeredAtMs: number | null;
  endedAtMs: number | null;
  seconds: number;
  costUsd: number;
  outcome: { result: string; summary: string; whatsappOk: boolean; callbackWhen: string; deal: string } | null;
  transcript: { who: 'them' | 'agent'; text: string }[];
  followUp: 'none' | 'pending' | 'sent' | 'failed';
  error: string | null;
}

/** One WhatsApp conversation, at `agentThreads/{waId}` in the workspace. */
export interface AgentThreadDoc {
  waId: string;
  name?: string;
  leadId?: string | null;
  mode: 'ai' | 'human';
  optedOut?: boolean;
  needsOwner?: boolean;
  unread?: number;
  intent?: string;
  deal?: string;
  note?: string;
  lastInAtMs?: number;
  lastOutAtMs?: number;
  updatedAtMs: number;
  messages: { from: 'them' | 'us'; text: string; atMs: number; by: 'them' | 'ai' | 'owner' | 'template' }[];
}

export interface AgentState {
  house: boolean;
  plan: AgentPlan | null;
  planLive: boolean;
  usage: AgentUsage;
  callsToday: number;
  price: AgentRateCard['price'];
  usdToPkr: number;
  numbers: { phone: string; kind: 'twilio' | 'verified'; agentId: string | null }[];
  phoneLine: boolean;
  bridge: boolean;
  whatsapp: AgentWaLine | null;
  webhookUrl: string;
}

export interface AgentClientRow {
  id: string;
  name: string;
  plan: AgentPlan | null;
  planLive: boolean;
  studioPlan: string;
  agents: { id: string; name: string; mode: 'script' | 'ai'; active: boolean }[];
  usage: AgentUsage;
  numbers: number;
  costUsd: number;
  billUsd: number;
  marginUsd: number;
}

export interface AgentsOverview {
  month: string;
  twilio: { accountSid: string; friendlyName: string; connectedAtMs: number; ok: boolean } | null;
  vaultReady: boolean;
  bridge: string;
  numbers: AgentNumber[];
  card: AgentRateCard;
  defaults: AgentRateCard;
  clients: AgentClientRow[];
}

/** What a package costs a customer: the price half of the backend's quote (costs never leave the server). */
export function agentPrice(pkg: AgentPackage, price: AgentRateCard['price'], usdToPkr: number) {
  const minutes = Math.ceil(pkg.callsPerDay * 30 * pkg.avgCallMin);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const usd = r2(
    r2(pkg.agents * price.perAgentMonth) +
      r2(pkg.numbers * price.perNumberMonth) +
      r2(minutes * price.perMin) +
      r2(pkg.waMessagesPerMonth * price.perWaMessage),
  );
  return { minutes, usd, pkr: Math.round(usd * usdToPkr) };
}

export const agentsApi = {
  state: callable<Record<string, never>, AgentState>('agentState'),
  startCall: callable<{ leadId: string; agentId: string }, { ok: boolean; callId: string }>('agentStartCall'),
  saveWhatsApp: callable<
    Omit<AgentWaLine, 'displayNumber' | 'verifiedName' | 'verifyToken' | 'connectedAtMs'> & { token?: string; appSecret?: string },
    { ok: boolean; line: AgentWaLine; webhookUrl: string }
  >('agentSaveWhatsApp'),
  disconnectWhatsApp: callable<Record<string, never>, { ok: boolean }>('agentDisconnectWhatsApp'),
  threadAction: callable<{ waId: string; action: 'send' | 'takeover' | 'handback' | 'read'; text?: string }, { ok: boolean }>(
    'agentThreadAction',
  ),
  // Admins
  overview: callable<Record<string, never>, AgentsOverview>('adminAgentsOverview'),
  connectTwilio: callable<{ accountSid: string; authToken: string }, { ok: boolean; friendlyName: string; numbers: AgentNumber[] }>(
    'adminAgentsConnectTwilio',
  ),
  numbers: callable<
    | { action: 'refresh' }
    | { action: 'search'; country: string }
    | { action: 'buy'; phone: string }
    | { action: 'release'; sid: string }
    | { action: 'assign'; sid: string; wid: string | null; agentId: string | null },
    { ok: boolean; numbers?: AgentNumber[]; available?: { phone: string; place: string }[] }
  >('adminAgentsNumbers'),
  setRateCard: callable<AgentRateCard, { ok: boolean; card: AgentRateCard }>('adminAgentsSetRateCard'),
  setPlan: callable<{ wid: string; package: AgentPackage | null; months: number; priceUsd?: number }, { ok: boolean }>(
    'adminAgentsSetPlan',
  ),
};

/** Velocity Studio: sign-up, paying, and the admin's decision on a payment. */
export const studioApi = {
  createWorkspace: callable<
    {
      businessName: string;
      website?: string;
      what: string;
      audience: string;
      market: string;
      language: string;
      differences?: string;
      plan: StudioPlanId;
    },
    { ok: boolean; workspaceId: string; trialEndsAtMs: number }
  >('studioCreateWorkspace'),
  submitPayment: callable<
    // A plan, a month of AI agents (`agents`) or credit days (`credits`) — exactly one.
    {
      plan?: StudioPlanId;
      billing?: StudioBilling;
      agents?: AgentPackage;
      credits?: number;
      txnId: string;
      screenshotPath: string;
    },
    { ok: boolean; paymentId: string }
  >('studioSubmitPayment'),
  /** This month's AI work as a share of the allowance — never a dollar of real cost. */
  usage: callable<Record<string, never>, { month: string; usedPct: number; creditDaysThisMonth: number }>('studioUsage'),
  decidePayment: callable<{ paymentId: string; approve: boolean; note?: string }, { ok: boolean; status: string }>(
    'adminDecideStudioPayment',
  ),
  /** The sign-up page saying hello, so an unfinished sign-up is on the admin's list. */
  touch: callable<Record<string, never>, { ok: boolean }>('studioTouch'),
  sendEmailCode: callable<Record<string, never>, { ok: boolean; sentTo?: string; alreadyVerified?: boolean }>(
    'studioSendEmailCode',
  ),
  verifyEmailCode: callable<{ code: string }, { ok: boolean }>('studioVerifyEmailCode'),
  manageCustomer: callable<
    { wid: string } & (
      | { action: 'extendTrial' | 'giveDays'; days: number }
      | { action: 'setPlan'; plan: StudioPlanId }
      | { action: 'suspend' | 'resume' }
      | { action: 'note'; note: string }
    ),
    { ok: boolean }
  >('adminManageStudioCustomer'),
  setMailer: callable<
    { host: string; port: number; user: string; pass?: string; from: string; fromName: string; testTo: string },
    { ok: boolean }
  >('adminSetStudioMailer'),
};

export const socialApi = {
  connectSchema: callable<Record<string, never>, ConnectSchema>('adminGetSocialConnectSchema'),

  /** The one-click Instagram connect — see backend/functions/src/social/meta.ts. */
  metaState: callable<Record<string, never>, MetaConnectState>('adminGetMetaConnectState'),
  setMetaApp: callable<
    { appId: string; appSecret: string },
    { ok: boolean; appId: string; appName: string | null; redirectUri: string }
  >('adminSetMetaApp'),
  /** `ads` adds the Marketing API scopes — only the Ads page asks for them. */
  startMetaConnect: callable<{ ads?: boolean }, { url: string; state: string; redirectUri: string }>(
    'adminStartMetaConnect',
  ),
  finishMetaConnect: callable<
    { code: string; state: string },
    { pages: MetaPageChoice[]; adAccounts?: MetaAdAccountChoice[] }
  >('adminFinishMetaConnect'),
  chooseMetaPage: callable<
    { state: string; pageId: string; adAccountId?: string },
    { ok: boolean; connected: string[]; instagram: boolean; note: string | null }
  >('adminChooseMetaPage'),

  connect: callable<
    {
      platform: SocialPlatform;
      accessToken: string;
      externalId?: string;
      clientId?: string;
      clientSecret?: string;
      expiresInDays?: number;
    },
    { ok: boolean }
  >('adminConnectSocialAccount'),
  verify: callable<{ platform: SocialPlatform }, { ok: boolean }>('adminVerifySocialAccount'),
  disconnect: callable<{ platform: SocialPlatform }, { ok: boolean }>('adminDisconnectSocialAccount'),

  readOwnPage: callable<Record<string, never>, SocialPageRead>('adminReadOwnPage'),
  auditProfile: callable<Record<string, never>, SocialProfileAudit>('adminAuditProfile'),

  roles: callable<Record<string, never>, { roles: SocialRoleOption[] }>('adminGetSocialRoles'),
  hire: callable<
    { name: string; role: SocialRole; title?: string; instructions?: string },
    { ok: boolean; employee: SocialEmployee }
  >('adminHireSocialEmployee'),
  updateEmployee: callable<
    {
      id: string;
      name?: string;
      title?: string;
      instructions?: string;
      status?: 'active' | 'off_duty';
      role?: SocialRole;
    },
    { ok: boolean }
  >('adminUpdateSocialEmployee'),
  fire: callable<{ id: string }, { ok: boolean }>('adminFireSocialEmployee'),
  seedTeam: callable<Record<string, never>, { ok: boolean; hired: number }>('adminSeedSocialTeam'),

  getSettings: callable<
    Record<string, never>,
    { settings: SocialSettings; readiness: SocialReadiness; coverage: string[]; staffed: number }
  >('adminGetSocialSettings'),
  /** `scheduled`: waiting pieces "Post on its own" just put on the calendar. */
  updateSettings: callable<Partial<SocialSettings>, { ok: boolean; settings: SocialSettings; scheduled?: number }>(
    'adminUpdateSocialSettings',
  ),
  /** Have the team (re)write the month's strategy. Read the result from `socialPlans/{month}`. */
  planMonth: callable<{ month: string }, { ok: boolean; days: number }>('adminPlanSocialMonth', LONG_CALL_MS),
  /** Change one planned day's topic before the team makes it. */
  editPlanSlot: callable<
    { date: string; format: SocialFormat; topic: string; hook?: string },
    { ok: boolean }
  >('adminEditPlanSlot'),
  /**
   * The launch sequence's first box: save what the owner knows and their links,
   * read the market (and run the audience test), then carry on down the
   * sequence. Progress is read live from `socialLaunch/state`.
   */
  launchMarket: callable<{ knowledge?: string; links?: string[] }, { ok: boolean }>('adminLaunchMarket', 10 * 60_000),

  /**
   * Put the team on a piece. `brief` is what it should be about, in your own
   * words; `publishWhenDone` posts it the moment it is finished instead of
   * stopping in the queue.
   */
  generate: callable<
    {
      date?: string;
      format?: SocialFormat;
      angle?: string;
      targets?: SocialPlatform[];
      replace?: boolean;
      brief?: string;
      publishWhenDone?: boolean;
      /** "Make it like this video": one of the two. */
      reference?: { youtube: string } | { storagePath: string };
    },
    { ok: boolean; id: string; format: SocialFormat }
  >('adminGenerateSocialPost', LONG_CALL_MS),
  requestChanges: callable<
    { postId: string; feedback: string; scope: SocialRevisionScope[] },
    { ok: boolean; reran: string[] }
  >('adminRequestSocialChanges', LONG_CALL_MS),
  review: callable<
    {
      postId: string;
      approve: boolean;
      caption?: string;
      targets?: SocialPlatform[];
      publishNow?: boolean;
    },
    /** `scheduled` (with `dueAtMs`) for a piece approved before its own day. */
    { ok: boolean; status?: string; published?: number; failed?: number; dueAtMs?: number }
  >('adminReviewSocialPost', LONG_CALL_MS),
  publish: callable<
    { postId: string; platforms?: SocialPlatform[] },
    { ok: boolean; published: number; failed: number }
  >('adminPublishSocialPost', LONG_CALL_MS),
  /** Draw the pictures, or cut the reel, for a piece that has none. */
  render: callable<{ postId: string }, { ok: boolean; made: number }>('adminRenderSocialPost', LONG_CALL_MS),
  attachMedia: callable<
    { postId: string; storagePath: string; kind?: 'video' | 'image'; slide?: number; alt?: string },
    { ok: boolean }
  >('adminAttachSocialMedia'),
  deletePost: callable<{ postId: string }, { ok: boolean }>('adminDeleteSocialPost'),

  syncComments: callable<Record<string, never>, { ok: boolean; summary: string }>('adminSyncSocialComments'),
  replyComment: callable<{ platform: SocialPlatform; commentId: string; text: string }, { ok: boolean }>(
    'adminReplySocialComment',
  ),
  setCommentStatus: callable<
    { platform: SocialPlatform; commentId: string; status: 'new' | 'drafted' | 'ignored' | 'escalated' },
    { ok: boolean }
  >('adminSetCommentStatus'),
};

// ── Ads desk ────────────────────────────────────────────────────────────────
// Meta campaigns planned, made, launched and steered from Manage social → Ads.
// Mirrors backend/functions/src/social/ads.ts and adsExpert.ts.

export type AdObjectiveKind = 'traffic' | 'awareness' | 'engagement';

export interface AdMetrics {
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  linkClicks: number;
  /** Link CTR, percent. */
  ctr: number;
  cpc: number;
  cpm: number;
  results: number;
  costPerResult: number;
  /** Sales, leads, chats, sign-ups or installs Meta could see; absent on reads before 2026-10-23. */
  conversions?: number;
  conversionKind?: 'purchase' | 'lead' | 'message' | 'signup' | 'install' | null;
  conversionValue?: number;
  costPerConversion?: number;
  /** Worth ÷ spend; null when nothing says what a conversion is worth. */
  roas?: number | null;
}

export interface AdBand {
  low: number;
  typical: number;
  high: number;
}

export interface AdBenchmarks {
  cpm: AdBand;
  cpc: AdBand;
  ctr: AdBand;
  cpe: AdBand;
  /** `own` once the account has a normal of its own. */
  source: 'pakistan' | 'own';
}

export type AdAction =
  | { kind: 'none' }
  | { kind: 'pause'; why: string }
  | { kind: 'scale'; to: number; why: string }
  | { kind: 'refresh'; why: string };

export interface AdVerdict {
  grade: 'idle' | 'learning' | 'good' | 'ok' | 'bad';
  headline: string;
  reasons: string[];
  action: AdAction;
}

export interface AdPlan {
  name: string;
  objective: AdObjectiveKind;
  audience: { cities: string[]; ageMin: number; ageMax: number; genders: 'all' | 'men' | 'women'; interests: string[] };
  dailyBudget: number;
  days: number;
  format: 'image' | 'video';
  primaryText: string;
  headline: string;
  cta: string;
  lines: string[];
  why: string;
}

export interface AdForecast {
  spend: number;
  results: [number, number];
  label: string;
  costPerResult: AdBand;
}

/** system/socialAds — the connection, the owner's limits, and the account at a glance. */
/** The connected Google Ads account, on the ads config (backend `GoogleAdsLink`). */
export interface GoogleAdsLink {
  customerId: string;
  name: string;
  currency: string;
  testAccount: boolean;
  connectedBy: string | null;
  connectedAtMs: number;
  /** Google refused the stored sign-in — connect again. */
  lastError: string | null;
}

export interface GoogleAdsChoice {
  customerId: string;
  name: string;
  currency: string;
  manager: boolean;
  testAccount: boolean;
  note: string | null;
}

export interface GoogleAdsTotals {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  value: number;
}

/** Where /connect/google-ads leaves its result when it could not postMessage it. */
export const GOOGLE_ADS_HANDOFF_KEY = 'velocity.social.googleAdsConnect';
export const GOOGLE_ADS_RETURN_KEY = 'velocity.social.googleAdsConnect.return';

export interface GoogleAdsHandoff {
  kind: 'velocity:google-ads-connect';
  code: string | null;
  state: string | null;
  error: string | null;
  atMs: number;
}

/** Google Ads: connected with "Continue with Google" and read. Nothing here spends. */
export const googleAdsApi = {
  state: callable<
    Record<string, never>,
    { ready: boolean; vaultReady: boolean; clientId: string | null; loginCustomerId: string | null; redirectUri: string }
  >('adminGetGoogleAdsState'),
  setApp: callable<
    { clientId: string; clientSecret: string; developerToken: string; loginCustomerId?: string },
    { ok: boolean; redirectUri: string }
  >('adminSetGoogleAdsApp'),
  start: callable<Record<string, never>, { url: string; state: string }>('adminStartGoogleAdsConnect'),
  finish: callable<{ code: string; state: string }, { choices: GoogleAdsChoice[] }>('adminFinishGoogleAdsConnect'),
  choose: callable<{ state: string; customerId: string }, { ok: boolean; name: string; customerId: string }>(
    'adminChooseGoogleAdsAccount',
  ),
  disconnect: callable<Record<string, never>, { ok: boolean }>('adminDisconnectGoogleAds'),
  summary: callable<
    Record<string, never>,
    {
      currency: string;
      totals: GoogleAdsTotals;
      campaigns: (GoogleAdsTotals & { id: string; name: string; status: string; channel: string })[];
    }
  >('adminGoogleAdsSummary'),
};

export interface AdsConfigDoc {
  /** Absent or null until a Google Ads account is connected. */
  google?: GoogleAdsLink | null;
  adAccountId: string | null;
  accountName: string | null;
  currency: string;
  pageId: string | null;
  instagramId: string | null;
  tokenExpiresAtMs: number | null;
  /** Connected with a System User token Meta confirmed never expires. */
  permanent?: boolean;
  mode: 'ask' | 'direct' | null;
  dailyCap: number;
  maxDays: number;
  link: string;
  /** What one sale or lead is worth to the owner — prices conversions Meta cannot value. 0 = not said. */
  valuePerConversion?: number;
  lastSyncAtMs: number | null;
  lastSyncStatus: string | null;
  review: { atMs: number; summary: string; moves: string[]; engine: string } | null;
  account?: {
    daily: { date: string; spend: number; impressions: number; linkClicks: number }[];
    week: AdMetrics;
    committed: number;
    bench: AdBenchmarks | null;
    /** The whole business over the same week (adsExpert.ts `blended`); null when our rides could not be read. */
    blended?: { orders: number; commission: number; costPerOrder: number; roas: number | null } | null;
  };
}

/** What a simulated panel made of an ad before Meta saw it. Mirrors backend `AdPretest`. */
export interface AdPretest {
  verdict: 'go' | 'adjust' | 'not_yet';
  /** Share of the panel that would act, maybes counted half; 0–1. */
  score: number;
  objections: string[];
  firstScore: number | null;
  rewritten: boolean;
}

/** socialAds/{campaignId} — one campaign, as the desk last read and judged it. */
export interface AdCampaignDoc {
  id: string;
  name: string;
  objective: string;
  objectiveKind: AdObjectiveKind;
  status: string;
  effectiveStatus: string;
  /** Made by the desk — the only kind it may steer on its own. */
  managed: boolean;
  approval?: 'pending' | 'approved';
  dailyBudget: number | null;
  endMs: number | null;
  lifetime?: AdMetrics;
  week?: AdMetrics;
  verdict?: AdVerdict | null;
  /** "In Meta review", or Meta's reason for rejecting it. */
  review?: string | null;
  previewUrl?: string | null;
  brief?: string;
  plan?: AdPlan;
  forecast?: AdForecast | null;
  targets?: { costPerResult: number; ctr: number; cpc: number; cpm: number } | null;
  targeting?: { cities: string[]; interests: string[] };
  budgetNote?: string | null;
  /** The simulated audience it met before Meta (backend `pretestAd`). */
  pretest?: AdPretest | null;
  engine?: string;
  plannedBy?: string;
  /** Fresh creatives the expert has made for it, and when it last did. */
  refreshes?: number;
  lastRefreshMs?: number | null;
  /** The old ad a fresh creative replaces, until Meta approves the new one. */
  retireAdId?: string | null;
  autoActions?: { atMs: number; kind: string; detail: string }[];
  manualActions?: { atMs: number; by: string; action: string; detail: string }[];
  createdAtMs?: number;
  syncedAtMs?: number;
}

export type AdSource = { kind: 'make' } | { kind: 'post'; postId: string } | { kind: 'boost'; mediaId: string };

export interface AdChatTurn {
  from: 'you' | 'expert';
  text: string;
}

export const adsApi = {
  settings: callable<
    { mode?: 'ask' | 'direct'; dailyCap?: number; maxDays?: number; link?: string; valuePerConversion?: number },
    { ok: boolean; config: AdsConfigDoc }
  >('adminSetAdsSettings'),
  /** The brief in, a campaign at Meta out — launched or waiting, by the owner's choice. `plan`: the one designed together. */
  create: callable<
    { brief: string; dailyBudget?: number; days?: number; source?: AdSource; launch?: boolean; plan?: AdPlan },
    {
      ok: boolean;
      campaignId: string;
      launched: boolean;
      budget: number;
      note: string | null;
      plan: AdPlan;
      forecast: AdForecast | null;
      pretest: AdPretest | null;
    }
  >('adminCreateAd', 10 * 60_000),
  /** One turn of "design a campaign with me": the expert's answer, its questions and the plan so far. Spends nothing. */
  design: callable<
    { chat: AdChatTurn[]; draft?: AdPlan },
    {
      ok: boolean;
      reply: string;
      questions: string[];
      plan: AdPlan;
      engine: string;
      note: string | null;
      currency: string;
      forecast: AdForecast | null;
    }
  >('adminDesignAd', 3 * 60_000),
  // Ten minutes: "apply" on a worn-out campaign draws its fresh creative.
  action: callable<
    { campaignId: string; action: 'launch' | 'pause' | 'resume' | 'budget' | 'apply' | 'end'; dailyBudget?: number },
    { ok: boolean; message: string }
  >('adminAdAction', 10 * 60_000),
  sync: callable<Record<string, never>, { ok: boolean; status: string }>('adminSyncAds', 6 * 60_000),
  /** Connect the ad account with a System User token from Business Settings — the one that never expires. */
  connectToken: callable<
    { token: string; adAccountId?: string },
    | { ok: true; accountName: string; permanent: boolean; pageId: string | null }
    | { ok: false; choose: { id: string; name: string; active: boolean }[] }
  >('adminConnectAdsToken'),
};

/**
 * The testing desk.
 *
 * Reading the log is a plain Firestore read (the rules let an admin read
 * `qaLogs`, and the page subscribes so a failure appears as it is recorded), so
 * the only thing that needs a callable is asking the agent to go and look now
 * rather than at its next quarter-hour.
 */
export const qaApi = {
  runChecksNow: callable<
    Record<string, never>,
    {
      day: string;
      ran: number;
      passed: string[];
      failed: string[];
      skipped: string[];
      durationMs: number;
    }
  >('qaRunChecksNow'),
  /** The same report the phone's watcher sends; the console sends its own crashes this way. */
  report: callable<
    {
      reports: {
        featureId: string;
        kind: 'threw';
        whatHappened: string;
        errorMessage?: string;
        screen?: string;
        detail?: Record<string, string>;
      }[];
      platform?: string;
    },
    { recorded: number }
  >('reportFeatureCheck'),
};
