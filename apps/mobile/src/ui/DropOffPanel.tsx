/**
 * Starting and ending a ride — one passenger at a time.
 *
 * A solo ride ends once, so a single END RIDE button is the whole story. A
 * shared ride does not: riders get in one by one (an en-route rider halfway
 * along), four riders can be going four ways, and the driver stops four times,
 * collecting a different amount from a different person at each one.
 *
 * So on a shared car every passenger has their own START RIDE, from the
 * moment the car is at the pickup — the first one in starts the trip — and
 * their own END RIDE once aboard, with the cash to collect from that person.
 * The ride only ends when the last passenger is out, and then it ends by itself.
 *
 * The arrival prompt is the same decision offered a second way. When the driver
 * gets near a stop the panel puts the choice up unasked — take the money and
 * finish here, or keep going — because that is the moment they are deciding,
 * and reading a list while pulling over is not.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { callInApp } from '../lib/inAppCall';

import { api, type PoolRiderView } from '../api/client';
import { useTripFees } from '../hooks/driver';
import { colors } from '../config';
import { themed } from '../theme';
import { distanceMeters, formatDistance } from '../lib/geo';
import { hasCoords, openNavigation } from '../lib/navigate';
import type { TripStatus } from '../domain/types';
import { SkeletonRows } from './states';

/** Close enough to a stop that the driver is deciding about it right now. */
const ARRIVAL_RADIUS_M = 250;

const GENDER_MARK: Record<string, string> = { male: '♂', female: '♀' };

interface Props {
  tripId: string;
  /** At the pickup ('arrived') riders are started; once running, ended. */
  tripStatus: TripStatus;
  /** The whole-car fare, used when the trip carries no per-rider breakdown. */
  fallbackFare: number;
  isPool: boolean;
  paymentMethod: 'cash' | 'wallet';
  driverCoords: { lat: number; lng: number } | null;
  /** Fired once the last rider is out and the trip has been completed. */
  onCompleted: () => void;
  /** Whatever a ride needs before it may start (the dash cam). False = stop. */
  canStart: () => Promise<boolean>;
  /** Start the whole trip at once — a pool whose rider list could not be read. */
  onStartTrip: () => void;
  /** Bump to re-read the riders, e.g. when somebody is picked up on the way. */
  refreshKey?: number;
  busy: boolean;
  setBusy: (b: boolean) => void;
}

export function DropOffPanel({
  tripId,
  tripStatus,
  fallbackFare,
  isPool,
  paymentMethod,
  driverCoords,
  onCompleted,
  canStart,
  onStartTrip,
  refreshKey,
  busy,
  setBusy,
}: Props) {
  const [riders, setRiders] = useState<PoolRiderView[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  // A stop the driver has said "keep going" to, so the prompt does not reappear
  // every second while they are still parked next to it.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // An earlier ride's cancellation fee, collected with this fare (backend payments/nextRideFees).
  const fees = useTripFees(tripId);
  const feeOf = (uid: string) => fees[uid] ?? 0;
  const dueFrom = (r: PoolRiderView) => (r.fare ?? fallbackFare) + feeOf(r.uid);
  const feeNote = (fee: number) => (fee > 0 ? ` (incl. PKR ${fee} old cancellation fee)` : '');
  // A solo ride has one rider, so whatever is stamped is theirs.
  const soloFee = Object.values(fees).reduce((sum, f) => sum + f, 0);

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
    // The trip starting, or a rider joining on the way, changes who is aboard.
  }, [tripId, isPool, tripStatus, refreshKey]);

  // Derived, not stored: only a pool ever has anything to wait for.
  const loading = isPool && !loaded;

  const remaining = (riders ?? []).filter((r) => !r.droppedOff);
  // `boarded` is absent from an older backend, which only ever listed riders
  // who were already in the car.
  const waiting = remaining.filter((r) => r.boarded === false);
  const aboard = remaining.filter((r) => r.boarded !== false);
  /** A pool we could not break down behaves exactly like a solo ride. */
  const perRider = isPool && remaining.length > 0;

  async function startRider(rider: PoolRiderView) {
    if (tripStatus !== 'in_progress' && !(await canStart())) return;
    setBusy(true);
    try {
      await api.boardPoolRider({ tripId, riderUid: rider.uid });
      setRiders((prev) =>
        (prev ?? []).map((r) => (r.uid === rider.uid ? { ...r, boarded: true } : r)),
      );
    } catch (e) {
      Alert.alert('Could not start the ride', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

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
        `${rider.name}'s ride ended`,
        `${paymentMethod === 'cash' ? `Collect PKR ${dueFrom(rider)} in cash${feeNote(feeOf(rider.uid))}. ` : ''}`
          + `${res.remaining} passenger${res.remaining === 1 ? '' : 's'} still to go.`,
      );
    } catch (e) {
      Alert.alert('Could not drop off', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmComplete(message: string) {
    Alert.alert(
      'End the ride here?',
      message,
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'End ride', style: 'destructive', onPress: completeWholeTrip },
      ],
    );
  }

  /** The stop the driver has pulled up to, if any. Only someone aboard can get out. */
  const atStop = driverCoords
    ? aboard.find((r) => {
        if (dismissed.has(r.uid)) return false;
        if (!hasCoords({ lat: r.dropoffLat ?? undefined, lng: r.dropoffLng ?? undefined })) return false;
        return distanceMeters(driverCoords.lat, driverCoords.lng, r.dropoffLat!, r.dropoffLng!) <= ARRIVAL_RADIUS_M;
      })
    : undefined;

  if (loading) {
    return (
      <SkeletonRows rows={2} height={48} />
    );
  }

  // ── Solo, or a pool we could not break into riders ──
  if (!perRider) {
    if (tripStatus !== 'in_progress') {
      return (
        <Pressable
          style={({ pressed }) => [styles.completeBtn, pressed && { opacity: 0.85 }]}
          disabled={busy}
          onPress={onStartTrip}
        >
          <Text style={styles.completeBtnText}>START RIDE</Text>
        </Pressable>
      );
    }
    return (
      <Pressable
        style={({ pressed }) => [styles.completeBtn, pressed && { opacity: 0.85 }]}
        disabled={busy}
        onPress={() =>
          confirmComplete(
            `This ends the ride and settles the fare.${paymentMethod === 'cash' ? ` Collect PKR ${fallbackFare + soloFee} in cash${feeNote(soloFee)}.` : ''}`,
          )
        }
      >
        <Text style={styles.completeBtnText}>
          END RIDE{paymentMethod === 'cash' ? ` · collect PKR ${fallbackFare + soloFee}` : ''}
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
                End ride{paymentMethod === 'cash' ? ` · PKR ${dueFrom(atStop)}` : ''}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Not in the car yet: at the pickup, or standing on the road ahead. */}
      {waiting.length > 0 ? (
        <Text style={styles.sectionLabel}>
          {waiting.length} TO PICK UP · START EACH RIDE WHEN THEY GET IN
        </Text>
      ) : null}
      {waiting.map((r) => (
        <View key={r.uid} style={styles.riderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.riderName}>
              {r.name} {GENDER_MARK[r.gender] ?? ''}
            </Text>
            <Text style={styles.riderDrop} numberOfLines={1}>
              {r.pickupAddress ?? 'Pickup point'}
            </Text>
          </View>
          <View style={styles.riderActions}>
            <Pressable
              style={styles.riderNavBtn}
              onPress={() =>
                callInApp({ rideKind: 'trip', rideId: tripId, calleeId: r.uid, name: r.name, phone: r.phone })
              }
              accessibilityLabel={`Call ${r.name}`}
            >
              <Text style={styles.riderNavText}>📞</Text>
            </Pressable>
            {r.pickupLat != null && r.pickupLng != null ? (
              <Pressable
                style={styles.riderNavBtn}
                onPress={() => openNavigation({ lat: r.pickupLat!, lng: r.pickupLng!, address: r.pickupAddress })}
                accessibilityLabel={`Directions to ${r.name}'s pickup`}
              >
                <Text style={styles.riderNavText}>🧭</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.riderDropBtn, pressed && { opacity: 0.85 }]}
              disabled={busy}
              onPress={() => void startRider(r)}
            >
              <Text style={styles.riderDropText}>START RIDE</Text>
            </Pressable>
          </View>
        </View>
      ))}

      {aboard.length > 0 ? (
        <View style={styles.summaryRow}>
          <Text style={styles.sectionLabel}>
            {aboard.length} PASSENGER{aboard.length === 1 ? '' : 'S'} ABOARD
          </Text>
          {paymentMethod === 'cash' ? (
            <Text style={styles.summaryTotal}>
              PKR {aboard.reduce((sum, r) => sum + dueFrom(r), 0)} still to collect
            </Text>
          ) : null}
        </View>
      ) : tripStatus === 'in_progress' && waiting.length > 0 ? (
        // Everybody who got in is out, and the rest never turned up: the ride
        // still has to be endable, or the driver is stuck on it.
        <Pressable
          style={({ pressed }) => [styles.completeBtn, pressed && { opacity: 0.85 }]}
          disabled={busy}
          onPress={() =>
            confirmComplete(
              `${waiting.map((r) => r.name).join(', ')} never got in. They are not charged, and you owe no commission on them.`,
            )
          }
        >
          <Text style={styles.completeBtnText}>END RIDE</Text>
        </Pressable>
      ) : null}

      {aboard.map((r) => {
        const away =
          driverCoords && r.dropoffLat != null && r.dropoffLng != null
            ? formatDistance(distanceMeters(driverCoords.lat, driverCoords.lng, r.dropoffLat, r.dropoffLng))
            : null;
        const isLast = aboard.length === 1 && waiting.length === 0;
        return (
          <View key={r.uid} style={styles.riderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.riderName}>
                {r.name} {GENDER_MARK[r.gender] ?? ''}
              </Text>
              <Text style={styles.riderDrop} numberOfLines={1}>
                {r.dropoffAddress ?? 'Drop-off point'}
              </Text>
              <Text style={styles.riderMeta}>
                {paymentMethod === 'cash' ? `Collect PKR ${dueFrom(r)}${feeNote(feeOf(r.uid))}` : `PKR ${r.fare ?? fallbackFare} from wallet`}
                {away ? ` · ${away} away` : ''}
              </Text>
            </View>
            <View style={styles.riderActions}>
              {/* The passenger who is not at the kerb when you get there. Their
                  number is on the driver's copy of the manifest for exactly
                  this moment. */}
              <Pressable
                style={styles.riderNavBtn}
                onPress={() =>
                  callInApp({ rideKind: 'trip', rideId: tripId, calleeId: r.uid, name: r.name, phone: r.phone })
                }
                accessibilityLabel={`Call ${r.name}`}
              >
                <Text style={styles.riderNavText}>📞</Text>
              </Pressable>
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
                <Text style={styles.riderDropText}>END RIDE</Text>
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
      `${rider.name} is the last passenger.${paymentMethod === 'cash' ? ` Collect PKR ${dueFrom(rider)} in cash${feeNote(feeOf(rider.uid))}.` : ''} This ends the ride.`,
      [
        { text: 'Keep going', style: 'cancel' },
        { text: 'End ride', style: 'destructive', onPress: () => dropRider(rider) },
      ],
    );
  }
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: 8, marginBottom: 10 },

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

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    gap: 8,
  },
  sectionLabel: {
    color: colors.muted,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1,
  },
  summaryTotal: { color: colors.primary, fontSize: 11.5, fontWeight: '900' },
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
