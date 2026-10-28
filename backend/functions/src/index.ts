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

// Sign-in codes over WhatsApp — the cheap channel, tried first. Every refusal
// answers "use SMS", so the bridge above stays the fallback rather than dead
// code: Meta can pause a template or the recipient may not be on WhatsApp, and
// neither may be able to lock somebody out of the app.
export { startWhatsAppOtp, verifyWhatsAppOtp } from './auth/whatsappOtp';

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

// The verification engine: a driver submits and, a minute later, is driving,
// told exactly what to fix, or in a queue a human clears. `submitDriverOnboarding`
// writes a job rather than waiting — the vision pass over six documents is far
// too slow to hold a callable open on a phone — and `sweepDriverVerificationJobs`
// does the work and writes the verdict onto the driver doc the app streams.
//
// A schedule rather than a Firestore trigger, which would be the obvious
// design: a Gen-2 document trigger runs on Eventarc, this project has never
// had one, and the deploy service account cannot grant itself the service-agent
// roles it would need — so the whole deploy fails, taking every unrelated
// function with it. See the note on the sweeper itself.
export {
  sweepDriverVerificationJobs,
  adminRerunDriverVerification,
  adminVerificationSettings,
} from './drivers/verification';

// The live face scan in front of the papers. The SERVER picks which poses to
// ask for, after the applicant has started, so a photograph of a photograph
// cannot pass: see domain/faceScan.ts.
export { startFaceScan, submitFaceScan } from './drivers/faceScan';

// 02:00 Pakistan time: the papers of every approved driver, checked again.
// Expiry dates were collected at onboarding and, until this job, never read a
// second time — a licence valid in March is not valid in October.
export { sweepDriverDocumentExpiry } from './drivers/documentExpiry';

// The driver's cars, and the photo that says which one they are driving today.
// Adding a car needs an admin's eyes on its papers; photographing the active car
// counts immediately and is reviewed afterwards, so a shift is never lost to a
// queue. Going online without a live photo is blocked by the security rules.
export {
  ensureDriverVehicles,
  addDriverVehicle,
  setActiveVehicle,
  deleteDriverVehicle,
  confirmVehiclePhoto,
  adminReviewDriverVehicle,
  adminReviewVehiclePhoto,
} from './drivers/vehicles';

// Commission settlement (manual bank transfer + AI-verified screenshot)
export { submitCommissionSettlement, adminReviewCommissionSettlement } from './drivers/commissionSettlement';

// 00:05 Pakistan time: tell the drivers whose day just closed short that their
// commission is due. The lock itself needs no job — see drivers/closeDay.ts.
export { notifyClosedCommissionDays } from './drivers/closeDay';

// The daily ride target's credit: the admin lever that grants or claws it back
// by hand (there is no gateway top-up yet), and the per-driver read the
// dashboard uses. The driver's own progress is streamed straight from
// `drivers/{uid}/dailyTargets/{day}` — no callable on the hot path.
export { adminAdjustCommissionCredit, adminGetDriverCommission } from './drivers/commissionCredit';

// Hourly: PKR 1,000 of bonus for a mobile holder, once for every approved driver.
export { grantMobileHolderBonuses } from './drivers/mobileHolderBonus';

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

// The same corridor search, told to the RIDER: who is standing on their road
// and what their own fare drops to if the driver takes them. Riders waiting
// alone in a shared ride could not see any of this before.
export { getEnRouteSavings, askDriverEnRoutePickup } from './trips/enRouteRider';

// Pool ride share links (invite codes, public/private visibility, joining)
export {
  getPoolTripByCode,
  joinPoolTrip,
  driverRespondToPoolJoin,
  coRiderObjectToPoolJoin,
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

// Riders rating the people they shared the car with. A separate relationship
// from submitRating's rider↔driver one, and a separate average — see
// ratings/coRiders for why the two are never added together.
export { getCoRiderRatingTargets, submitCoRiderRating } from './ratings/coRiders';

// The ride record: the admin desk's ledger of every trip, and the full file on
// any one of them. Built for the call that starts "the police are asking".
export { adminListRides, adminGetRideDetail, adminSearchRideParties } from './admin/rideHistory';

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

// "Share my ride with my family" — a live tracking link that opens in any
// browser, with no app and no account. `getTripWatch` is the one callable here
// that is deliberately unauthenticated; the token is the credential.
export { createTripWatchLink, getTripWatch, revokeTripWatchLink } from './trips/watch';
export { sweepTripWatchLinks } from './trips/sweepWatchLinks';
// The ride dash cam: who may watch which clips, "I can't see any passenger",
// and the 24-hour deletion.
export { getDashcamClips, getDashcamProof, checkDashcamCabin, sweepDashcamClips } from './trips/dashcam';

// Velocity Rapid Response System — the complaint desk. AI answers first and
// hands to a person the moment it is out of its depth or is asked to.
export {
  openSupportTicket,
  sendSupportMessage,
  requestHumanAgent,
  markSupportTicketRead,
  rateSupportResolution,
  adminReplySupportTicket,
  adminSetSupportTicketStatus,
  escalateStaleSupportTickets,
} from './support';
// The same desk on the phone: an AI voice answers, and a person takes over the
// moment the caller asks.
export { startHelplineCall, logHelplineCall } from './support/helpline';
export { helplineAction } from './support/helplineActions';

// Free in-app voice calls between a rider and their driver — phone to phone over
// WebRTC, so neither side spends airtime.
export { startCall } from './calls';

// Payments
export {
  getPaymentOptions,
  createTopupIntent,
  paymentCheckout,
  paymentWebhook,
  mockConfirmTopup,
  requestPayout,
  markPayoutPaid,
  adminRejectPayout,
  adminSetSettlementAccounts,
} from './payments';

// Topping up by bank transfer + a screenshot our own OCR engine verifies — the
// path that works before a gateway merchant account exists. See
// payments/manualTopup.ts and domain/topupProof.ts.
export { submitManualTopup, adminReviewManualTopup } from './payments/manualTopup';

// Maps proxy — Places + directions run with the server key, never the client's
export {
  placesAutocomplete,
  placeDetails,
  geocodeAddress,
  getDirections,
} from './maps';
// Deletes cached Google coordinates inside the 30 days the licence allows
export { sweepMapsCache } from './maps/sweepMapsCache';

// Velocity's own map — first-party places, built from completed trips. Unlike the
// Maps cache above, nothing here expires, because nothing here is Google's.
export { promoteTripLocations } from './locations/promote';
export { getPickupPoints } from './locations/pickupPoints';
export {
  adminListVelocityLocations,
  adminReviewVelocityLocation,
  adminAliasVelocityLocation,
  adminMergeVelocityLocations,
} from './locations/admin';

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
export { coarsenTravelMateLocations } from './travelMate/coarseLocation';
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
// Chat management — leave / block / report in 1:1 and group chats, and the
// admin desk that closes the reports out. Trip chat is deliberately excluded:
// a booked ride is not a conversation you can walk out of.
export {
  leaveTravelMateChat,
  leaveTravelMateGroupChat,
  reportTravelMateChat,
  adminResolveTravelMateReport,
} from './travelMate/chatModeration';

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

// Moves a shared ride on when the driver holding it never answered. The ladder
// itself advances on refusals and on feed polls; this is the minute-by-minute
// backstop for the pool whose offered driver simply closed the app.
export { sweepPoolDispatch } from './poolRideRequests/sweepDispatch';

// Stamps `drivers/{uid}.geohash` from the location the handset already writes,
// so the passenger map and the ride broadcast can find drivers by cell instead
// of reading every online driver in the country per call. Centralising that one
// scan here is what makes the per-request cost independent of fleet size —
// lib/nearbyDrivers.ts has the numbers.
export { sweepDriverGeohashes, stampDriverCell } from './drivers/geohashSweeper';

// Commute schedules — daily route registration + anonymised driver demand (Task 3)
export {
  upsertCommuteSchedule, deleteCommuteSchedule, getCommuteDemand, getCommuteMatches,
} from './commute';
export { runCommuteRideFormation } from './commute/formRides';
// Saved daily routes as areas: "Locations people are traveling to".
export { getTravelAreas } from './dailyRoutes/travelAreas';
export { getRouteMates, inviteRouteMates, getMyRideInvites, declineRideInvite } from './dailyRoutes/routeMates';

// Usernames, and the personal fleet they address. A fleet fills a shared car
// BEFORE a driver is asked — see fleet/index.ts for why that ordering is the
// whole feature.
export {
  claimUsername,
  setFleetRoute,
  sendFleetRequest,
  respondFleetRequest,
  removeFleetMember,
  getMyFleet,
  askFleetForRide,
  respondFleetRideAsk,
  cancelFleetRideAsk,
  bookFleetRide,
  inviteFleetToRide,
} from './fleet';

// Shared rides stop more than once. Dropping one rider is not ending the trip.
export { dropOffRider, boardPoolRider } from './trips/dropOff';

// In-ride chat. Sending goes through a callable so the message and the push
// to the other side are one action — direct writes notified nobody.
export { sendTripMessage } from './trips/chat';

// Retire ride requests nobody is waiting on — clears the driver feed of
// rides that were cancelled, taken, or simply abandoned mid-request.
export { sweepStaleOpenRequests } from './trips/sweepStaleRequests';
// A trip left in_progress (the driver's phone died) locks its rider out of
// booking; the sweep closes it after a day, the desk can close it at once.
export { sweepStuckTrips, adminForceEndTrip } from './trips/stuckTrips';

// The same job for the two shared-ride offer collections: a driver's posted
// ride whose departure time came and went without boarding, and a riders' pool
// that ran out of time without a driver. Neither had an ending of its own —
// and an abandoned pool ride also counted as "live work", which locked its
// driver out of ever switching cars.
export { sweepStaleSharedRides } from './poolRides/sweepStaleSharedRides';

// Scheduled rides — auto-book recurring rides from the Book Ride screen
export { upsertScheduledRide, deleteScheduledRide, runScheduledRides } from './scheduledRides';

// Fare engine — estimate, bid validation, pooling quote, admin seeding
export { getFareEstimate, getFareContext, submitBid, getPoolingQuote, getSharedRideFare, seedFareConfig } from './fare';
export {
  getMarketComparison, reportCompetitorQuote,
  adminUpsertMarketRates, adminDeleteMarketRates, adminFitMarketRates, adminMarketPosition,
} from './fare';
// …and the daily run that keeps those cards true without anyone pressing a
// button. See fare/marketRefresh.ts — it refits from rider reports only; there
// is still no lawful source for a competitor's published fare.
export {
  refreshMarketRates, adminRefreshMarketRates, adminMarketRunReport,
} from './fare';

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
  sendBusinessAdQuery,
  replyBusinessAdQuery,
  markBusinessAdQueryRead,
  setBusinessAdQueryBlock,
  reportBusinessAdQuery,
  adminResolveBusinessAdQueryReport,
  adminBackfillBusinessAdViewers,
} from './businessAds';

// Admin: broadcast push notification
export { adminSendPushNotification } from './users';

// WhatsApp alerts for OFFLINE drivers — the one channel that reaches a driver
// whose app is closed. Opt-in only, capped, and with a circuit breaker that
// stops every send the moment Meta pushes back (see whatsapp/policy.ts).
export { setWhatsAppAlerts, whatsappWebhook } from './whatsapp';
export {
  adminGetWhatsAppStatus,
  adminSetWhatsAppAlertSettings,
  adminSetWhatsAppOtpSettings,
  adminSendWhatsAppTest,
} from './whatsapp/admin';

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
  adminGetMetaConnectState,
  adminSetMetaApp,
  adminStartMetaConnect,
  adminFinishMetaConnect,
  adminChooseMetaPage,
  adminConnectAdsToken,
  adminGetGoogleAdsState,
  adminSetGoogleAdsApp,
  adminStartGoogleAdsConnect,
  adminFinishGoogleAdsConnect,
  adminChooseGoogleAdsAccount,
  adminDisconnectGoogleAds,
  adminGoogleAdsSummary,
  adminGetSocialRoles,
  adminHireSocialEmployee,
  adminUpdateSocialEmployee,
  adminFireSocialEmployee,
  adminSeedSocialTeam,
  adminGetSocialSettings,
  adminUpdateSocialSettings,
  adminPlanSocialMonth,
  adminEditPlanSlot,
  adminLaunchMarket,
  socialLaunchSweep,
  socialDailyContent,
  socialPublishSweep,
  adminGenerateSocialPost,
  adminRequestSocialChanges,
  adminReviewSocialPost,
  adminPublishSocialPost,
  adminRenderSocialPost,
  adminAttachSocialMedia,
  adminDeleteSocialPost,
  socialAdsSync,
  adminSyncAds,
  adminSetAdsSettings,
  adminCreateAd,
  adminDesignAd,
  adminAdAction,
  socialEngagement,
  adminSyncSocialComments,
  adminReplySocialComment,
  adminSetCommentStatus,
  socialPageRead,
  socialProfileAudit,
  adminReadOwnPage,
  adminAuditProfile,
} from './social';

// Velocity Studio — the desk sold to other businesses: sign-up, manual payments, approvals
export {
  studioCreateWorkspace,
  studioSubmitPayment,
  adminDecideStudioPayment,
  adminManageStudioCustomer,
} from './studio';
// Velocity Studio credits: a day of the team's work at a time, spent only when it would otherwise stop.
export { studioCreditSweep, studioUsage } from './studio/credits';
// Velocity Studio sign-up: the emailed code and the mailbox it comes from.
export { studioTouch, studioSendEmailCode, studioVerifyEmailCode } from './studio/emailCode';
export { adminSetStudioMailer } from './studio/mailer';

// The sales agent — find businesses, write to each, follow up twice, and draft an answer to every reply;
// its calling agents write a call script per business for the person who dials
export {
  salesGetSettings,
  salesSaveSettings,
  salesFindLeads,
  salesAddLeads,
  salesWriteEmails,
  salesLeadAction,
  salesCallScript,
  salesSweep,
} from './sales';

// What Velocity pays its vendors — pulled from Google Cloud, Anthropic and Meta
export { refreshPlatformCosts, adminRefreshPlatformCosts } from './costs';

// ── Pricing Engine ──────────────────────────────────────────────────────────
// Fuel-linked per-km rates, a capped demand/supply peak factor, detection of
// manufactured scarcity, and a FIFO driver queue. See src/pricing/index.ts.
//
// `refreshFuelPrices` runs daily at 06:15 Asia/Karachi; `runPricingTick` every
// minute. The tick is what finally writes `surge/{cityId}_{zone}`, which the
// fare engine has been reading — and defaulting to 1.0 — since it was written.
export {
  getPricingSnapshot,
  getDriverQueueStatus,
  adminGetPricingEngine,
  adminUpdatePricingEngine,
  adminRefreshFuelPrices,
  adminRunPricingTick,
  adminSetFuelPrice,
  adminClearSupplyFreeze,
  seedPricingEngine,
  refreshFuelPrices,
  runPricingTick,
} from './pricing';

// ── Road alerts ─────────────────────────────────────────────────────────────
// What is closed, blocked or crashed on the way, read off fourteen Pakistani
// news feeds and refused aggressively — see src/traffic/classify.ts, where the
// refusals are the actual feature. `refreshTrafficAlerts` runs every 20
// minutes; `getTrafficAlerts` answers both "anything in my city?" (the rider's
// booking screen) and "anything on my route?" (the driver's).
export {
  getTrafficAlerts,
  adminGetTrafficRun,
  adminRefreshTrafficAlerts,
  refreshTrafficAlerts,
} from './traffic';

// ── Testing agent ───────────────────────────────────────────────────────────
// Velocity testing itself. `runQaAgent` wakes every 15 minutes and asks whether
// the features are keeping the promises they were built to keep (src/qa/checks.ts);
// `reportFeatureCheck` is how the app says a tap did not do its job. Both write
// one date-wise, prompt-shaped log the admin Testing page reads. Nothing is
// written when a feature is fine — see src/qa/log.ts for why.
export { runQaAgent, qaRunChecksNow, sweepQaLogs } from './qa/agent';
export { reportFeatureCheck } from './qa/report';

// Manage social → AI keys & usage: Gemini keys per slot (house / customers /
// voice), monthly budgets per workspace, and the meter every call writes to.
export { adminAiOverview, adminAiSetKey, adminAiRemoveKey, adminAiTestKey, adminAiSetBudgets } from './ai/admin';

// AI agents that phone leads (Twilio → voice bridge → Gemini Live) and answer
// WhatsApp, with the admin's rate card, numbers and each customer's package.
export {
  agentSweep,
  agentState,
  agentStartCall,
  agentVoiceAnswer,
  agentVoiceSession,
  agentVoiceResult,
  agentVoiceStatus,
  agentWhatsappWebhook,
  agentSaveWhatsApp,
  agentDisconnectWhatsApp,
  agentThreadAction,
  adminAgentsOverview,
  adminAgentsConnectTwilio,
  adminAgentsNumbers,
  adminAgentsSetRateCard,
  adminAgentsSetPlan,
} from './agents';
