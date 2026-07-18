/**
 * Velocity backend — Cloud Functions entry point.
 *
 * Region is pinned to asia-south1 (Mumbai), the closest Google Cloud region to
 * Pakistan, to minimise latency for matching and trip updates.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'asia-south1', maxInstances: 20 });

// Users & roles
export {
  onUserCreate, onUserDelete,
  setUserRole, banPassenger, createDispute, resolveDispute, registerFcmToken,
  adminCreatePassenger, adminUpdatePassenger, adminDeletePassenger,
  uploadUserPhoto,
} from './users';

// Driver onboarding & verification
export { submitDriverOnboarding, approveDriver, rejectDriver, adminCreateDriver, updateDriver, deleteDriver, payCommission, claimDriverRole } from './drivers';

// Commission settlement (manual bank transfer + AI-verified screenshot)
export { submitCommissionSettlement, adminReviewCommissionSettlement } from './drivers/commissionSettlement';

// Cancellation-fee settlement — same proof flow, open to passengers and drivers
export { submitCancellationFeeSettlement } from './payments/cancellationFees';

// Franchise management
export { adminCreateFranchise, adminAssignFranchise } from './franchises';

// Trip lifecycle
export {
  createTrip,
  placeBid,
  raiseTripFare,
  acceptBid,
  updateTripStatus,
  cancelTrip,
  completeTrip,
} from './trips';

// Driver reports a fake / abusive request from the open-requests feed
export { reportOpenRequest } from './trips/reports';

// En-route pickups — riders on the driver's way, and driver-declared routes
export {
  setDriverRoute,
  endDriverRoute,
  getEnRouteMatches,
  acceptEnRouteRider,
  getPoolRiders,
} from './trips/enRoute';

// Pool ride share links (invite codes, public/private visibility, joining)
export {
  getPoolTripByCode,
  joinPoolTrip,
  setPoolVisibility,
  getNearbyPublicPoolTrips,
} from './trips/poolShare';

// Ratings (post-trip)
export { submitRating } from './ratings';

// Pool ride management
export {
  startPoolBoarding,
  poolArrivePassenger,
  poolPassengerBoarded,
  completePoolRide,
  joinPoolRide,
  driverAcceptPoolBatch,
  cancelPoolJoinRequest,
  driverBlockPoolPassenger,
  reportPoolGenderMisrepresentation,
} from './poolRides';

// Safety
export { raiseSafetyEvent, resolveSafetyEvent } from './safety';

// Payments
export {
  getPaymentOptions,
  createTopupIntent,
  paymentCheckout,
  paymentWebhook,
  mockConfirmTopup,
  requestPayout,
  markPayoutPaid,
  adminSetSettlementAccounts,
} from './payments';

// Travel Partner — commute-partner matching (identity-walled from ride data)
export { getTravelMateFeed } from './travelMate/feed';
export { upsertTravelMateProfile } from './travelMate/upsertProfile';
export { travelMateSwipe } from './travelMate/swipe';
export { requestTravelMateSubscription } from './travelMate/requestSubscription';
export { approveTravelMateSubscription, rejectTravelMateSubscription } from './travelMate/approveSubscription';
export { adminCreateTravelMatePlan, adminUpdateTravelMatePlan, adminDeleteTravelMatePlan } from './travelMate/plans';
export { expireTravelMateSubscriptions } from './travelMate/expireSubscriptions';
// Phase 3 — social (+ Instagram-style message requests)
export {
  sendTravelMateMessage,
  reactToTravelMateMessage,
  unmatchTravelMate,
  reportTravelMateUser,
  acceptTravelMateMessageRequest,
  declineTravelMateMessageRequest,
} from './travelMate/social';
// Phase 3 — admin moderation
export { adminSuspendTravelMateProfile } from './travelMate/moderation';
// Phase 4 — groups + fare split
export { createTravelMateGroup, joinTravelMateGroup, settleTravelMateSplit } from './travelMate/groups';
// Phase 5 — shareable ride links + group chat + private DMs
export { shareTravelMateRide, getSharedTravelMateRide, bookSharedTravelMateRide } from './travelMate/shareRide';
export { sendTravelMateGroupMessage, openTravelMateDirectChat, previewTravelMateGroup } from './travelMate/groupChat';
// Phase 6 — community feed: posts, city communities, follows, DMs, blocks
export {
  createTravelMatePost,
  deleteTravelMatePost,
  likeTravelMatePost,
  commentTravelMatePost,
  deleteTravelMateComment,
  createTravelMateCommunity,
  joinTravelMateCommunity,
  leaveTravelMateCommunity,
  openTravelMateFeedChat,
  blockTravelMateUser,
  unblockTravelMateUser,
} from './travelMate/community';
// Phase 6 — admin moderation of the community feed
export {
  adminUpdateTravelMatePost,
  adminUpsertTravelMateCommunity,
  adminDeleteTravelMateCommunity,
} from './travelMate/adminCommunity';

// Pool ride requests — InDrive-style passenger-initiated negotiation (Task 1 + Task 2)
export {
  createPoolRideRequest,
  driverRespondToRequest,
  leaderRespondToOffer,
  joinPoolRideRequest,
  cancelPoolRideRequest,
  getNearbyPoolRequests,
  getNearbyActiveRides,
} from './poolRideRequests';

// Commute schedules — daily route registration + anonymised driver demand (Task 3)
export { upsertCommuteSchedule, deleteCommuteSchedule, getCommuteDemand } from './commute';

// Scheduled rides — auto-book recurring rides from the Book Ride screen
export { upsertScheduledRide, deleteScheduledRide, runScheduledRides } from './scheduledRides';

// Fare engine — estimate, bid validation, pooling quote, admin seeding
export { getFareEstimate, submitBid, getPoolingQuote, seedFareConfig } from './fare';

// Intercity travel — booking, chat, admin trip management
export {
  createIntercityBooking,
  cancelIntercityBooking,
  sendIntercityMessage,
  adminCreateIntercityTrip,
  adminUpdateIntercityTrip,
  adminCancelIntercityTrip,
  seedIntercityTrips,
} from './intercity';

// Courier delivery — same-city parcel delivery (requires a verified CNIC)
export { createCourierOrder, cancelCourierOrder, adminUpdateCourierStatus } from './couriers';

// Passenger CNIC verification — the identity gate in front of couriers
export { submitCnicVerification, adminReviewCnicVerification } from './users/cnic';

// Freight / business delivery
export { createFreightRequest, cancelFreightRequest, acceptFreightQuote, adminUpdateFreightStatus } from './freight';

// Admin: broadcast push notification
export { adminSendPushNotification } from './users';

// Earn with Velocity — the Partner Program (fleets, referrals, commission)
export {
  submitPartnerApplication,
  adminReviewPartnerApplication,
  getPartnerTiers,
  previewPartnerFleet,
  claimPartnerReferral,
  adminReassignReferral,
  getMyReferral,
  maturePartnerEarnings,
  adminMarkRideStatus,
  requestPartnerWithdrawal,
  adminReviewWithdrawal,
  adminSuspendPartner,
  adminUpdatePartner,
  adminDeletePartner,
  getPartnerDashboard,
  getPartnerFleetMembers,
  getPartnerMemberRides,
  recomputePartnerLevels,
} from './partners';
