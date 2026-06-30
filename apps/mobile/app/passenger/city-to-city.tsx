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
  const [stage, setStage]             = useState<'route' | 'trips'>('route');
  const [fromCity, setFromCity]       = useState('Karachi');
  const [toCity, setToCity]           = useState('Lahore');
  const [seatClass, setSeatClass]     = useState<SeatClass>('economy');
  const [passengers, setPassengers]   = useState(1);
  const [selectedRoute, setSelectedRoute] = useState<number | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker,   setShowToPicker]   = useState(false);
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
    if (fromCity === toCity)     { Alert.alert('Invalid route', 'Origin and destination must be different.'); return; }
    if (selectedRoute === null)  { Alert.alert('Select departure', 'Please choose a departure time.');        return; }
    const route = availableRoutes!.times[selectedRoute]!;
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

  // ── STAGE 1: City selection ───────────────────────────────────────────────────
  if (stage === 'route') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>City to City</Text>
          <Pressable
            style={styles.closeBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          >
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          {/* City selector */}
          <View style={styles.cityBox}>
            <Pressable
              style={styles.cityBtn}
              onPress={() => { setShowFromPicker(true); setShowToPicker(false); }}
            >
              <Text style={styles.cityBtnLabel}>FROM</Text>
              <Text style={styles.cityBtnValue}>{fromCity}</Text>
            </Pressable>

            <Pressable style={styles.swapBtn} onPress={swapCities}>
              <Text style={styles.swapIcon}>⇄</Text>
            </Pressable>

            <Pressable
              style={styles.cityBtn}
              onPress={() => { setShowToPicker(true); setShowFromPicker(false); }}
            >
              <Text style={styles.cityBtnLabel}>TO</Text>
              <Text style={styles.cityBtnValue}>{toCity}</Text>
            </Pressable>
          </View>

          {/* City picker grid */}
          {(showFromPicker || showToPicker) && (
            <View style={styles.picker}>
              <Text style={styles.pickerTitle}>
                Select {showFromPicker ? 'origin' : 'destination'}
              </Text>
              <View style={styles.cityGrid}>
                {CITIES
                  .filter(c => showFromPicker ? c !== toCity : c !== fromCity)
                  .map(city => (
                    <Pressable
                      key={city}
                      style={[
                        styles.cityChip,
                        (showFromPicker ? fromCity : toCity) === city && styles.cityChipActive,
                      ]}
                      onPress={() => {
                        if (showFromPicker) setFromCity(city);
                        else setToCity(city);
                        setShowFromPicker(false);
                        setShowToPicker(false);
                        setSelectedRoute(null);
                      }}
                    >
                      <Text style={[
                        styles.cityChipText,
                        (showFromPicker ? fromCity : toCity) === city && styles.cityChipTextActive,
                      ]}>
                        {city}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          )}

          {/* Seat class + passengers */}
          <View style={styles.optionsRow}>
            <View style={styles.halfCard}>
              <Text style={styles.sectionLabel}>SEAT CLASS</Text>
              <View style={{ gap: 6, marginTop: 4 }}>
                {(['economy', 'business'] as SeatClass[]).map(c => (
                  <Pressable
                    key={c}
                    style={[styles.classBtn, seatClass === c && styles.classBtnActive]}
                    onPress={() => setSeatClass(c)}
                  >
                    <Text style={[styles.classBtnTxt, seatClass === c && { color: colors.primary }]}>
                      {c === 'economy' ? '💺 Economy' : '✨ Business'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.halfCard}>
              <Text style={styles.sectionLabel}>PASSENGERS</Text>
              <View style={styles.counterRow}>
                <Pressable
                  style={styles.counterBtn}
                  onPress={() => setPassengers(p => Math.max(1, p - 1))}
                >
                  <Text style={styles.counterBtnTxt}>−</Text>
                </Pressable>
                <Text style={styles.counterValue}>{passengers}</Text>
                <Pressable
                  style={styles.counterBtn}
                  onPress={() => setPassengers(p => Math.min(6, p + 1))}
                >
                  <Text style={styles.counterBtnTxt}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <Pressable
            style={[styles.continueBtn, fromCity === toCity && { opacity: 0.4 }]}
            onPress={() => {
              if (fromCity === toCity) { Alert.alert('Invalid route', 'Origin and destination must be different.'); return; }
              setStage('trips');
            }}
          >
            <Text style={styles.continueBtnTxt}>See Available Trips →</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── STAGE 2: Departure selection ──────────────────────────────────────────────
  const bookedTotal = selectedRoute !== null && availableRoutes
    ? Math.round(availableRoutes.times[selectedRoute]!.price * multiplier) * passengers
    : null;

  return (
    <View style={styles.safe}>
      {/* Abstract map background */}
      <View style={styles.mapBg}>
        <View style={[styles.road, { top: 100, left: -50, width: '120%', transform: [{ rotate: '-8deg' }] }]} />
        <View style={[styles.road, { top: 240, left: -50, width: '120%', transform: [{ rotate: '15deg' }] }]} />
        <View style={[styles.road, { top: 400, left: -50, width: '120%', transform: [{ rotate: '-4deg' }] }]} />
        <View style={[styles.mapPin, { top: 130, left: 80  }]}><Text style={styles.mapPinTxt}>🏙️</Text></View>
        <View style={[styles.mapPin, { top: 270, left: 220 }]}><Text style={styles.mapPinTxt}>🏙️</Text></View>
      </View>

      {/* Floating city header */}
      <SafeAreaView style={styles.floatingHeaderArea} pointerEvents="box-none">
        <View style={styles.floatingBar}>
          <Pressable style={styles.backBtn} onPress={() => setStage('route')}>
            <Text style={styles.backTxt}>←</Text>
          </Pressable>
          <View style={styles.floatingRouteCard}>
            <View style={styles.floatingPoint}>
              <Text style={styles.floatingDot}>🟢</Text>
              <Text style={styles.floatingCity}>{fromCity}</Text>
            </View>
            <View style={styles.floatingDivider} />
            <View style={styles.floatingPoint}>
              <Text style={styles.floatingDot}>🔴</Text>
              <Text style={styles.floatingCity}>{toCity}</Text>
            </View>
          </View>
          <View style={styles.floatingBadge}>
            <Text style={styles.floatingBadgeTxt}>{passengers} pax</Text>
            <Text style={styles.floatingBadgeSub}>{seatClass}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom sheet */}
      <View style={styles.sheet}>
        <View style={styles.dragIndicator} />

        <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
          {!availableRoutes ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>🚌</Text>
              <Text style={styles.emptyTitle}>No routes available</Text>
              <Text style={styles.emptyDesc}>
                No direct trips for {fromCity} → {toCity} yet.{'\n'}Try Karachi ↔ Lahore or Lahore ↔ Islamabad.
              </Text>
              <Pressable style={styles.changeRouteBtn} onPress={() => setStage('route')}>
                <Text style={styles.changeRouteTxt}>Change Route</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.departureHeader}>
                DEPARTURES  ·  {availableRoutes.times.length} available
              </Text>

              {availableRoutes.times.map((t, i) => {
                const price = Math.round(t.price * multiplier) * passengers;
                const isSelected = selectedRoute === i;
                return (
                  <Pressable
                    key={i}
                    style={[styles.departureCard, isSelected && styles.departureCardActive]}
                    onPress={() => setSelectedRoute(i)}
                  >
                    <View style={styles.departureLeft}>
                      <Text style={[styles.departureTime, isSelected && { color: colors.primary }]}>
                        {t.time}
                      </Text>
                      <Text style={styles.departureSeats}>{t.seats} seats left</Text>
                    </View>
                    <View style={styles.departureRight}>
                      <Text style={[styles.departurePrice, isSelected && { color: colors.primary, fontWeight: '900' }]}>
                        {price.toLocaleString()} PKR
                      </Text>
                      <Text style={styles.departurePerPax}>for {passengers} pax</Text>
                    </View>
                    {isSelected && <View style={styles.selectedDot} />}
                  </Pressable>
                );
              })}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[
              styles.bookBtn,
              (loading || selectedRoute === null) && { opacity: 0.45 },
            ]}
            onPress={book}
            disabled={loading || selectedRoute === null}
          >
            <Text style={styles.bookBtnTxt}>
              {loading
                ? 'Booking…'
                : bookedTotal
                  ? `Book Seats · ${bookedTotal.toLocaleString()} PKR`
                  : 'Select a departure'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  // Stage 1
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  closeBtn:    { padding: 6 },
  closeTxt:    { fontSize: 20, color: colors.muted },

  cityBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
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
  cityGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cityChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cityChipActive:     { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  cityChipText:       { fontSize: 13, fontWeight: '700', color: colors.text },
  cityChipTextActive: { color: colors.primary },

  optionsRow: { flexDirection: 'row', gap: 10 },
  halfCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  classBtn: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  classBtnActive: { borderColor: colors.primary, backgroundColor: '#1f2a10' },
  classBtnTxt:    { fontSize: 12, fontWeight: '700', color: colors.text },
  counterRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
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
  counterBtnTxt: { fontSize: 20, color: colors.text, lineHeight: 24 },
  counterValue:  { fontSize: 22, fontWeight: '900', color: colors.text },
  continueBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },

  // Stage 2 map
  mapBg: { ...StyleSheet.absoluteFill, backgroundColor: '#151616' },
  road: {
    position: 'absolute',
    height: 28,
    backgroundColor: '#1e2020',
    borderRadius: 4,
  },
  mapPin: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPinTxt: { fontSize: 16 },

  // Floating header
  floatingHeaderArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  floatingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt: { fontSize: 20, color: colors.text },
  floatingRouteCard: {
    flex: 1,
    backgroundColor: '#212222',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 4,
  },
  floatingPoint:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  floatingDot:     { fontSize: 10 },
  floatingCity:    { fontSize: 13, fontWeight: '900', color: colors.text },
  floatingDivider: { height: 1, backgroundColor: colors.border, marginLeft: 18 },
  floatingBadge: {
    backgroundColor: '#212222',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  floatingBadgeTxt: { fontSize: 13, fontWeight: '900', color: colors.primary },
  floatingBadgeSub: { fontSize: 10, color: colors.muted },

  // Bottom sheet
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingHorizontal: 16,
    maxHeight: '68%',
  },
  dragIndicator: {
    width: 36,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  departureHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  departureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  departureCardActive: { borderColor: colors.primary, backgroundColor: '#1a2010' },
  departureLeft:  { flex: 1, gap: 3 },
  departureTime:  { fontSize: 16, fontWeight: '900', color: colors.text },
  departureSeats: { fontSize: 12, color: colors.muted },
  departureRight: { alignItems: 'flex-end', gap: 3 },
  departurePrice: { fontSize: 16, fontWeight: '900', color: colors.text },
  departurePerPax:{ fontSize: 11, color: colors.muted },
  selectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginLeft: 10,
  },
  emptyBox: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  emptyIcon:  { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyDesc:  { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  changeRouteBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  changeRouteTxt: { fontSize: 14, fontWeight: '700', color: colors.muted },

  // Footer
  footer: { paddingTop: 10, paddingBottom: 28 },
  bookBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },
});
