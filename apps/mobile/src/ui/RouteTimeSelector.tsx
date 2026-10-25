/**
 * "Location & time" — the rider's regular trips, set from the map.
 *
 * A pill under the sharing-preference pill, and the sheet it opens. Each entry
 * is a pickup, a drop-off and an OPTIONAL time, saved to
 * `users/{uid}/dailyRoutes` — the same documents "My routes" edits, and the
 * ones the backend already matches every new public shared ride against
 * (backend/functions/src/dailyRoutes → notifyDailyRouteMatches): a ride that
 * starts near the pickup and ends near the drop-off sends the rider an alert.
 * With a time it has to leave within an hour of it; without one, any hour
 * counts. So a time is never required — it only narrows the alerts to the
 * ones the rider can actually take.
 *
 * The + on the pill opens the sheet straight on a new route, because "I make
 * more than one trip" is the reason somebody comes back to it.
 *
 * Places are picked from suggestions, never typed and trusted: the matching is
 * on coordinates, and a name with no pin behind it is the (0, 0) bug that kept
 * the commute schedules dead for months (see app/passenger/commute.tsx).
 *
 * Colours are light-on-dark literals, as in ShareGenderSelector: the pill
 * floats over a dark map and the sheet is dark in both themes.
 */
import { useEffect, useRef, useState } from 'react';
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
import DateTimePicker from '@react-native-community/datetimepicker';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { api, type TravelAreas } from '../api/client';
import { db } from '../firebase';
import { t } from '../i18n';
import type { DailyRoute, RoutePlace } from '../hooks/passenger';
import { fetchPlaceDetail, usePlacesAutocomplete, type PlacePrediction } from '../hooks/places';
import { areaLabel } from '../lib/areaLabel';
import { clockLabel, fromHHMM, toHHMM } from '../lib/dailyRouteTime';
import { themed } from '../theme';
import { DestinationPinIcon, PickupDotIcon } from './RideIcons';
import { ClockIcon } from './ServiceIcons';
import { Text, TextInput } from './Text';
import { GenderTally } from './TravelAreas';

const LIME = '#ccff00';

/** Where a new time starts — the same default "My routes" has always used. */
const DEFAULT_TIME = '08:30';

// Places API (New) requires session tokens to be UUID v4.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ── The map pill ──────────────────────────────────────────────────────────
   Dark glass like the answered sharing pill, because it is the same kind of
   thing: a standing setting, not a question. Nothing until the routes have been
   read, so it never says "add your route" to someone who has one. ── */
export function RouteTimePill({
  routes,
  onOpen,
  onAdd,
}: {
  routes: DailyRoute[] | null;
  onOpen: () => void;
  onAdd: () => void;
}) {
  if (routes === null) return null;

  const first = routes[0];
  // One route names its places and its time; several just say how many — the
  // sheet lists them. The time is never the part that gets cut off.
  const label = !first
    ? 'Location & time'
    : routes.length === 1
      ? `${areaLabel(first.pickup.address)} to ${areaLabel(first.dropoff.address)}`
      : `${routes.length} ${t('routes saved')}`;
  const sub = !first ? 'add your route' : routes.length === 1 ? clockLabel(first.time) ?? 'Any time' : null;

  return (
    // Full width of the left column so the pill has to shrink inside it; box-none
    // so the empty end of the row still lets the map pan.
    <View style={styles.pillRow} pointerEvents="box-none">
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={
          first ? `Your routes: ${routes.length}. Tap to see or change them.` : 'Set your pickup, drop-off and time'
        }
      >
        <DestinationPinIcon size={14} color="#ffffff" accent={LIME} />
        <Text style={styles.pillLabel} numberOfLines={1}>{label}</Text>
        {sub ? <Text style={styles.pillSub} numberOfLines={1}>{sub}</Text> : null}
        <Text style={styles.pillChevron}>›</Text>
      </Pressable>

      <Pressable
        onPress={onAdd}
        style={({ pressed }) => [styles.plus, pressed && { opacity: 0.8 }]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Add another route and time"
      >
        <Text style={styles.plusTxt}>+</Text>
      </Pressable>
    </View>
  );
}

type Field = 'pickup' | 'dropoff';

interface Draft {
  /** null while it is a new route. */
  id: string | null;
  pickup: RoutePlace | null;
  pickupText: string;
  dropoff: RoutePlace | null;
  dropoffText: string;
  time: string | null;
}

function blankDraft(here: RoutePlace | null): Draft {
  // Most regular trips start where the rider is standing when they save one.
  return {
    id: null,
    pickup: here,
    pickupText: here?.address ?? '',
    dropoff: null,
    dropoffText: '',
    time: null,
  };
}

function draftFrom(r: DailyRoute): Draft {
  return {
    id: r.id,
    pickup: r.pickup,
    pickupText: r.pickup.address,
    dropoff: r.dropoff,
    dropoffText: r.dropoff.address,
    time: r.time ?? null,
  };
}

/* ── The sheet ─────────────────────────────────────────────────────────────
   The list of saved routes, or the editor for one of them. The editor opens
   straight away from the + and whenever there is nothing to list yet, so a
   first-time tap goes directly to "where from, where to, when". ── */
export function RouteTimeSheet({
  open,
  startWith,
  routes,
  uid,
  here,
  onClose,
}: {
  open: boolean;
  /** 'add' opens on a new route — the pill's + button. */
  startWith: 'list' | 'add';
  routes: DailyRoute[] | null;
  uid: string | undefined;
  /** Where the rider is now, to start a new route's pickup from. */
  here: RoutePlace | null;
  onClose: () => void;
}) {
  const rise = useRef(new Animated.Value(0)).current;
  const [draft, setDraft] = useState<Draft | null>(null);
  /** The field the suggestions belong to, while it is being typed in. */
  const [field, setField] = useState<Field | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const tokenRef = useRef(uuidv4());

  const { predictions } = usePlacesAutocomplete(
    draft && field ? (field === 'pickup' ? draft.pickupText : draft.dropoffText) : '',
    tokenRef.current,
  );

  // Who else already travels the route being drafted, once both ends are real
  // places: the reason to save it, said before the rider has to.
  const [sameWay, setSameWay] = useState<TravelAreas['sameWay'] | 'loading'>(null);
  const from = draft?.pickup;
  const to = draft?.dropoff;
  useEffect(() => {
    if (!from || !to) {
      setSameWay(null);
      return;
    }
    let live = true;
    setSameWay('loading');
    api
      .getTravelAreas({
        lat: from.lat,
        lng: from.lng,
        radiusKm: 1,
        route: { from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng } },
      })
      .then((res) => live && setSameWay(res.sameWay))
      .catch(() => live && setSameWay(null));
    return () => {
      live = false;
    };
    // Keyed on coordinates, so picking the same place again does not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from?.lat, from?.lng, to?.lat, to?.lng]);

  useEffect(() => {
    Animated.timing(rise, {
      toValue: open ? 1 : 0,
      duration: open ? 240 : 160,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [open, rise]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setField(null);
      setPicking(false);
      return;
    }
    if (startWith === 'add' || routes?.length === 0) setDraft(blankDraft(here));
    // Only on opening: a route list or a GPS fix arriving must not reset a draft
    // the rider is in the middle of typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startWith]);

  function type(which: Field, text: string) {
    setField(which);
    // Typing un-pins the place: the name and the place must never disagree.
    setDraft((d) => d && (which === 'pickup'
      ? { ...d, pickupText: text, pickup: null }
      : { ...d, dropoffText: text, dropoff: null }));
  }

  async function choose(pred: PlacePrediction) {
    const which = field;
    if (!which) return;
    setField(null);
    // The keyboard would otherwise sit over the time choice and Save.
    Keyboard.dismiss();
    setDraft((d) => d && (which === 'pickup'
      ? { ...d, pickupText: pred.fullText }
      : { ...d, dropoffText: pred.fullText }));
    const detail = await fetchPlaceDetail(pred, tokenRef.current);
    tokenRef.current = uuidv4(); // rotate: the detail call closed the billing session
    if (!detail) {
      Alert.alert('Could not find that place', 'Please pick another suggestion.');
      return;
    }
    const place: RoutePlace = { lat: detail.lat, lng: detail.lng, address: pred.fullText };
    // Only if the field still says what was picked — the rider may have typed on.
    setDraft((d) => {
      if (!d) return d;
      if (which === 'pickup') return d.pickupText === pred.fullText ? { ...d, pickup: place } : d;
      return d.dropoffText === pred.fullText ? { ...d, dropoff: place } : d;
    });
  }

  function setTime(time: string | null) {
    setDraft((d) => d && { ...d, time });
  }

  function openTimePicker() {
    // iOS shows a spinner inline with no OK button, so the time it opens on is
    // the time that is set; Android's dialog sets it only on OK.
    if (Platform.OS === 'ios' && draft?.time === null) setTime(DEFAULT_TIME);
    setPicking(true);
  }

  function cancelEdit() {
    setField(null);
    setPicking(false);
    if (routes && routes.length > 0) setDraft(null);
    else onClose();
  }

  async function save() {
    if (!uid || !draft) return;
    if (!draft.pickup) {
      Alert.alert('Choose your pickup', 'Pick where you start from the suggestions, so we have the real place and not just its name.');
      return;
    }
    if (!draft.dropoff) {
      Alert.alert('Choose your drop-off', 'Pick where you are going from the suggestions, so we have the real place and not just its name.');
      return;
    }
    setSaving(true);
    try {
      const fields = {
        pickup: draft.pickup,
        dropoff: draft.dropoff,
        time: draft.time,
        updatedAt: serverTimestamp(),
      };
      if (draft.id) {
        // An edit keeps whatever name, radius and alert switch "My routes" gave it.
        await updateDoc(doc(db, 'users', uid, 'dailyRoutes', draft.id), fields);
      } else {
        await addDoc(collection(db, 'users', uid, 'dailyRoutes'), {
          ...fields,
          label: `To ${areaLabel(draft.dropoff.address)}`,
          radiusKm: 3,
          notify: true,
          createdAt: serverTimestamp(),
        });
      }
      setPicking(false);
      setDraft(null);
    } catch {
      Alert.alert('Could not save the route', 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function remove(r: DailyRoute) {
    if (!uid) return;
    Alert.alert(
      'Remove this route?',
      `${areaLabel(r.pickup.address)} → ${areaLabel(r.dropoff.address)}. You will stop getting shared-ride alerts for it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            deleteDoc(doc(db, 'users', uid, 'dailyRoutes', r.id)).catch(() =>
              Alert.alert('Could not remove the route', 'Please try again.'),
            );
          },
        },
      ],
    );
  }

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });
  const timeLabel = clockLabel(draft?.time);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Animated.View style={[styles.sheetWrap, { transform: [{ translateY }] }]}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <View style={styles.grabber} />
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.sheetBody}
              >
                {draft ? (
                  <>
                    <Text style={styles.sheetTitle}>{draft.id ? 'Edit route' : 'Add a route'}</Text>
                    <Text style={styles.sheetText}>Where you start, where you go and, if you like, when.</Text>

                    <View style={styles.routeCard}>
                      <View style={styles.fieldRow}>
                        <PickupDotIcon size={16} color="#ffffff" accent={LIME} />
                        <TextInput
                          style={styles.fieldInput}
                          value={draft.pickupText}
                          onChangeText={(text) => type('pickup', text)}
                          placeholder="Pickup location"
                          placeholderTextColor="#6b7270"
                          maxLength={200}
                        />
                        {draft.pickup ? <View style={styles.pinned} /> : null}
                      </View>
                      <View style={styles.fieldDivider} />
                      <View style={styles.fieldRow}>
                        <DestinationPinIcon size={16} color="#ffffff" accent={LIME} />
                        <TextInput
                          style={styles.fieldInput}
                          value={draft.dropoffText}
                          onChangeText={(text) => type('dropoff', text)}
                          placeholder="Drop-off location"
                          placeholderTextColor="#6b7270"
                          maxLength={200}
                          autoFocus={!draft.id && draft.pickup !== null}
                        />
                        {draft.dropoff ? <View style={styles.pinned} /> : null}
                      </View>
                    </View>

                    {field && predictions.length > 0 ? (
                      <View style={styles.predictions}>
                        {predictions.slice(0, 5).map((pred) => (
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
                        ))}
                      </View>
                    ) : null}

                    {/* Straight under the drop-off: how many people already make
                        this trip, and who. Counted on the radius shared-ride
                        alerts use, never including this rider. */}
                    {sameWay === 'loading' ? (
                      <Text style={styles.sameWayMuted}>Checking who else goes this way…</Text>
                    ) : sameWay ? (
                      <View style={styles.sameWay}>
                        <Text style={styles.sameWayTxt}>
                          {sameWay.people === 0
                            ? 'Nobody else has saved this route yet — you will be the first'
                            : `${sameWay.people} ${sameWay.people === 1 ? 'person goes' : 'people go'} this way`}
                        </Text>
                        {sameWay.people > 0 ? <GenderTally {...sameWay} /> : null}
                      </View>
                    ) : null}

                    <Text style={styles.fieldLabel}>Time · optional</Text>
                    <View style={styles.timeRow}>
                      <Pressable
                        style={[styles.timeChip, draft.time === null && styles.timeChipOn]}
                        onPress={() => {
                          setPicking(false);
                          setTime(null);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: draft.time === null }}
                      >
                        <Text style={[styles.timeChipTxt, draft.time === null && styles.timeChipTxtOn]}>Any time</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.timeChip, draft.time !== null && styles.timeChipOn]}
                        onPress={openTimePicker}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: draft.time !== null }}
                      >
                        <ClockIcon size={14} color={draft.time !== null ? '#0b0d0c' : '#9aa2a0'} />
                        <Text style={[styles.timeChipTxt, draft.time !== null && styles.timeChipTxtOn]}>
                          {timeLabel ?? 'Set a time'}
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={styles.timeHint}>
                      {timeLabel
                        ? `We will alert you to shared rides on this route leaving within an hour of ${timeLabel}.`
                        : 'No time needed. We will alert you to shared rides on this route at any hour.'}
                    </Text>
                    <Text style={styles.timeHint}>
                      Riders and drivers nearby see this route in "Locations people are traveling to" — only its areas and time, never your address or your name.
                    </Text>

                    {picking && Platform.OS === 'ios' ? (
                      <View style={styles.iosPicker}>
                        <DateTimePicker
                          value={fromHHMM(draft.time, fromHHMM(DEFAULT_TIME, new Date()))}
                          mode="time"
                          display="spinner"
                          themeVariant="dark"
                          onChange={(_, d) => d && setTime(toHHMM(d))}
                        />
                        <Pressable onPress={() => setPicking(false)} hitSlop={8} style={styles.iosDone}>
                          <Text style={styles.iosDoneTxt}>Done</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {picking && Platform.OS === 'android' ? (
                      <DateTimePicker
                        value={fromHHMM(draft.time, fromHHMM(DEFAULT_TIME, new Date()))}
                        mode="time"
                        display="default"
                        onChange={(event, d) => {
                          setPicking(false);
                          if (event.type === 'set' && d) setTime(toHHMM(d));
                        }}
                      />
                    ) : null}

                    <Pressable
                      style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.88 }]}
                      onPress={() => void save()}
                      disabled={saving}
                    >
                      {saving ? (
                        <ActivityIndicator color="#0b0d0c" />
                      ) : (
                        <Text style={styles.saveTxt}>{draft.id ? 'Save changes' : 'Save route'}</Text>
                      )}
                    </Pressable>
                    <Pressable onPress={cancelEdit} hitSlop={8} style={styles.cancelBtn}>
                      <Text style={styles.cancelTxt}>Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.sheetTitle}>Location & time</Text>
                    <Text style={styles.sheetText}>
                      Save the trips you make often. When a shared ride is leaving on one of them we send
                      you an alert: around the time you set, or at any hour if you leave the time blank.
                    </Text>

                    {routes === null ? (
                      <ActivityIndicator color={LIME} style={{ marginVertical: 20 }} />
                    ) : (
                      routes.map((r) => (
                        <Pressable
                          key={r.id}
                          style={({ pressed }) => [styles.savedRoute, pressed && { opacity: 0.85 }]}
                          onPress={() => setDraft(draftFrom(r))}
                          accessibilityRole="button"
                          accessibilityLabel={`${r.pickup.address} to ${r.dropoff.address}. Tap to change.`}
                        >
                          <View style={styles.savedLegs}>
                            <View style={styles.leg}>
                              <PickupDotIcon size={13} color="#ffffff" accent={LIME} />
                              <Text style={styles.legTxt} numberOfLines={1}>{r.pickup.address}</Text>
                            </View>
                            <View style={styles.leg}>
                              <DestinationPinIcon size={13} color="#ffffff" accent={LIME} />
                              <Text style={styles.legTxt} numberOfLines={1}>{r.dropoff.address}</Text>
                            </View>
                          </View>
                          <View style={styles.savedSide}>
                            {/* Lime only for a live, timed route: "Any time" and
                                "Alerts off" read grey. */}
                            <View
                              style={[
                                styles.timeTag,
                                (r.time === null || r.notify === false) && styles.timeTagAny,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.timeTagTxt,
                                  (r.time === null || r.notify === false) && styles.timeTagTxtAny,
                                ]}
                              >
                                {r.notify === false ? 'Alerts off' : clockLabel(r.time) ?? 'Any time'}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() => remove(r)}
                              hitSlop={10}
                              accessibilityRole="button"
                              accessibilityLabel="Remove this route"
                            >
                              <Text style={styles.removeTxt}>✕</Text>
                            </Pressable>
                          </View>
                        </Pressable>
                      ))
                    )}

                    <Pressable
                      style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
                      onPress={() => setDraft(blankDraft(here))}
                    >
                      <Text style={styles.addTxt}>
                        {routes && routes.length > 0 ? '+ Add another route' : '+ Add your first route'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  /* ── Map pill ── */
  pillRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 16,
    marginTop: 8,
  },
  pill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(16,19,18,0.88)',
    borderColor: 'rgba(255,255,255,0.14)',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  // The place names shrink (and ellipsize) on a narrow handset, so the + never
  // gets pushed under the live legend; minWidth 0 lets them go below their text.
  pillLabel: { flexShrink: 1, minWidth: 0, color: '#ffffff', fontSize: 11.5, fontWeight: '900' },
  pillSub: { flexShrink: 0, color: LIME, fontSize: 10, fontWeight: '800' },
  pillChevron: { color: '#9aa2a0', fontSize: 14, fontWeight: '900', marginLeft: -2 },
  plus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIME,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  plusTxt: { color: '#0b0d0c', fontSize: 19, lineHeight: 21, fontWeight: '900' },

  /* ── Sheet ── */
  kav: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetWrap: { width: '100%', maxHeight: '90%' },
  // flexShrink so a tall editor scrolls inside the 90% cap instead of spilling past it.
  sheet: {
    flexShrink: 1,
    backgroundColor: '#151917',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.22)',
    marginBottom: 6,
  },
  sheetBody: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 34, gap: 10 },
  sheetTitle: { color: '#ffffff', fontSize: 19, fontWeight: '900', letterSpacing: -0.2 },
  sheetText: { color: '#9aa2a0', fontSize: 12.5, fontWeight: '600', lineHeight: 17 },

  routeCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 4,
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  fieldInput: { flex: 1, color: '#ffffff', fontSize: 14, fontWeight: '700', paddingVertical: 13 },
  /** A lime dot once the field holds a real place, not just typed words. */
  pinned: { width: 8, height: 8, borderRadius: 4, backgroundColor: LIME },
  fieldDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: 39 },

  predictions: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#1c211f',
    overflow: 'hidden',
  },
  predictionRow: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  predictionMain: { color: '#ffffff', fontSize: 13, fontWeight: '800' },

  sameWay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(204,255,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(204,255,0,0.25)',
  },
  sameWayTxt: { flexShrink: 1, color: '#ffffff', fontSize: 12.5, fontWeight: '800' },
  sameWayMuted: { color: '#7d8482', fontSize: 12, fontWeight: '700', paddingHorizontal: 2 },
  predictionSub: { color: '#8a918f', fontSize: 11, fontWeight: '600', marginTop: 1 },

  fieldLabel: {
    color: '#7d8482',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  timeRow: { flexDirection: 'row', gap: 8 },
  timeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  timeChipOn: { backgroundColor: LIME, borderColor: LIME },
  timeChipTxt: { color: '#9aa2a0', fontSize: 13, fontWeight: '900' },
  timeChipTxtOn: { color: '#0b0d0c' },
  timeHint: { color: '#7d8482', fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  iosPicker: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  iosDone: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingBottom: 10 },
  iosDoneTxt: { color: LIME, fontSize: 14, fontWeight: '900' },

  saveBtn: {
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIME,
    marginTop: 6,
  },
  saveTxt: { color: '#0b0d0c', fontSize: 16, fontWeight: '900' },
  cancelBtn: { alignSelf: 'center', paddingVertical: 4 },
  cancelTxt: { color: '#9aa2a0', fontSize: 13, fontWeight: '800' },

  savedRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  savedLegs: { flex: 1, gap: 7 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legTxt: { flex: 1, color: '#ffffff', fontSize: 13, fontWeight: '700' },
  savedSide: { alignItems: 'flex-end', gap: 10 },
  timeTag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(204,255,0,0.14)',
  },
  timeTagAny: { backgroundColor: 'rgba(255,255,255,0.08)' },
  timeTagTxt: { color: LIME, fontSize: 11, fontWeight: '900' },
  timeTagTxtAny: { color: '#c4cac8' },
  removeTxt: { color: '#7d8482', fontSize: 14, fontWeight: '900' },

  addBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(204,255,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTxt: { color: LIME, fontSize: 14, fontWeight: '900' },
}));
