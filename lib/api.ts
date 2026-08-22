import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

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

function callable<Req, Res>(name: string): (data: Req) => Promise<Res> {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req) => (await fn(stripUndefined(data) as Req)).data;
}

/** Admin-only backend actions (each guarded by requireAdmin server-side). */
export const adminApi = {
  approveDriver: callable<{ driverId: string }, { ok: boolean }>('approveDriver'),
  rejectDriver: callable<
    { driverId: string; reason?: string; suspend?: boolean; rejectedSections?: string[] },
    { ok: boolean }
  >('rejectDriver'),
  setUserRole: callable<{ targetUid: string; role: 'passenger' | 'driver' | 'admin' }, { ok: boolean }>(
    'setUserRole',
  ),
  resolveSafetyEvent: callable<{ eventId: string; resolution?: string }, { ok: boolean }>(
    'resolveSafetyEvent',
  ),
  markPayoutPaid: callable<{ payoutId: string }, { ok: boolean }>('markPayoutPaid'),
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

  /** Passenger CNIC verification — the identity gate in front of couriers. */
  adminReviewCnicVerification: callable<
    { uid: string; approve: boolean; reason?: string },
    { ok: boolean; status: 'verified' | 'rejected' }
  >('adminReviewCnicVerification'),

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
};

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
