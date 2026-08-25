/**
 * Client-side brake on OTP sends — the pure half.
 *
 * Firebase throttles `accounts:sendVerificationCode` per phone number *and* per
 * device, and when it does it answers with an unmapped numeric code (see
 * `phoneAuthErrors.ts`). The way a real user reaches that state is not malice: the
 * SMS is slow on a Pakistani network, they tap Continue again, then again, then
 * force-close the app and tap five more times. Nothing in the app stopped them,
 * so they earned themselves an hour-long ban in under a minute.
 *
 * So the app now refuses to send faster than Firebase tolerates, remembers the
 * refusals across launches, and — once Firebase does throttle us — sits out the
 * cooldown locally with a countdown instead of retrying into a deeper ban.
 *
 * Pure and I/O-free so it is unit-testable; `src/auth/otpGuard.ts` bolts on the
 * AsyncStorage persistence.
 */

/** Minimum gap before the Nth send of the same number, in seconds. */
const COOLDOWN_LADDER_S = [0, 30, 60, 120, 300];

/** Fallback gap, so an out-of-range index can only ever be *more* cautious. */
const LONGEST_COOLDOWN_S = Math.max(...COOLDOWN_LADDER_S);

/** Sends allowed per number per hour, comfortably under Firebase's own ceiling. */
export const MAX_SENDS_PER_NUMBER = 5;

/**
 * RETRIES allowed per device per hour, across all numbers. This is the brake on
 * "maybe my other SIM works" — one number that has already been throttled being
 * chased around a handful of SIMs until the whole device is banned.
 *
 * It deliberately does NOT count a number's first code (see FIRST_CODE_EXEMPT
 * below), so it can never be the reason a new person is turned away.
 */
export const MAX_SENDS_PER_DEVICE = 40;

/**
 * The one device ceiling that nothing is exempt from.
 *
 * A signup drive runs one phone past a hundred people, and every one of them is
 * a first code that must go through. That is the whole point of the exemption —
 * but an exemption with no ceiling at all is a free SMS pump, so this is the
 * hard stop, set well above any real queue of people and well below anything
 * that would cost money to sit through.
 */
export const MAX_SENDS_PER_DEVICE_HARD = 150;

/**
 * A number nobody has asked for a code for on this device in the last hour is a
 * NEW PERSON, not a retry. Their first code skips the per-device retry cap and
 * the per-device block entirely.
 *
 * Without this, ten people signing up on the same phone — a driver onboarding
 * desk, a family sharing a handset, a demo — locked the eleventh out for an
 * hour over a queue they had nothing to do with. Firebase throttles per number
 * as well as per device, and the per-number ladder below is untouched, so the
 * one thing this loosens is precisely the one thing that punished a stranger.
 */
const FIRST_CODE_EXEMPT = true;

export const WINDOW_MS = 60 * 60 * 1000;

/** Key used for the device-wide tally. Not a valid phone number, so it cannot collide. */
export const DEVICE_KEY = '*';

export interface OtpSendLog {
  /** Key (phone digits, or DEVICE_KEY) → epoch-ms of each send attempt. */
  sends: Record<string, number[]>;
  /** Key → epoch-ms until which we refuse to send at all. */
  blockedUntil: Record<string, number>;
}

export const EMPTY_LOG: OtpSendLog = { sends: {}, blockedUntil: {} };

export type OtpDecision =
  | { allowed: true }
  | {
      allowed: false;
      /**
       * `throttled` — Firebase already refused us and we are serving the penalty.
       * `cooldown`  — too soon after the previous send.
       * `capped`    — hourly ceiling reached for this number or this device.
       */
      reason: 'throttled' | 'cooldown' | 'capped';
      waitMs: number;
    };

function recent(log: OtpSendLog, key: string, now: number): number[] {
  return (log.sends[key] ?? []).filter((t) => now - t < WINDOW_MS);
}

/** Drops entries that have aged out, so persisted state cannot grow forever. */
export function pruneLog(log: OtpSendLog, now: number): OtpSendLog {
  const sends: Record<string, number[]> = {};
  for (const [key, times] of Object.entries(log.sends ?? {})) {
    const kept = times.filter((t) => now - t < WINDOW_MS);
    if (kept.length) sends[key] = kept;
  }
  const blockedUntil: Record<string, number> = {};
  for (const [key, until] of Object.entries(log.blockedUntil ?? {})) {
    if (until > now) blockedUntil[key] = until;
  }
  return { sends, blockedUntil };
}

/** May we ask Firebase for a code for `phoneKey` right now? */
export function evaluateSend(log: OtpSendLog, phoneKey: string, now: number): OtpDecision {
  const mine = recent(log, phoneKey, now);
  const device = recent(log, DEVICE_KEY, now);
  // Nobody has asked for a code for this number on this phone in the last hour,
  // so this is somebody new rather than somebody retrying. Everything keyed to
  // the DEVICE — the block and the retry cap — steps aside for them; everything
  // keyed to the NUMBER still applies, because that is what Firebase counts.
  const firstCodeForThisNumber = FIRST_CODE_EXEMPT && mine.length === 0;

  // A server-side throttle outranks everything else: retrying during it is what
  // extends it.
  const blockedKeys = firstCodeForThisNumber ? [phoneKey] : [phoneKey, DEVICE_KEY];
  for (const key of blockedKeys) {
    const until = log.blockedUntil?.[key] ?? 0;
    if (until > now) return { allowed: false, reason: 'throttled', waitMs: until - now };
  }

  if (mine.length >= MAX_SENDS_PER_NUMBER) {
    const oldest = Math.min(...mine);
    return { allowed: false, reason: 'capped', waitMs: oldest + WINDOW_MS - now };
  }
  // The hard ceiling binds everyone, exempt or not.
  if (device.length >= MAX_SENDS_PER_DEVICE_HARD) {
    const oldest = Math.min(...device);
    return { allowed: false, reason: 'capped', waitMs: oldest + WINDOW_MS - now };
  }
  if (!firstCodeForThisNumber && device.length >= MAX_SENDS_PER_DEVICE) {
    const oldest = Math.min(...device);
    return { allowed: false, reason: 'capped', waitMs: oldest + WINDOW_MS - now };
  }

  // The ladder is indexed by how many sends this number has already had.
  const last = mine.length ? Math.max(...mine) : null;
  if (last !== null) {
    const idx = Math.min(mine.length, COOLDOWN_LADDER_S.length - 1);
    const requiredMs = (COOLDOWN_LADDER_S[idx] ?? LONGEST_COOLDOWN_S) * 1000;
    const elapsed = now - last;
    if (elapsed < requiredMs) {
      return { allowed: false, reason: 'cooldown', waitMs: requiredMs - elapsed };
    }
  }

  return { allowed: true };
}

/**
 * Records an *attempt*, not a success. A send that times out client-side has very
 * often already gone out on the server, so counting only successes would let the
 * app fire unlimited invisible SMS.
 */
export function recordSend(log: OtpSendLog, phoneKey: string, now: number): OtpSendLog {
  const pruned = pruneLog(log, now);
  return {
    ...pruned,
    sends: {
      ...pruned.sends,
      [phoneKey]: [...(pruned.sends[phoneKey] ?? []), now],
      [DEVICE_KEY]: [...(pruned.sends[DEVICE_KEY] ?? []), now],
    },
  };
}

/** Called after Firebase itself throttles us, to sit out the penalty locally. */
export function recordThrottle(
  log: OtpSendLog,
  phoneKey: string,
  now: number,
  cooldownMs: number,
): OtpSendLog {
  const pruned = pruneLog(log, now);
  return {
    ...pruned,
    blockedUntil: { ...pruned.blockedUntil, [phoneKey]: now + cooldownMs },
  };
}

/** "in about an hour" / "in 4 minutes" / "in 30 seconds" — never "in 3599s". */
export function formatWait(waitMs: number): string {
  const s = Math.ceil(waitMs / 1000);
  if (s <= 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  return `about ${h} hour${h === 1 ? '' : 's'}`;
}

/** The sentence shown when the local brake, not Firebase, blocks a send. */
export function describeDecision(decision: OtpDecision): string | null {
  if (decision.allowed) return null;
  const wait = formatWait(decision.waitMs);
  switch (decision.reason) {
    case 'throttled':
      return `SMS verification for this number is paused. Please try again in ${wait}.`;
    case 'cooldown':
      return `Please wait ${wait} before requesting another code.`;
    case 'capped':
      return `You've requested several codes already. Please try again in ${wait}, or contact support.`;
  }
}
