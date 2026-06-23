import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { OnbButton, StepHeader, SupportNote, UploadCard, oc, pickPhoto } from '../../../src/ui/onboarding';

export default function VehiclePhoto() {
  const router = useRouter();
  const { data, set } = useOnboarding();

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Picture" />
      <ScrollView contentContainerStyle={styles.container}>
        <UploadCard
          title="A clear photo of your vehicle"
          uri={data.vehiclePhoto}
          onPick={() => pickPhoto((uri) => set({ vehiclePhoto: uri }))}
        />
        <OnbButton label="Done" onPress={() => router.back()} disabled={!data.vehiclePhoto} />
        <SupportNote />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
});
