/**
 * Drawer icons — small illustrations, not line marks.
 *
 * ── Why they were redrawn, twice ────────────────────────────────────────────
 * Round one took the menu off emoji, which fixed the worst of it: no two rows
 * shared a face any more, and the marks finally carried the brand. But they
 * were hairline two-tone outlines at 21px, and sixteen of those stacked down a
 * dark panel read as one grey scribble — the eye cannot tell a 1.6px car from a
 * 1.6px parcel from a 1.6px cog without stopping to read the label underneath.
 * A menu you have to read word by word feels confusing even when every row is
 * correctly named.
 *
 * So these are drawn as objects instead of as diagrams:
 *
 *  · THREE TONES, NOT ONE. Every shape has a lit face, a body and a darker
 *    underside, plus a ground shadow, which is what makes a 26px mark read as a
 *    thing sitting there rather than a symbol printed flat.
 *  · REAL MATERIALS. Kraft card on the parcel, gold on the coins, steel on the
 *    shield and the cog, paper on the map and the envelope, glass on the cars.
 *    Material is the fastest way to tell two icons apart — faster than shape,
 *    much faster than a label.
 *  · THE LIME IS STILL THE POINTER. One brand detail per icon, on the part that
 *    names the feature: the headlights, the destination pin, the parcel tape,
 *    the magnifier, the tick. It is never the whole object, or it stops meaning
 *    anything.
 *  · 48-UNIT GRID (the old set used 24). Twice the room for the bevels and
 *    insets that do the shading, and round numbers while drawing.
 *
 * ── How they move ──────────────────────────────────────────────────────────
 * Each icon takes ONE `motion` value from its row:
 *
 *      0 ─────────── 1 ─────────── 2
 *      arriving      at rest       held down
 *
 * The drawer builds it as `Animated.add(the row's slice of the entrance
 * cascade, the row's press value)`, so an icon animates itself into place as
 * its row arrives, and again — further — while a finger is on it. An icon
 * rendered anywhere else gets `STILL` and sits at 1. Nothing loops: a wheel
 * spinning forever behind a closed drawer is battery spent on nobody.
 *
 * The moving part of each icon is a SEPARATE native-driven View layer over the
 * still art, never an animated node inside the <Svg>. Transforms on SVG
 * children cannot run on the native driver — they would be sixteen JS
 * animations fighting the scroll — whereas a View transform is free. Each layer
 * is its own small box so a rotation turns about the wheel's centre rather than
 * the icon's, and `clip` makes a box an opening something can slide out of (the
 * letter, the bank card).
 *
 * House rule for those boxes: leave ~4 units of padding around the art, so
 * nothing a transform does can reach the edge. Android will not reliably draw a
 * child outside its parent's bounds.
 */
import { type ComponentProps } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

import { colors } from '../config';

/** The grid every path below is drawn on. */
const GRID = 48;

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/** A 0 → 1 → 2 value: arriving, at rest, held. */
export type Motion = Animated.AnimatedInterpolation<number>;

/** Icons outside an animating row sit at rest. */
const STILL: Motion = new Animated.Value(1).interpolate({
  inputRange: [0, 1],
  outputRange: [0, 1],
});

export interface DrawerIconProps {
  size?: number;
  /** Structural colour. Only marks that must follow the row's own colour use it. */
  color?: string;
  /** The brand detail that names the feature. */
  accent?: string;
  motion?: Motion;
}

/* ── Materials ─────────────────────────────────────────────────────────────
   Named, shared and few. Sixteen icons each inventing their own greys is how
   an icon set stops looking like a set. */
const INK = '#14181a';
const STEEL_D = '#6c7780';
const STEEL = '#aab5bd';
const STEEL_L = '#e7edf0';
const GLASS = '#7fb0d2';
const GLASS_D = '#4b7793';
const PAPER = '#f4f6f3';
const PAPER_D = '#cdd4ce';
const GOLD = '#f6c846';
const GOLD_L = '#ffe493';
const GOLD_D = '#bd8a16';
const KRAFT_L = '#edc38c';
const KRAFT = '#d9a469';
const KRAFT_D = '#a97740';
const RED = '#e8492f';
const NAVY = '#36436a';
const NAVY_L = '#4a5a88';
const SHADOW = 'rgba(0,0,0,0.32)';

/** Two decimals is plenty on a 48 grid, and keeps generated paths readable. */
const f = (n: number) => Number(n.toFixed(2));

/** The icon's frame: still art in one Svg, moving parts layered over it. */
function Glyph({
  size,
  style,
  still,
  children,
}: {
  size: number;
  style?: AnimatedViewStyle;
  still: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        {still}
      </Svg>
      {children}
    </Animated.View>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One moving part, in its own box on the 48 grid.
 *
 * The box is fixed and the art inside it moves, which is the only way `clip`
 * reads as an opening: if the clip travelled with the art, nothing would ever
 * disappear into anything.
 */
function Part({
  size,
  box,
  clip = false,
  style,
  children,
}: {
  size: number;
  box: Box;
  clip?: boolean;
  style?: AnimatedViewStyle;
  children: React.ReactNode;
}) {
  const u = size / GRID;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: box.x * u,
        top: box.y * u,
        width: box.w * u,
        height: box.h * u,
        overflow: clip ? 'hidden' : 'visible',
      }}
    >
      <Animated.View style={style}>
        <Svg width={box.w * u} height={box.h * u} viewBox={`0 0 ${box.w} ${box.h}`} fill="none">
          {children}
        </Svg>
      </Animated.View>
    </View>
  );
}

/** A five-point star, generated so a badge box can be sized around it. */
function starPath(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = [];
  for (let k = 0; k < 5; k += 1) {
    const a = ((-90 + k * 72) * Math.PI) / 180;
    const b = a + (36 * Math.PI) / 180;
    pts.push(`${f(cx + outer * Math.cos(a))} ${f(cy + outer * Math.sin(a))}`);
    pts.push(`${f(cx + inner * Math.cos(b))} ${f(cy + inner * Math.sin(b))}`);
  }
  return `M${pts.join(' L')} Z`;
}

/**
 * A head and shoulders that fits inside a disc of radius `r`.
 *
 * The proportions matter more than they look: if the shoulder dome rises above
 * the head's waist the two merge into a cloud, which is exactly what the first
 * attempt did. The dome's apex is pinned just under the chin instead, and the
 * flat bottom is kept inside the disc's own curve at that height.
 */
function bust(cx: number, cy: number, r: number, fill: string) {
  const w = r * 0.5;
  const top = cy + r * 0.46;
  const bot = cy + r * 0.8;
  return (
    <>
      <Circle cx={cx} cy={f(cy - r * 0.34)} r={f(r * 0.28)} fill={fill} />
      <Path
        d={`M${f(cx - w)} ${f(bot)} V${f(top)} A${f(w)} ${f(w)} 0 0 1 ${f(cx + w)} ${f(top)} V${f(bot)} Z`}
        fill={fill}
      />
    </>
  );
}

/** A tyre with spokes — a plain disc spinning is a disc standing still. */
function wheel(accent: string) {
  return (
    <>
      <Circle cx={6.8} cy={6.8} r={6.2} fill={INK} />
      <Circle cx={6.8} cy={6.8} r={4.3} fill="#39424a" />
      <Rect x={6.3} y={2.6} width={1} height={8.4} rx={0.5} fill="#5c666d" />
      <Rect
        x={6.3}
        y={2.6}
        width={1}
        height={8.4}
        rx={0.5}
        fill="#5c666d"
        rotation={60}
        originX={6.8}
        originY={6.8}
      />
      <Rect
        x={6.3}
        y={2.6}
        width={1}
        height={8.4}
        rx={0.5}
        fill="#5c666d"
        rotation={120}
        originX={6.8}
        originY={6.8}
      />
      <Circle cx={6.8} cy={6.8} r={1.6} fill={accent} />
    </>
  );
}

/* ── Rides ───────────────────────────────────────────────────────────────── */

/** City rides — a saloon in profile. It rolls in, and rolls on when held. */
export function CityCarIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const roll = motion.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['-170deg', '0deg', '150deg'],
  });
  const drive = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-5 * u, 0, 1.6 * u] });

  return (
    <Glyph
      size={size}
      style={{ transform: [{ translateX: drive }] }}
      still={
        <>
          <Ellipse cx={24} cy={41.8} rx={16} ry={2.3} fill={SHADOW} />
          {/* Cabin first: the body is drawn over its base so the join is clean. */}
          <Path
            d="M13.8 22 L19.4 13.6 C20.3 12.3 21.8 11.5 23.4 11.5 H30.6 C32.3 11.5 33.9 12.4 34.8 13.8 L39.9 22 Z"
            fill={STEEL_L}
          />
          <Path d="M17.6 20.8 L21.6 14.8 C21.9 14.3 22.5 14 23.1 14 H25.4 V20.8 Z" fill={GLASS} />
          <Path d="M27.4 14 H30.3 C30.9 14 31.5 14.3 31.8 14.8 L35.6 20.8 H27.4 Z" fill={GLASS} />
          <Path d="M19.6 20.8 L23.4 14.6 H24.6 L21.2 20.8 Z" fill="rgba(255,255,255,0.32)" />
          <Path
            d="M3.6 34.2 V27 C3.6 25.3 4.8 23.9 6.5 23.6 L14.4 22 H38.2 C40.4 22 42.5 22.9 44 24.5 C44.9 25.5 45.4 26.8 45.4 28.1 V34.2 C45.4 35.3 44.5 36.2 43.4 36.2 H5.6 C4.5 36.2 3.6 35.3 3.6 34.2 Z"
            fill={STEEL}
          />
          <Path d="M26.4 22 V35.4" stroke="rgba(0,0,0,0.13)" strokeWidth={1.3} />
          <Rect x={20.8} y={26} width={4.4} height={1.5} rx={0.75} fill={STEEL_D} />
          <Rect x={6} y={33.6} width={36} height={2} rx={1} fill="rgba(0,0,0,0.18)" />
          <Rect x={41.4} y={26.4} width={3.6} height={3} rx={1.2} fill={accent} />
          <Rect x={4} y={26.4} width={3.2} height={2.8} rx={1.2} fill={RED} />
        </>
      }
    >
      <Part size={size} box={{ x: 8, y: 28, w: 13.6, h: 13.6 }} style={{ transform: [{ rotate: roll }] }}>
        {wheel(accent)}
      </Part>
      <Part size={size} box={{ x: 27, y: 28, w: 13.6, h: 13.6 }} style={{ transform: [{ rotate: roll }] }}>
        {wheel(accent)}
      </Part>
    </Glyph>
  );
}

/**
 * Special Rides — an award rosette, the medal glinting.
 *
 * Deliberately NOT a car. City rides is a car and shared rides is a car; a
 * third car with a sticker on it is exactly the "two products, one face"
 * problem the emoji had. A chauffeur's cap was tried first and read as a
 * flying saucer at 26px — a front-on cap is a dome on a disc, and so is a
 * saucer. A ribboned medal has a silhouette nothing else in the menu shares,
 * and says the one thing these bookings have in common: they are the premium
 * ones. The row's own line carries the specifics.
 */
export function SpecialRideIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const settle = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-3.4 * u, 0, 0.8 * u] });
  const glint = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.2, 1, 1.12] });
  const turn = motion.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['-120deg', '0deg', '26deg'],
  });

  return (
    <Glyph
      size={size}
      style={{ transform: [{ translateY: settle }] }}
      still={
        <>
          {/* Ribbons first: the medal is dropped on top of them. */}
          <Path d="M17.4 29.4 L13 43.8 L19 41.4 L22.6 30.8 Z" fill={NAVY_L} />
          <Path d="M30.6 29.4 L35 43.8 L29 41.4 L25.4 30.8 Z" fill={NAVY} />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 8.6, y: 5.2, w: 30.8, h: 30.8 }}
        style={{ transform: [{ scale: glint }, { rotate: turn }] }}
      >
        <Circle cx={15.4} cy={15.4} r={11.4} fill={GOLD} />
        <Circle cx={15.4} cy={15.4} r={9.9} stroke={accent} strokeWidth={1.2} />
        <Circle cx={15.4} cy={15.4} r={9} fill={GOLD_D} />
        <Path d={starPath(15.4, 15.4, 6.4, 2.7)} fill={GOLD_L} />
      </Part>
    </Glyph>
  );
}

/** City to City — a road out of town, and the pin dropping on the next one. */
export function CityToCityIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const drop = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-3.6 * u, 0, -1.8 * u] });
  const land = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.7, 1, 1.06] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Path d="M13.4 43.4 L20.4 17.2 H27.6 L34.6 43.4 Z" fill="#39424a" />
          <Path d="M20.4 17.2 L13.4 43.4" stroke={PAPER_D} strokeWidth={1.4} opacity={0.4} />
          <Path d="M27.6 17.2 L34.6 43.4" stroke={PAPER_D} strokeWidth={1.4} opacity={0.4} />
          {/* Lane dashes, shrinking into the distance. */}
          <Rect x={22.4} y={36.8} width={3.2} height={6.2} rx={1.6} fill="#e8ece9" />
          <Rect x={22.7} y={29.4} width={2.6} height={5} rx={1.3} fill="#e8ece9" opacity={0.85} />
          <Rect x={22.95} y={23.6} width={2.1} height={3.8} rx={1.05} fill="#e8ece9" opacity={0.6} />
          <Rect x={23.2} y={19.2} width={1.6} height={2.8} rx={0.8} fill="#e8ece9" opacity={0.4} />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 14, y: 1.6, w: 20, h: 20 }}
        style={{ transform: [{ translateY: drop }, { scale: land }] }}
      >
        <Path
          d="M10 16.4 C10 16.4 4.6 11 4.6 9.4 A5.4 5.4 0 1 1 15.4 9.4 C15.4 11 10 16.4 10 16.4 Z"
          fill={accent}
        />
        <Circle cx={10} cy={9.4} r={2.1} fill="#15181a" />
      </Part>
    </Glyph>
  );
}

/** Nearby sharing rides — a car head-on, two riders behind the glass. */
export function SharedRideIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const slide = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [3.2 * u, 0, 0] });
  const pop = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.08] });
  const show = motion.interpolate({ inputRange: [0, 0.55, 1, 2], outputRange: [0, 0, 1, 1] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={24} cy={42} rx={16} ry={2.3} fill={SHADOW} />
          <Path
            d="M7.2 38 V20.4 C7.2 17 10 14.2 13.4 14.2 H34.6 C38 14.2 40.8 17 40.8 20.4 V38 C40.8 39.4 39.7 40.5 38.3 40.5 H9.7 C8.3 40.5 7.2 39.4 7.2 38 Z"
            fill={STEEL}
          />
          <Path
            d="M9.6 22 V20.6 C9.6 18 11.7 15.9 14.3 15.9 H33.7 C36.3 15.9 38.4 18 38.4 20.6 V22 Z"
            fill={STEEL_L}
          />
          <Path
            d="M11.6 28 L13.8 19.6 C14.1 18.5 15.1 17.8 16.2 17.8 H31.8 C32.9 17.8 33.9 18.5 34.2 19.6 L36.4 28 Z"
            fill={GLASS}
          />
          <Path d="M12.4 25 H35.6 L36.4 28 H11.6 Z" fill={GLASS_D} opacity={0.45} />
          {/* Mirrors */}
          <Path d="M7.2 24.2 L4 25.4 C3.2 25.7 3.2 26.9 4 27.2 L7.2 28.4 Z" fill={STEEL_D} />
          <Path d="M40.8 24.2 L44 25.4 C44.8 25.7 44.8 26.9 44 27.2 L40.8 28.4 Z" fill={STEEL_D} />
          {/* The rider already aboard. */}
          <Circle cx={18.4} cy={22.6} r={3} fill={PAPER} />
          <Path d="M14.4 28 C14.4 26 16.2 24.4 18.4 24.4 C20.6 24.4 22.4 26 22.4 28 Z" fill={PAPER} />
          <Path d="M9.6 29.6 H38.4" stroke="rgba(0,0,0,0.13)" strokeWidth={1.3} />
          <Rect x={10.4} y={31.6} width={8} height={2.8} rx={1.4} fill={accent} />
          <Rect x={29.6} y={31.6} width={8} height={2.8} rx={1.4} fill={accent} />
          <Rect x={19.8} y={31.8} width={8.4} height={2.4} rx={1.2} fill="#2b3237" />
          <Rect x={8.4} y={35.6} width={31.2} height={3} rx={1.5} fill="#98a3ab" />
          <Rect x={18.6} y={36.3} width={10.8} height={1.8} rx={0.9} fill={PAPER_D} />
        </>
      }
    >
      {/* The second rider takes the free seat as the row arrives. */}
      <Part
        size={size}
        box={{ x: 21.6, y: 15.6, w: 16, h: 16 }}
        style={{ opacity: show, transform: [{ translateX: slide }, { scale: pop }] }}
      >
        <Circle cx={8} cy={7} r={3} fill={accent} />
        <Path d="M4 12.4 C4 10.4 5.8 8.8 8 8.8 C10.2 8.8 12 10.4 12 12.4 Z" fill={accent} />
      </Part>
    </Glyph>
  );
}

/** My routes — a folded paper map with the trip you saved drawn on it. */
export function RouteMapIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const drop = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-3.5 * u, 0, -1.6 * u] });
  const land = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.6, 1, 1.06] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={24} cy={42.4} rx={15} ry={2} fill={SHADOW} />
          <Path d="M4 13.4 L17.6 8.8 L30.4 13.4 L44 8.8 V34.6 L30.4 39.2 L17.6 34.6 L4 39.2 Z" fill={PAPER} />
          <Path d="M17.6 8.8 L30.4 13.4 V39.2 L17.6 34.6 Z" fill="#e3e7e1" />
          <Path d="M30.4 13.4 L44 8.8 V34.6 L30.4 39.2 Z" fill="#eef1ec" />
          <Path d="M17.6 8.8 V34.6" stroke="rgba(0,0,0,0.12)" strokeWidth={1} />
          <Path d="M30.4 13.4 V39.2" stroke="rgba(0,0,0,0.12)" strokeWidth={1} />
          {/* Casing under the route line, the way a road is drawn on a real map. */}
          <Path
            d="M11 31.4 C15.2 31.4 15.6 23.2 21 23.2 C26.4 23.2 27 16.2 33.2 16.2"
            stroke="#8aa800"
            strokeWidth={4.4}
            strokeLinecap="round"
          />
          <Path
            d="M11 31.4 C15.2 31.4 15.6 23.2 21 23.2 C26.4 23.2 27 16.2 33.2 16.2"
            stroke={accent}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <Circle cx={11} cy={31.4} r={3.2} fill={accent} />
          <Circle cx={11} cy={31.4} r={1.4} fill="#15181a" />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 25, y: 1, w: 17, h: 20 }}
        style={{ transform: [{ translateY: drop }, { scale: land }] }}
      >
        <Path
          d="M8.2 15.2 C8.2 15.2 3.6 10.2 3.6 8.6 A4.6 4.6 0 1 1 12.8 8.6 C12.8 10.2 8.2 15.2 8.2 15.2 Z"
          fill={RED}
        />
        <Circle cx={8.2} cy={8.6} r={1.8} fill={PAPER} />
      </Part>
    </Glyph>
  );
}

/** Couriers — a taped kraft box, landing. */
export function ParcelIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const fall = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-4 * u, 0, -2 * u] });
  const tilt = motion.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['-7deg', '0deg', '4deg'],
  });

  return (
    <Glyph size={size} still={<Ellipse cx={24} cy={42.2} rx={14} ry={2.2} fill={SHADOW} />}>
      <Part
        size={size}
        box={{ x: 0, y: 0, w: 48, h: 48 }}
        style={{ transform: [{ translateY: fall }, { rotate: tilt }] }}
      >
        <Path d="M24 7.4 L41.6 15.2 L24 23 L6.4 15.2 Z" fill={KRAFT_L} />
        <Path d="M6.4 15.2 L24 23 V40.6 L6.4 32.8 Z" fill={KRAFT_D} />
        <Path d="M41.6 15.2 L24 23 V40.6 L41.6 32.8 Z" fill={KRAFT} />
        <Path d="M15.2 11.3 L32.8 19.1 L36.6 17.4 L19 9.6 Z" fill={accent} opacity={0.92} />
        <Path d="M32.8 19.1 V36.7 L36.6 35 V17.4 Z" fill={accent} opacity={0.72} />
        <Path d="M10.6 21.6 L18.8 25.2 V31 L10.6 27.4 Z" fill={PAPER} opacity={0.92} />
        <Path d="M12.4 24.2 L17 26.2" stroke="#8b959d" strokeWidth={0.9} />
        <Path d="M12.4 26.6 L15.4 27.9" stroke="#8b959d" strokeWidth={0.9} />
        <Path d="M6.4 15.2 L24 23 L41.6 15.2" stroke="rgba(255,255,255,0.22)" strokeWidth={0.9} />
      </Part>
    </Glyph>
  );
}

/* ── People & earning ────────────────────────────────────────────────────── */

/** Travel Partner — looking for people who travel your way. */
export function PartnerIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const sweep = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-3.5 * u, 0, 1.6 * u] });
  const lift = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.8, 1, 1.06] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={21} cy={41.6} rx={13} ry={2.2} fill={SHADOW} />
          <Path d="M8.4 40 C8.4 31.6 13.4 25 19.6 25 C25.8 25 30.8 31.6 30.8 40 Z" fill="#89b2d4" />
          <Path
            d="M16 25.8 L19.6 29.6 L23.2 25.8"
            stroke={PAPER}
            strokeWidth={1.8}
            strokeLinecap="round"
          />
          <Circle cx={19.6} cy={15.4} r={6.2} fill={PAPER} />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 20.6, y: 15.8, w: 27.4, h: 28.4 }}
        style={{ transform: [{ translateX: sweep }, { translateY: sweep }, { scale: lift }] }}
      >
        <Circle cx={12.8} cy={12.8} r={7.2} fill="rgba(255,255,255,0.16)" />
        <Circle cx={12.8} cy={12.8} r={7.2} stroke={accent} strokeWidth={3.2} />
        <Path d="M17.9 17.9 L22.6 22.6" stroke={accent} strokeWidth={3.8} strokeLinecap="round" />
      </Part>
    </Glyph>
  );
}

/** Matches & Groups — the people you matched with, and the tick that says so. */
export function GroupIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const pop = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.2, 1, 1.12] });
  const show = motion.interpolate({ inputRange: [0, 0.5, 1, 2], outputRange: [0, 0, 1, 1] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Circle cx={12.6} cy={25} r={8.4} fill="#39434b" stroke="#0e100f" strokeWidth={1.8} />
          {bust(12.6, 25, 8.4, '#808d96')}
          <Circle cx={35.4} cy={25} r={8.4} fill="#39434b" stroke="#0e100f" strokeWidth={1.8} />
          {bust(35.4, 25, 8.4, '#808d96')}
          <Circle cx={24} cy={21.6} r={9.6} fill="#4a5661" stroke="#0e100f" strokeWidth={1.8} />
          {bust(24, 21.6, 9.6, PAPER)}
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 23.4, y: 20.2, w: 18, h: 18 }}
        style={{ opacity: show, transform: [{ scale: pop }] }}
      >
        <Circle cx={9} cy={9} r={5} fill={accent} stroke="#0e100f" strokeWidth={1.6} />
        <Path
          d="M6.4 9.1 L8.4 11.1 L11.8 7.5"
          stroke="#15181a"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Part>
    </Glyph>
  );
}

/**
 * Messages — an envelope with the letter sliding out of it.
 *
 * Three layers, in this order, because it is the only way the letter can come
 * out of the envelope rather than over it: the open back, then the letter in a
 * clipped box whose bottom edge IS the envelope's mouth, then the front.
 */
export function EnvelopeIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const out = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [9.6 * u, 0, -2.4 * u] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={24} cy={39.6} rx={15} ry={2} fill={SHADOW} />
          <Rect x={5} y={12.6} width={38} height={24.6} rx={3.4} fill="#b7bfb9" />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 7.5, y: 0, w: 33, h: 12.6 }}
        clip
        style={{ transform: [{ translateY: out }] }}
      >
        <Rect x={2} y={3} width={29} height={16} rx={1.8} fill="#ffffff" />
        <Rect x={5.2} y={6.4} width={16} height={1.5} rx={0.75} fill={accent} />
        <Rect x={5.2} y={9.8} width={22} height={1.3} rx={0.65} fill="#c9d1cb" />
        <Rect x={5.2} y={12.8} width={18} height={1.3} rx={0.65} fill="#c9d1cb" />
      </Part>
      <Part size={size} box={{ x: 0, y: 0, w: 48, h: 48 }}>
        <Path
          d="M5 18.4 L24 30.6 L43 18.4 V33.8 C43 35.6 41.6 37 39.8 37 H8.2 C6.4 37 5 35.6 5 33.8 Z"
          fill={PAPER}
        />
        <Path d="M5 18.4 L24 30.6 L43 18.4" stroke={accent} strokeWidth={1.8} strokeLinejoin="round" />
        <Path
          d="M5 33 H43 V33.8 C43 35.6 41.6 37 39.8 37 H8.2 C6.4 37 5 35.6 5 33.8 Z"
          fill="rgba(0,0,0,0.08)"
        />
      </Part>
    </Glyph>
  );
}

/** Earn with Velocity Rides — a stack of coins, the top one landing on it. */
export function EarnIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const fall = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-4.6 * u, 0, -2 * u] });
  const land = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.86, 1, 1.03] });

  /** One coin: a dark bottom edge, a side wall, a lit face. */
  const coin = (top: number) => (
    <>
      <Ellipse cx={24} cy={top + 3.6} rx={13} ry={5.2} fill={GOLD_D} />
      <Rect x={11} y={top} width={26} height={3.6} fill={GOLD_D} />
      <Ellipse cx={24} cy={top} rx={13} ry={5.2} fill={GOLD} />
      <Ellipse cx={24} cy={top} rx={9.4} ry={3.4} fill={GOLD_L} opacity={0.55} />
    </>
  );

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={24} cy={42} rx={14.6} ry={2.3} fill={SHADOW} />
          {coin(30.6)}
          {coin(25.2)}
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 7, y: 10, w: 34, h: 22.4 }}
        style={{ transform: [{ translateY: fall }, { scale: land }] }}
      >
        <Ellipse cx={17} cy={13} rx={13} ry={5.2} fill={GOLD_D} />
        <Rect x={4} y={9.4} width={26} height={3.6} fill={GOLD_D} />
        <Ellipse cx={17} cy={9.4} rx={13} ry={5.2} fill={GOLD} />
        <Ellipse cx={17} cy={9.4} rx={9.4} ry={3.4} fill={GOLD_L} opacity={0.55} />
        <Path
          d="M13 9.6 L17 6.8 L21 9.6"
          stroke={accent}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M17 7.8 V11.8" stroke={accent} strokeWidth={2.4} strokeLinecap="round" />
      </Part>
    </Glyph>
  );
}

/** Find my Customers — a megaphone pushing an offer out across the city. */
export function MegaphoneIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const push = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-3 * u, 0, 2.4 * u] });
  const heard = motion.interpolate({ inputRange: [0, 0.5, 1, 2], outputRange: [0, 0, 1, 1] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={22} cy={42.4} rx={12} ry={2} fill={SHADOW} />
          <Path
            d="M13.6 29.4 V33.6 C13.6 36 15.6 38 18 38 H19.4"
            stroke="#4a5359"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Rect x={5.4} y={18.6} width={9} height={10.8} rx={3} fill="#5a646b" />
          <Path
            d="M14 19 L31.6 8.6 C32.9 7.8 34.6 8.8 34.6 10.3 V37.7 C34.6 39.2 32.9 40.2 31.6 39.4 L14 29 Z"
            fill={STEEL_L}
          />
          <Path d="M14 24 H34.6 V37.7 C34.6 39.2 32.9 40.2 31.6 39.4 L14 29 Z" fill={STEEL} opacity={0.9} />
          <Path
            d="M31.6 8.6 C32.9 7.8 34.6 8.8 34.6 10.3 V37.7 C34.6 39.2 32.9 40.2 31.6 39.4"
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 32, y: 8, w: 16, h: 32 }}
        style={{ opacity: heard, transform: [{ translateX: push }] }}
      >
        <Path d="M3.4 12.6 Q7.4 16 3.4 19.4" stroke={accent} strokeWidth={2.4} strokeLinecap="round" />
        <Path
          d="M5.6 9.6 Q11.6 16 5.6 22.4"
          stroke={accent}
          strokeWidth={2.2}
          strokeLinecap="round"
          opacity={0.72}
        />
        <Path
          d="M7.8 6.6 Q15.8 16 7.8 25.4"
          stroke={accent}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.45}
        />
      </Part>
    </Glyph>
  );
}

/* ── Your account ────────────────────────────────────────────────────────── */

/** Wallet — a card coming out of a leather fold. */
export function WalletCardIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const out = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [9.4 * u, 0, -2.2 * u] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Ellipse cx={24} cy={40.4} rx={14} ry={2} fill={SHADOW} />
          <Rect x={5} y={12} width={38} height={25} rx={4.2} fill="#4b3f37" />
        </>
      }
    >
      <Part size={size} box={{ x: 10, y: 0, w: 28, h: 12 }} clip style={{ transform: [{ translateY: out }] }}>
        <Rect x={1.6} y={2.6} width={24.8} height={14} rx={2.2} fill={accent} />
        <Rect x={1.6} y={5.6} width={24.8} height={2.6} fill="rgba(0,0,0,0.55)" />
        <Rect x={4.2} y={10} width={4} height={2.8} rx={0.8} fill="rgba(0,0,0,0.35)" />
      </Part>
      <Part size={size} box={{ x: 0, y: 0, w: 48, h: 48 }}>
        <Path d="M5 20 V16.2 C5 13.9 6.9 12 9.2 12 H38.8 C41.1 12 43 13.9 43 16.2 V20 Z" fill="#5e5047" />
        <Rect
          x={7.8}
          y={14.8}
          width={32.4}
          height={19.4}
          rx={3}
          stroke="rgba(255,255,255,0.16)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
        <Rect x={28.6} y={22.4} width={12.4} height={7} rx={3.5} fill="#2d251f" />
        <Circle cx={34.8} cy={25.9} r={2.1} fill={accent} />
      </Part>
    </Glyph>
  );
}

/** Safety Centre — a steel shield, the tick struck into it. */
export function ShieldIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const pop = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.08] });
  const turn = motion.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['-18deg', '0deg', '0deg'],
  });
  const show = motion.interpolate({ inputRange: [0, 0.45, 1, 2], outputRange: [0, 0, 1, 1] });

  return (
    <Glyph
      size={size}
      still={
        <>
          <Path
            d="M24 4.4 L41.6 10.4 V23.6 C41.6 33.2 34.6 41.2 24 44.2 C13.4 41.2 6.4 33.2 6.4 23.6 V10.4 Z"
            fill="#93a0aa"
          />
          <Path d="M24 4.4 L6.4 10.4 V23.6 C6.4 33.2 13.4 41.2 24 44.2 Z" fill="#b0bcc4" />
          <Path
            d="M24 8.8 L37.6 13.4 V23.6 C37.6 31.2 32.2 37.6 24 40.2 C15.8 37.6 10.4 31.2 10.4 23.6 V13.4 Z"
            fill="#39424a"
          />
        </>
      }
    >
      <Part
        size={size}
        box={{ x: 12, y: 14, w: 24, h: 20 }}
        style={{ opacity: show, transform: [{ scale: pop }, { rotate: turn }] }}
      >
        <Path
          d="M6.6 10.6 L10.8 14.8 L17.6 6.4"
          stroke={accent}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Part>
    </Glyph>
  );
}

/** Help & complaints — a lifebuoy thrown to you, Rapid Response inside it. */
export function RapidHelpIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const spin = motion.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['-100deg', '0deg', '50deg'],
  });

  return (
    <Glyph
      size={size}
      still={<Path d="M25.6 16.4 L18.4 26 H22.6 L21.6 31.8 L29 22.6 H24.6 Z" fill={accent} />}
    >
      <Part size={size} box={{ x: 0, y: 0, w: 48, h: 48 }} style={{ transform: [{ rotate: spin }] }}>
        <Circle cx={24} cy={24} r={15.2} stroke="#eef2f0" strokeWidth={6.6} />
        {/* Four blocks: eight dashes of an eighth of the circumference each. */}
        <Circle
          cx={24}
          cy={24}
          r={15.2}
          stroke={RED}
          strokeWidth={6.6}
          strokeDasharray="11.94 11.94"
          rotation={22.5}
          originX={24}
          originY={24}
        />
        <Circle cx={24} cy={24} r={18.5} stroke="rgba(0,0,0,0.22)" strokeWidth={1} />
      </Part>
    </Glyph>
  );
}

/** Settings — a cog that turns itself into place. */
export function GearIcon({ size = 26, accent = colors.primary, motion = STILL }: DrawerIconProps) {
  const turn = motion.interpolate({
    inputRange: [0, 1, 2],
    outputRange: ['-70deg', '0deg', '45deg'],
  });

  return (
    <Glyph size={size} still={<Ellipse cx={24} cy={42} rx={12} ry={2} fill={SHADOW} />}>
      <Part size={size} box={{ x: 0, y: 0, w: 48, h: 48 }} style={{ transform: [{ rotate: turn }] }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
          <Rect
            key={k}
            x={21.4}
            y={3.8}
            width={5.2}
            height={7.6}
            rx={1.8}
            fill="#8d979f"
            rotation={k * 45}
            originX={24}
            originY={24}
          />
        ))}
        <Circle cx={24} cy={24} r={13.8} fill="#a9b4bb" />
        <Circle cx={24} cy={24} r={10.6} fill="#8d979f" />
        <Circle cx={24} cy={24} r={6.4} fill="#2f363b" />
        <Circle cx={24} cy={24} r={6.4} stroke={accent} strokeWidth={2.4} />
      </Part>
    </Glyph>
  );
}

/** Sign out — the way out, with the arrow already going through it. */
export function SignOutIcon({ size = 26, color = '#ffffff', motion = STILL }: DrawerIconProps) {
  const u = size / GRID;
  const leave = motion.interpolate({ inputRange: [0, 1, 2], outputRange: [-3.4 * u, 0, 3 * u] });

  return (
    <Glyph
      size={size}
      still={
        <>
          {/* A light frame around a dark door, with two sunk panels: without
              those it is a rounded slab, and a rounded slab is a phone. */}
          <Rect x={6} y={4.2} width={22.4} height={39.6} rx={2.6} fill="#8f9ba3" />
          <Rect x={9} y={7.2} width={16.4} height={33.6} rx={1.6} fill="#39434a" />
          <Rect x={11.4} y={10} width={11.6} height={12} rx={1.2} fill="#4d5861" />
          <Rect x={11.4} y={25} width={11.6} height={12} rx={1.2} fill="#4d5861" />
          <Circle cx={23.6} cy={23.4} r={1.8} fill="#f0d98a" />
        </>
      }
    >
      <Part size={size} box={{ x: 24, y: 14, w: 24, h: 20 }} style={{ transform: [{ translateX: leave }] }}>
        <Path d="M3.6 10 H14.6" stroke={color} strokeWidth={3.6} strokeLinecap="round" />
        <Path
          d="M10.4 5.4 L15.4 10 L10.4 14.6"
          stroke={color}
          strokeWidth={3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Part>
    </Glyph>
  );
}

/** Your profile — the head and shoulders on the drawer's own header. */
export function ProfileIcon({ size = 26, accent = colors.primary }: DrawerIconProps) {
  return (
    <Glyph
      size={size}
      still={
        <>
          <Path d="M9 42 C9 33.2 15.7 26.2 24 26.2 C32.3 26.2 39 33.2 39 42 Z" fill="#9fb0bb" />
          <Path
            d="M19.4 27.2 L24 31.6 L28.6 27.2"
            stroke={accent}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Circle cx={24} cy={16.6} r={8} fill={PAPER} />
        </>
      }
    />
  );
}
