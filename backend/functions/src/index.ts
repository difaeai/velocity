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

// Travel Mate — commute-partner matching (identity-walled from ride data)
export { getTravelMateFeed } from './travelMate/feed';
export { upsertTravelMateProfile } from './travelMate/upsertProfile';
export { travelMateSwipe } from './travelMate/swipe';
export { requestTravelMateSubscription } from './travelMate/requestSubscription';
export { approveTravelMateSubscription, rejectTravelMateSubscription } from './travelMate/approveSubscription';
export { adminCreateTravelMatePlan, adminUpdateTravelMatePlan, adminDeleteTravelMatePlan } from './travelMate/plans';
export { expireTravelMateSubscriptions } from './travelMate/expireSubscriptions';
// Phase 3 — social
export { sendTravelMateMessage, unmatchTravelMate, reportTravelMateUser } from './travelMate/social';
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

// Courier delivery — same-city parcel delivery
export { createCourierOrder, cancelCourierOrder, adminUpdateCourierStatus } from './couriers';

// Freight / business delivery
export { createFreightRequest, cancelFreightRequest, acceptFreightQuote, adminUpdateFreightStatus } from './freight';

// Admin: broadcast push notification
export { adminSendPushNotification } from './users';
