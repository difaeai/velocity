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
import type { LocationSubscription } from 'expo-location';
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

/**
 * Last position this process actually received, held outside React.
 *
 * A language or theme switch deliberately re-keys the whole route subtree (see
 * app/_layout.tsx) so the new strings/palette reach every open screen. That
 * remounts this hook and would reset `coords` to null, dropping the map back to
 * its default city centre for the several seconds a fresh GPS fix takes — which
 * reads to the user as "changing the language moved me to another city".
 * Keeping the fix in module scope, the same way theme.ts and i18n/index.ts keep
 * theirs, lets it survive the remount; the live watch then refines it.
 *
 * This is NOT the stale-cache problem that `getLastKnownPositionAsync` has (see
 * the note in `request`). These values are only ever written from a fix this
 * running process received, so they are the user's real position from moments
 * ago — never a leftover from an earlier session in a different city. Nothing is
 * persisted to disk, so a cold start still waits for real GPS.
 */
let lastCoords: Coords | null = null;
let lastAddress: string | null = null;

export function useCurrentLocation(auto = true): CurrentLocation {
  const [coords, setCoords] = useState<Coords | null>(lastCoords);
  const [address, setAddress] = useState<string | null>(lastAddress);
  const [status, setStatus] = useState<LocationStatus>(lastCoords ? 'granted' : 'idle');
  const mounted = useRef(true);
  const watchSub = useRef<LocationSubscription | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      watchSub.current?.remove();
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
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          lastCoords = next;
          setCoords(next);
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
        if (perm !== 'granted') { setStatus('denied'); return; }

        // Start live GPS watch — updates the map as the user moves.
        // NOTE: getLastKnownPositionAsync is intentionally skipped — it can
        // return a stale cached position from a completely different city.
        watchSub.current?.remove();
        watchSub.current = await Location!.watchPositionAsync(
          { accuracy: Location!.Accuracy.Balanced, distanceInterval: 10, timeInterval: 5000 },
          (pos) => {
            if (!mounted.current) return;
            const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            lastCoords = next;
            setCoords(next);
            setStatus('granted');
          },
        );

        // One-shot fix that anchors the "you are here" dot and the pickup label.
        // High, not Balanced: Balanced is ~100m, which is enough to put the dot on
        // the wrong side of the street. The live watch above stays on Balanced —
        // paying for GPS-grade accuracy once is fine, paying every 5 seconds is not.
        const pos = await Location!.getCurrentPositionAsync({ accuracy: Location!.Accuracy.High });
        if (!mounted.current) return;
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        lastCoords = next;
        setCoords(next);
        setStatus('granted');
        try {
          const places = await Location!.reverseGeocodeAsync({ latitude: next.lat, longitude: next.lng });
          if (!mounted.current) return;
          const place = places[0];
          const line = place ? [place.name, place.street, place.city].filter(Boolean).join(', ') : '';
          if (line) {
            lastAddress = line;
            setAddress(line);
          }
        } catch {
          // reverse geocoding is best-effort; coords are what matter
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
