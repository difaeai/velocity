import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { colors } from '../../src/config';

const CITIES = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Hyderabad', 'Peshawar', 'Quetta', 'Sialkot'];

type SeatClass = 'economy' | 'business';

const ROUTES: { from: string; to: string; times: { time: string; seats: number; price: number }[] }[] = [
  { from: 'Karachi',   to: 'Lahore',     times: [{ time: '7:00 AM', seats: 8, price: 3500 }, { time: '11:00 AM', seats: 4, price: 3500 }, { time: '3:00 PM', seats: 12, price: 3200 }] },
  { from: 'Karachi',   to: 'Islamabad',  times: [{ time: '8:00 AM', seats: 6, price: 4200 }, { time: '2:00 PM', seats: 10, price: 4000 }] },
  { from: 'Lahore',    to: 'Islamabad',  times: [{ time: '6:30 AM', seats: 14, price: 1800 }, { time: '12:00 PM', seats: 8, price: 1800 }, { time: '5:00 PM', seats: 6, price: 1600 }] },
  { from: 'Lahore',    to: 'Karachi',    times: [{ time: '7:00 AM', seats: 8, price: 3500 }, { time: '9:00 PM', seats: 12, price: 3000 }] },
  { from: 'Islamabad', to: 'Lahore',     times: [{ time: '7:00 AM', seats: 10, price: 1800 }, { time: '1:00 PM', seats: 6, price: 1800 }] },
  { from: 'Islamabad', to: 'Karachi',    times: [{ time: '9:00 AM', seats: 4, price: 4200 }] },
  { from: 'Multan',    to: 'Lahore',     times: [{ time: '8:00 AM', seats: 10, price: 1500 }, { time: '4:00 PM', seats: 6, price: 1500 }] },
];

export default function CityToCityScreen() {
  const router = useRouter();
  const [fromCity, setFromCity] = useState('Karachi');
  const [toCity, setToCity] = useState('Lahore');
  const [seatClass, setSeatClass] = useState<SeatClass>('economy');
  const [passengers, setPassengers] = useState(1);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [loading, setLoading] = useState(false);

  const availableRoutes = ROUTES.find(r => r.from === fromCity && r.to === toCity);
  const multiplier = seatClass === 'business' ? 1.6 : 1;

  function swapCities() {
    const tmp = fromCity;
    setFromCity(toCity);
    setToCity(tmp);
    setSelectedRoute(null);
  }

  function book() {
    if (fromCity === toCity) { Alert.alert('Invalid route', 'Origin and destination must be different.'); return; }
    if (selectedRoute === null) { Alert.alert('Select a departure', 'Please choose a departure time.'); return; }
    const route = availableRoutes!.times[selectedRoute];
    const total = Math.round(route.price * multiplier) * passengers;

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      Alert.alert(
        'Seats Booked! 🚗',
        `${passengers} × ${seatClass} seat${passengers > 1 ? 's' : ''}\n${fromCity} → ${toCity}\nDeparture: ${route.time}\n\nTotal: ${total.toLocaleString()} PKR`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    }, 1200);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>City to City</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Route selector */}
        <View style={styles.routeBox}>
          <Pressable style={styles.cityBtn} onPress={() => { setShowFromPicker(true); setShowToPicker(false); }}>
            <Text style={styles.cityBtnLabel}>FROM</Text>
            <Text style={styles.cityBtnValue}>{fromCity}</Text>
          </Pressable>

          <Pressable style={styles.swapBtn} onPress={swapCities}>
            <Text style={styles.swapIcon}>⇄</Text>
          </Pressable>

          <Pressable style={styles.cityBtn} onPress={() => { setShowToPicker(true); setShowFromPicker(false); }}>
            <Text style={styles.cityBtnLabel}>TO</Text>
            <Text style={styles.cityBtnValue}>{toCity}</Text>
          </Pressable>
        </View>

        {/* City pickers */}
        {(showFromPicker || showToPicker) && (
          <View style={styles.picker}>
            <Text style={styles.pickerTitle}>Select {showFromPicker ? 'origin' : 'destination'}</Text>
            <View style={styles.cityGrid}>
              {CITIES.filter(c => showFromPicker ? c !== toCity : c !== fromCity).map(city => (
                <Pressable
                  key={city}
                  style={[styles.cityChip, (showFromPicker ? fromCity : toCity) === city && styles.cityChipActive]}
                  onPress={() => {
                    if (showFromPicker) setFromCity(city);
                    else setToCity(city);
                    setShowFromPicker(false);
                    setShowToPicker(false);
                    setSelectedRoute(null);
                  }}
                >
                  <Text style={[styles.cityChipText, (showFromPicker ? fromCity : toCity) === city && styles.cityChipTextActive]}>
                    {city}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Seat class + passengers */}
        <View style={styles.row}>
          <View style={styles.halfCard}>
            <Text style={styles.sectionLabel}>SEAT CLASS</Text>
            <View style={styles.segRow}>
              {(['economy', 'business'] as SeatClass[]).map(c => (
                <Pressable
                  key={c}
                  style={[styles.seg, seatClass === c && styles.segActive]}
                  onPress={() => setSeatClass(c)}
                >
                  <Text style={[styles.segText, seatClass === c && styles.segTextActive]}>
                    {c === 'economy' ? '💺 Economy' : '✨ Business'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.halfCard}>
            <Text style={styles.sectionLabel}>PASSENGERS</Text>
            <View style={styles.counterRow}>
              <Pressable style={styles.counterBtn} onPress={() => setPassengers(Math.max(1, passengers - 1))}>
                <Text style={styles.counterBtnText}>−</Text>
              </Pressable>
              <Text style={styles.counterValue}>{passengers}</Text>
              <Pressable style={styles.counterBtn} onPress={() => setPassengers(Math.min(6, passengers + 1))}>
                <Text style={styles.counterBtnText}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Available departures */}
        <Text style={styles.sectionLabel}>AVAILABLE DEPARTURES</Text>
        {fromCity === toCity ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>Origin and destination must be different.</Text>
          </View>
        ) : !availableRoutes ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No direct routes available for this city pair yet.</Text>
            <Text style={[styles.emptyText, { marginTop: 4 }]}>Try Karachi ↔ Lahore or Lahore ↔ Islamabad.</Text>
          </View>
        ) : (
          availableRoutes.times.map((t, i) => {
            const price = Math.round(t.price * multiplier) * passengers;
            const isSelected = selectedRoute === i;
            return (
              <Pressable
                key={i}
                style={[styles.departureCard, isSelected && styles.departureCardActive]}
                onPress={() => setSelectedRoute(i)}
              >
                <View style={styles.departureLeft}>
                  <Text style={styles.departureTime}>{t.time}</Text>
                  <Text style={styles.departureSeats}>{t.seats} seats left</Text>
                </View>
                <View style={styles.departureRight}>
                  <Text style={[styles.departurePrice, isSelected && { color: colors.primary }]}>
                    {price.toLocaleString()} PKR
                  </Text>
                  <Text style={styles.departurePerSeat}>for {passengers} pax</Text>
                </View>
                {isSelected && <View style={styles.selectedDot} />}
              </Pressable>
            );
          })
        )}

        <Pressable
          style={({ pressed }) => [styles.bookBtn, pressed && { opacity: 0.85 }, (loading || selectedRoute === null || fromCity === toCity) && { opacity: 0.5 }]}
          onPress={book}
          disabled={loading || selectedRoute === null || fromCity === toCity}
        >
          <Text style={styles.bookBtnText}>{loading ? 'Booking…' : 'Book Seats'}</Text>
        </Pressable>
      </ScrollView>
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
  container: { padding: 16, gap: 14 },
  routeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 8,
  },
  cityBtn: { flex: 1, alignItems: 'center', gap: 4 },
  cityBtnLabel: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.5 },
  cityBtnValue: { fontSize: 17, fontWeight: '900', color: colors.text },
  swapBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapIcon: { fontSize: 18, color: colors.primary },
  picker: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  pickerTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cityChipActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  cityChipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  cityChipTextActive: { color: colors.primary },
  row: { flexDirection: 'row', gap: 10 },
  halfCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
  },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  segRow: { flexDirection: 'column', gap: 6 },
  seg: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  segActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  segText: { fontSize: 12, fontWeight: '700', color: colors.text },
  segTextActive: { color: colors.primary },
  counterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: { fontSize: 20, color: colors.text, lineHeight: 24 },
  counterValue: { fontSize: 22, fontWeight: '900', color: colors.text },
  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  departureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  departureCardActive: { borderColor: colors.primary, backgroundColor: '#1a2010' },
  departureLeft: { flex: 1, gap: 3 },
  departureTime: { fontSize: 16, fontWeight: '900', color: colors.text },
  departureSeats: { fontSize: 12, color: colors.muted },
  departureRight: { alignItems: 'flex-end', gap: 3 },
  departurePrice: { fontSize: 16, fontWeight: '900', color: colors.text },
  departurePerSeat: { fontSize: 11, color: colors.muted },
  selectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginLeft: 12,
  },
  bookBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  bookBtnText: { color: '#000', fontSize: 16, fontWeight: '900' },
});
