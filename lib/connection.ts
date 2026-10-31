/**
 * What every screen needs to know about the network, in one place.
 *
 * - `trackCall` is called by the one `callable()` in lib/api.ts, so the
 *   NetworkNotice can show a slow call's real elapsed time instead of a spinner.
 * - `explainError` turns any failed call into what went wrong, whose fault it
 *   is, and what to do. A sentence the server wrote for this exact case is kept
 *   as it is; only the bare transport codes ("internal", "Failed to fetch") are
 *   rewritten, because those mean nothing to the person reading them.
 *
 * Mirrors apps/mobile/src/lib/connection.ts — keep the two in step.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

export function subscribeCalls(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const callsVersion = (): number => version;

/** Calls still waiting for an answer. */
const inFlight = new Map<number, { startedMs: number; limitMs: number }>();
let nextId = 0;

/** Call when a request starts; call what it returns when it settles, however it settles. */
export function trackCall(limitMs = 70_000): () => void {
  const id = nextId++;
  inFlight.set(id, { startedMs: Date.now(), limitMs });
  notify();
  return () => {
    inFlight.delete(id);
    notify();
  };
}

/** The call that has waited longest, or null when nothing is pending. */
export function oldestCall(): { startedMs: number; limitMs: number } | null {
  let oldest: { startedMs: number; limitMs: number } | null = null;
  for (const c of inFlight.values()) if (!oldest || c.startedMs < oldest.startedMs) oldest = c;
  return oldest;
}

/** A message that is only a transport code, not a sentence anybody wrote for this case. */
const BARE = /^(internal|unavailable|deadline[-_ ]exceeded|unauthenticated|permission[-_ ]denied|not[-_ ]found|resource[-_ ]exhausted|unknown|cancelled|failed to fetch|load failed|network ?error.*|network request failed)\.?$/i;

/** What went wrong, whose fault it is, and how to fix it. Pure apart from the default `online`. */
export function explainError(e: unknown, online = typeof navigator === 'undefined' || navigator.onLine): string {
  const code = String((e as { code?: unknown } | null)?.code ?? '').replace(/^functions\//, '');
  const raw = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const written = raw !== '' && !BARE.test(raw);

  if (!online) return 'You are offline — your connection dropped, not Velocity. Reconnect and try again; nothing you typed is lost.';
  switch (code) {
    case 'unauthenticated':
      return 'Your sign-in ended — not something you did. Sign in again; what you typed here is kept.';
    case 'deadline-exceeded':
      return 'Velocity took too long to answer — a slow connection or our side. Try again in a minute; if you were saving, check it before saving again.';
    case 'unavailable':
      return 'Velocity is briefly unavailable — our side, not yours. Try again in a minute.';
    case 'resource-exhausted':
      return written ? raw : 'Too many tries in a short time. Wait a minute, then try again.';
    case 'permission-denied':
      return written ? raw : 'You do not have access to this. If you should, ask an admin to check your account.';
    case 'not-found':
      return written ? raw : 'This part of Velocity is not available right now — our side. Reload the page; if it stays, tell us.';
    default:
      return written ? raw : 'Something broke on our side — not your fault. Try again; if it keeps happening, tell us what you were doing.';
  }
}

/** The same error with an explained message, keeping its `code` and `details` for any caller that checks them. */
export function explained(e: unknown): Error {
  const out = new Error(explainError(e)) as Error & { code?: unknown; details?: unknown };
  out.code = (e as { code?: unknown } | null)?.code;
  out.details = (e as { details?: unknown } | null)?.details;
  out.cause = e;
  return out;
}
