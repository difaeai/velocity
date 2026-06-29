/**
 * Driver — Request Detail Screen
 *
 * Shows full ride details for a passenger request:
 *  - Pickup → dropoff route
 *  - Passenger's proposed fare
 *  - Auto-suggested fare (distance-based)
 *  - Fare adjuster: ±10 quick tap or custom amount
 *  - Submit → placeBid with chosen fare
 *  - Cancel → back to incoming requests
 */
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { api } from '../../../src/api/client';
import { useOpenRequests } from '../../../src/hooks/driver';
import { useDriverProfile } from '../../../src/hooks/driver';
import { useAuth } from '../../../src/auth/AuthContext';
import { colors } from '../../../src/config';
import { MapPlaceholder } from '../../../src/ui/MapPlaceholder';
import { PrimaryButton } from '../../../src/ui/components';

// ── Fare helpers ─────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function autoFare(lat1?: number, lng1?: number, lat2?: number, lng2?: number): number {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const km = haversineKm(lat1, lng1, lat2, lng2);
  return Math.max(150, Math.round(80 + km * 40));
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function RequestDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid;
  const profile = useDriverProfile(uid);

  // Reuse the openRequests hook — find the specific request by tripId
  const allRequests = useOpenRequests(true, undefined, undefined);
  const request = allRequests.find((r) => r.tripId === tripId);

  const [driverFare, setDriverFare] = useState<number | null>(null);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom]   = useState(false);
  const [busy, setBusy] = useState(false);

  const passengerFare = request?.offeredFare ?? 0;
  const suggested     = autoFare(
    request?.pickup?.lat, request?.pickup?.lng,
    request?.dropoff?.lat, request?.dropoff?.lng,
  );
  const activeFare = driverFare ?? passengerFare;

  async function submit() {
    if (!tripId) return;
    if (activeFare < passengerFare) {
      Alert.alert('Fare too low', 'Your fare cannot be less than the passenger\'s proposed fare.');
      return;
    }
    setBusy(true);
    try {
      await api.placeBid({ tripId, fare: activeFare });
      Alert.alert('Offer sent!', `Your fare of PKR ${activeFare} has been sent to the passenger.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to send offer.');
    } finally {
      setBusy(false);
    }
  }

  if (!request) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.muted}>Request no longer available.</Text>
          <PrimaryButton label="← Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Ride Request</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.container}>

        {/* Route map */}
        <MapPlaceholder
          pickup={request.pickup?.address}
          dropoff={request.dropoff?.address}
          pickupCoord={request.pickup?.lat && request.pickup?.lng
            ? { lat: request.pickup.lat, lng: request.pickup.lng } : undefined}
          dropoffCoord={request.dropoff?.lat && request.dropoff?.lng
            ? { lat: request.dropoff.lat, lng: request.dropoff.lng } : undefined}
        />

        {/* Route pill */}
        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: '#3b82f6' }]} />
            <Text style={styles.routeAddr} numberOfLines={2}>{request.pickup?.address ?? 'Pickup'}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.routeAddr} numberOfLines={2}>{request.dropoff?.address ?? 'Drop-off'}</Text>
          </View>
        </View>

        {/* Fare comparison */}
        <View style={styles.fareRow}>
          <View style={styles.fareBox}>
            <Text style={styles.fareBoxLabel}>Passenger Fare</Text>
            <Text style={styles.fareBoxAmt}>{passengerFare}</Text>
            <Text style={styles.fareBoxPkr}>PKR</Text>
          </View>
          <View style={styles.fareArrow}><Text style={styles.fareArrowTxt}>→</Text></View>
          <View style={[styles.fareBox, styles.fareBoxSuggested]}>
            <Text style={styles.fareBoxLabel}>Suggested Fare</Text>
            <Text style={[styles.fareBoxAmt, { color: colors.primary }]}>{suggested}</Text>
            <Text style={[styles.fareBoxPkr, { color: colors.primary }]}>PKR</Text>
          </View>
        </View>
        <Text style={styles.suggestedNote}>
          Suggested fare is auto-calculated based on route distance.
        </Text>

        {/* Ride badges */}
        <View style={styles.badgeRow}>
          <View style={styles.badge}><Text style={styles.badgeText}>{request.seats} seat(s)</Text></View>
          {request.paymentMethod === 'cash' && (
            <View style={styles.badge}><Text style={styles.badgeText}>💵 Cash</Text></View>
          )}
          {request.preferFemaleDriver && (
            <View style={[styles.badge, { borderColor: '#ff69b450' }]}>
              <Text style={[styles.badgeText, { color: '#ff69b4' }]}>👩 Female driver preferred</Text>
            </View>
          )}
        </View>

        {/* Your fare adjuster */}
        <Text style={styles.sectionLabel}>Your Fare</Text>
        <View style={styles.adjusterCard}>
          <Text style={styles.adjusterFare}>PKR {activeFare}</Text>

          <View style={styles.adjusterBtns}>
            <Pressable
              style={[styles.adjBtn, activeFare <= passengerFare && styles.adjBtnDisabled]}
              disabled={activeFare <= passengerFare}
              onPress={() => setDriverFare(Math.max(passengerFare, activeFare - 10))}
            >
              <Text style={styles.adjBtnTxt}>− 10</Text>
            </Pressable>
            <Pressable
              style={styles.adjBtn}
              onPress={() => setDriverFare(activeFare + 10)}
            >
              <Text style={styles.adjBtnTxt}>+ 10</Text>
            </Pressable>
            <Pressable
              style={[styles.adjBtn, { backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}50` }]}
              onPress={() => setDriverFare(suggested)}
            >
              <Text style={[styles.adjBtnTxt, { color: colors.primary }]}>Use suggested</Text>
            </Pressable>
          </View>

          {/* Custom amount */}
          {!showCustom ? (
            <Pressable onPress={() => setShowCustom(true)}>
              <Text style={styles.customLink}>Enter custom amount →</Text>
            </Pressable>
          ) : (
            <View style={styles.customRow}>
              <TextInput
                style={styles.customInput}
                keyboardType="number-pad"
                placeholder="e.g. 450"
                placeholderTextColor={colors.muted}
                value={customInput}
                onChangeText={setCustomInput}
              />
              <Pressable
                style={styles.customApplyBtn}
                onPress={() => {
                  const val = parseInt(customInput, 10);
                  if (!isNaN(val) && val >= passengerFare) {
                    setDriverFare(val);
                    setShowCustom(false);
                    setCustomInput('');
                  } else {
                    Alert.alert('Invalid', `Amount must be at least PKR ${passengerFare}.`);
                  }
                }}
              >
                <Text style={styles.customApplyTxt}>Apply</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Actions */}
        <PrimaryButton
          label={busy ? 'Sending…' : `Submit PKR ${activeFare}`}
          disabled={busy}
          onPress={submit}
        />
        <PrimaryButton
          variant="secondary"
          label="Cancel — back to requests"
          disabled={busy}
          onPress={() => router.back()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.background },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:   { width: 40 },
  backArrow: { fontSize: 24, color: colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  container: { padding: 16, gap: 14 },
  muted:     { fontSize: 13, color: colors.muted },

  routeCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  routeRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  routeDot:  { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  routeLine: { height: 18, width: 2, backgroundColor: colors.border, marginLeft: 4 },
  routeAddr: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text, lineHeight: 18 },

  fareRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fareBox:    { flex: 1, alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 2 },
  fareBoxSuggested: { borderColor: `${colors.primary}50`, backgroundColor: `${colors.primary}08` },
  fareBoxLabel: { fontSize: 11, fontWeight: '700', color: colors.muted },
  fareBoxAmt:   { fontSize: 26, fontWeight: '900', color: colors.text },
  fareBoxPkr:   { fontSize: 10, fontWeight: '700', color: colors.muted },
  fareArrow:    { alignItems: 'center' },
  fareArrowTxt: { fontSize: 20, color: colors.muted },
  suggestedNote: { fontSize: 11, color: colors.muted, textAlign: 'center' },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge:    { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.muted },

  sectionLabel: { fontSize: 13, fontWeight: '800', color: colors.text },
  adjusterCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14, alignItems: 'center' },
  adjusterFare: { fontSize: 36, fontWeight: '900', color: colors.text },
  adjusterBtns: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  adjBtn: { backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10 },
  adjBtnDisabled: { opacity: 0.35 },
  adjBtnTxt: { fontSize: 13, fontWeight: '800', color: colors.text },

  customLink: { fontSize: 12, color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
  customRow:  { flexDirection: 'row', gap: 8, alignItems: 'center' },
  customInput: {
    flex: 1, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, fontWeight: '700', color: colors.text,
  },
  customApplyBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  customApplyTxt: { fontSize: 13, fontWeight: '800', color: '#000' },
});
