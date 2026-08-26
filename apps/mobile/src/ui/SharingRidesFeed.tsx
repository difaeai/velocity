/**
 * Driver "Sharing rides" mode — the body of the driver home screen when the
 * Solo | Sharing selector is on Sharing.
 *
 * Two jobs:
 *  1. "Your shared pool" — the pool this driver has accepted, live from
 *     Firestore: every rider by first name with their fare and drop-off, the
 *     running total, and the 10-minute no-joiner window. If nobody joins the
 *     leader in 10 minutes, driver and leader are BOTH asked whether to go
 *     anyway — going needs both, either one may cancel.
 *  2. Nearby pool requests as boxes: who is in each pool (name + fare each),
 *     the total fare, pickup/destination areas, inside a radius the driver
 *     picks. Pool fares are fixed — the driver accepts or rejects, never
 *     negotiates. Gender preference is matched server-side before a request
 *     ever reaches this feed.
 */
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
import { Text } from './Text';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { db } from '../firebase';
import { api, type NearbyPoolRequest } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { DRIVER_TAB_BAR_HEIGHT } from './DriverTabBar';

/** Mirrors POOL_NO_JOINER_WINDOW_MS on the backend. */
const NO_JOINER_WINDOW_MS = 10 * 60 * 1000;

/** Rejected pools stay hidden for an hour — same policy as skipped solo requests. */
const REJECT_KEY = 'driver_rejected_pools';
const REJECT_TTL = 60 * 60 * 1000;

const RADIUS_KEY = 'driver_pool_radius_km';
const RADIUS_OPTIONS = [2, 5, 10] as const;

const GENDER_LABEL: Record<string, string> = {
  male_only:   '♂ Males only',
  female_only: '♀ Females only',
  any:         '👥 Open to all',
};

/** The driver's accepted pool, straight off the Firestore doc they may read. */
interface MyPool {
  id: string;
  status: 'active' | 'full';
  pickupAreaName: string;
  destinationAreaName: string;
  proposedFarePerSeat: number;
  agreedFarePerSeat: number | null;
  totalSlots: number;
  filledSlots: number;
  genderPref: string;
  passengers: string[];
  passengerNames?: Record<string, string>;
  passengerDropoffs?: Record<string, { areaName?: string } | undefined>;
  activatedAt?: { toDate?: () => Date } | null;
  goAnyway?: { leader: boolean | null; driver: boolean | null } | null;
  goAnywayConfirmed?: boolean;
}

/** Ticks once a second while `on`, so countdowns actually count down. */
function useNowTick(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Your shared pool ─────────────────────────────────────────────────────────

function MyPoolCard({ pool }: { pool: MyPool }) {
  const [busy, setBusy] = useState(false);

  const farePerSeat = pool.agreedFarePerSeat ?? pool.proposedFarePerSeat;
  const names = pool.passengerNames ?? {};
  const drops = pool.passengerDropoffs ?? {};
  const leaderUid = pool.passengers[0];
  const leaderName = (leaderUid ? names[leaderUid] : undefined) ?? 'Rider';

  const activatedMs = pool.activatedAt?.toDate?.()?.getTime();
  const alone = pool.status === 'active' && pool.filledSlots === 1;
  const now = useNowTick(alone && typeof activatedMs === 'number' && !pool.goAnywayConfirmed);
  const remainingMs = typeof activatedMs === 'number'
    ? activatedMs + NO_JOINER_WINDOW_MS - now
    : null;

  const driverReady = pool.goAnyway?.driver === true;
  const leaderReady = pool.goAnyway?.leader === true;

  async function respond(action: 'go' | 'cancel') {
    if (action === 'cancel') {
      const sure = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Cancel this shared ride?',
          `${leaderName} has been waiting since you accepted. Cancel because nobody else joined?`,
          [
            { text: 'Keep waiting', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Cancel ride', style: 'destructive', onPress: () => resolve(true) },
          ],
        ),
      );
      if (!sure) return;
    }
    setBusy(true);
    try {
      const res = await api.respondToPoolGoAnyway({ requestId: pool.id, action });
      if (action === 'go' && res.confirmed) {
        Alert.alert('Ride confirmed', `${leaderName} also agreed — head to ${pool.pickupAreaName}.`);
      }
    } catch (e) {
      Alert.alert('Could not respond', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.myPoolCard}>
      <View style={styles.myPoolHeader}>
        <Text style={styles.myPoolTitle}>🚕 Your shared pool</Text>
        <View style={styles.genderBadge}>
          <Text style={styles.genderBadgeText}>{GENDER_LABEL[pool.genderPref] ?? pool.genderPref}</Text>
        </View>
      </View>

      <View style={styles.routeRow}>
        <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
        <Text style={styles.routeText} numberOfLines={1}>{pool.pickupAreaName}</Text>
      </View>
      <View style={styles.connector} />
      <View style={styles.routeRow}>
        <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
        <Text style={styles.routeText} numberOfLines={1}>{pool.destinationAreaName}</Text>
      </View>

      {/* Everyone aboard: first name — fare — own drop-off when they chose one. */}
      <View style={styles.memberList}>
        {pool.passengers.map((uid, i) => {
          const drop = drops[uid]?.areaName;
          return (
            <View key={uid} style={styles.memberRow}>
              <Text style={styles.memberName} numberOfLines={1}>
                {names[uid] ?? 'Rider'}{i === 0 ? ' · leader' : ''}
              </Text>
              <Text style={styles.memberFare}>{farePerSeat} PKR</Text>
              {drop && drop !== pool.destinationAreaName ? (
                <Text style={styles.memberDrop} numberOfLines={1}>↳ {drop}</Text>
              ) : null}
            </View>
          );
        })}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            Total · {pool.filledSlots}/{pool.totalSlots} seats
          </Text>
          <Text style={styles.totalAmt}>{farePerSeat * pool.filledSlots} PKR</Text>
        </View>
      </View>

      {/* No-joiner window. Only while the leader is riding alone. */}
      {alone && !pool.goAnywayConfirmed && remainingMs !== null && remainingMs > 0 && (
        <View style={styles.waitBox}>
          <Text style={styles.waitText}>
            ⏳ Waiting for co-riders · {mmss(remainingMs)} — if nobody joins, you and{' '}
            {leaderName} both decide whether to go.
          </Text>
        </View>
      )}
      {alone && !pool.goAnywayConfirmed && remainingMs !== null && remainingMs <= 0 && (
        <View style={styles.decideBox}>
          <Text style={styles.decideTitle}>Nobody joined the pool</Text>
          <Text style={styles.decideText}>
            {leaderReady
              ? `${leaderName} is ready to go with just the two of you.`
              : `Go with just ${leaderName} at ${farePerSeat} PKR? Both of you must agree — either of you can cancel.`}
          </Text>
          {driverReady ? (
            <Text style={styles.readyText}>✓ You said go — waiting for {leaderName}…</Text>
          ) : (
            <View style={styles.decideBtns}>
              <Pressable
                style={[styles.goBtn, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={() => respond('go')}
              >
                <Text style={styles.goBtnText}>Go anyway</Text>
              </Pressable>
              <Pressable
                style={[styles.cancelBtn, busy && styles.btnDisabled]}
                disabled={busy}
                onPress={() => respond('cancel')}
              >
                <Text style={styles.cancelBtnText}>Cancel ride</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
      {alone && pool.goAnywayConfirmed && (
        <View style={styles.confirmedBox}>
          <Text style={styles.confirmedText}>
            ✅ Both agreed — pick up {leaderName} at {pool.pickupAreaName}.
          </Text>
        </View>
      )}
      {!alone && (
        <Text style={styles.pickupHint}>
          Pick up your riders at {pool.pickupAreaName}. More can join until every seat is taken.
        </Text>
      )}
    </View>
  );
}

// ── Nearby pool request boxes ────────────────────────────────────────────────

function PoolRequestBox({
  req,
  busy,
  onAccept,
  onReject,
}: {
  req: NearbyPoolRequest;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
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

      {/* The pool itself: each rider by first name with their fare. */}
      <View style={styles.memberList}>
        {req.members.map((m, i) => (
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
        {req.slotsAvailable > 0 && (
          <Text style={styles.openSeatsNote}>
            + {req.slotsAvailable} open seat{req.slotsAvailable > 1 ? 's' : ''} · {req.totalFareIfFull} PKR if full
          </Text>
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>
            Total now · {req.filledSlots}/{req.totalSlots} seats
          </Text>
          <Text style={styles.totalAmt}>{req.totalFare} PKR</Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable style={[styles.acceptBtn, busy && styles.btnDisabled]} disabled={busy} onPress={onAccept}>
          <Text style={styles.acceptBtnText}>Accept · {req.farePerSeat} PKR/seat</Text>
        </Pressable>
        <Pressable style={[styles.rejectBtn, busy && styles.btnDisabled]} disabled={busy} onPress={onReject}>
          <Text style={styles.rejectBtnText}>Reject</Text>
        </Pressable>
      </View>
      <Text style={styles.fixedFareNote}>Pool fares are fixed — no counter offers.</Text>
    </View>
  );
}

// ── The feed ─────────────────────────────────────────────────────────────────

export function SharingRidesFeed({
  uid,
  coords,
}: {
  uid: string;
  coords: { lat: number; lng: number } | null;
}) {
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [requests, setRequests] = useState<NearbyPoolRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [myPools, setMyPools] = useState<MyPool[]>([]);

  // Restore the radius the driver last set, and the pools they rejected.
  useEffect(() => {
    AsyncStorage.getItem(RADIUS_KEY).then((raw) => {
      const v = raw ? parseInt(raw, 10) : NaN;
      if (RADIUS_OPTIONS.includes(v as (typeof RADIUS_OPTIONS)[number])) setRadiusKm(v);
    }).catch(() => {});
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

  // The pool(s) this driver has accepted, live. Rules let the assigned driver
  // read the request doc, so the member list and the no-joiner state stream in.
  useEffect(() => {
    const q = query(
      collection(db, 'poolRideRequests'),
      where('driverId', '==', uid),
      where('status', 'in', ['active', 'full']),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMyPools(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MyPool)));
    }, () => { /* offline — the card just doesn't render */ });
    return unsub;
  }, [uid]);

  const load = useCallback(async (asRefresh = false) => {
    if (!coords) { setLoading(false); return; }
    if (asRefresh) setRefreshing(true);
    try {
      const res = await api.getNearbyPoolRequests({ lat: coords.lat, lng: coords.lng, radiusKm });
      setRequests(res.requests);
    } catch {
      // keep whatever is on screen
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coords?.lat, coords?.lng, radiusKm]);

  // Load on mount / radius change, then keep fresh — pools change as riders join.
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  function setRadius(km: number) {
    setRadiusKm(km);
    setLoading(true);
    AsyncStorage.setItem(RADIUS_KEY, String(km)).catch(() => {});
  }

  function reject(requestId: string) {
    setRejectedIds((prev) => new Set([...prev, requestId]));
    AsyncStorage.getItem(REJECT_KEY).then((raw) => {
      const existing: { id: string; at: number }[] = raw ? JSON.parse(raw) : [];
      const updated = [...existing.filter((e) => e.id !== requestId), { id: requestId, at: Date.now() }];
      AsyncStorage.setItem(REJECT_KEY, JSON.stringify(updated));
    }).catch(() => {});
  }

  async function accept(req: NearbyPoolRequest) {
    setActing(req.requestId);
    try {
      await api.driverRespondToRequest({ requestId: req.requestId, action: 'accept' });
      Alert.alert(
        'Pool accepted',
        `${req.filledSlots} rider${req.filledSlots > 1 ? 's' : ''} at ${req.farePerSeat} PKR each — ` +
        `pick up from ${req.pickupAreaName}. Riders can keep joining until the seats fill.`,
      );
      load();
    } catch (e) {
      Alert.alert('Could not accept', e instanceof Error ? e.message : 'It may have been taken by another driver.');
      load();
    } finally {
      setActing(null);
    }
  }

  const visible = useMemo(
    () => requests.filter((r) => !rejectedIds.has(r.requestId)),
    [requests, rejectedIds],
  );

  const header = (
    <View style={styles.headerArea}>
      {myPools.map((p) => <MyPoolCard key={p.id} pool={p} />)}
      <View style={styles.radiusRow}>
        <Text style={styles.radiusLabel}>Pools within</Text>
        {RADIUS_OPTIONS.map((km) => (
          <Pressable
            key={km}
            style={[styles.radiusChip, radiusKm === km && styles.radiusChipActive]}
            onPress={() => setRadius(km)}
          >
            <Text style={[styles.radiusChipText, radiusKm === km && styles.radiusChipTextActive]}>
              {km} km
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.flexCenter}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>Finding shared-ride pools near you…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={visible}
      keyExtractor={(r) => r.requestId}
      contentContainerStyle={styles.list}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyTitle}>No pools nearby</Text>
          <Text style={styles.emptyText}>
            {coords
              ? `No shared-ride pools within ${radiusKm} km right now. New ones appear here automatically.`
              : 'Waiting for your location to find pools near you…'}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <PoolRequestBox
          req={item}
          busy={acting === item.requestId}
          onAccept={() => accept(item)}
          onReject={() => reject(item.requestId)}
        />
      )}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  flexCenter:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:  { fontSize: 13, color: colors.muted },
  list:         { padding: 16, gap: 12, paddingBottom: DRIVER_TAB_BAR_HEIGHT + 16 },
  headerArea:   { gap: 12, marginBottom: 4 },

  empty:        { paddingTop: 48, alignItems: 'center', gap: 10, paddingHorizontal: 32 },
  emptyIcon:    { fontSize: 44 },
  emptyTitle:   { fontSize: 17, fontWeight: '800', color: colors.text },
  emptyText:    { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  radiusRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radiusLabel:    { fontSize: 12, color: colors.muted, fontWeight: '700' },
  radiusChip:     { borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  radiusChipActive:     { backgroundColor: colors.primary, borderColor: colors.primary },
  radiusChipText:       { fontSize: 12, fontWeight: '800', color: colors.muted },
  radiusChipTextActive: { color: '#000' },

  card:         { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  distLabel:    { fontSize: 12, color: colors.muted, fontWeight: '700' },
  genderBadge:  { backgroundColor: colors.glassLime, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  genderBadgeText: { fontSize: 10, fontWeight: '800', color: colors.primary },

  routeArea:    { paddingHorizontal: 14, paddingTop: 12, gap: 4 },
  routeRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  routeText:    { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  connector:    { height: 8, width: 1, backgroundColor: colors.border, marginLeft: 3 },

  memberList:   { margin: 14, marginBottom: 10, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 },
  memberRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  memberName:   { fontSize: 13, fontWeight: '800', color: colors.text, flexShrink: 1 },
  memberFare:   { fontSize: 13, fontWeight: '900', color: colors.primary, marginLeft: 'auto' },
  memberDrop:   { fontSize: 11, color: colors.muted, width: '100%' },
  openSeatsNote:{ fontSize: 11, color: colors.muted, fontStyle: 'italic' },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  totalLabel:   { fontSize: 12, color: colors.muted, fontWeight: '700' },
  totalAmt:     { fontSize: 17, fontWeight: '900', color: colors.text },

  actionRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  acceptBtn:    { flex: 2, height: 44, backgroundColor: colors.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText:{ color: '#000', fontWeight: '900', fontSize: 14 },
  rejectBtn:    { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#ef444440', backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  rejectBtnText:{ color: '#ef4444', fontWeight: '800', fontSize: 14 },
  btnDisabled:  { opacity: 0.5 },
  fixedFareNote:{ fontSize: 10, color: colors.muted, textAlign: 'center', paddingBottom: 10 },

  // Your shared pool
  myPoolCard:   { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: `${colors.primary}50`, padding: 14, gap: 6 },
  myPoolHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  myPoolTitle:  { fontSize: 15, fontWeight: '900', color: colors.text },
  pickupHint:   { fontSize: 12, color: colors.muted, lineHeight: 18 },

  waitBox:      { backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10 },
  waitText:     { fontSize: 12, color: colors.muted, lineHeight: 18 },
  decideBox:    { backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b50', padding: 12, gap: 8 },
  decideTitle:  { fontSize: 14, fontWeight: '900', color: '#f59e0b' },
  decideText:   { fontSize: 12, color: colors.text, lineHeight: 18 },
  decideBtns:   { flexDirection: 'row', gap: 8 },
  goBtn:        { flex: 1, height: 42, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  goBtnText:    { color: '#000', fontWeight: '900', fontSize: 13 },
  cancelBtn:    { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#ef444440', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:{ color: '#ef4444', fontWeight: '800', fontSize: 13 },
  readyText:    { fontSize: 12, fontWeight: '800', color: colors.primary },
  confirmedBox: { backgroundColor: colors.glassLime, borderRadius: 10, borderWidth: 1, borderColor: `${colors.primary}40`, padding: 10 },
  confirmedText:{ fontSize: 12, fontWeight: '800', color: colors.primary, lineHeight: 18 },
}));
