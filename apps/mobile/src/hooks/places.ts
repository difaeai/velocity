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

const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

// Pakistan bounding box for biasing results
const PAKISTAN_LOCATION = '30.3753,69.3451';
const PAKISTAN_RADIUS = 1500000; // 1500 km covers all of Pakistan

export function usePlacesAutocomplete(input: string, sessionToken: string) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const trimmed = input.trim();
    if (trimmed.length < 2) {
      setPredictions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          input: trimmed,
          key: GOOGLE_MAPS_API_KEY,
          sessiontoken: sessionToken,
          components: 'country:pk',
          location: PAKISTAN_LOCATION,
          radius: String(PAKISTAN_RADIUS),
          language: 'en',
        });
        const res = await fetch(`${AUTOCOMPLETE_URL}?${params}`);
        const data = await res.json();
        if (data.status === 'OK' && Array.isArray(data.predictions)) {
          setPredictions(
            data.predictions.map((p: {
              place_id: string;
              structured_formatting: { main_text: string; secondary_text: string };
              description: string;
            }) => ({
              placeId: p.place_id,
              mainText: p.structured_formatting?.main_text ?? p.description,
              secondaryText: p.structured_formatting?.secondary_text ?? '',
              fullText: p.description,
            })),
          );
        } else {
          setPredictions([]);
        }
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, sessionToken]);

  return { predictions, loading };
}

export async function fetchPlaceDetail(placeId: string, sessionToken: string): Promise<PlaceDetail | null> {
  try {
    const params = new URLSearchParams({
      place_id: placeId,
      key: GOOGLE_MAPS_API_KEY,
      sessiontoken: sessionToken,
      fields: 'geometry,formatted_address',
    });
    const res = await fetch(`${DETAILS_URL}?${params}`);
    const data = await res.json();
    if (data.status === 'OK' && data.result?.geometry?.location) {
      return {
        lat: data.result.geometry.location.lat,
        lng: data.result.geometry.location.lng,
        address: data.result.formatted_address ?? '',
      };
    }
    return null;
  } catch {
    return null;
  }
}
