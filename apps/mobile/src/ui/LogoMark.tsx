import { useEffect, useState } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Defs, Mask, Rect, Circle, Path, G } from 'react-native-svg';

/**
 * Velocity brand mark: a bold "V" (hood/windshield) merged with a car
 * chassis + wheels. Glyph-only (transparent) — wrap in a colored badge
 * View for contexts that previously used a filled square/circle.
 *
 * `spin` runs a one-shot spin on mount (used on the splash and brand
 * screens): the mark turns around its vertical axis for 3 seconds,
 * starting at ~2 turns/sec and decelerating to a stop. Drawn in 2D so it
 * renders identically on iOS and Android — see the note at the transform.
 *
 * Two turns, not more. A Y-rotation puts the mark edge-on twice per turn,
 * and at four turns it spent so much of the splash as an unreadable sliver
 * that it looked like a logo failing to load rather than one spinning.
 */
export function LogoMark({
  size = 60,
  color = '#ccff00',
  spin = false,
}: {
  size?: number;
  color?: string;
  spin?: boolean;
}) {
  // useState's lazy initialiser: one Animated.Value for the component's life,
  // without reading a ref during render.
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!spin) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: 3000,
      // Cubic ease-out: velocity starts high and decays smoothly to zero,
      // giving the 2x → 1x → stop deceleration profile.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [spin, progress]);

  const mark = (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Defs>
        <Mask id="hubs">
          <Rect x={0} y={0} width={200} height={200} fill="#ffffff" />
          <Circle cx={66} cy={152} r={6.5} fill="#000000" />
          <Circle cx={134} cy={152} r={6.5} fill="#000000" />
        </Mask>
      </Defs>
      <G mask="url(#hubs)" fill={color}>
        <Rect x={50} y={118} width={32} height={22} rx={11} />
        <Rect x={118} y={118} width={32} height={22} rx={11} />
        <Rect x={44} y={130} width={112} height={18} rx={9} />
        <Circle cx={66} cy={152} r={17} />
        <Circle cx={134} cy={152} r={17} />
        <Path d="M 36,30 L 60,30 Q 65,30 67,36 L 100,112 L 133,36 Q 135,30 140,30 L 164,30 Q 172,30 168,38 L 112,134 Q 108,142 100,142 Q 92,142 88,134 L 32,38 Q 28,30 36,30 Z" />
      </G>
    </Svg>
  );

  if (!spin) return mark;

  // 2 full turns over 3s. Cubic ease-out opens at three times the average
  // rate, so that is ~2 turns/s at launch decaying to 0 at rest, and the mark
  // ends front-facing.
  //
  // Drawn as scaleX = cos(angle), NOT perspective + rotateY. At these sizes a
  // turn around the vertical axis projects to exactly that — the mark narrows
  // to edge-on, mirrors, and widens back — so it looks the same as the 3D
  // version on Android. What it avoids is a real 3D layer transform, which iOS
  // composites in depth: half the turning layer passes behind the plane it sits
  // on and is cut away. A 2D scale has no depth, so nothing can clip it.
  return <Animated.View style={{ transform: [{ scaleX: spinScale(progress) }] }}>{mark}</Animated.View>;
}

/** Samples per turn — every 7.5°, smooth enough that the linear steps never show. */
const SPIN_STEPS = 96;
const SPIN_TURNS = 2;

const SPIN_INPUT = Array.from({ length: SPIN_STEPS + 1 }, (_, i) => i / SPIN_STEPS);
const SPIN_OUTPUT = SPIN_INPUT.map((p) => {
  const c = Math.cos(p * SPIN_TURNS * 2 * Math.PI);
  // Never exactly 0: a singular transform matrix is legal but some iOS versions
  // log about it. 2% wide is still an edge-on sliver.
  return Math.abs(c) < 0.02 ? (c < 0 ? -0.02 : 0.02) : c;
});

/** Eased 0→1 progress to the horizontal scale of a mark turning about its vertical axis. */
export function spinScale(progress: Animated.Value) {
  return progress.interpolate({ inputRange: SPIN_INPUT, outputRange: SPIN_OUTPUT });
}
