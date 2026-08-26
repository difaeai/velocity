/**
 * Bridges a *native* phone verification into a Firebase JS SDK session.
 *
 * Why this exists: the app verifies phone numbers with the native Firebase SDK
 * (@react-native-firebase/auth), because only the native SDK can attest the app
 * with Play Integrity. The JS-SDK reCAPTCHA-in-a-WebView flow it replaces was
 * unattested traffic, which is why Firebase's anti-abuse throttle kept refusing
 * real users with `auth/error-code:-39`.
 *
 * But the rest of the app — 60-plus screens of Firestore, plus Functions and
 * Storage — runs on the Firebase JS SDK, and the two SDKs keep completely
 * separate auth state. Migrating all of it was not worth the risk, so instead the
 * client hands us the ID token from the native verification and we trade it for a
 * custom token the JS SDK can consume. Same project, same uid, same custom claims
 * — the app's `role` claim and every security rule keep working untouched.
 *
 * This endpoint is deliberately unauthenticated: the caller has just proved a
 * phone number natively and has no JS-SDK session yet. The ID token *is* the
 * credential, so the checks in `checkExchangeable` are the only thing standing
 * between a verified phone and a session. They are all load-bearing.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';

import { auth } from '../lib/firebase';
import { rateLimit } from '../lib/ratelimit';

const schema = z.object({
  idToken: z.string().min(20).max(8192),
});

/**
 * How stale a phone verification may be and still be worth a session. The client
 * exchanges within seconds, so this is generous; the point is that a leaked ID
 * token cannot be redeemed an hour later, and that a native session left over
 * from a previous launch forces a fresh verification instead of being reused.
 */
export const MAX_VERIFICATION_AGE_SEC = 10 * 60;

/** The subset of a decoded ID token this decision depends on. */
export interface PhoneTokenClaims {
  phone_number?: string;
  auth_time: number;
  firebase?: { sign_in_provider?: string };
}

export type ExchangeRejection = 'not-phone' | 'stale';

/**
 * Decides whether a decoded ID token may be traded for a session. Pure, so the
 * two rules that carry the security weight here are unit-testable without an
 * emulator or a real token.
 *
 * Returns `null` to allow, or the reason to refuse.
 */
export function checkExchangeable(
  claims: PhoneTokenClaims,
  nowSec: number,
): ExchangeRejection | null {
  // The only credential this endpoint will trade for a session is a genuine phone
  // verification. Without this check it becomes a token launderer: hand it *any*
  // valid ID token for *any* provider and get back a custom token, which is a
  // privilege-escalation primitive rather than an auth bridge.
  if (claims.firebase?.sign_in_provider !== 'phone' || !claims.phone_number) {
    return 'not-phone';
  }
  // auth_time is when the user actually proved the number, and it does not move
  // when the token is refreshed — so this bounds the age of the *verification*,
  // not of the token that carries it.
  if (nowSec - claims.auth_time > MAX_VERIFICATION_AGE_SEC) return 'stale';
  return null;
}

export const exchangePhoneSession = onCall(async (req) => {
  const parsed = schema.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', 'Provide the verification token.');
  }

  let decoded;
  try {
    // checkRevoked — a token belonging to a session the user signed out of, or one
    // an admin revoked after a ban, must not be exchangeable for a fresh one.
    decoded = await auth.verifyIdToken(parsed.data.idToken, true);
  } catch {
    // Never echo the SDK's reason back: it distinguishes "expired" from "malformed"
    // from "revoked", which is free reconnaissance for anyone probing this endpoint.
    throw new HttpsError('unauthenticated', 'Phone verification could not be confirmed.');
  }

  const rejection = checkExchangeable(decoded, Math.floor(Date.now() / 1000));
  if (rejection === 'not-phone') {
    throw new HttpsError('permission-denied', 'This endpoint only accepts phone verification.');
  }
  if (rejection === 'stale') {
    throw new HttpsError('unauthenticated', 'That verification has expired. Please verify again.');
  }

  // Keyed on the verified uid, so the limit is per phone number and cannot be
  // dodged by reconnecting. Well above any honest retry loop.
  //
  // Raised from 10 alongside the client-side OTP ladder: this counts EXCHANGES,
  // not codes, and a flaky connection turns one successful verification into
  // several exchange attempts. Being refused here after proving your number is
  // the worst possible place to be stopped — the SMS is already spent — so the
  // ceiling sits far above any honest loop and exists only to stop a leaked
  // token being replayed in bulk.
  await rateLimit(decoded.uid, 'exchangePhoneSession', 30, 600);

  // No developer claims: `role` and friends live on the user record, set only by
  // the backend, and are picked up by every ID token minted afterwards. Passing
  // them here would let this function assert a role it has not checked.
  const customToken = await auth.createCustomToken(decoded.uid);
  return { customToken };
});
