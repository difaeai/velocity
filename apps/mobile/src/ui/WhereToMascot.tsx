import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '../config';
import { themed } from '../theme';
import { Text } from './Text';

/**
 * Velocity, as a driver, on the "Where to?" card.
 *
 * He wears the brand mark: the "V" is his torso, under a head with a white
 * chauffeur's cap, gloved hands and white shoes. Every five seconds he walks in
 * from the right edge of the card, stops where the text ends, asks "Kahan jana
 * hai?" from a tooltip above the card, then turns around and walks back out the
 * way he came.
 *
 * Rules it lives by:
 *
 *  - It is an overlay, never a section. It is absolutely positioned on top of
 *    the card, so it adds no height and moves nothing. The card's only
 *    concessions are a reserved lane on its right, so the sub-line never runs
 *    underneath him, and a little sheet headroom for the tooltip.
 *  - It cannot be touched. The layer is `pointerEvents="none"`: taps and drags
 *    pass through to the card, which is the app's primary action. There is
 *    nothing to press and nothing to dismiss.
 *  - It cannot cost a frame. Every animation is a transform or an opacity on
 *    the native driver, so it keeps running while the sheet is scrolled.
 */

/** Character width, in px. Everything below is a fraction of this, and it sets
 *  the width of the lane the card reserves for him — see MASCOT_LANE. */
const SIZE = 60;

/** He is taller than he is wide. The card is 72px, which is what caps this. */
const VB_W = 200;
const VB_H = 216;
const HEIGHT = (SIZE * VB_H) / VB_W;

/** What the card must keep its text clear of, on the right, so he has somewhere
 *  to stand: his own width plus a little breathing room. */
export const MASCOT_LANE = SIZE + 6;

/** The card's right padding plus its border: how far in from the card's outer
 *  edge his lane stops, so he stands inside the card rather than on its rim.
 *  Bound to `searchHero` in the passenger home screen; the two move together. */
const RIGHT_INSET = 16;

/**
 * Geometry, in a 200 × 216 viewBox. The torso is LogoMark's "V" — the same path,
 * scaled and dropped under the head, so this is the real mark and not a
 * lookalike. Everything else is measured off it: shoulders on the outer edges of
 * its arms, hips on the bar under its point.
 *
 * These numbers were checked against a rasterised copy of the whole character
 * rather than guessed. That is how the arms ended up angled outward (hanging
 * straight, they swung through the torso), the hips this far apart (the feet
 * collided mid-stride when they were closer), and the cap flat-topped with a
 * front-only peak (a domed crown on a wide band read as a sun hat).
 */
const V_PATH = 'M 36,30 L 60,30 Q 65,30 67,36 L 100,112 L 133,36 Q 135,30 140,30 L 164,30 Q 172,30 168,38 L 112,134 Q 108,142 100,142 Q 92,142 88,134 L 32,38 Q 28,30 36,30 Z';
const V_SCALE = 0.6;
const V_TX = 40;
const V_TY = 60;

const EYE_Y = 46;
const EYE_DX = 13;      // from the centre line
const EYE_R = 9;
const PUPIL_R = 4;

const SHOULDER_X = 64;  // right shoulder mirrors to 200 - SHOULDER_X
const SHOULDER_Y = 95;
const ARM_W = 9;
const ARM_L = 24;
const GLOVE_R = 8;
const ARM_BASE = 20;    // resting outward angle, in degrees

// Legs are deliberately long — a bit over a quarter of his height. The first
// build gave him a big head, a long torso and 34-unit stumps, and no gait curve
// can rescue a stride that short: the feet simply have nowhere to travel, so
// every step becomes a shuffle no matter how well the knee bends.
//
// The hips are close together for a different reason. He is drawn front-on but
// walks in profile, so a leg swinging forward from a WIDE hip opens outward
// while the other one swings inward across the body — which made one half of
// every cycle a wide stance and the other a crossed one, and read as skipping.
// Close hips make the two halves near enough to mirror each other.
const HIP_X = 90;       // right hip mirrors
const HIP_Y = 150;
const LEG_W = 10;
const THIGH_L = 26;
const SHIN_L = 26;
const SHOE_W = 17;
const SHOE_H = 10;

/**
 * One gait cycle — two steps — as keyframes over a phase that runs 0→1 and
 * repeats. Straight pendulum legs read as marching; what makes a walk look real
 * is the knee: it stays near-straight through stance while the body vaults over
 * it, then folds hard at toe-off so the foot clears the ground, and swings
 * through and extends again just before the heel lands.
 *
 * Angles are degrees. Positive swings a hanging limb toward the LEFT — the way
 * he walks — so a negative knee folds the heel backwards, behind him.
 *
 * The right leg is the same curve half a cycle later, written out rather than
 * computed: Animated needs one ascending input range per interpolation.
 */
const GAIT_MS = 700;

const LEFT_PHASE  = [0, 0.15, 0.30, 0.50, 0.62, 0.80, 1];
const LEFT_THIGH  = [22, 12, 0, -20, -5, 18, 22];
const LEFT_KNEE   = [0, -8, 0, -15, -55, -25, 0];

const RIGHT_PHASE = [0, 0.12, 0.30, 0.50, 0.65, 0.80, 1];
const RIGHT_THIGH = [-20, -5, 18, 22, 12, 0, -20];
const RIGHT_KNEE  = [-15, -55, -25, 0, -8, 0, -15];

/**
 * The body rises over each stance leg and drops through double support, so it
 * bobs twice per cycle — the single most-missed cue in a fake walk.
 *
 * The amount is not a taste decision, it is arithmetic: with the legs spread
 * ~21° at double support, the hip sits `L·cos21` above the ground and `L` above
 * it at mid-stance, so the rise is `L·(1 - cos21)` ≈ 3.8 viewBox units ≈ 1.1px.
 * Any more than that and the planted foot has to sink through the floor, which
 * is exactly what a bouncy fake walk looks like.
 */
const BOUNCE_PHASE = [0, 0.30, 0.50, 0.80, 1];
const BOUNCE_PX    = [0, -1.2, 0, -1.2, 0];

/** Arms counter-swing against the same-side leg, around their resting angle. */
const ARM_PHASE = [0, 0.30, 0.50, 0.80, 1];
const LEFT_ARM_SWING  = [-13, 0, 13, 0, -13];
const RIGHT_ARM_SWING = [13, 0, -13, 0, 13];

/** viewBox units → px. */
const u = (n: number) => (n / VB_W) * SIZE;

/**
 * The far side of him — his right arm and right leg — is shaded down. With the
 * hips this close the two legs overlap as they pass, and without depth the
 * crossing frame reads as a single leg; darker means "behind", which is what
 * the far limb is doing.
 */
const FAR_LIMB = '#a6cf00';
const FAR_WHITE = '#e2e2d9';

export function WhereToMascot() {
  // The lane measures itself: he has to start beyond the card's real right edge
  // on any handset, and stop where its text column ends.
  const [laneWidth, setLaneWidth] = useState(0);

  const x = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  /** 0 → 1, linearly, forever: where he is in the gait cycle. Every joint and
   *  the body's bob are read off this one value, which is what keeps them in
   *  step with each other. */
  const phase = useRef(new Animated.Value(0)).current;
  /** The slow breath he settles into when he stops. */
  const breath = useRef(new Animated.Value(0)).current;
  /** 0 walking, 1 stopped. Drives the limbs, the eyes and the raised hand. */
  const parked = useRef(new Animated.Value(0)).current;
  /** The tooltip. */
  const talk = useRef(new Animated.Value(0)).current;
  /** 0 facing left (the way he arrives), 1 facing right (the way he leaves).
   *  Passing through 0.5 flips him through zero width, which reads as a turn. */
  const facing = useRef(new Animated.Value(0)).current;

  // Stands flush with the end of his lane — which is to say, exactly where the
  // card's text stops. He waits just past the lane's right edge, which is the
  // point at which it clips him: any further out is distance he would have to
  // cover with his feet, and every extra pixel of travel per step is a pixel of
  // skate.
  const restX = Math.max(0, laneWidth - SIZE);
  const offX = laneWidth + 8;

  useEffect(() => {
    if (laneWidth <= 0) return;

    x.setValue(offX);
    parked.setValue(0);
    talk.setValue(0);
    facing.setValue(0);

    // The whole performance, on a five-second beat: in, ask, turn, out, pause.
    // The travel legs are slow enough that the number of steps he takes roughly
    // matches the ground he covers — walk him faster and he skates.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(x, {
          toValue: restX,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.spring(parked, { toValue: 1, friction: 7, tension: 160, useNativeDriver: true }),
          Animated.spring(talk, { toValue: 1, friction: 6, tension: 130, useNativeDriver: true }),
        ]),
        Animated.delay(900),
        Animated.parallel([
          Animated.timing(talk, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(parked, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]),
        // Turns on the spot, then walks back out the way he came.
        Animated.timing(facing, { toValue: 1, duration: 200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(x, {
          toValue: offX,
          duration: 1600,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        // Turns back to face the way he will arrive from — off-card, unseen.
        Animated.timing(facing, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(300),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [laneWidth, x, parked, talk, facing, restX, offX]);

  // The gait clock, and the breath for standing still. The gait runs linearly
  // and never stops or eases: a walk cycle that speeds up and slows down within
  // a step is the thing that reads as fake.
  useEffect(() => {
    const walk = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: GAIT_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    walk.start();
    breathing.start();
    return () => { walk.stop(); breathing.stop(); };
  }, [phase, breath]);

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

  // Limbs settle the moment he arrives: he does not march on the spot. Every
  // joint is a degree NUMBER read off the gait, scaled to zero as he parks, and
  // only then turned into a rotation string — you cannot fade out a "-20deg".
  const walking = parked.interpolate({ inputRange: [0, 1], outputRange: [1, 0], extrapolate: 'clamp' });

  /** A gait keyframe track, scaled to zero as he parks, as a raw number. */
  const gaitPx = (
    inputRange: number[],
    outputRange: number[],
  ): Animated.AnimatedInterpolation<number> =>
    Animated.multiply(phase.interpolate({ inputRange, outputRange }), walking);

  /** …and the same, turned into a rotation. Degrees stay numbers until the last
   *  step precisely so they can be faded out — you cannot scale a "-20deg". */
  const gaitDeg = (
    inputRange: number[],
    outputRange: number[],
  ): Animated.AnimatedInterpolation<string> =>
    Animated.multiply(phase.interpolate({ inputRange, outputRange }), walking).interpolate({
      inputRange: [-180, 180],
      outputRange: ['-180deg', '180deg'],
    });

  const thighAngle = (side: 'left' | 'right') =>
    side === 'left' ? gaitDeg(LEFT_PHASE, LEFT_THIGH) : gaitDeg(RIGHT_PHASE, RIGHT_THIGH);
  const kneeAngle = (side: 'left' | 'right') =>
    side === 'left' ? gaitDeg(LEFT_PHASE, LEFT_KNEE) : gaitDeg(RIGHT_PHASE, RIGHT_KNEE);

  // Arms hang outward and counter-swing against the same-side leg, so a gloved
  // hand never crosses the torso. Parked, the leading hand comes up to gesture
  // at the words beside him.
  const armAngle = (side: 'left' | 'right'): Animated.AnimatedInterpolation<string> => {
    const lead = side === 'left';
    const swing = gaitPx(ARM_PHASE, lead ? LEFT_ARM_SWING : RIGHT_ARM_SWING);
    const rest = lead ? Animated.add(ARM_BASE, Animated.multiply(parked, 18)) : -ARM_BASE;
    return Animated.add(swing, rest).interpolate({
      inputRange: [-180, 180],
      outputRange: ['-180deg', '180deg'],
    });
  };

  const bobY = Animated.add(
    gaitPx(BOUNCE_PHASE, BOUNCE_PX),
    Animated.multiply(Animated.multiply(breath, parked), -1.4),
  );
  // Leans into the walk, and stands up straight when he stops. The lean flips
  // with him, because it is applied after the mirror.
  const lean: Animated.AnimatedInterpolation<string> = Animated.multiply(walking, -3).interpolate({
    inputRange: [-180, 180],
    outputRange: ['-180deg', '180deg'],
  });
  const flipX = facing.interpolate({ inputRange: [0, 1], outputRange: [1, -1] });
  // Eyes down the road while walking; on the words beside him once he stops.
  const pupilX = parked.interpolate({ inputRange: [0, 1], outputRange: [-1.3, -0.8] });
  const pupilY = parked.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] });
  // The tooltip arrives on the diagonal, out of his head and up to its place
  // above the card.
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
          left: u(side === 'left' ? 100 - EYE_DX : 100 + EYE_DX) - u(EYE_R),
          top: u(EYE_Y) - u(EYE_R),
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

  const arm = (side: 'left' | 'right') => {
    const far = side === 'right';
    return limb(
      `arm-${side}`,
      { x: far ? VB_W - SHOULDER_X : SHOULDER_X, y: SHOULDER_Y },
      armAngle(side),
      <>
        <View
          style={[
            styles.limbBar,
            far && { backgroundColor: FAR_LIMB },
            { left: -u(ARM_W) / 2, width: u(ARM_W), height: u(ARM_L), borderRadius: u(ARM_W) / 2 },
          ]}
        />
        <View
          style={[
            styles.glove,
            far && { backgroundColor: FAR_WHITE },
            {
              left: -u(GLOVE_R),
              top: u(ARM_L) - u(GLOVE_R) * 0.6,
              width: u(GLOVE_R) * 2,
              height: u(GLOVE_R) * 2,
              borderRadius: u(GLOVE_R),
            },
          ]}
        />
      </>,
    );
  };

  /**
   * A leg is two pivots, not one: the thigh turns at the hip, and the shin
   * hangs off a second pivot at the knee, so its angle is relative to the thigh
   * exactly as a real knee's is. The shoe rides on the shin, which is what
   * makes the foot lift and tuck under him through the swing instead of
   * skimming the ground.
   */
  const leg = (side: 'left' | 'right') => {
    const far = side === 'right';
    const bar = { left: -u(LEG_W) / 2, width: u(LEG_W), borderRadius: u(LEG_W) / 2 };
    return limb(
      `leg-${side}`,
      { x: far ? VB_W - HIP_X : HIP_X, y: HIP_Y },
      thighAngle(side),
      <>
        <View style={[styles.limbBar, far && { backgroundColor: FAR_LIMB }, bar, { height: u(THIGH_L) + u(2) }]} />
        <Animated.View
          style={[styles.pivot, { left: 0, top: u(THIGH_L), transform: [{ rotate: kneeAngle(side) }] }]}
        >
          <View style={[styles.limbBar, far && { backgroundColor: FAR_LIMB }, bar, { height: u(SHIN_L) }]} />
          {/* The toe points the way he is walking. */}
          <View
            style={[
              styles.shoe,
              far && { backgroundColor: FAR_WHITE },
              {
                left: -u(SHOE_W) + u(LEG_W) / 2 + u(3),
                top: u(SHIN_L) - u(2),
                width: u(SHOE_W),
                height: u(SHOE_H),
                borderRadius: u(SHOE_H) / 2,
                borderBottomRightRadius: u(3),
              },
            ]}
          />
        </Animated.View>
      </>,
    );
  };

  return (
    <View style={styles.layer} pointerEvents="none">
      {/* The tooltip lives outside the clipped lane, so it can rise above the
          card. It does not flip when he turns — only he does. */}
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
        <Animated.View
          style={[
            styles.walker,
            { transform: [{ translateX: x }, { translateY: bobY }, { scaleX: flipX }, { rotate: lean }] },
          ]}
        >
          {/* Legs go down first, so they read as being behind the torso. */}
          {leg('right')}
          {leg('left')}

          {/* Hips and torso. Split from the head so the arms can sit between
              them, in front of the "V" but behind the face. */}
          <Svg style={styles.part} width={SIZE} height={HEIGHT} viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <Rect x={78} y={138} width={44} height={18} rx={9} fill={colors.primary} />
            <Path
              d={V_PATH}
              fill={colors.primary}
              transform={`translate(${V_TX} ${V_TY}) scale(${V_SCALE})`}
            />
          </Svg>

          {arm('right')}
          {arm('left')}

          {/* Neck, head, smile, and the cap: flat crown, band, and a peak at the
              front only — the shape that reads as a driver rather than a hat. */}
          <Svg style={styles.part} width={SIZE} height={HEIGHT} viewBox={`0 0 ${VB_W} ${VB_H}`}>
            <Rect x={92} y={68} width={16} height={14} fill={colors.primary} />
            <Rect x={70} y={22} width={60} height={52} rx={18} fill={colors.primary} />
            <Path d="M 90,60 Q 100,67 110,60" stroke="#0b0d0c" strokeWidth={3.2} strokeLinecap="round" fill="none" />
            <Path d="M 72,22 L 50,26 Q 45,29 50,33 L 72,33 Z" fill="#ffffff" />
            <Rect x={70} y={18} width={60} height={11} rx={4} fill="#ffffff" />
            <Rect x={74} y={6} width={52} height={14} rx={6} fill="#ffffff" />
            <Rect x={70} y={24} width={60} height={3} rx={1.5} fill="rgba(11,13,12,0.18)" />
          </Svg>

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
  // part that clips, so he can wait off the card's right edge and walk in and
  // out without ever spilling outside it.
  lane: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    right: RIGHT_INSET,
    overflow: 'hidden',
  },
  // Exactly the size of the drawing, and centred by offsetting half its own
  // height rather than by `justifyContent`. This matters: the limbs are
  // positioned against this box's top-left, so if the box were taller than the
  // character every joint would land high and the feet would vanish into the
  // torso.
  walker: {
    position: 'absolute',
    left: 0,
    top: '50%',
    marginTop: -HEIGHT / 2,
    width: SIZE,
    height: HEIGHT,
  },
  // Both halves of the body share one origin and one viewBox, so their
  // coordinates line up as if they were a single drawing.
  part: { position: 'absolute', left: 0, top: 0 },

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
    borderWidth: 1,
    borderColor: 'rgba(11,13,12,0.25)',
  },
  pupil: { backgroundColor: '#0b0d0c' },

  // Above the card, outside it. `bottom: 100%` puts its base on the card's top
  // edge; the negative margin lets it sit ON that edge and poke ~14px above,
  // because every pixel it rises has to be bought from the sheet's top padding
  // — see `bottomSheetContent` on the passenger home screen.
  tip: {
    position: 'absolute',
    bottom: '100%',
    right: RIGHT_INSET + SIZE * 0.15,
    marginBottom: -12,
    backgroundColor: '#f5f3ec',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 5,
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
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
