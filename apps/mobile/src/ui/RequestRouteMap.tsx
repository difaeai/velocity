/**
 * The map behind the driver's "Ride request" screen.
 *
 * Draws the two legs the driver cares about, each with its own ETA badge:
 *   • driver → pickup   (blue, dashed)  — "how far away is this job"
 *   • pickup → drop-off (lime, solid)   — "how long will it take me"
 *
 * Distinct from LiveMap, which knows only one route and no driver leg.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { colors } from '../config';
import { formatDistance } from '../lib/geo';
import { useRouteInfo, type MapPoint } from '../hooks/directions';
import { DARK_MAP_STYLE } from './mapStyle';

/** "4 min", "21 min", "1 h 05" — the badge over each leg. */
function formatEta(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

interface Props {
  pickup: MapPoint;
  dropoff: MapPoint;
  /** The driver's own position. Absent until GPS reports — the leg is then skipped. */
  driver?: MapPoint | null;
}

export function RequestRouteMap({ pickup, dropoff, driver }: Props) {
  const mapRef = useRef<MapView>(null);

  const toPickup = useRouteInfo(driver ?? null, pickup);
  const trip = useRouteInfo(pickup, dropoff);

  // Frame everything that matters: both legs plus the driver, so the whole job
  // is on screen the moment it opens.
  const fitCoords = useMemo(() => {
    const pts = [
      ...(toPickup?.coords ?? []),
      ...(trip?.coords ?? [
        { latitude: pickup.lat, longitude: pickup.lng },
        { latitude: dropoff.lat, longitude: dropoff.lng },
      ]),
    ];
    if (driver) pts.push({ latitude: driver.lat, longitude: driver.lng });
    return pts;
  }, [toPickup, trip, pickup, dropoff, driver]);

  useEffect(() => {
    if (fitCoords.length < 2) return;
    // Give the MapView a beat to lay out before fitting on first render. The
    // bottom padding keeps the route clear of the request sheet.
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(fitCoords, {
        edgePadding: { top: 140, right: 70, bottom: 80, left: 70 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
  }, [fitCoords]);

  const zoom = async (by: number) => {
    const cam = await mapRef.current?.getCamera();
    if (!cam) return;
    mapRef.current?.animateCamera({ ...cam, zoom: (cam.zoom ?? 13) + by }, { duration: 220 });
  };

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        style={styles.fill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={DARK_MAP_STYLE}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        initialRegion={{
          latitude: pickup.lat,
          longitude: pickup.lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {/* Leg 1 — driver to pickup */}
        {toPickup && (
          <Polyline
            coordinates={toPickup.coords}
            strokeColor="#4b9bff"
            strokeWidth={5}
            lineDashPattern={[10, 8]}
          />
        )}

        {/* Leg 2 — the trip itself */}
        <Polyline
          coordinates={
            trip?.coords ?? [
              { latitude: pickup.lat, longitude: pickup.lng },
              { latitude: dropoff.lat, longitude: dropoff.lng },
            ]
          }
          strokeColor={colors.primary}
          strokeWidth={6}
        />

        {driver && (
          <Marker coordinate={{ latitude: driver.lat, longitude: driver.lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.carPin}>
              <Text style={styles.carGlyph}>🚗</Text>
            </View>
          </Marker>
        )}

        <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.stopA}>
            <Text style={styles.stopATxt}>A</Text>
          </View>
        </Marker>

        <Marker coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={styles.stopB}>
            <Text style={styles.stopBTxt}>B</Text>
          </View>
        </Marker>

        {/* ETA badges ride on the map, anchored above each leg's end. */}
        {toPickup && (
          <Marker
            coordinate={{ latitude: pickup.lat, longitude: pickup.lng }}
            anchor={{ x: 0.5, y: 1.9 }}
            tracksViewChanges={false}
          >
            <View style={[styles.eta, styles.etaBlue]}>
              <Text style={styles.etaBlueTxt}>{formatEta(toPickup.durationSec)}</Text>
              <Text style={styles.etaBlueTxt}>{formatDistance(toPickup.distanceM)}</Text>
            </View>
          </Marker>
        )}

        {trip && (
          <Marker
            coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }}
            anchor={{ x: 0.5, y: 1.9 }}
            tracksViewChanges={false}
          >
            <View style={[styles.eta, styles.etaLime]}>
              <Text style={styles.etaLimeTxt}>{formatEta(trip.durationSec)}</Text>
              <Text style={styles.etaLimeTxt}>{formatDistance(trip.distanceM)}</Text>
            </View>
          </Marker>
        )}
      </MapView>

      <View style={styles.zoomCol}>
        <Pressable style={styles.zoomBtn} onPress={() => zoom(1)} accessibilityLabel="Zoom in">
          <Text style={styles.zoomTxt}>+</Text>
        </Pressable>
        <Pressable style={styles.zoomBtn} onPress={() => zoom(-1)} accessibilityLabel="Zoom out">
          <Text style={styles.zoomTxt}>−</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },

  carPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1c1b',
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carGlyph: { fontSize: 18 },

  stopA: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#0d0f0e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopATxt: { fontSize: 14, fontWeight: '900', color: '#000' },
  stopB: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#22c55e',
    borderWidth: 2,
    borderColor: '#0d0f0e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBTxt: { fontSize: 14, fontWeight: '900', color: '#04210f' },

  eta: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'center' },
  etaBlue: { backgroundColor: '#4b9bff' },
  etaBlueTxt: { fontSize: 14, fontWeight: '800', color: '#04203f' },
  etaLime: { backgroundColor: colors.primary },
  etaLimeTxt: { fontSize: 14, fontWeight: '800', color: '#1a2200' },

  zoomCol: { position: 'absolute', right: 14, bottom: 24, gap: 12 },
  zoomBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#22262a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomTxt: { fontSize: 26, fontWeight: '700', color: '#fff', lineHeight: 28 },
});
