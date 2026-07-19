/**
 * One incoming ride request in the driver's feed.
 *
 * Layout mirrors the driver-app spec: passenger identity on the left (avatar,
 * name, rating, how long ago), then distance-to-pickup, the fare, the pickup →
 * drop-off pair, and finally the payment method + car category chips.
 *
 * Swiping the row to the RIGHT (or tapping the ⋮ handle) reveals the action
 * panel: Complain · Hide · Choose on map. The swipe is a plain PanResponder —
 * react-native-gesture-handler is not a dependency of this app and adding a
 * native module would invalidate the current dev/production builds.
 */
import { useMemo } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '../config';
import { themed } from '../theme';
import { formatDistance } from '../lib/geo';
import { timeAgo } from '../lib/timeAgo';
import { RIDE_TYPE_LABELS } from '../domain/types';
import type { OpenRequest } from '../hooks/driver';

/** Horizontal travel (px) that counts as "swiped open". */
const OPEN_THRESHOLD = 56;

interface Props {
  request: OpenRequest;
  /** Only one card's action panel is open at a time — the list owns that state. */
  expanded: boolean;
  onToggleActions: () => void;
  onOpen: () => void;
  onComplain: () => void;
  onHide: () => void;
  onChooseOnMap: () => void;
  /** Commission lock — the driver can look but not accept. */
  locked?: boolean;
}

function ActionIcon({ d, color }: { d: string; color: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24">
      <Path d={d} fill={color} />
    </Svg>
  );
}

const ICONS = {
  complain: 'M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
  hide: 'M12 7a5 5 0 0 1 5 5c0 .64-.13 1.25-.36 1.81l2.92 2.92A11.8 11.8 0 0 0 23 12a11.83 11.83 0 0 0-11-7.5c-1.2 0-2.35.18-3.44.5l2.16 2.16c.4-.1.83-.16 1.28-.16zM2.71 3.16 1.3 4.57l2.48 2.48A11.75 11.75 0 0 0 1 12a11.83 11.83 0 0 0 11 7.5c1.52 0 2.97-.29 4.3-.82l3.13 3.13 1.41-1.41L2.71 3.16zM12 17a5 5 0 0 1-5-5c0-.69.15-1.34.4-1.93l1.57 1.57A2.5 2.5 0 0 0 12 14.5c.13 0 .26-.01.39-.03l1.57 1.57c-.6.29-1.26.46-1.96.46z',
  map: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
};

function KebabHandle({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} style={styles.kebab} accessibilityLabel="Request actions">
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path
          d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
          fill={colors.muted}
        />
      </Svg>
    </Pressable>
  );
}

export function RequestCard({
  request: r,
  expanded,
  onToggleActions,
  onOpen,
  onComplain,
  onHide,
  onChooseOnMap,
  locked,
}: Props) {
  const dx = useMemo(() => new Animated.Value(0), []);

  // Rebuilt whenever the parent hands down a fresh callback. React Native
  // dispatches touch events through the view's *current* props, so swapping the
  // handler object between renders — even mid-gesture — is safe.
  const pan = useMemo(() => {
    const settle = (to: number) =>
      Animated.spring(dx, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 18 }).start();

    return PanResponder.create({
      // Claim the gesture only once it is clearly horizontal, so the list's
      // vertical scroll still wins for ordinary drags.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_e, g) => {
        // Right-swipe only, with resistance past the threshold.
        const x = Math.max(0, Math.min(g.dx, OPEN_THRESHOLD + (g.dx - OPEN_THRESHOLD) * 0.2));
        dx.setValue(Number.isFinite(x) ? x : 0);
      },
      onPanResponderRelease: (_e, g) => {
        settle(0);
        if (g.dx >= OPEN_THRESHOLD) onToggleActions();
      },
      onPanResponderTerminate: () => settle(0),
    });
  }, [dx, onToggleActions]);

  if (expanded) {
    return (
      <View style={styles.actionPanel}>
        <KebabHandle onPress={onToggleActions} />
        <View style={styles.actionRow}>
          <Pressable style={styles.action} onPress={onComplain}>
            <ActionIcon d={ICONS.complain} color={colors.text} />
            <Text style={styles.actionLabel}>Complain</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={onHide}>
            <ActionIcon d={ICONS.hide} color={colors.text} />
            <Text style={styles.actionLabel}>Hide</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={onChooseOnMap}>
            <ActionIcon d={ICONS.map} color={colors.text} />
            <Text style={styles.actionLabel}>Choose on{'\n'}map</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const rating = r.passengerRating ?? 5;
  const ratingCount = r.passengerRatingCount ?? 0;
  const name = r.passengerName?.trim() || 'Passenger';
  const paymentLabel = r.paymentMethod === 'wallet' ? 'Wallet' : 'Cash';

  return (
    <Animated.View style={[styles.card, { transform: [{ translateX: dx }] }]} {...pan.panHandlers}>
      <Pressable style={styles.cardInner} onPress={onOpen} disabled={locked}>
        {/* Passenger */}
        <View style={styles.who}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.ratingRow}>
            <Text style={styles.star}>★</Text>
            <Text style={styles.rating}>
              {rating.toFixed(rating % 1 === 0 ? 1 : 2)}
              <Text style={styles.ratingCount}>({ratingCount})</Text>
            </Text>
          </View>
          <Text style={styles.ago}>{r.createdAt ? timeAgo(r.createdAt.seconds) : ''}</Text>
        </View>

        {/* Trip */}
        <View style={styles.body}>
          {r.distanceM !== undefined && (
            <Text style={styles.distance}>~{formatDistance(r.distanceM)}</Text>
          )}
          <Text style={styles.fare}>PKR{r.offeredFare.toLocaleString()}</Text>

          <Text style={styles.pickup} numberOfLines={2}>{r.pickup?.address ?? 'Pickup'}</Text>
          <Text style={styles.dropoff} numberOfLines={2}>{r.dropoff?.address ?? 'Drop-off'}</Text>

          <View style={styles.chips}>
            <View style={[styles.chip, styles.chipPay]}>
              <Text style={styles.chipPayTxt}>{paymentLabel}</Text>
            </View>
            <View style={[styles.chip, styles.chipCat]}>
              <Text style={styles.chipCatTxt}>{RIDE_TYPE_LABELS[r.rideType]}</Text>
            </View>
            {r.seats > 1 && (
              <View style={[styles.chip, styles.chipCat]}>
                <Text style={styles.chipCatTxt}>{r.seats} seats</Text>
              </View>
            )}
            {r.preferFemaleDriver && (
              <View style={[styles.chip, { backgroundColor: '#ff69b41f' }]}>
                <Text style={[styles.chipCatTxt, { color: '#ff8ac6' }]}>Female driver</Text>
              </View>
            )}
            {locked && (
              <View style={[styles.chip, { backgroundColor: `${colors.danger}22` }]}>
                <Text style={[styles.chipCatTxt, { color: colors.danger }]}>🔒 Settle commission</Text>
              </View>
            )}
          </View>
        </View>

        <KebabHandle onPress={onToggleActions} />
      </Pressable>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  cardInner: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 12, gap: 10 },

  // ── Passenger column ──
  who:    { width: 62, alignItems: 'center', gap: 2 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  avatarTxt:   { fontSize: 18, fontWeight: '800', color: colors.text },
  name:        { fontSize: 11, color: colors.muted, fontWeight: '600', maxWidth: 62, textAlign: 'center' },
  ratingRow:   { flexDirection: 'row', alignItems: 'center', gap: 2 },
  star:        { fontSize: 10, color: '#f5a623' },
  rating:      { fontSize: 10, fontWeight: '700', color: colors.text },
  ratingCount: { fontSize: 10, fontWeight: '500', color: colors.muted },
  ago:         { fontSize: 10, color: colors.muted, textAlign: 'center' },

  // ── Trip column ──
  body:     { flex: 1, gap: 3 },
  distance: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  fare:     { fontSize: 26, fontWeight: '900', color: colors.text, marginBottom: 2 },
  pickup:   { fontSize: 15, fontWeight: '800', color: colors.text, lineHeight: 20 },
  dropoff:  { fontSize: 14, fontWeight: '500', color: colors.muted, lineHeight: 19 },

  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip:       { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  chipPay:    { backgroundColor: colors.primary },
  chipPayTxt: { fontSize: 12, fontWeight: '800', color: '#000' },
  chipCat:    { backgroundColor: '#3b82f6' },
  chipCatTxt: { fontSize: 12, fontWeight: '800', color: '#fff' },

  kebab: { paddingHorizontal: 4, paddingTop: 6, alignSelf: 'flex-start' },

  // ── Revealed action panel ──
  actionPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassStrong,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 22,
    paddingHorizontal: 8,
    gap: 4,
  },
  actionRow: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start' },
  action:    { alignItems: 'center', gap: 8, paddingHorizontal: 10, minWidth: 84 },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.text, textAlign: 'center', lineHeight: 17 },
}));
