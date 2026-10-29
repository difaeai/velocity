/**
 * The watcher: did that tap do what the feature was built to do?
 * ----------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * Crash reporting tells us what threw. It cannot tell us that "Book a ride"
 * returned in 400 ms, threw nothing, and left the rider on a screen where no
 * driver will ever see them. So this watches features against their PURPOSE:
 * every callable that belongs to a feature is timed and classified, and a
 * screen can assert in one line that what it promised actually happened.
 *
 * WHEN IT DOES NOTHING
 * Which is almost always. A feature that works writes nothing, sends nothing
 * and costs nothing — no network call, no storage, no document. The whole
 * engine only exists for the failures, which is what keeps it affordable to
 * leave switched on for every user of the app.
 *
 * FOUR RULES IT KEEPS
 *  1. IT NEVER CHANGES WHAT HAPPENS. Every error is rethrown exactly as it
 *     arrived, so the screen's own error handling runs untouched. A watcher
 *     that can break the feature it watches is worse than no watcher.
 *  2. IT NEVER THROWS. Every reporting path is wrapped. Losing a report is
 *     acceptable; losing a ride because of a report is not.
 *  3. IT DOES NOT CRY WOLF ABOUT THE NETWORK. A dropped connection in a tunnel
 *     is not a bug. Transport failures are counted and only reported once the
 *     same callable has failed three times in a row in one session — enough to
 *     mean "this one never works", not enough to log every lift.
 *  4. IT STAYS QUIET IN DEVELOPMENT. A half-built feature on a laptop is not
 *     evidence about the app people are using, so dev builds log to the console
 *     instead of to the testing log.
 *
 * WHAT THIS CANNOT SEE — read before adding to CALLABLE_FEATURE
 * Some callables are built never to fail. `getTrafficAlerts` answers
 * `{ ok: true, city: [], route: [] }` when the alerts cannot be read at all,
 * because a road alert is a courtesy on top of a booking screen and must never
 * stop somebody booking a ride. From here that is a fast, successful call —
 * identical whether the feature is healthy or completely dead.
 *
 * So a feature with a degrade-to-empty contract must NOT be listed below. Silence
 * from it would mean nothing, and reading "no reports" as "no problem" is exactly
 * how a watcher ends up certifying a dead feature. Those are proved server-side
 * instead, by an agent check against the data (backend/functions/src/qa/checks.ts).
 * `getEnRouteSavings` degrades the same way on purpose and is watched here only
 * for what it CAN tell us: throwing, and taking too long.
 *
 * WHERE THE REPORTS GO
 * `reportFeatureCheck` (backend/functions/src/qa/report.ts) → one date-wise log
 * the admin Testing page reads, with each entry already written as the brief
 * somebody will paste into Claude Code.
 *
 * The ids below mirror FEATURE_CONTRACTS in backend/functions/src/qa/features.ts.
 * An id this file reports that the backend does not know is kept rather than
 * dropped, but it is logged as unknown — so keep the two in step.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../firebase';
import { currentAppVersion, currentBuildNumber } from './appUpdate';
import { chainCrashHandler, type GlobalHandler } from './crashHandler';

/** The features this app reports on. Mirrors the backend registry. */
export const FEATURE = {
  otpRequest: 'auth.otp.request',
  profileComplete: 'auth.profile.complete',
  booking: 'booking.request',
  fareQuote: 'booking.fare.quote',
  placesSearch: 'booking.places.search',
  voiceBooking: 'booking.voice',
  sharedBook: 'shared.book',
  sharedJoin: 'shared.join',
  enRouteOffer: 'shared.enroute.offer',
  enRouteSavings: 'shared.enroute.savings',
  driverOnline: 'driver.online',
  driverFeed: 'driver.feed',
  driverBid: 'driver.bid',
  tripProgress: 'driver.trip.progress',
  driverEarnings: 'driver.earnings',
  manualTopup: 'money.topup.manual',
  partnerCommission: 'money.partner.commission',
  sos: 'safety.sos',
  support: 'safety.support',
  push: 'platform.push',
  maps: 'platform.maps',
  crash: 'platform.crash',
} as const;

export type FeatureId = (typeof FEATURE)[keyof typeof FEATURE];

export type FailureKind = 'threw' | 'empty' | 'slow' | 'no_effect' | 'wrong_result';

/**
 * How long each feature may take before a user would call it broken.
 *
 * Mirrors `budgetMs` in the backend registry. Kept here as well because the
 * phone is the only place that can measure the whole interaction — the backend
 * sees its own slice of it and nothing of the round trip.
 */
const BUDGET_MS: Record<FeatureId, number> = {
  'auth.otp.request': 12_000,
  'auth.profile.complete': 8_000,
  'booking.request': 15_000,
  'booking.fare.quote': 10_000,
  'booking.places.search': 8_000,
  'booking.voice': 20_000,
  'shared.book': 15_000,
  'shared.join': 15_000,
  'shared.enroute.offer': 20_000,
  'shared.enroute.savings': 20_000,
  'driver.online': 10_000,
  'driver.feed': 12_000,
  'driver.bid': 12_000,
  'driver.trip.progress': 12_000,
  'driver.earnings': 12_000,
  'money.topup.manual': 30_000,
  'money.partner.commission': 12_000,
  'safety.sos': 10_000,
  'safety.support': 20_000,
  'platform.push': 15_000,
  'platform.maps': 15_000,
  'platform.crash': 15_000,
};

/**
 * Which callables belong to which feature.
 *
 * Only the ones that carry a promise to a user are here. An admin endpoint or a
 * seeding helper failing is a thing for the console to deal with, and watching
 * everything would fill the log with rows nobody has a contract for.
 */
const CALLABLE_FEATURE: Record<string, FeatureId> = {
  exchangePhoneSession: FEATURE.otpRequest,
  startWhatsAppOtp: FEATURE.otpRequest,
  verifyWhatsAppOtp: FEATURE.otpRequest,

  createTrip: FEATURE.booking,
  cancelTrip: FEATURE.booking,
  getFareEstimate: FEATURE.fareQuote,
  getFareContext: FEATURE.fareQuote,
  getMarketComparison: FEATURE.fareQuote,
  getSharedRideFare: FEATURE.fareQuote,
  placesAutocomplete: FEATURE.placesSearch,
  placeDetails: FEATURE.placesSearch,
  geocodeAddress: FEATURE.placesSearch,
  getDirections: FEATURE.maps,

  createPoolRideRequest: FEATURE.sharedBook,
  getSuggestedRides: FEATURE.sharedBook,
  getSharedPools: FEATURE.sharedBook,
  createSharedPool: FEATURE.sharedBook,
  joinSharedPool: FEATURE.sharedJoin,
  joinPoolTrip: FEATURE.sharedJoin,
  joinPoolRide: FEATURE.sharedJoin,
  joinPoolRideRequest: FEATURE.sharedJoin,
  getEnRouteMatches: FEATURE.enRouteOffer,
  acceptEnRouteRider: FEATURE.enRouteOffer,
  getEnRouteSavings: FEATURE.enRouteSavings,
  askDriverEnRoutePickup: FEATURE.enRouteSavings,

  stampDriverCell: FEATURE.driverOnline,
  placeBid: FEATURE.driverBid,
  updateTripStatus: FEATURE.tripProgress,
  completeTrip: FEATURE.tripProgress,
  dropOffRider: FEATURE.tripProgress,
  payCommission: FEATURE.driverEarnings,
  submitCommissionSettlement: FEATURE.driverEarnings,

  submitManualTopup: FEATURE.manualTopup,
  getPartnerDashboard: FEATURE.partnerCommission,
  requestPartnerWithdrawal: FEATURE.partnerCommission,

  raiseSafetyEvent: FEATURE.sos,
  openSupportTicket: FEATURE.support,
  sendSupportMessage: FEATURE.support,
  requestHumanAgent: FEATURE.support,
  registerFcmToken: FEATURE.push,
};

interface QueuedReport {
  featureId: string;
  kind: FailureKind;
  whatHappened: string;
  at: number;
  occurrences: number;
  tookMs?: number;
  callable?: string;
  errorCode?: string;
  errorMessage?: string;
  screen?: string;
  detail?: Record<string, string>;
}

const QUEUE_KEY = 'velocity.qa.reports';
/** Never hold more than this; the oldest go first. */
const QUEUE_MAX = 40;
/** The backend takes twenty per call. */
const BATCH_MAX = 20;
/** Wait this long after the first report, so a burst leaves as one call. */
const FLUSH_DELAY_MS = 5_000;
/** And never flush more often than this. */
const FLUSH_MIN_GAP_MS = 30_000;
/** Consecutive transport failures on one callable before we believe them. */
const TRANSPORT_PATIENCE = 3;

const TRANSPORT_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'cancelled',
  'aborted',
]);

let queue: QueuedReport[] = [];
let loaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushAt = 0;
let sending = false;
/** Where the user is, as the app last said. Attached to every report. */
let currentScreen: string | null = null;
/** Consecutive transport failures per callable, this session only. */
const transportStreak: Record<string, number> = {};
/** Transport problems already reported once this session. */
const transportReported = new Set<string>();

const send = httpsCallable<
  { reports: QueuedReport[]; appVersion?: string; platform?: string },
  { recorded: number }
>(functions, 'reportFeatureCheck');

/**
 * Tell the watcher which screen the user is on.
 *
 * Call it from a route change. Worth the one line: "createTrip failed" and
 * "createTrip failed from the shared-ride screen" are different bugs, and the
 * second one can be reproduced.
 */
export function setQaScreen(screen: string | null): void {
  currentScreen = screen ? screen.slice(0, 80) : null;
}

const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

/** The error's code and message, however the SDK chose to wrap it. */
function errorParts(e: unknown): { code: string; message: string } {
  const raw = e as { code?: unknown; message?: unknown } | null;
  const code = typeof raw?.code === 'string' ? raw.code.replace(/^functions\//, '') : 'unknown';
  const message = typeof raw?.message === 'string' ? raw.message : String(e);
  return { code: code.slice(0, 80), message: message.slice(0, 400) };
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QueuedReport[];
      if (Array.isArray(parsed)) queue = parsed.slice(-QUEUE_MAX);
    }
  } catch {
    /* a queue we cannot read is a queue we do without */
  }
}

async function persist(): Promise<void> {
  try {
    if (queue.length === 0) await AsyncStorage.removeItem(QUEUE_KEY);
    else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* nothing to do; the in-memory queue still flushes this session */
  }
}

/** Same feature, same kind, same error — one row, a bigger number. */
function sameProblem(a: QueuedReport, b: QueuedReport): boolean {
  return (
    a.featureId === b.featureId &&
    a.kind === b.kind &&
    (a.errorCode ?? '') === (b.errorCode ?? '') &&
    (a.callable ?? '') === (b.callable ?? '')
  );
}

function scheduleFlush(): void {
  if (flushTimer) return;
  const since = Date.now() - lastFlushAt;
  const wait = Math.max(FLUSH_DELAY_MS, FLUSH_MIN_GAP_MS - since);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, wait);
}

/**
 * Send what is queued.
 *
 * On failure the batch goes back to the front of the queue and waits — a report
 * about a broken feature is worth keeping precisely when the network is also
 * having a bad day. Safe to call at any time; exported so a screen that is
 * about to be closed can push what it has.
 */
export async function flush(): Promise<void> {
  if (sending || isDev) return;
  await load();
  if (queue.length === 0) return;
  sending = true;
  const batch = queue.slice(0, BATCH_MAX);
  queue = queue.slice(batch.length);
  try {
    await send({
      reports: batch,
      appVersion: `${currentAppVersion()}${
        currentBuildNumber() != null ? ` (${currentBuildNumber()})` : ''
      }`,
      platform: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 20),
    });
    lastFlushAt = Date.now();
    await persist();
  } catch {
    // Keep them, but behind anything newer, and do not retry in a tight loop.
    queue = [...batch, ...queue].slice(-QUEUE_MAX);
    lastFlushAt = Date.now();
    await persist();
  } finally {
    sending = false;
    if (queue.length > 0) scheduleFlush();
  }
}

/**
 * Record that a feature did not do its job.
 *
 * Public because plenty of failures are not callable failures: a map that will
 * not draw, a theme that will not switch, a voice command that parsed to
 * nothing. Those are the ones nobody would otherwise ever hear about.
 */
export function reportFeatureProblem(input: {
  featureId: string;
  kind: FailureKind;
  /** One sentence, for somebody reading the log tomorrow. */
  whatHappened: string;
  tookMs?: number;
  callable?: string;
  errorCode?: string;
  errorMessage?: string;
  detail?: Record<string, string>;
}): Promise<void> {
  try {
    if (isDev) {
      console.warn(`[qa] ${input.featureId} ${input.kind}: ${input.whatHappened}`);
      return Promise.resolve();
    }
    const report: QueuedReport = {
      featureId: input.featureId,
      kind: input.kind,
      whatHappened: input.whatHappened.slice(0, 400),
      at: Date.now(),
      occurrences: 1,
      ...(input.tookMs != null ? { tookMs: Math.round(input.tookMs) } : {}),
      ...(input.callable ? { callable: input.callable } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      ...(currentScreen ? { screen: currentScreen } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    };

    // Resolves once the report is saved, for a crash that must outlive the app.
    return load().then(async () => {
      const existing = queue.find((q) => sameProblem(q, report));
      if (existing) {
        existing.occurrences = Math.min(500, existing.occurrences + 1);
        existing.at = report.at;
      } else {
        queue.push(report);
        if (queue.length > QUEUE_MAX) queue = queue.slice(-QUEUE_MAX);
      }
      await persist();
      scheduleFlush();
    });
  } catch {
    /* rule 2: the watcher never throws */
    return Promise.resolve();
  }
}

/**
 * A JavaScript crash, through the same log. The message is the error code, so
 * two different crashes stay two rows instead of collapsing into one.
 */
export function reportCrash(error: unknown, where: 'render' | 'uncaught' | 'fatal'): Promise<void> {
  const { message } = errorParts(error);
  const stack = (error as { stack?: unknown } | null)?.stack;
  return reportFeatureProblem({
    featureId: FEATURE.crash,
    kind: 'threw',
    whatHappened: `The app hit an unhandled error (${where}).`,
    errorCode: message.slice(0, 80),
    errorMessage: message,
    ...(typeof stack === 'string' ? { detail: { stack: stack.slice(0, 200) } } : {}),
  });
}

/**
 * Report errors nothing caught. Installed once, from the root layout. A fatal
 * one is held for up to 1.5 s so the report is saved and sent before the
 * default handler takes the app down; one that does not leave in time is still
 * saved and goes on the next launch, which is why this flushes on install.
 */
export function installCrashReporting(): void {
  const eu = (globalThis as {
    ErrorUtils?: { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };
  }).ErrorUtils;
  if (!eu) return;
  eu.setGlobalHandler(
    chainCrashHandler(eu.getGlobalHandler(), (error, isFatal) =>
      isFatal ? reportCrash(error, 'fatal').then(flush) : reportCrash(error, 'uncaught'),
    ),
  );
  void flush();
}

/**
 * Wrap a callable so the feature behind it is watched.
 *
 * Used once, in the api client's `callable()` helper, which is what makes this
 * cover every feature-bearing call in the app rather than the handful somebody
 * remembered to instrument.
 */
export function watchCallable<Req, Res>(
  name: string,
  call: (data: Req) => Promise<Res>,
): (data: Req) => Promise<Res> {
  const featureId = CALLABLE_FEATURE[name];
  // Not part of any feature's promise, or the reporting call itself — which
  // must never be watched, or one failure would report itself for ever.
  if (!featureId || name === 'reportFeatureCheck') return call;
  const budget = BUDGET_MS[featureId] ?? 15_000;

  return async (data: Req) => {
    const started = Date.now();
    try {
      const res = await call(data);
      const took = Date.now() - started;
      transportStreak[name] = 0;
      if (took > budget) {
        reportFeatureProblem({
          featureId,
          kind: 'slow',
          whatHappened: `${name} answered after ${Math.round(took / 100) / 10}s, past the ${
            Math.round(budget / 100) / 10
          }s a user waits before deciding the feature is broken.`,
          tookMs: took,
          callable: name,
        });
      }
      return res;
    } catch (e) {
      const took = Date.now() - started;
      const { code, message } = errorParts(e);

      if (TRANSPORT_CODES.has(code)) {
        // Rule 3 — believe the third one, and only once per session.
        const streak = (transportStreak[name] ?? 0) + 1;
        transportStreak[name] = streak;
        if (streak >= TRANSPORT_PATIENCE && !transportReported.has(name)) {
          transportReported.add(name);
          reportFeatureProblem({
            featureId,
            kind: 'threw',
            whatHappened: `${name} failed to complete ${streak} times in a row on this phone, so this is not one bad moment on the network — the feature is unreachable for this user.`,
            tookMs: took,
            callable: name,
            errorCode: code,
            errorMessage: message,
            detail: { consecutiveFailures: String(streak) },
          });
        }
        throw e;
      }

      transportStreak[name] = 0;
      reportFeatureProblem({
        featureId,
        kind: 'threw',
        whatHappened: `${name} was refused with "${code}", so the tap did nothing a user would recognise as the feature working.`,
        tookMs: took,
        callable: name,
        errorCode: code,
        errorMessage: message,
      });
      throw e; // rule 1
    }
  };
}

/** What a screen can assert about what it just did. */
export interface Probe {
  /**
   * "This had to be true for the feature to have worked." A false assertion is
   * the whole point of this engine: it catches the taps that fail silently.
   */
  expect(ok: boolean, whatWentWrong: string, kind?: FailureKind): void;
  /** Anything worth having in the log — an id, a count, a flag. */
  note(key: string, value: string | number | boolean): void;
}

/**
 * Watch a whole interaction, not just one call.
 *
 * ```ts
 * await featureTap(FEATURE.voiceBooking, async (probe) => {
 *   const parsed = parseSpokenRide(said);
 *   probe.note('heard', said);
 *   probe.expect(!!parsed?.dropoff, 'Nothing was understood from what the rider said.', 'empty');
 *   return parsed;
 * });
 * ```
 *
 * The result is returned and errors are rethrown, so wrapping a handler in this
 * never changes what the screen does.
 */
export async function featureTap<T>(
  featureId: FeatureId | string,
  run: (probe: Probe) => Promise<T> | T,
): Promise<T> {
  const started = Date.now();
  const budget = BUDGET_MS[featureId as FeatureId] ?? 15_000;
  const detail: Record<string, string> = {};
  const failures: { what: string; kind: FailureKind }[] = [];

  const probe: Probe = {
    expect(ok, whatWentWrong, kind = 'wrong_result') {
      if (!ok) failures.push({ what: whatWentWrong, kind });
    },
    note(key, value) {
      detail[key.slice(0, 40)] = String(value).slice(0, 200);
    },
  };

  try {
    const result = await run(probe);
    const took = Date.now() - started;
    // The first unmet promise is the interesting one; the rest usually follow
    // from it, and reporting all of them would turn one bug into four rows.
    const first = failures[0];
    if (first) {
      reportFeatureProblem({
        featureId,
        kind: first.kind,
        whatHappened: first.what,
        tookMs: took,
        detail: {
          ...detail,
          ...(failures.length > 1 ? { alsoFailed: String(failures.length - 1) } : {}),
        },
      });
    } else if (took > budget) {
      reportFeatureProblem({
        featureId,
        kind: 'slow',
        whatHappened: `It worked, but took ${Math.round(took / 100) / 10}s — past the ${
          Math.round(budget / 100) / 10
        }s a user waits before deciding it is broken.`,
        tookMs: took,
        detail,
      });
    }
    return result;
  } catch (e) {
    const { code, message } = errorParts(e);
    reportFeatureProblem({
      featureId,
      kind: 'threw',
      whatHappened: `The tap threw before it finished: "${message.slice(0, 160)}".`,
      tookMs: Date.now() - started,
      errorCode: code,
      errorMessage: message,
      detail,
    });
    throw e; // rule 1
  }
}
