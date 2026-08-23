/**
 * Turns a phone-auth failure into something a passenger in Pakistan can act on.
 *
 * Firebase's Identity Toolkit returns a family of *numeric* anti-abuse codes that
 * the JS SDK has no mapping for. When that happens the SDK does not throw a nice
 * `auth/too-many-requests`; it throws `auth/error-code:-39` with the message
 * `Firebase: Error (auth/error-code:-39).` — and every screen that fell through to
 * a generic `else` branch printed that verbatim onto the login form. `-39` is the
 * server-side TOO_MANY_ATTEMPTS / quota throttle: it is the single most likely
 * error a real user will ever see here, and it looked like the app had crashed.
 *
 * The rule this module enforces: raw SDK codes never reach the screen. Anything
 * unrecognised still gets a human sentence plus a short support reference.
 */

/** How long Firebase's numeric anti-abuse throttle typically holds for. */
export const SMS_THROTTLE_COOLDOWN_MS = 60 * 60 * 1000;

export interface PhoneAuthFailure {
  /** Sentence to show the user. Never contains an SDK error code. */
  message: string;
  /**
   * True when Firebase throttled us rather than rejecting the input. The caller
   * puts the number in local cooldown instead of letting the user retry into a
   * deeper ban.
   */
  throttled: boolean;
  /**
   * True when nothing the user does will help — the project itself is
   * misconfigured (unregistered signing certificate, a restricted API key, Play
   * Integrity not enabled). Screens use this to stop offering "try again", which
   * on these failures is an invitation to tap forever.
   */
  misconfigured: boolean;
  /**
   * The raw native failure text, for logs and the long-press diagnostic on the
   * sign-in screen. Never rendered on its own. The whole reason this field
   * exists: the Android SDK puts the actual cause here and nowhere else, so
   * dropping it left "(ref: unknown)" as the only evidence a user could report.
   */
  detail?: string;
}

/**
 * `-39`, `-40`, … — Identity Toolkit's unmapped numeric codes. Matching the shape
 * rather than listing values, because the set is undocumented and grows; every
 * one of them means "the server refused, not the user mistyped".
 */
const NUMERIC_CODE_RE = /^auth\/error-code:-?(\d+)$/;

function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * The native failure text, which is where the real cause lives.
 *
 * `@react-native-firebase` wraps every Android throw in a `NativeFirebaseError`
 * whose `code` is `auth/<mapped>` — and when the Android SDK hands it a plain
 * `FirebaseException` rather than a `FirebaseAuthException`, that mapping is the
 * literal string `unknown`. The exception's own message survives on
 * `nativeErrorMessage`, and it is the only thing that says *which* refusal it
 * was. Reading it is what turns "(ref: unknown)" into an actionable report.
 */
function detailOf(e: unknown): string {
  const err = e as { nativeErrorMessage?: unknown; message?: unknown } | null;
  const native = typeof err?.nativeErrorMessage === 'string' ? err.nativeErrorMessage : '';
  const message = typeof err?.message === 'string' ? err.message : '';
  return (native || message).trim();
}

/**
 * Project-configuration refusals, keyed by a fragment of the Android SDK's own
 * wording. Every one of these arrives as `auth/unknown`, so the code alone
 * cannot tell them apart — and every one of them is permanent until somebody
 * changes a setting in the Firebase or Google Cloud console. Retrying is futile,
 * which is why they get their own copy and their own refs.
 */
const MISCONFIGURATIONS: ReadonlyArray<{ ref: string; test: RegExp }> = [
  // The Android API key has application restrictions that do not list this
  // package + signing SHA-1, or API restrictions that omit Identity Toolkit.
  { ref: 'KEY-BLOCKED', test: /requests from this android client application are blocked|blocked\.?\s*\]/i },
  { ref: 'KEY-INVALID', test: /api[ _-]?key not valid|API_KEY_INVALID|api key expired/i },
  // The signing certificate the app was built with is not registered on the
  // Firebase Android app. On a Play-signed build this is almost always the Play
  // App Signing SHA-256, which is a different certificate from the upload key.
  { ref: 'APP-UNVERIFIED', test: /not authorized to use firebase authentication|missing a valid app identifier|sha-?1|sha-?256|app identifier/i },
  // Play Integrity is the attestation the native flow depends on; if the API is
  // off in Google Cloud, or the app is not linked to it, verification never runs.
  { ref: 'INTEGRITY', test: /integrity|attestation|safetynet|app ?check/i },
  // reCAPTCHA is the fallback when Play Integrity is unavailable. Seeing it fail
  // means both paths are down — same console problem, so same treatment.
  { ref: 'RECAPTCHA', test: /recaptcha/i },
  // Identity Toolkit disabled on the project, or the project not permitted.
  { ref: 'API-DISABLED', test: /identitytoolkit|has not been used in project|PROJECT_NOT_PERMITTED|is disabled/i },
  { ref: 'BILLING', test: /BILLING_NOT_ENABLED|billing/i },
];

/** "auth/error-code:-39" → "E39"; "auth/internal-error" → "internal-error". */
function supportRef(code: string): string {
  const numeric = NUMERIC_CODE_RE.exec(code);
  if (numeric) return `E${numeric[1]}`;
  return code.replace(/^auth\//, '') || 'unknown';
}

/**
 * Maps a `signInWithPhoneNumber` / `verifyPhoneNumber` rejection to user-facing
 * copy. Accepts `unknown` so callers can hand over a bare `catch` binding.
 */
export function describePhoneAuthError(e: unknown): PhoneAuthFailure {
  const code = codeOf(e);
  const detail = detailOf(e);

  // Every numeric code is an anti-abuse refusal. Firebase counts attempts per
  // number *and* per device, so cycling SIMs makes it worse, not better — the
  // copy has to say so or the user will try exactly that.
  if (NUMERIC_CODE_RE.test(code) || code === 'auth/too-many-requests') {
    return {
      throttled: true,
      misconfigured: false,
      detail,
      message:
        'Too many code requests. For security, SMS verification is paused for ' +
        'this number for a while. Please try again in about an hour — trying ' +
        'another number now will not help.',
    };
  }

  switch (code) {
    case 'auth/invalid-phone-number':
      return { throttled: false, misconfigured: false, detail, message: 'That mobile number is not valid. Check the digits and try again.' };
    case 'auth/missing-phone-number':
      return { throttled: false, misconfigured: false, detail, message: 'Enter your mobile number first.' };
    case 'auth/captcha-check-failed':
      return { throttled: false, misconfigured: false, detail, message: 'Security check failed. Please try again.' };
    case 'auth/quota-exceeded':
      return {
        throttled: true,
        misconfigured: false,
        detail,
        message: 'Velocity has hit its SMS limit for now. Please try again later — this is on our side, not yours.',
      };
    case 'auth/operation-not-allowed':
    case 'auth/app-not-authorized':
      // Misconfiguration, not the user's problem. Never surface console steps to
      // a passenger; the crash log is where that belongs.
      return {
        throttled: false,
        misconfigured: true,
        detail,
        message: 'Phone sign-in is not available on this version of the app. Please contact support.',
      };
    case 'auth/network-request-failed':
      return {
        throttled: false,
        misconfigured: false,
        detail,
        message: 'No connection. Check your mobile data or Wi-Fi and try again.',
      };
    case 'auth/credential-already-in-use':
      return {
        throttled: false,
        misconfigured: false,
        detail,
        message: 'That number is already attached to another Velocity account.',
      };
    case 'auth/invalid-verification-code':
      return { throttled: false, misconfigured: false, detail, message: 'Incorrect code — please try again.' };
    case 'auth/code-expired':
      return { throttled: false, misconfigured: false, detail, message: 'That code has expired. Request a new one.' };
  }

  // Anything left is `auth/unknown` or a bare throw. On Android that bucket is
  // overwhelmingly a console misconfiguration — an unregistered signing
  // certificate, a restricted API key, Play Integrity switched off — and the
  // only thing separating them is the native text. Classify on that.
  const known = MISCONFIGURATIONS.find((m) => m.test.test(detail));
  if (known) {
    // "Try again in a few minutes" was the old copy here, and it was false: no
    // amount of waiting fixes a project setting. Say what is actually true and
    // give a ref that names the cause, so a report identifies the fix.
    return {
      throttled: false,
      misconfigured: true,
      detail,
      message:
        'Phone sign-in is not working on this version of the app. This is a ' +
        `problem on our side, not with your number. (ref: ${known.ref})`,
    };
  }

  return {
    throttled: false,
    misconfigured: false,
    detail,
    message: `Could not send the code right now. Please try again in a few minutes. (ref: ${supportRef(code)})`,
  };
}

/** Convenience for call sites that only need the sentence. */
export function phoneAuthErrorMessage(e: unknown): string {
  return describePhoneAuthError(e).message;
}
