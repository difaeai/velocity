import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '../../../src/api/client';
import type { NearbyActiveRide } from '../../../src/api/client';
import { colors } from '../../../src/config';

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
  const [rides, setRides]       = useState<NearbyActiveRide[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining]   = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getNearbyActiveRides({ lat: 0, lng: 0, radiusKm: 5 });
      setRides(res.rides);
    } catch {
      // silently fail, user sees empty list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    } catch (e: any) {
      Alert.alert('Cannot join', e?.message ?? 'Unable to join this ride.');
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
        <Text style={styles.anonText}>Rides are shown anonymously. No passenger names or exact locations are shared.</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🚗</Text>
              <Text style={styles.emptyTitle}>No rides nearby</Text>
              <Text style={styles.emptyText}>There are no active sharing rides in your area right now. Check back soon or create your own request.</Text>
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
