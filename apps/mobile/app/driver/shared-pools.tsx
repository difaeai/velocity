/**
 * Shared rides to take — the driver's side of Ride sharing (backend sharedPools/).
 *
 *   Near you   Shared rides with riders booked and no driver yet: where they go,
 *              when, who is in it and in what order to collect them, and what the
 *              car pays now and full. Take a car that is already out ("take it
 *              now"), or accept the next one ahead of time — the riders are told
 *              who is coming, and the car comes straight to you when it goes out.
 *   My route   Where you are driving and when. Shared rides along that road are
 *              suggested for you to accept; or post the route itself, and riders
 *              on it book seats in a car you already drive.
 *
 * Nothing is accepted for you: every car here is yours only after you tap.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { api, type DriverPoolView } from '../../src/api/client';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { RIDE_TYPE_LABELS, type RideType } from '../../src/domain/types';
import { PAKISTAN_CITIES } from '../../src/domain/intercityTypes';
import { useCurrentLocation } from '../../src/hooks/location';
import { useForegroundInterval } from '../../src/hooks/useForegroundInterval';
import { fetchPlaceDetail, usePlacesAutocomplete, type PlacePrediction } from '../../src/hooks/places';
import { areaLabel } from '../../src/lib/areaLabel';
import { clockLabel, toHHMM } from '../../src/lib/dailyRouteTime';
import { Text, TextInput } from '../../src/ui/Text';
import { DestinationPinIcon, PickupDotIcon } from '../../src/ui/RideIcons';
import { ArrowIcon } from '../../src/ui/ServiceIcons';

type Place = { lat: number; lng: number; address: string };
type Field = 'from' | 'to';

// Places API (New) requires session tokens to be UUID v4.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const errorText = (e: unknown) => (e instanceof FirebaseError ? e.message : 'Please try again.');

/** "Today 8:00 AM" / "Tomorrow 8:00 AM" / "Leaving now". */
function whenOf(j: Pick<DriverPoolView, 'departsAtMs' | 'liveTripId'>): string {
  if (j.liveTripId) return 'Car is out now — waiting for a driver';
  if (!j.departsAtMs) return 'Leaves as soon as a driver takes it';
  const d = new Date(j.departsAtMs);
  const day = d.toDateString() === new Date().toDateString() ? 'Today' : 'Tomorrow';
  return `${day} ${clockLabel(toHHMM(d))}`;
}

export default function DriverSharedPools() {
  const router = useRouter();
  const { coords, address } = useCurrentLocation();
  const [tab, setTab] = useState<'near' | 'route'>('near');
  const [jobs, setJobs] = useState<DriverPoolView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!coords) return;
    api.getDriverPools({ lat: coords.lat, lng: coords.lng }).then((r) => setJobs(r.pools)).catch(() => setJobs((j) => j ?? []));
    // Keyed on coordinates: a new coords object for the same fix must not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.lat, coords?.lng]);
  useEffect(() => load(), [load]);
  useForegroundInterval(tab === 'near' ? load : null, 30_000);

  async function accept(j: DriverPoolView, after?: () => void) {
    setBusy(j.id);
    try {
      const res = await api.acceptSharedPool({ poolId: j.id });
      if (res.status === 'matched') {
        Alert.alert('The car is yours', 'Head to the first pickup — the riders have been told you are coming.', [
          { text: 'Open home', onPress: () => router.replace('/driver/home') },
        ]);
      } else {
        Alert.alert(
          'You are driving it',
          `${whenOf(j)}. The riders have been told who is coming; the car comes straight to you when it goes out.`,
        );
      }
      load();
      after?.();
    } catch (e) {
      Alert.alert('Could not take it', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function withdraw(j: DriverPoolView, after?: () => void) {
    Alert.alert('Give this ride back?', 'The riders are told, and other drivers are asked when the car goes out.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Give it back',
        style: 'destructive',
        onPress: () => {
          api.withdrawSharedPool({ poolId: j.id }).then(() => { load(); after?.(); }).catch((e) => Alert.alert('Could not give it back', errorText(e)));
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/driver/home'))}
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
          <Text style={styles.title}>Shared rides</Text>
          <Text style={styles.subtitle}>Take one now, or ahead of time</Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(['near', 'route'] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabOn]}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[styles.tabTxt, tab === t && styles.tabTxtOn]}>{t === 'near' ? 'Near you' : 'My route'}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {tab === 'near' ? (
          !coords ? (
            <Text style={styles.hint}>Turn on location to see shared rides near you.</Text>
          ) : jobs === null ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
          ) : jobs.length === 0 ? (
            <Text style={styles.hint}>No shared rides need a driver near you right now. Riders booking seats show up here.</Text>
          ) : (
            jobs.map((j) => (
              <JobCard key={j.id} job={j} busy={busy === j.id} onAccept={() => void accept(j)} onWithdraw={() => withdraw(j)} />
            ))
          )
        ) : (
          <MyRoute here={coords && address ? { lat: coords.lat, lng: coords.lng, address } : null} onAccept={accept} onWithdraw={withdraw} busy={busy} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One shared ride as a job: where, when, who and in what order, and the money. */
function JobCard({
  job: j,
  busy,
  onAccept,
  onWithdraw,
}: {
  job: DriverPoolView;
  busy: boolean;
  onAccept: () => void;
  onWithdraw: () => void;
}) {
  return (
    <View style={[styles.card, j.mine && styles.cardMine]}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>{j.label ?? `To ${areaLabel(j.dropoff.address)}`}</Text>
        <Text style={styles.car}>{RIDE_TYPE_LABELS[j.rideType as RideType] ?? j.rideType}</Text>
      </View>
      <Text style={styles.when}>{whenOf(j)}</Text>

      <View style={styles.money}>
        <View style={styles.moneyBox}>
          <Text style={styles.moneyNum}>PKR {j.earnNow}</Text>
          <Text style={styles.moneyLbl}>{j.riders} rider{j.riders === 1 ? '' : 's'} now</Text>
        </View>
        <View style={styles.moneyBox}>
          <Text style={[styles.moneyNum, { color: colors.text }]}>PKR {j.earnIfFull}</Text>
          <Text style={styles.moneyLbl}>if all 4 seats fill</Text>
        </View>
      </View>
      <Text style={styles.meta}>
        {j.routeKm} km route{j.toPickupKm !== null ? ` · ${j.toPickupKm} km to the first pickup` : ''} · {j.seatsLeft} seat
        {j.seatsLeft === 1 ? '' : 's'} free. More riders are not guaranteed.
      </Text>

      {j.stops.length > 0 ? (
        <View style={styles.stops}>
          {j.stops.map((s, i) => (
            <View key={i} style={styles.stopRow}>
              <View style={[styles.stopNo, s.kind === 'dropoff' && styles.stopNoDrop]}>
                <Text style={styles.stopNoTxt}>{i + 1}</Text>
              </View>
              {s.kind === 'pickup'
                ? <PickupDotIcon size={13} color={colors.text} accent={colors.primary} />
                : <DestinationPinIcon size={13} color={colors.text} accent={colors.primary} />}
              <Text style={styles.stopTxt} numberOfLines={1}>
                {s.kind === 'pickup' ? 'Pick up' : 'Drop'} {s.name} · {s.address}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {j.mine ? (
        <View style={styles.mineRow}>
          <Text style={styles.mineTxt}>You are driving this one</Text>
          <Pressable onPress={onWithdraw} hitSlop={8} accessibilityRole="button">
            <Text style={styles.withdrawTxt}>Give it back</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.btnText} />
          ) : (
            <Text style={styles.btnTxt}>{j.liveTripId ? `Take it now · PKR ${j.earnNow}` : 'Accept — I will drive it'}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/** Where the driver is going and when: rides along it, or post the route itself. */
function MyRoute({
  here,
  onAccept,
  onWithdraw,
  busy,
}: {
  here: Place | null;
  onAccept: (j: DriverPoolView, after?: () => void) => Promise<void>;
  onWithdraw: (j: DriverPoolView, after?: () => void) => void;
  busy: string | null;
}) {
  const [fromText, setFromText] = useState('');
  const [from, setFrom] = useState<Place | null>(null);
  const [toText, setToText] = useState('');
  const [to, setTo] = useState<Place | null>(null);
  const [field, setField] = useState<Field | null>(null);
  const [timed, setTimed] = useState(false);
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
    return d;
  });
  const [picking, setPicking] = useState(false);
  const [label, setLabel] = useState('');
  const [found, setFound] = useState<DriverPoolView[] | null>(null);
  const [working, setWorking] = useState<'find' | 'post' | null>(null);
  const tokenRef = useRef(uuidv4());

  // The road starts where the driver is, until they type.
  useEffect(() => {
    if (here && !from && !fromText) {
      setFrom(here);
      setFromText(here.address);
    }
  }, [here, from, fromText]);

  const { predictions, loading } = usePlacesAutocomplete(field === 'from' ? fromText : field === 'to' ? toText : '', tokenRef.current);

  function type(which: Field, text: string) {
    setField(which);
    setFound(null);
    if (which === 'from') {
      setFromText(text);
      setFrom(null);
    } else {
      setToText(text);
      setTo(null);
    }
  }

  async function choose(pred: PlacePrediction) {
    const which = field;
    if (!which) return;
    setField(null);
    Keyboard.dismiss();
    const name = pred.mainText && pred.secondaryText ? `${pred.mainText}, ${pred.secondaryText}` : pred.fullText;
    if (which === 'from') setFromText(name);
    else setToText(name);
    const detail = await fetchPlaceDetail(pred, tokenRef.current);
    tokenRef.current = uuidv4();
    if (!detail) {
      Alert.alert('Could not find that place', 'Please pick another suggestion.');
      return;
    }
    const place = { lat: detail.lat, lng: detail.lng, address: name };
    if (which === 'from') setFrom(place);
    else setTo(place);
  }

  const departTime = timed ? toHHMM(time) : null;

  async function find() {
    if (!from || !to) return;
    setWorking('find');
    try {
      setFound((await api.findPoolsForRoute({ pickup: from, dropoff: to, departTime })).pools);
    } catch (e) {
      Alert.alert('Could not search', errorText(e));
    } finally {
      setWorking(null);
    }
  }

  async function post() {
    if (!from || !to) return;
    setWorking('post');
    const a = from.address.toLowerCase();
    const city = PAKISTAN_CITIES.find((c) => a.includes(c.name.toLowerCase()))?.id ?? 'islamabad';
    try {
      await api.offerDriverRoute({ city, label: label.trim() || null, departTime, pickup: from, dropoff: to });
      Alert.alert(
        'Your route is up',
        'Riders going your way can book seats in your car now. When it goes out it comes straight to you.',
      );
      void find();
    } catch (e) {
      Alert.alert('Could not post it', errorText(e));
    } finally {
      setWorking(null);
    }
  }

  function picked(event: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') setPicking(false);
    if (event.type === 'set' && d) setTime(d);
  }

  return (
    <>
      <View style={styles.routeBox}>
        <View style={styles.fieldRow}>
          <PickupDotIcon size={16} color={colors.text} accent={colors.primary} />
          <TextInput style={styles.fieldInput} value={fromText} onChangeText={(t) => type('from', t)} placeholder="Driving from" placeholderTextColor={colors.muted} maxLength={200} />
        </View>
        <View style={styles.divider} />
        <View style={styles.fieldRow}>
          <DestinationPinIcon size={16} color={colors.text} accent={colors.primary} />
          <TextInput style={styles.fieldInput} value={toText} onChangeText={(t) => type('to', t)} placeholder="Driving to" placeholderTextColor={colors.muted} maxLength={200} />
        </View>
      </View>
      {field && (loading || predictions.length > 0) ? (
        <View style={styles.predictions}>
          {loading && predictions.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 12 }} />
          ) : (
            predictions.slice(0, 5).map((p) => (
              <Pressable key={p.placeId} style={styles.predictionRow} onPress={() => void choose(p)}>
                <Text style={styles.predictionMain} numberOfLines={1}>{p.mainText}</Text>
                {p.secondaryText ? <Text style={styles.meta} numberOfLines={1}>{p.secondaryText}</Text> : null}
              </Pressable>
            ))
          )}
        </View>
      ) : null}

      <View style={styles.choiceRow}>
        <Pressable style={[styles.choice, !timed && styles.choiceOn]} onPress={() => setTimed(false)} accessibilityRole="radio" accessibilityState={{ selected: !timed }}>
          <Text style={[styles.choiceTxt, !timed && styles.choiceTxtOn]}>Leaving now</Text>
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
              <Text style={styles.meta}>Change</Text>
            </Pressable>
            {picking ? <DateTimePicker value={time} mode="time" display="default" onChange={picked} /> : null}
          </>
        )
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.btn, (!from || !to) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
        onPress={() => void find()}
        disabled={!from || !to || working !== null}
        accessibilityRole="button"
      >
        {working === 'find' ? <ActivityIndicator color={colors.btnText} /> : <Text style={styles.btnTxt}>Find riders on my route</Text>}
      </Pressable>

      {found !== null ? (
        <>
          <Text style={styles.blockLabel}>SHARED RIDES ALONG YOUR ROUTE · {found.length}</Text>
          {found.length === 0 ? (
            <Text style={styles.hint}>Nobody has booked along this road around that time yet. Post your route so they can.</Text>
          ) : (
            found.map((j) => (
              <JobCard key={j.id} job={j} busy={busy === j.id} onAccept={() => void onAccept(j, find)} onWithdraw={() => onWithdraw(j, find)} />
            ))
          )}
          <Text style={styles.blockLabel}>OR POST YOUR ROUTE FOR RIDERS</Text>
          <TextInput style={styles.input} value={label} onChangeText={setLabel} placeholder="Name it (optional) — e.g. G-10 to Blue Area" placeholderTextColor={colors.muted} maxLength={60} />
          <Pressable
            style={({ pressed }) => [styles.btnOutline, pressed && { opacity: 0.85 }]}
            onPress={() => void post()}
            disabled={working !== null}
            accessibilityRole="button"
          >
            {working === 'post' ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.btnOutlineTxt}>Post my route — riders book seats in my car</Text>}
          </Pressable>
        </>
      ) : null}
    </>
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
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  tabOn: { backgroundColor: colors.btnBg, borderColor: colors.btnBg },
  tabTxt: { fontSize: 14, fontWeight: '900', color: colors.text },
  tabTxtOn: { color: colors.btnText },
  scroll: { padding: 16, gap: 12, paddingBottom: 40 },
  hint: { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19, textAlign: 'center', marginTop: 12 },
  blockLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, marginTop: 6 },

  card: { borderRadius: 18, padding: 14, gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardMine: { borderColor: colors.primary },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15.5, fontWeight: '900', color: colors.text },
  car: { fontSize: 12, fontWeight: '800', color: colors.muted },
  when: { fontSize: 13, fontWeight: '800', color: colors.primary },
  money: { flexDirection: 'row', gap: 8 },
  moneyBox: { flex: 1, borderRadius: 12, padding: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  moneyNum: { fontSize: 18, fontWeight: '900', color: colors.primary },
  moneyLbl: { fontSize: 11, fontWeight: '700', color: colors.muted, marginTop: 1 },
  meta: { fontSize: 12, fontWeight: '600', color: colors.muted, lineHeight: 17 },
  stops: { gap: 6, marginTop: 2 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopNo: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stopNoDrop: { backgroundColor: colors.border },
  stopNoTxt: { fontSize: 11, fontWeight: '900', color: '#0b1a00' },
  stopTxt: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.text },
  mineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: 12, backgroundColor: colors.glassLime },
  mineTxt: { fontSize: 13, fontWeight: '900', color: colors.text },
  withdrawTxt: { fontSize: 13, fontWeight: '800', color: colors.danger },

  btn: { height: 48, borderRadius: 14, backgroundColor: colors.btnBg, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  btnTxt: { fontSize: 14.5, fontWeight: '900', color: colors.btnText },
  btnOutline: { height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  btnOutlineTxt: { fontSize: 14, fontWeight: '900', color: colors.primary },

  routeBox: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  fieldInput: { flex: 1, color: colors.text, fontSize: 14.5, fontWeight: '700', paddingVertical: 13 },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 39 },
  predictions: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  predictionRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  predictionMain: { color: colors.text, fontSize: 14, fontWeight: '800' },
  input: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
    paddingHorizontal: 13, paddingVertical: 11, color: colors.text, fontSize: 14.5, fontWeight: '700',
  },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  choiceOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  choiceTxt: { fontSize: 13.5, fontWeight: '900', color: colors.text },
  choiceTxtOn: { color: colors.primary },
  timeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 12, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 14, paddingVertical: 12,
  },
  timeTxt: { fontSize: 18, fontWeight: '900', color: colors.primary },
}));
