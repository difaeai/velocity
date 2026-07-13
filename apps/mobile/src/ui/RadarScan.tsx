/**
 * Radar sweep shown on the driver home while the app looks for nearby orders.
 *
 * Pure Animated + react-native-svg (no Reanimated, no new native modules).
 * Every animation drives transform/opacity only, so it runs on the native
 * driver and stays smooth on the low-end Androids most drivers carry.
 *
 * `scanning` gates the motion: when the driver is offline the radar is drawn
 * dimmed and still, which is the "you are not receiving orders" state.
 */
import { useEffect, useMemo } from 'react';
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { colors } from '../config';

interface Props {
  /** Animate the sweep + pulse. False = dimmed, static radar (driver offline). */
  scanning: boolean;
  title: string;
  subtitle?: string;
}

/** Rings drawn as fractions of the radar radius. */
const RING_FRACTIONS = [0.32, 0.58, 0.82, 1];

export function RadarScan({ scanning, title, subtitle }: Props) {
  const { width } = useWindowDimensions();
  // Keep the radar square and comfortably inside the screen on small devices.
  const size = Math.min(width - 32, 340);
  const r = size / 2;

  const sweep = useMemo(() => new Animated.Value(0), []);
  const pulse = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!scanning) {
      sweep.setValue(0);
      pulse.setValue(0);
      return;
    }

    const spin = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    spin.start();
    breathe.start();
    return () => {
      spin.stop();
      breathe.stop();
    };
  }, [scanning, sweep, pulse]);

  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // A ring that expands out of the centre and fades — the "ping".
  const pingScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const pingOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  // The sweep is a wedge anchored at the centre, drawn pointing straight down
  // and rotated by the animation.
  const wedge = `M ${r} ${r} L ${r - r * 0.42} ${size} L ${r + r * 0.42} ${size} Z`;

  return (
    <View style={styles.wrap}>
      <View style={[styles.radar, { width: size, height: size }, !scanning && styles.dimmed]}>
        {/* Static rings */}
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          {RING_FRACTIONS.map((f) => (
            <Circle
              key={f}
              cx={r}
              cy={r}
              r={r * f}
              stroke={colors.primary}
              strokeWidth={1}
              opacity={0.22}
              fill="none"
            />
          ))}
        </Svg>

        {/* Expanding ping */}
        {scanning && (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { opacity: pingOpacity, transform: [{ scale: pingScale }] },
            ]}
          >
            <Svg width={size} height={size}>
              <Circle cx={r} cy={r} r={r - 1} stroke={colors.primary} strokeWidth={1.5} fill="none" />
            </Svg>
          </Animated.View>
        )}

        {/* Rotating sweep wedge */}
        {scanning && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}
          >
            <Svg width={size} height={size}>
              <Defs>
                <RadialGradient id="sweep" cx="50%" cy="50%" r="50%">
                  <Stop offset="0%" stopColor={colors.primary} stopOpacity={0.45} />
                  <Stop offset="100%" stopColor={colors.primary} stopOpacity={0.04} />
                </RadialGradient>
              </Defs>
              <Path d={wedge} fill="url(#sweep)" />
            </Svg>
          </Animated.View>
        )}

        {/* Centre dot — the driver */}
        <View style={styles.centerWrap} pointerEvents="none">
          <View style={styles.centerDot} />
        </View>
      </View>

      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 6 },
  radar:   { alignItems: 'center', justifyContent: 'center' },
  dimmed:  { opacity: 0.35 },
  centerWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  title: {
    marginTop: 18,
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 19,
  },
});
