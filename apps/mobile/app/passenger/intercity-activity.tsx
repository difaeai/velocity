import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import {
  IntercityBooking,
  VEHICLE_TYPE_ICONS,
  VEHICLE_TYPE_LABELS,
  BOOKING_STATUS_META,
} from '../../src/domain/intercityTypes';

function formatDate(ms: number) {
  return new Date(ms).toLocaleString('en-PK', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

export default function IntercityActivityScreen() {
  const router    = useRouter();
  const { user }  = useAuth();
  const [bookings, setBookings]   = useState<IntercityBooking[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'intercityBookings'),
      where('passengerId', '==', user.uid),
      orderBy('departureTime', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      setBookings(snap.docs.map(d => ({ id: d.id, ...d.data() } as IntercityBooking)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user?.uid]);

  const active = bookings.filter(b => b.status === 'confirmed' && b.departureTime > Date.now() - 3_600_000);
  const past   = bookings.filter(b => !active.includes(b));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
        >
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My Intercity Trips</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>
      ) : bookings.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🚌</Text>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptySub}>Book your first city-to-city trip to get started.</Text>
          <Pressable style={styles.bookBtn} onPress={() => router.replace('/passenger/city-to-city')}>
            <Text style={styles.bookBtnTxt}>Book a Trip</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {active.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>UPCOMING</Text>
              {active.map(b => <BookingCard key={b.id} booking={b} onPress={() => router.push(`/passenger/intercity-trip/${b.id}`)} />)}
            </>
          )}
          {past.length > 0 && (
            <>
              <Text style={styles.sectionHeader}>PAST TRIPS</Text>
              {past.map(b => <BookingCard key={b.id} booking={b} onPress={() => router.push(`/passenger/intercity-trip/${b.id}`)} />)}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BookingCard({ booking, onPress }: { booking: IntercityBooking; onPress: () => void }) {
  const meta    = BOOKING_STATUS_META[booking.status];
  const isUpcoming = booking.status === 'confirmed' && booking.departureTime > Date.now();

  return (
    <Pressable style={[styles.card, isUpcoming && styles.cardUpcoming]} onPress={onPress}>
      {/* Route row */}
      <View style={styles.routeRow}>
        <View style={styles.routeCol}>
          <Text style={styles.cityName}>{booking.fromCityName}</Text>
          <Text style={styles.cityLabel}>From</Text>
        </View>
        <View style={styles.routeArrow}>
          <Text style={styles.routeArrowTxt}>→</Text>
        </View>
        <View style={[styles.routeCol, { alignItems: 'flex-end' }]}>
          <Text style={styles.cityName}>{booking.toCityName}</Text>
          <Text style={styles.cityLabel}>To</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* Details row */}
      <View style={styles.detailRow}>
        <View style={styles.detailLeft}>
          <Text style={styles.departure}>{formatDate(booking.departureTime)}</Text>
          <Text style={styles.vehicleTxt}>
            {VEHICLE_TYPE_ICONS[booking.vehicleType]}{'  '}{VEHICLE_TYPE_LABELS[booking.vehicleType]} · {booking.operatorName}
          </Text>
          <Text style={styles.seatsTxt}>{booking.seatsBooked} seat{booking.seatsBooked > 1 ? 's' : ''} · {booking.paymentMethod === 'cash' ? '💵 Cash' : '💳 Wallet'}</Text>
        </View>
        <View style={styles.detailRight}>
          <Text style={styles.fareTotal}>PKR {booking.fareTotal.toLocaleString()}</Text>
          <View style={[styles.statusPill, { backgroundColor: meta.color + '22', borderColor: meta.color + '60' }]}>
            <Text style={[styles.statusPillTxt, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {isUpcoming && (
            <Text style={styles.tapToView}>Tap to view →</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { width: 40 },
  backTxt: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyIcon: { fontSize: 52 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  bookBtn: { marginTop: 8, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12 },
  bookBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  sectionHeader: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginTop: 4, marginBottom: 4 },

  card: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
  cardUpcoming: { borderColor: colors.primary + '50', backgroundColor: '#1a2010' },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  routeCol: { flex: 1 },
  cityName: { fontSize: 17, fontWeight: '900', color: colors.text },
  cityLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  routeArrow: { paddingHorizontal: 12 },
  routeArrowTxt: { fontSize: 20, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border },
  detailRow: { flexDirection: 'row', gap: 12 },
  detailLeft: { flex: 1, gap: 4 },
  departure: { fontSize: 13, fontWeight: '700', color: colors.text },
  vehicleTxt: { fontSize: 12, color: colors.muted },
  seatsTxt: { fontSize: 12, color: colors.muted },
  detailRight: { alignItems: 'flex-end', gap: 6 },
  fareTotal: { fontSize: 16, fontWeight: '900', color: colors.primary },
  statusPill: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillTxt: { fontSize: 11, fontWeight: '800' },
  tapToView: { fontSize: 10, color: colors.muted, marginTop: 2 },
});
