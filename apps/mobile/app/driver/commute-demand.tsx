import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '../../src/api/client';
import type { CommuteDemandSlot } from '../../src/api/client';
import { colors } from '../../src/config';

function fmtTime(time: string): string {
  const parts = time.split(':');
  const h = parseInt(parts[0] ?? '0', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function SlotCard({ slot }: { slot: CommuteDemandSlot }) {
  const total = slot.genderBreakdown.male + slot.genderBreakdown.female + slot.genderBreakdown.any;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.timeLabel}>{fmtTime(slot.time)}</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeNum}>{slot.count}</Text>
          <Text style={styles.countBadgeLabel}>rider{slot.count > 1 ? 's' : ''}</Text>
        </View>
      </View>

      <View style={styles.destRow}>
        <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
        <Text style={styles.destText} numberOfLines={1}>{slot.destinationAreaName}</Text>
      </View>

      {total > 0 && (
        <View style={styles.genderRow}>
          {slot.genderBreakdown.male > 0 && (
            <View style={styles.genderChip}>
              <Text style={styles.genderChipText}>♂ {slot.genderBreakdown.male} male</Text>
            </View>
          )}
          {slot.genderBreakdown.female > 0 && (
            <View style={styles.genderChip}>
              <Text style={styles.genderChipText}>♀ {slot.genderBreakdown.female} female</Text>
            </View>
          )}
          {slot.genderBreakdown.any > 0 && (
            <View style={styles.genderChip}>
              <Text style={styles.genderChipText}>👥 {slot.genderBreakdown.any} any</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function CommuteDemandScreen() {
  const router = useRouter();
  const [slots, setSlots]           = useState<CommuteDemandSlot[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getCommuteDemand({ lat: 0, lng: 0, radiusKm: 5 });
      setSlots(res.demand);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/driver/home')} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Commute Demand</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.privacyBanner}>
        <Text style={styles.privacyText}>
          Passengers are shown anonymously — only general areas and rounded times. No names, UIDs, or exact addresses.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      ) : (
        <FlatList
          data={slots}
          keyExtractor={(s) => `${s.time}::${s.destinationAreaName}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={styles.todayBanner}>
              <Text style={styles.todayText}>Today's commuter demand in your area</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTitle}>No demand data</Text>
              <Text style={styles.emptyText}>No passengers have registered commute schedules in your area yet, or none match today's day. Pull to refresh.</Text>
            </View>
          }
          renderItem={({ item }) => <SlotCard slot={item} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.background },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:         { width: 40 },
  backArrow:       { fontSize: 24, color: colors.text },
  headerTitle:     { fontSize: 17, fontWeight: '800', color: colors.text },

  privacyBanner:   { backgroundColor: '#0d1a06', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: `${colors.primary}20` },
  privacyText:     { fontSize: 12, color: colors.primary, fontWeight: '600', textAlign: 'center' },

  list:            { padding: 16, gap: 12 },
  todayBanner:     { marginBottom: 8 },
  todayText:       { fontSize: 12, color: colors.muted, textAlign: 'center' },

  empty:           { paddingTop: 60, alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyIcon:       { fontSize: 48 },
  emptyTitle:      { fontSize: 18, fontWeight: '800', color: colors.text },
  emptyText:       { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  card:            { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', gap: 0 },
  cardHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  timeLabel:       { fontSize: 20, fontWeight: '900', color: colors.primary },
  countBadge:      { alignItems: 'center', backgroundColor: '#1c2c0a', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  countBadgeNum:   { fontSize: 20, fontWeight: '900', color: colors.primary },
  countBadgeLabel: { fontSize: 9, color: colors.primary, fontWeight: '700' },

  destRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dot:             { width: 8, height: 8, borderRadius: 4 },
  destText:        { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },

  genderRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  genderChip:      { backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 3 },
  genderChipText:  { fontSize: 11, color: colors.muted, fontWeight: '700' },
});
