import React from 'react';
import { Animated, Image, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { useLoop } from '../anim';
import { C } from '../theme';

export const VEXA_FACE = require('../../assets/icon.png');
const VEXA_FIGURE = require('../../assets/vexa.png');

/** Thin lines that run from the stage out to the six agent tiles. */
const LINKS = [
  'M108 72Q92 62 78 68',
  'M252 72Q268 62 282 68',
  'M96 124Q72 154 58 192',
  'M264 124Q288 154 302 192',
  'M122 174Q96 244 82 300',
  'M240 176Q272 238 290 294',
];

const DUST: Array<[number, number, number]> = [
  [40, 28, 1.6],
  [320, 40, 1.4],
  [26, 150, 1.2],
  [336, 162, 1.6],
  [60, 262, 1.3],
  [310, 252, 1.2],
  [150, 356, 1.4],
  [224, 350, 1.2],
  [196, 32, 1.1],
];

/**
 * Vexa herself on the holo pedestal: the light, rings and beam are SVG, she is
 * the cut-out PNG floating a little above the disc.
 */
export default function VexaStage() {
  const t = useLoop(3400);
  const float = t.interpolate({ inputRange: [0, 1], outputRange: [5, -7] });
  const breathe = t.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <>
      <Svg width="100%" height="100%" viewBox="0 0 360 380" fill="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="halo" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor={C.glow} stopOpacity={0.26} />
            <Stop offset="55%" stopColor={C.green} stopOpacity={0.09} />
            <Stop offset="100%" stopColor={C.green} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="beam" x1="0" y1="150" x2="0" y2="298" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor={C.glow} stopOpacity={0.03} />
            <Stop offset="100%" stopColor={C.glow} stopOpacity={0.3} />
          </LinearGradient>
          <RadialGradient id="disc" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor={C.glow} stopOpacity={0.6} />
            <Stop offset="100%" stopColor={C.green} stopOpacity={0.05} />
          </RadialGradient>
        </Defs>

        <Ellipse cx="180" cy="150" rx="178" ry="150" fill="url(#halo)" />
        <Ellipse cx="180" cy="252" rx="168" ry="96" stroke={C.green} strokeWidth={0.9} opacity={0.13} />
        <Ellipse cx="180" cy="236" rx="146" ry="124" stroke={C.green} strokeWidth={0.9} opacity={0.08} />

        {LINKS.map((d, i) => (
          <Path key={`l${i}`} d={d} stroke={C.green} strokeWidth={0.9} opacity={0.38} fill="none" />
        ))}
        {DUST.map(([x, y, r], i) => (
          <Circle key={`d${i}`} cx={x} cy={y} r={r} fill={C.glow} opacity={0.55} />
        ))}

        <Path d="M140 150h80l64 146H76Z" fill="url(#beam)" />
        <Ellipse cx="180" cy="314" rx="126" ry="28" stroke={C.green} strokeWidth={1} opacity={0.16} />
        <Ellipse cx="180" cy="306" rx="104" ry="24" stroke={C.green} strokeWidth={1.1} opacity={0.3} />
      </Svg>

      <Animated.View
        pointerEvents="none"
        // The cut-out's body sits right of its own centre (her hand fills the
        // left), so she is nudged left to stand on the middle of the disc.
        style={[st.figure, { transform: [{ translateX: -32 }, { translateY: float }] }]}
      >
        <Image source={VEXA_FIGURE} style={st.img} resizeMode="contain" />
      </Animated.View>

      <Svg width="100%" height="100%" viewBox="0 0 360 380" fill="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="disc2" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0%" stopColor={C.glow} stopOpacity={0.6} />
            <Stop offset="100%" stopColor={C.green} stopOpacity={0.05} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="180" cy="300" rx="84" ry="19" fill="url(#disc2)" stroke={C.green} strokeWidth={1.4} opacity={0.9} />
      </Svg>

      <Animated.View pointerEvents="none" style={[st.discGlow, { opacity: breathe }]}>
        <Svg width="100%" height="100%" viewBox="0 0 360 380" fill="none">
          <Ellipse cx="180" cy="297" rx="44" ry="9" fill={C.glow} opacity={0.65} />
        </Svg>
      </Animated.View>
    </>
  );
}

const st = StyleSheet.create({
  figure: { position: 'absolute', left: 0, right: 0, top: 18, alignItems: 'center' },
  img: { width: 272, height: 272 },
  discGlow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
