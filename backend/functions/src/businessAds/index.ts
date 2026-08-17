/**
 * "Find your Customers" — business proximity advertising.
 *
 * A business buys a radius and a plan length, a human approves the payment
 * screenshot, and from then on their offer is pushed to Velocity users who come
 * within that radius — once per person per cooldown window, inside a daily
 * per-person ceiling. The advertiser sees pushes, unique reach and opens.
 */
export {
  getBusinessAdPlans,
  submitBusinessAdApplication,
  adminReviewBusinessAdApplication,
} from './applications';

export {
  createBusinessAd,
  updateBusinessAd,
  setBusinessAdStatus,
  adminSetBusinessAdStatus,
  adminSuspendAdvertiser,
  adminUpdateBusinessAdSettings,
} from './ads';

export { checkNearbyBusinessAds, recordBusinessAdClick } from './nearby';
export { sendBusinessAdDemoNotification } from './demo';
export { getBusinessAdDashboard } from './stats';
export { expireBusinessAdPlans } from './expire';
