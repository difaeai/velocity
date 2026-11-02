/**
 * Corporate, Students & daily travel — home's left ride tile. Ride sharing,
 * laid out the owner's way (2026-10-29; the + box 2026-10-30): one search,
 * then cards — and + to start one.
 *
 *   1. The top row: "Ride sharing", the city in the middle, then +.
 *   2. Where to (drop-off), then where from (pickup — the phone's location
 *      until the rider types).
 *   3. Small animated boxes, two to a row (2026-10-30): the pickup alone (the
 *      phone's location as soon as it lands, 2026-11-02) shows what leaves from
 *      there; with a drop-off too, the related ones — the rider's exact route
 *      first, then further, then further still — and All shows every ride in
 *      the city. No pickup and no All, no boxes. Each has a picture on top
 *      (the driver's car, nearby cars, or its route drawn as a map), from → to,
 *      fare, "2 seats available", a pulsing "Available" and a ♀/♂ badge.
 *      Tap a box: a dialog with only fare, seats, from and to, Join in green
 *      and Cancel see-through (Leave there for a rider in it). A car that fills
 *      stays two minutes; then the route is an empty car again.
 *      In Islamabad and Rawalpindi every everyday route is there already
 *      (2026-11-02, src/domain/sharingRoutes): an empty car until its first
 *      Join creates it. A search shows the rider's exact route first (its Join
 *      creates it), then every other ride, the closest to their route first.
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
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Svg, { Circle, Defs, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { api, type SharedFareQuote, type SharedPool, type SharedPoolSeat } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { PAKISTAN_CITIES } from '../../src/domain/intercityTypes';
import { useCurrentLocation } from '../../src/hooks/location';
import { useCancellationSettings } from '../../src/hooks/driver';
import { useActiveTrip } from '../../src/hooks/useActiveTrip';
import { useTrip } from '../../src/hooks/useTrip';
import { poolLeaveFee } from '../../src/lib/poolLeave';
import { useForegroundInterval } from '../../src/hooks/useForegroundInterval';
import { fetchPlaceDetail, usePlacesAutocomplete, type PlacePrediction } from '../../src/hooks/places';
import { areaLabel } from '../../src/lib/areaLabel';
import { clockLabel, fromHHMM, toHHMM } from '../../src/lib/dailyRouteTime';
import { distanceMeters } from '../../src/lib/geo';
import {
  NEAR_PICKUP_M,
  nearestSpotName,
  pickupFit,
  routeGap,
  sameRoute,
  SHARING_ROUTES,
  TWIN_CITIES,
} from '../../src/domain/sharingRoutes';
import { Text, TextInput } from '../../src/ui/Text';
import { DestinationPinIcon, PickupDotIcon } from '../../src/ui/RideIcons';
import { ArrowIcon } from '../../src/ui/ServiceIcons';

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

/** Ready routes' boxes at a time; "Show more" adds as many again. */
const PAGE = 20;

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
  // The owner's All: every ride in the city instead of the relevant ones.
  const [all, setAll] = useState(false);
  const searching = !all && !!from && !!to;
  // The owner: no pickup and no All, no boxes (2026-10-30) — but the pickup
  // alone, the phone's location included, lists what leaves from there (2026-11-02).
  const listing = all || !!from;

  const loadPools = useCallback(() => {
    const n = ++searchSeq.current;
    if (!listing) return;
    api
      .getSharedPools({
        city,
        ...(from ? { from: { lat: from.lat, lng: from.lng } } : {}),
        ...(all ? { all: true } : to ? { to: { lat: to.lat, lng: to.lng } } : {}),
      })
      .then((r) => n === searchSeq.current && setPools(r.pools))
      .catch(() => n === searchSeq.current && setPools((prev) => prev ?? []));
  }, [city, from, to, all, listing]);
  // On focus and on every new search — and seats fill and cars leave while the rider watches.
  useFocusEffect(loadPools);
  useForegroundInterval(loadPools, 20_000);
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
  // With All: the real rides, then every route no real ride runs yet, nearest
  // pickup first. With a search (owner, 2026-11-02: "the exact location at
  // once, then the next, then the next"): the real rides on the rider's own
  // route, else their exact route as an empty car — then every other ride,
  // real or ready, closest to their route first.
  const listed = useMemo<Box[] | null>(() => {
    if (pools === null) return null;
    const twin = TWIN_CITIES.has(city);
    const open = SHARING_ROUTES.filter((r) => twin && !pools.some((p) => sameRoute(r, p)));
    // All, or a pickup with no drop-off yet: the real rides, then the ready
    // routes leaving from around the pickup — the nearby places first, the far
    // ones after — then the routes from further away.
    if (all || !to) {
      const fit = (r: (typeof SHARING_ROUTES)[number]) =>
        from ? pickupFit(from, r) + (distanceMeters(from.lat, from.lng, r.pickup.lat, r.pickup.lng) > NEAR_PICKUP_M ? 1e9 : 0) : 0;
      const ready = open.map((r) => ({ r, m: fit(r) })).sort((a, b) => a.m - b.m);
      return [...pools, ...ready.map(({ r }) => readyBox(r.id, r.label, city, r.pickup, r.dropoff))];
    }
    if (!from) return pools;
    const onIt = pools.filter((p) => !p.nearby);
    const km = distanceMeters(from.lat, from.lng, to.lat, to.lng) / 1000;
    // Their own route, as createSharedPool would take it (0.5–80 km).
    const exact = { pickup: from, dropoff: to };
    const mine =
      onIt.length === 0 && km >= 0.5 && km <= 80 && !pools.some((p) => sameRoute(exact, p))
        ? [readyBox('route:exact', placeName(to).slice(0, 60), city, from, to)]
        : [];
    const rest: Box[] = [
      ...pools.filter((p) => p.nearby),
      ...open.map((r) => readyBox(r.id, r.label, city, r.pickup, r.dropoff)),
    ];
    const gap = new Map(rest.map((b) => [b.id, routeGap(from, to, b)]));
    rest.sort((a, b) => gap.get(a.id)! - gap.get(b.id)!);
    return [...onIt, ...mine, ...rest];
  }, [pools, city, all, searching, from, to]);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [all, from, to, city]);
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

  async function join(p: Box) {
    setBusy(p.id);
    try {
      const res = p.ready
        // A ready route: its first rider creates the real shared ride, leaving now.
        ? await api.createSharedPool({ city, label: p.label, departTime: null, rideType: 'mini', pickup: p.pickup, dropoff: p.dropoff })
        // On the route, at the rider's own stops; a short walk away, at the car's own.
        : await api.joinSharedPool(!p.nearby && from && to ? { poolId: p.id, pickup: from, dropoff: to } : { poolId: p.id });
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
        setPools(null);
        setTo(null);
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

        {/* The search box: drop-off, then pickup (the phone's location until typed). */}
        <RouteFields
          key={routeKey}
          cityName={cityName}
          to={to}
          from={from}
          onTo={(p) => {
            // A new search shows its own boxes, never the last one's under its heading.
            if (p !== to) setPools(null);
            // Choosing a drop-off is asking for the relevant ones, not All.
            if (p) setAll(false);
            setTo(p);
          }}
          onFrom={(p) => {
            if (p !== from) setPools(null);
            setFromEdited(true);
            setFrom(p);
          }}
        />
        {to && !from ? <Text style={styles.hint}>Type your pickup, or turn on location.</Text> : null}

        {/* 3. The boxes: leaving from the pickup; with a drop-off, the rider's exact
            route first, then the nearest; with All, every ride in the city. */}
        <View style={styles.listHead}>
          <Text style={[styles.blockLabel, styles.listHeading]} numberOfLines={1}>
            {all ? `ALL IN ${cityName.toUpperCase()}` : searching ? 'YOUR ROUTE FIRST, THEN THE NEAREST' : 'LEAVING FROM YOUR PICKUP'}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.allChip, all && styles.allChipOn, pressed && { opacity: 0.85 }]}
            onPress={() => {
              setPools(null);
              setAll((a) => !a);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityState={{ selected: all }}
            accessibilityLabel={all ? 'Show the rides near you' : `Show every ride in ${cityName}`}
          >
            <Text style={[styles.allChipTxt, all && styles.allChipTxtOn]}>All</Text>
          </Pressable>
        </View>
        {!listing ? (
          <Text style={styles.hint}>
            Enter your pickup location to see the shared rides leaving from there — or tap All for every ride in {cityName}.
          </Text>
        ) : shown === null || listed === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
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
                  <PoolBox key={p.id} pool={p} index={i} beat={carBeat} flow={flow} onPress={() => setOpened(p)} />
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
        from={from}
        to={to}
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

/** "2 seats available" — the owner's words, never "2 of 4". */
const seatsText = (p: SharedPool) =>
  p.state === 'full'
    ? 'Full'
    : p.seatsLeft === 0
      ? 'No seats available'
      : `${p.seatsLeft} ${p.seatsLeft === 1 ? 'seat' : 'seats'} available`;

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

/** The route as a curve in a 160×100 box: pickup low left, drop-off high right, bent its own way. */
function artCurve(n: number) {
  const p0 = { x: 20 + (n % 3) * 4, y: 64 - ((n >> 2) % 3) * 5 };
  const p3 = { x: 138 - ((n >> 4) % 3) * 4, y: 30 + ((n >> 6) % 3) * 5 };
  const c1 = { x: 60, y: p0.y - 26 - ((n >> 8) % 4) * 6 };
  const c2 = { x: 100, y: p3.y + 26 + ((n >> 10) % 4) * 6 };
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

/**
 * A ride with no car photo yet (owner, 2026-11-02: the same BMW on every box
 * "looks strange"): its route drawn as a little map instead — streets, the
 * road from pickup to drop-off, and a little car driving it on `phase`.
 * Every route bends and colours its own way, so a screenful never repeats.
 */
function RouteArt({ seed, phase }: { seed: string; phase?: Animated.Value | Animated.AnimatedInterpolation<number> }) {
  const n = seedOf(seed);
  const [dark, light] = ART_TONES[n % ART_TONES.length]!;
  const curve = useMemo(() => artCurve(n), [n]);
  const [width, setWidth] = useState(0);
  const k = width / 160;
  const pts = RUNNER_STEPS.map(curve.at);
  // Which way the road points at each step, so the car turns with it (x only
  // grows along the curve, so the angle never wraps).
  const turns = RUNNER_STEPS.map((t) => {
    const a = curve.at(Math.max(0, t - 0.02));
    const b = curve.at(Math.min(1, t + 0.02));
    return `${(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI}deg`;
  });
  const id = `a${n}`;
  return (
    <View style={StyleSheet.absoluteFill} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Svg width="100%" height="100%" viewBox="0 0 160 100">
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
        <Rect x="0" y="0" width="160" height="100" fill={`url(#${id}bg)`} />
        {/* The streets: two main roads and a few lanes. */}
        <Line x1="0" y1={18 + (n % 17)} x2="160" y2={34 + ((n >> 3) % 17)} stroke="#ffffff" strokeOpacity={0.07} strokeWidth={7} />
        <Line x1={38 + (n % 41)} y1="0" x2={64 + ((n >> 5) % 41)} y2="100" stroke="#ffffff" strokeOpacity={0.07} strokeWidth={6} />
        <Line x1="0" y1={74 + (n % 13)} x2="160" y2={66 + ((n >> 7) % 13)} stroke="#ffffff" strokeOpacity={0.05} strokeWidth={1.2} />
        <Line x1={112 + (n % 29)} y1="0" x2={98 + ((n >> 9) % 29)} y2="100" stroke="#ffffff" strokeOpacity={0.05} strokeWidth={1.2} />
        <Line x1="0" y1={50 + (n % 9)} x2="160" y2={48 + ((n >> 11) % 9)} stroke="#ffffff" strokeOpacity={0.04} strokeWidth={1} />
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
      {phase && width > 0 ? (
        // The owner (2026-11-02): "some car related animation" — a car drives the route.
        <Animated.View
          pointerEvents="none"
          style={[
            styles.artCar,
            {
              opacity: phase.interpolate({ inputRange: [0, 0.06, 0.9, 1], outputRange: [0, 1, 1, 0] }),
              transform: [
                { translateX: phase.interpolate({ inputRange: RUNNER_STEPS, outputRange: pts.map((p) => p.x * k - CAR_W / 2) }) },
                { translateY: phase.interpolate({ inputRange: RUNNER_STEPS, outputRange: pts.map((p) => p.y * k - CAR_H / 2) }) },
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
 * cars that could come, turning over on each `beat` — or, with none, the
 * route drawn as a map (`seed`, `phase`). It drives in with `arrive`.
 */
function RideCars({
  photos,
  beat,
  arrive,
  seed,
  phase,
  children,
}: {
  photos: string[];
  beat: number;
  arrive?: Animated.Value;
  /** The ride's id: what its route drawing is built from. */
  seed: string;
  phase?: Animated.Value | Animated.AnimatedInterpolation<number>;
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
      <View style={styles.carFrame}>
        {count > 0 ? (
          <Animated.Image
            source={{ uri: photos[shown % count] }}
            resizeMode="cover"
            accessible={false}
            style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: fade }]}
          />
        ) : (
          <RouteArt seed={seed} phase={phase} />
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
 */
function PoolBox({
  pool: p,
  index,
  beat,
  flow,
  onPress,
}: {
  pool: SharedPool;
  index: number;
  beat: number;
  flow: Animated.Value;
  onPress: () => void;
}) {
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
        onPress={onPress}
        onPressIn={() => pressTo(0.95)}
        onPressOut={() => pressTo(1)}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Available. ' : ''}From ${from} to ${to}. ${fareText(p)}. ${seatsText(p)}`}
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
          <RideCars photos={p.carPhotos ?? []} beat={beat} arrive={arrive} seed={p.id} phase={open ? phase : undefined}>
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
          </RideCars>
        </View>
        <View>
          <View style={styles.boxLine}>
            <PickupDotIcon size={12} color={colors.text} accent={colors.primary} />
            <Text style={styles.boxPlace} numberOfLines={1}>{from}</Text>
          </View>
          <View style={styles.routeDots}>
            <View style={styles.routeDot} />
            <View style={styles.routeDot} />
          </View>
          <View style={styles.boxLine}>
            <DestinationPinIcon size={12} color={colors.text} accent={colors.primary} />
            <Text style={styles.boxPlace} numberOfLines={1}>{to}</Text>
          </View>
        </View>
        <View style={styles.boxFoot}>
          <SeatIcons taken={p.state === 'full' ? p.seatsTotal : p.riders} total={p.seatsTotal} />
          <Text style={[styles.boxSeats, !open && { color: colors.danger }]} numberOfLines={1}>{seatsText(p)}</Text>
        </View>
        {/* Two rides on one route differ by their time. */}
        <View style={styles.boxTimeRow}>
          <ClockIcon />
          <Text style={styles.boxTime} numberOfLines={1}>{p.departTime ? `${clockLabel(p.departTime)} daily` : 'Leaves now'}</Text>
        </View>
      </Pressable>
    </Animated.View>
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
}: {
  cityName: string;
  to: Place | null;
  from: Place | null;
  onTo: (p: Place | null) => void;
  onFrom: (p: Place | null) => void;
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

  return (
    <>
      <View style={styles.routeBox}>
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
        <View style={styles.fieldDivider} />
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
            <RideCars photos={p.carPhotos ?? []} beat={beat} arrive={pop} seed={p.id} phase={flow} />
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
          <RideCars photos={[]} beat={0} seed={`${from?.address ?? ''}>${to?.address ?? ''}`} />
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
  blockLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, marginTop: 4 },
  emptyBtn: { flexDirection: 'row', gap: 8 },

  /** The boxes' heading, with the owner's All on the right. */
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listHeading: { flex: 1, marginTop: 0 },
  allChip: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  allChipOn: { backgroundColor: colors.btnBg, borderColor: colors.btnBg },
  allChipTxt: { fontSize: 13, fontWeight: '900', color: colors.text },
  allChipTxtOn: { color: colors.btnText },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  boxWrap: { width: '48.5%' },
  box: {
    borderRadius: 20, padding: 10, gap: 6, overflow: 'hidden',
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
  carDots: { flexDirection: 'row', justifyContent: 'center', gap: 4, marginTop: 5 },
  carDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.border },
  carDotOn: { width: 12, backgroundColor: colors.primary },
  carCaption: { fontSize: 11.5, fontWeight: '800', color: colors.muted, textAlign: 'center', marginTop: 6 },
  liveRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: GO },
  liveCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: GO },
  boxLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boxPlace: { flex: 1, fontSize: 12.5, fontWeight: '800', color: colors.text },
  /** The dotted line from pickup to drop-off, a lime dot running down it. */
  routeDots: { paddingLeft: 5, paddingVertical: 2, gap: 2 },
  routeDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: colors.muted },
  /** The car driving a drawn route. */
  artCar: { position: 'absolute', left: 0, top: 0, width: CAR_W, height: CAR_H },
  boxFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boxSeats: { flexShrink: 1, fontSize: 12, fontWeight: '800', color: colors.text },
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
