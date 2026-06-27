import { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, onSnapshot } from 'firebase/firestore';

import { api } from '../../../src/api/client';
import { db } from '../../../src/firebase';
import { useAuth } from '../../../src/auth/AuthContext';
import { useCurrentLocation } from '../../../src/hooks/location';
import { colors } from '../../../src/config';
import { Card, PrimaryButton } from '../../../src/ui/components';
import { ChatModal } from '../../../src/ui/ChatModal';

// ── Types ────────────────────────────────────────────────────────────────────

interface PoolPassenger {
  uid:            string;
  userName?:      string;
  userPhone?:     string;
  pickupAddress?: string;
  pickupLat?:     number;
  pickupLng?:     number;
  dropoffAddress?:string;
  fare?:          number;
  status:         'confirmed' | 'driver_arrived' | 'picked_up' | 'dropped_off';
}

interface PoolRide {
  id:                   string;
  status:               string;
  pickup:               { address: string; lat: number; lng: number };
  dropoff:              { address: string; lat: number; lng: number };
  perSeatFare:          number;
  takenSeats:           number;
  maxSeats:             number;
  grossFare?:           number;
  pickupOrder?:         string[];
  currentPickupIndex?:  number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PoolPickup() {
  const { id: rideId } = useLocalSearchParams<{ id: string }>();
  const { user }       = useAuth();
  const { coords }     = useCurrentLocation();
  const router         = useRouter();

  const [ride,       setRide]       = useState<PoolRide | null>(null);
  const [passengers, setPassengers] = useState<Record<string, PoolPassenger>>({});
  const [busy,       setBusy]       = useState(false);
  const [chatOpen,   setChatOpen]   = useState(false);

  useEffect(() => {
    if (!rideId) return;
    return onSnapshot(doc(db, 'poolRides', rideId), (snap) => {
      if (snap.exists()) setRide({ id: snap.id, ...(snap.data() as Omit<PoolRide, 'id'>) });
    });
  }, [rideId]);

  useEffect(() => {
    if (!rideId) return;
    return onSnapshot(collection(db, 'poolRides', rideId, 'passengers'), (snap) => {
      const map: Record<string, PoolPassenger> = {};
      snap.docs.forEach((d) => {
        map[d.id] = { uid: d.id, ...(d.data() as Omit<PoolPassenger, 'uid'>) };
      });
      setPassengers(map);
    });
  }, [rideId]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!ride) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.loading}>Loading pool ride…</Text>
      </SafeAreaView>
    );
  }

  const allPassengers  = Object.values(passengers);
  const pickedUp       = allPassengers.filter((p) => p.status === 'picked_up');
  const totalPassengers = allPassengers.length;

  // ── Phase 1: Before boarding starts ──────────────────────────────────────
  if (ride.status === 'open' || ride.status === 'collecting' || ride.status === 'full') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Pool ride</Text>
          <Text style={styles.sub}>
            {totalPassengers} passenger{totalPassengers !== 1 ? 's' : ''} · {ride.takenSeats}/{ride.maxSeats} seats
          </Text>

          <View style={styles.route}>
            <Text style={styles.routeText} numberOfLines={1}>📍 {ride.pickup?.address ?? 'Pickup'}</Text>
            <Text style={styles.routeArrow}>↓</Text>
            <Text style={styles.routeText} numberOfLines={1}>🏁 {ride.dropoff?.address ?? 'Dropoff'}</Text>
          </View>

          {allPassengers.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Passengers joined</Text>
              {allPassengers.map((p) => (
                <Card key={p.uid}>
                  <Text style={styles.passName}>{p.userName ?? 'Passenger'}</Text>
                  <Text style={styles.passSub}>{p.pickupAddress ?? 'Pickup location'}</Text>
                  <Text style={styles.passDropoff}>→ {p.dropoffAddress ?? 'Their dropoff'}</Text>
                </Card>
              ))}
            </>
          )}

          {allPassengers.length === 0 && (
            <Card><Text style={styles.sub}>Waiting for passengers to join…</Text></Card>
          )}

          <View style={styles.startHint}>
            <Text style={styles.startHintText}>
              When you're ready, tap below. Your app will sort passengers by distance
              from your current location and guide you to each stop.
            </Text>
          </View>

          <PrimaryButton
            label={
              totalPassengers === 0 ? 'No passengers yet'
              : !coords ? 'Getting your location…'
              : `Start boarding (${totalPassengers} passenger${totalPassengers !== 1 ? 's' : ''})`
            }
            disabled={totalPassengers === 0 || busy || !coords}
            onPress={() => {
              if (!rideId || !coords) return;
              run(() => api.startPoolBoarding({ rideId: rideId!, driverLat: coords.lat, driverLng: coords.lng }));
            }}
          />
          <PrimaryButton
            variant="secondary"
            label="← Back"
            onPress={() => router.back()}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Phase 2: Boarding — picking up passengers one by one ─────────────────
  if (ride.status === 'boarding') {
    const pickupOrder   = ride.pickupOrder ?? [];
    const currentIdx    = ride.currentPickupIndex ?? 0;
    const currentPid    = pickupOrder[currentIdx];
    const currentPass   = currentPid ? passengers[currentPid] : null;
    const completedPids = pickupOrder.slice(0, currentIdx);
    const upcomingPids  = pickupOrder.slice(currentIdx + 1);

    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          {/* Progress header */}
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Picking up passengers</Text>
            <Text style={styles.progressCount}>{pickedUp.length}/{totalPassengers} boarded</Text>
          </View>

          {/* Progress dots */}
          <View style={styles.dots}>
            {pickupOrder.map((pid, i) => {
              const done    = passengers[pid]?.status === 'picked_up';
              const current = i === currentIdx;
              return (
                <View
                  key={pid}
                  style={[styles.dot, done && styles.dotDone, current && styles.dotCurrent]}
                />
              );
            })}
          </View>

          {/* Current target */}
          {currentPass && (
            <Card style={styles.currentCard}>
              <View style={styles.stopBadge}>
                <Text style={styles.stopBadgeText}>Stop {currentIdx + 1} of {pickupOrder.length}</Text>
              </View>
              <Text style={styles.passName}>{currentPass.userName ?? 'Passenger'}</Text>
              <Text style={styles.passSub}>{currentPass.pickupAddress ?? 'Pickup location'}</Text>

              {/* Contact */}
              <View style={styles.contactRow}>
                {currentPass.userPhone ? (
                  <Pressable
                    style={styles.contactBtn}
                    onPress={() => Linking.openURL(`tel:${currentPass.userPhone}`)}
                  >
                    <Text style={styles.contactBtnText}>📞 Call</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.contactBtn, { backgroundColor: colors.primary + '18' }]}
                  onPress={() => setChatOpen(true)}
                >
                  <Text style={styles.contactBtnText}>💬 Message</Text>
                </Pressable>
              </View>

              {/* State-dependent action */}
              {currentPass.status === 'confirmed' && (
                <PrimaryButton
                  label="I've arrived at this pickup stop"
                  disabled={busy}
                  onPress={() =>
                    run(() => api.poolArrivePassenger({ rideId: rideId!, passengerId: currentPid! }))
                  }
                />
              )}

              {currentPass.status === 'driver_arrived' && (
                <>
                  <View style={styles.arrivedBanner}>
                    <Text style={styles.arrivedText}>Passenger notified — you've arrived!</Text>
                  </View>
                  <PrimaryButton
                    label="Passenger has boarded ✓"
                    disabled={busy}
                    onPress={() =>
                      run(() => api.poolPassengerBoarded({ rideId: rideId!, passengerId: currentPid! }))
                    }
                  />
                </>
              )}
            </Card>
          )}

          {/* Upcoming stops */}
          {upcomingPids.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Upcoming stops</Text>
              {upcomingPids.map((pid, offset) => {
                const p = passengers[pid];
                return (
                  <Card key={pid} style={styles.upcomingCard}>
                    <Text style={styles.upcomingStop}>Stop {currentIdx + offset + 2}</Text>
                    <Text style={styles.passName}>{p?.userName ?? 'Passenger'}</Text>
                    <Text style={styles.passSub}>{p?.pickupAddress ?? 'Pickup location'}</Text>
                  </Card>
                );
              })}
            </>
          )}

          {/* Already boarded */}
          {completedPids.filter((pid) => passengers[pid]?.status === 'picked_up').length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Boarded</Text>
              {completedPids
                .filter((pid) => passengers[pid]?.status === 'picked_up')
                .map((pid) => {
                  const p = passengers[pid];
                  return (
                    <Card key={pid} style={styles.boardedCard}>
                      <Text style={styles.boardedName}>✓ {p?.userName ?? 'Passenger'}</Text>
                    </Card>
                  );
                })}
            </>
          )}
        </ScrollView>

        <ChatModal
          visible={chatOpen}
          roomId={rideId ?? ''}
          isPoolRide
          myUid={user?.uid ?? ''}
          myName={user?.displayName ?? 'Driver'}
          otherName={currentPass?.userName ?? 'Passenger'}
          onClose={() => setChatOpen(false)}
        />
      </SafeAreaView>
    );
  }

  // ── Phase 3: All boarded — en route to destination ───────────────────────
  if (ride.status === 'in_progress') {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>En route to destination</Text>
          <View style={styles.route}>
            <Text style={styles.routeText} numberOfLines={1}>🏁 {ride.dropoff?.address ?? 'Destination'}</Text>
          </View>

          <Text style={styles.sectionLabel}>Passengers on board</Text>
          {pickedUp.map((p) => (
            <Card key={p.uid}>
              <Text style={styles.passName}>{p.userName ?? 'Passenger'}</Text>
              <Text style={styles.passSub}>→ {p.dropoffAddress ?? 'Their dropoff'}</Text>
            </Card>
          ))}

          <View style={styles.completeEarn}>
            <Text style={styles.completeEarnLabel}>Estimated earnings</Text>
            <Text style={styles.completeEarnAmt}>{pickedUp.length * ride.perSeatFare} PKR</Text>
          </View>

          <PrimaryButton
            label="Complete pool ride"
            disabled={busy}
            onPress={() =>
              run(async () => {
                await api.completePoolRide({ rideId: rideId! });
                router.replace('/driver/home');
              })
            }
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Phase 4: Completed ───────────────────────────────────────────────────
  if (ride.status === 'completed') {
    const earned = ride.grossFare ?? pickedUp.length * ride.perSeatFare;
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.title}>Pool ride complete!</Text>
          <View style={styles.completeEarn}>
            <Text style={styles.completeEarnLabel}>You earned</Text>
            <Text style={styles.completeEarnAmt}>{earned} PKR</Text>
          </View>
          <PrimaryButton label="Back to home" onPress={() => router.replace('/driver/home')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return null;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.background },
  container:  { padding: 18, gap: 14 },
  loading:    { padding: 20, color: colors.muted },
  title:      { fontSize: 22, fontWeight: '900', color: colors.text },
  sub:        { fontSize: 14, color: colors.muted },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },

  route: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  routeText:  { fontSize: 14, fontWeight: '700', color: colors.text },
  routeArrow: { fontSize: 14, color: colors.muted, marginVertical: 4, marginLeft: 2 },

  startHint: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  startHintText: { fontSize: 13, color: colors.muted, lineHeight: 18 },

  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTitle:  { fontSize: 18, fontWeight: '900', color: colors.text },
  progressCount:  { fontSize: 14, fontWeight: '700', color: colors.primary },

  dots: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.border,
  },
  dotDone:    { backgroundColor: colors.primary },
  dotCurrent: { backgroundColor: colors.primary, width: 18, borderRadius: 9 },

  currentCard: { borderColor: colors.primary, borderWidth: 2 },
  stopBadge: {
    backgroundColor: colors.primary + '20',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  stopBadgeText: { fontSize: 11, fontWeight: '800', color: colors.primary },

  passName:    { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 2 },
  passSub:     { fontSize: 13, color: colors.muted, marginBottom: 2 },
  passDropoff: { fontSize: 13, color: colors.muted },

  contactRow: { flexDirection: 'row', gap: 10, marginVertical: 12 },
  contactBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },

  arrivedBanner: {
    backgroundColor: colors.primary + '18',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  arrivedText: { fontSize: 14, fontWeight: '800', color: colors.primary, textAlign: 'center' },

  upcomingCard: { opacity: 0.65 },
  upcomingStop: { fontSize: 11, fontWeight: '800', color: colors.muted, marginBottom: 4 },

  boardedCard: { opacity: 0.5, paddingVertical: 10 },
  boardedName: { fontSize: 14, fontWeight: '700', color: colors.primary },

  completeEarn: {
    backgroundColor: colors.primary + '18',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
  },
  completeEarnLabel: { fontSize: 13, color: colors.primary, fontWeight: '700', marginBottom: 4 },
  completeEarnAmt:   { fontSize: 32, fontWeight: '900', color: colors.primary },
});
