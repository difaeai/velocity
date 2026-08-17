/**
 * Phone sign-in — verified natively, consumed by the Firebase JS SDK.
 *
 * The app used to verify numbers through the JS SDK's reCAPTCHA flow, which on
 * React Native meant `expo-firebase-recaptcha`: an unmaintained package that
 * rendered a hidden WebView and loaded firebase 8.0.0 off gstatic to solve a
 * reCAPTCHA v2 challenge. To Firebase's anti-abuse system that is unattested
 * traffic, and it throttled real users on their first attempt with the unmapped
 * numeric code `auth/error-code:-39`.
 *
 * The native SDK attests the app with **Play Integrity** instead — no captcha, no
 * WebView, and on many Android devices the SMS is read automatically so the user
 * never types a code at all.
 *
 * The catch is that the native SDK and the JS SDK keep entirely separate auth
 * state, and ~60 screens of Firestore run on the JS SDK. So the native session is
 * used for exactly one thing — proving the phone number — and then traded for a
 * JS-SDK session via the `exchangePhoneSession` callable and discarded. After
 * `confirm()` resolves there is no native session left, which keeps a single
 * source of truth (`src/firebase.ts`'s `auth`) for the whole app.
 */
import {
  getAuth as getNativeAuth,
  getIdToken,
  onAuthStateChanged as onNativeAuthStateChanged,
  signInWithPhoneNumber as nativeSignInWithPhoneNumber,
  signOut as nativeSignOut,
  type User as NativeUser,
} from '@react-native-firebase/auth';
import { signInWithCustomToken } from 'firebase/auth';

import { auth as jsAuth } from '../firebase';
import { api } from '../api/client';
import { clearResourceCache } from '../lib/cachedResource';

export interface PhoneVerification {
  /**
   * Hands the SMS code to Firebase and, on success, leaves the JS SDK signed in.
   * Rejects with the underlying Firebase error so callers can run it through
   * `describePhoneAuthError`.
   */
  confirm(code: string): Promise<void>;
  /**
   * True when Android already verified the number and only the hand-off into the
   * JS SDK is still outstanding — `confirm()` then ignores the code entirely.
   *
   * The screen needs this because auto-verification means the user never typed
   * anything: if the hand-off fails, a "tap Verify to finish" prompt would hit
   * the empty-field guard and refuse to do the one thing that would work.
   */
  verifiedNatively(): boolean;
  /** Stop watching for Android's automatic verification. Safe to call twice. */
  cancel(): void;
}

/**
 * Turns the native session into a JS-SDK session for the same uid.
 *
 * The native ID token is the proof of phone ownership; the backend verifies it and
 * mints a custom token. Custom claims (`role`) live on the user record, so they
 * survive the swap and every security rule keeps working.
 */
async function bridgeToJsSdk(nativeUser: NativeUser): Promise<void> {
  const idToken = await getIdToken(nativeUser);
  const { customToken } = await api.exchangePhoneSession({ idToken });
  await signInWithCustomToken(jsAuth, customToken);

  // The native session has done its job. Dropping it means the app has exactly one
  // auth state to reason about, and a stale native session can never be replayed
  // against the exchange endpoint on a later launch.
  await nativeSignOut(getNativeAuth()).catch(() => {});
}

/**
 * Starts verification for an E.164 number (e.g. "+923001234567").
 *
 * `onAutoVerified` fires when Android verified the number on its own — the code
 * never reaches the user, so the screen should move on without waiting for input.
 * It receives an error instead if the automatic path failed mid-bridge.
 */
export async function startPhoneVerification(
  e164: string,
  onAutoVerified?: (error?: unknown) => void,
): Promise<PhoneVerification> {
  const nativeAuth = getNativeAuth();

  // A session left over from a previous launch would carry an old `auth_time`, and
  // the exchange endpoint rejects stale verifications. Start clean.
  await nativeSignOut(nativeAuth).catch(() => {});

  // Guards the bridge against running twice: Android's auto-verification and the
  // user's own `confirm()` can both land, and two exchanges would mean two
  // signInWithCustomToken calls racing over one session.
  let bridged = false;
  // The in-flight auto-verification bridge, so a `confirm()` that arrives while
  // it is still running can wait for its result instead of racing it.
  let bridgeInFlight: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;

  const cancel = () => {
    unsubscribe?.();
    unsubscribe = null;
  };

  // Instant verification: on many Android devices the native SDK reads the SMS and
  // signs in by itself, so nothing ever calls confirm(). Watching native auth state
  // is the only way to notice — and the watcher goes up *before* the request, since
  // on a fast device the sign-in can land before the send even resolves.
  // The immediate null from the signOut above is ignored by the guard.
  unsubscribe = onNativeAuthStateChanged(nativeAuth, (user) => {
    if (!user || bridged) return;
    bridged = true;
    cancel();
    bridgeInFlight = bridgeToJsSdk(user).then(
      () => onAutoVerified?.(),
      (e) => {
        // Let the user fall back to typing the code.
        bridged = false;
        bridgeInFlight = null;
        onAutoVerified?.(e);
      },
    );
  });

  let confirmation: Awaited<ReturnType<typeof nativeSignInWithPhoneNumber>>;
  try {
    confirmation = await nativeSignInWithPhoneNumber(nativeAuth, e164);
  } catch (e) {
    // Never leave a listener behind on a send that failed.
    cancel();
    throw e;
  }

  return {
    cancel,
    // A native session outliving the bridge can only mean the verification
    // succeeded and the exchange did not: bridgeToJsSdk signs out natively as
    // its last step on success.
    verifiedNatively: () => nativeAuth.currentUser !== null,
    async confirm(code: string) {
      // Auto-verification already consumed this verification, so Firebase has
      // nothing left to check the code against: calling confirm() now rejects
      // with auth/session-expired, which the screen renders as "that code has
      // expired" — to a user who just typed the correct code and is, or is about
      // to be, signed in. Wait for the bridge that is already running instead.
      // This check has to happen BEFORE confirm(), not after it; after is too
      // late, the throw has already happened.
      if (bridged) {
        if (bridgeInFlight) await bridgeInFlight;
        return;
      }

      // Claim ownership before the native sign-in lands. confirm() itself moves
      // native auth state, which wakes the watcher above — and without this it
      // would start a second, competing bridge for the same session.
      bridged = true;
      cancel();
      try {
        // A native session already present means Android verified the number on
        // its own and only the *bridge* failed (the exchange call, say, on a
        // flaky connection) — bridgeToJsSdk signs out natively on success, so
        // this can only be a half-finished attempt. The verification is spent
        // either way, so re-running confirm() would just fail; retry the part
        // that actually broke and let the user's Verify tap mean something.
        const verified = nativeAuth.currentUser;
        if (verified) {
          await bridgeToJsSdk(verified);
          return;
        }

        const credential = await confirmation.confirm(code);
        const user = credential?.user ?? nativeAuth.currentUser;
        if (!user) throw new Error('Verification did not return a user.');
        await bridgeToJsSdk(user);
      } catch (e) {
        // Leave the door open for a retry rather than stranding a verified user.
        bridged = false;
        throw e;
      }
    },
  };
}

/** Signs out of both SDKs, so a leftover native session can never be replayed. */
export async function signOutEverywhere(): Promise<void> {
  await nativeSignOut(getNativeAuth()).catch(() => {});
  await jsAuth.signOut();
  // Cached dashboard payloads are uid-scoped, so the next account could never
  // read them — but there is no reason to leave someone's earnings sitting on a
  // handset they have signed out of.
  await clearResourceCache();
}
