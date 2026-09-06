/**
 * "Your cars" — every car this driver may drive, and which one they are in.
 *
 * A driver is not one car for life. They sell one, borrow a brother's for a
 * week, run a bike in the morning and a rickshaw at night. Pinning the account
 * to a single vehicle forces them to either lie about what they are driving or
 * stop driving, and the first is much worse: the passenger is watching for a
 * plate that will never arrive.
 *
 * Switching is deliberately not frictionless. A new car needs its papers seen by
 * an admin before it can be driven at all, and switching to it clears the car
 * photo check — so the next thing the driver does is photograph the car they
 * actually got into.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text } from '../../src/ui/Text';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import {
  PRIMARY_VEHICLE_ID,
  useDriverProfile,
  useDriverVehicles,
  vehicleCheckStatus,
  type DriverVehicle,
} from '../../src/hooks/driver';
import { RIDE_TYPE_LABELS } from '../../src/domain/types';
import { themed } from '../../src/theme';

export default function DriverVehicles() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid;
  const profile = useDriverProfile(uid);
  const vehicles = useDriverVehicles(uid);
  const check = vehicleCheckStatus(profile);
  const [busy, setBusy] = useState<string | null>(null);

  // Lift the onboarding car in, so a driver who registered before this screen
  // existed sees their car here instead of an empty list.
  const seeded = useRef(false);
  const [seeding, setSeeding] = useState(true);
  useEffect(() => {
    if (seeded.current || !uid) return;
    seeded.current = true;
    api.ensureDriverVehicles({})
      .catch(() => { /* the list below is live either way */ })
      .finally(() => setSeeding(false));
  }, [uid]);

  const activeId = profile?.activeVehicleId ?? PRIMARY_VEHICLE_ID;
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/driver/home'));

  function switchTo(v: DriverVehicle) {
    if (v.vehicleId === activeId) return;
    if (v.status === 'pending') {
      Alert.alert(
        'Still being checked',
        "We're reviewing this car's registration papers. As soon as it's approved you'll be able to drive it.",
      );
      return;
    }
    if (v.status === 'rejected') {
      Alert.alert('Not approved', v.reviewReason ?? 'This car was not approved, so it cannot be driven.');
      return;
    }
    Alert.alert(
      `Drive the ${v.label}?`,
      `Your rides will show ${v.label} · ${v.plate}. You'll be taken offline and asked for a photo of it before you can start again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch car',
          onPress: async () => {
            setBusy(v.vehicleId);
            try {
              await api.setActiveVehicle({ vehicleId: v.vehicleId });
              // Straight to the camera: a switched car with no photo cannot go
              // online, and finding that out later at the toggle is a worse way
              // to learn it.
              router.replace('/driver/car-verification');
            } catch (e) {
              Alert.alert('Could not switch car', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  function remove(v: DriverVehicle) {
    Alert.alert(
      `Remove the ${v.label}?`,
      'It will be taken off your account. You can add it again later, but it will need to be checked again.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(v.vehicleId);
            try {
              await api.deleteDriverVehicle({ vehicleId: v.vehicleId });
            } catch (e) {
              Alert.alert('Could not remove it', e instanceof Error ? e.message : 'Please try again.');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.headerBtn}>
          <Text style={styles.headerArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Your cars</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {seeding && vehicles.length === 0 ? (
          <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
        ) : null}

        {vehicles.map((v) => {
          const isActive = v.vehicleId === activeId;
          return (
            <Pressable
              key={v.vehicleId}
              style={[styles.card, isActive && styles.cardActive]}
              onPress={() => switchTo(v)}
              disabled={busy !== null}
            >
              <View style={styles.cardTop}>
                {v.photoUrl ? (
                  <Image source={{ uri: v.photoUrl }} style={styles.thumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]}><Text style={styles.thumbIcon}>🚗</Text></View>
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{v.label}</Text>
                  <Text style={styles.cardPlate}>{v.plate}</Text>
                  <Text style={styles.cardType}>
                    {RIDE_TYPE_LABELS[v.vehicleType] ?? v.vehicleType}
                  </Text>
                </View>
                {busy === v.vehicleId ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <StatusChip status={v.status} active={isActive} />
                )}
              </View>

              {/* The active car carries the photo state, because that is the one
                  standing between this driver and going online. */}
              {isActive ? (
                <Pressable
                  style={styles.checkRow}
                  onPress={() => router.push('/driver/car-verification')}
                >
                  <Text style={[styles.checkTxt, check.needsPhoto && styles.checkTxtWarn]}>
                    {check.needsPhoto
                      ? '📸 Photo needed before you can go online'
                      : `📸 Photo confirmed · ${check.daysLeft} day${check.daysLeft === 1 ? '' : 's'} left`}
                  </Text>
                  <Text style={styles.checkChevron}>›</Text>
                </Pressable>
              ) : null}

              {v.status === 'rejected' && v.reviewReason ? (
                <Text style={styles.rejectReason}>{v.reviewReason}</Text>
              ) : null}

              {!isActive && vehicles.length > 1 ? (
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => remove(v)}
                  disabled={busy !== null}
                  hitSlop={6}
                >
                  <Text style={styles.removeTxt}>Remove</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}

        {!seeding && vehicles.length === 0 ? (
          <Text style={styles.empty}>
            No cars on your account yet. Add the one you drive to start taking rides.
          </Text>
        ) : null}

        <Pressable style={styles.addBtn} onPress={() => router.push('/driver/add-vehicle')}>
          <Text style={styles.addTxt}>+  Add a car</Text>
        </Pressable>

        <Text style={styles.note}>
          A new car is checked by our team before you can drive it — usually the same day. Whenever you
          switch cars we ask for a fresh photo, so the car your passenger is waiting for is the car that
          turns up.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusChip({ status, active }: { status: DriverVehicle['status']; active: boolean }) {
  if (active) {
    return (
      <View style={[styles.chip, styles.chipActive]}>
        <Text style={[styles.chipTxt, styles.chipActiveTxt]}>Driving now</Text>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={[styles.chip, styles.chipPending]}>
        <Text style={[styles.chipTxt, styles.chipPendingTxt]}>Under review</Text>
      </View>
    );
  }
  if (status === 'rejected') {
    return (
      <View style={[styles.chip, styles.chipRejected]}>
        <Text style={[styles.chipTxt, styles.chipRejectedTxt]}>Not approved</Text>
      </View>
    );
  }
  return (
    <View style={styles.chip}>
      <Text style={styles.chipTxt}>Switch</Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerArrow: { fontSize: 26, color: colors.text, fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },

  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  loading: { paddingVertical: 30 },

  card: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  cardActive: { borderColor: colors.primary },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.glassChip },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: 26 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  cardPlate: { fontSize: 14, fontWeight: '700', color: colors.muted, letterSpacing: 0.5 },
  cardType: { fontSize: 12, fontWeight: '600', color: colors.muted },

  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.glassChip },
  chipTxt: { fontSize: 11, fontWeight: '800', color: colors.text },
  chipActive: { backgroundColor: colors.primary },
  chipActiveTxt: { color: '#101211' },
  chipPending: { backgroundColor: 'rgba(245,158,11,0.18)' },
  chipPendingTxt: { color: '#f59e0b' },
  chipRejected: { backgroundColor: `${colors.danger}22` },
  chipRejectedTxt: { color: colors.danger },

  checkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.glassChip, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  checkTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.muted },
  checkTxtWarn: { color: '#f59e0b' },
  checkChevron: { fontSize: 20, color: colors.muted, fontWeight: '700' },

  rejectReason: { fontSize: 13, lineHeight: 19, color: colors.danger },

  removeBtn: { alignSelf: 'flex-start', paddingVertical: 4 },
  removeTxt: { fontSize: 13, fontWeight: '700', color: colors.danger },

  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 20 },

  addBtn: {
    height: 54, borderRadius: 14, backgroundColor: colors.glassChip,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  addTxt: { fontSize: 16, fontWeight: '800', color: colors.text },

  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
}));
