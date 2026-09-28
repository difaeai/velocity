/**
 * Date of birth as three taps: day, month, year.
 *
 * The native calendar was the fiddliest step of signing up. It opens on a month
 * and makes you page backwards, or find the small year header most people never
 * notice, to reach a birthday twenty-odd years ago. Here the three parts sit side
 * by side in one row. Tapping one opens a grid of large buttons, and choosing a
 * value moves straight on to the next part still empty, so a blank row is
 * filled in three taps with nothing to scroll or swipe.
 */
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';
import { daysInMonth, withPart, type BirthDateParts } from '../lib/birthDate';

export { birthDateFromParts, type BirthDateParts } from '../lib/birthDate';

type Part = keyof BirthDateParts;

const ORDER: Part[] = ['day', 'month', 'year'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABEL: Record<Part, string> = { day: 'Day', month: 'Month', year: 'Year' };
const TITLE: Record<Part, string> = { day: 'Pick the day', month: 'Pick the month', year: 'Pick the year' };

function show(part: Part, p: BirthDateParts): string | null {
  const v = p[part];
  if (v === null) return null;
  return part === 'month' ? (MONTHS[v] ?? null) : String(v);
}

export function BirthDatePicker({
  value,
  onChange,
  minYear,
  maxYear,
}: {
  value: BirthDateParts;
  onChange: (next: BirthDateParts) => void;
  /** Oldest year offered. */
  minYear: number;
  /** Newest year offered. */
  maxYear: number;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState<Part | null>(null);

  function pick(part: Part, n: number) {
    const next = withPart(value, part, n);
    onChange(next);
    // On to the next part still empty, so a blank row is three taps.
    setOpen(ORDER.find((p) => next[p] === null) ?? null);
  }

  const lastDay = daysInMonth(value.month, value.year);

  // Newest decade first: most people signing up were born in the last forty
  // years, so their decade is on screen without scrolling.
  const decades: { label: string; years: number[] }[] = [];
  for (let d = Math.floor(maxYear / 10) * 10; d >= Math.floor(minYear / 10) * 10; d -= 10) {
    const years: number[] = [];
    for (let y = d; y < d + 10; y += 1) if (y >= minYear && y <= maxYear) years.push(y);
    if (years.length) decades.push({ label: `${d}s`, years });
  }

  function cell(key: string | number, text: string, selected: boolean, onPress: () => void, cols: number, disabled = false) {
    return (
      <View key={key} style={[styles.cellWrap, { width: `${100 / cols}%` }]}>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected, disabled }}
          style={({ pressed }) => [
            styles.cell,
            selected && styles.cellSelected,
            disabled && styles.cellDisabled,
            pressed && !selected && styles.cellPressed,
          ]}
        >
          <Text style={[styles.cellText, selected && styles.cellTextSelected]}>{text}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <View style={styles.row}>
        {ORDER.map((part) => {
          const text = show(part, value);
          return (
            <Pressable
              key={part}
              onPress={() => setOpen(part)}
              accessibilityRole="button"
              accessibilityLabel={text ? `${LABEL[part]}: ${text}` : TITLE[part]}
              style={[styles.tile, part === 'day' ? styles.tileNarrow : styles.tileWide, text !== null && styles.tileFilled]}
            >
              <Text style={styles.tileLabel}>{LABEL[part]}</Text>
              <View style={styles.tileValueRow}>
                <Text style={text ? styles.tileValue : styles.tilePlaceholder} numberOfLines={1}>
                  {text ?? 'Select'}
                </Text>
                <Text style={styles.tileChevron}>▾</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={open !== null}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setOpen(null)}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(null)} accessibilityLabel="Close" />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{open ? TITLE[open] : ''}</Text>
              <Pressable onPress={() => setOpen(null)} hitSlop={12}>
                <Text style={styles.sheetDone}>Done</Text>
              </Pressable>
            </View>

            {open === 'day' && (
              <View style={styles.grid}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) =>
                  cell(d, String(d), value.day === d, () => pick('day', d), 7, d > lastDay),
                )}
              </View>
            )}

            {open === 'month' && (
              <View style={styles.grid}>
                {MONTHS.map((m, i) => cell(m, m, value.month === i, () => pick('month', i), 3))}
              </View>
            )}

            {open === 'year' && (
              <ScrollView style={{ maxHeight: height * 0.55 }} showsVerticalScrollIndicator={false}>
                {decades.map((dec) => (
                  <View key={dec.label}>
                    <Text style={styles.decade}>{dec.label}</Text>
                    <View style={styles.grid}>
                      {dec.years.map((y) => cell(y, String(y), value.year === y, () => pick('year', y), 5))}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  tile: {
    minHeight: 60,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  tileNarrow: { flex: 1 },
  tileWide: { flex: 1.25 },
  tileFilled: { borderColor: colors.primary },
  tileLabel: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  tileValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  tileValue: { flexShrink: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  tilePlaceholder: { flexShrink: 1, fontSize: 15, color: colors.muted },
  tileChevron: { fontSize: 13, color: colors.muted, marginLeft: 4 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18, paddingHorizontal: 4 },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sheetDone: { fontSize: 16, fontWeight: '800', color: colors.primary },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellWrap: { padding: 4 },
  cell: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cellSelected: { backgroundColor: colors.btnBg, borderColor: colors.btnBg },
  cellPressed: { borderColor: colors.primary },
  cellDisabled: { opacity: 0.25 },
  cellText: { fontSize: 16, fontWeight: '700', color: colors.text },
  cellTextSelected: { color: colors.btnText },
  decade: { fontSize: 13, fontWeight: '800', color: colors.muted, marginTop: 10, marginBottom: 2, marginLeft: 4 },
}));
