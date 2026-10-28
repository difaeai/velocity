/**
 * My Fleet — the people you actually share a car with.
 *
 * Reached from the foot of the Corporate, Students & daily screen
 * (daily-travel.tsx): colleagues and classmates who make the same run every day.
 *
 * The screen is in the order the feature is used, which is also the order the
 * data becomes meaningful:
 *
 *   1. YOUR ROUTE. Nothing else works until it is saved. "People who take your
 *      route" has no meaning without one, and a fleet of people going nowhere
 *      near each other cannot share a car.
 *   2. GOING NOW. The reason the fleet exists, so it sits above the admin:
 *      one push to everybody, the people who say yes are seated, and the ride
 *      that reaches a driver is already full.
 *   3. Requests waiting on you, then your members, then riders on your route
 *      you have not added yet.
 *
 * Everything is one `getMyFleet` call and a `reload()` after each action.
 * There is no listener because none of this is client-readable — the rules
 * close `fleets/**`, since drawing a member means reading their profile.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text, TextInput } from '../../src/ui/Text';
import { api, type FleetPerson, type FleetPoint, type MyFleet } from '../../src/api/client';
import { geocodeAddress } from '../../src/hooks/places';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import { EarnCard } from '../../src/ui/EarnCard';
import { RIDE_TYPE_LABELS, type RideType } from '../../src/domain/types';

/** Which cars a fleet can be booked into. A bike seats nobody else. */
const FLEET_RIDE_TYPES: RideType[] = ['mini', 'ac', 'comfort', 'xl'];

export default function FleetScreen() {
  const router = useRouter();

  const [data, setData] = useState<MyFleet | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Route editor
  const [editingRoute, setEditingRoute] = useState(false);
  const [pickupText, setPickupText] = useState('');
  const [dropoffText, setDropoffText] = useState('');

  // Add-by-username sheet
  const [adding, setAdding] = useState<{ username: string } | null>(null);
  const [addMessage, setAddMessage] = useState('');

  // "Going now" sheet
  const [asking, setAsking] = useState(false);
  const [askDestination, setAskDestination] = useState('');
  const [askNote, setAskNote] = useState('');

  const [rideType, setRideType] = useState<RideType>('mini');

  const reload = useCallback(async () => {
    try {
      const res = await api.getMyFleet({});
      setData(res);
      if (!res.route) setEditingRoute(true);
    } catch (e) {
      Alert.alert('Could not load your fleet', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /** Every action is the same shape: do it, say what went wrong, reload. */
  async function run(action: () => Promise<unknown>, failure = 'That did not work') {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (e) {
      Alert.alert(failure, e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveRoute() {
    if (!pickupText.trim() || !dropoffText.trim()) {
      Alert.alert('Both ends needed', 'Enter where you start and where you go.');
      return;
    }
    await run(async () => {
      const [p, d] = await Promise.all([
        geocodeAddress(pickupText),
        geocodeAddress(dropoffText),
      ]);
      if (!p) throw new Error('We could not find that pickup. Try a landmark or a fuller address.');
      if (!d) throw new Error('We could not find that destination. Try a landmark or a fuller address.');
      await api.setFleetRoute({
        pickup: { lat: p.lat, lng: p.lng, address: pickupText.trim() },
        dropoff: { lat: d.lat, lng: d.lng, address: dropoffText.trim() },
      });
      setEditingRoute(false);
    }, 'Could not save your route');
  }

  async function sendRequest() {
    const username = adding?.username.trim();
    if (!username) return;
    await run(async () => {
      await api.sendFleetRequest({ username, message: addMessage.trim() || undefined });
      setAdding(null);
      setAddMessage('');
      Alert.alert('Request sent', `@${username} will see it and can say yes.`);
    }, 'Could not send that request');
  }

  async function askFleet() {
    if (!data?.route) return;
    await run(async () => {
      let dropoff: FleetPoint | undefined;
      const typed = askDestination.trim();
      // Blank means the route they already saved — the common case, and one
      // that costs no geocode.
      if (typed && typed !== data.route!.dropoff.address) {
        const d = await geocodeAddress(typed);
        if (!d) throw new Error('We could not find that destination.');
        dropoff = { lat: d.lat, lng: d.lng, address: typed };
      }
      await api.askFleetForRide({ dropoff, note: askNote.trim() || undefined });
      setAsking(false);
      setAskNote('');
    }, 'Could not ask your fleet');
  }

  async function book(askId: string) {
    await run(async () => {
      const res = await api.bookFleetRide({ askId, rideType });
      router.push(`/passenger/trip/${res.tripId}`);
    }, 'Could not book that ride');
  }

  /**
   * Leaving and removing are ONE action, because membership is one edge.
   * Accepting somebody's request puts each of you in the other's fleet, so
   * there is no version of this where you can drop them and stay in theirs —
   * and nobody is ever stuck in a circle they joined once.
   */
  function confirmRemove(person: FleetPerson) {
    Alert.alert(
      'Leave each other’s fleet?',
      `You and ${person.name} will both drop out. Either of you can ask again later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => run(() => api.removeFleetMember({ memberUid: person.uid })),
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, styles.centre]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const route = data?.route ?? null;
  const hosted = data?.hosted ?? null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/passenger/home'))}
        >
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Corporate / Students</Text>
          <Text style={styles.subtitle}>
            {data?.username ? `Your fleet · @${data.username}` : 'Your fleet — the people you share a car with'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />}
      >
        {/* ── 1. Your route ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Where you travel</Text>
          {route && !editingRoute ? (
            <>
              <Text style={styles.routeLine}>🟢 {route.pickup.address}</Text>
              <Text style={styles.routeLine}>🔴 {route.dropoff.address}</Text>
              <Pressable
                onPress={() => {
                  setPickupText(route.pickup.address);
                  setDropoffText(route.dropoff.address);
                  setEditingRoute(true);
                }}
              >
                <Text style={styles.link}>Change</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardHint}>
                Save your own run first. It is what decides who can share a car with you.
              </Text>
              <TextInput
                value={pickupText}
                onChangeText={setPickupText}
                placeholder="Where you start — e.g. Johar Town, Lahore"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <TextInput
                value={dropoffText}
                onChangeText={setDropoffText}
                placeholder="Where you go — e.g. Gulberg III"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <Pressable style={styles.primaryBtn} onPress={saveRoute} disabled={busy}>
                <Text style={styles.primaryBtnTxt}>{busy ? 'Saving…' : 'Save my route'}</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* ── 2. Going now ──
             Above the member admin on purpose: this is the thing the fleet is
             for, and the pool it forms is complete before a driver is asked. */}
        {route ? (
          hosted ? (
            <View style={[styles.card, styles.liveCard]}>
              <Text style={styles.cardTitle}>Your fleet is being asked</Text>
              <Text style={styles.cardHint}>
                Going to {hosted.dropoffAddress}
                {hosted.note ? ` · “${hosted.note}”` : ''}
              </Text>
              {hosted.accepted.length === 0 ? (
                <Text style={styles.emptyTxt}>Nobody has answered yet.</Text>
              ) : (
                <>
                  <Text style={styles.sectionNote}>
                    {hosted.accepted.length} coming — they will be seated on the car before any
                    driver is asked.
                  </Text>
                  {hosted.accepted.map((p) => <PersonRow key={p.uid} person={p} />)}
                </>
              )}

              <Text style={styles.sectionNote}>Which car?</Text>
              <View style={styles.chipRow}>
                {FLEET_RIDE_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.chip, rideType === t && styles.chipActive]}
                    onPress={() => setRideType(t)}
                  >
                    <Text style={[styles.chipTxt, rideType === t && styles.chipTxtActive]}>
                      {RIDE_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Pressable style={styles.primaryBtn} onPress={() => book(hosted.askId)} disabled={busy}>
                <Text style={styles.primaryBtnTxt}>
                  {busy ? 'Booking…' : `Book for ${hosted.accepted.length + 1}`}
                </Text>
              </Pressable>
              <Pressable onPress={() => run(() => api.cancelFleetRideAsk({ askId: hosted.askId }))}>
                <Text style={styles.dangerLink}>Cancel this request</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={[styles.card, styles.goCard]}
              onPress={() => {
                setAskDestination(route.dropoff.address);
                setAsking(true);
              }}
              disabled={(data?.members.length ?? 0) === 0}
            >
              <Text style={styles.goTitle}>🚗 I&apos;m going — anyone coming?</Text>
              <Text style={styles.cardHint}>
                {(data?.members.length ?? 0) === 0
                  ? 'Add someone to your fleet first.'
                  : 'One message to your whole fleet. Everyone who says yes is on the car before a driver is even asked — so nobody waits, and every seat splits the fare.'}
              </Text>
            </Pressable>
          )
        ) : null}

        {/* ── Asks sent TO you ── */}
        {(data?.inbox.length ?? 0) > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your fleet is going</Text>
            {data!.inbox.map((ask) => (
              <View key={ask.askId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{ask.hostName} → {ask.dropoffAddress}</Text>
                  {ask.note ? <Text style={styles.rowSub}>“{ask.note}”</Text> : null}
                </View>
                {ask.accepted ? (
                  <Text style={styles.okTag}>You&apos;re in</Text>
                ) : (
                  <View style={styles.actions}>
                    <Pressable
                      style={styles.yesBtn}
                      onPress={() => run(() => api.respondFleetRideAsk({ askId: ask.askId, accept: true }))}
                    >
                      <Text style={styles.yesBtnTxt}>I&apos;m in</Text>
                    </Pressable>
                    <Pressable
                      style={styles.noBtn}
                      onPress={() => run(() => api.respondFleetRideAsk({ askId: ask.askId, accept: false }))}
                    >
                      <Text style={styles.noBtnTxt}>No</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Requests to join your fleet ── */}
        {(data?.requests.length ?? 0) > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Wants to join your fleet</Text>
            {data!.requests.map((r) => (
              <View key={r.fromUid} style={styles.row}>
                <Avatar person={r.person} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{r.person?.name ?? 'A rider'}</Text>
                  <Text style={styles.rowSub}>
                    {r.message || (r.person?.username ? `@${r.person.username}` : 'No message')}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <Pressable
                    style={styles.yesBtn}
                    onPress={() => run(() => api.respondFleetRequest({ fromUid: r.fromUid, accept: true }))}
                  >
                    <Text style={styles.yesBtnTxt}>Accept</Text>
                  </Pressable>
                  <Pressable
                    style={styles.noBtn}
                    onPress={() => run(() => api.respondFleetRequest({ fromUid: r.fromUid, accept: false }))}
                  >
                    <Text style={styles.noBtnTxt}>No</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── Your members ── */}
        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle}>Your fleet ({data?.members.length ?? 0})</Text>
            <Pressable
              onPress={() => { setAdding({ username: '' }); setAddMessage(''); }}
              disabled={!route}
            >
              <Text style={[styles.link, !route && { opacity: 0.4 }]}>+ Add by username</Text>
            </Pressable>
          </View>
          {(data?.members.length ?? 0) === 0 ? (
            <Text style={styles.emptyTxt}>
              Nobody yet. Add the people you already travel with — they get a request and decide.
            </Text>
          ) : (
            data!.members.map((p) => (
              <PersonRow
                key={p.uid}
                person={p}
                action={
                  <Pressable onPress={() => confirmRemove(p)}>
                    <Text style={styles.dangerLink}>Leave</Text>
                  </Pressable>
                }
              />
            ))
          )}
        </View>

        {/* ── Riders on the same run ── */}
        {(data?.suggestions.length ?? 0) > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Riders who take your route</Text>
            <Text style={styles.cardHint}>
              They saved a route that starts and ends near yours. Nothing is shared with them
              until they accept.
            </Text>
            {data!.suggestions.map((p) => (
              <PersonRow
                key={p.uid}
                person={p}
                action={
                  p.username ? (
                    <Pressable
                      onPress={() => { setAdding({ username: p.username! }); setAddMessage(''); }}
                    >
                      <Text style={styles.link}>Add</Text>
                    </Pressable>
                  ) : null
                }
              />
            ))}
          </View>
        ) : null}

        {/* The one piece of promotion on this screen, and it belongs here: a
            rider who has just built a circle of people they ride with is
            exactly who the partner programme pays. */}
        <Text style={styles.adLead}>Your fleet can pay you back</Text>
        <Text style={styles.adHint}>
          Bring your fleet on as your own referrals and you earn every time they ride.
        </Text>
        <EarnCard onPress={() => router.push('/passenger/earn')} />

        {/* Renting a whole car was this drawer slot (Special Rides). It stays
            reachable for anyone with a listing or a booking in it. */}
        <Pressable
          style={styles.card}
          onPress={() => router.push('/passenger/special-rides')}
          accessibilityRole="button"
        >
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle}>Rent a whole car</Text>
            <Text style={styles.link}>Open →</Text>
          </View>
          <Text style={styles.cardHint}>
            By the day, with or without a driver — or list your own car.
          </Text>
        </Pressable>

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Add by username */}
      <Modal visible={adding !== null} transparent animationType="slide" onRequestClose={() => setAdding(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAdding(null)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add to your fleet</Text>
          <View style={styles.inputRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={adding?.username ?? ''}
              onChangeText={(t) => setAdding({ username: t })}
              placeholder="their username"
              placeholderTextColor={colors.muted}
              style={styles.inputFlat}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={7}
            />
          </View>
          <TextInput
            value={addMessage}
            onChangeText={setAddMessage}
            placeholder="Add a message (optional) — e.g. “Same office, 9am?”"
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={200}
          />
          <Pressable style={styles.primaryBtn} onPress={sendRequest} disabled={busy}>
            <Text style={styles.primaryBtnTxt}>{busy ? 'Sending…' : 'Send request'}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Going now */}
      <Modal visible={asking} transparent animationType="slide" onRequestClose={() => setAsking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setAsking(false)} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Tell your fleet where you&apos;re going</Text>
          <TextInput
            value={askDestination}
            onChangeText={setAskDestination}
            placeholder="Destination"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <TextInput
            value={askNote}
            onChangeText={setAskNote}
            placeholder="Anything to add? e.g. “Leaving in 10 minutes”"
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={160}
          />
          <Text style={styles.cardHint}>
            Everyone in your fleet gets this. You book once they have answered — the car goes out
            to drivers already full.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={askFleet} disabled={busy}>
            <Text style={styles.primaryBtnTxt}>{busy ? 'Sending…' : 'Ask my fleet'}</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Avatar({ person }: { person: FleetPerson | null }) {
  if (person?.photoURL) {
    return <Image source={{ uri: person.photoURL }} style={styles.avatar} alt={person.name} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarEmpty]}>
      <Text style={styles.avatarTxt}>{(person?.name ?? '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

function PersonRow({ person, action }: { person: FleetPerson; action?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Avatar person={person} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{person.name}</Text>
        {person.username ? <Text style={styles.rowSub}>@{person.username}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  centre: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn:  { padding: 4 },
  backTxt:  { fontSize: 24, color: colors.text },
  title:    { fontSize: 22, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 12.5, color: colors.muted, fontWeight: '700' },

  card: {
    backgroundColor: colors.surface, borderRadius: 18, padding: 16, gap: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle:   { fontSize: 15.5, fontWeight: '900', color: colors.text },
  cardHint:    { fontSize: 12.5, color: colors.muted, fontWeight: '600', lineHeight: 18 },
  sectionNote: { fontSize: 12, color: colors.muted, fontWeight: '800', marginTop: 2 },
  emptyTxt:    { fontSize: 13, color: colors.muted, fontWeight: '600', lineHeight: 19 },
  routeLine:   { fontSize: 14, color: colors.text, fontWeight: '700' },
  link:        { fontSize: 12.5, color: colors.primary, fontWeight: '900' },
  dangerLink:  { fontSize: 12.5, color: colors.danger, fontWeight: '800' },

  goCard:   { borderColor: colors.primary },
  goTitle:  { fontSize: 16.5, fontWeight: '900', color: colors.primary },
  liveCard: { borderColor: colors.primary },

  input: {
    minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 14, fontSize: 14.5, color: colors.text, backgroundColor: colors.background,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    height: 48, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 14, backgroundColor: colors.background,
  },
  at:        { fontSize: 16, fontWeight: '900', color: colors.muted },
  inputFlat: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text, height: '100%' },

  primaryBtn:    { height: 48, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnTxt: { fontSize: 15, fontWeight: '900', color: '#000' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowName: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  rowSub:  { fontSize: 12, color: colors.muted, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yesBtn:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.primary },
  yesBtnTxt: { fontSize: 12.5, fontWeight: '900', color: '#000' },
  noBtn:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  noBtnTxt:  { fontSize: 12.5, fontWeight: '800', color: colors.muted },
  okTag:     { fontSize: 12.5, fontWeight: '900', color: colors.primary },

  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:         { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: colors.border },
  chipActive:   { borderColor: colors.primary, backgroundColor: `${colors.primary}18` },
  chipTxt:      { fontSize: 12.5, fontWeight: '800', color: colors.muted },
  chipTxtActive:{ color: colors.primary },

  avatar:      { width: 38, height: 38, borderRadius: 19 },
  avatarEmpty: { backgroundColor: colors.glassStrong, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:   { fontSize: 15, fontWeight: '900', color: colors.text },

  adLead: { fontSize: 14.5, fontWeight: '900', color: colors.text, marginTop: 6 },
  adHint: { fontSize: 12.5, color: colors.muted, fontWeight: '600', marginTop: -6 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.surface, padding: 20, gap: 12,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderTopWidth: 1, borderColor: colors.border,
  },
  sheetTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
}));
