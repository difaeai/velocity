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

  // Every numeric code is an anti-abuse refusal. Firebase counts attempts per
  // number *and* per device, so cycling SIMs makes it worse, not better — the
  // copy has to say so or the user will try exactly that.
  if (NUMERIC_CODE_RE.test(code) || code === 'auth/too-many-requests') {
    return {
      throttled: true,
      message:
        'Too many code requests. For security, SMS verification is paused for ' +
        'this number for a while. Please try again in about an hour — trying ' +
        'another number now will not help.',
    };
  }

  switch (code) {
    case 'auth/invalid-phone-number':
      return { throttled: false, message: 'That mobile number is not valid. Check the digits and try again.' };
    case 'auth/missing-phone-number':
      return { throttled: false, message: 'Enter your mobile number first.' };
    case 'auth/captcha-check-failed':
      return { throttled: false, message: 'Security check failed. Please try again.' };
    case 'auth/quota-exceeded':
      return {
        throttled: true,
        message: 'Velocity has hit its SMS limit for now. Please try again later — this is on our side, not yours.',
      };
    case 'auth/operation-not-allowed':
    case 'auth/app-not-authorized':
      // Misconfiguration, not the user's problem. Never surface console steps to
      // a passenger; the crash log is where that belongs.
      return {
        throttled: false,
        message: 'Phone sign-in is temporarily unavailable. Please try again shortly.',
      };
    case 'auth/network-request-failed':
      return {
        throttled: false,
        message: 'No connection. Check your mobile data or Wi-Fi and try again.',
      };
    case 'auth/credential-already-in-use':
      return {
        throttled: false,
        message: 'That number is already attached to another Velocity account.',
      };
    case 'auth/invalid-verification-code':
      return { throttled: false, message: 'Incorrect code — please try again.' };
    case 'auth/code-expired':
      return { throttled: false, message: 'That code has expired. Request a new one.' };
    default:
      return {
        throttled: false,
        message: `Could not send the code right now. Please try again in a few minutes. (ref: ${supportRef(code)})`,
      };
  }
}

/** Convenience for call sites that only need the sentence. */
export function phoneAuthErrorMessage(e: unknown): string {
  return describePhoneAuthError(e).message;
}
