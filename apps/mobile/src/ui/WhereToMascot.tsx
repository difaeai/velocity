import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '../config';
import { themed } from '../theme';
import { Text } from './Text';

/**
 * Velocity, as a driver, standing on the "Where to?" card.
 *
 * The brand "V" is the body: the two arms of the mark carry the eyes, a white
 * driver's cap sits over them, and the glyph gets gloved hands and white shoes
 * so the logo reads as a person rather than a badge. On open he walks in from
 * the right edge of the card, stops where the "Where to?" text ends — and stays
 * there, blinking and breathing, asking "Kahan jana hai?" every so often.
 *
 * Rules it lives by:
 *
 *  - It is an overlay, never a section. It is absolutely positioned inside the
 *    card itself, so it adds no height and moves nothing. The only concession
 *    the card makes is a reserved lane on its right, so the sub-line never runs
 *    underneath him.
 *  - It cannot be touched. The layer is `pointerEvents="none"`: taps and drags
 *    pass through to the card, which is the app's primary action. There is
 *    nothing to press and nothing to dismiss.
 *  - It cannot cost a frame. Every animation is a transform or an opacity on
 *    the native driver, so it keeps running while the sheet is scrolled.
 */

/** Character box, in px. Everything below is a fraction of this. It also sets
 *  the width of the lane the card reserves for him — see MASCOT_LANE. */
const SIZE = 56;

/** What the card must keep its text clear of, on the right, so he has somewhere
 *  to stand: his own width plus a little breathing room. */
export const MASCOT_LANE = SIZE + 6;

/** The card's right padding plus its border: how far in from the card's outer
 *  edge his lane stops, so he stands inside the card rather than on its rim.
 *  Bound to `searchHero` in the passenger home screen; the two move together. */
const RIGHT_INSET = 16;

/**
 * Geometry, in the 200×200 viewBox the brand mark is drawn in. The body path is
 * LogoMark's "V" — the same coordinates, so this is the real logo and not a
 * lookalike. Everything else hangs off measured points on that path: eyes
 * centred on the two arms, shoulders on their outer edges, hips on the bar
 * under the point. The numbers were checked against a rasterised copy of the
 * whole character, which is how the arms ended up angled outward (they crossed
 * the body when they hung straight) and the hips this far apart (the feet
 * collided mid-stride when they were narrower).
 */
const BODY = 'M 36,30 L 60,30 Q 65,30 67,36 L 100,112 L 133,36 Q 135,30 140,30 L 164,30 Q 172,30 168,38 L 112,134 Q 108,142 100,142 Q 92,142 88,134 L 32,38 Q 28,30 36,30 Z';

const EYE_CX = 57;   // right eye mirrors to 200 - EYE_CX
const EYE_CY = 52;
const EYE_R = 13;
const PUPIL_R = 5.5;

const SHOULDER_X = 60;
const SHOULDER_Y = 84;
const ARM_W = 10;
const ARM_L = 24;
const GLOVE_R = 9;
const ARM_BASE = 22;   // resting outward angle
const ARM_SWING = 16;

const HIP_X = 80;
const HIP_Y = 138;
const LEG_W = 12;
const LEG_L = 32;
const LEG_SWING = 13;
const SHOE_W = 19;
const SHOE_H = 12;

/** viewBox units → px at SIZE. */
const u = (n: number) => (n / 200) * SIZE;

export function WhereToMascot() {
  // The lane measures itself: he has to start beyond the card's real right edge
  // on any handset, and stop where its text column ends.
  const [laneWidth, setLaneWidth] = useState(0);

  const x = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  /** -1 → 1 → -1 forever: one stride. Legs and arms read it in opposite
   *  directions, which is what makes it a walk instead of a hop. */
  const stride = useRef(new Animated.Value(0)).current;
  /** The step bounce, and the slow breath he settles into once he stops. */
  const step = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  /** 0 walking, 1 arrived — and it stays at 1. He does not leave. */
  const parked = useRef(new Animated.Value(0)).current;
  /** The speech bubble, which comes and goes long after he has stopped. */
  const talk = useRef(new Animated.Value(0)).current;

  // Stands flush with the end of his lane — which is to say, exactly where the
  // card's text stops and just clear of the "→".
  const restX = Math.max(0, laneWidth - SIZE);
  const startX = laneWidth + RIGHT_INSET + 16;

  useEffect(() => {
    if (laneWidth <= 0) return;

    x.setValue(startX);
    parked.setValue(0);
    talk.setValue(0);

    // Walks in from the right, once, and stops. There is no exit: the card
    // keeps him.
    const arrive = Animated.sequence([
      Animated.delay(700),
      Animated.timing(x, {
        toValue: restX,
        duration: 2600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.spring(parked, { toValue: 1, friction: 6, tension: 110, useNativeDriver: true }),
    ]);

    // …and then asks, every so often. Delayed past the walk so the bubble never
    // pops while he is still moving.
    const ask = Animated.sequence([
      Animated.delay(3600),
      Animated.loop(
        Animated.sequence([
          Animated.spring(talk, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
          Animated.delay(3600),
          Animated.timing(talk, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay(11000),
        ]),
      ),
    ]);

    arrive.start();
    ask.start();
    return () => { arrive.stop(); ask.stop(); };
  }, [laneWidth, x, parked, talk, restX, startX]);

  // The stride and the bounce that goes with it.
  useEffect(() => {
    const swing = (to: number) =>
      Animated.timing(stride, { toValue: to, duration: 330, easing: Easing.inOut(Easing.sin), useNativeDriver: true });
    const legs = Animated.loop(Animated.sequence([swing(1), swing(-1)]));
    const bounce = Animated.loop(
      Animated.sequence([
        Animated.timing(step, { toValue: 1, duration: 165, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(step, { toValue: 0, duration: 165, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    // Standing still is not being still: he breathes.
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    legs.start();
    bounce.start();
    breathing.start();
    return () => { legs.stop(); bounce.stop(); breathing.stop(); };
  }, [stride, step, breath]);

  // Blinks on an uneven rhythm — two blinks with different gaps read as alive,
  // one blink on a fixed timer reads as a machine.
  useEffect(() => {
    const shut = (delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(blink, { toValue: 0.08, duration: 90, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: true }),
      ]);
    const loop = Animated.loop(Animated.sequence([shut(2600), shut(320), shut(4200)]));
    loop.start();
    return () => loop.stop();
  }, [blink]);

  // Limbs stop swinging the moment he arrives: he does not march on the spot.
  const walking = parked.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' });
  const swing = Animated.multiply(stride, walking);
  // Positive rotation swings a hanging limb toward the LEFT — the way he walks.
  const legAngle = (side: 'left' | 'right') =>
    Animated.multiply(swing, side === 'left' ? LEG_SWING : -LEG_SWING).interpolate({
      inputRange: [-LEG_SWING, LEG_SWING],
      outputRange: [`-${LEG_SWING}deg`, `${LEG_SWING}deg`],
    });
  // Arms hang outward and swing around that, so a gloved hand never crosses the
  // body. Parked, the leading hand comes up to gesture at the words beside him.
  const armAngle = (side: 'left' | 'right') => {
    const lead = side === 'left';
    const value = lead
      ? Animated.add(Animated.multiply(swing, ARM_SWING), Animated.add(ARM_BASE, Animated.multiply(parked, 20)))
      : Animated.add(Animated.multiply(swing, -ARM_SWING), -ARM_BASE);
    return value.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] });
  };

  const bobY = Animated.add(
    Animated.multiply(Animated.multiply(step, walking), -2.5),
    Animated.multiply(Animated.multiply(breath, parked), -1.6),
  );
  // Eyes down the road while walking; on the words beside him once he stops.
  const pupilX = parked.interpolate({ inputRange: [0, 1], outputRange: [-2, -3] });
  const pupilY = parked.interpolate({ inputRange: [0, 1], outputRange: [0, 1.4] });
  // The tooltip arrives on the diagonal, out of the mascot's head and up to
  // its resting place above the card.
  const tipScale = talk.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const tipX = talk.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const tipY = talk.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  // The spring overshoots past 1 — that overshoot is the pop — but an opacity
  // above 1 is not a legal value, so this one gets clamped.
  const tipOpacity = talk.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  const eye = (side: 'left' | 'right') => (
    <Animated.View
      key={side}
      style={[
        styles.eye,
        {
          left: u(side === 'left' ? EYE_CX : 200 - EYE_CX) - u(EYE_R),
          top: u(EYE_CY) - u(EYE_R),
          width: u(EYE_R) * 2,
          height: u(EYE_R) * 2,
          borderRadius: u(EYE_R),
          transform: [{ scaleY: blink }],
        },
      ]}
    >
      <Animated.View
        style={[
          styles.pupil,
          {
            width: u(PUPIL_R) * 2,
            height: u(PUPIL_R) * 2,
            borderRadius: u(PUPIL_R),
            transform: [{ translateX: pupilX }, { translateY: pupilY }],
          },
        ]}
      />
    </Animated.View>
  );

  /**
   * A limb is a zero-sized pivot View at the joint, with the limb hanging below
   * it. Rotating a view of no width or height turns its children about the joint
   * itself, which swings the arm from the shoulder and the leg from the hip
   * without needing `transformOrigin`.
   */
  const limb = (
    key: string,
    joint: { x: number; y: number },
    angle: Animated.AnimatedInterpolation<string>,
    body: ReactNode,
  ) => (
    <Animated.View
      key={key}
      style={[styles.pivot, { left: u(joint.x), top: u(joint.y), transform: [{ rotate: angle }] }]}
    >
      {body}
    </Animated.View>
  );

  const arm = (side: 'left' | 'right') =>
    limb(
      `arm-${side}`,
      { x: side === 'left' ? SHOULDER_X : 200 - SHOULDER_X, y: SHOULDER_Y },
      armAngle(side),
      <>
        <View style={[styles.limbBar, { left: -u(ARM_W) / 2, width: u(ARM_W), height: u(ARM_L), borderRadius: u(ARM_W) / 2 }]} />
        <View
          style={[
            styles.glove,
            {
              left: -u(GLOVE_R),
              top: u(ARM_L) - u(GLOVE_R) * 0.5,
              width: u(GLOVE_R) * 2,
              height: u(GLOVE_R) * 2,
              borderRadius: u(GLOVE_R),
            },
          ]}
        />
      </>,
    );

  const leg = (side: 'left' | 'right') =>
    limb(
      `leg-${side}`,
      { x: side === 'left' ? HIP_X : 200 - HIP_X, y: HIP_Y },
      legAngle(side),
      <>
        <View style={[styles.limbBar, { left: -u(LEG_W) / 2, width: u(LEG_W), height: u(LEG_L), borderRadius: u(LEG_W) / 2 }]} />
        {/* The toe points left, the way he came in. */}
        <View
          style={[
            styles.shoe,
            {
              left: -u(SHOE_W) + u(LEG_W) / 2 + u(3),
              top: u(LEG_L) - u(2),
              width: u(SHOE_W),
              height: u(SHOE_H),
              borderRadius: u(SHOE_H) / 2,
              borderBottomRightRadius: u(3),
            },
          ]}
        />
      </>,
    );

  return (
    <View style={styles.layer} pointerEvents="none">
      {/* The tooltip lives outside the clipped lane, so it can sit above the
          card entirely. */}
      <Animated.View
        style={[
          styles.tip,
          { opacity: tipOpacity, transform: [{ translateX: tipX }, { translateY: tipY }, { scale: tipScale }] },
        ]}
      >
        <Text style={styles.tipText}>Kahan jana hai?</Text>
        {/* Square, rotated 45°, half-buried under the tooltip's bottom edge: a
            diagonal point aimed down at the head that is speaking. */}
        <View style={styles.tipTail} />
      </Animated.View>

      <View style={styles.lane} onLayout={(e) => setLaneWidth(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.walker, { transform: [{ translateX: x }, { translateY: bobY }] }]}>
          {/* Legs first so they sit behind the body; arms after, so the gloved
              hands read in front of it. */}
          {leg('right')}
          {leg('left')}

          <Svg width={SIZE} height={SIZE} viewBox="0 0 200 200">
            {/* The "V" ends in a point, which has nowhere to hang legs from.
                This bar gives him a waist. */}
            <Rect x={72} y={126} width={56} height={18} rx={9} fill={colors.primary} />
            <Path d={BODY} fill={colors.primary} />
            {/* Driver's cap: peak facing the way he walks, then band, then crown. */}
            <Path d="M 34,29 Q 16,30 14,34 Q 16,38 34,38 Z" fill="#ffffff" />
            <Rect x={34} y={26} width={132} height={9} rx={4} fill="#ffffff" />
            <Path d="M 58,27 Q 58,9 100,9 Q 142,9 142,27 Z" fill="#ffffff" />
            <Rect x={34} y={31} width={132} height={3} rx={1.5} fill="rgba(11,13,12,0.18)" />
          </Svg>

          {arm('right')}
          {arm('left')}
          {eye('left')}
          {eye('right')}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  // Covers the card exactly, and deliberately does NOT clip: the tooltip has to
  // escape upward, out of the card. It adds no height of its own, which is the
  // whole point — the card looks identical whether he is there or not.
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  // Where he is allowed to be: the card minus its right padding. This is the
  // part that clips, so he can wait off the card's right edge and walk in
  // without ever spilling outside it.
  lane: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    right: RIGHT_INSET,
    overflow: 'hidden',
  },
  // Absolute and vertically centred, so he can stand off the lane's right edge
  // before walking in.
  walker: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: SIZE,
    justifyContent: 'center',
  },

  pivot: { position: 'absolute', width: 0, height: 0 },
  limbBar: { position: 'absolute', top: 0, backgroundColor: colors.primary },
  glove: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(11,13,12,0.25)',
  },
  shoe: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(11,13,12,0.25)',
  },

  eye: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    // A thin dark rim keeps the eye readable where it overlaps the lime arm.
    borderWidth: 1,
    borderColor: 'rgba(11,13,12,0.55)',
  },
  pupil: { backgroundColor: '#0b0d0c' },

  // Anchored by its RIGHT edge so it grows leftward into the card and never
  // pushes him out of his lane.
  // Above the card, outside it. `bottom: 100%` puts its base on the card's top
  // edge; the margin lifts it clear. Off-white on black text so it reads as a
  // tooltip rather than as more of the app's dark furniture.
  tip: {
    position: 'absolute',
    bottom: '100%',
    right: RIGHT_INSET + SIZE * 0.15,
    // Small, because the space above the card is paid for out of the sheet's
    // top padding — see `bottomSheetContent` on the passenger home screen.
    marginBottom: 2,
    backgroundColor: '#f5f3ec',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 6,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  // Half-buried under the tooltip's bottom-right corner and turned 45°, so the
  // point aims diagonally down at the head below it.
  tipTail: {
    position: 'absolute',
    right: 12,
    bottom: -4,
    width: 10,
    height: 10,
    backgroundColor: '#f5f3ec',
    transform: [{ rotate: '45deg' }],
  },
  tipText: { fontSize: 12, fontWeight: '800', color: '#0b0d0c' },
}));
