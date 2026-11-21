/**
 * The three pictures the welcome pages are built around. Each is a small
 * scene rather than an icon: layered, gradient-filled, and with one part that
 * keeps moving.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from 'react-native-svg';
import { C } from '../theme';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedRect = Animated.createAnimatedComponent(Rect);

type P = { size?: number };

/** A value that runs 0 → 1 for ever. */
function useRun(duration: number) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [t, duration]);
  return t;
}

/** There and back again, for breathing. */
function useSway(duration: number) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);
  return t;
}

const Grads = () => (
  <Defs>
    <LinearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <Stop offset="0%" stopColor={C.lime} stopOpacity={0.9} />
      <Stop offset="100%" stopColor={C.green} stopOpacity={0.55} />
    </LinearGradient>
    <LinearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.22} />
      <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.05} />
    </LinearGradient>
    <LinearGradient id="bar" x1="0" y1="1" x2="0" y2="0">
      <Stop offset="0%" stopColor={C.green} stopOpacity={0.45} />
      <Stop offset="100%" stopColor={C.lime} stopOpacity={1} />
    </LinearGradient>
  </Defs>
);

/** Content: a reel being written, with a photo card behind it. */
export function ContentScene({ size = 132 }: P) {
  const sway = useSway(2200);
  const caret = useRun(1100);

  const lift = sway.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const lineW = sway.interpolate({ inputRange: [0, 1], outputRange: [16, 34] });
  const caretO = caret.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.1, 1] });

  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Grads />

      {/* the photo card behind */}
      <G rotation={-11} origin="42, 56">
        <Rect x="22" y="30" width="44" height="54" rx="9" fill="url(#glass)" stroke={C.green} strokeWidth={1.1} opacity={0.75} />
        <Circle cx="35" cy="44" r="4" fill={C.green} opacity={0.8} />
        <Path d="M25 70l11-11 8 8 6-5 12 11v8H25Z" fill={C.green} opacity={0.35} />
      </G>

      {/* the reel being made */}
      <AnimatedG y={lift}>
        <Rect x="48" y="22" width="50" height="68" rx="11" fill="url(#glass)" stroke={C.lime} strokeWidth={1.4} />
        <Circle cx="73" cy="46" r="13" fill="url(#card)" opacity={0.9} />
        <Path d="M69.5 40.5l9 5.5-9 5.5Z" fill="#0A1206" />
        <Rect x="57" y="66" width="32" height="3.4" rx="1.7" fill={C.lime} opacity={0.55} />
        <AnimatedRect x="57" y="74" width={lineW} height="3.4" rx="1.7" fill={C.lime} opacity={0.9} />
      </AnimatedG>

      {/* her cursor, still typing */}
      <AnimatedRect x="93" y="73" width="2.4" height="6" rx="1.2" fill={C.lime} opacity={caretO} />

      {/* sparkles */}
      <Path d="M34 20l1.6 4.4 4.4 1.6-4.4 1.6L34 32l-1.6-4.4-4.4-1.6 4.4-1.6Z" fill={C.lime} opacity={0.85} />
      <Path d="M100 96l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1Z" fill={C.green} opacity={0.8} />
    </Svg>
  );
}

/** Ads: a megaphone, its waves, and the money it brings back. */
export function AdsScene({ size = 132 }: P) {
  const wave = useRun(1900);
  const sway = useSway(1800);

  const w1 = wave.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  const w2 = wave.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.8, 0] });
  const grow = sway.interpolate({ inputRange: [0, 1], outputRange: [26, 36] });
  const growY = sway.interpolate({ inputRange: [0, 1], outputRange: [68, 58] });

  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Grads />

      {/* waves going out */}
      <AnimatedCircle cx="46" cy="48" r="30" stroke={C.lime} strokeWidth={1.3} fill="none" opacity={w1} />
      <AnimatedCircle cx="46" cy="48" r="42" stroke={C.lime} strokeWidth={1.1} fill="none" opacity={w2} />

      {/* the megaphone */}
      <G rotation={-18} origin="52, 48">
        <Path d="M30 40h12l28-14v44L42 56H30a5 5 0 0 1-5-5v-6a5 5 0 0 1 5-5Z" fill="url(#card)" />
        <Rect x="36" y="56" width="9" height="20" rx="4.5" fill={C.green} opacity={0.75} />
        <Path d="M76 36c6 5 6 19 0 24" stroke={C.lime} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </G>

      {/* what comes back */}
      <Rect x="58" y="78" width="10" height="18" rx="3" fill="url(#bar)" opacity={0.8} />
      <Rect x="72" y="70" width="10" height="26" rx="3" fill="url(#bar)" opacity={0.9} />
      <AnimatedRect x="86" y={growY} width="10" height={grow} rx="3" fill="url(#bar)" />
      <Ellipse cx="30" cy="92" rx="11" ry="11" fill="url(#card)" opacity={0.9} />
      <Path d="M30 86v12M26.5 89h7M26.5 95h7" stroke="#0A1206" strokeWidth={1.8} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Sales: the question, her answer, and the order closed. */
export function SalesScene({ size = 132 }: P) {
  const sway = useSway(1600);
  const pop = useSway(1300);

  const dot = sway.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const ring = pop.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.75] });

  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Grads />

      {/* their message */}
      <G>
        <Path d="M16 26h50a9 9 0 0 1 9 9v16a9 9 0 0 1-9 9H30l-10 9V35a9 9 0 0 1 9-9Z" fill="url(#glass)" stroke={C.green} strokeWidth={1.2} />
        <AnimatedCircle cx="34" cy="43" r="3.4" fill={C.green} opacity={dot} />
        <Circle cx="46" cy="43" r="3.4" fill={C.green} opacity={0.6} />
        <Circle cx="58" cy="43" r="3.4" fill={C.green} opacity={0.35} />
      </G>

      {/* her answer */}
      <Path d="M104 52H58a9 9 0 0 0-9 9v13a9 9 0 0 0 9 9h32l12 9V61a9 9 0 0 0-2-9Z" fill="url(#card)" opacity={0.92} />
      <Path d="M62 70.5l5.5 5.5L84 60" stroke="#0A1206" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* the order, closed */}
      <AnimatedCircle cx="92" cy="26" r="15" fill={C.lime} opacity={ring} />
      <Circle cx="92" cy="26" r="11" fill={C.lime} />
      <Path d="M86.5 26l4 4 7.5-8" stroke="#0A1206" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M18 96l14-12 10 8 12-14 16 12" stroke={C.lime} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.8} />
      <Circle cx="70" cy="90" r="3.4" fill={C.lime} />
    </Svg>
  );
}
