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
import { explainDenied } from '../lib/permissions';

let saidWhyLocation = false;

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
 * These values are only ever written from a fix this running process received or
 * accepted, so they are the user's real position from moments ago — never a
 * leftover from an earlier session in a different city. Nothing is persisted to
 * disk: a cold start's head start comes from the OS's own recent fix, bounded by
 * age and accuracy (see `request`), which is fresher than anything we could keep
 * ourselves and carries the uncertainty figure that makes it safe to trust.
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
        if (perm !== 'granted') {
          setStatus('denied');
          // Once a session, however many screens ask: why, and the way to Settings.
          if (!saidWhyLocation) {
            saidWhyLocation = true;
            explainDenied('location');
          }
          return;
        }

        /**
         * The fix the phone already has, if it is recent and tight enough to
         * be true (owner, 2026-11-17: "locations load slow").
         *
         * `getCurrentPositionAsync` at High accuracy is a GPS lock, and under a
         * roof that is anywhere from two to thirty seconds — during which the
         * map sat on a default city centre and the pickup box said nothing. The
         * phone has usually had a fix in the last minute from some other app,
         * and showing that instantly is the difference between "the app is
         * slow" and "the app knows where I am".
         *
         * This is NOT the stale-position problem the old comment here warned
         * about. That warning was about calling it bare: unbounded, it will
         * hand back a fix from another city days ago. Bounded, it cannot —
         * nobody covers a city in 90 seconds, and anything looser than 1 km of
         * uncertainty is refused outright. Whatever it gives us is overwritten
         * seconds later by the real fix below and then by the live watch, so at
         * worst the map starts a street off and corrects itself.
         */
        void Location!.getLastKnownPositionAsync({ maxAge: 90_000, requiredAccuracy: 1000 })
          .then((last) => {
            // Only as a head start: if the real fix already landed, leave it.
            if (!mounted.current || !last || lastCoords) return;
            const seed = { lat: last.coords.latitude, lng: last.coords.longitude };
            lastCoords = seed;
            setCoords(seed);
            setStatus('granted');
          })
          .catch(() => {
            // No cached fix. The real one below is on its way regardless.
          });

        // Start live GPS watch — updates the map as the user moves.
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
