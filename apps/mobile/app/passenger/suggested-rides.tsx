/**
 * Suggested Rides — /passenger/suggested-rides
 *
 * Every shared car near the rider that still has a seat, in one list, whichever
 * of Velocity's three pooling subsystems the seat happens to live in (see
 * `getSuggestedRides` on the backend — it does the merging).
 *
 * WHY IT EXISTS
 * Pool discovery used to be reachable only from inside the booking flow, after
 * a destination had been typed. That is exactly backwards for the rider who has
 * not decided anything yet and just wants to know whether anyone is already
 * driving their way. This screen is that question, asked from the home screen
 * before any commitment.
 *
 * WHAT IT PROMISES
 *  - Every row has a free seat. Full cars are filtered out server-side, because
 *    a list of rides you cannot take is not a list, it is a disappointment.
 *  - The fare on a row is what THIS rider would pay, and it is not negotiable.
 *    Whoever started the pool set it; a joiner takes it or does not join.
 *  - A row either seats you or asks a driver, and it says which before the tap.
 *  - Women's pools, men's pools and mixed ones are listed separately, under
 *    their own headings. One flat list made the rider read every row's small
 *    print to answer the first question they actually have — "is this the
 *    women's car?" — and that question deserves a heading, not a footnote.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
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
  POOL_AUDIENCE_LABEL,
  POOL_AUDIENCE_NOTE,
  poolAudience,
  poolGenderSummary,
  type PoolAudience,
} from '../../src/lib/genderAccess';
import { useGenderPref } from '../../src/hooks/genderPref';
import { PoolIcon } from '../../src/ui/RideIcons';

/** How far out to look, in the rider's own words. */
const RADIUS_OPTIONS = [2, 5, 10, 25] as const;
const DEFAULT_RADIUS_KM = 5;

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

/** "7:12" — how long a gathering pool has left to take riders. */
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

function RideRow({
  ride,
  now,
  busy,
  onPress,
}: {
  ride: SuggestedRide;
  now: number;
  busy: boolean;
  onPress: () => void;
}) {
  const gathering = !ride.hasDriver && ride.joinWindowEndsAt != null;
  const audience = poolAudience(ride);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={
        `${POOL_AUDIENCE_CHIP[audience]} pool. `
        + `Join a shared ride to ${ride.destinationAreaName} for ${ride.farePerSeat} rupees`
      }
    >
      <View style={styles.cardHead}>
        <View style={styles.iconWrap}>
          <PoolIcon size={16} color={colors.primary} accent={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.dest} numberOfLines={1}>{ride.destinationAreaName}</Text>
          <Text style={styles.pickup} numberOfLines={1}>
            from {ride.pickupAreaName} · {ride.distanceKm} km away
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.fare}>PKR {ride.farePerSeat}</Text>
          <Text style={styles.fareSub}>per seat</Text>
        </View>
      </View>

      {/* The same answer as the section heading, repeated on the row — rows get
          screenshotted, shared and scrolled past their heading, and "which car
          is this" must survive all three. */}
      <View style={styles.audienceRow}>
        <View style={[styles.audienceChip, audienceTint(audience)]}>
          <Text style={[styles.audienceTxt, audienceInk(audience)]}>
            {POOL_AUDIENCE_CHIP[audience]}
          </Text>
        </View>
      </View>

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

  /**
   * One list per audience, in the order that puts the rider's own kind of car
   * at the top. The server has already dropped every pool the gender rules keep
   * this rider out of, so a section that renders is a section they can join —
   * the headings explain the shape of the list, they do not promise more of it.
   */
  const sections = useMemo(() => {
    const order = AUDIENCE_ORDER[gender] ?? AUDIENCE_ORDER.unspecified!;
    const buckets = new Map<PoolAudience, SuggestedRide[]>();
    for (const ride of rides ?? []) {
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
  }, [rides, gender]);

  /**
   * Take the seat, or ask for it. Which call to make is decided by which
   * subsystem the row came from — the rider never sees that distinction.
   */
  async function join(ride: SuggestedRide) {
    // Pool trips have their own join screen (companions, driver, gender mix,
    // the fare breakdown) and it is a better place to decide from than a row.
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
        await api.joinPoolRide({
          rideId: ride.id,
          pickupLat: coords.lat,
          pickupLng: coords.lng,
          pickupAddress: 'Current location',
          dropoffAddress: ride.destinationAreaName,
        });
        Alert.alert('You are in 🎉', `PKR ${ride.farePerSeat} for your seat.`);
      }
      await load();
    } catch (e) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/passenger/home'));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={goBack} hitSlop={8}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Suggested Rides</Text>
          <Text style={styles.headerSub}>Shared cars near you with a seat free</Text>
        </View>
      </View>

      <View style={styles.radiusRow}>
        {RADIUS_OPTIONS.map((km) => {
          const on = km === radiusKm;
          return (
            <Pressable
              key={km}
              style={[styles.radiusChip, on && styles.radiusChipOn]}
              onPress={() => setRadiusKm(km)}
            >
              <Text style={[styles.radiusChipTxt, on && styles.radiusChipTxtOn]}>{km} km</Text>
            </Pressable>
          );
        })}
      </View>

      {!coords ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>We need your location</Text>
          <Text style={styles.emptySub}>
            Suggested Rides are the cars going your way from where you are standing.
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
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => `${r.kind}:${r.id}`}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.primary} />
          }
          renderItem={({ item }) => (
            <RideRow ride={item} now={now} busy={busyId === item.id} onPress={() => void join(item)} />
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
            /* Why the list is as short as it is. A rider on same-gender-only is
               seeing a deliberately narrow slice, and without this the missing
               cars read as "Velocity has nothing" rather than "I asked for
               this" — with a tap back to home to change the answer. */
            (rides ?? []).length > 0 ? (
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
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Nothing going your way yet</Text>
              <Text style={styles.emptySub}>
                No shared car within {radiusKm} km has a free seat right now. Widen the search
                above — or book your own shared ride and let riders going your way join you.
              </Text>
              <Pressable style={styles.primaryBtn} onPress={() => router.push('/passenger/booking')}>
                <Text style={styles.primaryBtnTxt}>Book my own shared ride</Text>
              </Pressable>
            </View>
          }
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

  radiusRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  radiusChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  radiusChipOn: { backgroundColor: colors.glassLime, borderColor: colors.primary },
  radiusChipTxt: { color: colors.muted, fontSize: 12.5, fontWeight: '800' },
  radiusChipTxtOn: { color: colors.primary },

  list: { padding: 16, paddingTop: 4, gap: 12 },
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

  audienceRow: { flexDirection: 'row' },
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

  state: { fontSize: 12, fontWeight: '800' },
  stateDriver: { color: '#22c55e' },
  stateGathering: { color: colors.primary },

  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  meta: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  metaDot: { color: colors.muted, fontSize: 11.5 },
  companions: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  cta: { color: colors.primary, fontSize: 12.5, fontWeight: '900', marginTop: 2 },

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
}));
