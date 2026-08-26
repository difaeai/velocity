import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../../src/api/client';
import type { NearbyPoolRequest } from '../../src/api/client';
import { useCurrentLocation } from '../../src/hooks/location';
import { colors } from '../../src/config';
import { themed } from '../../src/theme';

const GENDER_LABEL: Record<string, string> = {
  male_only:   '♂ Males only',
  female_only: '♀ Females only',
  any:         '👥 Open to all',
};

// Shared with the home-screen Sharing feed, so a pool rejected in one place
// stays hidden in the other.
const REJECT_KEY = 'driver_rejected_pools';
const REJECT_TTL = 60 * 60 * 1000;

function RequestCard({
  req,
  onAccept,
  onReject,
}: {
  req: NearbyPoolRequest;
  onAccept: () => void;
  onReject: () => void;
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

      {/* The whole pool: each rider's first name and what they pay. */}
      <View style={styles.memberList}>
        {(req.members ?? []).map((m, i) => (
          <View key={`${m.name}-${i}`} style={styles.memberRow}>
            <Text style={styles.memberName} numberOfLines={1}>
              {m.name}{i === 0 ? ' · leader' : ''}
            </Text>
            <Text style={styles.memberFare}>{m.farePerSeat} PKR</Text>
            {m.dropoffAreaName !== req.destinationAreaName ? (
              <Text style={styles.memberDrop} numberOfLines={1}>↳ {m.dropoffAreaName}</Text>
            ) : null}
          </View>
        ))}
        {slotsAvail > 0 && (
          <Text style={styles.openSeatsNote}>
            + {slotsAvail} open seat{slotsAvail > 1 ? 's' : ''} · {req.totalFareIfFull} PKR if full
          </Text>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total now · {req.filledSlots}/{req.totalSlots} seats</Text>
          <Text style={styles.totalAmt}>{req.totalFare} PKR</Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={styles.acceptBtn} onPress={onAccept}>
          <Text style={styles.acceptBtnText}>Accept · {req.farePerSeat} PKR/seat</Text>
        </Pressable>
        <Pressable style={styles.rejectBtn} onPress={onReject}>
          <Text style={styles.rejectBtnText}>Reject</Text>
        </Pressable>
      </View>
      <Text style={styles.fixedFareNote}>Pool fares are fixed — no counter offers.</Text>
    </View>
  );
}

export default function PoolRequestsScreen() {
  const router = useRouter();
  const { coords, status: locStatus, request: requestLocation } = useCurrentLocation();
  const [requests, setRequests]     = useState<NearbyPoolRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing]         = useState<string | null>(null);

  // Pools this driver rejected — hidden for an hour, shared with the home feed.
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    AsyncStorage.getItem(REJECT_KEY).then((raw) => {
      if (!raw) return;
      try {
        const entries: { id: string; at: number }[] = JSON.parse(raw);
        const now = Date.now();
        const valid = entries.filter((e) => now - e.at < REJECT_TTL);
        setRejectedIds(new Set(valid.map((e) => e.id)));
        if (valid.length !== entries.length) AsyncStorage.setItem(REJECT_KEY, JSON.stringify(valid));
      } catch { /* corrupted — start fresh */ }
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    // Requests are matched around the driver's real position — without GPS
    // the geohash query would run at (0,0) and return nothing meaningful.
    if (!coords) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res = await api.getNearbyPoolRequests({ lat: coords.lat, lng: coords.lng, radiusKm: 5 });
      setRequests(res.requests);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coords?.lat, coords?.lng]);

  useEffect(() => { load(); }, [load]);

  async function accept(req: NearbyPoolRequest) {
    setActing(req.requestId);
    try {
      await api.driverRespondToRequest({ requestId: req.requestId, action: 'accept' });
      Alert.alert(
        'Ride Accepted!',
        `${req.filledSlots} rider${req.filledSlots > 1 ? 's' : ''} at ${req.farePerSeat} PKR each. ` +
        `The passengers will be notified. Pick up from ${req.pickupAreaName}.`,
        [{ text: 'OK', onPress: load }],
      );
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not accept. It may have been taken by another driver.');
      load();
    } finally {
      setActing(null);
    }
  }

  function reject(requestId: string) {
    setRejectedIds((prev) => new Set([...prev, requestId]));
    AsyncStorage.getItem(REJECT_KEY).then((raw) => {
      const existing: { id: string; at: number }[] = raw ? JSON.parse(raw) : [];
      const updated = [...existing.filter((e) => e.id !== requestId), { id: requestId, at: Date.now() }];
      AsyncStorage.setItem(REJECT_KEY, JSON.stringify(updated));
    }).catch(() => {});
  }

  const visible = useMemo(
    () => requests.filter((r) => !rejectedIds.has(r.requestId)),
    [requests, rejectedIds],
  );

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
          Passengers sharing a ride, with every rider's name and fare. Pool fares are fixed — accept or reject.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(r) => r.requestId}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={
            !coords ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📍</Text>
                <Text style={styles.emptyTitle}>Location needed</Text>
                <Text style={styles.emptyText}>
                  {locStatus === 'denied'
                    ? 'Location permission was denied. Enable it to see passenger requests near you.'
                    : 'Getting your location to find passenger requests near you…'}
                </Text>
                <Pressable style={styles.enableLocBtn} onPress={requestLocation}>
                  <Text style={styles.enableLocText}>Enable location</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📭</Text>
                <Text style={styles.emptyTitle}>No requests nearby</Text>
                <Text style={styles.emptyText}>No passengers are requesting rides in your area right now. Pull to refresh.</Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <RequestCard
              req={item}
              onAccept={() => accept(item)}
              onReject={() => reject(item.requestId)}
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

const styles = themed(() => StyleSheet.create({
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
  genderBadge:    { backgroundColor: colors.glassLime, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  genderBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary },

  routeArea:      { padding: 14, gap: 4 },
  routeRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot:            { width: 8, height: 8, borderRadius: 4 },
  routeText:      { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  connector:      { height: 8, width: 1, backgroundColor: colors.border, marginLeft: 3 },

  memberList:     { margin: 14, marginBottom: 10, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  memberRow:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  memberName:     { fontSize: 13, fontWeight: '800', color: colors.text, flexShrink: 1 },
  memberFare:     { fontSize: 13, fontWeight: '900', color: colors.primary, marginLeft: 'auto' },
  memberDrop:     { fontSize: 11, color: colors.muted, width: '100%' },
  openSeatsNote:  { fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  totalRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  totalLabel:     { fontSize: 12, color: colors.muted, fontWeight: '700' },
  totalAmt:       { fontSize: 17, fontWeight: '900', color: colors.text },

  actionRow:      { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  acceptBtn:      { flex: 2, height: 44, backgroundColor: colors.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText:  { color: '#000', fontWeight: '900', fontSize: 14 },
  rejectBtn:      { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#ef444440', alignItems: 'center', justifyContent: 'center' },
  rejectBtnText:  { color: '#ef4444', fontWeight: '800', fontSize: 14 },
  fixedFareNote:  { fontSize: 10, color: colors.muted, textAlign: 'center', paddingBottom: 10, paddingTop: 4 },

  actingOverlay:  { position: 'absolute', bottom: 32, left: 32, right: 32, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, elevation: 10 },
  actingText:     { fontSize: 14, color: colors.text, fontWeight: '700' },

  enableLocBtn:   { marginTop: 8, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  enableLocText:  { color: '#000', fontWeight: '900', fontSize: 13 },
}));
