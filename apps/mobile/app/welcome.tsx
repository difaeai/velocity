import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

import { Text } from '../src/ui/Text';
import { themed } from '../src/theme';

/**
 * Welcome carousel — the first thing a signed-out user sees after the splash.
 * Three full-bleed slides (pool rides / travel partners / earn) with a frosted
 * glass copy card, page dots and a lime Next button. Skip and Get Started both
 * mark the carousel as seen so it only ever shows once per device.
 */
export const WELCOME_SEEN_KEY = 'welcome_carousel_seen';

type Variant = 'ride' | 'mates' | 'earn';

const SLIDES: { key: Variant; title: string; body: string }[] = [
  {
    key: 'ride',
    title: 'Book rides at very low rates',
    body: 'Go with others heading your way and split the fare — the cheapest way to move around the city.',
  },
  {
    key: 'mates',
    title: 'Find your travel partners',
    body: 'Meet people who travel in your area every day, ride together, and make new friends.',
  },
  {
    key: 'earn',
    title: 'Earn with Velocity',
    body: 'Share your code with riders and drivers and earn real money from every ride they take.',
  },
];

/* ─────────────────────────── SVG backdrop scene ─────────────────────────── */

// Deterministic "lit windows" for the skyline buildings.
function windows(bx: number, by: number, bw: number, bh: number, seed: number) {
  const cells: { x: number; y: number; on: boolean; warm: boolean }[] = [];
  const cols = Math.floor((bw - 10) / 14);
  const rows = Math.floor((bh - 14) / 20);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = (seed * 31 + r * 7 + c * 13) % 10;
      cells.push({
        x: bx + 7 + c * 14,
        y: by + 10 + r * 20,
        on: n > 5,
        warm: n === 7,
      });
    }
  }
  return cells;
}

const BUILDINGS = [
  { x: -20, y: 150, w: 90, h: 460, seed: 1 },
  { x: 62, y: 230, w: 66, h: 380, seed: 2 },
  { x: 120, y: 120, w: 80, h: 490, seed: 3 },
  { x: 235, y: 200, w: 70, h: 410, seed: 4 },
  { x: 298, y: 90, w: 95, h: 520, seed: 5 },
];

function Skyline() {
  return (
    <G>
      {BUILDINGS.map((b) => (
        <G key={b.seed}>
          <Rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#111612" />
          {windows(b.x, b.y, b.w, b.h, b.seed).map((w, i) =>
            w.on ? (
              <Rect
                key={i}
                x={w.x}
                y={w.y}
                width={7}
                height={11}
                rx={1}
                fill={w.warm ? '#f59e0b' : '#7dd3c8'}
                opacity={w.warm ? 0.5 : 0.35}
              />
            ) : null,
          )}
        </G>
      ))}
      {/* Neon signboards */}
      <Rect x={30} y={250} width={60} height={34} rx={6} fill="none" stroke="#2dd4bf" strokeWidth={2.5} opacity={0.75} />
      <SvgText x={60} y={273} fontSize={15} fontWeight="bold" fill="#2dd4bf" opacity={0.9} textAnchor="middle">
        FAST
      </SvgText>
      <Rect x={252} y={168} width={54} height={26} rx={5} fill="#3b82f6" opacity={0.45} />
      <Rect x={140} y={190} width={44} height={22} rx={5} fill="#f59e0b" opacity={0.4} />
      <Rect x={318} y={300} width={48} height={26} rx={5} fill="#2dd4bf" opacity={0.35} />
      <Rect x={70} y={380} width={56} height={22} rx={5} fill="#ccff00" opacity={0.28} />
    </G>
  );
}

// Motifs sit around y≈300–500 so they stay visible above the copy card
// (which covers roughly the bottom third of the screen).
function RideMotif() {
  return (
    <G>
      {/* Under-glow */}
      <Ellipse cx={195} cy={498} rx={150} ry={26} fill="url(#glow)" />
      {/* Car body */}
      <Path
        d="M85 480 q8 -34 56 -40 q26 -36 84 -34 q52 2 66 36 q42 8 48 40 l0 16 q0 9 -9 9 l-236 0 q-9 0 -9 -9 z"
        fill="#0a0d08"
        stroke="#ccff00"
        strokeWidth={2.5}
        strokeOpacity={0.85}
      />
      {/* Windshield + window line */}
      <Path d="M150 442 q24 -30 74 -28 q44 2 58 28 z" fill="#1d2b12" stroke="#ccff00" strokeWidth={1.5} strokeOpacity={0.5} />
      {/* Wheels */}
      <Circle cx={140} cy={506} r={22} fill="#05070a" stroke="#ccff00" strokeWidth={2} strokeOpacity={0.8} />
      <Circle cx={140} cy={506} r={7} fill="#ccff00" opacity={0.8} />
      <Circle cx={280} cy={506} r={22} fill="#05070a" stroke="#ccff00" strokeWidth={2} strokeOpacity={0.8} />
      <Circle cx={280} cy={506} r={7} fill="#ccff00" opacity={0.8} />
      {/* Headlight beam */}
      <Rect x={330} y={464} width={38} height={7} rx={3.5} fill="#ccff00" opacity={0.6} />
    </G>
  );
}

function MatesMotif() {
  const person = (cx: number, cy: number, c: string, s: number) => (
    <G>
      <Circle cx={cx} cy={cy} r={22 * s} fill="#0a0d08" stroke={c} strokeWidth={2.5} />
      <Path
        d={`M${cx - 34 * s} ${cy + 66 * s} q0 -38 34 -38 q34 0 34 38 z`}
        fill="#0a0d08"
        stroke={c}
        strokeWidth={2.5}
      />
    </G>
  );
  return (
    <G>
      <Ellipse cx={195} cy={520} rx={140} ry={24} fill="url(#glow)" />
      {person(130, 426, '#2dd4bf', 0.9)}
      {person(260, 426, '#7dd3c8', 0.9)}
      {person(195, 410, '#ccff00', 1.15)}
      {/* Connection arcs */}
      <Path d="M148 388 q47 -34 94 0" fill="none" stroke="#ccff00" strokeWidth={2} strokeOpacity={0.6} strokeDasharray="2 7" strokeLinecap="round" />
    </G>
  );
}

function EarnMotif() {
  const coin = (cx: number, cy: number, r: number) => (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill="#0a0d08" stroke="#ccff00" strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={r - 8} fill="none" stroke="#ccff00" strokeWidth={1.2} strokeOpacity={0.5} />
      <SvgText x={cx} y={cy + r * 0.32} fontSize={r * 0.9} fontWeight="bold" fill="#ccff00" textAnchor="middle">
        ₨
      </SvgText>
    </G>
  );
  return (
    <G>
      <Ellipse cx={195} cy={520} rx={140} ry={24} fill="url(#glow)" />
      {coin(140, 470, 34)}
      {coin(255, 478, 28)}
      {coin(196, 420, 44)}
      {/* Rising arrow */}
      <Path d="M110 380 q60 -36 128 -66 l32 -12" fill="none" stroke="#2dd4bf" strokeWidth={3} strokeLinecap="round" strokeOpacity={0.8} />
      <Path d="M244 294 l30 4 l-12 28 z" fill="#2dd4bf" opacity={0.8} />
    </G>
  );
}

/** Full-bleed night-city scene rendered in SVG — no image assets needed. */
function Scene({ variant }: { variant: Variant }) {
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox="0 0 390 844"
      preserveAspectRatio="xMidYMid slice"
    >
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0e1a1c" />
          <Stop offset="0.45" stopColor="#0b0f0c" />
          <Stop offset="1" stopColor="#050604" />
        </LinearGradient>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#ccff00" stopOpacity={0.5} />
          <Stop offset="1" stopColor="#ccff00" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="cityHaze" cx="50%" cy="30%" r="70%">
          <Stop offset="0" stopColor="#2dd4bf" stopOpacity={0.16} />
          <Stop offset="1" stopColor="#2dd4bf" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id="dim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#000000" stopOpacity={0.25} />
          <Stop offset="0.5" stopColor="#000000" stopOpacity={0.1} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.82} />
        </LinearGradient>
      </Defs>

      <Rect x={0} y={0} width={390} height={844} fill="url(#sky)" />
      <Rect x={0} y={0} width={390} height={500} fill="url(#cityHaze)" />
      <Skyline />

      {/* Road */}
      <Path d="M0 640 L390 610 L390 844 L0 844 Z" fill="#080a07" />
      <Path d="M40 750 L120 720 M180 700 L260 675 M310 662 L370 645" stroke="#ccff00" strokeWidth={4} strokeOpacity={0.35} strokeLinecap="round" strokeDasharray="26 30" />

      {variant === 'ride' ? <RideMotif /> : variant === 'mates' ? <MatesMotif /> : <EarnMotif />}

      {/* Readability dim towards the copy card */}
      <Rect x={0} y={0} width={390} height={844} fill="url(#dim)" />
    </Svg>
  );
}

/* ────────────────────────────── The carousel ────────────────────────────── */

export default function Welcome() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const listRef = useRef<FlatList>(null);
  const [index, setIndex] = useState(0);

  // Tracked from onScroll (not just momentum-end): react-native-web never
  // fires momentum events for programmatic scrolls, so Next would stall.
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.max(0, Math.min(SLIDES.length - 1, Math.round(e.nativeEvent.contentOffset.x / width)));
    if (i !== index) setIndex(i);
  }

  async function finish() {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, '1').catch(() => {});
    router.replace('/auth/sign-in');
  }

  function next() {
    if (index >= SLIDES.length - 1) {
      finish();
    } else {
      listRef.current?.scrollToOffset({ offset: width * (index + 1), animated: true });
    }
  }

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          // Explicit height: a flex:1 slide collapses to zero height inside a
          // horizontal FlatList cell, which throws the absolute card off-screen.
          <View style={{ width, height }}>
            <Scene variant={item.key} />
            {/* Copy card sits just above the static dots + button area */}
            <View style={styles.cardHolder}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardBody}>{item.body}</Text>
              </View>
            </View>
          </View>
        )}
      />

      {/* Static overlay: brand + skip on top, dots + button at the bottom */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topBar} pointerEvents="box-none">
          <Text style={styles.brand}>Velocity</Text>
          <Pressable onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <View style={styles.bottom} pointerEvents="box-none">
          <View style={styles.dots}>
            {SLIDES.map((s, i) => (
              <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />
            ))}
          </View>
          <Pressable style={styles.nextBtn} onPress={next}>
            <Text style={styles.nextText}>{index >= SLIDES.length - 1 ? 'Get Started' : 'Next'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050604' },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 18,
  },
  brand: { fontSize: 28, fontWeight: '900', color: '#ffffff', letterSpacing: 0.3 },
  skip: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },

  cardHolder: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 158,
  },
  card: {
    borderRadius: 26,
    padding: 24,
    backgroundColor: 'rgba(28,32,22,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cardTitle: { fontSize: 29, fontWeight: '900', color: '#ffffff', marginBottom: 10 },
  cardBody: { fontSize: 17, lineHeight: 25, color: 'rgba(255,255,255,0.88)' },

  bottom: { paddingHorizontal: 24, paddingBottom: 20, gap: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { width: 26, borderRadius: 4, backgroundColor: '#ccff00' },

  nextBtn: {
    height: 62,
    borderRadius: 31,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontSize: 20, fontWeight: '800', color: '#0a0d08' },
}));
