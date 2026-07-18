/**
 * Earn with Velocity — the Partner Program.
 *
 * Fleet owners recruit drivers and passengers with a five-digit referral code
 * and earn a slice of Velocity's PLATFORM COMMISSION on every genuine completed
 * ride those recruits run. Never a slice of the fare — see config.ts for why
 * that distinction is the whole economics of the program.
 *
 * Two tiers: free (0.5% on both fleets) and Pro (2% driver / 1.3% passenger,
 * behind a one-off registration fee whose receipt an admin eyeballs).
 *
 * The flow: apply → admin approves the CNIC (and, for Pro, the payment proof) →
 * a code and both fleets are minted → share the code → recruits redeem it from
 * their settings or drawer → rides complete → commission is credited, held
 * briefly against fraud, then matures into a withdrawable balance.
 */
export {
  submitPartnerApplication,
  adminReviewPartnerApplication,
  getPartnerTiers,
} from './applications';
export { previewPartnerFleet } from './fleets';
export { claimPartnerReferral, adminReassignReferral, getMyReferral } from './referrals';
export {
  maturePartnerEarnings,
  adminMarkRideStatus,
  requestPartnerWithdrawal,
  adminReviewWithdrawal,
  adminSuspendPartner,
} from './wallet';
export { adminUpdatePartner, adminDeletePartner } from './manage';
export {
  getPartnerDashboard,
  getPartnerFleetMembers,
  getPartnerMemberRides,
  recomputePartnerLevels,
} from './stats';
