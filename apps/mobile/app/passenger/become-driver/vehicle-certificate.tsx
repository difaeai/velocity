import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
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
        <OnbButton label="Done" onPress={() => router.back()} disabled={!data.vehicleDoc} />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
});
