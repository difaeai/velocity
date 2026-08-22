/**
 * Franchise portal — the Pro partner's own web surface.
 *
 * `portal.ts` owns the link and the gate in front of it; `drivers.ts` owns the
 * submission queue and the admin decision that turns a submission into a real
 * driver.
 */
export { getFranchisePortal, adminRotatePartnerPortal, mintPortalId } from './portal';
export {
  franchiseSubmitDriver,
  franchiseListDrivers,
  franchiseWithdrawSubmission,
  adminListDriverSubmissions,
  adminReviewDriverSubmission,
} from './drivers';
