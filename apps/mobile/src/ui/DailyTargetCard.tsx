/**
 * "16 pool rides today → no commission." The driver's daily target, on the
 * home screen.
 *
 * WHAT THE DRIVER IS BEING OFFERED. Not a cash bonus — the day itself. Sixteen
 * pool rides and the whole day costs them nothing; short of it, the day owes 5%
 * of the cash they took and it lands at midnight. So the headline here is a
 * countdown to a free day, and the card says what it is worth in rupees using
 * the driver's OWN figures: 5% of what they have actually taken today. A
 * percentage means nothing at 9pm; "PKR 340 you keep" means everything.
 *
 * THE WORD IS **BONUS** for anything they earn; "commission" is only ever what
 * they pay Velocity. The two must never be called the same thing in front of a
 * driver — one is money coming to them and the other is money leaving. The
 * stored field is still `commissionCredit` (see the note in
 * domain/dailyTarget.ts), which is deliberate and invisible here: no label in
 * this file says "credit".
 *
 * Three jobs, in this order of importance:
 *
 * 1. **Say what is left.** Not "progress: 60%" — "6 more pool rides". A driver
 *    deciding whether to take one more fare at 9pm needs a count, not a bar.
 * 2. **Say what is BLOCKING it.** The target has conditions beyond the ride
 *    count (a fare floor, enough different passengers, enough total fare), and
 *    a driver who finds out at midnight that their day did not qualify has been
 *    cheated by the interface, not by the rule. Every unmet condition is named
 *    here while there is still time to fix it.
 * 3. **Say what happens if they miss it.** The 5% is not a surprise we spring at
 *    midnight. It is on the card all day, next to the way out of it.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';
import type { DailyTargetProgress } from '../domain/dailyTarget';

export function DailyTargetCard({
  progress,
  bonusBalance,
  /** Cash taken today, for "what this day is worth" in real rupees. */
  todayCashFare = 0,
  /** The commission rate, as a fraction. */
  rate = 0.05,
  onPress,
}: {
  progress: DailyTargetProgress;
  /** Unspent bonus across every day, from the driver document. */
  bonusBalance: number;
  todayCashFare?: number;
  rate?: number;
  onPress?: () => void;
}) {
  if (!progress.enabled) return null;

  const pct = Math.min(100, Math.round((progress.rides / Math.max(1, progress.target)) * 100));
  const done = progress.granted || progress.met;
  const rideWord = progress.poolOnly ? 'pool rides' : 'rides';
  // What the day is worth, in the driver's own money. Once the day is waived
  // this is what they kept; before that it is what it will cost them.
  const atStake = Math.round(todayCashFare * rate);
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
        <Text style={styles.bonus}>
          {progress.bonus > 0 ? `PKR ${progress.bonus.toLocaleString()}` : '0% commission'}
        </Text>
      </View>

      <Text style={styles.headline}>
        {done
          ? "Today's rides are commission-free"
          : progress.ridesToGo === 1
            ? `1 more ${progress.poolOnly ? 'pool ride' : 'ride'} to go`
            : `${progress.ridesToGo} more ${rideWord} to go`}
      </Text>

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }, done && styles.barFillDone]} />
      </View>
      <Text style={styles.counter}>
        {progress.rides} of {progress.target} {rideWord} today
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

      {/* The deal, in rupees, using today's own takings. */}
      {done ? (
        <Text style={styles.waived}>
          ✓ You keep the whole day
          {atStake > 0 ? ` — PKR ${atStake.toLocaleString()} of commission cancelled` : ''}
          {progress.bonus > 0 ? `, plus a PKR ${progress.bonus.toLocaleString()} bonus` : ''}
        </Text>
      ) : (
        <Text style={styles.warn}>
          {atStake > 0
            ? `Finish the target and PKR ${atStake.toLocaleString()} of commission on today's cash is cancelled. Miss it and it is due at midnight.`
            : `Finish the target and today costs you no commission at all. Miss it and ${Math.round(rate * 100)}% of today's cash is due at midnight.`}
        </Text>
      )}

      {/* The bonus balance, and what it is. Never called a wallet, never
          implied to be withdrawable. Hidden when there is none — an empty row
          labelled "your bonus" just raises a question nobody can answer. */}
      {bonusBalance > 0 ? (
        <View style={styles.creditRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.creditLabel}>Your bonus</Text>
            <Text style={styles.creditHint}>
              Pays your commission automatically · not withdrawable as cash
            </Text>
          </View>
          <Text style={styles.creditValue}>PKR {bonusBalance.toLocaleString()}</Text>
        </View>
      ) : null}
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
    waived: { fontSize: 12.5, fontWeight: '800', color: colors.primary, marginTop: 8, lineHeight: 18 },
    warn: { fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 17 },
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
