import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

import { api } from '../../../src/api/client';
import type { NearbyActiveRide } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { useCurrentLocation } from '../../../src/hooks/location';
import { db } from '../../../src/firebase';
import { colors } from '../../../src/config';
import { isRideVisibleToUser } from '../../../src/lib/genderAccess';

const GENDER_LABEL: Record<string, string> = {
  male_only:   '♂ Males only',
  female_only: '♀ Females only',
  any:         '👥 Open to all',
};

function RideCard({ ride, onJoin }: { ride: NearbyActiveRide; onJoin: () => void }) {
  const slotsLeft = ride.slotsAvailable;
  const isFull = slotsLeft === 0;

  return (
    <View style={[styles.card, isFull && styles.cardFull]}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, ride.type === 'request' ? styles.typeBadgeReq : styles.typeBadgeRide]}>
          <Text style={styles.typeBadgeText}>{ride.type === 'request' ? 'Passenger ride' : 'Driver ride'}</Text>
        </View>
        <Text style={styles.distLabel}>{ride.distanceKm} km away</Text>
      </View>

      <View style={styles.routeArea}>
        <View style={styles.routeRow}>
          <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.routeText} numberOfLines={1}>{ride.pickupAreaName}</Text>
        </View>
        <View style={styles.routeConnector} />
        <View style={styles.routeRow}>
          <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
          <Text style={styles.routeText} numberOfLines={1}>{ride.destinationAreaName}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>{ride.farePerSeat} PKR/seat</Text>
        </View>
        <View style={styles.metaChip}>
          <Text style={[styles.metaChipText, { color: isFull ? colors.muted : '#22c55e' }]}>
            {isFull ? 'Full' : `${slotsLeft} seat${slotsLeft > 1 ? 's' : ''} left`}
          </Text>
        </View>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>{GENDER_LABEL[ride.genderPref] ?? ride.genderPref}</Text>
        </View>
        {ride.rideCategory && (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>{ride.rideCategory}</Text>
          </View>
        )}
      </View>

      {!isFull && ride.type === 'request' && (
        <Pressable style={styles.joinBtn} onPress={onJoin}>
          <Text style={styles.joinBtnText}>Join this ride →</Text>
        </Pressable>
      )}
      {isFull && (
        <Text style={styles.fullNote}>No seats available</Text>
      )}
      {ride.type === 'ride' && !isFull && (
        <Pressable style={styles.joinBtn} onPress={onJoin}>
          <Text style={styles.joinBtnText}>View & Join →</Text>
        </Pressable>
      )}
    </View>
  );
}

export default function NearbyRidesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { coords } = useCurrentLocation();

  const [rides, setRides]             = useState<NearbyActiveRide[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [joining, setJoining]         = useState<string | null>(null);
  const [userGender, setUserGender]   = useState('unspecified');
  const [mixedRideOk, setMixedRideOk] = useState(false);
  const [mixedRideSaving, setMixedRideSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        const data = snap.data();
        if (data?.gender) setUserGender(data.gender as string);
        if (typeof data?.mixedRideOk === 'boolean') setMixedRideOk(data.mixedRideOk);
      })
      .catch(() => {});
  }, [user]);

  async function persistMixedRideOk(value: boolean) {
    if (!user) return;
    setMixedRideSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { mixedRideOk: value });
      setMixedRideOk(value);
    } catch {
      Alert.alert('Could not save preference', 'Please try again.');
    } finally {
      setMixedRideSaving(false);
    }
  }

  function promptMixedRideOk(value: boolean) {
    if (!value) {
      persistMixedRideOk(false);
      return;
    }
    Alert.alert(
      'Mixed-gender pool rides',
      'Enable this to see and join pools that may include opposite-gender passengers, following Pakistani cultural seating rules.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Enable', onPress: () => persistMixedRideOk(true) },
      ],
    );
  }

  const load = useCallback(async () => {
    try {
      const lat = coords?.lat ?? 0;
      const lng = coords?.lng ?? 0;
      const res = await api.getNearbyActiveRides({ lat, lng, radiusKm: 5 });
      setRides(res.rides);
    } catch {
      // silently fail, user sees empty list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coords?.lat, coords?.lng]);

  useEffect(() => { load(); }, [load]);

  const visibleRides = useMemo(
    () =>
      rides.filter((r) =>
        isRideVisibleToUser(
          {
            genderComposition: r.genderComposition,
            maleSeats: r.maleSeats,
            femaleSeats: r.femaleSeats,
            maxSeats: r.totalSlots,
            genderPref: r.genderPref,
          },
          userGender,
          mixedRideOk,
        ),
      ),
    [rides, userGender, mixedRideOk],
  );

  async function joinRide(ride: NearbyActiveRide) {
    if (ride.type === 'ride') {
      router.push(`/passenger/pool-ride` as Parameters<typeof router.push>[0]);
      return;
    }
    setJoining(ride.id);
    try {
      const res = await api.joinPoolRideRequest({ requestId: ride.id });
      Alert.alert(
        'Joined!',
        `You have joined this pool ride at ${res.farePerSeat} PKR/seat. Open "My Requests" to track your ride.`,
        [
          {
            text: 'View Request',
            onPress: () => router.push(`/passenger/pool-request/${ride.id}` as Parameters<typeof router.push>[0]),
          },
          { text: 'OK' },
        ],
      );
      load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unable to join this ride.';
      Alert.alert('Cannot join', msg);
    } finally {
      setJoining(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Nearby Sharing Rides</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.anonymousBanner}>
        <Text style={styles.anonText}>Rides are shown anonymously. Gender-composition rules apply to what you can see and join.</Text>
      </View>

      <View style={styles.mixedRideRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mixedRideLabel}>Open to mixed-gender rides</Text>
          <Text style={styles.mixedRideSub}>Required for opposite-gender pool sharing</Text>
        </View>
        <Switch
          value={mixedRideOk}
          onValueChange={promptMixedRideOk}
          disabled={mixedRideSaving}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      ) : (
        <FlatList
          data={visibleRides}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🚗</Text>
              <Text style={styles.emptyTitle}>No rides nearby</Text>
              <Text style={styles.emptyText}>No pool rides match your gender preferences in your area right now. Try enabling mixed-gender rides or create your own request.</Text>
              <Pressable style={styles.createBtn} onPress={() => router.push('/passenger/pool-request/create' as Parameters<typeof router.push>[0])}>
                <Text style={styles.createBtnText}>Create a Ride Request</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <RideCard
              ride={item}
              onJoin={() => joinRide(item)}
            />
          )}
        />
      )}

      {joining && (
        <View style={styles.joiningOverlay}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.joiningText}>Joining ride...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.background },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:        { width: 40 },
  backArrow:      { fontSize: 24, color: colors.text },
  headerTitle:    { fontSize: 17, fontWeight: '800', color: colors.text },

  anonymousBanner: { backgroundColor: '#0d1a06', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: `${colors.primary}20` },
  anonText:       { fontSize: 12, color: colors.primary, fontWeight: '600', textAlign: 'center' },

  mixedRideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  mixedRideLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  mixedRideSub:   { fontSize: 11, color: colors.muted, marginTop: 2 },

  list:           { padding: 16, gap: 12 },
  empty:          { flex: 1, alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
  emptyIcon:      { fontSize: 48 },
  emptyTitle:     { fontSize: 18, fontWeight: '800', color: colors.text },
  emptyText:      { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  createBtn:      { marginTop: 8, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  createBtnText:  { color: '#000', fontWeight: '900', fontSize: 14 },

  card:           { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardFull:       { opacity: 0.6 },
  cardHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  typeBadge:      { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeReq:   { backgroundColor: '#1c2c0a' },
  typeBadgeRide:  { backgroundColor: '#0d1a3a' },
  typeBadgeText:  { fontSize: 10, fontWeight: '800', color: colors.muted },
  distLabel:      { fontSize: 11, color: colors.muted, fontWeight: '700' },

  routeArea:      { padding: 14, gap: 4 },
  routeRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot:            { width: 8, height: 8, borderRadius: 4 },
  routeText:      { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  routeConnector: { height: 8, width: 1, backgroundColor: colors.border, marginLeft: 3 },

  metaRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  metaChip:       { backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 4 },
  metaChipText:   { fontSize: 11, color: colors.text, fontWeight: '700' },

  joinBtn:        { margin: 12, marginTop: 0, height: 44, backgroundColor: colors.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  joinBtnText:    { color: '#000', fontWeight: '900', fontSize: 14 },
  fullNote:       { textAlign: 'center', color: colors.muted, fontSize: 12, paddingBottom: 12 },

  joiningOverlay: { position: 'absolute', bottom: 32, left: 32, right: 32, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 10 },
  joiningText:    { fontSize: 14, color: colors.text, fontWeight: '700' },
});
