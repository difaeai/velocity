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
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useActiveTrip } from '../../src/hooks/useActiveTrip';
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
  MAX_SEATS,
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

/** A booking dictated on the voice screen, ready to seed this screen's state. */
interface VoicePrefill {
  readonly dropoff: string;
  /** Present only when the destination came from a past trip, which stores them. */
  readonly coords: { lat: number; lng: number } | null;
  readonly rideType: RideType | null;
  readonly pool: boolean;
  readonly seats: number;
}

/**
 * Read the voice screen's route params, or null for a normal typed booking.
 *
 * Everything is validated rather than trusted: the params survive a round trip
 * through the URL, so a ride type is checked against the real list and the seat
 * count is clamped to what a vehicle actually holds.
 */
function readVoicePrefill(params: Record<string, string | string[] | undefined>): VoicePrefill | null {
  const dropoff = typeof params.voiceDropoff === 'string' ? params.voiceDropoff.trim() : '';
  if (!dropoff) return null;

  const lat = Number(params.voiceDropoffLat);
  const lng = Number(params.voiceDropoffLng);
  const coords =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const spokenRide = params.voiceRideType;
  const rideType =
    typeof spokenRide === 'string' && spokenRide in BASE_FARES
      ? (spokenRide as RideType)
      : null;

  const spokenSeats = Number(params.voiceSeats);
  const seats = Number.isFinite(spokenSeats)
    ? Math.min(Math.max(Math.round(spokenSeats), 1), MAX_SEATS)
    : 1;

  return { dropoff, coords, rideType, pool: params.voicePool === '1', seats };
}

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

// The ride sheet opens comfortably tall — it carries the whole booking now —
// but the map behind it stays worth looking at, so the first snap still shows
// the route. The Book bar is pinned outside the sheet at every height.
const RIDE_SNAP_POINTS = [0.44, 0.70, 0.94];

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
  { key: 'mini',    label: 'Mini',     desc: 'Everyday, no AC',   seats: 4, Icon: MiniIcon },
  { key: 'bike',    label: 'Moto',     desc: 'Motorbike · Fast',  seats: 1, Icon: MotoIcon },
  { key: 'ac',      label: 'Ride A/C', desc: 'Cool cars, AC on',  seats: 4, Icon: AcIcon },
  { key: 'comfort', label: 'Premium',  desc: 'Top sedans, AC',    seats: 4, Icon: PremiumIcon },
];

export default function Booking() {
  const router = useRouter();
  /** Prefill handed over by the voice screen; empty for a typed booking. */
  const params = useLocalSearchParams<{
    voiceDropoff?: string;
    voiceDropoffLat?: string;
    voiceDropoffLng?: string;
    voiceRideType?: string;
    voicePool?: string;
    voiceSeats?: string;
  }>();
  const { user } = useAuth();
  // The ride sheet is absolutely pinned to the screen bottom; edge-to-edge
  // Android draws it behind the system navigation bar unless padded.
  const insets = useSafeAreaInsets();
  const { coords, address: currentAddress, status: locStatus, request: requestLocation } =
    useCurrentLocation();
  const recents = useRecentDestinations(user?.uid);
  // The backend refuses a second active trip, so without this the rider would
  // pick a destination, tune a fare, press Book and only THEN be told they
  // already have a ride running. Offer the ride instead of the dead end.
  const { active: activeTrip } = useActiveTrip(user?.uid);

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

  /**
   * A booking spoken on the voice screen (app/passenger/voice.tsx), read once.
   *
   * Voice fills the slots and stops; it never books. Everything that touches
   * money — the real fare from the fare engine, the map, the final confirm —
   * happens here, on exactly the screen a typed booking would have reached.
   * One pricing path, not two, and a mis-heard destination surfaces as
   * something the rider can see and change rather than a wrong charge.
   */
  const voicePrefill = useMemo(() => readVoicePrefill(params), []);

  // Two steps, and only two: say where you're going, then book. Pool-or-Solo
  // used to be a screen of its own between them; it is a pair of cards on the
  // ride sheet now, because it was never a question worth a whole screen.
  const [stage, setStage] = useState<'route' | 'ride'>(voicePrefill ? 'ride' : 'route');
  // Extras — payment, promo, pool visibility, scheduling — are folded away by
  // default. Cash, a public pool and no promo cover almost every booking, so
  // the rider who wants none of it never has to look at any of it.
  const [moreOpen, setMoreOpen] = useState(false);
  // The pool search radius only unfolds when the rider asks for it.
  const [radiusOpen, setRadiusOpen] = useState(false);
  // Measured height of the pinned Book bar, so the sheet's scroll can clear it.
  const [ctaHeight, setCtaHeight] = useState(96);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState(voicePrefill?.dropoff ?? '');
  // Resolved coords for the selected dropoff place — this is what puts the
  // destination pin + route line on the map, so every selection path below
  // (autocomplete, recents, free-typed) must eventually fill it.
  // Seeded from the voice screen when the destination came from the rider's own
  // past trips — those records already carry coordinates, so that path costs no
  // geocoding at all.
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(
    voicePrefill?.coords ?? null,
  );
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
  // Sharing is the default. It is the cheaper ride and the one the business
  // runs on, it costs the rider nothing to start (a share that nobody joins is
  // simply a solo ride at the solo price), and anyone who wants the car to
  // themselves is one tap away. A voice booking that explicitly said "alone"
  // still gets Solo.
  const [mode, setMode] = useState<'solo' | 'pool'>(
    voicePrefill && !voicePrefill.pool ? 'solo' : 'pool',
  );
  const [rideType, setRideType] = useState<RideType>(voicePrefill?.rideType ?? 'mini');
  const [fare, setFare] = useState<number>(BASE_FARES.mini);
  const [fareText, setFareText] = useState<string>(String(BASE_FARES.mini));
  // Voice booking can arrive with a passenger count already spoken ("do banday
  // hain"). The typed flow has no seat picker and never calls the setter.
  const [seats, setSeats] = useState(voicePrefill?.seats ?? 1);
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
    if (rt === 'bike' && mode === 'pool') {
      setMode('solo');
    }
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
    setStage('ride');
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
    setStage('ride');
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

  /**
   * Resolve a spoken destination that arrived without coordinates.
   *
   * Only the geocode needs to happen after mount — every other slot from the
   * voice screen is applied straight into the state initialisers above, so the
   * screen renders once, already correct, with no flash of an empty form.
   */
  useEffect(() => {
    if (!voicePrefill || voicePrefill.coords) return;

    const seq = ++destSeq.current;
    geocodeAddress(voicePrefill.dropoff).then((geo) => {
      if (geo && destSeq.current === seq) setDropoffCoords({ lat: geo.lat, lng: geo.lng });
    });
  }, [voicePrefill]);

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
  // The best case a pool can reach: a full car. Never the price we lead with —
  // the rider pays the full fare until somebody actually joins.
  const poolShareFare = poolFareFor(fare, POOL_TIERS[POOL_TIERS.length - 1]?.extra ?? 3);
  const payLabel = paymentMethod === 'cash' ? 'Pay cash' : 'Pay from wallet';

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

        {activeTrip ? (
          <Pressable
            style={({ pressed }) => [styles.activeTripBanner, pressed && { opacity: 0.9 }]}
            onPress={() => router.replace(`/passenger/trip/${activeTrip.id}` as Parameters<typeof router.replace>[0])}
            accessibilityRole="button"
            accessibilityLabel="Return to your ride in progress"
          >
            <View style={styles.activeTripDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.activeTripBannerTitle}>You already have a ride running</Text>
              <Text style={styles.activeTripBannerSub} numberOfLines={1}>
                {activeTrip.dropoffAddress ?? 'Your ride is still going'} · tap to track
              </Text>
            </View>
            <Text style={styles.activeTripBannerGo}>→</Text>
          </Pressable>
        ) : null}

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

  /* ══════════════ STAGE 2 — the whole booking, over the route map ══════════════ */
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
            onPress={() => setStage('route')}
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

      {/* ══════════════ ONE SHEET: choose, price, book ══════════════
          This was two screens — a Solo/Pool chooser, then a details screen.
          Two problems, one cause: the rider had to walk through a chooser that
          told them nothing they couldn't already see here, and the Book button
          lived inside the sheet, below its own bottom edge, so at every snap
          point but the tallest it sat off-screen and the ride could never be
          requested. Everything a rider decides now lives on this single sheet,
          and the button that books is pinned to the screen OUTSIDE the sheet,
          where no drag and no scroll can hide it. */}
      <DraggableSheet style={styles.rideSheet} snapPoints={RIDE_SNAP_POINTS}>
        <ScrollView
          style={styles.rideScroll}
          contentContainerStyle={[styles.rideScrollBody, { paddingBottom: ctaHeight + 14 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ══ Shared rides already going this way — FIRST, before anything ══
               This used to sit below the fare stepper, three sections down the
               sheet, where a rider had to scroll past every decision they were
               making to find out that somebody was already driving their route
               with a spare seat at half the price. Almost nobody did, so almost
               nobody pooled, and the cheapest option in the app was effectively
               hidden.
               It leads now, because it is the only thing on this screen that
               can make the ride cost less, and because it is the one choice
               that stops mattering the moment they price their own ride.
               Everything in this list is a CONFIRMED ride: a driver has agreed
               a fare with the host and is on their way. A pool still haggling
               with drivers never appears — a seat in a car nobody has agreed to
               drive is not a seat.
               With nothing to join it collapses to a single tappable line
               rather than taking room it has not earned. ── */}
          {poolsLoading || nearbyPools.length > 0 || radiusOpen ? (
            <>
              <View style={styles.goingYourWayHeader}>
                <PoolIcon size={14} color={colors.primary} accent={colors.primary} />
                <Text style={styles.goingYourWayLabel}>JOIN A RIDE ALREADY GOING YOUR WAY</Text>
                {nearbyPools.length > 0 && (
                  <View style={styles.goingYourWayCount}>
                    <Text style={styles.goingYourWayCountText}>{nearbyPools.length}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <Pressable onPress={() => setRadiusOpen((v) => !v)} hitSlop={10}>
                  <Text style={styles.radiusHint}>within {poolRadiusKm} km {radiusOpen ? '⌃' : '⌄'}</Text>
                </Pressable>
              </View>

              {/* The rider owns the search radius — 2 km for "must be right
                  here", 25 km to sweep the whole city when nothing turns up. */}
              {radiusOpen ? (
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
              ) : null}

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
                      </Text>
                      {/* Who's already in the car, and who is driving it. Riders
                          decide on this before fare — sharing with the opposite
                          gender is a real consideration here, and so is knowing
                          this is a real car with a real driver rather than a
                          request somebody has posted. */}
                      <Text style={styles.matchGender} numberOfLines={1}>
                        {poolGenderSummary(p.males, p.females)}
                        {p.companions && p.companions.length > 0
                          ? ` · with ${p.companions.map((c) => c.firstName).join(', ')}`
                          : ''}
                      </Text>
                      <Text style={styles.matchDriver} numberOfLines={1}>
                        {p.driverName
                          ? `🚗 ${p.driverName}${p.driverVehicle ? ` · ${p.driverVehicle}` : ''} — on the way`
                          : '🚗 Driver confirmed — on the way'}
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
                  No confirmed shared rides within {poolRadiusKm} km going your way yet — widen the
                  search above, or book your own below as a Share Ride and let others join you once
                  your driver is confirmed.
                </Text>
              )}
            </>
          ) : (
            <Pressable style={styles.widenRow} onPress={() => setRadiusOpen(true)}>
              <PoolIcon size={14} color={colors.muted} accent={colors.muted} />
              <Text style={styles.widenText}>
                No confirmed shared ride within {poolRadiusKm} km yet — tap to search wider
              </Text>
            </Pressable>
          )}

          {/* ── 1. The only choice that changes the ride: share it, or don't ──
               Two taps' worth of screen, not two screens. Both cards show the
               same price on purpose — a pool IS the full fare until someone
               actually joins, and pretending otherwise is the one thing riders
               get wrong about pooling. */}
          <Text style={styles.stepLabel}>OR BOOK YOUR OWN · HOW DO YOU WANT TO RIDE?</Text>
          <View style={styles.pickRow}>
            <Pressable
              style={({ pressed }) => [styles.pickCard, mode === 'pool' && styles.pickCardOn, pressed && styles.pickCardPressed]}
              onPress={() => pickMode('pool')}
            >
              <View style={styles.pickHeadRow}>
                <PoolIcon
                  size={16}
                  color={mode === 'pool' ? colors.primary : '#c9cfcc'}
                  accent={mode === 'pool' ? colors.primary : '#c9cfcc'}
                />
                <Text style={[styles.pickTitle, mode === 'pool' && { color: colors.primary }]}>Share Ride</Text>
                <View style={{ flex: 1 }} />
                {mode === 'pool' ? (
                  <View style={styles.pickTick}><Text style={styles.pickTickTxt}>✓</Text></View>
                ) : null}
              </View>
              <Text style={styles.pickPrice}>PKR {fare}</Text>
              <Text style={styles.pickSub}>
                Once your driver is confirmed, riders going your way can join — and your fare drops
                to PKR {poolShareFare} each as they do.
              </Text>
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>SAVE UP TO {maxSavePct}%</Text>
              </View>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.pickCard, mode === 'solo' && styles.pickCardOn, pressed && styles.pickCardPressed]}
              onPress={() => pickMode('solo')}
            >
              <View style={styles.pickHeadRow}>
                <SoloIcon
                  size={16}
                  color={mode === 'solo' ? colors.primary : '#c9cfcc'}
                  accent={mode === 'solo' ? colors.primary : '#c9cfcc'}
                />
                <Text style={[styles.pickTitle, mode === 'solo' && { color: colors.primary }]}>Solo</Text>
                <View style={{ flex: 1 }} />
                {mode === 'solo' ? (
                  <View style={styles.pickTick}><Text style={styles.pickTickTxt}>✓</Text></View>
                ) : null}
              </View>
              <Text style={styles.pickPrice}>PKR {fare}</Text>
              <Text style={styles.pickSub}>The whole car to yourself. Fastest pickup, nobody joins.</Text>
            </Pressable>
          </View>

          {/* ── 2. Which vehicle ── */}
          <Text style={styles.stepLabel}>WHICH CAR?</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.vehicleRow}
          >
            {RIDE_OPTIONS
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

          {/* ── 3. What you offer the driver ── */}
          <Text style={styles.stepLabel}>WHAT WILL YOU PAY?</Text>
          <View style={styles.fareCard}>
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

          {/* ── Everything else. A first-time rider can book without ever
               opening this: cash, a public pool and no promo are the defaults,
               and they are what almost every rider wants anyway. ── */}
          <Pressable style={styles.moreToggle} onPress={() => setMoreOpen((v) => !v)}>
            <Text style={styles.moreToggleText}>
              {moreOpen ? 'Hide extra options' : 'Payment, promo code & more'}
            </Text>
            <Text style={styles.moreChevron}>{moreOpen ? '⌃' : '⌄'}</Text>
          </Pressable>

          {moreOpen ? (
            <View style={styles.moreBody}>
              <Text style={styles.sectionLabel}>HOW YOU PAY</Text>
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

              {mode === 'pool' && (
                <>
                  {/* Everyone's fare drops as riders join — you always offer the
                      solo fare, and this table is the proof of that. */}
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

                  <Text style={styles.sectionLabel}>WHO CAN JOIN YOUR RIDE</Text>
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
                    who actually join, the less each of you pays.
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
            </View>
          ) : null}
        </ScrollView>
      </DraggableSheet>

      {/* ══ The Book button. Pinned to the screen, not to the sheet — the sheet
           is taller than the screen at every snap point but the last, so
           anything laid out below its scroll area can sit past the bottom edge
           with no way to reach it. This is the one control a rider must always
           be able to press. ══ */}
      <View
        style={[styles.ctaBar, { paddingBottom: insets.bottom + 12 }]}
        onLayout={(e) => setCtaHeight(e.nativeEvent.layout.height)}
      >
        {!coords && locStatus !== 'loading' ? (
          <Pressable onPress={requestLocation}>
            <Text style={styles.locHint}>Tap to enable location for your pickup point</Text>
          </Pressable>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.bookButton, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
          onPress={submitRide}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Book ride for ${fare} rupees`}
        >
          <Text style={styles.bookButtonText}>
            {loading ? 'Booking…' : `Book Ride · PKR ${fare}`}
          </Text>
        </Pressable>

        <Text style={styles.bookCaption}>
          {mode === 'pool'
            ? `${payLabel} · PKR ${fare} if you ride alone, PKR ${poolShareFare} each when full`
            : `${payLabel} · drivers bid on your offer — no surge tricks`}
        </Text>
      </View>

      {/* ══ Instant hand-off ══
           createTrip is a callable: a cold function in asia-south1 can take a
           couple of seconds to answer, and for all of that time the rider was
           left looking at the same sheet with a button that said "Booking…".
           It read as a dead tap, and riders pressed it again. This covers the
           screen the moment the press lands — before the network is touched —
           so the ride visibly starts immediately and the real trip screen
           replaces it as soon as the id comes back. ══ */}
      {loading ? (
        <View style={[styles.bookingOverlay, { paddingBottom: insets.bottom }]} pointerEvents="auto">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.bookingOverlayTitle}>Requesting your ride…</Text>
          <Text style={styles.bookingOverlayRoute} numberOfLines={2}>
            {(pickup.trim() || currentAddress || 'Current location')} → {dropoff.trim() || 'Destination'}
          </Text>
          <View style={styles.bookingOverlayFareRow}>
            <Text style={styles.bookingOverlayFare}>PKR {fare}</Text>
            <Text style={styles.bookingOverlayFareUnit}>
              {mode === 'pool' ? 'shared · drops as riders join' : 'solo'}
            </Text>
          </View>
          <Text style={styles.bookingOverlaySub}>
            {"Telling nearby drivers — they'll offer in a moment."}
          </Text>
        </View>
      ) : null}

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
                        {h.date}{h.fare ? ` · PKR ${h.fare}` : ''}{h.pool ? ' · Shared' : ''}
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

const styles = themed(() => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },

  /* A live ride, surfaced before the rider spends effort on one they cannot book. */
  activeTripBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.glassLime,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  activeTripDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  activeTripBannerTitle: {
    fontSize: 13.5,
    fontWeight: '900',
    color: colors.text,
  },
  activeTripBannerSub: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 2,
  },
  activeTripBannerGo: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.primary,
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

  /* ════════ Shared map + floating header ════════ */
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
  /* ════════ Stage 2 — the one booking sheet ════════ */
  /* Height is the rider's, via DraggableSheet — this only skins the surface. */
  rideSheet: {
    backgroundColor: 'rgba(11,13,12,0.97)',
  },
  rideScroll: {
    flex: 1,
  },
  rideScrollBody: {
    paddingHorizontal: 18,
    gap: 10,
  },
  /* Numbered so the sheet reads as a short list of steps rather than a wall of
     controls — a first-time rider can see there are only three of them. */
  stepLabel: {
    fontSize: 10.5,
    fontWeight: '900',
    color: colors.muted,
    letterSpacing: 1.1,
    marginTop: 4,
  },

  /* ── Pool vs Solo, side by side. Both show the same price because both COST
       the same until a rider actually joins a pool. ── */
  pickRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pickCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: 12,
    gap: 3,
  },
  pickCardOn: {
    backgroundColor: colors.glassLime,
    borderColor: colors.primary,
  },
  pickCardPressed: { opacity: 0.8 },
  pickHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pickTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.text,
  },
  pickTick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickTickTxt: {
    fontSize: 11,
    fontWeight: '900',
    color: '#0b0d0c',
  },
  pickPrice: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
    letterSpacing: -0.4,
  },
  pickSub: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
    color: '#a9b0ad',
  },

  /* Collapsed stand-in for the pool search when nothing is going the rider's
     way — one line instead of a header, five chips and an empty state. */
  widenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  widenText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '600',
    color: colors.muted,
  },

  /* ── The fold that keeps this screen simple ── */
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 2,
  },
  moreToggleText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
  },
  moreChevron: {
    fontSize: 15,
    fontWeight: '900',
    color: colors.muted,
  },
  moreBody: {
    gap: 8,
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
  // The line that makes a listed pool read as a car rather than a wish: it
  // names the driver who has already agreed to carry it.
  matchDriver: {
    fontSize: 10.5,
    color: colors.muted,
    fontWeight: '700',
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

  /* ════════ Ride options — vehicle, fare, pool detail ════════ */

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


  /* ══ The pinned Book bar ══
     Deliberately NOT a child of the sheet. The sheet is as tall as its tallest
     snap point and slides down to shrink, so anything below its scroll area
     ends up off the bottom of the screen — which is exactly how the old
     "Find Driver" button became unreachable. This sits on the screen itself. */
  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingHorizontal: 18,
    paddingTop: 12,
    gap: 8,
    backgroundColor: 'rgba(9,11,10,0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },
  bookButton: {
    // No `flex: 1` here — a standalone child of a column collapses to zero
    // height with flexBasis:0, which would make the primary CTA invisible.
    alignSelf: 'stretch',
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookButtonText: {
    color: '#0b0d0c',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  bookingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  bookingOverlayTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
    marginTop: 6,
  },
  bookingOverlayRoute: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
  },
  bookingOverlayFareRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 4,
  },
  bookingOverlayFare: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -0.5,
  },
  bookingOverlayFareUnit: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  bookingOverlaySub: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#8f9694',
    textAlign: 'center',
    marginTop: 2,
  },
  bookCaption: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: '#8cc840',
    textAlign: 'center',
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
