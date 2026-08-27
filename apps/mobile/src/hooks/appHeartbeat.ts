/**
 * The driver app's "I am on screen" heartbeat.
 *
 * WHY THIS EXISTS
 * Offline does not mean closed. A driver can be toggled Offline while sitting
 * in the app — deciding whether to start a shift, checking earnings, reading
 * the request feed. Nothing in the driver document could tell those two apart:
 * `lastSeenAt` is written when they flip the toggle and on location pings while
 * ONLINE, so for an offline driver it records a moment in the past, not a state.
 *
 * That gap has a price. The WhatsApp alert for offline drivers is a paid
 * conversation, and sending one to somebody who is looking at the screen that
 * already shows the ride buys nothing, costs money, and reads as the app
 * pestering them — which is how a useful alert turns into a blocked sender.
 *
 * So while any driver screen is in the foreground, this stamps `appActiveAt`.
 * The backend treats a recent stamp as "do not WhatsApp this person".
 *
 * WHAT IT COSTS
 * One tiny write every two minutes, and only while the app is actually on
 * screen. Backgrounding stops the timer on the next tick, and a killed app
 * stops writing by definition — which is exactly the signal we want, since the
 * absence of a heartbeat is what makes a driver eligible again.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from '../firebase';

/**
 * How often to re-stamp while the app is open.
 *
 * Comfortably under the backend's `appClosedAfterMinutes` (5 by default), so a
 * driver reading their feed never drifts into looking closed between beats.
 */
const HEARTBEAT_MS = 2 * 60 * 1000;

/** Writes are fire-and-forget: a missed beat costs nothing worth reporting. */
function stamp(uid: string): void {
  setDoc(doc(db, 'drivers', uid), { appActiveAt: serverTimestamp() }, { merge: true }).catch(
    () => {},
  );
}

/**
 * Keeps `drivers/{uid}.appActiveAt` fresh while the app is foregrounded.
 *
 * Mounted once in the driver layout so it covers every driver screen — a driver
 * parked on Earnings is just as present as one on Home, and messaging them
 * would be just as pointless.
 */
export function useDriverAppHeartbeat(uid: string | undefined): void {
  // The interval id, so a background transition can stop it without the effect
  // having to tear down and rebuild its AppState subscription.
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!uid) return;

    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };

    const start = () => {
      stop();
      // Beat immediately, then on a timer. The immediate one is what matters:
      // it closes the window where a driver has just reopened the app and the
      // backend still believes it is shut.
      stamp(uid);
      timer.current = setInterval(() => stamp(uid), HEARTBEAT_MS);
    };

    const onChange = (state: AppStateStatus) => {
      if (state === 'active') start();
      // 'inactive' is the iOS app-switcher / incoming-call limbo as well as a
      // real backgrounding. Stopping on it is safe: coming back is 'active',
      // which beats immediately.
      else stop();
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', onChange);

    return () => {
      sub.remove();
      stop();
    };
  }, [uid]);
}
