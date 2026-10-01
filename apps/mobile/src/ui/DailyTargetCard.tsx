/**
 * "15 rides today → PKR 2,000." The driver's daily target, on the home screen.
 *
 * Three jobs, in this order of importance:
 *
 * 1. **Say what is left.** Not "progress: 60%" — "6 more rides". A driver
 *    deciding whether to take one more fare at 9pm needs a count, not a bar.
 * 2. **Say what is BLOCKING it.** The target has conditions beyond the ride
 *    count (a fare floor, enough different passengers, enough total fare), and
 *    a driver who finds out at midnight that their day did not qualify has been
 *    cheated by the interface, not by the rule. Every unmet condition is named
 *    here while there is still time to fix it.
 * 3. **Say what the credit is for.** It is not cash and it cannot be withdrawn.
 *    Saying so plainly, every time, is the difference between an incentive and
 *    a complaint — and the wallet is hidden until top-ups launch, so this card
 *    is the only place a driver ever sees this money.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';
import type { DailyTargetProgress } from '../domain/dailyTarget';

export function DailyTargetCard({
  progress,
  credit,
  onPress,
}: {
  progress: DailyTargetProgress;
  /** Unspent credit across every day, from the driver document. */
  credit: number;
  onPress?: () => void;
}) {
  if (!progress.enabled) return null;

  const pct = Math.min(100, Math.round((progress.rides / Math.max(1, progress.target)) * 100));
  const done = progress.granted || progress.met;
  // Everything except the ride count — those are conditions the driver may not
  // know about and the ride count already has the headline.
  const extraBlockers = progress.blockers.filter((b) => b.key !== 'rides');

  return (
    <Pressable
      style={({ pressed }) => [styles.card, done && styles.cardDone, pressed && onPress && { opacity: 0.9 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.topRow}>
        <Text style={styles.label}>{done ? "🎯 Today's target complete" : "🎯 Today's target"}</Text>
        <Text style={styles.bonus}>PKR {progress.bonus.toLocaleString()}</Text>
      </View>

      <Text style={styles.headline}>
        {done
          ? `PKR ${progress.bonus.toLocaleString()} credit earned`
          : progress.ridesToGo === 1
            ? '1 more ride to go'
            : `${progress.ridesToGo} more rides to go`}
      </Text>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }, done && styles.barFillDone]} />
      </View>
      <Text style={styles.counter}>
        {progress.rides} of {progress.target} qualifying rides today
      </Text>

      {/* Conditions beyond the ride count. Named, with the real figures. */}
      {!done && extraBlockers.length > 0 ? (
        <View style={styles.blockers}>
          {extraBlockers.map((b) => (
            <Text key={b.key} style={styles.blockerTxt}>
              • Also needs {b.label} — you have {b.have.toLocaleString()}
            </Text>
          ))}
        </View>
      ) : null}

      {done && progress.commissionWaived ? (
        <Text style={styles.waived}>✓ Today&apos;s rides are commission-free</Text>
      ) : null}

      {/* The credit balance, and what it is. Never called a wallet, never
          implied to be withdrawable. */}
      <View style={styles.creditRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.creditLabel}>Commission credit</Text>
          <Text style={styles.creditHint}>
            Pays your commission automatically · not withdrawable as cash
          </Text>
        </View>
        <Text style={styles.creditValue}>PKR {credit.toLocaleString()}</Text>
      </View>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    cardDone: { borderColor: colors.primary, borderWidth: 1.5 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    label: {
      fontSize: 11,
      fontWeight: '900',
      color: colors.muted,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    bonus: { fontSize: 13, fontWeight: '900', color: colors.primary },
    headline: { fontSize: 19, fontWeight: '900', color: colors.text, marginTop: 6 },
    barTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
      overflow: 'hidden',
      marginTop: 10,
    },
    barFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary + 'cc' },
    barFillDone: { backgroundColor: colors.primary },
    counter: { fontSize: 12, color: colors.muted, marginTop: 6, fontWeight: '600' },
    blockers: { marginTop: 8, gap: 2 },
    blockerTxt: { fontSize: 12, color: colors.muted, lineHeight: 17 },
    waived: { fontSize: 12.5, fontWeight: '800', color: colors.primary, marginTop: 8 },
    creditRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    creditLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
    creditHint: { fontSize: 11, color: colors.muted, marginTop: 1, lineHeight: 15 },
    creditValue: { fontSize: 17, fontWeight: '900', color: colors.primary },
  }),
);
