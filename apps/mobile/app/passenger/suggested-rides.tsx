/**
 * Shared rides — /passenger/suggested-rides
 *
 * Every shared car near the rider that still has a seat, in one place, whichever
 * of Velocity's three pooling subsystems the seat happens to live in (see
 * `getSuggestedRides` on the backend — it does the merging).
 *
 * WHY IT EXISTS
 * Discovery used to be reachable only from inside the booking flow, after a
 * destination had been typed. That is exactly backwards for the rider who has
 * not decided anything yet and just wants to know whether anyone is already
 * driving their way. This screen is that question, asked before any commitment.
 *
 * THE FOUR THINGS IT ANSWERS, IN THE ORDER RIDERS ASK THEM
 *  1. "Is anything going where I am going?" — the search box. One box, matched
 *     against both ends of every journey, so typing an area finds the cars
 *     going TO it as well as the ones leaving FROM it.
 *  2. "Whose car is it?" — women's rides, men's rides and mixed ones are
 *     separate lists under their own headings, and the chips above can narrow
 *     to one of them. In Pakistan this is not a filter, it is the first
 *     question, and making a rider read every row's small print to answer it
 *     was making them read it for nothing.
 *  3. "Which areas have anything at all?" — the Areas tab: one card per
 *     destination, with what leaves soonest, the cheapest seat, and which
 *     pickups feed it. Tapping one searches for it.
 *  4. "When does it leave?" — every row carries a time, and `rideTimeInfo`
 *     makes sure it is a time the data actually supports: only a driver-posted
 *     ride is scheduled, so only it gets a clock time.
 *
 * WHAT A ROW STILL PROMISES
 *  - It has a free seat. Full cars are dropped server-side.
 *  - The fare is what THIS rider would pay, and a joiner cannot move it.
 *  - It says before the tap whether joining seats you or asks a driver.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api, type SuggestedRide } from '../../src/api/client';
import { useCurrentLocation } from '../../src/hooks/location';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';
import {
  POOL_AUDIENCE_CHIP,
  POOL_AUDIENCE_FILTER,
  POOL_AUDIENCE_LABEL,
  POOL_AUDIENCE_NOTE,
  poolAudience,
  poolGenderSummary,
  type PoolAudience,
} from '../../src/lib/genderAccess';
import {
  groupRidesByArea,
  rideSearchMatch,
  rideTimeInfo,
  searchTokens,
  shortAreaName,
  type RideAreaGroup,
} from '../../src/lib/rideSearch';
import { useGenderPref } from '../../src/hooks/genderPref';
import { PoolIcon } from '../../src/ui/RideIcons';

/** How far out to look, in the rider's own words. */
const RADIUS_OPTIONS = [2, 5, 10, 25] as const;
const DEFAULT_RADIUS_KM = 5;
/** The widest option, offered by name when a search finds nothing nearer. */
const WIDEST_RADIUS_KM: number = RADIUS_OPTIONS[RADIUS_OPTIONS.length - 1] ?? 25;

const GENDER_LABEL: Record<string, string> = {
  male_only: '♂ Males only',
  female_only: '♀ Females only',
};

/**
 * Heading order. A rider's own kind first — that is the list they came for —
 * then mixed, then the empty cars anyone may start. Whichever sections are
 * empty simply do not render.
 */
const AUDIENCE_ORDER: Record<string, PoolAudience[]> = {
  female: ['female', 'mixed', 'open', 'male'],
  male: ['male', 'mixed', 'open', 'female'],
  unspecified: ['open', 'female', 'male', 'mixed'],
};

/** Rides, or the areas they go to. Two views of one list, never two lists. */
type Tab = 'rides' | 'areas';

/**
 * Each group named as a noun that reads inside a sentence. The headings and the
 * chips cannot do this job: "No ♀ Women’s rides within 5 km" is a heading
 * wearing a sentence's clothes.
 */
const AUDIENCE_NOUN: Record<PoolAudience, string> = {
  female: 'women’s rides',
  male: 'men’s rides',
  mixed: 'mixed rides',
  open: 'rides with nobody aboard yet',
};

/** "7:12" — how long a gathering ride has left to take riders. */
function countdown(endsAt: number, now: number): string {
  const secs = Math.ceil(Math.max(0, endsAt - now) / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/* Audience colours, kept as functions rather than a style map so the themed()
   sheet stays statically typed: pink for women's cars, blue for men's, lime for
   the ones anyone may join. The glyph carries the meaning on its own — the
   colour is only there to make the groups scannable. */
function audienceTint(a: PoolAudience) {
  if (a === 'female') return styles.tintFemale;
  if (a === 'male') return styles.tintMale;
  if (a === 'mixed') return styles.tintMixed;
  return styles.tintOpen;
}

function audienceInk(a: PoolAudience) {
  if (a === 'female') return styles.inkFemale;
  if (a === 'male') return styles.inkMale;
  if (a === 'mixed') return styles.inkMixed;
  return styles.inkOpen;
}

/** "♀ 2 · ♂ 1" — what kinds of car go to an area, for an Areas card. */
function audienceTally(counts: Record<PoolAudience, number>): string {
  const order: PoolAudience[] = ['female', 'male', 'mixed', 'open'];
  return order
    .filter((a) => counts[a] > 0)
    .map((a) => `${POOL_AUDIENCE_FILTER[a]} ${counts[a]}`)
    .join(' · ');
}

function RideRow({
  ride,
  now,
  busy,
  tokens,
  onPress,
}: {
  ride: SuggestedRide;
  now: number;
  busy: boolean;
  tokens: string[];
  onPress: () => void;
}) {
  const gathering = !ride.hasDriver && ride.joinWindowEndsAt != null;
  const audience = poolAudience(ride);
  const time = rideTimeInfo(ride, now);
  const matched = rideSearchMatch(ride, tokens);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={
        `${POOL_AUDIENCE_CHIP[audience]} ride. `
        + `Join a shared ride to ${ride.destinationAreaName} for ${ride.farePerSeat} rupees. `
        + time.label
      }
    >
      <View style={styles.cardHead}>
        <View style={styles.iconWrap}>
          <PoolIcon size={16} color={colors.primary} accent={colors.primary} />
        </View>
        {/* Both ends, shortened. A full Google address ("Blue Area, Islamabad,
            Islamabad Capital Territory 44000, Pakistan") truncates to the half
            that says least; the whole thing still goes to the screen reader. */}
        <View style={{ flex: 1 }}>
          <Text style={styles.dest} numberOfLines={1}>
            {shortAreaName(ride.destinationAreaName)}
          </Text>
          <Text style={styles.pickup} numberOfLines={1}>
            from {shortAreaName(ride.pickupAreaName)} · {ride.distanceKm} km away
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.fare}>PKR {ride.farePerSeat}</Text>
          <Text style={styles.fareSub}>per seat</Text>
        </View>
      </View>

      {/* The same answer as the section heading, repeated on the row — rows get
          screenshotted, shared and scrolled past their heading, and "which car
          is this" must survive all three. Beside it, when the rider searched,
          which end of this journey their words landed on. */}
      <View style={styles.audienceRow}>
        <View style={[styles.audienceChip, audienceTint(audience)]}>
          <Text style={[styles.audienceTxt, audienceInk(audience)]}>
            {POOL_AUDIENCE_CHIP[audience]}
          </Text>
        </View>
        {matched !== null ? (
          <View style={[styles.audienceChip, styles.matchChip]}>
            <Text style={[styles.audienceTxt, styles.matchTxt]}>
              {matched === 'to'
                ? 'going there'
                : matched === 'from'
                  ? 'starts there'
                  : 'both ends'}
            </Text>
          </View>
        ) : null}
      </View>

      {/* When it leaves — never a clock time the data cannot back. */}
      {time.label ? (
        <Text style={[styles.time, time.kind === 'now' && styles.timeNow]}>🕒 {time.label}</Text>
      ) : null}

      {/* The state of the car, in one line. This is the difference between a
          cheap seat and a certain one, and riders choose on it. */}
      <Text style={[styles.state, ride.hasDriver ? styles.stateDriver : styles.stateGathering]}>
        {ride.hasDriver
          ? `🚗 ${ride.driverName ? `${ride.driverName} — driver confirmed` : 'Driver confirmed'}`
          : gathering
            ? `⏳ Gathering riders · ${countdown(ride.joinWindowEndsAt!, now)} left to join`
            : '⏳ Looking for a driver'}
      </Text>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {ride.seatsLeft} seat{ride.seatsLeft === 1 ? '' : 's'} left of {ride.seatsTotal}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.meta}>{poolGenderSummary(ride.males, ride.females)}</Text>
        {GENDER_LABEL[ride.genderPref] ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>{GENDER_LABEL[ride.genderPref]}</Text>
          </>
        ) : null}
      </View>

      {ride.companions.length > 0 ? (
        <Text style={styles.companions} numberOfLines={1}>
          with {ride.companions.map((c) => c.firstName).join(', ')}
        </Text>
      ) : null}

      <Text style={styles.cta}>
        {ride.needsDriverApproval ? 'Ask the driver for this seat →' : 'Join this ride →'}
      </Text>
    </Pressable>
  );
}

/**
 * One destination, and everything going to it. The answer to "which areas have
 * rides" — and, because the time is on the card, to "when".
 */
function AreaCard({
  group,
  onPress,
}: {
  group: RideAreaGroup<SuggestedRide>;
  onPress: () => void;
}) {
  const count = group.rides.length;
  return (
    <Pressable
      style={({ pressed }) => [styles.areaCard, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${count} shared rides to ${group.area}. ${group.nextLabel}. From ${group.cheapestFare} rupees a seat.`}
    >
      <View style={styles.areaHead}>
        <Text style={styles.areaName} numberOfLines={1}>{group.area}</Text>
        <View style={styles.areaCount}>
          <Text style={styles.areaCountTxt}>{count}</Text>
        </View>
      </View>
      {group.nextLabel ? (
        <Text style={styles.areaTime} numberOfLines={1}>🕒 {group.nextLabel}</Text>
      ) : null}
      <Text style={styles.areaFrom} numberOfLines={2}>
        from {group.pickupAreas.join(' · ')}
      </Text>
      <View style={styles.areaFootRow}>
        <Text style={styles.areaTally} numberOfLines={1}>{audienceTally(group.audiences)}</Text>
        <Text style={styles.areaFare}>from PKR {group.cheapestFare}</Text>
      </View>
    </Pressable>
  );
}

export default function SuggestedRidesScreen() {
  const router = useRouter();
  const { coords, request: requestLocation } = useCurrentLocation();
  // Read, not asked for, here: the choice is made on home and this screen only
  // reports it, so the rider understands why the list looks the way it does.
  const { pref, gender } = useGenderPref();

  const [rides, setRides] = useState<SuggestedRide[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>('rides');
  const [query, setQuery] = useState('');
  /** null = every audience. One value = only that list. */
  const [onlyAudience, setOnlyAudience] = useState<PoolAudience | null>(null);

  // One ticker for every countdown on the screen, rather than one per row.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!coords) return;
    setLoading(true);
    try {
      const r = await api.getSuggestedRides({ lat: coords.lat, lng: coords.lng, radiusKm });
      setRides(r.rides);
    } catch {
      // Discovery is best-effort — an empty list reads better than an error box
      // on a screen whose whole job is "here is what is around you".
      setRides([]);
    } finally {
      setLoading(false);
    }
  }, [coords?.lat, coords?.lng, radiusKm]);

  useEffect(() => { void load(); }, [load]);

  const tokens = useMemo(() => searchTokens(query), [query]);

  /** What the rider typed, applied to both ends of every journey. */
  const found = useMemo(
    () => (rides ?? []).filter((r) => tokens.length === 0 || rideSearchMatch(r, tokens) !== null),
    [rides, tokens],
  );

  /** How many cars of each kind survived the search — the numbers on the chips. */
  const audienceCounts = useMemo(() => {
    const counts: Record<PoolAudience, number> = { female: 0, male: 0, mixed: 0, open: 0 };
    for (const r of found) counts[poolAudience(r)] += 1;
    return counts;
  }, [found]);

  /** Everything both the search and the chosen chip allow — what both tabs show. */
  const visible = useMemo(
    () => (onlyAudience === null ? found : found.filter((r) => poolAudience(r) === onlyAudience)),
    [found, onlyAudience],
  );

  /** Which end of their journeys the search landed on, for the line above the list. */
  const matchSides = useMemo(() => {
    let to = 0;
    let from = 0;
    for (const r of visible) {
      const side = rideSearchMatch(r, tokens);
      if (side === 'from') from += 1;
      else if (side !== null) to += 1;
    }
    return { to, from };
  }, [visible, tokens]);

  /**
   * One list per audience, in the order that puts the rider's own kind of car
   * at the top. The server has already dropped every ride the gender rules keep
   * this rider out of, so a section that renders is a section they can join —
   * the headings explain the shape of the list, they do not promise more of it.
   *
   * A chosen chip collapses this to the one list, which is the same grouping
   * with the other three hidden, not a different query.
   */
  const sections = useMemo(() => {
    const order = AUDIENCE_ORDER[gender] ?? AUDIENCE_ORDER.unspecified!;
    const buckets = new Map<PoolAudience, SuggestedRide[]>();
    for (const ride of visible) {
      const key = poolAudience(ride);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(ride);
      else buckets.set(key, [ride]);
    }
    return order
      .filter((a) => (buckets.get(a)?.length ?? 0) > 0)
      .map((a) => ({
        audience: a,
        title: POOL_AUDIENCE_LABEL[a],
        note: POOL_AUDIENCE_NOTE[a],
        data: buckets.get(a)!,
      }));
  }, [visible, gender]);

  /* The ride rows need `now` every second for their join countdowns; area cards
     only ever say minutes, so they regroup on the minute instead of rebuilding
     the whole list sixty times for text that did not change. */
  const nowMinute = Math.floor(now / 60000) * 60000;

  /** Areas, honouring the same search and the same chip as the Rides tab. */
  const areas = useMemo(() => groupRidesByArea(visible, nowMinute), [visible, nowMinute]);

  /** Tapping an area is a search for it — one mechanism, not a second filter. */
  function openArea(group: RideAreaGroup<SuggestedRide>) {
    setQuery(group.area);
    setTab('rides');
  }

  /**
   * Take the seat, or ask for it. Which call to make is decided by which
   * subsystem the row came from — the rider never sees that distinction. What
   * the rider does see is the true outcome: a driver-posted car can queue a
   * join until a second rider of the same gender turns up, and saying "you are
   * in" to a queued rider would put them on a road waiting for a car that was
   * never coming.
   */
  async function join(ride: SuggestedRide) {
    // Booked shared rides have their own join screen (companions, driver,
    // gender mix, the fare breakdown) and it is a better place to decide from
    // than a row.
    if (ride.kind === 'trip') {
      router.push(`/passenger/pool-join/${ride.id}` as Parameters<typeof router.push>[0]);
      return;
    }

    setBusyId(ride.id);
    try {
      if (ride.kind === 'request') {
        const res = await api.joinPoolRideRequest({ requestId: ride.id });
        Alert.alert(
          res.pending ? 'Asked the driver' : 'You are in 🎉',
          res.pending
            ? 'The driver has to agree before you take the seat — you will get a notification either way.'
            : `PKR ${res.farePerSeat} for your seat. You will see the ride in your activity.`,
        );
      } else {
        if (!coords) { requestLocation(); return; }
        const res = await api.joinPoolRide({
          rideId: ride.id,
          pickupLat: coords.lat,
          pickupLng: coords.lng,
          pickupAddress: 'Current location',
          dropoffAddress: ride.destinationAreaName,
        });
        if (res.queued) {
          // The car already holds a man and a woman, so the back row waits for
          // a same-gender pair. Nobody has a seat yet, and the rider must know.
          Alert.alert(
            'You are in the queue',
            res.waitingSameGender && res.waitingSameGender > 1
              ? `${res.waitingSameGender} riders of your gender are waiting for this car — the driver is asked as soon as a pair is ready.`
              : 'This car is carrying both genders, so your seat waits for another rider of your gender. '
                + 'You will be notified the moment the driver takes you.',
          );
        } else {
          Alert.alert('You are in 🎉', `PKR ${ride.farePerSeat} for your seat.`);
        }
      }
      await load();
    } catch (e) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/passenger/home'));

  /* ── The controls: search, the two tabs, who and how far ───────────────── */
  const controls = (
    <>
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search an area — Blue Area, Saddar…"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search shared rides by area"
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear the search">
            <Text style={styles.searchClear}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabRow}>
        {(['rides', 'areas'] as Tab[]).map((t) => {
          const on = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.tabBtn, on && styles.tabBtnOn]}
              onPress={() => setTab(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>
                {t === 'rides'
                  ? `Rides${visible.length > 0 ? ` · ${visible.length}` : ''}`
                  : `Areas${areas.length > 0 ? ` · ${areas.length}` : ''}`}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Who, then how far. Both narrow the same list, so they share one
          scrolling row rather than costing the screen two. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={[styles.chip, onlyAudience === null && styles.chipOn]}
          onPress={() => setOnlyAudience(null)}
        >
          <Text style={[styles.chipTxt, onlyAudience === null && styles.chipTxtOn]}>All</Text>
        </Pressable>
        {(['female', 'male', 'mixed', 'open'] as PoolAudience[]).map((a) => {
          const on = onlyAudience === a;
          const n = audienceCounts[a];
          return (
            <Pressable
              key={a}
              style={[styles.chip, on && styles.chipOn, n === 0 && styles.chipEmpty]}
              onPress={() => setOnlyAudience(on ? null : a)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>
                {POOL_AUDIENCE_FILTER[a]}{n > 0 ? ` ${n}` : ''}
              </Text>
            </Pressable>
          );
        })}
        <View style={styles.filterDivider} />
        {RADIUS_OPTIONS.map((km) => {
          const on = km === radiusKm;
          return (
            <Pressable
              key={km}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setRadiusKm(km)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{km} km</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );

  /* Why the list is as short as it is. A rider on same-gender-only is seeing a
     deliberately narrow slice, and without this the missing cars read as
     "Velocity has nothing" rather than "I asked for this" — with a tap back to
     home to change the answer. */
  const prefNote = (rides ?? []).length > 0 ? (
    <Pressable
      style={styles.prefNote}
      onPress={goBack}
      accessibilityRole="button"
      accessibilityLabel="Change who you will share a ride with"
    >
      <Text style={styles.prefNoteTxt}>
        {pref === 'any_gender'
          ? 'Showing shared rides of any gender, as you chose on the home screen.'
          : pref === 'same_gender'
            ? 'Showing only shared rides you can share with, as you chose on the home screen.'
            : 'You have not chosen a gender preference yet — only same-gender rides are shown.'}
        {'  '}Change →
      </Text>
    </Pressable>
  ) : null;

  /** Nothing matched. Which of the three reasons it was decides what to offer. */
  const emptyBody = (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>
        {tokens.length > 0
          ? `Nothing going to “${query.trim()}” yet`
          : onlyAudience !== null
            ? `No ${AUDIENCE_NOUN[onlyAudience]} nearby`
            : 'Nothing going your way yet'}
      </Text>
      <Text style={styles.emptySub}>
        {tokens.length > 0
          ? `No shared car within ${radiusKm} km starts or ends near those words.`
          : onlyAudience !== null
            ? `No car of that kind within ${radiusKm} km has a free seat right now.`
            : `No shared car within ${radiusKm} km has a free seat right now.`}
        {' '}Widen the search — or book your own shared ride and let riders going your way join you.
      </Text>
      {radiusKm !== WIDEST_RADIUS_KM ? (
        <Pressable style={styles.secondaryBtn} onPress={() => setRadiusKm(WIDEST_RADIUS_KM)}>
          <Text style={styles.secondaryBtnTxt}>Search within {WIDEST_RADIUS_KM} km</Text>
        </Pressable>
      ) : null}
      {onlyAudience !== null ? (
        <Pressable style={styles.secondaryBtn} onPress={() => setOnlyAudience(null)}>
          <Text style={styles.secondaryBtnTxt}>Show every kind of ride</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.primaryBtn} onPress={() => router.push('/passenger/booking')}>
        <Text style={styles.primaryBtnTxt}>Book my own shared ride</Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={goBack} hitSlop={8}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Shared rides</Text>
          <Text style={styles.headerSub}>Who is going where, and when</Text>
        </View>
      </View>

      {controls}

      {!coords ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>We need your location</Text>
          <Text style={styles.emptySub}>
            Shared rides are the cars going your way from where you are standing.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={requestLocation}>
            <Text style={styles.primaryBtnTxt}>Enable location</Text>
          </Pressable>
        </View>
      ) : loading && rides === null ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.emptySub}>Looking for shared rides around you…</Text>
        </View>
      ) : tab === 'areas' ? (
        <FlatList
          data={areas}
          keyExtractor={(g) => g.key}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            areas.length > 0 ? (
              <Text style={styles.areasIntro}>
                {areas.length} area{areas.length === 1 ? '' : 's'} with a seat free within {radiusKm} km
                {' '}· soonest first. Tap one to see its rides.
              </Text>
            ) : null
          }
          renderItem={({ item }) => <AreaCard group={item} onPress={() => openArea(item)} />}
          ListEmptyComponent={emptyBody}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => `${r.kind}:${r.id}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <RideRow
              ride={item}
              now={now}
              tokens={tokens}
              busy={busyId === item.id}
              onPress={() => void join(item)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.sectionNote}>
                {section.note} · {section.data.length} ride
                {section.data.length === 1 ? '' : 's'}
              </Text>
            </View>
          )}
          ListHeaderComponent={
            <View style={styles.listHead}>
              {tokens.length > 0 && visible.length > 0 ? (
                <Text style={styles.searchSummary}>
                  “{query.trim()}” ·{' '}
                  {matchSides.to > 0
                    ? `${matchSides.to} going there`
                    : ''}
                  {matchSides.to > 0 && matchSides.from > 0 ? ' · ' : ''}
                  {matchSides.from > 0 ? `${matchSides.from} starting there` : ''}
                </Text>
              ) : null}
              {prefNote}
            </View>
          }
          ListEmptyComponent={emptyBody}
        />
      )}
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  backTxt: { color: colors.text, fontSize: 18, fontWeight: '800' },
  headerTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  headerSub: { color: colors.muted, fontSize: 12, fontWeight: '600', marginTop: 1 },

  /* ── Search ── */
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    paddingHorizontal: 12, height: 46,
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', padding: 0 },
  searchClear: { color: colors.muted, fontSize: 15, fontWeight: '900', paddingHorizontal: 4 },

  /* ── Rides | Areas ── */
  tabRow: {
    flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 10,
    backgroundColor: colors.card, borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: colors.border,
  },
  tabBtn: { flex: 1, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabBtnOn: { backgroundColor: colors.glassLime },
  tabTxt: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  tabTxtOn: { color: colors.primary },

  /* ── Who, and how far ── */
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.glassLime, borderColor: colors.primary },
  chipEmpty: { opacity: 0.45 },
  chipTxt: { color: colors.muted, fontSize: 12.5, fontWeight: '800' },
  chipTxtOn: { color: colors.primary },
  filterDivider: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 2 },

  list: { padding: 16, paddingTop: 4, gap: 12 },
  listHead: { gap: 10 },
  searchSummary: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },

  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 7,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconWrap: {
    width: 34, height: 34, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassLime,
  },
  dest: { color: colors.text, fontSize: 15, fontWeight: '900' },
  pickup: { color: colors.muted, fontSize: 11.5, fontWeight: '600', marginTop: 1 },
  fare: { color: colors.primary, fontSize: 16, fontWeight: '900' },
  fareSub: { color: colors.muted, fontSize: 10, fontWeight: '700' },

  /* ── One list per audience ── */
  sectionHead: { paddingTop: 10, gap: 2 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '900', letterSpacing: -0.2 },
  sectionNote: { color: colors.muted, fontSize: 11, fontWeight: '700' },

  prefNote: {
    backgroundColor: colors.glassLime,
    borderWidth: 1,
    borderColor: colors.glassLimeBorder,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  prefNoteTxt: { color: colors.text, fontSize: 11.5, fontWeight: '700', lineHeight: 16 },

  audienceRow: { flexDirection: 'row', gap: 6 },
  audienceChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  audienceTxt: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.2 },
  tintFemale: { backgroundColor: 'rgba(236,72,153,0.14)', borderColor: 'rgba(236,72,153,0.45)' },
  tintMale: { backgroundColor: 'rgba(59,130,246,0.14)', borderColor: 'rgba(59,130,246,0.45)' },
  tintMixed: { backgroundColor: 'rgba(168,85,247,0.14)', borderColor: 'rgba(168,85,247,0.45)' },
  tintOpen: { backgroundColor: colors.glassLime, borderColor: colors.glassLimeBorder },
  inkFemale: { color: '#ec4899' },
  inkMale: { color: '#3b82f6' },
  inkMixed: { color: '#a855f7' },
  inkOpen: { color: colors.primary },
  matchChip: { backgroundColor: 'transparent', borderColor: colors.border },
  matchTxt: { color: colors.muted },

  time: { color: colors.text, fontSize: 12, fontWeight: '800' },
  timeNow: { color: '#22c55e' },

  state: { fontSize: 12, fontWeight: '800' },
  stateDriver: { color: '#22c55e' },
  stateGathering: { color: colors.primary },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  meta: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  metaDot: { color: colors.muted, fontSize: 11.5 },
  companions: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  cta: { color: colors.primary, fontSize: 12.5, fontWeight: '900', marginTop: 2 },

  /* ── Areas ── */
  areasIntro: { color: colors.muted, fontSize: 11.5, fontWeight: '700', lineHeight: 16 },
  areaCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 5,
  },
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  areaName: { flex: 1, color: colors.text, fontSize: 15.5, fontWeight: '900' },
  areaCount: {
    minWidth: 26, height: 22, borderRadius: 11, paddingHorizontal: 7,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glassLime, borderWidth: 1, borderColor: colors.glassLimeBorder,
  },
  areaCountTxt: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  areaTime: { color: colors.text, fontSize: 12, fontWeight: '800' },
  areaFrom: { color: colors.muted, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  areaFootRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  areaTally: { flex: 1, color: colors.muted, fontSize: 11, fontWeight: '800' },
  areaFare: { color: colors.primary, fontSize: 13, fontWeight: '900' },

  center: { alignItems: 'center', gap: 10, padding: 30 },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  emptySub: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: colors.btnBg,
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  primaryBtnTxt: { color: colors.btnText, fontSize: 14.5, fontWeight: '900' },
  secondaryBtn: {
    marginTop: 4,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  secondaryBtnTxt: { color: colors.text, fontSize: 13.5, fontWeight: '800' },
}));
