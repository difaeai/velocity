import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect, G } from 'react-native-svg';

function useFloat(amplitude = 4, duration = 2200) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration, useNativeDriver: true, easing: (t) => Math.sin(t * Math.PI) }),
        Animated.timing(anim, { toValue: 0, duration, useNativeDriver: true, easing: (t) => Math.sin(t * Math.PI) }),
      ]),
    ).start();
  }, []);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -amplitude] });
  return translateY;
}

export function CarIllustration({ width = 100, height = 52 }: { width?: number; height?: number }) {
  const translateY = useFloat(4, 2400);
  const AnimatedG = Animated.createAnimatedComponent(G);

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Svg width={width} height={height} viewBox="0 0 200 104">
        {/* Shadow */}
        <Ellipse cx="100" cy="98" rx="70" ry="6" fill="rgba(0,0,0,0.25)" />
        {/* Body */}
        <Path
          d="M20 72 L20 55 Q20 48 27 48 L45 48 L68 26 Q74 20 86 20 L120 20 Q132 20 138 26 L158 48 L173 48 Q180 48 180 55 L180 72 Z"
          fill="#e8e8e8"
        />
        {/* Roof highlight */}
        <Path
          d="M72 26 Q78 22 88 22 L118 22 Q128 22 134 26 L154 46 L68 46 Z"
          fill="#f4f4f4"
        />
        {/* Windows */}
        <Path d="M76 44 L90 27 Q94 23 102 23 L116 23 Q122 23 126 27 L138 44 Z" fill="#b8d4e8" />
        {/* Window divider */}
        <Path d="M107 44 L107 24" stroke="#9ab8cc" strokeWidth="2" />
        {/* Window glare */}
        <Path d="M80 42 L88 29 Q90 27 94 27 L98 27 L90 43 Z" fill="rgba(255,255,255,0.35)" />
        {/* Door lines */}
        <Path d="M107 48 L107 72" stroke="#d0d0d0" strokeWidth="1.5" />
        {/* Front bumper */}
        <Rect x="165" y="62" width="18" height="8" rx="4" fill="#cccc00" />
        {/* Rear bumper */}
        <Rect x="17" y="62" width="18" height="8" rx="4" fill="#d0d0d0" />
        {/* Headlight */}
        <Rect x="172" y="52" width="9" height="6" rx="3" fill="#ffffcc" />
        {/* Taillight */}
        <Rect x="19" y="52" width="9" height="6" rx="3" fill="#ff6666" />
        {/* Front wheel */}
        <Circle cx="148" cy="76" r="14" fill="#333" />
        <Circle cx="148" cy="76" r="9" fill="#555" />
        <Circle cx="148" cy="76" r="4" fill="#ccff00" />
        {/* Rear wheel */}
        <Circle cx="54" cy="76" r="14" fill="#333" />
        <Circle cx="54" cy="76" r="9" fill="#555" />
        <Circle cx="54" cy="76" r="4" fill="#ccff00" />
        {/* Wheel arches */}
        <Path d="M134 72 Q148 66 162 72" stroke="#c8c8c8" strokeWidth="3" fill="none" />
        <Path d="M40 72 Q54 66 68 72" stroke="#c8c8c8" strokeWidth="3" fill="none" />
        {/* Door handle front */}
        <Rect x="130" y="58" width="12" height="3" rx="1.5" fill="#bbb" />
        {/* Door handle rear */}
        <Rect x="66" y="58" width="12" height="3" rx="1.5" fill="#bbb" />
      </Svg>
    </Animated.View>
  );
}

export function MotoIllustration({ width = 64, height = 52 }: { width?: number; height?: number }) {
  const translateY = useFloat(5, 1900);

  return (
    <Animated.View style={{ transform: [{ translateY }] }}>
      <Svg width={width} height={height} viewBox="0 0 130 104">
        {/* Shadow */}
        <Ellipse cx="65" cy="99" rx="44" ry="5" fill="rgba(0,0,0,0.22)" />
        {/* Frame */}
        <Path d="M48 50 L72 32 L92 36 L96 58" stroke="#aaa" strokeWidth="5" fill="none" strokeLinecap="round" />
        <Path d="M48 50 L36 58" stroke="#aaa" strokeWidth="5" fill="none" strokeLinecap="round" />
        {/* Fuel tank */}
        <Path d="M62 30 Q82 26 90 36 Q86 42 70 42 Q58 42 56 36 Z" fill="#ccff00" />
        {/* Seat */}
        <Path d="M56 36 Q68 32 88 36 L90 40 Q75 46 58 44 Z" fill="#444" />
        {/* Fairing / front cowl */}
        <Path d="M92 34 Q104 36 108 50 Q106 58 100 60 L96 56 Q100 50 98 44 L90 38 Z" fill="#d0d0d0" />
        {/* Headlight */}
        <Ellipse cx="106" cy="50" rx="7" ry="5" fill="#fffacc" />
        <Ellipse cx="106" cy="50" rx="4" ry="3" fill="#fff" />
        {/* Handlebar */}
        <Path d="M92 32 Q100 28 104 34" stroke="#888" strokeWidth="3" fill="none" strokeLinecap="round" />
        {/* Exhaust */}
        <Path d="M42 56 Q30 62 22 68" stroke="#999" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* Front wheel */}
        <Circle cx="98" cy="76" r="18" fill="#2a2a2a" />
        <Circle cx="98" cy="76" r="11" fill="#444" />
        <Circle cx="98" cy="76" r="4" fill="#ccff00" />
        {/* Rear wheel */}
        <Circle cx="34" cy="76" r="18" fill="#2a2a2a" />
        <Circle cx="34" cy="76" r="11" fill="#444" />
        <Circle cx="34" cy="76" r="4" fill="#ccff00" />
        {/* Fork */}
        <Path d="M96 56 L98 70" stroke="#bbb" strokeWidth="4" strokeLinecap="round" />
        {/* Chain */}
        <Path d="M42 74 Q65 80 82 74" stroke="#666" strokeWidth="2" fill="none" strokeDasharray="4 3" />
        {/* Rider silhouette */}
        <Circle cx="78" cy="22" r="9" fill="#555" />
        <Path d="M72 30 Q68 40 70 52 Q78 48 88 44 Q90 36 84 28 Z" fill="#555" />
        <Path d="M84 28 Q96 30 100 36" stroke="#555" strokeWidth="5" fill="none" strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}
