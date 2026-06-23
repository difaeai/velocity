import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useAuth } from '../../src/auth/AuthContext';
import { usePassengerTrips } from '../../src/hooks/passenger';
import { colors } from '../../src/config';
import { RIDE_TYPE_LABELS, type TripStatus } from '../../src/domain/types';

const STATUS_META: Record<TripStatus, { label: string; color: string }> = {
  requested: { label: 'Finding driver', color: '#ccff00' },
  matched: { label: 'Driver assigned', color: '#ccff00' },
  arriving: { label: 'On the way', color: '#ccff00' },
  arrived: { label: 'Driver arrived', color: '#ccff00' },
  in_progress: { label: 'In progress', color: '#ccff00' },
  completed: { label: 'Completed', color: '#10b981' },
  cancelled: { label: 'Cancelled', color: '#ef4444' },
};

const ACTIVE = new Set<TripStatus>(['requested', 'matched', 'arriving', 'arrived', 'in_progress']);

export default function Activity() {
  const router = useRouter();
  const { user } = useAuth();
  const { trips, loading } = usePassengerTrips(user?.uid);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Your rides</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : trips.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🛺</Text>
          <Text style={styles.emptyTitle}>No rides yet</Text>
          <Text style={styles.emptySub}>Your trips will show up here once you book one.</Text>
          <Pressable style={styles.bookBtn} onPress={() => router.replace('/passenger/home')}>
            <Text style={styles.bookBtnText}>Book a ride</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {trips.map((t) => {
            const meta = STATUS_META[t.status];
            const live = ACTIVE.has(t.status);
            return (
              <Pressable key={t.id} style={styles.card} onPress={() => router.push(`/passenger/trip/${t.id}`)}>
                <View style={styles.cardTop}>
                  <Text style={styles.rideType}>{RIDE_TYPE_LABELS[t.rideType]}</Text>
                  <View style={[styles.statusPill, { borderColor: meta.color }]}>
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <View style={styles.routeRow}>
                  <Text style={styles.routeDot}>👤</Text>
                  <Text style={styles.routeText} numberOfLines={1}>
                    {t.pickup?.address ?? 'Pickup'}
                  </Text>
                </View>
                <View style={styles.routeRow}>
                  <Text style={styles.routeDot}>🏁</Text>
                  <Text style={styles.routeText} numberOfLines={1}>
                    {t.dropoff?.address ?? 'Drop-off'}
                  </Text>
                </View>
                <View style={styles.cardBottom}>
                  <Text style={styles.fare}>{t.fare ?? t.offeredFare} PKR</Text>
                  {live ? <Text style={styles.resume}>Tap to resume →</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: { width: 32 },
  backText: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  emptyEmoji: { fontSize: 44, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  bookBtn: {
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingHorizontal: 26,
    paddingVertical: 14,
  },
  bookBtnText: { color: '#000', fontWeight: '900', fontSize: 15 },
  list: { padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rideType: { fontSize: 16, fontWeight: '800', color: colors.text },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '800' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDot: { fontSize: 13 },
  routeText: { flex: 1, fontSize: 13, color: colors.muted },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  fare: { fontSize: 16, fontWeight: '900', color: colors.primary },
  resume: { fontSize: 12, fontWeight: '700', color: colors.text },
});
