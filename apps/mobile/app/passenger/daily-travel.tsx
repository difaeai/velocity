/**
 * Corporate, Students & daily travel — home's left ride tile.
 *
 * One question at the top: where do you work, study or usually go (one place
 * or several), and where do you leave from. Each answer is a saved daily route
 * (`users/{uid}/dailyRoutes`). Once a place is saved the question folds into
 * one "Add another place" row, so the screen is about the places, not the form.
 *
 * Matching is by PLACE, never by employer: anyone leaving near you and going
 * near your place shares the car, whether or not they work in the same office.
 *
 * Everything happens on this screen. Each place shows:
 *  - the car and the fare: the whole car, and what each rider pays at 1-4;
 *  - the people on that route (first name, gender, area, usual time), each one
 *    ticked to receive a ride request (getRouteMates / inviteRouteMates);
 *  - the shared cars already going there, with a Join on each;
 *  - "Book & send request": books the shared ride here (createTrip) and asks
 *    the ticked people to join it, so the pool forms around this rider.
 * At the top: the ride the rider is on (car, fare, who is aboard, driver), with
 * "Ask by username" while it is their own sharing ride; then the sharing-ride
 * requests other riders sent them (getMyRideInvites), to Join or turn down.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';

import {
  api,
  type RideInvite,
  type RouteMate,
  type SharedFareQuote,
  type SuggestedRide,
  type TravelAreas,
} from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { db } from '../../src/firebase';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { RIDE_TYPE_LABELS, type RideType, type Trip } from '../../src/domain/types';
import { useCurrentLocation } from '../../src/hooks/location';
import { useActiveTrip } from '../../src/hooks/useActiveTrip';
import { useTrip } from '../../src/hooks/useTrip';
import { useForegroundInterval } from '../../src/hooks/useForegroundInterval';
import { useGenderPref } from '../../src/hooks/genderPref';
import { useDailyRoutes, type DailyRoute, type RoutePlace } from '../../src/hooks/passenger';
import { fetchPlaceDetail, usePlacesAutocomplete, type PlacePrediction } from '../../src/hooks/places';
import { areaLabel } from '../../src/lib/areaLabel';
import { clockLabel } from '../../src/lib/dailyRouteTime';
import { distanceMeters } from '../../src/lib/geo';
import { Text, TextInput } from '../../src/ui/Text';
import { GenderTally } from '../../src/ui/TravelAreas';
import { DestinationPinIcon, PickupDotIcon, PoolIcon } from '../../src/ui/RideIcons';
import { ArrowIcon } from '../../src/ui/ServiceIcons';

// Places API (New) requires session tokens to be UUID v4.
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type Field = 'to' | 'from';

/** What the live ride is doing, in the rider's words. */
const ACTIVE_LABEL: Record<string, string> = {
  requested: 'Booked — finding a driver',
  matched: 'Your driver is on the way',
  arriving: 'Your driver is on the way',
  arrived: 'Your driver has arrived',
  in_progress: 'You are on your ride',
};

/** The two cars a shared ride can be: four seats each. */
const SHARED_CARS: { key: RideType; note: string }[] = [
  { key: 'mini', note: 'No AC · 4 seats' },
  { key: 'ac', note: 'AC on · 4 seats' },
];

/** Ride states other riders can still be asked into — the backend's list. */
const INVITABLE = new Set(['requested', 'matched', 'arriving']);

/** A ride already booked counts as "going to this place" within this distance. */
const SAME_PLACE_M = 3000;

const MALE = '#60a5fa';
const FEMALE = '#f472b6';

export default function DailyTravelScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid;
  const routes = useDailyRoutes(uid);
  const { coords, address: currentAddress, request: requestLocation } = useCurrentLocation();
  const { active } = useActiveTrip(uid);
  const { trip: activeTrip } = useTrip(active?.id);
  // Woken while the rider is choosing, so Book does not wait on a cold start.
  useForegroundInterval(() => { api.warmRide('createTrip').catch(() => {}); }, 5 * 60_000);

  // The question card folds away once there is a place; "+ Add another" opens it.
  const [adding, setAdding] = useState(false);
  const formOpen = adding || (routes !== null && routes.length === 0);

  const [toText, setToText] = useState('');
  const [to, setTo] = useState<RoutePlace | null>(null);
  const [fromText, setFromText] = useState('');
  const [from, setFrom] = useState<RoutePlace | null>(null);
  // Until the rider types in it, "from" follows the phone's location.
  const [fromEdited, setFromEdited] = useState(false);
  const [field, setField] = useState<Field | null>(null);
  const [saving, setSaving] = useState(false);
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
    const place: RoutePlace = { lat: detail.lat, lng: detail.lng, address: label };
    if (which === 'to') setTo(place);
    else setFrom(place);
  }

  async function addPlace() {
    if (!uid) return;
    if (!to) {
      Alert.alert('Choose your place', 'Type your office, university or area and pick it from the list.');
      return;
    }
    if (!from) {
      Alert.alert('Where do you leave from?', 'Pick your home or starting point from the list.');
      return;
    }
    setSaving(true);
    try {
      // Same shape "My routes" (daily-routes.tsx) writes and the backend matches on.
      await addDoc(collection(db, 'users', uid, 'dailyRoutes'), {
        pickup: from,
        dropoff: to,
        time: null,
        label: `To ${areaLabel(to.address)}`,
        radiusKm: 3,
        notify: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setTo(null);
      setToText('');
      setAdding(false);
    } catch {
      Alert.alert('Could not save the place', 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function remove(r: DailyRoute) {
    if (!uid) return;
    Alert.alert('Remove this place?', `${r.dropoff.address}. You will stop getting shared-ride alerts for it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteDoc(doc(db, 'users', uid, 'dailyRoutes', r.id)).catch(() =>
            Alert.alert('Could not remove the place', 'Please try again.'),
          );
        },
      },
    ]);
  }

  const openRide = useCallback(
    (tripId: string) => router.push(`/passenger/trip/${tripId}` as Parameters<typeof router.push>[0]),
    [router],
  );

  // The pickup for a ride booked or joined here: where the phone is now.
  const here = coords
    ? { lat: coords.lat, lng: coords.lng, address: currentAddress ?? 'Current location' }
    : null;

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
          <Text style={styles.title} numberOfLines={1}>Corporate, Students & daily</Text>
          <Text style={styles.subtitle} numberOfLines={1}>Share a car with people going your way</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* The ride this rider is on — booked or joined here or anywhere. */}
        {active && activeTrip ? <BookedRide trip={activeTrip} onOpen={() => openRide(active.id)} /> : null}
        {active && activeTrip?.pool && activeTrip.passengerId === uid && INVITABLE.has(activeTrip.status) ? (
          <AskByUsername tripId={active.id} />
        ) : null}

        {/* Sharing rides other riders asked this one into. */}
        <RequestsForYou disabled={!!active} onJoined={openRide} />

        {formOpen ? (
          <View style={styles.card}>
            <Text style={styles.question}>Where do you work, study or usually go?</Text>

            <View style={styles.routeBox}>
              <View style={styles.fieldRow}>
                <DestinationPinIcon size={16} color={colors.text} accent={colors.primary} />
                <TextInput
                  style={styles.fieldInput}
                  value={toText}
                  onChangeText={(t) => type('to', t)}
                  placeholder="Office, university, school or area"
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
                  placeholder="You leave from (home, hostel…)"
                  placeholderTextColor={colors.muted}
                  maxLength={200}
                />
                {from ? <View style={styles.pinned} /> : null}
              </View>
            </View>

            {field && (searching || predictions.length > 0) ? (
              <View style={styles.predictions}>
                {searching && predictions.length === 0 ? (
                  <ActivityIndicator color={colors.primary} style={{ paddingVertical: 12 }} />
                ) : (
                  predictions.slice(0, 6).map((pred) => (
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

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, (!to || !from) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
              onPress={() => void addPlace()}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.btnText} />
              ) : (
                <Text style={styles.primaryBtnTxt}>Save my place</Text>
              )}
            </Pressable>
            {routes && routes.length > 0 ? (
              <Pressable onPress={() => setAdding(false)} hitSlop={8} style={{ alignSelf: 'center' }}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </Pressable>
            ) : (
              <Text style={styles.hint}>
                You do not need colleagues on Velocity. Anyone leaving near you and going near your place can
                share your car — from your office, your campus or the building next door.
              </Text>
            )}
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.85 }]}
            onPress={() => setAdding(true)}
            accessibilityRole="button"
          >
            <Text style={styles.addPlus}>+</Text>
            <Text style={styles.addTxt}>Add another place — office, campus or area</Text>
          </Pressable>
        )}

        {routes === null ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : (
          routes.map((r) => (
            <PlaceCard
              key={r.id}
              route={r}
              here={here}
              onNeedLocation={requestLocation}
              activeTrip={active ? activeTrip : null}
              onOpenRide={openRide}
              onRemove={() => remove(r)}
            />
          ))
        )}

        {/* The older fixed-group flow (add colleagues by username, ask them all
            at once). Its only door used to be the drawer row this screen replaced. */}
        <Pressable onPress={() => router.push('/passenger/fleet')} hitSlop={8} style={styles.fleetLink}>
          <Text style={styles.fleetLinkTxt}>Travel with a fixed group? Open your fleet ›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** The ride this rider is on: car, fare, who is aboard and the driver. */
function BookedRide({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const riders = trip.poolMembers?.length ?? 1;
  const carFare = trip.fare ?? trip.offeredFare;
  const myFare = trip.pool ? trip.poolPerSeatFare ?? carFare : carFare;
  const driver = trip.driverInfo;
  return (
    <Pressable style={({ pressed }) => [styles.bookedCard, pressed && { opacity: 0.92 }]} onPress={onOpen}>
      <View style={styles.bookedHead}>
        <View style={styles.bookedDot} />
        <Text style={styles.bookedTitle} numberOfLines={1}>{ACTIVE_LABEL[trip.status] ?? 'You are on a ride'}</Text>
        <ArrowIcon size={18} color="#0b1a00" />
      </View>
      <Text style={styles.bookedTo} numberOfLines={1}>To {trip.dropoff?.address ?? 'your place'}</Text>
      <View style={styles.bookedGrid}>
        <Detail label="Car" value={RIDE_TYPE_LABELS[trip.rideType] ?? trip.rideType} />
        <Detail label="Riders" value={trip.pool ? `${riders} of 4` : 'Just you'} />
        <Detail label="You pay" value={`PKR ${myFare}`} />
        <Detail label="Whole car" value={`PKR ${carFare}`} />
      </View>
      {trip.pool && trip.poolRoster && trip.poolRoster.length > 0 ? (
        <Text style={styles.bookedDriver} numberOfLines={2}>
          Aboard: {trip.poolRoster.map((r) => r.firstName).join(', ')}
        </Text>
      ) : null}
      <Text style={styles.bookedDriver} numberOfLines={2}>
        {driver
          ? `Driver: ${driver.displayName} · ${driver.vehicleLabel} · ${driver.plate}`
          : 'Driver: being found now — nearby drivers have your request'}
      </Text>
    </Pressable>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** Ask anyone into this rider's own sharing ride by their username. */
function AskByUsername({ tripId }: { tripId: string }) {
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    const username = name.trim().replace(/^@/, '');
    if (username.length < 3) return;
    setSending(true);
    try {
      const res = await api.inviteRouteMates({ tripId, usernames: [username] });
      if (res.invited > 0) {
        Alert.alert('Request sent', `@${username} was asked to join your sharing ride.`);
        setName('');
      } else if (res.notFound.length > 0) {
        Alert.alert('No such username', `Nobody on Velocity is called @${username}.`);
      } else {
        Alert.alert(
          'Could not ask them',
          'They are already asked or aboard, or the ride’s gender rules do not let you share a car.',
        );
      }
    } catch (e) {
      Alert.alert('Could not send', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.blockLabel}>ASK SOMEONE BY USERNAME</Text>
      <View style={styles.askRow}>
        <View style={styles.askField}>
          <Text style={styles.askAt}>@</Text>
          <TextInput
            style={styles.askInput}
            value={name}
            onChangeText={setName}
            placeholder="username"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            returnKeyType="send"
            onSubmitEditing={() => void send()}
          />
        </View>
        <Pressable
          style={({ pressed }) => [styles.joinBtn, styles.askBtn, pressed && { opacity: 0.85 }]}
          onPress={() => void send()}
          disabled={sending || name.trim().replace(/^@/, '').length < 3}
        >
          {sending ? <ActivityIndicator size="small" color={colors.btnText} /> : <Text style={styles.joinTxt}>Ask</Text>}
        </Pressable>
      </View>
      <Text style={styles.emptyTxt}>They get a notification and join your sharing ride in one tap.</Text>
    </View>
  );
}

/** Sharing rides other riders asked this one into: Join, or Not now. */
function RequestsForYou({ disabled, onJoined }: { disabled: boolean; onJoined: (tripId: string) => void }) {
  const [invites, setInvites] = useState<RideInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getMyRideInvites({}).then((r) => setInvites(r.invites)).catch(() => {});
  }, []);
  // Re-read whenever the screen comes back into view — a request arrives by push.
  useFocusEffect(load);

  async function join(inv: RideInvite) {
    setBusy(inv.tripId);
    try {
      const res = await api.joinPoolTrip({ code: inv.code, bookedFor: 'self' });
      if (res.pending) {
        Alert.alert('Asked', 'They have to agree before you take the seat. You will get a notification either way.');
      } else {
        Alert.alert('You are in 🎉', `PKR ${res.perSeatFare} for your seat.`, [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Open my ride', onPress: () => onJoined(res.tripId) },
        ]);
      }
      load();
    } catch (e) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function notNow(inv: RideInvite) {
    setInvites((prev) => prev.filter((i) => i.tripId !== inv.tripId));
    api.declineRideInvite({ tripId: inv.tripId }).catch(() => {});
  }

  if (invites.length === 0) return null;
  return (
    <View style={styles.placeCard}>
      <Text style={styles.blockLabel}>SHARING REQUESTS FOR YOU · {invites.length}</Text>
      {invites.map((inv) => (
        <View key={inv.tripId} style={styles.inviteRow}>
          <View style={styles.mateHead}>
            <View style={styles.avatar}>
              <Text style={styles.avatarTxt}>{inv.hostName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rideNames} numberOfLines={1}>{inv.hostName} asked you to share a ride</Text>
              <Text style={styles.rideMeta} numberOfLines={2}>
                {inv.fromArea} → {inv.toArea} · {RIDE_TYPE_LABELS[inv.rideType as RideType] ?? inv.rideType} ·{' '}
                {inv.riders} aboard · {inv.driver ?? 'finding a driver'}
              </Text>
            </View>
            <Text style={styles.rideFare}>PKR {inv.perSeat}</Text>
          </View>
          <View style={styles.inviteActions}>
            <Pressable onPress={() => notNow(inv)} hitSlop={8} style={styles.notNowBtn}>
              <Text style={styles.cancelTxt}>Not now</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
              onPress={() => void join(inv)}
              disabled={busy !== null || disabled}
            >
              {busy === inv.tripId ? (
                <ActivityIndicator size="small" color={colors.btnText} />
              ) : (
                <Text style={styles.joinTxt}>{disabled ? 'On a ride' : 'Join'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * One saved place: the car and its fare, the people on this route (ticked to
 * be asked), the shared cars going there now, and the button that books.
 */
function PlaceCard({
  route,
  here,
  onNeedLocation,
  activeTrip,
  onOpenRide,
  onRemove,
}: {
  route: DailyRoute;
  here: RoutePlace | null;
  onNeedLocation: () => void;
  activeTrip: Trip | null;
  onOpenRide: (tripId: string) => void;
  onRemove: () => void;
}) {
  const [sameWay, setSameWay] = useState<TravelAreas['sameWay'] | 'loading'>('loading');
  const [mates, setMates] = useState<RouteMate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rides, setRides] = useState<SuggestedRide[] | null>(null);
  const [rideType, setRideType] = useState<RideType>('mini');
  const [quote, setQuote] = useState<SharedFareQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { gender } = useGenderPref();
  const { pickup: p, dropoff: d } = route;
  // Cars and fares are worked out from where the rider stands; else the saved start.
  const start = here ?? p;

  // The rider's own shared ride, if it already goes to this place: requests go into it.
  const myRideHere =
    activeTrip?.pool && activeTrip.dropoff &&
    distanceMeters(activeTrip.dropoff.lat, activeTrip.dropoff.lng, d.lat, d.lng) <= SAME_PLACE_M
      ? activeTrip
      : null;
  const onOtherRide = !!activeTrip && !myRideHere;

  const loadRides = useCallback(() => {
    let live = true;
    api
      .getSuggestedRides({ lat: start.lat, lng: start.lng, radiusKm: 5, destLat: d.lat, destLng: d.lng, destRadiusKm: 2 })
      .then((res) => live && setRides(res.rides))
      .catch(() => live && setRides([]));
    return () => {
      live = false;
    };
  }, [start.lat, start.lng, d.lat, d.lng]);
  useEffect(() => loadRides(), [loadRides]);

  useEffect(() => {
    let live = true;
    const r = { from: { lat: p.lat, lng: p.lng }, to: { lat: d.lat, lng: d.lng } };
    api
      .getTravelAreas({ lat: p.lat, lng: p.lng, radiusKm: 1, route: r })
      .then((res) => live && setSameWay(res.sameWay))
      .catch(() => live && setSameWay(null));
    api
      .getRouteMates(r)
      .then((res) => {
        if (!live) return;
        setMates(res.mates);
        setPicked(new Set(res.mates.map((m) => m.id))); // everyone ticked to start with
      })
      .catch(() => live && setMates([]));
    return () => {
      live = false;
    };
  }, [p.lat, p.lng, d.lat, d.lng]);

  useEffect(() => {
    let live = true;
    setQuote(null);
    api
      .getSharedRideFare({ rideType, pickup: { lat: start.lat, lng: start.lng }, dropoff: { lat: d.lat, lng: d.lng } })
      .then((q) => live && setQuote(q))
      .catch(() => live && setQuote(null));
    return () => {
      live = false;
    };
  }, [rideType, start.lat, start.lng, d.lat, d.lng]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function needHere(): boolean {
    if (here) return false;
    onNeedLocation();
    Alert.alert('Location needed', 'Turn on location so the driver knows where to pick you up.');
    return true;
  }

  async function invite(tripId: string): Promise<number> {
    if (picked.size === 0) return 0;
    try {
      return (await api.inviteRouteMates({ tripId, mateIds: [...picked].slice(0, 10) })).invited;
    } catch {
      return 0;
    }
  }

  async function join(ride: SuggestedRide) {
    if (needHere() || !here) return;
    setBusy(ride.id);
    try {
      if (ride.kind === 'trip') {
        const res = await api.joinPoolTrip({ code: ride.id, bookedFor: 'self' });
        if (res.pending) {
          Alert.alert(
            res.vetBy === 'host' ? 'Asked the rider who started it' : 'Asked the driver',
            'They have to agree before you take the seat. You will get a notification either way.',
          );
        } else {
          Alert.alert('You are in 🎉', `PKR ${res.perSeatFare} for your seat.`, [
            { text: 'Stay here', style: 'cancel' },
            { text: 'Open my ride', onPress: () => onOpenRide(res.tripId) },
          ]);
        }
      } else if (ride.kind === 'request') {
        const res = await api.joinPoolRideRequest({ requestId: ride.id, bookedFor: 'self' });
        Alert.alert(
          res.pending ? 'Asked the driver' : 'You are in 🎉',
          res.pending
            ? 'The driver has to agree before you take the seat — you will get a notification either way.'
            : `PKR ${res.farePerSeat} for your seat. You will see the ride in your activity.`,
        );
      } else {
        const res = await api.joinPoolRide({
          rideId: ride.id,
          pickupLat: here.lat,
          pickupLng: here.lng,
          pickupAddress: here.address,
          dropoffAddress: d.address,
          bookedFor: 'self',
        });
        Alert.alert(
          res.vetting || res.queued ? 'You are in the queue' : 'You are in 🎉',
          res.vetting || res.queued
            ? 'The driver is asked as soon as your seat can be confirmed. You will be notified.'
            : `PKR ${ride.farePerSeat} for your seat.`,
        );
      }
      loadRides();
    } catch (e) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  /** Book the shared ride here and ask the ticked people — or just ask, into the ride already booked. */
  async function bookAndAsk() {
    if (myRideHere) {
      setBusy('book');
      const n = await invite(myRideHere.id);
      setBusy(null);
      Alert.alert(
        n > 0 ? 'Request sent' : 'Nobody new to ask',
        n > 0 ? `${n} ${n === 1 ? 'person was' : 'people were'} asked to join your ride.` : 'Everyone ticked has already been asked.',
      );
      return;
    }
    if (needHere() || !here) return;
    setBusy('book');
    try {
      // A shared ride's fare is the server's; createTrip recomputes it either way.
      const res = await api.createTrip({
        rideType,
        offeredFare: quote?.fare ?? 300,
        seats: 1,
        passengerGender: gender === 'male' || gender === 'female' ? gender : 'unspecified',
        bookedFor: 'self',
        sharedFareFixed: true,
        pool: true,
        poolVisibility: 'public',
        paymentMethods: ['cash'],
        preferFemaleDriver: false,
        commute: true,
        pickup: { lat: here.lat, lng: here.lng, address: here.address },
        dropoff: { lat: d.lat, lng: d.lng, address: d.address },
      });
      const n = await invite(res.tripId);
      Alert.alert(
        'Shared ride booked 🎉',
        `${RIDE_TYPE_LABELS[rideType]} to ${areaLabel(d.address)}, PKR ${quote?.fare ?? ''} for the whole car — less each as people join.` +
          (n > 0 ? ` Ride request sent to ${n} ${n === 1 ? 'person' : 'people'} on your route.` : '') +
          ' Drivers nearby are being asked now.',
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Open my ride', onPress: () => onOpenRide(res.tripId) },
        ],
      );
    } catch (e) {
      Alert.alert('Could not book', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  const perSeat = quote?.perSeat ?? [];
  // How many would be in the car if everyone ticked said yes.
  const expected = Math.min(4, 1 + picked.size);
  const ctaLabel = useMemo(() => {
    if (onOtherRide) return 'You are already on another ride';
    if (myRideHere) return picked.size > 0 ? `Send request to ${picked.size}` : 'Tick people to ask';
    const fare = quote ? ` · PKR ${quote.fare}` : '';
    return picked.size > 0 ? `Book${fare} & ask ${picked.size}` : `Book shared ride${fare}`;
  }, [onOtherRide, myRideHere, picked.size, quote]);

  return (
    <View style={styles.placeCard}>
      <View style={styles.placeHead}>
        <View style={styles.placeIcon}>
          <DestinationPinIcon size={18} color="#0b0d0c" accent="#0b0d0c" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.placeName} numberOfLines={2}>{d.address}</Text>
          <Text style={styles.placeFrom} numberOfLines={1}>from {areaLabel(p.address)}</Text>
        </View>
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel="Remove this place">
          <Text style={styles.removeTxt}>✕</Text>
        </Pressable>
      </View>

      {/* Who makes this trip: everyone's saved routes near both ends. */}
      <View style={styles.peopleRow}>
        {sameWay === 'loading' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <Text style={styles.peopleNum}>{sameWay?.people ?? 0}</Text>
            <Text style={styles.peopleTxt} numberOfLines={2}>
              {(sameWay?.people ?? 0) === 0
                ? 'Nobody else has saved this trip yet — be the first'
                : `${sameWay?.people === 1 ? 'person makes' : 'people make'} this trip every day`}
            </Text>
            {sameWay && sameWay.people > 0 ? <GenderTally {...sameWay} /> : null}
          </>
        )}
      </View>

      {/* The car, and what it costs: the whole car, and each rider's share. */}
      <Text style={styles.blockLabel}>CAR & FARE</Text>
      <View style={styles.carRow}>
        {SHARED_CARS.map((c) => (
          <Pressable
            key={c.key}
            style={[styles.carChip, rideType === c.key && styles.carChipOn]}
            onPress={() => setRideType(c.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rideType === c.key }}
          >
            <Text style={[styles.carName, rideType === c.key && styles.carNameOn]}>{RIDE_TYPE_LABELS[c.key]}</Text>
            <Text style={styles.carNote}>{c.note}</Text>
          </Pressable>
        ))}
      </View>
      {quote ? (
        <View style={styles.fareRow}>
          {perSeat.map((f, i) => (
            <View key={i} style={[styles.fareBox, i + 1 === expected && styles.fareBoxOn]}>
              <Text style={[styles.fareNum, i + 1 === expected && styles.fareNumOn]}>PKR {f}</Text>
              <Text style={styles.fareWho}>{i === 0 ? 'alone' : `each of ${i + 1}`}</Text>
            </View>
          ))}
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 8 }} />
      )}

      {/* The people on this route — ticked ones get the ride request. */}
      <Text style={styles.blockLabel}>
        PEOPLE ON YOUR ROUTE{mates && mates.length > 0 ? ` · ${picked.size} OF ${mates.length} TICKED` : ''}
      </Text>
      {mates === null ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 8 }} />
      ) : mates.length === 0 ? (
        <Text style={styles.emptyTxt}>
          Nobody you can share with has saved this route yet. Book anyway — anyone going near this place sees your
          ride below theirs.
        </Text>
      ) : (
        mates.map((m) => {
          const on = picked.has(m.id);
          return (
            <Pressable
              key={m.id}
              style={({ pressed }) => [styles.mateRow, pressed && { opacity: 0.85 }]}
              onPress={() => toggle(m.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <View
                style={[
                  styles.avatar,
                  m.gender === 'male' && { borderColor: MALE },
                  m.gender === 'female' && { borderColor: FEMALE },
                ]}
              >
                <Text style={styles.avatarTxt}>{m.firstName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rideNames} numberOfLines={1}>
                  {m.firstName} {m.gender === 'male' ? '♂' : m.gender === 'female' ? '♀' : ''}
                </Text>
                <Text style={styles.rideMeta} numberOfLines={1}>
                  {m.fromArea} → {m.toArea} · {clockLabel(m.time) ?? 'any time'}
                </Text>
              </View>
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })
      )}

      {/* The shared cars going there now — join one right here. */}
      <Text style={styles.blockLabel}>SHARED CARS GOING THERE NOW</Text>
      {rides === null ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: 8 }} />
      ) : rides.length === 0 ? (
        <Text style={styles.emptyTxt}>None yet — yours will be the first.</Text>
      ) : (
        rides.slice(0, 4).map((ride) => (
          <View key={ride.id} style={styles.rideRow}>
            <View style={styles.avatars}>
              {(ride.companions.length > 0 ? ride.companions : [{ firstName: '?', gender: '' }])
                .slice(0, 3)
                .map((c, i) => (
                  <View
                    key={i}
                    style={[
                      styles.avatar,
                      { marginLeft: i === 0 ? 0 : -8 },
                      c.gender === 'male' && { borderColor: MALE },
                      c.gender === 'female' && { borderColor: FEMALE },
                    ]}
                  >
                    <Text style={styles.avatarTxt}>{c.firstName.charAt(0).toUpperCase()}</Text>
                  </View>
                ))}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rideNames} numberOfLines={1}>
                {ride.companions.length > 0
                  ? ride.companions.map((c) => c.firstName).join(', ')
                  : `${ride.riders} rider${ride.riders === 1 ? '' : 's'}`}
              </Text>
              <Text style={styles.rideMeta} numberOfLines={1}>
                {ride.rideType ? `${RIDE_TYPE_LABELS[ride.rideType as RideType] ?? ride.rideType} · ` : ''}
                {ride.seatsLeft} seat{ride.seatsLeft === 1 ? '' : 's'} left ·{' '}
                {ride.hasDriver
                  ? `${ride.driverName ?? 'Driver'}${ride.driverVehicle ? `, ${ride.driverVehicle}` : ''}`
                  : 'finding a driver'}
              </Text>
            </View>
            <View style={styles.rideSide}>
              <Text style={styles.rideFare}>PKR {ride.farePerSeat}</Text>
              <Pressable
                style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }]}
                onPress={() => void join(ride)}
                disabled={busy !== null || !!activeTrip}
              >
                {busy === ride.id ? (
                  <ActivityIndicator size="small" color={colors.btnText} />
                ) : (
                  <Text style={styles.joinTxt}>Join</Text>
                )}
              </Pressable>
            </View>
          </View>
        ))
      )}

      <Pressable
        style={({ pressed }) => [
          styles.bookBtn,
          (busy !== null || onOtherRide || (myRideHere && picked.size === 0)) && { opacity: 0.5 },
          pressed && { opacity: 0.85 },
        ]}
        onPress={() => void bookAndAsk()}
        disabled={busy !== null || onOtherRide || (!!myRideHere && picked.size === 0)}
      >
        {busy === 'book' ? (
          <ActivityIndicator color={colors.btnText} />
        ) : (
          <>
            <PoolIcon size={18} color={colors.btnText} accent={colors.btnText} />
            <Text style={styles.primaryBtnTxt}>{ctaLabel}</Text>
          </>
        )}
      </Pressable>
      <Text style={styles.fareHint}>
        {myRideHere
          ? 'They get a notification and join your ride in one tap.'
          : `${RIDE_TYPE_LABELS[rideType]} · cash · pickup where you are now${
              perSeat.length > 0 ? ` · PKR ${perSeat[expected - 1]} each if ${expected === 1 ? 'nobody joins' : `${expected} ride`}` : ''
            }`}
      </Text>
    </View>
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
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },

  bookedCard: { borderRadius: 18, padding: 14, gap: 8, backgroundColor: colors.primary },
  bookedHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bookedDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0b1a00' },
  bookedTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: '#0b1a00' },
  bookedTo: { fontSize: 12.5, fontWeight: '700', color: '#0b1a00', opacity: 0.8 },
  bookedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  detail: { flexGrow: 1, flexBasis: '22%', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.12)' },
  detailLabel: { fontSize: 10, fontWeight: '800', color: '#0b1a00', opacity: 0.7 },
  detailValue: { fontSize: 13, fontWeight: '900', color: '#0b1a00' },
  bookedDriver: { fontSize: 12, fontWeight: '800', color: '#0b1a00' },

  card: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 16, gap: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  question: { fontSize: 18, fontWeight: '900', color: colors.text, lineHeight: 24 },
  hint: { fontSize: 12.5, color: colors.muted, fontWeight: '600', lineHeight: 18 },
  cancelTxt: { fontSize: 13, fontWeight: '800', color: colors.muted },

  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.glassLimeBorder, backgroundColor: colors.glassLime,
  },
  addPlus: { fontSize: 20, fontWeight: '900', color: colors.primary, marginTop: -2 },
  addTxt: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.text },

  routeBox: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13 },
  fieldInput: { flex: 1, color: colors.text, fontSize: 14.5, fontWeight: '700', paddingVertical: 13 },
  /** A lime dot once the field holds a real place, not just typed words. */
  pinned: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  fieldDivider: { height: 1, backgroundColor: colors.border, marginLeft: 39 },

  predictions: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  predictionRow: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
  predictionMain: { color: colors.text, fontSize: 14, fontWeight: '800' },
  predictionSub: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 2 },

  primaryBtn: { height: 48, borderRadius: 14, backgroundColor: colors.btnBg, alignItems: 'center', justifyContent: 'center' },
  primaryBtnTxt: { fontSize: 15, fontWeight: '900', color: colors.btnText },

  placeCard: {
    borderRadius: 20, padding: 16, gap: 10,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.glassLimeBorder,
  },
  placeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  placeIcon: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  placeName: { fontSize: 15.5, fontWeight: '900', color: colors.text },
  placeFrom: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  removeTxt: { fontSize: 15, color: colors.muted, fontWeight: '800' },

  peopleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.glassLime,
  },
  peopleNum: { fontSize: 24, fontWeight: '900', color: colors.primary },
  peopleTxt: { flex: 1, minWidth: 120, fontSize: 12.5, fontWeight: '700', color: colors.text },

  blockLabel: { fontSize: 11, fontWeight: '900', color: colors.muted, letterSpacing: 0.8, marginTop: 4 },
  emptyTxt: { fontSize: 12.5, color: colors.muted, fontWeight: '600', lineHeight: 18 },

  carRow: { flexDirection: 'row', gap: 8 },
  carChip: {
    flex: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12,
    borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.background,
  },
  carChipOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  carName: { fontSize: 14, fontWeight: '900', color: colors.text },
  carNameOn: { color: colors.primary },
  carNote: { fontSize: 11, fontWeight: '600', color: colors.muted, marginTop: 1 },

  fareRow: { flexDirection: 'row', gap: 6 },
  fareBox: {
    flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
  },
  fareBoxOn: { borderColor: colors.primary, backgroundColor: colors.glassLime },
  fareNum: { fontSize: 13, fontWeight: '900', color: colors.text },
  fareNumOn: { color: colors.primary },
  fareWho: { fontSize: 10, fontWeight: '700', color: colors.muted, marginTop: 1 },

  mateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, padding: 10,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
  },
  check: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkMark: { fontSize: 14, fontWeight: '900', color: colors.btnText },

  rideRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, padding: 10,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
  },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border,
    backgroundColor: colors.glassStrong, alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { fontSize: 12, fontWeight: '900', color: colors.text },
  rideNames: { fontSize: 13.5, fontWeight: '900', color: colors.text },
  rideMeta: { fontSize: 11.5, fontWeight: '600', color: colors.muted, marginTop: 1 },
  rideSide: { alignItems: 'flex-end', gap: 4 },
  rideFare: { fontSize: 12.5, fontWeight: '900', color: colors.primary },
  joinBtn: {
    minWidth: 58, height: 30, borderRadius: 10, paddingHorizontal: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.btnBg,
  },
  joinTxt: { fontSize: 13, fontWeight: '900', color: colors.btnText },

  bookBtn: {
    height: 50, borderRadius: 14, backgroundColor: colors.btnBg, marginTop: 4,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  fareHint: { fontSize: 11.5, fontWeight: '600', color: colors.muted, textAlign: 'center' },

  askRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  askField: {
    flex: 1, flexDirection: 'row', alignItems: 'center', height: 42, borderRadius: 12,
    paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background,
  },
  askAt: { fontSize: 15, fontWeight: '900', color: colors.muted },
  askInput: { flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.text, paddingVertical: 0, marginLeft: 2 },
  askBtn: { height: 42 },

  inviteRow: {
    gap: 8, borderRadius: 14, padding: 10,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
  },
  mateHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inviteActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 14 },
  notNowBtn: { paddingVertical: 6 },

  fleetLink: { alignSelf: 'center', paddingVertical: 6 },
  fleetLinkTxt: { fontSize: 12.5, fontWeight: '800', color: colors.muted },
}));
