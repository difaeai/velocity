import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api } from '../../src/api/client';
import { colors } from '../../src/config';
import { Card } from '../../src/ui/components';
import {
  BASE_FARES,
  MAX_SEATS,
  RIDE_TYPE_LABELS,
  fareBounds,
  type Gender,
  type RideType,
} from '../../src/domain/types';

const RIDE_TYPES = Object.keys(RIDE_TYPE_LABELS) as RideType[];
// Default to Islamabad coordinates
const DEFAULT_PICKUP = { lat: 33.6844, lng: 73.0479 };
const DEFAULT_DROPOFF = { lat: 33.7104, lng: 73.0551 };

const SUGGESTED_LOCATIONS = [
  {
    id: '1',
    name: 'Bahria University - Islamabad Campus',
    address: 'Shangrilla Road, E-8/1 E-8/1 E-8, Islamabad',
    distance: '17.2km',
  },
  {
    id: '2',
    name: 'Bahria University (BSEAS) Islamabad H-11/4 Campus',
    address: 'H-11/4 H 11/4 H-11, Islamabad',
    distance: '12.1km',
  },
  {
    id: '3',
    name: 'Bahria University College',
    address: 'Sector E-8, Islamabad',
    distance: '16.5km',
  },
];

export default function Booking() {
  const router = useRouter();
  const [stage, setStage] = useState<'route' | 'details'>('route');
  const [pickup, setPickup] = useState('Street Number 13 140');
  const [dropoff, setDropoff] = useState('Bahria uni');
  
  // Details state
  const [rideType, setRideType] = useState<RideType>('ac');
  const [fare, setFare] = useState<number>(BASE_FARES.ac);
  const [seats, setSeats] = useState(1);
  const [gender, setGender] = useState<Gender>('unspecified');
  const [pool, setPool] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bounds = fareBounds(rideType);

  function selectRide(rt: RideType) {
    setRideType(rt);
    setFare(BASE_FARES[rt]);
  }

  function bumpFare(delta: number) {
    setFare((f) => Math.min(bounds.max, Math.max(bounds.min, f + delta)));
  }

  function selectLocation(locName: string) {
    setDropoff(locName);
    setStage('details');
  }

  async function findDriver() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.createTrip({
        rideType,
        offeredFare: fare,
        seats,
        passengerGender: gender,
        pool,
        pickup: { ...DEFAULT_PICKUP, address: pickup || 'Pickup' },
        dropoff: { ...DEFAULT_DROPOFF, address: dropoff || 'Drop-off' },
      });
      router.replace(`/passenger/trip/${res.tripId}`);
    } catch (e) {
      const code = e instanceof FirebaseError ? e.message : 'Could not create the ride.';
      setError(code);
    } finally {
      setLoading(false);
    }
  }

  // STAGE 1: ROUTE SELECTOR SCREEN (Image 1 Mockup)
  if (stage === 'route') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Enter your route</Text>
          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.routeInputsCard}>
          {/* Pickup Input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputIcon}>👤</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>From</Text>
              <TextInput
                value={pickup}
                onChangeText={setPickup}
                placeholder="Search pickup location..."
                placeholderTextColor={colors.muted}
                style={styles.textInput}
              />
            </View>
          </View>

          {/* Divider */}
          <View style={styles.inputDivider} />

          {/* Dropoff Input */}
          <View style={[styles.inputContainer, styles.inputContainerActive]}>
            <Text style={styles.inputIcon}>🔍</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>To</Text>
              <TextInput
                value={dropoff}
                onChangeText={setDropoff}
                placeholder="Search destination..."
                placeholderTextColor={colors.muted}
                style={styles.textInput}
                autoFocus
              />
            </View>
            {dropoff.length > 0 && (
              <Pressable onPress={() => setDropoff('')} style={styles.clearBtn}>
                <Text style={styles.clearTxt}>✕</Text>
              </Pressable>
            )}
            <View style={styles.mapIconCircle}>
              <Text style={styles.mapIcon}>🗺️</Text>
            </View>
          </View>
        </View>

        {/* Tab Filters */}
        <View style={styles.tabsContainer}>
          <View style={[styles.tab, styles.tabActive]}>
            <Text style={[styles.tabText, styles.tabTextActive]}>Search Results</Text>
          </View>
          <View style={styles.tab}>
            <Text style={styles.tabText}>Suggested</Text>
          </View>
          <View style={styles.tab}>
            <Text style={styles.tabText}>Saved</Text>
          </View>
        </View>

        {/* Search Results List */}
        <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled">
          {SUGGESTED_LOCATIONS.filter(loc => 
            loc.name.toLowerCase().includes(dropoff.toLowerCase()) || 
            loc.address.toLowerCase().includes(dropoff.toLowerCase())
          ).map((loc) => (
            <Pressable
              key={loc.id}
              style={styles.resultItem}
              onPress={() => selectLocation(loc.name)}
            >
              <View style={styles.resultIconCircle}>
                <Text style={styles.resultIcon}>📍</Text>
              </View>
              <View style={styles.resultMeta}>
                <Text style={styles.resultName}>{loc.name}</Text>
                <Text style={styles.resultAddress}>{loc.address}</Text>
              </View>
              <View style={styles.resultRight}>
                <Text style={styles.resultDistance}>{loc.distance}</Text>
                <Text style={styles.bookmarkIcon}>🔖</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Keyboard suggestion bar mockup */}
        <View style={styles.keyboardSuggestionsBar}>
          <Pressable style={styles.suggestionItem} onPress={() => selectLocation('Bahria University - Islamabad Campus')}>
            <Text style={styles.suggestionText}>"uni"</Text>
          </Pressable>
          <View style={styles.suggestionDivider} />
          <Pressable style={styles.suggestionItem} onPress={() => selectLocation('Bahria University - Islamabad Campus')}>
            <Text style={styles.suggestionText}>university</Text>
          </Pressable>
          <View style={styles.suggestionDivider} />
          <Pressable style={styles.suggestionItem} onPress={() => selectLocation('Bahria University College')}>
            <Text style={styles.suggestionText}>uniform</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // STAGE 2: CATEGORY & FARE SELECTION
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Ride & Fare</Text>
        <Pressable style={styles.closeBtn} onPress={() => setStage('route')}>
          <Text style={styles.closeTxt}>←</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Route Details Card */}
        <Card style={styles.routeCardDetails}>
          <View style={styles.routePoint}>
            <Text style={styles.pointDotBlue}>•</Text>
            <Text style={styles.pointText} numberOfLines={1}>From: {pickup}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routePoint}>
            <Text style={styles.pointDotGreen}>•</Text>
            <Text style={styles.pointText} numberOfLines={1}>To: {dropoff}</Text>
          </View>
        </Card>

        {/* Ride Grid */}
        <Text style={styles.sectionTitle}>Ride type</Text>
        <View style={styles.rideGrid}>
          {RIDE_TYPES.map((rt) => {
            const active = rt === rideType;
            return (
              <Pressable
                key={rt}
                onPress={() => selectRide(rt)}
                style={[styles.rideCard, active && styles.rideCardActive]}
              >
                <Text style={[styles.rideLabel, active && { color: '#ccff00' }]}>
                  {RIDE_TYPE_LABELS[rt]}
                </Text>
                <Text style={styles.rideFare}>~{BASE_FARES[rt]} PKR</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Offer / Stepper */}
        <Card style={styles.detailCard}>
          <Text style={styles.cardLabel}>Your offer</Text>
          <View style={styles.stepperRow}>
            <Pressable style={styles.stepBtn} onPress={() => bumpFare(-50)}>
              <Text style={styles.stepTxt}>−</Text>
            </Pressable>
            <Text style={styles.fareValue}>{fare} PKR</Text>
            <Pressable style={styles.stepBtn} onPress={() => bumpFare(50)}>
              <Text style={styles.stepTxt}>+</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Allowed {bounds.min}–{bounds.max} PKR · share ~{Math.round(fare / seats)} PKR
          </Text>
        </Card>

        {/* Seats & Preferences */}
        <Card style={styles.detailCard}>
          <Text style={styles.cardLabel}>Seats</Text>
          <View style={styles.pillRow}>
            {Array.from({ length: MAX_SEATS }, (_, i) => i + 1).map((n) => (
              <Pressable
                key={n}
                onPress={() => setSeats(n)}
                style={[styles.pill, seats === n && styles.pillActive]}
              >
                <Text style={[styles.pillTxt, seats === n && { color: '#000' }]}>{n}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.cardLabel, { marginTop: 16 }]}>Gender Filter</Text>
          <View style={styles.pillRow}>
            {(['male', 'female', 'unspecified'] as Gender[]).map((g) => (
              <Pressable
                key={g}
                onPress={() => setGender(g)}
                style={[styles.pill, gender === g && styles.pillActive]}
              >
                <Text style={[styles.pillTxt, gender === g && { color: '#000' }]}>
                  {g === 'unspecified' ? 'Any' : g.charAt(0).toUpperCase() + g.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.toggleRow} onPress={() => setPool((p) => !p)}>
            <Text style={styles.toggleLabel}>Smart pool (share & split fare)</Text>
            <View style={[styles.toggle, pool && styles.toggleOn]}>
              <View style={[styles.knob, pool && { alignSelf: 'flex-end' }]} />
            </View>
          </Pressable>
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [styles.findBtn, pressed && { opacity: 0.8 }]}
          onPress={findDriver}
          disabled={loading}
        >
          <Text style={styles.findBtnText}>{loading ? 'Booking...' : 'Find a driver'}</Text>
        </Pressable>

        <Pressable style={styles.backBtn} onPress={() => setStage('route')}>
          <Text style={styles.backBtnText}>Change route</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#151616',
  },
  container: {
    padding: 18,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2f2f',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#ffffff',
  },
  closeBtn: {
    padding: 6,
  },
  closeTxt: {
    fontSize: 20,
    color: '#8a8c8c',
  },
  routeInputsCard: {
    backgroundColor: '#212222',
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 14,
    gap: 12,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  inputContainerActive: {
    borderWidth: 1.5,
    borderColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inputIcon: {
    fontSize: 16,
    color: '#ccff00',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8a8c8c',
  },
  textInput: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
    height: 24,
    padding: 0,
  },
  inputDivider: {
    height: 1,
    backgroundColor: '#2d2f2f',
    marginLeft: 28,
  },
  clearBtn: {
    padding: 4,
  },
  clearTxt: {
    color: '#8a8c8c',
    fontSize: 14,
  },
  mapIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  mapIcon: {
    fontSize: 14,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 10,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#212222',
  },
  tabActive: {
    backgroundColor: '#ffffff',
  },
  tabText: {
    color: '#8a8c8c',
    fontWeight: '700',
    fontSize: 13,
  },
  tabTextActive: {
    color: '#000000',
  },
  resultsScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2f2f',
    gap: 12,
  },
  resultIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#212222',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultIcon: {
    fontSize: 16,
  },
  resultMeta: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2563eb', // Bahria Uni blue highlight
  },
  resultAddress: {
    fontSize: 12,
    color: '#8a8c8c',
  },
  resultRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  resultDistance: {
    fontSize: 11,
    color: '#8a8c8c',
    fontWeight: '600',
  },
  bookmarkIcon: {
    fontSize: 14,
    color: '#8a8c8c',
  },
  keyboardSuggestionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2d2d2d',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: '#3d3d3d',
  },
  suggestionItem: {
    flex: 1,
    alignItems: 'center',
  },
  suggestionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  suggestionDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#3d3d3d',
  },

  // STAGE 2 STYLING
  routeCardDetails: {
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 14,
    gap: 8,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pointDotBlue: {
    color: '#3b82f6',
    fontSize: 22,
    lineHeight: 22,
  },
  pointDotGreen: {
    color: '#ccff00',
    fontSize: 22,
    lineHeight: 22,
  },
  pointText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  routeLine: {
    width: 2,
    height: 12,
    backgroundColor: '#2d2f2f',
    marginLeft: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 6,
  },
  rideGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rideCard: {
    width: '31%',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    backgroundColor: '#212222',
  },
  rideCardActive: {
    borderColor: '#ccff00',
    borderWidth: 2,
  },
  rideLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  rideFare: {
    fontSize: 11,
    color: '#8a8c8c',
    marginTop: 2,
  },
  detailCard: {
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 14,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTxt: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ccff00',
  },
  fareValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
  },
  hint: {
    fontSize: 12,
    color: '#8a8c8c',
    marginTop: 8,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  pill: {
    minWidth: 46,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#212222',
  },
  pillActive: {
    backgroundColor: '#ccff00',
    borderColor: '#ccff00',
  },
  pillTxt: {
    fontWeight: '800',
    color: '#ffffff',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 999,
    backgroundColor: '#2d2f2f',
    padding: 3,
  },
  toggleOn: {
    backgroundColor: '#ccff00',
  },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
  },
  error: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
  },
  findBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  findBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  backBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  backBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
