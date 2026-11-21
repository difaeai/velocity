import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

type Enter = { y?: number; scale?: number; duration?: number };

/** Fade a thing in once, optionally rising and growing into place. */
export function useEnter(delay = 0, { y = 14, scale, duration = 420 }: Enter = {}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.timing(t, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [t, delay, duration]);

  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [y, 0] });
  const grow = t.interpolate({ inputRange: [0, 1], outputRange: [scale ?? 1, 1] });

  return {
    opacity: t,
    transform: scale ? [{ translateY }, { scale: grow }] : [{ translateY }],
  };
}

/** A slow there-and-back loop, for floating and breathing. */
export function useLoop(duration = 3600) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t, duration]);

  return t;
}
