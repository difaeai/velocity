import { useSyncExternalStore } from 'react';

import { firebaseConfig, FUNCTIONS_REGION } from '@/lib/config';

/**
 * This visitor's own deadline for today's price (backend studio/priceClock.ts).
 * A plain POST to the callable, because the public pages stay free of the
 * Firebase SDK; kept in the browser so a return visit costs no function call.
 */
const CLOCK_URL = `https://${FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/studioPriceClock`;
const KEPT = 'vexaPriceEndsAt';

let endsAtMs: number | null = null;
let failed = false;
let asked = false;

function kept(): number | null {
  try {
    return Number(localStorage.getItem(KEPT)) || null;
  } catch {
    return null;
  }
}

function keep(value: number) {
  try {
    localStorage.setItem(KEPT, String(value));
  } catch {
    // A private window: it is simply asked again next visit.
  }
}

function ask() {
  if (asked) return;
  asked = true;
  endsAtMs = kept();
  if (endsAtMs) return;
  fetch(CLOCK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}' })
    .then((r) => r.json())
    .then(({ result }: { result: { leftMs: number } }) => {
      // Counted from now on this device, so a wrong device clock cannot shorten or stretch it.
      endsAtMs = Date.now() + result.leftMs;
      keep(endsAtMs);
    })
    .catch(() => {
      failed = true;
    });
}

// Polled faster than it changes so a late tick never skips a second.
function subscribe(tick: () => void) {
  ask();
  const id = setInterval(tick, 250);
  return () => clearInterval(id);
}

const secondsLeft = (): number | null | undefined =>
  failed ? undefined : endsAtMs === null ? null : Math.ceil((endsAtMs - Date.now()) / 1000);

/** Seconds of today's price left: null while asking, undefined if the server could not say. */
export const usePriceSecondsLeft = () => useSyncExternalStore(subscribe, secondsLeft, () => null);

/** Whether this visitor's own time is over. Re-renders only when that flips. */
export const usePriceRaised = () =>
  useSyncExternalStore(
    subscribe,
    () => endsAtMs !== null && Date.now() >= endsAtMs,
    () => false,
  );
