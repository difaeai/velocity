/**
 * Corporate, Students & daily travel — home's left ride tile. Ride sharing,
 * laid out the owner's way (2026-10-29; the + box 2026-10-30): one search,
 * then cards — and + to start one.
 *
 *   1. The top row: "Ride sharing", the city in the middle, then +.
 *   2. Where to (drop-off), then where from (pickup — the phone's location
 *      until the rider types), then GO — dead until both are in, and the only
 *      thing that puts rides on the screen (owner, 2026-11-11). Nothing is
 *      searched as the screen opens or while somebody types, which is most of
 *      what made the screen feel slow.
 *   3. Big cards, one to a row, two of them a screenful (owner, 2026-11-11;
 *      two to a row until then): with a drop-off, the related ones — the
 *      rider's exact route first, then further, then further still — and All
 *      shows every ride in the city without a GO, ranked around the phone's
 *      pickup. Each has a wide picture on top (the driver's car, nearby cars,
 *      or its route drawn as a map), then its four named lines — Pick up:,
 *      Drop off:, Fare:, Passengers: — a pulsing "Available" and a ♀/♂ badge.
 *      Tap a box: a dialog with only fare, seats, from and to, Join in green
 *      and Cancel see-through (Leave there for a rider in it). A car that fills
 *      stays two minutes; then the route is an empty car again.
 *      In Islamabad and Rawalpindi every everyday route is there already
 *      (2026-11-02, src/domain/sharingRoutes): an empty car until its first
 *      Join creates it. A search shows the rider's exact route first (its Join
 *      creates it), then every other ride, the closest to their route first.
 *      Over the boxes (2026-11-05): My Routes (the rider's own daily trip:
 *      pickup, drop-off, the time they go and the time they come back home,
 *      Save — which also turns on the reminder before each one — and its own
 *      GO; the trip there or home, by the clock or by the rider's pick),
 *      Leaving from your pickup, All (favourites on top) and Favourites — a
 *      heart, or a double tap, keeps a route there. My Routes is drawn as the
 *      website's Vexa log-in: lime, a shine across it, stars (owner,
 *      2026-11-11). The picture is the route on a real map, a car driving it.
 *   4. + (top right) opens the box that starts one, in this order: institution
 *      and location name, drop-off, pickup, start time — then its fare and the
 *      seats still free.
 *
 * A seat booked for later is PENDING until a driver accepts, and every card and
 * sheet says so. Riders on the route are collected at their own stops, each
 * within 1 km of the car's — that is what "on your route" means.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import MapView from 'react-native-maps';
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { api, type SharedFareQuote, type SharedPool, type SharedPoolSeat } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { db } from '../../src/firebase';
import { themed } from '../../src/theme';
import { PAKISTAN_CITIES } from '../../src/domain/intercityTypes';
import { useCurrentLocation } from '../../src/hooks/location';
import { useDailyRoutes, type DailyRoute } from '../../src/hooks/passenger';
import { useCancellationSettings } from '../../src/hooks/driver';
import { useActiveTrip } from '../../src/hooks/useActiveTrip';
import { useTrip } from '../../src/hooks/useTrip';
import { poolLeaveFee } from '../../src/lib/poolLeave';
import { useForegroundInterval } from '../../src/hooks/useForegroundInterval';
import { fetchPlaceDetail, usePlacesAutocomplete, type PlacePrediction } from '../../src/hooks/places';
import { areaLabel } from '../../src/lib/areaLabel';
import { clockLabel, fromHHMM, legByClock, toHHMM } from '../../src/lib/dailyRouteTime';
import { distanceMeters } from '../../src/lib/geo';
import {
  nearestSpotName,
  pickupOrder,
  routeGap,
  sameRoute,
  SHARING_ROUTES,
  TWIN_CITIES,
} from '../../src/domain/sharingRoutes';
import { Text, TextInput } from '../../src/ui/Text';
import { DestinationPinIcon, PickupDotIcon } from '../../src/ui/RideIcons';
import { ArrowIcon } from '../../src/ui/ServiceIcons';
import { MAPS_AVAILABLE, mapBaseProps } from '../../src/ui/mapProvider';

// Places API (New) requires session tokens to be UUID v4.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type Field = 'to' | 'from';
type Place = { lat: number; lng: number; address: string };
/** What the + box hands back: the name, the start time, and — new rides only — the route. */
type RideInput = { label: string; departTime: string | null; from: Place | null; to: Place | null };

/** What the live ride is doing, in the rider's words. */
const ACTIVE_LABEL: Record<string, string> = {
  requested: 'Booked — finding a driver',
  matched: 'Your driver is on the way',
  arriving: 'Your driver is on the way',
  arrived: 'Your driver has arrived',
  in_progress: 'You are on your ride',
};

/** The chosen city outlives the screen and the theme/language remount. */
let rememberedCity: string | null = null;

/** The city named in an address, if it is one we list. */
function cityFromAddress(address: string | null | undefined): string | null {
  const a = (address ?? '').toLowerCase();
  return PAKISTAN_CITIES.find((c) => a.includes(c.name.toLowerCase()))?.id ?? null;
}

const clockOf = (ms: number) => clockLabel(toHHMM(new Date(ms))) ?? '';

/** "Go" green — Join and the active light. */
const GO = '#22c55e';
/** The gender badge: women and men, as on the rest of the app's pink and blue. */
const WOMEN = '#ec4899';
const MEN = '#3b82f6';

const errorText = (e: unknown) => (e instanceof FirebaseError ? e.message : 'Please try again.');

/** A box: a real shared ride, or a `ready` route nobody has joined yet — its first Join creates it. */
type Box = SharedPool & { ready?: true };

/**
 * Boxes at a time; "Show more" adds as many again. Six, not twenty (owner,
 * 2026-11-11: the boxes are now a screenful of two): each one costs a map
 * photograph and a fare call, so a shorter page is a faster screen.
 */
const PAGE = 6;

/**
 * A card's picture, width ÷ height. Wide and shallow so a whole card — picture,
 * the four named lines and its time — is about half the screen, which is what
 * "two cards in front of me" (owner, 2026-11-11) comes to.
 */
const BOX_PIC_ASPECT = 2.6;

/** Each ready route's fare ladder, kept a while: the box only shows what Join would cost. */
const routeFares = new Map<string, { atMs: number; perSeat: number[] }>();
const fareAsked = new Set<string>();
const FARE_FRESH_MS = 10 * 60_000;
const fareKey = (b: { pickup: Place; dropoff: Place }) =>
  [b.pickup.lat, b.pickup.lng, b.dropoff.lat, b.dropoff.lng].map((n) => n.toFixed(4)).join(',');

/** A ready route as an empty car, priced from what has come back so far. */
function readyBox(id: string, label: string, city: string, pickup: Place, dropoff: Place): Box {
  const ladder = routeFares.get(fareKey({ pickup, dropoff }))?.perSeat ?? [];
  const fare = ladder[0] ?? 0;
  return {
    id, label, city, rideType: 'mini', pickup, dropoff,
    pickupDistanceM: null, dropoffDistanceM: null, departTime: null, departsAtMs: null,
    state: 'gathering', riders: 0, seatsTotal: 4, seatsLeft: 4,
    fare, farePerSeat: fare, fareLadder: ladder, soloFare: fare,
    driver: null, needsDriverApproval: false, booked: false, aboardTripId: null, mine: false,
    driverAhead: false, nearby: false, carPhotos: [], riderGender: null, ready: true,
  };
}

/** What the phone's location is called until its address comes back. */
const PICKUP_FALLBACK = 'Pickup location';
const CITY_NAMES = new Set(PAKISTAN_CITIES.map((c) => c.name.toLowerCase()));

/**
 * A place's name on a box: its area — or, when the address names only a street
 * and the city ("140, Street 13, Islamabad"), the known area it is in ("PWD").
 */
function placeName(pl: Place): string {
  const a = areaLabel(pl.address);
  if (a !== PICKUP_FALLBACK && !CITY_NAMES.has(a.toLowerCase())) return a;
  return nearestSpotName(pl) ?? a;
}

/** A box's fare — "PKR …" while a ready route's is still on its way. */
const fareText = (p: SharedPool) => (p.farePerSeat > 0 ? `PKR ${p.farePerSeat}` : 'PKR …');

/** The row over the boxes, in the owner's order (2026-11-05). */
type Mode = 'mine' | 'pickup' | 'all' | 'favs';
const MODES: [Mode, string][] = [
  ['mine', 'My Routes'],
  ['pickup', 'Leaving from your pickup'],
  ['all', 'All'],
  ['favs', 'Favourites'],
];

/** My Routes as two of the rider's daily routes (users/{uid}/dailyRoutes): there, and home again. */
const MY_ROUTE_GO = 'sharingGo';
const MY_ROUTE_BACK = 'sharingBack';

/** A favourite is a route: a box whose ends are each this close to it is the same one. */
const FAV_M = 300;
type Fav = { label: string; city: string; pickup: Place; dropoff: Place };
/** Kept on the phone: a favourite is a shortcut, nothing else depends on it. */
const favStoreKey = (uid: string | undefined) => `velocity.sharingFavs.${uid ?? 'guest'}`;
/** A second tap this soon after the first is a double tap — a favourite, not an open. */
const DOUBLE_TAP_MS = 260;
const HEART = '#ff4d6d';

export default function DailyTravelScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
  const { active } = useActiveTrip(user?.uid);

  const [city, setCityState] = useState(() => rememberedCity ?? cityFromAddress(currentAddress) ?? 'islamabad');
  const [cityOpen, setCityOpen] = useState(false);
  const cityName = PAKISTAN_CITIES.find((c) => c.id === city)?.name ?? 'Islamabad';
  function setCity(id: string) {
    rememberedCity = id;
    setCityState(id);
  }
  // Until the rider picks a city, it follows the phone's address once that arrives.
  useEffect(() => {
    const guess = cityFromAddress(currentAddress);
    if (!rememberedCity && guess) setCityState(guess);
  }, [currentAddress]);

  const [to, setTo] = useState<Place | null>(null);
  const [from, setFrom] = useState<Place | null>(null);
  // Until the rider types in it, "from" follows the phone's location.
  const [fromEdited, setFromEdited] = useState(false);

  useEffect(() => {
    if (fromEdited || !coords) return;
    // "Pickup location", never "Current location" (owner, 2026-11-02).
    setFrom({ lat: coords.lat, lng: coords.lng, address: currentAddress ?? PICKUP_FALLBACK });
    // Keyed on coordinates: a new coords object for the same fix must not re-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromEdited, coords?.lat, coords?.lng, currentAddress]);

  // ── The boxes ─────────────────────────────────────────────────────────────
  // Before a search, every shared ride in the city; with both ends, the related ones.
  const [pools, setPools] = useState<SharedPool[] | null>(null);
  const [opened, setOpened] = useState<Box | null>(null);
  const [sheet, setSheet] = useState<{ edit: SharedPool | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Bumped to empty the drop-off and pickup boxes from outside (after a new ride).
  const [routeKey, setRouteKey] = useState(0);
  const cancellation = useCancellationSettings();
  // Only the newest search may paint: an older answer landing late is a different route.
  const searchSeq = useRef(0);
  // The row over the boxes. All and Favourites both need every ride in the city.
  const [mode, setModeState] = useState<Mode>('pickup');
  const all = mode === 'all' || mode === 'favs';
  // GO (owner, 2026-11-11): the route the rider pressed GO on. Nothing is
  // searched while they are still typing, and nothing at all when the screen
  // opens — the boxes answer one press, which is also why the screen is quick.
  const [went, setWent] = useState<{ from: Place; to: Place } | null>(null);
  function setMode(m: Mode) {
    if (m !== mode) {
      setPools(null);
      // My Routes searches the rider's own saved route: the search box's GO
      // does not carry into it, nor its GO back out.
      if ((m === 'mine') !== (mode === 'mine')) setWent(null);
    }
    setModeState(m);
  }
  // My Routes: the rider's own saved route, searched instead of the box at the top.
  const routes = useDailyRoutes(user?.uid);
  const myRoute = routes?.find((r) => r.id === MY_ROUTE_GO) ?? null;
  const myRouteBack = routes?.find((r) => r.id === MY_ROUTE_BACK) ?? null;
  // Going there or coming back home: the rider's pick, else by their own two times.
  const [legPick, setLegPick] = useState<'go' | 'back' | null>(null);
  const homeward = (legPick ?? legByClock(myRoute?.time, myRouteBack?.time, new Date())) === 'back';
  // All and Favourites are a press of their own: they list the city straight
  // away, ranked around the phone's pickup. Everything else waits for GO.
  const qFrom = all ? from : went?.from ?? null;
  const qTo = all ? to : went?.to ?? null;
  const listing = all || !!(qFrom && qTo);

  const loadPools = useCallback(() => {
    const n = ++searchSeq.current;
    if (!listing) return;
    api
      .getSharedPools({
        city,
        // This build knows what a seeded ride is, and draws it under the real ones.
        seeds: true,
        ...(qFrom ? { from: { lat: qFrom.lat, lng: qFrom.lng }, fromAddress: qFrom.address } : {}),
        ...(all
          ? { all: true }
          : qTo
            ? { to: { lat: qTo.lat, lng: qTo.lng }, toAddress: qTo.address }
            : {}),
      })
      .then((r) => n === searchSeq.current && setPools(r.pools))
      .catch(() => n === searchSeq.current && setPools((prev) => prev ?? []));
  }, [city, qFrom, qTo, all, listing]);

  /** My Routes, saved as two daily routes: there at the go time, home at the back time. */
  function saveMyRoute(pickup: Place, dropoff: Place, start: string, end: string) {
    if (!user) return;
    const batch = writeBatch(db);
    const leg = (id: string, had: boolean, label: string, a: Place, b: Place, time: string) =>
      batch.set(
        doc(db, 'users', user.uid, 'dailyRoutes', id),
        {
          label, pickup: a, dropoff: b, time, updatedAt: serverTimestamp(),
          // A new one takes the My routes screen's defaults; a change made there is kept.
          ...(had ? {} : { radiusKm: 3, notify: true, createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
    leg(MY_ROUTE_GO, !!myRoute, 'My route', pickup, dropoff, start);
    leg(MY_ROUTE_BACK, !!myRouteBack, 'My route home', dropoff, pickup, end);
    batch
      .commit()
      .then(() =>
        Alert.alert(
          'Route saved',
          `Both times are set — ${clockLabel(start)} there and ${clockLabel(end)} back. ` +
            'We will remind you before each one, and tell you when people are going your way.',
        ),
      )
      .catch((e) => Alert.alert('Could not save your route', errorText(e)));
  }

  // ── Favourites (owner, 2026-11-05): a heart or a double tap, no searching again ──
  const [favs, setFavs] = useState<Fav[]>([]);
  const favStore = favStoreKey(user?.uid);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(favStore)
      .then((v) => {
        const list: unknown = v ? JSON.parse(v) : [];
        if (live && Array.isArray(list)) setFavs(list.filter((f: Fav) => f?.pickup && f?.dropoff));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [favStore]);
  const isFav = useCallback((b: { pickup: Place; dropoff: Place }) => favs.some((f) => sameRoute(f, b, FAV_M)), [favs]);
  function toggleFav(b: Box) {
    const next = isFav(b)
      ? favs.filter((f) => !sameRoute(f, b, FAV_M))
      : [{ label: b.label || placeName(b.dropoff), city: b.city, pickup: b.pickup, dropoff: b.dropoff }, ...favs];
    setFavs(next);
    AsyncStorage.setItem(favStore, JSON.stringify(next)).catch(() => {});
  }
  // On focus and on every new search — and seats fill and cars leave while the rider watches.
  useFocusEffect(loadPools);
  useForegroundInterval(loadPools, 20_000);
  // The wait the owner sees is a cold start, not the work (see `warmShared`):
  // wake the search and the fare as the screen opens, and keep them awake while
  // it is open. The join is woken when a ride's dialog opens, below.
  useForegroundInterval(() => {
    api.warmShared('getSharedPools').catch(() => {});
    api.warmShared('getSharedRideFare').catch(() => {});
  }, 5 * 60_000);
  // One beat for every box's car photos, so they turn over together.
  const [carBeat, setCarBeat] = useState(0);
  useForegroundInterval(() => setCarBeat((b) => b + 1), 2800);
  // One clock for every box's shine, glow and route dot: twenty boxes, one animation.
  const [flow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(flow, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [flow]);

  // ── The ready routes (Islamabad and Rawalpindi) ───────────────────────────
  // With All or the pickup alone: the real rides and every route no real ride
  // runs yet, those leaving near the pickup first. With a search (owner,
  // 2026-11-02: "the exact location at once, then the next, then the next"):
  // the real rides on the rider's own
  // route, else their exact route as an empty car — then every other ride,
  // real or ready, closest to their route first.
  const listed = useMemo<Box[] | null>(() => {
    if (pools === null) return null;
    const twin = TWIN_CITIES.has(city);
    /**
     * The example rides a cold area gets (demand/seedRides) are kept out of
     * every decision below and appended at the end.
     *
     * Not cosmetic. Their route IS the rider's own route, so left in `pools`
     * they would sort above the real rides on it — and worse, they would count
     * as "there is already a ride on your route", which suppresses the box
     * whose Join actually creates one. The rider would be left with three cards
     * that can only answer "that one has just left" and no way to start a ride
     * from the list. Real rides first, always; the examples fill the space under
     * them.
     */
    const real = pools.filter((p) => !p.seeded);
    const examples = pools.filter((p) => p.seeded);
    const open = SHARING_ROUTES.filter((r) => twin && !real.some((p) => sameRoute(r, p)));
    const boxes: Box[] = [...real, ...open.map((r) => readyBox(r.id, r.label, city, r.pickup, r.dropoff))];
    // Favourites: each one's ride as it is now — a real one first — else its route as an empty car.
    if (mode === 'favs') {
      const seen = new Set<string>();
      return favs
        .map((f) => boxes.find((b) => sameRoute(f, b, FAV_M)) ?? readyBox(`fav:${fareKey(f)}`, f.label, f.city, f.pickup, f.dropoff))
        .filter((b) => !seen.has(b.id) && !!seen.add(b.id));
    }
    // All, or a pickup with no drop-off yet: what leaves from around the pickup
    // first, then from further away. All: the rider's favourites on top.
    if (all || !qTo) return [...pickupOrder(qFrom, boxes, all ? isFav : undefined), ...examples];
    if (!qFrom) return [...real, ...examples];
    // The exact ones first (owner, 2026-11-11): of the rides on the route, the
    // ones leaving from and arriving at the rider's own two places lead.
    const onIt = real
      .filter((p) => !p.nearby)
      .sort((a, b) => routeGap(qFrom, qTo, a) - routeGap(qFrom, qTo, b));
    const km = distanceMeters(qFrom.lat, qFrom.lng, qTo.lat, qTo.lng) / 1000;
    // Their own route, as createSharedPool would take it (0.5–80 km).
    const exact = { pickup: qFrom, dropoff: qTo };
    const mine =
      onIt.length === 0 && km >= 0.5 && km <= 80 && !real.some((p) => sameRoute(exact, p))
        ? [readyBox('route:exact', placeName(qTo).slice(0, 60), city, qFrom, qTo)]
        : [];
    const rest = boxes.filter((b) => b.ready || b.nearby);
    const gap = new Map(rest.map((b) => [b.id, routeGap(qFrom, qTo, b)]));
    rest.sort((a, b) => gap.get(a.id)! - gap.get(b.id)!);
    return [...onIt, ...mine, ...rest, ...examples];
  }, [pools, city, all, mode, favs, isFav, qFrom, qTo]);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [mode, qFrom, qTo, city]);
  // A ready box's fare as of now: they land one by one after the boxes do.
  const [, setFareTick] = useState(0);
  const priced = (b: Box): Box => (b.ready ? readyBox(b.id, b.label ?? '', b.city, b.pickup, b.dropoff) : b);
  const shown = listed?.slice(0, limit).map(priced) ?? null;

  const unpriced = (shown ?? []).filter((b) => b.ready && !routeFares.has(fareKey(b))).map(fareKey).join('|');
  useEffect(() => {
    for (const b of shown ?? []) {
      const key = fareKey(b);
      const had = routeFares.get(key);
      if (!b.ready || fareAsked.has(key) || (had && Date.now() - had.atMs < FARE_FRESH_MS)) continue;
      fareAsked.add(key);
      api
        .getSharedRideFare({ rideType: 'mini', pickup: { lat: b.pickup.lat, lng: b.pickup.lng }, dropoff: { lat: b.dropoff.lat, lng: b.dropoff.lng } })
        .then((q) => {
          routeFares.set(key, { atMs: Date.now(), perSeat: q.perSeat });
          setFareTick((t) => t + 1);
        })
        .catch(() => {})
        .finally(() => fareAsked.delete(key));
    }
    // Keyed on the boxes still without a fare: a repaint must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unpriced]);

  const openRide = useCallback(
    (tripId: string) => router.push(`/passenger/trip/${tripId}` as Parameters<typeof router.push>[0]),
    [router],
  );

  function announce(res: SharedPoolSeat) {
    if (res.status === 'booked' && res.backup) {
      Alert.alert(
        'Seat held as a backup',
        'You are already in another shared ride. When you confirm that one, this seat is given back — if it falls through, this ride takes you.',
      );
    } else if (res.status === 'booked') {
      Alert.alert(
        'Seat booked',
        `${res.departsAtMs ? `The car leaves at ${clockOf(res.departsAtMs)}. ` : ''}` +
          `It is not confirmed until a driver accepts — we will notify you. PKR ${res.perSeatFare} for now, less if more people join.`,
      );
    } else if (res.status === 'asked') {
      Alert.alert('Asked the driver', 'They have to agree before you take the seat. You will get a notification either way.');
    } else {
      Alert.alert(
        'You are in 🎉',
        `PKR ${res.perSeatFare} for your seat — less if more people join. Drivers nearby are being asked now.`,
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Open my ride', onPress: () => openRide(res.tripId) },
        ],
      );
    }
  }

  /**
   * An example ride (demand/seedRides) has no seat behind it. The owner's
   * answer (2026-11-13): say the car has gone and the queue starts again — and
   * make that true, by offering to start this route's queue with them first in
   * it. That turns the example into the real shared ride it was advertising,
   * which is the entire reason the examples are on the screen.
   */
  function askStartQueue(p: Box) {
    setOpened(null);
    Alert.alert(
      'That ride has just left',
      'The queue starts again from the beginning. Start it for this route and you are first in the next car.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Start the queue', onPress: () => void join(p, true) },
      ],
    );
  }

  async function join(p: Box, startQueue = false) {
    if (p.seeded && !startQueue) { askStartQueue(p); return; }
    setBusy(p.id);
    try {
      const res = p.ready || p.seeded
        // A ready route: its first rider creates the real shared ride, leaving now.
        ? await api.createSharedPool({ city, label: p.label, departTime: null, rideType: 'mini', pickup: p.pickup, dropoff: p.dropoff })
        // On the route, at the rider's own stops; a short walk away, at the car's own.
        : await api.joinSharedPool(!p.nearby && qFrom && qTo ? { poolId: p.id, pickup: qFrom, dropoff: qTo } : { poolId: p.id });
      setOpened(null);
      announce(res);
      loadPools();
    } catch (e) {
      Alert.alert('Could not join', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit(form: RideInput) {
    const editing = sheet?.edit ?? null;
    setBusy('sheet');
    try {
      if (editing) {
        await api.editSharedPool({ poolId: editing.id, label: form.label, departTime: form.departTime });
        setSheet(null);
      } else {
        if (!form.from || !form.to) return;
        const res = await api.createSharedPool({
          city,
          label: form.label,
          departTime: form.departTime,
          rideType: 'mini',
          pickup: form.from,
          dropoff: form.to,
        });
        setSheet(null);
        // Back to every ride in the city, the new one first among the rider's own,
        // with an empty drop-off box — never the new ride's address left in it.
        // All, not the search: there is no GO to press after a ride is made.
        setPools(null);
        setTo(null);
        setWent(null);
        setModeState('all');
        setRouteKey((k) => k + 1);
        announce(res);
      }
      loadPools();
    } catch (e) {
      Alert.alert(editing ? 'Could not save' : 'Could not start it', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function leave(p: SharedPool) {
    Alert.alert('Leave this shared ride?', 'It is free — no driver has accepted yet.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          api.leaveSharedPool({ poolId: p.id }).then(closeAndReload).catch((e) => Alert.alert('Could not leave', errorText(e)));
        },
      },
    ]);
  }

  /** Leave a car that is already out, from its box — no ride screen needed. */
  function leaveCar(tripId: string, fee: number) {
    Alert.alert(
      fee > 0 ? `Leave this shared ride? It costs PKR ${fee}` : 'Leave this shared ride?',
      fee > 0
        ? 'A driver has accepted this car, so leaving costs a share of your fare. Everyone else keeps their ride.'
        : 'It is free. Everyone else keeps their ride.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: fee > 0 ? `Leave & pay PKR ${fee}` : 'Leave',
          style: 'destructive',
          onPress: () => {
            api.leaveSharedRide({ tripId }).then(closeAndReload).catch((e) => Alert.alert('Could not leave', errorText(e)));
          },
        },
      ],
    );
  }

  function remove(p: SharedPool) {
    Alert.alert('Delete this shared ride?', 'It goes from your list, and stays open for everyone else going this way.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          api.editSharedPool({ poolId: p.id, remove: true }).then(closeAndReload).catch((e) => Alert.alert('Could not delete', errorText(e)));
        },
      },
    ]);
  }

  function closeAndReload() {
    setOpened(null);
    loadPools();
  }

  function edit(p: SharedPool) {
    setOpened(null);
    // iOS will not present a sheet while the last one is still sliding away.
    setTimeout(() => setSheet({ edit: p }), 350);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          {/* SVG, not the ← glyph: TECNO's font draws that as "IJ". */}
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <ArrowIcon size={22} color={colors.text} />
          </View>
        </Pressable>
        {/* The owner's top row (2026-10-30): the heading, the city in the middle, then +. */}
        <Text style={styles.title} numberOfLines={1}>Ride sharing</Text>
        <View style={styles.headerMid}>
          <Pressable
            style={({ pressed }) => [styles.cityPill, pressed && { opacity: 0.85 }]}
            onPress={() => setCityOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`City: ${cityName}. Change city`}
          >
            <Text style={styles.cityTxt} numberOfLines={1}>{cityName}</Text>
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <ArrowIcon size={12} color={colors.muted} />
            </View>
          </Pressable>
        </View>
        <Pressable
          style={({ pressed }) => [styles.plusBtn, pressed && { opacity: 0.85 }]}
          onPress={() => setSheet({ edit: null })}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Create a shared ride"
        >
          <PlusIcon size={20} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {active ? (
          <Pressable style={({ pressed }) => [styles.activeCard, pressed && { opacity: 0.9 }]} onPress={() => openRide(active.id)}>
            <View style={styles.activeDot} />
            <Text style={styles.activeTxt} numberOfLines={1}>
              {active.confirmPending
                ? 'Ride starting — confirm your seat'
                : `${ACTIVE_LABEL[active.status] ?? 'You are on a ride'} — open it`}
            </Text>
            <ArrowIcon size={18} color="#0b1a00" />
          </Pressable>
        ) : null}

        {/* The search box: drop-off, then pickup (the phone's location until typed).
            My Routes has its own, below the row. */}
        {mode === 'mine' ? null : (
          <RouteFields
            key={routeKey}
            cityName={cityName}
            to={to}
            from={from}
            onTo={(p) => {
              // A new search shows its own boxes, never the last one's under its heading.
              if (p !== to) {
                setPools(null);
                setWent(null);
              }
              setTo(p);
            }}
            onFrom={(p) => {
              if (p !== from) {
                setPools(null);
                setWent(null);
              }
              setFromEdited(true);
              setFrom(p);
            }}
          />
        )}
        {/* GO (owner, 2026-11-11): dead until both places are in, and the only
            thing that puts boxes on the screen. */}
        {mode === 'mine' ? null : (
          <GoButton
            ready={!!(from && to)}
            onPress={() => {
              if (!from || !to) return;
              Keyboard.dismiss();
              setPools(null);
              if (all) setModeState('pickup');
              setWent({ from, to });
            }}
          />
        )}

        {/* 3. The owner's row (2026-11-05), My Routes on the left; then the boxes:
            leaving from the pickup, with a drop-off the rider's exact route first,
            then the nearest; All, every ride in the city; Favourites, theirs. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modeRow}
          keyboardShouldPersistTaps="handled"
        >
          {MODES.map(([m, label]) =>
            // My Routes is the one the owner wants seen: the Vexa log-in button,
            // on a phone (2026-11-11).
            m === 'mine' ? (
              <MagicChip key={m} label={label} on={mode === m} flow={flow} onPress={() => setMode(m)} />
            ) : (
              <Pressable
                key={m}
                style={({ pressed }) => [styles.allChip, mode === m && styles.allChipOn, pressed && { opacity: 0.85 }]}
                onPress={() => setMode(m)}
                hitSlop={6}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.allChipTxt, mode === m && styles.allChipTxtOn]}>{label}</Text>
              </Pressable>
            ),
          )}
        </ScrollView>
        {mode === 'mine' ? (
          // Mounted once the saved route has landed, so its selectors start from it.
          routes === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <MyRoutePanel
              cityName={cityName}
              go={myRoute}
              back={myRouteBack}
              homeward={homeward}
              onSave={saveMyRoute}
              onGo={(route) => {
                Keyboard.dismiss();
                setPools(null);
                setWent(route);
              }}
              onLeg={(home) => {
                if (home !== homeward) {
                  setPools(null);
                  // The rides already up are for the other way: swap their ends over.
                  if (went) setWent({ from: went.to, to: went.from });
                }
                setLegPick(home ? 'back' : 'go');
              }}
            />
          )
        ) : null}
        {!listing ? (
          <Text style={styles.hint}>
            {mode === 'mine'
              ? 'Save your route, then press GO — the shared rides on it show here.'
              : `Add your pickup and drop-off, then press GO — or tap All for every ride in ${cityName}.`}
          </Text>
        ) : shown === null || listed === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : mode === 'favs' && listed.length === 0 ? (
          <Text style={styles.hint}>Tap the heart on a ride — or double-tap the ride — and it waits for you here.</Text>
        ) : (
          <>
            {/* Nothing at all — a search always has the rider's own route as its first box. */}
            {listed.length === 0 ? (
              <CreatePrompt
                title={`No shared rides in ${cityName} yet`}
                body="Create the first one — everyone going your way can join it."
                onCreate={() => setSheet({ edit: null })}
              />
            ) : null}
            {shown.length > 0 ? (
              <View style={styles.grid}>
                {shown.map((p, i) => (
                  <PoolBox
                    key={p.id}
                    pool={p}
                    index={i}
                    beat={carBeat}
                    flow={flow}
                    fav={isFav(p)}
                    onPress={() => {
                      // Woken while the rider reads the dialog, so Join meets a warm instance.
                      api.warmShared(p.ready ? 'createSharedPool' : 'joinSharedPool').catch(() => {});
                      setOpened(p);
                    }}
                    onFav={() => toggleFav(p)}
                  />
                ))}
              </View>
            ) : null}
            {listed.length > shown.length ? (
              <Pressable
                style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.8 }]}
                onPress={() => setLimit((l) => l + PAGE)}
                accessibilityRole="button"
              >
                <Text style={styles.moreTxt}>Show more</Text>
                <Text style={styles.moreSub}>{(listed.length - shown.length).toLocaleString()} more routes</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>

      <CityPicker
        open={cityOpen}
        selected={city}
        onClose={() => setCityOpen(false)}
        onPick={(id) => {
          setCity(id);
          setCityOpen(false);
        }}
      />
      <RideDialog
        beat={carBeat}
        flow={flow}
        pool={opened && priced(opened)}
        uid={user?.uid}
        rates={cancellation}
        busy={opened !== null && busy === opened.id}
        onClose={() => setOpened(null)}
        onJoin={(p) => void join(p)}
        onLeave={leave}
        onLeaveCar={leaveCar}
        onOpenRide={openRide}
        onEdit={edit}
        onRemove={remove}
      />
      <RideSheet
        open={sheet !== null}
        edit={sheet?.edit ?? null}
        cityName={cityName}
        from={qFrom ?? from}
        to={qTo ?? to}
        busy={busy === 'sheet'}
        onClose={() => setSheet(null)}
        onSubmit={(form) => void submit(form)}
      />
    </SafeAreaView>
  );
}

/** What each rider pays at 1, 2, 3 and 4 aboard — the rung they would be on lit. */
function FareLadder({ ladder, at }: { ladder: number[]; at: number }) {
  return (
    <View style={styles.ladder}>
      {ladder.map((f, i) => (
        <View key={i} style={[styles.rung, i + 1 === at && styles.rungOn]}>
          <Text style={[styles.rungFare, i + 1 === at && styles.rungFareOn]}>PKR {f}</Text>
          <Text style={styles.rungWho}>{i === 0 ? 'alone' : `each of ${i + 1}`}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One named thing about a ride (owner, 2026-11-11: "pick up: drop off: fare:
 * passengers:"), label on the left so the four line up down the card.
 */
function Fact({
  label,
  value,
  danger,
  children,
}: {
  label: string;
  value: string;
  danger?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, danger && { color: colors.danger }]} numberOfLines={1}>{value}</Text>
      {children}
    </View>
  );
}

/** "2 seats available" — the owner's words, never "2 of 4". */
const seatsText = (p: SharedPool) =>
  p.state === 'full'
    ? 'Full'
    : p.seatsLeft === 0
      ? 'No seats available'
      : `${p.seatsLeft} ${p.seatsLeft === 1 ? 'seat' : 'seats'} available`;

/** Who is in it and what is left — the "Passengers:" line. */
const ridersText = (p: SharedPool) =>
  p.state === 'full' || p.seatsLeft === 0
    ? `${p.riders} aboard · full`
    : p.riders === 0
      ? `None yet · ${seatsText(p)}`
      : `${p.riders} aboard · ${seatsText(p)}`;

/** Seats to be had: the owner's blinking green light and "Available" (2026-10-30). */
const isAvailable = (p: SharedPool) => p.state !== 'full' && p.seatsLeft > 0;

/** Who is sitting in it, top right (owner, 2026-10-30) — a shared ride is one gender. */
function GenderBadge({ gender }: { gender: 'male' | 'female' }) {
  const female = gender === 'female';
  return (
    <View
      style={[styles.genderBadge, { backgroundColor: female ? WOMEN : MEN }]}
      accessible
      accessibilityLabel={female ? 'Women in this car' : 'Men in this car'}
    >
      <Text style={styles.genderBadgeTxt}>{female ? '♀' : '♂'}</Text>
    </View>
  );
}

/** The box's status, top left: a blinking green light and "Available", or "Full". */
function StatusTag({ open }: { open: boolean }) {
  return (
    <View style={styles.status} pointerEvents="none">
      {open ? <LiveDot /> : <View style={styles.statusFullDot} />}
      <Text style={[styles.statusTxt, open ? styles.statusOpen : styles.statusFull]}>{open ? 'Available' : 'Full'}</Text>
    </View>
  );
}

/** Map-dark tones a route's drawing sits on, picked by the route so neighbouring boxes differ. */
const ART_TONES: [string, string][] = [
  ['#0c2a22', '#18473a'],
  ['#141c3a', '#25335f'],
  ['#1f2410', '#343e18'],
  ['#2a1430', '#45224f'],
  ['#102430', '#1d3d50'],
  ['#2d1c0e', '#4a321c'],
];

/** A route's number (FNV-1a): the same route always draws the same way. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

type XY = { x: number; y: number };

/** The route as a curve in a 160×100 box: pickup low left, drop-off high right, bent its own way. */
function artCurve(n: number) {
  const p0 = { x: 20 + (n % 3) * 4, y: 64 - ((n >> 2) % 3) * 5 };
  const p3 = { x: 138 - ((n >> 4) % 3) * 4, y: 30 + ((n >> 6) % 3) * 5 };
  const c1 = { x: 60, y: p0.y - 26 - ((n >> 8) % 4) * 6 };
  const c2 = { x: 100, y: p3.y + 26 + ((n >> 10) % 4) * 6 };
  return bezier(p0, c1, c2, p3);
}

/** A route on its map: from where the map put its pickup to its drop-off, bowed a little its own way. */
function mapCurve(n: number, p0: XY, p3: XY) {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const bow = n & 1 ? 0.2 : -0.2;
  return bezier(
    p0,
    { x: p0.x + dx / 3 - dy * bow, y: p0.y + dy / 3 + dx * bow },
    { x: p0.x + (2 * dx) / 3 - dy * bow, y: p0.y + (2 * dy) / 3 + dx * bow },
    p3,
  );
}

function bezier(p0: XY, c1: XY, c2: XY, p3: XY) {
  const at = (t: number) => {
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
    return {
      x: k[0] * p0.x + k[1] * c1.x + k[2] * c2.x + k[3] * p3.x,
      y: k[0] * p0.y + k[1] * c1.y + k[2] * c2.y + k[3] * p3.y,
    };
  };
  return { p0, p3, d: `M${p0.x} ${p0.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`, at };
}

const RUNNER_STEPS = Array.from({ length: 13 }, (_, i) => i / 12);

/** The little car's size on screen, px; it is drawn facing right. */
const CAR_W = 22;
const CAR_H = 12;

/** A car from above, in the app's lime — headlights ahead, tail-lights behind. */
function TopCar() {
  return (
    <Svg width={CAR_W} height={CAR_H} viewBox="0 0 22 12">
      <Rect x={4} y={0.2} width={4.2} height={2.2} rx={1} fill="#0b0b0b" />
      <Rect x={14} y={0.2} width={4.2} height={2.2} rx={1} fill="#0b0b0b" />
      <Rect x={4} y={9.6} width={4.2} height={2.2} rx={1} fill="#0b0b0b" />
      <Rect x={14} y={9.6} width={4.2} height={2.2} rx={1} fill="#0b0b0b" />
      <Rect x={1} y={1.5} width={20} height={9} rx={3.6} fill={colors.primary} stroke="#0b1a00" strokeWidth={0.7} />
      <Rect x={6.5} y={3} width={9} height={6} rx={2} fill="#0b1a00" fillOpacity={0.85} />
      <Rect x={13.2} y={3.6} width={1.8} height={4.8} rx={0.9} fill="#ffffff" fillOpacity={0.45} />
      <Rect x={19.6} y={2.6} width={1.3} height={1.8} rx={0.6} fill="#fffbe0" />
      <Rect x={19.6} y={7.6} width={1.3} height={1.8} rx={0.6} fill="#fffbe0" />
      <Rect x={1.1} y={2.6} width={1.1} height={1.8} rx={0.5} fill="#ff4d4d" />
      <Rect x={1.1} y={7.6} width={1.1} height={1.8} rx={0.5} fill="#ff4d4d" />
    </Svg>
  );
}

/** A route's two ends — what its map is drawn around. */
type RouteEnds = { pickup: Place; dropoff: Place };
/** A route's map, drawn once: the photo, and where its ends fall on it in the 160×100 box. */
type MapShot = { uri: string; a: XY; b: XY };

/** This session's route maps, by route and width; null: that one could not be drawn. */
const mapShots = new Map<string, MapShot | null>();
/** Live maps drawing at once: each is a whole map view, and a grid holds twenty boxes. */
const MAP_SLOTS = 2;
let mapSlotsUsed = 0;
const mapWaiting: (() => void)[] = [];
/** How long a map may take to draw before its box keeps the drawn route instead. */
const MAP_DRAW_MS = 12_000;

/** Hands a held slot to the next box waiting, or frees it. */
function letGoMapSlot(held: { current: boolean }) {
  if (!held.current) return;
  held.current = false;
  const next = mapWaiting.shift();
  if (next) next();
  else mapSlotsUsed--;
}

/**
 * A box's real map (owner, 2026-11-05: actual maps, "so the picture shows a
 * person going from I-8 Markaz to F-7/3"): a live map is drawn — two at a
 * time, however many boxes there are — photographed and kept, so a screenful
 * of boxes is a screenful of pictures rather than of map views. `turn`: this
 * box's map is drawing now.
 */
function useMapShot(key: string | null) {
  const [turn, setTurn] = useState(false);
  const [, repaint] = useState(0);
  const held = useRef(false);
  useEffect(() => {
    if (!key || mapShots.has(key)) return;
    const go = () => {
      held.current = true;
      setTurn(true);
    };
    if (mapSlotsUsed < MAP_SLOTS) {
      mapSlotsUsed++;
      go();
    } else mapWaiting.push(go);
    return () => {
      const i = mapWaiting.indexOf(go);
      if (i >= 0) mapWaiting.splice(i, 1);
      letGoMapSlot(held);
      setTurn(false);
    };
  }, [key]);
  const done = (shot: MapShot | null) => {
    if (key) mapShots.set(key, shot);
    letGoMapSlot(held);
    setTurn(false);
    repaint((r) => r + 1);
  };
  return { shot: key ? mapShots.get(key) : undefined, turn, done };
}

/** A map region holding both ends with room round them — set a little low, clear of the fare. */
function regionOf({ pickup: a, dropoff: b }: RouteEnds) {
  const dLat = Math.max(Math.abs(a.lat - b.lat), 0.004);
  const dLng = Math.max(Math.abs(a.lng - b.lng), 0.004);
  return {
    latitude: (a.lat + b.lat) / 2 - dLat * 0.1,
    longitude: (a.lng + b.lng) / 2,
    latitudeDelta: dLat * 2.2,
    longitudeDelta: dLng * 2.2,
  };
}

/**
 * The live map behind a box while its photo is taken: drawn under the box's
 * picture, never touched. Where the two ends landed, then the photo.
 */
function MapSnapper({ route, onDone }: { route: RouteEnds; onDone: (shot: MapShot | null) => void }) {
  const map = useRef<MapView>(null);
  const size = useRef({ w: 0, h: 0 });
  const settled = useRef(false);
  const settle = (shot: MapShot | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(shot);
  };
  useEffect(() => {
    const t = setTimeout(() => settle(null), MAP_DRAW_MS);
    return () => clearTimeout(t);
    // Once per map: `settle` only reads refs and the onDone it mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function drawn() {
    // A beat for the camera to finish settling, so the ends and the photo agree.
    await new Promise((r) => setTimeout(r, 300));
    const m = map.current;
    const { w, h } = size.current;
    if (!m || !w || !h) return settle(null);
    try {
      const at = (p: Place) => m.pointForCoordinate({ latitude: p.lat, longitude: p.lng });
      const [a, b] = await Promise.all([at(route.pickup), at(route.dropoff)]);
      // An end off the picture means the camera never got there: keep the drawing.
      if ([a, b].some((p) => p.x < 0 || p.y < 0 || p.x > w || p.y > h)) return settle(null);
      const uri = await m.takeSnapshot({ format: 'jpg', quality: 0.85, result: 'file' });
      settle({ uri, a: { x: (a.x / w) * 160, y: (a.y / h) * 100 }, b: { x: (b.x / w) * 160, y: (b.y / h) * 100 } });
    } catch {
      settle(null);
    }
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
    >
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        {...mapBaseProps}
        initialRegion={regionOf(route)}
        // Google photographs what it has drawn, so it waits for the tiles; Apple
        // Maps' snapshot fetches its own (and never sends onMapLoaded).
        {...(mapBaseProps.provider ? { onMapLoaded: () => void drawn() } : { onMapReady: () => void drawn() })}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
      />
    </View>
  );
}

/** A place's name over its end of a mapped route, kept inside the picture. */
function PlaceTag({ at, kx, ky, width, name }: { at: XY; kx: number; ky: number; width: number; name: string }) {
  const w = 76;
  return (
    <View
      pointerEvents="none"
      style={[styles.placeTag, { width: w, left: Math.min(Math.max(at.x * kx - w / 2, 2), width - w - 2), top: Math.max(at.y * ky - 21, 2) }]}
    >
      <Text style={styles.placeTagTxt} numberOfLines={1}>{name}</Text>
    </View>
  );
}

/**
 * A ride with no car photo yet (owner, 2026-11-02: the same BMW on every box
 * "looks strange"): its route on a real map (2026-11-05) — both ends named, the
 * road from pickup to drop-off, and a little car driving it on `phase`. Until
 * the map is drawn (or with no map on this phone), the route drawn as a little
 * map instead; every route bends and colours its own way.
 */
function RouteArt({
  seed,
  phase,
  route,
  aspect = 1.6,
}: {
  seed: string;
  phase?: Animated.Value | Animated.AnimatedInterpolation<number>;
  route?: RouteEnds;
  /** The frame's width ÷ height. The drawing is a 160×100 box stretched to fill it. */
  aspect?: number;
}) {
  const n = seedOf(seed);
  const [dark, light] = ART_TONES[n % ART_TONES.length]!;
  const [width, setWidth] = useState(0);
  const { shot, turn, done } = useMapShot(
    route && MAPS_AVAILABLE && width > 0 ? `${fareKey(route)}@${Math.round(width)}` : null,
  );
  const curve = useMemo(() => (shot ? mapCurve(n, shot.a, shot.b) : artCurve(n)), [n, shot]);
  // Viewbox units to pixels. Separately for each axis: a wide frame is not
  // 160×100 scaled, it is 160×100 stretched, and the car must follow the road.
  const kx = width / 160;
  const ky = width / (aspect * 100);
  const pts = RUNNER_STEPS.map(curve.at);
  // Which way the road points at each step, so the car turns with it — never
  // the long way round where a westward route crosses ±180°.
  let last = 0;
  const turns = RUNNER_STEPS.map((t, i) => {
    const a = curve.at(Math.max(0, t - 0.02));
    const b = curve.at(Math.min(1, t + 0.02));
    let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    if (i > 0) deg += Math.round((last - deg) / 360) * 360;
    last = deg;
    return `${deg}deg`;
  });
  const id = `a${n}`;
  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {turn && route ? <MapSnapper route={route} onDone={done} /> : null}
      {shot ? (
        <Image source={{ uri: shot.uri }} resizeMode="cover" accessible={false} style={StyleSheet.absoluteFill} />
      ) : null}
      <Svg width="100%" height="100%" viewBox="0 0 160 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={`${id}bg`} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={dark} />
            <Stop offset="1" stopColor={light} />
          </LinearGradient>
          <RadialGradient id={`${id}glow`} cx={curve.p3.x} cy={curve.p3.y} r="34" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.primary} stopOpacity="0.38" />
            <Stop offset="1" stopColor={colors.primary} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {shot ? null : (
          <>
            <Rect x="0" y="0" width="160" height="100" fill={`url(#${id}bg)`} />
            {/* The streets: two main roads and a few lanes. */}
            <Line x1="0" y1={18 + (n % 17)} x2="160" y2={34 + ((n >> 3) % 17)} stroke="#ffffff" strokeOpacity={0.07} strokeWidth={7} />
            <Line x1={38 + (n % 41)} y1="0" x2={64 + ((n >> 5) % 41)} y2="100" stroke="#ffffff" strokeOpacity={0.07} strokeWidth={6} />
            <Line x1="0" y1={74 + (n % 13)} x2="160" y2={66 + ((n >> 7) % 13)} stroke="#ffffff" strokeOpacity={0.05} strokeWidth={1.2} />
            <Line x1={112 + (n % 29)} y1="0" x2={98 + ((n >> 9) % 29)} y2="100" stroke="#ffffff" strokeOpacity={0.05} strokeWidth={1.2} />
            <Line x1="0" y1={50 + (n % 9)} x2="160" y2={48 + ((n >> 11) % 9)} stroke="#ffffff" strokeOpacity={0.04} strokeWidth={1} />
          </>
        )}
        <Rect x="0" y="0" width="160" height="100" fill={`url(#${id}glow)`} />
        {/* The road: a soft glow under a dashed lime line. */}
        <Path d={curve.d} stroke={colors.primary} strokeOpacity={0.22} strokeWidth={7} strokeLinecap="round" fill="none" />
        <Path d={curve.d} stroke={colors.primary} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="round" fill="none" />
        <Circle cx={curve.p0.x} cy={curve.p0.y} r={5} fill={dark} stroke="#ffffff" strokeWidth={2.2} />
        <Circle cx={curve.p0.x} cy={curve.p0.y} r={1.8} fill="#ffffff" />
        <Circle cx={curve.p3.x} cy={curve.p3.y} r={10} fill={colors.primary} fillOpacity={0.25} />
        <Circle cx={curve.p3.x} cy={curve.p3.y} r={5.5} fill={colors.primary} />
        <Circle cx={curve.p3.x} cy={curve.p3.y} r={2} fill="#0b1a00" />
      </Svg>
      {shot && route ? (
        <>
          <PlaceTag at={shot.a} kx={kx} ky={ky} width={width} name={placeName(route.pickup)} />
          <PlaceTag at={shot.b} kx={kx} ky={ky} width={width} name={placeName(route.dropoff)} />
        </>
      ) : null}
      {phase && width > 0 ? (
        // The owner (2026-11-02): "some car related animation" — a car drives the route.
        <Animated.View
          pointerEvents="none"
          style={[
            styles.artCar,
            {
              opacity: phase.interpolate({ inputRange: [0, 0.06, 0.9, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: phase.interpolate({ inputRange: RUNNER_STEPS, outputRange: pts.map((p) => p.x * kx - CAR_W / 2) }) },
                { translateY: phase.interpolate({ inputRange: RUNNER_STEPS, outputRange: pts.map((p) => p.y * ky - CAR_H / 2) }) },
                { rotate: phase.interpolate({ inputRange: RUNNER_STEPS, outputRange: turns }) },
              ],
            },
          ]}
        >
          <TopCar />
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * A ride's cars (owner, 2026-10-30): the accepted driver's own, else the nearby
 * cars that could come, turning over on each `beat` — or, with none, its
 * `route` on a map (`seed`, `phase`). It drives in with `arrive`.
 */
function RideCars({
  photos,
  beat,
  arrive,
  seed,
  route,
  phase,
  wide,
  children,
}: {
  photos: string[];
  beat: number;
  arrive?: Animated.Value;
  /** The ride's id: what its route drawing is built from. */
  seed: string;
  route?: RouteEnds;
  phase?: Animated.Value | Animated.AnimatedInterpolation<number>;
  /** On a full-width card: wide and shallow instead of the dialog's 1.6. */
  wide?: boolean;
  /** Drawn over the photo, inside its rounded frame. */
  children?: React.ReactNode;
}) {
  const [still] = useState(() => new Animated.Value(1));
  const [fade] = useState(() => new Animated.Value(1));
  const [shown, setShown] = useState(0);
  // The beat it mounted on: the first car stays up for a full beat.
  const [firstBeat] = useState(beat);
  const count = photos.length;
  useEffect(() => {
    if (count < 2 || beat === firstBeat) return;
    const out = Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true });
    out.start(() => {
      setShown((i) => (i + 1) % count);
      Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
    });
    return () => out.stop();
  }, [beat, firstBeat, count, fade]);

  const shownIn = arrive ?? still;
  return (
    <Animated.View
      style={{
        alignSelf: 'stretch',
        opacity: shownIn,
        transform: [{ translateX: shownIn.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) }],
      }}
    >
      {/* A frame the photo fills: a bundled image would otherwise take its own pixel height. */}
      <View style={[styles.carFrame, wide && styles.carFrameWide]}>
        {count > 0 ? (
          <Animated.Image
            source={{ uri: photos[shown % count] }}
            resizeMode="cover"
            accessible={false}
            style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: fade }]}
          />
        ) : (
          <RouteArt seed={seed} phase={phase} route={route} aspect={wide ? BOX_PIC_ASPECT : 1.6} />
        )}
        {children}
      </View>
      {count > 1 ? (
        <View style={styles.carDots}>
          {photos.map((url, i) => <View key={url} style={[styles.carDot, i === shown % count && styles.carDotOn]} />)}
        </View>
      ) : null}
    </Animated.View>
  );
}

/** A seat for each place in the car: lime when taken, an outline when free. */
function SeatIcons({ taken, total }: { taken: number; total: number }) {
  return (
    <View style={styles.seatIcons}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.seatIcon, i < taken && styles.seatIconTaken]} />
      ))}
    </View>
  );
}

/**
 * One shared ride as a small box, half the screen wide, in the owner's order:
 * the car, then from → to, the fare and the seats still free. Each box rises
 * in after the one before it with its car driving in, and dips when pressed.
 *
 * Alive while it has seats (2026-11-02, "more creative, animated"): a shine
 * sweeps the picture, the border glows, and a little car drives the route —
 * all off the screen's one `flow` clock, each box a beat after the last, so
 * the grid moves in a wave. The fare rides on the photo.
 *
 * A heart on the picture — or a double tap anywhere on it — makes it a
 * favourite (owner, 2026-11-05), so a single tap waits a moment before it opens.
 */
function PoolBox({
  pool: p,
  index,
  beat,
  flow,
  fav,
  onPress,
  onFav,
}: {
  pool: SharedPool;
  index: number;
  beat: number;
  flow: Animated.Value;
  fav: boolean;
  onPress: () => void;
  onFav: () => void;
}) {
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (opening.current) clearTimeout(opening.current);
  }, []);
  function tap() {
    if (opening.current) {
      clearTimeout(opening.current);
      opening.current = null;
      onFav();
      return;
    }
    opening.current = setTimeout(() => {
      opening.current = null;
      onPress();
    }, DOUBLE_TAP_MS);
  }
  const yours = p.mine || p.booked || p.aboardTripId !== null;
  const open = isAvailable(p);
  const from = placeName(p.pickup);
  const to = placeName(p.dropoff);
  const [arrive] = useState(() => new Animated.Value(0));
  const [press] = useState(() => new Animated.Value(1));
  const phase = useMemo(() => Animated.modulo(Animated.add(flow, (index % 6) / 6), 1), [flow, index]);
  useEffect(() => {
    Animated.spring(arrive, { toValue: 1, delay: Math.min(index, 8) * 70, friction: 8, tension: 50, useNativeDriver: true }).start();
  }, [arrive, index]);
  const pressTo = (toValue: number) =>
    Animated.spring(press, { toValue, friction: 5, tension: 260, useNativeDriver: true }).start();
  return (
    <Animated.View
      style={[
        styles.boxWrap,
        {
          opacity: arrive,
          transform: [{ translateY: arrive.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { scale: press }],
        },
      ]}
    >
      <Pressable
        style={[styles.box, yours && styles.boxYours]}
        onPress={tap}
        onPressIn={() => pressTo(0.95)}
        onPressOut={() => pressTo(1)}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Available. ' : ''}${fav ? 'Favourite. ' : ''}From ${from} to ${to}. ${fareText(p)}. ${seatsText(p)}`}
      >
        {open && !yours ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.glow, { opacity: phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.12, 0.75, 0.12] }) }]}
          />
        ) : null}
        <StatusTag open={open} />
        {p.riderGender ? <GenderBadge gender={p.riderGender} /> : null}
        <View style={styles.boxCar}>
          <RideCars wide photos={p.carPhotos ?? []} beat={beat} arrive={arrive} seed={p.id} route={p} phase={open ? phase : undefined}>
            {open ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.sheen,
                  !p.carPhotos?.length && styles.sheenOnArt,
                  { transform: [{ translateX: phase.interpolate({ inputRange: [0, 0.45, 1], outputRange: [-90, 230, 230] }) }, { rotate: '18deg' }] },
                ]}
              />
            ) : null}
            <View style={styles.farePill} pointerEvents="none">
              <Text style={styles.farePillTxt}>{fareText(p)}</Text>
              <Text style={styles.farePillPer}>/seat</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.favBtn, pressed && { opacity: 0.7 }]}
              onPress={onFav}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: fav }}
              accessibilityLabel={fav ? 'Remove from favourites' : 'Add to favourites'}
            >
              <HeartIcon filled={fav} />
            </Pressable>
          </RideCars>
        </View>
        {/* Named, in the owner's order (2026-11-11), so nobody has to guess what
            they are joining: pick up, drop off, fare, passengers. */}
        <Fact label="Pick up:" value={from} />
        <Fact label="Drop off:" value={to} />
        <Fact label="Fare:" value={`${fareText(p)} per seat`} />
        <Fact label="Passengers:" value={ridersText(p)} danger={!open}>
          <SeatIcons taken={p.state === 'full' ? p.seatsTotal : p.riders} total={p.seatsTotal} />
        </Fact>
        {/* Two rides on one route differ by their time. */}
        <View style={styles.boxTimeRow}>
          <ClockIcon />
          <Text style={styles.boxTime} numberOfLines={1}>{p.departTime ? `${clockLabel(p.departTime)} daily` : 'Leaves now'}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Where each star sits on the chip, and where in the clock it twinkles. */
const MAGIC_STARS: { at: number; top?: number; bottom?: number; left?: number; right?: number }[] = [
  { at: 0, top: -4, left: 10 },
  { at: 0.34, top: -2, right: 16 },
  { at: 0.58, bottom: -3, left: 34 },
  { at: 0.8, bottom: -2, right: 8 },
];

/**
 * My Routes, the way the owner asked for it (2026-11-11): the Vexa log-in
 * button from the website, on a phone — "shiny and BOLD". Lime, a shine
 * sweeping across it, four stars twinkling at its corners and a sparkle in
 * front of the words. It rides the screen's one `flow` clock, so it costs the
 * same as the boxes' own animation: nothing extra.
 *
 * The website's turning ring of light is a conic gradient, which React Native
 * has no equivalent of; the lime glow breathing round the edge stands in.
 */
function MagicChip({
  label,
  on,
  flow,
  onPress,
}: {
  label: string;
  on: boolean;
  flow: Animated.Value;
  onPress: () => void;
}) {
  const shine = flow.interpolate({ inputRange: [0, 0.45, 1], outputRange: [-70, 190, 190] });
  const star = (at: number) =>
    Animated.modulo(Animated.add(flow, at), 1).interpolate({
      inputRange: [0, 0.2, 0.4, 1],
      outputRange: [0, 1, 0, 0],
    });
  return (
    <Pressable
      style={({ pressed }) => [styles.magicChip, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.magicGlow, { opacity: flow.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.2, 0.9, 0.2] }) }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.magicShine, { transform: [{ translateX: shine }, { rotate: '18deg' }] }]}
      />
      {MAGIC_STARS.map(({ at, ...where }, i) => (
        <Animated.View key={i} pointerEvents="none" style={[styles.magicStar, where, { opacity: star(at) }]}>
          <SparkleIcon size={8} color="#ffffff" />
        </Animated.View>
      ))}
      <SparkleIcon size={13} color="#0b1a00" />
      <Text style={styles.magicChipTxt}>{label}</Text>
    </Pressable>
  );
}

/** A four-pointed sparkle, drawn — the website's Vexa log-in has the same one. */
function SparkleIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z" fill={color} />
    </Svg>
  );
}

/**
 * GO (owner, 2026-11-11). Dead until both places are in, and the only thing
 * that puts rides on the screen — nothing is searched while somebody types.
 */
function GoButton({ ready, onPress }: { ready: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.searchGo, !ready && styles.searchGoOff, pressed && ready && { opacity: 0.88 }]}
      onPress={onPress}
      disabled={!ready}
      accessibilityRole="button"
      accessibilityState={{ disabled: !ready }}
      accessibilityLabel={ready ? 'Go — show the shared rides on this route' : 'Go. Add your pickup and drop-off first'}
    >
      <Text style={[styles.searchGoTxt, !ready && styles.searchGoOffTxt]}>GO</Text>
      {ready ? (
        <ArrowIcon size={18} color="#0b1a00" />
      ) : (
        <Text style={styles.searchGoHint}>Add your pickup and drop-off</Text>
      )}
    </Pressable>
  );
}

/** The favourite heart — drawn, so every phone's font agrees on it. */
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24">
      <Path
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
        fill={filled ? HEART : 'none'}
        stroke={filled ? HEART : '#ffffff'}
        strokeWidth={2.2}
      />
    </Svg>
  );
}

/** A small clock beside the box's time — drawn, so every phone's font agrees. */
function ClockIcon() {
  return (
    <Svg width={11} height={11} viewBox="0 0 12 12">
      <Circle cx={6} cy={6} r={5} stroke={colors.muted} strokeWidth={1.4} fill="none" />
      <Path d="M6 3.2V6l1.9 1.2" stroke={colors.muted} strokeWidth={1.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/**
 * No shared ride on the rider's route (owner, 2026-11-02: "if the search finds
 * no ride, tell them to create one"): a card that says so, with + breathing on it.
 */
function CreatePrompt({ title, body, onCreate }: { title: string; body: string; onCreate: () => void }) {
  const [pulse] = useState(() => new Animated.Value(0));
  const [rise] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.spring(rise, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, rise]);
  return (
    <Animated.View
      style={[
        styles.prompt,
        { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
      ]}
    >
      <View style={styles.promptIcon}>
        <Animated.View
          style={[
            styles.promptRing,
            {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
            },
          ]}
        />
        <View style={styles.promptCore}>
          <PlusIcon size={20} />
        </View>
      </View>
      <Text style={styles.promptTitle}>{title}</Text>
      <Text style={styles.promptBody}>{body}</Text>
      <Pressable
        style={({ pressed }) => [styles.joinBtn, styles.emptyBtn, styles.promptBtn, pressed && { opacity: 0.85 }]}
        onPress={onCreate}
        accessibilityRole="button"
      >
        <PlusIcon />
        <Text style={styles.joinTxt}>Create a shared ride</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The owner's green light: a blinking dot with a ring rippling out of it. */
function LiveDot() {
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.live} pointerEvents="none">
      <Animated.View
        style={[
          styles.liveRing,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] }) }],
          },
        ]}
      />
      <Animated.View
        style={[styles.liveCore, { opacity: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.35, 1] }) }]}
      />
    </View>
  );
}

/** The + of "start a shared ride" — drawn, so every phone's font agrees on it. */
function PlusIcon({ size = 18, color = colors.btnText }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Rect x={7.6} y={1} width={2.8} height={16} rx={1.4} fill={color} />
      <Rect x={1} y={7.6} width={16} height={2.8} rx={1.4} fill={color} />
    </Svg>
  );
}

/**
 * Drop-off, then pickup. What the rider types is pinned to a real place from
 * the suggestions; a place set from outside (the phone's location, a ride just
 * started) shows its own name.
 */
function RouteFields({
  cityName,
  to,
  from,
  onTo,
  onFrom,
  pickupFirst,
}: {
  cityName: string;
  to: Place | null;
  from: Place | null;
  onTo: (p: Place | null) => void;
  onFrom: (p: Place | null) => void;
  /** My Routes' order: pickup, then drop-off. */
  pickupFirst?: boolean;
}) {
  const [toText, setToText] = useState(to?.address ?? '');
  const [fromText, setFromText] = useState(from?.address ?? '');
  const [field, setField] = useState<Field | null>(null);
  const tokenRef = useRef(uuidv4());
  useEffect(() => {
    if (to) setToText(to.address);
  }, [to]);
  useEffect(() => {
    if (from) setFromText(from.address);
  }, [from]);

  const { predictions, loading: searching } = usePlacesAutocomplete(
    field === 'to' ? toText : field === 'from' ? fromText : '',
    tokenRef.current,
  );
  // The chosen city's places first. Ordered, never filtered: a suggestion that
  // does not name its city is still a real place.
  const suggestions = useMemo(() => {
    const name = cityName.toLowerCase();
    const inCity = (p: PlacePrediction) => `${p.fullText} ${p.secondaryText ?? ''}`.toLowerCase().includes(name);
    return [...predictions].sort((a, b) => Number(inCity(b)) - Number(inCity(a))).slice(0, 6);
  }, [predictions, cityName]);

  function type(which: Field, text: string) {
    setField(which);
    // Typing un-pins the place: the name and the place must never disagree.
    if (which === 'to') {
      setToText(text);
      onTo(null);
    } else {
      setFromText(text);
      onFrom(null);
    }
  }

  async function choose(pred: PlacePrediction) {
    const which = field;
    if (!which) return;
    setField(null);
    Keyboard.dismiss();
    const label = pred.mainText && pred.secondaryText ? `${pred.mainText}, ${pred.secondaryText}` : pred.fullText;
    if (which === 'to') setToText(label);
    else setFromText(label);
    const detail = await fetchPlaceDetail(pred, tokenRef.current);
    tokenRef.current = uuidv4(); // the detail call closed the billing session
    if (!detail) {
      Alert.alert('Could not find that place', 'Please pick another suggestion.');
      return;
    }
    const place: Place = { lat: detail.lat, lng: detail.lng, address: label };
    if (which === 'to') onTo(place);
    else onFrom(place);
  }

  const toRow = (
    <View style={styles.fieldRow}>
      <DestinationPinIcon size={16} color={colors.text} accent={colors.primary} />
      <TextInput
        style={styles.fieldInput}
        value={toText}
        onChangeText={(t) => type('to', t)}
        placeholder="Enter your drop-off location"
        placeholderTextColor={colors.muted}
        maxLength={200}
      />
      {to ? <View style={styles.pinned} /> : null}
      {toText ? (
        <Pressable
          onPress={() => {
            setToText('');
            onTo(null);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear drop-off"
        >
          <View style={{ transform: [{ rotate: '45deg' }] }}>
            <PlusIcon size={14} color={colors.muted} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
  const fromRow = (
    <View style={styles.fieldRow}>
      <PickupDotIcon size={16} color={colors.text} accent={colors.primary} />
      <TextInput
        style={styles.fieldInput}
        value={fromText}
        onChangeText={(t) => type('from', t)}
        placeholder="Enter your pickup location"
        placeholderTextColor={colors.muted}
        maxLength={200}
      />
      {from ? <View style={styles.pinned} /> : null}
    </View>
  );

  return (
    <>
      <View style={styles.routeBox}>
        {pickupFirst ? fromRow : toRow}
        <View style={styles.fieldDivider} />
        {pickupFirst ? toRow : fromRow}
      </View>

      {field && (searching || suggestions.length > 0) ? (
        <View style={styles.predictions}>
          {searching && suggestions.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 12 }} />
          ) : (
            suggestions.map((pred) => (
              <Pressable
                key={pred.placeId}
                style={({ pressed }) => [styles.predictionRow, pressed && { opacity: 0.7 }]}
                onPress={() => void choose(pred)}
              >
                <Text style={styles.predictionMain} numberOfLines={1}>{pred.mainText}</Text>
                {pred.secondaryText ? (
                  <Text style={styles.predictionSub} numberOfLines={1}>{pred.secondaryText}</Text>
                ) : null}
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}

/**
 * My Routes (owner, 2026-11-05): the rider's own daily trip as real selectors —
 * pickup and drop-off searched like the box at the top, then the two times.
 *
 * The times are generic (owner, 2026-11-11: not everyone goes to an office):
 * the time they go, and the time they come back home. **Save** writes both —
 * and turns on the reminder before each one (backend dailyRoutes/reminders) —
 * and **GO** is what puts rides on the screen, dead until both places are in.
 * Once saved, Go / Back home picks which of the two the rides are for.
 */
function MyRoutePanel({
  cityName,
  go,
  back,
  homeward,
  onSave,
  onGo,
  onLeg,
}: {
  cityName: string;
  go: DailyRoute | null;
  back: DailyRoute | null;
  /** The boxes are for the trip home. */
  homeward: boolean;
  onSave: (pickup: Place, dropoff: Place, start: string, end: string) => void;
  onGo: (route: { from: Place; to: Place }) => void;
  onLeg: (homeward: boolean) => void;
}) {
  const [v, setV] = useState({
    from: go?.pickup ?? null,
    to: go?.dropoff ?? null,
    start: go?.time ?? '09:00',
    end: back?.time ?? '17:00',
  });
  const set = (next: Partial<typeof v>) => setV((prev) => ({ ...prev, ...next }));
  const ready = !!(v.from && v.to);
  return (
    <View style={styles.mineBox}>
      <RouteFields
        cityName={cityName}
        from={v.from}
        to={v.to}
        pickupFirst
        onFrom={(p) => set({ from: p })}
        onTo={(p) => set({ to: p })}
      />
      <Text style={styles.sheetLabel}>YOUR TIMES</Text>
      <View style={styles.choiceRow}>
        <TimeSelect label="Go to time" value={v.start} onChange={(start) => set({ start })} />
        <TimeSelect label="Back to home time" value={v.end} onChange={(end) => set({ end })} />
      </View>
      <Pressable
        style={({ pressed }) => [styles.saveBtn, !ready && styles.saveBtnOff, pressed && ready && { opacity: 0.85 }]}
        onPress={() => v.from && v.to && onSave(v.from, v.to, v.start, v.end)}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
      >
        <Text style={[styles.saveTxt, !ready && styles.searchGoOffTxt]}>
          {ready ? 'Save route & remind me' : 'Add your pickup and drop-off to save'}
        </Text>
      </Pressable>
      <GoButton
        ready={ready}
        onPress={() => {
          if (!v.from || !v.to) return;
          // Whichever way it is going now: home again swaps the two ends over.
          onGo(homeward ? { from: v.to, to: v.from } : { from: v.from, to: v.to });
        }}
      />
      {go ? (
        <View style={styles.modeRow}>
          {[false, true].map((home) => (
            <Pressable
              key={String(home)}
              style={({ pressed }) => [styles.allChip, homeward === home && styles.allChipOn, pressed && { opacity: 0.85 }]}
              onPress={() => onLeg(home)}
              hitSlop={6}
              accessibilityRole="radio"
              accessibilityState={{ selected: homeward === home }}
            >
              <Text style={[styles.allChipTxt, homeward === home && styles.allChipTxtOn]}>
                {home ? `Back home · ${clockLabel(v.end) ?? ''}` : `Go · ${clockLabel(v.start) ?? ''}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One office time, on the phone's own picker: compact on iOS, the clock dialog on Android. */
function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (hhmm: string) => void }) {
  const [open, setOpen] = useState(false);
  const date = fromHHMM(value, new Date());
  function picked(event: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'set' && d) onChange(toHHMM(d));
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.choice, styles.choiceOn, pressed && { opacity: 0.85 }]}
      onPress={() => setOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${clockLabel(value) ?? 'not set'}. Change`}
    >
      <Text style={styles.choiceNote}>{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker value={date} mode="time" display="compact" onChange={picked} />
      ) : (
        <Text style={[styles.choiceTxt, styles.choiceTxtOn]}>{clockLabel(value)}</Text>
      )}
      {open && Platform.OS === 'android' ? <DateTimePicker value={date} mode="time" display="default" onChange={picked} /> : null}
    </Pressable>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      {/* Padding on Android too: the modal is edge-to-edge there, so its window never resizes for the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.sheetRow}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <Text style={styles.sheetValue}>{children}</Text>
    </View>
  );
}

/**
 * A box, tapped — the owner's dialog: the car, then only what decides it —
 * fare, seats, from and to — with Join in green and Cancel see-through. A
 * rider already in it gets Leave right here (and Open my ride once its car is
 * out); its creator also gets Edit and Delete.
 */
function RideDialog({
  pool: p,
  beat,
  flow,
  uid,
  rates,
  busy,
  onClose,
  onJoin,
  onLeave,
  onLeaveCar,
  onOpenRide,
  onEdit,
  onRemove,
}: {
  pool: SharedPool | null;
  /** The screen's car-photo beat. */
  beat: number;
  /** The screen's animation clock, for the drawn route's light. */
  flow: Animated.Value;
  uid: string | undefined;
  rates: { poolLeaveRate: number; poolLeaveArrivedRate: number };
  busy: boolean;
  onClose: () => void;
  onJoin: (p: SharedPool) => void;
  onLeave: (p: SharedPool) => void;
  onLeaveCar: (tripId: string, fee: number) => void;
  onOpenRide: (tripId: string) => void;
  onEdit: (p: SharedPool) => void;
  onRemove: (p: SharedPool) => void;
}) {
  // The car this rider is in: what leaving it costs depends on where it is.
  const { trip } = useTrip(p?.aboardTripId ?? undefined);
  const [pop] = useState(() => new Animated.Value(0));
  const openId = p?.id;
  useEffect(() => {
    if (!openId) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 65, useNativeDriver: true }).start();
  }, [openId, pop]);
  if (!p) return null;

  const inIt = p.booked || p.aboardTripId !== null;
  const canJoin = !inIt && p.state !== 'full' && p.seatsLeft > 0;
  const leaveFee = trip && trip.id === p.aboardTripId ? poolLeaveFee(trip, uid, rates) : null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dialogScreen}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.dialog,
            { opacity: pop, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }] },
          ]}
        >
          <StatusTag open={isAvailable(p)} />
          {p.riderGender ? <GenderBadge gender={p.riderGender} /> : null}
          <View style={styles.boxCar}>
            <RideCars photos={p.carPhotos ?? []} beat={beat} arrive={pop} seed={p.id} route={p} phase={flow} />
            {p.carPhotos?.length ? (
              <Text style={styles.carCaption}>{p.carIsDrivers ? 'The driver’s car' : 'Cars nearby that could come'}</Text>
            ) : null}
          </View>

          <View style={styles.dialogStats}>
            <View style={styles.dialogStat}>
              <Text style={styles.dialogLabel}>FARE</Text>
              <Text style={styles.dialogFare}>{fareText(p)}</Text>
            </View>
            <View style={styles.dialogDivider} />
            <View style={styles.dialogStat}>
              <Text style={styles.dialogLabel}>SEATS</Text>
              <Text style={styles.dialogSeats}>{seatsText(p)}</Text>
            </View>
          </View>

          <View style={styles.dialogPlace}>
            <PickupDotIcon size={14} color={colors.text} accent={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dialogLabel}>FROM</Text>
              <Text style={styles.dialogPlaceTxt} numberOfLines={2}>{p.pickup.address}</Text>
            </View>
          </View>
          <View style={styles.dialogPlace}>
            <DestinationPinIcon size={14} color={colors.text} accent={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dialogLabel}>TO</Text>
              <Text style={styles.dialogPlaceTxt} numberOfLines={2}>{p.dropoff.address}</Text>
            </View>
          </View>

          {p.aboardTripId ? (
            <>
              <Pressable
                style={({ pressed }) => [styles.goBtn, pressed && { opacity: 0.85 }]}
                onPress={() => onOpenRide(p.aboardTripId!)}
                accessibilityRole="button"
              >
                <Text style={styles.goTxt}>Open my ride</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.85 }]}
                onPress={() => leaveFee !== null && onLeaveCar(p.aboardTripId!, leaveFee)}
                disabled={leaveFee === null}
                accessibilityRole="button"
              >
                {leaveFee === null ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <Text style={styles.leaveTxt}>Leave this ride · {leaveFee > 0 ? `PKR ${leaveFee}` : 'free'}</Text>
                )}
              </Pressable>
            </>
          ) : p.booked ? (
            <Pressable
              style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.85 }]}
              onPress={() => onLeave(p)}
              accessibilityRole="button"
            >
              <Text style={styles.leaveTxt}>Leave this ride · free</Text>
            </Pressable>
          ) : canJoin ? (
            <Pressable
              style={({ pressed }) => [styles.goBtn, pressed && { opacity: 0.85 }]}
              onPress={() => onJoin(p)}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.goTxt}>Join</Text>}
            </Pressable>
          ) : null}
          <Pressable
            style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={styles.ghostTxt}>{inIt ? 'Close' : 'Cancel'}</Text>
          </Pressable>
          {p.mine ? (
            <View style={styles.ownerRow}>
              <Pressable onPress={() => onEdit(p)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.ownerTxt}>Edit</Text>
              </Pressable>
              <Pressable onPress={() => onRemove(p)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.ownerTxt}>Delete</Text>
              </Pressable>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

/** The next half hour, as the time a new daily ride starts at. */
function nextHalfHour(): Date {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

type RideBoxProps = {
  edit: SharedPool | null;
  cityName: string;
  from: Place | null;
  to: Place | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: RideInput) => void;
};

/** The + box. Mounted per opening, so every field starts from what the screen holds now. */
function RideSheet({ open, ...props }: RideBoxProps & { open: boolean }) {
  return (
    <Sheet open={open} onClose={props.onClose}>
      {open ? <RideBox {...props} /> : null}
    </Sheet>
  );
}

/**
 * Start a shared ride, in the owner's order: institution and location name,
 * drop-off, pickup, start time — then its fare and the seats still free. With
 * `edit`, its creator renames or retimes it; the route stays, riders booked on it.
 */
function RideBox({ edit, cityName, from: startFrom, to: startTo, busy, onClose, onSubmit }: RideBoxProps) {
  // "Bahria University, E-8" back into its two boxes.
  const [firstName, ...restName] = (edit?.label ?? '').split(', ');
  const [institution, setInstitution] = useState(firstName ?? '');
  const [area, setArea] = useState(restName.join(', '));
  const [to, setTo] = useState(startTo);
  const [from, setFrom] = useState(startFrom);
  const [timed, setTimed] = useState(edit ? !!edit.departTime : true);
  const [time, setTime] = useState(() => fromHHMM(edit?.departTime ?? null, nextHalfHour()));
  const [picking, setPicking] = useState(false);
  const [quote, setQuote] = useState<SharedFareQuote | null>(null);

  useEffect(() => {
    setQuote(null);
    if (edit || !from || !to) return;
    let live = true;
    api
      .getSharedRideFare({ rideType: 'mini', pickup: { lat: from.lat, lng: from.lng }, dropoff: { lat: to.lat, lng: to.lng } })
      .then((q) => live && setQuote(q))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [edit, from, to]);

  function picked(event: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setPicking(false);
    if (event.type === 'set' && d) setTime(d);
  }

  function pickTime() {
    setTimed(true);
    if (Platform.OS === 'android') setPicking(true);
  }

  function submit() {
    const label = [institution.trim(), area.trim()].filter(Boolean).join(', ');
    const missing = !label ? 'the institution or location name' : edit ? null : !to ? 'the drop-off' : !from ? 'the pickup' : null;
    if (missing) {
      Alert.alert('One more thing', `Please add ${missing}.`);
      return;
    }
    onSubmit({ label, departTime: timed ? toHHMM(time) : null, from, to });
  }

  return (
    <>
      <Text style={styles.sheetTitle}>{edit ? 'Edit your shared ride' : 'Create a shared ride'}</Text>

      <View style={styles.nameRow}>
        <View style={{ flex: 3, gap: 6 }}>
          <Text style={styles.sheetLabel}>INSTITUTION NAME</Text>
          <TextInput
            style={styles.sheetInput}
            value={institution}
            onChangeText={setInstitution}
            placeholder="Institution name"
            placeholderTextColor={colors.muted}
            maxLength={40}
          />
        </View>
        <View style={{ flex: 2, gap: 6 }}>
          <Text style={styles.sheetLabel}>LOCATION NAME</Text>
          <TextInput
            style={styles.sheetInput}
            value={area}
            onChangeText={setArea}
            placeholder="Location name"
            placeholderTextColor={colors.muted}
            maxLength={18}
          />
        </View>
      </View>

      {edit ? (
        <>
          <SheetRow label="DROP-OFF">{edit.dropoff.address}</SheetRow>
          <SheetRow label="PICKUP">{edit.pickup.address}</SheetRow>
        </>
      ) : (
        <>
          <Text style={styles.sheetLabel}>DROP-OFF, THEN PICKUP</Text>
          <RouteFields cityName={cityName} to={to} from={from} onTo={setTo} onFrom={setFrom} />
          <Text style={styles.metaTxt}>Everyone going this way sees both — a gate or landmark is better than a front door.</Text>
        </>
      )}

      <Text style={styles.sheetLabel}>START TIME</Text>
      <View style={styles.choiceRow}>
        <Pressable
          style={[styles.choice, timed && styles.choiceOn]}
          onPress={pickTime}
          accessibilityRole="radio"
          accessibilityState={{ selected: timed }}
          accessibilityLabel={`Every day at ${clockLabel(toHHMM(time))}. Change time`}
        >
          <Text style={[styles.choiceTxt, timed && styles.choiceTxtOn]}>{clockLabel(toHHMM(time))}</Text>
          <Text style={styles.choiceNote}>Every day · tap to change</Text>
        </Pressable>
        <Pressable
          style={[styles.choice, !timed && styles.choiceOn]}
          onPress={() => setTimed(false)}
          accessibilityRole="radio"
          accessibilityState={{ selected: !timed }}
        >
          <Text style={[styles.choiceTxt, !timed && styles.choiceTxtOn]}>Now</Text>
          <Text style={styles.choiceNote}>First driver to accept</Text>
        </Pressable>
      </View>
      {timed && Platform.OS === 'ios' ? (
        <DateTimePicker value={time} mode="time" display="spinner" textColor={colors.text} onChange={picked} />
      ) : null}
      {picking ? <DateTimePicker value={time} mode="time" display="default" onChange={picked} /> : null}
      <Text style={styles.metaTxt}>
        {timed
          ? 'Drivers are asked 10 minutes before — or the moment all 4 seats are taken. After each car leaves, the next one opens here.'
          : 'Drivers nearby are asked as soon as you create it.'}
      </Text>

      {edit ? null : (
        <>
          <Text style={styles.sheetLabel}>FARE</Text>
          {quote ? (
            <>
              <Text style={styles.fareBig}>PKR {quote.perSeat[0]}</Text>
              <Text style={styles.fareSub}>your seat now — less for everyone as people join</Text>
              <FareLadder ladder={quote.perSeat} at={1} />
            </>
          ) : to && from ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.metaTxt}>Choose the drop-off and pickup to see the fare.</Text>
          )}

          <Text style={styles.sheetLabel}>AVAILABLE SEATS</Text>
          <RideCars
            photos={[]}
            beat={0}
            seed={`${from?.address ?? ''}>${to?.address ?? ''}`}
            route={from && to ? { pickup: from, dropoff: to } : undefined}
          />
          <Text style={styles.seatsTxt}>3 seats available — one is yours</Text>
        </>
      )}

      <Pressable
        style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
        onPress={submit}
        disabled={busy}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color={colors.btnText} /> : <Text style={styles.joinTxt}>{edit ? 'Save' : 'Create shared ride'}</Text>}
      </Pressable>
      <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center' }}>
        <Text style={styles.cancelTxt}>Cancel</Text>
      </Pressable>
    </>
  );
}

/** Every city we list, searchable — the chosen one ticked. */
function CityPicker({
  open,
  selected,
  onClose,
  onPick,
}: {
  open: boolean;
  selected: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const list = PAKISTAN_CITIES.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose}>
      <Text style={styles.sheetTitle}>Choose your city</Text>
      <TextInput
        style={styles.sheetInput}
        value={q}
        onChangeText={setQ}
        placeholder="Search cities"
        placeholderTextColor={colors.muted}
        maxLength={40}
      />
      {list.map((c) => (
        <Pressable
          key={c.id}
          style={({ pressed }) => [styles.cityRow, pressed && { opacity: 0.7 }]}
          onPress={() => onPick(c.id)}
          accessibilityRole="radio"
          accessibilityState={{ selected: c.id === selected }}
        >
          <Text style={[styles.cityRowTxt, c.id === selected && { color: colors.primary }]}>{c.name}</Text>
          <Text style={styles.cityRowSub}>{c.province}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontWeight: '900', color: colors.text, flexShrink: 0 },
  /** The city, centred between the heading and +. */
  headerMid: { flex: 1, alignItems: 'center', minWidth: 0 },
  plusBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.btnBg,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  activeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 16, padding: 14, backgroundColor: colors.primary,
  },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0b1a00' },
  activeTxt: { flex: 1, fontSize: 14.5, fontWeight: '900', color: '#0b1a00' },

  cityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  cityTxt: { flexShrink: 1, fontSize: 14, fontWeight: '900', color: colors.text },

  routeBox: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  fieldInput: { flex: 1, color: colors.text, fontSize: 14.5, fontWeight: '700', paddingVertical: 13 },
  /** A lime dot once the field holds a real place, not just typed words. */
  pinned: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginLeft: 39 },

  predictions: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  predictionRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  predictionMain: { color: colors.text, fontSize: 14, fontWeight: '800' },
  predictionSub: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2 },

  hint: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19, textAlign: 'center', marginTop: 8 },
  emptyBtn: { flexDirection: 'row', gap: 8 },

  /** The row over the boxes: My Routes, Leaving from your pickup, All, Favourites. */
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /** My Routes' selectors. */
  mineBox: { gap: 10 },
  allChip: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  allChipOn: { backgroundColor: colors.btnBg, borderColor: colors.btnBg },
  allChipTxt: { fontSize: 13, fontWeight: '900', color: colors.text },
  allChipTxtOn: { color: colors.btnText },

  /** My Routes: the website's Vexa log-in, shiny and bold (owner, 2026-11-11). */
  magicChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, overflow: 'hidden',
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 16,
    backgroundColor: colors.primary,
  },
  magicChipTxt: { fontSize: 13.5, fontWeight: '900', letterSpacing: 0.3, color: '#0b1a00' },
  /** The lime breathing round the edge — the website's turning ring, as a phone can draw it. */
  magicGlow: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16,
    borderWidth: 2, borderColor: '#f2ffb0',
  },
  /** The light sweeping across it. */
  magicShine: { position: 'absolute', top: -20, bottom: -20, width: 26, backgroundColor: 'rgba(255,255,255,0.55)' },
  magicStar: { position: 'absolute' },

  /** GO: nothing is searched until it is pressed, and it is dead until it can be. */
  searchGo: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 13, backgroundColor: colors.primary,
  },
  searchGoOff: { backgroundColor: colors.glassLime, borderWidth: 1, borderColor: colors.glassLimeBorder },
  searchGoTxt: { fontSize: 16, fontWeight: '900', letterSpacing: 1.2, color: '#0b1a00' },
  searchGoOffTxt: { color: colors.muted },
  searchGoHint: { fontSize: 12, fontWeight: '700', color: colors.muted },

  /** Save, under My Routes' two times: it is what turns the reminders on. */
  saveBtn: {
    alignItems: 'center', borderRadius: 14, paddingVertical: 12,
    borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.glassLime,
  },
  saveBtnOff: { borderColor: colors.border },
  saveTxt: { fontSize: 14, fontWeight: '900', color: colors.text },
  /** One ride to a row (owner, 2026-11-11): two big cards fill the screen, the rest are a scroll away. */
  grid: { gap: 12 },
  boxWrap: { width: '100%' },
  box: {
    borderRadius: 20, padding: 10, gap: 5, overflow: 'hidden',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  boxYours: { borderColor: colors.primary },
  /** The owner's green light: a core that blinks and a ring that ripples out. */
  live: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  /** "● Available" / "Full", over the top-left corner of a box or the dialog. */
  status: {
    position: 'absolute', top: 8, left: 8, zIndex: 2,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  statusFullDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  statusTxt: { fontSize: 11, fontWeight: '900' },
  statusOpen: { color: GO },
  statusFull: { color: colors.danger },
  /** Room above the car for the status. */
  boxCar: { paddingTop: 16 },
  /** ♀ / ♂ over the top-right corner of a box or the dialog. */
  genderBadge: {
    position: 'absolute', top: 7, right: 7, zIndex: 2,
    width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  genderBadgeTxt: { color: '#ffffff', fontSize: 15, fontWeight: '900', lineHeight: 18 },
  /** A real car's photo: the driver's own, or one of the cars nearby. */
  carFrame: { width: '100%', aspectRatio: 1.6, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.background },
  /** On a full-width card: wide and shallow, so two whole cards still fit the screen. */
  carFrameWide: { aspectRatio: BOX_PIC_ASPECT },
  carDots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 5 },
  carDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border },
  carDotOn: { width: 12, backgroundColor: colors.primary },
  carCaption: { fontSize: 11.5, fontWeight: '800', color: colors.muted, textAlign: 'center', marginTop: 6 },
  liveRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: GO },
  liveCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: GO },
  /** "Pick up:", "Drop off:", "Fare:", "Passengers:" — the label column keeps the four lined up. */
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factLabel: { width: 78, fontSize: 12, fontWeight: '700', color: colors.muted },
  factValue: { flexShrink: 1, fontSize: 13.5, fontWeight: '800', color: colors.text },
  /** The car driving a drawn route. */
  artCar: { position: 'absolute', left: 0, top: 0, width: CAR_W, height: CAR_H },
  /** A mapped route's place name, over its end. */
  placeTag: { position: 'absolute', alignItems: 'center' },
  placeTagTxt: {
    maxWidth: '100%', fontSize: 9.5, fontWeight: '900', color: '#ffffff',
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.66)',
  },
  /** The favourite heart, on the picture's top-right corner — under the ♀/♂ badge. */
  favBtn: {
    position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)',
  },
  boxTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  boxTime: { flexShrink: 1, fontSize: 11, fontWeight: '700', color: colors.muted },
  /** A box with seats: its border breathing lime. */
  glow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderWidth: 1.5, borderColor: colors.primary },
  /** The light sweeping across the car. */
  sheen: { position: 'absolute', top: -30, bottom: -30, width: 42, backgroundColor: 'rgba(255,255,255,0.38)' },
  /** Softer on a drawn route: a glint, not a glare. */
  sheenOnArt: { backgroundColor: 'rgba(255,255,255,0.1)' },
  /** The fare, on the picture's bottom-right corner — clear of a drawn route's pickup. */
  farePill: {
    position: 'absolute', right: 6, bottom: 6, flexDirection: 'row', alignItems: 'baseline', gap: 2,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.primary,
  },
  farePillTxt: { fontSize: 13.5, fontWeight: '900', color: '#0b1a00' },
  farePillPer: { fontSize: 9.5, fontWeight: '800', color: '#0b1a00', opacity: 0.75 },

  /** No ride on the route: the card that offers +. */
  prompt: {
    alignItems: 'center', gap: 8, borderRadius: 22, padding: 18,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  promptIcon: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  promptRing: { position: 'absolute', width: 54, height: 54, borderRadius: 27, backgroundColor: colors.primary },
  promptCore: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.btnBg, alignItems: 'center', justifyContent: 'center',
  },
  promptTitle: { fontSize: 16, fontWeight: '900', color: colors.text, textAlign: 'center' },
  promptBody: { fontSize: 13, fontWeight: '600', color: colors.muted, textAlign: 'center', lineHeight: 19 },
  promptBtn: { alignSelf: 'stretch', paddingHorizontal: 16 },
  moreBtn: {
    alignItems: 'center', paddingVertical: 12, borderRadius: 14,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  moreTxt: { fontSize: 14, fontWeight: '900', color: colors.text },
  moreSub: { fontSize: 11, fontWeight: '700', color: colors.muted, marginTop: 1 },
  seatIcons: { flexDirection: 'row', gap: 3 },
  seatIcon: {
    width: 9, height: 11, borderWidth: 1.5, borderColor: colors.primary,
    borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
  },
  seatIconTaken: { backgroundColor: colors.primary },
  fareBig: { fontSize: 30, fontWeight: '900', color: colors.primary, textAlign: 'center', marginTop: 4 },
  fareSub: { fontSize: 12, fontWeight: '700', color: colors.muted, textAlign: 'center', marginTop: -4 },
  seatsTxt: { fontSize: 14, fontWeight: '900', color: colors.text, textAlign: 'center' },

  // The box's dialog: centred, to the point.
  dialogScreen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  // Solid: `surface` is frosted glass, and the boxes would show through it.
  dialog: {
    width: '100%', maxWidth: 380, borderRadius: 26, padding: 18, gap: 14,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.glassLimeBorder,
  },
  dialogStats: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  dialogStat: { flex: 1, alignItems: 'center', gap: 2 },
  dialogDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  dialogLabel: { fontSize: 10.5, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  dialogFare: { fontSize: 24, fontWeight: '900', color: colors.primary },
  dialogSeats: { fontSize: 15, fontWeight: '900', color: colors.text },
  dialogPlace: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dialogPlaceTxt: { fontSize: 14, fontWeight: '800', color: colors.text, lineHeight: 19 },
  /** Join, in the owner's green. */
  goBtn: { height: 52, borderRadius: 16, backgroundColor: GO, alignItems: 'center', justifyContent: 'center' },
  goTxt: { fontSize: 16, fontWeight: '900', color: '#ffffff' },
  /** Cancel, see-through. */
  ghostBtn: {
    height: 50, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  ghostTxt: { fontSize: 15, fontWeight: '800', color: colors.text },

  ladder: { flexDirection: 'row', gap: 6 },
  rung: {
    flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
  },
  rungOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  rungFare: { fontSize: 12.5, fontWeight: '900', color: colors.text },
  rungFareOn: { color: colors.primary },
  rungWho: { fontSize: 10, fontWeight: '700', color: colors.muted, marginTop: 1 },

  metaTxt: { fontSize: 12.5, fontWeight: '600', color: colors.muted, lineHeight: 18 },

  joinBtn: {
    height: 50, borderRadius: 14, backgroundColor: colors.btnBg, marginTop: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  joinTxt: { fontSize: 15, fontWeight: '900', color: colors.btnText },
  leaveBtn: {
    height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  leaveTxt: { fontSize: 14.5, fontWeight: '900', color: colors.danger },
  cancelTxt: { fontSize: 13, fontWeight: '800', color: colors.muted },
  ownerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  ownerTxt: { fontSize: 12.5, fontWeight: '800', color: colors.muted },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '86%', backgroundColor: colors.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28,
    borderWidth: 1, borderColor: colors.border,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 10 },
  sheetTitle: { fontSize: 19, fontWeight: '900', color: colors.text },
  sheetRow: { gap: 3 },
  sheetLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  sheetValue: { fontSize: 13.5, fontWeight: '700', color: colors.text, lineHeight: 19 },
  sheetInput: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: 13, paddingVertical: 11, color: colors.text, fontSize: 14.5, fontWeight: '700',
  },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  choiceTxt: { fontSize: 13.5, fontWeight: '900', color: colors.text },
  choiceTxtOn: { color: colors.primary },
  choiceNote: { fontSize: 11, fontWeight: '600', color: colors.muted, marginTop: 1 },
  nameRow: { flexDirection: 'row', gap: 8 },
  cityRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  cityRowTxt: { fontSize: 15, fontWeight: '800', color: colors.text },
  cityRowSub: { fontSize: 11.5, fontWeight: '600', color: colors.muted, marginTop: 1 },
}));
