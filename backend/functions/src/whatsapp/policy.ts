/**
 * Who gets a WhatsApp alert, and who does not. Pure and I/O-free.
 *
 * The transport (`client.ts`) knows how to send. This knows whether we *should*
 * — and the answer is "much less often than you would think". Every rule below
 * exists to keep the business number's quality rating healthy, because a
 * restricted number is not a bug you fix, it is a channel you lose.
 *
 * The gates, in the order they bite:
 *
 *  1. OPT-IN. A driver who has not explicitly switched these alerts on in the
 *     app is never messaged. Not once. This is the single most important rule:
 *     unsolicited WhatsApp from a business is precisely what people press
 *     "Block" and "Report" on, and those two taps are what Meta counts.
 *  2. SCARCITY. Alerts only go out when there are not enough ONLINE drivers to
 *     serve the request. If the ride will be taken anyway, the message is noise
 *     — and noise is what erodes a sender's standing.
 *  3. QUIET HOURS. Nobody is grateful for a fare alert at 3am, and an ignored
 *     3am message is a block waiting to happen.
 *  4. FREQUENCY. A minimum gap between messages to one driver, a hard daily
 *     count per driver, a cap on how many drivers one ride may wake, and a
 *     global daily budget across the whole platform.
 *  5. LIVENESS. Drivers who have not opened the app in weeks are skipped.
 *     Their numbers are the likeliest to be dead or reassigned, and dead
 *     numbers produce undeliverables, which are themselves a spam signal.
 *
 * Every threshold is overridable from `config/whatsappAlerts` so the numbers
 * can be tightened from the admin console without a deploy — the direction that
 * matters in an emergency.
 */

/** Pakistan Standard Time is UTC+5 all year — no DST, so an offset is enough. */
const PKT_OFFSET_MIN = 5 * 60;

export interface WhatsAppAlertSettings {
  /** Master switch. Off by default: the feature stays dark until a human arms it. */
  enabled: boolean;
  /** How far from the pickup an offline driver may be and still be worth waking. */
  radiusKm: number;
  /** Minimum minutes between two alerts to the same driver. */
  minGapMinutes: number;
  /** Hard ceiling on alerts to one driver in one PKT day. */
  maxPerDriverPerDay: number;
  /** How many drivers a single ride request may wake. */
  maxRecipientsPerTrip: number;
  /** Platform-wide ceiling for one PKT day. The budget, and the blast radius. */
  dailyGlobalCap: number;
  /** Quiet hours in PKT, [start, end). 22 → 7 means 22:00–06:59 is silent. */
  quietStartHour: number;
  quietEndHour: number;
  /**
   * Only alert when FEWER than this many approved drivers are already online
   * within the search radius. Zero would mean "only when nobody is there".
   */
  onlineDriverThreshold: number;
  /** A driver unseen for this many days is presumed gone; do not message them. */
  staleDriverDays: number;
  /** Fares below this are not worth waking anyone for. */
  minFare: number;
}

export const DEFAULT_ALERT_SETTINGS: WhatsAppAlertSettings = {
  enabled: false,
  radiusKm: 5,
  minGapMinutes: 45,
  maxPerDriverPerDay: 4,
  maxRecipientsPerTrip: 10,
  dailyGlobalCap: 400,
  quietStartHour: 22,
  quietEndHour: 7,
  onlineDriverThreshold: 3,
  staleDriverDays: 21,
  minFare: 0,
};

/**
 * Merges an admin-edited settings document over the defaults, keeping only
 * values of the right type and clamping them into a sane range.
 *
 * The clamps are deliberate: this document is editable from the admin console,
 * and a fat-fingered `maxPerDriverPerDay: 400` would do real damage to the
 * number's standing before anyone noticed. Defaults win over nonsense.
 */
export function readAlertSettings(raw: unknown): WhatsAppAlertSettings {
  const d = (raw ?? {}) as Record<string, unknown>;
  const num = (key: keyof WhatsAppAlertSettings, min: number, max: number): number => {
    const v = d[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_ALERT_SETTINGS[key] as number;
    return Math.min(max, Math.max(min, v));
  };
  return {
    enabled: d.enabled === true,
    radiusKm: num('radiusKm', 0.5, 25),
    minGapMinutes: num('minGapMinutes', 15, 24 * 60),
    maxPerDriverPerDay: num('maxPerDriverPerDay', 1, 10),
    maxRecipientsPerTrip: num('maxRecipientsPerTrip', 1, 50),
    dailyGlobalCap: num('dailyGlobalCap', 1, 20_000),
    quietStartHour: num('quietStartHour', 0, 23),
    quietEndHour: num('quietEndHour', 0, 23),
    onlineDriverThreshold: num('onlineDriverThreshold', 0, 50),
    staleDriverDays: num('staleDriverDays', 1, 365),
    minFare: num('minFare', 0, 100_000),
  };
}

/** The PKT calendar day, `YYYY-MM-DD`. Daily counters are keyed on this. */
export function pktDayKey(nowMs: number): string {
  return new Date(nowMs + PKT_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** The hour of the PKT clock, 0–23. */
export function pktHour(nowMs: number): number {
  return new Date(nowMs + PKT_OFFSET_MIN * 60_000).getUTCHours();
}

/**
 * Is it a time of night we refuse to message anyone at?
 *
 * Handles the wrap across midnight, which is the normal case (22 → 7). When
 * start equals end the window is empty rather than the whole day — an admin
 * typing the same number twice should not silence the feature by accident.
 */
export function isQuietHour(nowMs: number, s: WhatsAppAlertSettings): boolean {
  const h = pktHour(nowMs);
  const { quietStartHour: start, quietEndHour: end } = s;
  if (start === end) return false;
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** Why the whole fan-out was skipped, for logs and the admin desk. */
export type FanoutBlock =
  | 'disabled'
  | 'not-configured'
  | 'circuit-open'
  | 'quiet-hours'
  | 'enough-drivers-online'
  | 'fare-too-small'
  | 'global-cap';

export interface FanoutContext {
  /** Approved drivers already online inside the radius. */
  onlineNearby: number;
  /** The fare on offer, in PKR. */
  fare: number;
  /** Alerts already sent platform-wide today. */
  sentToday: number;
  /** True when the breaker has been tripped by a `halt` from Meta. */
  circuitOpen: boolean;
  /** False when the Cloud API credentials are missing. */
  configured: boolean;
}

/**
 * The one decision that covers the entire ride request. Returns null to
 * proceed, or the reason nobody is being messaged.
 *
 * Ordered cheapest-and-most-decisive first, so the common "feature is off" case
 * costs nothing and the logs name the real cause rather than the last check.
 */
export function blockFanout(
  s: WhatsAppAlertSettings,
  ctx: FanoutContext,
  nowMs: number,
): FanoutBlock | null {
  if (!s.enabled) return 'disabled';
  if (!ctx.configured) return 'not-configured';
  // The breaker outranks everything. Meta has already told us to stop.
  if (ctx.circuitOpen) return 'circuit-open';
  if (isQuietHour(nowMs, s)) return 'quiet-hours';
  if (ctx.onlineNearby >= s.onlineDriverThreshold) return 'enough-drivers-online';
  if (ctx.fare < s.minFare) return 'fare-too-small';
  if (ctx.sentToday >= s.dailyGlobalCap) return 'global-cap';
  return null;
}

/** Per-driver alert state, as stored under `drivers/{uid}.whatsappAlerts`. */
export interface DriverAlertState {
  /** Explicit consent, set only by the driver's own toggle in the app. */
  optIn?: boolean;
  /**
   * The normalised number consent was given for, captured at opt-in.
   *
   * Stored separately from the profile's free-text `phone` for two reasons: it
   * is queryable, which is how an inbound STOP finds its driver; and it pins
   * the alert to the number the person actually agreed with, so editing a
   * profile cannot silently redirect messages to a number nobody consented on.
   */
  number?: string;
  /** Set when Meta says this number must not be messaged again. Permanent. */
  blocked?: boolean;
  /** Epoch ms of the last alert we sent them. */
  lastSentAt?: number | null;
  /** PKT day the counter below belongs to. */
  sentDay?: string | null;
  sentToday?: number;
}

export interface CandidateDriver {
  uid: string;
  /** Already normalised by `toWhatsAppNumber`; null when unusable. */
  phone: string | null;
  distanceKm: number;
  /** Epoch ms the driver was last seen in the app, or null if never recorded. */
  lastSeenAt: number | null;
  alerts: DriverAlertState;
}

export type SkipReason =
  | 'no-phone'
  | 'not-opted-in'
  | 'blocked'
  | 'too-far'
  | 'too-soon'
  | 'driver-daily-cap'
  | 'stale'
  | 'fanout-cap'
  | 'global-cap';

export interface FanoutPlan<T extends CandidateDriver = CandidateDriver> {
  picked: T[];
  skipped: { uid: string; reason: SkipReason }[];
}

/**
 * Picks the drivers to message for one ride request.
 *
 * Nearest first, because the nearest offline driver is the one most likely to
 * find the message useful rather than annoying — and "useful rather than
 * annoying" is, in the end, the only durable protection a business number has.
 *
 * `remainingGlobal` is what is left of today's platform-wide budget; the plan
 * never exceeds it, so a burst of simultaneous requests cannot collectively
 * blow through a cap each one individually respected.
 */
export function planFanout<T extends CandidateDriver>(
  candidates: T[],
  s: WhatsAppAlertSettings,
  nowMs: number,
  remainingGlobal: number,
): FanoutPlan<T> {
  const today = pktDayKey(nowMs);
  const minGapMs = s.minGapMinutes * 60_000;
  const staleMs = s.staleDriverDays * 24 * 60 * 60_000;

  const picked: T[] = [];
  const skipped: { uid: string; reason: SkipReason }[] = [];
  const budget = Math.max(0, Math.min(s.maxRecipientsPerTrip, remainingGlobal));

  for (const c of [...candidates].sort((a, b) => a.distanceKm - b.distanceKm)) {
    const reason = skipReasonFor(c, s, nowMs, today, minGapMs, staleMs);
    if (reason) {
      skipped.push({ uid: c.uid, reason });
      continue;
    }
    if (picked.length >= budget) {
      // Eligible, but this ride has woken enough people already. Not an error —
      // the cap is the feature.
      skipped.push({ uid: c.uid, reason: budget === remainingGlobal ? 'global-cap' : 'fanout-cap' });
      continue;
    }
    picked.push(c);
  }

  return { picked, skipped };
}

function skipReasonFor(
  c: CandidateDriver,
  s: WhatsAppAlertSettings,
  nowMs: number,
  today: string,
  minGapMs: number,
  staleMs: number,
): SkipReason | null {
  // Consent first, so nothing downstream can accidentally message a driver who
  // never asked to hear from us.
  if (c.alerts.optIn !== true) return 'not-opted-in';
  if (c.alerts.blocked === true) return 'blocked';
  if (!c.phone) return 'no-phone';
  if (c.distanceKm > s.radiusKm) return 'too-far';
  if (c.lastSeenAt !== null && nowMs - c.lastSeenAt > staleMs) return 'stale';

  const last = c.alerts.lastSentAt ?? null;
  if (last !== null && nowMs - last < minGapMs) return 'too-soon';

  // The daily counter only counts if it belongs to today; a stale day means the
  // driver's allowance has already rolled over.
  const usedToday = c.alerts.sentDay === today ? c.alerts.sentToday ?? 0 : 0;
  if (usedToday >= s.maxPerDriverPerDay) return 'driver-daily-cap';

  return null;
}

/**
 * How a driver's counters look after one alert goes out. Kept here, next to the
 * rules that read them, so a change to the accounting cannot drift away from
 * the change to the caps.
 */
export function afterSend(state: DriverAlertState, nowMs: number): DriverAlertState {
  const today = pktDayKey(nowMs);
  const usedToday = state.sentDay === today ? state.sentToday ?? 0 : 0;
  return { ...state, lastSentAt: nowMs, sentDay: today, sentToday: usedToday + 1 };
}

/** The word an inbound WhatsApp reply amounts to, if any. */
export type InboundIntent = 'stop' | 'start' | 'none';

/**
 * Reads a driver's reply as consent or withdrawal of it.
 *
 * Urdu and Roman Urdu are here because that is what people actually type, and a
 * "STOP" we fail to understand is a person who reaches for Block instead — the
 * exact outcome every other rule in this file is spending effort to avoid. When
 * in doubt the answer is `stop`: acting on an ambiguous opt-out costs us one
 * driver's alerts, while missing a real one costs the number.
 */
export function readInboundIntent(text: string): InboundIntent {
  // Only the FIRST word counts. "Stop" in the middle of a sentence about
  // traffic is a driver chatting, not withdrawing consent, and quietly killing
  // their alerts over it is a real cost. Matching on a token rather than a
  // regex prefix also sidesteps `\b`, which does not behave as a word boundary
  // next to Urdu script — the exact input this needs to get right.
  const first = text.trim().toLowerCase().split(/[\s،,.!؟?]+/)[0] ?? '';
  if (!first) return 'none';
  if (STOP_WORDS.has(first)) return 'stop';
  if (START_WORDS.has(first)) return 'start';
  return 'none';
}

/** Urdu, Roman Urdu and English, because that is what drivers actually type. */
const STOP_WORDS = new Set([
  'stop', 'unsubscribe', 'off', 'band', 'bandh', 'rok', 'roko',
  'بند', 'روکو', 'بس',
]);

const START_WORDS = new Set([
  'start', 'subscribe', 'on', 'resume', 'chalu', 'shuru',
  'شروع', 'چالو',
]);
