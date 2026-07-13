/**
 * Demand tab — "where are the passengers right now".
 *
 * Two views of the same question: the live heatmap of open requests around the
 * driver, and today's anonymised commuter demand (rounded times + area names
 * only, never a passenger's exact origin).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api, type CommuteDemandSlot } from '../../src/api/client';
import { useCurrentLocation } from '../../src/hooks/location';
import { colors } from '../../src/config';
import { DemandHeatmap } from '../../src/ui/DemandHeatmap';
import { DriverTabBar, DRIVER_TAB_BAR_HEIGHT } from '../../src/ui/DriverTabBar';

export default function DriverDemand() {
  const router = useRouter();
  const { coords } = useCurrentLocation();
  const [slots, setSlots] = useState<CommuteDemandSlot[]>([]);

  const load = useCallback(async (lat: number, lng: number) => {
    try {
      const res = await api.getCommuteDemand({ lat, lng, radiusKm: 10 });
      setSlots((res as { demand: CommuteDemandSlot[] }).demand.slice(0, 5));
    } catch { /* silent — the heatmap above is still useful */ }
  }, []);

  useEffect(() => {
    if (coords) load(coords.lat, coords.lng);
  }, [coords, load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Demand</Text>
        <Text style={styles.headerSub}>See where to find passengers right now</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <DemandHeatmap />

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Commute map</Text>
              <Text style={styles.sectionSub}>Today&apos;s anonymised commuter demand near you</Text>
            </View>
            <Pressable
              style={styles.linkBtn}
              onPress={() => router.push('/driver/commute-demand' as Parameters<typeof router.push>[0])}
            >
              <Text style={styles.linkBtnTxt}>View all →</Text>
            </Pressable>
          </View>

          {slots.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTxt}>No commute demand data in your area today</Text>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {slots.map((slot) => {
                const parts = slot.time.split(':');
                const h = parseInt(parts[0] ?? '0', 10);
                const m = parts[1] ?? '00';
                const ampm = h >= 12 ? 'PM' : 'AM';
                const h12 = h % 12 || 12;
                return (
                  <Pressable
                    key={`${slot.time}::${slot.destinationAreaName}`}
                    style={styles.slotCard}
                    onPress={() => router.push('/driver/commute-demand' as Parameters<typeof router.push>[0])}
                  >
                    <View style={styles.timeBox}>
                      <Text style={styles.timeNum}>{h12}:{m}</Text>
                      <Text style={styles.timeAmpm}>{ampm}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.slotDest} numberOfLines={1}>→ {slot.destinationAreaName}</Text>
                      <View style={styles.genderRow}>
                        {slot.genderBreakdown.male > 0 && (
                          <View style={[styles.genderChip, { borderColor: '#4fc3f7' }]}>
                            <Text style={[styles.genderChipTxt, { color: '#4fc3f7' }]}>♂ {slot.genderBreakdown.male}</Text>
                          </View>
                        )}
                        {slot.genderBreakdown.female > 0 && (
                          <View style={[styles.genderChip, { borderColor: '#ff69b4' }]}>
                            <Text style={[styles.genderChipTxt, { color: '#ff69b4' }]}>♀ {slot.genderBreakdown.female}</Text>
                          </View>
                        )}
                        {slot.genderBreakdown.any > 0 && (
                          <View style={[styles.genderChip, { borderColor: colors.muted }]}>
                            <Text style={[styles.genderChipTxt, { color: colors.muted }]}>👥 {slot.genderBreakdown.any}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.countBadge}>
                      <Text style={styles.countNum}>{slot.count}</Text>
                      <Text style={styles.countLbl}>rider{slot.count !== 1 ? 's' : ''}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <Text style={styles.footnote}>Anonymised — area names and rounded times only</Text>
            </View>
          )}
        </View>

        <Pressable style={styles.offerBtn} onPress={() => router.push('/driver/pool-ride-offer')}>
          <Text style={styles.offerBtnTxt}>+ Offer a pool route</Text>
        </Pressable>
      </ScrollView>

      <DriverTabBar active="demand" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { fontSize: 24, fontWeight: '900', color: colors.text },
  headerSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  scroll: { padding: 18, paddingTop: 0, gap: 14, paddingBottom: DRIVER_TAB_BAR_HEIGHT + 18 },

  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  sectionSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  linkBtn: {
    backgroundColor: `${colors.primary}20`,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${colors.primary}60`,
  },
  linkBtnTxt: { fontSize: 12, fontWeight: '800', color: colors.primary },

  empty: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  emptyIcon: { fontSize: 22 },
  emptyTxt: { fontSize: 12, color: colors.muted, flex: 1 },

  slotCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 11,
  },
  timeBox: {
    alignItems: 'center',
    backgroundColor: '#1a2e0a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  timeNum: { fontSize: 15, fontWeight: '900', color: colors.primary },
  timeAmpm: { fontSize: 9, fontWeight: '700', color: colors.primary },
  slotDest: { fontSize: 13, fontWeight: '700', color: colors.text },
  genderRow: { flexDirection: 'row', gap: 6, marginTop: 3, flexWrap: 'wrap' },
  genderChip: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  genderChipTxt: { fontSize: 10, fontWeight: '700' },
  countBadge: {
    alignItems: 'center',
    backgroundColor: `${colors.primary}18`,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
  },
  countNum: { fontSize: 16, fontWeight: '900', color: colors.primary },
  countLbl: { fontSize: 9, fontWeight: '700', color: colors.primary },
  footnote: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 2 },

  offerBtn: {
    backgroundColor: `${colors.primary}12`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    paddingVertical: 14,
    alignItems: 'center',
  },
  offerBtnTxt: { fontSize: 14, fontWeight: '800', color: colors.primary },
});
