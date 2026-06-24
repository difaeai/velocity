import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '../../../src/api/client';
import { useTrip } from '../../../src/hooks/useTrip';
import { colors } from '../../../src/config';
import { Badge, Card, PrimaryButton } from '../../../src/ui/components';
import { MapPlaceholder } from '../../../src/ui/MapPlaceholder';
import { RIDE_TYPE_LABELS, type TripStatus } from '../../../src/domain/types';

const STATUS_LABEL: Record<TripStatus, string> = {
  requested: 'Finding you a driver…',
  matched: 'Driver assigned',
  arriving: 'Driver is on the way',
  arrived: 'Driver has arrived',
  in_progress: 'On the way to your destination',
  completed: 'Trip complete',
  cancelled: 'Trip cancelled',
};

const BUBBLE_COLORS = ['#3b82f6', '#ef4444', '#10b981'];

export default function TripScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const tripId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { trip, bids, loading } = useTrip(tripId);
  const [busy, setBusy] = useState(false);
  const [timeLeft, setTimeLeft] = useState(54);
  const [adjustedFare, setAdjustedFare] = useState(0);
  const [autoAccept, setAutoAccept] = useState(false);

  // Initialize adjustedFare when trip loads
  useEffect(() => {
    if (trip && adjustedFare === 0) {
      setAdjustedFare(trip.offeredFare);
    }
  }, [trip]);

  // Countdown timer
  useEffect(() => {
    if (!trip || trip.status !== 'requested') return;
    const timer = setInterval(() => {
      setTimeLeft((t) => (t > 0 ? t - 1 : 59));
    }, 1000);
    return () => clearInterval(timer);
  }, [trip?.status]);

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

  if (loading || !trip) {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  const goHome = () => router.replace('/passenger/home');
  const pendingBids = bids.filter((b) => b.status === 'pending');

  if (trip.status === 'requested') {
    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    };

    return (
      <View style={styles.safeDark}>
        {/* 1. Full Screen Dark Map */}
        <View style={styles.mapContainerFull}>
          {/* Abstract Map Roads */}
          <View style={[styles.roadLine, { top: 120, left: -50, width: '130%', transform: [{ rotate: '-15deg' }] }]} />
          <View style={[styles.roadLine, { top: 260, left: -50, width: '130%', transform: [{ rotate: '25deg' }] }]} />
          <View style={[styles.roadLine, { top: 400, left: -50, width: '130%', transform: [{ rotate: '-10deg' }] }]} />
          <View style={[styles.roadLine, { top: 0, left: 160, width: 4, height: '100%' }]} />

          {/* User Location Pulse (from Image 3) */}
          <View style={[styles.pulsePin, { top: 220, left: 180 }]}>
            <View style={styles.pinGlow} />
            <Text style={{ fontSize: 24 }}>👤</Text>
          </View>
        </View>

        {/* 2. Top floating counter: real driver offers on this request */}
        <SafeAreaView style={styles.floatingTopArea} pointerEvents="box-none">
          <View style={styles.viewersBanner}>
            <Text style={styles.viewersText}>
              {pendingBids.length > 0
                ? `${pendingBids.length} driver${pendingBids.length > 1 ? 's' : ''} sent an offer`
                : 'Searching for nearby drivers…'}
            </Text>
            {pendingBids.length > 0 ? (
              <View style={styles.avatarBubbles}>
                {pendingBids.slice(0, 3).map((b, i) => (
                  <View
                    key={b.id}
                    style={[
                      styles.avatarBubble,
                      {
                        backgroundColor: BUBBLE_COLORS[i % BUBBLE_COLORS.length],
                        marginLeft: i === 0 ? 0 : -8,
                      },
                    ]}
                  >
                    <Text style={styles.avatarBubbleText}>
                      {(b.driverInfo.displayName?.[0] ?? 'D').toUpperCase()}
                    </Text>
                  </View>
                ))}
                {pendingBids.length > 3 ? (
                  <View style={[styles.avatarBubble, { backgroundColor: '#4b5563', marginLeft: -8 }]}>
                    <Text style={styles.avatarBubbleText}>+{pendingBids.length - 3}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </SafeAreaView>

        {/* 3. Bottom Slide-up Bidding Sheet */}
        <View style={styles.bottomBiddingSheet}>
          <View style={styles.dragIndicator} />

          {/* Priority banner with countdown */}
          <View style={styles.priorityBanner}>
            <Text style={styles.priorityText}>Good fare. Your request gets priority</Text>
            <Text style={styles.countdownText}>{formatTime(timeLeft)}</Text>
          </View>

          {/* Progress bar line */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${(timeLeft / 60) * 100}%` }]} />
          </View>

          {/* Stepper adjuster for fare */}
          <View style={styles.fareAdjusterRow}>
            <Pressable
              style={[styles.adjustBtn, adjustedFare <= trip.offeredFare && styles.adjustBtnDisabled]}
              onPress={() => setAdjustedFare((f) => Math.max(trip.offeredFare, f - 5))}
              disabled={adjustedFare <= trip.offeredFare}
            >
              <Text style={styles.adjustBtnText}>- 5</Text>
            </Pressable>
            
            <Text style={styles.biddingFareValue}>PKR {adjustedFare}</Text>
            
            <Pressable
              style={styles.adjustBtn}
              onPress={() => setAdjustedFare((f) => f + 5)}
            >
              <Text style={styles.adjustBtnText}>+ 5</Text>
            </Pressable>
          </View>

          {/* Raise fare button */}
          <Pressable
            style={[styles.raiseFareBtn, adjustedFare <= trip.offeredFare && styles.raiseFareBtnDisabled]}
            disabled={adjustedFare <= trip.offeredFare || busy}
            onPress={() => run(() => api.raiseTripFare({ tripId: trip.id, fare: adjustedFare }))}
          >
            <Text style={[styles.raiseFareBtnText, adjustedFare <= trip.offeredFare && { color: '#8a8c8c' }]}>
              Raise fare
            </Text>
          </Pressable>

          {/* Auto-accept offer toggle */}
          <View style={styles.toggleRowBidding}>
            <Text style={styles.toggleLabelBidding}>Auto-accept an offer of PKR {adjustedFare} up to 5 min away</Text>
            <Pressable
              onPress={() => setAutoAccept((v) => !v)}
              style={[styles.toggleSwitchBidding, autoAccept && { backgroundColor: colors.primary }]}
            >
              <View style={[styles.toggleKnobBidding, autoAccept && styles.toggleKnobOn]} />
            </Pressable>
          </View>

          {/* Cash Payment Badge */}
          <View style={styles.cashBadgeRow}>
            <Text style={{ fontSize: 16 }}>💵</Text>
            <Text style={styles.cashBadgeText}>PKR {adjustedFare} Cash</Text>
          </View>

          {/* Scrollable route & bids details */}
          <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: 10 }} keyboardShouldPersistTaps="handled">
            {/* Route Details Card */}
            <View style={styles.routePillCard}>
              <View style={styles.routePillPoint}>
                <Text style={styles.routeDotBlue}>👤</Text>
                <Text style={styles.routePillText} numberOfLines={1}>{trip.pickup?.address || 'Pickup'}</Text>
              </View>
              <View style={styles.routePillDivider} />
              <View style={styles.routePillPoint}>
                <Text style={styles.routeDotGreen}>🏁</Text>
                <Text style={styles.routePillText} numberOfLines={1}>{trip.dropoff?.address || 'Drop-off'}</Text>
              </View>
            </View>

            {/* List of active bids if any */}
            {pendingBids.length > 0 && (
              <View style={styles.driverBidsSection}>
                <Text style={styles.driverBidsTitle}>Active Driver Offers</Text>
                {pendingBids.map((b) => (
                  <View key={b.id} style={styles.driverBidCard}>
                    <View style={styles.bidMetaRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bidDriverName}>{b.driverInfo.displayName}</Text>
                        <Text style={styles.bidDriverVehicle}>
                          {b.driverInfo.vehicleLabel} · {b.driverInfo.plate} · {b.driverInfo.rating}★
                        </Text>
                      </View>
                      <Text style={styles.bidFarePKR}>{b.fare} PKR</Text>
                    </View>
                    <Pressable
                      style={styles.acceptBidBtn}
                      disabled={busy}
                      onPress={() => run(() => api.acceptBid({ tripId: trip.id, bidId: b.id }))}
                    >
                      <Text style={styles.acceptBidBtnText}>Accept Offer</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          {/* Cancel Request Button */}
          <Pressable
            style={({ pressed }) => [styles.cancelRequestBtn, pressed && { opacity: 0.85 }]}
            onPress={() => run(() => api.cancelTrip({ tripId: trip.id }))}
            disabled={busy}
          >
            <Text style={styles.cancelRequestBtnText}>Cancel request</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.status}>{STATUS_LABEL[trip.status]}</Text>
          <Badge label={RIDE_TYPE_LABELS[trip.rideType]} />
        </View>

        <MapPlaceholder
          pickup={trip.pickup?.address}
          dropoff={trip.dropoff?.address}
          tracking={trip.status === 'in_progress' || trip.status === 'arriving'}
        />



        {/* ── Active trip ── */}
        {['matched', 'arriving', 'arrived', 'in_progress'].includes(trip.status) && (
          <>
            {trip.driverInfo && (
              <Card>
                <Text style={styles.cardTitle}>{trip.driverInfo.displayName}</Text>
                <Text style={styles.muted}>
                  {trip.driverInfo.vehicleLabel} · {trip.driverInfo.plate} · {trip.driverInfo.rating}★
                </Text>
                <Text style={[styles.fare, { marginTop: 6 }]}>Fare: {trip.fare} PKR</Text>
              </Card>
            )}
            <PrimaryButton
              variant="danger"
              label="🆘 Emergency SOS"
              disabled={busy}
              onPress={() =>
                run(() => api.raiseSafetyEvent({ tripId: trip.id, kind: 'sos' }))
              }
            />
            {trip.status !== 'in_progress' && (
              <PrimaryButton
                variant="secondary"
                label="Cancel trip"
                disabled={busy}
                onPress={() => run(() => api.cancelTrip({ tripId: trip.id }))}
              />
            )}
          </>
        )}

        {/* ── Invoice ── */}
        {trip.status === 'completed' && (
          <Card>
            <Text style={styles.cardTitle}>Invoice</Text>
            <Row label="Ride" value={RIDE_TYPE_LABELS[trip.rideType]} />
            <Row label="Seats" value={`${trip.settlement?.seats ?? trip.seats}`} />
            <Row label="Total fare" value={`${trip.settlement?.grossFare ?? trip.fare ?? 0} PKR`} />
            <Row label="Your share" value={`${trip.settlement?.passengerShare ?? 0} PKR`} bold />
            <View style={{ height: 10 }} />
            <PrimaryButton label="Done" onPress={goHome} />
          </Card>
        )}

        {trip.status === 'cancelled' && (
          <Card>
            <Text style={styles.muted}>This trip was cancelled.</Text>
            <View style={{ height: 10 }} />
            <PrimaryButton label="Back to home" onPress={goHome} />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.invoiceRow}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.invoiceVal, bold && { fontWeight: '900', color: colors.primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 18, gap: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  status: { fontSize: 20, fontWeight: '900', color: colors.text, flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  bidRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  fare: { fontSize: 18, fontWeight: '900', color: colors.primary },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  invoiceVal: { fontSize: 14, fontWeight: '700', color: colors.text },
  
  // Custom dark-mode requested screen styles (Image 2 & 3)
  safeDark: {
    flex: 1,
    backgroundColor: '#151616',
  },
  mapContainerFull: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: '44%', // upper portion of the screen
    backgroundColor: '#151b22',
  },
  roadLine: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#262f3c',
  },
  pulsePin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinGlow: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  floatingTopArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  viewersBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#1c1b1b',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    borderRadius: 99,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 4,
  },
  viewersText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  avatarBubbles: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBubble: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1c1b1b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBubbleText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '800',
  },
  bottomBiddingSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: '#151616',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    paddingTop: 10,
  },
  dragIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3e4040',
    alignSelf: 'center',
    marginBottom: 10,
  },
  priorityBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  priorityText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  countdownText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'Courier',
  },
  progressBarBg: {
    height: 3,
    backgroundColor: '#2d2f2f',
    width: '100%',
    marginTop: 6,
    marginBottom: 14,
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#ffffff',
  },
  fareAdjusterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 20,
  },
  adjustBtn: {
    width: 80,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustBtnDisabled: {
    opacity: 0.5,
  },
  adjustBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  biddingFareValue: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
    minWidth: 110,
    textAlign: 'center',
  },
  raiseFareBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  raiseFareBtnDisabled: {
    backgroundColor: '#1c1b1b',
    borderColor: '#2d2f2f',
  },
  raiseFareBtnText: {
    color: '#ccff00',
    fontSize: 15,
    fontWeight: '800',
  },
  toggleRowBidding: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2f2f',
  },
  toggleLabelBidding: {
    color: '#8a8c8c',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    paddingRight: 10,
  },
  toggleSwitchBidding: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2d2f2f',
    padding: 2,
    justifyContent: 'center',
  },
  toggleKnobBidding: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#8a8c8c',
  },
  toggleKnobOn: {
    backgroundColor: '#000',
    alignSelf: 'flex-end',
  },
  cashBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    gap: 10,
  },
  cashBadgeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sheetScroll: {
    flex: 1,
    paddingHorizontal: 20,
    marginVertical: 10,
  },
  routePillCard: {
    backgroundColor: '#212222',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d2f2f',
    padding: 10,
    gap: 6,
  },
  routePillPoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeDotBlue: {
    color: '#3b82f6',
    fontSize: 14,
  },
  routeDotGreen: {
    color: '#ccff00',
    fontSize: 14,
  },
  routePillText: {
    color: '#8a8c8c',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  routePillDivider: {
    height: 1,
    backgroundColor: '#2d2f2f',
    marginLeft: 22,
  },
  driverBidsSection: {
    marginTop: 16,
    gap: 10,
  },
  driverBidsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  driverBidCard: {
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  bidMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bidDriverName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  bidDriverVehicle: {
    color: '#8a8c8c',
    fontSize: 11,
    marginTop: 2,
  },
  bidFarePKR: {
    color: '#ccff00',
    fontSize: 16,
    fontWeight: '900',
  },
  acceptBidBtn: {
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ccff00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBidBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  cancelRequestBtn: {
    marginHorizontal: 20,
    marginBottom: 20,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#212222',
    borderWidth: 1,
    borderColor: '#2d2f2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelRequestBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
});
