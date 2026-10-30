/**
 * The shared ride's "are you coming?" (owner, 2026-10-30), over the whole app.
 *
 * When a driver starts a shared car (backend sharedPools startSharedCar), each
 * rider in it answers before anything else: one small box with their fare, the
 * car and who is in it, and Confirm or Cancel. The app waits — no back button,
 * nothing to tap past it. Confirm ends the rider's seats on every other shared
 * ride at once (they booked those to be sure of one); Cancel is leaving this car.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { FirebaseError } from 'firebase/app';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../config';
import { themed } from '../theme';
import { useActiveTrip } from '../hooks/useActiveTrip';
import { useTrip } from '../hooks/useTrip';
import { useCancellationSettings } from '../hooks/driver';
import { poolLeaveFee } from '../lib/poolLeave';
import { Text } from './Text';

/** "Go" green, as on the ride boxes' Join. */
const GO = '#22c55e';

const errorText = (e: unknown) => (e instanceof FirebaseError ? e.message : 'Please try again.');

export function SharedRideConfirmGate() {
  const { user } = useAuth();
  const uid = user?.uid;
  const { active } = useActiveTrip(uid);
  const pendingId = active?.confirmPending ? active.id : undefined;
  const { trip } = useTrip(pendingId);
  const rates = useCancellationSettings();
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);

  if (!uid || !pendingId || !trip || trip.id !== pendingId) return null;
  const tripId = pendingId;
  const fare = trip.poolFares?.[uid] ?? trip.poolPerSeatFare ?? trip.fare ?? trip.offeredFare;
  const fee = poolLeaveFee(trip, uid, rates);
  const driver = trip.driverInfo;
  const others = (trip.poolRoster ?? []).filter((r) => r.uid !== uid).map((r) => r.firstName);

  async function confirm() {
    setBusy('confirm');
    try {
      const { released = 0 } = await api.confirmSharedSeat({ tripId });
      if (released > 0) {
        Alert.alert(
          'You are confirmed',
          `Your seat${released === 1 ? '' : 's'} on ${released} other shared ride${released === 1 ? ' was' : 's were'} given back.`,
        );
      }
    } catch (e) {
      Alert.alert('Could not confirm', errorText(e));
    } finally {
      setBusy(null);
    }
  }

  function cancel() {
    Alert.alert(
      fee > 0 ? `Cancel your seat? It costs PKR ${fee}` : 'Cancel your seat?',
      fee > 0
        ? 'A driver has accepted this car, so leaving costs a share of your fare. Everyone else keeps their ride.'
        : 'It is free. Everyone else keeps their ride.',
      [
        { text: 'Keep my seat', style: 'cancel' },
        {
          text: fee > 0 ? `Cancel & pay PKR ${fee}` : 'Cancel seat',
          style: 'destructive',
          onPress: () => {
            setBusy('cancel');
            api.leaveSharedRide({ tripId })
              .catch((e) => Alert.alert('Could not cancel', errorText(e)))
              .finally(() => setBusy(null));
          },
        },
      ],
    );
  }

  return (
    // No onRequestClose action: the ride waits on an answer, so Back does nothing.
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.screen}>
        <View style={styles.box} accessibilityViewIsModal>
          <Text style={styles.title}>Your shared ride is starting</Text>
          <Text style={styles.sub}>Your driver is collecting everyone now. Are you coming?</Text>

          <View style={styles.row}>
            <Text style={styles.label}>FARE</Text>
            <Text style={styles.fare}>PKR {fare}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>CAR</Text>
            <Text style={styles.value} numberOfLines={2}>
              {driver
                ? `${driver.vehicleLabel}${driver.plate ? ` · ${driver.plate}` : ''} · ${driver.displayName}`
                : 'Your driver'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>PASSENGERS</Text>
            <Text style={styles.value} numberOfLines={2}>
              {others.length > 0 ? `You, ${others.join(', ')}` : 'Just you so far'}
            </Text>
          </View>

          <View style={styles.buttons}>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
              onPress={cancel}
              disabled={busy !== null}
              accessibilityRole="button"
            >
              {busy === 'cancel' ? <ActivityIndicator color={colors.text} /> : <Text style={styles.cancelTxt}>Cancel</Text>}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.85 }]}
              onPress={() => void confirm()}
              disabled={busy !== null}
              accessibilityRole="button"
            >
              {busy === 'confirm' ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.confirmTxt}>Confirm</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: {
    width: '100%', maxWidth: 360, borderRadius: 22, padding: 18, gap: 12,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: GO,
  },
  title: { fontSize: 18, fontWeight: '900', color: colors.text },
  sub: { fontSize: 13, fontWeight: '600', color: colors.muted, lineHeight: 18, marginTop: -6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { width: 88, fontSize: 10.5, fontWeight: '900', color: colors.muted, letterSpacing: 0.8 },
  fare: { fontSize: 22, fontWeight: '900', color: colors.primary },
  value: { flex: 1, fontSize: 14, fontWeight: '800', color: colors.text },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center',
  },
  cancelTxt: { fontSize: 15, fontWeight: '800', color: colors.text },
  confirmBtn: { flex: 1, height: 48, borderRadius: 14, backgroundColor: GO, alignItems: 'center', justifyContent: 'center' },
  confirmTxt: { fontSize: 15, fontWeight: '900', color: '#ffffff' },
}));
