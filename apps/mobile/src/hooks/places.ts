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

export function usePlacesAutocomplete(input: string, sessionToken: string) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      setPredictions([]);
      setApiStatus(null);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Debounced so a destination search is a few calls, not one per keystroke.
    // The session token matters for cost too: Google bills autocomplete per
    // session, so every keystroke plus the final details call is one charge.
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
      } catch (e) {
        setApiStatus('NETWORK_ERROR');
        setApiMessage(e instanceof Error ? e.message : null);
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

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
