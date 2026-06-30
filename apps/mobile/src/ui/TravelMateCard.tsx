import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../config';

const AVATARS = ['🧑', '👩', '🧔'] as const;

/** Animated, eye-catching entry point that signals "people to ride with are here". */
export function TravelMateCard({ onPress }: { onPress: () => void }) {
  const bob1 = useRef(new Animated.Value(0)).current;
  const bob2 = useRef(new Animated.Value(0)).current;
  const bob3 = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bob = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: -6, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(400),
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
        Animated.delay(1400),
        Animated.timing(shimmer, { toValue: 1, duration: 1100, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );

    const loops = [bob(bob1, 0), bob(bob2, 200), bob(bob3, 400), pulseLoop, arrowLoop, shimmerLoop];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bob1, bob2, bob3, pulse, arrow, shimmer]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-240, 240] });

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Animated.View
        pointerEvents="none"
        style={[styles.shimmer, { transform: [{ rotate: '12deg' }, { translateX: shimmerX }] }]}
      />

      <View style={styles.avatarCluster}>
        <Animated.View style={[styles.avatarBubble, styles.avatarBack, { transform: [{ translateY: bob3 }] }]}>
          <Text style={styles.avatarEmoji}>{AVATARS[2]}</Text>
        </Animated.View>
        <Animated.View style={[styles.avatarBubble, styles.avatarMid, { transform: [{ translateY: bob2 }] }]}>
          <Text style={styles.avatarEmoji}>{AVATARS[1]}</Text>
        </Animated.View>
        <Animated.View style={[styles.avatarBubble, styles.avatarFront, { transform: [{ translateY: bob1 }] }]}>
          <Text style={styles.avatarEmoji}>{AVATARS[0]}</Text>
          <View style={styles.onlineDotWrap}>
            <Animated.View style={[styles.onlinePulse, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
            <View style={styles.onlineDot} />
          </View>
        </Animated.View>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Travel Mate</Text>
        <Text style={styles.sub}>People near you are heading your way. Swipe, match, ride together.</Text>
      </View>

      <Animated.Text style={[styles.arrow, { transform: [{ translateX: arrow }] }]}>→</Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1a00',
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

  avatarCluster: { width: 62, height: 44, justifyContent: 'center' },
  avatarBubble: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: '#1e1a00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBack:  { left: 0, top: 0 },
  avatarMid:   { left: 13, top: 8 },
  avatarFront: { left: 26, top: 1, backgroundColor: colors.primary, zIndex: 2 },
  avatarEmoji: { fontSize: 15 },

  onlineDotWrap: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlinePulse: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#22c55e' },
  onlineDot:   { width: 9, height: 9, borderRadius: 5, backgroundColor: '#22c55e', borderWidth: 1.5, borderColor: '#1e1a00' },

  body:  { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '900', color: colors.primary },
  sub:   { fontSize: 12, color: '#8a8c8c', lineHeight: 17 },
  arrow: { fontSize: 20, color: colors.primary, fontWeight: '900' },
});
