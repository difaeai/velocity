/**
 * Earn with Velocity — one member's complete ride history.
 *
 * Every ride appears, including the ones that paid nothing. A partner who sees a
 * ride simply missing assumes the app is broken or that they are being cheated;
 * a partner who sees it listed as "🟠 Scam ride — Rs 0" understands the rule they
 * are being held to. Transparency here is what makes the fraud policy credible.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Text } from '../../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../../../../src/api/client';
import type { PartnerRide } from '../../../../src/api/client';
import { colors } from '../../../../src/config';
import { themed } from '../../../../src/theme';
import { RideStatusPill, Skeleton, formatPKR } from '../../../../src/ui/partner';

export default function MemberRides() {
  const { uid, name } = useLocalSearchParams<{ uid: string; name?: string }>();
  const [rides, setRides] = useState<PartnerRide[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Knowable during render, so derive it rather than setting state from an
  // effect — otherwise a missing route param costs an extra render for nothing.
  const problem = error ?? (uid ? null : 'No member specified.');

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    api
      .getPartnerMemberRides({ memberUid: uid, limit: 200 })
      .then((res) => {
        if (!cancelled) setRides(res.rides);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the ride history.');
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const earned = (rides ?? []).reduce((sum, r) => sum + r.fleetCommission, 0);
  const completed = (rides ?? []).filter((r) => r.rideStatus === 'completed').length;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <FlatList
        data={rides ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={s.header}>
            <Text style={s.name}>{name ?? 'Member'}</Text>
            <Text style={s.meta}>
              {completed} completed ride{completed === 1 ? '' : 's'} · {formatPKR(earned)} earned for you
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.cardTop}>
              <RideStatusPill status={item.rideStatus} />
              <Text style={s.date}>
                {item.date ? new Date(item.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}
              </Text>
            </View>

            <Text style={s.route} numberOfLines={2}>
              {item.pickup ?? 'Pickup'} → {item.dropoff ?? 'Destination'}
            </Text>

            <View style={s.moneyRow}>
              <Money label="Fare" value={formatPKR(item.fare)} />
              <Money label="Platform commission" value={formatPKR(item.platformCommission)} />
              <Money
                label="Your commission"
                value={formatPKR(item.fleetCommission)}
                accent={item.fleetCommission > 0 ? colors.primary : colors.muted}
              />
            </View>

            {item.fraudReason ? (
              <Text style={s.fraud}>⚠️ {item.fraudReason} — this ride paid zero.</Text>
            ) : item.paymentStatus === 'pending' ? (
              <Text style={s.pending}>⏳ Clearing — moves to your balance after the fraud-hold window.</Text>
            ) : null}

            <Text style={s.tripId}>Ride {item.tripId}</Text>
          </View>
        )}
        ListEmptyComponent={
          rides === null && !problem ? (
            <View style={{ gap: 10 }}>
              <Skeleton height={120} radius={16} />
              <Skeleton height={120} radius={16} />
            </View>
          ) : (
            <Text style={s.empty}>{problem ?? 'This member has not completed any rides yet.'}</Text>
          )
        }
      />
    </SafeAreaView>
  );
}

function Money({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.moneyLabel}>{label}</Text>
      <Text style={[s.moneyValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

const s = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 18, gap: 12, paddingBottom: 40 },

  header: { marginBottom: 4 },
  name: { color: colors.text, fontSize: 22, fontWeight: '900' },
  meta: { color: colors.muted, fontSize: 13, marginTop: 4 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  route: { color: colors.text, fontSize: 14, fontWeight: '700', lineHeight: 20 },

  moneyRow: { flexDirection: 'row', gap: 10 },
  moneyLabel: { color: colors.muted, fontSize: 10 },
  moneyValue: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },

  fraud: { color: '#f97316', fontSize: 12, fontWeight: '700', lineHeight: 18 },
  pending: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  tripId: { color: colors.muted, fontSize: 10, opacity: 0.7 },

  empty: { color: colors.muted, fontSize: 13, textAlign: 'center', padding: 30, lineHeight: 20 },
}));
