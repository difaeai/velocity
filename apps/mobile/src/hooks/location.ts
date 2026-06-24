/**
 * Real device / browser geolocation.
 *
 * Replaces the hardcoded city coordinates the booking flow used to send. On
 * web we use the browser Geolocation API; on native we use `expo-location`
 * (and best-effort reverse-geocode the coordinates into a readable address).
 *
 * There is no places/geocoding provider wired up yet, so we capture the rider's
 * real position rather than inventing one. When a maps provider is added, the
 * destination can be geocoded to its own coordinates here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// `expo-location` is native-only; never evaluate it on web.
const Location =
  Platform.OS === 'web' ? null : (require('expo-location') as typeof import('expo-location'));

export interface Coords {
  lat: number;
  lng: number;
}

export type LocationStatus = 'idle' | 'loading' | 'granted' | 'denied' | 'unavailable';

export interface CurrentLocation {
  coords: Coords | null;
  address: string | null;
  status: LocationStatus;
  /** Re-request the device location (e.g. after the user was prompted). */
  request: () => void;
}

export function useCurrentLocation(auto = true): CurrentLocation {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = useCallback(() => {
    setStatus('loading');

    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setStatus('unavailable');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!mounted.current) return;
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setStatus('granted');
        },
        (err) => {
          if (!mounted.current) return;
          // 1 === PERMISSION_DENIED
          setStatus(err.code === 1 ? 'denied' : 'unavailable');
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
      return;
    }

    void (async () => {
      try {
        const { status: perm } = await Location!.requestForegroundPermissionsAsync();
        if (!mounted.current) return;
        if (perm !== 'granted') {
          setStatus('denied');
          return;
        }
        const pos = await Location!.getCurrentPositionAsync({});
        if (!mounted.current) return;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(next);
        setStatus('granted');
        try {
          const places = await Location!.reverseGeocodeAsync({
            latitude: next.lat,
            longitude: next.lng,
          });
          if (!mounted.current) return;
          const place = places[0];
          const line = place
            ? [place.name, place.street, place.city].filter(Boolean).join(', ')
            : '';
          if (line) setAddress(line);
        } catch {
          // reverse geocoding is best-effort; the coordinates are what matter.
        }
      } catch {
        if (mounted.current) setStatus('unavailable');
      }
    })();
  }, []);

  useEffect(() => {
    if (auto) request();
  }, [auto, request]);

  return { coords, address, status, request };
}
