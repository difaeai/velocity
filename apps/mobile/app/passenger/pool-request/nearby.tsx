import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Text, TextInput } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

import { api } from '../../../src/api/client';
import type { NearbyActiveRide } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { useCurrentLocation } from '../../../src/hooks/location';
import { usePlacesAutocomplete, fetchPlaceDetail, type PlacePrediction } from '../../../src/hooks/places';
import { db } from '../../../src/firebase';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';
import { isRideVisibleToUser } from '../../../src/lib/genderAccess';

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GENDER_LABEL: Record<string, string> = {
  male_only:   '♂ Males only',
  female_only: '♀ Females only',
  any:         '👥 Open to all',
};

/**
 * Joiners choose the pool's exact destination ("same area") or their own
 * drop-off within 2 km of it. Mirrors POOL_JOIN_RADIUS_M on the backend; a
 * wider leader-set radius still counts when the pool carries one.
 */
const JOIN_RADIUS_M = 2000;

const joinRadiusM = (ride: NearbyActiveRide | null) =>
  Math.max(ride?.dropRadiusM ?? 1000, JOIN_RADIUS_M);

function RideCard({ ride, onJoin }: { ride: NearbyActiveRide; onJoin: () => void }) {
  const slotsLeft = ride.slotsAvailable;
  const isFull = slotsLeft === 0;

  return (
    <View style={[styles.card, isFull && styles.cardFull]}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, ride.type === 'request' ? styles.typeBadgeReq : styles.typeBadgeRide]}>
          <Text style={styles.typeBadgeText}>{ride.type === 'request' ? 'Passenger ride' : 'Driver ride'}</Text>
        </View>
        {/* Pools gather riders before a driver takes them — say which phase this one is in. */}
        {ride.type === 'request' && (
          <View style={[styles.typeBadge, ride.hasDriver ? styles.typeBadgeReq : styles.typeBadgeRide]}>
            <Text style={[styles.typeBadgeText, ride.hasDriver && { color: '#22c55e' }]}>
              {ride.hasDriver ? '🚗 Driver assigned' : '🔍 Finding driver'}
            </Text>
          </View>
        )}
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
  const { coords, status: locStatus, request: requestLocation } = useCurrentLocation();

  const [rides, setRides]             = useState<NearbyActiveRide[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [joining, setJoining]         = useState<string | null>(null);
  const [userGender, setUserGender]   = useState('unspecified');
  const [mixedRideOk, setMixedRideOk] = useState(false);
  const [mixedRideSaving, setMixedRideSaving] = useState(false);

  // Drop-off picker for joining a pool request. Every joiner is dropped within
  // the pool's drop zone (dropRadiusM around the leader's destination).
  const [joinTarget, setJoinTarget]   = useState<NearbyActiveRide | null>(null);
  const [dropQuery, setDropQuery]     = useState('');
  const [dropChoice, setDropChoice]   = useState<{ lat: number; lng: number; label: string } | null>(null);
  const sessionTokenRef = useRef(
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }),
  );
  const { predictions: dropPredictions } = usePlacesAutocomplete(
    joinTarget ? dropQuery : '',
    sessionTokenRef.current,
  );

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
    // Rides are matched around the user's real position — querying at (0,0)
    // would just return nothing (or garbage), so wait for a GPS fix.
    if (!coords) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await api.getNearbyActiveRides({ lat: coords.lat, lng: coords.lng, radiusKm: 5 });
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

  function joinRide(ride: NearbyActiveRide) {
    if (ride.type === 'ride') {
      router.push(`/passenger/pool-ride` as Parameters<typeof router.push>[0]);
      return;
    }
    // Ask where they want to be dropped before joining — must be inside the
    // pool's drop zone (or simply the same destination).
    setDropQuery('');
    setDropChoice(null);
    setJoinTarget(ride);
  }

  async function selectDropPrediction(pred: PlacePrediction) {
    if (!joinTarget) return;
    const detail = await fetchPlaceDetail(pred.placeId, sessionTokenRef.current);
    if (!detail) {
      Alert.alert('Could not load place', 'Please try another suggestion.');
      return;
    }
    const radiusM = joinRadiusM(joinTarget);
    if (typeof joinTarget.destinationLat === 'number' && typeof joinTarget.destinationLng === 'number') {
      const distM = haversineM(joinTarget.destinationLat, joinTarget.destinationLng, detail.lat, detail.lng);
      if (distM > radiusM) {
        Alert.alert(
          'Outside the drop area',
          `That spot is ${(distM / 1000).toFixed(1)} km from the pool destination. Your drop-off must be ` +
          `within ${(radiusM / 1000).toFixed(1)} km of "${joinTarget.destinationAreaName}" — pick a closer point, ` +
          'choose the same area, or ask the driver to drop you inside it.',
        );
        return;
      }
    }
    setDropChoice({ lat: detail.lat, lng: detail.lng, label: pred.fullText || detail.address });
    setDropQuery(pred.fullText || detail.address);
  }

  async function confirmJoin(sameDestination: boolean) {
    const ride = joinTarget;
    if (!ride) return;
    if (!sameDestination && !dropChoice) {
      Alert.alert('Pick a drop-off', 'Choose the same area, or search a spot within 2 km of the pool destination.');
      return;
    }
    setJoinTarget(null);
    setJoining(ride.id);
    try {
      const res = await api.joinPoolRideRequest({
        requestId: ride.id,
        ...(!sameDestination && dropChoice
          ? { dropoffLat: dropChoice.lat, dropoffLng: dropChoice.lng, dropoffAreaName: dropChoice.label }
          : {}),
      });
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
            !coords ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📍</Text>
                <Text style={styles.emptyTitle}>Location needed</Text>
                <Text style={styles.emptyText}>
                  {locStatus === 'denied'
                    ? 'Location permission was denied. Enable it to see pool rides near you.'
                    : 'Getting your location to find pool rides near you…'}
                </Text>
                <Pressable style={styles.createBtn} onPress={requestLocation}>
                  <Text style={styles.createBtnText}>Enable location</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>🚗</Text>
                <Text style={styles.emptyTitle}>No rides nearby</Text>
                <Text style={styles.emptyText}>No pool rides match your gender preferences in your area right now. Try enabling mixed-gender rides or create your own request.</Text>
                <Pressable style={styles.createBtn} onPress={() => router.push('/passenger/pool-request/create' as Parameters<typeof router.push>[0])}>
                  <Text style={styles.createBtnText}>Create a Ride Request</Text>
                </Pressable>
              </View>
            )
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

      {/* Drop-off picker — every joiner is dropped inside the pool's drop zone */}
      <Modal
        visible={!!joinTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setJoinTarget(null)}
      >
        <View style={styles.dropOverlay}>
          <View style={styles.dropBox}>
            <Text style={styles.dropTitle}>Where should we drop you?</Text>
            <Text style={styles.dropSub}>
              This pool is going to
              {joinTarget ? ` "${joinTarget.destinationAreaName}"` : ' the same location'}. Ride to the
              same area, or pick your own drop-off within{' '}
              {(joinRadiusM(joinTarget) / 1000).toFixed(0)} km of it. Once you join, the fare is
              fixed — the driver only accepts or rejects the pool, there is no negotiation.
            </Text>

            <Pressable style={styles.dropSameBtn} onPress={() => confirmJoin(true)}>
              <Text style={styles.dropSameBtnText}>
                🏁 Same area — {joinTarget?.destinationAreaName ?? ''}
              </Text>
            </Pressable>

            <Text style={styles.dropOrText}>
              or pick a spot within {(joinRadiusM(joinTarget) / 1000).toFixed(0)} km
            </Text>

            <TextInput
              style={styles.dropInput}
              value={dropQuery}
              onChangeText={(t) => { setDropQuery(t); setDropChoice(null); }}
              placeholder="Search your drop-off…"
              placeholderTextColor={colors.muted}
            />
            {!dropChoice && dropPredictions.length > 0 && (
              <View style={styles.dropPredictionsBox}>
                {dropPredictions.slice(0, 4).map((pred) => (
                  <Pressable
                    key={pred.placeId}
                    style={styles.dropPredictionRow}
                    onPress={() => selectDropPrediction(pred)}
                  >
                    <Text style={styles.dropPredictionMain} numberOfLines={1}>{pred.mainText}</Text>
                    {!!pred.secondaryText && (
                      <Text style={styles.dropPredictionSub} numberOfLines={1}>{pred.secondaryText}</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
            {dropChoice && (
              <Text style={styles.dropChosenText}>✓ Drop-off inside the zone: {dropChoice.label}</Text>
            )}

            <View style={styles.dropActions}>
              <Pressable style={styles.dropCancelBtn} onPress={() => setJoinTarget(null)}>
                <Text style={styles.dropCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.dropJoinBtn, !dropChoice && { opacity: 0.5 }]}
                onPress={() => confirmJoin(false)}
                disabled={!dropChoice}
              >
                <Text style={styles.dropJoinText}>Join with my drop-off</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.background },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:        { width: 40 },
  backArrow:      { fontSize: 24, color: colors.text },
  headerTitle:    { fontSize: 17, fontWeight: '800', color: colors.text },

  anonymousBanner: { backgroundColor: colors.glassLime, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: `${colors.primary}20` },
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
  typeBadgeReq:   { backgroundColor: colors.glassLime },
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

  // Drop-off picker modal
  dropOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  dropBox:     { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12 },
  dropTitle:   { fontSize: 18, fontWeight: '900', color: colors.text },
  dropSub:     { fontSize: 12, color: colors.muted, lineHeight: 18 },
  dropSameBtn: { backgroundColor: colors.glassLime, borderRadius: 12, borderWidth: 1, borderColor: `${colors.primary}40`, paddingHorizontal: 14, paddingVertical: 12 },
  dropSameBtnText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  dropOrText:  { fontSize: 11, color: colors.muted, textAlign: 'center', fontWeight: '700' },
  dropInput:   { height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, fontSize: 14, color: colors.text, backgroundColor: colors.background },
  dropPredictionsBox: { backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  dropPredictionRow:  { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  dropPredictionMain: { fontSize: 13, fontWeight: '700', color: colors.text },
  dropPredictionSub:  { fontSize: 11, color: colors.muted },
  dropChosenText: { fontSize: 12, fontWeight: '700', color: '#22c55e' },
  dropActions:   { flexDirection: 'row', gap: 12, marginTop: 4 },
  dropCancelBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dropCancelText:{ fontSize: 13, fontWeight: '700', color: colors.muted },
  dropJoinBtn:   { flex: 2, height: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dropJoinText:  { fontSize: 13, fontWeight: '900', color: '#000' },
}));
