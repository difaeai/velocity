import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';

/**
 * A one-line news ticker that runs under the home header, right below the
 * language switch and the pickup pill.
 *
 * It exists to say the one thing about "Earn with Velocity" that riders never
 * work out on their own: a normal user — not only a driver — can bring people
 * onto Velocity and earn from the rides they take. Both sides count. Drivers
 * they sign up, and passengers they sign up.
 *
 * A strip rather than a card, because this is standing information, not a task.
 * It costs one line over the map, it can't push the booking controls down, and
 * it never has to be dismissed.
 *
 * The messages scroll right-to-left forever. Two identical copies of the line
 * sit side by side and the whole row is translated by exactly one copy's width;
 * when the first copy has fully left, the second is sitting precisely where it
 * started, so the loop has no visible seam and no dead gap.
 */

/** Each message is one whole literal so `Text` can translate it as a sentence. */
const MESSAGES = [
  'Bring people onto Velocity and they become your fleet — you earn from every ride they take.',
  'Not just drivers: passengers you invite earn for you too.',
  'Invite drivers, invite riders, keep earning — your fares never change.',
];

/** Pixels per second. Slow enough to read at a glance, quick enough to cycle. */
const SPEED = 45;

export function NewsTicker({ onPress }: { onPress?: () => void }) {
  const [copyWidth, setCopyWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (copyWidth <= 0) return;

    x.setValue(0);
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: -copyWidth,
        duration: (copyWidth / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [copyWidth]);

  // Re-measured whenever the language flips, which is the one thing that
  // changes how wide a copy is while the screen is open.
  const copy = (measured: boolean) => (
    <View
      style={styles.copy}
      onLayout={measured ? (e) => setCopyWidth(e.nativeEvent.layout.width) : undefined}
    >
      {MESSAGES.map((m) => (
        <View key={m} style={styles.item}>
          <Text style={styles.bullet}>◆</Text>
          <Text style={styles.message}>{m}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <Pressable
      style={styles.track}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel="Earn with Velocity — build your own fleet of drivers and passengers"
    >
      <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]}>
        {copy(true)}
        {copy(false)}
      </Animated.View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  track: {
    height: 26,
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
  },
  // Absolute so the row is free to be wider than the strip that clips it.
  row: { position: 'absolute', left: 0, flexDirection: 'row', alignItems: 'center' },
  copy: { flexDirection: 'row', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 26 },
  bullet: { fontSize: 7, color: colors.primary },
  message: { fontSize: 11, fontWeight: '700', color: '#d8dfd2' },
}));
