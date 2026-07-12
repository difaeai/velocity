import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { api, type CommuteDay, type NearbyPublicPool } from '../../src/api/client';
import { colors } from '../../src/config';
import { useAuth } from '../../src/auth/AuthContext';
import { useFeatureFlags } from '../../src/hooks/driver';
import { useCurrentLocation } from '../../src/hooks/location';
import { useRecentDestinations } from '../../src/hooks/passenger';
import { usePlacesAutocomplete, fetchPlaceDetail, type PlacePrediction } from '../../src/hooks/places';
import { LiveMap } from '../../src/ui/LiveMap';
import {
  BASE_FARES,
  RIDE_TYPE_LABELS,
  fareBounds,
  type Gender,
  type PoolVisibility,
  type RideType,
} from '../../src/domain/types';
import {
  CityFareConfig, VehicleCategory,
  calculateFare, round5,
} from '../../src/lib/fareEngine';

// Map app RideType keys to fareEngine VehicleCategory keys
const RIDE_TO_CAT: Record<RideType, VehicleCategory> = {
  mini:    'mini',
  bike:    'moto',
  auto:    'rickshaw',
  ac:      'ac_car',
  comfort: 'luxury',
  xl:      'luxury',
};

// The prefilled offer is pinned below the engine's market-fair estimate so
// Velocity always reads cheaper than inDrive/Yango for the same trip:
// display = recommendedFare × ANCHOR_FACTOR, clamped to the allowed bid range.
// 0.80 = "we look ~20% cheaper than the market". Tune here.
const ANCHOR_FACTOR = 0.8;

function anchorFare(est: { recommendedFare: number; minAcceptableBid: number; suggestedMaxBid: number }): number {
  const target = est.recommendedFare * ANCHOR_FACTOR;
  return round5(Math.min(est.suggestedMaxBid, Math.max(est.minAcceptableBid, target)));
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Pool fare breakdown — percentage of solo fare per seat based on total riders
// 2 riders total (you + 1 joins): each pays 60%
// 3 riders total (you + 2 join):  each pays 40%
// 4 riders total (you + 3 join):  each pays 35%
const POOL_TIERS = [
  { extra: 1, pct: 0.60, label: '+1 joins' },
  { extra: 2, pct: 0.40, label: '+2 join'  },
  { extra: 3, pct: 0.35, label: '+3 join'  },
];
function poolFareFor(soloFare: number, extra: number): number {
  const tier = POOL_TIERS.find(t => t.extra === extra);
  return Math.ceil(soloFare * (tier?.pct ?? 1));
}

export default function Booking() {
  const router = useRouter();
  const { user } = useAuth();
  // The ride sheet is absolutely pinned to the screen bottom; edge-to-edge
  // Android draws it behind the system navigation bar unless padded.
  const insets = useSafeAreaInsets();
  const { coords, address: currentAddress, status: locStatus, request: requestLocation } =
    useCurrentLocation();
  const recents = useRecentDestinations(user?.uid);

  const [stage, setStage] = useState<'route' | 'details'>('route');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  // Resolved coords for the selected dropoff place
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Places API (New) requires session tokens to be UUID v4
  const sessionTokenRef = useRef(uuidv4());

  function newSession() { sessionTokenRef.current = uuidv4(); }

  // Prefill the pickup with the rider's real (reverse-geocoded) address once we
  // have it, unless they've already typed something.
  useEffect(() => {
    if (currentAddress) setPickup((prev) => (prev.trim() ? prev : currentAddress));
  }, [currentAddress]);

  // Fare engine config from Firestore (city-level rates set by admin)
  const [fareConfig, setFareConfig] = useState<CityFareConfig | null>(null);
  useEffect(() => {
    getDoc(doc(db, 'fareConfig', 'islamabad_rawalpindi')).then((snap) => {
      if (snap.exists()) setFareConfig(snap.data() as CityFareConfig);
    }).catch(() => {});
  }, []);

  // Details state — one explicit booking mode; Solo and Pool can never be
  // "selected" at the same time, and one CTA reflects the active mode.
  const [mode, setMode] = useState<'solo' | 'pool'>('solo');
  const [rideType, setRideType] = useState<RideType>('mini');
  const [fare, setFare] = useState<number>(BASE_FARES.mini);
  const [fareText, setFareText] = useState<string>(String(BASE_FARES.mini));
  const [seats] = useState(1);
  const [gender] = useState<Gender>('unspecified');
  const [autoAccept, setAutoAccept] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'wallet'>('cash');
  // Pool rides: public → nearby riders can discover and join; private → only
  // people with the share link can join.
  const [poolVisibility, setPoolVisibility] = useState<PoolVisibility>('public');
  const [nearbyPools, setNearbyPools] = useState<NearbyPublicPool[]>([]);
  const [joinCode, setJoinCode] = useState('');
  // Wallet ride payments depend on wallet top-ups, which are "Coming Soon" for
  // launch — until then rides are cash-only.
  const { walletTopupEnabled } = useFeatureFlags();
  const [promoCode, setPromoCode] = useState('');
  const [showPromo, setShowPromo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scheduled (frequent) rides — auto-booked by the backend at the set time.
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedDays, setSchedDays] = useState<CommuteDay[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [schedHour, setSchedHour] = useState(8);
  const [schedMin, setSchedMin] = useState(30);
  const [schedSaving, setSchedSaving] = useState(false);

  const bounds = fareBounds(rideType);

  // Compute engine estimate whenever route + config are available
  const distKm = coords && dropoffCoords ? haversineKm(coords, dropoffCoords) : null;
  const engineEst = fareConfig && distKm
    ? calculateFare(fareConfig, { category: RIDE_TO_CAT[rideType], distanceKm: distKm, durationMin: Math.round(distKm * 3.5) })
    : null;

  // Auto-fill the offer from the admin-configured fare engine — but never
  // override a fare the passenger has typed or bumped for this route.
  const userEditedFare = useRef(false);
  useEffect(() => {
    userEditedFare.current = false;
  }, [dropoffCoords, rideType]);

  const prefillAnchor = engineEst
    ? anchorFare(engineEst)
    : fareConfig
      ? fareConfig.categories[RIDE_TO_CAT[rideType]]?.minFare ?? null
      : null;
  useEffect(() => {
    if (prefillAnchor == null || userEditedFare.current) return;
    setFare(prefillAnchor);
    setFareText(String(prefillAnchor));
  }, [prefillAnchor]);

  // Engine-anchored price for a ride type (falls back to the static base fare).
  function priceFor(rt: RideType): number {
    const est = fareConfig && distKm
      ? calculateFare(fareConfig, { category: RIDE_TO_CAT[rt], distanceKm: distKm, durationMin: Math.round(distKm * 3.5) })
      : null;
    return est ? anchorFare(est) : BASE_FARES[rt];
  }

  function selectRide(rt: RideType) {
    setRideType(rt);
    const base = priceFor(rt);
    setFare(base);
    setFareText(String(base));
  }

  // Public pools near the rider — shown in Pool mode so they can hop onto an
  // existing pool instead of starting their own.
  useEffect(() => {
    if (mode !== 'pool' || !coords) return;
    let alive = true;
    api.getNearbyPublicPoolTrips({ lat: coords.lat, lng: coords.lng, radiusKm: 5 })
      .then((r) => { if (alive) setNearbyPools(r.pools); })
      .catch(() => { /* discovery is best-effort */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function bumpFare(delta: number) {
    userEditedFare.current = true;
    const min = engineEst?.minAcceptableBid ?? bounds.min;
    const max = engineEst?.suggestedMaxBid  ?? bounds.max;
    setFare((f) => {
      const next = Math.min(max, Math.max(min, f + delta));
      setFareText(String(next));
      return next;
    });
  }

  function commitFareText() {
    userEditedFare.current = true;
    const parsed  = parseInt(fareText, 10);
    const min     = engineEst?.minAcceptableBid ?? bounds.min;
    const max     = engineEst?.suggestedMaxBid  ?? bounds.max;
    const clamped = isNaN(parsed) ? fare : Math.min(max, Math.max(min, parsed));
    setFare(clamped);
    setFareText(String(clamped));
  }

  async function selectPrediction(pred: PlacePrediction) {
    setDropoff(pred.fullText);
    setDropoffCoords(null);
    setStage('details');
    // Fetch real lat/lng in the background; used when creating the trip
    const detail = await fetchPlaceDetail(pred.placeId, sessionTokenRef.current);
    if (detail) setDropoffCoords({ lat: detail.lat, lng: detail.lng });
    newSession(); // rotate token after detail call closes the billing session
  }

  function selectLocation(locName: string) {
    setDropoff(locName);
    setDropoffCoords(null);
    setStage('details');
  }

  async function submitRide() {
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
    // Clamp the offer into the allowed band before it reaches the backend, in
    // case the fare field is still focused and never got its onBlur clamp.
    const min = engineEst?.minAcceptableBid ?? bounds.min;
    const max = engineEst?.suggestedMaxBid  ?? bounds.max;
    const safeFare = Math.min(max, Math.max(min, fare));
    if (safeFare !== fare) {
      setFare(safeFare);
      setFareText(String(safeFare));
    }
    setLoading(true);
    try {
      const isPool = mode === 'pool';
      const pickupAddress = pickup.trim() || currentAddress || 'Current location';
      // The backend stores coordinates but matches by the public request feed,
      // not distance, and there is no geocoder yet — so the destination carries
      // the rider's coordinates and the typed address as the meaningful field.
      const destCoords = dropoffCoords ?? { lat: coords.lat, lng: coords.lng };
      const res = await api.createTrip({
        rideType,
        // Pool rides offer the FULL solo fare too — the per-seat discount only
        // materialises as riders actually join (never send a discounted fare,
        // it would fall below the fare-engine floor and be rejected).
        offeredFare: safeFare,
        seats: isPool ? 1 : seats,
        passengerGender: gender,
        pool: isPool,
        poolVisibility: isPool ? poolVisibility : undefined,
        paymentMethod,
        preferFemaleDriver: false,
        promoCode: promoCode.trim() || undefined,
        pickup: { lat: coords.lat, lng: coords.lng, address: pickupAddress },
        dropoff: { lat: destCoords.lat, lng: destCoords.lng, address: dropoff.trim() },
      });
      // Straight to the Uber-style finding-driver map. Pool rides open the
      // share sheet once so the host can invite riders immediately.
      router.replace(`/passenger/trip/${res.tripId}${isPool ? '?shareNow=1' : ''}` as Parameters<typeof router.replace>[0]);
    } catch (e) {
      setError(e instanceof FirebaseError ? e.message : 'Could not create the ride.');
    } finally {
      setLoading(false);
    }
  }

  function toggleSchedDay(day: CommuteDay) {
    setSchedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  async function saveSchedule() {
    if (!dropoff.trim()) {
      Alert.alert('Destination needed', 'Pick your destination first, then schedule the ride.');
      return;
    }
    if (!coords) {
      Alert.alert('Location needed', 'Enable location access so we know your pickup point.');
      requestLocation();
      return;
    }
    if (schedDays.length === 0) {
      Alert.alert('Pick days', 'Choose at least one day for this ride.');
      return;
    }
    setSchedSaving(true);
    try {
      const time = `${String(schedHour).padStart(2, '0')}:${String(schedMin).padStart(2, '0')}`;
      const pickupAddress = pickup.trim() || currentAddress || 'Current location';
      const destCoords = dropoffCoords ?? { lat: coords.lat, lng: coords.lng };
      await api.upsertScheduledRide({
        pickup:  { lat: coords.lat, lng: coords.lng, address: pickupAddress },
        dropoff: { lat: destCoords.lat, lng: destCoords.lng, address: dropoff.trim() },
        rideType,
        offeredFare: fare,
        seats,
        passengerGender: gender,
        paymentMethod,
        days: schedDays,
        time,
      });
      setScheduleOpen(false);
      Alert.alert(
        'Ride scheduled 🗓️',
        `We'll request this ride automatically at ${time} on your selected days — no need to book it manually.`,
        [
          { text: 'View my schedules', onPress: () => router.push('/passenger/scheduled-rides' as Parameters<typeof router.push>[0]) },
          { text: 'Done' },
        ],
      );
    } catch (e) {
      Alert.alert('Could not schedule', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setSchedSaving(false);
    }
  }

  const { predictions, loading: placesLoading, apiStatus, apiMessage } = usePlacesAutocomplete(dropoff, sessionTokenRef.current);
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
            {placesLoading ? 'Searching...' : (query && predictions.length > 0 ? 'Suggestions' : 'Recent destinations')}
          </Text>
          {placesLoading ? <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} /> : null}
        </View>

        <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled">
          {/* Google Places suggestions */}
          {query && predictions.length > 0 && predictions.map((pred) => (
            <Pressable
              key={pred.placeId}
              style={styles.resultItem}
              onPress={() => selectPrediction(pred)}
            >
              <View style={styles.resultIconCircle}>
                <Text style={styles.resultIcon}>📍</Text>
              </View>
              <View style={styles.resultMeta}>
                <Text style={styles.resultName} numberOfLines={1}>{pred.mainText}</Text>
                <Text style={styles.resultAddress} numberOfLines={1}>{pred.secondaryText}</Text>
              </View>
            </Pressable>
          ))}

          {/* Recent destinations (shown when no Places results or no query) */}
          {(!query || predictions.length === 0) && filteredRecents.map((loc) => (
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
          ))}

          {/* API error hint */}
          {apiStatus && apiStatus !== 'OK' && apiStatus !== 'ZERO_RESULTS' && query.length > 1 && (
            <View style={styles.emptyResults}>
              <Text style={[styles.emptyResultsText, { color: '#ef4444' }]}>
                Places API: {apiStatus}
              </Text>
              {apiMessage ? (
                <Text style={[styles.emptyResultsText, { color: '#ef4444', fontSize: 11, marginTop: 2 }]}>
                  {apiMessage}
                </Text>
              ) : null}
            </View>
          )}

          {/* Empty / fallback */}
          {query && predictions.length === 0 && filteredRecents.length === 0 && !placesLoading && (
            <View style={styles.emptyResults}>
              <Text style={styles.emptyResultsText}>No results found. You can still continue with what you typed.</Text>
              <Pressable style={styles.useTypedBtn} onPress={() => selectLocation(dropoff.trim())}>
                <Text style={styles.useTypedBtnText}>{'Continue to "' + dropoff.trim() + '"'}</Text>
              </Pressable>
            </View>
          )}

          {!query && recents.length === 0 && (
            <View style={styles.emptyResults}>
              <Text style={styles.emptyResultsText}>Type your destination above to search for places.</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // STAGE 2: RIDE TYPE SELECTION — one explicit Solo / Pool mode
  const maxSavePct = Math.round((1 - (POOL_TIERS[POOL_TIERS.length - 1]?.pct ?? 1)) * 100);
  const fareMin = engineEst?.minAcceptableBid ?? bounds.min;
  const fareMax = engineEst?.suggestedMaxBid  ?? bounds.max;

  return (
    <View style={styles.safe}>
      {/* Real live map showing the actual pickup → destination route */}
      <View style={styles.mapContainer}>
        <LiveMap coords={coords} pickup={coords} dropoff={dropoffCoords} />
      </View>

      {/* Top: route summary */}
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

      {/* Bottom sheet */}
      <View style={[styles.bottomRideSheet, { paddingBottom: insets.bottom }]}>
        <View style={styles.dragIndicator} />

        {/* Solo ⟷ Pool — one explicit choice; the single CTA below follows it */}
        <View style={styles.modeToggleRow}>
          <Pressable
            style={[styles.modeBtn, mode === 'solo' && styles.modeBtnActive]}
            onPress={() => setMode('solo')}
          >
            <Text style={[styles.modeBtnTitle, mode === 'solo' && styles.modeBtnTitleActive]}>🚗 Solo</Text>
            <Text style={styles.modeBtnSub}>The car is yours</Text>
          </Pressable>
          <Pressable
            style={[styles.modeBtn, mode === 'pool' && styles.modeBtnActive]}
            onPress={() => {
              setMode('pool');
              if (rideType === 'bike') selectRide('mini'); // bikes have one seat — nothing to pool
            }}
          >
            <Text style={[styles.modeBtnTitle, mode === 'pool' && styles.modeBtnTitleActive]}>🔀 Pool</Text>
            <Text style={[styles.modeBtnSub, mode === 'pool' && { color: colors.primary }]}>
              Share & save up to {maxSavePct}%
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.alternativeList}
          contentContainerStyle={{ paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Vehicle type (bikes can't be pooled) */}
          {([
            { key: 'mini'    as RideType, label: 'Mini',     desc: 'Lower fares, no AC',       icon: '🚗', seats: 4 },
            { key: 'bike'    as RideType, label: 'Moto',     desc: 'No traffic, lower prices', icon: '🏍️', seats: 1 },
            { key: 'ac'      as RideType, label: 'Ride A/C', desc: 'Cars with AC',             icon: '❄️', seats: 4 },
            { key: 'comfort' as RideType, label: 'Premium',  desc: 'Sedans with AC',           icon: '⭐', seats: 4 },
          ] as const)
            .filter((rt) => mode === 'solo' || rt.seats > 1)
            .map((rt) => (
            <Pressable
              key={rt.key}
              style={[styles.categoryRow, rideType === rt.key && styles.categoryRowActive]}
              onPress={() => selectRide(rt.key)}
            >
              <View style={styles.categoryRowLeft}>
                <Text style={styles.categoryEmojiSmall}>{rt.icon}</Text>
                <View>
                  <Text style={[styles.categoryNameSmall, rideType === rt.key && { color: colors.primary }]}>
                    {rt.label}
                  </Text>
                  <Text style={styles.categorySubSmall}>
                    {rt.seats > 1 ? `${rt.seats} seats · ` : ''}{rt.desc}
                  </Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={[styles.categoryFareSmall, rideType === rt.key && { color: colors.primary, fontWeight: '900' }]}>
                  PKR {priceFor(rt.key)}
                </Text>
                {rideType === rt.key && <Text style={{ color: colors.primary, fontSize: 11, fontWeight: '800' }}>selected ✓</Text>}
              </View>
            </Pressable>
          ))}

          {/* Your fare offer */}
          <View style={styles.fareCard}>
            <View style={styles.soloFareStepper}>
              <Pressable style={styles.stepperCircle} onPress={() => bumpFare(-50)}>
                <Text style={styles.stepperText}>−</Text>
              </Pressable>
              <View style={{ alignItems: 'center', flex: 1 }}>
                <View style={styles.fareInputRow}>
                  <Text style={styles.fareInputPrefix}>PKR</Text>
                  <TextInput
                    value={fareText}
                    onChangeText={(t) => setFareText(t.replace(/[^0-9]/g, ''))}
                    onBlur={commitFareText}
                    keyboardType="number-pad"
                    style={styles.fareInput}
                    selectTextOnFocus
                    returnKeyType="done"
                    onSubmitEditing={commitFareText}
                  />
                </View>
                <Text style={styles.stepperLabel}>your offer · tap to edit or use − +</Text>
              </View>
              <Pressable style={styles.stepperCircle} onPress={() => bumpFare(50)}>
                <Text style={styles.stepperText}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.fareRangeHint}>
              {engineEst
                ? `${distKm ? `~${distKm.toFixed(1)} km · ` : ''}Recommended PKR ${engineEst.recommendedFare} · Allowed PKR ${fareMin}–${fareMax}${engineEst.surgeApplied > 1 ? ` · Surge ${engineEst.surgeApplied.toFixed(1)}×` : ''}`
                : `Allowed range PKR ${fareMin}–${fareMax}`}
            </Text>
          </View>

          {mode === 'pool' && (
            <>
              {/* Everyone's fare drops as riders join — you always offer the solo fare */}
              <Text style={styles.sectionLabel}>FARE PER RIDER AS PEOPLE JOIN</Text>
              <View style={styles.poolTierTable}>
                <View style={styles.poolTierRow}>
                  <View style={styles.poolTierLeft}>
                    <Text style={styles.poolTierRiders}>👤  Just you</Text>
                  </View>
                  <Text style={styles.poolTierFareSolo}>PKR {fare}</Text>
                  <Text style={styles.poolTierSavingNone}>—</Text>
                </View>
                {POOL_TIERS.map((tier, i) => {
                  const tierFare = poolFareFor(fare, tier.extra);
                  const savePct  = Math.round((1 - tier.pct) * 100);
                  return (
                    <View key={tier.extra} style={styles.poolTierRow}>
                      <View style={styles.poolTierLeft}>
                        <Text style={styles.poolTierRiders}>{tier.label}</Text>
                      </View>
                      <Text style={styles.poolTierFare}>PKR {tierFare}</Text>
                      <View style={[styles.poolTierSavingBadge, i === POOL_TIERS.length - 1 && styles.poolTierSavingBest]}>
                        <Text style={[styles.poolTierSavingText, i === POOL_TIERS.length - 1 && { color: colors.primary }]}>
                          -{savePct}%
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* Who can join */}
              <Text style={styles.sectionLabel}>WHO CAN JOIN YOUR POOL</Text>
              <View style={styles.visRow}>
                <Pressable
                  style={[styles.visOpt, poolVisibility === 'public' && styles.visOptActive]}
                  onPress={() => setPoolVisibility('public')}
                >
                  <Text style={styles.visOptIcon}>🌍</Text>
                  <Text style={[styles.visOptTitle, poolVisibility === 'public' && { color: colors.primary }]}>Public</Text>
                  <Text style={styles.visOptSub}>Riders nearby can see & join</Text>
                </Pressable>
                <Pressable
                  style={[styles.visOpt, poolVisibility === 'private' && styles.visOptActive]}
                  onPress={() => setPoolVisibility('private')}
                >
                  <Text style={styles.visOptIcon}>🔒</Text>
                  <Text style={[styles.visOptTitle, poolVisibility === 'private' && { color: colors.primary }]}>Private</Text>
                  <Text style={styles.visOptSub}>Only people with your link</Text>
                </Pressable>
              </View>
              <Text style={styles.poolShareHint}>
                You get an invite link right after booking — share it on WhatsApp so friends can join and everyone pays less.
              </Text>

              {/* Manual code entry — mirrors the code shown on the link page */}
              <View style={styles.poolCodeRow}>
                <TextInput
                  value={joinCode}
                  onChangeText={(t) => setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="Have an invite code?"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  style={styles.poolCodeInput}
                  maxLength={12}
                />
                <Pressable
                  style={[styles.poolCodeGoBtn, !joinCode.trim() && { opacity: 0.4 }]}
                  disabled={!joinCode.trim()}
                  onPress={() => router.push(`/passenger/pool-join/${joinCode.trim()}` as Parameters<typeof router.push>[0])}
                >
                  <Text style={styles.poolCodeGoTxt}>Open</Text>
                </Pressable>
              </View>

              {/* Join an existing pool instead */}
              {nearbyPools.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>OR JOIN A POOL NEARBY</Text>
                  {nearbyPools.slice(0, 3).map((p) => (
                    <Pressable
                      key={p.code}
                      style={styles.nearbyPoolRow}
                      onPress={() => router.push(`/passenger/pool-join/${p.code}` as Parameters<typeof router.push>[0])}
                    >
                      <Text style={{ fontSize: 20 }}>🔀</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.nearbyPoolDest} numberOfLines={1}>{p.dropoffAddress}</Text>
                        <Text style={styles.nearbyPoolMeta}>
                          {p.distanceKm} km away · {p.riders} rider{p.riders > 1 ? 's' : ''} · {p.seatsLeft} seat{p.seatsLeft > 1 ? 's' : ''} left
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.nearbyPoolFare}>PKR {p.perSeatFareIfYouJoin}</Text>
                        <Text style={styles.nearbyPoolJoin}>Join →</Text>
                      </View>
                    </Pressable>
                  ))}
                </>
              )}
            </>
          )}

          {mode === 'solo' && (
            <>
              {/* Schedule this ride (frequent rides) */}
              <Pressable style={styles.scheduleCard} onPress={() => setScheduleOpen(true)}>
                <Text style={{ fontSize: 22 }}>🗓️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scheduleCardTitle}>Schedule this ride</Text>
                  <Text style={styles.scheduleCardSub}>
                    Ride this route often? We'll request it automatically at your time — no manual booking.
                  </Text>
                </View>
                <Text style={styles.scheduleCardChevron}>›</Text>
              </Pressable>
              <Pressable
                style={styles.scheduleManageLink}
                onPress={() => router.push('/passenger/scheduled-rides' as Parameters<typeof router.push>[0])}
              >
                <Text style={styles.scheduleManageText}>View my scheduled rides →</Text>
              </Pressable>
            </>
          )}

          <View style={styles.taxNoticeBanner}>
            <Text style={styles.taxNoticeIcon}>ⓘ</Text>
            <Text style={styles.taxNoticeText}>Fare doesn't include state entry tax, tolls, or parking fees</Text>
          </View>
        </ScrollView>

        {/* Footer: solo booking controls */}
        <View style={styles.sheetActionsFooter}>
          <View style={styles.paymentToggleRow}>
            <Pressable
              style={[styles.paymentBtn, paymentMethod === 'cash' && styles.paymentBtnActive]}
              onPress={() => setPaymentMethod('cash')}
            >
              <Text style={styles.paymentBtnIcon}>💵</Text>
              <Text style={[styles.paymentBtnLabel, paymentMethod === 'cash' && styles.paymentBtnLabelActive]}>Cash</Text>
            </Pressable>
            <Pressable
              style={[
                styles.paymentBtn,
                paymentMethod === 'wallet' && styles.paymentBtnActive,
                !walletTopupEnabled && { opacity: 0.5 },
              ]}
              disabled={!walletTopupEnabled}
              onPress={() => {
                if (!walletTopupEnabled) {
                  Alert.alert('Coming soon', 'Wallet payments are coming soon. Please pay the driver in cash for now.');
                  return;
                }
                setPaymentMethod('wallet');
              }}
            >
              <Text style={styles.paymentBtnIcon}>💳</Text>
              <Text style={[styles.paymentBtnLabel, paymentMethod === 'wallet' && styles.paymentBtnLabelActive]}>
                {walletTopupEnabled ? 'Wallet' : 'Wallet (soon)'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.optionTogglesRow}>
            {mode === 'solo' && (
              <Pressable style={styles.optionToggle} onPress={() => setAutoAccept(v => !v)}>
                <Text style={styles.optionToggleIcon}>⚡</Text>
                <Text style={[styles.optionToggleLabel, autoAccept && { color: colors.primary }]}>
                  Auto-accept offer of PKR {fare}
                </Text>
                <View style={[styles.toggleSwitchSmall, autoAccept && { backgroundColor: colors.primary }]}>
                  <View style={[styles.toggleSwitchKnobSmall, autoAccept && styles.toggleKnobOn]} />
                </View>
              </Pressable>
            )}
            <Pressable style={styles.optionToggle} onPress={() => setShowPromo(v => !v)}>
              <Text style={styles.optionToggleIcon}>🎟️</Text>
              <Text style={[styles.optionToggleLabel, promoCode && { color: colors.primary }]}>
                {promoCode || 'Promo code'}
              </Text>
            </Pressable>
          </View>

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
            onPress={submitRide}
            disabled={loading}
          >
            <Text style={styles.findDriverButtonText}>
              {loading
                ? 'Booking…'
                : mode === 'pool'
                  ? `Start Pool Ride · PKR ${fare}`
                  : `Find Driver · PKR ${fare} ${paymentMethod === 'cash' ? 'cash' : 'wallet'}`}
            </Text>
          </Pressable>
          {mode === 'pool' && !loading ? (
            <Text style={styles.poolCtaCaption}>
              PKR {fare} riding alone · drops to PKR {poolFareFor(fare, POOL_TIERS[POOL_TIERS.length - 1]?.extra ?? 3)} each with a full car
            </Text>
          ) : null}
        </View>
      </View>

      {/* Schedule-ride modal */}
      <Modal visible={scheduleOpen} transparent animationType="slide" onRequestClose={() => setScheduleOpen(false)}>
        <View style={styles.schedOverlay}>
          <View style={[styles.schedBox, { paddingBottom: 24 + insets.bottom }]}>
            <Text style={styles.schedTitle}>🗓️ Schedule this ride</Text>
            <Text style={styles.schedSub}>
              {`${(pickup.trim() || currentAddress || 'Current location')} → ${dropoff.trim() || 'Destination'}`}
            </Text>
            <Text style={styles.schedSub}>
              {RIDE_TYPE_LABELS[rideType]} · PKR {fare} · {paymentMethod === 'cash' ? 'Cash' : 'Wallet'}
            </Text>

            <Text style={styles.schedLabel}>REPEAT ON</Text>
            <View style={styles.schedDaysRow}>
              {([['mon', 'M'], ['tue', 'T'], ['wed', 'W'], ['thu', 'T'], ['fri', 'F'], ['sat', 'S'], ['sun', 'S']] as [CommuteDay, string][]).map(([day, letter], i) => {
                const on = schedDays.includes(day);
                return (
                  <Pressable
                    key={`${day}-${i}`}
                    style={[styles.schedDayChip, on && styles.schedDayChipOn]}
                    onPress={() => toggleSchedDay(day)}
                  >
                    <Text style={[styles.schedDayText, on && styles.schedDayTextOn]}>{letter}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.schedLabel}>PICKUP TIME</Text>
            <View style={styles.schedTimeRow}>
              <View style={styles.schedTimeStepper}>
                <Pressable style={styles.schedTimeBtn} onPress={() => setSchedHour(h => (h + 23) % 24)}>
                  <Text style={styles.schedTimeBtnText}>−</Text>
                </Pressable>
                <Text style={styles.schedTimeVal}>{String(schedHour).padStart(2, '0')}</Text>
                <Pressable style={styles.schedTimeBtn} onPress={() => setSchedHour(h => (h + 1) % 24)}>
                  <Text style={styles.schedTimeBtnText}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.schedTimeColon}>:</Text>
              <View style={styles.schedTimeStepper}>
                <Pressable style={styles.schedTimeBtn} onPress={() => setSchedMin(m => (m + 45) % 60)}>
                  <Text style={styles.schedTimeBtnText}>−</Text>
                </Pressable>
                <Text style={styles.schedTimeVal}>{String(schedMin).padStart(2, '0')}</Text>
                <Pressable style={styles.schedTimeBtn} onPress={() => setSchedMin(m => (m + 15) % 60)}>
                  <Text style={styles.schedTimeBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.schedActions}>
              <Pressable style={styles.schedCancelBtn} onPress={() => setScheduleOpen(false)}>
                <Text style={styles.schedCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.schedSaveBtn, schedSaving && { opacity: 0.6 }]}
                onPress={saveSchedule}
                disabled={schedSaving}
              >
                <Text style={styles.schedSaveText}>{schedSaving ? 'Saving…' : 'Save schedule'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Schedule-ride card + modal
  scheduleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 10 },
  scheduleCardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  scheduleCardSub: { fontSize: 11, color: colors.muted, marginTop: 2, lineHeight: 15 },
  scheduleCardChevron: { fontSize: 20, color: colors.muted },
  scheduleManageLink: { alignItems: 'center', paddingVertical: 8 },
  scheduleManageText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  schedOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  schedBox: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 10 },
  schedTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  schedSub: { fontSize: 12, color: colors.muted },
  schedLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, letterSpacing: 0.6, marginTop: 8 },
  schedDaysRow: { flexDirection: 'row', gap: 8 },
  schedDayChip: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  schedDayChipOn: { borderColor: colors.primary, backgroundColor: `${colors.primary}20` },
  schedDayText: { fontSize: 13, fontWeight: '800', color: colors.muted },
  schedDayTextOn: { color: colors.primary },
  schedTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  schedTimeStepper: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 6 },
  schedTimeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  schedTimeBtnText: { fontSize: 16, fontWeight: '900', color: colors.primary },
  schedTimeVal: { fontSize: 20, fontWeight: '900', color: colors.text, minWidth: 34, textAlign: 'center' },
  schedTimeColon: { fontSize: 20, fontWeight: '900', color: colors.text },
  schedActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  schedCancelBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  schedCancelText: { fontSize: 14, fontWeight: '700', color: colors.muted },
  schedSaveBtn: { flex: 1, height: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  schedSaveText: { fontSize: 14, fontWeight: '900', color: '#000' },
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
    borderBottomColor: colors.glassStrong,
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
    backgroundColor: colors.glassChip,
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: colors.glassStrong,
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
    backgroundColor: colors.glassStrong,
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
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: colors.glassChip,
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
    borderBottomColor: colors.glassStrong,
    gap: 12,
  },
  resultIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glassChip,
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
  // ── Solo / Pool mode toggle ─────────────────────────────────────────────────
  modeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 5,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 9,
    gap: 1,
  },
  modeBtnActive: {
    backgroundColor: colors.glassLime,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  modeBtnTitle:       { fontSize: 15, fontWeight: '900', color: '#8a8c8c' },
  modeBtnTitleActive: { color: colors.primary },
  modeBtnSub:         { fontSize: 10, fontWeight: '700', color: '#6b7280' },

  // ── Fare offer card ─────────────────────────────────────────────────────────
  fareCard: { marginTop: 10, gap: 6 },
  fareRangeHint: {
    color: '#8cc840',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8a8c8c',
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },

  // ── Pool visibility (public / private) ──────────────────────────────────────
  visRow: { flexDirection: 'row', gap: 8 },
  visOpt: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.glassStrong,
    padding: 12,
    gap: 2,
  },
  visOptActive: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  visOptIcon:   { fontSize: 18 },
  visOptTitle:  { fontSize: 13, fontWeight: '900', color: colors.text },
  visOptSub:    { fontSize: 10, color: colors.muted, fontWeight: '600', lineHeight: 14 },
  poolShareHint: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 16,
    marginTop: 8,
  },
  poolCodeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  poolCodeInput: {
    flex: 1,
    height: 42,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  poolCodeGoBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolCodeGoTxt: { fontSize: 13, fontWeight: '900', color: colors.primary },

  // ── Nearby public pools ─────────────────────────────────────────────────────
  nearbyPoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 12,
    marginBottom: 8,
  },
  nearbyPoolDest: { fontSize: 13, fontWeight: '800', color: colors.text },
  nearbyPoolMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  nearbyPoolFare: { fontSize: 14, fontWeight: '900', color: colors.primary },
  nearbyPoolJoin: { fontSize: 10, fontWeight: '800', color: colors.primary, marginTop: 2 },

  poolCtaCaption: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8cc840',
    textAlign: 'center',
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
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: 'rgba(16,18,17,0.94)',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: colors.glassStrong,
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
    backgroundColor: colors.glassStrong,
    marginLeft: 22,
  },
  bottomRideSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '54%', // Overlay bottom part of screen
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    paddingTop: 10,
  },
  // ── Pool ride primary card ──────────────────────────────────────────────────
  poolPrimaryCard: {
    backgroundColor: colors.glassLime,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 16,
    gap: 14,
    marginBottom: 4,
  },
  poolPrimaryTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  poolPrimaryTitle:  { fontSize: 20, fontWeight: '900', color: colors.primary },
  poolPrimaryBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  poolPrimaryBadgeText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  poolPrimarySub:    { fontSize: 12, color: '#8a8c8c', fontWeight: '600' },

  // Tier breakdown table
  poolTierTable: {
    backgroundColor: colors.glassLime,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    overflow: 'hidden',
  },
  poolTierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassLimeBorder,
    gap: 8,
  },
  poolTierRowSelected: { backgroundColor: colors.glassLime },
  poolTierLeft:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  poolTierRidersEmoji: { fontSize: 12 },
  poolTierRiders:   { fontSize: 13, fontWeight: '700', color: '#8a8c8c' },
  poolTierFareSolo: { fontSize: 13, fontWeight: '700', color: '#8a8c8c', minWidth: 70, textAlign: 'right' },
  poolTierFare:     { fontSize: 13, fontWeight: '700', color: '#ffffff', minWidth: 70, textAlign: 'right' },
  poolTierSavingNone: { fontSize: 11, color: '#555', fontWeight: '700', minWidth: 46, textAlign: 'right' },
  poolTierSavingBadge: {
    backgroundColor: colors.glassLime,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 46,
    alignItems: 'center',
  },
  poolTierSavingBest: { backgroundColor: `${colors.primary}20` },
  poolTierSavingText: { fontSize: 11, fontWeight: '900', color: '#4ade80' },

  // Gender toggle inside pool card
  genderRow: { flexDirection: 'row', gap: 8 },
  genderOpt: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.glassLime,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    padding: 11,
  },
  genderOptActive:  { borderColor: colors.primary, backgroundColor: colors.glassLime },
  genderOptIcon:    { fontSize: 18 },
  genderOptTitle:   { fontSize: 12, fontWeight: '700', color: colors.text },
  genderOptSub:     { fontSize: 10, color: colors.muted, fontWeight: '600', marginTop: 1 },

  poolHint: { fontSize: 10, color: '#555', textAlign: 'center', lineHeight: 15 },

  poolFareAdjRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.glassLime,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    padding: 12,
    gap: 8,
  },
  poolFareAdjBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolFareAdjBtnText: { fontSize: 20, fontWeight: '900', color: '#000', lineHeight: 24 },
  poolFareAdjValue:   { fontSize: 22, fontWeight: '900', color: colors.primary },
  poolFareAdjLabel:   { fontSize: 11, color: '#8a8c8c', fontWeight: '600', marginTop: 2 },
  poolFindBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolFindBtnText: { fontSize: 15, fontWeight: '900', color: '#000' },

  // ── OR divider ──────────────────────────────────────────────────────────────
  orDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  orDividerLine: { flex: 1, height: 1, backgroundColor: colors.glassStrong },
  orDividerText: { fontSize: 11, fontWeight: '800', color: '#8a8c8c', letterSpacing: 1 },

  // ── Category row active state ───────────────────────────────────────────────
  categoryRowActive: { borderColor: colors.primary, backgroundColor: '#0e1e08' },

  // ── Unified solo booking card (car selector + fare adjuster) ────────────────
  soloBookingCard: {
    backgroundColor: '#141515',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#2a2b2b',
    padding: 14,
    gap: 12,
    marginBottom: 4,
  },
  soloBookingLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // ── Car type 2×2 grid (inside soloBookingCard) ───────────────────────────────
  carGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  carTile: {
    width: '47.5%',
    backgroundColor: '#1c1d1d',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    gap: 3,
  },
  carTileActive: {
    borderColor: colors.primary,
    backgroundColor: '#0e1e08',
  },
  carTileEmoji: { fontSize: 26 },
  carTileName:  { fontSize: 13, fontWeight: '800', color: colors.text },
  carTilePrice: { fontSize: 11, fontWeight: '700', color: colors.muted },

  // ── Solo fare stepper (inside pool card) ────────────────────────────────────
  soloFareStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0e1f08',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a10',
    padding: 12,
    gap: 8,
  },

  // ── Car type dropdown (inside pool card) ─────────────────────────────────────
  carDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0e1f08',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a10',
    padding: 12,
  },
  carDropdownEmoji: { fontSize: 22 },
  carDropdownName:  { fontSize: 15, fontWeight: '800', color: colors.text },
  carDropdownRange: { fontSize: 11, color: colors.muted, fontWeight: '600', marginTop: 1 },
  carDropdownArrow: { fontSize: 12, color: colors.muted, fontWeight: '800' },
  carDropdownMenu: {
    backgroundColor: '#0a1505',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a10',
    overflow: 'hidden',
  },
  carDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a2a10',
  },
  carDropdownItemEmoji: { fontSize: 20 },
  carDropdownItemName:  { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  carDropdownItemPrice: { fontSize: 13, fontWeight: '800', color: colors.muted },

  activeCategoryBox: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassStrong,
    gap: 12,
  },
  activeCategoryMeta: {
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 10,
  },
  stepperCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.glassStrong,
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
  fareHintRow: {
    backgroundColor: '#0a1505',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  fareHintText: {
    color: '#8cc840',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  fareInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  fareInputPrefix: {
    color: '#8a8c8c',
    fontSize: 13,
    fontWeight: '700',
  },
  fareInput: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    minWidth: 64,
    textAlign: 'center',
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#ccff0060',
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
    borderBottomColor: colors.glassStrong,
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
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    borderTopColor: colors.glassStrong,
    backgroundColor: colors.background,
    gap: 10,
  },

  // Payment toggle
  paymentToggleRow:    { flexDirection: 'row', gap: 8 },
  paymentBtn:          {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 12, borderWidth: 1.5,
    borderColor: colors.glassStrong, backgroundColor: colors.surface,
  },
  paymentBtnActive:    { borderColor: colors.primary, backgroundColor: `${colors.primary}15` },
  paymentBtnIcon:      { fontSize: 16 },
  paymentBtnLabel:     { fontSize: 13, fontWeight: '700', color: '#8a8c8c' },
  paymentBtnLabelActive: { color: colors.primary },

  // Option toggles
  optionTogglesRow:    { flexDirection: 'row', gap: 8 },
  optionToggle:        {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1,
    borderColor: colors.glassStrong, paddingHorizontal: 10, paddingVertical: 8,
  },
  optionToggleIcon:    { fontSize: 14 },
  optionToggleLabel:   { flex: 1, fontSize: 12, fontWeight: '700', color: '#8a8c8c' },

  // Promo input
  promoInputRow:       {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1,
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
    backgroundColor: colors.glassStrong,
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
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
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
    backgroundColor: colors.glassStrong,
    alignSelf: 'center',
    marginBottom: 10,
  },

  // ── Pool incentive banner ──────────────────────────────────────────────────
  poolBanner: {
    backgroundColor: colors.glassLime,
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
    borderBottomColor: colors.glassLime,
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
    backgroundColor: colors.glassLime,
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
    borderTopColor: colors.glassLime,
    alignItems: 'center',
    paddingVertical: 10,
  },
  poolBannerCTAText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ccff00',
  },
});
