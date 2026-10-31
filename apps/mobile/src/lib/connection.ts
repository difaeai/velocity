/**
 * What every screen needs to know about the network, in one place — with no
 * native module. The phone is believed offline only after a call fails on
 * transport AND a tiny probe cannot reach the internet; it is back the moment a
 * probe gets through. Nothing is polled while the app is online: the probe
 * repeats every 10 seconds only while offline, and when the app comes back to
 * the front.
 *
 * - `trackCall` is called by the one `callable()` in src/api/client.ts, so the
 *   NetworkNotice can show a slow call's real elapsed time instead of a spinner.
 * - `isOnline` is what src/lib/explainError.ts is told when it explains a failure.
 *
 * Mirrors lib/connection.ts in the web app — keep the two in step.
 */
import { AppState } from 'react-native';

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

export function subscribeNetwork(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const networkVersion = (): number => version;

// ── online ───────────────────────────────────────────────────────────────────

let online = true;
export const isOnline = (): boolean => online;

function setOnline(next: boolean) {
  if (next === online) return;
  online = next;
  notify();
}

/** Google's own connectivity check: an empty 204 any working network answers at once. */
const PROBE_URL = 'https://clients3.google.com/generate_204';
let probing: Promise<boolean> | null = null;
let again: ReturnType<typeof setTimeout> | null = null;

/** Ask the internet directly. While offline it asks again every 10 seconds, and stops once back. */
export function probe(): Promise<boolean> {
  if (probing) return probing;
  probing = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(PROBE_URL, { method: 'HEAD', signal: ctrl.signal });
      setOnline(res.status === 204 || res.ok);
    } catch {
      setOnline(false);
    } finally {
      clearTimeout(timer);
      probing = null;
    }
    if (again) clearTimeout(again);
    again = online ? null : setTimeout(() => void probe(), 10_000);
    return online;
  })();
  return probing;
}

// Back in front is when a dropped connection is most likely to have changed.
AppState.addEventListener('change', (state) => {
  if (state === 'active' && !online) void probe();
});

// ── slow calls ───────────────────────────────────────────────────────────────

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
