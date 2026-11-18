/**
 * Your Travel Partner Status — one setting for the whole module.
 *
 * It used to be a three-segment bar pinned under the header of every Travel
 * Partner tab: Open | Mute | Close, side by side, on four screens. Three
 * buttons permanently on screen to express one choice that changes about never,
 * and the explanation under them could only ever describe the mode you were
 * already in — so the thing you most needed to read (what the OTHER two do) was
 * the thing it never showed.
 *
 * So it is one control now (owner, 2026-11-18): a pill in the header, beside
 * the settings button, that names the status you are in. Tapping it opens the
 * three choices WITH their explanations, so the decision is made with all three
 * descriptions in front of you rather than one at a time.
 *
 * It is still one value — `travelMateProfiles.inboxMode` — and it still governs
 * the whole module: the rules (likes) and the chat callables (messages, pushes)
 * are what enforce it, exactly as before. Nothing about the backend changed;
 * this is the same switch with one hand on it instead of three.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';
import { useInboxMode, type InboxMode } from '../hooks/travelMateCommunity';

const MODES: { key: InboxMode; label: string; blurb: string; hint: string }[] = [
  {
    key: 'open',
    label: 'Open',
    blurb: 'Anyone can like or message you, and your phone tells you when they do.',
    hint: 'Pick this when you are looking for travel partners.',
  },
  {
    key: 'mute',
    label: 'Mute',
    blurb: 'People can still find you, like you and message you — your phone just stays quiet.',
    hint: 'Pick this when you are busy but still want the messages waiting for you.',
  },
  {
    key: 'closed',
    label: 'Close',
    blurb: 'Nobody can like or message you, and you are taken out of the deck. Your profile and your chats are kept.',
    hint: 'Pick this when you want a break. Nothing is deleted.',
  },
];

const tint = (key: InboxMode) =>
  key === 'open' ? colors.primary : key === 'mute' ? '#f59e0b' : colors.danger;

/**
 * The header pill. Sits immediately left of the settings button on every
 * Travel Partner screen — same control, same place, whichever tab you are on.
 */
export function InboxModeBar() {
  const [mode, setMode] = useInboxMode();
  const [open, setOpen] = useState(false);
  // `MODES[0]` is Open, which is also what an absent inboxMode means — so a
  // value we do not recognise shows the same thing the backend would do.
  const current = MODES.find((m) => m.key === mode) ?? MODES[0]!;

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          s.pill,
          { borderColor: tint(current.key) },
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Your Travel Partner status: ${current.label}`}
        accessibilityHint="Change who can reach you across Travel Partner"
      >
        <View style={[s.dot, { backgroundColor: tint(current.key) }]} />
        <Text style={[s.pillTxt, { color: tint(current.key) }]} numberOfLines={1}>
          {current.label}
        </Text>
        {/* A caret, drawn with text rather than an arrow glyph — the arrow
            characters render as the wrong character on some handsets here. */}
        <Text style={s.caret}>▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(false)}>
          {/* Swallows the tap so pressing the sheet does not close it. */}
          <Pressable style={s.sheet} onPress={() => {}}>
            <Text style={s.sheetTitle}>Your Travel Partner Status</Text>
            <Text style={s.sheetSub}>
              One setting for the whole of Travel Partner — your profile, the feed, groups and
              your messages.
            </Text>

            {MODES.map((m) => {
              const on = m.key === mode;
              return (
                <Pressable
                  key={m.key}
                  style={[s.row, on && { borderColor: tint(m.key), backgroundColor: `${tint(m.key)}14` }]}
                  onPress={() => {
                    setMode(m.key);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${m.label}. ${m.blurb}`}
                >
                  <View style={[s.rowDot, { backgroundColor: tint(m.key) }]} />
                  <View style={{ flex: 1 }}>
                    <View style={s.rowHead}>
                      <Text style={[s.rowLabel, on && { color: tint(m.key) }]}>{m.label}</Text>
                      {on ? <Text style={[s.now, { color: tint(m.key) }]}>NOW</Text> : null}
                    </View>
                    <Text style={s.rowBlurb}>{m.blurb}</Text>
                    <Text style={s.rowHint}>{m.hint}</Text>
                  </View>
                </Pressable>
              );
            })}

            <Pressable style={s.close} onPress={() => setOpen(false)} accessibilityRole="button">
              <Text style={s.closeTxt}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = themed(() => StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: colors.surface,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillTxt: { fontSize: 12.5, fontWeight: '900' },
  caret: { fontSize: 10, color: colors.muted, marginTop: 1 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: 20,
    paddingBottom: 32,
    gap: 10,
  },
  sheetTitle: { fontSize: 19, fontWeight: '900', color: colors.text },
  sheetSub: { fontSize: 12.5, fontWeight: '600', color: colors.muted, lineHeight: 18, marginBottom: 4 },

  row: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
  },
  rowDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 15, fontWeight: '900', color: colors.text },
  now: { fontSize: 9.5, fontWeight: '900', letterSpacing: 0.7 },
  rowBlurb: { fontSize: 12.5, fontWeight: '600', color: colors.muted, lineHeight: 18, marginTop: 2 },
  rowHint: { fontSize: 11.5, fontWeight: '700', color: colors.text, opacity: 0.75, marginTop: 4 },

  close: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20, marginTop: 2 },
  closeTxt: { fontSize: 14, fontWeight: '800', color: colors.muted },
}));
