/**
 * Web stand-in for {@link ./LiveMap}. The web bundle must never import
 * react-native-maps (it has no web build), so Metro picks this file on web.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '../config';
import type { Coords } from '../hooks/location';

export function LiveMap({
  coords,
  style,
}: {
  coords: Coords | null;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.placeholder, style]}>
      <Text style={styles.placeholderText}>🗺️ Live map runs in the phone app</Text>
    </View>
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
