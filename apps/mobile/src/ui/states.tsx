/**
 * The states every screen can be in, drawn the same way everywhere:
 *
 *   loading   the shape of what is coming (Skeleton), never a bare spinner
 *   empty     why it is empty, and the one next step
 *   error     what went wrong, whose fault, how to fix — and Try again
 *   no match  the likely typo fixed, and a next search
 *   a field   the mistake at the field, with how to fix it
 *   success   confirmed, reassured, celebrated, and what happens next
 *   network   offline or slow, at the foot of the screen — never over the content
 *
 * Mirrors components/states.tsx in the web app.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View, type DimensionValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../config';
import { isOnline, networkVersion, oldestCall, probe, subscribeNetwork } from '../lib/connection';
import { explainError } from '../lib/explainError';
import { themed } from '../theme';
import { Text } from './Text';

export type StateAction = { label: string; onPress: () => void };

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** One block in the shape of what is coming, breathing gently unless motion is reduced. */
export function Skeleton({
  height = 16,
  width = '100%',
  radius = 8,
}: {
  height?: number;
  width?: DimensionValue;
  radius?: number;
}) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[s.skeleton, { height, width, borderRadius: radius, opacity: reduce ? 0.8 : pulse }]}
    />
  );
}

/** A list that has not arrived yet: rows shaped like the rows that will. */
export function SkeletonRows({ rows = 4, height = 64 }: { rows?: number; height?: number }) {
  return (
    <View accessible accessibilityLabel="Loading" style={s.skeletonWrap}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} radius={14} />
      ))}
    </View>
  );
}

/** One thing that has not arrived yet — a trip, a profile, a post: its picture, its lines, its card. */
export function SkeletonDetail() {
  return (
    <View accessible accessibilityLabel="Loading" style={s.skeletonWrap}>
      <Skeleton height={160} radius={18} />
      <Skeleton height={22} width="60%" />
      <Skeleton height={14} width="85%" />
      <Skeleton height={14} width="70%" />
      <Skeleton height={96} radius={16} />
    </View>
  );
}

function ActionButton({ action }: { action: StateAction }) {
  return (
    <Pressable onPress={action.onPress} style={s.action} accessibilityRole="button" accessibilityLabel={action.label}>
      <Text style={s.actionText}>{action.label}</Text>
    </Pressable>
  );
}

/** Nothing here — why it is empty, and the one thing to do next. */
export function EmptyState({
  icon = '○',
  title,
  why,
  action,
}: {
  icon?: string;
  title: string;
  why: string;
  action?: StateAction;
}) {
  return (
    <View style={s.box}>
      <Text style={s.icon} accessibilityElementsHidden>
        {icon}
      </Text>
      <Text style={s.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={s.body}>{why}</Text>
      {action ? <ActionButton action={action} /> : null}
    </View>
  );
}

/** What went wrong, whose fault it is, how to fix it — and a way to try again. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={[s.box, s.errorBox]} accessibilityRole="alert">
      <Text style={s.icon} accessibilityElementsHidden>
        ⚠️
      </Text>
      <Text style={s.title}>This did not load</Text>
      <Text style={s.body}>{typeof error === 'string' ? error : explainError(error, isOnline())}</Text>
      {onRetry ? <ActionButton action={{ label: 'Try again', onPress: onRetry }} /> : null}
    </View>
  );
}

/** A search that found nothing: the likely typo fixed, and what to search next. */
export function NoResults({
  query,
  suggestion,
  onSuggestion,
  next,
}: {
  query: string;
  suggestion?: string | null;
  onSuggestion?: (s: string) => void;
  next: string;
}) {
  return (
    <View style={s.box}>
      <Text style={s.title}>Nothing matches “{query}”</Text>
      {suggestion && onSuggestion ? (
        <Pressable onPress={() => onSuggestion(suggestion)} accessibilityRole="button" accessibilityLabel={`Search for ${suggestion}`}>
          <Text style={s.body}>
            Did you mean <Text style={s.link}>{suggestion}</Text>?
          </Text>
        </Pressable>
      ) : null}
      <Text style={s.body}>{next}</Text>
    </View>
  );
}

/** The mistake, at the field, with how to fix it. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Text style={s.fieldError} accessibilityRole="alert" accessibilityLiveRegion="polite">
      ⚠ {message}
    </Text>
  );
}

/** Done: confirm it, reassure, celebrate it, then show what happens next. */
export function SuccessState({
  title,
  reassurance,
  next,
  action,
}: {
  title: string;
  reassurance: string;
  next: string;
  action?: StateAction;
}) {
  const reduce = useReduceMotion();
  const pop = useRef(new Animated.Value(reduce ? 1 : 0.3)).current;
  useEffect(() => {
    if (!reduce) Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [reduce, pop]);
  return (
    <View style={[s.box, s.successBox]} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <Animated.Text style={[s.celebrate, { transform: [{ scale: pop }] }]} accessibilityElementsHidden>
        🎉
      </Animated.Text>
      <Text style={s.title}>{title}</Text>
      <Text style={s.reassure}>{reassurance}</Text>
      <Text style={s.body}>
        <Text style={s.bold}>What happens next: </Text>
        {next}
      </Text>
      {action ? <ActionButton action={action} /> : null}
    </View>
  );
}

/** Shown after a call has waited this long; before that a pause is just a pause. */
const SLOW_MS = 4000;

/**
 * Offline or slow, at the foot of every screen. Offline keeps the screen as it
 * was and says what still works; slow shows the real seconds against the call's
 * own limit, so a long wait reads as progress rather than a hang.
 */
export function NetworkNotice() {
  useSyncExternalStore(subscribeNetwork, networkVersion, networkVersion);
  const insets = useSafeAreaInsets();
  const online = isOnline();
  const call = oldestCall();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!call) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [call]);

  const waited = call ? now - call.startedMs : 0;
  if (online && (!call || waited < SLOW_MS)) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[s.notice, { bottom: insets.bottom + 12 }, !online && s.noticeOffline]}
      accessibilityLiveRegion="polite"
    >
      {!online ? (
        <>
          <Text style={s.noticeTitle}>You are offline</Text>
          <Text style={s.noticeBody}>
            What is on screen stays, and your rides and saved places still show. Booking, chat and payments wait until
            you are back.
          </Text>
          <Pressable onPress={() => void probe()} accessibilityRole="button" accessibilityLabel="Check the connection again">
            <Text style={s.noticeLink}>Check again</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={s.noticeTitle}>
            Still working — {Math.round(waited / 1000)}s of up to {Math.round(call!.limitMs / 1000)}s
          </Text>
          <Text style={s.noticeBody}>The connection or our server is slow. Keep the app open.</Text>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.min(100, (waited / call!.limitMs) * 100)}%` }]} />
          </View>
        </>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    skeleton: { backgroundColor: colors.glassStrong },
    // Stretched, because most loading spots are centring containers built for a spinner.
    skeletonWrap: { gap: 12, alignSelf: 'stretch', width: '100%', padding: 16 },
    box: {
      alignItems: 'center',
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderRadius: 18,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.border,
      gap: 6,
    },
    errorBox: { borderStyle: 'solid', borderColor: 'rgba(239,68,68,0.45)' },
    successBox: { borderStyle: 'solid', borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime },
    icon: { fontSize: 30 },
    celebrate: { fontSize: 40 },
    title: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
    reassure: { fontSize: 14, color: colors.text, textAlign: 'center' },
    body: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
    bold: { fontWeight: '800', color: colors.text },
    link: { color: colors.primary, fontWeight: '800', textDecorationLine: 'underline' },
    action: { marginTop: 10, backgroundColor: colors.btnBg, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 18 },
    actionText: { color: colors.btnText, fontWeight: '800', fontSize: 14 },
    fieldError: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 4 },
    notice: {
      position: 'absolute',
      left: 12,
      right: 12,
      backgroundColor: '#1c1f1d',
      borderRadius: 14,
      padding: 12,
      gap: 4,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.12)',
    },
    noticeOffline: { backgroundColor: '#5b2a0a' },
    noticeTitle: { color: '#ffffff', fontWeight: '800', fontSize: 14 },
    noticeBody: { color: 'rgba(255,255,255,0.85)', fontSize: 12, lineHeight: 17 },
    noticeLink: { color: colors.primary, fontWeight: '800', fontSize: 13, marginTop: 2 },
    track: { height: 4, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 6 },
    fill: { height: 4, borderRadius: 4, backgroundColor: '#ccff00' },
  }),
);
