import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { api } from '../../src/api/client';
import type { NearbyPoolRequest } from '../../src/api/client';
import { colors } from '../../src/config';

const GENDER_LABEL: Record<string, string> = {
  male_only:   '♂ Males only',
  female_only: '♀ Females only',
  any:         '👥 Open to all',
};

function RequestCard({
  req,
  onAccept,
  onCounter,
}: {
  req: NearbyPoolRequest;
  onAccept: () => void;
  onCounter: () => void;
}) {
  const slotsAvail = req.totalSlots - req.filledSlots;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.distLabel}>{req.distanceKm} km away</Text>
        <View style={styles.genderBadge}>
          <Text style={styles.genderBadgeText}>{GENDER_LABEL[req.genderPref] ?? req.genderPref}</Text>
        </View>
      </View>

      <View style={styles.routeArea}>
        <View style={styles.routeRow}>
          <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
          <Text style={styles.routeText} numberOfLines={1}>{req.pickupAreaName}</Text>
        </View>
        <View style={styles.connector} />
        <View style={styles.routeRow}>
          <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
          <Text style={styles.routeText} numberOfLines={1}>{req.destinationAreaName}</Text>
        </View>
      </View>

      <View style={styles.fareRow}>
        <View>
          <Text style={styles.fareLabel}>Proposed per seat</Text>
          <Text style={styles.fareAmt}>{req.proposedFarePerSeat} PKR</Text>
        </View>
        <View style={styles.slotsInfo}>
          <Text style={styles.slotsNum}>{slotsAvail}</Text>
          <Text style={styles.slotsLabel}>seat{slotsAvail > 1 ? 's' : ''}{'\n'}needed</Text>
        </View>
      </View>

      <View style={styles.totalNote}>
        <Text style={styles.totalNoteText}>
          Total: {req.proposedFarePerSeat * req.totalSlots} PKR for {req.totalSlots} seats
        </Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.acceptBtn} onPress={onAccept}>
          <Text style={styles.acceptBtnText}>Accept Fare</Text>
        </Pressable>
        <Pressable style={styles.counterBtn} onPress={onCounter}>
          <Text style={styles.counterBtnText}>Counter Offer</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function PoolRequestsScreen() {
  const router = useRouter();
  const [requests, setRequests]     = useState<NearbyPoolRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing]         = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getNearbyPoolRequests({ lat: 0, lng: 0, radiusKm: 5 });
      setRequests(res.requests);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function accept(req: NearbyPoolRequest) {
    setActing(req.requestId);
    try {
      await api.driverRespondToRequest({ requestId: req.requestId, action: 'accept' });
      Alert.alert(
        'Ride Accepted!',
        `You agreed to ${req.proposedFarePerSeat} PKR/seat. The passenger will be notified. Pick up from ${req.pickupAreaName}.`,
        [{ text: 'OK', onPress: load }],
      );
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not accept. It may have been taken by another driver.');
      load();
    } finally {
      setActing(null);
    }
  }

  function promptCounter(req: NearbyPoolRequest) {
    let counterFare = String(req.proposedFarePerSeat + 50);
    Alert.prompt(
      'Counter Offer',
      `Passenger proposed ${req.proposedFarePerSeat} PKR/seat. Enter your counter fare per seat:`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Counter',
          onPress: async (value?: string) => {
            const fareNum = parseInt(value ?? '', 10);
            if (!fareNum || fareNum <= req.proposedFarePerSeat) {
              Alert.alert('Invalid', 'Counter fare must be higher than the proposed fare.');
              return;
            }
            setActing(req.requestId);
            try {
              await api.driverRespondToRequest({
                requestId:          req.requestId,
                action:             'counter',
                counterFarePerSeat: fareNum,
              });
              Alert.alert('Counter Sent!', `The passenger will see your offer of ${fareNum} PKR/seat.`, [
                { text: 'OK', onPress: load },
              ]);
            } catch (e: any) {
              Alert.alert('Failed', e?.message ?? 'Could not send counter.');
            } finally {
              setActing(null);
            }
          },
        },
      ],
      'plain-text',
      counterFare,
      'number-pad',
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/driver/home')} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Passenger Ride Requests</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.infoBanner}>
        <Text style={styles.infoText}>
          Passengers are looking for shared rides. Accept their fare or send a counter offer.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(r) => r.requestId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>No requests nearby</Text>
              <Text style={styles.emptyText}>No passengers are requesting rides in your area right now. Pull to refresh.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <RequestCard
              req={item}
              onAccept={() => accept(item)}
              onCounter={() => promptCounter(item)}
            />
          )}
        />
      )}

      {acting && (
        <View style={styles.actingOverlay}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.actingText}>Responding...</Text>
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

  infoBanner:     { backgroundColor: colors.surface, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoText:       { fontSize: 12, color: colors.muted, lineHeight: 18 },

  list:           { padding: 16, gap: 12 },
  empty:          { paddingTop: 60, alignItems: 'center', gap: 12, paddingHorizontal: 32 },
  emptyIcon:      { fontSize: 48 },
  emptyTitle:     { fontSize: 18, fontWeight: '800', color: colors.text },
  emptyText:      { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  card:           { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  distLabel:      { fontSize: 12, color: colors.muted, fontWeight: '700' },
  genderBadge:    { backgroundColor: '#0d1a06', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  genderBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary },

  routeArea:      { padding: 14, gap: 4 },
  routeRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot:            { width: 8, height: 8, borderRadius: 4 },
  routeText:      { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  connector:      { height: 8, width: 1, backgroundColor: colors.border, marginLeft: 3 },

  fareRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8 },
  fareLabel:      { fontSize: 11, color: colors.muted, fontWeight: '600' },
  fareAmt:        { fontSize: 22, fontWeight: '900', color: colors.text },
  slotsInfo:      { alignItems: 'center', backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  slotsNum:       { fontSize: 24, fontWeight: '900', color: colors.primary },
  slotsLabel:     { fontSize: 10, color: colors.muted, textAlign: 'center', lineHeight: 14 },

  totalNote:      { paddingHorizontal: 14, paddingBottom: 12 },
  totalNoteText:  { fontSize: 12, color: colors.muted, fontWeight: '600' },

  actionRow:      { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  acceptBtn:      { flex: 1, height: 44, backgroundColor: colors.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText:  { color: '#000', fontWeight: '900', fontSize: 14 },
  counterBtn:     { flex: 1, height: 44, backgroundColor: '#0d1a3a', borderRadius: 12, borderWidth: 1, borderColor: '#3b82f640', alignItems: 'center', justifyContent: 'center' },
  counterBtnText: { color: '#60a5fa', fontWeight: '800', fontSize: 14 },

  actingOverlay:  { position: 'absolute', bottom: 32, left: 32, right: 32, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 10 },
  actingText:     { fontSize: 14, color: colors.text, fontWeight: '700' },
});
