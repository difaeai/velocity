import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

import { useAuth } from '../../src/auth/AuthContext';
import { db } from '../../src/firebase';
import { api } from '../../src/api/client';
import {
  useDriverActiveTrip,
  useDriverPoolRides,
  useDriverProfile,
  useOpenRequests,
  useWalletBalance,
} from '../../src/hooks/driver';
import { colors } from '../../src/config';
import { Badge, Card, PrimaryButton } from '../../src/ui/components';
import { MapPlaceholder } from '../../src/ui/MapPlaceholder';
import { RatingModal } from '../../src/ui/RatingModal';
import { ChatModal } from '../../src/ui/ChatModal';
import { DriverDrawer } from '../../src/ui/DriverDrawer';
import { RIDE_TYPE_LABELS, type Trip, type TripStatus } from '../../src/domain/types';

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
  const profile    = useDriverProfile(uid);
  const activeTrip = useDriverActiveTrip(uid);
  const poolRides  = useDriverPoolRides(uid);
  const online  = profile?.online ?? false;
  const requests = useOpenRequests(online && !activeTrip);
  const balance  = useWalletBalance(uid);
  const [busy, setBusy] = useState(false);

  // Commission lock state
  const [cycleGrossFare, setCycleGrossFare] = useState(0);
  const [commThreshold,  setCommThreshold]  = useState(5000);
  const [commRate,       setCommRate]       = useState(0.10);
  const [payingComm,     setPayingComm]     = useState(false);

  // Rating state: shown after driver completes a trip
  const [ratingTrip, setRatingTrip]   = useState<Trip | null>(null);
  const prevTripRef                   = useRef<Trip | null>(null);

  // Chat state
  const [chatOpen, setChatOpen]       = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen]   = useState(false);

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

  // When active trip disappears (driver completed it), capture it for rating
  useEffect(() => {
    if (prevTripRef.current && !activeTrip) {
      // Trip just ended — offer driver a chance to rate the passenger
      if (prevTripRef.current.status === 'in_progress' && !prevTripRef.current.driverRated) {
        setRatingTrip(prevTripRef.current);
      }
    }
    prevTripRef.current = activeTrip;
  }, [activeTrip]);

  const commissionLocked = cycleGrossFare >= commThreshold;
  const commissionOwed   = Math.round(commThreshold * commRate);

  async function handleRate(stars: number, comment: string) {
    if (!ratingTrip) return;
    await api.submitRating({ tripId: ratingTrip.id, stars, comment: comment || undefined, targetRole: 'passenger' });
    setRatingTrip(null);
  }

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
          <Pressable onPress={() => setDrawerOpen(true)} style={styles.menuBtn} hitSlop={12}>
            <Text style={styles.menuIcon}>☰</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.hello}>Driver</Text>
            <Text style={styles.email}>{profile?.fullName || user?.email || 'Driver'}</Text>
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

            {/* Passenger contact */}
            <View style={styles.contactRow}>
              {activeTrip.passengerPhone ? (
                <Pressable
                  style={styles.contactBtn}
                  onPress={() => Linking.openURL(`tel:${activeTrip.passengerPhone}`)}
                >
                  <Text style={styles.contactBtnText}>📞 Call passenger</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.contactBtn, { backgroundColor: colors.primary + '18' }]}
                onPress={() => setChatOpen(true)}
              >
                <Text style={styles.contactBtnText}>💬 Message</Text>
              </Pressable>
            </View>

            {/* Next action button */}
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
            <Text style={styles.section}>Incoming requests — all ride types</Text>
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

        {/* Offer a Pool Route — optional extra income feature */}
        <View style={styles.poolSection}>
          <View style={styles.poolHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.poolTitle}>Offer a Pool Route</Text>
              <Text style={styles.poolSubtitle}>Earn more by sharing your own route</Text>
            </View>
            <Pressable
              style={styles.offerBtn}
              onPress={() => router.push('/driver/pool-ride-offer')}
            >
              <Text style={styles.offerBtnText}>+ New route</Text>
            </Pressable>
          </View>

          {/* Active pool routes the driver created */}
          {poolRides.length > 0 && (
            <View style={{ gap: 10 }}>
              {poolRides.map((pr) => (
                <Pressable
                  key={pr.id}
                  style={styles.poolRideCard}
                  onPress={() => router.push(`/driver/pool-pickup/${pr.id}`)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.poolRideRoute} numberOfLines={1}>
                      {pr.pickup?.address ?? 'Pickup'} → {pr.dropoff?.address ?? 'Dropoff'}
                    </Text>
                    <Text style={styles.poolRideMeta}>
                      {pr.takenSeats}/{pr.maxSeats} seats · {pr.perSeatFare} PKR/seat
                    </Text>
                  </View>
                  <View style={styles.poolRideStatusBadge}>
                    <Text style={styles.poolRideStatusText}>
                      {pr.status === 'open'         ? '🟡 Open'
                        : pr.status === 'collecting' ? '🟢 Collecting'
                        : pr.status === 'full'       ? '🔵 Full'
                        : pr.status === 'boarding'   ? '🚗 Boarding'
                        : pr.status === 'in_progress'? '🏁 En route'
                        : pr.status}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {poolRides.length === 0 && (
            <Text style={styles.poolDesc}>
              Post your own route and fill empty seats along the way.{'\n'}
              Example: 1200 PKR solo → 400 PKR × 4 passengers = 1600 PKR
            </Text>
          )}
        </View>

        <PrimaryButton variant="danger" label="Sign out" onPress={signOut} />
      </ScrollView>

      {/* Post-trip: rate the passenger */}
      <RatingModal
        visible={ratingTrip !== null}
        targetLabel="Rate your passenger"
        targetName="Passenger"
        onSubmit={handleRate}
        onSkip={() => setRatingTrip(null)}
      />

      {/* In-ride chat with passenger */}
      {activeTrip && (
        <ChatModal
          visible={chatOpen}
          roomId={activeTrip.id}
          myUid={user?.uid ?? ''}
          myName={user?.displayName ?? 'Driver'}
          otherName="Passenger"
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Side drawer */}
      <DriverDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        driverName={profile?.fullName ?? user?.displayName ?? ''}
        driverEmail={user?.email ?? ''}
        online={online}
        tripsCount={profile?.tripsCount ?? 0}
        rating={profile?.rating ?? 5}
        onSignOut={signOut}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuBtn:   { padding: 4 },
  menuIcon:  { fontSize: 26, color: colors.text, fontWeight: '700' },
  hello: { fontSize: 15, color: colors.muted },
  email: { fontSize: 18, fontWeight: '900', color: colors.text },
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
  poolHeader:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  poolTitle:     { fontSize: 16, fontWeight: '800', color: colors.text },
  poolSubtitle:  { fontSize: 12, color: colors.muted, marginTop: 2 },
  offerBtn: {
    backgroundColor: `${colors.primary}20`,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${colors.primary}60`,
  },
  offerBtnText: { fontSize: 12, fontWeight: '800', color: colors.primary },
  poolDesc: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: 4 },
  poolRideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
  },
  poolRideRoute: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 3 },
  poolRideMeta:  { fontSize: 11, color: colors.muted },
  poolRideStatusBadge: {
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  poolRideStatusText: { fontSize: 11, fontWeight: '700', color: colors.text },
  contactRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
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
