/**
 * Pool invite landing screen — /passenger/pool-join/{code}
 *
 * Opened from a pool share link, from Suggested Rides, or by tapping a pool on
 * the booking screen. Resolves the invite code, shows the ride and the per-seat
 * fare after joining, and gets the caller into the car.
 *
 * There are two ways in, and the screen says which one this is BEFORE the tap:
 *
 *  - The pool is still gathering riders (no driver yet). Joining is instant,
 *    and a countdown shows how long that window has left.
 *  - A driver has already agreed to carry it. Joining sends that driver a
 *    request, and the rider waits here for their answer.
 *
 * What never happens on this screen is a negotiation. The fare shown is the
 * pool's own per-seat tier, set by the rider who started it; a joiner takes it
 * or does not join.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FirebaseError } from 'firebase/app';

import { api, type PoolTripByCode } from '../../../src/api/client';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { RIDE_TYPE_LABELS, type RideType } from '../../../src/domain/types';
import { poolGenderSummary } from '../../../src/lib/genderAccess';

export default function PoolJoinScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = (Array.isArray(params.code) ? params.code[0] : params.code) ?? '';
  const router = useRouter();

  const [info, setInfo]       = useState<PoolTripByCode | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Ticks the gathering countdown. Only runs while there is one to show. */
  const [now, setNow] = useState(() => Date.now());

  const windowEndsAt = info?.gathering ? info.joinWindowEndsAt ?? null : null;
  useEffect(() => {
    if (windowEndsAt == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [windowEndsAt]);

  const windowLeft = useMemo(() => {
    if (windowEndsAt == null) return null;
    const secs = Math.ceil(Math.max(0, windowEndsAt - now) / 1000);
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  }, [windowEndsAt, now]);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    api.getPoolTripByCode({ code })
      .then((r) => { if (alive) setInfo(r); })
      .catch((e) => {
        if (alive) setError(e instanceof FirebaseError ? e.message : 'This pool invite is invalid or has expired.');
      });
    return () => { alive = false; };
  }, [code]);

  /**
   * Re-read the invite. Only reachable from the awaiting-driver state, where
   * the thing the rider is waiting on happens on somebody else's screen —
   * without this their only move is to back out and open the link again.
   */
  async function refresh() {
    setRefreshing(true);
    try {
      setInfo(await api.getPoolTripByCode({ code }));
    } catch {
      // Leave the last good snapshot up rather than blanking the screen.
    } finally {
      setRefreshing(false);
    }
  }

  async function join() {
    setJoining(true);
    try {
      const res = await api.joinPoolTrip({ code });
      // A pool with a driver does not seat anyone on a tap — the driver decides.
      // Sending the rider to a trip screen for a seat they do not have yet
      // would be the app telling them they are in a car they are not in.
      if (res.pending) {
        await refresh();
        Alert.alert(
          'Asked the driver',
          'The driver has to agree before you take this seat — you will get a notification either way. '
            + 'Nothing about the fare changes: it is set by the rider who started this pool.',
        );
        return;
      }
      router.replace(`/passenger/trip/${res.tripId}` as Parameters<typeof router.replace>[0]);
    } catch (e) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setJoining(false);
    }
  }

  async function withdraw() {
    if (!info?.tripId) return;
    setJoining(true);
    try {
      await api.cancelPoolTripJoinRequest({ tripId: info.tripId });
      await refresh();
    } catch (e) {
      Alert.alert('Could not withdraw', e instanceof FirebaseError ? e.message : 'Please try again.');
    } finally {
      setJoining(false);
    }
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/passenger/home'));

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backTxt}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Shared ride invite</Text>
        <View style={{ width: 40 }} />
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>😕</Text>
          <Text style={styles.errorTitle}>Invite not available</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <Pressable style={styles.secondaryBtn} onPress={goBack}>
            <Text style={styles.secondaryBtnTxt}>Go back</Text>
          </Pressable>
        </View>
      ) : !info ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.errorSub}>Opening invite…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={{ fontSize: 28 }}>🔀</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.hostLine}>{info.hostName} invited you to pool a ride</Text>
                <View style={styles.badgeRow}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>
                      {info.visibility === 'private' ? '🔒 Private ride' : '🌍 Public ride'}
                    </Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeTxt}>{RIDE_TYPE_LABELS[info.rideType as RideType] ?? info.rideType}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.routeBox}>
              <View style={styles.routeRow}>
                <Text style={styles.routeIcon}>📍</Text>
                <Text style={styles.routeTxt} numberOfLines={2}>{info.pickupAddress}</Text>
              </View>
              <View style={styles.routeDivider} />
              <View style={styles.routeRow}>
                <Text style={styles.routeIcon}>🏁</Text>
                <Text style={styles.routeTxt} numberOfLines={2}>{info.dropoffAddress}</Text>
              </View>
            </View>

            <View style={styles.seatsRow}>
              <Text style={styles.seatsTxt}>
                {'👤'.repeat(info.riders)}{'○'.repeat(info.seatsLeft)}
              </Text>
              <Text style={styles.seatsLabel}>
                {info.riders}/{info.maxRiders} riders · {info.seatsLeft} seat{info.seatsLeft === 1 ? '' : 's'} left
              </Text>
              {/* Gender make-up of the car, counts only. The decision a rider
                  makes on this screen is "am I comfortable in this car", so it
                  belongs next to the seat count, not buried below the fare. */}
              <Text style={styles.seatsGender}>
                {poolGenderSummary(info.males, info.females)}
              </Text>
            </View>

            {/* A pool still gathering riders has no driver to name yet, so it
                says what it IS instead — riders collecting, and how long is
                left to get in. A rider deciding between this and booking their
                own ride is choosing between a cheaper seat and a certain one,
                and they can only make that call if we say which is which. */}
            {info.gathering ? (
              <View style={styles.driverBox}>
                <Text style={styles.driverLabel}>GATHERING RIDERS</Text>
                <Text style={styles.driverName}>
                  {windowLeft ? `${windowLeft} left to join` : 'Looking for a driver'}
                </Text>
                <Text style={styles.driverVehicle}>
                  No driver yet — you get in straight away, and the whole pool goes to drivers
                  together. More riders means a better fare for everyone in it.
                </Text>
              </View>
            ) : null}

            {/* Who is driving, once somebody has agreed to carry this ride.
                Naming the car is what turns "join a pool" from an abstraction
                into a decision somebody can actually make. */}
            {info.driverName ? (
              <View style={styles.driverBox}>
                <Text style={styles.driverLabel}>YOUR DRIVER</Text>
                <Text style={styles.driverName}>
                  {info.driverName}
                  {info.driverRating ? `  ★ ${info.driverRating.toFixed(1)}` : ''}
                </Text>
                {info.driverVehicle || info.driverPlate ? (
                  <Text style={styles.driverVehicle}>
                    {[info.driverVehicle, info.driverPlate].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {/* And who you would be sharing it with, by first name. This is the
                question riders actually weigh before tapping Join, and a bare
                head-count never answered it. */}
            {info.companions && info.companions.length > 0 ? (
              <View style={styles.companionBox}>
                <Text style={styles.driverLabel}>ALREADY IN THE CAR</Text>
                {info.companions.map((c, i) => (
                  <Text key={`${c.firstName}-${i}`} style={styles.companionRow}>
                    {c.gender === 'female' ? '♀' : c.gender === 'male' ? '♂' : '•'} {c.firstName}
                    {c.kind === 'host' ? '  · started this ride' : ''}
                  </Text>
                ))}
              </View>
            ) : null}

            {info.joinable && (
              <View style={styles.fareBox}>
                <Text style={styles.fareLabel}>YOU'D PAY</Text>
                <Text style={styles.fareValue}>PKR {info.perSeatFareIfYouJoin}</Text>
                <Text style={styles.fareSub}>
                  Riders currently pay PKR {info.perSeatFareNow} each — everyone's fare drops when you join
                </Text>
                <Text style={styles.fareSub}>
                  This price is set by the rider who started the pool. Joining takes it as it
                  stands — there is nothing to haggle over on the way in.
                </Text>
              </View>
            )}
          </View>

          {info.alreadyJoined ? (
            <>
              <Text style={styles.stateNote}>✅ You're already on this shared ride.</Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => info.tripId && router.replace(`/passenger/trip/${info.tripId}` as Parameters<typeof router.replace>[0])}
              >
                <Text style={styles.primaryBtnTxt}>View ride</Text>
              </Pressable>
            </>
          ) : info.requestStatus === 'pending' ? (
            <>
              {/* The tap has happened and the answer is somebody else's to
                  give. Saying so — and offering the way out — is the whole
                  difference between waiting and being stuck. */}
              <Text style={styles.stateNote}>⏳ Waiting for the driver to accept you.</Text>
              <Text style={styles.finePrint}>
                The driver decides who else rides in their car. You'll get a notification the
                moment they answer — you don't have to keep this screen open.
              </Text>
              <Pressable style={styles.secondaryBtn} onPress={() => void refresh()}>
                <Text style={styles.secondaryBtnTxt}>{refreshing ? 'Checking…' : 'Check again'}</Text>
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => void withdraw()} disabled={joining}>
                <Text style={styles.secondaryBtnTxt}>Withdraw my request</Text>
              </Pressable>
            </>
          ) : info.requestStatus === 'rejected' ? (
            <>
              <Text style={styles.stateNote}>The driver could not take you on this ride.</Text>
              <Text style={styles.finePrint}>
                Nothing to do with you — a driver may already have a fuller car, or a route that
                no longer suits. Book your own shared ride and let others join you instead.
              </Text>
              <Pressable style={styles.primaryBtn} onPress={() => router.replace('/passenger/booking')}>
                <Text style={styles.primaryBtnTxt}>Book my own shared ride</Text>
              </Pressable>
            </>
          ) : info.joinable ? (
            <>
              <Pressable
                style={[styles.primaryBtn, joining && { opacity: 0.6 }]}
                onPress={join}
                disabled={joining}
              >
                <Text style={styles.primaryBtnTxt}>
                  {joining
                    ? (info.needsDriverApproval ? 'Asking the driver…' : 'Joining…')
                    : info.needsDriverApproval
                      ? `Ask the driver for a seat · PKR ${info.perSeatFareIfYouJoin}`
                      : `Join pool · PKR ${info.perSeatFareIfYouJoin}`}
                </Text>
              </Pressable>
              {/* Which of the two taps this is, said before it is tapped. */}
              <Text style={styles.finePrint}>
                {info.needsDriverApproval
                  ? 'A driver has already agreed to carry this ride, so they decide who else gets in. Your request goes to them.'
                  : 'No driver yet, so you get in straight away — and the pool goes looking for a car with you already in it.'}
              </Text>
            </>
          ) : info.awaitingDriver ? (
            <>
              {/* A pool whose gathering window has run out. Not a dead end for
                  the rider — just not this car. */}
              <Text style={styles.stateNote}>
                ⏳ This ride has stopped taking riders while it waits for a driver.
              </Text>
              <Text style={styles.finePrint}>
                It gathered riders for ten minutes and is now looking for a car. Book your own
                shared ride — riders going your way can join you the same way.
              </Text>
              <Pressable style={styles.secondaryBtn} onPress={() => void refresh()}>
                <Text style={styles.secondaryBtnTxt}>{refreshing ? 'Checking…' : 'Check again'}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.stateNote}>
              {info.seatsLeft === 0
                ? '😔 This shared ride is already full.'
                : 'This shared ride has already departed or ended.'}
            </Text>
          )}

          <Text style={styles.finePrint}>
            Pay the driver in cash at drop-off. Your fare may drop further if more riders join before departure.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:   { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.glassChip,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTxt:     { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: colors.text },

  driverBox: {
    backgroundColor: colors.glassLime,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: 12,
    gap: 2,
  },
  driverLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: colors.muted },
  driverName: { fontSize: 15, fontWeight: '900', color: colors.text },
  driverVehicle: { fontSize: 12, fontWeight: '700', color: colors.muted },
  companionBox: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 3,
  },
  companionRow: { fontSize: 13, fontWeight: '700', color: colors.text },

  body: { padding: 16, gap: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.glassStrong,
    padding: 16,
    gap: 14,
  },
  cardTopRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  hostLine:   { fontSize: 15, fontWeight: '800', color: colors.text, lineHeight: 20 },
  badgeRow:   { flexDirection: 'row', gap: 6, marginTop: 6 },
  badge: {
    backgroundColor: colors.glassChip,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: colors.muted },

  routeBox: {
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    padding: 12,
    gap: 8,
  },
  routeRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeIcon:    { fontSize: 14 },
  routeTxt:     { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text, lineHeight: 18 },
  routeDivider: { height: 1, backgroundColor: colors.glassStrong, marginLeft: 22 },

  seatsRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seatsTxt:   { fontSize: 16, letterSpacing: 2 },
  seatsLabel: { fontSize: 12, fontWeight: '700', color: colors.muted },
  seatsGender: { fontSize: 12, fontWeight: '800', color: colors.primary, marginTop: 4 },

  fareBox: {
    backgroundColor: colors.glassLime,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 14,
    alignItems: 'center',
    gap: 3,
  },
  fareLabel: { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 1 },
  fareValue: { fontSize: 28, fontWeight: '900', color: colors.primary },
  fareSub:   { fontSize: 11, color: colors.muted, textAlign: 'center', lineHeight: 15 },

  primaryBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { fontSize: 16, fontWeight: '900', color: '#000' },
  secondaryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassStrong,
    backgroundColor: colors.glassChip,
  },
  secondaryBtnTxt: { fontSize: 14, fontWeight: '800', color: colors.text },

  stateNote:  { fontSize: 14, fontWeight: '700', color: colors.text, textAlign: 'center' },
  errorTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
  errorSub:   { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  finePrint:  { fontSize: 11, color: '#6b7280', textAlign: 'center', lineHeight: 16 },
}));
