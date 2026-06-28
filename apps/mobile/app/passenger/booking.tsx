import { useEffect, useState } from 'react';
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
import { useAuth } from '../../src/auth/AuthContext';
import { useCurrentLocation } from '../../src/hooks/location';
import { useRecentDestinations } from '../../src/hooks/passenger';
import {
  BASE_FARES,
  RIDE_TYPE_LABELS,
  fareBounds,
  type Gender,
  type RideType,
} from '../../src/domain/types';

const RIDE_TYPES = Object.keys(RIDE_TYPE_LABELS) as RideType[];

// Pool fare helpers — same progressive formula as pool-ride.tsx
// factor(n) = (48 + (n-1)(n+6)) / 48
function poolPerSeat(soloFare: number, riders: number): number {
  const factor = (48 + (riders - 1) * (riders + 6)) / 48;
  return Math.ceil((soloFare * factor) / riders);
}
function poolDriverTotal(soloFare: number, riders: number): number {
  return poolPerSeat(soloFare, riders) * riders;
}

export default function Booking() {
  const router = useRouter();
  const { user } = useAuth();
  const { coords, address: currentAddress, status: locStatus, request: requestLocation } =
    useCurrentLocation();
  const recents = useRecentDestinations(user?.uid);

  const [stage, setStage] = useState<'route' | 'details'>('route');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');

  // Prefill the pickup with the rider's real (reverse-geocoded) address once we
  // have it, unless they've already typed something.
  useEffect(() => {
    if (currentAddress) setPickup((prev) => (prev.trim() ? prev : currentAddress));
  }, [currentAddress]);

  // Details state
  const [rideType, setRideType] = useState<RideType>('ac');
  const [fare, setFare] = useState<number>(BASE_FARES.ac);
  const [seats, setSeats] = useState(1);
  const [gender, setGender] = useState<Gender>('unspecified');
  const [pool, setPool] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'wallet'>('cash');
  const [preferFemale, setPreferFemale] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [showPromo, setShowPromo] = useState(false);
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
    if (!dropoff.trim()) {
      setError('Enter your destination first.');
      setStage('route');
      return;
    }
    if (!coords) {
      setError('We need your location to set the pickup. Please enable location access.');
      requestLocation();
      return;
    }
    setLoading(true);
    try {
      const pickupAddress = pickup.trim() || currentAddress || 'Current location';
      // The backend stores coordinates but matches by the public request feed,
      // not distance, and there is no geocoder yet — so the destination carries
      // the rider's coordinates and the typed address as the meaningful field.
      const res = await api.createTrip({
        rideType,
        offeredFare: fare,
        seats,
        passengerGender: gender,
        pool,
        paymentMethod,
        preferFemaleDriver: preferFemale,
        promoCode: promoCode.trim() || undefined,
        pickup: { lat: coords.lat, lng: coords.lng, address: pickupAddress },
        dropoff: { lat: coords.lat, lng: coords.lng, address: dropoff.trim() },
      });
      router.replace(`/passenger/trip/${res.tripId}`);
    } catch (e) {
      const code = e instanceof FirebaseError ? e.message : 'Could not create the ride.';
      setError(code);
    } finally {
      setLoading(false);
    }
  }

  const query = dropoff.trim().toLowerCase();
  const filteredRecents = query
    ? recents.filter((r) => r.address.toLowerCase().includes(query))
    : recents;

  // STAGE 1: ROUTE SELECTOR SCREEN (Image 1 Mockup)
  if (stage === 'route') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Enter your route</Text>
          <Pressable
            style={styles.closeBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          >
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

        {/* Section header */}
        <View style={styles.tabsContainer}>
          <Text style={styles.sectionHeader}>
            {query ? 'Recent matches' : 'Recent destinations'}
          </Text>
        </View>

        {/* Results: the rider's own recent destinations (real data) */}
        <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled">
          {filteredRecents.length > 0 ? (
            filteredRecents.map((loc) => (
              <Pressable
                key={loc.address}
                style={styles.resultItem}
                onPress={() => selectLocation(loc.address)}
              >
                <View style={styles.resultIconCircle}>
                  <Text style={styles.resultIcon}>🕒</Text>
                </View>
                <View style={styles.resultMeta}>
                  <Text style={styles.resultName} numberOfLines={1}>{loc.address}</Text>
                  <Text style={styles.resultAddress}>Recent destination</Text>
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyResults}>
              <Text style={styles.emptyResultsText}>
                {dropoff.trim()
                  ? 'No saved match — continue with what you typed.'
                  : 'Type where you want to go. Destinations from your past rides will appear here.'}
              </Text>
              {dropoff.trim().length > 0 ? (
                <Pressable style={styles.useTypedBtn} onPress={() => selectLocation(dropoff.trim())}>
                  <Text style={styles.useTypedBtnText}>Continue to “{dropoff.trim()}”</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>
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
              <Text style={styles.floatingRouteText} numberOfLines={1}>
                {pickup.trim() || currentAddress || 'Current location'}
              </Text>
            </View>
            <View style={styles.floatingRouteDivider} />
            <View style={styles.floatingRoutePoint}>
              <Text style={styles.floatingIconGreen}>🏁</Text>
              <Text style={styles.floatingRouteText} numberOfLines={1}>
                {dropoff.trim() || 'Destination'}
              </Text>
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
                <Text style={styles.categorySubtitleBig}>👤 {seats} seat{seats > 1 ? 's' : ''}</Text>
                <Text style={styles.categoryDescriptionBig}>
                  Fare range PKR {bounds.min}–{bounds.max}
                </Text>
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
                    PKR {fareBounds(rt).min}–{fareBounds(rt).max}
                  </Text>
                </View>
              </View>
              <Text style={styles.categoryFareSmall}>PKR {BASE_FARES[rt]}</Text>
            </Pressable>
          ))}

          {/* ── Pool Ride Incentive Banner ── */}
          {(() => {
            const riders4   = poolPerSeat(fare, 4);
            const riders3   = poolPerSeat(fare, 3);
            const driverSolo = fare;
            const driver4    = poolDriverTotal(fare, 4);
            const savePct    = Math.round(((fare - riders4) / fare) * 100);
            const earnExtra  = Math.round(((driver4 - driverSolo) / driverSolo) * 100);
            return (
              <Pressable
                style={styles.poolBanner}
                onPress={() => router.push('/passenger/pool-ride')}
              >
                {/* Top row: title + badge */}
                <View style={styles.poolBannerTop}>
                  <Text style={styles.poolBannerTitle}>🔀 Ride Sharing (Pool)</Text>
                  <View style={styles.poolSaveBadge}>
                    <Text style={styles.poolSaveBadgeText}>Save up to {savePct}%</Text>
                  </View>
                </View>

                {/* Two columns: passenger | driver */}
                <View style={styles.poolBannerCols}>
                  {/* Left: passenger */}
                  <View style={styles.poolBannerCol}>
                    <Text style={styles.poolColIcon}>👤</Text>
                    <Text style={styles.poolColHeading}>You pay</Text>
                    <View style={styles.poolFareComparison}>
                      <Text style={styles.poolFareBefore}>PKR {fare}</Text>
                      <Text style={styles.poolFareArrow}> → </Text>
                      <Text style={styles.poolFareAfter}>PKR {riders4}</Text>
                    </View>
                    <Text style={styles.poolColSub}>
                      with 4 riders · <Text style={{ color: '#4ade80' }}>−{savePct}%</Text>
                    </Text>
                    <Text style={styles.poolColTip}>
                      PKR {riders3} with 3 riders
                    </Text>
                  </View>

                  <View style={styles.poolBannerDivider} />

                  {/* Right: driver */}
                  <View style={styles.poolBannerCol}>
                    <Text style={styles.poolColIcon}>🚗</Text>
                    <Text style={styles.poolColHeading}>Driver earns</Text>
                    <View style={styles.poolFareComparison}>
                      <Text style={styles.poolFareBefore}>PKR {driverSolo}</Text>
                      <Text style={styles.poolFareArrow}> → </Text>
                      <Text style={[styles.poolFareAfter, { color: '#fbbf24' }]}>PKR {driver4}</Text>
                    </View>
                    <Text style={styles.poolColSub}>
                      with 4 riders · <Text style={{ color: '#fbbf24' }}>+{earnExtra}%</Text>
                    </Text>
                    <Text style={styles.poolColTip}>Same trip, more income</Text>
                  </View>
                </View>

                {/* CTA */}
                <View style={styles.poolBannerCTA}>
                  <Text style={styles.poolBannerCTAText}>Try Pool Ride →</Text>
                </View>
              </Pressable>
            );
          })()}

          {/* Notice Banner */}
          <View style={styles.taxNoticeBanner}>
            <Text style={styles.taxNoticeIcon}>ⓘ</Text>
            <Text style={styles.taxNoticeText}>
              Fare doesn't include state entry tax, tolls, or parking fees
            </Text>
          </View>
        </ScrollView>

        {/* Footer controls */}
        <View style={styles.sheetActionsFooter}>
          {/* Payment method toggle */}
          <View style={styles.paymentToggleRow}>
            <Pressable
              style={[styles.paymentBtn, paymentMethod === 'cash' && styles.paymentBtnActive]}
              onPress={() => setPaymentMethod('cash')}
            >
              <Text style={styles.paymentBtnIcon}>💵</Text>
              <Text style={[styles.paymentBtnLabel, paymentMethod === 'cash' && styles.paymentBtnLabelActive]}>Cash</Text>
            </Pressable>
            <Pressable
              style={[styles.paymentBtn, paymentMethod === 'wallet' && styles.paymentBtnActive]}
              onPress={() => setPaymentMethod('wallet')}
            >
              <Text style={styles.paymentBtnIcon}>💳</Text>
              <Text style={[styles.paymentBtnLabel, paymentMethod === 'wallet' && styles.paymentBtnLabelActive]}>Wallet</Text>
            </Pressable>
          </View>

          {/* Option toggles row */}
          <View style={styles.optionTogglesRow}>
            {/* Female driver preference */}
            <Pressable style={styles.optionToggle} onPress={() => setPreferFemale(v => !v)}>
              <Text style={styles.optionToggleIcon}>👩</Text>
              <Text style={[styles.optionToggleLabel, preferFemale && { color: colors.primary }]}>
                Female driver
              </Text>
              <View style={[styles.toggleSwitchSmall, preferFemale && { backgroundColor: colors.primary }]}>
                <View style={[styles.toggleSwitchKnobSmall, preferFemale && styles.toggleKnobOn]} />
              </View>
            </Pressable>
            {/* Promo code */}
            <Pressable style={styles.optionToggle} onPress={() => setShowPromo(v => !v)}>
              <Text style={styles.optionToggleIcon}>🎟️</Text>
              <Text style={[styles.optionToggleLabel, promoCode && { color: colors.primary }]}>
                {promoCode || 'Promo code'}
              </Text>
            </Pressable>
          </View>

          {/* Promo code input */}
          {showPromo && (
            <View style={styles.promoInputRow}>
              <TextInput
                value={promoCode}
                onChangeText={t => setPromoCode(t.toUpperCase())}
                placeholder="Enter promo code"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                style={styles.promoInput}
              />
              {promoCode ? (
                <Pressable onPress={() => setPromoCode('')} style={styles.promoClear}>
                  <Text style={{ color: colors.muted }}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {!coords && locStatus !== 'loading' ? (
            <Pressable onPress={requestLocation}>
              <Text style={styles.locHint}>📍 Tap to enable location for your pickup point</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.findDriverButton, pressed && { opacity: 0.85 }]}
            onPress={findDriver}
            disabled={loading}
          >
            <Text style={styles.findDriverButtonText}>
              {loading ? 'Booking...' : `Find a driver · PKR ${fare}${paymentMethod === 'cash' ? ' cash' : ' wallet'}`}
            </Text>
          </Pressable>
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
  sectionHeader: {
    color: '#8a8c8c',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  emptyResults: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 14,
  },
  emptyResultsText: {
    color: '#8a8c8c',
    fontSize: 13,
    lineHeight: 19,
  },
  useTypedBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  useTypedBtnText: {
    color: '#ccff00',
    fontWeight: '800',
    fontSize: 14,
  },
  locHint: {
    color: '#ccff00',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
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
    color: '#2563eb', // Destination highlight
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
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: '#2d2f2f',
    backgroundColor: '#151616',
    gap: 10,
  },

  // Payment toggle
  paymentToggleRow:    { flexDirection: 'row', gap: 8 },
  paymentBtn:          {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, borderWidth: 1.5,
    borderColor: '#2d2f2f', backgroundColor: '#1e1f1f',
  },
  paymentBtnActive:    { borderColor: colors.primary, backgroundColor: `${colors.primary}15` },
  paymentBtnIcon:      { fontSize: 16 },
  paymentBtnLabel:     { fontSize: 13, fontWeight: '700', color: '#8a8c8c' },
  paymentBtnLabelActive: { color: colors.primary },

  // Option toggles
  optionTogglesRow:    { flexDirection: 'row', gap: 8 },
  optionToggle:        {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1e1f1f', borderRadius: 10, borderWidth: 1,
    borderColor: '#2d2f2f', paddingHorizontal: 10, paddingVertical: 8,
  },
  optionToggleIcon:    { fontSize: 14 },
  optionToggleLabel:   { flex: 1, fontSize: 12, fontWeight: '700', color: '#8a8c8c' },

  // Promo input
  promoInputRow:       {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e1f1f', borderRadius: 10, borderWidth: 1,
    borderColor: colors.primary, paddingHorizontal: 12, height: 40,
  },
  promoInput:          { flex: 1, color: '#fff', fontSize: 14, fontWeight: '700' },
  promoClear:          { padding: 4 },

  toggleTextCol: { flex: 1 },
  autoAcceptLabel: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
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

  // ── Pool incentive banner ──────────────────────────────────────────────────
  poolBanner: {
    backgroundColor: '#0d1a06',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#ccff0030',
    marginVertical: 10,
    overflow: 'hidden',
  },
  poolBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a2e0f',
  },
  poolBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ccff00',
  },
  poolSaveBadge: {
    backgroundColor: '#ccff0020',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccff0040',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  poolSaveBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#ccff00',
  },
  poolBannerCols: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  poolBannerCol: {
    flex: 1,
    paddingHorizontal: 12,
    gap: 3,
  },
  poolBannerDivider: {
    width: 1,
    backgroundColor: '#1a2e0f',
  },
  poolColIcon: { fontSize: 16, marginBottom: 2 },
  poolColHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  poolFareComparison: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  poolFareBefore: {
    fontSize: 12,
    color: '#6b7280',
    textDecorationLine: 'line-through',
  },
  poolFareArrow: {
    fontSize: 11,
    color: '#4b5563',
  },
  poolFareAfter: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ccff00',
  },
  poolColSub: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 1,
  },
  poolColTip: {
    fontSize: 10,
    color: '#4b5563',
    fontStyle: 'italic',
  },
  poolBannerCTA: {
    backgroundColor: '#ccff0015',
    borderTopWidth: 1,
    borderTopColor: '#1a2e0f',
    alignItems: 'center',
    paddingVertical: 10,
  },
  poolBannerCTAText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ccff00',
  },
});
