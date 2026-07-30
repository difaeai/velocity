import { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Constants from 'expo-constants';
import { Text } from './Text';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import type { Coords } from '../hooks/location';
import { useRoute } from '../hooks/directions';

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface DriverPin {
  id: string;
  lat: number;
  lng: number;
}

/**
 * Somebody nearby with the Velocity app. Drawn as a small red dot: enough to
 * read "there are people here", never a person you could go and find. The
 * coordinates arrive already blurred and anonymous from the server (see
 * getNearbyActivity), which is the only thing that makes drawing them at all
 * acceptable.
 */
export interface DemandPin {
  id: string;
  lat: number;
  lng: number;
}

// Default map centre (Karachi) — shown instantly before GPS responds.
const DEFAULT_REGION = {
  latitude: 24.8607,
  longitude: 67.0011,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// Solid base colour behind the map — also the fallback surface below.
const MAP_BASE = '#151b22';

/**
 * Google Maps only authenticates in a real dev-client / release build compiled
 * with the Android Maps API key (see app.config.ts). In Expo Go — or any build
 * where the key is absent — the native map paints an ugly grey tile grid with
 * concentric rings and never loads real tiles. We detect that up front and show
 * a clean dark surface instead, so users never see that broken grid.
 */
const IS_EXPO_GO = Constants.appOwnership === 'expo';
const MAPS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ??
  (Constants.expoConfig as { android?: { config?: { googleMaps?: { apiKey?: string } } } } | null)
    ?.android?.config?.googleMaps?.apiKey ??
  '';
const MAPS_AVAILABLE = !IS_EXPO_GO && !!MAPS_KEY;

import { DARK_MAP_STYLE } from './mapStyle';
import { themed } from '../theme';

/**
 * Live Google map.
 *
 * - `coords` only (home screens): follows the user's GPS position.
 * - `pickup` + `dropoff`: draws pin/flag markers with a route line and frames
 *   the whole route (booking + trip screens).
 * - `drivers`: live driver positions rendered as car chips.
 * - `demand`: other app users nearby, rendered as small red dots.
 */
export function LiveMap({
  coords,
  pickup,
  dropoff,
  drivers,
  demand,
  style,
}: {
  coords: Coords | null;
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  drivers?: DriverPin[];
  demand?: DemandPin[];
  style?: StyleProp<ViewStyle>;
}) {
  const mapRef   = useRef<MapView>(null);
  const centred  = useRef(false);
  const lastLat  = useRef<number | null>(null);
  const lastLng  = useRef<number | null>(null);

  const hasRoute = !!(pickup && dropoff);

  // Real road-following route (Google Directions). Null while loading or when
  // Directions is unavailable — we fall back to the straight geodesic line.
  const routeCoords = useRoute(pickup, dropoff);

  // Route mode: frame the whole trip. Prefer the real route's bounds so bends
  // in the road stay on-screen; fall back to the two endpoints otherwise.
  useEffect(() => {
    if (!hasRoute || !mapRef.current) return;
    const coordsToFit =
      routeCoords && routeCoords.length > 1
        ? routeCoords
        : [
            { latitude: pickup!.lat, longitude: pickup!.lng },
            { latitude: dropoff!.lat, longitude: dropoff!.lng },
          ];
    const fit = () =>
      mapRef.current?.fitToCoordinates(coordsToFit, {
        edgePadding: { top: 120, right: 70, bottom: 120, left: 70 },
        animated: true,
      });
    // Give the MapView a beat to lay out before fitting on first render.
    const t = setTimeout(fit, 350);
    return () => clearTimeout(t);
  }, [hasRoute, pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, routeCoords]);

  // Follow mode: re-centre whenever GPS updates significantly (>30m) or on first fix.
  useEffect(() => {
    if (hasRoute || !coords || !mapRef.current) return;
    const moved =
      lastLat.current === null ||
      Math.abs(coords.lat - lastLat.current) > 0.0003 ||
      Math.abs(coords.lng - lastLng.current!) > 0.0003;
    if (!centred.current || moved) {
      centred.current  = true;
      lastLat.current  = coords.lat;
      lastLng.current  = coords.lng;
      mapRef.current.animateToRegion(
        { latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        600,
      );
    }
  }, [coords, hasRoute]);

  // No usable native map (Expo Go / no key) → clean dark placeholder, never the
  // grey Google grid. A soft brand halo keeps it reading as an intentional
  // "locating you" surface rather than a broken map.
  if (!MAPS_AVAILABLE) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.fallback, style]}>
        <View style={styles.fallbackHalo}>
          <View style={styles.fallbackHaloMid}>
            <View style={styles.pickupInner} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFill, style]}
      provider={PROVIDER_GOOGLE}
      customMapStyle={DARK_MAP_STYLE}
      // While the native map spins up, show our dark base + brand spinner — not
      // the default white grid that flashes on every open.
      loadingEnabled
      loadingBackgroundColor={MAP_BASE}
      loadingIndicatorColor="#ccff00"
      // NEVER enable showsUserLocation: on this RN/new-arch combo the native map
      // dispatches topUserLocationChange events that JS has no registered handler
      // for, and each one throws — a fatal crash in release builds. We draw our
      // own GPS marker from `coords` instead.
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      initialRegion={
        pickup
          ? { latitude: pickup.lat, longitude: pickup.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }
          : coords
            ? { latitude: coords.lat, longitude: coords.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : DEFAULT_REGION
      }
    >
      {hasRoute && (() => {
        const line =
          routeCoords && routeCoords.length > 1
            ? routeCoords
            : [
                { latitude: pickup!.lat, longitude: pickup!.lng },
                { latitude: dropoff!.lat, longitude: dropoff!.lng },
              ];
        const routed = !!(routeCoords && routeCoords.length > 1);
        return (
          <>
            {/* Dark casing under the route so the lime line reads on the map */}
            <Polyline coordinates={line} strokeColor="#0a0e12" strokeWidth={7} />
            <Polyline
              coordinates={line}
              strokeColor="#ccff00"
              strokeWidth={4}
              // Only straighten with a geodesic when we don't have real roads.
              geodesic={!routed}
              lineCap="round"
              lineJoin="round"
            />
          </>
        );
      })()}

      {pickup && (
        <Marker
          coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={styles.pickupOuter}>
            <View style={styles.pickupInner} />
          </View>
        </Marker>
      )}

      {dropoff && (
        <Marker
          coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={false}
        >
          <View style={styles.dropoffPin}>
            <View style={styles.dropoffHead}>
              <View style={styles.dropoffDot} />
            </View>
            <View style={styles.dropoffStem} />
          </View>
        </Marker>
      )}

      {/* Waiting riders first, so a car chip always wins the overlap: the dots
          are context, the cars are the thing you're about to book. */}
      {demand?.map((p) => (
        <Marker
          key={p.id}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          zIndex={1}
        >
          <View style={styles.demandOuter}>
            <View style={styles.demandInner} />
          </View>
        </Marker>
      ))}

      {drivers?.map((d) => (
        <Marker
          key={d.id}
          coordinate={{ latitude: d.lat, longitude: d.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          zIndex={2}
        >
          <View style={styles.driverChip}>
            <Text style={styles.driverChipEmoji}>🚗</Text>
          </View>
        </Marker>
      ))}

      {/* Bare GPS marker only when not showing a route (route mode draws its own pins). */}
      {!hasRoute && coords && (
        <Marker
          coordinate={{ latitude: coords.lat, longitude: coords.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={styles.pickupOuter}>
            <View style={styles.pickupInner} />
          </View>
        </Marker>
      )}
    </MapView>
  );
}

const styles = themed(() => StyleSheet.create({
  // Dark placeholder shown when the native map can't render (Expo Go / no key).
  fallback: {
    backgroundColor: MAP_BASE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackHalo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(204,255,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackHaloMid: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(204,255,0,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Pickup: lime dot in a soft halo — reads "you are here".
  pickupOuter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(204,255,0,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupInner: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#ccff00',
    borderWidth: 2.5,
    borderColor: '#0e1216',
  },

  // Dropoff: classic destination pin, white head on a slim stem.
  dropoffPin: { alignItems: 'center' },
  dropoffHead: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  dropoffDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0e1216',
  },
  dropoffStem: {
    width: 2.5,
    height: 10,
    backgroundColor: '#ffffff',
  },

  // Waiting rider: small red dot in a faint halo. Sized well below the car
  // chip and the GPS marker so a busy area reads as texture, not as clutter.
  demandOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  demandInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: 'rgba(10,14,18,0.85)',
  },

  driverChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#10131a',
    borderWidth: 1.5,
    borderColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  driverChipEmoji: { fontSize: 15 },
}));
