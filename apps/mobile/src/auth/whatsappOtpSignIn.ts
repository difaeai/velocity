/**
 * The WhatsApp half of sign-in.
 *
 * A code sent as a WhatsApp message instead of an SMS, because Firebase charges
 * several times as much per SMS to a Pakistani number and Velocity already runs
 * a WhatsApp business number for offline-driver alerts.
 *
 * This module never decides *whether* to use WhatsApp — `phoneSignIn.ts` does
 * that, and falls through to the native Firebase flow whenever this one answers
 * `null`. Everything here is written so that answering `null` is cheap and
 * common: a backend with no approved template, a number that is not on WhatsApp,
 * Meta pausing the template overnight. None of those may cost anybody a login.
 */
import { signInWithCustomToken } from 'firebase/auth';

import { auth as jsAuth } from '../firebase';
import { api } from '../api/client';
import type { PhoneVerification } from './phoneSignIn';

/**
 * Reasons that are true of the whole *backend* rather than of one number, and
 * so are worth remembering for the rest of the app session.
 *
 * Without this, a user whose backend has no OTP template configured pays a
 * pointless round trip to Asia South before every single code — including every
 * Resend, which is exactly when they are least patient. `undeliverable` is
 * deliberately absent: that one is about one phone, and caching it against the
 * whole app would send the next person to SMS for no reason.
 */
const GLOBAL_REASONS = new Set(['not-configured', 'disabled', 'suppressed', 'capped']);

/** How long a remembered refusal stands before WhatsApp is tried again. */
const REMEMBER_MS = 10 * 60 * 1000;

let unavailableUntil = 0;
/** Numbers Meta told us are not on WhatsApp, so we stop asking for them. */
const notOnWhatsApp = new Map<string, number>();

/** Forgets what was learned about availability. Exported for sign-out. */
export function resetWhatsAppOtpMemory(): void {
  unavailableUntil = 0;
  notOnWhatsApp.clear();
}

function skipWhatsApp(e164: string): boolean {
  const now = Date.now();
  if (unavailableUntil > now) return true;
  const until = notOnWhatsApp.get(e164);
  if (until !== undefined && until > now) return true;
  return false;
}

/**
 * Callable failures, translated into the `auth/*` codes both sign-in screens
 * already understand.
 *
 * The screens were written against Firebase's error vocabulary — `code-expired`
 * means "tap Resend", `too-many-requests` means "wait", anything else means
 * "you mistyped". Rather than teach two screens a second vocabulary, the one
 * place that knows about `functions/*` codes converts them here. A backend
 * failure that is genuinely ours (a network drop mid-call) is passed through
 * untouched, so it still reads as "your code was accepted but sign-in did not
 * finish" rather than being blamed on the user's typing.
 */
function asAuthError(e: unknown): unknown {
  const code = (e as { code?: string } | null)?.code ?? '';
  const translated =
    code === 'functions/unauthenticated'
      ? 'auth/code-expired'
      : code === 'functions/resource-exhausted'
        ? 'auth/too-many-requests'
        : code === 'functions/permission-denied' || code === 'functions/invalid-argument'
          ? 'auth/invalid-verification-code'
          : null;
  if (!translated) return e;
  return Object.assign(new Error((e as Error)?.message ?? 'Verification failed.'), {
    code: translated,
  });
}

/**
 * Asks the backend to send a code over WhatsApp.
 *
 * Returns a `PhoneVerification` when the message is on its way, or `null` when
 * the caller should use SMS instead. It throws only for a refusal the user needs
 * to see — asking for too many codes — because silently answering that with an
 * SMS would hand a dearer channel to precisely the behaviour the limit exists to
 * discourage.
 */
export async function startWhatsAppVerification(
  e164: string,
): Promise<PhoneVerification | null> {
  if (skipWhatsApp(e164)) return null;

  let result: Awaited<ReturnType<typeof api.startWhatsAppOtp>>;
  try {
    result = await api.startWhatsAppOtp({ phone: e164 });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code ?? '';
    // The per-number ceiling. Surfaced, not swallowed — see above.
    if (code === 'functions/resource-exhausted') throw asAuthError(e);
    // Anything else — offline, cold start timeout, a bad deploy — is not the
    // user's problem and must not be their dead end. SMS still works.
    return null;
  }

  if (!result.sent) {
    if (GLOBAL_REASONS.has(result.reason)) unavailableUntil = Date.now() + REMEMBER_MS;
    else if (result.reason === 'undeliverable') {
      notOnWhatsApp.set(e164, Date.now() + REMEMBER_MS);
    }
    return null;
  }

  const { challengeId } = result;

  return {
    channel: 'whatsapp',
    // There is no automatic verification to watch for and nothing to unsubscribe
    // from: the code arrives in a chat, and only the user can read it across.
    verifiedNatively: () => false,
    cancel: () => {},
    async confirm(code: string) {
      try {
        const { customToken } = await api.verifyWhatsAppOtp({ challengeId, code });
        await signInWithCustomToken(jsAuth, customToken);
      } catch (e) {
        throw asAuthError(e);
      }
    },
  };
}
