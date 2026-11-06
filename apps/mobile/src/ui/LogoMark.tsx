import { useEffect, useState } from 'react';
import { Animated, Easing, Image } from 'react-native';

/**
 * Velocity brand mark: the owner's glowing lime V on wheels (2026-11-06),
 * cut out on a transparent background by scripts/generate-brand-assets.mjs —
 * the same master as the app icon. Put it on a dark surface: it is lime.
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
  spin = false,
}: {
  size?: number;
  /** Ignored: the logo is an image with its own colour. Kept so callers compile. */
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
    <Image
      source={require('../../assets/logo.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Velocity Rides"
    />
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
