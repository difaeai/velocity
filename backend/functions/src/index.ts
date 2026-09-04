/**
 * Velocity backend — Cloud Functions entry point.
 *
 * Region is pinned to asia-south1 (Mumbai), the closest Google Cloud region to
 * Pakistan, to minimise latency for matching and trip updates.
 */
import { setGlobalOptions } from 'firebase-functions/v2';

/**
 * maxInstances is a CEILING, not a reservation: an instance that is not serving
 * a request costs nothing, so this number does not change the bill at today's
 * traffic. What it changes is what happens at a spike.
 *
 * It was 20. A 2nd-gen function running on the default 256 MiB gets less than a
 * full vCPU, and Cloud Run forces concurrency to 1 below 1 CPU — so 20 was 20
 * requests in flight across the WHOLE backend. That is fine for a handful of
 * people and wrong for a launch: a hundred riders opening the app at once are
 * already most of it, and everything past the cap queues and then times out.
 *
 * Sign-in is where that hurts most and is least forgivable. `exchangePhoneSession`
 * is on this path — every OTP that is typed correctly ends here — and it makes a
 * network round trip of its own (`verifyIdToken` with checkRevoked), so it holds
 * an instance for a few hundred milliseconds. A queue in front of it turns a
 * correct code into an error on the screen of somebody who did nothing wrong and
 * has already spent their SMS.
 *
 * 100 leaves room for a thousand people signing up in the same hour while still
 * being a hard stop against a runaway loop.
 *
 * If sign-ups ever outgrow this, the next lever is CPU rather than instances:
 * `cpu: 1` on the callables lets Cloud Run put concurrency back to 80, which is
 * far cheaper per request than 80 single-request instances.
 */
setGlobalOptions({ region: 'asia-south1', maxInstances: 100 });

// Sign-in bridge: native (Play Integrity attested) phone verification → JS SDK session
export { exchangePhoneSession } from './auth/sessionExchange';

// Users & roles
export {
  onUserCreate, onUserDelete,
  setUserRole, banPassenger, createDispute, resolveDispute, registerFcmToken,
  adminCreatePassenger, adminUpdatePassenger, adminDeletePassenger,
  uploadUserPhoto,
} from './users';

// The user deletes their own account — App Store guideline 5.1.1(v) requires
// this to exist inside the app, not behind a link to the website.
export { deleteMyAccount } from './users/deleteAccount';

// Driver onboarding & verification
export { submitDriverOnboarding, approveDriver, rejectDriver, adminCreateDriver, updateDriver, deleteDriver, payCommission, claimDriverRole } from './drivers';

// Commission settlement (manual bank transfer + AI-verified screenshot)
export { submitCommissionSettlement, adminReviewCommissionSettlement } from './drivers/commissionSettlement';

// Cancellation-fee settlement — same proof flow, open to passengers and drivers
export { submitCancellationFeeSettlement } from './payments/cancellationFees';

// Franchise management
export { adminCreateFranchise, adminAssignFranchise } from './franchises';

// Franchise portal — a Pro partner's own web dashboard for building their fleet
export {
  getFranchisePortal,
  adminRotatePartnerPortal,
  franchiseSubmitDriver,
  franchiseListDrivers,
  franchiseWithdrawSubmission,
  adminListDriverSubmissions,
  adminReviewDriverSubmission,
} from './franchise';

// Trip lifecycle
export {
  createTrip,
  placeBid,
  raiseTripFare,
  acceptBid,
  declineBid,
  updateTripStatus,
  cancelTrip,
  completeTrip,
} from './trips';

// Driver reports a fake / abusive request from the open-requests feed
export { reportOpenRequest } from './trips/reports';

// Passenger home map — anonymised live supply (cars) + demand (waiting riders)
export { getNearbyActivity } from './trips/nearbyActivity';

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
  driverRespondToPoolJoin,
  cancelPoolTripJoinRequest,
  getPoolJoinRequests,
  setPoolVisibility,
  getNearbyPublicPoolTrips,
} from './trips/poolShare';

// One feed for every shared car near you that still has a seat, whichever of
// the three pooling subsystems that seat happens to live in.
export { getSuggestedRides } from './trips/suggestedRides';

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

// Maps proxy — Places + directions run with the server key, never the client's
export {
  placesAutocomplete,
  placeDetails,
  geocodeAddress,
  getDirections,
} from './maps';

// Saved payment methods — connected Easypaisa/JazzCash/bank/card instruments
export {
  getPaymentMethods,
  createPaymentMethodSetup,
  paymentMethodSetupPage,
  paymentMethodCallback,
  mockConfirmPaymentMethod,
  setDefaultPaymentMethod,
  deletePaymentMethod,
  topupWithSavedMethod,
} from './payments/paymentMethods';

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
  driverRespondToPoolRequestJoin,
  getPoolRequestJoinRequests,
  cancelPoolRideRequest,
  respondToPoolGoAnyway,
  getNearbyPoolRequests,
  getNearbyActiveRides,
} from './poolRideRequests';

// Commute schedules — daily route registration + anonymised driver demand (Task 3)
export { upsertCommuteSchedule, deleteCommuteSchedule, getCommuteDemand } from './commute';

// Shared rides stop more than once. Dropping one rider is not ending the trip.
export { dropOffRider } from './trips/dropOff';

// In-ride chat. Sending goes through a callable so the message and the push
// to the other side are one action — direct writes notified nobody.
export { sendTripMessage } from './trips/chat';

// Retire ride requests nobody is waiting on — clears the driver feed of
// rides that were cancelled, taken, or simply abandoned mid-request.
export { sweepStaleOpenRequests } from './trips/sweepStaleRequests';

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

// Find your Customers — business proximity advertising (paid radius + push offers)
export {
  getBusinessAdPlans,
  submitBusinessAdApplication,
  adminReviewBusinessAdApplication,
  createBusinessAd,
  updateBusinessAd,
  setBusinessAdStatus,
  adminSetBusinessAdStatus,
  adminSuspendAdvertiser,
  adminUpdateBusinessAdSettings,
  checkNearbyBusinessAds,
  recordBusinessAdClick,
  getBusinessAdDashboard,
  expireBusinessAdPlans,
  sendBusinessAdDemoNotification,
} from './businessAds';

// Admin: broadcast push notification
export { adminSendPushNotification } from './users';

// WhatsApp alerts for OFFLINE drivers — the one channel that reaches a driver
// whose app is closed. Opt-in only, capped, and with a circuit breaker that
// stops every send the moment Meta pushes back (see whatsapp/policy.ts).
export { setWhatsAppAlerts, whatsappWebhook } from './whatsapp';
export { adminGetWhatsAppStatus, adminSetWhatsAppAlertSettings, adminSendWhatsAppTest } from './whatsapp/admin';

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

// Special Rides — daily vehicle rental with/without drivers
export {
  submitSpecialRidesApplication,
  adminReviewSpecialRidesApplication,
  getSpecialRidesDashboard,
  adminSuspendHost,
  getSpecialRidesListings,
  getSpecialRidesListingDetails,
  updateSpecialRidesApplication,
  deleteSpecialRidesListing,
  bookSpecialRidesCar,
  confirmSpecialRidesBooking,
  cancelSpecialRidesBooking,
} from './specialRides';

// Admin dashboard analytics — daily series + live snapshot, cached per day
export { adminGetAnalytics } from './analytics';

// Social desk — the staff, the accounts they post to, and the inbox
export {
  adminConnectSocialAccount,
  adminDisconnectSocialAccount,
  adminVerifySocialAccount,
  adminGetSocialConnectSchema,
  adminGetSocialRoles,
  adminHireSocialEmployee,
  adminUpdateSocialEmployee,
  adminFireSocialEmployee,
  adminSeedSocialTeam,
  adminGetSocialSettings,
  adminUpdateSocialSettings,
  socialDailyContent,
  adminGenerateSocialPost,
  adminRequestSocialChanges,
  adminReviewSocialPost,
  adminPublishSocialPost,
  adminAttachSocialMedia,
  adminDeleteSocialPost,
  socialEngagement,
  adminSyncSocialComments,
  adminReplySocialComment,
  adminSetCommentStatus,
} from './social';

// What Velocity pays its vendors — pulled from Google Cloud, Anthropic and Meta
export { refreshPlatformCosts, adminRefreshPlatformCosts } from './costs';
