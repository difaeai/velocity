import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { api } from '../../src/api/client';
import {
  PAKISTAN_CITIES,
  POPULAR_CITY_IDS,
  IntercityCity,
  IntercityTrip,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPE_ICONS,
} from '../../src/domain/intercityTypes';

// Days available for selection
function buildDays() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    days.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' }),
      shortLabel: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-PK', { weekday: 'short' }),
      dayLabel: i < 2 ? '' : d.toLocaleDateString('en-PK', { day: 'numeric' }),
      date: d,
      ts: d.getTime(),
    });
  }
  return days;
}

const DAYS = buildDays();

function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function formatDuration(depMs: number, arrMs?: number) {
  if (!arrMs) return '';
  const h = Math.floor((arrMs - depMs) / 3_600_000);
  const m = Math.round(((arrMs - depMs) % 3_600_000) / 60_000);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function seatsLeft(trip: IntercityTrip) { return trip.totalSeats - trip.bookedSeats; }

// ── City Picker Modal ─────────────────────────────────────────────────────────

function CityPickerModal({
  visible, title, exclude, onSelect, onClose,
}: {
  visible: boolean; title: string; exclude?: string;
  onSelect: (city: IntercityCity) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) { setSearch(''); setTimeout(() => inputRef.current?.focus(), 300); }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PAKISTAN_CITIES.filter(c => c.id !== exclude && (!q || c.name.toLowerCase().includes(q) || c.province.toLowerCase().includes(q)));
  }, [search, exclude]);

  const popular = useMemo(
    () => PAKISTAN_CITIES.filter(c => c.id !== exclude && POPULAR_CITY_IDS.includes(c.id)),
    [exclude],
  );

  // Group by province
  const grouped = useMemo(() => {
    const g: Record<string, IntercityCity[]> = {};
    for (const c of filtered) {
      if (!g[c.province]) g[c.province] = [];
      g[c.province]!.push(c);
    }
    return g;
  }, [filtered]);

  const sections = useMemo(() => {
    const items: ({ type: 'header'; province: string } | { type: 'city'; city: IntercityCity })[] = [];
    for (const [province, cities] of Object.entries(grouped)) {
      items.push({ type: 'header', province });
      cities.forEach(city => items.push({ type: 'city', city }));
    }
    return items;
  }, [grouped]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={modal.safe}>
        {/* Header */}
        <View style={modal.header}>
          <Pressable onPress={onClose} style={modal.closeBtn}>
            <Text style={modal.closeTxt}>✕</Text>
          </Pressable>
          <Text style={modal.title}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Search */}
        <View style={modal.searchRow}>
          <Text style={modal.searchIcon}>🔍</Text>
          <TextInput
            ref={inputRef}
            style={modal.searchInput}
            placeholder="Search city or province…"
            placeholderTextColor={colors.muted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Text style={modal.clearBtn}>✕</Text>
            </Pressable>
          )}
        </View>

        {/* Popular (shown when no search) */}
        {!search && (
          <View style={modal.popularSection}>
            <Text style={modal.sectionLabel}>POPULAR</Text>
            <View style={modal.popularGrid}>
              {popular.map(c => (
                <Pressable key={c.id} style={modal.popularChip} onPress={() => onSelect(c)}>
                  <Text style={modal.popularChipText}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Full list */}
        <FlatList
          data={sections}
          keyExtractor={(item, i) => item.type === 'header' ? `h_${item.province}` : `c_${item.city.id}_${i}`}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return <Text style={modal.provinceHeader}>{item.province.toUpperCase()}</Text>;
            }
            return (
              <Pressable style={modal.cityRow} onPress={() => onSelect(item.city)}>
                <Text style={modal.cityName}>{item.city.name}</Text>
                <Text style={modal.cityProvince}>{item.city.province}</Text>
              </Pressable>
            );
          }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={modal.emptyBox}>
              <Text style={modal.emptyText}>No cities match "{search}"</Text>
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CityToCityScreen() {
  const router     = useRouter();
  const { user }   = useAuth();
  const [stage, setStage]         = useState<'route' | 'trips'>('route');
  const [fromCity, setFromCity]   = useState<IntercityCity | null>(null);
  const [toCity, setToCity]       = useState<IntercityCity | null>(null);
  const [dayIdx, setDayIdx]       = useState(0);
  const [passengers, setPassengers] = useState(1);
  const [showFrom, setShowFrom]   = useState(false);
  const [showTo, setShowTo]       = useState(false);

  // Stage 2
  const [trips, setTrips]         = useState<IntercityTrip[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [booking, setBooking]     = useState(false);
  const [payMethod, setPayMethod] = useState<'cash' | 'wallet'>('cash');

  const selectedDay = DAYS[dayIdx]!;

  // Load trips when entering stage 2
  useEffect(() => {
    if (stage !== 'trips' || !fromCity || !toCity) return;
    setLoadingTrips(true);
    setSelectedTripId(null);

    const startOfDay = selectedDay.ts;
    const endOfDay   = startOfDay + 86_400_000;

    const q = query(
      collection(db, 'intercityTrips'),
      where('fromCityId', '==', fromCity.id),
      where('toCityId',   '==', toCity.id),
      where('status',     'in', ['scheduled', 'boarding']),
    );

    const unsub = onSnapshot(q, snap => {
      const raw = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as IntercityTrip))
        .filter(t => t.departureTime >= startOfDay && t.departureTime < endOfDay && seatsLeft(t) >= passengers)
        .sort((a, b) => a.departureTime - b.departureTime);
      setTrips(raw);
      setLoadingTrips(false);
    }, () => setLoadingTrips(false));

    return unsub;
  }, [stage, fromCity?.id, toCity?.id, selectedDay.ts, passengers]);

  function swapCities() {
    const tmp = fromCity;
    setFromCity(toCity);
    setToCity(tmp);
    setSelectedTripId(null);
  }

  async function bookSeats() {
    if (!selectedTripId || !user) return;
    const trip = trips.find(t => t.id === selectedTripId);
    if (!trip) return;

    setBooking(true);
    try {
      const res = await api.createIntercityBooking({
        tripId: selectedTripId,
        seatsBooked: passengers,
        paymentMethod: payMethod,
      });
      router.replace(`/passenger/intercity-trip/${res.bookingId}`);
    } catch (e: unknown) {
      Alert.alert('Booking Failed', (e as { message?: string }).message ?? 'Please try again.');
      setBooking(false);
    }
  }

  const selectedTrip = trips.find(t => t.id === selectedTripId);
  const totalFare    = selectedTrip ? selectedTrip.farePerSeat * passengers : null;

  // ── Stage 1: Route selection ───────────────────────────────────────────────
  if (stage === 'route') {
    return (
      <SafeAreaView style={styles.safe}>
        <CityPickerModal
          visible={showFrom}
          title="Select Origin"
          exclude={toCity?.id}
          onSelect={c => { setFromCity(c); setShowFrom(false); setSelectedTripId(null); }}
          onClose={() => setShowFrom(false)}
        />
        <CityPickerModal
          visible={showTo}
          title="Select Destination"
          exclude={fromCity?.id}
          onSelect={c => { setToCity(c); setShowTo(false); setSelectedTripId(null); }}
          onClose={() => setShowTo(false)}
        />

        <View style={styles.header}>
          <Pressable
            style={styles.closeBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          >
            <Text style={styles.closeTxt}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>City to City</Text>
          <Pressable onPress={() => router.push('/passenger/intercity-activity')}>
            <Text style={styles.myTripsLink}>My Trips</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
          {/* FROM / TO */}
          <View style={styles.routeBox}>
            <Pressable style={styles.citySelector} onPress={() => setShowFrom(true)}>
              <Text style={styles.citySelectorLabel}>FROM</Text>
              {fromCity
                ? <Text style={styles.citySelectorValue}>{fromCity.name}</Text>
                : <Text style={styles.citySelectorPlaceholder}>Select city</Text>}
              {fromCity && <Text style={styles.citySelectorProv}>{fromCity.province}</Text>}
            </Pressable>

            <Pressable style={styles.swapBtn} onPress={swapCities}>
              <Text style={styles.swapIcon}>⇄</Text>
            </Pressable>

            <Pressable style={styles.citySelector} onPress={() => setShowTo(true)}>
              <Text style={styles.citySelectorLabel}>TO</Text>
              {toCity
                ? <Text style={styles.citySelectorValue}>{toCity.name}</Text>
                : <Text style={styles.citySelectorPlaceholder}>Select city</Text>}
              {toCity && <Text style={styles.citySelectorProv}>{toCity.province}</Text>}
            </Pressable>
          </View>

          {/* Date picker */}
          <View>
            <Text style={styles.sectionLabel}>DATE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
                {DAYS.map((d, i) => (
                  <Pressable
                    key={i}
                    style={[styles.dayChip, i === dayIdx && styles.dayChipActive]}
                    onPress={() => { setDayIdx(i); setSelectedTripId(null); }}
                  >
                    <Text style={[styles.dayChipTop, i === dayIdx && { color: '#000' }]}>{d.shortLabel}</Text>
                    {d.dayLabel ? <Text style={[styles.dayChipBottom, i === dayIdx && { color: '#000' }]}>{d.dayLabel}</Text> : null}
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Passengers */}
          <View style={styles.passengerRow}>
            <Text style={styles.sectionLabel}>PASSENGERS</Text>
            <View style={styles.counterRow}>
              <Pressable style={styles.counterBtn} onPress={() => setPassengers(p => Math.max(1, p - 1))}>
                <Text style={styles.counterBtnTxt}>−</Text>
              </Pressable>
              <Text style={styles.counterValue}>{passengers}</Text>
              <Pressable style={styles.counterBtn} onPress={() => setPassengers(p => Math.min(6, p + 1))}>
                <Text style={styles.counterBtnTxt}>+</Text>
              </Pressable>
            </View>
          </View>

          {/* Payment method */}
          <View>
            <Text style={styles.sectionLabel}>PAYMENT</Text>
            <View style={[styles.counterRow, { gap: 10, marginTop: 8 }]}>
              {(['cash', 'wallet'] as const).map(m => (
                <Pressable
                  key={m}
                  style={[styles.payBtn, payMethod === m && styles.payBtnActive]}
                  onPress={() => setPayMethod(m)}
                >
                  <Text style={[styles.payBtnTxt, payMethod === m && { color: colors.primary }]}>
                    {m === 'cash' ? '💵 Cash' : '💳 Wallet'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            style={[styles.searchBtn, (!fromCity || !toCity || fromCity.id === toCity.id) && { opacity: 0.4 }]}
            onPress={() => {
              if (!fromCity || !toCity) { Alert.alert('Select cities', 'Please select both origin and destination.'); return; }
              if (fromCity.id === toCity.id) { Alert.alert('Invalid route', 'Origin and destination must be different.'); return; }
              setStage('trips');
            }}
          >
            <Text style={styles.searchBtnTxt}>Search Trips →</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Stage 2: Available trips ───────────────────────────────────────────────
  return (
    <View style={styles.safe}>
      {/* Abstract map background */}
      <View style={styles.mapBg}>
        {[{ top: 120, rotate: '-6deg' }, { top: 260, rotate: '12deg' }, { top: 420, rotate: '-3deg' }].map((r, i) => (
          <View key={i} style={[styles.road, { top: r.top, transform: [{ rotate: r.rotate }] }]} />
        ))}
        <View style={[styles.mapPin, { top: 140, left: 60 }]}><Text style={styles.mapPinTxt}>📍</Text></View>
        <View style={[styles.mapPin, { top: 300, left: 240 }]}><Text style={styles.mapPinTxt}>📍</Text></View>
      </View>

      {/* Floating header */}
      <SafeAreaView style={styles.floatArea} pointerEvents="box-none">
        <View style={styles.floatBar}>
          <Pressable style={styles.backBtn} onPress={() => { setStage('route'); setTrips([]); }}>
            <Text style={styles.backTxt}>←</Text>
          </Pressable>
          <View style={styles.floatRoute}>
            <View style={styles.floatPoint}>
              <View style={styles.floatDotGreen} />
              <Text style={styles.floatCity}>{fromCity!.name}</Text>
            </View>
            <View style={styles.floatLine} />
            <View style={styles.floatPoint}>
              <View style={styles.floatDotRed} />
              <Text style={styles.floatCity}>{toCity!.name}</Text>
            </View>
          </View>
          <View style={styles.floatBadge}>
            <Text style={styles.floatBadgePax}>{passengers} pax</Text>
            <Text style={styles.floatBadgeDay}>{selectedDay.shortLabel}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom sheet */}
      <View style={styles.sheet}>
        <View style={styles.dragIndicator} />

        {loadingTrips ? (
          <View style={styles.sheetCenter}><ActivityIndicator color={colors.primary} size="large" /></View>
        ) : trips.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>🚌</Text>
            <Text style={styles.emptyTitle}>No trips available</Text>
            <Text style={styles.emptyDesc}>
              No scheduled trips for {fromCity!.name} → {toCity!.name}{'\n'}on {selectedDay.label}.{'\n'}Try a different date.
            </Text>
            <Pressable style={styles.changeBtn} onPress={() => { setStage('route'); setTrips([]); }}>
              <Text style={styles.changeBtnTxt}>Change Route / Date</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.sheetHeader}>DEPARTURES · {trips.length} trip{trips.length > 1 ? 's' : ''} available</Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {trips.map(trip => {
                const left   = seatsLeft(trip);
                const isSelected = selectedTripId === trip.id;
                const fare   = trip.farePerSeat * passengers;
                return (
                  <Pressable
                    key={trip.id}
                    style={[styles.tripCard, isSelected && styles.tripCardActive]}
                    onPress={() => setSelectedTripId(isSelected ? null : trip.id)}
                  >
                    <View style={styles.tripCardTop}>
                      <View style={styles.tripTimeBlock}>
                        <Text style={[styles.tripTime, isSelected && { color: colors.primary }]}>
                          {formatTime(trip.departureTime)}
                        </Text>
                        {trip.estimatedArrivalTime && (
                          <Text style={styles.tripArrival}>→ {formatTime(trip.estimatedArrivalTime)}</Text>
                        )}
                        <Text style={styles.tripDuration}>{formatDuration(trip.departureTime, trip.estimatedArrivalTime)}</Text>
                      </View>
                      <View style={styles.tripMeta}>
                        <Text style={styles.tripVehicle}>
                          {VEHICLE_TYPE_ICONS[trip.vehicleType]}{'  '}{VEHICLE_TYPE_LABELS[trip.vehicleType]}
                        </Text>
                        <Text style={styles.tripOperator}>{trip.operatorName}</Text>
                        <Text style={[styles.tripSeats, left <= 3 && { color: '#f59e0b' }]}>
                          {left} seat{left !== 1 ? 's' : ''} left
                        </Text>
                      </View>
                      <View style={styles.tripFareBlock}>
                        <Text style={[styles.tripFare, isSelected && { color: colors.primary }]}>
                          {fare.toLocaleString()} PKR
                        </Text>
                        <Text style={styles.tripFareSub}>for {passengers} pax</Text>
                        <Text style={styles.tripFarePerSeat}>{trip.farePerSeat.toLocaleString()}/seat</Text>
                      </View>
                    </View>
                    {(trip.pickupPoint || trip.dropoffPoint) && (
                      <View style={styles.tripPoints}>
                        {trip.pickupPoint  && <Text style={styles.tripPointTxt} numberOfLines={1}>📍 {trip.pickupPoint}</Text>}
                        {trip.dropoffPoint && <Text style={styles.tripPointTxt} numberOfLines={1}>🏁 {trip.dropoffPoint}</Text>}
                      </View>
                    )}
                    {trip.status === 'boarding' && (
                      <View style={styles.boardingBadge}><Text style={styles.boardingTxt}>BOARDING NOW</Text></View>
                    )}
                    {isSelected && <View style={styles.selectedCheck}><Text style={styles.selectedCheckTxt}>✓</Text></View>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Book footer */}
        {selectedTripId && (
          <View style={styles.footer}>
            <Pressable
              style={[styles.bookBtn, booking && { opacity: 0.6 }]}
              onPress={bookSeats}
              disabled={booking}
            >
              {booking
                ? <ActivityIndicator color="#000" />
                : <Text style={styles.bookBtnTxt}>
                    Book {passengers} Seat{passengers > 1 ? 's' : ''} · {totalFare?.toLocaleString()} PKR
                  </Text>}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeTxt: { fontSize: 22, color: colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  myTripsLink: { fontSize: 13, fontWeight: '700', color: colors.primary },

  routeBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  citySelector: { flex: 1, gap: 3 },
  citySelectorLabel: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.5 },
  citySelectorValue: { fontSize: 18, fontWeight: '900', color: colors.text },
  citySelectorPlaceholder: { fontSize: 15, fontWeight: '700', color: colors.muted },
  citySelectorProv: { fontSize: 11, color: colors.muted },
  swapBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  swapIcon: { fontSize: 18, color: colors.primary },

  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  dayChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', minWidth: 68 },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipTop: { fontSize: 12, fontWeight: '800', color: colors.text },
  dayChipBottom: { fontSize: 11, color: colors.muted, marginTop: 1 },

  passengerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  counterBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  counterBtnTxt: { fontSize: 20, color: colors.text, lineHeight: 24 },
  counterValue: { fontSize: 22, fontWeight: '900', color: colors.text, minWidth: 28, textAlign: 'center' },

  payBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  payBtnActive: { borderColor: colors.primary, backgroundColor: '#1a2010' },
  payBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.muted },

  searchBtn: { height: 54, backgroundColor: colors.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  searchBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },

  // Stage 2 map
  mapBg: { ...StyleSheet.absoluteFill, backgroundColor: '#151616' },
  road: { position: 'absolute', left: -50, width: '120%', height: 28, backgroundColor: '#1e2020', borderRadius: 4 },
  mapPin: { position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: '#212222', alignItems: 'center', justifyContent: 'center' },
  mapPinTxt: { fontSize: 14 },

  floatArea: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  floatBar:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  backBtn:   { width: 40, height: 40, borderRadius: 20, backgroundColor: '#212222', alignItems: 'center', justifyContent: 'center' },
  backTxt:   { fontSize: 20, color: colors.text },
  floatRoute: { flex: 1, backgroundColor: '#212222', borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, gap: 4 },
  floatPoint: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  floatDotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  floatDotRed:   { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  floatLine:  { height: 1, backgroundColor: colors.border, marginLeft: 16 },
  floatCity:  { fontSize: 13, fontWeight: '900', color: colors.text },
  floatBadge: { backgroundColor: '#212222', borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  floatBadgePax: { fontSize: 13, fontWeight: '900', color: colors.primary },
  floatBadgeDay: { fontSize: 10, color: colors.muted },

  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, paddingHorizontal: 16, maxHeight: '70%' },
  dragIndicator: { width: 36, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetCenter: { height: 200, alignItems: 'center', justifyContent: 'center' },
  sheetHeader: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginBottom: 10 },

  tripCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
  tripCardActive: { borderColor: colors.primary, backgroundColor: '#1a2010' },
  tripCardTop: { flexDirection: 'row', gap: 10 },
  tripTimeBlock: { width: 72, gap: 2 },
  tripTime: { fontSize: 15, fontWeight: '900', color: colors.text },
  tripArrival: { fontSize: 11, color: colors.muted },
  tripDuration: { fontSize: 10, color: colors.muted, marginTop: 2 },
  tripMeta: { flex: 1, gap: 2 },
  tripVehicle: { fontSize: 13, fontWeight: '700', color: colors.text },
  tripOperator: { fontSize: 12, color: colors.muted },
  tripSeats: { fontSize: 12, color: colors.muted },
  tripFareBlock: { alignItems: 'flex-end', gap: 2 },
  tripFare: { fontSize: 15, fontWeight: '900', color: colors.text },
  tripFareSub: { fontSize: 11, color: colors.muted },
  tripFarePerSeat: { fontSize: 10, color: colors.muted },
  tripPoints: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  tripPointTxt: { fontSize: 11, color: colors.muted },
  boardingBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: '#f59e0b22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#f59e0b50' },
  boardingTxt: { fontSize: 10, fontWeight: '900', color: '#f59e0b', letterSpacing: 0.5 },
  selectedCheck: { position: 'absolute', bottom: 10, right: 12 },
  selectedCheckTxt: { fontSize: 16, color: colors.primary, fontWeight: '900' },

  emptyBox: { alignItems: 'center', padding: 24, gap: 10 },
  emptyIcon: { fontSize: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptyDesc: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  changeBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginTop: 4 },
  changeBtnTxt: { fontSize: 14, fontWeight: '700', color: colors.muted },

  footer: { paddingTop: 10, paddingBottom: 28 },
  bookBtn: { height: 54, backgroundColor: colors.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bookBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },
});

const modal = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeTxt: { fontSize: 20, color: colors.text },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  searchRow: { flexDirection: 'row', alignItems: 'center', margin: 16, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, fontSize: 15, color: colors.text },
  clearBtn: { fontSize: 14, color: colors.muted, padding: 4 },
  popularSection: { paddingHorizontal: 16, marginBottom: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginBottom: 8 },
  popularGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  popularChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.primary + '60', backgroundColor: '#1a2010' },
  popularChipText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  provinceHeader: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.5, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.background },
  cityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  cityName: { fontSize: 15, fontWeight: '700', color: colors.text },
  cityProvince: { fontSize: 12, color: colors.muted },
  emptyBox: { alignItems: 'center', padding: 32 },
  emptyText: { fontSize: 14, color: colors.muted },
});
