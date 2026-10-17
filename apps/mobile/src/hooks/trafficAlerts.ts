/**
 * Road alerts for wherever the screen is looking.
 * ----------------------------------------------------------------------------
 * POLLING, AND WHY IT IS SLOW
 * ---------------------------
 * The server re-reads the news every twenty minutes, so a screen asking more
 * often than that is asking for an answer that cannot have changed. Five
 * minutes gives a screen left open on a desk a fresh answer well inside the
 * life of any alert, and costs one small callable per screen per five minutes.
 *
 * The poll stops when the app is backgrounded, for the same reason every other
 * foreground poller in this app does (see the mobile audit note): a timer that
 * keeps firing behind a locked screen is battery spent on an answer nobody is
 * looking at.
 *
 * ALWAYS DEGRADES TO SILENCE
 * --------------------------
 * Every failure path returns empty. A road alert is a courtesy on top of a
 * booking screen; if the call fails, the rider books a ride and never learns
 * there was a strip that could have appeared. What must never happen is an
 * error, a spinner or an empty box where the alert would have been.
 * ----------------------------------------------------------------------------
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { api, type TrafficAlertView } from '../api/client';

const POLL_MS = 5 * 60 * 1000;

export interface TrafficAlerts {
  /** Alerts filed to the city this point is in. */
  city: TrafficAlertView[];
  /** Alerts the supplied route runs into, in driving order. Empty with no route. */
  route: TrafficAlertView[];
  cityName: string | null;
  /** False until the first answer lands, so a screen can stay quiet until then. */
  loaded: boolean;
}

const EMPTY: TrafficAlerts = { city: [], route: [], cityName: null, loaded: false };

/**
 * `point` is where the user is (or is being picked up from). `polyline` is the
 * journey, when the screen knows one — pass it and `route` fills in.
 *
 * WHAT THE EFFECT IS KEYED ON, AND WHY IT IS NOT THE COORDINATES
 * A GPS fix updates several times a second, and keying the poll on it would
 * tear down and rebuild the interval on every one of those. The key is the
 * point rounded to ~11 km instead: coarse enough that jitter never touches it,
 * fine enough that actually moving to another city re-asks at once rather than
 * showing the old city's alerts until the next tick. The route is in the key
 * too, so picking a destination re-asks immediately — that is the moment the
 * answer matters most.
 */
export function useTrafficAlerts(
  point: { lat: number; lng: number } | null | undefined,
  polyline?: string | null,
): TrafficAlerts {
  const [state, setState] = useState<TrafficAlerts>(EMPTY);

  const hasPoint = !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng);
  const lat = hasPoint ? point!.lat : 0;
  const lng = hasPoint ? point!.lng : 0;
  const areaKey = hasPoint ? `${lat.toFixed(1)},${lng.toFixed(1)}` : '';
  const routeKey = polyline ? `${polyline.length}:${polyline.slice(0, 24)}` : '';

  useEffect(() => {
    if (!areaKey) return;

    let cancelled = false;

    const ask = async () => {
      try {
        const res = await api.getTrafficAlerts({
          lat,
          lng,
          ...(polyline ? { polyline } : {}),
        });
        if (cancelled) return;
        setState({
          city: res.city ?? [],
          route: res.route ?? [],
          cityName: res.cityName ?? null,
          loaded: true,
        });
      } catch {
        // Silence, not an error. See the note at the top.
        if (!cancelled) setState((prior) => ({ ...prior, loaded: true }));
      }
    };

    void ask();
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => void ask(), POLL_MS);

    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        // Catch up on whatever happened while the phone was in a pocket.
        void ask();
        if (!timer) timer = setInterval(() => void ask(), POLL_MS);
      } else {
        stop();
      }
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
    // `lat`/`lng`/`polyline` are read inside and deliberately NOT dependencies:
    // `areaKey` and `routeKey` are their coarse forms, and re-running on the
    // raw values is exactly the per-GPS-fix churn this hook exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, routeKey]);

  // Derived, not stored: with no point there is nothing to report, and writing
  // that into state from an effect would be a render just to clear a render.
  return hasPoint ? state : EMPTY;
}
