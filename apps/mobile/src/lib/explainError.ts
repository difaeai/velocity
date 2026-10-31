/**
 * A failed call, said the way a person needs it: what went wrong, whose fault it
 * is, and how to fix it. A sentence the server wrote for this exact case is kept
 * as it is; only bare transport codes ("internal") are rewritten, because those
 * mean nothing to the person reading them.
 *
 * Pure, so it is tested without a phone; src/lib/connection.ts supplies `online`.
 * Mirrors lib/connection.ts in the web app — keep the two in step.
 */

/** A message that is only a transport code, not a sentence anybody wrote for this case. */
const BARE = /^(internal|unavailable|deadline[-_ ]exceeded|unauthenticated|permission[-_ ]denied|not[-_ ]found|resource[-_ ]exhausted|unknown|cancelled|failed to fetch|network ?error.*|network request failed)\.?$/i;

/** Codes that can mean the phone, not the server: worth asking the internet before explaining. */
export const TRANSPORT = new Set(['internal', 'unavailable', 'deadline-exceeded', 'unknown']);

export const codeOf = (e: unknown): string =>
  String((e as { code?: unknown } | null)?.code ?? '').replace(/^functions\//, '');

export function explainError(e: unknown, online: boolean): string {
  const code = codeOf(e);
  const raw = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const written = raw !== '' && !BARE.test(raw);

  if (!online) {
    return 'You are offline — your phone lost its connection, not Velocity. Check Wi-Fi or mobile data and try again; nothing was lost.';
  }
  switch (code) {
    case 'unauthenticated':
      return 'You were signed out — not something you did. Sign in again; what you typed is kept.';
    case 'deadline-exceeded':
      return 'Velocity took too long to answer — a slow connection or our side. Try again in a minute; if you were booking or paying, check it went through before trying again.';
    case 'unavailable':
      return 'Velocity is briefly unavailable — our side, not yours. Try again in a minute.';
    case 'resource-exhausted':
      return written ? raw : 'Too many tries in a short time. Wait a minute, then try again.';
    case 'permission-denied':
      return written ? raw : 'Your account cannot do this. If you think it should, tell us in Help & complaints.';
    case 'not-found':
      return written ? raw : 'This needs the newest Velocity. Update the app from the store, then try again.';
    default:
      return written ? raw : 'Something broke on our side — not your fault. Try again; if it keeps happening, tell us in Help & complaints.';
  }
}

/** The same error with an explained message, keeping `code` and `details` for any caller that checks them. */
export function explained(e: unknown, online: boolean): Error {
  const out = new Error(explainError(e, online)) as Error & { code?: unknown; details?: unknown; cause?: unknown };
  out.code = (e as { code?: unknown } | null)?.code;
  out.details = (e as { details?: unknown } | null)?.details;
  out.cause = e;
  return out;
}
