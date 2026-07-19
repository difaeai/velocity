import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { DateField, IdCardArt, OnbButton, StepHeader, SupportNote, UploadCard, oc, pickPhoto } from '../../../src/ui/onboarding';
import { themed } from '../../../src/theme';

export default function VehicleCertificate() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Certificate of vehicle registration" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <UploadCard
          title="Certificate of vehicle registration"
          uri={data.vehicleDoc}
          onPick={() => pickPhoto((uri) => set({ vehicleDoc: uri }))}
          art={<IdCardArt label="VEHICLE" />}
        />
        <DateField
          label="Registration expiry date"
          optional
          value={data.vehicleDocExpiry}
          onChange={(v) => set({ vehicleDocExpiry: v })}
          placeholder="Select a date"
          minimumDate={new Date()}
        />
        <OnbButton
          label="Done"
          onPress={() => router.back()}
          disabled={!data.vehicleDoc}
          disabledHint="Add a photo of the certificate of vehicle registration."
        />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themed(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
}));
