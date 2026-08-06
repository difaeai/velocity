/**
 * AsyncStorage persistence for the OTP send brake in `src/lib/otpThrottle.ts`.
 *
 * Persisted rather than held in component state, because the retry pattern that
 * gets users banned is "force-close the app and try again" — in-memory counters
 * reset on exactly the action we need to survive.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  EMPTY_LOG,
  describeDecision,
  evaluateSend,
  pruneLog,
  recordSend,
  recordThrottle,
  type OtpDecision,
  type OtpSendLog,
} from '../lib/otpThrottle';

const STORAGE_KEY = 'velocity.otpSendLog.v1';

// Mirrors the stored value so a Continue tap does not have to await a disk read
// before it can decide. AsyncStorage is written behind the decision.
let cache: OtpSendLog | null = null;

async function load(): Promise<OtpSendLog> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OtpSendLog) : EMPTY_LOG;
    cache = pruneLog(
      { sends: parsed?.sends ?? {}, blockedUntil: parsed?.blockedUntil ?? {} },
      Date.now(),
    );
  } catch {
    // Corrupt or unreadable state must not lock anyone out of signing in.
    cache = EMPTY_LOG;
  }
  return cache;
}

function persist(next: OtpSendLog): void {
  cache = next;
  // Fire and forget: a failed write costs us the cross-launch guard, which is not
  // worth blocking the sign-in flow over.
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

/**
 * Checks the brake. Returns `null` when the send may proceed, or the sentence to
 * show the user when it may not.
 */
export async function checkOtpSendAllowed(phoneKey: string): Promise<string | null> {
  const log = await load();
  const decision: OtpDecision = evaluateSend(log, phoneKey, Date.now());
  return describeDecision(decision);
}

/** Call immediately before handing the number to Firebase. */
export async function noteOtpSendAttempt(phoneKey: string): Promise<void> {
  const log = await load();
  persist(recordSend(log, phoneKey, Date.now()));
}

/** Call when Firebase answers with a throttle, to serve the penalty locally. */
export async function noteOtpThrottled(phoneKey: string, cooldownMs: number): Promise<void> {
  const log = await load();
  persist(recordThrottle(log, phoneKey, Date.now(), cooldownMs));
}
