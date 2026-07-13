import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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

// Default map centre (Karachi) — shown instantly before GPS responds.
const DEFAULT_REGION = {
  latitude: 24.8607,
  longitude: 67.0011,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

import { DARK_MAP_STYLE } from './mapStyle';

/**
 * Live Google map.
 *
 * - `coords` only (home screens): follows the user's GPS position.
 * - `pickup` + `dropoff`: draws pin/flag markers with a route line and frames
 *   the whole route (booking + trip screens).
 * - `drivers`: live driver positions rendered as car chips.
 */
export function LiveMap({
  coords,
  pickup,
  dropoff,
  drivers,
  style,
}: {
  coords: Coords | null;
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  drivers?: DriverPin[];
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

  return (
    <MapView
      ref={mapRef}
      style={[StyleSheet.absoluteFill, style]}
      provider={PROVIDER_GOOGLE}
      customMapStyle={DARK_MAP_STYLE}
      showsUserLocation
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

      {drivers?.map((d) => (
        <Marker
          key={d.id}
          coordinate={{ latitude: d.lat, longitude: d.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
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

const styles = StyleSheet.create({
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
});
