/**
 * "You'd pay this much on inDrive or Yango. Here it's this."
 *
 * Riders on this market already do the comparison by hand — open inDrive, read
 * the price, open Yango, read that one, pick the cheaper. This panel does it
 * for them on the screen where they are already standing.
 *
 * What it will not do is invent a number. The competitor figures come from rate
 * cards fitted to fares someone actually observed, and the panel renders only
 * when there is a fresh, well-sampled card for this city and vehicle class.
 * With no data there is no panel — see src/lib/marketRates.ts for why that is
 * the only defensible behaviour here.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { colors } from '../config';
import { themed } from '../theme';
import { COMPETITOR_LABELS, type Competitor, type MarketComparison } from '../lib/marketRates';

interface Props {
  comparison: MarketComparison | null;
  disclaimer: string;
  /** Opens the "seen a different price?" sheet. Omit to hide the link. */
  onReport?: (competitor: Competitor, quotedFare: number) => Promise<void> | void;
}

export function MarketCompare({ comparison, disclaimer, onReport }: Props) {
  const [reportOpen, setReportOpen] = useState(false);
  const [which, setWhich] = useState<Competitor>('indrive');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  // No verified rates for this city and class → no panel. Deliberately silent:
  // an empty space says less than a number we cannot stand behind.
  if (!comparison?.available || !comparison.cheapest) return null;

  const { competitors, cheapest, velocityFare, savings, savingsPct, guaranteeMet } = comparison;

  async function submitReport() {
    const value = Math.round(Number(amount));
    if (!onReport || !Number.isFinite(value) || value <= 0) return;
    setSaving(true);
    try {
      await onReport(which, value);
      setSent(true);
      setTimeout(() => { setReportOpen(false); setSent(false); setAmount(''); }, 1200);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Text style={styles.head}>THE SAME TRIP, ELSEWHERE</Text>
        {guaranteeMet && savingsPct != null && savingsPct > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeTxt}>{savingsPct}% LESS</Text>
          </View>
        ) : null}
      </View>

      {competitors.map((c) => {
        const isCheapest = c.competitor === cheapest.competitor;
        return (
          <View key={c.competitor} style={styles.row}>
            <View style={styles.rowLeft}>
              <Text style={styles.rival}>{c.label}</Text>
              <Text style={styles.tier} numberOfLines={1}>{c.competitorClass}</Text>
            </View>
            <Text style={[styles.rivalFare, isCheapest && styles.rivalFareCheapest]}>
              ~PKR {c.fare.toLocaleString()}
            </Text>
          </View>
        );
      })}

      <View style={[styles.row, styles.usRow]}>
        <View style={styles.rowLeft}>
          <Text style={styles.us}>Velocity</Text>
          <Text style={styles.tier}>This ride</Text>
        </View>
        <Text style={styles.usFare}>PKR {velocityFare.toLocaleString()}</Text>
      </View>

      {guaranteeMet && savings != null && savings > 0 ? (
        <Text style={styles.saving}>
          You keep PKR {savings.toLocaleString()} against the cheaper of them.
        </Text>
      ) : (
        // The promise did not hold for this trip — most often a short ride where
        // the driver floor sits above the target. Saying so beats a badge that
        // quietly disappears and leaves the rider wondering.
        <Text style={styles.noGuarantee}>
          On a trip this short our driver minimum sits above the usual discount, so this one is
          close to the market rather than under it.
        </Text>
      )}

      <Text style={styles.disclaimer}>{disclaimer}</Text>

      {onReport ? (
        <Pressable onPress={() => setReportOpen(true)} hitSlop={8}>
          <Text style={styles.reportLink}>Seen a different price? Tell us →</Text>
        </Pressable>
      ) : null}

      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setReportOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {sent ? (
              <Text style={styles.thanks}>Thanks — that goes straight to our pricing desk.</Text>
            ) : (
              <>
                <Text style={styles.sheetTitle}>What were you quoted?</Text>
                <Text style={styles.sheetBody}>
                  For this same trip, right now. Real numbers are what keep the comparison above
                  honest.
                </Text>

                <View style={styles.pickRow}>
                  {(Object.keys(COMPETITOR_LABELS) as Competitor[]).map((c) => (
                    <Pressable
                      key={c}
                      style={[styles.pick, which === c && styles.pickOn]}
                      onPress={() => setWhich(c)}
                    >
                      <Text style={[styles.pickTxt, which === c && styles.pickTxtOn]}>
                        {COMPETITOR_LABELS[c]}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.inputRow}>
                  <Text style={styles.inputPrefix}>PKR</Text>
                  <TextInput
                    value={amount}
                    onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoFocus
                  />
                </View>

                <Pressable
                  style={[styles.send, (!amount || saving) && styles.sendOff]}
                  disabled={!amount || saving}
                  onPress={submitReport}
                >
                  <Text style={styles.sendTxt}>{saving ? 'Sending…' : 'Send'}</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  head: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.muted,
  },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeTxt: { fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 0.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLeft: { flex: 1 },
  rival: { fontSize: 15, fontWeight: '700', color: colors.text },
  tier: { fontSize: 11, color: colors.muted, marginTop: 1 },
  rivalFare: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  rivalFareCheapest: { color: colors.text },

  usRow: { borderBottomWidth: 0, paddingTop: 10 },
  us: { fontSize: 16, fontWeight: '900', color: colors.primary },
  usFare: { fontSize: 22, fontWeight: '900', color: colors.primary },

  saving: { fontSize: 13, fontWeight: '600', color: colors.text },
  noGuarantee: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  disclaimer: { fontSize: 11, color: colors.muted, lineHeight: 15 },
  reportLink: { fontSize: 12, fontWeight: '700', color: colors.primary, paddingTop: 2 },

  // ── Report sheet ──
  backdrop: {
    flex: 1,
    backgroundColor: '#0009',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.background,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sheetBody: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  thanks: { fontSize: 15, fontWeight: '700', color: colors.primary, textAlign: 'center', paddingVertical: 12 },

  pickRow: { flexDirection: 'row', gap: 8 },
  pick: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pickOn: { borderColor: colors.primary, backgroundColor: colors.glassStrong },
  pickTxt: { fontSize: 14, fontWeight: '700', color: colors.muted },
  pickTxtOn: { color: colors.primary },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  inputPrefix: { fontSize: 15, fontWeight: '700', color: colors.muted },
  input: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text, paddingVertical: 10 },

  send: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendOff: { opacity: 0.5 },
  sendTxt: { fontSize: 15, fontWeight: '800', color: '#000' },
}));
