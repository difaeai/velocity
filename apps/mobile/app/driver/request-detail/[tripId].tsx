/**
 * Driver — Ride request.
 *
 * The job laid out over the map: both legs with their ETAs, who is hailing,
 * where they are going, and what they will pay.
 *
 * Fare model (unchanged, and the same one the passenger app expects):
 *   • "Accept for PKR X"  → a bid at exactly the fare the passenger offered.
 *   • "Offer your fare"   → a bid above it.
 * Either way the passenger sees every driver who responded and picks one —
 * accepting does not silently lock the ride to this driver.
 */
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, { Path } from 'react-native-svg';

import { api, type ReportReason } from '../../../src/api/client';
import { useAuth } from '../../../src/auth/AuthContext';
import { useDriverProfile, useOpenRequests } from '../../../src/hooks/driver';
import { useCurrentLocation } from '../../../src/hooks/location';
import { colors } from '../../../src/config';
import { formatDistance } from '../../../src/lib/geo';
import { timeAgo } from '../../../src/lib/timeAgo';
import { RIDE_TYPE_LABELS } from '../../../src/domain/types';
import { RequestRouteMap } from '../../../src/ui/RequestRouteMap';
import { ReportRequestModal } from '../../../src/ui/ReportRequestModal';
import { DriverDrawer } from '../../../src/ui/DriverDrawer';

/** Quick "offer your fare" steps above the passenger's price. */
const OFFER_STEPS = [0.10, 0.18, 0.26];

export default function RequestDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const profile = useDriverProfile(user?.uid);
  const { coords } = useCurrentLocation();

  const requests = useOpenRequests(true, coords?.lat, coords?.lng);
  const request = requests.find((r) => r.tripId === tripId);

  const [selectedFare, setSelectedFare] = useState<number | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const offeredFare = request?.offeredFare ?? 0;
  const fare = selectedFare ?? offeredFare;
  const isCounterOffer = fare > offeredFare;

  const offers = OFFER_STEPS.map((step) => Math.round(offeredFare * (1 + step)));

  async function sendOffer() {
    if (!tripId || !request) return;
    setBusy(true);
    try {
      await api.placeBid({ tripId, fare });
      Alert.alert(
        isCounterOffer ? 'Offer sent' : 'Accepted',
        isCounterOffer
          ? `Your fare of PKR ${fare.toLocaleString()} was sent to the passenger.`
          : `You accepted PKR ${fare.toLocaleString()}. The passenger will confirm shortly.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(reasons: ReportReason[], description: string) {
    if (!tripId) return;
    setReporting(true);
    setReportError(null);
    try {
      await api.reportOpenRequest({ tripId, reasons, ...(description ? { description } : {}) });
      setReportOpen(false);
      Alert.alert('Report sent', 'Thank you. Our team will review this request.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Could not send the report. Please try again.');
    } finally {
      setReporting(false);
    }
  }

  function applyCustomFare() {
    const val = parseInt(customInput, 10);
    if (Number.isNaN(val) || val < offeredFare) {
      Alert.alert('Invalid fare', `Your fare cannot be below the passenger's PKR ${offeredFare.toLocaleString()}.`);
      return;
    }
    setSelectedFare(val);
    setCustomInput('');
    setCustomOpen(false);
  }

  // The request is gone the moment another driver is picked, or the passenger
  // cancels — the feed doc is deleted, so say so instead of showing a husk.
  if (!request) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.gone}>
          <Text style={styles.goneIcon}>🚗💨</Text>
          <Text style={styles.goneTitle}>Request no longer available</Text>
          <Text style={styles.goneBody}>It was taken by another driver or cancelled by the passenger.</Text>
          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeTxt}>Close</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const hasRoute =
    request.pickup?.lat !== undefined && request.pickup?.lng !== undefined &&
    request.dropoff?.lat !== undefined && request.dropoff?.lng !== undefined;

  const name = request.passengerName?.trim() || 'Passenger';
  const rating = request.passengerRating ?? 5;
  const ratingCount = request.passengerRatingCount ?? 0;
  const online = profile?.online ?? false;

  return (
    <View style={styles.root}>
      {/* ── Map ── */}
      <View style={styles.map}>
        {hasRoute ? (
          <RequestRouteMap
            pickup={{ lat: request.pickup!.lat!, lng: request.pickup!.lng! }}
            dropoff={{ lat: request.dropoff!.lat!, lng: request.dropoff!.lng! }}
            driver={coords ? { lat: coords.lat, lng: coords.lng } : null}
          />
        ) : (
          <View style={styles.noMap}>
            <Text style={styles.noMapTxt}>Route unavailable for this request</Text>
          </View>
        )}
      </View>

      {/* ── Floating header ── */}
      <SafeAreaView style={styles.headerSafe} edges={['top']} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="box-none">
          <Pressable onPress={() => setDrawerOpen(true)} hitSlop={12} style={styles.headerBtn}>
            <Svg width={26} height={26} viewBox="0 0 24 24">
              <Path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" fill={colors.text} />
            </Svg>
          </Pressable>

          <View style={[styles.statusPill, online ? styles.statusOn : styles.statusOff]}>
            <Text style={styles.statusTxt}>{online ? 'Online' : 'Offline'}</Text>
          </View>

          <Pressable onPress={() => router.push('/passenger/settings')} hitSlop={12} style={styles.headerBtn}>
            <Svg width={24} height={24} viewBox="0 0 24 24">
              <Path
                d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.25.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
                fill={colors.text}
              />
            </Svg>
          </Pressable>
        </View>

        <Text style={styles.title}>Ride request</Text>

        {/* Overflow — report the request from here too. */}
        <Pressable
          style={styles.moreBtn}
          onPress={() =>
            Alert.alert('Ride request', undefined, [
              { text: 'Report this request', style: 'destructive', onPress: () => { setReportError(null); setReportOpen(true); } },
              { text: 'Cancel', style: 'cancel' },
            ])
          }
        >
          <Text style={styles.moreTxt}>•••</Text>
        </Pressable>
      </SafeAreaView>

      {/* ── Request sheet ── */}
      <SafeAreaView style={styles.sheetSafe} edges={['bottom']}>
        <ScrollView
          style={styles.sheet}
          contentContainerStyle={styles.sheetBody}
          showsVerticalScrollIndicator={false}
        >
          {/* Passenger + fare */}
          <View style={styles.topRow}>
            <View style={styles.who}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{name.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.whoName} numberOfLines={1}>{name}</Text>
              <View style={styles.ratingRow}>
                <Text style={styles.star}>★</Text>
                <Text style={styles.rating}>
                  {rating.toFixed(2)}
                  <Text style={styles.ratingCount}> ({ratingCount})</Text>
                </Text>
              </View>
              <Text style={styles.ago}>{request.createdAt ? timeAgo(request.createdAt.seconds) : ''}</Text>
            </View>

            <View style={styles.fareCol}>
              {request.distanceM !== undefined && (
                <Text style={styles.distance}>~{formatDistance(request.distanceM)}</Text>
              )}
              <Text style={styles.fare}>PKR{offeredFare.toLocaleString()}</Text>

              <View style={styles.stopRow}>
                <View style={styles.stopA}><Text style={styles.stopATxt}>A</Text></View>
                <Text style={styles.stopAddr} numberOfLines={2}>{request.pickup?.address ?? 'Pickup'}</Text>
              </View>
              <View style={styles.stopRow}>
                <View style={styles.stopB}><Text style={styles.stopBTxt}>B</Text></View>
                <Text style={styles.stopAddr} numberOfLines={2}>{request.dropoff?.address ?? 'Drop-off'}</Text>
              </View>

              <View style={styles.chips}>
                <View style={[styles.chip, styles.chipPay]}>
                  <Text style={styles.chipPayTxt}>
                    {request.paymentMethod === 'wallet' ? 'Wallet' : 'Cash'}
                  </Text>
                </View>
                <View style={[styles.chip, styles.chipCat]}>
                  <Text style={styles.chipCatTxt}>{RIDE_TYPE_LABELS[request.rideType]}</Text>
                </View>
                {request.seats > 1 && (
                  <View style={[styles.chip, styles.chipCat]}>
                    <Text style={styles.chipCatTxt}>{request.seats} seats</Text>
                  </View>
                )}
                {request.preferFemaleDriver && (
                  <View style={[styles.chip, { backgroundColor: '#ff69b41f' }]}>
                    <Text style={[styles.chipCatTxt, { color: '#ff8ac6' }]}>Female driver</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Accept / offer */}
          <Pressable
            style={[styles.accept, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={sendOffer}
          >
            <Text style={styles.acceptTxt}>
              {busy
                ? 'Sending…'
                : isCounterOffer
                  ? `Offer PKR${fare.toLocaleString()}`
                  : `Accept for PKR${fare.toLocaleString()}`}
            </Text>
          </Pressable>

          <Text style={styles.offerLabel}>Offer your fare</Text>
          <View style={styles.offerRow}>
            {offers.map((amount) => (
              <Pressable
                key={amount}
                style={[styles.offerChip, fare === amount && styles.offerChipOn]}
                onPress={() => setSelectedFare(amount)}
              >
                <Text style={[styles.offerChipTxt, fare === amount && styles.offerChipTxtOn]}>
                  PKR{amount.toLocaleString()}
                </Text>
              </Pressable>
            ))}
            <Pressable style={styles.pencilBtn} onPress={() => setCustomOpen(true)}>
              <Svg width={20} height={20} viewBox="0 0 24 24">
                <Path
                  d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                  fill={colors.text}
                />
              </Svg>
            </Pressable>
          </View>

          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeTxt}>Close</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      {/* Custom fare */}
      <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCustomOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Your fare</Text>
            <Text style={styles.modalSub}>
              At least PKR {offeredFare.toLocaleString()} — the passenger&apos;s offer.
            </Text>
            <TextInput
              value={customInput}
              onChangeText={setCustomInput}
              keyboardType="number-pad"
              autoFocus
              placeholder={String(offeredFare)}
              placeholderTextColor={colors.muted}
              style={styles.modalInput}
              onSubmitEditing={applyCustomFare}
            />
            <Pressable style={styles.modalApply} onPress={applyCustomFare}>
              <Text style={styles.modalApplyTxt}>Set fare</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <ReportRequestModal
        visible={reportOpen}
        submitting={reporting}
        error={reportError}
        onClose={() => { setReportOpen(false); setReportError(null); }}
        onSubmit={submitReport}
      />

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  safe: { flex: 1, backgroundColor: colors.background },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  noMap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0e1216' },
  noMapTxt: { color: colors.muted, fontSize: 13, fontWeight: '600' },

  // ── Floating header ──
  headerSafe: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerBtn: { padding: 4 },
  statusPill: { borderRadius: 20, paddingHorizontal: 34, paddingVertical: 9 },
  statusOn: { backgroundColor: colors.primary },
  statusOff: { backgroundColor: '#ff8a8a' },
  statusTxt: { fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
    marginTop: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 8,
  },
  moreBtn: {
    position: 'absolute',
    right: 14,
    top: 58,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1f7a45',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreTxt: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1 },

  // ── Sheet ──
  sheetSafe: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '62%' },
  sheet: {
    backgroundColor: '#1b1e1d',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sheetBody: { padding: 16, gap: 14 },

  topRow: { flexDirection: 'row', gap: 12 },
  who: { width: 66, alignItems: 'center', gap: 2 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  avatarTxt: { fontSize: 20, fontWeight: '800', color: colors.text },
  whoName: { fontSize: 12, color: colors.muted, fontWeight: '600', textAlign: 'center' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  star: { fontSize: 11, color: '#f5a623' },
  rating: { fontSize: 11, fontWeight: '700', color: colors.text },
  ratingCount: { fontSize: 11, fontWeight: '500', color: colors.muted },
  ago: { fontSize: 11, color: colors.muted },

  fareCol: { flex: 1, gap: 4 },
  distance: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  fare: { fontSize: 30, fontWeight: '900', color: colors.text, marginBottom: 4 },

  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stopA: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stopATxt: { fontSize: 11, fontWeight: '900', color: '#000' },
  stopB: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#22c55e', alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stopBTxt: { fontSize: 11, fontWeight: '900', color: '#04210f' },
  stopAddr: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text, lineHeight: 21 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  chipPay: { backgroundColor: colors.primary },
  chipPayTxt: { fontSize: 14, fontWeight: '800', color: '#000' },
  chipCat: { backgroundColor: '#5aa9f8' },
  chipCatTxt: { fontSize: 14, fontWeight: '800', color: '#04203f' },

  accept: {
    height: 60,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  acceptTxt: { fontSize: 20, fontWeight: '800', color: '#000' },

  offerLabel: { fontSize: 16, fontWeight: '600', color: colors.muted, textAlign: 'center' },
  offerRow: { flexDirection: 'row', gap: 10 },
  offerChip: {
    flex: 1,
    height: 62,
    borderRadius: 14,
    backgroundColor: '#2b2f2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerChipOn: { backgroundColor: colors.primary },
  offerChipTxt: { fontSize: 16, fontWeight: '700', color: colors.text },
  offerChipTxtOn: { color: '#000', fontWeight: '800' },
  pencilBtn: {
    width: 62,
    height: 62,
    borderRadius: 14,
    backgroundColor: '#2b2f2e',
    alignItems: 'center',
    justifyContent: 'center',
  },

  closeBtn: {
    height: 60,
    borderRadius: 16,
    backgroundColor: '#2b2f2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: { fontSize: 19, fontWeight: '700', color: colors.text },

  // ── Request gone ──
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 12 },
  goneIcon: { fontSize: 44 },
  goneTitle: { fontSize: 19, fontWeight: '800', color: colors.text, textAlign: 'center' },
  goneBody: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: 10 },

  // ── Custom fare modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#1b1e1d',
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  modalSub: { fontSize: 13, color: colors.muted },
  modalInput: {
    height: 60,
    borderRadius: 14,
    backgroundColor: '#2b2f2e',
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalApply: {
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalApplyTxt: { fontSize: 17, fontWeight: '900', color: '#000' },
});
