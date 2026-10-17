/**
 * What every feature was BUILT to do — the registry the whole QA engine judges against.
 * ----------------------------------------------------------------------------
 * WHY A REGISTRY AND NOT JUST ERROR LOGS
 * Crash reporting answers "what threw". It cannot answer the question that
 * actually matters here: *was this feature doing the job it was built for?* A
 * screen that opens, renders, throws nothing and shows an empty list is a
 * perfectly healthy crash report and a completely broken feature.
 *
 * So each feature gets a contract: one sentence saying what it is FOR, a time
 * budget past which a user would call it broken, the files that implement it,
 * and the ways it has actually broken before. A failure is then not "an error
 * occurred" but "this promise was not kept", which is the only form a log can
 * take if somebody is going to read it tomorrow and fix something.
 *
 * `knownCauses` is the part that earns its keep. Every entry in it is a bug this
 * codebase really had — a sentinel value inside an array, Expo tokens posted to
 * the wrong transport, a pool joiner written into `poolMembers` and billed
 * nowhere. When a report's signature matches one, the log says what it probably
 * is and what fixed it last time instead of making the reader rediscover it.
 *
 * HONESTY RULE
 * When nothing matches, the log says nothing matched. A plausible-sounding
 * invented cause is worse than no cause at all: it sends the next person to the
 * wrong file and they come back trusting these logs less.
 *
 * KEEPING IT HONEST OVER TIME
 * The test suite checks every `code` path still exists — a contract pointing at
 * a file somebody deleted fails CI rather than quietly misleading a reader. Add
 * a feature here the day you add the feature; the ids the app reports live in
 * apps/mobile/src/lib/featureCheck.ts and are checked against this list.
 */

/** The part of the business a feature belongs to. Groups the admin log. */
export type QaArea =
  | 'Sign-in'
  | 'Booking'
  | 'Shared rides'
  | 'Driver'
  | 'Money'
  | 'Safety'
  | 'Platform';

export const QA_AREAS: readonly QaArea[] = [
  'Sign-in',
  'Booking',
  'Shared rides',
  'Driver',
  'Money',
  'Safety',
  'Platform',
];

/**
 * How bad it is when this feature does not work.
 *
 * `core` means nobody can use Velocity for its purpose — booking a ride, a
 * driver earning, somebody calling for help. A `core` feature that throws is a
 * blocker; everything else is reported as broken or degraded.
 */
export type QaCriticality = 'core' | 'normal';

/** The shape of a failure, as the watcher saw it. */
export type QaFailureKind =
  /** The call or the handler threw. */
  | 'threw'
  /** It completed, and came back with nothing where something was promised. */
  | 'empty'
  /** It completed, too late to be the feature it was meant to be. */
  | 'slow'
  /** It completed and nothing changed — the tap did nothing at all. */
  | 'no_effect'
  /** It completed with a result that breaks the feature's own rules. */
  | 'wrong_result';

export const QA_FAILURE_KINDS: readonly QaFailureKind[] = [
  'threw',
  'empty',
  'slow',
  'no_effect',
  'wrong_result',
];

export type QaSeverity = 'blocker' | 'broken' | 'degraded';

/** A way this feature has broken before, and what fixed it. */
export interface KnownCause {
  /**
   * Matched against `"<kind> <errorCode> <errorMessage>"`, lower-cased. Keep it
   * specific: a pattern that matches everything turns every log into this one
   * diagnosis and buries the real cause.
   */
  signal: RegExp;
  /** What is actually going on when that signature appears. */
  because: string;
  /** What to do about it, concretely enough to start work from. */
  fix: string;
}

export interface FeatureContract {
  id: string;
  area: QaArea;
  title: string;
  /** One sentence. What a user who taps this is entitled to get. */
  designedTo: string;
  criticality: QaCriticality;
  /**
   * How long the whole interaction may take before it has failed as a feature.
   * Generous: this is the point a user gives up, not a performance target.
   */
  budgetMs: number;
  /** Repo-relative paths. Where a fix starts. */
  code: string[];
  knownCauses: KnownCause[];
}

/**
 * Causes that are about the plumbing rather than any one feature, so they are
 * worth checking against every report.
 *
 * They are tried LAST, after the feature's own causes, because "your connection
 * dropped" explains anything and would eat every specific diagnosis if it went
 * first.
 */
export const SHARED_CAUSES: readonly KnownCause[] = [
  {
    signal: /unauthenticated/,
    because:
      'The call left the phone without a signed-in user. Either the session expired mid-tap, or the screen is reachable before sign-in has finished.',
    fix: 'Check the screen sits behind the auth gate, and that the custom-token sign-in (apps/mobile/src/auth/phoneSignIn.ts) completed before the screen mounted.',
  },
  {
    signal: /permission-denied/,
    because:
      'Firestore rules refused a direct read or write. The app is reaching for a document the rules do not grant it — that data belongs behind a callable.',
    fix: 'Find the path in firestore.rules. If the app legitimately needs it, move the operation into a callable rather than widening the rule.',
  },
  {
    signal: /resource-exhausted|too many|rate ?limit/,
    because:
      'A rate limit fired (backend/functions/src/lib/ratelimit.ts). Either the user is tapping repeatedly, or the screen is calling from a render path.',
    fix: 'Check the caller is not in a render path or an unbounded poll. If the limit is simply too tight for honest use, raise it where it is declared.',
  },
  {
    signal: /unavailable|deadline-exceeded|network|timeout|offline/,
    because:
      'The round trip never completed. On a Pakistani mobile connection this is ordinary; it only matters as a share of taps, or when it lands on one feature and nothing else.',
    fix: 'Nothing to fix for a handful. If it is one feature only, look for a cold start (a function with no warm instance) or a payload large enough to time out.',
  },
  {
    signal: /internal/,
    because:
      'The callable threw something that was not an HttpsError, so the client was handed a bare "internal". The real error exists only in the Cloud Run log.',
    fix: 'Find the invocation in the function logs by timestamp, then wrap the throwing path in a real HttpsError so the next failure explains itself on the phone.',
  },
];

/**
 * The contracts.
 *
 * Deliberately not exhaustive over every button in the app — a registry nobody
 * maintains is worse than a short one that is true. These are the surfaces whose
 * failure a user would describe as "the app does not work".
 */
export const FEATURE_CONTRACTS: readonly FeatureContract[] = [
  // ── Sign-in ────────────────────────────────────────────────────────────────
  {
    id: 'auth.otp.request',
    area: 'Sign-in',
    title: 'Send me a code',
    designedTo:
      'Put a six-digit code on the phone of whoever typed the number, within a few seconds.',
    criticality: 'core',
    budgetMs: 12_000,
    code: ['apps/mobile/src/auth/phoneSignIn.ts', 'backend/functions/src/auth/whatsappOtp.ts'],
    knownCauses: [
      {
        signal: /auth\/unknown|ref: ?unknown/,
        because:
          'Firebase returns auth/unknown for a console misconfiguration, never for a code bug: a missing SHA-256 for this build, an API key restriction, or Play Integrity not enabled for the package.',
        fix: 'Long-press the error line in the app to read the native message, then fix it in the Firebase console — SHA-256 fingerprints, API key restrictions, Play Integrity. Nothing in this repo will change it.',
      },
      {
        signal: /error-code: ?-39|too-many-requests|throttl/,
        because: 'The SMS path is throttled for this number or this device.',
        fix: 'Confirm the native RNFirebase path is in use (not the old WebView reCAPTCHA), and that the WhatsApp code is tried before Firebase SMS.',
      },
      {
        signal: /slow/,
        because:
          'A cold start. Codes measured 4–11 s from cold against 1.6 s warm, which is the difference between "it works" and "it is broken".',
        fix: 'Check the warm pings are reaching the OTP functions (backend/functions/src/lib/warmup.ts), and that the build on the phone actually sends them.',
      },
    ],
  },
  {
    id: 'auth.profile.complete',
    area: 'Sign-in',
    title: 'Finish your profile',
    designedTo: 'Save name, gender and date of birth once, and never ask again.',
    criticality: 'core',
    budgetMs: 8_000,
    code: ['apps/mobile/src/api/client.ts', 'backend/functions/src/users'],
    knownCauses: [
      {
        signal: /invalid-argument.*(dob|date)/,
        because:
          'The date tiles produced something the backend schema rejects — day/month/year assembled out of order, or a partial date sent as a whole one.',
        fix: 'Check the three tiles are combined into YYYY-MM-DD before the call, and that an incomplete date disables the button rather than being sent.',
      },
    ],
  },

  // ── Booking ────────────────────────────────────────────────────────────────
  {
    id: 'booking.request',
    area: 'Booking',
    title: 'Book a ride',
    designedTo:
      'Turn the pickup, the drop-off and the fare into a live request that every nearby driver can see.',
    criticality: 'core',
    budgetMs: 15_000,
    code: ['apps/mobile/app/passenger/booking.tsx', 'backend/functions/src/trips/index.ts'],
    knownCauses: [
      {
        signal: /active (ride|trip)|already have/,
        because:
          'users/{uid}.activeTripId still points at a ride that is over, so the backend refuses a second one. The rider is locked out of booking by a trip that stopped existing in every sense except the database.',
        fix: 'Clear the dangling pointer — the agent check users.activeTrip.dangling lists them — then fix the path that ended that trip so it clears activeTripId for the passenger AND every pool member.',
      },
      {
        signal: /empty|no_effect/,
        because:
          'The request may exist while no driver can see it: `openRequests` is the driver-readable mirror of the trip, written in the same transaction, so a trip without one is invisible.',
        fix: 'Run the agent check requests.feed.mirror. If trips are missing their mirror, the createTrip transaction is partially failing — look for a write that sits outside it.',
      },
      {
        signal: /failed-precondition.*(commission|outstanding)/,
        because: 'A money gate refused the booking.',
        fix: 'Check the gate is meant to apply to riders at all — the commission lock is a driver-side rule (backend/functions/src/domain/commission.ts).',
      },
    ],
  },
  {
    id: 'booking.fare.quote',
    area: 'Booking',
    title: 'Fare estimate and the market comparison',
    designedTo:
      'Show a fare before anyone commits, and show honestly what inDrive and Yango would charge for the same road.',
    criticality: 'normal',
    budgetMs: 10_000,
    code: ['apps/mobile/src/lib/fareEngine.ts', 'backend/functions/src/pricing/functions.ts'],
    knownCauses: [
      {
        signal: /empty/,
        because:
          'No comparison came back. The cards refit themselves from rider reports, so a city with no observations deliberately has nothing to show.',
        fix: 'Check marketRates/{cityId} exists for this city before treating it as a bug; refusing to print a number we do not have is the feature.',
      },
    ],
  },
  {
    id: 'booking.places.search',
    area: 'Booking',
    title: 'Search for a place',
    designedTo:
      'Find the place somebody typed — our own places first, Google only when ours has nothing.',
    criticality: 'core',
    budgetMs: 8_000,
    code: [
      'apps/mobile/src/hooks/places.ts',
      'backend/functions/src/maps',
      'backend/functions/src/locations',
    ],
    knownCauses: [
      {
        signal: /request_denied|api key|not authorized/,
        because: 'The Maps key was refused — a restriction, billing, or the wrong key for the API being called.',
        fix: 'Check the key fingerprint and its API restrictions. Geocoding, not Text Search, is the API this path uses.',
      },
      {
        signal: /empty/,
        because:
          'Neither velocityLocations nor Geocoding matched the text. Ordinary for a misspelling, a bug if it is every search.',
        fix: 'If every search is empty, check the server key is configured at all — the whole path degrades to nothing without it.',
      },
    ],
  },
  {
    id: 'booking.voice',
    area: 'Booking',
    title: 'Book by voice',
    designedTo:
      'Hear a destination spoken in Urdu or English, on the device, and fill the booking screen in with it.',
    criticality: 'normal',
    budgetMs: 20_000,
    code: ['apps/mobile/app/passenger/voice.tsx'],
    knownCauses: [
      {
        signal: /permission|denied.*(mic|audio)/,
        because: 'Microphone permission was refused, or never asked for.',
        fix: 'Check the prompt fires before the recorder starts, and that a refusal offers the keyboard instead of failing.',
      },
      {
        signal: /empty|no_effect/,
        because:
          'The on-device parser understood nothing. It is a rules parser with no cloud model behind it, so unusual phrasings legitimately fall through.',
        fix: 'Add the phrasing to the parser rules if it is common. Never route this to a paid model; zero cost is the point of the feature.',
      },
    ],
  },

  // ── Shared rides ───────────────────────────────────────────────────────────
  {
    id: 'shared.book',
    area: 'Shared rides',
    title: 'Book a shared ride',
    designedTo:
      'Book a seat at the server-fixed shared fare, and keep it joinable by riders going the same way.',
    criticality: 'core',
    budgetMs: 15_000,
    code: ['backend/functions/src/poolRides', 'backend/functions/src/trips/poolShare.ts'],
    knownCauses: [
      {
        signal: /gender|mixed/,
        because:
          'The gender rules refused the composition. That is the feature working — unless the rider was never asked for a preference.',
        fix: 'Check the shared-ride gender pill was answered before this screen. It gates every shared-ride entry, and must never appear in the solo path.',
      },
      {
        signal: /offeredfare|fare/,
        because:
          'A client-side fare reached a shared booking. Shared fares are server-priced and createTrip ignores the client offer.',
        fix: 'Leave the fare out of the shared-ride call entirely. A shared ride is never negotiable.',
      },
    ],
  },
  {
    id: 'shared.join',
    area: 'Shared rides',
    title: 'Join someone else’s shared ride',
    designedTo:
      'Put a rider into an existing car and cut everyone’s fare, with seats and the gender rules enforced server-side.',
    criticality: 'normal',
    budgetMs: 15_000,
    code: ['backend/functions/src/trips/poolShare.ts', 'apps/mobile/app/passenger/pool-join'],
    knownCauses: [
      {
        signal: /wrong_result|fare/,
        because:
          'A joiner written into `poolMembers` but not into `poolRiders` is never billed, never counted as a seat, and never seen by the next gender check — such a trip settles from the leg-split total.',
        fix: 'Price the joiner through priceShareJoinerOnto (backend/functions/src/trips/enRoute.ts) instead of bumping the member list, and run the agent check pool.riders.unbilled.',
      },
    ],
  },
  {
    id: 'shared.enroute.offer',
    area: 'Shared rides',
    title: 'Riders on your way (driver)',
    designedTo:
      'Offer a driver only the pool riders standing on the road they are already driving, priced so everybody pays less and the driver earns more.',
    criticality: 'normal',
    budgetMs: 20_000,
    code: ['backend/functions/src/trips/enRoute.ts', 'apps/mobile/app/driver/en-route.tsx'],
    knownCauses: [
      {
        signal: /invalid.*array|sentinel|servertimestamp/,
        because:
          'Firestore rejects sentinel values inside arrays. `poolRiders` is an array, so a serverTimestamp() in a rider record fails the whole write — which is exactly what made every pickup fail until it became a plain Timestamp.',
        fix: 'Use Timestamp.now() for anything that goes inside an array. Never FieldValue.serverTimestamp().',
      },
      {
        signal: /empty/,
        because:
          'No rider passed the four corridor gates. Normal on a quiet road; suspicious when the driver is on a busy corridor with a wide radius.',
        fix: 'Check config/enRouteSettings is enabled, and that the radius the driver chose reached the backend — the feed and the accept path must use the same one.',
      },
    ],
  },
  {
    id: 'shared.enroute.savings',
    area: 'Shared rides',
    title: 'Riders on your way (rider)',
    designedTo:
      'Show a rider waiting alone in a shared ride the people standing along their road, and what their own fare drops to if the driver takes them.',
    criticality: 'normal',
    budgetMs: 20_000,
    code: [
      'backend/functions/src/trips/enRouteRider.ts',
      'apps/mobile/src/ui/EnRouteSavingsCard.tsx',
    ],
    knownCauses: [
      {
        signal: /empty/,
        because:
          'Nobody is on this road right now. Expected most of the time — the card is built to disappear rather than to show a zero.',
        fix: 'Nothing, unless the corridor could not be built at all. Then check whether a route came back from Maps for this trip.',
      },
      {
        signal: /failed-precondition.*(driver|matched)/,
        because: 'The rider asked the driver to pick somebody up before a driver existed.',
        fix: 'The ask button may only render once the trip has a driver. The savings figure shows before that; the ask does not.',
      },
    ],
  },

  // ── Driver ─────────────────────────────────────────────────────────────────
  {
    id: 'driver.online',
    area: 'Driver',
    title: 'Go online',
    designedTo: 'Put a verified driver into the nearby-driver index, so requests reach them within a minute.',
    criticality: 'core',
    budgetMs: 10_000,
    code: ['apps/mobile/app/driver/home.tsx', 'backend/functions/src/drivers/geohashSweeper.ts'],
    knownCauses: [
      {
        signal: /permission-denied/,
        because:
          'The rules gate going online on a live car photo (carPhotoIsLive). A driver whose photo has aged out is refused by design.',
        fix: 'Send them to Your cars to retake it. The 30-day rule is implemented in the rules, the backend and the app, and all three have to agree.',
      },
      {
        signal: /empty|no_effect/,
        because:
          'Online but invisible: `drivers/{uid}.geohash` is server-owned, and the bounded lookup only finds drivers who have a cell stamped.',
        fix: 'Check stampDriverCell is called at shift start — the once-a-minute sweep leaves a 60 s blind window that the shift-start call exists to close.',
      },
    ],
  },
  {
    id: 'driver.feed',
    area: 'Driver',
    title: 'Ride requests feed',
    designedTo: 'Show a driver every live request near them, and nothing that has already ended.',
    criticality: 'core',
    budgetMs: 12_000,
    code: ['apps/mobile/src/hooks/driver.ts', 'backend/functions/src/trips/sweepStaleRequests.ts'],
    knownCauses: [
      {
        signal: /empty/,
        because:
          'No open request near this driver — or their cell is not stamped, so the geographic query cannot reach them at all.',
        fix: 'Rule out the geohash first (agent check drivers.cell.missing), then check whether any openRequests exist.',
      },
      {
        signal: /wrong_result/,
        because: 'Dead rides in the feed: an openRequests document whose trip has already finished or been cancelled.',
        fix: 'The five-minute sweep deletes those. If they persist the sweep is failing — check its logs and the agent check requests.feed.orphans.',
      },
    ],
  },
  {
    id: 'driver.bid',
    area: 'Driver',
    title: 'Offer a fare',
    designedTo: 'Put the driver’s price in front of the rider, in the order the bids arrived.',
    criticality: 'core',
    budgetMs: 12_000,
    code: ['backend/functions/src/trips/index.ts'],
    knownCauses: [
      {
        signal: /failed-precondition.*(commission|locked|outstanding)/,
        because: 'The commission lock refused the bid: a short day came due at midnight and has not been cleared.',
        fix: 'Correct behaviour. The driver clears it from the Earnings screen — check the figure shown there matches the one the gate used.',
      },
      {
        signal: /face|verification/,
        because: 'The daily face check has not been done for this Pakistan day.',
        fix: 'Correct behaviour wherever dailyFaceCheckIn is on for this driver. It stops the day, never the account.',
      },
    ],
  },
  {
    id: 'driver.trip.progress',
    area: 'Driver',
    title: 'Arriving → started → completed',
    designedTo: 'Move a trip through its states and settle it exactly once, with both sides told.',
    criticality: 'core',
    budgetMs: 12_000,
    code: ['backend/functions/src/trips/index.ts', 'backend/functions/src/trips/dropOff.ts'],
    knownCauses: [
      {
        signal: /wrong_result|no_effect/,
        because:
          'A trip stuck mid-state holds `activeTripId` on both sides, which locks the rider out of booking and the driver out of working.',
        fix: 'Run the agent check trips.stuck. Whichever path failed must clear activeTripId for the passenger and every pool member.',
      },
    ],
  },
  {
    id: 'driver.earnings',
    area: 'Driver',
    title: 'Earnings and the daily commission',
    designedTo: 'Show what the driver made, what the 5% came to, and let them clear it.',
    criticality: 'normal',
    budgetMs: 12_000,
    code: ['apps/mobile/app/driver/earnings.tsx', 'backend/functions/src/domain/dailyTarget.ts'],
    knownCauses: [
      {
        signal: /wrong_result/,
        because:
          'Commission is charged by the Pakistan day. A figure computed against UTC is a day out either side of midnight.',
        fix: 'Every day boundary goes through pktDayKey (backend/functions/src/domain/dailyTarget.ts) — never a local-time read.',
      },
    ],
  },

  // ── Money ──────────────────────────────────────────────────────────────────
  {
    id: 'money.topup.manual',
    area: 'Money',
    title: 'Bank-transfer top-up',
    designedTo: 'Read a transfer receipt with our own OCR, and credit the amount once an admin confirms it.',
    criticality: 'normal',
    budgetMs: 30_000,
    code: ['backend/functions/src/payments', 'backend/functions/src/lib/paymentProofAI.ts'],
    knownCauses: [
      {
        signal: /empty|wrong_result/,
        because:
          'The OCR read nothing usable off the screenshot. It is our own engine with no paid model behind it, so a dark or cropped photo legitimately fails.',
        fix: 'Make sure the screen asks for a retake instead of submitting an unreadable receipt. Never route this to a paid model.',
      },
    ],
  },
  {
    id: 'money.partner.commission',
    area: 'Money',
    title: 'Earn with Velocity',
    designedTo:
      'Pay a partner a percentage of the platform commission their referrals generated — never a percentage of the fare.',
    criticality: 'normal',
    budgetMs: 12_000,
    code: ['backend/functions/src/partners/commission.ts'],
    knownCauses: [
      {
        signal: /wrong_result/,
        because:
          'A partner earning larger than the commission it was cut from means the basis was the fare, not the commission.',
        fix: 'Check the basis in partners/commission.ts, and run the agent check partners.basis.',
      },
    ],
  },

  // ── Safety ─────────────────────────────────────────────────────────────────
  {
    id: 'safety.sos',
    area: 'Safety',
    title: 'SOS',
    designedTo:
      'Reach the rider’s own emergency contacts and the safety desk immediately, from the rider’s own number.',
    criticality: 'core',
    budgetMs: 10_000,
    code: ['apps/mobile/app/safety.tsx', 'backend/functions/src/safety/index.ts'],
    knownCauses: [
      {
        signal: /empty|no_effect/,
        because: 'No emergency contacts were saved, so there was nobody to message.',
        fix: 'The sheet must say so and still raise the desk alert. This is the one feature that may never fail silently.',
      },
    ],
  },
  {
    id: 'safety.support',
    area: 'Safety',
    title: 'Rapid Response',
    designedTo: 'Answer every message — AI first, a human the moment one is asked for.',
    criticality: 'core',
    budgetMs: 20_000,
    code: ['backend/functions/src/support/index.ts'],
    knownCauses: [
      {
        signal: /empty|no_effect/,
        because: 'A message with no reply. The one rule of this system is that a message is never left unanswered.',
        fix: 'Check the escalation writes waiting_human and that the desk is notified. Run the agent check support.unanswered.',
      },
    ],
  },

  // ── Platform ───────────────────────────────────────────────────────────────
  {
    id: 'platform.push',
    area: 'Platform',
    title: 'Push notifications',
    designedTo:
      'Land a notification on the phone for the things that cannot wait — a bid, a driver arriving, a safety alert.',
    criticality: 'core',
    budgetMs: 15_000,
    code: ['backend/functions/src/lib/fcm.ts'],
    knownCauses: [
      {
        signal: /token|registration|not registered/,
        because:
          'Expo-format tokens have to go out through the FCM Admin SDK. Sent any other way they fail silently — which is how pushes were dead for weeks without one error surfacing.',
        fix: 'Check tokenKind() routing in lib/fcm.ts before looking anywhere else.',
      },
    ],
  },
  {
    id: 'platform.whatsapp',
    area: 'Platform',
    title: 'WhatsApp messages',
    designedTo: 'Reach a driver whose app is closed, and carry sign-in codes on the cheap channel.',
    criticality: 'normal',
    budgetMs: 20_000,
    code: ['backend/functions/src/whatsapp'],
    knownCauses: [
      {
        signal: /template|132018|does not exist/,
        because:
          'The template name the code asks for is not a name that exists on the WABA, or its button type is wrong for the category.',
        fix: 'List the templates on the WABA and match name and category exactly. Auth templates use a URL button, never a coupon code.',
      },
      {
        signal: /no_effect/,
        because:
          'A WhatsApp was skipped on purpose: the gate is whether the app looks CLOSED, not whether the driver is offline.',
        fix: 'Correct behaviour — appLooksClosed() is the gate, never online == false on its own.',
      },
    ],
  },
  {
    id: 'platform.theme',
    area: 'Platform',
    title: 'Light and dark theme',
    designedTo: 'Repaint every screen the moment the theme changes, without a restart.',
    criticality: 'normal',
    budgetMs: 4_000,
    code: ['apps/mobile/src/theme.ts'],
    knownCauses: [
      {
        signal: /wrong_result|no_effect/,
        because:
          'A screen built on a bare StyleSheet.create keeps the colours it had at first render — the switch silently does nothing there.',
        fix: 'Wrap the styles in themed(() => StyleSheet.create({ … })). This one breaks quietly, so it is worth grepping for the bare form.',
      },
    ],
  },
  {
    id: 'platform.qa.agent',
    area: 'Platform',
    title: 'The testing agent',
    designedTo:
      'Test the app on its own every few minutes, and write a usable brief whenever a feature is not keeping its promise.',
    criticality: 'normal',
    budgetMs: 180_000,
    code: ['backend/functions/src/qa/agent.ts', 'backend/functions/src/qa/checks.ts'],
    knownCauses: [
      {
        signal: /index|failed-precondition.*query/,
        because:
          'A check asked Firestore for a shape that has no composite index, so the query is refused. The agent is blind to that feature until the index exists.',
        fix: 'Take the index definition out of the error and add it to firestore.indexes.json. Mind that the index step in CI is continue-on-error, so a missing index does not fail the build — it just never gets created.',
      },
      {
        signal: /check-threw/,
        because:
          'The check itself broke — a field renamed under it, or a document shape it did not expect. Nothing is known about that feature while this persists.',
        fix: 'Fix the check in backend/functions/src/qa/checks.ts and verify its field names against PRODUCTION documents, not against the emulator or a type definition.',
      },
    ],
  },
  {
    id: 'platform.maps',
    area: 'Platform',
    title: 'The map',
    designedTo: 'Draw the route, the cars and the pickup pin on a map that does not take the app down with it.',
    criticality: 'core',
    budgetMs: 15_000,
    code: ['apps/mobile/src/ui/LiveMap.tsx'],
    knownCauses: [
      {
        signal: /topuserlocationchange|showsuserlocation|crash/,
        because:
          'showsUserLocation emits topUserLocationChange, which kills release builds. It is never set here for that reason.',
        fix: 'Never set showsUserLocation on LiveMap. Draw our own dot from the location hook instead.',
      },
    ],
  },
];

const BY_ID = new Map(FEATURE_CONTRACTS.map((f) => [f.id, f] as const));

export function featureContract(id: string): FeatureContract | null {
  return BY_ID.get(id) ?? null;
}

export function isKnownFeature(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * The contract used for a report whose feature id we do not recognise.
 *
 * An unknown id is never dropped. It means an app build is newer than this
 * registry, and throwing away the only evidence of a problem because the
 * registry has not caught up is the opposite of the point.
 */
export function unknownFeatureContract(id: string): FeatureContract {
  return {
    id,
    area: 'Platform',
    title: id,
    designedTo:
      'Not in the feature registry — this app build reports a feature this backend does not know about yet.',
    criticality: 'normal',
    budgetMs: 15_000,
    code: ['backend/functions/src/qa/features.ts'],
    knownCauses: [],
  };
}

/**
 * The best available explanation for a failure, and what to do about it.
 *
 * Feature-specific causes are tried before the shared ones, so "unavailable" on
 * the OTP path reads as a cold start rather than as a generic network blip.
 * `matched: false` is a real answer and is reported as one.
 */
export function diagnose(
  contract: FeatureContract,
  kind: QaFailureKind,
  errorCode?: string | null,
  errorMessage?: string | null,
): { why: string; fix: string; matched: boolean } {
  const signature = `${kind} ${errorCode ?? ''} ${errorMessage ?? ''}`.toLowerCase();
  for (const cause of [...contract.knownCauses, ...SHARED_CAUSES]) {
    if (cause.signal.test(signature)) {
      return { why: cause.because, fix: cause.fix, matched: true };
    }
  }
  return {
    why: 'No known cause matches this signature, so this is either new or a one-off. Treat the evidence below as the whole of what we know.',
    fix: `Reproduce it on the screen named in the evidence, then read the function log for that minute. Start in ${contract.code.join(' or ')}. If it turns out to be a repeat, add it to this feature's knownCauses in backend/functions/src/qa/features.ts so the next log says so.`,
    matched: false,
  };
}

/**
 * How bad this is. A core feature that threw, or did nothing at all, is a
 * blocker; merely slow or empty is a degradation, however important the feature.
 */
export function severityOf(contract: FeatureContract, kind: QaFailureKind): QaSeverity {
  if (kind === 'slow' || kind === 'empty') return 'degraded';
  return contract.criticality === 'core' ? 'blocker' : 'broken';
}
