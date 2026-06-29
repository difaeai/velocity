import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { useAuth } from '../../src/auth/AuthContext';
import { useCurrentLocation } from '../../src/hooks/location';
import { colors } from '../../src/config';
import { ChatModal } from '../../src/ui/ChatModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type PoolGenderPref = 'male_only' | 'female_only' | 'any';
type Step = 'browse' | 'detail' | 'confirmed';

interface PoolRide {
  id: string;
  driverId: string;
  driverName: string;
  driverRating: number;
  driverVehicle: string;
  driverPlate: string;
  driverGender: string;
  genderPref: PoolGenderPref;
  rideCategory?: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  pickupRadius: number;
  dropoffRadius: number;
  maxSeats: number;
  takenSeats: number;
  perSeatFare: number;
  baseFare: number;
  departureTime: Timestamp;
  boardingStartedAt?: Timestamp;
  status: string;
}

// ── Fare formula (progressive multiplier) ─────────────────────────────────────
// factor(n) = (48 + (n-1)(n+6)) / 48
// n=2 → +17%, n=3 → +38%, n=4 → +63% driver gain vs solo

export const POOL_EXAMPLE_SOLO = 1200;

export function poolFactor(n: number): number {
  return (48 + (n - 1) * (n + 6)) / 48;
}
export function poolPerSeat(soloFare: number, n: number): number {
  return Math.ceil((soloFare * poolFactor(n)) / n);
}
export function poolDriverTotal(soloFare: number, n: number): number {
  return poolPerSeat(soloFare, n) * n;
}

interface FareRow {
  n: number;
  perSeat: number;
  driverTotal: number;
  passengerSavePct: number;
  driverGainPct: number;
}
export function fareBreakdown(soloFare: number): FareRow[] {
  return [1, 2, 3, 4].map((n) => {
    const perSeat     = poolPerSeat(soloFare, n);
    const driverTotal = poolDriverTotal(soloFare, n);
    return {
      n,
      perSeat,
      driverTotal,
      passengerSavePct: Math.round((1 - perSeat / soloFare) * 100),
      driverGainPct:    Math.round((driverTotal / soloFare - 1) * 100),
    };
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_NEARBY_KM = 1.0;

interface RideCategory {
  key: string;
  icon: string;
  label: string;
  exampleFare: number;
  desc: string;
}
const RIDE_CATEGORIES: RideCategory[] = [
  { key: 'all',     icon: '🚗', label: 'All',     exampleFare: 500,  desc: 'All cars' },
  { key: 'mini',    icon: '🚙', label: 'Mini',    exampleFare: 400,  desc: 'Hatchback · No AC' },
  { key: 'ac',      icon: '❄️', label: 'AC',      exampleFare: 600,  desc: 'Air conditioned' },
  { key: 'comfort', icon: '🚘', label: 'Comfort', exampleFare: 800,  desc: 'Premium sedan' },
];

const GENDER_META: Record<PoolGenderPref, { label: string; color: string; icon: string }> = {
  male_only:   { label: 'Males only',   color: '#3b82f6', icon: '♂' },
  female_only: { label: 'Females only', color: '#ec4899', icon: '♀' },
  any:         { label: 'Open to all',  color: '#10b981', icon: '👥' },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function distKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtTime(ts: Timestamp): string {
  const d    = ts.toDate();
  const h    = d.getHours();
  const m    = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function fmtDay(ts: Timestamp): string {
  const d    = ts.toDate();
  const today = new Date();
  const tmrw  = new Date(today);
  tmrw.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tmrw.toDateString())  return 'Tomorrow';
  return d.toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtRelativeDeparture(ts: Timestamp): string {
  const diffMs  = ts.toMillis() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0)   return 'Departing now';
  if (diffMin < 60)   return `in ${diffMin} min`;
  if (diffMin < 1440) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `${fmtDay(ts)} · ${fmtTime(ts)}`;
}

interface BoardingStatus { label: string; color: string; minsLeft: number }

function getBoardingStatus(ride: PoolRide): BoardingStatus | null {
  if (ride.takenSeats === 0) return null;
  if (!ride.boardingStartedAt) {
    return { label: 'Boarding now', color: '#f59e0b', minsLeft: 10 };
  }
  const elapsed   = Date.now() - ride.boardingStartedAt.toMillis();
  const remaining = 10 * 60 * 1000 - elapsed;
  if (remaining <= 0) return { label: 'Departing soon', color: '#ef4444', minsLeft: 0 };
  const mins = Math.ceil(remaining / 60000);
  return { label: `Boarding · ${mins} min left`, color: '#f59e0b', minsLeft: mins };
}

// ── PoolRideCard ──────────────────────────────────────────────────────────────

function PoolRideCard({ ride, onJoin }: { ride: PoolRide; onJoin: () => void }) {
  const meta      = GENDER_META[ride.genderPref] ?? GENDER_META.any;
  const avail     = ride.maxSeats - ride.takenSeats;
  const boarding  = getBoardingStatus(ride);
  const isBoarding = !!boarding;
  const catMeta   = RIDE_CATEGORIES.find((c) => c.key === ride.rideCategory);

  return (
    <Pressable style={styles.rideCard} onPress={onJoin}>
      {/* Status strip */}
      <View style={[styles.statusStrip, { backgroundColor: isBoarding ? '#1c1200' : '#0a1a06' }]}>
        <View style={[styles.statusPip, { backgroundColor: isBoarding ? boarding!.color : '#22c55e' }]} />
        <Text style={[styles.statusLabel, { color: isBoarding ? boarding!.color : '#22c55e' }]}>
          {isBoarding ? boarding!.label : `Open · ${avail} seat${avail !== 1 ? 's' : ''} free`}
        </Text>
        {catMeta && (
          <View style={styles.catBadge}>
            <Text style={styles.catBadgeText}>{catMeta.icon} {catMeta.label}</Text>
          </View>
        )}
        <View style={styles.deptChip}>
          <Text style={styles.deptChipText}>{fmtRelativeDeparture(ride.departureTime)}</Text>
        </View>
      </View>

      <View style={styles.rideCardBody}>
        {/* Driver row */}
        <View style={styles.driverRow}>
          <View style={styles.driverAvatar}>
            <Text style={styles.driverAvatarText}>{ride.driverName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.driverName}>{ride.driverName}</Text>
            <Text style={styles.vehicleText}>{ride.driverVehicle} · {ride.driverPlate}</Text>
          </View>
          <View style={styles.ratingChip}>
            <Text style={styles.ratingText}>★ {ride.driverRating.toFixed(1)}</Text>
          </View>
        </View>

        {/* Route block */}
        <View style={styles.routeBlock}>
          {/* Pickup */}
          <View style={styles.routeRowFull}>
            <View style={styles.routeIconCol}>
              <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
              <View style={styles.routeStem} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeAddr} numberOfLines={1}>{ride.pickup.address}</Text>
              <Text style={styles.routeZone}>Pickup within {ride.pickupRadius}m</Text>
            </View>
          </View>
          {/* Dropoff */}
          <View style={styles.routeRowFull}>
            <View style={styles.routeIconCol}>
              <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeAddr} numberOfLines={1}>{ride.dropoff.address}</Text>
              <Text style={styles.routeZone}>Drop within {ride.dropoffRadius}m</Text>
            </View>
          </View>
        </View>

        {/* Seats visualisation */}
        <View style={styles.seatsRow}>
          <View style={styles.seatPips}>
            {Array.from({ length: ride.maxSeats }, (_, i) => {
              const filled = i < ride.takenSeats;
              return (
                <View key={i} style={[styles.seatPip, filled ? styles.seatFilled : styles.seatEmpty]}>
                  <Text style={[styles.seatPipIcon, filled ? styles.seatIconFilled : styles.seatIconEmpty]}>
                    {filled ? '👤' : '+'}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.seatsMeta}>
            {ride.takenSeats > 0
              ? `${ride.takenSeats} joined · ${avail} free`
              : `${avail} seat${avail !== 1 ? 's' : ''} available`}
          </Text>
        </View>

        {/* Boarding note if active */}
        {isBoarding && (
          <View style={[styles.boardingNote, { borderColor: boarding!.color + '40' }]}>
            <Text style={[styles.boardingNoteText, { color: boarding!.color }]}>
              ⏱ Driver waits up to 10 min for all passengers to board
              {boarding!.minsLeft > 0 ? ` · ${boarding!.minsLeft} min remaining` : ''}
            </Text>
          </View>
        )}

        {/* Card footer */}
        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.fareAmt}>
              {ride.perSeatFare}
              <Text style={styles.fareSub}> PKR/seat</Text>
            </Text>
            <View style={[styles.genderBadge, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}40` }]}>
              <Text style={[styles.genderBadgeText, { color: meta.color }]}>
                {meta.icon} {meta.label}
              </Text>
            </View>
          </View>
          <Pressable style={styles.joinBtn} onPress={onJoin}>
            <Text style={styles.joinBtnText}>Join →</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function PoolRideScreen() {
  const router = useRouter();
  const { user }                                         = useAuth();
  const { coords, address: pickupAddress }               = useCurrentLocation();

  const [step, setStep]               = useState<Step>('browse');
  const [destination, setDestination] = useState('');
  const [genderPref, setGenderPref]   = useState<'same' | 'any'>('same');
  const [userGender, setUserGender]   = useState('unspecified');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [allRides, setAllRides]       = useState<PoolRide[]>([]);
  const [loadingRides, setLoadingRides] = useState(true);
  const [selected, setSelected]       = useState<PoolRide | null>(null);
  const [booking, setBooking]             = useState(false);
  const [showFareTable, setShowFareTable] = useState(false);
  const [destForBooking, setDestForBooking] = useState('');
  // Confirmed booking state — subscribe to real-time status updates
  const [bookingStatus, setBookingStatus] = useState<string>('confirmed');
  const [chatOpen, setChatOpen]           = useState(false);

  // Load user gender from profile
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        const g = snap.data()?.gender as string | undefined;
        if (g) setUserGender(g);
      })
      .catch(() => {});
  }, [user]);

  // Real-time booking status — shows driver_arrived / picked_up banners
  useEffect(() => {
    if (step !== 'confirmed' || !selected || !user) return;
    const ref = doc(db, 'poolRides', selected.id, 'passengers', user.uid);
    return onSnapshot(ref, (snap) => {
      const status = snap.get('status') as string | undefined;
      if (status) setBookingStatus(status);
    });
  }, [step, selected?.id, user?.uid]);

  // Real-time nearby rides subscription
  useEffect(() => {
    const q = query(
      collection(db, 'poolRides'),
      where('status', 'in', ['open', 'collecting']),
      orderBy('departureTime', 'asc'),
      limit(25),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        let rides: PoolRide[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PoolRide);

        // 1km proximity filter
        if (coords) {
          rides = rides.filter(
            (r) => r.pickup?.lat && distKm(coords.lat, coords.lng, r.pickup.lat, r.pickup.lng) <= MAX_NEARBY_KM,
          );
        }

        // Only show rides with free seats
        rides = rides.filter((r) => r.takenSeats < r.maxSeats);
        setAllRides(rides);
        setLoadingRides(false);
      },
      () => setLoadingRides(false),
    );
    return unsub;
  }, [coords]);

  // Derive filtered rides (category + gender)
  const visibleRides = useMemo(() => {
    let result = allRides;

    // Category filter
    if (selectedCategory !== 'all') {
      result = result.filter((r) => (r.rideCategory ?? 'mini') === selectedCategory);
    }

    // Gender filter
    if (genderPref === 'same') {
      result = result.filter((r) => {
        // If gender is unspecified, only show open-to-all rides (safest default)
        if (userGender === 'unspecified') return r.genderPref === 'any';
        if (userGender === 'male')   return r.genderPref === 'male_only' || r.genderPref === 'any';
        if (userGender === 'female') return r.genderPref === 'female_only' || r.genderPref === 'any';
        return r.genderPref === 'any';
      });
    }

    return result;
  }, [allRides, selectedCategory, genderPref, userGender]);

  // ── Book seat ───────────────────────────────────────────────────────────────

  async function bookSeat() {
    if (!selected || !user) return;
    const dest = destForBooking.trim() || destination.trim();
    if (!dest) {
      Alert.alert('Destination required', 'Please enter your destination before booking.');
      return;
    }
    setBooking(true);
    try {
      const rideRef      = doc(db, 'poolRides', selected.id);
      const passengerRef = doc(collection(db, 'poolRides', selected.id, 'passengers'), user.uid);
      const batch        = writeBatch(db);

      batch.set(passengerRef, {
        userId:         user.uid,
        userName:       user.displayName ?? 'Passenger',
        userPhone:      user.phoneNumber ?? null,
        userGender,
        pickupAddress:  pickupAddress ?? 'Current location',
        pickupLat:      coords?.lat ?? selected.pickup.lat,
        pickupLng:      coords?.lng ?? selected.pickup.lng,
        dropoffAddress: dest,
        fare:           selected.perSeatFare,
        status:         'confirmed',
        joinedAt:       serverTimestamp(),
      });

      const isFirst  = selected.takenSeats === 0;
      const newSeats = selected.takenSeats + 1;
      const isFull   = newSeats >= selected.maxSeats;

      batch.update(rideRef, {
        takenSeats: increment(1),
        status:     isFull ? 'full' : 'collecting',
        ...(isFirst ? { boardingStartedAt: serverTimestamp() } : {}),
      });

      await batch.commit();
      setDestination(dest);
      setBookingStatus('confirmed');
      setStep('confirmed');
    } catch (e) {
      Alert.alert('Booking failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBooking(false);
    }
  }

  // ── Confirmed ────────────────────────────────────────────────────────────────

  if (step === 'confirmed' && selected) {
    // Status banners shown to passenger based on real-time booking status
    const StatusBanner =
      bookingStatus === 'driver_arrived' ? (
        <View style={styles.arrivedBanner}>
          <Text style={styles.arrivedBannerText}>🚗 Your driver has arrived at your pickup!</Text>
        </View>
      ) : bookingStatus === 'picked_up' ? (
        <View style={[styles.arrivedBanner, { backgroundColor: colors.primary + '20' }]}>
          <Text style={styles.arrivedBannerText}>✅ You're on board — enjoy the ride!</Text>
        </View>
      ) : null;

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={{ width: 40 }} />
          <Text style={styles.headerTitle}>Confirmed!</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scrollPad}>
          {StatusBanner}

          <View style={styles.confirmedCircle}>
            <Text style={styles.confirmedEmoji}>
              {bookingStatus === 'driver_arrived' ? '🚗'
               : bookingStatus === 'picked_up' ? '🎉'
               : '✅'}
            </Text>
          </View>
          <Text style={styles.confirmedTitle}>Seat Reserved</Text>
          <Text style={styles.confirmedSub}>Your pool ride is booked</Text>

          {/* Chat with driver button */}
          <Pressable style={styles.chatDriverBtn} onPress={() => setChatOpen(true)}>
            <Text style={styles.chatDriverBtnText}>💬 Message driver</Text>
          </Pressable>

          <View style={styles.detailCard}>
            {[
              ['Driver',      `${selected.driverName} · ★${selected.driverRating.toFixed(1)}`],
              ['Vehicle',     `${selected.driverVehicle} · ${selected.driverPlate}`],
              ['From',        selected.pickup.address],
              ['To',          destination],
              ['Departure',   `${fmtDay(selected.departureTime)} · ${fmtTime(selected.departureTime)}`],
              ['Pickup zone', `Within ${selected.pickupRadius}m of origin`],
              ['Drop zone',   `Within ${selected.dropoffRadius}m of destination`],
            ].map(([label, val]) => (
              <View key={label} style={styles.detailRow}>
                <Text style={styles.detailLabel}>{label}</Text>
                <Text style={styles.detailVal} numberOfLines={2}>{val}</Text>
              </View>
            ))}
            <View style={[styles.detailRow, { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }]}>
              <Text style={styles.detailLabel}>Your fare</Text>
              <Text style={[styles.detailVal, { color: colors.primary, fontSize: 20, fontWeight: '900' }]}>
                {selected.perSeatFare} PKR
              </Text>
            </View>
          </View>

          <View style={styles.boardingInfoBox}>
            <Text style={styles.boardingInfoText}>
              ⏱ The driver waits up to 10 minutes at the pickup zone for all confirmed passengers to board before departing.
            </Text>
          </View>

          <Pressable style={styles.primaryBtn} onPress={() => router.replace('/passenger/home')}>
            <Text style={styles.primaryBtnText}>Back to Home</Text>
          </Pressable>
        </ScrollView>

        {/* Pool ride chat */}
        <ChatModal
          visible={chatOpen}
          roomId={selected.id}
          isPoolRide
          myUid={user?.uid ?? ''}
          myName={user?.displayName ?? 'Passenger'}
          otherName={selected.driverName}
          onClose={() => setChatOpen(false)}
        />
      </SafeAreaView>
    );
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  if (step === 'detail' && selected) {
    const meta    = GENDER_META[selected.genderPref] ?? GENDER_META.any;
    const avail   = selected.maxSeats - selected.takenSeats;
    const boarding = getBoardingStatus(selected);

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={() => setStep('browse')} hitSlop={12}>
            <Text style={styles.backArrow}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Ride Details</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollPad}>
          {/* Status */}
          {boarding && (
            <View style={[styles.boardingBanner, { backgroundColor: boarding.color + '18', borderColor: boarding.color + '40' }]}>
              <Text style={[styles.boardingBannerText, { color: boarding.color }]}>
                ⏱ {boarding.label} — driver waits up to 10 min for all passengers
              </Text>
            </View>
          )}

          {/* Driver */}
          <View style={styles.detailDriverCard}>
            <View style={styles.detailAvatar}>
              <Text style={styles.detailAvatarText}>{selected.driverName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailDriverName}>{selected.driverName}</Text>
              <Text style={styles.detailRating}>★ {selected.driverRating.toFixed(1)} · {selected.driverVehicle}</Text>
              <Text style={styles.detailPlate}>{selected.driverPlate}</Text>
            </View>
            <View style={[styles.genderBadge, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}40` }]}>
              <Text style={[styles.genderBadgeText, { color: meta.color }]}>
                {meta.icon} {meta.label}
              </Text>
            </View>
          </View>

          {/* Route */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardLabel}>ROUTE</Text>
            <View style={styles.routeBlock}>
              <View style={styles.routeRowFull}>
                <View style={styles.routeIconCol}>
                  <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
                  <View style={styles.routeStem} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeAddr}>{selected.pickup.address}</Text>
                  <Text style={styles.routeZone}>Pickup zone: within {selected.pickupRadius}m</Text>
                </View>
              </View>
              <View style={styles.routeRowFull}>
                <View style={styles.routeIconCol}>
                  <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeAddr}>{selected.dropoff.address}</Text>
                  <Text style={styles.routeZone}>Drop zone: within {selected.dropoffRadius}m</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Info grid */}
          <View style={styles.infoGrid}>
            {[
              { label: 'Departure', main: fmtDay(selected.departureTime), sub: fmtTime(selected.departureTime) },
              { label: 'Seats free', main: `${avail}/${selected.maxSeats}`, sub: 'available' },
              { label: 'Your fare', main: `${selected.perSeatFare}`, sub: 'PKR', accent: true },
            ].map((item) => (
              <View key={item.label} style={styles.infoCell}>
                <Text style={styles.infoCellLabel}>{item.label}</Text>
                <Text style={[styles.infoCellMain, item.accent && { color: colors.primary }]}>{item.main}</Text>
                <Text style={styles.infoCellSub}>{item.sub}</Text>
              </View>
            ))}
          </View>

          {/* Destination input */}
          <Text style={styles.fieldLabel}>YOUR DESTINATION</Text>
          <View style={styles.destField}>
            <View style={[styles.locationDot, { backgroundColor: '#ef4444' }]} />
            <TextInput
              style={styles.destInput}
              placeholder="Where are you going?"
              placeholderTextColor={colors.muted}
              value={destForBooking}
              onChangeText={setDestForBooking}
              returnKeyType="done"
            />
          </View>
          <Text style={styles.destHint}>
            Driver will drop you within {selected.dropoffRadius}m of your destination
          </Text>

          {/* How it works */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardLabel}>HOW THIS RIDE WORKS</Text>
            {[
              `Be within ${selected.pickupRadius}m of the origin at departure time.`,
              `Driver picks up all passengers within 10 minutes of the first boarding.`,
              `Share the route — driver drops each passenger near their stop.`,
              `Pay ${selected.perSeatFare} PKR cash or via wallet on arrival.`,
            ].map((t, i) => (
              <View key={i} style={styles.howRow}>
                <View style={styles.howNum}><Text style={styles.howNumText}>{i + 1}</Text></View>
                <Text style={styles.howText}>{t}</Text>
              </View>
            ))}
          </View>

          <Pressable
            style={[styles.primaryBtn, booking && { opacity: 0.6 }]}
            onPress={bookSeat}
            disabled={booking}
          >
            {booking
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.primaryBtnText}>Confirm Booking — {selected.perSeatFare} PKR</Text>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Browse (default) ──────────────────────────────────────────────────────

  const activeCat  = (RIDE_CATEGORIES.find((c) => c.key === selectedCategory) ?? RIDE_CATEGORIES[0]) as RideCategory;
  const fareRows   = fareBreakdown(activeCat.exampleFare);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={12}
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Ride Sharing</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={visibleRides}
        keyExtractor={(r) => r.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listPad}
        ListHeaderComponent={
          <>
            {/* Destination + pickup combined bar */}
            <View style={styles.routeBar}>
              <View style={styles.routeBarDots}>
                <View style={[styles.routeDot, { backgroundColor: '#22c55e' }]} />
                <View style={styles.routeStem} />
                <View style={[styles.routeDot, { backgroundColor: '#ef4444' }]} />
              </View>
              <View style={{ flex: 1, gap: 0 }}>
                <Text style={styles.routeBarFrom} numberOfLines={1}>
                  {pickupAddress ?? 'Current location'}
                </Text>
                <View style={styles.routeBarDivider} />
                <TextInput
                  style={styles.routeBarInput}
                  placeholder="Where are you going?"
                  placeholderTextColor={colors.muted}
                  value={destination}
                  onChangeText={setDestination}
                  returnKeyType="search"
                  autoCorrect={false}
                />
              </View>
              {destination.length > 0 && (
                <Pressable onPress={() => setDestination('')} hitSlop={10}>
                  <Text style={{ color: colors.muted, fontSize: 20, lineHeight: 22 }}>×</Text>
                </Pressable>
              )}
            </View>

            {/* Compact filter row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {RIDE_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat.key}
                  style={[styles.filterChip, selectedCategory === cat.key && styles.filterChipActive]}
                  onPress={() => setSelectedCategory(cat.key)}
                >
                  <Text style={[styles.filterChipText, selectedCategory === cat.key && { color: colors.primary }]}>
                    {cat.icon} {cat.label}
                  </Text>
                </Pressable>
              ))}
              <View style={styles.filterSep} />
              <Pressable
                style={[styles.filterChip, genderPref === 'same' && styles.filterChipActive]}
                onPress={() => setGenderPref('same')}
              >
                <Text style={[styles.filterChipText, genderPref === 'same' && { color: colors.primary }]}>
                  🔒 Same gender
                </Text>
              </Pressable>
              <Pressable
                style={[styles.filterChip, genderPref === 'any' && styles.filterChipActive]}
                onPress={() => {
                  if (genderPref !== 'any') {
                    Alert.alert('Travel with any gender?',
                      'You will see rides where male and female passengers travel together. Are you sure?',
                      [{ text: 'Cancel', style: 'cancel' }, { text: 'Accept', onPress: () => setGenderPref('any') }]);
                  } else setGenderPref('same');
                }}
              >
                <Text style={[styles.filterChipText, genderPref === 'any' && { color: colors.primary }]}>
                  👥 Any gender
                </Text>
              </Pressable>
            </ScrollView>

            {/* Section header */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>POOL RIDES NEARBY</Text>
              {!loadingRides && (
                <View style={styles.liveBadge}>
                  <View style={styles.livePip} />
                  <Text style={styles.liveBadgeText}>
                    {visibleRides.length > 0 ? `${visibleRides.length} available` : 'None nearby'}
                  </Text>
                </View>
              )}
            </View>

            {loadingRides && (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.loadingText}>Finding rides near you…</Text>
              </View>
            )}

            {!loadingRides && visibleRides.length === 0 && (
              <View style={styles.emptyRides}>
                <Text style={styles.emptyIcon}>🚗</Text>
                <Text style={styles.emptyTitle}>No pool rides nearby yet</Text>
                <Text style={styles.emptySub}>
                  {destination.trim()
                    ? `No rides heading toward "${destination.trim()}" right now.`
                    : 'No rides available in your area right now.'}
                  {'\n'}Request one — a driver will respond to your route.
                </Text>
                <Pressable
                  style={styles.requestRideBtn}
                  onPress={() => router.push('/passenger/pool-request/create' as Parameters<typeof router.push>[0])}
                >
                  <Text style={styles.requestRideBtnText}>✋ Request a Pool Ride</Text>
                </Pressable>
                <Pressable
                  style={styles.soloFallbackBtn}
                  onPress={() => router.replace('/passenger/booking')}
                >
                  <Text style={styles.soloFallbackBtnText}>🚕 Book Solo Ride Instead</Text>
                </Pressable>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <PoolRideCard
            ride={item}
            onJoin={() => { setSelected(item); setDestForBooking(''); setStep('detail'); }}
          />
        )}
        ListFooterComponent={
          <>
            {/* More options */}
            <View style={styles.quickLinksSection}>
              <Text style={styles.quickLinksTitle}>MORE OPTIONS</Text>
              <Pressable
                style={styles.quickLink}
                onPress={() => router.push('/passenger/pool-request/create' as Parameters<typeof router.push>[0])}
              >
                <Text style={styles.quickLinkIcon}>✋</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickLinkLabel}>Request a Pool Ride</Text>
                  <Text style={styles.quickLinkDesc}>Propose your route & fare · driver accepts or counters</Text>
                </View>
                <Text style={styles.quickLinkArrow}>›</Text>
              </Pressable>
              <Pressable
                style={styles.quickLink}
                onPress={() => router.push('/passenger/commute' as Parameters<typeof router.push>[0])}
              >
                <Text style={styles.quickLinkIcon}>📅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.quickLinkLabel}>My Commute Schedule</Text>
                  <Text style={styles.quickLinkDesc}>Register your daily commute · help drivers find you</Text>
                </View>
                <Text style={styles.quickLinkArrow}>›</Text>
              </Pressable>
            </View>

            {/* Collapsible fare table */}
            <Pressable style={styles.fareToggleBtn} onPress={() => setShowFareTable((v) => !v)}>
              <Text style={styles.fareToggleText}>
                {showFareTable ? '▲' : '▼'}  How pooling changes the fare
              </Text>
            </Pressable>

            {showFareTable && (
              <View style={styles.fareTable}>
                <View style={styles.fareTableHead}>
                  <Text style={styles.fareTableHeadText}>
                    {activeCat.icon} {activeCat.label} · Example {activeCat.exampleFare.toLocaleString()} PKR solo fare
                  </Text>
                </View>
                <View style={[styles.fareTableRow, styles.fareTableHeaderRow]}>
                  <Text style={[styles.fareCell, styles.fareCellRiders, styles.fareHeaderText]}>Riders</Text>
                  <Text style={[styles.fareCell, styles.fareCellSeatWide, styles.fareHeaderText]}>You pay</Text>
                  <Text style={[styles.fareCell, styles.fareCellSavings, styles.fareHeaderText]}>Savings</Text>
                </View>
                {fareRows.map(({ n, perSeat, passengerSavePct }) => {
                  const isBest = n === 4;
                  const isSolo = n === 1;
                  return (
                    <View key={n} style={[styles.fareTableRow, isBest && styles.fareTableRowBest]}>
                      <View style={[styles.fareCell, styles.fareCellRiders]}>
                        <Text style={styles.fareRiderLabel}>
                          {isSolo ? '🧍 Solo' : `👥 ×${n} riders`}
                        </Text>
                        {isBest && (
                          <View style={styles.bestTag}>
                            <Text style={styles.bestTagText}>BEST</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.fareCell, styles.fareCellSeatWide]}>
                        <Text style={[styles.fareAmt, isBest && { color: colors.primary }]}>
                          {perSeat.toLocaleString()} <Text style={styles.fareUnit}>PKR</Text>
                        </Text>
                      </View>
                      <View style={[styles.fareCell, styles.fareCellSavings]}>
                        {isSolo
                          ? <Text style={styles.fareBaseRef}>base</Text>
                          : <Text style={[styles.fareSavePct, isBest && { fontSize: 15 }]}>−{passengerSavePct}%</Text>}
                      </View>
                    </View>
                  );
                })}
                <View style={styles.fareTableFoot}>
                  <Text style={styles.fareTableFootText}>
                    More riders join → your fare drops · the more you save
                  </Text>
                </View>
              </View>
            )}

            <View style={{ height: 32 }} />
          </>
        }
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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

  listPad: { padding: 14, gap: 10 },
  scrollPad: { padding: 16, gap: 14 },

  // Quick links to new pool features
  quickLinksSection: { gap: 8, marginVertical: 8 },
  quickLinksTitle:   { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, marginBottom: 4 },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  quickLinkIcon:  { fontSize: 20 },
  quickLinkLabel: { fontSize: 14, fontWeight: '800', color: colors.text },
  quickLinkDesc:  { fontSize: 11, color: colors.muted, marginTop: 2 },
  quickLinkArrow: { fontSize: 20, color: colors.muted },

  // Route bar (destination + pickup combined)
  routeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  routeBarDots: { alignItems: 'center', paddingVertical: 2, width: 14 },
  routeBarFrom: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    paddingBottom: 8,
  },
  routeBarDivider: { height: 1, backgroundColor: colors.border, marginBottom: 8 },
  routeBarInput: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    height: 38,
    padding: 0,
  },
  locationDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },

  // Compact filter row
  filterRow: { gap: 8, paddingRight: 4 },
  filterChip: {
    backgroundColor: colors.surface,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}12` },
  filterChipText: { fontSize: 12, fontWeight: '700', color: colors.text },
  filterSep: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginHorizontal: 2,
  },

  // Section header
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  livePip: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  liveBadgeText: { fontSize: 10, fontWeight: '700', color: colors.muted },

  // Loading / Empty
  loadingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loadingText: { fontSize: 13, color: colors.muted },
  emptyRides: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  emptyIcon: { fontSize: 40, marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  emptySub: { fontSize: 12, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  requestRideBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 4,
  },
  requestRideBtnText: { fontSize: 15, fontWeight: '900', color: '#000' },
  soloFallbackBtn: {
    height: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  soloFallbackBtnText: { fontSize: 13, fontWeight: '700', color: colors.muted },

  // ── Pool Ride Card ──────────────────────────────────────────────────────────

  rideCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },

  // Status strip
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  statusPip: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { flex: 1, fontSize: 11, fontWeight: '800' },
  catBadge: {
    backgroundColor: colors.background,
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  catBadgeText: { fontSize: 10, fontWeight: '800', color: colors.muted },
  deptChip: {
    backgroundColor: colors.background,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  deptChipText: { fontSize: 10, fontWeight: '700', color: colors.muted },

  rideCardBody: { padding: 14, gap: 12 },

  // Driver row
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  driverAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a2e0d',
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarText: { fontSize: 17, fontWeight: '900', color: colors.primary },
  driverName: { fontSize: 14, fontWeight: '800', color: colors.text },
  vehicleText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  ratingChip: {
    backgroundColor: '#1c160a',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#f59e0b40',
  },
  ratingText: { fontSize: 11, fontWeight: '800', color: '#f59e0b' },

  // Route
  routeBlock: { gap: 0 },
  routeRowFull: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  routeIconCol: { alignItems: 'center', width: 14 },
  routeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  routeStem: { width: 2, height: 22, backgroundColor: colors.border, marginVertical: 2 },
  routeAddr: { fontSize: 13, fontWeight: '700', color: colors.text, flex: 1 },
  routeZone: { fontSize: 10, color: colors.muted, fontWeight: '600', marginTop: 2, marginBottom: 6 },

  // Seats
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seatPips: { flexDirection: 'row', gap: 5 },
  seatPip: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatFilled: { backgroundColor: `${colors.primary}25`, borderWidth: 1, borderColor: `${colors.primary}60` },
  seatEmpty:  { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  seatPipIcon: { fontSize: 13 },
  seatIconFilled: { opacity: 1 },
  seatIconEmpty:  { color: colors.muted },
  seatsMeta: { fontSize: 11, color: colors.muted, fontWeight: '600', flex: 1 },

  // Boarding note
  boardingNote: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  boardingNoteText: { fontSize: 11, fontWeight: '700', lineHeight: 16 },

  // Card footer
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerLeft: { gap: 4 },
  fareAmt: { fontSize: 18, fontWeight: '900', color: colors.text },
  fareSub: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  genderBadge: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  genderBadgeText: { fontSize: 10, fontWeight: '800' },
  joinBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  joinBtnText: { fontSize: 13, fontWeight: '900', color: '#000' },

  // Or divider
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { fontSize: 12, color: colors.muted, fontWeight: '600' },

  secondaryBtn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700', color: colors.text },

  // Fare toggle
  fareToggleBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  fareToggleText: { fontSize: 12, fontWeight: '700', color: colors.muted },

  // Fare table
  fareTable: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  fareTableHead: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fareTableHeadText: { fontSize: 11, fontWeight: '700', color: colors.muted },
  fareTableHeaderRow: { backgroundColor: '#0d1709' },
  fareHeaderText: { fontSize: 9, fontWeight: '900', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  fareTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: '#0d1709',
  },
  fareTableRowBest: { backgroundColor: '#0d1f07' },
  fareCell: { paddingHorizontal: 4 },
  fareCellRiders:   { flex: 1.3 },
  fareCellSeatWide: { flex: 1.5 },
  fareCellSavings:  { flex: 0.9, alignItems: 'flex-end' },
  fareRiderLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  bestTag: {
    backgroundColor: `${colors.primary}20`,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: `${colors.primary}50`,
  },
  bestTagText: { fontSize: 8, fontWeight: '900', color: colors.primary },
  fareUnit: { fontWeight: '600', color: colors.muted },
  fareSavePct: { fontSize: 12, fontWeight: '800', color: '#4ade80' },
  fareBaseRef: { fontSize: 10, color: colors.muted, fontStyle: 'italic' },
  fareTableFoot: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0d1709',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fareTableFootText: { fontSize: 10, color: colors.muted, textAlign: 'center', fontStyle: 'italic' },

  // ── Detail step styles ────────────────────────────────────────────────────────

  boardingBanner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  boardingBannerText: { fontSize: 12, fontWeight: '700', lineHeight: 18 },

  detailDriverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  detailAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a2e0d',
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailAvatarText: { fontSize: 24, fontWeight: '900', color: colors.primary },
  detailDriverName: { fontSize: 16, fontWeight: '900', color: colors.text },
  detailRating: { fontSize: 12, color: '#f59e0b', fontWeight: '700' },
  detailPlate: { fontSize: 11, color: colors.muted, fontWeight: '600' },

  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  sectionCardLabel: { fontSize: 9, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },

  infoGrid: { flexDirection: 'row', gap: 10 },
  infoCell: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  infoCellLabel: { fontSize: 9, fontWeight: '800', color: colors.muted, letterSpacing: 0.5 },
  infoCellMain: { fontSize: 17, fontWeight: '900', color: colors.text },
  infoCellSub: { fontSize: 10, color: colors.muted, fontWeight: '600' },

  fieldLabel: { fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 0.6 },
  destField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  destInput: { flex: 1, height: 46, fontSize: 14, fontWeight: '700', color: colors.text },
  destHint: { fontSize: 10, color: colors.muted, fontStyle: 'italic' },

  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  howNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  howNumText: { fontSize: 12, fontWeight: '900', color: '#000' },
  howText: { fontSize: 13, color: colors.muted, lineHeight: 19, flex: 1 },

  primaryBtn: {
    height: 54,
    backgroundColor: colors.primary,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#000', fontSize: 16, fontWeight: '900' },

  // ── Confirmed step ──────────────────────────────────────────────────────────

  confirmedCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1a2e0d',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  confirmedEmoji: { fontSize: 40 },
  confirmedTitle: { fontSize: 24, fontWeight: '900', color: colors.text, textAlign: 'center' },
  confirmedSub: { fontSize: 14, color: colors.muted, textAlign: 'center' },

  detailCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 12, color: colors.muted, fontWeight: '600', flexShrink: 0 },
  detailVal: { fontSize: 12, color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },

  arrivedBanner: {
    backgroundColor: '#f59e0b18',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f59e0b40',
  },
  arrivedBannerText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#f59e0b',
    textAlign: 'center' as const,
  },
  chatDriverBtn: {
    backgroundColor: `${colors.primary}18`,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: `${colors.primary}40`,
    marginBottom: 4,
  },
  chatDriverBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  boardingInfoBox: {
    backgroundColor: '#1a1200',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f59e0b40',
    padding: 14,
  },
  boardingInfoText: { fontSize: 12, color: '#f5d384', lineHeight: 18, textAlign: 'center' },
});
