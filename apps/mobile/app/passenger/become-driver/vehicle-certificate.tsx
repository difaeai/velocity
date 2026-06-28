import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { IdCardArt, OnbButton, StepHeader, SupportNote, UploadCard, oc, pickPhoto } from '../../../src/ui/onboarding';

export default function VehicleCertificate() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Certificate of vehicle registration" />
      <ScrollView contentContainerStyle={styles.container}>
        <UploadCard
          title="Certificate of vehicle registration"
          uri={data.vehicleDoc}
          onPick={() => pickPhoto((uri) => set({ vehicleDoc: uri }))}
          art={<IdCardArt label="VEHICLE" />}
        />
        <Text style={styles.fieldLabel}>Registration expiry date (YYYY-MM-DD)</Text>
        <TextInput
          style={styles.input}
          value={data.vehicleDocExpiry}
          onChangeText={t => set({ vehicleDocExpiry: t })}
          placeholder="e.g. 2026-12-31"
          placeholderTextColor={oc.sub}
          keyboardType="numeric"
        />
        <OnbButton label="Done" onPress={() => router.back()} disabled={!data.vehicleDoc} />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: oc.sub },
  input: { backgroundColor: oc.card, borderRadius: 10, borderWidth: 1, borderColor: oc.fieldBorder, padding: 12, color: oc.text, fontSize: 14 },
});
