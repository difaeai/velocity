import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../../src/ui/Text';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';

import { db } from '../../src/firebase';
import { api, type CommuteDay, type NearbyPublicPool } from '../../src/api/client';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { AdBanner } from '../../src/ads';
import { useAuth } from '../../src/auth/AuthContext';
import { useFeatureFlags } from '../../src/hooks/driver';
import { useCurrentLocation } from '../../src/hooks/location';
import { poolGenderSummary } from '../../src/lib/genderAccess';
import { usePassengerTrips, useRecentDestinations, type RecentDestination } from '../../src/hooks/passenger';
import {
  usePlacesAutocomplete,
  fetchPlaceDetail,
  geocodeAddress,
  type PlacePrediction,
} from '../../src/hooks/places';
import { DraggableSheet } from '../../src/ui/DraggableSheet';
import { LiveMap } from '../../src/ui/LiveMap';
import { ClockIcon } from '../../src/ui/ServiceIcons';
import { CarIllustration } from '../../src/ui/VehicleIllustrations';
import {
  AcIcon,
  BoltIcon,
  CalendarIcon,
  CashIcon,
  DestinationPinIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  MiniIcon,
  MotoIcon,
  PickupDotIcon,
  PoolIcon,
  PremiumIcon,
  SoloIcon,
  TicketIcon,
  WalletIcon,
  type RideIconProps,
} from '../../src/ui/RideIcons';
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

// How far out to look for pools to join. The rider picks; we remember it, so
// someone who always searches 15 km never has to say so twice. Capped at the
// 25 km the backend accepts.
const POOL_RADIUS_OPTIONS = [2, 5, 10, 15, 25] as const;
const POOL_RADIUS_KEY = 'velocity.poolRadiusKm';
const DEFAULT_POOL_RADIUS_KM = 5;

// The mode sheet opens taller than the others: it carries the pool matches AND
// both ride cards, and the map behind it is only a route summary at this point.
const MODE_SNAP_POINTS = [0.45, 0.72, 0.94];

// Stand-in shown the moment coordinates land, before the reverse-geocoded
// street address does. The backend receives real coordinates either way, so this
// is only ever a label.
const CURRENT_LOCATION_LABEL = 'Current location';

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

// Vehicle catalogue for the carousel — brand SVG marks, not emoji, so every
// Android skin renders the same thing.
const RIDE_OPTIONS: {
  key: RideType;
  label: string;
  desc: string;
  seats: number;
  Icon: (props: RideIconProps) => ReactElement;
}[] = [
  { key: 'mini',    label: 'Mini',     desc: 'Everyday, no AC',  seats: 4, Icon: MiniIcon },
  { key: 'bike',    label: 'Moto',     desc: 'Beat the traffic', seats: 1, Icon: MotoIcon },
  { key: 'ac',      label: 'Ride A/C', desc: 'Cool cars, AC on', seats: 4, Icon: AcIcon },
  { key: 'comfort', label: 'Premium',  desc: 'Top sedans, AC',   seats: 4, Icon: PremiumIcon },
];

export default function Booking() {
  const router = useRouter();
  const { user } = useAuth();
  // The ride sheet is absolutely pinned to the screen bottom; edge-to-edge
  // Android draws it behind the system navigation bar unless padded.
  const insets = useSafeAreaInsets();
  const { coords, address: currentAddress, status: locStatus, request: requestLocation } =
    useCurrentLocation();
  const recents = useRecentDestinations(user?.uid);

  // Full ride history — every past trip that reached a real destination, with
  // date/fare so the rider can spot the exact trip and rebook it. Tucked behind
  // a small button next to "Recent destinations" so it never crowds the list.
  const { trips } = usePassengerTrips(user?.uid);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRows = useMemo(() => {
    return trips
      .map((t) => {
        const address = t.dropoff?.address?.trim();
        if (!address) return null;
        const seconds = (t as { createdAt?: { seconds?: number } }).createdAt?.seconds;
        const date = seconds
          ? new Date(seconds * 1000).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
          : '';
        return {
          id: t.id,
          address,
          lat: t.dropoff?.lat,
          lng: t.dropoff?.lng,
          date,
          fare: t.fare ?? t.offeredFare ?? null,
          pool: !!t.pool,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .slice(0, 30);
  }, [trips]);

  // Three explicit steps: type the route → pick Solo or Pool → tune the ride.
  const [stage, setStage] = useState<'route' | 'mode' | 'details'>('route');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  // Resolved coords for the selected dropoff place — this is what puts the
  // destination pin + route line on the map, so every selection path below
  // (autocomplete, recents, free-typed) must eventually fill it.
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  // A destination pick invalidates any still-running coordinate lookup from a
  // previous pick, so a slow response can't clobber the newer selection.
  const destSeq = useRef(0);
  // Places API (New) requires session tokens to be UUID v4
  const sessionTokenRef = useRef(uuidv4());

  function newSession() { sessionTokenRef.current = uuidv4(); }

  // Whether the rider has taken the pickup field over. Until they do, the field
  // belongs to their device location — nobody opening "Where to?" should have to
  // type where they are already standing.
  const [pickupEdited, setPickupEdited] = useState(false);

  /**
   * Fill the pickup from the device as soon as there is ANYTHING to show, and
   * refine it as better data lands: coordinates arrive from the GPS watch in a
   * second or two, while the reverse-geocoded street address can take several
   * more (or never resolve at all indoors). Waiting for the address — which is
   * what this used to do — left the rider staring at an empty "Search pickup
   * location…" box for the whole of that gap.
   */
  useEffect(() => {
    if (pickupEdited) return;
    if (currentAddress) setPickup(currentAddress);
    else if (coords) setPickup(CURRENT_LOCATION_LABEL);
  }, [currentAddress, coords?.lat, coords?.lng, pickupEdited]);

  /** Hand the field back to the device location after the rider has edited it. */
  function useMyLocationForPickup() {
    setPickupEdited(false);
    if (currentAddress) setPickup(currentAddress);
    else if (coords) setPickup(CURRENT_LOCATION_LABEL);
    else requestLocation();
  }

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
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [poolRadiusKm, setPoolRadiusKm] = useState<number>(DEFAULT_POOL_RADIUS_KM);
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

  function pickMode(next: 'solo' | 'pool') {
    setMode(next);
    if (next === 'pool' && rideType === 'bike') selectRide('mini'); // bikes have one seat — nothing to pool
  }

  // Public pools already heading where this rider is going. This is the whole of
  // pool discovery now — the home screen no longer has its own "find rides"
  // entry point, so the moment a destination is picked we look up who is going
  // that way and offer those seats BEFORE offering to start a new pool.
  //
  // The pickup is gated to the radius the rider chose; once we know their
  // drop-off the destination is gated by the same distance, so the list really
  // is "rides going your way" rather than "any pool nearby".
  useEffect(() => {
    if (stage === 'route' || !coords) return;
    let alive = true;
    setPoolsLoading(true);
    api.getNearbyPublicPoolTrips({
      lat: coords.lat,
      lng: coords.lng,
      radiusKm: poolRadiusKm,
      ...(dropoffCoords
        ? { destLat: dropoffCoords.lat, destLng: dropoffCoords.lng, destRadiusKm: poolRadiusKm }
        : {}),
    })
      .then((r) => { if (alive) setNearbyPools(r.pools); })
      .catch(() => { if (alive) setNearbyPools([]); /* discovery is best-effort */ })
      .finally(() => { if (alive) setPoolsLoading(false); });
    return () => { alive = false; };
  }, [stage, poolRadiusKm, coords?.lat, coords?.lng, dropoffCoords?.lat, dropoffCoords?.lng]);

  // Remembered search radius, restored before the first lookup runs.
  useEffect(() => {
    AsyncStorage.getItem(POOL_RADIUS_KEY)
      .then((saved) => {
        const km = Number(saved);
        if (POOL_RADIUS_OPTIONS.some((o) => o === km)) setPoolRadiusKm(km);
      })
      .catch(() => {});
  }, []);

  function changePoolRadius(km: number) {
    setPoolRadiusKm(km);
    AsyncStorage.setItem(POOL_RADIUS_KEY, String(km)).catch(() => {});
  }

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
    const seq = ++destSeq.current;
    setDropoff(pred.fullText);
    setDropoffCoords(null);
    setStage('mode');
    // Fetch real lat/lng in the background; draws the route and prices the trip
    const detail = await fetchPlaceDetail(pred.placeId, sessionTokenRef.current);
    newSession(); // rotate token after detail call closes the billing session
    if (detail && destSeq.current === seq) {
      setDropoffCoords({ lat: detail.lat, lng: detail.lng });
    } else if (!detail && destSeq.current === seq) {
      // Details call failed (key restriction, network) — geocode the text so
      // the map still gets a pin and a route instead of silently staying blank.
      const geo = await geocodeAddress(pred.fullText);
      if (geo && destSeq.current === seq) setDropoffCoords({ lat: geo.lat, lng: geo.lng });
    }
  }

  function selectLocation(dest: RecentDestination | string) {
    const seq = ++destSeq.current;
    const address = typeof dest === 'string' ? dest : dest.address;
    setDropoff(address);
    setStage('mode');
    // Recents rebooked from past trips already know their coordinates — the
    // route draws instantly. BUT: trips booked before geocoding existed saved
    // the rider's own location as the "destination", so coords sitting on top
    // of the current pickup are that artifact, not a real drop-off — those go
    // through the geocoder like a free-typed address.
    const known = typeof dest !== 'string' && dest.lat != null && dest.lng != null
      ? { lat: dest.lat, lng: dest.lng }
      : null;
    if (known && (!coords || haversineKm(coords, known) > 0.25)) {
      setDropoffCoords(known);
      return;
    }
    setDropoffCoords(null);
    geocodeAddress(address).then((geo) => {
      if (geo && destSeq.current === seq) setDropoffCoords({ lat: geo.lat, lng: geo.lng });
    });
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

  // Pickup field state: "finding you" only while there is genuinely nothing to
  // show yet; "your location" whenever the field still mirrors the device.
  const locatingPickup = !pickupEdited && !coords && locStatus !== 'denied' && locStatus !== 'unavailable';
  const usingCurrentPickup = !pickupEdited && !!coords;

  const maxSavePct = Math.round((1 - (POOL_TIERS[POOL_TIERS.length - 1]?.pct ?? 1)) * 100);
  const fareMin = engineEst?.minAcceptableBid ?? bounds.min;
  const fareMax = engineEst?.suggestedMaxBid  ?? bounds.max;

  /* ════════════════════ STAGE 1 — ROUTE ENTRY ════════════════════ */
  if (stage === 'route') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Where to?</Text>
            <Text style={styles.headerSub}>Set your destination — you name the fare</Text>
          </View>
          <Pressable
            style={styles.closeBtn}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          >
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>

        {/* Route rail — pickup dot, dashed leg, destination pin */}
        <View style={styles.routeInputsCard}>
          <View style={styles.inputRow}>
            <View style={styles.inputIconWrap}>
              <PickupDotIcon size={19} color="rgba(255,255,255,0.75)" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.pickupLabelRow}>
                <Text style={styles.inputLabel}>PICKUP</Text>
                {locatingPickup ? (
                  <>
                    <ActivityIndicator size="small" color={colors.muted} />
                    <Text style={styles.pickupStatus}>Finding you…</Text>
                  </>
                ) : usingCurrentPickup ? (
                  <Text style={styles.pickupStatusOn}>Your location</Text>
                ) : null}
              </View>
              <TextInput
                value={pickup}
                onChangeText={(t) => { setPickupEdited(true); setPickup(t); }}
                placeholder={locatingPickup ? 'Finding your location…' : 'Search pickup location…'}
                placeholderTextColor={colors.muted}
                style={styles.textInput}
              />
            </View>
            {/* Only offered once it would actually change something: after the
                rider has typed over the field, or when location is off. */}
            {!usingCurrentPickup && !locatingPickup ? (
              <Pressable onPress={useMyLocationForPickup} hitSlop={10} style={styles.useLocBtn}>
                <Text style={styles.useLocBtnText}>
                  {coords ? 'Use my location' : 'Enable location'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.railLegRow}>
            <View style={styles.railLeg} />
            <View style={styles.inputDivider} />
          </View>

          <View style={[styles.inputRow, styles.inputRowActive]}>
            <View style={styles.inputIconWrap}>
              <DestinationPinIcon size={19} color={colors.primary} accent={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.inputLabel, { color: colors.primary }]}>DESTINATION</Text>
              <TextInput
                value={dropoff}
                onChangeText={setDropoff}
                placeholder="Search destination…"
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
          </View>
        </View>

        {/* Section header — History tucks into the right corner beside it */}
        <View style={styles.resultsHeaderRow}>
          <Text style={styles.sectionHeader}>
            {placesLoading ? 'Searching…' : (query && predictions.length > 0 ? 'Suggestions' : 'Recent destinations')}
          </Text>
          {placesLoading ? <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} /> : null}
          <View style={{ flex: 1 }} />
          {historyRows.length > 0 && (
            <Pressable style={styles.historyChip} onPress={() => setHistoryOpen(true)} hitSlop={8}>
              <ClockIcon size={13} color={colors.primary} />
              <Text style={styles.historyChipText}>History</Text>
            </Pressable>
          )}
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
                <DestinationPinIcon size={17} color="#c9cfcc" />
              </View>
              <View style={styles.resultMeta}>
                <Text style={styles.resultName} numberOfLines={1}>{pred.mainText}</Text>
                <Text style={styles.resultAddress} numberOfLines={1}>{pred.secondaryText}</Text>
              </View>
              <Text style={styles.resultGo}>→</Text>
            </Pressable>
          ))}

          {/* Recent destinations (shown when no Places results or no query) */}
          {(!query || predictions.length === 0) && filteredRecents.map((loc) => (
            <Pressable
              key={loc.address}
              style={styles.resultItem}
              onPress={() => selectLocation(loc)}
            >
              <View style={styles.resultIconCircle}>
                <ClockIcon size={16} color="#c9cfcc" />
              </View>
              <View style={styles.resultMeta}>
                <Text style={styles.resultName} numberOfLines={1}>{loc.address}</Text>
                <Text style={styles.resultAddress}>Recent destination</Text>
              </View>
              <Text style={styles.resultGo}>→</Text>
            </Pressable>
          ))}

          {/* API error hint */}
          {apiStatus && apiStatus !== 'OK' && apiStatus !== 'ZERO_RESULTS' && query.length > 1 && (
            <View style={styles.emptyResults}>
              <Text style={[styles.emptyResultsText, { color: colors.danger }]}>
                Places API: {apiStatus}
              </Text>
              {apiMessage ? (
                <Text style={[styles.emptyResultsText, { color: colors.danger, fontSize: 11, marginTop: 2 }]}>
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

        {/* Banner sits BELOW the suggestion list, never inside it — a scrolling
            ad between tappable destination rows is the classic accidental-click
            trap, and accidental clicks count as invalid traffic. The component's
            own top border draws the line between "app" and "ad", and it yields
            the space entirely while the keyboard is up. */}
        <AdBanner hideOnKeyboard />
      </SafeAreaView>
    );
  }

  /* ════════════════ STAGES 2 & 3 — over the live route map ════════════════ */
  const soloFrom = priceFor('mini');
  const poolFrom = poolFareFor(soloFrom, POOL_TIERS[POOL_TIERS.length - 1]?.extra ?? 3);

  return (
    <View style={styles.safe}>
      {/* Real live map: pickup pin + destination pin + road-following route */}
      <View style={styles.mapContainer}>
        <LiveMap coords={coords} pickup={coords} dropoff={dropoffCoords} />
      </View>

      {/* Top: back + route summary */}
      <SafeAreaView style={styles.floatingHeaderArea} pointerEvents="box-none">
        <View style={styles.floatingHeaderBar}>
          <Pressable
            style={styles.floatingBackBtn}
            onPress={() => setStage(stage === 'details' ? 'mode' : 'route')}
          >
            <Text style={styles.floatingBackTxt}>←</Text>
          </Pressable>
          <View style={styles.floatingRouteCard}>
            <View style={styles.floatingRoutePoint}>
              <PickupDotIcon size={14} color="rgba(255,255,255,0.7)" />
              <Text style={styles.floatingRouteText} numberOfLines={1}>
                {pickup.trim() || currentAddress || 'Current location'}
              </Text>
            </View>
            <View style={styles.floatingRouteDivider} />
            <View style={styles.floatingRoutePoint}>
              <DestinationPinIcon size={14} color={colors.primary} />
              <Text style={styles.floatingRouteText} numberOfLines={1}>
                {dropoff.trim() || 'Destination'}
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {stage === 'mode' ? (
        /* ── STAGE 2: PICK YOUR RIDE STYLE ── */
        <DraggableSheet
          style={[styles.modeSheet, { paddingBottom: insets.bottom + 16 }]}
          snapPoints={MODE_SNAP_POINTS}
        >
          <Text style={styles.modeHeading}>How do you want to ride?</Text>
          <Text style={styles.modeHeadingSub}>Join a pool going your way, or book your own</Text>

          {/* Matches + both ride cards scroll together: with a few pools on the
              route this content is taller than the sheet on a small phone, and
              a bounded sheet that scrolls beats one that runs off the screen. */}
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={styles.modeScrollBody}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >

          {/* ── Rides going your way — public pools on this exact route.
               Joining one is cheaper than starting a pool, so it comes first;
               the rider sets how far out we look, and if nobody is going their
               way they start their own from the card below. ── */}
          <View style={styles.goingYourWayHeader}>
            <PoolIcon size={14} color={colors.primary} accent={colors.primary} />
            <Text style={styles.goingYourWayLabel}>RIDES GOING YOUR WAY</Text>
            {nearbyPools.length > 0 && (
              <View style={styles.goingYourWayCount}>
                <Text style={styles.goingYourWayCountText}>{nearbyPools.length}</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            <Text style={styles.radiusHint}>within</Text>
          </View>

          {/* The rider owns the search radius — 2 km for "must be right here",
              25 km to sweep the whole city when nothing turns up nearby. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.radiusRow}
            keyboardShouldPersistTaps="handled"
          >
            {POOL_RADIUS_OPTIONS.map((km) => {
              const on = km === poolRadiusKm;
              return (
                <Pressable
                  key={km}
                  style={[styles.radiusChip, on && styles.radiusChipOn]}
                  onPress={() => changePoolRadius(km)}
                >
                  <Text style={[styles.radiusChipText, on && styles.radiusChipTextOn]}>{km} km</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {poolsLoading && nearbyPools.length === 0 ? (
            <View style={styles.poolFindRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.poolFindText}>Looking for rides going your way…</Text>
            </View>
          ) : nearbyPools.length > 0 ? (
            nearbyPools.slice(0, 3).map((p) => (
              <Pressable
                key={p.code}
                style={({ pressed }) => [styles.matchRow, pressed && { opacity: 0.75 }]}
                onPress={() => router.push(`/passenger/pool-join/${p.code}` as Parameters<typeof router.push>[0])}
              >
                <View style={styles.matchIcon}>
                  <PoolIcon size={17} color={colors.primary} accent={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchDest} numberOfLines={1}>{p.dropoffAddress}</Text>
                  <Text style={styles.matchMeta} numberOfLines={1}>
                    {p.distanceKm} km away · {RIDE_TYPE_LABELS[p.rideType] ?? p.rideType} · {p.seatsLeft} seat{p.seatsLeft !== 1 ? 's' : ''} left
                    {p.hasDriver ? ' · driver on the way' : ''}
                  </Text>
                  {/* Who's already in the car. Riders decide on this before fare —
                      sharing with the opposite gender is a real consideration here. */}
                  <Text style={styles.matchGender} numberOfLines={1}>
                    {poolGenderSummary(p.males, p.females)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.matchFare}>PKR {p.perSeatFareIfYouJoin}</Text>
                  <Text style={styles.matchJoin}>Join →</Text>
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={styles.noMatchHint}>
              No pools within {poolRadiusKm} km going your way — widen the search above, or start your own below.
            </Text>
          )}

          {/* Pool — share & save (leads: it's the flagship option) */}
          <Pressable
            style={({ pressed }) => [styles.modeCard, styles.modeCardPool, pressed && styles.modeCardPressed]}
            onPress={() => { pickMode('pool'); setStage('details'); }}
          >
            <View style={styles.modeCardBody}>
              <View style={styles.modeEyebrowRow}>
                <PoolIcon size={15} color={colors.primary} accent={colors.primary} />
                <Text style={[styles.modeEyebrow, { color: colors.primary }]}>POOL</Text>
                <View style={styles.saveBadge}>
                  <Text style={styles.saveBadgeText}>−{maxSavePct}% WHEN FULL</Text>
                </View>
              </View>
              <Text style={styles.modeCardTitle}>
                {nearbyPools.length > 0 ? 'Start your own pool' : 'Ride Pool'}
              </Text>
              <Text style={styles.modeCardSub}>
                {nearbyPools.length > 0
                  ? 'None of these suit you? Start your own — riders going your way can join it.'
                  : "No one's going your way yet — start a pool and nearby riders can join and split the fare."}
              </Text>
              {/* Lead with the price they actually pay TODAY. Leading with the
                  full-car per-seat price read as "this ride costs 140" when
                  140 only happens if three strangers turn up. */}
              <View style={styles.modePriceRow}>
                <Text style={styles.modePrice}>PKR {soloFrom}</Text>
                <Text style={styles.modePriceUnit}>if nobody joins</Text>
              </View>
              <Text style={styles.poolPriceCaveat}>
                Starts at the full fare. It only drops — to as low as PKR {poolFrom} each — as riders
                actually join.
              </Text>
            </View>
            <View style={styles.modeCardArt}>
              <PoolBubbles />
            </View>
          </Pressable>

          {/* Solo — the whole car */}
          <Pressable
            style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
            onPress={() => { pickMode('solo'); setStage('details'); }}
          >
            <View style={styles.modeCardBody}>
              <View style={styles.modeEyebrowRow}>
                <SoloIcon size={15} color="#cfd6d2" accent="#cfd6d2" />
                <Text style={styles.modeEyebrow}>SOLO</Text>
              </View>
              <Text style={styles.modeCardTitle}>Ride Solo</Text>
              <Text style={styles.modeCardSub}>The whole car to yourself — fastest way from A to B.</Text>
              <View style={styles.modePriceRow}>
                <Text style={styles.modePrice}>PKR {soloFrom}</Text>
                <View style={styles.modeChip}>
                  <Text style={styles.modeChipText}>Fastest pickup</Text>
                </View>
              </View>
            </View>
            <View style={styles.modeCardArt}>
              <CarIllustration width={112} height={58} />
            </View>
          </Pressable>

          <View style={styles.modeFootRow}>
            <CashIcon size={15} color="#8f9694" accent="#8f9694" />
            <Text style={styles.modeFootText}>Pay cash · drivers bid on your offer · no surge tricks</Text>
          </View>

          </ScrollView>
        </DraggableSheet>
      ) : (
        /* ── STAGE 3: RIDE OPTIONS ── */
        <DraggableSheet style={[styles.bottomRideSheet, { paddingBottom: insets.bottom }]}>
          {/* Compact Solo ⟷ Pool switch — the big choice already happened */}
          <View style={styles.modeToggleRow}>
            <Pressable
              style={[styles.modePill, mode === 'pool' && styles.modePillActive]}
              onPress={() => pickMode('pool')}
            >
              <PoolIcon
                size={15}
                color={mode === 'pool' ? '#0b0d0c' : colors.muted}
                accent={mode === 'pool' ? '#0b0d0c' : colors.muted}
              />
              <Text style={[styles.modePillText, mode === 'pool' && styles.modePillTextActive]}>Pool</Text>
            </Pressable>
            <Pressable
              style={[styles.modePill, mode === 'solo' && styles.modePillActive]}
              onPress={() => pickMode('solo')}
            >
              <SoloIcon
                size={15}
                color={mode === 'solo' ? '#0b0d0c' : colors.muted}
                accent={mode === 'solo' ? '#0b0d0c' : colors.muted}
              />
              <Text style={[styles.modePillText, mode === 'solo' && styles.modePillTextActive]}>Solo</Text>
            </Pressable>
          </View>
          <Text style={styles.modeCaption}>
            {mode === 'pool'
              ? 'You offer the full fare. It only drops as riders actually join.'
              : 'Private ride — the car is all yours'}
          </Text>

          <ScrollView
            style={styles.detailsScroll}
            contentContainerStyle={{ paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Vehicle carousel (bikes can't be pooled) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.vehicleRow}
            >
              {RIDE_OPTIONS
                .filter((rt) => mode === 'solo' || rt.seats > 1)
                .map((rt) => {
                  const active = rideType === rt.key;
                  return (
                    <Pressable
                      key={rt.key}
                      style={[styles.vehicleCard, active && styles.vehicleCardActive]}
                      onPress={() => selectRide(rt.key)}
                    >
                      <View style={[styles.vehicleIconWrap, active && styles.vehicleIconWrapActive]}>
                        <rt.Icon size={30} color={active ? colors.primary : '#e6eae8'} />
                      </View>
                      <Text style={[styles.vehicleName, active && { color: colors.primary }]}>{rt.label}</Text>
                      <Text style={styles.vehicleDesc} numberOfLines={1}>{rt.desc}</Text>
                      <Text style={[styles.vehiclePrice, active && { color: colors.primary }]}>
                        PKR {priceFor(rt.key)}
                      </Text>
                      <Text style={styles.vehicleSeats}>{rt.seats > 1 ? `${rt.seats} seats` : '1 seat'}</Text>
                    </Pressable>
                  );
                })}
            </ScrollView>

            {/* Your fare offer */}
            <View style={styles.fareCard}>
              <Text style={styles.fareEyebrow}>YOUR OFFER</Text>
              <View style={styles.fareStepperRow}>
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
                  <Text style={styles.stepperLabel}>drivers see this — tap to edit or use − +</Text>
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
                {/* The one thing riders get wrong about pooling: the discount is
                    earned, not promised. Say it before the tier table, in the
                    rider's own numbers, so nobody reads the best-case row as
                    the price of the ride. */}
                <View style={styles.poolFareNotice}>
                  <Text style={styles.poolFareNoticeTitle}>
                    You pay PKR {fare} if nobody joins
                  </Text>
                  <Text style={styles.poolFareNoticeBody}>
                    A pool starts as a normal ride at the full fare — exactly what Solo costs.
                    Nothing is split in advance. Every rider who joins cuts everyone's share, and
                    only then does your fare come down.
                  </Text>
                </View>

                {/* Everyone's fare drops as riders join — you always offer the solo fare */}
                <Text style={styles.sectionLabel}>WHAT YOU PAY, RIDER BY RIDER</Text>
                <View style={styles.poolTierTable}>
                  <View style={[styles.poolTierRow, styles.poolTierRowNow]}>
                    <View style={styles.poolTierLeft}>
                      <SoloIcon size={15} color={colors.text} accent={colors.text} />
                      <Text style={[styles.poolTierRiders, styles.poolTierRidersNow]}>Just you</Text>
                    </View>
                    <Text style={styles.poolTierFareSolo}>PKR {fare}</Text>
                    <View style={styles.poolTierNowBadge}>
                      <Text style={styles.poolTierNowText}>YOU START HERE</Text>
                    </View>
                  </View>
                  {POOL_TIERS.map((tier, i) => {
                    const tierFare = poolFareFor(fare, tier.extra);
                    const savePct  = Math.round((1 - tier.pct) * 100);
                    return (
                      <View key={tier.extra} style={[styles.poolTierRow, i === POOL_TIERS.length - 1 && { borderBottomWidth: 0 }]}>
                        <View style={styles.poolTierLeft}>
                          <PoolIcon size={15} color={colors.muted} />
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
                    <GlobeIcon size={19} color={poolVisibility === 'public' ? colors.primary : '#c9cfcc'} />
                    <Text style={[styles.visOptTitle, poolVisibility === 'public' && { color: colors.primary }]}>Public</Text>
                    <Text style={styles.visOptSub}>Riders nearby can see & join</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.visOpt, poolVisibility === 'private' && styles.visOptActive]}
                    onPress={() => setPoolVisibility('private')}
                  >
                    <LockIcon size={19} color={poolVisibility === 'private' ? colors.primary : '#c9cfcc'} />
                    <Text style={[styles.visOptTitle, poolVisibility === 'private' && { color: colors.primary }]}>Private</Text>
                    <Text style={styles.visOptSub}>Only people with your link</Text>
                  </Pressable>
                </View>
                <Text style={styles.poolShareHint}>
                  You get an invite link right after booking — share it on WhatsApp. The more people
                  who actually join, the less each of you pays; with nobody joining it stays PKR {fare}.
                </Text>

                {/* Manual code entry — mirrors the code shown on the link page */}
                <View style={styles.poolCodeRow}>
                  <View style={styles.poolCodeInputWrap}>
                    <LinkIcon size={15} color={colors.muted} accent={colors.muted} />
                    <TextInput
                      value={joinCode}
                      onChangeText={(t) => setJoinCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      placeholder="Have an invite code?"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="characters"
                      style={styles.poolCodeInput}
                      maxLength={12}
                    />
                  </View>
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
                    <Text style={styles.sectionLabel}>OR JOIN A POOL GOING YOUR WAY</Text>
                    {nearbyPools.slice(0, 3).map((p) => (
                      <Pressable
                        key={p.code}
                        style={styles.nearbyPoolRow}
                        onPress={() => router.push(`/passenger/pool-join/${p.code}` as Parameters<typeof router.push>[0])}
                      >
                        <View style={styles.nearbyPoolIcon}>
                          <PoolIcon size={18} color={colors.primary} accent={colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.nearbyPoolDest} numberOfLines={1}>{p.dropoffAddress}</Text>
                          <Text style={styles.nearbyPoolMeta}>
                            {p.distanceKm} km away · {p.riders} rider{p.riders > 1 ? 's' : ''} · {p.seatsLeft} seat{p.seatsLeft > 1 ? 's' : ''} left
                          </Text>
                          <Text style={styles.matchGender} numberOfLines={1}>
                            {poolGenderSummary(p.males, p.females)}
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
                  <View style={styles.scheduleIconWrap}>
                    <CalendarIcon size={20} color={colors.primary} accent={colors.primary} />
                  </View>
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

            <Text style={styles.taxNoticeText}>
              ⓘ Fare doesn't include state entry tax, tolls, or parking fees
            </Text>
          </ScrollView>

          {/* Footer: payment + extras + CTA */}
          <View style={styles.sheetActionsFooter}>
            <View style={styles.paymentToggleRow}>
              <Pressable
                style={[styles.paymentBtn, paymentMethod === 'cash' && styles.paymentBtnActive]}
                onPress={() => setPaymentMethod('cash')}
              >
                <CashIcon
                  size={17}
                  color={paymentMethod === 'cash' ? colors.primary : colors.muted}
                  accent={paymentMethod === 'cash' ? colors.primary : colors.muted}
                />
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
                <WalletIcon
                  size={17}
                  color={paymentMethod === 'wallet' ? colors.primary : colors.muted}
                  accent={paymentMethod === 'wallet' ? colors.primary : colors.muted}
                />
                <Text style={[styles.paymentBtnLabel, paymentMethod === 'wallet' && styles.paymentBtnLabelActive]}>
                  {walletTopupEnabled ? 'Wallet' : 'Wallet (soon)'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.optionTogglesRow}>
              {mode === 'solo' && (
                <Pressable style={styles.optionToggle} onPress={() => setAutoAccept(v => !v)}>
                  <BoltIcon size={15} color={autoAccept ? colors.primary : colors.muted} />
                  <Text style={[styles.optionToggleLabel, autoAccept && { color: colors.primary }]}>
                    Auto-accept offer of PKR {fare}
                  </Text>
                  <View style={[styles.toggleSwitchSmall, autoAccept && { backgroundColor: colors.primary }]}>
                    <View style={[styles.toggleSwitchKnobSmall, autoAccept && styles.toggleKnobOn]} />
                  </View>
                </Pressable>
              )}
              <Pressable style={styles.optionToggle} onPress={() => setShowPromo(v => !v)}>
                <TicketIcon
                  size={15}
                  color={promoCode ? colors.primary : colors.muted}
                  accent={promoCode ? colors.primary : colors.muted}
                />
                <Text style={[styles.optionToggleLabel, promoCode ? { color: colors.primary } : null]}>
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
                <Text style={styles.locHint}>Tap to enable location for your pickup point</Text>
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
                You're booking at PKR {fare}. That's what you pay if you ride alone — it drops to
                PKR {poolFareFor(fare, POOL_TIERS[POOL_TIERS.length - 1]?.extra ?? 3)} each only with a full car.
              </Text>
            ) : null}
          </View>
        </DraggableSheet>
      )}

      {/* Schedule-ride modal */}
      <Modal visible={scheduleOpen} transparent animationType="slide" onRequestClose={() => setScheduleOpen(false)}>
        <View style={styles.schedOverlay}>
          <View style={[styles.schedBox, { paddingBottom: 24 + insets.bottom }]}>
            <View style={styles.schedTitleRow}>
              <CalendarIcon size={20} color={colors.primary} accent={colors.primary} />
              <Text style={styles.schedTitle}>Schedule this ride</Text>
            </View>
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

      {/* Ride history — full past-trip list, opened from the header chip */}
      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={styles.historyOverlay}>
          <View style={styles.historySheet}>
            <View style={styles.historyGrabber} />
            <View style={styles.historyHeaderRow}>
              <Text style={styles.historyHeaderTitle}>Your ride history</Text>
              <Pressable onPress={() => setHistoryOpen(false)} hitSlop={12}>
                <Text style={styles.historyClose}>✕</Text>
              </Pressable>
            </View>

            {historyRows.length > 0 ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {historyRows.map((h) => (
                  <Pressable
                    key={h.id}
                    style={styles.historyRow}
                    onPress={() => {
                      setHistoryOpen(false);
                      selectLocation({ address: h.address, lat: h.lat, lng: h.lng });
                    }}
                  >
                    <View style={styles.historyIconCircle}>
                      <ClockIcon size={15} color={colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyRowName} numberOfLines={1}>{h.address}</Text>
                      <Text style={styles.historyRowMeta} numberOfLines={1}>
                        {h.date}{h.fare ? ` · PKR ${h.fare}` : ''}{h.pool ? ' · Pool' : ''}
                      </Text>
                    </View>
                    <Text style={styles.historyGo}>↺</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.historyEmpty}>
                <Text style={styles.historyEmptyText}>
                  No past trips yet. Book your first ride to see it here.
                </Text>
              </View>
            )}

            <Pressable
              style={styles.historyAllLink}
              onPress={() => {
                setHistoryOpen(false);
                router.push('/passenger/activity');
              }}
            >
              <Text style={styles.historyAllLinkText}>View full request history →</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Overlapping rider bubbles for the Pool card — same visual family as the
 * home screen's Travel Partner card, but drawn with the brand SVG marks
 * instead of emoji so it matches the rest of the flow.
 */
function PoolBubbles() {
  return (
    <View style={styles.poolBubblesWrap}>
      <View style={[styles.poolBubble, styles.poolBubbleBack]}>
        <SoloIcon size={17} color="#c9cfcc" accent="#c9cfcc" />
      </View>
      <View style={[styles.poolBubble, styles.poolBubbleMid]}>
        <SoloIcon size={17} color="#c9cfcc" accent="#c9cfcc" />
      </View>
      <View style={[styles.poolBubble, styles.poolBubbleFront]}>
        <SoloIcon size={17} color="#0b0d0c" accent="#0b0d0c" />
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },

  /* ════════ Stage 1 — route entry ════════ */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 3,
    fontWeight: '600',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: {
    fontSize: 16,
    color: '#c9cfcc',
  },
  routeInputsCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  inputRowActive: {
    backgroundColor: 'rgba(204,255,0,0.06)',
    borderWidth: 1.2,
    borderColor: colors.glassLimeBorder,
    borderRadius: 14,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  inputIconWrap: {
    width: 22,
    alignItems: 'center',
  },
  inputLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
  },
  /* ── Pickup: device-location state next to the label ── */
  pickupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pickupStatus: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.3,
  },
  pickupStatusOn: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.3,
  },
  useLocBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    backgroundColor: colors.glassLime,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginLeft: 6,
  },
  useLocBtnText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
  },
  textInput: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    height: 26,
    padding: 0,
  },
  railLegRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  railLeg: {
    width: 0,
    height: 16,
    marginLeft: 10,
    borderLeftWidth: 1.6,
    borderColor: 'rgba(255,255,255,0.28)',
    borderStyle: 'dashed',
  },
  inputDivider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 22,
  },
  clearBtn: {
    padding: 6,
  },
  clearTxt: {
    color: colors.muted,
    fontSize: 14,
  },
  resultsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 18,
    marginBottom: 6,
  },
  sectionHeader: {
    color: colors.muted,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  resultsScroll: {
    flex: 1,
    paddingHorizontal: 16,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
    gap: 12,
  },
  resultIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultMeta: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  resultAddress: {
    fontSize: 12,
    color: colors.muted,
  },
  resultGo: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '800',
  },

  /* ── History chip (right corner of the "Recent destinations" header) ── */
  historyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(204,255,0,0.10)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  historyChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.3,
  },

  /* ── History modal ── */
  historyOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  historySheet: {
    maxHeight: '78%',
    backgroundColor: colors.glassPanel,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: colors.glassStrong,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 24,
  },
  historyGrabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyHeaderTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.text,
  },
  historyClose: {
    fontSize: 18,
    color: colors.muted,
    fontWeight: '700',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(204,255,0,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyRowName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  historyRowMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  historyGo: { fontSize: 15, color: colors.primary, fontWeight: '800' },
  historyEmpty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  historyEmptyText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 20,
  },
  historyAllLink: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 10,
  },
  historyAllLinkText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  emptyResults: {
    paddingHorizontal: 4,
    paddingVertical: 20,
    gap: 14,
  },
  emptyResultsText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  useTypedBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  useTypedBtnText: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 14,
  },

  /* ════════ Shared map + floating header (stages 2 & 3) ════════ */
  mapContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: '42%',
    backgroundColor: '#151b22',
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
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingBackTxt: {
    color: colors.text,
    fontSize: 19,
    fontWeight: 'bold',
  },
  floatingRouteCard: {
    flex: 1,
    backgroundColor: 'rgba(16,19,18,0.92)',
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  floatingRoutePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floatingRouteText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  floatingRouteDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginLeft: 22,
  },
  /* ════════ Stage 2 — Solo / Pool chooser ════════ */
  /* Height is the rider's, via DraggableSheet — this only skins the surface. */
  modeSheet: {
    backgroundColor: 'rgba(11,13,12,0.97)',
    paddingHorizontal: 18,
    gap: 12,
  },
  modeScrollBody: { gap: 12, paddingBottom: 2 },
  modeHeading: {
    fontSize: 21,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.3,
  },
  modeHeadingSub: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
    marginTop: -8,
    marginBottom: 2,
  },

  /* ── "Rides going your way" — pool matches on this route ── */
  poolFindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 4,
  },
  poolFindText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  goingYourWayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: -4,
  },
  goingYourWayLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.9,
  },
  goingYourWayCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: colors.glassLime,
    alignItems: 'center',
  },
  goingYourWayCountText: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.primary,
  },
  radiusHint: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  radiusRow: {
    flexDirection: 'row',
    gap: 7,
    paddingRight: 4,
  },
  radiusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radiusChipOn: {
    backgroundColor: colors.glassLime,
    borderColor: colors.glassLimeBorder,
  },
  radiusChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.muted,
  },
  radiusChipTextOn: { color: colors.primary },
  noMatchHint: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    fontWeight: '600',
  },
  matchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  matchIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.glassLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchDest: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  matchMeta: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
    marginTop: 2,
  },
  matchGender: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '800',
    marginTop: 2,
  },
  matchFare: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.text,
  },
  matchJoin: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
    marginTop: 1,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
    overflow: 'hidden',
  },
  modeCardPool: {
    backgroundColor: 'rgba(204,255,0,0.07)',
    borderColor: colors.glassLimeBorder,
  },
  modeCardPressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  modeCardBody: { flex: 1, gap: 4 },
  modeEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modeEyebrow: {
    fontSize: 10,
    fontWeight: '900',
    color: '#cfd6d2',
    letterSpacing: 1.4,
  },
  saveBadge: {
    backgroundColor: colors.primary,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 2,
    flexShrink: 1, // never push the POOL eyebrow off a narrow card
  },
  saveBadgeText: {
    fontSize: 8.5,
    fontWeight: '900',
    color: '#0b0d0c',
    letterSpacing: 0.6,
  },
  modeCardTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.2,
  },
  modeCardSub: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 16,
  },
  modePriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  modePrice: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.text,
  },
  modePriceUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  /* The pool card's price is the FULL fare; this line is what stops that number
     being mistaken for a promise of the shared price. */
  poolPriceCaveat: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: '#a9b0ad',
    marginTop: 2,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
  },
  modeChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#c9cfcc',
  },
  modeCardArt: {
    width: 116,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolBubblesWrap: {
    width: 96,
    height: 62,
  },
  poolBubble: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 2,
    borderColor: '#161d10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolBubbleBack:  { left: 4,  top: 2 },
  poolBubbleMid:   { left: 28, top: 18 },
  poolBubbleFront: { left: 52, top: 4, backgroundColor: colors.primary, zIndex: 2 },
  modeFootRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 2,
  },
  modeFootText: {
    fontSize: 11,
    color: '#8f9694',
    fontWeight: '600',
  },

  /* ════════ Stage 3 — ride options ════════ */
  /* Height is the rider's, via DraggableSheet — this only skins the surface. */
  bottomRideSheet: {
    backgroundColor: 'rgba(11,13,12,0.97)',
  },
  modeToggleRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    gap: 4,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 8,
  },
  modePillActive: {
    backgroundColor: colors.primary,
  },
  modePillText: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.muted,
  },
  modePillTextActive: {
    color: '#0b0d0c',
  },
  modeCaption: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8cc840',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 20,
  },
  detailsScroll: {
    flex: 1,
  },

  // Vehicle carousel
  vehicleRow: {
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  vehicleCard: {
    width: 122,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 12,
    gap: 2,
  },
  vehicleCardActive: {
    backgroundColor: colors.glassLime,
    borderColor: colors.primary,
  },
  vehicleIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  vehicleIconWrapActive: {
    backgroundColor: 'rgba(204,255,0,0.12)',
  },
  vehicleName: {
    fontSize: 13.5,
    fontWeight: '900',
    color: colors.text,
  },
  vehicleDesc: {
    fontSize: 9.5,
    color: colors.muted,
    fontWeight: '600',
  },
  vehiclePrice: {
    fontSize: 13,
    fontWeight: '900',
    color: '#e6eae8',
    marginTop: 4,
  },
  vehicleSeats: {
    fontSize: 9.5,
    color: colors.muted,
    fontWeight: '700',
  },

  // Fare offer card
  fareCard: {
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: colors.glassLime,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  fareEyebrow: {
    fontSize: 9,
    fontWeight: '900',
    color: '#8cc840',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  fareStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  fareInputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  fareInputPrefix: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.muted,
  },
  fareInput: {
    fontSize: 30,
    fontWeight: '900',
    color: colors.text,
    padding: 0,
    minWidth: 70,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(204,255,0,0.4)',
  },
  stepperLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
    marginTop: 2,
  },
  fareRangeHint: {
    color: '#8cc840',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },

  sectionLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 20,
  },

  // Pool tier table
  /* ── "you pay full fare if nobody joins" notice ── */
  poolFareNotice: {
    marginHorizontal: 20,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 5,
  },
  poolFareNoticeTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.text,
  },
  poolFareNoticeBody: {
    fontSize: 12,
    lineHeight: 17,
    color: '#a9b0ad',
    fontWeight: '600',
  },

  poolTierTable: {
    marginHorizontal: 20,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 2,
  },
  poolTierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  poolTierLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  poolTierRiders: {
    fontSize: 13,
    fontWeight: '700',
    color: '#d8dcda',
  },
  /* The "just you" row is the DEFAULT outcome, not a footnote — it is tinted
     and labelled so it can't be skimmed past on the way to the cheapest row. */
  poolTierRowNow: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    marginVertical: 2,
    paddingHorizontal: 8,
  },
  poolTierRidersNow: { color: colors.text, fontWeight: '800' },
  poolTierNowBadge: {
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  poolTierNowText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#d8dcda',
    letterSpacing: 0.3,
  },
  /* Full fare — the amount actually charged when nobody joins, so it reads as
     loud as the discounted rows below it rather than greyed out. */
  poolTierFareSolo: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.text,
    marginRight: 12,
  },
  poolTierFare: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.text,
    marginRight: 12,
  },
  poolTierSavingBadge: {
    width: 48,
    borderRadius: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
  },
  poolTierSavingBest: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
  },
  poolTierSavingText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#c9cfcc',
  },

  // Pool visibility
  visRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  visOpt: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  visOptActive: {
    borderColor: colors.primary,
    backgroundColor: colors.glassLime,
  },
  visOptTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.text,
  },
  visOptSub: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: '600',
    lineHeight: 14,
  },
  poolShareHint: {
    fontSize: 11,
    color: '#6b7280',
    lineHeight: 16,
    marginTop: 8,
    paddingHorizontal: 20,
  },
  poolCodeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 20,
  },
  poolCodeInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  poolCodeInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    padding: 0,
  },
  poolCodeGoBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  poolCodeGoTxt: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.primary,
  },

  // Nearby public pools
  nearbyPoolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  nearbyPoolIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glassLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearbyPoolDest: { fontSize: 13, fontWeight: '800', color: colors.text },
  nearbyPoolMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  nearbyPoolFare: { fontSize: 14, fontWeight: '900', color: colors.primary },
  nearbyPoolJoin: { fontSize: 10, fontWeight: '800', color: colors.primary, marginTop: 2 },

  // Schedule (solo)
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 12,
    marginHorizontal: 20,
  },
  scheduleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.glassLime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleCardTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  scheduleCardSub: { fontSize: 11, color: colors.muted, marginTop: 2, lineHeight: 15 },
  scheduleCardChevron: { fontSize: 20, color: colors.muted },
  scheduleManageLink: { alignItems: 'center', paddingVertical: 8 },
  scheduleManageText: { fontSize: 12, fontWeight: '700', color: colors.primary },

  taxNoticeText: {
    fontSize: 10.5,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 20,
  },

  // Footer
  sheetActionsFooter: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  paymentToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  paymentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  paymentBtnActive: {
    backgroundColor: colors.glassLime,
    borderColor: colors.primary,
  },
  paymentBtnLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.muted,
  },
  paymentBtnLabelActive: {
    color: colors.primary,
  },
  optionTogglesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  optionToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionToggleLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  toggleSwitchSmall: {
    width: 34,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleSwitchKnobSmall: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: '#0b0d0c',
  },
  promoInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 12,
  },
  promoInput: {
    flex: 1,
    height: 42,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    padding: 0,
  },
  promoClear: {
    padding: 6,
  },
  locHint: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  findDriverButton: {
    // NOTE: no `flex: 1` here — this button is a standalone child of the
    // column footer, and flex:1 (flexBasis:0) collapses it to zero height,
    // making the primary "Find Driver / Start Pool Ride" CTA invisible.
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  findDriverButtonText: {
    color: '#0b0d0c',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  poolCtaCaption: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: '#8cc840',
    textAlign: 'center',
    paddingHorizontal: 4,
  },

  // Schedule-ride modal
  schedOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  schedBox: { backgroundColor: '#151816', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 10 },
  schedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
}));
