/**
 * Today's target as one moving line on the driver home. The full card stays on
 * Earnings, a tap away.
 *
 * The card was four lines tall and sat above the request feed, so the requests
 * a driver is waiting for started at the bottom of the screen. This keeps the
 * one number that matters still, in a ring on the left (rides to go, and the
 * ring fills as they are done), and slides everything else past in one line.
 *
 * It runs RIGHT TO LEFT, like a news ticker (asked for in so many words), so the
 * headline is the first thing to slide in and each short phrase reads in order.
 * With the phone's reduce-motion setting on, the line stands still.
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';
import type { DailyTargetProgress } from '../domain/dailyTarget';

/** Points a second: slow enough to read text that is moving. */
const SPEED = 42;
const RING = 28;
const RING_R = 11;
const RING_C = 2 * Math.PI * RING_R;
const SEPARATOR = '   •   ';

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the line says, most important first. Same facts as DailyTargetCard. */
function phrasesFor(p: DailyTargetProgress, bonusBalance: number, todayCashFare: number, rate: number): string[] {
  // What the day is worth in the driver's own money: 5% of today's cash.
  const atStake = Math.round(todayCashFare * rate);
  if (p.granted || p.met) {
    return [
      "Today's target complete — today's rides are commission-free",
      atStake > 0 ? `PKR ${atStake.toLocaleString()} of commission cancelled` : null,
      p.bonus > 0 ? `plus a PKR ${p.bonus.toLocaleString()} bonus` : null,
    ].filter((s): s is string => s !== null).map(upperFirst);
  }
  const rideWord = p.poolOnly ? 'shared ride' : 'ride';
  return [
    `${p.ridesToGo} more ${rideWord}${p.ridesToGo === 1 ? '' : 's'} to go`,
    `${p.rides} of ${p.target} today`,
    // Conditions beyond the ride count, named with the real figures.
    ...p.blockers
      .filter((b) => b.key !== 'rides')
      .map((b) => `also needs ${b.label} — you have ${b.have.toLocaleString()}`),
    atStake > 0
      ? `finish it and PKR ${atStake.toLocaleString()} of commission is cancelled`
      : 'finish it and today is commission-free',
    `miss it and ${Math.round(rate * 100)}% of today's cash is commission`,
    // The bonus pays each ride's commission as it ends (backend drivers/cycle.ts),
    // and a target day hands all of it back.
    bonusBalance > 0
      ? `commission comes off your PKR ${bonusBalance.toLocaleString()} bonus ride by ride`
      : `unpaid commission is due at midnight`,
  ].filter((s): s is string => s !== null).map(upperFirst);
}

export function DailyTargetTicker({
  progress,
  bonusBalance,
  todayCashFare = 0,
  rate = 0.05,
  onPress,
}: {
  progress: DailyTargetProgress;
  /** Unspent bonus across every day, from the driver document. */
  bonusBalance: number;
  /** Cash taken today, for "what this day is worth" in real rupees. */
  todayCashFare?: number;
  /** The commission rate, as a fraction. */
  rate?: number;
  onPress?: () => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const [lineW, setLineW] = useState(0);
  const [still, setStill] = useState(false);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {});
  }, []);

  // In from the right edge, out past the left one, and round again.
  useEffect(() => {
    if (still || !trackW || !lineW) return;
    x.setValue(trackW);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -lineW,
        duration: ((trackW + lineW) / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [still, trackW, lineW, x]);

  if (!progress.enabled) return null;

  const done = progress.granted || progress.met;
  const phrases = phrasesFor(progress, bonusBalance, todayCashFare, rate);
  const share = done ? 1 : Math.min(1, progress.rides / Math.max(1, progress.target));

  return (
    <Pressable
      style={({ pressed }) => [styles.pill, done && styles.pillDone, pressed && onPress && { opacity: 0.85 }]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={phrases.join('. ')}
      accessibilityHint={onPress ? 'Opens your earnings' : undefined}
    >
      <View style={styles.ring}>
        <Svg width={RING} height={RING}>
          <Circle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={colors.border} strokeWidth={3} fill="none" />
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RING_R}
            stroke={colors.primary}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${RING_C} ${RING_C}`}
            strokeDashoffset={RING_C * (1 - share)}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        </Svg>
        <Text style={styles.ringTxt}>{done ? '✓' : progress.ridesToGo}</Text>
      </View>

      <View
        style={styles.track}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {still ? (
          <Text style={styles.line} numberOfLines={1}>
            {phrases.join(SEPARATOR)}
          </Text>
        ) : (
          <Animated.View style={[styles.runner, { transform: [{ translateX: x }] }]}>
            <Text style={styles.line} numberOfLines={1} onLayout={(e) => setLineW(e.nativeEvent.layout.width)}>
              {phrases.join(SEPARATOR)}
            </Text>
          </Animated.View>
        )}
      </View>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 38,
      borderRadius: 19,
      paddingLeft: 5,
      paddingRight: 12,
      gap: 8,
      backgroundColor: colors.glassLime,
      borderWidth: 1,
      borderColor: colors.glassLimeBorder,
      marginBottom: 8,
    },
    pillDone: { borderColor: colors.primary },
    ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
    ringTxt: { position: 'absolute', fontSize: 11, fontWeight: '900', color: colors.primary },
    track: { flex: 1, height: '100%', overflow: 'hidden', justifyContent: 'center' },
    // Wide enough that the line is never wrapped while it is measured.
    runner: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4000,
      flexDirection: 'row',
      alignItems: 'center',
    },
    line: { fontSize: 13, fontWeight: '700', color: colors.text },
  }),
);
