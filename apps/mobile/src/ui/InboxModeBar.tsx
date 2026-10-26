/**
 * Open | Mute | Close — who can reach you on Travel Partner.
 *
 * Pinned under the header of every Travel Partner tab so the choice is always
 * one tap away. The switch only writes travelMateProfiles.inboxMode; the rules
 * (likes) and the chat callables (messages, pushes) are what enforce it.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';
import { useInboxMode, type InboxMode } from '../hooks/travelMateCommunity';

const MODES: { key: InboxMode; label: string; hint: string }[] = [
  { key: 'open', label: 'Open', hint: 'Anyone can like or message you, and you get notified.' },
  { key: 'mute', label: 'Mute', hint: 'People can still like and message you — no notifications.' },
  { key: 'closed', label: 'Close', hint: 'Nobody can like or message you, and you are out of the deck.' },
];

const tint = (key: InboxMode) =>
  key === 'open' ? colors.primary : key === 'mute' ? '#f59e0b' : colors.danger;

export function InboxModeBar() {
  const [mode, setMode] = useInboxMode();
  const current = MODES.find(m => m.key === mode)!;

  return (
    <View style={s.wrap}>
      <View style={s.bar} accessibilityRole="radiogroup" accessibilityLabel="Who can reach you">
        {MODES.map(m => {
          const on = m.key === mode;
          return (
            <Pressable
              key={m.key}
              style={[s.seg, on && { backgroundColor: `${tint(m.key)}22`, borderColor: tint(m.key) }]}
              onPress={() => setMode(m.key)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityHint={m.hint}
            >
              <View style={[s.dot, { backgroundColor: tint(m.key) }]} />
              <Text style={[s.label, on && { color: tint(m.key) }]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={s.hint} numberOfLines={1}>{current.hint}</Text>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  wrap:  { paddingHorizontal: 16, paddingBottom: 8, gap: 4 },
  bar:   { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  seg:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  dot:   { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 13, fontWeight: '800', color: colors.muted },
  hint:  { fontSize: 11, color: colors.muted, textAlign: 'center' },
}));
