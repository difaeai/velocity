import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../config';

const WINDOW_SECONDS = 5 * 60; // 5 minutes

interface Props {
  arrivedAt?: { seconds: number; nanoseconds: number } | null;
  role: 'driver' | 'passenger';
}

export function ArrivalCountdown({ arrivedAt, role }: Props) {
  const [secsLeft, setSecsLeft] = useState<number>(WINDOW_SECONDS);

  useEffect(() => {
    // Wait until Firestore delivers the server timestamp before counting down.
    // Without this guard, every tick would reset the timer to 5:00.
    if (!arrivedAt) return;

    function tick() {
      const elapsed = Math.floor(Date.now() / 1000) - arrivedAt!.seconds;
      setSecsLeft(Math.max(0, WINDOW_SECONDS - elapsed));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [arrivedAt]);

  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const display = `${mins}:${String(secs).padStart(2, '0')}`;
  const expired = secsLeft === 0;
  const urgent  = secsLeft <= 60;
  const syncing = !arrivedAt;

  if (syncing) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>⏳ Starting timer…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, expired && styles.wrapExpired, urgent && !expired && styles.wrapUrgent]}>
      <View style={styles.row}>
        <Text style={styles.icon}>{expired ? '⏰' : '⏱️'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, urgent && styles.labelUrgent]}>
            {role === 'driver'
              ? expired ? 'Boarding window expired' : 'Passenger boarding window'
              : expired ? 'Pickup window expired' : 'Time to reach your driver'}
          </Text>
          <Text style={styles.sub}>
            {role === 'driver'
              ? expired ? 'You may now leave if passenger has not boarded.' : 'Wait for the passenger to board.'
              : expired ? 'Please contact your driver.' : 'Your driver is waiting at the pickup point.'}
          </Text>
        </View>
        <Text style={[styles.timer, urgent && styles.timerUrgent, expired && styles.timerExpired]}>
          {expired ? '0:00' : display}
        </Text>
      </View>
      {!expired && (
        <View style={styles.trackBg}>
          <View style={[styles.trackFill, {
            width: `${(secsLeft / WINDOW_SECONDS) * 100}%` as `${number}%`,
            backgroundColor: urgent ? '#ef4444' : colors.primary,
          }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: `${colors.primary}12`,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: `${colors.primary}50`,
    padding: 14,
    gap: 10,
    marginBottom: 10,
  },
  wrapUrgent: {
    backgroundColor: '#ef444415',
    borderColor: '#ef444480',
  },
  wrapExpired: {
    backgroundColor: '#3f3f3f18',
    borderColor: '#3f3f3f50',
  },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon:  { fontSize: 22 },
  label: { fontSize: 13, fontWeight: '800', color: colors.primary },
  labelUrgent: { color: '#ef4444' },
  sub:   { fontSize: 11, color: colors.muted, marginTop: 2 },
  timer: { fontSize: 28, fontWeight: '900', color: colors.primary, fontVariant: ['tabular-nums'] },
  timerUrgent:  { color: '#ef4444' },
  timerExpired: { color: colors.muted },
  trackBg:   { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2 },
});
