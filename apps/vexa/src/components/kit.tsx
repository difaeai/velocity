/**
 * The pieces every feature screen is built from. All glass, all animated:
 * nothing here appears without a fade, a rise or a draw.
 */
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useEnter } from '../anim';
import { C, R } from '../theme';
import { GmailMark, GoogleMark, InstagramMark, MetaMark, TiktokMark, WhatsappMark, YoutubeMark } from './BrandMarks';
import Glass from './Glass';
import { CheckIcon, CloseIcon, PlusIcon, RefreshIcon, WifiOffIcon } from './Icons';
import type { Channel } from '../store';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const SCREEN = Dimensions.get('window');

/* ───────────────────────── brand marks ───────────────────────── */

export function PlatformMark({ k, size = 18 }: { k: Channel; size?: number }) {
  if (k === 'instagram') return <InstagramMark size={size} />;
  if (k === 'facebook') return <MetaMark size={size} />;
  if (k === 'tiktok') return <TiktokMark size={size} />;
  if (k === 'youtube') return <YoutubeMark size={size} />;
  if (k === 'whatsapp') return <WhatsappMark size={size} />;
  if (k === 'gmail') return <GmailMark size={size} />;
  return <GoogleMark size={size} />;
}

export function MarkRow({ list, size = 16 }: { list: Channel[]; size?: number }) {
  return (
    <View style={st.markRow}>
      {list.map((k) => (
        <PlatformMark key={k} k={k} size={size} />
      ))}
    </View>
  );
}

/* ───────────────────────── small bits ───────────────────────── */

export type Tone = 'lime' | 'green' | 'dim' | 'warn' | 'bad';

const TONE: Record<Tone, { bg: string; fg: string }> = {
  lime: { bg: 'rgba(195,255,55,0.16)', fg: C.lime },
  green: { bg: 'rgba(43,224,122,0.16)', fg: C.green },
  dim: { bg: 'rgba(255,255,255,0.08)', fg: C.textDim },
  warn: { bg: 'rgba(255,194,75,0.16)', fg: '#FFC24B' },
  bad: { bg: 'rgba(255,122,122,0.16)', fg: '#FF7A7A' },
};

export function Tag({ text, tone = 'dim' }: { text: string; tone?: Tone }) {
  const t = TONE[tone];
  return (
    <View style={[st.tag, { backgroundColor: t.bg }]}>
      <Text style={[st.tagText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

export function SectionTitle({ text, right }: { text: string; right?: React.ReactNode }) {
  return (
    <View style={st.sectionRow}>
      <Text style={st.section}>{text}</Text>
      {right}
    </View>
  );
}

/** Fade-and-rise wrapper for list rows, so a list arrives one row at a time. */
export function Stagger({ index = 0, children, style }: { index?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const enter = useEnter(60 + Math.min(index, 12) * 55, { y: 16 });
  return <Animated.View style={[style, enter]}>{children}</Animated.View>;
}

/* ───────────────────────── buttons ───────────────────────── */

type BtnKind = 'primary' | 'ghost' | 'danger';

export function Btn({
  label,
  icon,
  onPress,
  kind = 'primary',
  busy,
  full,
  small,
  disabled,
  style,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  kind?: BtnKind;
  busy?: boolean;
  full?: boolean;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });
  const to = (v: number) =>
    Animated.timing(press, { toValue: v, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();

  const dead = disabled || busy;
  const fg = kind === 'primary' ? '#0A1206' : kind === 'danger' ? '#FF7A7A' : C.text;

  return (
    <Animated.View style={[full && { alignSelf: 'stretch' }, { transform: [{ scale }] }, style]}>
      <Pressable
        onPress={dead ? undefined : onPress}
        onPressIn={() => !dead && to(1)}
        onPressOut={() => to(0)}
        style={[
          st.btn,
          small && st.btnSmall,
          kind === 'primary' && st.btnPrimary,
          kind !== 'primary' && st.btnGhost,
          kind === 'danger' && st.btnDanger,
          dead && { opacity: 0.55 },
        ]}
      >
        {busy ? <Spinner size={16} color={fg} /> : icon}
        <Text style={[st.btnText, small && { fontSize: 13 }, { color: fg }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function IconBtn({
  children,
  onPress,
  size = 36,
  tone,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  size?: number;
  tone?: 'lime' | 'bad';
}) {
  return (
    <Glass
      style={[
        { width: size, height: size },
        tone === 'lime' && { backgroundColor: 'rgba(195,255,55,0.1)' },
        tone === 'bad' && { backgroundColor: 'rgba(255,122,122,0.1)' },
      ]}
      radius={size / 2}
      onPress={onPress}
    >
      <View style={st.center}>{children}</View>
    </Glass>
  );
}

/** The floating + button: it breathes until you press it. */
export function Fab({ onPress, label = 'New' }: { onPress: () => void; label?: string }) {
  const t = useRef(new Animated.Value(0)).current;
  const enter = useEnter(380, { y: 24, scale: 0.7 });

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  const halo = t.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.5] });
  const grow = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });

  return (
    <Animated.View style={[st.fabWrap, enter]}>
      <Animated.View style={[st.fabHalo, { opacity: halo, transform: [{ scale: grow }] }]} />
      <Pressable onPress={onPress} style={({ pressed }) => [st.fab, pressed && { transform: [{ scale: 0.94 }] }]}>
        <PlusIcon size={20} />
        <Text style={st.fabText}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/* ───────────────────────── inputs ───────────────────────── */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  lines = 4,
  keyboard,
  prefix,
  suffix,
  style,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  lines?: number;
  keyboard?: 'default' | 'number-pad' | 'phone-pad' | 'email-address';
  prefix?: string;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [on, setOn] = useState(false);
  return (
    <View style={[st.fieldWrap, style]}>
      {label ? <Text style={st.fieldLabel}>{label}</Text> : null}
      <Glass style={st.field} radius={R.md} lit={on}>
        <View style={st.fieldInner}>
          {prefix ? <Text style={st.fieldFix}>{prefix}</Text> : null}
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onFocus={() => setOn(true)}
            onBlur={() => setOn(false)}
            placeholder={placeholder}
            placeholderTextColor={C.textFaint}
            keyboardType={keyboard ?? 'default'}
            multiline={multiline}
            style={[st.input, multiline && { height: lines * 19, textAlignVertical: 'top' }]}
          />
          {suffix ? <Text style={st.fieldFix}>{suffix}</Text> : null}
        </View>
      </Glass>
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(t, { toValue: value ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, t]);

  const x = t.interpolate({ inputRange: [0, 1], outputRange: [3, 25] });
  const bg = t.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.14)', 'rgba(195,255,55,0.85)'] });

  return (
    <Pressable onPress={() => onChange(!value)} hitSlop={8}>
      <Animated.View style={[st.toggle, { backgroundColor: bg }]}>
        <Animated.View style={[st.knob, { transform: [{ translateX: x }] }]} />
      </Animated.View>
    </Pressable>
  );
}

/** A row with a label and a switch. */
export function ToggleRow({
  label,
  sub,
  value,
  onChange,
  icon,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <Glass style={st.listRow} radius={R.md}>
      <View style={st.listInner}>
        {icon ? <View style={st.rowIcon}>{icon}</View> : null}
        <View style={{ flex: 1 }}>
          <Text style={st.rowLabel}>{label}</Text>
          {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
        </View>
        <Toggle value={value} onChange={onChange} />
      </View>
    </Glass>
  );
}

/** One row of a list: icon, label, sub, and whatever belongs on the right. */
export function Row({
  icon,
  label,
  sub,
  right,
  onPress,
  lit,
  index,
}: {
  icon?: React.ReactNode;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  lit?: boolean;
  index?: number;
}) {
  return (
    <Stagger index={index} style={st.rowSpace}>
      <Glass style={st.listRow} radius={R.md} lit={lit} onPress={onPress}>
        <View style={st.listInner}>
          {icon ? <View style={st.rowIcon}>{icon}</View> : null}
          <View style={{ flex: 1 }}>
            <Text style={st.rowLabel}>{label}</Text>
            {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
          </View>
          {right}
        </View>
      </Glass>
    </Stagger>
  );
}

/** Pill tabs with a highlight that slides between them. */
export function Segment<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ key: T; label: string }>;
  value: T;
  onChange: (k: T) => void;
}) {
  const [w, setW] = useState(0);
  const t = useRef(new Animated.Value(0)).current;
  const at = Math.max(0, items.findIndex((i) => i.key === value));

  useEffect(() => {
    Animated.spring(t, { toValue: at, useNativeDriver: true, friction: 9, tension: 70 }).start();
  }, [at, t]);

  const cell = w / Math.max(1, items.length);
  const x = t.interpolate({
    inputRange: items.map((_, i) => i),
    outputRange: items.map((_, i) => i * cell),
  });

  return (
    <Glass style={st.segment} radius={R.pill}>
      <View style={st.segmentInner} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 ? (
          <Animated.View style={[st.segmentPill, { width: cell, transform: [{ translateX: x }] }]} />
        ) : null}
        {items.map((i) => (
          <Pressable key={i.key} style={st.segmentCell} onPress={() => onChange(i.key)}>
            <Text style={[st.segmentText, i.key === value && st.segmentTextOn]} numberOfLines={1}>
              {i.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Glass>
  );
}

/** Tap-to-choose chips. `multi` lets more than one stay on. */
export function Chips({
  items,
  on,
  onToggle,
  icons,
}: {
  items: string[];
  on: string[];
  onToggle: (v: string) => void;
  icons?: Record<string, React.ReactNode>;
}) {
  return (
    <View style={st.chipRow}>
      {items.map((i) => {
        const live = on.includes(i);
        return (
          <Glass key={i} style={st.chip} radius={R.pill} lit={live} onPress={() => onToggle(i)}>
            <View style={st.chipInner}>
              {icons?.[i]}
              <Text style={[st.chipText, live && { color: C.lime, fontWeight: '800' }]}>{i}</Text>
              {live ? <CheckIcon size={13} /> : null}
            </View>
          </Glass>
        );
      })}
    </View>
  );
}

/* ───────────────────────── loading & failure ───────────────────────── */

/** The indeterminate bar that rides the top of a loading screen. */
export function LoadingBar({ active }: { active: boolean }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1150, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, t]);

  if (!active) return null;

  const x = t.interpolate({ inputRange: [0, 1], outputRange: [-140, SCREEN.width] });

  return (
    <View style={st.loadBar}>
      <Animated.View style={[st.loadBarRun, { transform: [{ translateX: x }] }]}>
        <LinearGradient
          colors={['rgba(195,255,55,0)', C.lime, 'rgba(195,255,55,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/** A grey block that shimmers while the real thing is on its way. */
export function Skeleton({ h = 14, w = '100%', radius = 8, style }: { h?: number; w?: ViewStyle['width']; radius?: number; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);

  const x = t.interpolate({ inputRange: [0, 1], outputRange: [-120, 320] });

  return (
    <View style={[{ height: h, width: w, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/** Three shimmering card outlines — the standard first paint. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Glass key={i} style={st.skelCard} radius={R.md}>
          <View style={st.skelInner}>
            <Skeleton h={40} w={40} radius={12} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton h={12} w="62%" />
              <Skeleton h={10} w="88%" />
            </View>
          </View>
        </Glass>
      ))}
    </View>
  );
}

export function Spinner({ size = 20, color = C.lime }: { size?: number; color?: string }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);

  const spin = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }] }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.14)" strokeWidth={2.6} fill="none" />
        <Path d="M12 3a9 9 0 0 1 9 9" stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

/** "Slow connection" — shows itself when a wait outlasts 1.3 seconds. */
export function SlowNote({ visible, line = 'Slow connection — still fetching' }: { visible: boolean; line?: string }) {
  if (!visible) return null;
  return (
    <Stagger style={{ marginBottom: 10 }}>
      <Glass style={st.note} radius={R.md}>
        <View style={st.noteInner}>
          <WifiOffIcon size={18} />
          <Text style={st.noteText}>{line}</Text>
          <Spinner size={15} color="#FFC24B" />
        </View>
      </Glass>
    </Stagger>
  );
}

export function ErrorNote({ onRetry, line = 'Could not reach Vexa. Check your connection.' }: { onRetry: () => void; line?: string }) {
  return (
    <Stagger>
      <Glass style={st.note} radius={R.md} lit>
        <View style={st.errInner}>
          <WifiOffIcon size={22} color="#FF7A7A" />
          <Text style={st.errText}>{line}</Text>
          <Btn label="Try again" icon={<RefreshIcon size={16} color="#0A1206" />} onPress={onRetry} small />
        </View>
      </Glass>
    </Stagger>
  );
}

export function Empty({
  icon,
  title,
  line,
  cta,
  onCta,
}: {
  icon?: React.ReactNode;
  title: string;
  line: string;
  cta?: string;
  onCta?: () => void;
}) {
  const enter = useEnter(80, { y: 18, scale: 0.94 });
  return (
    <Animated.View style={[st.empty, enter]}>
      <Glass style={{ alignSelf: 'stretch' }} radius={R.xl}>
        <View style={st.emptyInner}>
          {icon ? <View style={st.emptyIcon}>{icon}</View> : null}
          <Text style={st.emptyTitle}>{title}</Text>
          <Text style={st.emptyLine}>{line}</Text>
          {cta && onCta ? <Btn label={cta} onPress={onCta} small style={{ marginTop: 4 }} /> : null}
        </View>
      </Glass>
    </Animated.View>
  );
}

/** Bars that jump while Vexa is talking. */
export function Waveform({ live, height = 24, color = C.lime }: { live: boolean; height?: number; color?: string }) {
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.3))).current;

  useEffect(() => {
    if (!live) {
      bars.forEach((b) => b.setValue(0.3));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 260 + i * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.3, duration: 260 + i * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars, live]);

  return (
    <View style={[st.wave, { height }]}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[st.waveBar, { height: height - 4, backgroundColor: color, transform: [{ scaleY: b }] }]}
        />
      ))}
    </View>
  );
}

/** The dots Vexa thinks with. */
export function TypingDots() {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 3, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);

  return (
    <View style={st.dots}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={[
            st.dot,
            {
              opacity: t.interpolate({
                inputRange: [i - 0.6, i, i + 0.6, i + 1, 3],
                outputRange: [0.25, 1, 0.25, 0.25, 0.25],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

/* ───────────────────────── numbers & charts ───────────────────────── */

/** A round progress bar that draws itself on mount. */
export function Ring({
  pct,
  size = 86,
  stroke = 7,
  label,
  sub,
  color = C.lime,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  label?: string;
  sub?: string;
  color?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const draw = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.timing(draw, { toValue: 1, duration: 1200, delay: 140, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    a.start();
    return () => a.stop();
  }, [draw, pct]);

  const offset = draw.interpolate({ inputRange: [0, 1], outputRange: [circ, circ * (1 - Math.min(1, pct)) ] });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.1)" strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={st.ringText}>
        {label ? <Text style={[st.ringLabel, { fontSize: size * 0.22 }]}>{label}</Text> : null}
        {sub ? <Text style={st.ringSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** A straight progress bar that fills to a share, with a shimmer running it. */
export function Meter({ pct, color = C.lime, h = 7 }: { pct: number; color?: string; h?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1000, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    const loop = Animated.loop(Animated.timing(shine, { toValue: 1, duration: 1900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t, shine, pct]);

  const w = t.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${Math.round(Math.min(1, pct) * 100)}%`] });
  const x = shine.interpolate({ inputRange: [0, 1], outputRange: [-70, 260] });

  return (
    <View style={[st.meter, { height: h, borderRadius: h / 2 }]}>
      <Animated.View style={{ width: w, height: '100%', borderRadius: h / 2, backgroundColor: color }} />
      <Animated.View style={[st.meterShine, { transform: [{ translateX: x }] }]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/** Counts up to the number instead of just being it. */
export function CountUp({
  value,
  prefix = '',
  suffix = '',
  style,
  duration = 900,
  decimals = 0,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  duration?: number;
  /** ROAS and the like are 3.4, not 3. */
  decimals?: number;
}) {
  const [n, setN] = useState(0);

  useEffect(() => {
    const t = new Animated.Value(0);
    const id = t.addListener(({ value: v }) => setN(v * value));
    Animated.timing(t, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => t.removeListener(id);
  }, [value, duration]);

  return (
    <Text style={style}>
      {prefix}
      {n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </Text>
  );
}

export function Stat({
  label,
  value,
  delta,
  prefix,
  suffix,
  index,
  decimals,
}: {
  label: string;
  value: number;
  delta?: string;
  prefix?: string;
  suffix?: string;
  index?: number;
  decimals?: number;
}) {
  return (
    <Stagger index={index} style={{ flex: 1 }}>
      <Glass style={{ flex: 1 }} radius={R.md}>
        <View style={st.statInner}>
          <Text style={st.statLabel}>{label}</Text>
          <CountUp value={value} prefix={prefix} suffix={suffix} decimals={decimals} style={st.statValue} />
          {delta ? <Text style={st.statDelta}>{delta}</Text> : null}
        </View>
      </Glass>
    </Stagger>
  );
}

/** Bars that grow out of the floor. */
export function Bars({ data, labels, height = 96, color = C.lime }: { data: number[]; labels?: string[]; height?: number; color?: string }) {
  const t = useRef(new Animated.Value(0)).current;
  const max = Math.max(1, ...data);

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 950, delay: 120, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [t, data]);

  return (
    <View>
      <View style={[st.bars, { height }]}>
        {data.map((d, i) => (
          <View key={i} style={st.barCell}>
            <Animated.View
              style={{
                width: '62%',
                borderRadius: 6,
                backgroundColor: i === data.length - 1 ? color : 'rgba(195,255,55,0.34)',
                height: t.interpolate({ inputRange: [0, 1], outputRange: [2, Math.max(3, (d / max) * height)] }),
              }}
            />
          </View>
        ))}
      </View>
      {labels ? (
        <View style={st.barLabels}>
          {labels.map((l, i) => (
            <Text key={i} style={st.barLabel}>
              {l}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** The named steps of a job, ticking off one by one. */
export function Steps({ steps, at }: { steps: string[]; at: number }) {
  return (
    <View style={{ gap: 9 }}>
      {steps.map((s, i) => {
        const done = i < at;
        const live = i === at;
        return (
          <View key={s} style={st.stepRow}>
            <View style={[st.stepDot, done && st.stepDotDone, live && st.stepDotLive]}>
              {done ? <CheckIcon size={12} color="#0A1206" /> : live ? <Spinner size={13} /> : null}
            </View>
            <Text style={[st.stepText, (done || live) && { color: C.text }]}>{s}</Text>
          </View>
        );
      })}
    </View>
  );
}

/* ───────────────────────── sheets, dialogs, toasts ───────────────────────── */

/**
 * A glass sheet off the bottom. `full` makes it a page — what the editors and
 * the detail views use, so a push still feels like a push.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  full,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  const [shown, setShown] = useState(open);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setShown(true);
      Animated.spring(t, { toValue: 1, useNativeDriver: true, friction: 11, tension: 64 }).start();
    } else if (shown) {
      Animated.timing(t, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        ({ finished }) => finished && setShown(false),
      );
    }
  }, [open, shown, t]);

  if (!shown) return null;

  const y = t.interpolate({ inputRange: [0, 1], outputRange: [SCREEN.height * (full ? 0.9 : 0.6), 0] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>
        <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[st.sheet, full ? st.sheetFull : st.sheetHalf, { transform: [{ translateY: y }] }]}>
        <BlurView intensity={52} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={st.sheetTint} pointerEvents="none" />
        <View style={st.sheetRim} pointerEvents="none" />

        <KeyboardAvoidingView
          behavior={RNPlatform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={st.grab} />
          <View style={st.sheetHead}>
            <Text style={st.sheetTitle}>{title}</Text>
            <View testID="sheet-close">
              <IconBtn size={32} onPress={onClose}>
                <CloseIcon size={16} />
              </IconBtn>
            </View>
          </View>
          <ScrollView
            contentContainerStyle={st.sheetBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </View>
  );
}

export function Confirm({
  open,
  title,
  line,
  cta = 'Yes, do it',
  danger,
  onCancel,
  onConfirm,
  busy,
}: {
  open: boolean;
  title: string;
  line: string;
  cta?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(t, { toValue: open ? 1 : 0, useNativeDriver: true, friction: 10, tension: 90 }).start();
  }, [open, t]);

  if (!open) return null;

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <View style={[StyleSheet.absoluteFill, st.center]}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: t }]}>
        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={onCancel} />
      </Animated.View>

      <Animated.View style={{ opacity: t, transform: [{ scale }], width: '84%' }}>
        <Glass style={{ alignSelf: 'stretch' }} radius={R.xl} lit>
          <View style={st.dialog}>
            <Text style={st.dialogTitle}>{title}</Text>
            <Text style={st.dialogLine}>{line}</Text>
            <View style={st.dialogBtns}>
              <Btn label="Cancel" kind="ghost" onPress={onCancel} small style={{ flex: 1 }} />
              <Btn
                label={cta}
                kind={danger ? 'danger' : 'primary'}
                onPress={onConfirm}
                busy={busy}
                small
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </Glass>
      </Animated.View>
    </View>
  );
}

/** `const [toast, say] = useToast()` — drop `toast` at the end of the screen. */
export function useToast(): [React.ReactNode, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const t = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    t.setValue(0);
    Animated.spring(t, { toValue: 1, useNativeDriver: true, friction: 10, tension: 80 }).start();
    timer.current = setTimeout(() => {
      Animated.timing(t, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => finished && setText(null));
    }, 2100);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const node = text ? (
    <Animated.View
      pointerEvents="none"
      style={[
        st.toast,
        { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] },
      ]}
    >
      <Glass style={{ alignSelf: 'center' }} radius={R.pill} lit>
        <View style={st.toastInner}>
          <CheckIcon size={16} />
          <Text style={st.toastText}>{text}</Text>
        </View>
      </Glass>
    </Animated.View>
  ) : null;

  return [node, say];
}

/* ───────────────────────── page scaffold ───────────────────────── */

/** The scroll body every feature screen sits in. */
export function Page({ children, bottom = 26 }: { children: React.ReactNode; bottom?: number }) {
  return (
    <ScrollView
      contentContainerStyle={[st.page, { paddingBottom: bottom }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/** The line of copy under a screen's title. */
export function Lede({ text }: { text: string }) {
  const enter = useEnter(40, { y: 10 });
  return <Animated.Text style={[st.lede, enter]}>{text}</Animated.Text>;
}

const st = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { paddingHorizontal: 16, paddingTop: 10 },
  lede: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },

  markRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  tag: { borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3 },
  tagText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  section: { color: C.textFaint, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: R.pill,
  },
  btnSmall: { paddingVertical: 9, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: C.lime },
  btnGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)' },
  btnDanger: { borderColor: 'rgba(255,122,122,0.4)', backgroundColor: 'rgba(255,122,122,0.08)' },
  btnText: { fontSize: 14.5, fontWeight: '800' },

  fabWrap: { position: 'absolute', right: 18, bottom: 18, alignItems: 'center', justifyContent: 'center' },
  fabHalo: { position: 'absolute', width: 120, height: 48, borderRadius: 24, backgroundColor: 'rgba(195,255,55,0.3)' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.lime,
    borderRadius: R.pill,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  fabText: { color: '#0A1206', fontSize: 14.5, fontWeight: '900' },

  fieldWrap: { marginBottom: 12 },
  fieldLabel: { color: C.textDim, fontSize: 11.5, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  field: { alignSelf: 'stretch' },
  fieldInner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 11 },
  fieldFix: { color: C.textDim, fontSize: 13.5, fontWeight: '700' },
  input: { flex: 1, color: C.text, fontSize: 14, padding: 0, minHeight: 20 },

  toggle: { width: 48, height: 27, borderRadius: 14, justifyContent: 'center' },
  knob: { width: 21, height: 21, borderRadius: 11, backgroundColor: '#07100B' },

  rowSpace: { marginBottom: 8 },
  listRow: { alignSelf: 'stretch', marginBottom: 0 },
  listInner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 13 },
  rowIcon: { width: 34, alignItems: 'center' },
  rowLabel: { color: C.text, fontSize: 14, fontWeight: '700' },
  rowSub: { color: C.textDim, fontSize: 11.5, marginTop: 3, lineHeight: 16 },

  segment: { alignSelf: 'stretch' },
  segmentInner: { flexDirection: 'row', padding: 4 },
  segmentPill: { position: 'absolute', top: 4, bottom: 4, borderRadius: R.pill, backgroundColor: 'rgba(195,255,55,0.16)', borderWidth: 1, borderColor: 'rgba(195,255,55,0.4)' },
  segmentCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  segmentText: { color: C.textDim, fontSize: 12.5, fontWeight: '700' },
  segmentTextOn: { color: C.lime, fontWeight: '900' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {},
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  chipText: { color: C.text, fontSize: 12.5, fontWeight: '600' },

  loadBar: { height: 3, alignSelf: 'stretch', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)' },
  loadBarRun: { position: 'absolute', top: 0, bottom: 0, width: 140 },

  skelCard: { alignSelf: 'stretch' },
  skelInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },

  note: { alignSelf: 'stretch' },
  noteInner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, paddingVertical: 10 },
  noteText: { color: '#FFC24B', fontSize: 12, fontWeight: '700', flex: 1 },
  errInner: { alignItems: 'center', gap: 10, padding: 18 },
  errText: { color: C.text, fontSize: 13.5, fontWeight: '600', textAlign: 'center', lineHeight: 19 },

  empty: { marginTop: 18, alignItems: 'center' },
  emptyInner: { alignItems: 'center', gap: 8, padding: 24 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: 'rgba(120,255,140,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyTitle: { color: C.text, fontSize: 16.5, fontWeight: '800', textAlign: 'center' },
  emptyLine: { color: C.textDim, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },

  dots: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.lime },

  wave: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  waveBar: { width: 3, borderRadius: 2 },

  ringText: { position: 'absolute', alignItems: 'center' },
  ringLabel: { color: C.text, fontWeight: '900' },
  ringSub: { color: C.textDim, fontSize: 10, marginTop: 1 },

  meter: { alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  meterShine: { position: 'absolute', top: 0, bottom: 0, width: 64 },

  statInner: { padding: 13, gap: 4 },
  statLabel: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  statValue: { color: C.text, fontSize: 19, fontWeight: '900' },
  statDelta: { color: C.green, fontSize: 10.5, fontWeight: '700' },

  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  barCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
  barLabels: { flexDirection: 'row', gap: 6, marginTop: 6 },
  barLabel: { flex: 1, textAlign: 'center', color: C.textFaint, fontSize: 9.5, fontWeight: '700' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: C.lime, borderColor: C.lime },
  stepDotLive: { borderColor: C.lime },
  stepText: { color: C.textFaint, fontSize: 13, fontWeight: '600', flex: 1 },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  sheetHalf: { maxHeight: '78%' },
  sheetFull: { top: 44 },
  sheetTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(6,12,9,0.72)' },
  sheetRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  grab: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', marginTop: 9 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12 },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '900', flex: 1 },
  sheetBody: { padding: 18, paddingBottom: 34 },

  dialog: { padding: 20, gap: 8 },
  dialogTitle: { color: C.text, fontSize: 17, fontWeight: '900' },
  dialogLine: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  dialogBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },

  toast: { position: 'absolute', left: 0, right: 0, bottom: 108, alignItems: 'center' },
  toastInner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 11 },
  toastText: { color: C.text, fontSize: 13, fontWeight: '700' },
});
