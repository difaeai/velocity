/**
 * Web stand-in for {@link ./RequestRouteMap}. The web bundle must never import
 * react-native-maps (it has no web build), so Metro picks this file on web.
 */
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../config';
import type { MapPoint } from '../hooks/directions';

export function RequestRouteMap(props: {
  pickup: MapPoint;
  dropoff: MapPoint;
  driver?: MapPoint | null;
}) {
  // Accepted for API parity with the native map; there is nothing to draw here.
  void props;
  return (
    <View style={styles.placeholder}>
      <Text style={styles.text}>🗺️ Route map runs in the phone app</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0e1216',
  },
  text: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
