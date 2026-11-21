import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { C } from '../theme';

/**
 * The light the glass refracts: three soft colour pools on black, breathing
 * slowly so the panes never look like flat grey rectangles.
 */
export default function Backdrop() {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 7000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 7000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bg }]} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity, transform: [{ scale }] }]}>
        <Svg width="100%" height="100%" viewBox="0 0 400 860" preserveAspectRatio="xMidYMid slice">
          <Defs>
            <RadialGradient id="pool1" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={C.glow} stopOpacity={0.26} />
              <Stop offset="100%" stopColor={C.glow} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="pool2" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor="#1FE6C0" stopOpacity={0.16} />
              <Stop offset="100%" stopColor="#1FE6C0" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="pool3" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor={C.lime} stopOpacity={0.13} />
              <Stop offset="100%" stopColor={C.lime} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="210" cy="300" rx="260" ry="250" fill="url(#pool1)" />
          <Ellipse cx="40" cy="650" rx="230" ry="220" fill="url(#pool2)" />
          <Ellipse cx="370" cy="780" rx="220" ry="200" fill="url(#pool3)" />
        </Svg>
      </Animated.View>
    </View>
  );
}
