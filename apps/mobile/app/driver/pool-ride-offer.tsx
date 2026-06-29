import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { useCurrentLocation } from '../../src/hooks/location';
import { colors } from '../../src/config';

type GenderPref = 'male_only' | 'female_only' | 'any';

const GENDER_OPTIONS: { key: GenderPref; label: string; icon: string; desc: string }[] = [
  { key: 'male_only',   label: 'Males only',   icon: '♂', desc: 'Only male passengers' },
  { key: 'female_only', label: 'Females only', icon: '♀', desc: 'Only female passengers' },
  { key: 'any',         label: 'Open to all',  icon: '👥', desc: 'Any gender welcome' },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTIONS = [0, 15, 30, 45];

const RIDE_CATEGORY_OPTIONS = [
  { key: 'bike',    icon: '🏍️', label: 'Bike',    desc: 'Motorcycle' },
  { key: 'mini',    icon: '🚗', label: 'Mini',    desc: 'Hatchback / Alto / Cultus' },
  { key: 'ac',      icon: '❄️', label: 'AC',      desc: 'Air conditioned car' },
  { key: 'comfort', icon: '✨', label: 'Comfort', desc: 'Premium sedan' },
];

// Progressive multiplier — same formula as passenger/pool-ride.tsx
// factor(n) = (48 + (n-1)(n+6)) / 48
// Gives: n=2 → +17%, n=3 → +38%, n=4 → +63% over solo
function calcPerSeatFare(baseFare: number, maxSeats: number): number {
  if (!baseFare || !maxSeats) return 0;
  const factor = (48 + (maxSeats - 1) * (maxSeats + 6)) / 48;
  return Math.ceil((baseFare * factor) / maxSeats);
}

export default function PoolRideOfferScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { coords } = useCurrentLocation();

  const [pickupAddr, setPickupAddr] = useState('');
  const [dropoffAddr, setDropoffAddr] = useState('');
  const [rideCategory, setRideCategory] = useState('mini');
  const [pickupRadius, setPickupRadius] = useState(400);
  const [dropoffRadius, setDropoffRadius] = useState(300);
  const [maxSeats, setMaxSeats] = useState(3);
  const [genderPref, setGenderPref] = useState<GenderPref>('any');
  const [baseFare, setBaseFare] = useState('');
  const [deptHour, setDeptHour] = useState(8);
  const [deptMin, setDeptMin] = useState(0);
  const [deptIsToday, setDeptIsToday] = useState(true);
  const [posting, setPosting] = useState(false);

  const baseFareNum = parseInt(baseFare, 10) || 0;
  const perSeatFare = calcPerSeatFare(baseFareNum, maxSeats);
  const driverEarns = perSeatFare * maxSeats;

  function buildDepartureTime(): Timestamp {
    const d = new Date();
    if (!deptIsToday) d.setDate(d.getDate() + 1);
    d.setHours(deptHour, deptMin, 0, 0);
    return Timestamp.fromDate(d);
  }

  async function postRide() {
    if (!pickupAddr.trim())  { Alert.alert('Required', 'Enter a pickup address.'); return; }
    if (!dropoffAddr.trim()) { Alert.alert('Required', 'Enter a dropoff address.'); return; }
    if (!baseFareNum || baseFareNum < 100) {
      Alert.alert('Invalid fare', 'Enter a base fare of at least 100 PKR.');
      return;
    }
    if (!user) return;

    setPosting(true);
    try {
      // Fetch driver profile for name/vehicle info
      const driverSnap = await getDoc(doc(db, 'drivers', user.uid));
      const profile = driverSnap.data() ?? {};

      const deptTime = buildDepartureTime();

      // Check departure is in the future (at least 5 min)
      if (deptTime.toMillis() - Date.now() < 5 * 60 * 1000) {
        Alert.alert('Invalid time', 'Departure must be at least 5 minutes from now.');
        setPosting(false);
        return;
      }

      await addDoc(collection(db, 'poolRides'), {
        driverId: user.uid,
        driverName: profile.fullName ?? user.displayName ?? 'Driver',
        driverRating: profile.rating ?? 5.0,
        driverVehicle: profile.vehicleLabel ?? 'Sedan',
        driverPlate: profile.plate ?? 'N/A',
        driverGender: profile.gender ?? 'unspecified',
        genderPref,
        rideCategory,
        pickup: {
          lat: coords?.lat ?? 0,
          lng: coords?.lng ?? 0,
          address: pickupAddr.trim(),
        },
        dropoff: {
          lat: coords?.lat ?? 0,
          lng: coords?.lng ?? 0,
          address: dropoffAddr.trim(),
        },
        pickupRadius,
        dropoffRadius,
        maxSeats,
        takenSeats: 0,
        baseFare: baseFareNum,
        perSeatFare,
        departureTime: deptTime,
        status: 'open',
        createdAt: serverTimestamp(),
      });

      Alert.alert(
        'Pool Ride Posted! 🎉',
        `Passengers can now find and book your ride.\nDeparture: ${deptIsToday ? 'Today' : 'Tomorrow'} at ${fmtHM(deptHour, deptMin)}\nPer seat: ${perSeatFare} PKR`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to post. Try again.');
    } finally {
      setPosting(false);
    }
  }

  function fmtHM(h: number, m: number) {
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/driver/home'))}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Offer Pool Ride</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Ride category */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RIDE TYPE</Text>
          <View style={styles.catGrid}>
            {RIDE_CATEGORY_OPTIONS.map((opt) => {
              const active = rideCategory === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[styles.catOpt, active && styles.catOptActive]}
                  onPress={() => setRideCategory(opt.key)}
                >
                  <Text style={styles.catOptIcon}>{opt.icon}</Text>
                  <Text style={[styles.catOptLabel, active && { color: colors.primary }]}>{opt.label}</Text>
                  <Text style={styles.catOptDesc}>{opt.desc}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Route */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ROUTE</Text>
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Pickup area / neighbourhood"
                placeholderTextColor={colors.muted}
                value={pickupAddr}
                onChangeText={setPickupAddr}
              />
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
              <TextInput
                style={styles.routeInput}
                placeholder="Dropoff area / neighbourhood"
                placeholderTextColor={colors.muted}
                value={dropoffAddr}
                onChangeText={setDropoffAddr}
              />
            </View>
          </View>
          <Text style={styles.helperText}>
            Passengers within your set radius of the pickup/drop zone can join your ride.
          </Text>
        </View>

        {/* Pickup & dropoff radius */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PICKUP ZONE RADIUS</Text>
          <Text style={styles.helperText}>
            Set how close passengers must be to your route to board. Max 1 km.
          </Text>
          <View style={styles.radiusCard}>
            <View style={styles.radiusRow}>
              <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
              <Text style={styles.radiusLabel}>Pickup radius</Text>
              <View style={styles.radiusStepper}>
                <Pressable
                  style={styles.radiusBtn}
                  onPress={() => setPickupRadius((v) => Math.max(300, v - 100))}
                >
                  <Text style={styles.radiusBtnText}>−</Text>
                </Pressable>
                <Text style={styles.radiusVal}>{pickupRadius}m</Text>
                <Pressable
                  style={styles.radiusBtn}
                  onPress={() => setPickupRadius((v) => Math.min(1000, v + 100))}
                >
                  <Text style={styles.radiusBtnText}>+</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.radiusRow}>
              <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
              <Text style={styles.radiusLabel}>Dropoff radius</Text>
              <View style={styles.radiusStepper}>
                <Pressable
                  style={styles.radiusBtn}
                  onPress={() => setDropoffRadius((v) => Math.max(300, v - 100))}
                >
                  <Text style={styles.radiusBtnText}>−</Text>
                </Pressable>
                <Text style={styles.radiusVal}>{dropoffRadius}m</Text>
                <Pressable
                  style={styles.radiusBtn}
                  onPress={() => setDropoffRadius((v) => Math.min(1000, v + 100))}
                >
                  <Text style={styles.radiusBtnText}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <View style={styles.radiusHintRow}>
            {[
              { m: 300, label: 'Tight', desc: 'Same street' },
              { m: 500, label: 'Normal', desc: '5 min walk' },
              { m: 1000, label: 'Wide', desc: '~10 min walk' },
            ].map((h) => (
              <View key={h.m} style={styles.radiusHint}>
                <Text style={styles.radiusHintM}>{h.m}m</Text>
                <Text style={styles.radiusHintLabel}>{h.label}</Text>
                <Text style={styles.radiusHintDesc}>{h.desc}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Departure day */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DEPARTURE DAY</Text>
          <View style={styles.dayToggle}>
            {[
              { key: true,  label: 'Today' },
              { key: false, label: 'Tomorrow' },
            ].map((opt) => (
              <Pressable
                key={String(opt.key)}
                style={[styles.dayOpt, deptIsToday === opt.key && styles.dayOptActive]}
                onPress={() => setDeptIsToday(opt.key)}
              >
                <Text style={[styles.dayOptText, deptIsToday === opt.key && styles.dayOptTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Departure time */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DEPARTURE TIME</Text>
          <View style={styles.timeRow}>
            {/* Hour picker */}
            <View style={styles.timePicker}>
              <Pressable
                style={styles.timeBtn}
                onPress={() => setDeptHour((h) => (h + 1) % 24)}
              >
                <Text style={styles.timeBtnText}>▲</Text>
              </Pressable>
              <Text style={styles.timeValue}>{deptHour.toString().padStart(2, '0')}</Text>
              <Pressable
                style={styles.timeBtn}
                onPress={() => setDeptHour((h) => (h + 23) % 24)}
              >
                <Text style={styles.timeBtnText}>▼</Text>
              </Pressable>
            </View>
            <Text style={styles.timeSep}>:</Text>
            {/* Minute picker */}
            <View style={styles.timePicker}>
              <Pressable
                style={styles.timeBtn}
                onPress={() => setDeptMin((m) => MINUTE_OPTIONS[(MINUTE_OPTIONS.indexOf(m) + 1) % MINUTE_OPTIONS.length] ?? 0)}
              >
                <Text style={styles.timeBtnText}>▲</Text>
              </Pressable>
              <Text style={styles.timeValue}>{deptMin.toString().padStart(2, '0')}</Text>
              <Pressable
                style={styles.timeBtn}
                onPress={() => {
                  const idx = MINUTE_OPTIONS.indexOf(deptMin);
                  setDeptMin(MINUTE_OPTIONS[(idx + MINUTE_OPTIONS.length - 1) % MINUTE_OPTIONS.length] ?? 0);
                }}
              >
                <Text style={styles.timeBtnText}>▼</Text>
              </Pressable>
            </View>
            <Text style={styles.timeAmpm}>{deptHour >= 12 ? 'PM' : 'AM'}</Text>
          </View>
        </View>

        {/* Seats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AVAILABLE SEATS FOR PASSENGERS</Text>
          <View style={styles.seatsRow}>
            {[2, 3, 4].map((s) => (
              <Pressable
                key={s}
                style={[styles.seatOpt, maxSeats === s && styles.seatOptActive]}
                onPress={() => setMaxSeats(s)}
              >
                <Text style={styles.seatOptNum}>{s}</Text>
                <Text style={styles.seatOptLabel}>{s === 4 ? 'Full\ncarpool' : 'seats'}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Gender preference */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WHO CAN JOIN?</Text>
          <View style={styles.genderRow}>
            {GENDER_OPTIONS.map((opt) => (
              <Pressable
                key={opt.key}
                style={[styles.genderOpt, genderPref === opt.key && styles.genderOptActive]}
                onPress={() => setGenderPref(opt.key)}
              >
                <Text style={styles.genderIcon}>{opt.icon}</Text>
                <Text style={[styles.genderLabel, genderPref === opt.key && styles.genderLabelActive]}>
                  {opt.label}
                </Text>
                <Text style={styles.genderDesc}>{opt.desc}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Base fare */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SOLO FARE FOR THIS ROUTE (PKR)</Text>
          <Text style={styles.helperText}>
            Enter what you would normally charge for this route alone. We'll calculate the pool price.
          </Text>
          <View style={styles.fareInput}>
            <Text style={styles.farePrefix}>PKR</Text>
            <TextInput
              style={styles.fareField}
              placeholder="e.g. 1200"
              placeholderTextColor={colors.muted}
              value={baseFare}
              onChangeText={(t) => setBaseFare(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
            />
          </View>

          {/* Earnings preview — shows full progression as seats fill */}
          {baseFareNum >= 100 && (
            <View style={styles.earningsCard}>
              <Text style={styles.earningsTitle}>💰 Earnings as seats fill</Text>
              <Text style={styles.earningsSubtitle}>Base: {baseFareNum} PKR solo fare</Text>

              {/* Header row */}
              <View style={[styles.earningsTableRow, styles.earningsTableHeader]}>
                <Text style={[styles.earningsTableCell, styles.earningsColPassengers, styles.earningsHeaderText]}>Passengers</Text>
                <Text style={[styles.earningsTableCell, styles.earningsColSeat, styles.earningsHeaderText]}>Per seat</Text>
                <Text style={[styles.earningsTableCell, styles.earningsColTotal, styles.earningsHeaderText]}>You earn</Text>
              </View>

              {/* Solo row */}
              <View style={styles.earningsTableRow}>
                <Text style={[styles.earningsTableCell, styles.earningsColPassengers, styles.earningsRowText]}>0 (solo)</Text>
                <Text style={[styles.earningsTableCell, styles.earningsColSeat, styles.earningsRowText]}>{baseFareNum} PKR</Text>
                <Text style={[styles.earningsTableCell, styles.earningsColTotal, styles.earningsSoloAmt]}>{baseFareNum} PKR</Text>
              </View>

              {/* n = 1 to maxSeats rows */}
              {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => {
                const seat  = calcPerSeatFare(baseFareNum, n);
                const total = seat * n;
                const gain  = Math.round(((total - baseFareNum) / baseFareNum) * 100);
                const isFull = n === maxSeats;
                return (
                  <View key={n} style={[styles.earningsTableRow, isFull && styles.earningsTableRowFull]}>
                    <View style={[styles.earningsTableCell, styles.earningsColPassengers]}>
                      <Text style={[styles.earningsRowText, isFull && { color: colors.primary }]}>
                        {n} passenger{n > 1 ? 's' : ''}
                      </Text>
                      {isFull && (
                        <Text style={styles.earningsFullTag}>FULL</Text>
                      )}
                    </View>
                    <Text style={[styles.earningsTableCell, styles.earningsColSeat, styles.earningsRowText]}>
                      {seat} PKR
                    </Text>
                    <View style={[styles.earningsTableCell, styles.earningsColTotal]}>
                      <Text style={[styles.earningsTotalAmt, isFull && { color: colors.primary }]}>
                        {total} PKR
                      </Text>
                      <Text style={styles.earningsGainPct}>+{gain}% gain</Text>
                    </View>
                  </View>
                );
              })}

              <View style={styles.earningsDivider} />
              <Text style={styles.earningsNote}>
                Passengers pay less · You earn more · Everyone wins
              </Text>
            </View>
          )}
        </View>

        <Pressable
          style={[styles.postBtn, (posting || !pickupAddr || !dropoffAddr || !baseFareNum) && { opacity: 0.5 }]}
          onPress={postRide}
          disabled={posting || !pickupAddr.trim() || !dropoffAddr.trim() || !baseFareNum}
        >
          {posting
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.postBtnText}>Post Pool Ride →</Text>}
        </Pressable>

        <Text style={styles.legalNote}>
          By posting, you agree to pick up all confirmed passengers within {pickupRadius}m of the origin and drop them within {dropoffRadius}m of their destination.
        </Text>
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
  backBtn: { width: 40 },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },

  container: { padding: 16, gap: 4, paddingBottom: 32 },
  section: { gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  helperText: { fontSize: 12, color: colors.muted, lineHeight: 17 },

  // Category grid
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catOpt: {
    width: '47%',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  catOptActive: { borderColor: colors.primary, backgroundColor: '#0e1e08' },
  catOptIcon: { fontSize: 24 },
  catOptLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  catOptDesc: { fontSize: 10, color: colors.muted, fontWeight: '600' },

  // Route card
  routeCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  routeInput: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  routeDivider: { height: 1, backgroundColor: colors.border, marginLeft: 34 },

  // Day toggle
  dayToggle: { flexDirection: 'row', gap: 10 },
  dayOpt: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOptActive: { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  dayOptText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  dayOptTextActive: { color: colors.primary },

  // Time picker
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timePicker: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 4,
  },
  timeBtn: { paddingHorizontal: 12, paddingVertical: 4 },
  timeBtnText: { fontSize: 14, color: colors.muted, fontWeight: '700' },
  timeValue: { fontSize: 32, fontWeight: '900', color: colors.text, width: 56, textAlign: 'center' },
  timeSep: { fontSize: 28, fontWeight: '900', color: colors.text, marginBottom: 6 },
  timeAmpm: { fontSize: 18, fontWeight: '800', color: colors.muted, marginBottom: 4 },

  // Seats
  seatsRow: { flexDirection: 'row', gap: 10 },
  seatOpt: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  seatOptActive: { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  seatOptNum: { fontSize: 28, fontWeight: '900', color: colors.text },
  seatOptLabel: { fontSize: 10, color: colors.muted, textAlign: 'center', fontWeight: '600' },

  // Gender
  genderRow: { gap: 8 },
  genderOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  genderOptActive: { borderColor: colors.primary, backgroundColor: '#1c2c0a' },
  genderIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  genderLabel: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  genderLabelActive: { color: colors.primary },
  genderDesc: { fontSize: 11, color: colors.muted, fontWeight: '600' },

  // Fare
  fareInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    height: 52,
    gap: 8,
  },
  farePrefix: { fontSize: 14, fontWeight: '700', color: colors.muted },
  fareField: { flex: 1, fontSize: 22, fontWeight: '900', color: colors.text },

  earningsCard: {
    backgroundColor: '#0d1a06',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    overflow: 'hidden',
    gap: 0,
  },
  earningsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 2,
  },
  earningsSubtitle: {
    fontSize: 11,
    color: colors.muted,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  earningsTableHeader: {
    backgroundColor: '#0f1a08',
    paddingVertical: 7,
  },
  earningsHeaderText: {
    fontSize: 9,
    fontWeight: '900',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  earningsTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#0f1a08',
  },
  earningsTableRowFull: { backgroundColor: '#101f07' },
  earningsTableCell: { paddingHorizontal: 0 },
  earningsColPassengers: { flex: 1.3 },
  earningsColSeat:       { flex: 1 },
  earningsColTotal:      { flex: 1.1, alignItems: 'flex-end' },
  earningsRowText: { fontSize: 12, fontWeight: '600', color: colors.text },
  earningsSoloAmt: { fontSize: 12, fontWeight: '700', color: colors.muted },
  earningsFullTag: {
    fontSize: 8,
    fontWeight: '900',
    color: colors.primary,
    backgroundColor: `${colors.primary}20`,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  earningsTotalAmt: { fontSize: 13, fontWeight: '900', color: '#fbbf24' },
  earningsGainPct: { fontSize: 9, fontWeight: '700', color: '#fbbf24', opacity: 0.8 },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  earningsLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  earningsVal: { fontSize: 13, color: colors.text, fontWeight: '800' },
  earningsDivider: { height: 1, backgroundColor: '#0f1a08', marginHorizontal: 0 },
  earningsNote: {
    fontSize: 11,
    color: colors.muted,
    lineHeight: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#0f1a08',
    fontStyle: 'italic',
  },

  // Radius stepper
  radiusCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  radiusLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  radiusStepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radiusBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radiusBtnText: { fontSize: 18, color: colors.primary, fontWeight: '900', lineHeight: 22 },
  radiusVal: { fontSize: 15, fontWeight: '900', color: colors.text, minWidth: 60, textAlign: 'center' },
  radiusHintRow: { flexDirection: 'row', gap: 8 },
  radiusHint: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    alignItems: 'center',
    gap: 2,
  },
  radiusHintM: { fontSize: 13, fontWeight: '900', color: colors.text },
  radiusHintLabel: { fontSize: 10, fontWeight: '700', color: colors.primary },
  radiusHintDesc: { fontSize: 9, color: colors.muted, fontWeight: '600' },

  postBtn: {
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  postBtnText: { color: '#000', fontSize: 17, fontWeight: '900' },
  legalNote: { fontSize: 11, color: colors.muted, textAlign: 'center', lineHeight: 16 },
});
