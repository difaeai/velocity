/**
 * Earn with Velocity — the Partner Program.
 *
 * Fleet owners recruit drivers and passengers with a referral code and earn a
 * slice of Velocity's PLATFORM COMMISSION on every genuine completed ride those
 * recruits run. Never a slice of the fare — see config.ts for why that
 * distinction is the whole economics of the program.
 *
 * The flow: apply → admin approves the CNIC → create fleets → share codes →
 * recruits bind on first registration → rides complete → commission is credited,
 * held briefly against fraud, then matures into a withdrawable balance.
 */
export { submitPartnerApplication, adminReviewPartnerApplication } from './applications';
export { createPartnerFleet, previewPartnerFleet } from './fleets';
export { claimPartnerReferral, adminReassignReferral } from './referrals';
export {
  maturePartnerEarnings,
  adminMarkRideStatus,
  requestPartnerWithdrawal,
  adminReviewWithdrawal,
  adminSuspendPartner,
} from './wallet';
export {
  getPartnerDashboard,
  getPartnerFleetMembers,
  getPartnerMemberRides,
  recomputePartnerLevels,
} from './stats';
