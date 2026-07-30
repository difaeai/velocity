import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { colors } from '../config';
import { themed } from '../theme';

/**
 * Shown on the passenger home only when the live map came back genuinely empty —
 * no online cars and nobody else running the app within the search radius.
 *
 * An empty map is normally a dead end for a rider. It is also the single most
 * honest moment to pitch "Earn with Velocity": the person is standing in a real
 * gap in our coverage, they can see the gap on the map above this card, and
 * filling it is exactly what a fleet partner does. So this is a nudge with
 * evidence behind it rather than a banner ad.
 *
 * Two doors, because the pitch is genuinely both: drive yourself, and bring
 * riders in. That is what "create your fleet" means in the partner program —
 * partners earn a share of Velocity's commission on the rides their people take,
 * never a cut of anyone's fare.
 *
 * Deliberately an inline callout and not a modal: a popup fired on every cold
 * start in a quiet area would be the most annoying thing in the app, and it
 * would sit on top of "Where to?" — the one thing a rider actually came for.
 * The ✕ hides it for the session; it returns next launch if the area is still
 * empty.
 */
export function QuietAreaCard({
  onEarn,
  onDrive,
  onDismiss,
}: {
  onEarn: () => void;
  onDrive: () => void;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        style={styles.close}
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Text style={styles.icon}>📍</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>It&apos;s quiet around you</Text>
          <Text style={styles.sub}>No cars online and nobody else on Velocity nearby right now.</Text>
        </View>
      </View>

      {/* One string, not a sentence stitched from styled fragments: the <Text>
          wrapper translates whole literals, and fragments make poor Urdu. */}
      <Text style={styles.body}>
        That&apos;s an opening, not a dead end. Register as a driver and invite riders in your area —
        build your own Velocity fleet and earn from every ride they take.
      </Text>

      <View style={styles.actions}>
        <Pressable style={styles.primaryBtn} onPress={onEarn}>
          <Text style={styles.primaryBtnText}>Earn with Velocity →</Text>
        </Pressable>
        <Pressable style={styles.ghostBtn} onPress={onDrive}>
          <Text style={styles.ghostBtnText}>Become a driver</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    backgroundColor: 'rgba(204,255,0,0.07)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    padding: 14,
    paddingRight: 34, // clears the ✕
    gap: 10,
  },
  close: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    zIndex: 2,
  },
  closeText: { fontSize: 11, color: colors.muted, fontWeight: '800' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 16 },
  headerText: { flex: 1 },
  title: { fontSize: 14, fontWeight: '900', color: colors.primary },
  sub: { fontSize: 11, color: colors.muted, marginTop: 2, lineHeight: 15 },

  body: { fontSize: 12, color: '#d8dfd2', lineHeight: 18 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  primaryBtnText: { fontSize: 12, fontWeight: '900', color: '#0b0d0c' },
  ghostBtn: {
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ghostBtnText: { fontSize: 12, fontWeight: '800', color: '#d3e9a6' },
}));
