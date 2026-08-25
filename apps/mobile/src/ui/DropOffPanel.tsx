/**
 * Ending a ride — one stop at a time.
 *
 * A solo ride ends once, so a single "Complete trip" button was the whole
 * story. A shared ride does not: four riders can be going four ways, and the
 * driver stops four times, collecting a different amount from a different
 * person at each one. With only "Complete trip" available, the first rider to
 * reach their street ended everybody's ride.
 *
 * So this shows the stops that are actually left, each one named, with the cash
 * to collect from that person. Dropping someone leaves the ride running; the
 * ride only ends when the last passenger is out, and then it ends by itself.
 *
 * The arrival prompt is the same decision offered a second way. When the driver
 * gets near a stop the panel puts the choice up unasked — take the money and
 * finish here, or keep going — because that is the moment they are deciding,
 * and reading a list while pulling over is not.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { api, type PoolRiderView } from '../api/client';
import { colors } from '../config';
import { themed } from '../theme';
import { distanceMeters, formatDistance } from '../lib/geo';
import { hasCoords, openNavigation } from '../lib/navigate';

/** Close enough to a stop that the driver is deciding about it right now. */
const ARRIVAL_RADIUS_M = 250;

interface Props {
  tripId: string;
  /** The whole-car fare, used when the trip carries no per-rider breakdown. */
  fallbackFare: number;
  isPool: boolean;
  paymentMethod: 'cash' | 'wallet';
  driverCoords: { lat: number; lng: number } | null;
  /** Fired once the last rider is out and the trip has been completed. */
  onCompleted: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

export function DropOffPanel({
  tripId,
  fallbackFare,
  isPool,
  paymentMethod,
  driverCoords,
  onCompleted,
  busy,
  setBusy,
}: Props) {
  const [riders, setRiders] = useState<PoolRiderView[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A stop the driver has said "keep going" to, so the prompt does not reappear
  // every second while they are still parked next to it.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Solo rides have nothing to fetch. Returning early rather than calling
    // setState here keeps the effect body free of synchronous state writes.
    if (!isPool) return;
    let alive = true;
    api.getPoolRiders({ tripId })
      .then((r) => { if (alive) setRiders(r.riders); })
      // A pool whose rider list cannot be read still has to be completable —
      // fall back to the single-stop flow rather than trapping the driver.
      .catch(() => { if (alive) setRiders(null); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [tripId, isPool]);

  // Derived, not stored: only a pool ever has anything to wait for.
  const loading = isPool && !loaded;

  const remaining = (riders ?? []).filter((r) => !r.droppedOff);
  /** A pool we could not break down behaves exactly like a solo ride. */
  const perRider = isPool && remaining.length > 0;

  async function completeWholeTrip() {
    setBusy(true);
    try {
      await api.completeTrip({ tripId });
      onCompleted();
    } catch (e) {
      Alert.alert('Could not complete', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function dropRider(rider: PoolRiderView) {
    setBusy(true);
    try {
      const res = await api.dropOffRider({ tripId, riderUid: rider.uid });
      if (res.remaining === 0) {
        // Last one out. The backend deliberately does not end the trip itself,
        // so the money logic lives in exactly one place — completeTrip.
        await api.completeTrip({ tripId });
        onCompleted();
        return;
      }
      setRiders((prev) =>
        (prev ?? []).map((r) => (r.uid === rider.uid ? { ...r, droppedOff: true } : r)),
      );
      Alert.alert(
        `${rider.name} dropped off`,
        `${paymentMethod === 'cash' ? `Collect PKR ${rider.fare ?? fallbackFare} in cash. ` : ''}`
          + `${res.remaining} passenger${res.remaining === 1 ? '' : 's'} still aboard.`,
      );
    } catch (e) {
      Alert.alert('Could not drop off', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmComplete(amount: number, who: string | null) {
    Alert.alert(
      'End the ride here?',
      who
        ? `Drop ${who} off and finish the ride.${paymentMethod === 'cash' ? ` Collect PKR ${amount} in cash.` : ''}`
        : `Finish the ride.${paymentMethod === 'cash' ? ` Collect PKR ${amount} in cash.` : ''}`,
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Complete ride', style: 'destructive', onPress: completeWholeTrip },
      ],
    );
  }

  /** The stop the driver has pulled up to, if any. */
  const atStop = driverCoords
    ? remaining.find((r) => {
        if (dismissed.has(r.uid)) return false;
        if (!hasCoords({ lat: r.dropoffLat ?? undefined, lng: r.dropoffLng ?? undefined })) return false;
        return distanceMeters(driverCoords.lat, driverCoords.lng, r.dropoffLat!, r.dropoffLng!) <= ARRIVAL_RADIUS_M;
      })
    : undefined;

  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.loadingText}>Loading your stops…</Text>
      </View>
    );
  }

  // ── Solo, or a pool we could not break into riders ──
  if (!perRider) {
    return (
      <Pressable
        style={({ pressed }) => [styles.completeBtn, pressed && { opacity: 0.85 }]}
        disabled={busy}
        onPress={() => confirmComplete(fallbackFare, null)}
      >
        <Text style={styles.completeBtnText}>
          Complete ride{paymentMethod === 'cash' ? ` · collect PKR ${fallbackFare}` : ''}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.wrap}>
      {/* Pulled up at somebody's stop: put the decision on screen rather than
          making the driver find the right row in a list. */}
      {atStop ? (
        <View style={styles.arrivedCard}>
          <Text style={styles.arrivedTitle}>{`You're at ${atStop.name}'s stop`}</Text>
          <Text style={styles.arrivedSub} numberOfLines={2}>
            {atStop.dropoffAddress ?? 'Drop-off point'}
          </Text>
          <View style={styles.arrivedActions}>
            <Pressable
              style={({ pressed }) => [styles.keepGoingBtn, pressed && { opacity: 0.8 }]}
              disabled={busy}
              onPress={() => setDismissed((prev) => new Set([...prev, atStop.uid]))}
            >
              <Text style={styles.keepGoingText}>Keep going</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dropBtn, pressed && { opacity: 0.85 }]}
              disabled={busy}
              onPress={() => dropRider(atStop)}
            >
              <Text style={styles.dropBtnText}>
                Drop off{paymentMethod === 'cash' ? ` · PKR ${atStop.fare ?? fallbackFare}` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>
        {remaining.length} STOP{remaining.length === 1 ? '' : 'S'} LEFT
      </Text>

      {remaining.map((r) => {
        const away =
          driverCoords && r.dropoffLat != null && r.dropoffLng != null
            ? formatDistance(distanceMeters(driverCoords.lat, driverCoords.lng, r.dropoffLat, r.dropoffLng))
            : null;
        const isLast = remaining.length === 1;
        return (
          <View key={r.uid} style={styles.riderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.riderName}>{r.name}</Text>
              <Text style={styles.riderDrop} numberOfLines={1}>
                {r.dropoffAddress ?? 'Drop-off point'}
              </Text>
              <Text style={styles.riderMeta}>
                {paymentMethod === 'cash' ? `Collect PKR ${r.fare ?? fallbackFare}` : `PKR ${r.fare ?? fallbackFare} from wallet`}
                {away ? ` · ${away} away` : ''}
              </Text>
            </View>
            <View style={styles.riderActions}>
              {r.dropoffLat != null && r.dropoffLng != null ? (
                <Pressable
                  style={styles.riderNavBtn}
                  onPress={() => openNavigation({ lat: r.dropoffLat!, lng: r.dropoffLng!, address: r.dropoffAddress })}
                >
                  <Text style={styles.riderNavText}>🧭</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={({ pressed }) => [styles.riderDropBtn, pressed && { opacity: 0.85 }]}
                disabled={busy}
                onPress={() =>
                  isLast
                    ? confirmCompleteLast(r)
                    : dropRider(r)
                }
              >
                <Text style={styles.riderDropText}>{isLast ? 'Finish' : 'Drop off'}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );

  /** The last rider's drop-off ends the ride, so it asks first. */
  function confirmCompleteLast(rider: PoolRiderView) {
    Alert.alert(
      'End the ride here?',
      `${rider.name} is the last passenger.${paymentMethod === 'cash' ? ` Collect PKR ${rider.fare ?? fallbackFare} in cash.` : ''} This finishes the ride.`,
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'Complete ride', style: 'destructive', onPress: () => dropRider(rider) },
      ],
    );
  }
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: 8, marginBottom: 10 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  loadingText: { color: colors.muted, fontSize: 12, fontWeight: '600' },

  completeBtn: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  completeBtnText: { color: '#0b0d0c', fontSize: 15, fontWeight: '900' },

  arrivedCard: {
    backgroundColor: `${colors.primary}18`,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  arrivedTitle: { color: colors.text, fontSize: 15, fontWeight: '900' },
  arrivedSub: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  arrivedActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  keepGoingBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepGoingText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  dropBtn: {
    flex: 1.4,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropBtnText: { color: '#0b0d0c', fontSize: 13, fontWeight: '900' },

  sectionLabel: {
    color: colors.muted,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 2,
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 12,
  },
  riderName: { color: colors.text, fontSize: 14, fontWeight: '900' },
  riderDrop: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  riderMeta: { color: colors.primary, fontSize: 11.5, fontWeight: '800', marginTop: 2 },
  riderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riderNavBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderNavText: { fontSize: 15 },
  riderDropBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderDropText: { color: '#0b0d0c', fontSize: 12.5, fontWeight: '900' },
}));
