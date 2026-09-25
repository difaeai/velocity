/**
 * A polling interval that stops when the app is not in front of the user.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS
 * Several screens poll: the driver's en-route search, suggested rides, the
 * sharing feed, the pool manifest. A plain `setInterval` in a `useEffect` keeps
 * firing after the user has switched away — the JS thread is still alive, so a
 * driver who backgrounds the app and puts the phone in their pocket carries on
 * making a round trip every 15 to 30 seconds, indefinitely. Nobody is looking at
 * the result. It costs them battery and mobile data, and it costs us the
 * Firestore reads and callable invocations behind every tick.
 *
 * `useDriverAppHeartbeat` already solved this for itself; this is the same
 * pattern factored out so every poller gets it rather than just the one that
 * happened to be written last.
 *
 * WHAT IT GUARANTEES
 * Foreground: `tick` runs almost immediately, then every `periodMs`.
 * Background or inactive: nothing runs.
 * Returning to the foreground: `tick` runs again at once, then the timer resumes.
 *
 * That run on return is what makes this safe to drop into a live feed. Without
 * it, a driver reopening the app would stare at whatever was on screen when they
 * left for up to a full period. With it, the screen is fresher on resume than the
 * old always-on interval managed, because the old one had no idea the user had
 * come back.
 *
 * WHY THE FIRST TICK IS DEFERRED BY A TIMEOUT
 * Callers' ticks call `setState`. Running one synchronously inside this effect
 * would set state during the effect that mounted the subscription, cascading a
 * second render before the first has painted — the thing `react-hooks/
 * set-state-in-effect` exists to catch. A `setTimeout(…, 0)` puts the first run
 * on the next task instead. The delay is imperceptible and the render is clean.
 *
 * `tick` is held in a ref, so callers do not need to wrap it in `useCallback`
 * and an unstable callback cannot thrash the AppState subscription. Pass `null`
 * to keep the poller idle while the ids or permissions a tick depends on load.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useForegroundInterval(
  tick: (() => void) | null,
  periodMs: number,
  /**
   * Change this to force an immediate re-run and restart the timer.
   *
   * Because `tick` lives in a ref, a caller whose callback closes over a "refresh
   * now" signal would otherwise see that signal ignored until the next beat — the
   * ref updates silently and nothing re-fires. Pass the signal here instead. This
   * is what preserves the behaviour of the plain effects this hook replaced,
   * where putting a key in the dependency array re-ran the read straight away.
   */
  restartKey?: string | number,
): void {
  const tickRef = useRef(tick);

  // Assigned in an effect rather than during render: a ref written while
  // rendering is a render that depends on something React does not track.
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Whether the caller wants to poll at all, as a primitive, so that passing a
  // fresh arrow function every render does not restart the effect.
  const enabled = tick !== null;

  useEffect(() => {
    if (!enabled) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let kick: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      if (interval) clearInterval(interval);
      if (kick) clearTimeout(kick);
      interval = null;
      kick = null;
    };

    const run = () => tickRef.current?.();

    const start = () => {
      stop();
      kick = setTimeout(run, 0);
      interval = setInterval(run, periodMs);
    };

    const onChange = (state: AppStateStatus) => {
      if (state === 'active') start();
      // 'inactive' is the iOS app-switcher and incoming-call limbo as well as a
      // real backgrounding. Stopping on it is safe: coming back is 'active',
      // which starts again immediately.
      else stop();
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', onChange);

    return () => {
      sub.remove();
      stop();
    };
  }, [enabled, periodMs, restartKey]);
}
