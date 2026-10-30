/**
 * Corporate, Students & daily travel — home's left ride tile. Ride sharing,
 * laid out the owner's way (2026-10-29): one search, then cards.
 *
 *   1. The city, at the top.
 *   2. Where to (drop-off), then where from (pickup — the phone's location
 *      until the rider types).
 *   3. With both set, the shared rides on that route appear as cards: the fare
 *      per seat on top, the car under it with its seats taken and free, then
 *      Join. A car that fills stays on its card for two minutes; then the same
 *      route is an empty car again for the next riders (backend sharedPools/).
 *   4. Nobody going that way yet? The card for a new shared ride on the route
 *      is already there — start it, with a name and a daily time if wanted.
 *
 * A seat booked for later is PENDING until a driver accepts, and every card and
 * sheet says so. Riders meet the car at its pickup and leave it at its drop-off,
 * each within 1 km of their own — that is what "on your route" means.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { RIDE_TYPE_LABELS, type RideType } from '../../src/domain/types';
import { PAKISTAN_CITIES } from '../../src/domain/intercityTypes';
import { useCurrentLocation } from '../../src/hooks/location';
import { useCancellationSettings } from '../../src/hooks/driver';
import { useActiveTrip } from '../../src/hooks/useActiveTrip';
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
type SharedCar = 'mini' | 'ac';

/** What the live ride is doing, in the rider's words. */
const ACTIVE_LABEL: Record<string, string> = {
  requested: 'Booked — finding a driver',
  matched: 'Your driver is on the way',
  arriving: 'Your driver is on the way',
  arrived: 'Your driver has arrived',
  in_progress: 'You are on your ride',
};

/** The two cars a shared ride can be: four seats each. */
const SHARED_CARS: { key: SharedCar; note: string }[] = [
  { key: 'mini', note: 'No AC · 4 seats' },
  { key: 'ac', note: 'AC on · 4 seats' },
];

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

/** The next moment at this clock time — today if still ahead, else tomorrow. */
function nextAt(time: Date): number {
  const d = new Date();
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d.getTime() > Date.now() - 5 * 60_000 ? d.getTime() : d.getTime() + 24 * 3600_000;
}

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

  const [toText, setToText] = useState('');
  const [to, setTo] = useState<Place | null>(null);
  const [fromText, setFromText] = useState('');
  const [from, setFrom] = useState<Place | null>(null);
  // Until the rider types in it, "from" follows the phone's location.
  const [fromEdited, setFromEdited] = useState(false);
  const [field, setField] = useState<Field | null>(null);
  const tokenRef = useRef(uuidv4());

  useEffect(() => {
    if (fromEdited || !coords) return;
    const address = currentAddress ?? 'Current location';
    setFrom({ lat: coords.lat, lng: coords.lng, address });
    setFromText(address);
    // Keyed on coordinates: a new coords object for the same fix must not re-fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromEdited, coords?.lat, coords?.lng, currentAddress]);

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
      setTo(null);
    } else {
      setFromEdited(true);
      setFromText(text);
      setFrom(null);
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
    if (which === 'to') setTo(place);
    else setFrom(place);
  }

  // ── The cards ─────────────────────────────────────────────────────────────
  const [pools, setPools] = useState<SharedPool[] | null>(null);
  // A short walk away: met at the car's own pickup.
  const [nearby, setNearby] = useState<SharedPool[]>([]);
  const [mine, setMine] = useState<SharedPool[] | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [quote, setQuote] = useState<SharedFareQuote | null>(null);
  const [joining, setJoining] = useState<SharedPool | null>(null);
  const [sheet, setSheet] = useState<{ edit: SharedPool | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // "Leaving around" — optional; null is any time.
  const [at, setAt] = useState<Date | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const cancellation = useCancellationSettings();
  // Only the newest search may paint: an older answer landing late is a different route.
  const searchSeq = useRef(0);

  const loadPools = useCallback(() => {
    const n = ++searchSeq.current;
    if (!from || !to) {
      setPools(null);
      return;
    }
    api
      .getSharedPools({
        city,
        from: { lat: from.lat, lng: from.lng },
        to: { lat: to.lat, lng: to.lng },
        ...(at ? { at: nextAt(at) } : {}),
      })
      .then((r) => {
        if (n !== searchSeq.current) return;
        setPools(r.pools);
        setNearby(r.nearby ?? []);
      })
      .catch(() => n === searchSeq.current && setPools((prev) => prev ?? []));
  }, [city, from, to, at]);
  useEffect(() => {
    setPools(null);
    loadPools();
  }, [loadPools]);
  // Seats fill and cars leave while the rider watches.
  useForegroundInterval(from && to ? loadPools : null, 20_000);

  const loadMine = useCallback(() => {
    api.getSharedPools({ mine: true }).then((r) => setMine(r.pools)).catch(() => {});
  }, []);
  useFocusEffect(loadMine);

  // The fare for a new shared ride on this route — the card shown when nobody shares it yet.
  useEffect(() => {
    setQuote(null);
    if (!from || !to) return;
    let live = true;
    api
      .getSharedRideFare({ rideType: 'mini', pickup: { lat: from.lat, lng: from.lng }, dropoff: { lat: to.lat, lng: to.lng } })
      .then((q) => live && setQuote(q))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [from, to]);

  const refresh = () => {
    loadPools();
    loadMine();
  };

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
      setJoining(null);
      announce(res);
      refresh();
    } catch (e) {
      Alert.alert('Could not join', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function submit(form: { label: string; departTime: string | null; rideType: SharedCar }) {
    const editing = sheet?.edit ?? null;
    setBusy('sheet');
    try {
      if (editing) {
        await api.editSharedPool({ poolId: editing.id, label: form.label.trim() || null, departTime: form.departTime });
        setSheet(null);
      } else {
        if (!from || !to) return;
        const res = await api.createSharedPool({
          city,
          label: form.label.trim() || null,
          departTime: form.departTime,
          rideType: form.rideType,
          pickup: from,
          dropoff: to,
        });
        setSheet(null);
        announce(res);
      }
      refresh();
    } catch (e) {
      Alert.alert(editing ? 'Could not save' : 'Could not start it', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function leave(p: SharedPool) {
    Alert.alert('Cancel your seat?', 'It is free — no driver has accepted yet.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel seat',
        style: 'destructive',
        onPress: () => {
          api.leaveSharedPool({ poolId: p.id }).then(refresh).catch((e) => Alert.alert('Could not cancel', errorText(e)));
        },
      },
    ]);
  }

  function remove(p: SharedPool) {
    Alert.alert('Remove it from your list?', 'It stays open for everyone else going this way.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          api.editSharedPool({ poolId: p.id, remove: true }).then(loadMine).catch((e) => Alert.alert('Could not remove', errorText(e)));
        },
      },
    ]);
  }

  const cardProps = (p: SharedPool, owner = false) => ({
    pool: p,
    busy: busy === p.id,
    onJoin: () => setJoining(p),
    onLeave: () => leave(p),
    onOpenRide: openRide,
    onEdit: owner && p.mine ? () => setSheet({ edit: p }) : undefined,
    onRemove: owner && p.mine ? () => remove(p) : undefined,
  });

  // Seats the rider holds that this search does not already show.
  const shownIds = new Set((pools ?? []).map((p) => p.id));
  const yourSeats = (mine ?? []).filter((p) => (p.booked || p.aboardTripId) && !shownIds.has(p.id));

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
          style={({ pressed }) => [styles.mineBtn, showMine && styles.mineBtnOn, pressed && { opacity: 0.85 }]}
          onPress={() => setShowMine((v) => !v)}
          accessibilityRole="button"
        >
          <Text style={[styles.mineBtnTxt, showMine && styles.mineBtnTxtOn]}>{showMine ? 'Search' : 'My rides'}</Text>
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

        {showMine ? (
          mine === null ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          ) : mine.length === 0 ? (
            <Text style={styles.hint}>
              Shared rides you start or book a seat on show up here.
            </Text>
          ) : (
            mine.map((p) => <PoolCardView key={p.id} {...cardProps(p, true)} />)
          )
        ) : (
          <>
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

            {/* Departure time — optional, for riders who are not flexible. */}
            <View style={styles.timeRow}>
              <Pressable
                style={({ pressed }) => [styles.timeChip, at && styles.timeChipOn, pressed && { opacity: 0.85 }]}
                onPress={() => setTimeOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={at ? `Leaving around ${clockLabel(toHHMM(at))}. Change` : 'Leaving at any time. Pick a time'}
              >
                <Text style={[styles.timeChipTxt, at && styles.timeChipTxtOn]}>
                  {at ? `Leaving around ${clockLabel(toHHMM(at))}` : 'Leaving: any time'}
                </Text>
              </Pressable>
              {at ? (
                <Pressable onPress={() => setAt(null)} hitSlop={10} accessibilityLabel="Any time">
                  <Text style={styles.cancelTxt}>Any time</Text>
                </Pressable>
              ) : null}
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

            {yourSeats.length > 0 ? (
              <>
                <Text style={styles.blockLabel}>YOUR SEAT</Text>
                {yourSeats.map((p) => <PoolCardView key={p.id} {...cardProps(p)} />)}
              </>
            ) : null}

            {/* 3. The cards, once both ends are set. */}
            {!to || !from ? (
              <Text style={styles.hint}>
                {!from && !coords
                  ? 'Type your pickup, or turn on location.'
                  : 'Choose where you are going. Shared rides on your route appear here — join one, or start your own.'}
              </Text>
            ) : pools === null ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
            ) : (
              <>
                <Text style={styles.blockLabel}>
                  {pools.length > 0 ? `SHARED RIDES ON YOUR ROUTE · ${pools.length}` : 'NOBODY SHARES THIS ROUTE YET'}
                </Text>
                {pools.length === 0 ? (
                  <NewRideCard dropoff={to} quote={quote} onStart={() => setSheet({ edit: null })} />
                ) : (
                  pools.map((p) => <PoolCardView key={p.id} {...cardProps(p)} />)
                )}
                {pools.length > 0 ? (
                  <Pressable
                    style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.85 }]}
                    onPress={() => setSheet({ edit: null })}
                    accessibilityRole="button"
                  >
                    <Text style={styles.addPlus}>+</Text>
                    <Text style={styles.addTxt}>Start your own on this route — another time or name</Text>
                  </Pressable>
                ) : null}
                {nearby.length > 0 ? (
                  <>
                    <Text style={styles.blockLabel}>ALSO GOING YOUR WAY · A SHORT WALK</Text>
                    <Text style={styles.metaTxt}>
                      These leave from a little further away: you meet the car at its own pickup and get out at its drop-off.
                    </Text>
                    {nearby.map((p) => <PoolCardView key={p.id} {...cardProps(p)} />)}
                  </>
                ) : null}
              </>
            )}
          </>
        )}

        {/* The older fixed-group flow (add colleagues by username, ask them all at once). */}
        <Pressable onPress={() => router.push('/passenger/fleet')} hitSlop={8} style={styles.fleetLink}>
          <Text style={styles.fleetLinkTxt}>Travel with a fixed group? Open your fleet ›</Text>
        </Pressable>
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
      <TimeSheet
        open={timeOpen}
        value={at}
        onClose={() => setTimeOpen(false)}
        onPick={(d) => {
          setAt(d);
          setTimeOpen(false);
        }}
      />
      <JoinSheet
        pool={joining}
        from={from}
        to={to}
        rates={cancellation}
        busy={joining !== null && busy === joining.id}
        onClose={() => setJoining(null)}
        onConfirm={(p) => void join(p)}
      />
      <RideSheet
        open={sheet !== null}
        edit={sheet?.edit ?? null}
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
 * take them. The fare sits on top of it on the card — together they are the
 * two things a rider decides on.
 */
function CarSeats({ taken, total, driver }: { taken: number; total: number; driver: boolean }) {
  // Front passenger first, then the back row, left to right as you look at it.
  const seats = [
    { x: 126, y: 66, w: 34, h: 30 },
    { x: 50, y: 22, w: 36, h: 24 },
    { x: 50, y: 48, w: 36, h: 24 },
    { x: 50, y: 74, w: 36, h: 24 },
  ].slice(0, total);
  return (
    <View style={styles.carWrap} accessible accessibilityLabel={`${taken} of ${total} seats taken`}>
      <Svg width={240} height={120} viewBox="0 0 240 120">
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

function PoolCardView({
  pool: p,
  busy,
  onJoin,
  onLeave,
  onOpenRide,
  onEdit,
  onRemove,
}: {
  pool: SharedPool;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onOpenRide: (tripId: string) => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const st = statusOf(p);
  const inIt = p.booked || p.aboardTripId !== null;
  const rung = Math.min(p.seatsTotal, inIt || p.state === 'full' ? p.riders : p.riders + 1);
  return (
    <View style={[styles.poolCard, p.state === 'full' && { opacity: 0.75 }]}>
      <View style={styles.poolHead}>
        <Text style={styles.poolTitle} numberOfLines={1}>{p.label ?? `To ${areaLabel(p.dropoff.address)}`}</Text>
        <View style={[styles.chip, st.tone === 'go' ? styles.chipGo : st.tone === 'full' ? styles.chipFull : styles.chipWait]}>
          <Text style={[styles.chipTxt, st.tone === 'go' && styles.chipTxtGo]}>{st.label}</Text>
        </View>
      </View>

      {/* The fare on top of the car. */}
      <Text style={styles.fareBig}>PKR {p.farePerSeat}</Text>
      <Text style={styles.fareSub}>
        {inIt ? 'your seat, so far' : p.state === 'full' ? 'per seat in this car' : 'per seat if you join now'}
      </Text>
      <CarSeats taken={p.state === 'full' ? p.seatsTotal : p.riders} total={p.seatsTotal} driver={!!p.driver} />
      <Text style={styles.seatsTxt}>
        {p.state === 'full'
          ? 'No seats left — an empty car opens here in 2 minutes'
          : `${p.seatsLeft} of ${p.seatsTotal} seats available`}
      </Text>
      <FareLadder ladder={p.fareLadder} at={rung} />

      <View style={styles.lines}>
        <Line icon={<PickupDotIcon size={14} color={colors.text} accent={colors.primary} />}>
          {p.pickup.address}
          {p.pickupDistanceM !== null ? <Text style={styles.lineMuted}>  · {distance(p.pickupDistanceM)} from you</Text> : null}
        </Line>
        <Line icon={<DestinationPinIcon size={14} color={colors.text} accent={colors.primary} />}>
          {p.dropoff.address}
          {p.dropoffDistanceM !== null ? (
            <Text style={styles.lineMuted}>  · {distance(p.dropoffDistanceM)} from your drop-off</Text>
          ) : null}
        </Line>
        <Text style={styles.metaTxt}>{departLine(p)}</Text>
        <Text style={styles.metaTxt}>
          {p.driver
            ? `${p.driver.name} · ${p.driver.vehicle}${p.driver.plate ? ` · ${p.driver.plate}` : ''}`
            : `${RIDE_TYPE_LABELS[p.rideType as RideType] ?? p.rideType} · no driver yet — the fare only drops as people join`}
        </Text>
      </View>

      {p.aboardTripId ? (
        <Pressable style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]} onPress={() => onOpenRide(p.aboardTripId!)}>
          <Text style={styles.joinTxt}>Open my ride</Text>
        </Pressable>
      ) : p.booked ? (
        <View style={styles.bookedRow}>
          <Text style={styles.bookedTxt}>Seat booked — not confirmed until a driver accepts</Text>
          <Pressable onPress={onLeave} hitSlop={8} accessibilityRole="button">
            <Text style={styles.cancelTxt}>Cancel seat</Text>
          </Pressable>
        </View>
      ) : p.state === 'full' ? null : (
        <Pressable
          style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
          onPress={onJoin}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.btnText} />
          ) : (
            <Text style={styles.joinTxt}>{p.needsDriverApproval ? 'Ask the driver' : 'Join'} · PKR {p.farePerSeat}</Text>
          )}
        </Pressable>
      )}

      {onEdit || onRemove ? (
        <View style={styles.ownerRow}>
          {onEdit ? (
            <Pressable onPress={onEdit} hitSlop={8}><Text style={styles.ownerTxt}>Edit name or time</Text></Pressable>
          ) : null}
          {onRemove ? (
            <Pressable onPress={onRemove} hitSlop={8}><Text style={styles.ownerTxt}>Remove from my list</Text></Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.line}>
      {icon}
      <Text style={styles.lineTxt} numberOfLines={2}>{children}</Text>
    </View>
  );
}

/** Nobody shares this route yet: the card of the car that would, ready to start. */
function NewRideCard({ dropoff, quote, onStart }: { dropoff: Place; quote: SharedFareQuote | null; onStart: () => void }) {
  return (
    <View style={styles.poolCard}>
      <View style={styles.poolHead}>
        <Text style={styles.poolTitle} numberOfLines={1}>To {areaLabel(dropoff.address)}</Text>
        <View style={[styles.chip, styles.chipWait]}><Text style={styles.chipTxt}>New</Text></View>
      </View>
      {quote ? (
        <>
          <Text style={styles.fareBig}>PKR {quote.perSeat[0]}</Text>
          <Text style={styles.fareSub}>alone — less for everyone as people join</Text>
        </>
      ) : (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 14 }} />
      )}
      <CarSeats taken={0} total={4} driver={false} />
      <Text style={styles.seatsTxt}>4 of 4 seats available</Text>
      {quote ? <FareLadder ladder={quote.perSeat} at={1} /> : null}
      <Text style={styles.metaTxt}>
        Start it now or at a daily time, and anyone going the same way can join you.
      </Text>
      <Pressable style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]} onPress={onStart} accessibilityRole="button">
        <Text style={styles.joinTxt}>Start this shared ride</Text>
      </Pressable>
    </View>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

/** Everything a rider agrees to before the seat is theirs. */
function JoinSheet({
  pool: p,
  from,
  to,
  rates,
  busy,
  onClose,
  onConfirm,
}: {
  pool: SharedPool | null;
  from: Place | null;
  to: Place | null;
  rates: { poolLeaveRate: number; poolLeaveArrivedRate: number };
  busy: boolean;
  onClose: () => void;
  onConfirm: (p: SharedPool) => void;
}) {
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const later = p.state === 'gathering' && !!p.departTime;
  // On the route the car collects you at your own stops; a short walk away, at its own.
  const own = !p.nearby && from && to;
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  return (
    <Sheet open onClose={onClose}>
      <Text style={styles.sheetTitle}>{p.state === 'gathering' ? 'Book your seat' : 'Join this car'}</Text>
      <Text style={styles.sheetName} numberOfLines={2}>{p.label ?? `To ${areaLabel(p.dropoff.address)}`}</Text>
      <SheetRow label="YOUR PICKUP">
        {own ? `${from.address} — the car collects you here` : `${p.pickup.address}${p.pickupDistanceM !== null ? ` — ${distance(p.pickupDistanceM)} walk from you` : ''}`}
      </SheetRow>
      <SheetRow label="YOUR DROP-OFF">
        {own ? to.address : `${p.dropoff.address}${p.dropoffDistanceM !== null ? ` — ${distance(p.dropoffDistanceM)} from yours` : ''}`}
      </SheetRow>
      <SheetRow label="WHEN">{departLine(p)}</SheetRow>
      <SheetRow label="YOUR FARE">
        PKR {p.farePerSeat} now, cash to the driver — your own route at the car’s size. It goes down as people join
        (PKR {p.fareLadder[2]} with 3 in the car), and never above PKR {p.soloFare}, riding alone.
      </SheetRow>
      <SheetRow label="DRIVER">
        {p.driver
          ? `${p.driver.name} · ${p.driver.vehicle}${p.driver.plate ? ` · ${p.driver.plate}` : ''}${p.needsDriverApproval ? ' — they have to agree to take you' : ''}`
          : later
            ? 'Not yet. Drivers are asked 10 minutes before the car leaves. Your ride is not confirmed until one accepts — we will notify you.'
            : 'Not yet. Drivers nearby are asked as soon as you join. Your ride is not confirmed until one accepts.'}
      </SheetRow>
      <SheetRow label="LEAVING">
        Free until a driver accepts. After that, {pct(rates.poolLeaveRate)} of your fare —{' '}
        {pct(rates.poolLeaveArrivedRate)} once the driver is at the pickup. If someone else leaves and your share goes
        up, you are told — and can leave free until a driver accepts.
      </SheetRow>
      <Pressable
        style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
        onPress={() => onConfirm(p)}
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
      <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center' }}>
        <Text style={styles.cancelTxt}>Not now</Text>
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

/** Start a shared ride on the searched route — or, with `edit`, rename or retime one. */
function RideSheet({
  open,
  edit,
  from,
  to,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  edit: SharedPool | null;
  from: Place | null;
  to: Place | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: { label: string; departTime: string | null; rideType: SharedCar }) => void;
}) {
  const [label, setLabel] = useState('');
  const [timed, setTimed] = useState(false);
  const [time, setTime] = useState(nextHalfHour);
  const [picking, setPicking] = useState(false);
  const [rideType, setRideType] = useState<SharedCar>('mini');
  const [quote, setQuote] = useState<SharedFareQuote | null>(null);

  useEffect(() => {
    if (!open) return;
    setLabel(edit?.label ?? '');
    setTimed(!!edit?.departTime);
    setTime(fromHHMM(edit?.departTime ?? null, nextHalfHour()));
    setRideType('mini');
  }, [open, edit]);

  useEffect(() => {
    setQuote(null);
    if (!open || edit || !from || !to) return;
    let live = true;
    api
      .getSharedRideFare({ rideType, pickup: { lat: from.lat, lng: from.lng }, dropoff: { lat: to.lat, lng: to.lng } })
      .then((q) => live && setQuote(q))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, edit, rideType, from, to]);

  function picked(event: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setPicking(false);
    if (event.type === 'set' && d) setTime(d);
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Text style={styles.sheetTitle}>{edit ? 'Edit your shared ride' : 'Start a shared ride'}</Text>
      {edit ? null : (
        <>
          <SheetRow label="PICKUP">{from?.address ?? '—'}</SheetRow>
          <SheetRow label="DROP-OFF">{to?.address ?? '—'}</SheetRow>
          {/* The pickup defaults to where the phone is — often a front door. */}
          <Text style={styles.metaTxt}>
            Everyone going this way sees the pickup and drop-off. A landmark or gate is better than your door.
          </Text>
        </>
      )}

      <Text style={styles.sheetLabel}>NAME IT (OPTIONAL)</Text>
      <TextInput
        style={styles.sheetInput}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Bahria University, E-8"
        placeholderTextColor={colors.muted}
        maxLength={60}
      />

      <Text style={styles.sheetLabel}>WHEN DOES IT LEAVE?</Text>
      <View style={styles.choiceRow}>
        <Pressable style={[styles.choice, !timed && styles.choiceOn]} onPress={() => setTimed(false)} accessibilityRole="radio" accessibilityState={{ selected: !timed }}>
          <Text style={[styles.choiceTxt, !timed && styles.choiceTxtOn]}>As soon as a driver accepts</Text>
        </Pressable>
        <Pressable style={[styles.choice, timed && styles.choiceOn]} onPress={() => setTimed(true)} accessibilityRole="radio" accessibilityState={{ selected: timed }}>
          <Text style={[styles.choiceTxt, timed && styles.choiceTxtOn]}>Every day at a time</Text>
        </Pressable>
      </View>
      {timed ? (
        Platform.OS === 'ios' ? (
          <DateTimePicker value={time} mode="time" display="spinner" textColor={colors.text} onChange={picked} />
        ) : (
          <>
            <Pressable style={styles.timeBtn} onPress={() => setPicking(true)} accessibilityRole="button">
              <Text style={styles.timeTxt}>{clockLabel(toHHMM(time))}</Text>
              <Text style={styles.cancelTxt}>Change</Text>
            </Pressable>
            {picking ? <DateTimePicker value={time} mode="time" display="default" onChange={picked} /> : null}
          </>
        )
      ) : null}
      <Text style={styles.metaTxt}>
        {timed
          ? 'Seats are booked for the time. Drivers are asked 10 minutes before — or the moment all 4 seats are taken. After each car leaves, the next one opens here.'
          : 'Drivers nearby are asked as soon as it starts. Anyone going your way can join until the car leaves.'}
      </Text>

      {edit ? null : (
        <>
          <Text style={styles.sheetLabel}>CAR</Text>
          <View style={styles.choiceRow}>
            {SHARED_CARS.map((c) => (
              <Pressable
                key={c.key}
                style={[styles.choice, rideType === c.key && styles.choiceOn]}
                onPress={() => setRideType(c.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: rideType === c.key }}
              >
                <Text style={[styles.choiceTxt, rideType === c.key && styles.choiceTxtOn]}>{RIDE_TYPE_LABELS[c.key]}</Text>
                <Text style={styles.choiceNote}>{c.note}</Text>
              </Pressable>
            ))}
          </View>
          {quote ? (
            <>
              <FareLadder ladder={quote.perSeat} at={1} />
              <Text style={styles.metaTxt}>
                Your seat is PKR {quote.perSeat[0]} if nobody joins, and it drops for everyone as people do. The driver
                earns up to PKR {(quote.perSeat[3] ?? 0) * 4} with all 4 seats taken. Cash to the driver.
              </Text>
            </>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </>
      )}

      <Pressable
        style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
        onPress={() => onSubmit({ label, departTime: timed ? toHHMM(time) : null, rideType })}
        disabled={busy || (!edit && (!from || !to))}
        accessibilityRole="button"
      >
        {busy ? <ActivityIndicator color={colors.btnText} /> : <Text style={styles.joinTxt}>{edit ? 'Save' : 'Start and book my seat'}</Text>}
      </Pressable>
      <Pressable onPress={onClose} hitSlop={8} style={{ alignSelf: 'center' }}>
        <Text style={styles.cancelTxt}>Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

/** "Leaving around" — for riders who are not flexible about when they go. */
function TimeSheet({
  open,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  value: Date | null;
  onClose: () => void;
  onPick: (d: Date) => void;
}) {
  const [time, setTime] = useState(nextHalfHour);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (open) setTime(value ?? nextHalfHour());
  }, [open, value]);

  function picked(event: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setPicking(false);
    if (event.type === 'set' && d) setTime(d);
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <Text style={styles.sheetTitle}>Leaving around</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker value={time} mode="time" display="spinner" textColor={colors.text} onChange={picked} />
      ) : (
        <>
          <Pressable style={styles.timeBtn} onPress={() => setPicking(true)} accessibilityRole="button">
            <Text style={styles.timeTxt}>{clockLabel(toHHMM(time))}</Text>
            <Text style={styles.cancelTxt}>Change</Text>
          </Pressable>
          {picking ? <DateTimePicker value={time} mode="time" display="default" onChange={picked} /> : null}
        </>
      )}
      <Text style={styles.metaTxt}>
        Shows shared rides leaving within an hour of this time — and rides that leave on demand when it is soon.
      </Text>
      <Pressable style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]} onPress={() => onPick(time)}>
        <Text style={styles.joinTxt}>Show rides around {clockLabel(toHHMM(time))}</Text>
      </Pressable>
    </Sheet>
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
  mineBtn: {
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  mineBtnOn: { backgroundColor: colors.btnBg, borderColor: colors.btnBg },
  mineBtnTxt: { fontSize: 13, fontWeight: '900', color: colors.text },
  mineBtnTxtOn: { color: colors.btnText },
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

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  timeChip: {
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  timeChipOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  timeChipTxt: { fontSize: 13, fontWeight: '800', color: colors.muted },
  timeChipTxtOn: { color: colors.primary },

  predictions: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  predictionRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  predictionMain: { color: colors.text, fontSize: 14, fontWeight: '800' },
  predictionSub: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2 },

  hint: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19, textAlign: 'center', marginTop: 8 },
  blockLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, marginTop: 4 },

  poolCard: {
    borderRadius: 20, padding: 16, gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.glassLimeBorder,
  },
  poolHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  poolTitle: { flex: 1, fontSize: 15.5, fontWeight: '900', color: colors.text },
  chip: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4 },
  chipWait: { backgroundColor: 'rgba(251,191,36,0.18)' },
  chipGo: { backgroundColor: colors.primary },
  chipFull: { backgroundColor: colors.border },
  chipTxt: { fontSize: 11.5, fontWeight: '900', color: colors.text },
  chipTxtGo: { color: '#0b1a00' },
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

  lines: { gap: 6, marginTop: 2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineTxt: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.text },
  lineMuted: { fontSize: 12, fontWeight: '600', color: colors.muted },
  metaTxt: { fontSize: 12.5, fontWeight: '600', color: colors.muted, lineHeight: 18 },

  joinBtn: {
    height: 50, borderRadius: 14, backgroundColor: colors.btnBg, marginTop: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  joinTxt: { fontSize: 15, fontWeight: '900', color: colors.btnText },
  bookedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4,
    borderRadius: 14, padding: 12, backgroundColor: colors.glassLime,
  },
  bookedTxt: { flex: 1, fontSize: 12.5, fontWeight: '800', color: colors.text },
  cancelTxt: { fontSize: 13, fontWeight: '800', color: colors.muted },
  ownerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  ownerTxt: { fontSize: 12.5, fontWeight: '800', color: colors.muted },

  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  addPlus: { fontSize: 20, fontWeight: '900', color: colors.primary, marginTop: -2 },
  addTxt: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.text },

  fleetLink: { alignSelf: 'center', paddingVertical: 6 },
  fleetLinkTxt: { fontSize: 12.5, fontWeight: '800', color: colors.muted },

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
  timeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 14, paddingVertical: 12,
  },
  timeTxt: { fontSize: 18, fontWeight: '900', color: colors.primary },
  cityRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  cityRowTxt: { fontSize: 15, fontWeight: '800', color: colors.text },
  cityRowSub: { fontSize: 11.5, fontWeight: '600', color: colors.muted, marginTop: 1 },
}));
