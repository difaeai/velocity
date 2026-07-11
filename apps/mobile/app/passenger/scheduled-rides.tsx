/**
 * Scheduled rides — manage auto-booked frequent rides.
 *
 * Lists the user's scheduledRides docs (owner-readable), lets them pause /
 * resume / delete each one. The backend cron requests the ride automatically
 * at the saved time on the saved days and sends a push either way.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { api, type CommuteDay } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { RIDE_TYPE_LABELS, type Gender, type RideType } from '../../src/domain/types';

interface ScheduledRide {
  id: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  rideType: RideType;
  offeredFare: number;
  seats: number;
  passengerGender: Gender;
  paymentMethod: 'cash' | 'wallet';
  days: CommuteDay[];
  time: string;
  active: boolean;
  lastError?: string | null;
}

const DAY_LABEL: Record<CommuteDay, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};
const DAY_ORDER: CommuteDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function daysLabel(days: CommuteDay[]): string {
  const sorted = DAY_ORDER.filter(d => days.includes(d));
  if (sorted.length === 7) return 'Every day';
  if (sorted.length === 5 && !days.includes('sat') && !days.includes('sun')) return 'Weekdays';
  return sorted.map(d => DAY_LABEL[d]).join(', ');
}

export default function ScheduledRides() {
  const { user } = useAuth();
  const router = useRouter();

  const [rides, setRides] = useState<ScheduledRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      query(collection(db, 'scheduledRides'), where('uid', '==', user.uid)),
      snap => {
        setRides(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ScheduledRide));
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [user?.uid]);

  async function toggleActive(ride: ScheduledRide, value: boolean) {
    setBusyId(ride.id);
    try {
      await api.upsertScheduledRide({
        scheduleId: ride.id,
        pickup: ride.pickup,
        dropoff: ride.dropoff,
        rideType: ride.rideType,
        offeredFare: ride.offeredFare,
        seats: ride.seats,
        passengerGender: ride.passengerGender,
        paymentMethod: ride.paymentMethod,
        days: ride.days,
        time: ride.time,
        active: value,
      });
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(ride: ScheduledRide) {
    Alert.alert(
      'Delete scheduled ride?',
      `${ride.time} · ${ride.pickup.address} → ${ride.dropoff.address}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(ride.id);
            try {
              await api.deleteScheduledRide({ scheduleId: ride.id });
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable
          style={s.backBtn}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')}
          hitSlop={12}
        >
          <Text style={s.backArrow}>←</Text>
        </Pressable>
        <Text style={s.headerTitle}>Scheduled rides</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          <View style={s.infoCard}>
            <Text style={s.infoText}>
              🗓️ Rides here are requested automatically at your set time — we notify you when a
              schedule books (or when it can't, e.g. you're already on a trip).
            </Text>
          </View>

          {rides.length === 0 && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>🗓️</Text>
              <Text style={s.emptyTitle}>No scheduled rides yet</Text>
              <Text style={s.emptyText}>
                Book a route you take often? Open Book Ride and tap "Schedule this ride" so it
                books itself.
              </Text>
              <Pressable style={s.emptyBtn} onPress={() => router.push('/passenger/booking')}>
                <Text style={s.emptyBtnText}>Book a ride</Text>
              </Pressable>
            </View>
          )}

          {rides.map(ride => (
            <View key={ride.id} style={[s.card, !ride.active && { opacity: 0.6 }]}>
              <View style={s.cardTop}>
                <View style={s.timePill}>
                  <Text style={s.timePillText}>{ride.time}</Text>
                </View>
                <Text style={s.daysText}>{daysLabel(ride.days)}</Text>
                <Switch
                  value={ride.active}
                  onValueChange={v => toggleActive(ride, v)}
                  disabled={busyId === ride.id}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              <View style={s.routeRow}>
                <View style={[s.dot, { backgroundColor: '#22c55e' }]} />
                <Text style={s.routeText} numberOfLines={1}>{ride.pickup.address}</Text>
              </View>
              <View style={s.routeRow}>
                <View style={[s.dot, { backgroundColor: '#ef4444' }]} />
                <Text style={s.routeText} numberOfLines={1}>{ride.dropoff.address}</Text>
              </View>

              <View style={s.metaRow}>
                <Text style={s.metaText}>
                  {RIDE_TYPE_LABELS[ride.rideType] ?? ride.rideType} · PKR {ride.offeredFare} ·{' '}
                  {ride.paymentMethod === 'cash' ? 'Cash' : 'Wallet'}
                </Text>
                <Pressable onPress={() => confirmDelete(ride)} disabled={busyId === ride.id} hitSlop={8}>
                  <Text style={s.deleteText}>Delete</Text>
                </Pressable>
              </View>

              {ride.lastError ? (
                <Text style={s.lastError}>⚠️ Last attempt: {ride.lastError}</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:     { width: 40 },
  backArrow:   { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  list: { padding: 16, gap: 12, paddingBottom: 32 },

  infoCard: { backgroundColor: colors.glassLime, borderRadius: 14, borderWidth: 1, borderColor: `${colors.primary}30`, padding: 12 },
  infoText: { fontSize: 12, color: colors.primary, lineHeight: 17, fontWeight: '600' },

  empty:      { alignItems: 'center', paddingTop: 48, paddingHorizontal: 32, gap: 10 },
  emptyIcon:  { fontSize: 44 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  emptyText:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  emptyBtn:   { marginTop: 8, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnText: { color: '#000', fontWeight: '900', fontSize: 14 },

  card:    { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timePill: { backgroundColor: `${colors.primary}20`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  timePillText: { fontSize: 15, fontWeight: '900', color: colors.primary },
  daysText: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.muted },

  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot:      { width: 8, height: 8, borderRadius: 4 },
  routeText:{ flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },

  metaRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  metaText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  deleteText: { fontSize: 12, fontWeight: '800', color: '#ef4444' },

  lastError: { fontSize: 11, color: '#f59e0b', fontWeight: '600' },
});
