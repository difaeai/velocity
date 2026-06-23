import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { Field, OnbButton, StepHeader, oc } from '../../../src/ui/onboarding';

export default function VehiclePlate() {
  const router = useRouter();
  const { data, set } = useOnboarding();
  const valid = data.plate.trim().length > 2;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="Registration plate" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Field
          label="Number plate"
          value={data.plate}
          onChangeText={(t) => set({ plate: t })}
          placeholder="LEC-4820"
          autoCapitalize="characters"
        />
        <OnbButton label="Done" onPress={() => router.back()} disabled={!valid} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: oc.screen },
  container: { padding: 18, gap: 14 },
});
