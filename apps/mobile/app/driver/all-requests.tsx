import { useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { useOpenRequests } from '../../src/hooks/driver';
import { colors } from '../../src/config';
import { RIDE_TYPE_LABELS } from '../../src/domain/types';

export default function AllRequestsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing]  = useState(false);

  const allRequests = useOpenRequests(true, undefined, undefined);
  const visible     = allRequests.filter((r) => !skippedIds.has(r.tripId));

  const skip = (tripId: string) =>
    setSkippedIds((prev) => new Set([...prev, tripId]));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          Incoming Requests {visible.length > 0 ? `(${visible.length})` : ''}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => setRefreshing(false)}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🔍</Text>
            <Text style={styles.emptyTitle}>No open requests</Text>
            <Text style={styles.emptyText}>All nearby requests have been skipped or there are none right now. Pull to refresh.</Text>
          </View>
        }
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            {/* Route */}
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#3b82f6' }]} />
              <Text style={styles.routeAddr} numberOfLines={1}>{r.pickup?.address ?? 'Pickup'}</Text>
            </View>
            <View style={styles.routeLine} />
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: colors.primary }]} />
              <Text style={styles.routeAddr} numberOfLines={1}>{r.dropoff?.address ?? 'Drop-off'}</Text>
            </View>

            {/* Meta row */}
            <View style={styles.metaRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeTxt}>{RIDE_TYPE_LABELS[r.rideType]}</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeTxt}>{r.seats} seat{r.seats !== 1 ? 's' : ''}</Text>
              </View>
              {r.paymentMethod === 'cash' && (
                <View style={styles.badge}><Text style={styles.badgeTxt}>💵 Cash</Text></View>
              )}
              {r.preferFemaleDriver && (
                <View style={[styles.badge, { borderColor: '#ff69b450' }]}>
                  <Text style={[styles.badgeTxt, { color: '#ff69b4' }]}>👩 Female pref</Text>
                </View>
              )}
            </View>

            {/* Fare + actions */}
            <View style={styles.actionRow}>
              <View style={styles.fareBadge}>
                <Text style={styles.fareAmt}>{r.offeredFare}</Text>
                <Text style={styles.farePkr}>PKR</Text>
              </View>
              <Pressable
                style={styles.openBtn}
                onPress={() => router.push(`/driver/request-detail/${r.tripId}` as Parameters<typeof router.push>[0])}
              >
                <Text style={styles.openBtnTxt}>Open Request</Text>
              </Pressable>
              <Pressable style={styles.skipBtn} onPress={() => skip(r.tripId)}>
                <Text style={styles.skipBtnTxt}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:     { width: 40 },
  backArrow:   { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  list:        { padding: 16, gap: 12 },

  empty:      { paddingTop: 60, alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyIcon:  { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  emptyText:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },

  routeRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:       { width: 10, height: 10, borderRadius: 5 },
  routeAddr: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  routeLine: { height: 16, width: 2, backgroundColor: colors.border, marginLeft: 4 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge:   { backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: colors.muted },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fareBadge: { alignItems: 'center', backgroundColor: `${colors.primary}15`, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: `${colors.primary}40` },
  fareAmt:   { fontSize: 18, fontWeight: '900', color: colors.primary },
  farePkr:   { fontSize: 9, fontWeight: '700', color: colors.primary },

  openBtn:    { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  openBtnTxt: { fontSize: 13, fontWeight: '900', color: '#000' },
  skipBtn:    { flex: 1, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 11, alignItems: 'center' },
  skipBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.muted },
});
