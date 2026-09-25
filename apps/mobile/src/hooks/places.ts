/**
 * Address search — autocomplete, place details and free-text geocoding.
 *
 * These used to call Google Places directly from the device. They cannot: the
 * Android Maps key is restricted to the app's package name and signing
 * certificate, and that restriction is proven by the *native* SDK attaching
 * those to the request. A `fetch()` from JS attaches neither, so Google
 * answered every call with
 *
 *   PERMISSION_DENIED — "Requests from this Android client application
 *                        <empty> are blocked."
 *
 * `<empty>` being the package name it never received. So the calls now go
 * through backend callables that use GOOGLE_MAPS_SERVER_KEY, and the app ships
 * no Google key that can spend money. See backend/functions/src/lib/places.ts.
 *
 * Everything still degrades to null / [] rather than throwing — a Places
 * outage should leave the user typing an address by hand, not stuck.
 */
import { useEffect, useRef, useState } from 'react';

import { api, type PlaceDetail, type PlacePrediction } from '../api/client';

export type { PlaceDetail, PlacePrediction };

/**
 * Shortest query we will pay for.
 *
 * Two characters is not a search, it is a prefix — "is", "la", "f " match half
 * of Pakistan and nobody picks a result from them, yet each one is a billed
 * autocomplete request. Three is where predictions start being useful, and it
 * removes roughly the first third of the requests a destination search used to
 * make. Nothing is lost: the user is still typing.
 */
const MIN_QUERY_CHARS = 3;

/**
 * How long to wait for typing to stop.
 *
 * Every fire is a billed request (see the COST note in the backend's
 * lib/places.ts — the session token does not make these free). At 300 ms a
 * normal typist triggers a call mid-word several times per search; 500 ms is
 * still below the point where the list feels laggy, and it roughly halves the
 * number of requests. If this ever feels slow, lower it knowing what it costs.
 */
const DEBOUNCE_MS = 500;

/**
 * Predictions already seen this app session.
 *
 * Deliberately IN MEMORY ONLY and deliberately never written to AsyncStorage.
 * These are Google Maps Content: the licence allows temporary caching for
 * performance, not a copy on the device that outlives the process. Backspacing
 * one character and retyping it is the case this catches, and it is a common one.
 */
const PREDICTION_LIMIT = 60;
const predictionMemo = new Map<string, PlacePrediction[]>();

function rememberPredictions(key: string, predictions: PlacePrediction[]): void {
  if (predictionMemo.size >= PREDICTION_LIMIT) {
    const oldest = predictionMemo.keys().next().value;
    if (oldest !== undefined) predictionMemo.delete(oldest);
  }
  predictionMemo.set(key, predictions);
}

export function usePlacesAutocomplete(input: string, sessionToken: string) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < MIN_QUERY_CHARS) {
      setPredictions([]);
      setApiStatus(null);
      return;
    }

    // Something we already asked about — answer without spending, and without
    // waiting out the debounce either, so the cheap path is also the fast one.
    const memoKey = trimmed.toLowerCase();
    const remembered = predictionMemo.get(memoKey);
    if (remembered) {
      setPredictions(remembered);
      setApiStatus('OK');
      setApiMessage(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Debounced so a destination search is a few calls, not one per keystroke.
    // Each call is billed — see MIN_QUERY_CHARS and DEBOUNCE_MS above, and the
    // backend's lib/places.ts for why the session token is not the saving here.
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.placesAutocomplete({ input: trimmed, sessionToken });
        if (!res.configured) {
          setApiStatus('NOT_CONFIGURED');
          setApiMessage('Address search is not set up yet.');
          setPredictions([]);
          return;
        }
        setApiStatus('OK');
        setApiMessage(null);
        setPredictions(res.predictions);
        rememberPredictions(memoKey, res.predictions);
      } catch (e) {
        setApiStatus('NETWORK_ERROR');
        setApiMessage(e instanceof Error ? e.message : null);
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, sessionToken]);

  return { predictions, loading, apiStatus, apiMessage };
}

/**
 * Resolve a typed address to coordinates.
 * Returns null on failure — callers fall back to a coordinate-less booking,
 * exactly as before this helper existed.
 */
export async function geocodeAddress(text: string): Promise<PlaceDetail | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const res = await api.geocodeAddress({ text: trimmed });
    return res.detail;
  } catch {
    return null;
  }
}

/** Resolve a prediction the user tapped into coordinates. */
export async function fetchPlaceDetail(
  placeId: string,
  sessionToken: string,
): Promise<PlaceDetail | null> {
  try {
    const res = await api.placeDetails({ placeId, sessionToken });
    return res.detail;
  } catch {
    return null;
  }
}
