import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from '../../../src/ui/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';

import { db as firestoreDb } from '../../../src/firebase';
import { api } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { themed } from '../../../src/theme';

type Status = 'open' | 'negotiating' | 'active' | 'full' | 'cancelled' | 'completed';

interface PoolRequest {
  id: string;
  leaderId: string;
  pickupAreaName: string;
  destinationAreaName: string;
  proposedFarePerSeat: number;
  agreedFarePerSeat: number | null;
  counterFarePerSeat: number | null;
  totalSlots: number;
  filledSlots: number;
  genderPref: string;
  passengers?: string[];
  /** First names only, keyed by uid — all a co-rider sees of the others. */
  passengerNames?: Record<string, string>;
  passengerDropoffs?: Record<string, { areaName?: string } | undefined>;
  driverId: string | null;
  driverName: string | null;
  driverVehicle: string | null;
  driverPlate: string | null;
  status: Status;
  /** Set when a driver accepts — starts the 10-minute no-joiner window. */
  activatedAt?: { toDate?: () => Date } | null;
  goAnyway?: { leader: boolean | null; driver: boolean | null } | null;
  goAnywayConfirmed?: boolean;
  cancelledBy?: 'leader' | 'driver';
}

/** Mirrors POOL_NO_JOINER_WINDOW_MS on the backend. */
const NO_JOINER_WINDOW_MS = 10 * 60 * 1000;

/** Ticks once a second while `on`, so the waiting countdown moves. */
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

const STATUS_META: Record<Status, { label: string; color: string; desc: string }> = {
  open:        { label: 'Waiting for driver',     color: '#f59e0b', desc: 'Riders can join your pool while we find a driver.' },
  negotiating: { label: 'Counter offer received', color: '#3b82f6', desc: 'Driver has proposed a higher fare.' },
  active:      { label: 'Ride confirmed',         color: '#22c55e', desc: 'Fare agreed. Other passengers can join.' },
  full:        { label: 'Ride full',              color: '#6b7280', desc: 'All seats are taken.' },
  cancelled:   { label: 'Cancelled',              color: '#ef4444', desc: 'This ride request was cancelled.' },
  completed:   { label: 'Completed',              color: '#22c55e', desc: 'Ride completed.' },
};

export default function PoolRequestDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [request, setRequest]   = useState<PoolRequest | null>(null);
  const [loading, setLoading]   = useState(true);
  const [acting, setActing]     = useState(false);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(firestoreDb, 'poolRideRequests', id), (snap) => {
      if (snap.exists()) {
        setRequest({ id: snap.id, ...snap.data() } as PoolRequest);
      }
      setLoading(false);
    });
    return unsub;
  }, [id]);

  const isLeader = user?.uid === request?.leaderId;

  // No-joiner window: a driver accepted but the leader is still riding alone.
  // Ten minutes after acceptance both sides get asked whether to go anyway —
  // going needs both, either one can cancel. (Hook stays above the early
  // returns below.)
  const activatedMs = request?.activatedAt?.toDate?.()?.getTime();
  const aloneActive =
    request?.status === 'active' && request?.filledSlots === 1 && !request?.goAnywayConfirmed;
  const now = useNowTick(!!aloneActive && typeof activatedMs === 'number');

  async function handleGoAnyway(action: 'go' | 'cancel') {
    if (!id) return;
    if (action === 'cancel') {
      const sure = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Cancel this ride?',
          'Nobody joined your pool. Cancel instead of going with just the driver?',
          [
            { text: 'Keep it', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Cancel ride', style: 'destructive', onPress: () => resolve(true) },
          ],
        ),
      );
      if (!sure) return;
    }
    setActing(true);
    try {
      const res = await api.respondToPoolGoAnyway({ requestId: id, action });
      if (action === 'go' && res.confirmed) {
        Alert.alert('Ride confirmed', 'The driver also agreed — they are on their way.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to respond. Try again.');
    } finally {
      setActing(false);
    }
  }

  async function handleLeaderResponse(action: 'accept' | 'reject') {
    if (!id) return;
    setActing(true);
    try {
      await api.leaderRespondToOffer({ requestId: id, action });
      if (action === 'reject') {
        Alert.alert('Counter rejected', 'The driver\'s counter offer was rejected. Your request is open again for other drivers.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to respond. Try again.');
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    if (!id) return;
    Alert.alert('Cancel Ride?', 'Are you sure you want to cancel this ride request?', [
      { text: 'No' },
      {
        text: 'Cancel Request',
        style: 'destructive',
        onPress: async () => {
          setActing(true);
          try {
            await api.cancelPoolRideRequest({ requestId: id });
            router.back();
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? 'Failed to cancel.');
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Ride request not found.</Text>
          <Pressable style={styles.backBtnLarge} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const meta = STATUS_META[request.status] ?? STATUS_META.open;
  const slotsLeft = request.totalSlots - request.filledSlots;
  const activeFare = request.agreedFarePerSeat ?? request.proposedFarePerSeat;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/passenger/home')} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Your Pool Request</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {/* Status card */}
        <View style={[styles.statusCard, { borderColor: meta.color + '50' }]}>
          <View style={[styles.statusPip, { backgroundColor: meta.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusLabel, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.statusDesc}>{meta.desc}</Text>
          </View>
        </View>

        {/* Route */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ROUTE</Text>
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.routeText}>{request.pickupAreaName}</Text>
          </View>
          <View style={[styles.dot, { alignSelf: 'flex-start', marginLeft: 5, backgroundColor: 'transparent', borderLeftWidth: 2, borderLeftColor: colors.border, height: 16, width: 1, marginVertical: 2 }]} />
          <View style={styles.routeRow}>
            <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.routeText}>{request.destinationAreaName}</Text>
          </View>
        </View>

        {/* Fare section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>FARE</Text>
          <View style={styles.fareRow}>
            <View>
              <Text style={styles.fareLabel}>Your proposed</Text>
              <Text style={styles.fareAmt}>{request.proposedFarePerSeat} PKR/seat</Text>
            </View>
            {request.agreedFarePerSeat !== null && (
              <View style={styles.fareAgreed}>
                <Text style={styles.fareAgreedLabel}>AGREED</Text>
                <Text style={styles.fareAgreedAmt}>{request.agreedFarePerSeat} PKR/seat</Text>
              </View>
            )}
          </View>

          {/* Driver counter offer */}
          {request.status === 'negotiating' && request.counterFarePerSeat !== null && isLeader && (
            <View style={styles.counterCard}>
              <Text style={styles.counterTitle}>Driver countered at:</Text>
              <Text style={styles.counterAmt}>{request.counterFarePerSeat} PKR/seat</Text>
              <Text style={styles.counterNote}>
                Total for {request.totalSlots} seats: {request.counterFarePerSeat * request.totalSlots} PKR
              </Text>
              <View style={styles.counterBtns}>
                <Pressable
                  style={[styles.counterBtn, styles.counterAccept, acting && { opacity: 0.5 }]}
                  onPress={() => handleLeaderResponse('accept')}
                  disabled={acting}
                >
                  {acting ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.counterAcceptText}>Accept</Text>}
                </Pressable>
                <Pressable
                  style={[styles.counterBtn, styles.counterReject, acting && { opacity: 0.5 }]}
                  onPress={() => handleLeaderResponse('reject')}
                  disabled={acting}
                >
                  <Text style={styles.counterRejectText}>Reject</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Read-only counter for other passengers */}
          {request.status === 'negotiating' && !isLeader && (
            <View style={styles.waitingChip}>
              <Text style={styles.waitingText}>Negotiation in progress. Waiting for leader to confirm fare.</Text>
            </View>
          )}
        </View>

        {/* Seats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SEATS</Text>
          <View style={styles.seatsRow}>
            {Array.from({ length: request.totalSlots }).map((_, i) => (
              <View
                key={i}
                style={[styles.seatDot, i < request.filledSlots && styles.seatDotFilled]}
              />
            ))}
            <Text style={styles.seatsLabel}>
              {slotsLeft > 0 ? `${slotsLeft} seat${slotsLeft > 1 ? 's' : ''} available` : 'Full'}
            </Text>
          </View>
        </View>

        {/* Who's in the pool — first names, what each pays, and the total. */}
        {(request.passengers?.length ?? 0) > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>WHO'S IN THIS POOL</Text>
            {(request.passengers ?? []).map((uid, i) => {
              const drop = request.passengerDropoffs?.[uid]?.areaName;
              return (
                <View key={uid} style={styles.memberRow}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {request.passengerNames?.[uid] ?? 'Rider'}
                    {i === 0 ? ' · leader' : ''}{uid === user?.uid ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.memberFare}>{activeFare} PKR</Text>
                  {drop && drop !== request.destinationAreaName ? (
                    <Text style={styles.memberDrop} numberOfLines={1}>↳ {drop}</Text>
                  ) : null}
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total · {request.filledSlots}/{request.totalSlots} seats</Text>
              <Text style={styles.totalAmt}>{activeFare * request.filledSlots} PKR</Text>
            </View>
          </View>
        )}

        {/* No-joiner window — driver aboard, leader still alone. */}
        {aloneActive && typeof activatedMs === 'number' && (
          activatedMs + NO_JOINER_WINDOW_MS - now > 0 ? (
            <View style={styles.waitBox}>
              <Text style={styles.waitText}>
                ⏳ Waiting for co-riders · {mmss(activatedMs + NO_JOINER_WINDOW_MS - now)} — if nobody
                joins, you and the driver both decide whether to go anyway.
              </Text>
            </View>
          ) : (
            <View style={styles.decideBox}>
              <Text style={styles.decideTitle}>Nobody joined your pool</Text>
              <Text style={styles.decideText}>
                {request.goAnyway?.driver === true
                  ? `${request.driverName ?? 'The driver'} is ready to go with just you at ${activeFare} PKR.`
                  : `Go with just you and the driver at ${activeFare} PKR? Both of you must agree — either of you can cancel.`}
              </Text>
              {isLeader ? (
                request.goAnyway?.leader === true ? (
                  <Text style={styles.readyText}>✓ You said go — waiting for the driver…</Text>
                ) : (
                  <View style={styles.decideBtns}>
                    <Pressable
                      style={[styles.goBtn, acting && { opacity: 0.5 }]}
                      disabled={acting}
                      onPress={() => handleGoAnyway('go')}
                    >
                      <Text style={styles.goBtnText}>Go anyway</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.goCancelBtn, acting && { opacity: 0.5 }]}
                      disabled={acting}
                      onPress={() => handleGoAnyway('cancel')}
                    >
                      <Text style={styles.goCancelText}>Cancel ride</Text>
                    </Pressable>
                  </View>
                )
              ) : (
                <Text style={styles.decideText}>Waiting for the leader and driver to decide.</Text>
              )}
            </View>
          )
        )}
        {request.status === 'active' && request.filledSlots === 1 && request.goAnywayConfirmed && (
          <View style={styles.confirmedBox}>
            <Text style={styles.confirmedText}>
              ✅ You and the driver both agreed — the ride is on. {request.driverName ?? 'Your driver'} is
              heading to {request.pickupAreaName}.
            </Text>
          </View>
        )}

        {/* Driver info (when assigned) */}
        {request.driverId && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>DRIVER</Text>
            <View style={styles.driverRow}>
              <View style={styles.driverAvatar}>
                <Text style={styles.driverAvatarText}>{(request.driverName ?? 'D').charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{request.driverName ?? 'Driver'}</Text>
                <Text style={styles.driverVehicle}>{request.driverVehicle} · {request.driverPlate}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Active fare info for other passengers joining */}
        {request.status === 'active' && !isLeader && (
          <View style={styles.joinInfoCard}>
            <Text style={styles.joinInfoTitle}>Confirmed fare</Text>
            <Text style={styles.joinInfoFare}>{activeFare} PKR/seat</Text>
            <Text style={styles.joinInfoNote}>This is the agreed fare — it cannot be renegotiated.</Text>
          </View>
        )}

        {/* Cancel button (leader only, if still cancellable) */}
        {isLeader && ['open', 'negotiating', 'active'].includes(request.status) && (
          <Pressable style={styles.cancelBtn} onPress={handleCancel} disabled={acting}>
            <Text style={styles.cancelBtnText}>Cancel Request</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe:            { flex: 1, backgroundColor: colors.background },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:         { width: 40 },
  backArrow:       { fontSize: 24, color: colors.text },
  headerTitle:     { fontSize: 17, fontWeight: '800', color: colors.text },

  container:       { padding: 16, gap: 12, paddingBottom: 40 },
  empty:           { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText:       { fontSize: 16, color: colors.muted },
  backBtnLarge:    { backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  backBtnText:     { color: '#000', fontWeight: '800' },

  statusCard:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, padding: 14 },
  statusPip:       { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  statusLabel:     { fontSize: 15, fontWeight: '800' },
  statusDesc:      { fontSize: 12, color: colors.muted, marginTop: 2 },

  card:            { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  cardTitle:       { fontSize: 10, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },

  routeRow:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot:             { width: 10, height: 10, borderRadius: 5 },
  routeText:       { fontSize: 15, fontWeight: '700', color: colors.text },

  fareRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  fareLabel:       { fontSize: 11, color: colors.muted, fontWeight: '600' },
  fareAmt:         { fontSize: 18, fontWeight: '900', color: colors.text },
  fareAgreed:      { alignItems: 'flex-end' },
  fareAgreedLabel: { fontSize: 9, fontWeight: '900', color: '#22c55e', letterSpacing: 0.8 },
  fareAgreedAmt:   { fontSize: 20, fontWeight: '900', color: '#22c55e' },

  counterCard:     { backgroundColor: '#0d1a3a', borderRadius: 12, borderWidth: 1, borderColor: '#3b82f640', padding: 14, gap: 8 },
  counterTitle:    { fontSize: 12, color: colors.muted, fontWeight: '700' },
  counterAmt:      { fontSize: 24, fontWeight: '900', color: '#60a5fa' },
  counterNote:     { fontSize: 11, color: colors.muted },
  counterBtns:     { flexDirection: 'row', gap: 10, marginTop: 4 },
  counterBtn:      { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  counterAccept:   { backgroundColor: colors.primary },
  counterAcceptText: { color: '#000', fontWeight: '900', fontSize: 15 },
  counterReject:   { backgroundColor: '#1c0a0a', borderWidth: 1, borderColor: '#ef444440' },
  counterRejectText: { color: '#ef4444', fontWeight: '800', fontSize: 15 },

  waitingChip:     { backgroundColor: '#1a1200', borderRadius: 10, borderWidth: 1, borderColor: '#f59e0b40', padding: 12 },
  waitingText:     { fontSize: 12, color: '#f59e0b' },

  memberRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  memberName:      { fontSize: 13, fontWeight: '800', color: colors.text, flexShrink: 1 },
  memberFare:      { fontSize: 13, fontWeight: '900', color: colors.primary, marginLeft: 'auto' },
  memberDrop:      { fontSize: 11, color: colors.muted, width: '100%' },
  totalRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  totalLabel:      { fontSize: 12, color: colors.muted, fontWeight: '700' },
  totalAmt:        { fontSize: 17, fontWeight: '900', color: colors.text },

  waitBox:         { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  waitText:        { fontSize: 12, color: colors.muted, lineHeight: 18 },
  decideBox:       { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b50', padding: 14, gap: 8 },
  decideTitle:     { fontSize: 14, fontWeight: '900', color: '#f59e0b' },
  decideText:      { fontSize: 12, color: colors.text, lineHeight: 18 },
  decideBtns:      { flexDirection: 'row', gap: 8 },
  goBtn:           { flex: 1, height: 42, backgroundColor: colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  goBtnText:       { color: '#000', fontWeight: '900', fontSize: 13 },
  goCancelBtn:     { flex: 1, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#ef444440', alignItems: 'center', justifyContent: 'center' },
  goCancelText:    { color: '#ef4444', fontWeight: '800', fontSize: 13 },
  readyText:       { fontSize: 12, fontWeight: '800', color: colors.primary },
  confirmedBox:    { backgroundColor: colors.glassLime, borderRadius: 12, borderWidth: 1, borderColor: `${colors.primary}40`, padding: 12 },
  confirmedText:   { fontSize: 12, fontWeight: '800', color: colors.primary, lineHeight: 18 },

  seatsRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seatDot:         { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.border },
  seatDotFilled:   { backgroundColor: colors.primary },
  seatsLabel:      { fontSize: 13, color: colors.muted, fontWeight: '600', marginLeft: 4 },

  driverRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverAvatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  driverAvatarText: { fontSize: 18, fontWeight: '900', color: '#000' },
  driverName:      { fontSize: 15, fontWeight: '800', color: colors.text },
  driverVehicle:   { fontSize: 12, color: colors.muted, marginTop: 2 },

  joinInfoCard:    { backgroundColor: colors.glassLime, borderRadius: 14, borderWidth: 1, borderColor: `${colors.primary}40`, padding: 14, alignItems: 'center', gap: 4 },
  joinInfoTitle:   { fontSize: 11, color: colors.muted, fontWeight: '700' },
  joinInfoFare:    { fontSize: 24, fontWeight: '900', color: colors.primary },
  joinInfoNote:    { fontSize: 11, color: colors.muted, textAlign: 'center' },

  cancelBtn:       { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#ef444430', backgroundColor: '#1c0a0a', alignItems: 'center', justifyContent: 'center' },
  cancelBtnText:   { color: '#ef4444', fontWeight: '800', fontSize: 15 },
}));
