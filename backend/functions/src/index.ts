/**
 * Velocity backend — Cloud Functions entry point.
 *
 * Region is pinned to asia-south1 (Mumbai), the closest Google Cloud region to
 * Pakistan, to minimise latency for matching and trip updates.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'asia-south1', maxInstances: 20 });

// Users & roles
export { onUserCreate, onUserDelete, setUserRole } from './users';

// Driver onboarding & verification
export { submitDriverOnboarding, approveDriver, rejectDriver } from './drivers';

// Trip lifecycle
export {
  createTrip,
  placeBid,
  acceptBid,
  updateTripStatus,
  cancelTrip,
  completeTrip,
} from './trips';

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
