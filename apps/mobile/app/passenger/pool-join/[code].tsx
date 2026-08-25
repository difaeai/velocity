/**
 * Pool invite landing screen — /passenger/pool-join/{code}
 *
 * Opened from a pool share link (or by tapping a nearby public pool on the
 * booking screen). Resolves the invite code, shows the ride and the per-seat
 * fare after joining, and books the caller onto the pool.
 */
import { useEffect, useState } from 'react';
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

  async function join() {
    setJoining(true);
    try {
      const res = await api.joinPoolTrip({ code });
      router.replace(`/passenger/trip/${res.tripId}` as Parameters<typeof router.replace>[0]);
    } catch (e) {
      Alert.alert('Could not join', e instanceof FirebaseError ? e.message : 'Please try again.');
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

            {info.joinable && (
              <View style={styles.fareBox}>
                <Text style={styles.fareLabel}>YOU'D PAY</Text>
                <Text style={styles.fareValue}>PKR {info.perSeatFareIfYouJoin}</Text>
                <Text style={styles.fareSub}>
                  Riders currently pay PKR {info.perSeatFareNow} each — everyone's fare drops when you join
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
          ) : info.joinable ? (
            <Pressable
              style={[styles.primaryBtn, joining && { opacity: 0.6 }]}
              onPress={join}
              disabled={joining}
            >
              <Text style={styles.primaryBtnTxt}>
                {joining ? 'Joining…' : `Join pool · PKR ${info.perSeatFareIfYouJoin}`}
              </Text>
            </Pressable>
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
