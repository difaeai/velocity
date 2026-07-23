import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { colors } from '../config';
import { themed } from '../theme';
import { DestinationPinIcon, PickupDotIcon } from './RideIcons';
import type { NearbyPublicPool } from '../api/client';

/**
 * One public pool heading somewhere, shown in discovery lists (home preview and
 * the Find-a-pool screen). It deliberately shows NO rider names — only the
 * pickup area, the destination, how many people (and which genders) are already
 * aboard, seats left and the per-seat fare you'd pay by joining.
 */
export function NearbyPoolCard({
  pool,
  onJoin,
}: {
  pool: NearbyPublicPool;
  onJoin: () => void;
}) {
  const { males, females, riders } = pool;
  const others = Math.max(0, riders - males - females); // gender-unspecified riders
  const parts: string[] = [];
  if (females > 0) parts.push(`${females} female${females > 1 ? 's' : ''}`);
  if (males > 0) parts.push(`${males} male${males > 1 ? 's' : ''}`);
  if (others > 0) parts.push(`${others} rider${others > 1 ? 's' : ''}`);
  const genderText = parts.length ? parts.join(' · ') : `${riders} rider${riders > 1 ? 's' : ''}`;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onJoin}>
      {/* Route: pickup area → destination (no names) */}
      <View style={styles.routeBlock}>
        <View style={styles.routeRow}>
          <View style={styles.iconCol}>
            <PickupDotIcon size={15} color="rgba(255,255,255,0.7)" />
            <View style={styles.stem} />
          </View>
          <Text style={styles.routeAddr} numberOfLines={1}>{pool.pickupAddress}</Text>
        </View>
        <View style={styles.routeRow}>
          <View style={styles.iconCol}>
            <DestinationPinIcon size={15} color={colors.primary} accent={colors.primary} />
          </View>
          <Text style={styles.routeAddr} numberOfLines={1}>{pool.dropoffAddress}</Text>
        </View>
      </View>

      {/* Who's aboard + seats + fare */}
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <View style={styles.genderChip}>
            <Text style={styles.genderChipText}>👥 {genderText}</Text>
          </View>
          <Text style={styles.seatsText}>
            {pool.distanceKm} km away · {pool.seatsLeft} seat{pool.seatsLeft !== 1 ? 's' : ''} left
          </Text>
        </View>
        <View style={styles.fareCol}>
          <Text style={styles.fareAmt}>PKR {pool.perSeatFareIfYouJoin}</Text>
          <Text style={styles.joinCta}>Join →</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 12,
  },
  cardPressed: { opacity: 0.75 },
  routeBlock: { gap: 2 },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCol: {
    width: 16,
    alignItems: 'center',
  },
  stem: {
    width: 0,
    height: 12,
    marginTop: 1,
    borderLeftWidth: 1.4,
    borderColor: 'rgba(255,255,255,0.22)',
    borderStyle: 'dashed',
  },
  routeAddr: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  metaLeft: { flex: 1, gap: 6 },
  genderChip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  genderChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  seatsText: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  fareCol: { alignItems: 'flex-end', gap: 2 },
  fareAmt: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
  },
  joinCta: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.primary,
  },
}));
