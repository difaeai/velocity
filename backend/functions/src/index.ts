/**
 * Velocity backend — Cloud Functions entry point.
 *
 * Region is pinned to asia-south1 (Mumbai), the closest Google Cloud region to
 * Pakistan, to minimise latency for matching and trip updates.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'asia-south1', maxInstances: 20 });

// Users & roles
export { onUserCreate, onUserDelete, setUserRole, banPassenger, resolveDispute, registerFcmToken } from './users';

// Driver onboarding & verification
export { submitDriverOnboarding, approveDriver, rejectDriver, adminCreateDriver, updateDriver, deleteDriver, payCommission, claimDriverRole } from './drivers';

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
} from './poolRides';

// Safety
export { raiseSafetyEvent, resolveSafetyEvent } from './safety';

// Payments
export {
  createTopupIntent,
  paymentWebhook,
  mockConfirmTopup,
  requestPayout,
  markPayoutPaid,
} from './payments';

// Travel Mate — commute-partner matching (identity-walled from ride data)
export { getTravelMateFeed } from './travelMate/feed';
export { upsertTravelMateProfile } from './travelMate/upsertProfile';
export { travelMateSwipe } from './travelMate/swipe';
export { requestTravelMateSubscription } from './travelMate/requestSubscription';
export { approveTravelMateSubscription, rejectTravelMateSubscription } from './travelMate/approveSubscription';
export { adminCreateTravelMatePlan, adminUpdateTravelMatePlan, adminDeleteTravelMatePlan } from './travelMate/plans';
export { expireTravelMateSubscriptions } from './travelMate/expireSubscriptions';
