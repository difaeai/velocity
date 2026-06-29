import { useEffect, useRef, useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from '../config';

export interface PlacePrediction {
  placeId: string;
  mainText: string;
  secondaryText: string;
  fullText: string;
}

export interface PlaceDetail {
  lat: number;
  lng: number;
  address: string;
}

// Places API (New) endpoints — v1
const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

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

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(AUTOCOMPLETE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          },
          body: JSON.stringify({
            input: trimmed,
            sessionToken,
            includedRegionCodes: ['pk'],
            languageCode: 'en',
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          const status = data?.error?.status ?? `HTTP_${res.status}`;
          const message = data?.error?.message ?? 'Unknown error';
          setApiStatus(status);
          setApiMessage(message);
          console.error('[Places API]', status, message, '| body:', JSON.stringify(data));
          setPredictions([]);
          return;
        }

        setApiStatus('OK');
        const suggestions = data.suggestions ?? [];
        setPredictions(
          suggestions
            .filter((s: { placePrediction?: unknown }) => s.placePrediction)
            .map((s: {
              placePrediction: {
                placeId: string;
                text?: { text: string };
                structuredFormat?: {
                  mainText?: { text: string };
                  secondaryText?: { text: string };
                };
              };
            }) => {
              const p = s.placePrediction;
              return {
                placeId: p.placeId,
                mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
                secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
                fullText: p.text?.text ?? '',
              };
            }),
        );
      } catch {
        setApiStatus('NETWORK_ERROR');
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

export async function fetchPlaceDetail(placeId: string, sessionToken: string): Promise<PlaceDetail | null> {
  try {
    const res = await fetch(
      `${DETAILS_BASE_URL}/${placeId}?sessionToken=${sessionToken}`,
      {
        headers: {
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'location,formattedAddress',
        },
      },
    );
    const data = await res.json();
    if (res.ok && data.location) {
      return {
        lat: data.location.latitude,
        lng: data.location.longitude,
        address: data.formattedAddress ?? '',
      };
    }
    return null;
  } catch {
    return null;
  }
}
