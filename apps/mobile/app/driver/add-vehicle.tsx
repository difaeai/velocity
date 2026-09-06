/**
 * Add a car to the driver's account.
 *
 * Two steps, in the order a driver thinks about it: what KIND of vehicle, then
 * its details and papers. The kind comes first because it decides everything
 * after it — a motorcycle has no tariff to choose, a rickshaw has no colour
 * anybody cares about, and putting six ride-type pills in front of a bike rider
 * is how you get a bike registered as an AC car.
 *
 * Nothing here makes the car drivable. It is submitted for review, and an admin
 * has to see its registration certificate before it can be selected — the same
 * bar the driver's first car cleared at signup.
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Text, TextInput } from '../../src/ui/Text';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/config';
import { RIDE_TYPE_LABELS, type RideType } from '../../src/domain/types';
import { uploadDriverDoc } from '../../src/lib/uploadDoc';
import { choosePhoto, takePhoto } from '../../src/lib/photo';
import { themed } from '../../src/theme';

/**
 * The three shapes of vehicle on Pakistani roads, and the tariffs each one can
 * actually serve. A car can be any of four; a bike and a rickshaw are exactly
 * what they are, so their step 2 has no tariff question at all.
 */
const CLASSES: { key: string; label: string; icon: string; types: RideType[] }[] = [
  { key: 'car',        label: 'Car',        icon: '🚗', types: ['mini', 'ac', 'comfort', 'xl'] },
  { key: 'motorcycle', label: 'Motorcycle', icon: '🏍️', types: ['bike'] },
  { key: 'rickshaw',   label: 'Rickshaw',   icon: '🛺', types: ['auto'] },
];

export default function AddVehicle() {
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.uid;

  const [cls, setCls] = useState<(typeof CLASSES)[number] | null>(null);
  const [vehicleType, setVehicleType] = useState<RideType | null>(null);
  const [make, setMake] = useState('');
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [docUri, setDocUri] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/driver/vehicles'));

  const ready =
    !!vehicleType &&
    make.trim().length > 1 &&
    color.trim().length > 1 &&
    plate.trim().length > 2 &&
    !!docUri &&
    !!photoUri;

  function chooseClass(next: (typeof CLASSES)[number]) {
    setCls(next);
    // A single-tariff class answers its own question — don't ask it.
    setVehicleType(next.types.length === 1 ? next.types[0]! : null);
  }

  /** Papers may be photographed now or already be in the gallery; allow both. */
  function attach(setter: (uri: string) => void, cameraOnly: boolean) {
    const run = async (fn: () => Promise<string | null>) => {
      try {
        const uri = await fn();
        if (uri) setter(uri);
      } catch (e) {
        Alert.alert('Cannot open the camera', e instanceof Error ? e.message : 'Please try again.');
      }
    };
    if (cameraOnly) {
      run(takePhoto);
      return;
    }
    Alert.alert('Add a photo', undefined, [
      { text: 'Take a photo', onPress: () => run(takePhoto) },
      { text: 'Choose from gallery', onPress: () => run(choosePhoto) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function submit() {
    if (!uid || !ready || busy) return;
    setBusy(true);
    try {
      const [docResult, photoResult] = await Promise.all([
        uploadDriverDoc(uid, 'vehicle-doc', docUri!),
        uploadDriverDoc(uid, 'vehicle-photo', photoUri!),
      ]);
      await api.addDriverVehicle({
        vehicleType: vehicleType!,
        make: make.trim(),
        color: color.trim(),
        plate: plate.trim().toUpperCase(),
        docPath: docResult.path,
        docUrl: docResult.url,
        photoPath: photoResult.path,
        photoUrl: photoResult.url,
      });
      Alert.alert(
        'Sent for checking ✅',
        "We'll review this car's papers and let you know. Once it's approved you can switch to it from Your cars.",
        [{ text: 'Done', onPress: goBack }],
      );
    } catch (e) {
      Alert.alert('Could not add this car', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Step 1: what kind of vehicle ──────────────────────────────────────────
  if (!cls) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.headerBtn} />
          <View style={styles.headerBtn} />
          <Pressable onPress={goBack} hitSlop={12} style={styles.headerClose}>
            <Text style={styles.headerCloseTxt}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.stepBody}>
          <Text style={styles.title}>Choose your vehicle</Text>
          {CLASSES.map((c) => (
            <Pressable key={c.key} style={styles.classRow} onPress={() => chooseClass(c)}>
              <View style={styles.classIcon}><Text style={styles.classIconTxt}>{c.icon}</Text></View>
              <Text style={styles.classLabel}>{c.label}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    );
  }

  // ── Step 2: the car itself ────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => setCls(null)} hitSlop={12} style={styles.headerBtn} disabled={busy}>
          <Text style={styles.headerArrow}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{cls.label} details</Text>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {cls.types.length > 1 ? (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Which rides can it take?</Text>
              <View style={styles.pillRow}>
                {cls.types.map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.pill, vehicleType === t && styles.pillActive]}
                    onPress={() => setVehicleType(t)}
                  >
                    <Text style={[styles.pillTxt, vehicleType === t && styles.pillTxtActive]}>
                      {RIDE_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.block}>
            <Text style={styles.label}>Make &amp; model</Text>
            <TextInput
              style={styles.input}
              value={make}
              onChangeText={setMake}
              placeholder="e.g. Suzuki Swift"
              placeholderTextColor={colors.muted}
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>Colour</Text>
            <TextInput
              style={styles.input}
              value={color}
              onChangeText={setColor}
              placeholder="e.g. White"
              placeholderTextColor={colors.muted}
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.label}>Registration plate</Text>
            <TextInput
              style={styles.input}
              value={plate}
              onChangeText={setPlate}
              placeholder="e.g. ZK-659"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
            />
          </View>

          <UploadTile
            title="Certificate of registration"
            hint="A clear photo of the car's registration book or card."
            uri={docUri}
            onPress={() => attach(setDocUri, false)}
          />
          <UploadTile
            title="Front photo of the vehicle"
            hint="Take it from the front so the whole vehicle and its plate are readable."
            uri={photoUri}
            onPress={() => attach(setPhotoUri, true)}
          />

          <Pressable
            style={[styles.submit, (!ready || busy) && styles.submitOff]}
            onPress={() => {
              if (busy) return;
              if (!ready) {
                Alert.alert(
                  'Almost there',
                  'Fill in the make, colour and plate, and add both photos, so our team can check this vehicle.',
                );
                return;
              }
              submit();
            }}
          >
            {busy ? (
              <ActivityIndicator color="#101211" />
            ) : (
              <Text style={[styles.submitTxt, !ready && styles.submitTxtOff]}>Send for checking</Text>
            )}
          </Pressable>

          <Text style={styles.note}>
            We check every vehicle before it can be driven. You'll keep driving your current car in the
            meantime.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UploadTile({
  title, hint, uri, onPress,
}: { title: string; hint: string; uri: string | null; onPress: () => void }) {
  return (
    <Pressable style={styles.upload} onPress={onPress}>
      {uri ? (
        <Image source={{ uri }} style={styles.uploadImg} resizeMode="cover" />
      ) : (
        <View style={[styles.uploadImg, styles.uploadEmpty]}>
          <Text style={styles.uploadPlus}>＋</Text>
        </View>
      )}
      <View style={styles.uploadBody}>
        <Text style={styles.uploadTitle}>{title}</Text>
        <Text style={styles.uploadHint}>{uri ? 'Tap to replace' : hint}</Text>
      </View>
      {uri ? <Text style={styles.uploadTick}>✓</Text> : null}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerArrow: { fontSize: 26, color: colors.text, fontWeight: '600' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  headerClose: { paddingHorizontal: 12, height: 44, justifyContent: 'center' },
  headerCloseTxt: { fontSize: 16, color: colors.muted, fontWeight: '700' },

  stepBody: { paddingHorizontal: 18, gap: 8 },
  title: { fontSize: 26, fontWeight: '900', color: colors.text, marginBottom: 14 },

  classRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 12,
  },
  classIcon: {
    width: 56, height: 56, borderRadius: 14, backgroundColor: colors.glassChip,
    alignItems: 'center', justifyContent: 'center',
  },
  classIconTxt: { fontSize: 26 },
  classLabel: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
  chevron: { fontSize: 24, color: colors.muted, fontWeight: '600' },

  scroll: { padding: 18, gap: 16, paddingBottom: 40 },
  block: { gap: 8 },
  blockTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  input: {
    height: 52, borderRadius: 12, paddingHorizontal: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    color: colors.text, fontSize: 16, fontWeight: '600',
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 16, height: 42, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillTxt: { fontWeight: '800', color: colors.text },
  pillTxtActive: { color: '#101211' },

  upload: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  uploadImg: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.glassChip },
  uploadEmpty: { alignItems: 'center', justifyContent: 'center' },
  uploadPlus: { fontSize: 26, color: colors.muted, fontWeight: '700' },
  uploadBody: { flex: 1, gap: 3 },
  uploadTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  uploadHint: { fontSize: 12, lineHeight: 17, color: colors.muted },
  uploadTick: { fontSize: 20, color: colors.primary, fontWeight: '900' },

  submit: {
    height: 56, borderRadius: 14, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  submitOff: { backgroundColor: colors.glassStrong },
  submitTxt: { fontSize: 17, fontWeight: '800', color: '#101211' },
  // Still pressable while incomplete (it explains what is missing), so it has to
  // stay legible against the dimmed fill rather than going dark-on-dark.
  submitTxtOff: { color: colors.muted },

  note: { color: colors.muted, fontSize: 12, lineHeight: 18 },
}));
