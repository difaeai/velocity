import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';

/**
 * Home-screen entry point for "Earn with Velocity" — the partner program.
 *
 * Sits directly under the Travel Partner card and shares its visual family
 * (shimmer sweep, animated arrow, lime accents) so the two read as siblings,
 * but leads with money instead of people: a coin that pops, rising bars, and
 * the one number that sells the program — up to 2% of Velocity's commission.
 */
export function EarnCard({ onPress }: { onPress: () => void }) {
  const coin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const bar1 = useRef(new Animated.Value(0)).current;
  const bar2 = useRef(new Animated.Value(0)).current;
  const bar3 = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The coin does a little hop, like a coin dropped into a jar.
    const coinLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(coin, { toValue: -7, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(coin, { toValue: 0, duration: 420, easing: Easing.bounce, useNativeDriver: true }),
        Animated.delay(1400),
      ]),
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(500),
      ]),
    );
    // The chart bars grow in one after another — earnings going up.
    const rise = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.delay(2200 - delay),
          Animated.timing(val, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.delay(300),
        ]),
      );
    const arrowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrow, { toValue: 6, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(arrow, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(700),
      ]),
    );
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(2000),
        Animated.timing(shimmer, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );

    const loops = [coinLoop, glowLoop, rise(bar1, 0), rise(bar2, 180), rise(bar3, 360), arrowLoop, shimmerLoop];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [coin, glow, bar1, bar2, bar3, arrow, shimmer]);

  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-240, 240] });
  const barScale = (val: Animated.Value) => val.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Animated.View
        pointerEvents="none"
        style={[styles.shimmer, { transform: [{ rotate: '12deg' }, { translateX: shimmerX }] }]}
      />

      {/* Coin over a tiny rising chart — the earnings picture in one glance. */}
      <View style={styles.artWrap}>
        <View style={styles.barsRow}>
          <Animated.View style={[styles.bar, { height: 14, transform: [{ scaleY: barScale(bar1) }] }]} />
          <Animated.View style={[styles.bar, { height: 22, transform: [{ scaleY: barScale(bar2) }] }]} />
          <Animated.View style={[styles.bar, { height: 30, transform: [{ scaleY: barScale(bar3) }] }]} />
        </View>
        <View style={styles.coinWrap}>
          <Animated.View style={[styles.coinGlow, { transform: [{ scale: glowScale }], opacity: glowOpacity }]} />
          <Animated.View style={[styles.coin, { transform: [{ translateY: coin }] }]}>
            <Text style={styles.coinText}>₨</Text>
          </Animated.View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Earn with Velocity</Text>
          <View style={styles.newPill}>
            <Text style={styles.newPillText}>NEW</Text>
          </View>
        </View>
        <Text style={styles.sub}>
          Invite drivers &amp; riders, earn up to 2% of Velocity&apos;s commission on their every ride.
        </Text>
        <View style={styles.chipsRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>Free to join</Text>
          </View>
          <View style={[styles.chip, styles.chipSolid]}>
            <Text style={styles.chipSolidText}>Become a partner</Text>
          </View>
        </View>
      </View>

      <Animated.Text style={[styles.arrow, { transform: [{ translateX: arrow }] }]}>→</Animated.Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111a04',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#ccff0040',
    padding: 16,
    gap: 12,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: -60,
    bottom: -60,
    width: 70,
    backgroundColor: '#ccff0022',
  },

  artWrap: { width: 62, height: 56, alignItems: 'center', justifyContent: 'flex-end' },
  barsRow: {
    position: 'absolute',
    bottom: 0,
    left: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  bar: {
    width: 9,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: '#ccff0055',
  },
  coinWrap: {
    position: 'absolute',
    top: 0,
    right: 2,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinGlow: { position: 'absolute', width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary },
  coin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#eaffa3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinText: { fontSize: 16, fontWeight: '900', color: '#0b0d0c' },

  body: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '900', color: colors.primary },
  newPill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  newPillText: { fontSize: 9, fontWeight: '900', color: '#0b0d0c', letterSpacing: 0.6 },
  sub: { fontSize: 12, color: '#9aa398', lineHeight: 17 },

  chipsRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderColor: '#ccff0045',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipText: { fontSize: 10, fontWeight: '800', color: '#d3e9a6' },
  chipSolid: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipSolidText: { fontSize: 10, fontWeight: '900', color: '#0b0d0c' },

  arrow: { fontSize: 20, color: colors.primary, fontWeight: '900' },
}));
