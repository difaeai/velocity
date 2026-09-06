/**
 * Car photo verification — the gate in front of going online.
 *
 * A passenger's whole safety check is "a white Suzuki Swift, ZK-659, will pull
 * up". Documents reviewed at signup cannot promise that months later: cars get
 * sold, swapped, repainted, crashed. So before a shift the driver photographs
 * the car they are about to drive, and that photo is what stands behind the
 * plate on the passenger's screen.
 *
 * Reached two ways, and it has to read correctly from both:
 *   · pressing Online with no live photo (`intent=online` → we take them online
 *     the moment the photo lands, because going online is what they asked for);
 *   · from the car screens or the home banner, where confirming is the whole
 *     errand and nothing else should happen afterwards.
 *
 * The enforcement itself is NOT here — the Firestore rules refuse the `online`
 * write without a live check (see firestore.rules). This screen is how a driver
 * satisfies that rule, not how it is imposed.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { Text } from '../../src/ui/Text';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { db } from '../../src/firebase';
import { colors } from '../../src/config';
import {
  PRIMARY_VEHICLE_ID,
  useDriverProfile,
  useDriverVehicles,
  vehicleCheckStatus,
  type VehicleCheckReason,
} from '../../src/hooks/driver';
import { uploadDriverDoc } from '../../src/lib/uploadDoc';
import { takePhoto } from '../../src/lib/photo';
import { themed } from '../../src/theme';

/** What the photo has to show. Stated before the camera, not after a rejection. */
const RULES = [
  'The whole car must be in the photo. The photo is sharp and well-lit',
  'The registration plate must be easy to read and match the car documents',
  "Screen photos, edited or generated pictures aren't accepted",
];

/** Why we are asking — each reason gets its own honest sentence. */
const WHY: Record<Exclude<VehicleCheckReason, null>, string> = {
  never: 'Confirm your car once and you can start taking rides.',
  car_changed: "You've switched cars. Take a photo of the one you're driving now.",
  expired: "It's been a while since your last car photo. Take a fresh one to keep driving.",
  rejected: 'Your last car photo was turned down. Please take another one.',
};

export default function CarVerification() {
  const router = useRouter();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const goOnlineAfter = intent === 'online';

  const { user } = useAuth();
  const uid = user?.uid;
  const profile = useDriverProfile(uid);
  const vehicles = useDriverVehicles(uid);
  const check = vehicleCheckStatus(profile);

  const [busy, setBusy] = useState(false);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/driver/home'));

  /**
   * Cold-start race.
   *
   * Home decides whether to send a driver here from the driver document, which
   * on a fresh launch has not arrived yet — so a fast tap on Online lands here
   * with nothing to confirm. Rather than making them photograph a car that is
   * already confirmed, finish what they actually asked for. Latched on the FIRST
   * snapshot so it can never fire a second time on the way back out.
   */
  const settled = useRef(false);
  useEffect(() => {
    if (!goOnlineAfter || !uid || !profile || settled.current) return;
    settled.current = true;
    if (check.needsPhoto) return;
    setDoc(doc(db, 'drivers', uid), { online: true, lastSeenAt: serverTimestamp() }, { merge: true })
      .catch(() => { /* the toggle on home stays offline and can be tapped again */ })
      .finally(goBack);
    // goBack/check are read once, at the moment the first snapshot lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goOnlineAfter, uid, profile]);

  // Drivers approved before cars became documents have theirs only in the flat
  // fields on the driver record. Lifting it across is idempotent and gives this
  // screen (and the car list behind "Change a car") something real to show.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !uid) return;
    seeded.current = true;
    api.ensureDriverVehicles({}).catch(() => {
      // Non-fatal: the flat fields below still describe the car correctly.
    });
  }, [uid]);

  const activeId = profile?.activeVehicleId ?? PRIMARY_VEHICLE_ID;
  const active = vehicles.find((v) => v.vehicleId === activeId);
  const label = active?.label ?? profile?.vehicleLabel ?? 'Your car';
  const plate = active?.plate ?? profile?.plate ?? '';
  const referencePhoto = active?.photoUrl ?? profile?.vehiclePhotoDocUrl ?? null;

  async function confirm() {
    if (!uid || busy) return;
    setBusy(true);
    try {
      const uri = await takePhoto();
      // Backing out of the camera is not a failure — leave the screen as it was.
      if (!uri) return;

      const { path, url } = await uploadDriverDoc(uid, 'car-check', uri);
      await api.confirmVehiclePhoto({ photoPath: path, photoUrl: url });

      if (goOnlineAfter) {
        // They pressed Online and were sent here; finish the job they asked for.
        // The rules accept this write now that the check exists server-side.
        await setDoc(
          doc(db, 'drivers', uid),
          { online: true, lastSeenAt: serverTimestamp() },
          { merge: true },
        );
        goBack();
        return;
      }
      Alert.alert(
        'Car confirmed ✅',
        "You're all set. We'll ask for a fresh photo in about a month, or whenever you change cars.",
        [{ text: 'Done', onPress: goBack }],
      );
    } catch (e) {
      Alert.alert('Could not confirm your car', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12} style={styles.closeBtn} disabled={busy}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Car photo verification</Text>

        {check.reason ? (
          <View style={[styles.why, check.reason === 'rejected' && styles.whyBad]}>
            <Text style={[styles.whyTxt, check.reason === 'rejected' && styles.whyBadTxt]}>
              {WHY[check.reason]}
            </Text>
            {check.reason === 'rejected' && check.rejectionReason ? (
              <Text style={styles.whyReason}>{check.rejectionReason}</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.why}>
            <Text style={styles.whyTxt}>
              Your car is confirmed. You can take a new photo any time.
            </Text>
          </View>
        )}

        <View style={styles.rules}>
          {RULES.map((rule) => (
            <View key={rule} style={styles.ruleRow}>
              <View style={styles.tick}><Text style={styles.tickTxt}>✓</Text></View>
              <Text style={styles.ruleTxt}>{rule}</Text>
            </View>
          ))}
        </View>

        {/* The car on file, so the driver can see which car we are asking about
            — and so a driver holding the wrong keys notices before they drive. */}
        <View style={styles.carCard}>
          {referencePhoto ? (
            <Image source={{ uri: referencePhoto }} style={styles.carPhoto} resizeMode="cover" />
          ) : (
            <View style={[styles.carPhoto, styles.carPhotoEmpty]}>
              <Text style={styles.carPhotoEmptyTxt}>No photo on file yet</Text>
            </View>
          )}
          <Text style={styles.carLabel}>
            {label}{plate ? ` ${plate}` : ''}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          style={[styles.primary, busy && styles.primaryBusy]}
          onPress={confirm}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#101211" /> : <Text style={styles.primaryTxt}>Take picture</Text>}
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => router.push('/driver/vehicles')}
          disabled={busy}
        >
          <Text style={styles.secondaryTxt}>Change a car</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 4 },
  closeBtn: { padding: 8 },
  close: { fontSize: 22, color: colors.text, fontWeight: '600' },

  scroll: { paddingHorizontal: 22, paddingBottom: 20, gap: 18 },
  title: { fontSize: 32, fontWeight: '900', color: colors.text, lineHeight: 38 },

  why: { backgroundColor: colors.glassChip, borderRadius: 14, padding: 14, gap: 6 },
  whyBad: { backgroundColor: `${colors.danger}1a` },
  whyTxt: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  whyBadTxt: { color: colors.danger },
  whyReason: { color: colors.muted, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },

  rules: { gap: 14 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tick: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.text,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  tickTxt: { color: colors.background, fontSize: 14, fontWeight: '900' },
  ruleTxt: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '500' },

  carCard: { gap: 12, alignItems: 'center' },
  carPhoto: { width: '100%', height: 210, borderRadius: 16, backgroundColor: colors.glassChip },
  carPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  carPhotoEmptyTxt: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  carLabel: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  actions: { paddingHorizontal: 22, paddingTop: 8, gap: 12 },
  primary: {
    height: 56, borderRadius: 14, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBusy: { opacity: 0.7 },
  primaryTxt: { color: '#101211', fontSize: 17, fontWeight: '800' },
  secondary: {
    height: 56, borderRadius: 14, backgroundColor: colors.glassChip,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryTxt: { color: colors.text, fontSize: 17, fontWeight: '700' },
}));
