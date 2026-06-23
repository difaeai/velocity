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
import { comingSoon } from '../../src/ui/components';
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
  const [autoAccept, setAutoAccept] = useState(false);
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
    <View style={styles.safe}>
      {/* 1. Full-Screen Dark Map Representation */}
      <View style={styles.mapContainer}>
        {/* Abstract Map Roads */}
        <View style={[styles.road, { top: 140, left: -50, width: '120%', transform: [{ rotate: '-15deg' }] }]} />
        <View style={[styles.road, { top: 280, left: -50, width: '120%', transform: [{ rotate: '25deg' }] }]} />
        <View style={[styles.road, { top: 480, left: -50, width: '120%', transform: [{ rotate: '-5deg' }] }]} />
        
        {/* Route Connection Graphic */}
        <View style={styles.routeLineGraphic} />

        {/* Mock Map Pins for Pickup and Dropoff */}
        <View style={[styles.mapPinPoint, { top: 150, left: 130 }]}>
          <Text style={styles.pinPointEmoji}>👤</Text>
        </View>
        <View style={[styles.mapPinPoint, { top: 290, left: 240 }]}>
          <Text style={styles.pinPointEmoji}>🏁</Text>
        </View>
      </View>

      {/* 2. Top Floating Routing Details Card (from Image 4) */}
      <SafeAreaView style={styles.floatingHeaderArea} pointerEvents="box-none">
        <View style={styles.floatingHeaderBar}>
          <Pressable style={styles.floatingBackBtn} onPress={() => setStage('route')}>
            <Text style={styles.floatingBackTxt}>←</Text>
          </Pressable>

          <View style={styles.floatingRouteCard}>
            <View style={styles.floatingRoutePoint}>
              <Text style={styles.floatingIconBlue}>👤</Text>
              <Text style={styles.floatingRouteText} numberOfLines={1}>Street Number 13 140 (PWD Society, Sector B)</Text>
              <View style={styles.entranceBadge}><Text style={styles.entranceText}>Entrance</Text></View>
            </View>
            <View style={styles.floatingRouteDivider} />
            <View style={styles.floatingRoutePoint}>
              <Text style={styles.floatingIconGreen}>🏁</Text>
              <Text style={styles.floatingRouteText} numberOfLines={1}>Bahria University - Islamabad Campus (Shangrilla Road, E-8/1 E 8/1 E-8, Islamabad) ~33 min</Text>
              <Text style={styles.plusIcon}>+</Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* 3. Bottom Slide-up Sheet */}
      <View style={styles.bottomRideSheet}>
        <View style={styles.dragIndicator} />
        
        {/* Selected/Active Category Details */}
        <View style={styles.activeCategoryBox}>
          <View style={styles.activeCategoryMeta}>
            <View style={styles.categoryTitleRow}>
              <Text style={styles.categoryEmojiBig}>🚗</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.categoryNameRow}>
                  <Text style={styles.categoryNameBig}>{RIDE_TYPE_LABELS[rideType]}</Text>
                  <Text style={styles.infoIconCircle}>ⓘ</Text>
                  <Text style={styles.editPencil}>✏️</Text>
                </View>
                <Text style={styles.categorySubtitleBig}>👤 4 · 2 min</Text>
                <Text style={styles.categoryDescriptionBig}>Lower fares, no AC</Text>
              </View>
            </View>
          </View>

          {/* Stepper adjustment for the fare */}
          <View style={styles.activeFareStepper}>
            <Pressable style={styles.stepperCircle} onPress={() => bumpFare(-50)}>
              <Text style={styles.stepperText}>−</Text>
            </Pressable>
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.stepperFareValue}>PKR {fare}</Text>
              <Text style={styles.stepperLabel}>Recommended fare</Text>
            </View>
            <Pressable style={styles.stepperCircle} onPress={() => bumpFare(50)}>
              <Text style={styles.stepperText}>+</Text>
            </Pressable>
          </View>
        </View>

        {/* Scrollable list of alternative categories */}
        <ScrollView style={styles.alternativeList} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
          {RIDE_TYPES.filter(rt => rt !== rideType).map((rt) => (
            <Pressable key={rt} style={styles.categoryRow} onPress={() => selectRide(rt)}>
              <View style={styles.categoryRowLeft}>
                <Text style={styles.categoryEmojiSmall}>
                  {rt === 'bike' ? '🏍️' : rt === 'comfort' ? '🚙' : '🚗'}
                </Text>
                <View>
                  <Text style={styles.categoryNameSmall}>{RIDE_TYPE_LABELS[rt]}</Text>
                  <Text style={styles.categorySubSmall}>
                    {rt === 'bike' ? '👤 1 · 2 min · No traffic, lower prices' : '👤 4 · 3 min · Cars with AC'}
                  </Text>
                </View>
              </View>
              <Text style={styles.categoryFareSmall}>PKR {BASE_FARES[rt]}</Text>
            </Pressable>
          ))}

          {/* Notice Banner */}
          <View style={styles.taxNoticeBanner}>
            <Text style={styles.taxNoticeIcon}>ⓘ</Text>
            <Text style={styles.taxNoticeText}>
              Fare doesn't include state entry tax, tolls, or parking fees
            </Text>
          </View>
        </ScrollView>

        {/* Toggle & Payment Details */}
        <View style={styles.sheetActionsFooter}>
          <Pressable style={styles.toggleRowFooter} onPress={() => setAutoAccept((v) => !v)}>
            <View style={styles.toggleTextCol}>
              <Text style={styles.autoAcceptLabel}>Auto-accept offer of PKR {fare}</Text>
            </View>
            <View style={[styles.toggleSwitchSmall, autoAccept && { backgroundColor: colors.primary }]}>
              <View style={[styles.toggleSwitchKnobSmall, autoAccept && styles.toggleKnobOn]} />
            </View>
          </Pressable>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={styles.bottomButtonsRow}>
            {/* Cash Badge Button */}
            <Pressable style={styles.cashBadgeFooter} onPress={() => comingSoon('Payment methods')}>
              <Text style={styles.cashBadgeEmoji}>💵</Text>
            </Pressable>

            {/* Find a Driver Button */}
            <Pressable
              style={({ pressed }) => [styles.findDriverButton, pressed && { opacity: 0.85 }]}
              onPress={findDriver}
              disabled={loading}
            >
              <Text style={styles.findDriverButtonText}>
                {loading ? 'Booking...' : 'Find a driver'}
              </Text>
            </Pressable>

            {/* Filter Button */}
            <Pressable style={styles.filterButtonFooter} onPress={() => comingSoon('Filters')}>
              <Text style={styles.filterButtonIcon}>🎛️</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
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

  // STAGE 2 STYLING (Image 1 & 4 Map + Sheet Layout)
  mapContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: '48%', // Show map on the upper half
    backgroundColor: '#151b22',
  },
  road: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#262f3c',
  },
  routeLineGraphic: {
    position: 'absolute',
    top: 220,
    left: 140,
    width: 110,
    height: 3,
    backgroundColor: '#ffffff',
    transform: [{ rotate: '45deg' }],
  },
  mapPinPoint: {
    position: 'absolute',
    backgroundColor: '#1c1b1b',
    padding: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  pinPointEmoji: {
    fontSize: 16,
  },
  floatingHeaderArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  floatingHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  floatingBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingBackTxt: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  floatingRouteCard: {
    flex: 1,
    backgroundColor: '#1c1b1b',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    gap: 6,
  },
  floatingRoutePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floatingIconBlue: {
    color: '#3b82f6',
    fontSize: 14,
  },
  floatingIconGreen: {
    color: '#ccff00',
    fontSize: 14,
  },
  floatingRouteText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  entranceBadge: {
    backgroundColor: '#2d2f2f',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  entranceText: {
    color: '#8a8c8c',
    fontSize: 9,
    fontWeight: '700',
  },
  plusIcon: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  floatingRouteDivider: {
    height: 1,
    backgroundColor: '#2d2f2f',
    marginLeft: 22,
  },
  bottomRideSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '54%', // Overlay bottom part of screen
    backgroundColor: '#151616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    paddingTop: 10,
  },
  activeCategoryBox: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2f2f',
    gap: 12,
  },
  activeCategoryMeta: {
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    borderRadius: 16,
    padding: 12,
  },
  categoryTitleRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  categoryEmojiBig: {
    fontSize: 34,
  },
  categoryNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryNameBig: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  infoIconCircle: {
    color: '#8a8c8c',
    fontSize: 12,
  },
  editPencil: {
    fontSize: 12,
    marginLeft: 4,
  },
  categorySubtitleBig: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '700',
    marginTop: 2,
  },
  categoryDescriptionBig: {
    fontSize: 11,
    color: '#8a8c8c',
    marginTop: 1,
  },
  activeFareStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1f1f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 10,
  },
  stepperCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  stepperFareValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  stepperLabel: {
    color: '#8a8c8c',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  alternativeList: {
    flex: 1,
    paddingHorizontal: 20,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2f2f',
  },
  categoryRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  categoryEmojiSmall: {
    fontSize: 24,
  },
  categoryNameSmall: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  categorySubSmall: {
    color: '#8a8c8c',
    fontSize: 11,
    marginTop: 2,
  },
  categoryFareSmall: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  taxNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1f1f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 14,
    gap: 10,
  },
  taxNoticeIcon: {
    color: '#8a8c8c',
    fontSize: 14,
  },
  taxNoticeText: {
    color: '#8a8c8c',
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  sheetActionsFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2d2f2f',
    backgroundColor: '#151616',
    gap: 14,
  },
  toggleRowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTextCol: {
    flex: 1,
  },
  autoAcceptLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  toggleSwitchSmall: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2d2f2f',
    padding: 2,
    justifyContent: 'center',
  },
  toggleSwitchKnobSmall: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#8a8c8c',
  },
  toggleKnobOn: {
    backgroundColor: '#000',
    alignSelf: 'flex-end',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cashBadgeFooter: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashBadgeEmoji: {
    fontSize: 20,
  },
  findDriverButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  findDriverButtonText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '900',
  },
  filterButtonFooter: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonIcon: {
    color: '#ffffff',
    fontSize: 18,
  },
  dragIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3e4040',
    alignSelf: 'center',
    marginBottom: 10,
  },
});
