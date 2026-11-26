/**
 * A pretend network, so every screen has the states a real one has: a first
 * load, a "this is taking a while" warning, a failure you can retry, and a
 * save button that spins. Nothing leaves the device.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SLOW_AFTER = 1300;

export type Load = {
  /** First paint: show skeletons. */
  loading: boolean;
  /** Still going after 1.3s: show the slow-connection note. */
  slow: boolean;
  /** This attempt failed: show the retry card. */
  failed: boolean;
  retry: () => void;
};

/**
 * @param ms      how long this screen's data takes
 * @param failFirst make the first attempt fail, so the retry path is reachable
 */
export function useLoad(ms = 850, failFirst = false): Load {
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [failed, setFailed] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    attempt.current += 1;
    const first = attempt.current === 1;
    const wait = failFirst && first ? 1800 : ms;

    setLoading(true);
    setSlow(false);
    setFailed(false);

    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER);
    const doneTimer = setTimeout(() => {
      clearTimeout(slowTimer); // or a fast load still raises the slow warning behind it
      setSlow(false);
      setLoading(false);
      if (failFirst && first) setFailed(true);
    }, wait);

    return () => {
      clearTimeout(slowTimer);
      clearTimeout(doneTimer);
    };
  }, [tick, ms, failFirst]);

  const retry = useCallback(() => setTick((n) => n + 1), []);
  return { loading, slow, failed, retry };
}

/**
 * A button that does work: `run` flips `busy`, waits, then calls back.
 * `slow` turns on if the work outlasts 1.3s, for the inline warning.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const run = useCallback((ms: number, then?: () => void) => {
    setBusy(true);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER);
    timers.current.push(slowTimer);
    timers.current.push(
      setTimeout(() => {
        clearTimeout(slowTimer);
        setBusy(false);
        setSlow(false);
        then?.();
      }, ms),
    );
  }, []);

  return { busy, slow, run };
}

/** A job with named steps, for the agents that visibly work (research, ads, training). */
export function useSteps(steps: string[], each = 900) {
  const [at, setAt] = useState(-1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (then?: () => void) => {
      stop();
      setAt(0);
      steps.forEach((_, i) => {
        timers.current.push(setTimeout(() => setAt(i + 1), each * (i + 1)));
      });
      timers.current.push(setTimeout(() => then?.(), each * steps.length + 250));
    },
    [steps, each, stop],
  );

  const reset = useCallback(() => {
    stop();
    setAt(-1);
  }, [stop]);

  return { at, running: at >= 0 && at < steps.length, start, reset };
}
