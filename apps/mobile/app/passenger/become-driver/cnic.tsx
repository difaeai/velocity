import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useOnboarding } from '../../../src/onboarding/context';
import { Field, IdCardArt, StepHeader, UploadCard, pickPhoto } from '../../../src/ui/onboarding';
import { PrimaryButton } from '../../../src/ui/components';
import { colors } from '../../../src/config';

const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export default function Cnic() {
  const router = useRouter();
  const { data, set } = useOnboarding();
  const valid = !!data.cnicFront && !!data.cnicBack && CNIC_RE.test(data.cnicNumber);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StepHeader title="CNIC" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <UploadCard
          title="CNIC (front side)"
          uri={data.cnicFront}
          onPick={() => pickPhoto((uri) => set({ cnicFront: uri }))}
          art={<IdCardArt label="CNIC" />}
        />
        <UploadCard
          title="CNIC (back side)"
          uri={data.cnicBack}
          onPick={() => pickPhoto((uri) => set({ cnicBack: uri }))}
          art={<IdCardArt label="CNIC" />}
        />
        <Field
          label="CNIC number"
          value={data.cnicNumber}
          onChangeText={(t) => set({ cnicNumber: t })}
          placeholder="12345-1234567-1"
          keyboardType="numbers-and-punctuation"
        />
        <PrimaryButton label="Done" onPress={() => router.back()} disabled={!valid} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { padding: 18, gap: 14 },
});
