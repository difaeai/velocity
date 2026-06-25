/**
 * Real Google map for the home/trip screens.
 *
 * react-native-maps has no native module inside Expo Go, so we load it only in a
 * development/standalone build and fall back to a neutral placeholder in Expo Go.
 * The map centres on the rider's real location (no hardcoded coordinates).
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { colors } from '../config';
import type { Coords } from '../hooks/location';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Maps = isExpoGo ? null : require('react-native-maps');
const MapView = Maps?.default ?? null;
const Marker = Maps?.Marker ?? null;
const PROVIDER_GOOGLE = Maps?.PROVIDER_GOOGLE;

// Compact Google "night" style so the map matches the app's dark theme.
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c34' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8c8c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2c34' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#6f9ba5' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1b3c34' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2b3d45' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9aa6ab' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a4a52' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2b3d45' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1a20' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4e6d78' }] },
];

export function LiveMap({
  coords,
  style,
}: {
  coords: Coords | null;
  style?: StyleProp<ViewStyle>;
}) {
  // Expo Go can't render native maps — show a neutral placeholder there.
  if (!MapView) {
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.placeholderText}>🗺️ Live map appears in the app build</Text>
      </View>
    );
  }

  // Wait for the real location before centring the camera (no hardcoded region).
  if (!coords) {
    return (
      <View style={[styles.placeholder, style]}>
        <Text style={styles.placeholderText}>Locating you…</Text>
      </View>
    );
  }

  const region = {
    latitude: coords.lat,
    longitude: coords.lng,
    latitudeDelta: 0.012,
    longitudeDelta: 0.012,
  };

  return (
    <MapView
      style={[StyleSheet.absoluteFill, style]}
      provider={PROVIDER_GOOGLE}
      customMapStyle={DARK_MAP_STYLE}
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      initialRegion={region}
    >
      {Marker ? <Marker coordinate={{ latitude: coords.lat, longitude: coords.lng }} /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#151b22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
});
