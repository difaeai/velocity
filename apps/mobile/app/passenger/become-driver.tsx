import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { api } from '../../src/api/client';
import { useAuth } from '../../src/auth/AuthContext';
import { uploadDriverDoc } from '../../src/lib/uploadDoc';
import { colors } from '../../src/config';
import { Card, PrimaryButton } from '../../src/ui/components';
import { RIDE_TYPE_LABELS, type RideType } from '../../src/domain/types';

const RIDE_TYPES = Object.keys(RIDE_TYPE_LABELS) as RideType[];
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export default function BecomeDriver() {
  const { user, refreshRole } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [cnic, setCnic] = useState('');
  const [vehicleType, setVehicleType] = useState<RideType>('ac');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [plate, setPlate] = useState('');
  const [license, setLicense] = useState<string | null>(null);
  const [cnicDoc, setCnicDoc] = useState<string | null>(null);
  const [vehicleDoc, setVehicleDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function pick(setter: (uri: string) => void) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach documents.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!res.canceled && res.assets[0]) setter(res.assets[0].uri);
  }

  async function submit() {
    setError(null);
    if (!user) return;
    if (fullName.trim().length < 2) return setError('Enter your full name.');
    if (!CNIC_RE.test(cnic)) return setError('CNIC must look like 12345-1234567-1.');
    if (vehicleLabel.trim().length < 2 || plate.trim().length < 3)
      return setError('Enter your vehicle and plate.');
    if (!license || !cnicDoc || !vehicleDoc) return setError('Attach all three documents.');

    setLoading(true);
    try {
      const [licenseDocPath, cnicDocPath, vehicleDocPath] = await Promise.all([
        uploadDriverDoc(user.uid, 'license', license),
        uploadDriverDoc(user.uid, 'cnic', cnicDoc),
        uploadDriverDoc(user.uid, 'vehicle', vehicleDoc),
      ]);
      await api.submitDriverOnboarding({
        fullName: fullName.trim(),
        cnic,
        vehicleType,
        vehicleLabel: vehicleLabel.trim(),
        plate: plate.trim(),
        licenseDocPath,
        cnicDocPath,
        vehicleDocPath,
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed.');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.successWrap}>
          <Text style={styles.successEmoji}>✅</Text>
          <Text style={styles.title}>Submitted for review</Text>
          <Text style={styles.muted}>
            An admin will verify your documents. The driver experience unlocks in
            this app once you&apos;re approved.
          </Text>
          <PrimaryButton label="Check approval status" onPress={() => refreshRole()} />
          <PrimaryButton variant="secondary" label="Back to home" onPress={() => router.replace('/passenger/home')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Drive with Velocity</Text>
        <Text style={styles.muted}>Submit your details to get verified.</Text>

        <Card>
          <Field label="Full name" value={fullName} onChange={setFullName} placeholder="As on your CNIC" />
          <Field label="CNIC" value={cnic} onChange={setCnic} placeholder="12345-1234567-1" />
        </Card>

        <Card>
          <Text style={styles.label}>Vehicle type</Text>
          <View style={styles.pillRow}>
            {RIDE_TYPES.map((rt) => (
              <Pressable
                key={rt}
                onPress={() => setVehicleType(rt)}
                style={[styles.pill, vehicleType === rt && styles.pillActive]}
              >
                <Text style={[styles.pillTxt, vehicleType === rt && { color: '#fff' }]}>
                  {RIDE_TYPE_LABELS[rt]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field label="Vehicle" value={vehicleLabel} onChange={setVehicleLabel} placeholder="e.g. White Toyota Corolla" />
          <Field label="Number plate" value={plate} onChange={setPlate} placeholder="LEC-4820" />
        </Card>

        <Card>
          <Text style={styles.label}>Documents</Text>
          <DocPicker label="Driving licence" done={!!license} onPress={() => pick(setLicense)} />
          <DocPicker label="CNIC photo" done={!!cnicDoc} onPress={() => pick(setCnicDoc)} />
          <DocPicker label="Vehicle papers" done={!!vehicleDoc} onPress={() => pick(setVehicleDoc)} />
        </Card>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label="Submit for verification" onPress={submit} loading={loading} />
        <PrimaryButton variant="secondary" label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

function DocPicker({ label, done, onPress }: { label: string; done: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.docRow}>
      <Text style={styles.docLabel}>{label}</Text>
      <Text style={[styles.docState, done && { color: colors.primary }]}>
        {done ? '✓ Attached' : 'Attach'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
  successWrap: { flex: 1, padding: 24, gap: 12, alignItems: 'center', justifyContent: 'center' },
  successEmoji: { fontSize: 48 },
  title: { fontSize: 24, fontWeight: '900', color: colors.text, textAlign: 'center' },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 6 },
  input: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 12 },
  pill: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillTxt: { fontWeight: '800', color: colors.text },
  docRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  docLabel: { fontSize: 14, color: colors.text, fontWeight: '600' },
  docState: { fontSize: 13, fontWeight: '800', color: colors.muted },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
