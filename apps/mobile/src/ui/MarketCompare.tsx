/**
 * "You'd pay this much on inDrive or Yango. Here it's this."
 *
 * Riders on this market already do the comparison by hand — open inDrive, read
 * the price, open Yango, read that one, pick the cheaper. This panel does it
 * for them without their leaving the screen.
 *
 * Two shapes. `map` is a narrow translucent strip that floats over the route,
 * where it is visible the whole time the rider is choosing and costs the
 * booking sheet no height at all. `sheet` is the full-width card, for anywhere
 * the panel has room to be read rather than glanced at.
 *
 * What neither will do is invent a number. The competitor figures come from rate
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

/**
 * The little square that stands in for a competitor's logo.
 *
 * Deliberately NOT their real trademark. Two reasons, and the second is the
 * one that decided it: we do not ship their artwork, and inDrive's brand green
 * is within a few degrees of our own lime. Painting a rival's row in the colour
 * this app uses for "ours" would make the one thing the card exists to say —
 * that number is theirs, this number is ours — the hardest thing to read on it.
 *
 * So every rival wears the same neutral grey monogram and Velocity keeps the
 * lime to itself. If we ever license the real marks, this is the only component
 * that has to change.
 */
function BrandMark({ competitor, size = 16 }: { competitor: Competitor; size?: number }) {
  const glyph = competitor === 'indrive' ? 'iD' : 'Y';
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: Math.round(size * 0.3) },
      ]}
    >
      <Text style={[styles.markTxt, { fontSize: size * (glyph.length > 1 ? 0.5 : 0.62) }]}>
        {glyph}
      </Text>
    </View>
  );
}

interface Props {
  comparison: MarketComparison | null;
  disclaimer: string;
  /** Opens the "seen a different price?" sheet. Omit to hide the link. */
  onReport?: (competitor: Competitor, quotedFare: number) => Promise<void> | void;
  /** 'map' floats over the route; 'sheet' is the full-width card. */
  variant?: 'map' | 'sheet';
  /**
   * Admins only. A rider gets no panel and no explanation when there are no
   * rates — that is correct. Somebody testing the app needs to be able to tell
   * an unconfigured city from a broken feature without leaving the screen.
   */
  showEmptyReason?: boolean;
  emptyReason?: string | null;
}

export function MarketCompare({
  comparison, disclaimer, onReport, variant = 'sheet', showEmptyReason, emptyReason,
}: Props) {
  const [reportOpen, setReportOpen] = useState(false);
  const [which, setWhich] = useState<Competitor>('indrive');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);
  // The floating strip opens for the qualifiers. Collapsed is the honest
  // default: on a map, height is the thing the rider is paying for.
  const [open, setOpen] = useState(false);

  const onMap = variant === 'map';

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

  const reportModal = (
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
  );

  // No verified rates for this city and class → no panel. Deliberately silent
  // for riders: an empty space says less than a number we cannot stand behind.
  if (!comparison?.available || !comparison.cheapest) {
    if (!showEmptyReason) return null;
    return (
      <View style={[styles.diagCard, onMap && styles.diagCardMap]}>
        <Text style={styles.diagHead}>ADMIN · NO COMPARISON</Text>
        <Text style={styles.diagBody}>
          {emptyReason ?? 'No competitor rates for this city.'}
        </Text>
        <Text style={styles.diagFoot}>Riders see nothing at all until a card exists.</Text>
      </View>
    );
  }

  const { competitors, cheapest, velocityFare, savings, savingsPct, guaranteeMet } = comparison;

  /* ── The strip that floats over the route ──
       Three lines and a badge. It used to be nine, and at that height it ran
       from under the route card all the way into the booking sheet, sitting on
       the map it was supposed to annotate. Everything a rider needs to act on
       is in the collapsed state — their price, our price, how much less — and
       the qualifiers that only matter once (what you keep, that it is an
       estimate, how to correct it) live behind a tap. ── */
  if (onMap) {
    return (
      <View style={styles.mapCard}>
        <Pressable onPress={() => setOpen((v) => !v)} hitSlop={6}>
          <View style={styles.mapHeadRow}>
            <Text style={styles.mapHead}>SAME TRIP</Text>
            {guaranteeMet && savingsPct != null && savingsPct > 0 ? (
              <View style={styles.mapBadge}>
                <Text style={styles.mapBadgeTxt}>−{savingsPct}%</Text>
              </View>
            ) : null}
            <Text style={styles.mapChevron}>{open ? '⌃' : '⌄'}</Text>
          </View>

          {competitors.map((c) => (
            <View key={c.competitor} style={styles.mapRow}>
              <BrandMark competitor={c.competitor} size={15} />
              <Text style={styles.mapRival} numberOfLines={1}>{c.label}</Text>
              <Text style={styles.mapRivalFare}>{c.fare.toLocaleString()}</Text>
            </View>
          ))}

          <View style={styles.mapUsRow}>
            <View style={styles.mapUsMark} />
            <Text style={styles.mapUs}>Velocity</Text>
            <Text style={styles.mapUsFare}>{velocityFare.toLocaleString()}</Text>
          </View>
        </Pressable>

        {open ? (
          <View style={styles.mapMore}>
            {guaranteeMet && savings != null && savings > 0 ? (
              <Text style={styles.mapSaving}>You keep PKR {savings.toLocaleString()}</Text>
            ) : (
              <Text style={styles.mapSavingMuted}>
                Close to the market on a trip this short
              </Text>
            )}
            <Text style={styles.mapNote}>Estimated, not a live quote</Text>
            {onReport ? (
              <Pressable onPress={() => setReportOpen(true)} hitSlop={8}>
                <Text style={styles.mapReport}>Saw another price?</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {reportModal}
      </View>
    );
  }

  /* ── The full-width card ── */
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
            <BrandMark competitor={c.competitor} size={22} />
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
        <View style={styles.usMark} />
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

      {reportModal}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  /* ── Floating strip over the route ──
       Narrow AND short on purpose. It sits beside the road line, not on top of
       it, and it must clear the booking sheet at its tallest snap point — which
       the nine-line version did not. Every size below is chosen so the whole
       strip is read in one glance, without becoming the screen. */
  mapCard: {
    width: 152,
    backgroundColor: colors.glassPanel,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  mapHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  mapHead: {
    flex: 1,
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.9,
    color: colors.muted,
  },
  mapChevron: { fontSize: 11, fontWeight: '900', color: colors.muted, lineHeight: 12 },

  /* Rival rows: mark, name, struck fare. The strike is what makes a bare
     number legible as "what you would have paid". */
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  mapRival: { flex: 1, fontSize: 11.5, fontWeight: '600', color: colors.muted },
  mapRivalFare: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textDecorationLine: 'line-through',
  },

  /* Our row. No divider rule above it — the lime dot and the type size already
     separate it, and a hairline was one more horizontal line on a map full of
     them. */
  mapUsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  mapUsMark: { width: 15, height: 15, borderRadius: 5, backgroundColor: colors.primary },
  mapUs: { flex: 1, fontSize: 11.5, fontWeight: '800', color: colors.text },
  mapUsFare: { fontSize: 19, fontWeight: '900', color: colors.primary, lineHeight: 22 },

  mapBadge: {
    backgroundColor: colors.primary,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  mapBadgeTxt: { fontSize: 9.5, fontWeight: '900', color: '#000' },

  /* Behind the tap. */
  mapMore: { marginTop: 7, paddingTop: 7, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  mapSaving: { fontSize: 10.5, fontWeight: '700', color: colors.text, lineHeight: 14 },
  mapSavingMuted: { fontSize: 10, color: colors.muted, lineHeight: 13 },
  mapNote: { fontSize: 9, color: colors.muted },
  mapReport: { fontSize: 10.5, fontWeight: '700', color: colors.primary, marginTop: 2 },

  /* Stand-in for a competitor logo — see BrandMark. */
  mark: {
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markTxt: { fontWeight: '900', color: colors.muted, includeFontPadding: false },

  diagCardMap: {
    width: 178,
    backgroundColor: colors.glassPanel,
    marginTop: 0,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  // Admin-only diagnostic. Deliberately drab — it is a maintenance note on a
  // rider's screen, and it should never read as part of the product.
  diagCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    padding: 12,
    gap: 4,
    marginTop: 4,
  },
  diagHead: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8, color: colors.muted },
  diagBody: { fontSize: 12.5, color: colors.text, lineHeight: 17 },
  diagFoot: { fontSize: 11, color: colors.muted },

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
  usMark: { width: 22, height: 22, borderRadius: 7, backgroundColor: colors.primary },
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
