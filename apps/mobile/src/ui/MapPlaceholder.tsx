import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors } from '../config';

/**
 * Lightweight map stand-in for the trip screens. Shows pickup/dropoff and an
 * optional animated vehicle marker for "live tracking".
 *
 * Swap this for `react-native-maps` once EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is
 * configured and a development build is in use (Expo Go has limited map support).
 */
export function MapPlaceholder({
  pickup,
  dropoff,
  tracking,
}: {
  pickup?: string;
  dropoff?: string;
  tracking?: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!tracking) return;
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 3500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [tracking, t]);

  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [10, 220] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [110, 30] });

  return (
    <View style={styles.map}>
      <View style={[styles.pin, { top: 100, left: 8 }]}>
        <View style={[styles.dot, { backgroundColor: colors.secondary }]} />
        <Text style={styles.pinLabel}>{pickup ?? 'Pickup'}</Text>
      </View>
      <View style={[styles.pin, { top: 18, right: 8, alignItems: 'flex-end' }]}>
        <View style={[styles.dot, { backgroundColor: colors.primary }]} />
        <Text style={styles.pinLabel}>{dropoff ?? 'Drop-off'}</Text>
      </View>
      {tracking ? (
        <Animated.View style={[styles.car, { transform: [{ translateX }, { translateY }] }]}>
          <Text style={{ fontSize: 18 }}>🚗</Text>
        </Animated.View>
      ) : null}
      <Text style={styles.watermark}>Map preview</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 180,
    borderRadius: 18,
    backgroundColor: '#e7efe9',
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  pin: { position: 'absolute', maxWidth: 160 },
  dot: { width: 12, height: 12, borderRadius: 6, marginBottom: 2 },
  pinLabel: { fontSize: 11, fontWeight: '700', color: colors.text },
  car: { position: 'absolute' },
  watermark: { alignSelf: 'center', marginBottom: 8, color: colors.muted, fontSize: 10, fontWeight: '700' },
});
