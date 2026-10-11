/**
 * Why this fare is what it is — shown next to the price, or not at all.
 * ----------------------------------------------------------------------------
 * Two things can move a fare off the published rate card, and a rider paying
 * more is owed the reason in the same place as the number rather than in a help
 * article:
 *
 *  · The PEAK FACTOR, when there are more riders than free cars nearby. Capped
 *    at 1.25x by the pricing engine, which is why this says how high it can go:
 *    "Busy right now" with no ceiling attached invites the suspicion that it is
 *    unbounded, which is the reputation surge pricing has everywhere else.
 *  · FUEL. A government price revision moves per-km rates the same morning it
 *    takes effect, and naming the pump price makes the claim checkable against
 *    the board on the forecourt.
 *
 * RENDERS NOTHING in the ordinary case. `label` is null at a factor of 1.0 and
 * the fuel note is null when fuel has not moved the rate — which is most fares,
 * most of the time, in most places. A badge reassuring somebody that prices are
 * normal is noise on the one screen where they are deciding whether to spend
 * money.
 *
 * English, as every string in this app is. Urdu arrives through i18n/ur.ts.
 * ----------------------------------------------------------------------------
 */
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';

export interface PriceNoticeProps {
  /** Straight from `getFareEstimate.peak` or `getPricingSnapshot.peak`. */
  peak?: { multiplier: number; label: string | null; maxMultiplier: number } | null;
  /** Straight from the same call's `fuel`. */
  fuel?: { note: string | null } | null;
  /**
   * Shared rides sell a fixed price, so the booking screen can suppress the
   * peak line there and keep the fuel one — fuel is a cost that moved, not a
   * fare that might still move.
   */
  hidePeak?: boolean;
}

export function PriceNotice({ peak, fuel, hidePeak }: PriceNoticeProps) {
  const peakLabel = hidePeak ? null : (peak?.label ?? null);
  const fuelNote = fuel?.note ?? null;
  if (!peakLabel && !fuelNote) return null;

  const pct = peak ? Math.round((peak.multiplier - 1) * 100) : 0;

  return (
    <View style={styles.wrap}>
      {peakLabel && (
        <View style={styles.row}>
          <Text style={styles.icon}>📈</Text>
          <View style={styles.body}>
            <Text style={styles.title}>
              {peakLabel}
              {pct > 0 ? ` · +${pct}%` : ''}
            </Text>
            {/* The ceiling, stated. This is the sentence that distinguishes a
                capped peak factor from surge pricing as riders know it. */}
            {peak && peak.maxMultiplier > 1 && (
              <Text style={styles.detail}>
                Fares here never rise more than {Math.round((peak.maxMultiplier - 1) * 100)}%.
              </Text>
            )}
          </View>
        </View>
      )}
      {fuelNote && (
        <View style={styles.row}>
          <Text style={styles.icon}>⛽</Text>
          <View style={styles.body}>
            <Text style={styles.detail}>{fuelNote}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  icon: { fontSize: 14, marginTop: 1 },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 13, fontWeight: '800' },
  detail: { color: colors.muted, fontSize: 11, marginTop: 2, lineHeight: 15 },
}));
