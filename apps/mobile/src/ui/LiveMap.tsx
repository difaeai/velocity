import { useEffect, useRef } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import type { Coords } from '../hooks/location';

// Default map centre (Karachi) — shown instantly before GPS responds.
const DEFAULT_REGION = {
  latitude: 24.8607,
  longitude: 67.0011,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

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
  const mapRef   = useRef<MapView>(null);
  const centred  = useRef(false);
  const lastLat  = useRef<number | null>(null);
  const lastLng  = useRef<number | null>(null);

  // Re-centre whenever GPS updates significantly (>30m delta) or on first fix.
  useEffect(() => {
    if (!coords || !mapRef.current) return;
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
  }, [coords]);

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
      initialRegion={DEFAULT_REGION}
    >
      {coords && (
        <Marker coordinate={{ latitude: coords.lat, longitude: coords.lng }} />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({});
