import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { useAuth } from '../../src/auth/AuthContext';
import { db } from '../../src/firebase';
import { api } from '../../src/api/client';
import {
  useDriverActiveTrip,
  useDriverProfile,
  useOpenRequests,
  useWalletBalance,
} from '../../src/hooks/driver';
import { colors } from '../../src/config';
import { Badge, Card, PrimaryButton } from '../../src/ui/components';
import { MapPlaceholder } from '../../src/ui/MapPlaceholder';
import { RIDE_TYPE_LABELS, type TripStatus } from '../../src/domain/types';

const NEXT_ACTION: Partial<Record<TripStatus, { label: string; to?: 'arriving' | 'arrived' | 'in_progress' }>> = {
  matched: { label: 'Head to pickup', to: 'arriving' },
  arriving: { label: 'Arrived at pickup', to: 'arrived' },
  arrived: { label: 'Start trip', to: 'in_progress' },
  in_progress: { label: 'Complete trip' },
};

export default function DriverHome() {
  const { user, signOut } = useAuth();
  const uid = user?.uid;
  const router = useRouter();
  const profile = useDriverProfile(uid);
  const activeTrip = useDriverActiveTrip(uid);
  const online = profile?.online ?? false;
  const requests = useOpenRequests(online && !activeTrip);
  const balance = useWalletBalance(uid);
  const [busy, setBusy] = useState(false);

  // Commission lock state
  const [cycleGrossFare, setCycleGrossFare]   = useState(0);
  const [commThreshold, setCommThreshold]     = useState(5000);
  const [commRate, setCommRate]               = useState(0.10);
  const [payingComm, setPayingComm]           = useState(false);

  // Subscribe to driver doc for live cycleGrossFare
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'drivers', uid), (snap) => {
      setCycleGrossFare(snap.get('cycleGrossFare') ?? 0);
    });
    return unsub;
  }, [uid]);

  // Fetch commission settings once
  useEffect(() => {
    getDoc(doc(db, 'config', 'commissionSettings')).then((snap) => {
      if (snap.exists()) {
        setCommThreshold(snap.get('threshold') ?? 5000);
        setCommRate(snap.get('rate') ?? 0.10);
      }
    }).catch(() => {});
  }, []);

  const commissionLocked = cycleGrossFare >= commThreshold;
  const commissionOwed   = Math.round(commThreshold * commRate);

  async function handlePayCommission() {
    setPayingComm(true);
    try {
      await api.payCommission({});
      Alert.alert('Commission paid', 'Your account has been unlocked. You can now accept rides.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Payment failed.');
    } finally {
      setPayingComm(false);
    }
  }

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

  function toggleOnline() {
    if (!uid) return;
    run(() =>
      setDoc(doc(db, 'drivers', uid), { online: !online, lastSeenAt: serverTimestamp() }, { merge: true }),
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hello}>Driver</Text>
            <Text style={styles.email}>{user?.email ?? 'Driver'}</Text>
          </View>
          <Badge label={online ? 'Online' : 'Offline'} color={online ? colors.primary : colors.muted} />
        </View>

        <PrimaryButton
          label={online ? 'Go offline' : 'Go online'}
          variant={online ? 'danger' : 'primary'}
          disabled={busy}
          onPress={toggleOnline}
        />

        {/* Commission lock banner */}
        {commissionLocked && (
          <View style={styles.lockBanner}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={styles.lockTitle}>Account Locked — Commission Due</Text>
            <Text style={styles.lockBody}>
              Your total fares reached {commThreshold.toLocaleString()} PKR.{'\n'}
              Pay <Text style={styles.lockAmt}>{commissionOwed.toLocaleString()} PKR</Text> ({Math.round(commRate * 100)}%) to Velocity to unlock your account and accept rides again.
            </Text>
            <Text style={styles.lockSub}>You can still see incoming requests below.</Text>
            <Pressable
              style={[styles.lockPayBtn, payingComm && { opacity: 0.6 }]}
              onPress={handlePayCommission}
              disabled={payingComm}
            >
              <Text style={styles.lockPayBtnText}>
                {payingComm ? 'Processing…' : `Pay ${commissionOwed.toLocaleString()} PKR commission`}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Cycle earnings progress */}
        {!commissionLocked && cycleGrossFare > 0 && (
          <View style={styles.cycleBar}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={styles.cycleLabel}>Cycle earnings</Text>
              <Text style={styles.cycleLabel}>{cycleGrossFare.toLocaleString()} / {commThreshold.toLocaleString()} PKR</Text>
            </View>
            <View style={styles.cycleTrack}>
              <View style={[styles.cycleFill, { width: `${Math.min((cycleGrossFare / commThreshold) * 100, 100)}%` }]} />
            </View>
          </View>
        )}

        {/* Active trip takes priority */}
        {activeTrip ? (
          <Card>
            <Text style={styles.cardTitle}>Current trip · {RIDE_TYPE_LABELS[activeTrip.rideType]}</Text>
            <MapPlaceholder
              pickup={activeTrip.pickup?.address}
              dropoff={activeTrip.dropoff?.address}
              tracking={activeTrip.status === 'in_progress' || activeTrip.status === 'arriving'}
            />
            <Text style={styles.fare}>Fare: {activeTrip.fare} PKR</Text>
            {(() => {
              const next = NEXT_ACTION[activeTrip.status];
              if (!next) return null;
              return (
                <PrimaryButton
                  label={next.label}
                  disabled={busy}
                  onPress={() =>
                    run(() =>
                      next.to
                        ? api.updateTripStatus({ tripId: activeTrip.id, to: next.to })
                        : api.completeTrip({ tripId: activeTrip.id }),
                    )
                  }
                />
              );
            })()}
            <PrimaryButton
              variant="danger"
              label="🆘 SOS"
              disabled={busy}
              onPress={() => run(() => api.raiseSafetyEvent({ tripId: activeTrip.id, kind: 'sos' }))}
            />
          </Card>
        ) : online ? (
          <>
            <Text style={styles.section}>Incoming requests</Text>
            {requests.length === 0 ? (
              <Card>
                <Text style={styles.muted}>No open requests nearby. Stay online…</Text>
              </Card>
            ) : (
              requests.map((r) => (
                <Card key={r.id}>
                  <View style={styles.reqRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>
                        {RIDE_TYPE_LABELS[r.rideType]} · {r.seats} seat(s)
                      </Text>
                      <Text style={styles.muted}>
                        {r.pickup?.address ?? 'Pickup'} → {r.dropoff?.address ?? 'Drop-off'}
                      </Text>
                    </View>
                    <Text style={styles.fare}>{r.offeredFare} PKR</Text>
                  </View>
                  <View style={styles.bidRow}>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        label={commissionLocked ? '🔒 Locked' : `Accept ${r.offeredFare}`}
                        disabled={busy || commissionLocked}
                        onPress={() => {
                          if (commissionLocked) {
                            Alert.alert('Account Locked', `Pay your ${commissionOwed} PKR commission to accept rides.`);
                            return;
                          }
                          run(() => api.placeBid({ tripId: r.tripId, fare: r.offeredFare }));
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <PrimaryButton
                        variant="secondary"
                        label={commissionLocked ? '🔒' : `+50 → ${r.offeredFare + 50}`}
                        disabled={busy || commissionLocked}
                        onPress={() => run(() => api.placeBid({ tripId: r.tripId, fare: r.offeredFare + 50 }))}
                      />
                    </View>
                  </View>
                </Card>
              ))
            )}
          </>
        ) : (
          <Card>
            <Text style={styles.muted}>You&apos;re offline. Go online to receive ride requests.</Text>
          </Card>
        )}

        <Card>
          <Text style={styles.cardTitle}>Earnings</Text>
          <Text style={styles.earnings}>{balance} PKR</Text>
          <Text style={styles.muted}>{profile?.tripsCount ?? 0} trips · {profile?.rating ?? 5}★</Text>
          <View style={{ marginTop: 10 }}>
            <PrimaryButton
              variant="secondary"
              label="💳 Wallet & payouts"
              onPress={() => router.push('/driver/wallet')}
            />
          </View>
        </Card>

        {/* Pool Rides */}
        <View style={styles.poolSection}>
          <View style={styles.poolHeader}>
            <Text style={styles.poolTitle}>Pool Rides</Text>
            <Pressable
              style={styles.offerBtn}
              onPress={() => router.push('/driver/pool-ride-offer')}
            >
              <Text style={styles.offerBtnText}>+ Offer a ride</Text>
            </Pressable>
          </View>
          <Text style={styles.poolDesc}>
            Post your route and earn more by sharing seats.{'\n'}
            Example: 1200 PKR solo ride → 400 PKR × 4 passengers = 1600 PKR
          </Text>
          <Pressable
            style={styles.poolCTA}
            onPress={() => router.push('/driver/pool-ride-offer')}
          >
            <Text style={styles.poolCTAText}>🚗  Offer Pool Ride →</Text>
          </Pressable>
        </View>

        <PrimaryButton variant="danger" label="Sign out" onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hello: { fontSize: 15, color: colors.muted },
  email: { fontSize: 20, fontWeight: '900', color: colors.text },
  section: { fontSize: 14, fontWeight: '800', color: colors.text },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 8 },
  muted: { fontSize: 13, color: colors.muted },
  fare: { fontSize: 18, fontWeight: '900', color: colors.primary, marginVertical: 8 },
  reqRow: { flexDirection: 'row', alignItems: 'center' },
  bidRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  earnings: { fontSize: 28, fontWeight: '900', color: colors.primary, marginVertical: 4 },
  poolSection: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  poolHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  poolTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  offerBtn: {
    backgroundColor: `${colors.primary}20`,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${colors.primary}60`,
  },
  offerBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  poolDesc: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  poolCTA: {
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  poolCTAText: { fontSize: 15, fontWeight: '900', color: '#000' },

  // Commission lock banner
  lockBanner: {
    backgroundColor: '#2a0a0a',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.danger,
    padding: 16,
    gap: 8,
    alignItems: 'center' as const,
  },
  lockIcon: { fontSize: 28 },
  lockTitle: { fontSize: 16, fontWeight: '900', color: colors.danger, textAlign: 'center' as const },
  lockBody: { fontSize: 13, color: '#ffaaaa', textAlign: 'center' as const, lineHeight: 20 },
  lockAmt: { fontWeight: '900', color: '#ff6666' },
  lockSub: { fontSize: 11, color: colors.muted, textAlign: 'center' as const },
  lockPayBtn: {
    marginTop: 6,
    backgroundColor: colors.danger,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignSelf: 'stretch' as const,
    alignItems: 'center' as const,
  },
  lockPayBtnText: { fontSize: 14, fontWeight: '900', color: '#fff' },

  // Cycle earnings progress bar
  cycleBar: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  cycleLabel: { fontSize: 11, fontWeight: '700', color: colors.muted },
  cycleTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden' as const,
  },
  cycleFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
});
