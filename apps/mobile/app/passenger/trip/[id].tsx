import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
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

export default function TripScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const tripId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { trip, bids, loading } = useTrip(tripId);
  const [busy, setBusy] = useState(false);

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

        {/* ── Bidding ── */}
        {trip.status === 'requested' && (
          <>
            <Card>
              <Text style={styles.cardTitle}>Your offer: {trip.offeredFare} PKR</Text>
              <Text style={styles.muted}>Drivers nearby can accept or counter your fare.</Text>
            </Card>
            {pendingBids.length === 0 ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.muted, { marginTop: 8 }]}>Waiting for bids…</Text>
              </View>
            ) : (
              pendingBids.map((b) => (
                <Card key={b.id}>
                  <View style={styles.bidRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{b.driverInfo.displayName}</Text>
                      <Text style={styles.muted}>
                        {b.driverInfo.vehicleLabel} · {b.driverInfo.plate} · {b.driverInfo.rating}★
                      </Text>
                    </View>
                    <Text style={styles.fare}>{b.fare} PKR</Text>
                  </View>
                  <PrimaryButton
                    label="Accept"
                    disabled={busy}
                    onPress={() => run(() => api.acceptBid({ tripId: trip.id, bidId: b.id }))}
                  />
                </Card>
              ))
            )}
            <PrimaryButton
              variant="danger"
              label="Cancel request"
              disabled={busy}
              onPress={() => run(() => api.cancelTrip({ tripId: trip.id }))}
            />
          </>
        )}

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
});
