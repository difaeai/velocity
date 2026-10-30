/**
 * Corporate, Students & daily travel — home's left ride tile. Ride sharing,
 * laid out the owner's way (2026-10-29; the + box 2026-10-30): one search,
 * then cards — and + to start one.
 *
 *   1. The city, at the top.
 *   2. Where to (drop-off), then where from (pickup — the phone's location
 *      until the rider types).
 *   3. Small boxes, two to a row (2026-10-30): the car on top, then pickup,
 *      drop-off, fare and "2 seats available", a green light blinking while one
 *      is active. Before a search, every shared ride in the city — the rider's
 *      own first. Searched, the related ones: leaving from the rider's area,
 *      those to their drop-off first, then further, then further still. Tap a
 *      box for the rest — Join, or Edit / Delete on your own. A car that fills
 *      stays two minutes; then the route is an empty car again (sharedPools/).
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
import Svg, { Circle, Path, Rect } from 'react-native-svg';

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

const distance = (m: number | null) =>
  m === null ? '' : m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;

const clockOf = (ms: number) => clockLabel(toHHMM(new Date(ms))) ?? '';

/** "Leaves 8:00 AM today — or as soon as it is full". */
function departLine(p: Pick<SharedPool, 'departTime' | 'departsAtMs'>): string {
  if (!p.departTime) return 'Leaves as soon as a driver accepts';
  const day = p.departsAtMs && new Date(p.departsAtMs).toDateString() !== new Date().toDateString()
    ? 'tomorrow'
    : 'today';
  return `Leaves ${clockLabel(p.departTime)} ${day} — or as soon as it is full`;
}

function statusOf(p: SharedPool): { label: string; tone: 'wait' | 'go' | 'full' } {
  if (p.state === 'full') return { label: 'Full — on its way', tone: 'full' };
  if (p.driver) return { label: 'Driver assigned', tone: 'go' };
  if (p.state === 'car') return { label: 'Finding a driver', tone: 'wait' };
  return { label: 'Driver needed', tone: 'wait' };
}

const errorText = (e: unknown) => (e instanceof FirebaseError ? e.message : 'Please try again.');

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
    setFrom({ lat: coords.lat, lng: coords.lng, address: currentAddress ?? 'Current location' });
    // Keyed on coordinates: a new coords object for the same fix must not re-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromEdited, coords?.lat, coords?.lng, currentAddress]);

  // ── The boxes ─────────────────────────────────────────────────────────────
  // Before a search, every shared ride in the city; with both ends, the related ones.
  const [pools, setPools] = useState<SharedPool[] | null>(null);
  const [opened, setOpened] = useState<SharedPool | null>(null);
  const [sheet, setSheet] = useState<{ edit: SharedPool | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const cancellation = useCancellationSettings();
  // Only the newest search may paint: an older answer landing late is a different route.
  const searchSeq = useRef(0);
  const searching = !!from && !!to;

  const loadPools = useCallback(() => {
    const n = ++searchSeq.current;
    api
      .getSharedPools({
        city,
        ...(from ? { from: { lat: from.lat, lng: from.lng } } : {}),
        ...(to ? { to: { lat: to.lat, lng: to.lng } } : {}),
      })
      .then((r) => n === searchSeq.current && setPools(r.pools))
      .catch(() => n === searchSeq.current && setPools((prev) => prev ?? []));
  }, [city, from, to]);
  // On focus and on every new search — and seats fill and cars leave while the rider watches.
  useFocusEffect(loadPools);
  useForegroundInterval(loadPools, 20_000);

  const openRide = useCallback(
    (tripId: string) => router.push(`/passenger/trip/${tripId}` as Parameters<typeof router.push>[0]),
    [router],
  );

  function announce(res: SharedPoolSeat) {
    if (res.status === 'booked') {
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

  async function join(p: SharedPool) {
    setBusy(p.id);
    try {
      // On the route, at the rider's own stops; a short walk away, at the car's own.
      const res = await api.joinSharedPool(
        !p.nearby && from && to ? { poolId: p.id, pickup: from, dropoff: to } : { poolId: p.id },
      );
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
        // Its box then shows first, where riders find it: the search on its own route.
        setPools(null);
        setFromEdited(true);
        setFrom(form.from);
        setTo(form.to);
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
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>Ride sharing</Text>
          <Text style={styles.subtitle} numberOfLines={1}>Corporate, students & daily travel</Text>
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
              {ACTIVE_LABEL[active.status] ?? 'You are on a ride'} — open it
            </Text>
            <ArrowIcon size={18} color="#0b1a00" />
          </Pressable>
        ) : null}

        {/* 1. The city, first and centred. */}
        <Pressable
          style={({ pressed }) => [styles.cityPill, pressed && { opacity: 0.85 }]}
          onPress={() => setCityOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`City: ${cityName}. Change city`}
        >
          <DestinationPinIcon size={16} color={colors.text} accent={colors.primary} />
          <Text style={styles.cityTxt}>{cityName}</Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <ArrowIcon size={14} color={colors.muted} />
          </View>
        </Pressable>

        {/* 2. Where to, then where from. */}
        <RouteFields
          cityName={cityName}
          to={to}
          from={from}
          onTo={(p) => {
            // A new search shows its own boxes, never the last one's under its heading.
            if (p !== to) setPools(null);
            setTo(p);
          }}
          onFrom={(p) => {
            if (p !== from) setPools(null);
            setFromEdited(true);
            setFrom(p);
          }}
        />
        {to && !from ? <Text style={styles.hint}>Type your pickup, or turn on location.</Text> : null}

        {/* 3. The boxes: every shared ride in the city, or — searched — the related ones. */}
        {pools === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
        ) : pools.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.hint}>
              {searching ? 'No shared rides from your area yet.' : `No shared rides in ${cityName} yet.`}
            </Text>
            <Pressable
              style={({ pressed }) => [styles.joinBtn, styles.emptyBtn, pressed && { opacity: 0.85 }]}
              onPress={() => setSheet({ edit: null })}
              accessibilityRole="button"
            >
              <PlusIcon />
              <Text style={styles.joinTxt}>Create a shared ride</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.blockLabel}>
              {searching ? 'NEAREST TO YOUR DROP-OFF FIRST' : `SHARED RIDES IN ${cityName.toUpperCase()}`}
            </Text>
            <View style={styles.grid}>
              {pools.map((p) => <PoolBox key={p.id} pool={p} onPress={() => setOpened(p)} />)}
            </View>
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
      <JoinSheet
        pool={opened}
        uid={user?.uid}
        from={from}
        to={to}
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

/**
 * The car from above: the driver's seat and four for riders, filled as people
 * take them — on top of every box, the owner's order.
 */
function CarSeats({ taken, total, driver, width = 240 }: { taken: number; total: number; driver: boolean; width?: number }) {
  // Front passenger first, then the back row, left to right as you look at it.
  const seats = [
    { x: 126, y: 66, w: 34, h: 30 },
    { x: 50, y: 22, w: 36, h: 24 },
    { x: 50, y: 48, w: 36, h: 24 },
    { x: 50, y: 74, w: 36, h: 24 },
  ].slice(0, total);
  return (
    <View style={styles.carWrap} accessible accessibilityLabel={`${taken} of ${total} seats taken`}>
      <Svg width={width} height={width / 2} viewBox="0 0 240 120">
        {/* Wheels and mirrors first, so the body sits over them. */}
        {[48, 162].flatMap((x) => [5, 101].map((y) => (
          <Rect key={`${x}-${y}`} x={x} y={y} width={34} height={14} rx={5} fill={colors.muted} />
        )))}
        <Rect x={160} y={4} width={12} height={9} rx={4} fill={colors.glassLimeBorder} />
        <Rect x={160} y={107} width={12} height={9} rx={4} fill={colors.glassLimeBorder} />
        {/* Body, nose to the right. */}
        <Path
          d="M30 12 H188 C214 12 232 32 232 60 C232 88 214 108 188 108 H30 C17 108 8 99 8 86 V34 C8 21 17 12 30 12 Z"
          fill={colors.glassLime}
          stroke={colors.glassLimeBorder}
          strokeWidth={2}
        />
        {/* Windscreen and rear glass. */}
        <Path d="M172 22 L192 28 Q197 60 192 92 L172 98 Z" fill={colors.border} />
        <Path d="M38 26 L26 32 Q22 60 26 88 L38 94 Z" fill={colors.border} />
        {/* The driver's seat: dashed until a driver accepts. */}
        <Rect
          x={126} y={24} width={34} height={30} rx={9}
          fill={driver ? colors.muted : 'none'}
          stroke={colors.muted}
          strokeWidth={2}
          strokeDasharray={driver ? undefined : '4 3'}
        />
        {driver ? <Circle cx={143} cy={39} r={6} fill="#0b1a00" /> : null}
        <Circle cx={166} cy={39} r={7} stroke={colors.muted} strokeWidth={3} fill="none" />
        {seats.map((s, i) => (i < taken ? (
          <Rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={8} fill={colors.primary} />
        ) : (
          <Rect
            key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={8}
            fill="none" stroke={colors.primary} strokeWidth={2} strokeDasharray="4 3"
          />
        )))}
        {seats.slice(0, taken).map((s, i) => (
          <Circle key={`h${i}`} cx={s.x + s.w / 2} cy={s.y + s.h / 2} r={6} fill="#0b1a00" />
        ))}
      </Svg>
    </View>
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

/** Someone is in it or its car is out: the owner's blinking green light. */
const isActive = (p: SharedPool) => p.state === 'car' || (p.state === 'gathering' && p.riders > 0);

/**
 * One shared ride as a small box, half the screen wide, in the owner's order:
 * the car, then pickup, drop-off, fare and the seats still free. Tapping it
 * opens everything else.
 */
function PoolBox({ pool: p, onPress }: { pool: SharedPool; onPress: () => void }) {
  const active = isActive(p);
  const yours = p.mine || p.booked || p.aboardTripId !== null;
  const from = areaLabel(p.pickup.address);
  const to = areaLabel(p.dropoff.address);
  return (
    <Pressable
      style={({ pressed }) => [styles.box, yours && styles.boxYours, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${active ? 'Active. ' : ''}From ${from} to ${to}. PKR ${p.farePerSeat}. ${seatsText(p)}`}
    >
      {active ? <LiveDot /> : null}
      <CarSeats taken={p.state === 'full' ? p.seatsTotal : p.riders} total={p.seatsTotal} driver={!!p.driver} width={128} />
      <View style={styles.boxLine}>
        <PickupDotIcon size={12} color={colors.text} accent={colors.primary} />
        <Text style={styles.boxPlace} numberOfLines={1}>{from}</Text>
      </View>
      <View style={styles.boxLine}>
        <DestinationPinIcon size={12} color={colors.text} accent={colors.primary} />
        <Text style={styles.boxPlace} numberOfLines={1}>{to}</Text>
      </View>
      <Text style={styles.boxFare}>PKR {p.farePerSeat}</Text>
      <Text style={styles.boxSeats}>{seatsText(p)}</Text>
      {/* Two rides on one route differ by their time. */}
      <Text style={styles.boxTime}>{p.departTime ? `${clockLabel(p.departTime)} daily` : 'Leaves now'}</Text>
    </Pressable>
  );
}

function LiveDot() {
  const [glow] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.15, duration: 700, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [glow]);
  return <Animated.View style={[styles.liveDot, { opacity: glow }]} />;
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
            placeholder="Drop-off — office, university or area"
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
            placeholder="Pickup — your current location"
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
 * A box, opened: the ride in full, and what this rider can do with it — join,
 * leave (a booked seat or a car already out, right here), open the ride they
 * are on, or (theirs) edit or delete it.
 */
function JoinSheet({
  pool: p,
  uid,
  from,
  to,
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
  uid: string | undefined;
  from: Place | null;
  to: Place | null;
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
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const leaveFee = trip && trip.id === p.aboardTripId ? poolLeaveFee(trip, uid, rates) : null;
  const later = p.state === 'gathering' && !!p.departTime;
  const inIt = p.booked || p.aboardTripId !== null;
  const canJoin = !inIt && p.state !== 'full' && p.seatsLeft > 0;
  // On the rider's route the car collects them at their own stops; otherwise at its own.
  const own = canJoin && !p.nearby && from && to;
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const rung = Math.min(p.seatsTotal, inIt || p.state === 'full' ? p.riders : p.riders + 1);
  return (
    <Sheet open onClose={onClose}>
      <Text style={styles.sheetTitle} numberOfLines={2}>{p.label ?? `To ${areaLabel(p.dropoff.address)}`}</Text>
      <Text style={styles.sheetName}>{statusOf(p).label}</Text>
      <CarSeats taken={p.state === 'full' ? p.seatsTotal : p.riders} total={p.seatsTotal} driver={!!p.driver} />
      <SheetRow label="PICKUP">
        {own ? `${from.address} — the car collects you here` : `${p.pickup.address}${p.pickupDistanceM !== null ? ` — ${distance(p.pickupDistanceM)} from you` : ''}`}
      </SheetRow>
      <SheetRow label="DROP-OFF">
        {own ? to.address : `${p.dropoff.address}${p.dropoffDistanceM !== null ? ` — ${distance(p.dropoffDistanceM)} from yours` : ''}`}
      </SheetRow>
      <SheetRow label="FARE">
        PKR {p.farePerSeat} {inIt ? 'for your seat so far' : p.state === 'full' ? 'a seat in this car' : 'a seat if you join now'}, cash
        to the driver. It goes down as people join, and is never above PKR {p.soloFare}, riding alone.
      </SheetRow>
      <FareLadder ladder={p.fareLadder} at={rung} />
      <SheetRow label="SEATS">{p.state === 'full' ? 'Full — an empty car opens here in 2 minutes' : seatsText(p)}</SheetRow>
      <SheetRow label="WHEN">{departLine(p)}</SheetRow>
      <SheetRow label="DRIVER">
        {p.driver
          ? `${p.driver.name} · ${p.driver.vehicle}${p.driver.plate ? ` · ${p.driver.plate}` : ''}${p.needsDriverApproval ? ' — they have to agree to take you' : ''}`
          : later
            ? 'Not yet. Drivers are asked 10 minutes before the car leaves. Your ride is not confirmed until one accepts — we will notify you.'
            : 'Not yet. Drivers nearby are asked as soon as you join. Your ride is not confirmed until one accepts.'}
      </SheetRow>
      {canJoin ? (
        <SheetRow label="LEAVING">
          Free until a driver accepts. After that, {pct(rates.poolLeaveRate)} of your fare —{' '}
          {pct(rates.poolLeaveArrivedRate)} once the driver is at the pickup. If someone else leaves and your share goes
          up, you are told — and can leave free until a driver accepts.
        </SheetRow>
      ) : null}

      {p.aboardTripId ? (
        <>
          <Pressable
            style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
            onPress={() => onOpenRide(p.aboardTripId!)}
            accessibilityRole="button"
          >
            <Text style={styles.joinTxt}>Open my ride</Text>
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
        <>
          <Text style={styles.metaTxt}>Seat booked — not confirmed until a driver accepts.</Text>
          <Pressable
            style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.85 }]}
            onPress={() => onLeave(p)}
            accessibilityRole="button"
          >
            <Text style={styles.leaveTxt}>Leave this ride · free</Text>
          </Pressable>
        </>
      ) : canJoin ? (
        <Pressable
          style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
          onPress={() => onJoin(p)}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.btnText} />
          ) : (
            <Text style={styles.joinTxt}>
              {later ? 'Book my seat' : `${p.needsDriverApproval ? 'Ask the driver' : 'Join'} · PKR ${p.farePerSeat}`}
            </Text>
          )}
        </Pressable>
      ) : null}
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
      <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center' }}>
        <Text style={styles.cancelTxt}>Close</Text>
      </Pressable>
    </Sheet>
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
            placeholder="Bahria University"
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
            placeholder="E-8"
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
          <CarSeats taken={1} total={4} driver={false} />
          <Text style={styles.seatsTxt}>3 of 4 seats available — one is yours</Text>
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
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  title: { fontSize: 19, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },
  plusBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.btnBg,
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
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  cityTxt: { fontSize: 16, fontWeight: '900', color: colors.text },

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
  empty: { gap: 4 },
  emptyBtn: { flexDirection: 'row', gap: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  box: {
    width: '48.5%', borderRadius: 16, padding: 10, gap: 4,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  boxYours: { borderColor: colors.primary },
  /** The owner's green light, top right. */
  liveDot: {
    position: 'absolute', top: 9, right: 9, zIndex: 1, width: 11, height: 11, borderRadius: 6,
    backgroundColor: '#22c55e', borderWidth: 2, borderColor: 'rgba(34,197,94,0.35)',
  },
  boxLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boxPlace: { flex: 1, fontSize: 12.5, fontWeight: '800', color: colors.text },
  boxFare: { fontSize: 17, fontWeight: '900', color: colors.primary, marginTop: 2 },
  boxSeats: { fontSize: 12, fontWeight: '800', color: colors.text },
  boxTime: { fontSize: 11, fontWeight: '700', color: colors.muted },
  fareBig: { fontSize: 30, fontWeight: '900', color: colors.primary, textAlign: 'center', marginTop: 4 },
  fareSub: { fontSize: 12, fontWeight: '700', color: colors.muted, textAlign: 'center', marginTop: -4 },
  carWrap: { alignItems: 'center', paddingVertical: 2 },
  seatsTxt: { fontSize: 14, fontWeight: '900', color: colors.text, textAlign: 'center' },

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
  sheetName: { fontSize: 14, fontWeight: '800', color: colors.primary, marginTop: -6 },
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
